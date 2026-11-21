/**
 * Stochastic inventory & queueing optimization engine.
 * Reuses IPE's PRNG and Normal helpers for consistent Monte Carlo results.
 */

import { eoq, inputError, mean, mulberry32, normalFrom, normInv, queueing, stdev } from './ipe';

export interface DistributionDescriptor {
  valid: boolean;
  invalid?: boolean;
  reason?: string;
  type: string;
  params: Record<string, unknown>;
  label: string;
  assumptions: string;
  mean: number;
  sd: number;
  sample: (rnd: () => number) => number;
}

export interface DemandDistributionInput {
  type?: 'normal' | 'poisson' | 'lognormal' | 'gamma' | 'empirical' | 'constant';
  mean?: number;
  sd?: number;
  meanLog?: number;
  sdLog?: number;
  shape?: number;
  scale?: number;
  samples?: number[];
  data?: number[];
}

export interface LeadTimeModelInput {
  type?: 'deterministic' | 'normal' | 'empirical' | 'lognormal' | 'gamma';
  mean?: number;
  sd?: number;
  meanLog?: number;
  sdLog?: number;
  shape?: number;
  scale?: number;
  samples?: number[];
  data?: number[];
}

function invalidDescriptor(reason: string): DistributionDescriptor {
  return {
    valid: false,
    invalid: true,
    reason,
    type: '',
    params: {},
    label: '',
    assumptions: '',
    mean: 0,
    sd: 0,
    sample: () => 0,
  };
}

function poissonFrom(rnd: () => number, mu: number): number {
  const m = Number(mu);
  if (!(m >= 0)) return 0;
  if (m < 30) {
    const L = Math.exp(-m);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rnd();
    } while (p > L);
    return k - 1;
  }
  const x = normalFrom(rnd, m, Math.sqrt(m));
  return Math.max(0, Math.round(x));
}

function bootstrapFrom(rnd: () => number, samples: number[]): number {
  if (!samples || samples.length === 0) return 0;
  return samples[Math.floor(rnd() * samples.length)];
}

function lognormalFrom(rnd: () => number, meanLog: number, sdLog: number): number {
  return Math.exp(normalFrom(rnd, meanLog, sdLog));
}

function gammaFrom(rnd: () => number, shape: number, scale: number): number {
  const s = Number(shape);
  const sc = Number(scale);
  if (!(s > 0 && sc > 0)) return 0;
  if (s < 1) {
    const a = s;
    for (let iter = 0; iter < 500; iter++) {
      const u = rnd();
      const b = (Math.E + a) / Math.E;
      const p = b * u;
      if (p > 1) {
        const x = -Math.log((b - p) / a);
        const y = -Math.log(rnd());
        if (x > y) return sc * x;
      } else {
        const x = Math.pow(p, 1 / a);
        const y = -Math.log(rnd());
        if (x > y) return sc * x;
      }
    }
    return sc * s;
  }
  const d = s - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let iter = 0; iter < 500; iter++) {
    let x = 0;
    let v = 0;
    do {
      x = normalFrom(rnd, 0, 1);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x * x * x * x) return sc * d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return sc * d * v;
  }
  return sc * s;
}

export function demandDistribution(opts: DemandDistributionInput = {}): DistributionDescriptor {
  const type = String(opts.type || 'normal').toLowerCase();
  if (type === 'normal') {
    const meanVal = Math.max(0, Number(opts.mean) || 0);
    const sdVal = Math.max(0, Number(opts.sd) || 0);
    if (!(meanVal > 0)) return invalidDescriptor('demand mean must be > 0 for normal');
    if (sdVal > meanVal * 5) {
      return invalidDescriptor(
        `normal demand sd (${sdVal}) is 5× the mean (${meanVal}) — use lognormal or gamma for highly skewed demand`
      );
    }
    return {
      valid: true,
      invalid: false,
      type: 'normal',
      params: { mean: meanVal, sd: sdVal },
      label: `Normal D(${meanVal}, ${sdVal})`,
      assumptions: `Demand each period is independent N(${meanVal}, ${sdVal}) truncated at 0.`,
      mean: meanVal,
      sd: sdVal,
      sample: (rnd) => {
        const x = sdVal > 0 ? normalFrom(rnd, meanVal, sdVal) : meanVal;
        return x > 0 ? x : 0;
      },
    };
  }
  if (type === 'poisson') {
    const mu = Math.max(0, Number(opts.mean) || 0);
    if (!(mu > 0)) return invalidDescriptor('Poisson mean must be > 0');
    return {
      valid: true,
      invalid: false,
      type: 'poisson',
      params: { mean: mu },
      label: `Poisson P(${mu})`,
      assumptions: `Count demand each period is independent Poisson(${mu}).`,
      mean: mu,
      sd: Math.sqrt(mu),
      sample: (rnd) => poissonFrom(rnd, mu),
    };
  }
  if (type === 'lognormal') {
    const ml = Number(opts.meanLog);
    const sl = Number(opts.sdLog);
    if (!Number.isFinite(ml) || !Number.isFinite(sl) || sl <= 0) {
      return invalidDescriptor('lognormal requires meanLog and sdLog > 0');
    }
    const trueMean = Math.exp(ml + (sl * sl) / 2);
    return {
      valid: true,
      invalid: false,
      type: 'lognormal',
      params: { meanLog: ml, sdLog: sl, trueMean },
      label: `Lognormal LN(${ml}, ${sl})`,
      assumptions: `Positive skewed demand LN(${ml}, ${sl}), arithmetic mean ${trueMean.toFixed(2)}.`,
      mean: trueMean,
      sd: Math.sqrt((Math.exp(sl * sl) - 1) * Math.exp(2 * ml + sl * sl)),
      sample: (rnd) => lognormalFrom(rnd, ml, sl),
    };
  }
  if (type === 'gamma') {
    const shape = Number(opts.shape);
    const scale = Number(opts.scale);
    if (!(shape > 0 && scale > 0)) return invalidDescriptor('gamma requires shape > 0 and scale > 0');
    const trueMean = shape * scale;
    return {
      valid: true,
      invalid: false,
      type: 'gamma',
      params: { shape, scale, trueMean },
      label: `Gamma Γ(${shape}, ${scale})`,
      assumptions: `Positive skewed Gamma(${shape}, ${scale}) demand, mean ${trueMean.toFixed(2)}.`,
      mean: trueMean,
      sd: Math.sqrt(shape * scale * scale),
      sample: (rnd) => gammaFrom(rnd, shape, scale),
    };
  }
  if (type === 'empirical') {
    const raw = Array.isArray(opts.samples) ? opts.samples : Array.isArray(opts.data) ? opts.data : [];
    const clean = raw.map(Number).filter((v) => Number.isFinite(v) && v >= 0);
    if (!clean.length) return invalidDescriptor('empirical demand requires non-empty non-negative samples');
    const m = mean(clean);
    const s = stdev(clean);
    return {
      valid: true,
      invalid: false,
      type: 'empirical',
      params: { samples: clean },
      label: `Empirical (n=${clean.length}, mean=${m.toFixed(2)})`,
      assumptions: `Demand is bootstrapped from ${clean.length} observed historical periods.`,
      mean: m,
      sd: s,
      sample: (rnd) => bootstrapFrom(rnd, clean),
    };
  }
  if (type === 'constant') {
    const v = Math.max(0, Number(opts.mean) || 0);
    if (!(v > 0)) return invalidDescriptor('constant demand must be > 0');
    return {
      valid: true,
      invalid: false,
      type: 'constant',
      params: { value: v },
      label: `Constant D=${v}`,
      assumptions: 'Deterministic demand each period.',
      mean: v,
      sd: 0,
      sample: () => v,
    };
  }
  return invalidDescriptor(`unknown demand distribution "${type}"`);
}

export function leadTimeModel(opts: LeadTimeModelInput = {}): DistributionDescriptor {
  const type = String(opts.type || 'deterministic').toLowerCase();
  if (type === 'deterministic') {
    const L = Math.max(0, Math.round(Number(opts.mean) || 0));
    return {
      valid: true,
      invalid: false,
      type: 'deterministic',
      params: { mean: L },
      label: `Deterministic L=${L}`,
      assumptions: `Lead time is fixed at ${L} periods.`,
      mean: L,
      sd: 0,
      sample: () => L,
    };
  }
  if (type === 'normal') {
    const lm = Math.max(0, Number(opts.mean) || 0);
    const ls = Math.max(0, Number(opts.sd) || 0);
    return {
      valid: true,
      invalid: false,
      type: 'normal',
      params: { mean: lm, sd: ls },
      label: `Normal L(${lm}, ${ls})`,
      assumptions: `Lead time is N(${lm}, ${ls}) rounded to whole periods and floored at 0.`,
      mean: lm,
      sd: ls,
      sample: (rnd) => Math.max(0, Math.round(ls > 0 ? normalFrom(rnd, lm, ls) : lm)),
    };
  }
  if (type === 'empirical') {
    const raw = Array.isArray(opts.samples) ? opts.samples : Array.isArray(opts.data) ? opts.data : [];
    const clean = raw.map(Number).filter((v) => Number.isFinite(v) && v >= 0);
    if (!clean.length) return invalidDescriptor('empirical lead time requires non-empty samples');
    const lm = mean(clean);
    const ls = stdev(clean);
    return {
      valid: true,
      invalid: false,
      type: 'empirical',
      params: { samples: clean },
      label: `Empirical (n=${clean.length}, mean=${lm.toFixed(2)})`,
      assumptions: `Lead time is bootstrapped from ${clean.length} historical deliveries.`,
      mean: lm,
      sd: ls,
      sample: (rnd) => bootstrapFrom(rnd, clean),
    };
  }
  if (type === 'lognormal') {
    const ml = Number(opts.meanLog);
    const sl = Number(opts.sdLog);
    if (!Number.isFinite(ml) || !Number.isFinite(sl) || sl <= 0) {
      return invalidDescriptor('lognormal lead time requires meanLog and sdLog > 0');
    }
    const trueMean = Math.exp(ml + (sl * sl) / 2);
    return {
      valid: true,
      invalid: false,
      type: 'lognormal',
      params: { meanLog: ml, sdLog: sl, trueMean },
      label: `Lognormal L(${ml}, ${sl})`,
      assumptions: `Right-tailed Lognormal lead time rounded to whole periods.`,
      mean: trueMean,
      sd: Math.sqrt((Math.exp(sl * sl) - 1) * Math.exp(2 * ml + sl * sl)),
      sample: (rnd) => Math.max(0, Math.round(lognormalFrom(rnd, ml, sl))),
    };
  }
  if (type === 'gamma') {
    const shape = Number(opts.shape);
    const scale = Number(opts.scale);
    if (!(shape > 0 && scale > 0)) return invalidDescriptor('gamma lead time requires shape > 0 and scale > 0');
    const trueMean = shape * scale;
    return {
      valid: true,
      invalid: false,
      type: 'gamma',
      params: { shape, scale, trueMean },
      label: `Gamma L(${shape}, ${scale})`,
      assumptions: `Gamma(${shape}, ${scale}) lead time rounded to whole periods.`,
      mean: trueMean,
      sd: Math.sqrt(shape * scale * scale),
      sample: (rnd) => Math.max(0, Math.round(gammaFrom(rnd, shape, scale))),
    };
  }
  return invalidDescriptor(`unknown lead time model "${type}"`);
}

export interface MonteCarloOptions {
  Q: number;
  R: number;
  days?: number;
  unitCost?: number;
  holdingRate?: number;
  orderCost?: number;
  shortageCost?: number;
  lostSales?: boolean;
  replications?: number;
  seed?: number;
  initialStock?: number | null;
  demand?: DemandDistributionInput;
  leadTime?: LeadTimeModelInput;
}

export interface MonteCarloResult {
  valid: boolean;
  reason: string;
  days: number;
  replications: number;
  Q: number;
  R: number;
  initial: number;
  demandDist: DistributionDescriptor;
  leadTimeModel: DistributionDescriptor;
  effectiveDemandMean: number;
  effectiveDemandSd: number;
  fillRate: number;
  fillRateSd: number;
  fillRateMin: number;
  fillRateMax: number;
  fillRateCI95: [number, number];
  periodService: number;
  cycleService: number;
  cycleServiceSd: number;
  stockoutDays: number;
  stockoutDaysSd: number;
  orders: number;
  ordersSd: number;
  avgInventory: number;
  avgInventorySd: number;
  avgBacklog: number;
  avgBacklogSd: number;
  avgDemand: number;
  avgDemandSd: number;
  holdingCost: number;
  orderingCost: number;
  shortageCost: number;
  totalCost: number;
  holdingCostSd: number;
  orderingCostSd: number;
  shortageCostSd: number;
  totalCostSd: number;
  costBreakdown: { holding: number; ordering: number; shortage: number };
  series: { stock: number[]; backlog: number[]; demand: number[] };
  runFillRates: number[];
  runTotalCosts: number[];
  runOrderCounts: number[];
  avgOrdersInPipeline: number;
  truncationWarning: string | null;
  label?: string;
  policyQ?: number;
  policyR?: number;
}

export function simulateMonteCarlo(opts: MonteCarloOptions): MonteCarloResult {
  const Q = Number(opts.Q) || 0;
  const R = Number(opts.R) || 0;
  const days = Math.max(1, Math.min(3650, Math.round(Number(opts.days) || 365)));
  const C = Math.max(0, Number(opts.unitCost) || 0);
  const holdPct = Math.max(0, Number(opts.holdingRate) || 0);
  const S = Math.max(0, Number(opts.orderCost) || 0);
  const shortageCost = Math.max(0, Number(opts.shortageCost) || 0);
  const lostSales = !!opts.lostSales;
  const reps = Math.max(1, Math.min(2000, Math.round(Number(opts.replications) || 100)));
  const seed = Number.isFinite(Number(opts.seed)) ? Number(opts.seed) >>> 0 : 42;
  const initial =
    opts.initialStock == null ? Math.max(0, Math.round(R + Q / 2)) : Math.max(0, Number(opts.initialStock) || 0);

  const dd = demandDistribution(opts.demand);
  const lt = leadTimeModel(opts.leadTime);
  const H_d = (C * holdPct) / 100 / 365;

  const blank = (reason: string): MonteCarloResult => ({
    valid: false,
    reason,
    days,
    replications: reps,
    Q,
    R,
    initial,
    demandDist: dd,
    leadTimeModel: lt,
    effectiveDemandMean: 0,
    effectiveDemandSd: 0,
    fillRate: 0,
    fillRateSd: 0,
    fillRateMin: 0,
    fillRateMax: 0,
    fillRateCI95: [0, 0],
    periodService: 0,
    cycleService: 0,
    cycleServiceSd: 0,
    stockoutDays: 0,
    stockoutDaysSd: 0,
    orders: 0,
    ordersSd: 0,
    avgInventory: 0,
    avgInventorySd: 0,
    avgBacklog: 0,
    avgBacklogSd: 0,
    avgDemand: 0,
    avgDemandSd: 0,
    holdingCost: 0,
    orderingCost: 0,
    shortageCost: 0,
    totalCost: 0,
    holdingCostSd: 0,
    orderingCostSd: 0,
    shortageCostSd: 0,
    totalCostSd: 0,
    costBreakdown: { holding: 0, ordering: 0, shortage: 0 },
    series: { stock: [], backlog: [], demand: [] },
    runFillRates: [],
    runTotalCosts: [],
    runOrderCounts: [],
    avgOrdersInPipeline: 0,
    truncationWarning: null,
  });

  const err = inputError({ Q: opts.Q, R: opts.R }, { Q: 'order quantity Q', R: 'reorder point R' });
  if (err) return blank(err);
  if (!(Q > 0)) return blank('order quantity Q must be greater than 0');
  if (!dd.valid) return blank(`demand: ${dd.reason}`);
  if (!lt.valid) return blank(`lead time: ${lt.reason}`);
  if (!(dd.mean > 0)) return blank('mean demand must be greater than 0');

  const truncationWarning =
    dd.type === 'normal' && dd.sd > 0 && dd.sd / dd.mean > 0.35
      ? `Normal demand CV (${(dd.sd / dd.mean).toFixed(2)}) > 0.35 — clamping negatives at 0 shifts realized mean upward; consider Gamma or Lognormal.`
      : null;

  const fills: number[] = [];
  const periods: number[] = [];
  const cycles: number[] = [];
  const invs: number[] = [];
  const backs: number[] = [];
  const dems: number[] = [];
  const sodCounts: number[] = [];
  const ordCounts: number[] = [];
  const pipeAvgs: number[] = [];
  const holdCosts: number[] = [];
  const ordCosts: number[] = [];
  const shortCosts: number[] = [];
  const totals: number[] = [];
  let series: { stock: number[]; backlog: number[]; demand: number[] } = { stock: [], backlog: [], demand: [] };

  for (let rep = 0; rep < reps; rep++) {
    const rnd = mulberry32((seed + Math.imul(rep + 1, 0x9e3779b1)) >>> 0);
    let stock = initial;
    let backlog = 0;
    const pipe: Array<{ due: number; qty: number }> = [];
    let demandTotal = 0;
    let lostUnits = 0;
    let stockoutDays = 0;
    let orders = 0;
    let pipeSum = 0;
    let stockSum = 0;
    let backSum = 0;
    let demandSum = 0;
    let holdSum = 0;
    let shortSum = 0;
    let orderSum = 0;
    let cycleCount = 0;
    let failedCycles = 0;
    let cycleFailed = false;
    const sStock: number[] = [];
    const sBacklog: number[] = [];
    const sDemand: number[] = [];

    for (let day = 0; day < days; day++) {
      for (let k = pipe.length - 1; k >= 0; k--) {
        if (pipe[k].due <= day) {
          stock += pipe[k].qty;
          pipe.splice(k, 1);
        }
      }
      if (backlog > 0 && stock > 0) {
        const s = Math.min(stock, backlog);
        stock -= s;
        backlog -= s;
      }
      const d = dd.sample(rnd);
      demandTotal += d;
      demandSum += d;
      const served = Math.min(stock, d);
      stock -= served;
      const unserved = d - served;
      if (lostSales) lostUnits += unserved;
      else backlog += unserved;

      let onOrder = pipe.reduce((a, p) => a + p.qty, 0);
      let ordersToday = 0;
      while (stock - backlog + onOrder <= R && ordersToday < 20) {
        const L = lt.sample(rnd);
        pipe.push({ due: day + L, qty: Q });
        onOrder += Q;
        orders++;
        ordersToday++;
        orderSum += S;
        if (cycleCount > 0 && cycleFailed) failedCycles++;
        cycleCount++;
        cycleFailed = false;
      }

      pipeSum += pipe.length;
      holdSum += stock * H_d;
      shortSum += backlog * shortageCost;
      stockSum += stock;
      backSum += backlog;
      if (unserved > 0) stockoutDays++;
      if (unserved > 0 || backlog > 0) cycleFailed = true;
      sStock.push(stock);
      sBacklog.push(backlog);
      sDemand.push(d);
    }
    if (cycleCount > 0 && cycleFailed) failedCycles++;

    const unservedEnd = Math.max(0, backlog) + lostUnits;
    fills.push(demandTotal > 0 ? Math.max(0, (demandTotal - unservedEnd) / demandTotal) : 1);
    periods.push(1 - stockoutDays / days);
    sodCounts.push(stockoutDays);
    cycles.push(cycleCount ? 1 - failedCycles / cycleCount : 1);
    invs.push(stockSum / days);
    backs.push(backSum / days);
    dems.push(demandSum / days);
    ordCounts.push(orders);
    pipeAvgs.push(pipeSum / days);
    holdCosts.push(holdSum);
    ordCosts.push(orderSum);
    shortCosts.push(shortSum);
    totals.push(holdSum + orderSum + shortSum);
    if (rep === 0) series = { stock: sStock, backlog: sBacklog, demand: sDemand };
  }

  const effMean = mean(series.demand);
  const effSd = stdev(series.demand);
  const T_975: Record<number, number> = {
    1: 12.7062, 2: 4.3027, 3: 3.1824, 4: 2.7764, 5: 2.5706,
    6: 2.4469, 7: 2.3646, 8: 2.3060, 9: 2.2622, 10: 2.2281,
    11: 2.2010, 12: 2.1788, 13: 2.1604, 14: 2.1448, 15: 2.1314,
    16: 2.1199, 17: 2.1098, 18: 2.1009, 19: 2.0930, 20: 2.0860,
    21: 2.0796, 22: 2.0739, 23: 2.0687, 24: 2.0639, 25: 2.0595,
    26: 2.0555, 27: 2.0518, 28: 2.0484, 29: 2.0452,
  };
  const ci95 = (arr: number[]): [number, number] => {
    if (arr.length < 2) return [mean(arr), mean(arr)];
    const m = mean(arr);
    const s = stdev(arr);
    const df = arr.length - 1;
    const t = df < 30 ? (T_975[df] ?? 2.0452) : 1.96;
    return [m - (t * s) / Math.sqrt(arr.length), m + (t * s) / Math.sqrt(arr.length)];
  };

  return {
    valid: true,
    reason: '',
    days,
    replications: reps,
    Q,
    R,
    initial,
    demandDist: dd,
    leadTimeModel: lt,
    effectiveDemandMean: effMean,
    effectiveDemandSd: effSd,
    fillRate: mean(fills) * 100,
    fillRateSd: stdev(fills) * 100,
    fillRateMin: Math.min(...fills) * 100,
    fillRateMax: Math.max(...fills) * 100,
    fillRateCI95: ci95(fills.map((v) => v * 100)),
    periodService: mean(periods) * 100,
    cycleService: mean(cycles) * 100,
    cycleServiceSd: stdev(cycles) * 100,
    stockoutDays: mean(sodCounts),
    stockoutDaysSd: stdev(sodCounts),
    orders: mean(ordCounts),
    ordersSd: stdev(ordCounts),
    avgInventory: mean(invs),
    avgInventorySd: stdev(invs),
    avgBacklog: mean(backs),
    avgBacklogSd: stdev(backs),
    avgDemand: mean(dems),
    avgDemandSd: stdev(dems),
    holdingCost: mean(holdCosts),
    holdingCostSd: stdev(holdCosts),
    orderingCost: mean(ordCosts),
    orderingCostSd: stdev(ordCosts),
    shortageCost: mean(shortCosts),
    shortageCostSd: stdev(shortCosts),
    totalCost: mean(totals),
    totalCostSd: stdev(totals),
    costBreakdown: {
      holding: mean(holdCosts),
      ordering: mean(ordCosts),
      shortage: mean(shortCosts),
    },
    series,
    runFillRates: fills,
    runTotalCosts: totals,
    runOrderCounts: ordCounts,
    avgOrdersInPipeline: mean(pipeAvgs),
    truncationWarning,
  };
}

export function inventoryOptimizer(
  scenario: Omit<MonteCarloOptions, 'Q' | 'R'>,
  objective: 'minCost' | 'maxFillRate' | 'minCostWithService' = 'minCost',
  options: {
    serviceLevelPct?: number;
    serviceMetric?: 'period' | 'cycle' | 'fillRate';
    Qgrid?: number[];
    Rgrid?: number[];
    replications?: number;
    seed?: number;
  } = {}
) {
  const reps = Math.max(1, Math.min(500, Math.round(Number(options.replications) || 50)));
  const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) >>> 0 : 42;
  const sl = Math.max(0, Math.min(100, Number(options.serviceLevelPct) || 95));
  const sm = options.serviceMetric || 'fillRate';

  const dd = demandDistribution(scenario.demand);
  const ltm = leadTimeModel(scenario.leadTime);
  const dMean = dd.valid ? dd.mean : 0;
  const dSd = dd.valid ? dd.sd : 0;
  const lt = ltm.valid ? ltm.mean : 0;

  const eoqRes = eoq({
    annualDemand: dMean * 365,
    orderCost: Number(scenario.orderCost) || 0,
    unitCost: Number(scenario.unitCost) || 0,
    holdingRate: Number(scenario.holdingRate) || 0,
  });
  const Q0 = eoqRes.valid && eoqRes.Q > 0 ? Math.round(eoqRes.Q) : Math.max(1, Math.round(dMean * 10));
  const z = sl > 0 && sl < 100 ? normInv(sl / 100) : 1.6449;
  const baseROP = Math.max(1, Math.round(dMean * lt + (Number.isFinite(z) ? z : 1.64) * dSd * Math.sqrt(Math.max(1, lt))));

  const qStep = Math.max(1, Math.round(Q0 / 4));
  const Qgrid =
    options.Qgrid && options.Qgrid.length
      ? options.Qgrid
      : [Math.max(1, Q0 - 2 * qStep), Math.max(1, Q0 - qStep), Q0, Q0 + qStep, Q0 + 2 * qStep];
  const rStep = Math.max(1, Math.round(baseROP / 5));
  const Rgrid =
    options.Rgrid && options.Rgrid.length
      ? options.Rgrid
      : [Math.max(0, baseROP - 2 * rStep), Math.max(0, baseROP - rStep), baseROP, baseROP + rStep, baseROP + 2 * rStep];

  const grid: MonteCarloResult[] = [];
  for (const q of [...new Set(Qgrid)]) {
    for (const r of [...new Set(Rgrid)]) {
      grid.push(simulateMonteCarlo({ ...scenario, Q: q, R: r, replications: reps, seed }));
    }
  }

  const valid = grid.filter((g) => g.valid);
  if (!valid.length) {
    return { valid: false, reason: 'No valid policy in grid', objective, grid, best: null, equivalentCount: 0 };
  }

  let best: MonteCarloResult | null = null;
  if (objective === 'minCost') {
    best = valid.reduce((a, b) => (a.totalCost <= b.totalCost ? a : b));
  } else if (objective === 'maxFillRate') {
    best = valid.reduce((a, b) => (a.fillRate >= b.fillRate ? a : b));
  } else {
    const feasible = valid.filter((g) => {
      const m = sm === 'cycle' ? g.cycleService : sm === 'fillRate' ? g.fillRate : g.periodService;
      return m >= sl;
    });
    if (!feasible.length) {
      return {
        valid: false,
        reason: `No (Q, R) grid candidate meets the ${sl}% ${sm} service target.`,
        objective,
        grid,
        best: null,
        equivalentCount: 0,
      };
    }
    best = feasible.reduce((a, b) => (a.totalCost <= b.totalCost ? a : b));
  }

  const metricKey = objective === 'maxFillRate' ? 'fillRate' : 'totalCost';
  const metricSdKey = objective === 'maxFillRate' ? 'fillRateSd' : 'totalCostSd';
  const halfWidth = ((best[metricSdKey] || 0) * 1.96) / Math.sqrt(reps);
  const bLo = best[metricKey] - halfWidth;
  const bHi = best[metricKey] + halfWidth;
  const equiv = valid.filter((g) => {
    if (g === best) return false;
    const hw = ((g[metricSdKey] || 0) * 1.96) / Math.sqrt(reps);
    return g[metricKey] - hw <= bHi && g[metricKey] + hw >= bLo;
  });

  return {
    valid: true,
    reason: '',
    objective,
    grid,
    best,
    equivalentCount: equiv.length,
    reps,
  };
}

export interface ExtendedQueueResult {
  valid: boolean;
  reason: string;
  lambda: number;
  mu: number;
  servers: number;
  capacity: number | string;
  rho: number;
  rhoPct: number;
  model: string;
  p0: number;
  pBlock: number;
  pWait: number;
  Lq: number;
  Wq: number;
  L: number;
  W: number;
  lambdaEff: number;
  utilPct: number;
  pState: Array<{ n: number; p: number }>;
  assumptions?: string;
}

export function queueMeckley({
  lambda,
  mu,
  servers = 1,
  capacity = Infinity,
}: {
  lambda: number;
  mu: number;
  servers?: number;
  capacity?: number;
}): ExtendedQueueResult {
  const l = Number(lambda) || 0;
  const m = Number(mu) || 0;
  const c = Math.max(1, Math.min(50, Math.round(Number(servers) || 1)));
  const K = Number.isFinite(Number(capacity)) ? Math.max(c, Math.min(2000, Math.round(Number(capacity)))) : Infinity;

  const unstable = (reason: string): ExtendedQueueResult => ({
    valid: false,
    reason,
    lambda: l,
    mu: m,
    servers: c,
    capacity: K === Infinity ? '∞' : K,
    rho: m > 0 ? l / (c * m) : 0,
    rhoPct: m > 0 ? (l / (c * m)) * 100 : 0,
    model: K === Infinity ? 'M/M/c' : `M/M/${c}/${K}`,
    p0: 0,
    pBlock: 0,
    pWait: 0,
    Lq: Infinity,
    Wq: Infinity,
    L: Infinity,
    W: Infinity,
    lambdaEff: 0,
    utilPct: 0,
    pState: [],
  });

  if (!(l > 0)) return unstable('arrival rate λ must be > 0');
  if (!(m > 0)) return unstable('service rate μ must be > 0');

  const a = l / m;
  const rho = a / c;

  if (K === Infinity) {
    if (l >= c * m) return unstable(`M/M/c unstable — λ (${l}) must be < c·μ (${c * m})`);
    let sum = 0;
    let fk = 1;
    for (let k = 0; k < c; k++) {
      if (k > 0) fk *= k;
      sum += Math.pow(a, k) / fk;
    }
    fk *= c;
    const term = Math.pow(a, c) / (fk * (1 - rho));
    const p0 = 1 / (sum + term);
    if (!Number.isFinite(p0) || !(p0 > 0)) return unstable('numerical overflow computing P₀');
    const pWait = term * p0;
    const Lq = (pWait * rho) / (1 - rho);
    const Wq = Lq / l;
    const L = Lq + a;
    const W = L / l;
    return {
      valid: true,
      reason: '',
      lambda: l,
      mu: m,
      servers: c,
      capacity: '∞ (M/M/c)',
      rho,
      rhoPct: rho * 100,
      model: c === 1 ? 'M/M/1' : `M/M/${c}`,
      p0,
      pWait,
      Lq,
      Wq,
      L,
      W,
      lambdaEff: l,
      utilPct: rho * 100,
      pBlock: 0,
      pState: [],
    };
  }

  const p = new Array<number>(K + 1);
  p[0] = 1;
  for (let n = 1; n <= K; n++) {
    const serviceRate = n < c ? n * m : c * m;
    p[n] = (p[n - 1] * l) / serviceRate;
  }
  const Z = p.reduce((s, v) => s + v, 0);
  if (!Number.isFinite(Z) || Z <= 0) return unstable('numerical overflow for M/M/c/K');
  for (let n = 0; n <= K; n++) p[n] /= Z;
  const p0ff = p[0];
  const pBlock = p[K];
  const lambdaEff = l * (1 - pBlock);
  let L = 0;
  for (let n = 0; n <= K; n++) L += n * p[n];
  const Lq = Math.max(0, L - lambdaEff / m);
  const W = lambdaEff > 0 ? L / lambdaEff : 0;
  const Wq = lambdaEff > 0 ? Lq / lambdaEff : 0;
  const utilPct = (lambdaEff / (c * m)) * 100;

  const pWaitFinite = p.slice(c).reduce((s, v) => s + v, 0);
  return {
    valid: true,
    reason: '',
    lambda: l,
    mu: m,
    servers: c,
    capacity: K,
    rho,
    rhoPct: rho * 100,
    model: `M/M/${c}/${K}`,
    p0: p0ff,
    pBlock,
    pWait: pWaitFinite,
    Lq,
    Wq,
    L,
    W,
    lambdaEff,
    utilPct,
    pState: p.map((v, n) => ({ n, p: v })),
  };
}

export function queueMG1({
  lambda,
  mu,
  scv2 = 1,
}: {
  lambda: number;
  mu: number;
  scv2?: number;
}): ExtendedQueueResult {
  const l = Number(lambda) || 0;
  const m = Number(mu) || 0;
  const s2 = Number(scv2);

  const invalidP = (reason: string): ExtendedQueueResult => ({
    valid: false,
    reason,
    lambda: l,
    mu: m,
    servers: 1,
    capacity: '∞ (M/G/1)',
    rho: m > 0 ? l / m : 0,
    rhoPct: m > 0 ? (l / m) * 100 : 0,
    model: 'M/G/1',
    p0: 0,
    pBlock: 0,
    pWait: 0,
    Lq: Infinity,
    Wq: Infinity,
    L: Infinity,
    W: Infinity,
    lambdaEff: 0,
    utilPct: 0,
    pState: [],
  });

  if (!(l > 0)) return invalidP('arrival rate λ must be > 0');
  if (!(m > 0)) return invalidP('service rate μ must be > 0');
  if (!Number.isFinite(s2) || s2 < 0) return invalidP('SCV² must be >= 0');
  if (l >= m) return invalidP(`M/G/1 unstable — λ (${l}) must be < μ (${m})`);

  const meanS = 1 / m;
  const varS = s2 * meanS * meanS;
  const rho = l / m;
  const Lq = (l * l * varS + rho * rho) / (2 * (1 - rho));
  const Wq = Lq / l;
  const L = Lq + rho;
  const W = L / l;

  return {
    valid: true,
    reason: '',
    lambda: l,
    mu: m,
    servers: 1,
    capacity: '∞ (M/G/1)',
    rho,
    rhoPct: rho * 100,
    model: 'M/G/1 (Pollaczek–Khinchine)',
    p0: 1 - rho,
    pBlock: 0,
    pWait: rho,
    Lq,
    Wq,
    L,
    W,
    lambdaEff: l,
    utilPct: rho * 100,
    pState: [],
    assumptions: `Poisson arrivals, single FIFO server, general service time (SCV² = ${s2}).`,
  };
}

export function queueCurveExtended({
  mu,
  servers = 1,
  capacity = Infinity,
  scv2,
  rhoMin = 0.05,
  rhoMax = 0.95,
  steps = 36,
}: {
  mu: number;
  servers?: number;
  capacity?: number;
  scv2?: number;
  rhoMin?: number;
  rhoMax?: number;
  steps?: number;
}) {
  const m = Number(mu) || 0;
  if (!(m > 0)) return [];
  const c = Math.max(1, Math.round(Number(servers) || 1));
  const n = Math.max(2, Math.min(200, Math.round(Number(steps) || 36)));
  const lo = Math.max(0.01, Number(rhoMin) || 0.05);
  const hi = Number(rhoMax) || 0.95;
  const K = Number.isFinite(Number(capacity)) ? Math.round(Number(capacity)) : Infinity;
  const out: Array<{ rho: number; wq: number; lq: number; pBlock: number; valid: boolean }> = [];

  for (let i = 0; i < n; i++) {
    const rho = lo + (Math.min(hi, 0.99) - lo) * (i / (n - 1));
    const lam = rho * c * m;
    let r: ExtendedQueueResult | ReturnType<typeof queueing>;
    if (K === Infinity) {
      r =
        c === 1 && scv2 != null && Number.isFinite(scv2)
          ? queueMG1({ lambda: lam, mu: m, scv2 })
          : queueing({ lambda: lam, mu: m, servers: c });
    } else {
      r = queueMeckley({ lambda: lam, mu: m, servers: c, capacity: K });
    }
    if (r && r.valid) {
      out.push({
        rho: rho * 100,
        wq: r.Wq,
        lq: r.Lq,
        pBlock: 'pBlock' in r ? r.pBlock : 0,
        valid: true,
      });
    }
  }
  return out;
}
