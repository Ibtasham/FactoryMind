import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultFactoryConfigFromWorkspace,
  estimateSpcQualityProfile,
  FactorySimConfig,
  runFactorySimulation,
  runSensitivitySweep,
  stationsFromLineBalanceForFactory,
} from './factorySim.ts';
import { FactoryStore, StorageBackend } from '../store/store.ts';

function baseConfig(): FactorySimConfig {
  const stations = stationsFromLineBalanceForFactory(null);
  return {
    name: 'Test Line',
    assemblySku: 'ASM-TEST',
    assemblyName: 'Test Assembly',
    arrivalRatePerHour: 5.5,
    arrivalCv: 0.35,
    serviceDist: 'lognormal',
    routingMode: 'serial',
    defectRatePct: 0,
    reworkTargetStationIdx: 0,
    maxReworkLoops: 2,
    shiftsPerDay: 2,
    shiftHours: 8,
    daysToSimulate: 3,
    warmupHours: 4,
    operatorsAvailable: 3,
    laborRatePerHour: 28,
    wipHoldingCostPerJobHour: 3,
    stockoutPenaltyPerMissedJob: 12,
    replications: 8,
    seed: 1337,
    enforceMaterialFlow: false,
    stations,
    materials: [],
    sourceNotes: {
      demandOrigin: 'test',
      lineBalanceOrigin: 'test',
      bomOrigin: 'none',
      spcOrigin: 'zero defects',
    },
  };
}

test('FactorySim: deterministic reproducibility and provenance tagging', () => {
  const cfg = baseConfig();
  const r1 = runFactorySimulation(cfg);
  const r2 = runFactorySimulation(cfg);

  assert.equal(r1.valid, true);
  assert.equal(r1.provenance, 'SIMULATED_MODEL');
  assert.equal(r1.configHash, r2.configHash);
  assert.equal(r1.throughputPerHour.mean, r2.throughputPerHour.mean);
  assert.equal(r1.cycleTimeMin.mean, r2.cycleTimeMin.mean);
  assert.equal(r1.oeePct, r2.oeePct);
  assert.ok(r1.timeline.length > 0);
});

test('FactorySim: Little\'s Law holds closely in steady-state unstarved flow', () => {
  const cfg: FactorySimConfig = {
    ...baseConfig(),
    arrivalRatePerHour: 4.0,
    daysToSimulate: 5,
    warmupHours: 8,
    replications: 10,
    stations: baseConfig().stations.map((s) => ({
      ...s,
      mtbfMin: 0,
      bufferCapacity: 25,
      meanTimeMin: 8.0,
      cv: 0.15,
    })),
  };
  const res = runFactorySimulation(cfg);
  assert.equal(res.valid, true);
  assert.ok(res.littlesLawGapPct < 10, `Expected Little's Law gap < 10%, got ${res.littlesLawGapPct.toFixed(2)}%`);
});

test('FactorySim: adding +1 parallel machine at bottleneck raises throughput & lowers utilization', () => {
  const cfg: FactorySimConfig = {
    ...baseConfig(),
    arrivalRatePerHour: 7.5,
    replications: 8,
  };
  const before = runFactorySimulation(cfg);
  const bn = before.bottleneckIndex;
  assert.ok(before.stations[bn].utilizationPct > 75);

  const relievedCfg: FactorySimConfig = {
    ...cfg,
    operatorsAvailable: cfg.operatorsAvailable + 1,
    stations: cfg.stations.map((s, idx) => (idx === bn ? { ...s, machineCount: s.machineCount + 1 } : s)),
  };
  const after = runFactorySimulation(relievedCfg);

  assert.ok(after.throughputPerHour.mean > before.throughputPerHour.mean);
  assert.ok(after.stations[bn].utilizationPct < before.stations[bn].utilizationPct);
});

test('FactorySim: rework-loop improves good output vs scrap and tracks first-pass yield', () => {
  const serialCfg: FactorySimConfig = {
    ...baseConfig(),
    arrivalRatePerHour: 4.2,
    routingMode: 'serial',
    defectRatePct: 12,
    replications: 8,
  };
  const reworkCfg: FactorySimConfig = {
    ...serialCfg,
    routingMode: 'rework-loop',
    reworkTargetStationIdx: 1,
    maxReworkLoops: 2,
  };

  const serialRes = runFactorySimulation(serialCfg);
  const reworkRes = runFactorySimulation(reworkCfg);

  assert.ok(reworkRes.reworkCount > 0);
  assert.ok(reworkRes.goodUnitsCompleted > serialRes.goodUnitsCompleted);
  assert.ok(reworkRes.scrapUnits < serialRes.scrapUnits);
  assert.ok(reworkRes.firstPassYieldPct < 96);
});

test('FactorySim: Preventive Maintenance generates PM events and material flow enforces BOM stockouts', () => {
  const cfg: FactorySimConfig = {
    ...baseConfig(),
    arrivalRatePerHour: 5.0,
    enforceMaterialFlow: true,
    daysToSimulate: 3,
    stations: baseConfig().stations.map((s) => ({
      ...s,
      pmIntervalMin: 240,
      pmDurationMin: 6,
    })),
    materials: [
      {
        productId: 'm1',
        sku: 'MOT-TEST',
        name: 'Test Motor',
        unit: 'pcs',
        initialStock: 25,
        qtyPerJob: 1,
        rop: 15,
        orderQty: 40,
        leadTimeDays: 10,
        unitCost: 75,
      },
    ],
  };

  const res = runFactorySimulation(cfg);
  assert.equal(res.valid, true);
  assert.ok(res.stations.some((s) => s.pmEventsCount > 0), 'Expected PM events to fire');
  assert.ok(res.materialStarvedHours > 1, 'Expected low-stock BOM material to cause starvation hours');
  assert.equal(res.materialBottleneckSku, 'MOT-TEST');
  assert.ok(res.materials[0].replenishmentOrders >= 1);
  assert.equal(res.materials[0].stockoutOccurred, true);
});

test('FactorySim: workforce shortage slows throughput and sensitivity sweep ranks capacity & ROP relief', () => {
  const fullOps = baseConfig();
  const shortOps: FactorySimConfig = {
    ...fullOps,
    operatorsAvailable: 1,
  };
  const rFull = runFactorySimulation(fullOps);
  const rShort = runFactorySimulation(shortOps);

  assert.ok(rShort.effectiveStaffingRatio < 0.5);
  assert.ok(rShort.throughputPerHour.mean < rFull.throughputPerHour.mean);

  const sweep = runSensitivitySweep({
    ...fullOps,
    arrivalRatePerHour: 7.2,
  });
  assert.ok(sweep.baseline.valid);
  assert.ok(sweep.levers.length >= 4);
  assert.ok(sweep.levers[0].throughputDeltaPct >= sweep.levers[sweep.levers.length - 1].throughputDeltaPct);
});

test('FactorySim: workspace sync builder connects Store catalog, LineBalance, Forecast & SPC profiles', () => {
  const map: Record<string, string> = {};
  const storage: StorageBackend = {
    persistent: false,
    get: (k) => (k in map ? map[k] : null),
    set: (k, v) => {
      map[k] = v;
    },
    del: (k) => {
      delete map[k];
    },
  };
  const store = new FactoryStore(storage);
  const cfg = buildDefaultFactoryConfigFromWorkspace({
    products: store.products(),
    lineBalance: store.getLineBalance(),
    metricsOf: (p) => store.metrics(p as any),
    assemblySku: 'ASM-PA100',
    spcProfile: 'drift',
  });

  assert.equal(cfg.assemblySku, 'ASM-PA100');
  assert.ok(cfg.stations.length >= 3);
  assert.ok(cfg.materials.length >= 5);
  assert.ok(cfg.defectRatePct > estimateSpcQualityProfile('stable').defectRatePct);

  const res = runFactorySimulation(cfg);
  assert.equal(res.valid, true);
});
