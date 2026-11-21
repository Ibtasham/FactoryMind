import test from 'node:test';
import assert from 'node:assert/strict';

import {
  abcAnalysis,
  abcSummary,
  eoq,
  epq,
  newsvendor,
  normCdf,
  normInv,
  quantityDiscount,
  rop,
  spcAnalysis,
  spcDrift,
  statusFor,
} from './ipe.ts';
import {
  classifyDemand,
  compareMethods,
  crostonMethod,
  generateDemandDataset,
  holtLinear,
  recommendForecast,
  sbaMethod,
  smaMethod,
} from './forecast.ts';
import { lotSize, mrpPlan } from './mrp.ts';
import { compareAlgorithms, getBenchmark, lineBalanceExact, lineBalanceRPW } from './linebal.ts';
import { inventoryOptimizer, queueMeckley, queueMG1, simulateMonteCarlo } from './inventory.ts';
import { advisorAnalyse, advisorHealth, advisorScenario, briefModel } from './advisor.ts';
import { computeMetrics, createSeedDB } from '../store/store.ts';

test('IPE: Wilson EOQ, EPQ, Quantity Discounts, and ROP math', () => {
  const e = eoq({ annualDemand: 10000, orderCost: 100, unitCost: 20, holdingRate: 25 });
  assert.equal(e.valid, true);
  assert.ok(Math.abs(e.Q - Math.sqrt((2 * 10000 * 100) / 5)) < 1e-6);

  const p = epq({ annualDemand: 10000, setupCost: 150, unitCost: 20, holdingRate: 25, productionRate: 20000 });
  assert.equal(p.valid, true);
  assert.ok(p.Q > e.Q, 'EPQ lot size should exceed Wilson EOQ when p > D');
  assert.ok(p.maxInventory < p.Q);

  const qd = quantityDiscount({
    annualDemand: 5000,
    orderCost: 100,
    unitCost: 10,
    holdingRate: 20,
    tiers: [
      { minQty: 1, discountPct: 0 },
      { minQty: 500, discountPct: 5 },
      { minQty: 1000, discountPct: 10 },
    ],
  });
  assert.equal(qd.valid, true);
  assert.equal(qd.best!.minQty, 1000);

  const r = rop({ annualDemand: 12000, leadTimeDays: 14, serviceLevel: 95, history: [950, 1050, 1000, 980, 1020] });
  assert.equal(r.valid, true);
  assert.ok(r.safetyStock > 0);
  assert.ok(r.rop > r.dBar * 14);
  assert.equal(statusFor(0, r.rop, r.safetyStock), 'out');
  assert.equal(statusFor(r.safetyStock - 1, r.rop, r.safetyStock), 'critical');
  assert.equal(statusFor(r.rop, r.rop, r.safetyStock), 'reorder');
  assert.equal(statusFor(r.rop + 50, r.rop, r.safetyStock), 'ok');
});

test('IPE: Normal inverse, ABC classification, Newsvendor, and SPC/EWMA/CUSUM', () => {
  assert.ok(Math.abs(normInv(0.95) - 1.6448536) < 1e-4);
  assert.ok(Math.abs(normCdf(1.96) - 0.975002) < 1e-4);

  const rows = abcAnalysis(
    [
      { id: 'A1', sku: 'A1', name: 'Item A1', category: 'Test', unit: 'pcs', annualDemand: 1000, unitCost: 100 },
      { id: 'B1', sku: 'B1', name: 'Item B1', category: 'Test', unit: 'pcs', annualDemand: 200, unitCost: 100 },
      { id: 'C1', sku: 'C1', name: 'Item C1', category: 'Test', unit: 'pcs', annualDemand: 50, unitCost: 10 },
    ],
    { aThreshold: 70, bThreshold: 90 }
  );
  const sum = abcSummary(rows);
  assert.equal(sum.A.count, 1);
  assert.ok(Math.abs(sum.total - 120500) < 1e-6);

  const nv = newsvendor({ price: 30, cost: 12, salvage: 4, mean: 100, sd: 20 });
  assert.equal(nv.valid, true);
  assert.ok(Math.abs(nv.criticalRatio - (30 - 12) / (30 - 4)) < 1e-6);
  assert.ok(nv.Q > 100);

  const subgroups = [
    [10.02, 9.98, 10.01, 9.99, 10.0],
    [10.01, 10.03, 9.97, 10.0, 9.99],
    [9.98, 10.02, 10.01, 10.0, 10.01],
    [10.04, 10.05, 10.02, 10.03, 10.01],
    [10.18, 10.22, 10.19, 10.2, 10.21],
  ];
  const spc = spcAnalysis({ subgroups, usl: 10.3, lsl: 9.7 });
  assert.equal(spc.valid, true);
  assert.ok(spc.oocCount >= 1);
  const drift = spcDrift({ subgroups, usl: 10.3, lsl: 9.7, target: 10.0 });
  assert.equal(drift.valid, true);
  assert.ok(drift.ewma!.oocCount >= 1 || drift.cusum!.oocCount >= 1);
});

test('Forecast: 12 methods, backtesting, classification, and synthetic pattern generator', () => {
  const { history: trendHist } = generateDemandDataset('trend', { n: 24, base: 100, noise: 4, seed: 12 });
  const cls = classifyDemand(trendHist);
  assert.ok(cls.slope > 2, 'Trend dataset should exhibit strong positive slope');

  const rec = recommendForecast(trendHist, [
    { name: 'SMA (3)', shortKey: 'sma', method: smaMethod, params: { w: 3 } },
    { name: 'Holt', shortKey: 'holt', method: holtLinear, params: { alpha: 0.35, beta: 0.15 } },
  ]);
  assert.equal(rec.recommendation, 'Holt');

  const intermittent = [0, 0, 12, 0, 0, 0, 18, 0, 0, 14, 0, 0, 0, 16, 0, 0, 15, 0];
  const cr = crostonMethod(intermittent, { alpha: 0.2, horizon: 3 });
  const sba = sbaMethod(intermittent, { alpha: 0.2, horizon: 3 });
  assert.ok(sba.forecast[0] < cr.forecast[0], 'SBA corrects Croston positive bias');

  const cmp = compareMethods(trendHist, [
    { name: 'SMA', method: smaMethod, params: { w: 3 } },
    { name: 'Holt', method: holtLinear, params: { alpha: 0.35, beta: 0.15 } },
  ]);
  assert.ok(cmp.best != null);
});

test('MRP: multi-level explosion, lot sizing, and shortage / late detection', () => {
  const ls = lotSize(130, { lotRule: 'foq', foqQty: 100 });
  assert.equal(ls.orderQty, 200);

  const plan = mrpPlan({
    rootId: 'ASM',
    planQuantity: 10,
    needInDays: 10,
    horizonDays: 30,
    bucketSizeDays: 1,
    lotRule: 'l4l',
    items: {
      ASM: {
        name: 'Assembly',
        bom: [
          { componentId: 'SUB', qtyPer: 2 },
          { componentId: 'RAW', qtyPer: 1 },
        ],
        onHand: 0,
        leadTimeDays: 2,
      },
      SUB: {
        name: 'Subassembly',
        bom: [{ componentId: 'RAW', qtyPer: 3 }],
        onHand: 5,
        safetyStock: 5,
        leadTimeDays: 15,
      },
      RAW: {
        name: 'Steel Bolt',
        bom: [],
        onHand: 10,
        safetyStock: 0,
        leadTimeDays: 4,
      },
    },
  });

  // RAW needed: 10 * (1 + 2 * 3) = 70
  assert.equal(plan.components.RAW.totalGross, 70);
  assert.equal(plan.components.RAW.totalNetRequirement, 60);
  // SUB has 15d lead time vs 10d need date -> late order warning
  assert.ok(plan.lateOrderWarnings.some((w) => w.componentId === 'SUB'));
});

test('Line Balancing: 5 algorithms on benchmarks & cycle guard', () => {
  const bosch = getBenchmark('bosch-13')!;
  assert.equal(bosch.tasks.length, 13);

  const cmp = compareAlgorithms({ tasks: bosch.tasks, cycleTime: 10 });
  assert.equal(cmp.algorithms.exact.stationCount, 3);
  assert.equal(cmp.algorithms.exact.exact, true);
  assert.ok(cmp.algorithms.exact.stationCount! <= cmp.algorithms.comsoal.stationCount!);
  assert.ok(cmp.algorithms.rpw.valid);

  const simple = getBenchmark('simple-6')!;
  const ex = lineBalanceExact({ tasks: simple.tasks, cycleTime: 10 });
  assert.equal(ex.stationCount, 3);

  const cyclic = lineBalanceRPW({
    tasks: [
      { id: 'A', time: 2, successors: ['B'] },
      { id: 'B', time: 2, successors: ['A'] },
    ],
    cycleTime: 5,
  });
  assert.equal(cyclic.valid, false);
});

test('Stochastic Inventory & Queueing: deterministic MC, optimizer, M/M/c/K, M/G/1', () => {
  const r1 = simulateMonteCarlo({
    Q: 200,
    R: 80,
    days: 180,
    replications: 20,
    seed: 123,
    unitCost: 10,
    holdingRate: 25,
    orderCost: 50,
    shortageCost: 5,
    demand: { type: 'normal', mean: 10, sd: 3 },
    leadTime: { type: 'deterministic', mean: 5 },
  });
  const r2 = simulateMonteCarlo({
    Q: 200,
    R: 80,
    days: 180,
    replications: 20,
    seed: 123,
    unitCost: 10,
    holdingRate: 25,
    orderCost: 50,
    shortageCost: 5,
    demand: { type: 'normal', mean: 10, sd: 3 },
    leadTime: { type: 'deterministic', mean: 5 },
  });
  assert.equal(r1.valid, true);
  assert.equal(r1.fillRate, r2.fillRate);
  assert.equal(r1.totalCost, r2.totalCost);

  const opt = inventoryOptimizer(
    {
      days: 90,
      unitCost: 10,
      holdingRate: 25,
      orderCost: 40,
      shortageCost: 8,
      demand: { type: 'poisson', mean: 8 },
      leadTime: { type: 'normal', mean: 4, sd: 1 },
    },
    'minCost',
    { replications: 15, seed: 42 }
  );
  assert.equal(opt.valid, true);
  assert.ok(opt.best != null);

  const mmck = queueMeckley({ lambda: 6, mu: 4, servers: 2, capacity: 8 });
  assert.equal(mmck.valid, true);
  assert.ok(mmck.pBlock > 0 && mmck.pBlock < 1);

  const mg1 = queueMG1({ lambda: 3, mu: 5, scv2: 0 });
  const mm1 = queueMeckley({ lambda: 3, mu: 5, servers: 1 });
  assert.ok(Math.abs(mg1.Wq - 0.5 * mm1.Wq) < 1e-6, 'M/D/1 (scv2=0) wait is exactly half of M/M/1');
});

test('Advisor & Executive Brief: pricing, health score, and policy simulation consistency', () => {
  const db = createSeedDB();
  const rows = db.products.map((p) => ({ p, m: computeMetrics(p) }));
  let stockValue = 0;
  let usageValue = 0;
  const counts = { ok: 0, reorder: 0, critical: 0, out: 0 };
  const byCategory: Record<string, number> = {};
  rows.forEach(({ p, m }) => {
    stockValue += m.stockValue;
    usageValue += m.usageValue;
    counts[m.status]++;
    byCategory[p.category] = (byCategory[p.category] || 0) + m.stockValue;
  });
  const summary = {
    skuCount: db.products.length,
    stockValue,
    usageValue,
    counts,
    byCategory,
    alertCount: counts.reorder + counts.critical + counts.out,
    txCount: db.transactions.length,
  };

  const { findings, totals } = advisorAnalyse(rows, db.transactions);
  assert.ok(findings.length > 0);
  const h = advisorHealth(rows, findings, totals, summary);
  assert.ok(h.score >= 0 && h.score <= 100);

  const scen = advisorScenario(rows, { cover: 1.5, band: [95, 97] });
  assert.ok(scen.parked >= scen.baseline, 'Tightening cover target flags more parked cash');

  const brief = briefModel(rows, db.transactions, summary, { advCover: 1.5, advSlLow: 95, advSlHigh: 97 });
  assert.equal(brief.policy.cover, 1.5);
  assert.ok(brief.totals.parkedCash >= scen.parked, 'Parked cash includes excess cover plus idle slow movers');
});

import {
  buildOperationsReport,
  fullOperationsDossierCSV,
  inventoryMetricsToCSV,
  operationsReportToMarkdown,
  productionMetricsToCSV,
  replenishmentScheduleToCSV,
} from './reports.ts';

test('Reports Engine: inventory metrics, BOM production readiness, line balance & CSV/Markdown builders', () => {
  const db = createSeedDB();
  const s = new (class {
    run() {
      const rows = db.products.map((p) => ({ p, m: computeMetrics(p) }));
      let stockValue = 0;
      let usageValue = 0;
      const counts = { ok: 0, reorder: 0, critical: 0, out: 0 };
      const byCategory: Record<string, number> = {};
      rows.forEach(({ p, m }) => {
        stockValue += m.stockValue;
        usageValue += m.usageValue;
        counts[m.status]++;
        byCategory[p.category] = (byCategory[p.category] || 0) + m.stockValue;
      });
      return {
        skuCount: db.products.length,
        stockValue,
        usageValue,
        counts,
        byCategory,
        alertCount: counts.reorder + counts.critical + counts.out,
        txCount: db.transactions.length,
      };
    }
  })().run();

  const snap = buildOperationsReport(db.products, s, db.settings, {
    buildQty: 25,
    needInDays: 35,
    benchmarkKey: 'bosch-13',
    cycleTime: 10,
  });

  assert.equal(snap.inventory.filteredSkuCount, 17);
  assert.ok(snap.inventory.stockValue > 0);
  assert.ok(snap.production.assemblies.length >= 4);
  assert.ok(snap.production.lineBalance.bestStations === 3);
  assert.ok(snap.production.lineBalance.efficiencyPct === 100);

  const invCsv = inventoryMetricsToCSV(snap);
  assert.ok(invCsv.includes('SKU,Name,Category'));
  assert.ok(invCsv.includes('ASM-CM200'));

  const prodCsv = productionMetricsToCSV(snap);
  assert.ok(prodCsv.includes('ASSEMBLY BUILD READINESS'));
  assert.ok(prodCsv.includes('LINE BALANCING'));

  const repCsv = replenishmentScheduleToCSV(snap);
  assert.ok(repCsv.includes('Estimated PO Value ($)'));

  const fullCsv = fullOperationsDossierCSV(snap);
  assert.ok(fullCsv.includes('REPLENISHMENT SCHEDULE'));
  assert.ok(fullCsv.includes('PRODUCTION & MRP METRICS'));
  assert.ok(fullCsv.includes('INVENTORY & ABC METRICS'));

  const md = operationsReportToMarkdown(snap);
  assert.ok(md.includes('# FactoryMind Operations Report'));
  assert.ok(md.includes('## Production & MRP Readiness'));
});

import { computeDashboardSummary } from './dashboardSummary.ts';

test('Dashboard Summary: Total Inventory Value, Low Stock Alerts, and Recent Production Throughput windows', () => {
  const db = createSeedDB();
  const now = Date.now();
  const summary30 = computeDashboardSummary(db.products, db.transactions, db.settings, { nowTs: now, windowDays: 30 });
  const summary7 = computeDashboardSummary(db.products, db.transactions, db.settings, { nowTs: now, windowDays: 7 });

  assert.equal(summary30.inventory.skuCount, 17);
  assert.ok(summary30.inventory.totalValue > 0);
  assert.equal(
    summary30.alerts.totalAlerts,
    summary30.alerts.outCount + summary30.alerts.criticalCount + summary30.alerts.reorderCount
  );
  assert.ok(summary30.alerts.totalAlerts > 0);
  assert.ok(summary30.alerts.mostUrgent != null);
  assert.ok(summary30.throughput.outboundUnits >= summary7.throughput.outboundUnits);
  assert.ok(Math.abs(summary30.throughput.dailyUnitRate - summary30.throughput.outboundUnits / 30) < 1e-9);
});

import { ASSEMBLY_3D_SPECS, ASSEMBLY_SKU_LIST, getAssemblySpec, isAssemblySku } from './threeSpecs.ts';

test('3D Digital Twin Specs: all 5 assemblies and BOM sub-parts map to real catalogue SKUs', () => {
  const db = createSeedDB();
  const skuSet = new Set(db.products.map((p) => p.sku));

  assert.equal(ASSEMBLY_SKU_LIST.length, 5);
  ASSEMBLY_SKU_LIST.forEach((sku) => {
    assert.equal(isAssemblySku(sku), true);
    assert.ok(skuSet.has(sku), `Assembly SKU ${sku} should exist in catalogue`);
    const spec = getAssemblySpec(sku);
    assert.ok(spec.parts.length >= 4, `${sku} should have at least 4 articulated 3D parts`);
    spec.parts.forEach((part) => {
      assert.ok(skuSet.has(part.sku), `3D part SKU ${part.sku} in ${sku} should exist in catalogue`);
      assert.ok(part.qtyPer > 0);
    });
  });
  assert.equal(Object.keys(ASSEMBLY_3D_SPECS).length, 5);
});

import { predictSmartAlerts } from './smartAlerts.ts';

test('Smart Alerts: predicts upcoming stockouts from demand trajectories and flags lead-time risks', () => {
  const db = createSeedDB();
  const seededResult = predictSmartAlerts(db.products, computeMetrics, { horizonDays: 45 });

  assert.ok(seededResult.alerts.length > 0, 'Seed catalogue should produce predictive alerts');
  assert.ok(seededResult.summary.beforeLeadTimeCount > 0, 'Should catch SKUs running out before lead time');
  assert.equal(seededResult.summary.mostUrgent?.id, seededResult.alerts[0].id);

  // Synthetic test: accelerating demand trend catches stockout earlier than static annual average
  const trendingSku = {
    ...db.products[0],
    id: 'p-trend-test',
    sku: 'TRD-100',
    name: 'Trending Valve',
    stock: 220,
    annualDemand: 1200, // static ~3.29/day => ~67 days cover
    leadTime: 20,
    // Strong upward trend: last few months ~400/mo (~13.3/day) -> runs out in <18d (<20d lead time!)
    demandHistory: [40, 55, 70, 90, 120, 160, 210, 260, 310, 360, 410, 460],
  };

  const wellStockedSku = {
    ...db.products[1],
    id: 'p-safe-test',
    sku: 'SAF-999',
    name: 'Well-Stocked Plate',
    stock: 50000,
    annualDemand: 1200,
    leadTime: 10,
    demandHistory: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
  };

  const zeroStockSku = {
    ...db.products[2],
    id: 'p-zero-test',
    sku: 'ZER-000',
    name: 'Depleted Gasket',
    stock: 0,
    annualDemand: 2400,
    leadTime: 7,
    demandHistory: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200],
  };

  const res = predictSmartAlerts([wellStockedSku, trendingSku, zeroStockSku], computeMetrics, {
    horizonDays: 45,
  });

  assert.equal(res.alerts.some((a) => a.product.sku === 'SAF-999'), false, 'Well-stocked item should not trigger alert');
  const zeroAlert = res.alerts.find((a) => a.product.sku === 'ZER-000');
  assert.ok(zeroAlert, 'Zero-stock SKU should trigger imminent alert');
  assert.equal(zeroAlert.severity, 'imminent');

  const trendAlert = res.alerts.find((a) => a.product.sku === 'TRD-100');
  assert.ok(trendAlert, 'Trending SKU should trigger predictive alert despite 67d static cover');
  assert.ok(
    trendAlert.daysUntilStockout < trendAlert.staticDaysOfCover,
    'Forecast days until stockout must be shorter than static cover under rising demand'
  );
  assert.equal(trendAlert.runsOutBeforeLeadTime, true);
  assert.equal(trendAlert.severity, 'critical');
  assert.equal(res.alerts[0].product.sku, 'ZER-000', 'Imminent alert ranks before critical alert');
});

import { simulateProductionLine, stationsFromLineBalance } from './prodsim.ts';

test('ProdSim DES: validates Little Law, blocking/starvation with tight buffers, MTBF/MTTR, and LineBalance sync', () => {
  const bosch = getBenchmark('bosch-13')!;
  const lb = compareAlgorithms({ tasks: bosch.tasks, cycleTime: 10 });
  const stations = stationsFromLineBalance(lb.algorithms.exact, {
    cv: 0.2,
    bufferCapacity: 2,
    mtbfMin: 120,
    mttrMin: 6,
  });
  assert.equal(stations.length, 3);

  const des = simulateProductionLine({
    stations,
    arrivalRatePerHour: 5.0,
    arrivalCv: 0.5,
    shiftMinutes: 720,
    warmupMinutes: 90,
    replications: 15,
    seed: 42,
    serviceDist: 'lognormal',
  });
  assert.equal(des.valid, true);
  assert.ok(des.effectiveThroughputPerHour > 3.5);
  assert.ok(des.littlesLawGapPct < 10, `Expected Little's Law gap < 10%, got ${des.littlesLawGapPct}`);
  assert.ok(des.stations.some((s) => s.isBottleneck), 'Should flag a bottleneck station');
  assert.ok(des.stations.some((s) => s.downPct > 0), 'MTBF/MTTR should produce measurable downtime');
  assert.ok(des.timeline.length > 0);

  const invalidDes = simulateProductionLine({ stations: [], arrivalRatePerHour: 5 });
  assert.equal(invalidDes.valid, false);
});

test('Audit Upgrades: detrended dailyStats, Phase II SPC, EWMA finite bounds, MRP receipts/alerts, MC pipeline, and CSV escaping', () => {
  // 1. Trend history should yield smaller detrended residual sigma than raw total stdev
  const trendMonthly = [100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320];
  const rTrend = rop({ annualDemand: 2520, leadTimeDays: 10, serviceLevel: 95, history: trendMonthly });
  assert.equal(rTrend.sigmaFallback, false);
  assert.ok(rTrend.sigmaD < 5, `Pure linear trend residual σ_d should be near zero, got ${rTrend.sigmaD}`);

  const rNoHist = rop({ annualDemand: 1000, leadTimeDays: 10, serviceLevel: 95, history: [] });
  assert.equal(rNoHist.sigmaFallback, true);
  assert.ok(rNoHist.sigmaSource.includes('assumed') || rNoHist.sigmaSource.includes('no usable history'));

  // 2. SPC Phase II excludes OOC subgroups & EWMA uses expanding finite-horizon uclSeries
  const nomHi = [9.975, 10.015, 10.035, 10.055, 10.095]; // mean 10.035, R=0.12
  const nomLo = [9.935, 9.975, 9.995, 10.015, 10.055]; // mean 9.995, R=0.12
  const spcGroups = [
    nomHi, nomLo, nomHi, nomLo, nomHi,
    nomLo, nomHi, nomLo, nomHi, nomLo,
    [10.15, 10.17, 10.18, 10.21, 10.19], // sharp OOC spike (mean 10.18)
  ];
  const spcRes = spcAnalysis({ subgroups: spcGroups, usl: 10.2, lsl: 9.8 });
  assert.equal(spcRes.oocCount, 1);
  assert.ok(spcRes.phase2Cap != null);
  assert.ok(spcRes.phase2Cap.Cpk > spcRes.cap!.Cpk, 'Phase II Cpk excluding OOC spike must exceed raw Cpk');

  const driftRes = spcDrift({ subgroups: spcGroups.slice(0, 3), target: 10.0, lambda: 0.2 });
  assert.ok(driftRes.ewma!.uclSeries[0] < driftRes.ewma!.uclSeries[2]);
  assert.ok(driftRes.ewma!.uclSeries[2] <= driftRes.ewma!.ucl);

  // 3. MRP ceiling lead-time offset + scheduledReceipts cover
  const mrpWithPo = mrpPlan({
    rootId: 'ASM',
    planQuantity: 20,
    needInDays: 14,
    horizonDays: 28,
    bucketSizeDays: 7,
    items: {
      ASM: { name: 'Assembly', bom: [{ componentId: 'C1', qtyPer: 1 }], onHand: 0, leadTimeDays: 2 },
      C1: {
        name: 'Motor',
        bom: [],
        onHand: 5,
        safetyStock: 5,
        leadTimeDays: 9,
        scheduledReceipts: [{ qty: 20, daysFromStart: 7 }],
      },
    },
  });
  assert.equal(mrpWithPo.components.C1.totalNetRequirement, 0, 'Open PO scheduled receipt covers net req');

  const mrpLate = mrpPlan({
    rootId: 'ASM',
    planQuantity: 20,
    needInDays: 3,
    horizonDays: 28,
    bucketSizeDays: 7,
    items: {
      ASM: { name: 'Assembly', bom: [{ componentId: 'C1', qtyPer: 1 }], onHand: 0, leadTimeDays: 1 },
      C1: { name: 'Motor', bom: [], onHand: 0, safetyStock: 5, leadTimeDays: 15 },
    },
  });
  assert.ok(mrpLate.shortageAlerts.length > 0, 'Lead-time deficit should produce MRP shortageAlert');

  // 4. Monte Carlo concurrent pipeline orders + high-CV normal warning
  const mcMulti = simulateMonteCarlo({
    Q: 30,
    R: 80,
    days: 120,
    replications: 15,
    seed: 7,
    unitCost: 10,
    holdingRate: 20,
    orderCost: 10,
    shortageCost: 5,
    demand: { type: 'normal', mean: 15, sd: 8 }, // CV > 0.35 triggers warning
    leadTime: { type: 'deterministic', mean: 12 }, // 12d * 15/d = 180 demand in flight => > 1 pipeline order
  });
  assert.equal(mcMulti.valid, true);
  assert.ok(mcMulti.avgOrdersInPipeline > 1.2, `Expected concurrent orders in flight, got ${mcMulti.avgOrdersInPipeline}`);
  assert.ok(mcMulti.truncationWarning && mcMulti.truncationWarning.includes('CV'));

  // 5. Reports CSV injection escaping + customTasks
  const db = createSeedDB();
  db.products[0].name = '=HYPERLINK("http://evil","Click")';
  const sum = {
    skuCount: db.products.length,
    stockValue: 1000,
    usageValue: 5000,
    counts: { ok: 10, reorder: 4, critical: 2, out: 1 },
    byCategory: { Assembly: 1000 },
    alertCount: 7,
    txCount: 0,
  };
  const customSnap = buildOperationsReport(db.products, sum, db.settings, {
    customTasks: [
      { id: 'A', time: 4, successors: ['B'] },
      { id: 'B', time: 5, successors: [] },
    ],
    cycleTime: 6,
  });
  assert.equal(customSnap.production.lineBalance.taskCount, 2);
  const safeCsv = inventoryMetricsToCSV(customSnap);
  assert.ok(safeCsv.includes("'=HYPERLINK"), 'Formula prefix should be neutralized with leading apostrophe');
});



