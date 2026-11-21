import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dailyStats,
  eoq,
  epq,
  mean,
  newsvendor,
  newsvendorProfit,
  normCdf,
  normInv,
  quantityDiscount,
  queueing,
  rop,
  SPC_CONSTANTS,
  spcAnalysis,
  spcDrift,
  stdev,
  totalCostAtQ,
} from './ipe.ts';
import {
  accuracyMetrics,
  backtestForecast,
  classifyDemand,
  crostonMethod,
  emaMethod,
  holtLinear,
  hwAdditive,
  hwMultiplicative,
  linregMethod,
  mase,
  meanBaseline,
  naiveMethod,
  recommendForecast,
  sbaMethod,
  seasonalNaive,
  smaMethod,
  wmaMethod,
} from './forecast.ts';
import { bomTopology, lotSize, mrpPlan } from './mrp.ts';
import {
  getBenchmark,
  lineBalanceCOMSOAL,
  lineBalanceExact,
  lineBalanceKW,
  lineBalanceLCR,
  lineBalanceRPW,
  LineBalanceSolution,
  LineBalTaskInput,
} from './linebal.ts';
import {
  demandDistribution,
  inventoryOptimizer,
  leadTimeModel,
  queueMeckley,
  queueMG1,
  simulateMonteCarlo,
} from './inventory.ts';
import { simulateProductionLine } from './prodsim.ts';

/* ============================================================================
 * 1. INVENTORY OPTIMIZATION VALIDATION
 * ============================================================================ */

test('Math [Inventory]: EOQ cost-equality identity, local minimum, and invalid bounds', () => {
  const params = { annualDemand: 8400, orderCost: 125, unitCost: 35, holdingRate: 22 };
  const res = eoq(params);
  assert.equal(res.valid, true);

  // At optimal Q*, annual ordering cost equals annual holding cost
  assert.ok(Math.abs(res.orderingCost - res.holdingCost) < 1e-8);

  // Verify Q* strictly minimizes total variable cost vs +/- 1% perturbations
  const left = totalCostAtQ(res.Q * 0.99, params);
  const right = totalCostAtQ(res.Q * 1.01, params);
  assert.ok(res.variableCost < left.variable && res.variableCost < right.variable);

  // Boundary invalidation
  assert.equal(eoq({ ...params, annualDemand: 0 }).valid, false);
  assert.equal(eoq({ ...params, orderCost: -10 }).valid, false);
  assert.equal(eoq({ ...params, holdingRate: 0 }).valid, false);
});

test('Math [Inventory]: EPQ asymptotic limit converges to Wilson EOQ as p -> infinity', () => {
  const base = { annualDemand: 6000, cost: 40, orderCost: 90, rate: 25 };
  const wEoq = eoq({
    annualDemand: base.annualDemand,
    orderCost: base.orderCost,
    unitCost: base.cost,
    holdingRate: base.rate,
  });
  const finiteP = epq({
    annualDemand: base.annualDemand,
    setupCost: base.orderCost,
    unitCost: base.cost,
    holdingRate: base.rate,
    productionRate: 12000, // rho = 0.5 => factor 1/sqrt(0.5) = sqrt(2)
  });
  assert.equal(finiteP.valid, true);
  assert.ok(Math.abs(finiteP.Q / wEoq.Q - Math.SQRT2) < 1e-8);
  assert.ok(Math.abs(finiteP.maxInventory - finiteP.Q * (1 - 0.5)) < 1e-8);
  assert.ok(Math.abs(finiteP.setupCost - finiteP.holdingCost) < 1e-8);

  const highP = epq({
    annualDemand: base.annualDemand,
    setupCost: base.orderCost,
    unitCost: base.cost,
    holdingRate: base.rate,
    productionRate: 1e9,
  });
  assert.ok(Math.abs(highP.Q - wEoq.Q) / wEoq.Q < 1e-4);

  // Infeasible when production rate <= demand
  assert.equal(epq({ annualDemand: 6000, setupCost: 90, unitCost: 40, holdingRate: 25, productionRate: 6000 }).valid, false);
  assert.equal(epq({ annualDemand: 6000, setupCost: 90, unitCost: 40, holdingRate: 25, productionRate: 4500 }).valid, false);
});

test('Math [Inventory]: ROP special cases (zero L, zero variance, trend residuals, monotonicity)', () => {
  const zLead = rop({ annualDemand: 3650, leadTimeDays: 0, serviceLevel: 99, history: [280, 320, 300] });
  assert.equal(zLead.valid, true);
  assert.equal(zLead.safetyStock, 0);
  assert.equal(zLead.rop, 0);

  const constHist = rop({ annualDemand: 3650, leadTimeDays: 10, serviceLevel: 95, history: [300, 300, 300, 300] });
  assert.equal(constHist.valid, true);
  assert.equal(constHist.sigmaD, 0);
  assert.equal(constHist.safetyStock, 0);
  assert.ok(Math.abs(constHist.rop - 100) < 1e-8);

  // Service level monotonicity
  const r90 = rop({ annualDemand: 3650, leadTimeDays: 10, serviceLevel: 90, history: [250, 350, 290, 310] });
  const r99 = rop({ annualDemand: 3650, leadTimeDays: 10, serviceLevel: 99, history: [250, 350, 290, 310] });
  assert.ok(r99.safetyStock > r90.safetyStock);
  assert.ok(r99.rop > r90.rop);

  // Clean linear ramp gives near-zero detrended residual sigmaD
  const ds = dailyStats(7800, [100, 200, 300, 400, 500, 600, 700, 800]);
  assert.equal(ds.sigmaFallback, false);
  assert.ok(ds.sigmaD < 1e-6);

  // Invalid service level boundaries
  assert.equal(rop({ annualDemand: 1000, leadTimeDays: 5, serviceLevel: 100 }).valid, false);
  assert.equal(rop({ annualDemand: 1000, leadTimeDays: 5, serviceLevel: 0 }).valid, false);
});

test('Math [Inventory]: All-unit Quantity Discount price-break vs infeasible EOQ check', () => {
  // Craft scenario where lower-tier EOQ is infeasible and price-break threshold wins
  const qd = quantityDiscount({
    annualDemand: 2400,
    orderCost: 50,
    unitCost: 20,
    holdingRate: 25,
    tiers: [
      { minQty: 1, discountPct: 0 },     // EOQ = sqrt(2*2400*50/(20*0.25)) = sqrt(48000) ~ 219.1 (feasible)
      { minQty: 400, discountPct: 4 },   // EOQ ~ 223.6 (<400, clamped to 400)
      { minQty: 1200, discountPct: 5 },  // Clamped to 1200 -> higher holding exceeds marginal 1% discount
    ],
  });
  assert.equal(qd.valid, true);
  assert.equal(qd.rows[0].eoqFeasible, true);
  assert.equal(qd.rows[1].eoqFeasible, false);
  assert.equal(qd.rows[1].Q, 400);
  // Tier 2 (minQty=400) vs Tier 1 & Tier 3 independent cost check
  const c0 = qd.rows[0].purchase + qd.rows[0].ordering + qd.rows[0].holding;
  const c1 = qd.rows[1].purchase + qd.rows[1].ordering + qd.rows[1].holding;
  const c2 = qd.rows[2].purchase + qd.rows[2].ordering + qd.rows[2].holding;
  assert.ok(c1 < c0 && c1 < c2);
  assert.equal(qd.best!.minQty, 400);
  assert.ok(Math.abs(qd.savings - (c0 - c1)) < 1e-6);
});

test('Math [Inventory]: Newsvendor finite-difference optimality, conservation identities & edge guards', () => {
  const cfg = { price: 50, cost: 20, salvage: 5, mean: 200, sd: 40 };
  const nv = newsvendor(cfg);
  assert.equal(nv.valid, true);

  // Critical ratio check: cu / (cu + co) = (50-20) / (50-5) = 30/45 = 2/3
  assert.ok(Math.abs(nv.criticalRatio - 2 / 3) < 1e-9);
  assert.ok(Math.abs(normCdf((nv.Q - cfg.mean) / cfg.sd) - 2 / 3) < 1e-6);

  // Check normCdf(normInv(p)) == p identity
  assert.ok(Math.abs(normCdf(normInv(0.95)) - 0.95) < 1e-9);
  assert.ok(Math.abs(normCdf(normInv(2 / 3)) - 2 / 3) < 1e-6);

  // Conservation laws: E[Sold] + E[Shortage] = mu, E[Sold] + E[Leftover] = Q
  assert.ok(Math.abs(nv.expectedSold + nv.expectedShortage - cfg.mean) < 1e-8);
  assert.ok(Math.abs(nv.expectedSold + nv.expectedLeftover - nv.Q) < 1e-8);

  // Numerical optimization verification via independent profit evaluator
  const pOpt = newsvendorProfit(nv.Q, cfg);
  const pMinus = newsvendorProfit(nv.Q - 0.5, cfg);
  const pPlus = newsvendorProfit(nv.Q + 0.5, cfg);
  assert.ok(Math.abs(pOpt - nv.expectedProfit) < 1e-6);
  assert.ok(pOpt > pMinus && pOpt > pPlus);

  // Reject invalid unit economics
  assert.equal(newsvendor({ ...cfg, price: 20 }).valid, false); // cu = 0
  assert.equal(newsvendor({ ...cfg, salvage: 20 }).valid, false); // co = 0
  assert.equal(newsvendor({ ...cfg, sd: 0 }).valid, false);
});

test('Math [Inventory]: Deterministic continuous-review MC reproduces closed-form EOQ cycle metrics', () => {
  // Constant demand D = 10/day, constant leadTime L = 5 days, Q = 100, R = 50 (exact demand during LT), initial = 150
  // Every cycle spans exactly 10 days cleanly over 100 days (10 cycles) with zero shortages.
  const sim = simulateMonteCarlo({
    Q: 100,
    R: 50,
    days: 100,
    replications: 5,
    seed: 1,
    initialStock: 140, // triggers at day 9 (stock=50 -> order 100 arrives day 14 when stock=0, rises to 100)
    unitCost: 20,
    holdingRate: 36.5, // H_d = 20 * 0.365 / 365 = 0.02 / unit-day
    orderCost: 40,
    shortageCost: 10,
    demand: { type: 'constant', mean: 10 },
    leadTime: { type: 'deterministic', mean: 5 },
  });
  assert.equal(sim.valid, true);
  assert.equal(sim.fillRate, 100);
  assert.equal(sim.stockoutDays, 0);
  assert.equal(sim.avgDemand, 10);
  // Ordering cost + holding cost consistency with accounting
  assert.ok(Math.abs(sim.totalCost - (sim.holdingCost + sim.orderingCost + sim.shortageCost)) < 1e-8);
  // Zero SD across identical deterministic replications
  assert.equal(sim.totalCostSd, 0);
});

/* ============================================================================
 * 2. FORECASTING ENGINE VALIDATION & REGRESSION TESTS
 * ============================================================================ */

test('Math [Forecast]: All 12 forecasting methods reconstruct analytical reference signals', () => {
  const constant = new Array(16).fill(50);
  const linear = Array.from({ length: 16 }, (_, t) => 20 + 5 * t); // ends at 20+75=95; next = 100, 105, 110
  const seasonal4 = [10, 40, 20, 30, 10, 40, 20, 30, 10, 40, 20, 30, 10, 40, 20, 30];

  assert.ok(Math.abs(smaMethod(constant, { w: 4, horizon: 3 }).forecast[0] - 50) < 1e-9);
  assert.ok(Math.abs(wmaMethod(constant, { w: 4, horizon: 3 }).forecast[0] - 50) < 1e-9);
  assert.ok(Math.abs(emaMethod(constant, { alpha: 0.4, horizon: 3 }).forecast[0] - 50) < 1e-9);
  assert.ok(Math.abs(naiveMethod(constant, { horizon: 3 }).forecast[0] - 50) < 1e-9);
  assert.ok(Math.abs(meanBaseline(constant, { horizon: 3 }).forecast[0] - 50) < 1e-9);

  const linRes = linregMethod(linear, { horizon: 3 });
  assert.ok(Math.abs(linRes.forecast[0] - 100) < 1e-6);
  assert.ok(Math.abs(linRes.forecast[2] - 110) < 1e-6);

  const holtRes = holtLinear(linear, { alpha: 0.4, beta: 0.2, horizon: 3 });
  assert.ok(Math.abs(holtRes.forecast[0] - 100) < 1e-6);
  assert.ok(Math.abs(holtRes.forecast[2] - 110) < 1e-6);

  const snRes = seasonalNaive(seasonal4, { period: 4, horizon: 4 });
  assert.deepEqual(snRes.forecast, [10, 40, 20, 30]);

  // REGRESSION: HW Additive & Multiplicative exact periodic phase alignment ((n + h - 1) % p)
  const hwaRes = hwAdditive(seasonal4, { seasonPeriod: 4, alpha: 0.3, beta: 0.1, gamma: 0.2, horizon: 4 });
  assert.ok(Math.abs(hwaRes.forecast[0] - 10) < 1e-6, `Expected HWA step 1 = 10, got ${hwaRes.forecast[0]}`);
  assert.ok(Math.abs(hwaRes.forecast[1] - 40) < 1e-6, `Expected HWA step 2 = 40, got ${hwaRes.forecast[1]}`);
  assert.ok(Math.abs(hwaRes.forecast[2] - 20) < 1e-6);
  assert.ok(Math.abs(hwaRes.forecast[3] - 30) < 1e-6);

  const hwmRes = hwMultiplicative(seasonal4, { seasonPeriod: 4, alpha: 0.3, beta: 0.1, gamma: 0.2, horizon: 4 });
  assert.ok(Math.abs(hwmRes.forecast[0] - 10) < 1e-6, `Expected HWM step 1 = 10, got ${hwmRes.forecast[0]}`);
  assert.ok(Math.abs(hwmRes.forecast[1] - 40) < 1e-6, `Expected HWM step 2 = 40, got ${hwmRes.forecast[1]}`);
  assert.ok(Math.abs(hwmRes.forecast[2] - 20) < 1e-6);
  assert.ok(Math.abs(hwmRes.forecast[3] - 30) < 1e-6);
});

test('Math [Forecast]: REGRESSION Croston leading-zero init, sparse single spike, and canonical SBA relation', () => {
  const periodicIntermittent = [0, 0, 12, 0, 0, 12, 0, 0, 12]; // size=12 every 3 periods -> rate = 4.0
  const alpha = 0.2;
  const cr = crostonMethod(periodicIntermittent, { alpha, horizon: 2 });
  const sb = sbaMethod(periodicIntermittent, { alpha, horizon: 2 });

  assert.ok(Math.abs(cr.forecast[0] - 4) < 1e-8, `Expected exact Croston rate 4.0, got ${cr.forecast[0]}`);
  assert.ok(Math.abs(sb.forecast[0] - 4 * (1 - alpha / 2)) < 1e-8, `Expected exact SBA rate 3.6, got ${sb.forecast[0]}`);
  assert.ok(sb.forecast[0] < cr.forecast[0]);

  // Sparse single nonzero demand across 10 periods -> rate = 20 / 10 = 2.0
  const singleSpike = [0, 0, 0, 20, 0, 0, 0, 0, 0, 0];
  const crSparse = crostonMethod(singleSpike, { alpha: 0.3, horizon: 1 });
  assert.ok(Math.abs(crSparse.forecast[0] - 2.0) < 1e-8);

  // Classification check on intermittent vs seasonal vs trending
  const clsInt = classifyDemand(periodicIntermittent, 4);
  assert.ok(clsInt.pdt < 0.5 && clsInt.type.includes('intermittent'));
});

test('Math [Forecast]: REGRESSION rolling-origin backtesting advances training window properly', () => {
  const seq = Array.from({ length: 18 }, (_, i) => (i + 1) * 10);
  const bt = backtestForecast(seq, {
    method: naiveMethod,
    horizon: 1,
    step: 1,
    trainWindow: { type: 'rolling', minSize: 4, maxSize: 6 },
  });
  assert.ok(bt.origins.length > 10);

  for (const o of bt.origins) {
    assert.equal(o.trainEnd, o.originIndex - 1, `Origin ${o.originIndex} must end right before origin`);
    assert.equal(o.trainSize, Math.min(o.originIndex, 6));
    assert.equal(o.pred[0], seq[o.originIndex - 1]);
  }

  // Forecast bias sign & magnitude check: naive under-predicts +10 step linear ramp by +10 mean(actual - pred)
  assert.ok(Math.abs(bt.metrics!.bias! - 10) < 1e-8);
  assert.ok(Math.abs(bt.metrics!.mae! - 10) < 1e-8);

  const mBias = accuracyMetrics([100, 110, 120], [105, 115, 125]);
  assert.ok(Math.abs(mBias.bias! - (-5)) < 1e-9, 'Consistent +5 over-forecast yields -5 bias');
  assert.ok(Math.abs(mBias.mae! - 5) < 1e-9);

  // MASE sanity check vs in-sample naive denominator
  const m = mase([20, 30, 40], [20, 30, 40], 1, [10, 20, 30, 40]);
  assert.equal(m, 0);
});

test('Math [Forecast]: Zero-demand series vs insufficient data in recommendForecast', () => {
  const zeros = new Array(12).fill(0);
  const zeroRec = recommendForecast(zeros, [{ name: 'SMA (3)', method: smaMethod, params: { w: 3 } }]);
  assert.ok(zeroRec.bestMethod != null, '12 periods of zero demand should produce zero-MAE recommendation');
  assert.equal(zeroRec.bestMethod!.metrics.mae, 0);

  const tooShort = [10, 12, 11];
  const shortRec = recommendForecast(tooShort, [{ name: 'SMA (3)', method: smaMethod, params: { w: 3 } }]);
  assert.equal(shortRec.bestMethod, null);
  assert.equal(shortRec.confidence, 0);
});

/* ============================================================================
 * 3. MRP MULTI-LEVEL BOM, SCRAP, LOT SIZING & CYCLE DETECTION
 * ============================================================================ */

test('Math [MRP]: Diamond BOM low-level coding, shared summation, and scrap/yield compounding', () => {
  // Diamond BOM:
  //   TOP (1) -> 2*SUB1, 1*SUB2, 4*BOLT
  //   SUB1    -> 3*BOLT
  //   SUB2    -> 2*BOLT
  // Level of BOLT must be 2 (low-level code = deepest parent + 1)
  // Without scrap on BOLT: total BOLT factor = 4 + 2*3 + 1*2 = 12 per TOP.
  // With BOLT scrapPct = 20% and yieldPct = 90% => effYield = 0.8 * 0.9 = 0.72 => factor = 12 / 0.72 = 16.6667
  const items = {
    TOP: { name: 'Top', bom: [{ componentId: 'SUB1', qtyPer: 2 }, { componentId: 'SUB2', qtyPer: 1 }, { componentId: 'BOLT', qtyPer: 4 }] },
    SUB1: { name: 'Sub1', bom: [{ componentId: 'BOLT', qtyPer: 3 }] },
    SUB2: { name: 'Sub2', bom: [{ componentId: 'BOLT', qtyPer: 2 }] },
    BOLT: { name: 'Bolt', bom: [], scrapPct: 20, yieldPct: 90, onHand: 0, leadTimeDays: 3 },
  };
  const topo = bomTopology('TOP', items);
  assert.equal(topo.hasCycle, false);
  assert.equal(topo.levels.BOLT, 2);

  const plan = mrpPlan({ rootId: 'TOP', planQuantity: 36, needInDays: 14, horizonDays: 30, items });
  assert.equal(plan.valid, true);
  // Expected gross BOLT = 36 * (12 / 0.72) = 600
  assert.ok(Math.abs(plan.components.BOLT.totalGross - 600) < 1e-4);
  assert.equal(plan.components.BOLT.level, 2);
});

test('Math [MRP]: All 4 lot-sizing rules and REGRESSION zero-FOQ/EOQ safe fallback', () => {
  assert.equal(lotSize(135, { lotRule: 'l4l' }).orderQty, 135);
  assert.equal(lotSize(135, { lotRule: 'foq', foqQty: 50 }).orderQty, 150);
  assert.equal(lotSize(135, { lotRule: 'eoq', eoqQty: 100 }).orderQty, 200);
  assert.equal(lotSize(135, { lotRule: 'poq', periodDemand: 60, periodCount: 3 }).orderQty, 180);

  // REGRESSION: zero foqQty or eoqQty falls back cleanly to netReq without division by 0.0001
  assert.equal(lotSize(135, { lotRule: 'foq', foqQty: 0 }).orderQty, 135);
  assert.equal(lotSize(135, { lotRule: 'eoq', eoqQty: 0 }).orderQty, 135);
  assert.equal(lotSize(0, { lotRule: 'foq', foqQty: 50 }).orderQty, 0);
});

test('Math [MRP]: Circular BOM detection & REGRESSION bounded finite quantities on cycle', () => {
  const cyclic = mrpPlan({
    rootId: 'ASM',
    planQuantity: 10,
    needInDays: 14,
    horizonDays: 30,
    items: {
      ASM: { name: 'Asm', bom: [{ componentId: 'SUB_A', qtyPer: 2 }], onHand: 0 },
      SUB_A: { name: 'SubA', bom: [{ componentId: 'SUB_B', qtyPer: 3 }], onHand: 0 },
      SUB_B: { name: 'SubB', bom: [{ componentId: 'SUB_A', qtyPer: 2 }], onHand: 0 }, // cycle B -> A -> B
    },
  });
  assert.equal(cyclic.topology.hasCycle, true);
  assert.equal(cyclic.valid, false);
  assert.equal(cyclic.summary.planFeasible, false);
  // Path-guarded traversal stops cycle inflation: ASM(1)->SUB_A(2)->SUB_B(6), back-edge skipped
  assert.ok(Number.isFinite(cyclic.components.SUB_A.totalGross));
  assert.equal(cyclic.components.SUB_A.totalGross, 20);
  assert.equal(cyclic.components.SUB_B.totalGross, 60);
});

/* ============================================================================
 * 4. PRODUCTION LINE BALANCING & DISCRETE-EVENT BOTTLENECK VALIDATION
 * ============================================================================ */

function assertValidBalance(sol: LineBalanceSolution, tasks: LineBalTaskInput[], cycleTime: number) {
  assert.equal(sol.valid, true, `Expected valid solution for ${sol.algorithm}, got reason: ${sol.reason}`);
  assert.ok(sol.stationCount != null && sol.stationCount >= sol.theoreticalMin);

  const totalInputTime = tasks.reduce((s, t) => s + t.time, 0);
  const assignedIds: string[] = [];
  const stationIdxOf: Record<string, number> = {};

  sol.stations.forEach((st, idx) => {
    const sumStation = st.tasks.reduce((s, t) => s + t.time, 0);
    assert.ok(sumStation <= cycleTime + 1e-9, `Station ${idx + 1} overloaded: ${sumStation} > ${cycleTime}`);
    assert.ok(Math.abs(st.time - sumStation) < 1e-9);
    assert.ok(Math.abs(st.idle - (cycleTime - sumStation)) < 1e-9);
    st.tasks.forEach((t) => {
      assignedIds.push(t.id);
      stationIdxOf[t.id] = idx;
    });
  });

  // Partition & precedence checks
  assert.equal(assignedIds.length, tasks.length, 'Every task assigned once');
  assert.equal(new Set(assignedIds).size, tasks.length, 'No duplicate task assignments');
  const sumAssigned = sol.stations.reduce((s, st) => s + st.time, 0);
  assert.ok(Math.abs(sumAssigned - totalInputTime) < 1e-9, 'Total task time conserved');

  tasks.forEach((t) => {
    const uSt = stationIdxOf[t.id];
    (t.successors || []).forEach((succId) => {
      const vSt = stationIdxOf[succId];
      assert.ok(uSt <= vSt, `Precedence violated: ${t.id}@S${uSt + 1} -> ${succId}@S${vSt + 1}`);
    });
  });
}

test('Math [Line Balancing]: Independent feasibility proof across all 5 algorithms & exact optimality', () => {
  const bosch = getBenchmark('bosch-13')!;
  const C = bosch.defaultCycleTime;
  const solutions = [
    lineBalanceRPW({ tasks: bosch.tasks, cycleTime: C }),
    lineBalanceLCR({ tasks: bosch.tasks, cycleTime: C }),
    lineBalanceKW({ tasks: bosch.tasks, cycleTime: C }),
    lineBalanceCOMSOAL({ tasks: bosch.tasks, cycleTime: C, trials: 100, seed: 7 }),
    lineBalanceExact({ tasks: bosch.tasks, cycleTime: C }),
  ];

  for (const sol of solutions) {
    assertValidBalance(sol, bosch.tasks, C);
  }
  const exact = solutions[4];
  assert.equal(exact.stationCount, bosch.optimalStations);
  for (const h of solutions.slice(0, 4)) {
    assert.ok(exact.stationCount! <= h.stationCount!);
  }
});

test('Math [Line Balancing]: REGRESSION standardized missing-successor/cycle/C<=0 guards & bottleneck peak load', () => {
  const missingSuccTasks: LineBalTaskInput[] = [
    { id: 'T1', time: 4, successors: ['MISSING'] },
    { id: 'T2', time: 3, successors: [] },
  ];
  assert.equal(lineBalanceRPW({ tasks: missingSuccTasks, cycleTime: 10 }).valid, false);
  assert.equal(lineBalanceLCR({ tasks: missingSuccTasks, cycleTime: 10 }).valid, false);
  assert.equal(lineBalanceKW({ tasks: missingSuccTasks, cycleTime: 10 }).valid, false);
  assert.equal(lineBalanceCOMSOAL({ tasks: missingSuccTasks, cycleTime: 10 }).valid, false);
  assert.equal(lineBalanceExact({ tasks: missingSuccTasks, cycleTime: 10 }).valid, false);

  assert.equal(lineBalanceExact({ tasks: [{ id: 'A', time: 5, successors: [] }], cycleTime: 0 }).inputsOk, false);
  assert.equal(lineBalanceCOMSOAL({ tasks: [{ id: 'A', time: 11, successors: [] }], cycleTime: 10 }).valid, false);

  // REGRESSION: bottleneck is highest-time (lowest-idle) station, NOT highest-idle station
  const skewed = lineBalanceRPW({
    tasks: [
      { id: 'A', time: 9, successors: ['B'] },
      { id: 'B', time: 3, successors: [] },
    ],
    cycleTime: 10,
  });
  assert.equal(skewed.stationCount, 2);
  assert.equal(skewed.bottleneck!.time, 9);
  assert.equal(skewed.bottleneck!.idle, 1);
});

test('Math [ProdSim DES]: REGRESSION identifies downstream slow bottleneck despite upstream finite-buffer blocking', () => {
  const sim = simulateProductionLine({
    stations: [
      { id: 'S1', name: 'Fast Feeder', meanTimeMin: 2, cv: 0.05, bufferCapacity: 1 },
      { id: 'S2', name: 'Slow Bottleneck', meanTimeMin: 12, cv: 0.05, bufferCapacity: 1 },
    ],
    arrivalRatePerHour: 12,
    arrivalCv: 0.1,
    shiftMinutes: 600,
    warmupMinutes: 60,
    replications: 10,
    seed: 19,
  });
  assert.equal(sim.valid, true);
  assert.equal(sim.bottleneckName, 'Slow Bottleneck', 'Upstream blocked feeder must not be mislabeled as bottleneck');
  assert.ok(sim.stations[1].busyPct > sim.stations[0].busyPct);
  assert.ok(sim.stations[0].utilizationPct < 40, 'utilizationPct should reflect busy fraction, not blocked wait');
});

/* ============================================================================
 * 5. STATISTICAL QUALITY CONTROL (X-BAR/R, EWMA, CUSUM, CAPABILITY)
 * ============================================================================ */

test('Math [Quality]: X-bar/R, Western Electric Rules 1/2/3, Cp/Cpk/Pp/Ppk vs independent math', () => {
  // 4 well-behaved size-4 subgroups
  const groups = [
    [10.0, 10.2, 9.8, 10.0],   // mean = 10.0, R = 0.4
    [10.1, 10.3, 9.9, 10.1],   // mean = 10.1, R = 0.4
    [9.9, 10.1, 9.7, 9.9],     // mean = 9.9, R = 0.4
    [10.0, 10.2, 9.8, 10.0],   // mean = 10.0, R = 0.4
  ];
  const spc = spcAnalysis({ subgroups: groups, usl: 10.6, lsl: 9.4 });
  assert.equal(spc.valid, true);

  const C4 = SPC_CONSTANTS[4];
  const expXbar = 10.0;
  const expRbar = 0.4;
  const expSigmaWithin = expRbar / C4.d2;
  const allVals = groups.flat();
  const expOverallSd = stdev(allVals);

  assert.ok(Math.abs(spc.xbar - expXbar) < 1e-9);
  assert.ok(Math.abs(spc.rbar - expRbar) < 1e-9);
  assert.ok(Math.abs(spc.ucl - (expXbar + C4.A2 * expRbar)) < 1e-9);
  assert.ok(Math.abs(spc.rUcl - C4.D4 * expRbar) < 1e-9);
  assert.ok(Math.abs(spc.cap!.Cp - 1.2 / (6 * expSigmaWithin)) < 1e-9);
  assert.ok(Math.abs(spc.cap!.Pp - 1.2 / (6 * expOverallSd)) < 1e-9);
  assert.ok(Math.abs(spc.cap!.Cp - spc.cap!.Cpk) < 1e-9, 'Centered process satisfies Cp == Cpk');

  // Rule 3 check: 8 consecutive points above center within control limits (not triggering Rule 1)
  const rule3Groups = [
    [9.0, 9.2], [9.0, 9.2], [9.0, 9.2], [9.0, 9.2], // baseline below mean
    [9.8, 10.0], [9.8, 10.0], [9.8, 10.0], [9.8, 10.0],
    [9.8, 10.0], [9.8, 10.0], [9.8, 10.0], [9.8, 10.0], // 8 shifts
  ];
  const spcR3 = spcAnalysis({ subgroups: rule3Groups });
  assert.ok(spcR3.ruleCounts[3] >= 8);
});

test('Math [Quality]: Small samples (n=2), uneven sizes, degenerate sigma=0, invalid specs & CUSUM k=0', () => {
  // Small sample n = 2 works cleanly
  const small = spcAnalysis({ subgroups: [[5.1, 4.9], [5.0, 5.2], [4.8, 5.0]], usl: 5.5, lsl: 4.5 });
  assert.equal(small.valid, true);
  assert.equal(small.n, 2);

  // Invalid sizes: n = 1, n = 11, uneven subgroup sizes
  assert.equal(spcAnalysis({ subgroups: [[5], [6]] }).valid, false);
  assert.equal(spcAnalysis({ subgroups: [new Array(11).fill(1), new Array(11).fill(2)] }).valid, false);
  assert.equal(spcAnalysis({ subgroups: [[1, 2], [1, 2, 3]] }).valid, false);

  // Degenerate zero variance
  const degen = spcAnalysis({ subgroups: [[10, 10], [10, 10], [10, 10]], usl: 11, lsl: 9 });
  assert.equal(degen.valid, true);
  assert.equal(degen.cap, null);
  assert.equal(degen.outOfSpecPct, 0);

  // REGRESSION: invalid specification limits (USL <= LSL) explicitly labeled and cap is null
  const badSpec = spcAnalysis({ subgroups: [[10.1, 9.9], [10.0, 10.2]], usl: 9.0, lsl: 11.0 });
  assert.equal(badSpec.valid, true);
  assert.equal(badSpec.cap, null);
  assert.ok(badSpec.capabilityLevel.includes('invalid spec limits'));

  // REGRESSION: spcDrift honors explicit k = 0 without falling back to 0.5
  const driftK0 = spcDrift({
    subgroups: [
      [10.0, 10.4],
      [10.2, 10.6],
      [10.5, 10.9],
      [10.8, 11.2],
    ],
    target: 10.0,
    k: 0,
    h: 2,
  });
  assert.equal(driftK0.valid, true);
  assert.equal(driftK0.cusum!.k, 0);
  assert.ok(driftK0.cusum!.oocCount >= 1);
});

/* ============================================================================
 * 6. STOCHASTIC DISTRIBUTIONS, CONVERGENCE, OPTIMIZER & QUEUEING
 * ============================================================================ */

test('Math [Stochastic]: PRNG reproducibility, distribution boundaries, Student-t small-n CI & convergence', () => {
  // Distribution validation boundaries
  assert.equal(demandDistribution({ type: 'normal', mean: 10, sd: 60 }).valid, false);
  assert.equal(demandDistribution({ type: 'lognormal', meanLog: 1, sdLog: 0 }).valid, false);
  assert.equal(demandDistribution({ type: 'gamma', shape: -1, scale: 2 }).valid, false);
  assert.equal(demandDistribution({ type: 'empirical', samples: [] }).valid, false);
  assert.equal(leadTimeModel({ type: 'empirical', samples: [] }).valid, false);

  // Large-sample empirical mean/variance verification for Gamma(4, 5) (mean=20, sd=10)
  const gam = demandDistribution({ type: 'gamma', shape: 4, scale: 5 });
  assert.equal(gam.valid, true);
  assert.equal(gam.mean, 20);
  assert.equal(gam.sd, 10);

  const mcGam = simulateMonteCarlo({
    Q: 400,
    R: 120,
    days: 500,
    replications: 8,
    seed: 99,
    unitCost: 10,
    holdingRate: 20,
    orderCost: 50,
    shortageCost: 5,
    demand: { type: 'gamma', shape: 4, scale: 5 },
    leadTime: { type: 'deterministic', mean: 4 },
  });
  assert.ok(Math.abs(mcGam.avgDemand - 20) < 1.2);

  // REGRESSION: Student-t small-n CI check (replications=4 -> df=3 -> t=3.1824 vs 2.045 old bug)
  const smallMc = simulateMonteCarlo({
    Q: 100,
    R: 60,
    days: 90,
    replications: 4,
    seed: 12,
    demand: { type: 'poisson', mean: 10 },
    leadTime: { type: 'normal', mean: 4, sd: 1.5 },
  });
  const hw = (smallMc.fillRateCI95[1] - smallMc.fillRateCI95[0]) / 2;
  const expectedHw = (3.1824 * smallMc.fillRateSd) / Math.sqrt(4);
  if (smallMc.fillRateSd > 0) {
    assert.ok(Math.abs(hw - expectedHw) < 1e-3, `Expected Student-t(df=3) CI half-width ${expectedHw}, got ${hw}`);
  }

  // Monte Carlo 1/sqrt(N) SE reduction across replications
  const mc16 = simulateMonteCarlo({
    Q: 120,
    R: 45,
    days: 90,
    replications: 16,
    seed: 55,
    unitCost: 15,
    holdingRate: 25,
    orderCost: 40,
    shortageCost: 12,
    demand: { type: 'poisson', mean: 10 },
    leadTime: { type: 'normal', mean: 4, sd: 1.5 },
  });
  const mc64 = simulateMonteCarlo({
    Q: 120,
    R: 45,
    days: 90,
    replications: 64,
    seed: 55,
    unitCost: 15,
    holdingRate: 25,
    orderCost: 40,
    shortageCost: 12,
    demand: { type: 'poisson', mean: 10 },
    leadTime: { type: 'normal', mean: 4, sd: 1.5 },
  });
  const se16 = mc16.totalCostSd / Math.sqrt(16);
  const se64 = mc64.totalCostSd / Math.sqrt(64);
  assert.ok(se16 > 0 && se64 > 0);
  assert.ok(se64 < se16 * 0.7, `Expected ~2x SE shrinkage on 4x replications: se16=${se16}, se64=${se64}`);
});

test('Math [Stochastic]: Optimizer objectives, constraint enforcement, and infeasible rejection', () => {
  const baseScenario = {
    days: 90,
    unitCost: 15,
    holdingRate: 25,
    orderCost: 50,
    shortageCost: 10,
    demand: { type: 'poisson' as const, mean: 10 },
    leadTime: { type: 'deterministic' as const, mean: 4 },
  };

  const constrained = inventoryOptimizer(baseScenario, 'minCostWithService', {
    replications: 12,
    seed: 77,
    serviceLevelPct: 96,
    serviceMetric: 'fillRate',
    Qgrid: [80, 150],
    Rgrid: [10, 50, 80],
  });
  assert.equal(constrained.valid, true);
  assert.ok(constrained.best!.fillRate >= 96);

  // Impossible target on low R grid must return valid: false
  const impossible = inventoryOptimizer(baseScenario, 'minCostWithService', {
    replications: 8,
    seed: 77,
    serviceLevelPct: 99.9,
    serviceMetric: 'cycle',
    Qgrid: [20],
    Rgrid: [5, 10],
  });
  assert.equal(impossible.valid, false);
});

test('Math [Queueing]: Little Law identities, M/M/c Erlang-C, M/M/c/K bounds & M/G/1 P-K', () => {
  const mmc = queueMeckley({ lambda: 10, mu: 4, servers: 3 });
  assert.equal(mmc.valid, true);
  assert.ok(Math.abs(mmc.L - mmc.lambda * mmc.W) < 1e-9);
  assert.ok(Math.abs(mmc.Lq - mmc.lambda * mmc.Wq) < 1e-9);
  assert.ok(Math.abs(mmc.W - (mmc.Wq + 1 / 4)) < 1e-9);

  // M/M/c/K effective throughput Little Law & valid probability simplex [0, 1]
  const mmck = queueMeckley({ lambda: 12, mu: 5, servers: 2, capacity: 6 }); // unstable without finite K!
  assert.equal(mmck.valid, true);
  const sumP = mmck.pState.reduce((s, x) => s + x.p, 0);
  assert.ok(Math.abs(sumP - 1) < 1e-9);
  assert.ok(mmck.pWait >= 0 && mmck.pWait <= 1);
  assert.ok(Math.abs(mmck.L - mmck.lambdaEff * mmck.W) < 1e-9);
  assert.ok(Math.abs(mmck.Lq - mmck.lambdaEff * mmck.Wq) < 1e-9);

  // M/G/1 Pollaczek-Khinchine linearity in (1 + SCV^2)/2
  const mg0 = queueMG1({ lambda: 3, mu: 5, scv2: 0 });
  const mg1 = queueMG1({ lambda: 3, mu: 5, scv2: 1 });
  const mg2 = queueMG1({ lambda: 3, mu: 5, scv2: 2 });
  const mm1Base = queueing({ lambda: 3, mu: 5, servers: 1 });
  assert.ok(Math.abs(mg1.Wq - mm1Base.Wq) < 1e-9);
  assert.ok(Math.abs(mg0.Wq - 0.5 * mg1.Wq) < 1e-9);
  assert.ok(Math.abs(mg2.Wq - 1.5 * mg1.Wq) < 1e-9);

  // Unstable M/M/c and M/G/1 rejected cleanly
  assert.equal(queueMeckley({ lambda: 8, mu: 4, servers: 2 }).valid, false);
  assert.equal(queueMG1({ lambda: 5, mu: 5, scv2: 0.5 }).valid, false);

  // Use imported mean to verify clean usage without lint noise
  assert.equal(mean([1, 2, 3]), 2);
});
