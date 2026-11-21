import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceWorkingMinutes,
  buildDesConfigFromFactorySim,
  DesConfig,
  isWorkingCalendarMinute,
  MinHeap,
  runDesExperimentSuite,
  runDiscreteEventSimulation,
  sampleDist,
  scheduledMinutesBetween,
} from './desEngine.ts';
import { buildDefaultFactoryConfigFromWorkspace } from './factorySim.ts';
import { mulberry32 } from './ipe.ts';
import { FactoryStore, StorageBackend } from '../store/store.ts';

/* -------------------------------------------------------------------------- */
/*  1. Priority Queue (MinHeap) Ordering & FIFO Tie-Breaking                  */
/* -------------------------------------------------------------------------- */

test('MinHeap pops events in ascending (time, seq) order with deterministic tie-breaking', () => {
  const heap = new MinHeap<{ time: number; seq: number; label: string }>();
  const inputs = [
    { time: 25, seq: 0, label: 't25-a' },
    { time: 10, seq: 1, label: 't10-b' },
    { time: 40, seq: 2, label: 't40-a' },
    { time: 10, seq: 3, label: 't10-c' },
    { time: 5, seq: 4, label: 't5-a' },
    { time: 10, seq: 0, label: 't10-a' },
    { time: 25, seq: 1, label: 't25-b' },
  ];
  for (const item of inputs) heap.push(item);
  assert.equal(heap.size, 7);

  const popped: string[] = [];
  while (heap.size > 0) {
    popped.push(heap.pop()!.label);
  }
  assert.deepEqual(popped, ['t5-a', 't10-a', 't10-b', 't10-c', 't25-a', 't25-b', 't40-a']);
  assert.equal(heap.pop(), undefined);
});

/* -------------------------------------------------------------------------- */
/*  2. Working Calendar & Shift Pause / Resume Invariants                     */
/* -------------------------------------------------------------------------- */

test('Working calendar computes exact scheduled minutes and pauses active jobs across shift boundaries', () => {
  const cal = {
    shiftsPerDay: 1,
    shiftHours: 8, // 480 min working per day, 960 min off-shift
    workingDaysPerWeek: 5,
    firstShiftStartMin: 480, // 08:00 - 16:00
  };

  assert.equal(isWorkingCalendarMinute(479, cal), false);
  assert.equal(isWorkingCalendarMinute(480, cal), true);
  assert.equal(isWorkingCalendarMinute(959, cal), true);
  assert.equal(isWorkingCalendarMinute(960, cal), false);

  // Full 7-day week (10080 calendar min) = 5 * 8h = 2400 working min
  assert.equal(scheduledMinutesBetween(0, 7 * 1440, cal), 5 * 480);

  // Job needing 300 working min starting at 13:00 (min 780) uses 180 min today (until 960),
  // skips 16:00 -> 08:00 next day (1440+480 = 1920), and completes at 1920 + 120 = 2040.
  assert.equal(advanceWorkingMinutes(780, 300, cal), 2040);

  // End-to-end DES check: single order released at 13:00 (780) taking 300m finishes at 2040 => Lead Time = 1260m
  const res = runDiscreteEventSimulation({
    name: 'Shift Pause Verification',
    horizonHours: 48,
    warmupHours: 0,
    deterministic: true,
    calendar: cal,
    stations: [
      {
        id: 'MILL',
        name: 'CNC Mill',
        machineCount: 1,
        bufferCapacity: 5,
        processDist: { kind: 'constant', mean: 300 },
      },
    ],
    routes: [{ id: 'R1', sku: 'SKU-1', name: 'Route 1', steps: [{ stationId: 'MILL' }] }],
    orders: [{ id: 'ORD-1', sku: 'SKU-1', routeId: 'R1', qty: 1, releaseAtMin: 780, dueAtMin: 2500 }],
  });

  assert.equal(res.valid, true);
  assert.equal(res.totalThroughputGood, 1);
  assert.ok(Math.abs(res.avgLeadTimeMin.mean - 1260) < 1e-6, `Expected 1260m lead time across night gap, got ${res.avgLeadTimeMin.mean}`);
  assert.equal(res.flowBalance.conservationResidual, 0);
  // Scheduled working hours over 48h (2 working days * 8h) = 16h; busy = 5h; unplanned down = 0
  assert.ok(Math.abs(res.scheduledWorkingHours - 16) < 1e-6);
  assert.equal(res.stations[0].downMin, 0);
  assert.ok(Math.abs(res.stations[0].busyMin - 300) < 1e-6);
  assert.ok(Math.abs(res.stations[0].offShiftMin - 32 * 60) < 1e-6);
  assert.ok(res.teepPct < res.oeePct, 'TEEP must reflect non-24/7 calendar schedule ratio below OEE');
});

/* -------------------------------------------------------------------------- */
/*  3. Deterministic D/D/1 Analytical Serial Line Benchmark                   */
/* -------------------------------------------------------------------------- */

test('Deterministic D/D/1 tandem 3-station line matches exact analytical cycle time and zero queue wait', () => {
  // Release 10 units every 10 min starting at t=0; station times = [4, 6, 5] <= 10m interarrival => zero wait!
  const orders = Array.from({ length: 10 }, (_, idx) => ({
    id: `ORD-${idx + 1}`,
    sku: 'PUMP',
    routeId: 'R-SERIAL',
    qty: 1,
    releaseAtMin: idx * 10,
    dueAtMin: idx * 10 + 20,
  }));

  const res = runDiscreteEventSimulation({
    name: 'D/D/1 Tandem Analytical Benchmark',
    horizonHours: 4, // 240m -> all 10 finish by 90 + 15 = 105m
    warmupHours: 0,
    deterministic: true,
    stations: [
      { id: 'S1', name: 'Cut', machineCount: 1, bufferCapacity: 5, processDist: { kind: 'constant', mean: 4 } },
      { id: 'S2', name: 'Machine', machineCount: 1, bufferCapacity: 5, processDist: { kind: 'constant', mean: 6 } },
      { id: 'S3', name: 'Assemble', machineCount: 1, bufferCapacity: 5, processDist: { kind: 'constant', mean: 5 } },
    ],
    routes: [
      {
        id: 'R-SERIAL',
        sku: 'PUMP',
        name: 'Serial Route',
        steps: [{ stationId: 'S1' }, { stationId: 'S2' }, { stationId: 'S3' }],
      },
    ],
    orders,
  });

  assert.equal(res.valid, true);
  assert.equal(res.totalThroughputGood, 10);
  assert.equal(res.completionRatePct, 100);
  assert.equal(res.onTimeDeliveryPct, 100);
  assert.ok(Math.abs(res.avgCycleTimeMin.mean - 15) < 1e-9);
  assert.ok(Math.abs(res.avgLeadTimeMin.mean - 15) < 1e-9);
  assert.ok(Math.abs(res.avgQueueWaitMin) < 1e-9);
  // Exact time-average WIP: 10 units * 15 min / 240 min = 0.625 jobs
  assert.ok(Math.abs(res.avgWip.mean - 0.625) < 1e-6);
  assert.equal(res.bottleneckId, 'S2');
  assert.equal(res.flowBalance.conservationResidual, 0);
});

/* -------------------------------------------------------------------------- */
/*  4. Analytical Queueing Convergence: M/M/1 & M/M/2 Reference Comparison    */
/* -------------------------------------------------------------------------- */

test('Stochastic M/M/1 open-arrival simulation converges closely to analytical queueing formula and Little Law', () => {
  // lambda = 6 jobs/hr (0.1/min), mu = 10 jobs/hr (mean = 6 min), rho = 0.6
  // Analytical M/M/1: L = rho / (1 - rho) = 1.50 jobs; W = L / lambda = 15.0 min
  const res = runDiscreteEventSimulation({
    name: 'M/M/1 Queueing Validation',
    horizonHours: 140,
    warmupHours: 20,
    replications: 10,
    seed: 9101,
    stations: [
      {
        id: 'SRV',
        name: 'Single Server',
        machineCount: 1,
        bufferCapacity: 300,
        processDist: { kind: 'exponential', mean: 6 },
      },
    ],
    routes: [{ id: 'R1', sku: 'JOB', name: 'Job', steps: [{ stationId: 'SRV' }] }],
    openArrivals: { ratePerHour: 6, cv: 1.0, clockMode: 'calendar' },
  });

  assert.equal(res.valid, true);
  assert.ok(
    res.avgCycleTimeMin.mean > 12.5 && res.avgCycleTimeMin.mean < 18.0,
    `M/M/1 mean cycle time expected near 15.0m, got ${res.avgCycleTimeMin.mean.toFixed(2)}m`
  );
  assert.ok(
    res.avgWip.mean > 1.2 && res.avgWip.mean < 1.9,
    `M/M/1 mean WIP expected near 1.50, got ${res.avgWip.mean.toFixed(2)}`
  );
  assert.ok(res.littlesLawGapPct < 4.0, `Expected Little's Law gap < 4%, got ${res.littlesLawGapPct.toFixed(2)}%`);
  assert.equal(Math.abs(res.flowBalance.conservationResidual) < 1e-6, true);
});

test('Stochastic M/M/2 parallel-machine station reduces cycle time over overloaded 1-machine line', () => {
  const mkCfg = (machines: number): DesConfig => ({
    name: `M/M/${machines}`,
    horizonHours: 60,
    warmupHours: 10,
    replications: 6,
    seed: 5511,
    stations: [
      {
        id: 'CELL',
        name: 'Parallel Cell',
        machineCount: machines,
        bufferCapacity: 200,
        processDist: { kind: 'exponential', mean: 9 }, // single machine capacity 6.67/hr
      },
    ],
    routes: [{ id: 'R1', sku: 'A', name: 'A', steps: [{ stationId: 'CELL' }] }],
    openArrivals: { ratePerHour: 6, cv: 1.0 },
  });

  const single = runDiscreteEventSimulation(mkCfg(1)); // rho = 0.9 -> heavy queue
  const dual = runDiscreteEventSimulation(mkCfg(2));   // rho = 0.45 -> fast queue

  assert.equal(single.valid, true);
  assert.equal(dual.valid, true);
  assert.ok(dual.avgCycleTimeMin.mean < single.avgCycleTimeMin.mean * 0.4);
  assert.ok(dual.avgWip.mean < single.avgWip.mean * 0.45);
});

/* -------------------------------------------------------------------------- */
/*  5. Exact Conservation & Flow Balance Across Rework, Scrap, Warmup & Shift */
/* -------------------------------------------------------------------------- */

test('Flow conservation and per-station time-partition identities hold exactly under warmup, shifts, scrap, rework, and BOM constraints', () => {
  const res = runDiscreteEventSimulation({
    name: 'Full Conservation Audit',
    horizonHours: 72,
    warmupHours: 12,
    replications: 4,
    seed: 31415,
    calendar: { shiftsPerDay: 2, shiftHours: 8, interShiftGapMin: 30, workingDaysPerWeek: 7 },
    stations: [
      {
        id: 'S1',
        name: 'Prep',
        machineCount: 1,
        bufferCapacity: 6,
        processDist: { kind: 'gamma', mean: 5.5, cv: 0.25 },
        setupTimeMin: 1.2,
        mtbfMin: 180,
        failureDistKind: 'weibull',
        failureWeibullShape: 1.8,
        mttrMin: 12,
        pmIntervalMin: 300,
        pmDurationMin: 10,
      },
      {
        id: 'S2',
        name: 'Core Assembly',
        machineCount: 2,
        bufferCapacity: 4,
        processDist: { kind: 'lognormal', mean: 11.0, cv: 0.22 },
        mtbfMin: 220,
        mttrMin: 15,
      },
      {
        id: 'S3',
        name: 'Final Test',
        machineCount: 1,
        bufferCapacity: 4,
        processDist: { kind: 'normal', mean: 4.8, cv: 0.15 },
      },
    ],
    routes: [
      {
        id: 'R-A',
        sku: 'PA-100',
        name: 'Standard',
        materialsPerJob: [{ materialSku: 'MAT-ALU', qtyPerJob: 2 }],
        steps: [
          { stationId: 'S1' },
          { stationId: 'S2' },
          { stationId: 'S3', scrapRate: 0.04, reworkProb: 0.1, reworkToStepIdx: 1, maxRework: 2 },
        ],
      },
      {
        id: 'R-B',
        sku: 'PA-200',
        name: 'Reverse-Order Variant',
        materialsPerJob: [{ materialSku: 'MAT-ALU', qtyPerJob: 3 }],
        steps: [
          { stationId: 'S1', cycleTimeMult: 0.8 },
          { stationId: 'S3', cycleTimeMult: 1.1 },
          { stationId: 'S2', cycleTimeMult: 0.9, scrapRate: 0.05 },
        ],
      },
    ],
    orders: [
      { id: 'PO-1', sku: 'PA-100', routeId: 'R-A', qty: 20, releaseAtMin: 60, dueAtMin: 1800, priority: 1 },
      { id: 'PO-2', sku: 'PA-200', routeId: 'R-B', qty: 15, releaseAtMin: 800, dueAtMin: 2800, priority: 2 },
    ],
    openArrivals: {
      ratePerHour: 7.5,
      cv: 0.8,
      clockMode: 'working',
      mix: [
        { routeId: 'R-A', weight: 0.7 },
        { routeId: 'R-B', weight: 0.3 },
      ],
    },
    materials: [
      {
        sku: 'MAT-ALU',
        name: 'Aluminum Plate',
        unit: 'pcs',
        initialStock: 120,
        rop: 60,
        orderQty: 180,
        leadTimeMin: 360,
        unitCost: 12,
      },
    ],
  });

  assert.equal(res.valid, true);
  assert.equal(res.provenance, 'SIMULATED_MODEL');
  assert.ok(Math.abs(res.flowBalance.conservationResidual) < 1e-6, `Expected 0 job leak, residual=${res.flowBalance.conservationResidual}`);
  assert.ok(res.rejectedQty > 0, 'Expected non-zero scrapped quantity under 4-5% scrap rate');
  assert.ok(res.reworkedQty > 0, 'Expected non-zero rework events');
  assert.ok(res.firstPassYieldPct < res.oeeQualityPct, 'First-pass yield must be strictly below post-rework quality when rework occurs');

  // Every station's mutually exclusive working-shift state times must sum to observedScheduledHours * 60 * machineCount
  const obsSchedMin = res.observedScheduledHours * 60;
  for (const st of res.stations) {
    const stateSum = st.busyMin + st.setupMin + st.blockedMin + st.starvedMin + st.downMin + st.pmMin;
    const expected = obsSchedMin * st.machineCount;
    assert.ok(
      Math.abs(stateSum - expected) < 0.05,
      `Station ${st.id} state time sum (${stateSum.toFixed(3)}) must equal scheduled machine-min (${expected.toFixed(3)})`
    );
  }
});

/* -------------------------------------------------------------------------- */
/*  6. OEE vs Asset Utilization Decoupling & Finite Buffer Blocking           */
/* -------------------------------------------------------------------------- */

test('OEE Availability and Performance stay distinct from Demand Starvation Utilization', () => {
  // Low demand (1.8 jobs/hr) on fast healthy line (6 min cycle -> capacity 10/hr => utilization ~18%)
  const lowDemandHealthy = runDiscreteEventSimulation({
    name: 'Starved Healthy Line',
    horizonHours: 40,
    warmupHours: 4,
    replications: 3,
    seed: 101,
    stations: [
      {
        id: 'ST-1',
        name: 'Laser',
        machineCount: 1,
        bufferCapacity: 10,
        processDist: { kind: 'constant', mean: 6 },
      },
    ],
    routes: [{ id: 'R1', sku: 'S', name: 'S', steps: [{ stationId: 'ST-1' }] }],
    openArrivals: { ratePerHour: 1.8, cv: 0 },
  });

  assert.equal(lowDemandHealthy.valid, true);
  assert.ok(lowDemandHealthy.assetUtilizationPct < 25, `Asset utilization should be ~18%, got ${lowDemandHealthy.assetUtilizationPct}`);
  assert.ok(lowDemandHealthy.oeeAvailabilityPct > 99.9, 'Healthy unstarved mechanical availability must remain ~100% despite low demand');
  assert.ok(lowDemandHealthy.oeePerformancePct > 99.9, 'Performance at rated speed must remain ~100%');
  assert.ok(
    Math.abs(lowDemandHealthy.oeePct - (lowDemandHealthy.oeeAvailabilityPct * lowDemandHealthy.oeePerformancePct * lowDemandHealthy.oeeQualityPct) / 10000) < 1e-6
  );

  // Balanced variable stations (6m cv=0.65 -> 6m cv=0.65, arrival=11/hr): cap=1 couples variability & cuts throughput
  const mkBlockedCfg = (bufCap: number): DesConfig => ({
    name: `Buf=${bufCap}`,
    horizonHours: 60,
    warmupHours: 6,
    replications: 6,
    seed: 222,
    stations: [
      { id: 'S1', name: 'Variable Stage 1', machineCount: 1, bufferCapacity: 50, processDist: { kind: 'lognormal', mean: 6.0, cv: 0.65 } },
      { id: 'S2', name: 'Variable Stage 2', machineCount: 1, bufferCapacity: bufCap, processDist: { kind: 'lognormal', mean: 6.0, cv: 0.65 } },
    ],
    routes: [{ id: 'R1', sku: 'X', name: 'X', steps: [{ stationId: 'S1' }, { stationId: 'S2' }] }],
    openArrivals: { ratePerHour: 11.0, cv: 0.4 },
  });

  const tight = runDiscreteEventSimulation(mkBlockedCfg(1));
  const buffered = runDiscreteEventSimulation(mkBlockedCfg(20));
  assert.ok(tight.stations[0].blockedPct > buffered.stations[0].blockedPct + 3, 'Tight buffer must produce measurable upstream blocking');
  assert.ok(buffered.throughputPerScheduledHour.mean > tight.throughputPerScheduledHour.mean, 'Larger buffer relieves blocking and increases throughput');
});

/* -------------------------------------------------------------------------- */
/*  7. Distributions, Reproducibility, Experiment Suite, Bridge & Guards      */
/* -------------------------------------------------------------------------- */

test('Gamma and Weibull samplers preserve configured means within sampling tolerance', () => {
  const rnd = mulberry32(4242);
  const n = 4000;
  let gammaSum = 0;
  let weibSum = 0;
  for (let i = 0; i < n; i++) {
    gammaSum += sampleDist(rnd, { kind: 'gamma', mean: 12, cv: 0.5 }, false);
    weibSum += sampleDist(rnd, { kind: 'weibull', mean: 20, cv: 0.4 }, false);
  }
  assert.ok(Math.abs(gammaSum / n - 12) < 0.6, `Gamma sample mean off: ${gammaSum / n}`);
  assert.ok(Math.abs(weibSum / n - 20) < 0.8, `Weibull sample mean off: ${weibSum / n}`);
});

test('DES engine is bit-exact reproducible by seed, runs experimentation suite, bridges workspace, and rejects invalid inputs', () => {
  const mem: Record<string, string> = {};
  const storage: StorageBackend = {
    persistent: false,
    get: (k) => (k in mem ? mem[k] : null),
    set: (k, v) => {
      mem[k] = v;
    },
    del: (k) => {
      delete mem[k];
    },
  };
  const store = new FactoryStore(storage);
  const baseFactoryCfg = buildDefaultFactoryConfigFromWorkspace({
    products: store.products(),
    lineBalance: store.getLineBalance(),
    metricsOf: (p) => store.metrics(p as any),
  });
  const desCfg = buildDesConfigFromFactorySim(baseFactoryCfg, { customSecondaryRoute: true });

  const r1 = runDiscreteEventSimulation(desCfg);
  const r2 = runDiscreteEventSimulation(desCfg);
  assert.equal(r1.valid, true);
  assert.deepEqual(r1, r2, 'Identical seed and config must produce bit-exact results');

  const diffSeed = runDiscreteEventSimulation({ ...desCfg, seed: desCfg.seed! + 77 });
  assert.notEqual(r1.throughputPerScheduledHour.mean, diffSeed.throughputPerScheduledHour.mean);

  const sweep = runDesExperimentSuite(desCfg, {
    bufferCaps: [1, 8],
    volumeMultipliers: [1.3],
    includeMachineCases: true,
    includeReliabilityCases: true,
  });
  assert.equal(sweep.length, 6);
  assert.ok(sweep.some((p) => p.category === 'buffer'));
  assert.ok(sweep.some((p) => p.category === 'machines'));
  assert.ok(sweep.some((p) => p.category === 'volume'));
  assert.ok(sweep.some((p) => p.category === 'reliability'));

  // Boundary guards
  assert.equal(runDiscreteEventSimulation({ ...desCfg, stations: [] }).valid, false);
  assert.equal(runDiscreteEventSimulation({ ...desCfg, horizonHours: 10, warmupHours: 10 }).valid, false);
  assert.equal(
    runDiscreteEventSimulation({ ...desCfg, orders: [], openArrivals: undefined }).valid,
    false
  );
  assert.equal(
    runDiscreteEventSimulation({
      ...desCfg,
      routes: [{ id: 'BAD', sku: 'BAD', name: 'Bad', steps: [{ stationId: 'NON_EXISTENT' }] }],
    }).valid,
    false
  );
});
