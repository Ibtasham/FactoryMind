/**
 * Forecasting Laboratory engine — 12 forecasting models, rolling-origin backtesting,
 * MASE, residual analysis, AC demand classification, and automated method recommendation.
 */

export interface ForecastOutput {
  model: string;
  label: string;
  short: string;
  color: string;
  fitted: (number | null)[];
  forecast: number[];
  components?: Record<string, unknown>;
}

export interface ForecastMethodOpts {
  w?: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
  seasonPeriod?: number;
  period?: number;
  horizon?: number;
}

export interface MethodSpec {
  name: string;
  shortKey?: string;
  method: (history: ReadonlyArray<number>, opts?: ForecastMethodOpts) => ForecastOutput;
  params?: ForecastMethodOpts;
}

export const METHOD_COLORS: Record<string, string> = {
  sma: '#34d399',
  wma: '#fbbf24',
  ema: '#a78bfa',
  holt: '#f97316',
  hwa: '#22c55e',
  hwm: '#15803d',
  sn: '#eab308',
  lin: '#f472b6',
  croston: '#ea580c',
  sba: '#0d9488',
  naive: '#6b7280',
  avg: '#9ca3af',
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const toSeries = (history: ReadonlyArray<number>): number[] =>
  (Array.isArray(history) ? history : []).map(Number).filter(Number.isFinite);

function mean(arr: ReadonlyArray<number>): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return arr.length ? s / arr.length : 0;
}

function stdevFrom(vals: ReadonlyArray<number>): number {
  const n = vals.length;
  if (n < 2) return 0;
  const m = mean(vals);
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (vals[i] - m) ** 2;
  return Math.sqrt(sq / (n - 1));
}

function mad(vals: ReadonlyArray<number>): number {
  return mean(vals.map(Math.abs));
}

function linregSlope(vals: ReadonlyArray<number>, xBase?: number[]): number {
  const n = vals.length;
  if (n < 2) return 0;
  const xs = xBase || Array.from({ length: n }, (_, i) => i);
  const mx = mean(xs);
  const my = mean(vals);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = vals[i] - my;
    num += dx * dy;
    den += dx * dx;
  }
  return den > 1e-12 ? num / den : 0;
}

function linregIntercept(vals: ReadonlyArray<number>, xBase?: number[]): number {
  const n = vals.length;
  if (n < 2) return 0;
  const xs = xBase || Array.from({ length: n }, (_, i) => i);
  const mx = mean(xs);
  const my = mean(vals);
  const slope = linregSlope(vals, xs);
  return my - slope * mx;
}

function autocorrAt(vals: ReadonlyArray<number>, lag: number): number {
  const n = vals.length;
  if (n < lag + 2) return 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n - lag; i++) {
    xs.push(vals[i]);
    ys.push(vals[i + lag]);
  }
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den > 1e-12 ? num / den : 0;
}

function detectSeasonality(vals: ReadonlyArray<number>, maxL = 12): boolean {
  const n = vals.length;
  if (n < maxL * 2) return false;
  let best = 0;
  let bestLag = 0;
  for (let lag = 2; lag <= maxL; lag++) {
    const ac = autocorrAt(vals, lag);
    if (ac > best) {
      best = ac;
      bestLag = lag;
    }
  }
  return best > 0.25 && bestLag > 1;
}

/* ---------- 12 Forecasting Methods ---------- */

export function smaMethod(history: ReadonlyArray<number>, opts: ForecastMethodOpts = {}): ForecastOutput {
  const H = toSeries(history);
  const n = H.length;
  const w = clamp(Number(opts.w) || 6, 2, Math.max(2, n));
  const fitted: (number | null)[] = new Array(n).fill(null);
  for (let k = w; k < n; k++) fitted[k] = mean(H.slice(k - w, k));
  const horizon = clamp(Number(opts.horizon) || 12, 1, 60);
  const val = n ? mean(H.slice(-w)) : 0;
  return {
    model: 'SMA',
    label: `SMA (w=${w})`,
    short: 'SMA',
    color: METHOD_COLORS.sma,
    fitted,
    forecast: new Array(horizon).fill(val),
    components: { window: w, value: val },
  };
}

export function wmaMethod(history: ReadonlyArray<number>, opts: ForecastMethodOpts = {}): ForecastOutput {
  const H = toSeries(history);
  const n = H.length;
  const w = clamp(Number(opts.w) || 6, 2, Math.max(2, n));
  const weights = new Array<number>(w);
  let wsum = 0;
  for (let i = 0; i < w; i++) {
    weights[i] = i + 1;
    wsum += weights[i];
  }
  for (let i = 0; i < w; i++) weights[i] /= wsum;
  const fitted: (number | null)[] = new Array(n).fill(null);
  for (let k = w; k < n; k++) {
    let s = 0;
    for (let i = 0; i < w; i++) s += weights[i] * H[k - w + i];
    fitted[k] = s;
  }
  const horizon = clamp(Number(opts.horizon) || 12, 1, 60);
  let fv = 0;
  if (n >= w) {
    for (let i = 0; i < w; i++) fv += weights[i] * H[n - w + i];
  } else if (n > 0) {
    fv = mean(H);
  }
  return {
    model: 'WMA',
    label: `WMA (w=${w})`,
    short: 'WMA',
    color: METHOD_COLORS.wma,
    fitted,
    forecast: new Array(horizon).fill(fv),
    components: { window: w, weights, value: fv },
  };
}

export function emaMethod(history: ReadonlyArray<number>, opts: ForecastMethodOpts = {}): ForecastOutput {
  const H = toSeries(history);
  const n = H.length;
  const alpha = clamp(Number(opts.alpha) || 0.3, 0.01, 0.99);
  if (n === 0) return { model: 'SES', label: 'SES', short: 'EMA', color: METHOD_COLORS.ema, fitted: [], forecast: [] };
  const fitted: (number | null)[] = new Array(n).fill(null);
  let s = H[0];
  for (let k = 1; k < n; k++) {
    fitted[k] = s;
    s = alpha * H[k] + (1 - alpha) * s;
  }
  const horizon = clamp(Number(opts.horizon) || 12, 1, 60);
  return {
    model: 'SES',
    label: `SES (α=${alpha.toFixed(2)})`,
    short: 'EMA',
    color: METHOD_COLORS.ema,
    fitted,
    forecast: new Array(horizon).fill(s),
    components: { alpha, level: s },
  };
}

export function holtLinear(history: ReadonlyArray<number>, opts: ForecastMethodOpts = {}): ForecastOutput {
  const H = toSeries(history);
  const n = H.length;
  const alpha = clamp(Number(opts.alpha) || 0.3, 0.01, 0.99);
  const beta = clamp(Number(opts.beta) || 0.1, 0.01, 0.99);
  if (n === 0) return { model: 'HoltLinear', label: 'Holt linear', short: 'HL', color: METHOD_COLORS.holt, fitted: [], forecast: [] };
  const fitted: (number | null)[] = new Array(n).fill(null);
  let level = H[0];
  let trend = n > 1 ? H[1] - H[0] : 0;
  for (let k = 1; k < n; k++) {
    fitted[k] = level + trend;
    const prevLevel = level;
    level = alpha * H[k] + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  const horizon = clamp(Number(opts.horizon) || 12, 1, 60);
  const forecast = new Array<number>(horizon);
  for (let h = 1; h <= horizon; h++) forecast[h - 1] = Math.max(0, level + trend * h);
  return {
    model: 'HoltLinear',
    label: `Holt linear (α=${alpha.toFixed(2)}, β=${beta.toFixed(2)})`,
    short: 'HL',
    color: METHOD_COLORS.holt,
    fitted,
    forecast,
    components: { alpha, beta, level, trend },
  };
}

export function hwAdditive(history: ReadonlyArray<number>, opts: ForecastMethodOpts = {}): ForecastOutput {
  const H = toSeries(history);
  const n = H.length;
  const p = clamp(Number(opts.seasonPeriod) || 12, 2, n || 12);
  const alpha = clamp(Number(opts.alpha) || 0.3, 0.01, 0.99);
  const beta = clamp(Number(opts.beta) || 0.1, 0.01, 0.99);
  const gamma = clamp(Number(opts.gamma) || 0.1, 0.01, 0.99);
  if (n === 0) return { model: 'HoltWintersAdd', label: 'Holt-Winters additive', short: 'HW-A', color: METHOD_COLORS.hwa, fitted: [], forecast: [] };
  const fitted: (number | null)[] = new Array(n).fill(null);
  const S = new Array<number>(p).fill(0);
  let level = H[0];
  let trend = n > 1 ? H[1] - H[0] : 0;
  if (n >= p * 2) {
    const mean0 = mean(H.slice(0, p));
    const mean1 = mean(H.slice(p, p * 2));
    trend = (mean1 - mean0) / p;
    const l0 = mean0 - trend * ((p - 1) / 2);
    for (let i = 0; i < p; i++) {
      S[i] = 0.5 * ((H[i] - (l0 + trend * i)) + (H[p + i] - (l0 + trend * (p + i))));
    }
    const sMean = mean(S);
    for (let i = 0; i < p; i++) S[i] -= sMean;
    level = l0 - trend;
  } else if (n >= p) {
    const mean0 = mean(H.slice(0, p));
    trend = 0;
    for (let i = 0; i < p; i++) S[i] = H[i] - mean0;
    level = mean0;
  }
  for (let k = 0; k < n; k++) {
    const sIdx = ((k % p) + p) % p;
    const oneStepLevel = level + trend;
    fitted[k] = oneStepLevel + S[sIdx];
    const prevLevel = level;
    level = alpha * (H[k] - S[sIdx]) + (1 - alpha) * oneStepLevel;
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    S[sIdx] = gamma * (H[k] - level) + (1 - gamma) * S[sIdx];
  }
  const horizon = clamp(Number(opts.horizon) || 12, 1, 60);
  const forecast = new Array<number>(horizon);
  for (let h = 1; h <= horizon; h++) {
    const sIdx = ((n + h - 1) % p + p) % p;
    forecast[h - 1] = Math.max(0, level + trend * h + S[sIdx]);
  }
  return {
    model: 'HoltWintersAdd',
    label: `Holt-Winters additive (p=${p})`,
    short: 'HW-A',
    color: METHOD_COLORS.hwa,
    fitted,
    forecast,
    components: { alpha, beta, gamma, seasonPeriod: p, level, trend, seasonal: S },
  };
}

export function hwMultiplicative(history: ReadonlyArray<number>, opts: ForecastMethodOpts = {}): ForecastOutput {
  const H = toSeries(history);
  const n = H.length;
  const p = clamp(Number(opts.seasonPeriod) || 12, 2, n || 12);
  const alpha = clamp(Number(opts.alpha) || 0.3, 0.01, 0.99);
  const beta = clamp(Number(opts.beta) || 0.1, 0.01, 0.99);
  const gamma = clamp(Number(opts.gamma) || 0.1, 0.01, 0.99);
  if (n === 0) return { model: 'HoltWintersMult', label: 'Holt-Winters mult.', short: 'HW-M', color: METHOD_COLORS.hwm, fitted: [], forecast: [] };
  if (H.some((v) => v <= 0)) {
    const r = hwAdditive(H, { ...opts, seasonPeriod: p, alpha, beta, gamma });
    r.model = 'HWMultiplicative-degraded';
    return r;
  }
  const fitted: (number | null)[] = new Array(n).fill(null);
  const S = new Array<number>(p).fill(1);
  let level = H[0];
  let trend = n > 1 ? H[1] - H[0] : 0;
  if (n >= p * 2) {
    const mean0 = mean(H.slice(0, p));
    const mean1 = mean(H.slice(p, p * 2));
    trend = (mean1 - mean0) / p;
    const l0 = mean0 - trend * ((p - 1) / 2);
    for (let i = 0; i < p; i++) {
      const denom0 = Math.max(1e-6, l0 + trend * i);
      const denom1 = Math.max(1e-6, l0 + trend * (p + i));
      S[i] = 0.5 * (H[i] / denom0 + H[p + i] / denom1);
    }
    const fmean = mean(S);
    if (fmean > 1e-9) for (let i = 0; i < p; i++) S[i] /= fmean;
    // Refine L0 on deseasonalized Season 0 so initial level matches exact multiplicative trend
    let deseasonSum = 0;
    for (let i = 0; i < p; i++) deseasonSum += H[i] / Math.max(1e-6, S[i]) - trend * i;
    const l0Refined = deseasonSum / p;
    level = l0Refined - trend;
  } else if (n >= p) {
    const mean0 = mean(H.slice(0, p));
    trend = 0;
    for (let i = 0; i < p; i++) S[i] = H[i] / (mean0 || 1);
    const fmean = mean(S);
    if (fmean > 1e-9) for (let i = 0; i < p; i++) S[i] /= fmean;
    level = mean0 || H[0];
  }
  for (let k = 0; k < n; k++) {
    const sIdx = k % p;
    const oneStepLevel = level + trend;
    fitted[k] = oneStepLevel * S[sIdx];
    const prevLevel = level;
    level = alpha * (H[k] / (S[sIdx] || 1)) + (1 - alpha) * oneStepLevel;
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    S[sIdx] = gamma * (H[k] / (level || 1)) + (1 - gamma) * S[sIdx];
    if ((k + 1) % p === 0) {
      const sMean = mean(S);
      if (sMean > 1e-9) for (let i = 0; i < p; i++) S[i] /= sMean;
    }
  }
  const horizon = clamp(Number(opts.horizon) || 12, 1, 60);
  const forecast = new Array<number>(horizon);
  for (let h = 1; h <= horizon; h++) {
    const sIdx = ((n + h - 1) % p + p) % p;
    forecast[h - 1] = Math.max(0, (level + trend * h) * S[sIdx]);
  }
  return {
    model: 'HoltWintersMult',
    label: `Holt-Winters mult. (p=${p})`,
    short: 'HW-M',
    color: METHOD_COLORS.hwm,
    fitted,
    forecast,
    components: { alpha, beta, gamma, seasonPeriod: p, level, trend, seasonal: S },
  };
}

export function seasonalNaive(history: ReadonlyArray<number>, opts: ForecastMethodOpts = {}): ForecastOutput {
  const H = toSeries(history);
  const n = H.length;
  const p = clamp(Number(opts.period) || Number(opts.seasonPeriod) || 12, 2, Math.max(2, n));
  const fitted: (number | null)[] = new Array(n).fill(null);
  for (let k = p; k < n; k++) fitted[k] = H[k - p];
  const horizon = clamp(Number(opts.horizon) || 12, 1, 60);
  const forecast = new Array<number>(horizon);
  for (let h = 0; h < horizon; h++) {
    const idx = n - p + (h % p);
    forecast[h] = idx >= 0 && idx < n ? H[idx] : H[n - 1] || 0;
  }
  return {
    model: 'SeasonalNaive',
    label: `Seasonal naive (p=${p})`,
    short: 'SN',
    color: METHOD_COLORS.sn,
    fitted,
    forecast,
    components: { period: p },
  };
}

export function linregMethod(history: ReadonlyArray<number>, opts: ForecastMethodOpts = {}): ForecastOutput {
  const H = toSeries(history);
  const n = H.length;
  const fitted: (number | null)[] = new Array(n).fill(null);
  const horizon = clamp(Number(opts.horizon) || 12, 1, 60);
  if (n < 2) {
    return {
      model: 'LinearTrend',
      label: 'Linear trend',
      short: 'LIN',
      color: METHOD_COLORS.lin,
      fitted,
      forecast: new Array(horizon).fill(H[0] || 0),
      components: { slope: 0, intercept: H[0] || 0, rSquared: 0 },
    };
  }
  const xs = Array.from({ length: n }, (_, i) => i);
  const slope = linregSlope(H, xs);
  const intercept = linregIntercept(H, xs);
  let ssTot = 0;
  let ssRes = 0;
  const m = mean(H);
  for (let i = 0; i < n; i++) {
    const pred = Math.max(0, intercept + slope * i);
    fitted[i] = pred;
    ssTot += (H[i] - m) ** 2;
    ssRes += (H[i] - pred) ** 2;
  }
  const rSquared = ssTot > 1e-12 ? 1 - ssRes / ssTot : 0;
  const forecast = new Array<number>(horizon);
  for (let h = 1; h <= horizon; h++) forecast[h - 1] = Math.max(0, intercept + slope * (n - 1 + h));
  return {
    model: 'LinearTrend',
    label: `Linear trend (R²=${rSquared.toFixed(2)})`,
    short: 'LIN',
    color: METHOD_COLORS.lin,
    fitted,
    forecast,
    components: { slope, intercept, rSquared },
  };
}

export function crostonMethod(history: ReadonlyArray<number>, opts: ForecastMethodOpts = {}): ForecastOutput {
  const H = toSeries(history);
  const n = H.length;
  const a = clamp(Number(opts.alpha) || 0.3, 0.01, 0.99);
  const fitted: (number | null)[] = new Array(n).fill(null);
  let hasZ = false;
  let hasP = false;
  let z = 0;
  let p = 0;
  let lastNonzeroIdx = -1;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      fitted[i] = hasZ ? (hasP ? z / p : z / Math.max(1, i)) : 0;
    }
    if (H[i] > 0) {
      if (!hasZ) {
        z = H[i];
        hasZ = true;
      } else {
        const gap = i - lastNonzeroIdx;
        if (!hasP) {
          p = gap;
          hasP = true;
        } else {
          p = a * gap + (1 - a) * p;
        }
        z = a * H[i] + (1 - a) * z;
      }
      lastNonzeroIdx = i;
    }
  }
  const effectiveP = hasP ? p : hasZ ? Math.max(1, n) : 0;
  const fc = hasZ && effectiveP > 0 ? z / effectiveP : 0;
  const horizon = clamp(Number(opts.horizon) || 12, 1, 60);
  return {
    model: 'Croston',
    label: `Croston (α=${a.toFixed(2)})`,
    short: 'CRO',
    color: METHOD_COLORS.croston,
    fitted,
    forecast: new Array(horizon).fill(fc),
    components: { zHat: z, pHat: effectiveP, forecast: fc },
  };
}

export function sbaMethod(history: ReadonlyArray<number>, opts: ForecastMethodOpts = {}): ForecastOutput {
  const H = toSeries(history);
  const n = H.length;
  const a = clamp(Number(opts.alpha) || 0.3, 0.01, 0.99);
  const factor = 1 - a / 2;
  const fitted: (number | null)[] = new Array(n).fill(null);
  let hasZ = false;
  let hasP = false;
  let z = 0;
  let p = 0;
  let lastNonzeroIdx = -1;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      fitted[i] = hasZ ? factor * (hasP ? z / p : z / Math.max(1, i)) : 0;
    }
    if (H[i] > 0) {
      if (!hasZ) {
        z = H[i];
        hasZ = true;
      } else {
        const gap = i - lastNonzeroIdx;
        if (!hasP) {
          p = gap;
          hasP = true;
        } else {
          p = a * gap + (1 - a) * p;
        }
        z = a * H[i] + (1 - a) * z;
      }
      lastNonzeroIdx = i;
    }
  }
  const effectiveP = hasP ? p : hasZ ? Math.max(1, n) : 0;
  const fc = hasZ && effectiveP > 0 ? factor * (z / effectiveP) : 0;
  const horizon = clamp(Number(opts.horizon) || 12, 1, 60);
  return {
    model: 'SBA',
    label: `SBA (α=${a.toFixed(2)})`,
    short: 'SBA',
    color: METHOD_COLORS.sba,
    fitted,
    forecast: new Array(horizon).fill(Math.max(0, fc)),
    components: { zHat: z, pHat: effectiveP, factor, forecast: Math.max(0, fc) },
  };
}

export function naiveMethod(history: ReadonlyArray<number>, opts: ForecastMethodOpts = {}): ForecastOutput {
  const H = toSeries(history);
  const n = H.length;
  if (n === 0) return { model: 'Naive', label: 'Naive (last)', short: 'NAIVE', color: METHOD_COLORS.naive, fitted: [], forecast: [] };
  const fitted: (number | null)[] = new Array(n).fill(null);
  for (let k = 1; k < n; k++) fitted[k] = H[k - 1];
  const horizon = clamp(Number(opts.horizon) || 12, 1, 60);
  return {
    model: 'Naive',
    label: 'Naive (last)',
    short: 'NAIVE',
    color: METHOD_COLORS.naive,
    fitted,
    forecast: new Array(horizon).fill(H[n - 1]),
    components: { last: H[n - 1] },
  };
}

export function meanBaseline(history: ReadonlyArray<number>, opts: ForecastMethodOpts = {}): ForecastOutput {
  const H = toSeries(history);
  const n = H.length;
  const mu = n > 0 ? mean(H) : 0;
  const horizon = clamp(Number(opts.horizon) || 12, 1, 60);
  return {
    model: 'HistoricalMean',
    label: 'Mean of history',
    short: 'MEAN',
    color: METHOD_COLORS.avg,
    fitted: new Array(n).fill(null),
    forecast: new Array(horizon).fill(mu),
    components: { mean: mu },
  };
}

/* ---------- Accuracy & Backtesting ---------- */

export interface AccuracyMetrics {
  n: number;
  mae: number | null;
  rmse: number | null;
  mape: number | null;
  smape: number | null;
  wape: number | null;
  bias: number | null;
  absBias: number | null;
}

export function accuracyMetrics(
  actual: ReadonlyArray<number>,
  fitted: ReadonlyArray<number | null>,
  horizon = 0
): AccuracyMetrics {
  const n = Math.min(actual.length, fitted.length);
  const start = horizon > 0 ? horizon : 0;
  let ae = 0;
  let se = 0;
  let err = 0;
  let errAbs = 0;
  let count = 0;
  let apeSum = 0;
  let apeDen = 0;
  let smapeSum = 0;
  let smapeN = 0;
  let sumA = 0;
  let sumAE = 0;
  for (let i = start; i < n; i++) {
    const a = actual[i];
    const f = fitted[i];
    if (a != null && Number.isFinite(a) && f != null && Number.isFinite(f)) {
      const e = a - f;
      ae += Math.abs(e);
      se += e * e;
      err += e;
      errAbs += Math.abs(e);
      sumA += Math.abs(a);
      sumAE += Math.abs(e);
      if (Math.abs(a) > 1e-9) {
        apeSum += Math.abs(e / a);
        apeDen++;
      }
      if (Math.abs(a) + Math.abs(f) > 1e-9) {
        smapeSum += (2 * Math.abs(a - f)) / (Math.abs(a) + Math.abs(f));
        smapeN++;
      }
      count++;
    }
  }
  return {
    n: count,
    mae: count > 0 ? ae / count : null,
    rmse: count > 0 ? Math.sqrt(se / count) : null,
    mape: apeDen > 0 ? (apeSum / apeDen) * 100 : null,
    smape: smapeN > 0 ? (smapeSum / smapeN) * 100 : null,
    wape: sumA > 1e-9 ? (sumAE / sumA) * 100 : null,
    bias: count > 0 ? err / count : null,
    absBias: count > 0 ? errAbs / count : null,
  };
}

export function mase(
  forecast: ReadonlyArray<number>,
  actual: ReadonlyArray<number>,
  period = 1,
  train?: ReadonlyArray<number>
): number | null {
  const n = Math.min(forecast.length, actual.length);
  if (n === 0) return null;
  const p = Math.max(1, Math.round(Number(period) || 1));
  let aeMethod = 0;
  for (let i = 0; i < n; i++) aeMethod += Math.abs(forecast[i] - actual[i]);
  const maeMethod = aeMethod / n;
  const ref = Array.isArray(train) && train.length ? train : actual;
  if (ref.length < p + 1) return null;
  let aeBase = 0;
  let nBase = 0;
  for (let i = p; i < ref.length; i++) {
    aeBase += Math.abs(ref[i] - ref[i - p]);
    nBase++;
  }
  if (nBase === 0) return null;
  const maeBase = aeBase / nBase;
  if (maeBase < 1e-12) return null;
  return maeMethod / maeBase;
}

export function backtestForecast(
  history: ReadonlyArray<number>,
  opts: {
    method?: (h: ReadonlyArray<number>, p?: ForecastMethodOpts) => ForecastOutput;
    params?: ForecastMethodOpts;
    trainWindow?: { type?: 'expanding' | 'rolling'; minSize?: number; maxSize?: number };
    horizon?: number;
    step?: number;
    holdout?: number;
  } = {}
) {
  const H = toSeries(history);
  const n = H.length;
  if (n < 4) return { origins: [], metrics: null as AccuracyMetrics | null, naiveBenchmarks: null, perHorizon: [], summary: null };

  const method = opts.method || smaMethod;
  const params = opts.params || {};
  const trainType = opts.trainWindow?.type === 'rolling' ? 'rolling' : 'expanding';
  const minSize = Math.max(2, Number(opts.trainWindow?.minSize) || 4);
  const maxSize = Number(opts.trainWindow?.maxSize) || Infinity;
  const horizon = Math.max(1, Number(opts.horizon) || 3);
  const step = Math.max(1, Number(opts.step) || 1);
  const holdout = Math.max(0, Number(opts.holdout) || 0);

  const origins: {
    originIndex: number;
    trainStart: number;
    trainEnd: number;
    trainSize: number;
    testStart: number;
    testEnd: number;
    testActual: number[];
    pred: (number | null)[];
    naivePred: number[];
    model: ForecastOutput;
  }[] = [];

  let originIdx = minSize;
  while (originIdx + horizon <= n - holdout) {
    const trainEnd = originIdx - 1;
    const trainStart = trainType === 'rolling' && maxSize < Infinity ? Math.max(0, originIdx - maxSize) : 0;
    const train = H.slice(trainStart, trainEnd + 1);
    const testActual = H.slice(originIdx, Math.min(originIdx + horizon, n));
    const model = method(train, { ...params, horizon });
    const pred = model.forecast.slice(0, testActual.length);
    const predAligned: (number | null)[] = testActual.map((_, i) => (i < pred.length ? pred[i] : null));
    const naivePred = new Array<number>(testActual.length).fill(train[train.length - 1] || 0);
    origins.push({
      originIndex: originIdx,
      trainStart,
      trainEnd,
      trainSize: train.length,
      testStart: originIdx,
      testEnd: originIdx + testActual.length - 1,
      testActual,
      pred: predAligned,
      naivePred,
      model,
    });
    originIdx += step;
  }

  if (origins.length === 0) return { origins: [], metrics: null, naiveBenchmarks: null, perHorizon: [], summary: null };

  const allPred: number[] = [];
  const allActual: number[] = [];
  const allNaive: number[] = [];
  const perHorizon = [];

  for (let hp = 0; hp < horizon; hp++) {
    const hPred: number[] = [];
    const hActual: number[] = [];
    const hNaive: number[] = [];
    for (const o of origins) {
      const pv = o.pred[hp];
      const av = o.testActual[hp];
      if (pv != null && av != null && Number.isFinite(pv) && Number.isFinite(av)) {
        hPred.push(pv);
        hActual.push(av);
        hNaive.push(o.naivePred[hp]);
      }
    }
    perHorizon.push({
      horizon: hp + 1,
      mad: hPred.length ? mad(hPred.map((p, i) => p - hActual[i])) : null,
      madNaive: hNaive.length ? mad(hNaive.map((p, i) => p - hActual[i])) : null,
      rmse: hPred.length ? Math.sqrt(mean(hPred.map((p, i) => (p - hActual[i]) ** 2))) : null,
      n: hPred.length,
    });
  }

  for (const o of origins) {
    for (let hp = 0; hp < o.pred.length; hp++) {
      const pv = o.pred[hp];
      const av = o.testActual[hp];
      if (pv != null && av != null && Number.isFinite(pv) && Number.isFinite(av)) {
        allPred.push(pv);
        allActual.push(av);
        allNaive.push(o.naivePred[hp]);
      }
    }
  }

  return {
    origins,
    metrics: accuracyMetrics(allActual, allPred),
    naiveBenchmarks: { overall: accuracyMetrics(allActual, allNaive) },
    perHorizon,
    summary: { nOrigins: origins.length, trainType, horizon, step, minTrainSize: minSize },
  };
}

export function compareMethods(
  history: ReadonlyArray<number>,
  methodSpecs: MethodSpec[],
  opts: { horizon?: number; minTrainSize?: number; trainWindow?: { type?: 'expanding' | 'rolling'; minSize?: number; maxSize?: number } } = {}
) {
  const H = toSeries(history);
  const baselineSpecs: MethodSpec[] = [
    { name: 'Naive (last)', shortKey: 'naive', method: naiveMethod },
    { name: 'Mean of history', shortKey: 'avg', method: meanBaseline },
  ];
  const allSpecs = [...baselineSpecs, ...methodSpecs];
  const trainWindow = opts.trainWindow || { type: 'expanding', minSize: opts.minTrainSize || 4 };

  const results = allSpecs.map((spec) => {
    const bt = backtestForecast(H, {
      method: spec.method,
      params: spec.params || {},
      horizon: opts.horizon || 3,
      trainWindow,
      step: 1,
    });
    const m: AccuracyMetrics = bt.metrics || {
      n: 0,
      mae: null,
      rmse: null,
      mape: null,
      smape: null,
      wape: null,
      bias: null,
      absBias: null,
    };
    return {
      name: spec.name,
      shortKey: spec.shortKey || spec.name.toLowerCase(),
      method: spec.method,
      params: spec.params || {},
      metrics: m,
      perHorizon: bt.perHorizon || [],
      summary: bt.summary,
      origins: bt.origins,
      color: (spec.shortKey && METHOD_COLORS[spec.shortKey]) || '#64748b',
    };
  });

  const val = (a: number | null, b: number | null) =>
    a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a - b;
  const ranked = results
    .slice()
    .sort(
      (a, b) =>
        val(a.metrics.wape, b.metrics.wape) ||
        val(a.metrics.rmse, b.metrics.rmse) ||
        val(a.metrics.mae, b.metrics.mae) ||
        val(a.metrics.smape, b.metrics.smape)
    );
  return {
    methods: results,
    best: ranked[0] || null,
    bestBy: 'WAPE (tie-broken RMSE / MAE / sMAPE)',
  };
}

export function forecastProfile(
  history: ReadonlyArray<number>,
  method: (h: ReadonlyArray<number>, p?: ForecastMethodOpts) => ForecastOutput,
  params: ForecastMethodOpts = {},
  horizon = 12
) {
  const H = toSeries(history);
  if (!H.length) return null;
  const model = method(H, { ...params, horizon });
  const fitted = Array.isArray(model.fitted) ? model.fitted : new Array(H.length).fill(null);
  const forecast = Array.isArray(model.forecast) ? model.forecast.slice(0, horizon) : [];

  const intervals: ({ lower: number; upper: number; sd: number; z: number; level: number } | null)[] = [];
  const validFitted = fitted
    .map((v, i) => ({ v, a: H[i] }))
    .filter((d): d is { v: number; a: number } => d.v != null && Number.isFinite(d.v) && Number.isFinite(d.a));

  if (validFitted.length >= 4) {
    const errors = validFitted.map((d) => d.a - d.v);
    const sd = stdevFrom(errors);
    const z = 1.96;
    for (let h = 0; h < forecast.length; h++) {
      const f = forecast[h];
      if (f != null && Number.isFinite(f) && sd > 1e-9) {
        const horizonSd = sd * Math.sqrt(1 + 0.08 * h);
        intervals.push({
          lower: Math.max(0, f - z * horizonSd),
          upper: f + z * horizonSd,
          sd: horizonSd,
          z,
          level: 0.95,
        });
      } else {
        intervals.push(null);
      }
    }
  } else {
    for (let h = 0; h < forecast.length; h++) intervals.push(null);
  }

  return {
    fitted,
    forecast,
    intervals,
    method: model.model,
    label: model.label,
    components: model.components || {},
  };
}

export function classifyDemand(history: ReadonlyArray<number>, m = 12) {
  const H = toSeries(history);
  const n = H.length;
  if (n === 0) {
    return { type: 'unknown', ac: null as 'A' | 'B' | 'C' | null, pdt: 0, cv: 0, trended: false, seasonal: false, slope: 0, mean: 0, sd: 0 };
  }
  const hMean = mean(H);
  const sd = stdevFrom(H);
  const cv = hMean > 0 ? sd / hMean : Infinity;
  const pdt = H.filter((v) => v > 0).length / n;
  const slope = n > 1 ? linregSlope(H) : 0;
  const trended = Math.abs(slope) / (hMean || 1) > 0.025;
  const seasonal = n >= m * 2 ? detectSeasonality(H, m) : false;

  let type: string;
  let ac: 'A' | 'B' | 'C';
  if (pdt < 0.5) {
    if (cv < 0.5) {
      type = 'intermittent-smooth';
      ac = 'A';
    } else if (cv < 1.0) {
      type = 'intermittent';
      ac = 'B';
    } else {
      type = 'lumpy-intermittent';
      ac = 'C';
    }
  } else {
    if (cv < 0.1) {
      type = 'smooth';
      ac = 'A';
    } else if (cv < 0.5) {
      type = 'erratic';
      ac = 'B';
    } else {
      type = 'erratic-high-CV';
      ac = 'C';
    }
  }
  if (seasonal && pdt >= 0.5) type = type.includes('smooth') ? 'seasonal-smooth' : 'seasonal-erratic';
  else if (trended && !seasonal && pdt >= 0.5) type = type.includes('smooth') ? 'trend-smooth' : 'trend-erratic';

  return { type, ac, pdt, cv, trended, seasonal, slope, mean: hMean, sd };
}

export function recommendForecast(
  history: ReadonlyArray<number>,
  methodSpecs: MethodSpec[],
  opts: { horizon?: number; minTrainSize?: number; seasonPeriod?: number } = {}
) {
  const H = toSeries(history);
  if (!H.length) {
    return { recommendation: null, reason: 'No demand history.', classification: null, confidence: 0, methods: [], bestMethod: null };
  }
  const minSize = opts.minTrainSize !== undefined ? opts.minTrainSize : Math.min(12, Math.max(4, H.length - 4));
  const comparison = compareMethods(H, methodSpecs, {
    horizon: opts.horizon || 3,
    minTrainSize: minSize,
    trainWindow: { type: 'expanding', minSize },
  });
  const classification = classifyDemand(H, opts.seasonPeriod || 12);
  const best = comparison.best;
  if (!best || (best.metrics.wape == null && best.metrics.mae == null)) {
    return {
      recommendation: 'No reliable method selected — insufficient history.',
      reason: 'Need at least 6–8 demand periods to run rolling-origin cross-validation.',
      confidence: 0,
      methods: comparison.methods,
      classification,
      bestMethod: null,
    };
  }
  const bestWape = best.metrics.wape;
  if (bestWape == null) {
    return {
      recommendation: best.name,
      reason: 'All historical demand values across evaluation origins are zero — zero forecast achieves 0.00 MAE.',
      confidence: H.length >= 12 ? 0.7 : 0.45,
      methods: comparison.methods,
      classification,
      bestMethod: best,
    };
  }

  const naWape = comparison.methods.find((m) => m.name === 'Naive (last)')?.metrics.wape;
  const parts: string[] = [];
  let confidence = 0.5;
  if (naWape != null && bestWape < naWape) {
    const improvement = (naWape - bestWape) / naWape;
    confidence = clamp(0.45 + 0.4 * improvement, 0.25, 0.92);
    parts.push(
      `Outperforms naive baseline by ${Math.round(improvement * 100)}% on WAPE (${bestWape.toFixed(1)}% vs ${naWape.toFixed(1)}%).`
    );
  } else {
    parts.push(`Performs comparably to naive baseline (WAPE ${bestWape.toFixed(1)}%).`);
    confidence = 0.35;
  }
  if (H.length >= 24) confidence = clamp(confidence + 0.08, 0, 1);
  if (classification.pdt < 0.5) {
    parts.push('Demand is intermittent — Croston/SBA estimators separate demand size from inter-arrival intervals.');
  }
  if (classification.seasonal) {
    parts.push('Significant seasonal autocorrelation detected across historical cycles.');
  }
  if (classification.trended) {
    parts.push('Directional trend present — trend-aware smoothing tracks slope shifts.');
  }

  return {
    recommendation: best.name,
    reason: parts.join(' '),
    confidence,
    methods: comparison.methods,
    classification,
    bestMethod: best,
  };
}

function mulberry32Fc(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function generateDemandDataset(
  pattern: 'stationary' | 'trend' | 'seasonal' | 'intermittent' | 'structural-break',
  opts: { n?: number; base?: number; noise?: number; seed?: number } = {}
): { history: number[]; meta: { pattern: string; n: number; base: number } } {
  const n = Math.max(6, Number(opts.n) || 36);
  const base = Number(opts.base) || 120;
  const noise = Number(opts.noise) || 9;
  const rng = mulberry32Fc(opts.seed || 42);
  const history = new Array<number>(n);

  switch (pattern) {
    case 'stationary':
      for (let i = 0; i < n; i++) history[i] = Math.max(1, Math.round(base + gauss(rng) * noise));
      break;
    case 'trend':
      for (let i = 0; i < n; i++) history[i] = Math.max(1, Math.round(base * (1 + 0.035 * i) + gauss(rng) * noise));
      break;
    case 'seasonal':
      for (let i = 0; i < n; i++) {
        const seasonal = Math.sin((i / 12) * 2 * Math.PI) * 0.32;
        history[i] = Math.max(1, Math.round(base * (1 + seasonal) + gauss(rng) * noise * 0.5));
      }
      break;
    case 'intermittent':
      for (let i = 0; i < n; i++) {
        history[i] = rng() < 0.32 ? Math.max(1, Math.round(85 * (0.4 + 1.2 * rng()))) : 0;
      }
      break;
    case 'structural-break':
      for (let i = 0; i < n; i++) {
        const lev = i < Math.floor(n / 2) ? base : base * 1.55;
        history[i] = Math.max(1, Math.round(lev + gauss(rng) * noise));
      }
      break;
  }

  return { history, meta: { pattern, n, base } };
}
