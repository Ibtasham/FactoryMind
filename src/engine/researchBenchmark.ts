/**
 * Research Lab Benchmark Engine
 * Decoupled, deterministic cross-series forecasting evaluation, metric validation,
 * causal future-leakage verification, provenance classification, and reproducible
 * benchmark artifact generation & replay verification.
 */

import {
  AccuracyMetrics,
  backtestForecast,
  crostonMethod,
  emaMethod,
  ForecastOutput,
  generateDemandDataset,
  holtLinear,
  hwAdditive,
  hwMultiplicative,
  linregMethod,
  meanBaseline,
  MethodSpec,
  naiveMethod,
  sbaMethod,
  seasonalNaive,
  smaMethod,
  wmaMethod,
} from './forecast';

export type ResearchProvenanceClass =
  | 'illustrative-catalogue'
  | 'user-imported'
  | 'synthetic-generated'
  | 'external-dataset';

export type SyntheticPattern =
  | 'stationary'
  | 'trend'
  | 'seasonal'
  | 'intermittent'
  | 'structural-break';

export type CohortScope = 'all' | 'catalogue' | 'synthetic' | 'external';
export type TrainWindowType = 'expanding' | 'rolling';

export interface BenchmarkConfig {
  seed: number;
  cohortScope: CohortScope;
  trainWindowType: TrainWindowType;
  skuHorizon: number;
  synthHorizon: number;
  minSynthTrainSize: number;
  rollingMaxTrain: number;
  synthLength: number;
  synthBase: number;
  synthNoise: number;
  maWindow: number;
  alpha: number;
  beta: number;
  gamma: number;
  seasonPeriod: number;
  minSeriesLength: number;
}

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  seed: 42,
  cohortScope: 'all',
  trainWindowType: 'expanding',
  skuHorizon: 2,
  synthHorizon: 3,
  minSynthTrainSize: 12,
  rollingMaxTrain: 12,
  synthLength: 36,
  synthBase: 120,
  synthNoise: 9,
  maWindow: 3,
  alpha: 0.3,
  beta: 0.1,
  gamma: 0.2,
  seasonPeriod: 12,
  minSeriesLength: 6,
};

export const SYNTHETIC_PATTERNS: SyntheticPattern[] = [
  'stationary',
  'trend',
  'seasonal',
  'intermittent',
  'structural-break',
];

export interface ResearchProductInput {
  id?: string;
  sku: string;
  name?: string;
  category?: string;
  unit?: string;
  demandHistory: ReadonlyArray<number>;
  demandSource?: 'demo' | 'user' | 'imported' | 'synthetic' | 'external';
}

export interface ExternalSeriesInput {
  id: string;
  label: string;
  unit?: string;
  history: number[];
  note?: string;
}

export interface SeriesDescriptor {
  id: string;
  label: string;
  subLabel: string;
  provenanceClass: ResearchProvenanceClass;
  provenanceLabel: string;
  rawDemandSource: string;
  unit: string;
  history: number[];
  checksum: string;
  horizon: number;
  minTrainSize: number;
  effectiveSeasonPeriod: number;
  zeroCount: number;
  meanDemand: number;
  cv: number;
  generatorSpec?: {
    prng: 'mulberry32';
    seed: number;
    pattern: SyntheticPattern;
    n: number;
    base: number;
    noise: number;
  };
}

export interface ExcludedSeriesRecord {
  id: string;
  label: string;
  provenanceClass: ResearchProvenanceClass;
  length: number;
  reason: string;
}

export interface OriginAuditRecord {
  originIndex: number;
  trainStart: number;
  trainEnd: number;
  trainSize: number;
  testStart: number;
  testEnd: number;
  testActual: number[];
  naivePred: number[];
  trainNaiveMae: number | null;
  bestPred: (number | null)[];
  baselinePred: (number | null)[];
}

export interface PerSeriesMethodEvaluation {
  name: string;
  shortKey: string;
  metrics: AccuracyMetrics;
  mase: number | null;
  mapeValidPoints: number;
  zeroActualPoints: number;
  nOrigins: number;
  rank: number | null;
  degradedVariant: boolean;
  lastModelTag: string;
}

export interface PerSeriesResult {
  series: SeriesDescriptor;
  bestMethodName: string | null;
  bestBy: string;
  methods: PerSeriesMethodEvaluation[];
  originsAudit: OriginAuditRecord[];
  allOriginsNonOverlapping: boolean;
}

export interface AggregateMethodRow {
  name: string;
  shortKey: string;
  avgWape: number | null;
  medianWape: number | null;
  q1Wape: number | null;
  q3Wape: number | null;
  iqrWape: number | null;
  sdWape: number | null;
  minWape: number | null;
  maxWape: number | null;
  avgRmse: number | null;
  avgMae: number | null;
  avgMase: number | null;
  avgSmape: number | null;
  avgMape: number | null;
  avgBias: number | null;
  meanRank: number | null;
  wins: number;
  seriesCount: number;
  totalPoints: number;
  degradedSeriesCount: number;
}

export interface LeakageAuditSummary {
  passed: boolean;
  verifiedSeriesCount: number;
  verifiedOriginsCount: number;
  perturbationSeriesId: string | null;
  perturbationModelsTested: number;
  maxFuturePerturbationDelta: number;
  leakedModels: string[];
  zeroLeakageInMaseDenominator: boolean;
  notes: string[];
}

export interface ProvenanceCounts {
  'illustrative-catalogue': number;
  'user-imported': number;
  'synthetic-generated': number;
  'external-dataset': number;
}

export interface ResearchBenchmarkResult {
  config: BenchmarkConfig;
  includedSeries: SeriesDescriptor[];
  excludedSeries: ExcludedSeriesRecord[];
  provenanceCountsAllWorkspaceAndSynth: ProvenanceCounts;
  provenanceCountsEvaluated: ProvenanceCounts;
  perSeries: PerSeriesResult[];
  leaderboardAll: AggregateMethodRow[];
  leaderboardWorkspace: AggregateMethodRow[];
  leaderboardSynthetic: AggregateMethodRow[];
  leaderboardExternal: AggregateMethodRow[];
  leakageAudit: LeakageAuditSummary;
  checksums: {
    configChecksum: string;
    datasetChecksum: string;
    resultsChecksum: string;
  };
}

export interface ForecastAlgorithmDoc {
  shortKey: string;
  name: string;
  family: 'Baseline' | 'Moving Average' | 'Exponential Smoothing' | 'Seasonal' | 'Regression' | 'Intermittent';
  formula: string;
  initialization: string;
  hyperparameters: string;
  bestFor: string;
  limitations: string;
}

export interface ForecastMetricDoc {
  id: string;
  name: string;
  formula: string;
  units: string;
  interpretation: string;
  caveats: string;
}

export interface BenchmarkLimitationDoc {
  id: string;
  title: string;
  detail: string;
}

export const FORECAST_ALGORITHM_DOCS: ForecastAlgorithmDoc[] = [
  {
    shortKey: 'naive',
    name: 'Naive (last)',
    family: 'Baseline',
    formula: 'ŷ_{t+h|t} = y_t (random-walk persistence forecast for all h ≥ 1)',
    initialization: 'Fitted values start at k = 1 with ŷ_k = y_{k-1}.',
    hyperparameters: 'None (zero free parameters)',
    bestFor: 'Random-walk demand benchmarks and strict lower-bound skill comparison.',
    limitations: 'Ignores trends, seasonality, and carries transient outliers directly into all future steps.',
  },
  {
    shortKey: 'avg',
    name: 'Mean of history',
    family: 'Baseline',
    formula: 'ŷ_{t+h|t} = (1/t) · Σ_{i=1..t} y_i',
    initialization: 'Computes unweighted sample arithmetic mean of the training window.',
    hyperparameters: 'None (zero free parameters)',
    bestFor: 'Purely stationary i.i.d. series with constant mean and no structural drift.',
    limitations: 'Very slow to adapt after level shifts, step changes, trends, or cycles; no in-sample lag fit.',
  },
  {
    shortKey: 'sma',
    name: 'SMA (w)',
    family: 'Moving Average',
    formula: 'ŷ_{t+h|t} = (1/w) · Σ_{i=0..w-1} y_{t-i}',
    initialization: 'Clamps w to [2, n_train]; fitted values defined for k ≥ w.',
    hyperparameters: 'Window length w (default 3)',
    bestFor: 'Stationary noisy demand needing symmetric smoothing over recent periods.',
    limitations: 'Constant flat multi-step forecast; lags behind persistent directional trends by (w − 1)/2 steps.',
  },
  {
    shortKey: 'wma',
    name: 'WMA (w)',
    family: 'Moving Average',
    formula: 'ŷ_{t+h|t} = Σ_{i=1..w} [2i / (w(w+1))] · y_{t-w+i}',
    initialization: 'Linearly increasing weights (1, 2, …, w) normalized to sum to 1; falls back to mean if n_train < w.',
    hyperparameters: 'Window length w (default 3)',
    bestFor: 'Level-shifting stationary series where the most recent observations carry higher signal.',
    limitations: 'Does not extrapolate trend slope beyond the last weighted average; ignores seasonality.',
  },
  {
    shortKey: 'ema',
    name: 'SES (α)',
    family: 'Exponential Smoothing',
    formula: 's_k = α·y_k + (1 − α)·s_{k-1},   ŷ_{t+h|t} = s_t',
    initialization: 'Level initialized at s_0 = y_0; geometric decay over infinite past.',
    hyperparameters: 'Level smoothing α ∈ [0.01, 0.99] (default 0.30)',
    bestFor: 'Stationary series with gradual level drift and moderate observation noise.',
    limitations: 'Flat horizon forecast; systematically lags linear trends unless α → 1.',
  },
  {
    shortKey: 'holt',
    name: 'Holt Linear',
    family: 'Exponential Smoothing',
    formula: 'ℓ_k = α·y_k + (1−α)(ℓ_{k-1}+b_{k-1});  b_k = β(ℓ_k−ℓ_{k-1}) + (1−β)b_{k-1};  ŷ_{t+h|t} = max(0, ℓ_t + h·b_t)',
    initialization: 'ℓ_0 = y_0, b_0 = y_1 − y_0 (0 if n_train = 1).',
    hyperparameters: 'α (level, default 0.30), β (trend, default 0.10)',
    bestFor: 'Trending non-seasonal industrial demand with smooth slope changes.',
    limitations: 'Linear trend is undamped and can overshoot at long horizons; sensitive to noisy initial slope y_1 − y_0.',
  },
  {
    shortKey: 'hwa',
    name: 'Holt-Winters Add',
    family: 'Seasonal',
    formula: 'ℓ_k = α(y_k−s_{k-p})+(1−α)(ℓ_{k-1}+b_{k-1});  b_k = β(ℓ_k−ℓ_{k-1})+(1−β)b_{k-1};  s_k = γ(y_k−ℓ_k)+(1−γ)s_{k-p}',
    initialization: 'Uses 2-cycle seasonal means & zero-sum centered indices when n_train ≥ 2p; single-cycle deviations when p ≤ n_train < 2p; zero seasonal indices when n_train < p.',
    hyperparameters: 'α, β, γ, seasonal period p = min(seasonPeriod, max(2, floor(n/2)))',
    bestFor: 'Constant-amplitude additive seasonality combined with trend.',
    limitations: 'Needs n_train ≥ 2p for stable seasonal initialization; short training windows under-estimate seasonal amplitude.',
  },
  {
    shortKey: 'hwm',
    name: 'Holt-Winters Mult',
    family: 'Seasonal',
    formula: 'ℓ_k = α(y_k/s_{k-p})+(1−α)(ℓ_{k-1}+b_{k-1});  s_k = γ(y_k/ℓ_k)+(1−γ)s_{k-p};  ŷ = max(0, (ℓ_t+h·b_t)·s_{t+h-p})',
    initialization: 'Normalized unit-mean seasonal ratios refined via deseasonalized Season 0 mean. Automatically degrades to Holt-Winters Additive ("HWMultiplicative-degraded") if any y_k ≤ 0.',
    hyperparameters: 'α, β, γ, seasonal period p',
    bestFor: 'Proportional seasonality where peak swings scale with demand level.',
    limitations: 'Undefined for zero/negative observations (triggers additive fallback on intermittent SKUs); sensitive to small denominators.',
  },
  {
    shortKey: 'sn',
    name: 'Seasonal Naive',
    family: 'Seasonal',
    formula: 'ŷ_{t+h|t} = y_{t + ((h − 1) mod p) + 1 − p}',
    initialization: 'Reads exact prior cycle lag p; falls back to y_t when n_train < p.',
    hyperparameters: 'Seasonal period p',
    bestFor: 'Strong repeating calendar seasonality with minimal level drift.',
    limitations: 'Zero trend adaptability; propagates one-off prior-season anomalies verbatim.',
  },
  {
    shortKey: 'lin',
    name: 'Linear Trend',
    family: 'Regression',
    formula: 'ŷ_{t+h|t} = max(0, a + b·(t − 1 + h)) fitted via Ordinary Least Squares on k = 0..t−1',
    initialization: 'Closed-form OLS normal equations on index time k; flat y_0 if n_train < 2.',
    hyperparameters: 'None (exact closed-form OLS fit)',
    bestFor: 'Global monotonic linear growth or decline across the full training history.',
    limitations: 'Weights oldest points equally with newest; severe bias after structural level breaks.',
  },
  {
    shortKey: 'croston',
    name: 'Croston',
    family: 'Intermittent',
    formula: 'On y_k > 0: z_k = α·y_k + (1−α)·z_{k-1},  p_k = α·q_k + (1−α)·p_{k-1};  ŷ = z_t / p_t',
    initialization: 'First non-zero demand sets z; second sets inter-arrival interval p (fallback max(1, n_train) if single spike).',
    hyperparameters: 'Smoothing α (default 0.30)',
    bestFor: 'Sparse spare-parts / maintenance SKUs with frequent zero-demand periods.',
    limitations: 'Known upward bias on positive demand rate (SBA corrects by 1 − α/2); assumes independent stationary arrivals.',
  },
  {
    shortKey: 'sba',
    name: 'SBA',
    family: 'Intermittent',
    formula: 'ŷ_{t+h|t} = (1 − α/2) · (z_t / p_t)  (Syntetos–Boylan Approximation)',
    initialization: 'Identical non-zero / interval recursion as Croston, scaled by bias-correction factor (1 − α/2).',
    hyperparameters: 'Smoothing α (default 0.30)',
    bestFor: 'Intermittent and lumpy demand where standard Croston systematically over-forecasts.',
    limitations: 'Constant rate output; does not model trend, seasonality, or obsolescence after long zero runs.',
  },
];

export const FORECAST_METRIC_DOCS: ForecastMetricDoc[] = [
  {
    id: 'wape',
    name: 'WAPE (%) — Primary Ranking Metric',
    formula: 'WAPE = 100 · (Σ |y_i − ŷ_i|) / (Σ |y_i|)',
    units: '% (dimensionless scale-free per series)',
    interpretation: 'Total absolute error divided by total actual demand across all evaluation points. Lower is better; 0% is exact.',
    caveats: 'Undefined when Σ|y_i| = 0 (all zero actuals across every test window). Gives higher influence to larger-volume test windows within a series.',
  },
  {
    id: 'mase',
    name: 'MASE — Mean Absolute Scaled Error',
    formula: 'MASE = mean(|y_i − ŷ_i|) / MAE_naive,in-sample(train)',
    units: 'Dimensionless ratio vs 1-step in-sample naive error',
    interpretation: 'Values < 1.00 mean the model beats an in-sample random walk computed strictly on each origin’s training slice.',
    caveats: 'Computed per origin using ONLY past train observations to avoid future leakage; undefined if training history is flat (denominator = 0).',
  },
  {
    id: 'smape',
    name: 'sMAPE (%) — Symmetric MAPE',
    formula: 'sMAPE = (100 / N) · Σ [ 2·|y_i − ŷ_i| / (|y_i| + |ŷ_i|) ]',
    units: '% bounded in [0%, 200%]',
    interpretation: 'Treats positive/negative errors more symmetrically than MAPE while avoiding division by zero when either actual or prediction > 0.',
    caveats: 'Still undefined (excluded) if both y_i = 0 and ŷ_i = 0; slightly penalizes under-forecasts vs over-forecasts of equal magnitude.',
  },
  {
    id: 'mape',
    name: 'MAPE (%) — Non-Zero Periods Only',
    formula: 'MAPE = (100 / N_{y≠0}) · Σ_{y_i ≠ 0} |y_i − ŷ_i| / |y_i|',
    units: '% over non-zero actuals',
    interpretation: 'Standard percentage error when demand is strictly positive.',
    caveats: 'Skips any evaluation period where y_i = 0! On intermittent series, MAPE therefore evaluates a biased subset — inspect alongside WAPE and skipped zero counts.',
  },
  {
    id: 'rmse_mae',
    name: 'RMSE & MAE',
    formula: 'MAE = mean(|y_i − ŷ_i|),   RMSE = sqrt(mean((y_i − ŷ_i)²))',
    units: 'Original SKU demand units (e.g., pcs, m, kg)',
    interpretation: 'MAE measures typical error magnitude; RMSE penalizes large spike errors quadratically.',
    caveats: 'UNIT-DEPENDENT! When pooled across heterogeneous SKUs (e.g., 180k fasteners/yr vs 150 panels/yr), arithmetic mean RMSE/MAE is dominated by high-volume items. Use WAPE, MASE, or Mean Rank for cross-SKU comparisons.',
  },
  {
    id: 'bias',
    name: 'Mean Error / Bias',
    formula: 'Bias = (1 / N) · Σ (y_i − ŷ_i)',
    units: 'Original SKU demand units',
    interpretation: 'Signed error: Positive (+) indicates systematic under-forecasting (actual > forecast); Negative (−) indicates over-forecasting.',
    caveats: 'Unit-dependent when averaged across heterogeneous SKUs; opposite errors across periods can cancel near zero.',
  },
];

export const BENCHMARK_LIMITATIONS: BenchmarkLimitationDoc[] = [
  {
    id: 'fixed-params',
    title: 'Fixed Smoothing Hyperparameters (No Nested CV Tuning)',
    detail: 'All methods run with the single user-configured parameter tuple (w, α, β, γ, p) across every series rather than fitting per-SKU MLE parameters on validation folds. Tuned exponential smoothing can behave differently on series with extreme dynamics.',
  },
  {
    id: 'scale-mixing',
    title: 'Scale-Mixing When Pooling Unit-Dependent Errors',
    detail: 'Catalogue SKUs span orders of magnitude (e.g., ~180,000 nuts/yr vs ~150 assemblies/yr). Pooled arithmetic averages of RMSE, MAE, and Bias are mathematically dominated by high-volume SKUs; rely on dimensionless WAPE, Median WAPE, MASE, and Mean Rank for cross-SKU ranking.',
  },
  {
    id: 'short-catalogue',
    title: 'Short Illustrative Catalogue Series (n = 12)',
    detail: 'Preloaded illustrative catalogue SKUs contain 12 monthly points, so effective seasonal period p caps at min(seasonPeriod, floor(n/2)) = 6 and early expanding origins have fewer than 2p observations for full Holt-Winters cycle initialization.',
  },
  {
    id: 'hwm-fallback',
    title: 'Holt-Winters Multiplicative Zero Fallback',
    detail: 'When a training slice contains zeros or non-positive demand (such as the intermittent regime), Holt-Winters Multiplicative cannot divide by zero and automatically falls back to Holt-Winters Additive (tagged "HWMultiplicative-degraded" in diagnostics).',
  },
  {
    id: 'provenance-mix',
    title: 'No Pre-Bundled External Empirical Benchmarks',
    detail: 'FactoryMind ships zero external empirical datasets (e.g., M3/M4/M5 or live ERP feeds). Preloaded catalogue SKUs use deterministic seeded trajectories ("demo"), and synthetic suites use Mulberry32 + Box-Muller generators. Users must supply CSV/JSON or external series for real-plant validation.',
  },
  {
    id: 'no-significance-test',
    title: 'Descriptive Aggregation Without Hypothesis Testing',
    detail: 'Leaderboard ranks, WAPE IQR, and series wins summarize empirical backtest samples descriptively and do not run formal Diebold-Mariano or Friedman-Nemenyi statistical significance tests; small differences on < 20 series may fall within sampling noise.',
  },
];

export function fnv1aHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function classifyResearchProvenance(source?: string): {
  provenanceClass: ResearchProvenanceClass;
  provenanceLabel: string;
} {
  if (source === 'external') {
    return { provenanceClass: 'external-dataset', provenanceLabel: 'External Dataset' };
  }
  if (source === 'synthetic') {
    return { provenanceClass: 'synthetic-generated', provenanceLabel: 'Generated Synthetic' };
  }
  if (source === 'imported' || source === 'user') {
    return { provenanceClass: 'user-imported', provenanceLabel: 'User-Imported / Entered' };
  }
  return { provenanceClass: 'illustrative-catalogue', provenanceLabel: 'Illustrative Catalogue' };
}

export function buildBenchmarkMethodSpecs(seriesLen: number, cfg: BenchmarkConfig): MethodSpec[] {
  const p = Math.min(cfg.seasonPeriod, Math.max(2, Math.floor(seriesLen / 2)));
  return [
    { name: `SMA (w=${cfg.maWindow})`, shortKey: 'sma', method: smaMethod, params: { w: cfg.maWindow } },
    { name: `WMA (w=${cfg.maWindow})`, shortKey: 'wma', method: wmaMethod, params: { w: cfg.maWindow } },
    { name: `SES (α=${cfg.alpha.toFixed(2)})`, shortKey: 'ema', method: emaMethod, params: { alpha: cfg.alpha } },
    { name: 'Holt Linear', shortKey: 'holt', method: holtLinear, params: { alpha: cfg.alpha, beta: cfg.beta } },
    {
      name: 'Holt-Winters Add',
      shortKey: 'hwa',
      method: hwAdditive,
      params: { alpha: cfg.alpha, beta: cfg.beta, gamma: cfg.gamma, seasonPeriod: p },
    },
    {
      name: 'Holt-Winters Mult',
      shortKey: 'hwm',
      method: hwMultiplicative,
      params: { alpha: cfg.alpha, beta: cfg.beta, gamma: cfg.gamma, seasonPeriod: p },
    },
    { name: 'Seasonal Naive', shortKey: 'sn', method: seasonalNaive, params: { period: p } },
    { name: 'Linear Trend', shortKey: 'lin', method: linregMethod },
    { name: 'Croston', shortKey: 'croston', method: crostonMethod, params: { alpha: cfg.alpha } },
    { name: 'SBA', shortKey: 'sba', method: sbaMethod, params: { alpha: cfg.alpha } },
  ];
}

export function sanitizeBenchmarkConfig(raw: Partial<BenchmarkConfig> = {}): BenchmarkConfig {
  const intRange = (v: unknown, def: number, lo: number, hi: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
  };
  const floatRange = (v: unknown, def: number, lo: number, hi: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
  };
  const scope: CohortScope =
    raw.cohortScope === 'catalogue' || raw.cohortScope === 'synthetic' || raw.cohortScope === 'external'
      ? raw.cohortScope
      : 'all';
  const trainWindowType: TrainWindowType = raw.trainWindowType === 'rolling' ? 'rolling' : 'expanding';

  return {
    seed: intRange(raw.seed, DEFAULT_BENCHMARK_CONFIG.seed, 1, 999999999),
    cohortScope: scope,
    trainWindowType,
    skuHorizon: intRange(raw.skuHorizon, DEFAULT_BENCHMARK_CONFIG.skuHorizon, 1, 4),
    synthHorizon: intRange(raw.synthHorizon, DEFAULT_BENCHMARK_CONFIG.synthHorizon, 1, 6),
    minSynthTrainSize: intRange(raw.minSynthTrainSize, DEFAULT_BENCHMARK_CONFIG.minSynthTrainSize, 6, 24),
    rollingMaxTrain: intRange(raw.rollingMaxTrain, DEFAULT_BENCHMARK_CONFIG.rollingMaxTrain, 4, 24),
    synthLength: intRange(raw.synthLength, DEFAULT_BENCHMARK_CONFIG.synthLength, 18, 60),
    synthBase: floatRange(raw.synthBase, DEFAULT_BENCHMARK_CONFIG.synthBase, 20, 1000),
    synthNoise: floatRange(raw.synthNoise, DEFAULT_BENCHMARK_CONFIG.synthNoise, 0, 200),
    maWindow: intRange(raw.maWindow, DEFAULT_BENCHMARK_CONFIG.maWindow, 2, 12),
    alpha: floatRange(raw.alpha, DEFAULT_BENCHMARK_CONFIG.alpha, 0.05, 0.95),
    beta: floatRange(raw.beta, DEFAULT_BENCHMARK_CONFIG.beta, 0.05, 0.95),
    gamma: floatRange(raw.gamma, DEFAULT_BENCHMARK_CONFIG.gamma, 0.05, 0.95),
    seasonPeriod: intRange(raw.seasonPeriod, DEFAULT_BENCHMARK_CONFIG.seasonPeriod, 2, 24),
    minSeriesLength: intRange(raw.minSeriesLength, DEFAULT_BENCHMARK_CONFIG.minSeriesLength, 4, 24),
  };
}

function seriesStats(history: ReadonlyArray<number>): { zeroCount: number; meanDemand: number; cv: number } {
  const n = history.length;
  if (!n) return { zeroCount: 0, meanDemand: 0, cv: 0 };
  let sum = 0;
  let zeroCount = 0;
  for (let i = 0; i < n; i++) {
    sum += history[i];
    if (history[i] === 0) zeroCount++;
  }
  const mu = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (history[i] - mu) ** 2;
  const sd = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
  return {
    zeroCount,
    meanDemand: mu,
    cv: mu > 1e-9 ? sd / mu : 0,
  };
}

function computeTrainNaiveMae(trainSlice: ReadonlyArray<number>): number | null {
  if (trainSlice.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < trainSlice.length; i++) {
    sum += Math.abs(trainSlice[i] - trainSlice[i - 1]);
  }
  const maeVal = sum / (trainSlice.length - 1);
  return maeVal > 1e-12 ? maeVal : null;
}

function quantile(sorted: ReadonlyArray<number>, q: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

function stdevSample(vals: ReadonlyArray<number>): number | null {
  if (vals.length < 2) return vals.length === 1 ? 0 : null;
  const m = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sq = vals.reduce((s, v) => s + (v - m) ** 2, 0);
  return Math.sqrt(sq / (vals.length - 1));
}

function evaluateSeries(desc: SeriesDescriptor, cfg: BenchmarkConfig): PerSeriesResult {
  const baseSpecs: MethodSpec[] = [
    { name: 'Naive (last)', shortKey: 'naive', method: naiveMethod },
    { name: 'Mean of history', shortKey: 'avg', method: meanBaseline },
  ];
  const candidateSpecs = buildBenchmarkMethodSpecs(desc.history.length, cfg);
  const allSpecs = [...baseSpecs, ...candidateSpecs];
  const trainWindow = {
    type: cfg.trainWindowType,
    minSize: desc.minTrainSize,
    maxSize: cfg.trainWindowType === 'rolling' ? cfg.rollingMaxTrain : Infinity,
  };

  let allOriginsNonOverlapping = true;
  const methodRuns = allSpecs.map((spec) => {
    const bt = backtestForecast(desc.history, {
      method: spec.method,
      params: spec.params || {},
      horizon: desc.horizon,
      trainWindow,
      step: 1,
    });

    const origins = bt.origins;
    const allActual: number[] = [];
    const allPred: number[] = [];
    const originScaledErrors: number[] = [];
    let zeroActualPoints = 0;
    let mapeValidPoints = 0;

    for (const o of origins) {
      if (o.trainEnd !== o.originIndex - 1 || o.testStart !== o.originIndex || o.trainSize !== o.trainEnd - o.trainStart + 1) {
        allOriginsNonOverlapping = false;
      }
      // Strictly in-sample 1-step naive denominator computed ONLY on train slice
      const trainSlice = desc.history.slice(o.trainStart, o.trainEnd + 1);
      const scaleMae = computeTrainNaiveMae(trainSlice);

      for (let hp = 0; hp < o.testActual.length; hp++) {
        const av = o.testActual[hp];
        const pv = o.pred[hp];
        if (av != null && pv != null && Number.isFinite(av) && Number.isFinite(pv)) {
          allActual.push(av);
          allPred.push(pv);
          if (Math.abs(av) > 1e-9) mapeValidPoints++;
          else zeroActualPoints++;
          if (scaleMae !== null) {
            originScaledErrors.push(Math.abs(av - pv) / scaleMae);
          }
        }
      }
    }

    const metrics: AccuracyMetrics = bt.metrics || {
      n: 0,
      mae: null,
      rmse: null,
      mape: null,
      smape: null,
      wape: null,
      bias: null,
      absBias: null,
    };
    const maseVal = originScaledErrors.length
      ? originScaledErrors.reduce((s, v) => s + v, 0) / originScaledErrors.length
      : null;
    const lastModel: ForecastOutput | undefined = origins.length ? origins[origins.length - 1].model : undefined;
    const degradedVariant = origins.some((o) => o.model.model.includes('degraded'));

    return {
      spec,
      bt,
      metrics,
      mase: maseVal,
      mapeValidPoints,
      zeroActualPoints,
      nOrigins: origins.length,
      degradedVariant,
      lastModelTag: lastModel?.model || spec.shortKey || spec.name,
    };
  });

  const cmpNull = (a: number | null, b: number | null) =>
    a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a - b;

  const ranked = methodRuns
    .slice()
    .sort(
      (a, b) =>
        cmpNull(a.metrics.wape, b.metrics.wape) ||
        cmpNull(a.metrics.rmse, b.metrics.rmse) ||
        cmpNull(a.metrics.mae, b.metrics.mae) ||
        cmpNull(a.metrics.smape, b.metrics.smape)
    );

  const rankByName = new Map<string, number>();
  ranked.forEach((r, idx) => {
    rankByName.set(r.spec.name, idx + 1);
  });

  const methods: PerSeriesMethodEvaluation[] = methodRuns.map((r) => ({
    name: r.spec.name,
    shortKey: r.spec.shortKey || r.spec.name.toLowerCase(),
    metrics: r.metrics,
    mase: r.mase,
    mapeValidPoints: r.mapeValidPoints,
    zeroActualPoints: r.zeroActualPoints,
    nOrigins: r.nOrigins,
    rank: rankByName.get(r.spec.name) ?? null,
    degradedVariant: r.degradedVariant,
    lastModelTag: r.lastModelTag,
  }));

  const bestName = ranked[0]?.spec.name || null;
  const bestRun = methodRuns.find((r) => r.spec.name === bestName);
  const naiveRun = methodRuns.find((r) => r.spec.shortKey === 'naive');

  const originsAudit: OriginAuditRecord[] = (bestRun?.bt.origins || []).map((o, idx) => {
    const trainSlice = desc.history.slice(o.trainStart, o.trainEnd + 1);
    const nOrig = naiveRun?.bt.origins[idx];
    return {
      originIndex: o.originIndex,
      trainStart: o.trainStart,
      trainEnd: o.trainEnd,
      trainSize: o.trainSize,
      testStart: o.testStart,
      testEnd: o.testEnd,
      testActual: o.testActual,
      naivePred: o.naivePred,
      trainNaiveMae: computeTrainNaiveMae(trainSlice),
      bestPred: o.pred,
      baselinePred: nOrig ? nOrig.pred : o.naivePred,
    };
  });

  return {
    series: desc,
    bestMethodName: bestName,
    bestBy: 'WAPE (tie-broken RMSE / MAE / sMAPE)',
    methods,
    originsAudit,
    allOriginsNonOverlapping,
  };
}

function aggregateCohortLeaderboard(seriesResults: PerSeriesResult[]): AggregateMethodRow[] {
  if (!seriesResults.length) return [];

  interface Acc {
    name: string;
    shortKey: string;
    wapes: number[];
    rmses: number[];
    maes: number[];
    mases: number[];
    smapes: number[];
    mapes: number[];
    biases: number[];
    ranks: number[];
    wins: number;
    seriesCount: number;
    totalPoints: number;
    degradedSeriesCount: number;
  }

  const map = new Map<string, Acc>();
  for (const sr of seriesResults) {
    for (const m of sr.methods) {
      let acc = map.get(m.name);
      if (!acc) {
        acc = {
          name: m.name,
          shortKey: m.shortKey,
          wapes: [],
          rmses: [],
          maes: [],
          mases: [],
          smapes: [],
          mapes: [],
          biases: [],
          ranks: [],
          wins: 0,
          seriesCount: 0,
          totalPoints: 0,
          degradedSeriesCount: 0,
        };
        map.set(m.name, acc);
      }
      acc.seriesCount++;
      acc.totalPoints += m.metrics.n;
      if (m.degradedVariant) acc.degradedSeriesCount++;
      if (m.metrics.wape != null && Number.isFinite(m.metrics.wape)) acc.wapes.push(m.metrics.wape);
      if (m.metrics.rmse != null && Number.isFinite(m.metrics.rmse)) acc.rmses.push(m.metrics.rmse);
      if (m.metrics.mae != null && Number.isFinite(m.metrics.mae)) acc.maes.push(m.metrics.mae);
      if (m.mase != null && Number.isFinite(m.mase)) acc.mases.push(m.mase);
      if (m.metrics.smape != null && Number.isFinite(m.metrics.smape)) acc.smapes.push(m.metrics.smape);
      if (m.metrics.mape != null && Number.isFinite(m.metrics.mape)) acc.mapes.push(m.metrics.mape);
      if (m.metrics.bias != null && Number.isFinite(m.metrics.bias)) acc.biases.push(m.metrics.bias);
      if (m.rank != null) acc.ranks.push(m.rank);
      if (sr.bestMethodName === m.name) acc.wins++;
    }
  }

  const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

  return Array.from(map.values())
    .map((a) => {
      const sortedWape = a.wapes.slice().sort((x, y) => x - y);
      const q1 = quantile(sortedWape, 0.25);
      const med = quantile(sortedWape, 0.5);
      const q3 = quantile(sortedWape, 0.75);
      return {
        name: a.name,
        shortKey: a.shortKey,
        avgWape: avg(a.wapes),
        medianWape: med,
        q1Wape: q1,
        q3Wape: q3,
        iqrWape: q1 != null && q3 != null ? q3 - q1 : null,
        sdWape: stdevSample(a.wapes),
        minWape: sortedWape.length ? sortedWape[0] : null,
        maxWape: sortedWape.length ? sortedWape[sortedWape.length - 1] : null,
        avgRmse: avg(a.rmses),
        avgMae: avg(a.maes),
        avgMase: avg(a.mases),
        avgSmape: avg(a.smapes),
        avgMape: avg(a.mapes),
        avgBias: avg(a.biases),
        meanRank: avg(a.ranks),
        wins: a.wins,
        seriesCount: a.seriesCount,
        totalPoints: a.totalPoints,
        degradedSeriesCount: a.degradedSeriesCount,
      };
    })
    .sort((a, b) => {
      const aw = a.avgWape ?? Infinity;
      const bw = b.avgWape ?? Infinity;
      if (aw !== bw) return aw - bw;
      return (a.meanRank ?? Infinity) - (b.meanRank ?? Infinity);
    });
}

export function verifyNoFutureLeakage(
  perSeries: PerSeriesResult[],
  cfg: BenchmarkConfig
): LeakageAuditSummary {
  let verifiedOriginsCount = 0;
  let structuralOk = true;
  for (const sr of perSeries) {
    if (!sr.allOriginsNonOverlapping) structuralOk = false;
    verifiedOriginsCount += sr.originsAudit.length;
  }

  // Causal invariance test across all 12 models on longest eligible series
  const probeSeries = perSeries
    .slice()
    .sort((a, b) => b.series.history.length - a.series.history.length)[0]?.series;

  let perturbationSeriesId: string | null = null;
  let perturbationModelsTested = 0;
  let maxDelta = 0;
  const leakedModels: string[] = [];

  const probeResult = perSeries.find((r) => r.series.id === probeSeries?.id);
  if (probeResult && probeResult.originsAudit.length > 0) {
    perturbationSeriesId = probeResult.series.id;
    const orig = probeResult.series.history;
    const midOrigin = probeResult.originsAudit[Math.floor(probeResult.originsAudit.length / 2)];
    const perturbed = orig.map((v, idx) => (idx >= midOrigin.originIndex ? v + 50000 : v));

    const allSpecs: MethodSpec[] = [
      { name: 'Naive (last)', shortKey: 'naive', method: naiveMethod },
      { name: 'Mean of history', shortKey: 'avg', method: meanBaseline },
      ...buildBenchmarkMethodSpecs(orig.length, cfg),
    ];

    const trainWindow = {
      type: cfg.trainWindowType,
      minSize: probeResult.series.minTrainSize,
      maxSize: cfg.trainWindowType === 'rolling' ? cfg.rollingMaxTrain : Infinity,
    };

    for (const spec of allSpecs) {
      perturbationModelsTested++;
      const btBase = backtestForecast(orig, {
        method: spec.method,
        params: spec.params || {},
        horizon: probeResult.series.horizon,
        trainWindow,
        step: 1,
      });
      const btPert = backtestForecast(perturbed, {
        method: spec.method,
        params: spec.params || {},
        horizon: probeResult.series.horizon,
        trainWindow,
        step: 1,
      });

      const oBase = btBase.origins.find((o) => o.originIndex === midOrigin.originIndex);
      const oPert = btPert.origins.find((o) => o.originIndex === midOrigin.originIndex);
      if (!oBase || !oPert || oBase.pred.length !== oPert.pred.length) {
        leakedModels.push(spec.name);
        maxDelta = Infinity;
        continue;
      }
      for (let i = 0; i < oBase.pred.length; i++) {
        const d = Math.abs((oBase.pred[i] ?? 0) - (oPert.pred[i] ?? 0));
        if (d > maxDelta) maxDelta = d;
        if (d > 1e-12 && !leakedModels.includes(spec.name)) leakedModels.push(spec.name);
      }
    }
  }

  const passed = structuralOk && leakedModels.length === 0 && maxDelta <= 1e-12;
  const notes = [
    structuralOk
      ? `All ${verifiedOriginsCount} rolling/expanding origins enforce trainEnd = originIndex − 1 < testStart.`
      : 'One or more origins detected window boundary mismatch.',
    perturbationSeriesId
      ? `Perturbation test (+50,000 injected into y[t ≥ origin]) yielded max |Δŷ| = ${maxDelta.toFixed(6)} across ${perturbationModelsTested} models on ${perturbationSeriesId}.`
      : 'No multi-origin series available in current cohort to run future perturbation invariance check.',
    'MASE denominators use 1-step in-sample naive MAE computed strictly within each origin training slice.',
  ];

  return {
    passed,
    verifiedSeriesCount: perSeries.length,
    verifiedOriginsCount,
    perturbationSeriesId,
    perturbationModelsTested,
    maxFuturePerturbationDelta: maxDelta,
    leakedModels,
    zeroLeakageInMaseDenominator: true,
    notes,
  };
}

export function buildSeriesDescriptors(input: {
  products: ResearchProductInput[];
  config: Partial<BenchmarkConfig>;
  externalSeries?: ExternalSeriesInput[];
  prebuiltSyntheticHistories?: Partial<Record<SyntheticPattern, number[]>>;
}): {
  config: BenchmarkConfig;
  included: SeriesDescriptor[];
  excluded: ExcludedSeriesRecord[];
  provenanceCountsAll: ProvenanceCounts;
} {
  const cfg = sanitizeBenchmarkConfig(input.config);
  const included: SeriesDescriptor[] = [];
  const excluded: ExcludedSeriesRecord[] = [];
  const provenanceCountsAll: ProvenanceCounts = {
    'illustrative-catalogue': 0,
    'user-imported': 0,
    'synthetic-generated': 0,
    'external-dataset': 0,
  };

  for (const p of input.products) {
    const cleanHist = (Array.isArray(p.demandHistory) ? p.demandHistory : [])
      .map(Number)
      .filter((v) => Number.isFinite(v) && v >= 0);
    const { provenanceClass, provenanceLabel } = classifyResearchProvenance(p.demandSource);
    provenanceCountsAll[provenanceClass]++;

    const includeInScope =
      cfg.cohortScope === 'all' ||
      (cfg.cohortScope === 'catalogue' &&
        (provenanceClass === 'illustrative-catalogue' || provenanceClass === 'user-imported')) ||
      (cfg.cohortScope === 'synthetic' && p.demandSource === 'synthetic') ||
      (cfg.cohortScope === 'external' && p.demandSource === 'external');

    if (!includeInScope) continue;

    if (cleanHist.length < cfg.minSeriesLength) {
      excluded.push({
        id: p.id || `sku:${p.sku}`,
        label: p.sku,
        provenanceClass,
        length: cleanHist.length,
        reason: `Has ${cleanHist.length} valid periods; requires ≥ ${cfg.minSeriesLength} for rolling-origin evaluation.`,
      });
      continue;
    }

    const minTrain = Math.min(6, Math.max(3, Math.floor(cleanHist.length / 2)));
    const safeHorizon = Math.min(cfg.skuHorizon, Math.max(1, cleanHist.length - minTrain));
    const effP = Math.min(cfg.seasonPeriod, Math.max(2, Math.floor(cleanHist.length / 2)));
    const stats = seriesStats(cleanHist);

    included.push({
      id: p.id || `sku:${p.sku}`,
      label: p.sku,
      subLabel: p.name || p.sku,
      provenanceClass,
      provenanceLabel,
      rawDemandSource: p.demandSource || 'demo',
      unit: p.unit || 'units',
      history: cleanHist,
      checksum: fnv1aHash(cleanHist.join(',')),
      horizon: safeHorizon,
      minTrainSize: minTrain,
      effectiveSeasonPeriod: effP,
      zeroCount: stats.zeroCount,
      meanDemand: stats.meanDemand,
      cv: stats.cv,
    });
  }

  for (const pat of SYNTHETIC_PATTERNS) {
    provenanceCountsAll['synthetic-generated']++;
    const override = input.prebuiltSyntheticHistories?.[pat];
    const hist =
      override && override.length >= cfg.minSeriesLength
        ? override.map(Number).filter((v) => Number.isFinite(v) && v >= 0)
        : generateDemandDataset(pat, {
            n: cfg.synthLength,
            base: cfg.synthBase,
            noise: cfg.synthNoise,
            seed: cfg.seed,
          }).history;

    if (cfg.cohortScope !== 'all' && cfg.cohortScope !== 'synthetic') continue;

    const minTrain = Math.min(cfg.minSynthTrainSize, Math.max(4, Math.floor(hist.length / 2)));
    const safeHorizon = Math.min(cfg.synthHorizon, Math.max(1, hist.length - minTrain));
    const effP = Math.min(cfg.seasonPeriod, Math.max(2, Math.floor(hist.length / 2)));
    const stats = seriesStats(hist);

    included.push({
      id: `synth:${pat}`,
      label: `synth:${pat}`,
      subLabel: `Canonical ${pat} regime (seed #${cfg.seed})`,
      provenanceClass: 'synthetic-generated',
      provenanceLabel: 'Generated Synthetic',
      rawDemandSource: 'synthetic-mulberry32',
      unit: 'units',
      history: hist,
      checksum: fnv1aHash(hist.join(',')),
      horizon: safeHorizon,
      minTrainSize: minTrain,
      effectiveSeasonPeriod: effP,
      zeroCount: stats.zeroCount,
      meanDemand: stats.meanDemand,
      cv: stats.cv,
      generatorSpec: {
        prng: 'mulberry32',
        seed: cfg.seed,
        pattern: pat,
        n: hist.length,
        base: cfg.synthBase,
        noise: cfg.synthNoise,
      },
    });
  }

  for (const ext of input.externalSeries || []) {
    const cleanHist = (Array.isArray(ext.history) ? ext.history : [])
      .map(Number)
      .filter((v) => Number.isFinite(v) && v >= 0);
    provenanceCountsAll['external-dataset']++;

    if (cleanHist.length < cfg.minSeriesLength) {
      excluded.push({
        id: ext.id,
        label: ext.label,
        provenanceClass: 'external-dataset',
        length: cleanHist.length,
        reason: `External series has ${cleanHist.length} periods; requires ≥ ${cfg.minSeriesLength}.`,
      });
      continue;
    }

    if (cfg.cohortScope !== 'all' && cfg.cohortScope !== 'external') continue;

    const minTrain = Math.min(cfg.minSynthTrainSize, Math.max(3, Math.floor(cleanHist.length / 2)));
    const safeHorizon = Math.min(cfg.skuHorizon, Math.max(1, cleanHist.length - minTrain));
    const effP = Math.min(cfg.seasonPeriod, Math.max(2, Math.floor(cleanHist.length / 2)));
    const stats = seriesStats(cleanHist);

    included.push({
      id: ext.id,
      label: ext.label,
      subLabel: ext.note || 'User-uploaded external empirical series',
      provenanceClass: 'external-dataset',
      provenanceLabel: 'External Dataset',
      rawDemandSource: 'external',
      unit: ext.unit || 'units',
      history: cleanHist,
      checksum: fnv1aHash(cleanHist.join(',')),
      horizon: safeHorizon,
      minTrainSize: minTrain,
      effectiveSeasonPeriod: effP,
      zeroCount: stats.zeroCount,
      meanDemand: stats.meanDemand,
      cv: stats.cv,
    });
  }

  return { config: cfg, included, excluded, provenanceCountsAll };
}

export function runResearchBenchmark(input: {
  products: ResearchProductInput[];
  config?: Partial<BenchmarkConfig>;
  externalSeries?: ExternalSeriesInput[];
  prebuiltSyntheticHistories?: Partial<Record<SyntheticPattern, number[]>>;
}): ResearchBenchmarkResult {
  const { config, included, excluded, provenanceCountsAll } = buildSeriesDescriptors({
    products: input.products,
    config: input.config || {},
    externalSeries: input.externalSeries,
    prebuiltSyntheticHistories: input.prebuiltSyntheticHistories,
  });

  const perSeries = included.map((desc) => evaluateSeries(desc, config));
  const provenanceCountsEvaluated: ProvenanceCounts = {
    'illustrative-catalogue': 0,
    'user-imported': 0,
    'synthetic-generated': 0,
    'external-dataset': 0,
  };
  for (const sr of perSeries) {
    provenanceCountsEvaluated[sr.series.provenanceClass]++;
  }

  const workspaceSeries = perSeries.filter(
    (s) => s.series.provenanceClass === 'illustrative-catalogue' || s.series.provenanceClass === 'user-imported'
  );
  const syntheticSeries = perSeries.filter((s) => s.series.provenanceClass === 'synthetic-generated');
  const externalOnlySeries = perSeries.filter((s) => s.series.provenanceClass === 'external-dataset');

  const leaderboardAll = aggregateCohortLeaderboard(perSeries);
  const leaderboardWorkspace = aggregateCohortLeaderboard(workspaceSeries);
  const leaderboardSynthetic = aggregateCohortLeaderboard(syntheticSeries);
  const leaderboardExternal = aggregateCohortLeaderboard(externalOnlySeries);
  const leakageAudit = verifyNoFutureLeakage(perSeries, config);

  const configChecksum = fnv1aHash(JSON.stringify(config));
  const datasetChecksum = fnv1aHash(
    JSON.stringify(included.map((s) => ({ id: s.id, provenance: s.provenanceClass, checksum: s.checksum })))
  );
  const resultsChecksum = fnv1aHash(
    JSON.stringify(
      leaderboardAll.map((r) => ({
        name: r.name,
        avgWape: r.avgWape != null ? Number(r.avgWape.toFixed(8)) : null,
        avgMase: r.avgMase != null ? Number(r.avgMase.toFixed(8)) : null,
        wins: r.wins,
      }))
    )
  );

  return {
    config,
    includedSeries: included,
    excludedSeries: excluded,
    provenanceCountsAllWorkspaceAndSynth: provenanceCountsAll,
    provenanceCountsEvaluated,
    perSeries,
    leaderboardAll,
    leaderboardWorkspace,
    leaderboardSynthetic,
    leaderboardExternal,
    leakageAudit,
    checksums: {
      configChecksum,
      datasetChecksum,
      resultsChecksum,
    },
  };
}

export interface BenchmarkConfigExport {
  schemaVersion: 2;
  artifactType: 'factorymind-benchmark-config';
  exportedAt: string;
  config: BenchmarkConfig;
  externalSeries: ExternalSeriesInput[];
}

export interface BenchmarkFullExport {
  schemaVersion: 2;
  artifactType: 'factorymind-research-benchmark';
  generatedAt: string;
  config: BenchmarkConfig;
  reproducibility: {
    prng: 'mulberry32';
    configChecksum: string;
    datasetChecksum: string;
    resultsChecksum: string;
    howToReproduce: string;
  };
  provenanceSummary: {
    allAvailableCounts: ProvenanceCounts;
    evaluatedCounts: ProvenanceCounts;
    categoriesExplained: Record<ResearchProvenanceClass, string>;
    excludedSeries: ExcludedSeriesRecord[];
  };
  leakageAudit: LeakageAuditSummary;
  datasets: SeriesDescriptor[];
  leaderboards: {
    overall: AggregateMethodRow[];
    workspaceCatalogueAndUser: AggregateMethodRow[];
    syntheticSuites: AggregateMethodRow[];
    externalDatasets: AggregateMethodRow[];
  };
  perSeriesResults: Array<{
    seriesId: string;
    label: string;
    provenanceClass: ResearchProvenanceClass;
    provenanceLabel: string;
    horizon: number;
    minTrainSize: number;
    bestMethodName: string | null;
    allOriginsNonOverlapping: boolean;
    methods: PerSeriesMethodEvaluation[];
  }>;
  methodology: {
    algorithms: ForecastAlgorithmDoc[];
    metrics: ForecastMetricDoc[];
    limitations: BenchmarkLimitationDoc[];
  };
}

export function buildConfigExportPayload(
  config: BenchmarkConfig,
  externalSeries: ExternalSeriesInput[] = []
): BenchmarkConfigExport {
  return {
    schemaVersion: 2,
    artifactType: 'factorymind-benchmark-config',
    exportedAt: new Date().toISOString(),
    config,
    externalSeries,
  };
}

export function buildBenchmarkExportPayload(
  result: ResearchBenchmarkResult
): BenchmarkFullExport {
  return {
    schemaVersion: 2,
    artifactType: 'factorymind-research-benchmark',
    generatedAt: new Date().toISOString(),
    config: result.config,
    reproducibility: {
      prng: 'mulberry32',
      configChecksum: result.checksums.configChecksum,
      datasetChecksum: result.checksums.datasetChecksum,
      resultsChecksum: result.checksums.resultsChecksum,
      howToReproduce:
        'Import this JSON file via "Load / Verify JSON" in FactoryMind Research Lab or pass `datasets[].history` and `config` directly to your external evaluation script. Each dataset includes exact raw series observations and FNV-1a checksums.',
    },
    provenanceSummary: {
      allAvailableCounts: result.provenanceCountsAllWorkspaceAndSynth,
      evaluatedCounts: result.provenanceCountsEvaluated,
      categoriesExplained: {
        'illustrative-catalogue':
          'Preloaded illustrative 17-SKU factory items with seeded deterministic histories (not real plant ERP data).',
        'user-imported': 'SKUs imported via CSV/JSON or entered/edited directly by the user.',
        'synthetic-generated':
          'Generated synthetic canonical demand regimes (Mulberry32 PRNG + Box-Muller Gaussian noise).',
        'external-dataset':
          'User-loaded external empirical series in Research Lab (0 pre-bundled external datasets shipped).',
      },
      excludedSeries: result.excludedSeries,
    },
    leakageAudit: result.leakageAudit,
    datasets: result.includedSeries,
    leaderboards: {
      overall: result.leaderboardAll,
      workspaceCatalogueAndUser: result.leaderboardWorkspace,
      syntheticSuites: result.leaderboardSynthetic,
      externalDatasets: result.leaderboardExternal,
    },
    perSeriesResults: result.perSeries.map((sr) => ({
      seriesId: sr.series.id,
      label: sr.series.label,
      provenanceClass: sr.series.provenanceClass,
      provenanceLabel: sr.series.provenanceLabel,
      horizon: sr.series.horizon,
      minTrainSize: sr.series.minTrainSize,
      bestMethodName: sr.bestMethodName,
      allOriginsNonOverlapping: sr.allOriginsNonOverlapping,
      methods: sr.methods,
    })),
    methodology: {
      algorithms: FORECAST_ALGORITHM_DOCS,
      metrics: FORECAST_METRIC_DOCS,
      limitations: BENCHMARK_LIMITATIONS,
    },
  };
}

export function buildResearchMarkdownReport(result: ResearchBenchmarkResult): string {
  const f = (v: number | null | undefined, digits = 2, suffix = '') =>
    v != null && Number.isFinite(v) ? `${v.toFixed(digits)}${suffix}` : '—';

  const formatBoard = (title: string, rows: AggregateMethodRow[]) => {
    if (!rows.length) return [`## ${title}`, '', '_No series evaluated in this cohort._', ''];
    return [
      `## ${title}`,
      '',
      '| Rank | Method | Mean WAPE (%) | Median WAPE (%) | WAPE IQR | Mean MASE | Mean sMAPE (%) | Mean Bias | Mean Rank | Wins | N |',
      '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
      ...rows.map(
        (r, idx) =>
          `| ${idx + 1} | ${r.name} | ${f(r.avgWape, 2)} | ${f(r.medianWape, 2)} | ${f(r.iqrWape, 2)} | ${f(r.avgMase, 3)} | ${f(r.avgSmape, 2)} | ${f(r.avgBias, 2)} | ${f(r.meanRank, 2)} | ${r.wins} | ${r.totalPoints} |`
      ),
      '',
    ];
  };

  const regimeCols = result.perSeries.filter((s) => s.series.provenanceClass === 'synthetic-generated');
  const regimeMatrixLines =
    regimeCols.length > 0
      ? [
          '## Synthetic Regime WAPE (%) Matrix',
          '',
          `| Method | ${regimeCols.map((c) => c.series.label.replace('synth:', '')).join(' | ')} |`,
          `|---|${regimeCols.map(() => '---:').join('|')}|`,
          ...result.leaderboardAll.map((row) => {
            const cells = regimeCols.map((c) => {
              const m = c.methods.find((x) => x.name === row.name);
              const txt = f(m?.metrics.wape, 1);
              return m?.degradedVariant ? `${txt}*` : txt;
            });
            return `| ${row.name} | ${cells.join(' | ')} |`;
          }),
          '',
          '_*Indicates HWMultiplicative automatically fell back to additive mode due to zero/non-positive values in training._',
          '',
        ]
      : [];

  const lines: string[] = [
    '# FactoryMind Forecasting Research Benchmark Report',
    '',
    `- **Generated At (UTC)**: ${new Date().toISOString()}`,
    `- **PRNG Seed**: ${result.config.seed} (Mulberry32 deterministic)`,
    `- **Training Window**: ${result.config.trainWindowType}${result.config.trainWindowType === 'rolling' ? ` (max width ${result.config.rollingMaxTrain})` : ''}`,
    `- **Cohort Scope**: ${result.config.cohortScope}`,
    `- **Config Checksum (FNV-1a)**: \`${result.checksums.configChecksum}\``,
    `- **Dataset Checksum (FNV-1a)**: \`${result.checksums.datasetChecksum}\``,
    `- **Results Checksum (FNV-1a)**: \`${result.checksums.resultsChecksum}\``,
    '',
    '## Dataset Provenance Summary',
    '',
    '| Provenance Class | Series Evaluated | Status / Origin Description |',
    '|---|---:|---|',
    `| Preloaded Illustrative Catalogue | ${result.provenanceCountsEvaluated['illustrative-catalogue']} | Seeded 17-SKU factory items with deterministic curves (not empirical ERP logs). |`,
    `| User-Imported / Workspace Data | ${result.provenanceCountsEvaluated['user-imported']} | SKUs imported via CSV/JSON or added/edited in Workspace Inventory. |`,
    `| Generated Synthetic Data | ${result.provenanceCountsEvaluated['synthetic-generated']} | Mulberry32 + Box-Muller canonical regimes (stationary, trend, seasonal, intermittent, structural-break). |`,
    `| External Empirical Datasets | ${result.provenanceCountsEvaluated['external-dataset']} | Session-loaded external CSV series (0 pre-bundled external benchmarks shipped). |`,
    '',
    ...(result.excludedSeries.length
      ? [
          `Excluded series (${result.excludedSeries.length}): ${result.excludedSeries
            .map((e) => `${e.label} (${e.length} pts)`)
            .join(', ')}.`,
          '',
        ]
      : []),
    '## Causal Future-Leakage Verification',
    '',
    `- **Audit Status**: ${result.leakageAudit.passed ? 'PASSED' : 'FAILED'}`,
    `- **Origins Verified**: ${result.leakageAudit.verifiedOriginsCount} origins across ${result.leakageAudit.verifiedSeriesCount} series`,
    `- **Future Perturbation Test Max |Δŷ|**: ${result.leakageAudit.maxFuturePerturbationDelta.toFixed(6)} across ${result.leakageAudit.perturbationModelsTested} models`,
    ...result.leakageAudit.notes.map((n) => `- ${n}`),
    '',
    ...formatBoard('Aggregate Leaderboard (Evaluated Cohort)', result.leaderboardAll),
    ...formatBoard('Workspace SKUs Only (Illustrative + User-Imported)', result.leaderboardWorkspace),
    ...formatBoard('Generated Synthetic Regimes Only', result.leaderboardSynthetic),
    ...(result.leaderboardExternal.length ? formatBoard('External Empirical Series Only', result.leaderboardExternal) : []),
    ...regimeMatrixLines,
    '## Exact Configuration',
    '',
    '```json',
    JSON.stringify(result.config, null, 2),
    '```',
    '',
    '## Error Metrics & Mathematical Definitions',
    '',
    ...FORECAST_METRIC_DOCS.map((m) => `- **${m.name}**: \`${m.formula}\` — ${m.interpretation} _Caveat: ${m.caveats}_`),
    '',
    '## Algorithm Specifications (12 Methods)',
    '',
    ...FORECAST_ALGORITHM_DOCS.map((a) => `- **${a.name} (${a.family})**: \`${a.formula}\` | Hyperparameters: ${a.hyperparameters} | Limitation: ${a.limitations}`),
    '',
    '## Methodological Assumptions & Limitations',
    '',
    ...BENCHMARK_LIMITATIONS.map((l) => `- **${l.title}**: ${l.detail}`),
    '',
  ];

  return lines.join('\n');
}

export interface BenchmarkVerificationReport {
  valid: boolean;
  kind: 'full-benchmark' | 'config-only';
  error?: string;
  restoredConfig?: BenchmarkConfig;
  restoredExternalSeries?: ExternalSeriesInput[];
  exactMatch?: boolean;
  expectedResultsChecksum?: string;
  recomputedResultsChecksum?: string;
  maxWapeDiff?: number;
  seriesChecked?: number;
  mismatches?: string[];
}

export function verifyAndLoadBenchmarkArtifact(rawJson: string): BenchmarkVerificationReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { valid: false, kind: 'config-only', error: 'Invalid JSON syntax — unable to parse benchmark artifact.' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, kind: 'config-only', error: 'Expected a JSON object.' };
  }

  const obj = parsed as Record<string, unknown>;
  if (!obj.config || typeof obj.config !== 'object') {
    return { valid: false, kind: 'config-only', error: 'Missing required "config" object in JSON artifact.' };
  }

  const restoredConfig = sanitizeBenchmarkConfig(obj.config as Partial<BenchmarkConfig>);

  if (obj.artifactType === 'factorymind-benchmark-config') {
    const ext = Array.isArray(obj.externalSeries)
      ? (obj.externalSeries as ExternalSeriesInput[]).filter(
          (e) => e && typeof e.id === 'string' && typeof e.label === 'string' && Array.isArray(e.history)
        )
      : [];
    return {
      valid: true,
      kind: 'config-only',
      restoredConfig,
      restoredExternalSeries: ext,
    };
  }

  if (obj.artifactType !== 'factorymind-research-benchmark' || !Array.isArray(obj.datasets)) {
    return {
      valid: false,
      kind: 'full-benchmark',
      error: 'Unrecognized artifact format. Export a Config JSON or Research Benchmark JSON from Research Lab first.',
    };
  }

  const datasets = obj.datasets as SeriesDescriptor[];
  const products: ResearchProductInput[] = [];
  const externalSeries: ExternalSeriesInput[] = [];
  const prebuiltSyntheticHistories: Partial<Record<SyntheticPattern, number[]>> = {};

  for (const ds of datasets) {
    if (!ds || !Array.isArray(ds.history)) continue;
    if (ds.provenanceClass === 'synthetic-generated' && ds.generatorSpec?.pattern) {
      prebuiltSyntheticHistories[ds.generatorSpec.pattern] = ds.history;
    } else if (ds.provenanceClass === 'external-dataset') {
      externalSeries.push({
        id: ds.id,
        label: ds.label,
        unit: ds.unit,
        history: ds.history,
        note: ds.subLabel,
      });
    } else {
      products.push({
        id: ds.id,
        sku: ds.label,
        name: ds.subLabel,
        unit: ds.unit,
        demandHistory: ds.history,
        demandSource: ds.rawDemandSource === 'imported' ? 'imported' : ds.rawDemandSource === 'user' ? 'user' : 'demo',
      });
    }
  }

  const replay = runResearchBenchmark({
    products,
    config: { ...restoredConfig, cohortScope: 'all' },
    externalSeries,
    prebuiltSyntheticHistories,
  });

  const expectedChecksum =
    typeof obj.reproducibility === 'object' && obj.reproducibility !== null
      ? String((obj.reproducibility as Record<string, unknown>).resultsChecksum || '')
      : '';

  const exportedLeader =
    typeof obj.leaderboards === 'object' &&
    obj.leaderboards !== null &&
    Array.isArray((obj.leaderboards as Record<string, unknown>).overall)
      ? ((obj.leaderboards as Record<string, unknown>).overall as AggregateMethodRow[])
      : [];

  let maxWapeDiff = 0;
  const mismatches: string[] = [];
  for (const expRow of exportedLeader) {
    const curRow = replay.leaderboardAll.find((r) => r.name === expRow.name);
    if (!curRow) {
      mismatches.push(`Missing method ${expRow.name}`);
      continue;
    }
    if (expRow.avgWape != null && curRow.avgWape != null) {
      const d = Math.abs(expRow.avgWape - curRow.avgWape);
      if (d > maxWapeDiff) maxWapeDiff = d;
      if (d > 1e-6) mismatches.push(`${expRow.name}: exported WAPE ${expRow.avgWape.toFixed(4)} vs recomputed ${curRow.avgWape.toFixed(4)}`);
    } else if (expRow.avgWape !== curRow.avgWape) {
      mismatches.push(`${expRow.name}: null/finite mismatch`);
    }
    if (expRow.wins !== curRow.wins) {
      mismatches.push(`${expRow.name}: exported wins ${expRow.wins} vs recomputed ${curRow.wins}`);
    }
  }

  const checksumMatch = expectedChecksum ? expectedChecksum === replay.checksums.resultsChecksum : mismatches.length === 0;

  return {
    valid: true,
    kind: 'full-benchmark',
    restoredConfig,
    restoredExternalSeries: externalSeries,
    exactMatch: checksumMatch && mismatches.length === 0 && maxWapeDiff <= 1e-6,
    expectedResultsChecksum: expectedChecksum || undefined,
    recomputedResultsChecksum: replay.checksums.resultsChecksum,
    maxWapeDiff,
    seriesChecked: replay.includedSeries.length,
    mismatches,
  };
}

export function parseExternalSeriesInput(
  labelRaw: string,
  valuesRaw: string
): { valid: boolean; series?: ExternalSeriesInput; error?: string; rejectedTokens: string[] } {
  const label = labelRaw.trim();
  if (!label) {
    return { valid: false, error: 'Enter a dataset or series label (e.g., Plant-Line-A-2025).', rejectedTokens: [] };
  }
  const tokens = valuesRaw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const nums: number[] = [];
  const rejectedTokens: string[] = [];
  for (const t of tokens) {
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0) nums.push(n);
    else rejectedTokens.push(t);
  }
  if (rejectedTokens.length > 0) {
    return {
      valid: false,
      error: `Found ${rejectedTokens.length} non-numeric or negative token(s): ${rejectedTokens.slice(0, 4).join(', ')}.`,
      rejectedTokens,
    };
  }
  if (nums.length < 6) {
    return {
      valid: false,
      error: `Need at least 6 non-negative numeric observations for rolling-origin evaluation (found ${nums.length}).`,
      rejectedTokens,
    };
  }
  return {
    valid: true,
    rejectedTokens: [],
    series: {
      id: `ext:${fnv1aHash(`${label}:${nums.join(',')}`)}`,
      label,
      unit: 'units',
      history: nums,
      note: `Session-loaded external empirical series (n=${nums.length})`,
    },
  };
}
