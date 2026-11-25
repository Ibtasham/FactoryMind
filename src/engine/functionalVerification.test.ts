import assert from 'node:assert/strict';
import test from 'node:test';
import { FactoryStore, StorageBackend } from '../store/store.ts';
import { advisorAnalyse, advisorHealth, DEFAULT_ADVISOR_POLICY } from './advisor.ts';
import { buildAssistantWorkspaceContext, runDeterministicDecisionQuery } from './decisionAssistant.ts';
import { buildDesConfigFromFactorySim, runDiscreteEventSimulation } from './desEngine.ts';
import { buildDefaultFactoryConfigFromWorkspace } from './factorySim.ts';
import { generateDemandDataset, recommendForecast } from './forecast.ts';
import {
  inventoryOptimizer,
  queueMeckley,
  queueMG1,
  simulateMonteCarlo,
} from './inventory.ts';
import {
  abcAnalysis,
  abcSummary,
  eoq,
  epq,
  newsvendor,
  quantityDiscount,
  rop,
  spcAnalysis,
} from './ipe.ts';
import {
  compareAlgorithms,
  lineBalanceRPW,
} from './linebal.ts';
import { mrpPlan, mrpToCSV } from './mrp.ts';
import { simulateProductionLine, stationsFromLineBalance } from './prodsim.ts';
import { buildOperationsReport, inventoryMetricsToCSV } from './reports.ts';
import {
  buildBaselineScenarioFromWorkspace,
  compareScenarioToBaseline,
  evaluateScenario,
  sanitizeScenarioParams,
} from './scenarioStudio.ts';
import { predictSmartAlerts } from './smartAlerts.ts';
import { buildAssembly3D, buildPlantFloorTwin, updatePlantFloorTwin } from './threeModels.ts';
import { validateBomLines, validateProductForm, validateStockMove } from './uxHelpers.ts';

function memoryBackend(): StorageBackend {
  const map: Record<string, string> = {};
  return {
    persistent: false,
    get: (k) => (k in map ? map[k] : null),
    set: (k, v) => {
      map[k] = v;
    },
    del: (k) => {
      delete map[k];
    },
  };
}

test('1. INVENTORY: CRUD, 0 leadTime preservation, zero-stock issue rejection, ABC, and CSV validation', () => {
  const store = new FactoryStore(memoryBackend());
  assert.equal(store.products().length, 17);

  // Add SKU with boundary leadTime = 0 & orderCost = 0
  const zeroLeadSku = store.addProduct({
    sku: 'JST-000',
    name: 'Just-in-time Fastener',
    category: 'Fastener',
    unit: 'pcs',
    unitCost: 2.5,
    stock: 0,
    annualDemand: 3650,
    orderCost: 0,
    holdingRate: 20,
    leadTime: 0,
    serviceLevel: 95,
  });
  assert.equal(zeroLeadSku.leadTime, 0);
  assert.equal(zeroLeadSku.orderCost, 0);

  // Attempting to issue from 0-stock SKU must be rejected (no 0-qty ghost ledger entry)
  const beforeTxCount = store.transactions().length;
  const rejectedOut = store.addTransaction(zeroLeadSku.id, 'out', 10, 'Invalid over-issue');
  assert.equal(rejectedOut, null);
  assert.equal(store.transactions().length, beforeTxCount);

  // Receive 50, then verify stock validation
  const rx = store.addTransaction(zeroLeadSku.id, 'in', 50, 'Inbound PO');
  assert.ok(rx);
  assert.equal(store.getProduct(zeroLeadSku.id)!.stock, 50);

  const validMoveCheck = validateStockMove('10', 'out', 50);
  assert.equal(validMoveCheck.valid, true);
  const invalidMoveCheck = validateStockMove('80', 'out', 50);
  assert.equal(invalidMoveCheck.valid, false);
  const zeroMoveCheck = validateStockMove('0', 'in', 50);
  assert.equal(zeroMoveCheck.valid, false);

  // Validate form boundary & invalid input
  const badForm = validateProductForm(
    {
      sku: 'JST-000',
      name: '',
      unit: '',
      unitCost: '-5',
      stock: '-1',
      annualDemand: 'abc',
      orderCost: '-1',
      holdingRate: '0',
      leadTime: '9999',
      serviceLevel: '10',
      historyText: '10, -2, xyz',
    },
    { existingSkus: store.products().map((p) => p.sku) }
  );
  assert.equal(badForm.valid, false);
  assert.ok(badForm.errors.sku && badForm.errors.name && badForm.errors.unitCost && badForm.errors.historyText);

  // CSV import skips negative & malformed numbers without creating garbage
  const csvBad = [
    'SKU,Name,Unit Cost,Stock,Annual Demand,Lead Time (days)',
    'NEG-1,Negative Cost Item,-4.5,10,100,5',
    'NAN-1,Bad Qty Item,10,notanumber,100,5',
    'OK-1,Valid Item,12.5,25,600,4',
  ].join('\n');
  const imp = store.importProductsCSV(csvBad);
  assert.equal(imp.created, 1);
  assert.equal(imp.skipped.length, 2);

  // ABC summary on populated & empty arrays
  const abcRows = abcAnalysis(store.products(), { aThreshold: 70, bThreshold: 90 });
  const abcStats = abcSummary(abcRows);
  assert.equal(abcStats.A.count + abcStats.B.count + abcStats.C.count, store.products().length);
  const emptyAbc = abcSummary(abcAnalysis([], { aThreshold: 70, bThreshold: 90 }));
  assert.equal(emptyAbc.total, 0);
});

test('2. INVENTORY OPTIMIZATION: EOQ, EPQ, quantity discounts, forecasting & smart alerts boundaries', () => {
  const store = new FactoryStore(memoryBackend());

  // EOQ & EPQ expected + invalid boundary
  const eoqOk = eoq({ annualDemand: 4200, orderCost: 65, unitCost: 18.5, holdingRate: 22 });
  assert.equal(eoqOk.valid, true);
  assert.ok(eoqOk.Q > 300 && eoqOk.Q < 400);
  const eoqZero = eoq({ annualDemand: 0, orderCost: 65, unitCost: 18.5, holdingRate: 22 });
  assert.equal(eoqZero.valid, false);

  const epqInvalid = epq({
    annualDemand: 5000,
    setupCost: 100,
    unitCost: 20,
    holdingRate: 20,
    productionRate: 4000,
  });
  assert.equal(epqInvalid.valid, false);

  const ropZeroLt = rop({ annualDemand: 3650, leadTimeDays: 0, serviceLevel: 95 });
  assert.equal(ropZeroLt.rop, 0);

  // Discount optimization expected & invalid discount >= 100
  const discOk = quantityDiscount({
    annualDemand: 4800,
    orderCost: 60,
    unitCost: 25,
    holdingRate: 20,
    tiers: [
      { minQty: 1, discountPct: 0 },
      { minQty: 500, discountPct: 5 },
      { minQty: 1200, discountPct: 10 },
    ],
  });
  assert.equal(discOk.valid, true);
  assert.ok(discOk.best && discOk.best.minQty >= 500);

  const discCapped = quantityDiscount({
    annualDemand: 4800,
    orderCost: 60,
    unitCost: 25,
    holdingRate: 20,
    tiers: [{ minQty: 1, discountPct: 100 }],
  });
  assert.equal(discCapped.valid, true);
  assert.equal(discCapped.best?.discountPct, 99);

  const discBad = quantityDiscount({
    annualDemand: 4800,
    orderCost: 60,
    unitCost: 25,
    holdingRate: 20,
    tiers: [],
  });
  assert.equal(discBad.valid, false);

  // Advisor + Health score
  const invRows = store.products().map((p) => ({ p, m: store.metrics(p) }));
  const adv = advisorAnalyse(invRows, store.transactions(), { ...DEFAULT_ADVISOR_POLICY, cover: 3, band: [90, 98] });
  const score = advisorHealth(invRows, adv.findings, adv.totals, store.summary());
  assert.ok(score.score >= 0 && score.score <= 100);
  assert.ok(adv.totals.parkedCash >= 0);

  // Forecasting on seasonal data vs all-zeros vs tiny 2-point series
  const seasonal = generateDemandDataset('seasonal', { n: 24, base: 100, noise: 5, seed: 7 }).history;
  const fRec = recommendForecast(seasonal, []);
  assert.ok(fRec.bestMethod);
  const fZero = recommendForecast([0, 0, 0, 0, 0, 0], []);
  assert.ok(fZero.methods.length > 0);
  const fShort = recommendForecast([10, 12], []);
  assert.equal(fShort.bestMethod, null);

  // Smart alerts analysis + dismiss persistence
  const smart = predictSmartAlerts(store.products(), (p) => store.metrics(p), { horizonDays: 45 });
  assert.ok(smart.alerts.length > 0);
  const firstId = smart.alerts[0].id;
  store.dismissSmartAlert(firstId);
  assert.ok(store.getSmartAlertPrefs().dismissedIds.includes(firstId));
});

test('3. PRODUCTION: Multi-level MRP with scheduled receipts, all lot rules, BOM validation, Line Balance & SPC', () => {
  const store = new FactoryStore(memoryBackend());
  const products = store.products();
  const root = products.find((p) => p.sku === 'ASM-CM200')!;

  // BOM self-reference and duplicate rejection
  const selfBomCheck = validateBomLines([{ componentId: root.id, qtyPer: 2 }], root.id);
  assert.equal(selfBomCheck.valid, false);
  const dupBomCheck = validateBomLines(
    [
      { componentId: products[0].id, qtyPer: 1 },
      { componentId: products[0].id, qtyPer: 2 },
    ],
    root.id
  );
  assert.equal(dupBomCheck.valid, false);

  type MrpItemsMap = NonNullable<Parameters<typeof mrpPlan>[0]['items']>;
  const buildItems = (withReceiptForId?: string): MrpItemsMap => {
    const items: MrpItemsMap = {};
    products.forEach((p) => {
      const m = store.metrics(p);
      items[p.id] = {
        id: p.id,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        bom: p.bom,
        onHand: p.stock,
        scheduledReceipts:
          withReceiptForId === p.id ? [{ qty: 1000, daysFromStart: 7 }] : [],
        safetyStock: Math.round(m.safetyStock),
        leadTimeDays: p.leadTime,
        lotRule: 'l4l',
        eoqQty: Math.max(1, Math.round(m.eoq.Q)),
        foqQty: 50,
        periodDemand: Math.max(1, Math.round(m.dBar * 7)),
        periodCount: 2,
      };
    });
    return items;
  };

  for (const lotRule of ['l4l', 'eoq', 'foq', 'poq'] as const) {
    const res = mrpPlan({
      rootId: root.id,
      planQuantity: 30,
      needInDays: 35,
      items: buildItems(),
      horizonDays: 60,
      bucketSizeDays: 7,
      lotRule,
    });
    assert.ok(res.summary.componentCount > 1);
    const csv = mrpToCSV(res);
    assert.ok(csv.includes(root.id) || csv.includes(root.name));
  }

  // Scheduled receipt lowers total net requirement for child component
  const firstChildId = root.bom[0].componentId;
  const planWithoutRcpt = mrpPlan({
    rootId: root.id,
    planQuantity: 80,
    needInDays: 35,
    items: buildItems(),
    horizonDays: 60,
    bucketSizeDays: 7,
    lotRule: 'l4l',
  });
  const planWithRcpt = mrpPlan({
    rootId: root.id,
    planQuantity: 80,
    needInDays: 35,
    items: buildItems(firstChildId),
    horizonDays: 60,
    bucketSizeDays: 7,
    lotRule: 'l4l',
  });
  assert.ok(
    planWithRcpt.components[firstChildId].totalNetRequirement <=
      planWithoutRcpt.components[firstChildId].totalNetRequirement
  );

  // Line Balancing: valid, cycle, infeasible cycle time, empty task array
  const lb = store.getLineBalance();
  const cmp = compareAlgorithms({
    tasks: lb.tasks,
    cycleTime: lb.cycleTime,
    algorithms: ['rpw', 'lcr', 'kw', 'comsoal', 'exact'],
  });
  assert.equal(cmp.best?.valid, true);

  const emptyLb = lineBalanceRPW({ tasks: [], cycleTime: 10 });
  assert.equal(emptyLb.valid, false);
  assert.equal(emptyLb.reason, 'no tasks defined');

  const cycleLb = lineBalanceRPW({
    tasks: [
      { id: 'T1', time: 4, successors: ['T2'] },
      { id: 'T2', time: 4, successors: ['T1'] },
    ],
    cycleTime: 10,
  });
  assert.equal(cycleLb.valid, false);

  const tightLb = lineBalanceRPW({ tasks: lb.tasks, cycleTime: 1 });
  assert.equal(tightLb.valid, false);

  // SPC: valid & inverted spec limits
  const spcOk = spcAnalysis({
    subgroups: [
      [25.0, 25.02, 24.99, 25.01, 24.98],
      [25.01, 24.99, 25.0, 25.02, 24.99],
      [24.99, 25.01, 25.0, 24.98, 25.01],
    ],
    lsl: 24.94,
    usl: 25.06,
  });
  assert.equal(spcOk.valid, true);
  assert.ok(spcOk.cap && spcOk.cap.Cpk > 1);

  const spcBadLimits = spcAnalysis({
    subgroups: [
      [25.0, 25.02, 24.99],
      [25.01, 24.99, 25.0],
    ],
    lsl: 25.1,
    usl: 25.0,
  });
  assert.equal(spcBadLimits.cap, null);
});

test('4. SIMULATION: Monte Carlo gamma boundary, Newsvendor, Queueing instability, Production DES & Factory DES', () => {
  // Gamma distribution Monte Carlo produces finite values
  const mcGamma = simulateMonteCarlo({
    Q: 220,
    R: 110,
    days: 90,
    unitCost: 20,
    holdingRate: 20,
    orderCost: 50,
    shortageCost: 5,
    replications: 25,
    seed: 99,
    demand: { type: 'gamma', shape: 0.4, scale: 20 },
    leadTime: { type: 'gamma', shape: 2, scale: 3 },
  });
  assert.equal(mcGamma.valid, true);
  assert.ok(Number.isFinite(mcGamma.totalCost));

  const opt = inventoryOptimizer({
    days: 60,
    unitCost: 15,
    holdingRate: 20,
    orderCost: 50,
    shortageCost: 5,
    replications: 10,
    seed: 42,
    demand: { type: 'normal', mean: 10, sd: 3 },
    leadTime: { type: 'deterministic', mean: 6 },
  });
  assert.equal(opt.valid, true);

  // Newsvendor valid & invalid price <= cost
  const nvOk = newsvendor({ price: 45, cost: 22, salvage: 8, mean: 250, sd: 55 });
  assert.equal(nvOk.valid, true);
  assert.ok(nvOk.Q > 250);
  const nvBad = newsvendor({ price: 20, cost: 25, salvage: 5, mean: 250, sd: 55 });
  assert.equal(nvBad.valid, false);

  // Queueing M/M/c unstable (rho >= 1) vs M/M/c/K stable (finite buffer allows rho >= 1) vs M/G/1
  const qUnstable = queueMeckley({ lambda: 30, mu: 8, servers: 3 });
  assert.equal(qUnstable.valid, false);
  const qFiniteBuf = queueMeckley({ lambda: 30, mu: 8, servers: 3, capacity: 12 });
  assert.equal(qFiniteBuf.valid, true);
  const qMg1 = queueMG1({ lambda: 5, mu: 8, scv2: 1.4 });
  assert.equal(qMg1.valid, true);

  // Production DES & Factory Sim DES
  const stns = stationsFromLineBalance(
    compareAlgorithms({ tasks: new FactoryStore(memoryBackend()).getLineBalance().tasks, cycleTime: 10 }).best,
    {
      bufferCapacity: 4,
      mtbfMin: 120,
      mttrMin: 6,
    }
  );
  const prodDes = simulateProductionLine({
    stations: stns,
    arrivalRatePerHour: 5.5,
    replications: 4,
    seed: 11,
  });
  assert.equal(prodDes.valid, true);
  assert.ok(prodDes.effectiveThroughputPerHour > 0);

  const store = new FactoryStore(memoryBackend());
  const fCfg = buildDefaultFactoryConfigFromWorkspace({
    products: store.products(),
    lineBalance: store.getLineBalance(),
    metricsOf: (p) => store.metrics(p as ReturnType<FactoryStore['products']>[number]),
  });
  const desCfg = buildDesConfigFromFactorySim(fCfg);
  const desRes = runDiscreteEventSimulation(desCfg);
  assert.equal(desRes.valid, true);
  assert.equal(desRes.flowBalance.conservationResidual, 0);

  const desEmptyStations = runDiscreteEventSimulation({ ...desCfg, stations: [] });
  assert.equal(desEmptyStations.valid, false);
});

test('5. DECISION INTELLIGENCE: Scenario Studio counterfactuals, approval gates & Decision Assistant queries', () => {
  const store = new FactoryStore(memoryBackend());
  const ws = {
    products: store.products(),
    lineBalance: store.getLineBalance(),
    factorySimConfig: store.getFactorySimConfig(),
  };

  const base = buildBaselineScenarioFromWorkspace(ws);
  const shockDef = {
    id: 'test-shock',
    name: 'Lead Time +40% Shock',
    notes: 'Stress test',
    createdAt: Date.now(),
    params: sanitizeScenarioParams({
      ...base.params,
      supplierLeadTimeMult: 1.4,
      extraBottleneckMachines: 1,
    }),
  };

  const baseEval = evaluateScenario(base, ws);
  const shockEval = evaluateScenario(shockDef, ws);
  const cmp = compareScenarioToBaseline(baseEval, shockEval);
  assert.ok(cmp.deltas.length >= 5);

  // Decision Assistant returns grounded facts without mutating workspace until explicitly approved
  const slBefore = store.products().map((p) => p.serviceLevel);
  const daCtx = buildAssistantWorkspaceContext({
    products: store.products(),
    transactions: store.transactions(),
    settings: store.settings(),
    summary: store.summary(),
    metricsOf: (p) => store.metrics(p),
    lineBalance: store.getLineBalance(),
    factorySimConfig: store.getFactorySimConfig(),
  });
  const daRes = runDeterministicDecisionQuery('Where is the production bottleneck and how do we relieve it?', daCtx);
  assert.equal(daRes.intent, 'bottleneck');
  assert.ok(daRes.proposedActions.some((a) => a.requiresApproval));
  assert.deepEqual(
    store.products().map((p) => p.serviceLevel),
    slBefore
  );

  // Apply scenario propagates changes cleanly across workspace
  store.applyScenarioToWorkspace(shockDef);
  assert.ok(store.actionLog().some((a) => a.action.includes(shockDef.name)));

  // Empty workspace Decision Assistant responds gracefully without throwing
  store.clearAll();
  const emptyCtx = buildAssistantWorkspaceContext({
    products: store.products(),
    transactions: store.transactions(),
    settings: store.settings(),
    summary: store.summary(),
    metricsOf: (p) => store.metrics(p),
    lineBalance: store.getLineBalance(),
    factorySimConfig: store.getFactorySimConfig(),
  });
  const emptyDa = runDeterministicDecisionQuery('Give plant overview', emptyCtx);
  assert.equal(emptyDa.intent, 'general_overview');
  assert.ok(emptyDa.headline.length > 0);
});

test('6-8. VISUALIZATION, REPORTING & SETTINGS: 3D Twin empty catalog safety, reports, backup/restore, reset', () => {
  const store = new FactoryStore(memoryBackend());

  // Populated report snapshot + CSV export
  const snap = buildOperationsReport(store.products(), store.summary(), store.settings(), {
    lotRule: 'eoq',
    buildQty: 25,
  });
  assert.equal(snap.inventory.totalCatalogSkus, 17);
  assert.ok(snap.production.assemblies.length >= 5);
  const invCsv = inventoryMetricsToCSV(snap);
  assert.ok(invCsv.includes('ASM-CM200'));

  // 3D assembly builds cleanly for all presets
  for (const sku of ['ASM-CM200', 'ASM-PA100', 'ASM-GS350', 'ASM-CP120', 'KIT-MK5'] as const) {
    const asm = buildAssembly3D(sku, 'slate');
    assert.ok(asm.parts.length >= 3);
    asm.dispose();
  }

  // Empty workspace: 3D Plant Twin, Update in place, Report snapshot must NOT throw
  store.clearAll();
  assert.equal(store.products().length, 0);
  const emptyBuilt = buildPlantFloorTwin([], [], 'slate');
  assert.ok(emptyBuilt.plantHandle);
  assert.equal(updatePlantFloorTwin(emptyBuilt, [], []), true);
  emptyBuilt.dispose();

  const emptySnap = buildOperationsReport(store.products(), store.summary(), store.settings());
  assert.equal(emptySnap.inventory.totalCatalogSkus, 0);
  assert.equal(emptySnap.production.assemblies.length, 0);

  // Settings theme switching + Reset restores all 17 SKUs & 34 ledger entries
  store.setSetting('theme', 'light');
  assert.equal(store.settings().theme, 'light');
  store.reset();
  assert.equal(store.products().length, 17);
  assert.equal(store.transactions().length, 34);
  assert.equal(store.settings().theme, 'light');

  // Invalid JSON restore throws clear error without wiping existing state
  assert.throws(() => store.importJSON('{bad json'), /JSON|Unexpected|Expected/i);
  assert.throws(() => store.importJSON(JSON.stringify({ hello: 'world' })), /missing products/);
  assert.equal(store.products().length, 17);
});
