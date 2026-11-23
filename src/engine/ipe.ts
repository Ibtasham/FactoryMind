/**
 * Core Industrial & Production Engineering mathematical engine.
 * Pure TypeScript, zero DOM dependencies.
 */

export const DAYS_PER_MONTH = 30.4375;

export function sum(a: ReadonlyArray<number>): number {
  return a.reduce((s, v) => s + (Number(v) || 0), 0);
}

export function mean(a: ReadonlyArray<number>): number {
  return a.length ? sum(a) / a.length : 0;
}

export function stdev(a: ReadonlyArray<number>): number {
  if (!a || a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((v) => (v - m) * (v - m))) / (a.length - 1));
}

export function cappedProduct(a: number, b: number): number {
  const p = a * b;
  return Number.isFinite(p) ? p : Number.MAX_VALUE;
}

export function inputError(
  obj: Record<string, unknown> | undefined | null,
  labels: Record<string, string>
): string {
  for (const key of Object.keys(labels)) {
    const v = obj ? obj[key] : undefined;
    if (v == null || v === '') continue;
    const num = Number(v);
    if (!Number.isFinite(num)) return `${labels[key]} must be a finite number (got ${String(v)})`;
    if (num < 0) return `${labels[key]} must not be negative (got ${num})`;
  }
  return '';
}

export function ceil2dp(x: number): number {
  const scaled = x * 100;
  const nearest = Math.round(scaled);
  return (Math.abs(scaled - nearest) < 1e-9 ? nearest : Math.ceil(scaled)) / 100;
}

/* ---------- Normal Distribution & PRNG ---------- */

export const Z_TABLE: ReadonlyArray<readonly [number, number]> = [
  [80, 0.8416],
  [85, 1.0364],
  [90, 1.2816],
  [92, 1.4051],
  [94, 1.5548],
  [95, 1.6449],
  [96, 1.7507],
  [97, 1.8808],
  [97.5, 1.96],
  [98, 2.0537],
  [99, 2.3263],
  [99.5, 2.5758],
];

const SQRT2PI = Math.sqrt(2 * Math.PI);
const SQRT_PI = Math.sqrt(Math.PI);

export function normPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / SQRT2PI;
}

export function erfc(x: number): number {
  if (x === 0) return 1;
  const a = Math.abs(x);
  let v: number;
  if (a <= 2) {
    let term = a;
    let s = a;
    for (let k = 1; k < 200; k++) {
      term *= (-a * a) / k;
      const add = term / (2 * k + 1);
      s += add;
      if (Math.abs(add) < Math.abs(s) * 1e-18) break;
    }
    v = 1 - (2 / SQRT_PI) * s;
  } else {
    let g = a;
    for (let k = 200; k >= 1; k--) g = a + k / 2 / g;
    v = Math.exp(-a * a) / SQRT_PI / g;
  }
  return x >= 0 ? v : 2 - v;
}

export function normCdf(z: number): number {
  if (z == null || Number.isNaN(z)) return NaN;
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  return 0.5 * erfc(-z / Math.SQRT2);
}

export function normSf(z: number): number {
  if (z == null || Number.isNaN(z)) return NaN;
  if (!Number.isFinite(z)) return z > 0 ? 0 : 1;
  return 0.5 * erfc(z / Math.SQRT2);
}

export function normInv(p: number): number {
  if (!(p > 0)) return -Infinity;
  if (!(p < 1)) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416,
  ];
  const pl = 0.02425;
  let q: number;
  let r: number;
  let z: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    z =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    q = p - 0.5;
    r = q * q;
    z =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    z =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  for (let i = 0; i < 3; i++) {
    const dens = normPdf(z);
    if (!(dens > 1e-300)) break;
    const step = (normCdf(z) - p) / dens;
    z -= step;
    if (!Number.isFinite(z)) break;
    if (Math.abs(step) < 1e-16 * (1 + Math.abs(z))) break;
  }
  return z;
}

export function normLoss(z: number): number {
  return normPdf(z) - z * normSf(z);
}

export function zFor(serviceLevel: number): number {
  const sl = Number(serviceLevel);
  if (!Number.isFinite(sl) || !(sl > 0) || !(sl < 100)) return NaN;
  for (const [t, z] of Z_TABLE) if (Math.abs(sl - t) < 1e-9) return z;
  return normInv(sl / 100);
}

export function mulberry32(seed: number): () => number {
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalFrom(rnd: () => number, meanVal = 0, sd = 1): number {
  let u = 0;
  while (u === 0) u = rnd();
  const v = rnd();
  const r = Math.sqrt(-2 * Math.log(u));
  return meanVal + sd * r * Math.cos(2 * Math.PI * v);
}

/* ---------- EOQ / EPQ / Quantity Discounts ---------- */

export function holdingCostPerUnit(unitCost: number, holdingRatePct: number): number {
  return unitCost * (holdingRatePct / 100);
}

export interface EoqInput {
  annualDemand?: number;
  orderCost?: number;
  unitCost?: number;
  holdingRate?: number;
}

export interface EoqResult {
  valid: boolean;
  reason: string;
  Q: number;
  H: number;
  ordersPerYear: number;
  cycleDays: number;
  purchaseCost: number;
  orderingCost: number;
  holdingCost: number;
  variableCost: number;
  totalCost: number;
}

export function eoq({ annualDemand, orderCost, unitCost, holdingRate }: EoqInput = {}): EoqResult {
  const inputs = { annualDemand, orderCost, unitCost, holdingRate };
  const typeErr = inputError(inputs, {
    annualDemand: 'annual demand',
    orderCost: 'order cost',
    unitCost: 'unit cost',
    holdingRate: 'holding rate (%)',
  });
  const D = Number(annualDemand) || 0;
  const S = Number(orderCost) || 0;
  const C = Number(unitCost) || 0;
  const H = holdingCostPerUnit(C, Number(holdingRate) || 0);
  let reason = typeErr;
  if (!reason && !(D > 0)) reason = 'annual demand must be greater than 0';
  else if (!reason && !(S > 0)) reason = 'order (setup) cost must be greater than 0';
  else if (!reason && !(H > 0))
    reason = 'holding cost per unit must be greater than 0 — check unit cost and holding rate';
  const valid = !reason;
  const Q = valid ? Math.sqrt((2 * D * S) / H) : 0;
  const ordersPerYear = valid ? D / Q : 0;
  const cycleDays = valid ? 365 / ordersPerYear : 0;
  const purchaseCost = D * C;
  const orderingCost = ordersPerYear * S;
  const holdingCostYr = (Q / 2) * H;
  const variableCost = orderingCost + holdingCostYr;
  return {
    valid,
    reason,
    Q,
    H,
    ordersPerYear,
    cycleDays,
    purchaseCost,
    orderingCost,
    holdingCost: holdingCostYr,
    variableCost,
    totalCost: purchaseCost + variableCost,
  };
}

export function totalCostAtQ(
  Q: number,
  { annualDemand, orderCost, unitCost, holdingRate }: EoqInput = {}
): { ordering: number; holding: number; variable: number; purchase: number } {
  const D = Number(annualDemand) || 0;
  const S = Number(orderCost) || 0;
  const H = holdingCostPerUnit(Number(unitCost) || 0, Number(holdingRate) || 0);
  if (!(Q > 0) || !(D > 0)) {
    return { ordering: 0, holding: 0, variable: 0, purchase: D * (Number(unitCost) || 0) };
  }
  const ordering = (D / Q) * S;
  const holding = (Q / 2) * H;
  return { ordering, holding, variable: ordering + holding, purchase: D * (Number(unitCost) || 0) };
}

export interface EpqInput {
  annualDemand?: number;
  setupCost?: number;
  unitCost?: number;
  holdingRate?: number;
  productionRate?: number;
}

export interface EpqResult {
  valid: boolean;
  reason: string;
  Q: number;
  H: number;
  rho: number;
  maxInventory: number;
  runsPerYear: number;
  cycleDays: number;
  runDays: number;
  purchaseCost: number;
  setupCost: number;
  holdingCost: number;
  variableCost: number;
  totalCost: number;
}

export function epq({
  annualDemand,
  setupCost,
  unitCost,
  holdingRate,
  productionRate,
}: EpqInput = {}): EpqResult {
  const typeErr = inputError(
    { annualDemand, setupCost, unitCost, holdingRate, productionRate },
    {
      annualDemand: 'annual demand',
      setupCost: 'setup cost',
      unitCost: 'unit cost',
      holdingRate: 'holding rate (%)',
      productionRate: 'production rate',
    }
  );
  const D = Number(annualDemand) || 0;
  const S = Number(setupCost) || 0;
  const C = Number(unitCost) || 0;
  const p = Number(productionRate) || 0;
  const H = holdingCostPerUnit(C, Number(holdingRate) || 0);
  let reason = typeErr;
  if (!reason && !(D > 0)) reason = 'annual demand must be greater than 0';
  else if (!reason && !(S > 0)) reason = 'setup cost must be greater than 0';
  else if (!reason && !(H > 0))
    reason = 'holding cost per unit must be greater than 0 — check unit cost and holding rate';
  else if (!reason && !(p > D))
    reason = `production rate must exceed annual demand (p = ${p}, D = ${D})`;
  const valid = !reason;
  const rho = valid ? D / p : 1;
  const Q = valid ? Math.sqrt((2 * D * S) / (H * (1 - rho))) : 0;
  const maxInventory = Q * (1 - rho);
  const runsPerYear = valid ? D / Q : 0;
  const cycleDays = valid ? 365 / runsPerYear : 0;
  const runDays = valid ? (Q / p) * 365 : 0;
  const purchaseCost = D * C;
  const setupCostYr = runsPerYear * S;
  const holdingCostYr = (maxInventory / 2) * H;
  const variableCost = setupCostYr + holdingCostYr;
  return {
    valid,
    reason,
    Q,
    H,
    rho,
    maxInventory,
    runsPerYear,
    cycleDays,
    runDays,
    purchaseCost,
    setupCost: setupCostYr,
    holdingCost: holdingCostYr,
    variableCost,
    totalCost: purchaseCost + variableCost,
  };
}

export function epqProfile(
  Q: number,
  annualDemand: number,
  productionRate: number,
  steps = 60
): { days: number[]; inv: number[] } {
  const dd = annualDemand / 365;
  const pd = productionRate / 365;
  if (!(Q > 0) || !(pd > dd)) return { days: [], inv: [] };
  const runDays = Q / pd;
  const cycleDays = Q / dd;
  const days: number[] = [];
  const inv: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * cycleDays;
    days.push(t);
    inv.push(t <= runDays ? (pd - dd) * t : Math.max(0, Q - dd * t));
  }
  return { days, inv };
}

export interface DiscountTierInput {
  minQty: number;
  discountPct: number;
}

export interface DiscountTierRow {
  minQty: number;
  discountPct: number;
  price: number;
  H: number;
  qEoq: number;
  Q: number;
  eoqFeasible: boolean;
  purchase: number;
  ordering: number;
  holding: number;
  variable: number;
  totalCost: number;
}

export interface QuantityDiscountResult {
  valid: boolean;
  reason: string;
  rows: DiscountTierRow[];
  bestIndex: number;
  best: DiscountTierRow | null;
  savings: number;
}

function clampPct(v: number): number {
  return Math.min(99, Math.max(0, v));
}

export function quantityDiscount({
  annualDemand,
  orderCost,
  unitCost,
  holdingRate,
  tiers,
}: {
  annualDemand?: number;
  orderCost?: number;
  unitCost?: number;
  holdingRate?: number;
  tiers?: DiscountTierInput[];
} = {}): QuantityDiscountResult {
  const D = Number(annualDemand) || 0;
  const S = Number(orderCost) || 0;
  const C = Number(unitCost) || 0;
  const i = Number(holdingRate) || 0;
  const list = (Array.isArray(tiers) ? tiers : [])
    .map((t) => ({
      minQty: Math.max(0, Number(t.minQty) || 0),
      discountPct: clampPct(Number(t.discountPct) || 0),
    }))
    .sort((a, b) => a.minQty - b.minQty);

  const typeErr = inputError(
    { annualDemand: D, orderCost: S, unitCost: C, holdingRate: i },
    {
      annualDemand: 'annual demand',
      orderCost: 'order cost',
      unitCost: 'unit cost',
      holdingRate: 'holding rate (%)',
    }
  );
  let reason = typeErr;
  if (!reason && !(D > 0)) reason = 'annual demand must be greater than 0';
  else if (!reason && !(S > 0)) reason = 'order cost must be greater than 0';
  else if (!reason && !(C > 0)) reason = 'unit cost must be greater than 0';
  else if (!reason && !(i > 0)) reason = 'holding rate must be greater than 0';
  else if (!reason && !list.length) reason = 'add at least one price-break tier';
  if (reason) {
    return { valid: false, reason, rows: [], bestIndex: -1, best: null, savings: 0 };
  }

  const rows: DiscountTierRow[] = list.map((t) => {
    const price = C * (1 - t.discountPct / 100);
    const H = holdingCostPerUnit(price, i);
    const qEoq = H > 0 ? Math.sqrt((2 * D * S) / H) : 0;
    const Q = Math.max(qEoq, t.minQty, 1);
    const purchase = D * price;
    const ordering = (D / Q) * S;
    const holding = (Q / 2) * H;
    return {
      ...t,
      price,
      H,
      qEoq,
      Q,
      eoqFeasible: qEoq >= t.minQty,
      purchase,
      ordering,
      holding,
      variable: ordering + holding,
      totalCost: purchase + ordering + holding,
    };
  });
  let bestIndex = 0;
  rows.forEach((r, k) => {
    if (r.totalCost < rows[bestIndex].totalCost) bestIndex = k;
  });
  const baseline = rows.length ? rows[0].totalCost : 0;
  return {
    valid: true,
    reason: '',
    rows,
    bestIndex,
    best: rows[bestIndex] || null,
    savings: rows.length ? baseline - rows[bestIndex].totalCost : 0,
  };
}

/* ---------- Demand Statistics & ROP ---------- */

export function dailyStats(
  annualDemand: number,
  history?: ReadonlyArray<number> | null
): { dBar: number; sigmaD: number; sigmaSource: string; sigmaFallback: boolean } {
  const dBar = (Number(annualDemand) || 0) / 365;
  const vals = Array.isArray(history)
    ? history.map(Number).filter((v) => Number.isFinite(v))
    : [];
  let sigmaD: number;
  let sigmaSource: string;
  let sigmaFallback = false;
  if (vals.length >= 6) {
    // Detrend monthly observations via OLS linear fit so trend slope doesn't inflate σ_d
    const n = vals.length;
    const xBar = (n - 1) / 2;
    const yBar = mean(vals);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const dx = i - xBar;
      num += dx * (vals[i] - yBar);
      den += dx * dx;
    }
    const slope = den > 0 ? num / den : 0;
    const intercept = yBar - slope * xBar;
    let sse = 0;
    for (let i = 0; i < n; i++) {
      const res = vals[i] - (intercept + slope * i);
      sse += res * res;
    }
    const resSd = Math.sqrt(sse / Math.max(1, n - 2));
    const monthlySd = Math.min(stdev(vals), resSd);
    sigmaD = monthlySd / Math.sqrt(DAYS_PER_MONTH);
    sigmaSource = sigmaD > 0 ? 'from detrended history residuals' : 'from history (zero residual spread)';
  } else if (vals.length >= 2) {
    sigmaD = stdev(vals) / Math.sqrt(DAYS_PER_MONTH);
    sigmaSource = sigmaD > 0 ? 'from history' : 'from history (zero spread)';
  } else {
    sigmaD = dBar * 0.3;
    sigmaSource = 'assumed — 30% of daily demand (no usable history)';
    sigmaFallback = true;
  }
  return { dBar, sigmaD, sigmaSource, sigmaFallback };
}

export interface RopResult {
  valid: boolean;
  reason: string;
  dBar: number;
  sigmaD: number;
  sigmaSource: string;
  sigmaFallback: boolean;
  z: number;
  leadTimeDays: number;
  safetyStock: number;
  rop: number;
}

export function rop({
  annualDemand,
  leadTimeDays,
  serviceLevel = 95,
  history = null,
}: {
  annualDemand?: number;
  leadTimeDays?: number;
  serviceLevel?: number | null;
  history?: ReadonlyArray<number> | null;
} = {}): RopResult {
  const typeErr = inputError(
    { annualDemand, leadTimeDays, serviceLevel },
    {
      annualDemand: 'annual demand',
      leadTimeDays: 'lead time (days)',
      serviceLevel: 'service level (%)',
    }
  );
  const sl = serviceLevel == null ? 95 : Number(serviceLevel);
  const Lraw = Number(leadTimeDays);
  let reason = typeErr;
  if (!reason && !(Number(annualDemand) >= 0)) reason = 'annual demand must be a number ≥ 0';
  else if (!reason && !(Lraw >= 0)) reason = 'lead time must be a number of days ≥ 0';
  else if (!reason && !Number.isFinite(zFor(sl)))
    reason = 'service level must be between 0% and 100% (exclusive)';
  const L = Number.isFinite(Lraw) && Lraw > 0 ? Lraw : 0;
  const { dBar, sigmaD, sigmaSource, sigmaFallback } = dailyStats(Number(annualDemand) || 0, history);
  const z = reason ? 0 : zFor(sl);
  if (reason) {
    return {
      valid: false,
      reason,
      dBar,
      sigmaD,
      sigmaSource,
      sigmaFallback,
      z: 0,
      leadTimeDays: L,
      safetyStock: 0,
      rop: 0,
    };
  }
  const safetyStock = z * sigmaD * Math.sqrt(L);
  return {
    valid: true,
    reason: '',
    dBar,
    sigmaD,
    sigmaSource,
    sigmaFallback,
    z,
    leadTimeDays: L,
    safetyStock,
    rop: dBar * L + safetyStock,
  };
}

/* ---------- Stock Status & ABC ---------- */

export type StockStatus = 'ok' | 'reorder' | 'critical' | 'out';

export function statusFor(
  stock: number,
  ropValue: number | null | undefined,
  safetyStock?: number | null
): StockStatus {
  if (stock <= 0) return 'out';
  if (safetyStock != null && stock <= safetyStock) return 'critical';
  if (ropValue != null && stock <= ropValue) return 'reorder';
  return 'ok';
}

export const STATUS_META: Record<StockStatus, { label: string; cls: 'ok' | 'warn' | 'bad' }> = {
  ok: { label: 'In Stock', cls: 'ok' },
  reorder: { label: 'Reorder', cls: 'warn' },
  critical: { label: 'Critical', cls: 'bad' },
  out: { label: 'Stockout', cls: 'bad' },
};

export interface AbcItemInput {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  unitCost: number;
  annualDemand: number;
}

export interface AbcRow<T extends AbcItemInput = AbcItemInput> {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  usage: number;
  ref: T;
  rank: number;
  pct: number;
  cumPct: number;
  cls: 'A' | 'B' | 'C';
}

export function abcAnalysis<T extends AbcItemInput>(
  items: ReadonlyArray<T>,
  { aThreshold = 70, bThreshold = 90 }: { aThreshold?: number; bThreshold?: number } = {}
): AbcRow<T>[] {
  let aT = Number(aThreshold);
  let bT = Number(bThreshold);
  if (!Number.isFinite(aT) || aT <= 0) aT = 70;
  if (!Number.isFinite(bT) || bT <= aT) bT = Math.min(100, aT + 20);
  bT = Math.min(100, bT);
  const rows = (Array.isArray(items) ? items : []).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    unit: p.unit,
    usage: cappedProduct(Math.max(0, Number(p.unitCost) || 0), Math.max(0, Number(p.annualDemand) || 0)),
    ref: p,
  }));
  const peak = rows.reduce((m, r) => Math.max(m, r.usage), 0);
  const scale = peak > 0 ? peak : 1;
  const total = sum(rows.map((r) => r.usage / scale)) || 1;
  rows.sort((a, b) => b.usage - a.usage);
  let cum = 0;
  return rows.map((r, i) => {
    const cumBeforePct = (cum / total) * 100;
    cum += r.usage / scale;
    const cumPct = (cum / total) * 100;
    const cls: 'A' | 'B' | 'C' = cumBeforePct < aT ? 'A' : cumBeforePct < bT ? 'B' : 'C';
    return { ...r, rank: i + 1, pct: (r.usage / scale / total) * 100, cumPct, cls };
  });
}

export interface AbcClassStat {
  count: number;
  usage: number;
  countPct: number;
  usagePct: number;
}

export function abcSummary(abcRows: ReadonlyArray<AbcRow>): {
  A: AbcClassStat;
  B: AbcClassStat;
  C: AbcClassStat;
  total: number;
} {
  const rows = Array.isArray(abcRows) ? abcRows : [];
  const out = {
    A: { count: 0, usage: 0, countPct: 0, usagePct: 0 },
    B: { count: 0, usage: 0, countPct: 0, usagePct: 0 },
    C: { count: 0, usage: 0, countPct: 0, usagePct: 0 },
    total: 0,
  };
  const peak = rows.reduce((m, r) => Math.max(m, Number(r.usage) || 0), 0);
  const scale = peak > 0 ? peak : 1;
  let total = 0;
  for (const r of rows) {
    const cls: 'A' | 'B' | 'C' = r.cls === 'A' || r.cls === 'B' ? r.cls : 'C';
    out[cls].count++;
    const u = (Number(r.usage) || 0) / scale;
    out[cls].usage += u;
    total += u;
  }
  for (const k of ['A', 'B', 'C'] as const) {
    out[k].countPct = rows.length ? (out[k].count / rows.length) * 100 : 0;
    out[k].usagePct = total ? (out[k].usage / total) * 100 : 0;
    out[k].usage *= scale;
  }
  out.total = total * scale;
  return out;
}

export const ABC_ADVICE: Record<'A' | 'B' | 'C', string> = {
  A: 'Tight control — frequent review, low safety stock, reliable suppliers, exact records.',
  B: 'Moderate control — periodic review, medium safety stock, standard ordering.',
  C: 'Loose control — bulk ordering, generous stocks, minimal paperwork.',
};

/* ---------- Newsvendor ---------- */

export interface NewsvendorResult {
  valid: boolean;
  reason: string;
  cu: number;
  co: number;
  criticalRatio: number;
  z: number;
  Q: number;
  mean: number;
  sd: number;
  cycleService: number;
  expectedSold: number;
  expectedLeftover: number;
  expectedShortage: number;
  expectedProfit: number;
}

export function newsvendor({
  price,
  cost,
  salvage = 0,
  mean: meanD,
  sd,
}: {
  price?: number;
  cost?: number;
  salvage?: number;
  mean?: number;
  sd?: number;
} = {}): NewsvendorResult {
  const typeErr = inputError(
    { price, cost, salvage, mean: meanD, sd },
    { price: 'price', cost: 'cost', salvage: 'salvage value', mean: 'mean demand', sd: 'demand sd' }
  );
  const p = Number(price) || 0;
  const c = Number(cost) || 0;
  const s = Number(salvage) || 0;
  const mu = Number(meanD) || 0;
  const sg = Number(sd) || 0;
  const cu = p - c;
  const co = c - s;
  let reason = typeErr;
  if (!reason && !(sg > 0)) reason = 'demand standard deviation must be greater than 0';
  else if (!reason && !(cu > 0)) reason = 'underage cost (price − cost) must be greater than 0';
  else if (!reason && !(co > 0)) reason = 'overage cost (cost − salvage) must be greater than 0';
  else if (!reason && (!Number.isFinite(cu) || !Number.isFinite(co)))
    reason = 'underage/overage cost overflowed double precision';
  const cr = reason ? 0 : cu / (cu + co);
  if (!reason && !(cr > 0 && cr < 1)) reason = 'critical ratio is at floating-point limit';
  const valid = !reason;
  const z = valid ? normInv(cr) : 0;
  const Q = valid ? mu + sg * z : 0;
  const loss = valid ? normLoss(z) : 0;
  return {
    valid,
    reason,
    cu,
    co,
    criticalRatio: cr,
    z,
    Q,
    mean: mu,
    sd: sg,
    cycleService: cr * 100,
    expectedSold: valid ? mu - sg * loss : 0,
    expectedLeftover: valid ? Q - mu + sg * loss : 0,
    expectedShortage: valid ? sg * loss : 0,
    expectedProfit: valid ? p * (mu - sg * loss) + s * (Q - mu + sg * loss) - c * Q : 0,
  };
}

export function newsvendorProfit(
  Q: number,
  { price, cost, salvage = 0, mean: meanD, sd }: { price: number; cost: number; salvage?: number; mean: number; sd: number }
): number {
  const sg = Number(sd) || 0;
  if (!(sg > 0)) return NaN;
  const p = Number(price) || 0;
  const c = Number(cost) || 0;
  const s = Number(salvage) || 0;
  const mu = Number(meanD) || 0;
  const loss = normLoss((Q - mu) / sg);
  return p * (mu - sg * loss) + s * (Q - mu + sg * loss) - c * Q;
}

/* ---------- Statistical Process Control (SPC) ---------- */

export interface SpcConstant {
  d2: number;
  d3: number;
  A2: number;
  D3: number;
  D4: number;
}

export const SPC_CONSTANTS: Record<number, SpcConstant> = {
  2: { d2: 1.128, d3: 0.853, A2: 1.88, D3: 0.0, D4: 3.267 },
  3: { d2: 1.693, d3: 0.888, A2: 1.023, D3: 0.0, D4: 2.574 },
  4: { d2: 2.059, d3: 0.88, A2: 0.729, D3: 0.0, D4: 2.282 },
  5: { d2: 2.326, d3: 0.864, A2: 0.577, D3: 0.0, D4: 2.114 },
  6: { d2: 2.534, d3: 0.848, A2: 0.483, D3: 0.0, D4: 2.004 },
  7: { d2: 2.704, d3: 0.833, A2: 0.419, D3: 0.076, D4: 1.924 },
  8: { d2: 2.847, d3: 0.82, A2: 0.373, D3: 0.136, D4: 1.864 },
  9: { d2: 2.97, d3: 0.808, A2: 0.337, D3: 0.184, D4: 1.816 },
  10: { d2: 3.078, d3: 0.797, A2: 0.308, D3: 0.223, D4: 1.777 },
};

export interface SpcResult {
  valid: boolean;
  reason: string;
  n: number;
  subgroups: number;
  dropped: number;
  means: number[];
  ranges: number[];
  flags: number[][];
  rFlags: number[][];
  centre: number;
  ucl: number;
  lcl: number;
  rCentre: number;
  rUcl: number;
  rLcl: number;
  zone: number;
  xbar: number;
  rbar: number;
  sigma: number;
  sigmaOverall: number;
  oocCount: number;
  oocIndexes: number[];
  ruleCounts: Record<1 | 2 | 3, number>;
  cap: {
    Cp: number;
    Cpk: number;
    Pp: number;
    Ppk: number;
    cpu: number;
    cpl: number;
  } | null;
  phase2Cap: {
    subgroupsKept: number;
    Cp: number;
    Cpk: number;
    Pp: number;
    Ppk: number;
  } | null;
  capabilityLevel: string;
  outOfSpecPct: number | null;
  spec: { usl: number; lsl: number };
  target: number;
  constants: SpcConstant | null;
  points: { i: number; value: number; range: number; flags: number[]; ooc: boolean }[];
}

export function spcAnalysis({
  subgroups,
  usl,
  lsl,
}: {
  subgroups?: ReadonlyArray<ReadonlyArray<number>>;
  usl?: number;
  lsl?: number;
} = {}): SpcResult {
  const raw = (Array.isArray(subgroups) ? subgroups : [])
    .map((g) => (Array.isArray(g) ? g.map(Number).filter(Number.isFinite) : []))
    .filter((g) => g.length > 1);
  const n = raw.length ? raw[0].length : 0;
  const kept = raw.filter((g) => g.length === n);
  const dropped = raw.length - kept.length;
  const C = SPC_CONSTANTS[n] || null;

  const fail = (reason: string): SpcResult => ({
    valid: false,
    reason,
    n,
    subgroups: kept.length,
    dropped,
    means: [],
    ranges: [],
    flags: [],
    rFlags: [],
    centre: 0,
    ucl: 0,
    lcl: 0,
    rCentre: 0,
    rUcl: 0,
    rLcl: 0,
    zone: 0,
    xbar: 0,
    rbar: 0,
    sigma: 0,
    sigmaOverall: 0,
    oocCount: 0,
    oocIndexes: [],
    ruleCounts: { 1: 0, 2: 0, 3: 0 },
    cap: null,
    phase2Cap: null,
    capabilityLevel: 'unknown',
    outOfSpecPct: null,
    spec: { usl: Number(usl), lsl: Number(lsl) },
    target: 0,
    constants: C,
    points: [],
  });

  if (kept.length < 2) return fail('Enter at least 2 subgroups of measurements.');
  if (!C)
    return fail(
      n > 10
        ? `Subgroup size ${n} is too large — use 2 to 10 measurements per sample.`
        : 'Each subgroup needs at least 2 measurements.'
    );
  if (dropped) return fail(`${dropped} subgroup(s) had a different size — keep every sample the same length.`);

  const means = kept.map((g) => mean(g));
  const ranges = kept.map((g) => Math.max(...g) - Math.min(...g));
  const xbar = mean(means);
  const rbar = mean(ranges);
  const sigma = rbar > 0 ? rbar / C.d2 : 0;
  const all = kept.reduce<number[]>((a, g) => a.concat(g), []);
  const sigmaOverall = all.length > 1 ? stdev(all) : 0;

  const centre = xbar;
  const ucl = xbar + C.A2 * rbar;
  const lcl = xbar - C.A2 * rbar;
  const rCentre = rbar;
  const rUcl = C.D4 * rbar;
  const rLcl = C.D3 * rbar;
  const zone = (ucl - xbar) / 3;

  const flags: number[][] = means.map(() => []);
  for (let i = 0; i < means.length; i++) {
    if (means[i] > ucl || means[i] < lcl) flags[i].push(1);
  }
  for (let i = 0; i + 2 < means.length; i++) {
    const w = [means[i], means[i + 1], means[i + 2]];
    const hi = w.filter((v) => v > xbar + 2 * zone).length;
    const lo = w.filter((v) => v < xbar - 2 * zone).length;
    if (hi >= 2)
      w.forEach((v, k) => {
        if (v > xbar + 2 * zone && !flags[i + k].includes(2)) flags[i + k].push(2);
      });
    if (lo >= 2)
      w.forEach((v, k) => {
        if (v < xbar - 2 * zone && !flags[i + k].includes(2)) flags[i + k].push(2);
      });
  }
  let run = 1;
  for (let i = 1; i < means.length; i++) {
    const same = (means[i] - centre) * (means[i - 1] - centre) > 0;
    run = same ? run + 1 : 1;
    if (run >= 8) {
      for (let k = i - 7; k <= i; k++) if (!flags[k].includes(3)) flags[k].push(3);
    }
  }

  const rFlags: number[][] = ranges.map(() => []);
  ranges.forEach((v, i) => {
    if (v > rUcl || v < rLcl) rFlags[i].push(1);
  });

  const ruleCounts: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  flags.forEach((f) =>
    f.forEach((r) => {
      if (r === 1 || r === 2 || r === 3) ruleCounts[r]++;
    })
  );
  const oocIndexes: number[] = [];
  flags.forEach((f, i) => {
    if (f.length) oocIndexes.push(i);
  });

  const U = Number(usl);
  const L = Number(lsl);
  const hasFiniteSpec =
    usl != null &&
    usl !== ('' as unknown) &&
    lsl != null &&
    lsl !== ('' as unknown) &&
    Number.isFinite(U) &&
    Number.isFinite(L);
  const hasInvalidSpec = hasFiniteSpec && U <= L;
  const hasSpec = hasFiniteSpec && U > L;
  let cap: SpcResult['cap'] = null;
  let phase2Cap: SpcResult['phase2Cap'] = null;
  let capabilityLevel = hasInvalidSpec ? 'invalid spec limits (USL must exceed LSL)' : 'no spec limits';
  let outOfSpecPct: number | null = null;
  if (hasSpec) {
    const sd = sigma > 0 ? sigma : sigmaOverall;
    const so = sigmaOverall > 0 ? sigmaOverall : sd;
    if (sd > 0) {
      cap = {
        Cp: (U - L) / (6 * sd),
        Cpk: Math.min(U - xbar, xbar - L) / (3 * sd),
        Pp: (U - L) / (6 * so),
        Ppk: Math.min(U - xbar, xbar - L) / (3 * so),
        cpu: (U - xbar) / (3 * sd),
        cpl: (xbar - L) / (3 * sd),
      };
      capabilityLevel = cap.Cpk >= 1.33 ? 'capable' : cap.Cpk >= 1.0 ? 'marginal' : 'not capable';
      outOfSpecPct = (normSf((U - xbar) / so) + normCdf((L - xbar) / so)) * 100;

      if (oocIndexes.length > 0 && kept.length - oocIndexes.length >= 2) {
        const oocSet = new Set(oocIndexes);
        const inControl = kept.filter((_, idx) => !oocSet.has(idx));
        const icMeans = inControl.map((g) => mean(g));
        const icRanges = inControl.map((g) => Math.max(...g) - Math.min(...g));
        const xbar2 = mean(icMeans);
        const rbar2 = mean(icRanges);
        const all2 = inControl.reduce<number[]>((a, g) => a.concat(g), []);
        const so2 = all2.length > 1 ? stdev(all2) : sd;
        const sd2 = rbar2 > 0 ? rbar2 / C.d2 : so2;
        if (sd2 > 0 && so2 > 0) {
          phase2Cap = {
            subgroupsKept: inControl.length,
            Cp: (U - L) / (6 * sd2),
            Cpk: Math.min(U - xbar2, xbar2 - L) / (3 * sd2),
            Pp: (U - L) / (6 * so2),
            Ppk: Math.min(U - xbar2, xbar2 - L) / (3 * so2),
          };
        }
      }
    } else {
      const inside = xbar <= U && xbar >= L;
      capabilityLevel = 'degenerate — σ̂ is 0 (every measurement identical)';
      outOfSpecPct = inside ? 0 : 100;
    }
  }

  return {
    valid: true,
    reason: '',
    n,
    subgroups: kept.length,
    dropped,
    constants: C,
    means,
    ranges,
    flags,
    rFlags,
    centre,
    ucl,
    lcl,
    rCentre,
    rUcl,
    rLcl,
    zone,
    xbar,
    rbar,
    sigma,
    sigmaOverall,
    oocCount: oocIndexes.length,
    oocIndexes,
    ruleCounts,
    cap,
    phase2Cap,
    capabilityLevel,
    outOfSpecPct,
    spec: { usl: U, lsl: L },
    target: Number.isFinite(U) && Number.isFinite(L) ? (U + L) / 2 : xbar,
    points: means.map((v, i) => ({
      i,
      value: v,
      range: ranges[i],
      flags: flags[i],
      ooc: flags[i].length > 0,
    })),
  };
}

export function spcDrift({
  subgroups,
  usl,
  lsl,
  target,
  lambda = 0.2,
  k = 0.5,
  h = 4,
  L = 3,
}: {
  subgroups?: ReadonlyArray<ReadonlyArray<number>>;
  usl?: number;
  lsl?: number;
  target?: number;
  lambda?: number;
  k?: number;
  h?: number;
  L?: number;
} = {}) {
  const raw = (Array.isArray(subgroups) ? subgroups : [])
    .map((g) => (Array.isArray(g) ? g.map(Number).filter(Number.isFinite) : []))
    .filter((g) => g.length > 1);
  const n = raw.length ? raw[0].length : 0;
  const kept = raw.filter((g) => g.length === n);
  const fail = (reason: string) => ({
    valid: false,
    reason,
    n,
    subgroups: kept.length,
    xbar: 0,
    sigmaMean: 0,
    target: 0,
    means: [] as number[],
    ewma: null as null | {
      lambda: number;
      L: number;
      sigmaZ: number;
      ucl: number;
      lcl: number;
      uclSeries: number[];
      lclSeries: number[];
      target: number;
      series: number[];
      flags: boolean[];
      oocCount: number;
    },
    cusum: null as null | {
      k: number;
      h: number;
      up: number[];
      down: number[];
      flags: boolean[];
      oocCount: number;
    },
    firstAlarm: null as number | null,
  });

  const C = SPC_CONSTANTS[n] || null;
  if (kept.length < 2) return fail('Enter at least 2 subgroups to run drift detection.');
  if (!C)
    return fail(
      n > 10
        ? `Subgroup size ${n} is too large — use 2 to 10 measurements per sample.`
        : 'Each subgroup needs at least 2 measurements.'
    );

  const means = kept.map((g) => mean(g));
  const rbar = mean(kept.map((g) => Math.max(...g) - Math.min(...g)));
  const xbar = mean(means);
  const sigmaMean = (rbar * C.A2) / 3;
  if (!(sigmaMean > 0)) return fail('Every measurement is identical — σ̂ is 0, nothing to detect.');

  const U = Number(usl);
  const Ls = Number(lsl);
  const specMid = Number.isFinite(U) && Number.isFinite(Ls) && U > Ls ? (U + Ls) / 2 : null;
  const tgt = Number.isFinite(Number(target)) ? Number(target) : specMid != null ? specMid : xbar;
  const sm = sigmaMean;

  const lam = lambda != null && Number.isFinite(Number(lambda)) ? Math.min(0.5, Math.max(0.01, Number(lambda))) : 0.2;
  const LL = L != null && Number.isFinite(Number(L)) ? Math.max(1, Number(L)) : 3;
  const zSig = sm * Math.sqrt(lam / (2 - lam));
  const eUcl = tgt + LL * zSig;
  const eLcl = tgt - LL * zSig;
  const series: number[] = [];
  const uclSeries: number[] = [];
  const lclSeries: number[] = [];
  const eFlags: boolean[] = [];
  let z = tgt;
  for (let i = 0; i < means.length; i++) {
    z = lam * means[i] + (1 - lam) * z;
    const zSigT = sm * Math.sqrt((lam / (2 - lam)) * (1 - Math.pow(1 - lam, 2 * (i + 1))));
    const uclT = tgt + LL * zSigT;
    const lclT = tgt - LL * zSigT;
    series.push(z);
    uclSeries.push(uclT);
    lclSeries.push(lclT);
    eFlags.push(z > uclT || z < lclT);
  }

  const kk = k != null && Number.isFinite(Number(k)) ? Math.max(0, Number(k)) : 0.5;
  const hh = h != null && Number.isFinite(Number(h)) ? Math.max(0.5, Number(h)) : 4;
  const up: number[] = [];
  const down: number[] = [];
  const cFlags: boolean[] = [];
  let sUp = 0;
  let sDn = 0;
  for (let i = 0; i < means.length; i++) {
    const d = (means[i] - tgt) / sm;
    sUp = Math.max(0, sUp + d - kk);
    sDn = Math.max(0, sDn - d - kk);
    up.push(sUp);
    down.push(sDn);
    cFlags.push(sUp > hh || sDn > hh);
  }

  let firstAlarm: number | null = null;
  for (let i = 0; i < means.length; i++) {
    if (eFlags[i] || cFlags[i]) {
      firstAlarm = i;
      break;
    }
  }

  return {
    valid: true,
    reason: '',
    n,
    subgroups: kept.length,
    xbar,
    sigmaMean: sm,
    target: tgt,
    means,
    ewma: {
      lambda: lam,
      L: LL,
      sigmaZ: zSig,
      ucl: eUcl,
      lcl: eLcl,
      uclSeries,
      lclSeries,
      target: tgt,
      series,
      flags: eFlags,
      oocCount: eFlags.filter(Boolean).length,
    },
    cusum: {
      k: kk,
      h: hh,
      up,
      down,
      flags: cFlags,
      oocCount: cFlags.filter(Boolean).length,
    },
    firstAlarm,
  };
}

/* ---------- Basic M/M/c Queueing ---------- */

export function queueing({ lambda, mu, servers = 1 }: { lambda?: number; mu?: number; servers?: number } = {}) {
  const l = Number(lambda) || 0;
  const m = Number(mu) || 0;
  const c = Math.max(1, Math.min(50, Math.round(Number(servers) || 1)));
  const rho0 = m > 0 && c > 0 ? l / (c * m) : 0;
  const unstable = {
    valid: false,
    reason: '',
    lambda: l,
    mu: m,
    servers: c,
    capacity: c * m,
    offeredLoad: m > 0 ? l / m : 0,
    rho: rho0,
    p0: 0,
    pWait: 0,
    pWaitPct: 0,
    Lq: Infinity,
    Wq: Infinity,
    L: Infinity,
    W: Infinity,
    utilPct: rho0 * 100,
    busyServers: 0,
    idlePct: 0,
  };
  if (!(l > 0)) return { ...unstable, reason: 'arrival rate λ must be greater than 0' };
  if (!(m > 0)) return { ...unstable, reason: 'service rate μ must be greater than 0' };
  if (l >= c * m) {
    return { ...unstable, reason: `unstable — λ (${l}) must stay below c·μ (${c * m})` };
  }

  const a = l / m;
  const rho = a / c;
  let sumTerms = 0;
  let fk = 1;
  for (let k = 0; k < c; k++) {
    if (k > 0) fk *= k;
    sumTerms += Math.pow(a, k) / fk;
  }
  fk *= c;
  const termC = Math.pow(a, c) / (fk * (1 - rho));
  const p0 = 1 / (sumTerms + termC);
  if (!Number.isFinite(p0) || !(p0 > 0)) {
    return { ...unstable, reason: `numerical failure computing P₀ for a=${a}, c=${c}` };
  }
  const pWait = termC * p0;
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
    capacity: c * m,
    offeredLoad: a,
    rho,
    utilPct: rho * 100,
    p0,
    pWait,
    pWaitPct: pWait * 100,
    Lq,
    Wq,
    L,
    W,
    busyServers: a,
    idlePct: p0 * 100,
  };
}
