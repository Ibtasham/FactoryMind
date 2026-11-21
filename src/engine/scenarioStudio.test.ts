import test from 'node:test';
import assert from 'node:assert/strict';
import { FactoryStore, StorageBackend } from '../store/store.ts';
import {
  buildBaselineScenarioFromWorkspace,
  buildPresetScenarioDefinitions,
  buildWorkspaceApplyPreview,
  compareScenarioToBaseline,
  evaluateScenario,
  exportScenarioPackageJSON,
  importScenarioPackageJSON,
  runScenarioSensitivity,
  sanitizeScenarioParams,
  ScenarioWorkspaceInput,
} from './scenarioStudio.ts';

function memoryStorage(): StorageBackend {
  const map = new Map<string, string>();
  return {
    persistent: false,
    get: (k) => (map.has(k) ? map.get(k)! : null),
    set: (k, v) => {
      map.set(k, v);
    },
    del: (k) => {
      map.delete(k);
    },
  };
}

function buildWorkspaceSnapshot(store: FactoryStore): ScenarioWorkspaceInput {
  return {
    products: store.products(),
    lineBalance: store.getLineBalance(),
    factorySimConfig: store.getFactorySimConfig(),
  };
}

test('Scenario Studio never mutates live workspace store during evaluation, comparison, sensitivity, or import', () => {
  const store = new FactoryStore(memoryStorage());
  const beforeProducts = JSON.stringify(store.products());
  const beforeLb = JSON.stringify(store.getLineBalance());
  const beforeSim = JSON.stringify(store.getFactorySimConfig());
  const beforeTx = JSON.stringify(store.transactions());

  const ws = buildWorkspaceSnapshot(store);
  const base = buildBaselineScenarioFromWorkspace(ws);
  const presets = buildPresetScenarioDefinitions(ws);
  const baseEval = evaluateScenario(base, ws);
  const surgeEval = evaluateScenario(presets[1], ws);
  const cmp = compareScenarioToBaseline(baseEval, surgeEval);
  const sens = runScenarioSensitivity(base, ws);
  const preview = buildWorkspaceApplyPreview(presets[0], ws);
  const exported = exportScenarioPackageJSON(presets);
  const reimported = importScenarioPackageJSON(exported);

  assert.equal(baseEval.valid, true);
  assert.equal(surgeEval.valid, true);
  assert.equal(cmp.deltas.length, 12);
  assert.ok(sens.length >= 6);
  assert.ok(preview.changes.length >= 4);
  assert.equal(reimported.length, presets.length);

  assert.equal(JSON.stringify(store.products()), beforeProducts);
  assert.equal(JSON.stringify(store.getLineBalance()), beforeLb);
  assert.equal(JSON.stringify(store.getFactorySimConfig()), beforeSim);
  assert.equal(JSON.stringify(store.transactions()), beforeTx);
});

test('Evaluations are bit-for-bit reproducible for a given seed and scenario definition', () => {
  const store = new FactoryStore(memoryStorage());
  const ws = buildWorkspaceSnapshot(store);
  const sc = buildPresetScenarioDefinitions(ws)[0];

  const ev1 = evaluateScenario(sc, ws);
  const ev2 = evaluateScenario(sc, ws);

  assert.equal(ev1.kpis.throughputPerHour, ev2.kpis.throughputPerHour);
  assert.equal(ev1.kpis.oeePct, ev2.kpis.oeePct);
  assert.equal(ev1.kpis.totalInventoryCostAnnual, ev2.kpis.totalInventoryCostAnnual);
  assert.equal(ev1.kpis.operatingCostPerUnit, ev2.kpis.operatingCostPerUnit);
  assert.equal(ev1.confidence.scorePct, ev2.confidence.scorePct);
});

test('Demand surge scales forecast, annual inventory policy cost, and DES arrival pressure', () => {
  const store = new FactoryStore(memoryStorage());
  const ws = buildWorkspaceSnapshot(store);
  const base = buildBaselineScenarioFromWorkspace(ws);
  const baseEval = evaluateScenario(base, ws);

  const highDemand = {
    ...base,
    id: 'test-high-demand',
    name: 'High Demand Test',
    params: { ...base.params, demandVolumeMult: 1.6, safetyStockMult: 1.0 },
  };
  const highEval = evaluateScenario(highDemand, ws);

  assert.ok(highEval.forecastSummary.annualForecast > baseEval.forecastSummary.annualForecast * 1.45);
  assert.ok(highEval.kpis.totalInventoryCostAnnual > baseEval.kpis.totalInventoryCostAnnual * 1.15);
  assert.ok(highEval.forecastSummary.arrivalRatePerHour > baseEval.forecastSummary.arrivalRatePerHour);
});

test('Safety stock & service-target policies raise effective service level & holding buffer while cutting exposure', () => {
  const store = new FactoryStore(memoryStorage());
  const ws = buildWorkspaceSnapshot(store);
  const base = buildBaselineScenarioFromWorkspace(ws);

  const leanStock = evaluateScenario(
    { ...base, id: 'lean-ss', name: 'Thin Stock', params: { ...base.params, safetyStockMult: 0.5, supplierLeadTimeMult: 1.6 } },
    ws
  );
  const bufferedStock = evaluateScenario(
    {
      ...base,
      id: 'buf-ss',
      name: 'Buffered Stock',
      params: { ...base.params, reorderPolicy: 'service-target', targetServiceLevelPct: 99, safetyStockMult: 2.0, supplierLeadTimeMult: 1.6 },
    },
    ws
  );

  assert.ok(bufferedStock.inventorySummary.safetyStockUnits > leanStock.inventorySummary.safetyStockUnits * 2.5);
  assert.ok(bufferedStock.kpis.serviceLevelPct > leanStock.kpis.serviceLevelPct);
  assert.ok(bufferedStock.kpis.totalInventoryCostAnnual > leanStock.kpis.totalInventoryCostAnnual);
  assert.ok(bufferedStock.kpis.shortageRiskPct <= leanStock.kpis.shortageRiskPct);
});

test('Adding parallel bottleneck machine relieves bottleneck workload & raises throughput under overloaded demand', () => {
  const store = new FactoryStore(memoryStorage());
  const baseWs = buildWorkspaceSnapshot(store);
  // Ensure ample local material stock so machine capacity is the active constraint
  const ws: ScenarioWorkspaceInput = {
    ...baseWs,
    products: baseWs.products.map((p) => ({ ...p, stock: Math.max(p.stock, 5000) })),
  };
  const base = buildBaselineScenarioFromWorkspace(ws);

  const overloaded = evaluateScenario(
    {
      ...base,
      id: 'overloaded',
      name: 'Overloaded Line',
      params: {
        ...base.params,
        demandVolumeMult: 2.0,
        machineCycleMult: 1.4,
        extraBottleneckMachines: 0,
        operatorsAvailable: 6,
        horizonHours: 24,
        replications: 4,
      },
    },
    ws
  );
  const relieved = evaluateScenario(
    {
      ...base,
      id: 'relieved',
      name: 'Expanded Bottleneck',
      params: {
        ...base.params,
        demandVolumeMult: 2.0,
        machineCycleMult: 1.4,
        extraBottleneckMachines: 2,
        operatorsAvailable: 12,
        horizonHours: 24,
        replications: 4,
      },
    },
    ws
  );

  assert.ok(relieved.kpis.throughputPerHour > overloaded.kpis.throughputPerHour);
  assert.ok(relieved.kpis.avgCycleTimeMin < overloaded.kpis.avgCycleTimeMin);
  const ovBnIdx = overloaded.desResult.bottleneckIndex;
  assert.ok(relieved.desResult.stations[ovBnIdx].busyPct < overloaded.desResult.stations[ovBnIdx].busyPct * 0.6);
});

test('Workforce understaffing, higher scrap rate, and higher breakdown frequency degrade expected KPIs', () => {
  const store = new FactoryStore(memoryStorage());
  const ws = buildWorkspaceSnapshot(store);
  const base = buildBaselineScenarioFromWorkspace(ws);
  const baseEval = evaluateScenario(base, ws);

  const understaffed = evaluateScenario(
    { ...base, id: 'low-ops', name: 'Low Staffing', params: { ...base.params, operatorsAvailable: 1 } },
    ws
  );
  assert.ok(understaffed.lineBalanceSummary.workforceStaffingRatio < 1);
  assert.ok(understaffed.kpis.avgCycleTimeMin > baseEval.kpis.avgCycleTimeMin);

  const highScrap = evaluateScenario(
    { ...base, id: 'high-scrap', name: 'High Scrap', params: { ...base.params, scrapRatePct: 18 } },
    ws
  );
  assert.ok(highScrap.kpis.oeeQualityPct < baseEval.kpis.oeeQualityPct);
  assert.ok(highScrap.kpis.oeePct < baseEval.kpis.oeePct);

  const frequentFail = evaluateScenario(
    { ...base, id: 'high-fail', name: 'High Breakdowns', params: { ...base.params, breakdownFreqMult: 3.2, horizonHours: 48, replications: 6 } },
    ws
  );
  const reliableBase = evaluateScenario(
    { ...base, id: 'rel-base', name: 'Low Breakdowns', params: { ...base.params, breakdownFreqMult: 0.4, horizonHours: 48, replications: 6 } },
    ws
  );
  assert.ok(frequentFail.kpis.downtimePct > reliableBase.kpis.downtimePct);
  assert.ok(frequentFail.kpis.oeeAvailabilityPct < reliableBase.kpis.oeeAvailabilityPct);
});

test('Comparison engine emits complete 7-part explainability & provenance metadata', () => {
  const store = new FactoryStore(memoryStorage());
  const ws = buildWorkspaceSnapshot(store);
  const base = buildBaselineScenarioFromWorkspace(ws);
  const preset = buildPresetScenarioDefinitions(ws)[0];

  const baseEval = evaluateScenario(base, ws);
  const presetEval = evaluateScenario(preset, ws);
  const cmp = compareScenarioToBaseline(baseEval, presetEval);

  assert.equal(presetEval.provenance, 'SCENARIO_SIMULATION_MODEL');
  assert.ok(cmp.explanation.whatChanged.length > 0);
  assert.ok(cmp.explanation.modelsUsed.length >= 5);
  assert.ok(cmp.explanation.assumptions.length >= 4);
  assert.ok(cmp.explanation.whatImproved.length >= 1);
  assert.ok(cmp.explanation.whatDeteriorated.length >= 1);
  assert.ok(cmp.explanation.remainingConstraints.length >= 1);
  assert.ok(cmp.explanation.confidenceStatement.includes('DES 95% CI'));
});

test('Scenario JSON export/import roundtrip preserves parameters, clamps bounds, and strips prototype keys', () => {
  const store = new FactoryStore(memoryStorage());
  const ws = buildWorkspaceSnapshot(store);
  const presets = buildPresetScenarioDefinitions(ws);
  const rawJson = exportScenarioPackageJSON(presets);

  // Inject malicious keys + out-of-range params
  const parsed = JSON.parse(rawJson);
  parsed.scenarios[0].__proto__ = { polluted: true };
  parsed.scenarios[0].params.scrapRatePct = 999;

  const imported = importScenarioPackageJSON(JSON.stringify(parsed));
  assert.equal(imported.length, presets.length);
  assert.equal(imported[0].params.scrapRatePct, 35); // clamped cleanly to upper bound
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(imported[1].params, sanitizeScenarioParams(presets[1].params));

  assert.throws(() => importScenarioPackageJSON('{"bad":true}'), /missing scenarios/);
});

test('FactoryStore persists scenario vault records and applies approved scenario only on explicit invocation', () => {
  const storage = memoryStorage();
  const store = new FactoryStore(storage);
  const ws = buildWorkspaceSnapshot(store);
  const presets = buildPresetScenarioDefinitions(ws);

  const saved = store.saveScenarioStudioRecord({
    id: 'vault-1',
    name: 'Approved Expansion',
    notes: 'Ready for Q4',
    params: { ...presets[0].params, machineCycleMult: 0.9, bufferCapacity: 14, reorderPolicy: 'service-target', targetServiceLevelPct: 98 },
  });
  assert.equal(store.getScenarioStudioRecords().length, 1);
  assert.equal(saved.id, 'vault-1');

  // Rehydrate from storage to verify normalization preserves records
  const reloaded = new FactoryStore(storage);
  assert.equal(reloaded.getScenarioStudioRecords().length, 1);
  assert.equal(reloaded.getScenarioStudioRecords()[0].params.bufferCapacity, 14);

  // Explicit apply updates live line balance, factory sim config, and target assembly service level
  const origCycle = reloaded.getLineBalance().cycleTime;
  reloaded.applyScenarioToWorkspace(saved);
  assert.ok(Math.abs(reloaded.getLineBalance().cycleTime - origCycle * 0.9) < 0.05);
  assert.equal(reloaded.getFactorySimConfig().stations[0].bufferCapacity, 14);
  const targetAsm = reloaded.products().find((p) => p.sku === saved.params.assemblySku);
  assert.equal(targetAsm?.serviceLevel, 98);

  reloaded.deleteScenarioStudioRecord('vault-1');
  assert.equal(reloaded.getScenarioStudioRecords().length, 0);
});
