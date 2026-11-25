/**
 * FactoryMind Discrete-Event Production Simulation Engine (DES)
 *
 * Pure TypeScript event-driven manufacturing simulation engine separated cleanly
 * from UI components for reuse across Simulation Lab, Scenario Studio, and 3D Digital Twin.
 *
 * Core Mathematical Architecture:
 * 1. Event Clock & Binary Min-Heap Priority Queue: O(log N) deterministic event scheduling
 *    ordered by `(time, seq)` so equal-timestamp events preserve FIFO causal order.
 * 2. Working Calendar & Shift Pause/Resume: Separates calendar time, scheduled shift hours,
 *    inter-shift breaks, and off-shift days. Active machine/reliability timers pause at
 *    shift end and resume with exact remaining work at shift start.
 * 3. Production Orders & Multi-Product Non-Linear Routing: Supports explicit order releases
 *    (SKU, route, qty, release time, due date, priority) and/or stochastic open arrivals,
 *    SKU-dependent setup/changeovers, conditional scrap/rework branches, and parallel machines.
 * 4. Finite Buffers, Backpressure Blocking & BOM Material Flow: Models inter-station blocking,
 *    wakeup cascades, BOM stock reservation, and (ROP, Q) replenishment lead-time events.
 * 5. Rigorous OEE vs Asset Utilization & Flow Conservation:
 *    - Asset Utilization = busyTime / scheduledWorkingTime
 *    - OEE Availability  = (scheduledWorkingTime - downTime - pmTime) / scheduledWorkingTime
 *    - OEE Performance   = min(100%, earnedIdealWork / activeRunPlusBlockedTime)
 *    - OEE Quality       = goodUnits / (goodUnits + scrappedUnits)
 *    - Conservation      = wipAtWarmupStart + arrivedAfterWarmup - good - scrapped - wipAtEnd === 0
 *
 * Provenance Guarantee: Every output is tagged as `'SIMULATED_MODEL'` and is never presented
 * as live empirical shop-floor telemetry.
 */

import {
  estimateSpcQualityProfile,
  extractBomMaterialsForFactory,
  FactorySimConfig,
  forecastDemandSignalForProduct,
  SpcQualityProfileKey,
} from './factorySim.ts';
import { mulberry32, normalFrom } from './ipe.ts';

/* -------------------------------------------------------------------------- */
/*  Priority Queue (Binary Min-Heap with Deterministic Tie-Breaking)          */
/* -------------------------------------------------------------------------- */

export interface HeapComparable {
  time: number;
  seq: number;
}

/**
 * Deterministic binary min-heap ordered by `(a.time - b.time) || (a.seq - b.seq)`.
 * Push and pop execute in O(log N) time with stable FIFO ordering on ties.
 */
export class MinHeap<T extends HeapComparable> {
  private readonly items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  clear(): void {
    this.items.length = 0;
  }

  push(item: T): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const n = this.items.length;
    if (n === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (n > 1) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private less(i: number, j: number): boolean {
    const a = this.items[i];
    const b = this.items[j];
    if (a.time !== b.time) return a.time < b.time;
    return a.seq < b.seq;
  }

  private siftUp(idx: number): void {
    let i = idx;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(i, parent)) {
        const tmp = this.items[i];
        this.items[i] = this.items[parent];
        this.items[parent] = tmp;
        i = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(idx: number): void {
    let i = idx;
    const n = this.items.length;
    while (true) {
      const left = (i << 1) + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.less(left, smallest)) smallest = left;
      if (right < n && this.less(right, smallest)) smallest = right;
      if (smallest !== i) {
        const tmp = this.items[i];
        this.items[i] = this.items[smallest];
        this.items[smallest] = tmp;
        i = smallest;
      } else {
        break;
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Public Types                                                              */
/* -------------------------------------------------------------------------- */

export type DesDistKind =
  | 'constant'
  | 'normal'
  | 'lognormal'
  | 'exponential'
  | 'gamma'
  | 'weibull';

export interface DesDistSpec {
  kind: DesDistKind;
  mean: number;
  /** Coefficient of variation (sd / mean). Used by normal, lognormal, gamma, weibull (if shape omitted). */
  cv?: number;
  /** Optional explicit shape parameter k for Weibull / Gamma (> 0). */
  shape?: number;
}

export type DesQueueDiscipline = 'fifo' | 'edd' | 'priority';

export interface DesShiftCalendar {
  /** Number of active shifts per working day (1..3). */
  shiftsPerDay: number;
  /** Duration of each shift in hours (> 0, <= 24 / shiftsPerDay). */
  shiftHours: number;
  /** Optional break/handover gap (minutes) between consecutive shifts within the same day. */
  interShiftGapMin?: number;
  /** Working days per 7-day week (1..7, e.g. 5 = Mon-Fri, 7 = 24/7). */
  workingDaysPerWeek?: number;
  /** Optional start offset of first shift in minutes from midnight (default 0). */
  firstShiftStartMin?: number;
}

export interface DesStationSpec {
  id: string;
  name: string;
  machineCount: number;
  /** Finite input buffer capacity before this station (>= 1). */
  bufferCapacity: number;
  /** Default processing time distribution (minutes). */
  processDist: DesDistSpec;
  /** Setup / SKU changeover duration when switching SKU or starting if configureFirstSetup = true. */
  setupTimeMin?: number;
  /** Whether setup only fires when SKU changes (true, default) or on every job (false). */
  setupOnSkuChangeOnly?: boolean;
  /** Queue selection discipline at this station. */
  queueDiscipline?: DesQueueDiscipline;
  /** Mean time between failures on active working-shift time (0 disables failures). */
  mtbfMin?: number;
  /** Failure inter-arrival distribution (default exponential). */
  failureDistKind?: 'exponential' | 'weibull' | 'lognormal';
  /** Weibull shape (>1 wear-out, <1 infant mortality, 1 exponential). Default 1.6 if weibull. */
  failureWeibullShape?: number;
  /** Mean time to repair (minutes). */
  mttrMin?: number;
  /** Repair duration distribution (default lognormal). */
  repairDistKind?: DesDistKind;
  /** Repair CV (default 0.35). */
  repairCv?: number;
  /** Scheduled Preventive Maintenance interval on working-shift clock (0 disables PM). */
  pmIntervalMin?: number;
  /** Scheduled Preventive Maintenance duration (minutes). */
  pmDurationMin?: number;
  /** Hourly machine operating cost ($/machine-hr on scheduled time). */
  hourlyMachineCost?: number;
  /** Operators assigned per machine for cost accounting. */
  operatorsPerMachine?: number;
}

export interface DesBomItem {
  materialSku: string;
  qtyPerJob: number;
}

export interface DesRouteStep {
  stationId: string;
  /** Multiplier applied to station mean processing time (default 1.0). */
  cycleTimeMult?: number;
  /** Explicit step processing time override (minutes). */
  processDistOverride?: DesDistSpec;
  /** Explicit changeover/setup override (minutes). */
  setupMinOverride?: number;
  /** Probability [0, 0.95] unit is scrapped/rejected immediately after this step. */
  scrapRate?: number;
  /** Probability [0, 0.95] surviving (non-scrapped) unit needs rework loop after this step. */
  reworkProb?: number;
  /** Route step index (0..steps.length-1) to route rework back to. */
  reworkToStepIdx?: number;
  /** Maximum rework attempts per unit before remaining failure triggers scrap. */
  maxRework?: number;
}

export interface DesRouteSpec {
  id: string;
  sku: string;
  name: string;
  steps: DesRouteStep[];
  materialsPerJob?: DesBomItem[];
}

export interface DesOrderSpec {
  id: string;
  sku: string;
  routeId: string;
  qty: number;
  /** Release timestamp in simulation calendar minutes (>= 0). */
  releaseAtMin: number;
  /** Optional customer due timestamp (minutes) for tardiness & OTD calculation. */
  dueAtMin?: number;
  /** Lower number = higher priority under 'priority' discipline (default 5). */
  priority?: number;
}

export interface DesOpenArrivalSpec {
  /** Arrival rate per active working hour (or calendar hour if arrivalClock = 'calendar'). */
  ratePerHour: number;
  cv?: number;
  /** Whether inter-arrival clock advances only during scheduled shifts ('working', default) or 24/7 ('calendar'). */
  clockMode?: 'working' | 'calendar';
  /** Mix weights across defined routes (uniform across routes if omitted). */
  mix?: Array<{ routeId: string; weight: number }>;
  /** Due date offset from arrival in minutes for open-arrival OTD KPI (default 240). */
  defaultLeadAllowanceMin?: number;
}

export interface DesMaterialSpec {
  sku: string;
  name: string;
  unit: string;
  initialStock: number;
  rop: number;
  orderQty: number;
  leadTimeMin: number;
  unitCost: number;
}

export interface DesConfig {
  name: string;
  /** Total simulation horizon in calendar hours (> 0). */
  horizonHours: number;
  /** Warmup duration in calendar hours (>= 0, < horizonHours). Statistics reset cleanly at warmup end. */
  warmupHours?: number;
  /** Shift & working calendar schedule. If omitted, runs 24/7 continuous shifts. */
  calendar?: DesShiftCalendar;
  /** Deterministic mode removes stochastic CV, random scrap/rework draws remain expected? Actually forces deterministic times & zero random failures unless PM. */
  deterministic?: boolean;
  /** Number of independent Monte Carlo replications (>= 1). */
  replications?: number;
  /** Base PRNG seed (uint32). */
  seed?: number;
  /** Snapshot sampling interval in minutes for timeline trace (default 60). */
  traceIntervalMin?: number;
  /** Optional cap on station 0 intake gate; if omitted, order staging holds waiting releases safely without loss. */
  finiteArrivalGateCap?: number;
  /** Hourly operator wage rate ($/hr) for cost accounting. */
  laborRatePerHour?: number;
  /** WIP holding cost per unit-hour. */
  wipHoldingCostPerJobHour?: number;
  stations: DesStationSpec[];
  routes: DesRouteSpec[];
  orders?: DesOrderSpec[];
  openArrivals?: DesOpenArrivalSpec;
  materials?: DesMaterialSpec[];
}

export interface DesConfidenceInterval {
  mean: number;
  sd: number;
  ci95Low: number;
  ci95High: number;
}

export interface DesStationTelemetry {
  index: number;
  id: string;
  name: string;
  machineCount: number;
  bufferCapacity: number;
  nominalCycleMin: number;
  /** Busy time / Scheduled working time (%). Reflects idle/starved & blocked demand losses. */
  assetUtilizationPct: number;
  busyPct: number;
  setupPct: number;
  blockedPct: number;
  starvedPct: number;
  downPct: number;
  pmPct: number;
  materialWaitPct: number;
  offShiftCalendarPct: number;
  /** Nakajima Availability: (Scheduled - Down - PM) / Scheduled (%). Independent of demand starvation. */
  oeeAvailabilityPct: number;
  /** Active speed/setup/blocking efficiency: earnedIdealWork / (busy + setup + blocked) (%). */
  oeePerformancePct: number;
  busyMin: number;
  setupMin: number;
  blockedMin: number;
  starvedMin: number;
  downMin: number;
  pmMin: number;
  offShiftMin: number;
  avgQueueLen: number;
  maxQueueLen: number;
  avgWaitMin: number;
  processedOps: number;
  failuresCount: number;
  pmEventsCount: number;
  setupCount: number;
  isBottleneck: boolean;
}

export interface DesOrderTelemetry {
  id: string;
  sku: string;
  routeId: string;
  orderedQty: number;
  releasedQty: number;
  completedQty: number;
  scrappedQty: number;
  inWipQty: number;
  completionRatePct: number;
  avgLeadTimeMin: number;
  onTimePct: number;
  avgTardinessMin: number;
}

export interface DesMaterialTelemetry {
  sku: string;
  name: string;
  unit: string;
  initialStock: number;
  endingStock: number;
  minStock: number;
  totalConsumed: number;
  replenishmentOrders: number;
  totalOrderedQty: number;
  starvationEvents: number;
  starvedMinutes: number;
  stockoutOccurred: boolean;
}

export interface DesFlowBalance {
  wipAtWarmupStart: number;
  arrivedAfterWarmup: number;
  completedGood: number;
  rejectedScrapped: number;
  wipAtEnd: number;
  rejectedAtFiniteGate: number;
  /** Exact accounting identity: (wipAtWarmupStart + arrivedAfterWarmup) - (completedGood + rejectedScrapped + wipAtEnd). Always 0. */
  conservationResidual: number;
}

export interface DesTimelineSample {
  minute: number;
  hour: number;
  label: string;
  isWorking: boolean;
  wip: number;
  stagingWip: number;
  completedCumulative: number;
  scrappedCumulative: number;
  reworkCumulative: number;
  throughputPerScheduledHr: number;
  stationStates: Array<'busy' | 'setup' | 'blocked' | 'starved' | 'down' | 'pm' | 'offShift'>;
  stationQueues: number[];
}

export interface DesResult {
  valid: boolean;
  reason: string;
  provenance: 'SIMULATED_MODEL';
  provenanceNotice: string;
  deterministic: boolean;
  seed: number;
  replications: number;
  calendarHours: number;
  scheduledWorkingHours: number;
  warmupCalendarHours: number;
  observedCalendarHours: number;
  observedScheduledHours: number;

  // Core Production KPIs (with 95% CI across replications)
  throughputPerScheduledHour: DesConfidenceInterval;
  throughputPerCalendarHour: DesConfidenceInterval;
  avgCycleTimeMin: DesConfidenceInterval;
  avgLeadTimeMin: DesConfidenceInterval;
  avgWip: DesConfidenceInterval;
  maxWip: number;
  totalThroughputGood: number;
  rejectedQty: number;
  reworkedQty: number;
  firstPassGoodQty: number;
  totalEnteredPostWarmup: number;
  completionRatePct: number;
  onTimeDeliveryPct: number;
  firstPassYieldPct: number;

  // OEE vs Asset Utilization (Strictly Distinguished)
  assetUtilizationPct: number;
  oeeAvailabilityPct: number;
  oeePerformancePct: number;
  oeeQualityPct: number;
  oeePct: number;
  teepPct: number;

  // Queueing, Bottleneck & Idle / Downtime Aggregates
  avgQueueWaitMin: number;
  bottleneckIndex: number;
  bottleneckId: string;
  bottleneckName: string;
  bottleneckWorkloadPct: number;
  totalIdleStarvedMin: number;
  totalDowntimeMin: number;

  // Little's Law & Exact Job Conservation
  littlesLawExpectedWip: number;
  littlesLawGapPct: number;
  flowBalance: DesFlowBalance;

  // Economics
  costPerGoodUnit: number;

  stations: DesStationTelemetry[];
  orders: DesOrderTelemetry[];
  materials: DesMaterialTelemetry[];
  timeline: DesTimelineSample[];
}

export interface DesExperimentPoint {
  id: string;
  label: string;
  category: 'buffer' | 'machines' | 'volume' | 'reliability';
  paramValue: string;
  throughputPerHour: number;
  throughputDeltaPct: number;
  avgCycleTimeMin: number;
  avgLeadTimeMin: number;
  avgWip: number;
  oeePct: number;
  assetUtilizationPct: number;
  rejectedQty: number;
  completionRatePct: number;
  bottleneckName: string;
}

/* -------------------------------------------------------------------------- */
/*  Mathematical Utilities: Distributions, Student-t CI & Working Calendar    */
/* -------------------------------------------------------------------------- */

const T_975_DF: ReadonlyArray<number> = [
  12.7062, 4.3027, 3.1824, 2.7764, 2.5706, 2.4469, 2.3646, 2.306, 2.2622, 2.2281,
  2.201, 2.1788, 2.1604, 2.1448, 2.1314, 2.1199, 2.1098, 2.1009, 2.093, 2.086,
  2.0796, 2.0739, 2.0687, 2.0639, 2.0595, 2.0555, 2.0518, 2.0484, 2.0452,
];

function studentT975(df: number): number {
  if (df <= 0) return 0;
  if (df <= T_975_DF.length) return T_975_DF[df - 1];
  // Asymptotic expansion accurate beyond df=29
  const z = 1.959963984540054;
  return z + (z ** 3 + z) / (4 * df);
}

export function summarizeDesCI(values: ReadonlyArray<number>): DesConfidenceInterval {
  const n = values.length;
  if (n === 0) return { mean: 0, sd: 0, ci95Low: 0, ci95High: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, sd: 0, ci95Low: mean, ci95High: mean };
  const variance = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / (n - 1);
  const sd = Math.sqrt(Math.max(0, variance));
  const half = studentT975(n - 1) * (sd / Math.sqrt(n));
  return {
    mean,
    sd,
    ci95Low: Math.max(0, mean - half),
    ci95High: mean + half,
  };
}

/** Lanczos log-gamma for Weibull CV <-> shape calibration. */
function logGamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const zm1 = z - 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) {
    x += p[i] / (zm1 + i);
  }
  const t = zm1 + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zm1 + 0.5) * Math.log(t) - t + Math.log(x);
}

function gammaFn(z: number): number {
  return Math.exp(logGamma(z));
}

function uniformPositive(rnd: () => number): number {
  let u = rnd();
  while (u <= 1e-12 || u >= 1) {
    u = rnd();
  }
  return u;
}

/** Marsaglia & Tsang (2000) Gamma(shape, scale=1) sampler. */
function sampleStandardGamma(rnd: () => number, shape: number): number {
  const k = Math.max(1e-4, shape);
  if (k < 1) {
    const u = uniformPositive(rnd);
    return sampleStandardGamma(rnd, k + 1) * Math.pow(u, 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x = normalFrom(rnd, 0, 1);
    let v = 1 + c * x;
    while (v <= 0) {
      x = normalFrom(rnd, 0, 1);
      v = 1 + c * x;
    }
    v = v * v * v;
    const u = uniformPositive(rnd);
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Calibrate Weibull shape k from target CV = sqrt(Gamma(1 + 2/k)/Gamma(1 + 1/k)^2 - 1)
 * via bisection on [0.25, 25].
 */
function weibullShapeFromCv(cv: number): number {
  const targetCv2 = Math.max(1e-5, cv * cv);
  let lo = 0.25;
  let hi = 25;
  for (let iter = 0; iter < 36; iter++) {
    const mid = 0.5 * (lo + hi);
    const g1 = gammaFn(1 + 1 / mid);
    const g2 = gammaFn(1 + 2 / mid);
    const cv2 = Math.max(0, g2 / (g1 * g1) - 1);
    if (cv2 > targetCv2) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Sample strictly positive duration from supported distribution with mean preservation.
 */
export function sampleDist(rnd: () => number, spec: DesDistSpec, deterministic: boolean): number {
  const meanVal = Math.max(1e-4, Number(spec.mean) || 0);
  const cv = Math.max(0, Number(spec.cv ?? 0));
  if (deterministic || spec.kind === 'constant') {
    return meanVal;
  }
  if (spec.kind === 'exponential') {
    return -meanVal * Math.log(uniformPositive(rnd));
  }
  if (cv <= 1e-6 && spec.kind !== 'weibull' && spec.kind !== 'gamma') {
    return meanVal;
  }
  if (spec.kind === 'normal') {
    return Math.max(meanVal * 0.05, normalFrom(rnd, meanVal, meanVal * cv));
  }
  if (spec.kind === 'lognormal') {
    const s2 = Math.log(1 + cv * cv);
    const sdLog = Math.sqrt(s2);
    const muLog = Math.log(meanVal) - 0.5 * s2;
    return Math.max(1e-4, Math.exp(normalFrom(rnd, muLog, sdLog)));
  }
  if (spec.kind === 'gamma') {
    const k = spec.shape && spec.shape > 0 ? spec.shape : cv > 1e-5 ? 1 / (cv * cv) : 1000;
    const scale = meanVal / k;
    return Math.max(1e-4, sampleStandardGamma(rnd, k) * scale);
  }
  // Weibull: F^-1(u) = scale * (-ln u)^(1/k), where scale = mean / Gamma(1 + 1/k)
  const k = spec.shape && spec.shape > 0 ? spec.shape : cv > 1e-5 ? weibullShapeFromCv(cv) : 10;
  const scale = meanVal / gammaFn(1 + 1 / k);
  return Math.max(1e-4, scale * Math.pow(-Math.log(uniformPositive(rnd)), 1 / k));
}

/* -------------------------------------------------------------------------- */
/*  Working Calendar Schedule Helpers                                         */
/* -------------------------------------------------------------------------- */

interface NormalizedCalendar {
  continuous24x7: boolean;
  intervalsPerDay: Array<{ startMin: number; endMin: number }>;
  workingDaysPerWeek: number;
  workingMinPerWeek: number;
}

function normalizeCalendar(cal?: DesShiftCalendar): NormalizedCalendar {
  if (!cal) {
    return {
      continuous24x7: true,
      intervalsPerDay: [{ startMin: 0, endMin: 1440 }],
      workingDaysPerWeek: 7,
      workingMinPerWeek: 7 * 1440,
    };
  }
  const shifts = Math.max(1, Math.min(3, Math.round(cal.shiftsPerDay || 1)));
  const gap = Math.max(0, Number(cal.interShiftGapMin ?? 0));
  const rawShiftMin = Math.max(30, Number(cal.shiftHours || 8) * 60);
  const startOffset = Math.max(0, Math.min(1439, Number(cal.firstShiftStartMin ?? 0)));
  const daysPerWeek = Math.max(1, Math.min(7, Math.round(cal.workingDaysPerWeek ?? 7)));

  // Check if exact 24/7
  if (shifts * rawShiftMin >= 1440 - 1e-6 && gap <= 1e-6 && daysPerWeek === 7) {
    return {
      continuous24x7: true,
      intervalsPerDay: [{ startMin: 0, endMin: 1440 }],
      workingDaysPerWeek: 7,
      workingMinPerWeek: 7 * 1440,
    };
  }

  const intervals: Array<{ startMin: number; endMin: number }> = [];
  let cursor = startOffset;
  for (let s = 0; s < shifts && cursor < 1440; s++) {
    const end = Math.min(1440, cursor + rawShiftMin);
    if (end > cursor + 1e-6) {
      intervals.push({ startMin: cursor, endMin: end });
    }
    cursor = end + gap;
  }
  if (intervals.length === 0) {
    intervals.push({ startMin: 0, endMin: Math.min(1440, rawShiftMin) });
  }
  const dayMin = intervals.reduce((acc, iv) => acc + (iv.endMin - iv.startMin), 0);
  return {
    continuous24x7: false,
    intervalsPerDay: intervals,
    workingDaysPerWeek: daysPerWeek,
    workingMinPerWeek: dayMin * daysPerWeek,
  };
}

/** Check if calendar minute `t` falls inside a scheduled working shift window. */
export function isWorkingCalendarMinute(t: number, cal?: DesShiftCalendar): boolean {
  const norm = normalizeCalendar(cal);
  if (norm.continuous24x7) return true;
  const dayIdx = Math.floor(t / 1440);
  const dow = dayIdx % 7;
  if (dow >= norm.workingDaysPerWeek) return false;
  const mod = t - dayIdx * 1440;
  for (const iv of norm.intervalsPerDay) {
    if (mod >= iv.startMin - 1e-9 && mod < iv.endMin - 1e-9) return true;
  }
  return false;
}

/** Convert elapsed working minutes starting from `fromCalMin` into exact calendar completion timestamp. */
export function advanceWorkingMinutes(fromCalMin: number, workDeltaMin: number, cal?: DesShiftCalendar): number {
  const norm = normalizeCalendar(cal);
  if (norm.continuous24x7 || workDeltaMin <= 0) return fromCalMin + Math.max(0, workDeltaMin);
  let remaining = workDeltaMin;
  let t = fromCalMin;
  let guard = 0;
  while (remaining > 1e-9 && guard < 100000) {
    guard++;
    const dayIdx = Math.floor(t / 1440);
    const dow = dayIdx % 7;
    if (dow >= norm.workingDaysPerWeek) {
      t = (dayIdx + 1) * 1440;
      continue;
    }
    const mod = t - dayIdx * 1440;
    let jumped = false;
    for (const iv of norm.intervalsPerDay) {
      if (mod < iv.startMin - 1e-9) {
        t = dayIdx * 1440 + iv.startMin;
        jumped = true;
        break;
      }
      if (mod >= iv.startMin - 1e-9 && mod < iv.endMin - 1e-9) {
        const avail = iv.endMin - mod;
        if (remaining <= avail + 1e-9) {
          return t + remaining;
        }
        remaining -= avail;
        t = dayIdx * 1440 + iv.endMin;
        jumped = true;
        break;
      }
    }
    if (!jumped) {
      t = (dayIdx + 1) * 1440;
    }
  }
  return t;
}

/** Exact scheduled working minutes contained in `[startCal, endCal]`. */
export function scheduledMinutesBetween(startCal: number, endCal: number, cal?: DesShiftCalendar): number {
  const norm = normalizeCalendar(cal);
  const lo = Math.max(0, startCal);
  const hi = Math.max(lo, endCal);
  if (norm.continuous24x7) return hi - lo;

  const firstDay = Math.floor(lo / 1440);
  const lastDay = Math.floor(hi / 1440);
  let total = 0;
  for (let d = firstDay; d <= lastDay; d++) {
    if (d % 7 >= norm.workingDaysPerWeek) continue;
    const dayStart = d * 1440;
    for (const iv of norm.intervalsPerDay) {
      const a = Math.max(lo, dayStart + iv.startMin);
      const b = Math.min(hi, dayStart + iv.endMin);
      if (b > a) total += b - a;
    }
  }
  return total;
}

function buildCalendarTransitions(totalCalMin: number, norm: NormalizedCalendar): Array<{ time: number; workingAfter: boolean }> {
  if (norm.continuous24x7) return [];
  const transitions: Array<{ time: number; workingAfter: boolean }> = [];
  const maxDay = Math.ceil(totalCalMin / 1440);
  for (let d = 0; d <= maxDay; d++) {
    if (d % 7 >= norm.workingDaysPerWeek) continue;
    const base = d * 1440;
    for (const iv of norm.intervalsPerDay) {
      const s = base + iv.startMin;
      const e = base + iv.endMin;
      if (s > 0 && s < totalCalMin) transitions.push({ time: s, workingAfter: true });
      if (e > 0 && e < totalCalMin) transitions.push({ time: e, workingAfter: false });
    }
  }
  // Merge consecutive duplicate boundaries (e.g. gap === 0)
  const merged: Array<{ time: number; workingAfter: boolean }> = [];
  for (const tr of transitions) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.time - tr.time) < 1e-9) {
      merged.pop();
    } else {
      merged.push(tr);
    }
  }
  return merged;
}

/* -------------------------------------------------------------------------- */
/*  DES Internal Event & State Types                                          */
/* -------------------------------------------------------------------------- */

type DesEventType =
  | 'open_arrival'
  | 'order_release'
  | 'setup_done'
  | 'process_done'
  | 'machine_fail'
  | 'repair_done'
  | 'pm_done'
  | 'pm_due'
  | 'material_arrival'
  | 'shift_start'
  | 'shift_end'
  | 'warmup_end'
  | 'timeline_sample'
  | 'sim_end';

interface DesEvent extends HeapComparable {
  type: DesEventType;
  stationIdx?: number;
  machineIdx?: number;
  materialIdx?: number;
  orderIdx?: number;
  token?: number;
}

interface DesJob {
  id: number;
  orderIdx: number; // -1 for open arrivals
  orderId: string;
  routeIdx: number;
  sku: string;
  stepIdx: number;
  priority: number;
  releaseAtMin: number;
  dueAtMin: number;
  enteredFloorAt: number;
  enteredQueueAt: number;
  reworkCount: number;
  hadRework: boolean;
  materialConsumed: boolean;
  /** Nominal ideal processing minutes summed across completed steps */
  nominalIdealEarnedHere?: number;
}

type MachinePhase = 'idle' | 'setup' | 'busy' | 'blocked' | 'down' | 'pm';

interface MachineRuntime {
  phase: MachinePhase;
  lastSku: string | null;
  job: DesJob | null;
  blockedTargetStationIdx: number; // -1 unless blocked waiting downstream buffer
  setupRemMin: number;
  procRemMin: number;
  downRemMin: number;
  pmRemMin: number;
  failRemMin: number;
  pmIntervalRemMin: number;
  /** Phase paused while down; restores to busy/setup on repair end */
  pausedByDownPhase: 'idle' | 'setup' | 'busy';
  eventToken: number;
  failToken: number;
  pmToken: number;
  phaseResumeCal: number;
  relResumeCal: number;
  failuresCount: number;
  pmEventsCount: number;
  setupCount: number;
}

interface StationRuntime {
  spec: DesStationSpec;
  queue: DesJob[];
  machines: MachineRuntime[];
  waitingMaterial: boolean;
  // Observation accumulators (reset cleanly on warmup_end)
  busyMin: number;
  setupMin: number;
  blockedMin: number;
  starvedMin: number;
  downMin: number;
  pmMin: number;
  matWaitMin: number;
  offShiftMin: number;
  earnedIdealMin: number;
  queueArea: number;
  waitTimeSum: number;
  waitCount: number;
  maxQueueLen: number;
  processedOps: number;
}

interface MaterialRuntime {
  spec: DesMaterialSpec;
  stock: number;
  onOrder: number;
  minStock: number;
  totalConsumed: number;
  replenishmentOrders: number;
  totalOrderedQty: number;
  starvationEvents: number;
  starvedMinutes: number;
}

interface OrderRuntime {
  spec: DesOrderSpec;
  routeIdx: number;
  releasedQty: number;
  completedQty: number;
  scrappedQty: number;
  leadTimeSum: number;
  onTimeCount: number;
  tardinessSum: number;
}

/* -------------------------------------------------------------------------- */
/*  Config Validation                                                         */
/* -------------------------------------------------------------------------- */

function validateDesConfig(cfg: DesConfig): string | null {
  if (!cfg || !Array.isArray(cfg.stations) || cfg.stations.length === 0) {
    return 'Configuration requires at least one workstation.';
  }
  if (!Number.isFinite(cfg.horizonHours) || cfg.horizonHours <= 0) {
    return 'Simulation horizonHours must be positive.';
  }
  const warmup = Number(cfg.warmupHours ?? 0);
  if (!Number.isFinite(warmup) || warmup < 0 || warmup >= cfg.horizonHours) {
    return 'warmupHours must be >= 0 and strictly less than horizonHours.';
  }
  const stationIds = new Set<string>();
  for (const st of cfg.stations) {
    if (!st.id || stationIds.has(st.id)) {
      return `Workstation id "${st.id}" is missing or duplicated.`;
    }
    stationIds.add(st.id);
    if (!Number.isFinite(st.machineCount) || st.machineCount < 1) {
      return `Station ${st.id} requires machineCount >= 1.`;
    }
    if (!Number.isFinite(st.bufferCapacity) || st.bufferCapacity < 1) {
      return `Station ${st.id} requires finite bufferCapacity >= 1.`;
    }
    if (!st.processDist || !Number.isFinite(st.processDist.mean) || st.processDist.mean <= 0) {
      return `Station ${st.id} requires positive processDist.mean.`;
    }
  }
  if (!Array.isArray(cfg.routes) || cfg.routes.length === 0) {
    return 'Configuration requires at least one product route.';
  }
  const routeIds = new Set<string>();
  for (const rt of cfg.routes) {
    if (!rt.id || routeIds.has(rt.id)) {
      return `Route id "${rt.id}" is missing or duplicated.`;
    }
    routeIds.add(rt.id);
    if (!Array.isArray(rt.steps) || rt.steps.length === 0) {
      return `Route ${rt.id} requires at least one routing step.`;
    }
    for (let si = 0; si < rt.steps.length; si++) {
      const step = rt.steps[si];
      if (!stationIds.has(step.stationId)) {
        return `Route ${rt.id} step ${si + 1} references unknown station "${step.stationId}".`;
      }
      if (step.reworkToStepIdx != null && (step.reworkToStepIdx < 0 || step.reworkToStepIdx >= rt.steps.length)) {
        return `Route ${rt.id} step ${si + 1} has invalid reworkToStepIdx.`;
      }
    }
  }
  const orders = cfg.orders ?? [];
  const openRate = cfg.openArrivals?.ratePerHour ?? 0;
  if (orders.length === 0 && openRate <= 0) {
    return 'Provide at least one production order or positive openArrivals.ratePerHour.';
  }
  for (const ord of orders) {
    if (!routeIds.has(ord.routeId)) {
      return `Order ${ord.id} references unknown route "${ord.routeId}".`;
    }
    if (!Number.isFinite(ord.qty) || ord.qty < 1) {
      return `Order ${ord.id} requires qty >= 1.`;
    }
    if (!Number.isFinite(ord.releaseAtMin) || ord.releaseAtMin < 0) {
      return `Order ${ord.id} requires releaseAtMin >= 0.`;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Core Discrete-Event Simulation Engine                                     */
/* -------------------------------------------------------------------------- */

function buildInvalidDesResult(cfg: DesConfig, reason: string): DesResult {
  return {
    valid: false,
    reason,
    provenance: 'SIMULATED_MODEL',
    provenanceNotice: 'Discrete-event simulation model did not execute due to invalid configuration.',
    deterministic: !!cfg?.deterministic,
    seed: cfg?.seed ?? 1,
    replications: 0,
    calendarHours: 0,
    scheduledWorkingHours: 0,
    warmupCalendarHours: 0,
    observedCalendarHours: 0,
    observedScheduledHours: 0,
    throughputPerScheduledHour: { mean: 0, sd: 0, ci95Low: 0, ci95High: 0 },
    throughputPerCalendarHour: { mean: 0, sd: 0, ci95Low: 0, ci95High: 0 },
    avgCycleTimeMin: { mean: 0, sd: 0, ci95Low: 0, ci95High: 0 },
    avgLeadTimeMin: { mean: 0, sd: 0, ci95Low: 0, ci95High: 0 },
    avgWip: { mean: 0, sd: 0, ci95Low: 0, ci95High: 0 },
    maxWip: 0,
    totalThroughputGood: 0,
    rejectedQty: 0,
    reworkedQty: 0,
    firstPassGoodQty: 0,
    totalEnteredPostWarmup: 0,
    completionRatePct: 0,
    onTimeDeliveryPct: 0,
    firstPassYieldPct: 0,
    assetUtilizationPct: 0,
    oeeAvailabilityPct: 0,
    oeePerformancePct: 0,
    oeeQualityPct: 0,
    oeePct: 0,
    teepPct: 0,
    avgQueueWaitMin: 0,
    bottleneckIndex: 0,
    bottleneckId: '',
    bottleneckName: 'N/A',
    bottleneckWorkloadPct: 0,
    totalIdleStarvedMin: 0,
    totalDowntimeMin: 0,
    littlesLawExpectedWip: 0,
    littlesLawGapPct: 0,
    flowBalance: {
      wipAtWarmupStart: 0,
      arrivedAfterWarmup: 0,
      completedGood: 0,
      rejectedScrapped: 0,
      wipAtEnd: 0,
      rejectedAtFiniteGate: 0,
      conservationResidual: 0,
    },
    costPerGoodUnit: 0,
    stations: [],
    orders: [],
    materials: [],
    timeline: [],
  };
}

export function runDiscreteEventSimulation(cfg: DesConfig): DesResult {
  const err = validateDesConfig(cfg);
  if (err) return buildInvalidDesResult(cfg, err);

  const deterministic = !!cfg.deterministic;
  const reps = deterministic ? 1 : Math.max(1, Math.min(40, Math.round(cfg.replications ?? 5)));
  const baseSeed = Number.isFinite(cfg.seed) ? Math.floor(cfg.seed!) : 2026;
  const totalCalMin = cfg.horizonHours * 60;
  const warmupMin = (cfg.warmupHours ?? 0) * 60;
  const normCal = normalizeCalendar(cfg.calendar);
  const scheduledTotalMin = scheduledMinutesBetween(0, totalCalMin, cfg.calendar);
  const observedCalMin = totalCalMin - warmupMin;
  const observedSchedMin = Math.max(1e-6, scheduledMinutesBetween(warmupMin, totalCalMin, cfg.calendar));

  const nStations = cfg.stations.length;
  const stationIdxById = new Map<string, number>();
  cfg.stations.forEach((s, idx) => stationIdxById.set(s.id, idx));

  const routeIdxById = new Map<string, number>();
  cfg.routes.forEach((r, idx) => routeIdxById.set(r.id, idx));

  const matsSpec = cfg.materials ?? [];
  const matIdxBySku = new Map<string, number>();
  matsSpec.forEach((m, idx) => matIdxBySku.set(m.sku, idx));

  // Normalize open arrival route mix
  const openSpec = cfg.openArrivals;
  const openRatePerHr = Math.max(0, Number(openSpec?.ratePerHour ?? 0));
  const openMix: Array<{ routeIdx: number; cumWeight: number }> = [];
  if (openRatePerHr > 0) {
    const rawMix = openSpec?.mix?.length
      ? openSpec.mix.map((m) => ({
          routeIdx: routeIdxById.get(m.routeId) ?? 0,
          w: Math.max(0, Number(m.weight) || 0),
        }))
      : cfg.routes.map((_, ri) => ({ routeIdx: ri, w: 1 }));
    const wSum = rawMix.reduce((a, b) => a + b.w, 0) || 1;
    let acc = 0;
    for (const item of rawMix) {
      acc += item.w / wSum;
      openMix.push({ routeIdx: item.routeIdx, cumWeight: acc });
    }
    if (openMix.length) openMix[openMix.length - 1].cumWeight = 1;
  }

  const calTransitions = buildCalendarTransitions(totalCalMin, normCal);

  // Replication accumulators
  const repTpSched: number[] = [];
  const repTpCal: number[] = [];
  const repCycle: number[] = [];
  const repLead: number[] = [];
  const repWip: number[] = [];
  const repFloorWip: number[] = [];
  let maxWipAcrossReps = 0;

  let aggGood = 0;
  let aggScrap = 0;
  let aggRework = 0;
  let aggFirstPass = 0;
  let aggEnteredPostWarmup = 0;
  let aggWipStart = 0;
  let aggWipEnd = 0;
  let aggGateRejected = 0;
  let aggConservationResidual = 0;
  let aggOnTimeCount = 0;
  let aggDeliveredTracked = 0;

  const aggStation = cfg.stations.map(() => ({
    busyMin: 0,
    setupMin: 0,
    blockedMin: 0,
    starvedMin: 0,
    downMin: 0,
    pmMin: 0,
    matWaitMin: 0,
    offShiftMin: 0,
    earnedIdealMin: 0,
    queueArea: 0,
    waitSum: 0,
    waitCount: 0,
    maxQueue: 0,
    processedOps: 0,
    failures: 0,
    pmEvents: 0,
    setups: 0,
  }));

  const aggMats = matsSpec.map(() => ({
    endStock: 0,
    minStock: Infinity,
    consumed: 0,
    orders: 0,
    orderedQty: 0,
    starveEvents: 0,
    starvedMin: 0,
  }));

  const aggOrders = (cfg.orders ?? []).map(() => ({
    released: 0,
    completed: 0,
    scrapped: 0,
    inWip: 0,
    leadSum: 0,
    onTime: 0,
    tardinessSum: 0,
  }));

  let sampleTimeline: DesTimelineSample[] = [];

  for (let rep = 0; rep < reps; rep++) {
    const rnd = mulberry32((baseSeed + Math.imul(rep + 1, 0x9e3779b1)) >>> 0);
    const heap = new MinHeap<DesEvent>();
    let seq = 0;
    const schedule = (ev: Omit<DesEvent, 'seq'>) => {
      if (ev.time <= totalCalMin + 1e-9) {
        heap.push({ ...ev, seq: seq++ });
      }
    };

    let t = 0;
    let working = isWorkingCalendarMinute(0, cfg.calendar);
    let observing = warmupMin <= 1e-9;

    const sampleFailureInterval = (st: DesStationSpec): number => {
      if (deterministic || !st.mtbfMin || st.mtbfMin <= 0 || !st.mttrMin || st.mttrMin <= 0) {
        return Infinity;
      }
      const kind = st.failureDistKind ?? 'exponential';
      const baseMtbf = st.pmIntervalMin && st.pmDurationMin ? st.mtbfMin * 1.45 : st.mtbfMin;
      return sampleDist(
        rnd,
        {
          kind,
          mean: baseMtbf,
          cv: kind === 'lognormal' ? 0.5 : 1.0,
          shape: st.failureWeibullShape ?? 1.6,
        },
        false
      );
    };

    const sampleRepairDur = (st: DesStationSpec): number => {
      const mean = Math.max(0.5, st.mttrMin ?? 8);
      if (deterministic) return mean;
      return Math.max(
        0.5,
        sampleDist(
          rnd,
          { kind: st.repairDistKind ?? 'lognormal', mean, cv: st.repairCv ?? 0.35 },
          false
        )
      );
    };

    const stations: StationRuntime[] = cfg.stations.map((spec) => {
      const mCount = Math.max(1, Math.min(12, Math.round(spec.machineCount)));
      const machines: MachineRuntime[] = Array.from({ length: mCount }, (_, mi) => {
        const failRem = sampleFailureInterval(spec);
        const pmInit =
          spec.pmIntervalMin && spec.pmIntervalMin > 0 && spec.pmDurationMin && spec.pmDurationMin > 0
            ? spec.pmIntervalMin * (0.7 + (mi * 0.3) / mCount)
            : Infinity;
        return {
          phase: 'idle',
          lastSku: null,
          job: null,
          blockedTargetStationIdx: -1,
          setupRemMin: 0,
          procRemMin: 0,
          downRemMin: 0,
          pmRemMin: 0,
          failRemMin: failRem,
          pmIntervalRemMin: pmInit,
          pausedByDownPhase: 'idle',
          eventToken: 0,
          failToken: 0,
          pmToken: 0,
          phaseResumeCal: 0,
          relResumeCal: 0,
          failuresCount: 0,
          pmEventsCount: 0,
          setupCount: 0,
        };
      });
      return {
        spec,
        queue: [],
        machines,
        waitingMaterial: false,
        busyMin: 0,
        setupMin: 0,
        blockedMin: 0,
        starvedMin: 0,
        downMin: 0,
        pmMin: 0,
        matWaitMin: 0,
        offShiftMin: 0,
        earnedIdealMin: 0,
        queueArea: 0,
        waitTimeSum: 0,
        waitCount: 0,
        maxQueueLen: 0,
        processedOps: 0,
      };
    });

    const materials: MaterialRuntime[] = matsSpec.map((spec) => ({
      spec,
      stock: Math.max(0, spec.initialStock),
      onOrder: 0,
      minStock: Math.max(0, spec.initialStock),
      totalConsumed: 0,
      replenishmentOrders: 0,
      totalOrderedQty: 0,
      starvationEvents: 0,
      starvedMinutes: 0,
    }));

    const orders: OrderRuntime[] = (cfg.orders ?? []).map((spec) => ({
      spec,
      routeIdx: routeIdxById.get(spec.routeId) ?? 0,
      releasedQty: 0,
      completedQty: 0,
      scrappedQty: 0,
      leadTimeSum: 0,
      onTimeCount: 0,
      tardinessSum: 0,
    }));

    // Order staging queue preserves released units safely when station 0 buffer is full (zero phantom drop)
    const stagingQueue: DesJob[] = [];

    // Job & flow conservation counters (strictly post-warmup unless warmup === 0)
    let nextJobId = 1;
    let wipTotal = 0;
    let wipAtWarmupStart = 0;
    let arrivedAfterWarmup = 0;
    let rejectedAtGate = 0;
    let goodCompleted = 0;
    let firstPassCompleted = 0;
    let scrappedCompleted = 0;
    let reworkEvents = 0;
    let onTimeGood = 0;
    let cycleSum = 0;
    let cycleCount = 0;
    let leadSum = 0;
    let leadCount = 0;
    let wipArea = 0;
    let floorWipArea = 0;
    let maxWip = 0;

    // Seed calendar transitions
    for (const tr of calTransitions) {
      schedule({
        time: tr.time,
        type: tr.workingAfter ? 'shift_start' : 'shift_end',
      });
    }

    // Seed warmup boundary & sim end
    if (warmupMin > 1e-9) {
      schedule({ time: warmupMin, type: 'warmup_end' });
    }
    schedule({ time: totalCalMin, type: 'sim_end' });

    // Seed timeline sampling on rep 0
    const traceInt = Math.max(10, Math.round(cfg.traceIntervalMin ?? Math.max(15, Math.round(observedCalMin / 36))));
    const timeline: DesTimelineSample[] = [];
    if (rep === 0) {
      for (let ts = warmupMin; ts <= totalCalMin + 1e-6; ts += traceInt) {
        schedule({ time: Math.min(totalCalMin, ts), type: 'timeline_sample' });
      }
    }

    // Seed order releases
    orders.forEach((ord, oi) => {
      schedule({ time: ord.spec.releaseAtMin, type: 'order_release', orderIdx: oi });
    });

    // Helper: sample next open arrival timestamp
    const openMeanInterMin = openRatePerHr > 0 ? 60 / openRatePerHr : Infinity;
    const scheduleNextOpenArrival = (fromCal: number) => {
      if (openRatePerHr <= 0) return;
      const cv = Math.max(0, openSpec?.cv ?? 1);
      const delta = sampleDist(
        rnd,
        { kind: cv === 0 || deterministic ? 'constant' : cv === 1 ? 'exponential' : 'lognormal', mean: openMeanInterMin, cv },
        deterministic
      );
      const clockMode = openSpec?.clockMode ?? 'working';
      const target =
        clockMode === 'working' ? advanceWorkingMinutes(fromCal, delta, cfg.calendar) : fromCal + delta;
      if (target <= totalCalMin + 1e-9) {
        schedule({ time: target, type: 'open_arrival' });
      }
    };

    if (openRatePerHr > 0) {
      // If deterministic, first arrival at mean interval or t=0? Standard arrival stream starts at first interarrival (or working start + delta)
      scheduleNextOpenArrival(0);
    }

    // Schedule initial failure & PM events when starting inside a working window
    const armReliabilityForMachine = (si: number, mi: number, now: number) => {
      const m = stations[si].machines[mi];
      m.relResumeCal = now;
      if (Number.isFinite(m.failRemMin) && m.phase !== 'down' && m.phase !== 'pm') {
        m.failToken++;
        schedule({
          time: now + m.failRemMin,
          type: 'machine_fail',
          stationIdx: si,
          machineIdx: mi,
          token: m.failToken,
        });
      }
      if (Number.isFinite(m.pmIntervalRemMin) && m.phase !== 'pm' && m.phase !== 'down') {
        m.pmToken++;
        schedule({
          time: now + m.pmIntervalRemMin,
          type: 'pm_due',
          stationIdx: si,
          machineIdx: mi,
          token: m.pmToken,
        });
      }
    };

    if (working) {
      for (let si = 0; si < nStations; si++) {
        for (let mi = 0; mi < stations[si].machines.length; mi++) {
          armReliabilityForMachine(si, mi, 0);
        }
      }
    }

    // Accumulate continuous time-weighted statistics over [prevT, nextT]
    const accumulate = (t0: number, t1: number) => {
      const dt = t1 - t0;
      if (dt <= 1e-12 || !observing) return;

      wipArea += wipTotal * dt;
      floorWipArea += Math.max(0, wipTotal - stagingQueue.length) * dt;
      maxWip = Math.max(maxWip, wipTotal);

      for (let si = 0; si < nStations; si++) {
        const st = stations[si];
        st.queueArea += st.queue.length * dt;
        st.maxQueueLen = Math.max(st.maxQueueLen, st.queue.length);

        const mCount = st.machines.length;
        if (!working) {
          st.offShiftMin += dt * mCount;
          continue;
        }
        let anyMatStarve = false;
        for (const m of st.machines) {
          if (m.phase === 'busy') st.busyMin += dt;
          else if (m.phase === 'setup') st.setupMin += dt;
          else if (m.phase === 'blocked') st.blockedMin += dt;
          else if (m.phase === 'down') st.downMin += dt;
          else if (m.phase === 'pm') st.pmMin += dt;
          else {
            st.starvedMin += dt;
            if (st.waitingMaterial && st.queue.length > 0) {
              st.matWaitMin += dt;
              anyMatStarve = true;
            }
          }
        }
        if (anyMatStarve) {
          for (const mat of materials) {
            if (mat.stock <= 1e-9) mat.starvedMinutes += dt;
          }
        }
      }
    };

    const checkReorderMaterials = (now: number) => {
      for (let mi = 0; mi < materials.length; mi++) {
        const mat = materials[mi];
        const invPos = mat.stock + mat.onOrder;
        if (invPos <= mat.spec.rop && mat.spec.orderQty > 0) {
          const lt = Math.max(1, mat.spec.leadTimeMin);
          mat.onOrder += mat.spec.orderQty;
          mat.replenishmentOrders++;
          mat.totalOrderedQty += mat.spec.orderQty;
          schedule({ time: now + lt, type: 'material_arrival', materialIdx: mi });
        }
      }
    };

    const canConsumeJobMaterials = (job: DesJob): boolean => {
      if (job.materialConsumed || materials.length === 0) return true;
      const route = cfg.routes[job.routeIdx];
      const bom = route.materialsPerJob;
      if (!bom || bom.length === 0) return true;
      for (const line of bom) {
        const mi = matIdxBySku.get(line.materialSku);
        if (mi == null) continue;
        if (materials[mi].stock + 1e-9 < line.qtyPerJob) return false;
      }
      return true;
    };

    const consumeJobMaterials = (job: DesJob, now: number) => {
      if (job.materialConsumed || materials.length === 0) {
        job.materialConsumed = true;
        return;
      }
      const route = cfg.routes[job.routeIdx];
      const bom = route.materialsPerJob;
      if (!bom || bom.length === 0) {
        job.materialConsumed = true;
        return;
      }
      for (const line of bom) {
        const mi = matIdxBySku.get(line.materialSku);
        if (mi == null) continue;
        const mat = materials[mi];
        mat.stock = Math.max(0, mat.stock - line.qtyPerJob);
        mat.minStock = Math.min(mat.minStock, mat.stock);
        if (observing) mat.totalConsumed += line.qtyPerJob;
      }
      job.materialConsumed = true;
      checkReorderMaterials(now);
    };

    const pickJobIndexFromQueue = (queue: DesJob[], discipline: DesQueueDiscipline = 'fifo'): number => {
      if (queue.length <= 1 || discipline === 'fifo') return 0;
      let best = 0;
      for (let i = 1; i < queue.length; i++) {
        if (discipline === 'edd') {
          if (queue[i].dueAtMin < queue[best].dueAtMin) best = i;
        } else if (discipline === 'priority') {
          if (
            queue[i].priority < queue[best].priority ||
            (queue[i].priority === queue[best].priority && queue[i].dueAtMin < queue[best].dueAtMin)
          ) {
            best = i;
          }
        }
      }
      return best;
    };

    const enqueueAtStation = (si: number, job: DesJob, now: number) => {
      job.enteredQueueAt = now;
      if (job.enteredFloorAt < 0) job.enteredFloorAt = now;
      stations[si].queue.push(job);
      if (observing) {
        stations[si].maxQueueLen = Math.max(stations[si].maxQueueLen, stations[si].queue.length);
      }
    };

    const drainStagingToEntry = (now: number) => {
      const entryCap = cfg.stations[0].bufferCapacity;
      while (stagingQueue.length > 0 && stations[0].queue.length < entryCap) {
        const j = stagingQueue.shift()!;
        enqueueAtStation(0, j, now);
      }
    };

    const beginMachineProcessing = (si: number, mi: number, now: number) => {
      const st = stations[si];
      const m = st.machines[mi];
      const job = m.job!;
      const route = cfg.routes[job.routeIdx];
      const step = route.steps[job.stepIdx];
      const baseDist = step.processDistOverride ?? st.spec.processDist;
      const mult = Math.max(0.01, Number(step.cycleTimeMult ?? 1));
      const procDist: DesDistSpec = { ...baseDist, mean: baseDist.mean * mult };
      const dur = sampleDist(rnd, procDist, deterministic);
      job.nominalIdealEarnedHere = procDist.mean;
      m.phase = 'busy';
      m.procRemMin = dur;
      m.phaseResumeCal = now;
      m.lastSku = job.sku;
      m.eventToken++;
      schedule({
        time: now + dur,
        type: 'process_done',
        stationIdx: si,
        machineIdx: mi,
        token: m.eventToken,
      });
    };

    const tryStartStation = (si: number, now: number) => {
      if (!working) return;
      const st = stations[si];
      st.waitingMaterial = false;

      for (let mi = 0; mi < st.machines.length; mi++) {
        if (st.queue.length === 0) break;
        const m = st.machines[mi];
        if (m.phase !== 'idle') continue;

        const qIdx = pickJobIndexFromQueue(st.queue, st.spec.queueDiscipline);
        const candidate = st.queue[qIdx];

        if (!canConsumeJobMaterials(candidate)) {
          st.waitingMaterial = true;
          for (const line of cfg.routes[candidate.routeIdx].materialsPerJob ?? []) {
            const mIdx = matIdxBySku.get(line.materialSku);
            if (mIdx != null && materials[mIdx].stock < line.qtyPerJob && observing) {
              materials[mIdx].starvationEvents++;
            }
          }
          checkReorderMaterials(now);
          continue;
        }

        // Dispatch job onto machine
        st.queue.splice(qIdx, 1);
        consumeJobMaterials(candidate, now);
        if (observing) {
          st.waitTimeSum += Math.max(0, now - candidate.enteredQueueAt);
          st.waitCount++;
        }

        m.job = candidate;
        m.blockedTargetStationIdx = -1;

        const route = cfg.routes[candidate.routeIdx];
        const step = route.steps[candidate.stepIdx];
        const baseSetup = Math.max(0, Number(step.setupMinOverride ?? st.spec.setupTimeMin ?? 0));
        const skuChangeOnly = st.spec.setupOnSkuChangeOnly ?? true;
        const needsSetup =
          baseSetup > 1e-6 && (!skuChangeOnly || (m.lastSku !== null && m.lastSku !== candidate.sku));

        if (needsSetup) {
          m.phase = 'setup';
          m.setupRemMin = baseSetup;
          m.phaseResumeCal = now;
          if (observing) m.setupCount++;
          m.eventToken++;
          schedule({
            time: now + baseSetup,
            type: 'setup_done',
            stationIdx: si,
            machineIdx: mi,
            token: m.eventToken,
          });
        } else {
          beginMachineProcessing(si, mi, now);
        }
      }

      if (si === 0) {
        drainStagingToEntry(now);
      }
    };

    // Deadlock-safe recursive release of machines blocked trying to push into `freedStationIdx`
    const wakeBlockedSendersFor = (freedStationIdx: number, now: number, visited: Set<number> = new Set()) => {
      if (visited.has(freedStationIdx)) return;
      visited.add(freedStationIdx);

      // Scan stations deterministically for machines blocked waiting on freedStationIdx
      for (let si = 0; si < nStations; si++) {
        const st = stations[si];
        for (let mi = 0; mi < st.machines.length; mi++) {
          const m = st.machines[mi];
          if (m.phase === 'blocked' && m.blockedTargetStationIdx === freedStationIdx && m.job) {
            if (stations[freedStationIdx].queue.length < stations[freedStationIdx].spec.bufferCapacity) {
              const job = m.job;
              m.job = null;
              m.phase = 'idle';
              m.blockedTargetStationIdx = -1;
              enqueueAtStation(freedStationIdx, job, now);
              tryStartStation(freedStationIdx, now);
              tryStartStation(si, now);
              wakeBlockedSendersFor(si, now, visited);
            }
          }
        }
      }

      if (freedStationIdx === 0) {
        drainStagingToEntry(now);
        if (stations[0].queue.length > 0) tryStartStation(0, now);
      }
    };

    const routeOrFinishJob = (si: number, mi: number, job: DesJob, now: number) => {
      const st = stations[si];
      const m = st.machines[mi];
      const route = cfg.routes[job.routeIdx];
      const step = route.steps[job.stepIdx];

      // 1. Step scrap check
      const scrapP = Math.max(0, Math.min(0.95, step.scrapRate ?? 0));
      if (!deterministic && scrapP > 0 && rnd() < scrapP) {
        wipTotal = Math.max(0, wipTotal - 1);
        m.job = null;
        m.phase = 'idle';
        m.blockedTargetStationIdx = -1;
        if (observing) {
          scrappedCompleted++;
          if (job.orderIdx >= 0) orders[job.orderIdx].scrappedQty++;
        }
        tryStartStation(si, now);
        wakeBlockedSendersFor(si, now);
        return;
      }

      // 2. Step rework check
      const reworkP = Math.max(0, Math.min(0.95, step.reworkProb ?? 0));
      if (!deterministic && reworkP > 0 && rnd() < reworkP) {
        const maxRework = Math.max(0, step.maxRework ?? 2);
        if (job.reworkCount < maxRework) {
          const rwStepIdx = step.reworkToStepIdx ?? job.stepIdx;
          const targetStationId = route.steps[rwStepIdx].stationId;
          const targetSi = stationIdxById.get(targetStationId)!;
          job.reworkCount++;
          job.hadRework = true;
          job.stepIdx = rwStepIdx;
          if (observing) reworkEvents++;

          // Same-station rework or target with buffer slot (plus cycle-deadlock guard if mutual block)
          const targetHasSpace = stations[targetSi].queue.length < stations[targetSi].spec.bufferCapacity;
          const mutualCycleBlock =
            targetSi !== si &&
            stations[targetSi].machines.some((tm) => tm.phase === 'blocked' && tm.blockedTargetStationIdx === si);

          if (targetHasSpace || mutualCycleBlock || targetSi === si) {
            m.job = null;
            m.phase = 'idle';
            m.blockedTargetStationIdx = -1;
            enqueueAtStation(targetSi, job, now);
            tryStartStation(targetSi, now);
            tryStartStation(si, now);
            if (targetSi !== si) wakeBlockedSendersFor(si, now);
          } else {
            m.phase = 'blocked';
            m.blockedTargetStationIdx = targetSi;
          }
          return;
        } else {
          // Exceeded rework limit -> reject/scrap
          wipTotal = Math.max(0, wipTotal - 1);
          m.job = null;
          m.phase = 'idle';
          m.blockedTargetStationIdx = -1;
          if (observing) {
            scrappedCompleted++;
            if (job.orderIdx >= 0) orders[job.orderIdx].scrappedQty++;
          }
          tryStartStation(si, now);
          wakeBlockedSendersFor(si, now);
          return;
        }
      }

      // 3. Advance to next route step or complete product
      if (job.stepIdx + 1 >= route.steps.length) {
        wipTotal = Math.max(0, wipTotal - 1);
        m.job = null;
        m.phase = 'idle';
        m.blockedTargetStationIdx = -1;
        if (observing) {
          goodCompleted++;
          if (!job.hadRework) firstPassCompleted++;
          const floorCycle = Math.max(0, now - (job.enteredFloorAt >= 0 ? job.enteredFloorAt : job.releaseAtMin));
          const orderLead = Math.max(0, now - job.releaseAtMin);
          cycleSum += floorCycle;
          cycleCount++;
          leadSum += orderLead;
          leadCount++;
          if (now <= job.dueAtMin + 1e-6) onTimeGood++;
          if (job.orderIdx >= 0) {
            const ord = orders[job.orderIdx];
            ord.completedQty++;
            ord.leadTimeSum += orderLead;
            if (now <= job.dueAtMin + 1e-6) ord.onTimeCount++;
            else ord.tardinessSum += now - job.dueAtMin;
          }
        }
        tryStartStation(si, now);
        wakeBlockedSendersFor(si, now);
        return;
      }

      // Advance to next station along SKU route
      job.stepIdx++;
      const nextStId = route.steps[job.stepIdx].stationId;
      const nextSi = stationIdxById.get(nextStId)!;

      if (stations[nextSi].queue.length < stations[nextSi].spec.bufferCapacity) {
        m.job = null;
        m.phase = 'idle';
        m.blockedTargetStationIdx = -1;
        enqueueAtStation(nextSi, job, now);
        tryStartStation(nextSi, now);
        tryStartStation(si, now);
        wakeBlockedSendersFor(si, now);
      } else {
        m.phase = 'blocked';
        m.blockedTargetStationIdx = nextSi;
      }
    };

    const takeSnapshot = (now: number): DesTimelineSample => {
      const hr = now / 60;
      const stationStates = stations.map((st) => {
        if (!working) return 'offShift' as const;
        if (st.machines.some((m) => m.phase === 'busy')) return 'busy' as const;
        if (st.machines.some((m) => m.phase === 'setup')) return 'setup' as const;
        if (st.machines.some((m) => m.phase === 'blocked')) return 'blocked' as const;
        if (st.machines.some((m) => m.phase === 'down')) return 'down' as const;
        if (st.machines.some((m) => m.phase === 'pm')) return 'pm' as const;
        return 'starved' as const;
      });
      const elapsedObsSchedHr = Math.max(1 / 60, scheduledMinutesBetween(warmupMin, now, cfg.calendar) / 60);
      return {
        minute: Math.round(now),
        hour: Number(hr.toFixed(2)),
        label: `${Math.floor(hr)}h`,
        isWorking: working,
        wip: wipTotal,
        stagingWip: stagingQueue.length,
        completedCumulative: goodCompleted,
        scrappedCumulative: scrappedCompleted,
        reworkCumulative: reworkEvents,
        throughputPerScheduledHr: Number((goodCompleted / elapsedObsSchedHr).toFixed(2)),
        stationStates,
        stationQueues: stations.map((s) => s.queue.length),
      };
    };

    const admitJob = (job: DesJob, now: number) => {
      const cap = cfg.finiteArrivalGateCap;
      if (cap != null && cap > 0 && stations[0].queue.length >= cap) {
        if (observing) rejectedAtGate++;
        return;
      }
      wipTotal++;
      if (observing) arrivedAfterWarmup++;
      if (job.orderIdx >= 0 && observing) {
        orders[job.orderIdx].releasedQty++;
      }

      if (stations[0].queue.length < stations[0].spec.bufferCapacity) {
        enqueueAtStation(0, job, now);
        tryStartStation(0, now);
      } else {
        // Hold safely in staging until station 0 buffer frees up (ensures zero unrecorded drops)
        stagingQueue.push(job);
      }
    };

    // Main Priority-Queue Event Processing Loop
    while (heap.size > 0) {
      const ev = heap.pop()!;
      if (ev.time < t - 1e-9) continue; // safety guard
      const nextT = Math.min(ev.time, totalCalMin);
      accumulate(t, nextT);
      t = nextT;

      if (ev.type === 'sim_end') {
        break;
      }

      if (ev.type === 'warmup_end') {
        observing = true;
        wipAtWarmupStart = wipTotal;
        goodCompleted = 0;
        firstPassCompleted = 0;
        scrappedCompleted = 0;
        reworkEvents = 0;
        onTimeGood = 0;
        arrivedAfterWarmup = 0;
        rejectedAtGate = 0;
        cycleSum = 0;
        cycleCount = 0;
        leadSum = 0;
        leadCount = 0;
        wipArea = 0;
        floorWipArea = 0;
        maxWip = wipTotal;
        for (const st of stations) {
          st.busyMin = 0;
          st.setupMin = 0;
          st.blockedMin = 0;
          st.starvedMin = 0;
          st.downMin = 0;
          st.pmMin = 0;
          st.matWaitMin = 0;
          st.offShiftMin = 0;
          st.earnedIdealMin = 0;
          st.queueArea = 0;
          st.waitTimeSum = 0;
          st.waitCount = 0;
          st.maxQueueLen = st.queue.length;
          st.processedOps = 0;
          for (const m of st.machines) {
            m.failuresCount = 0;
            m.pmEventsCount = 0;
            m.setupCount = 0;
          }
        }
        for (const mat of materials) {
          mat.totalConsumed = 0;
          mat.replenishmentOrders = 0;
          mat.totalOrderedQty = 0;
          mat.starvationEvents = 0;
          mat.starvedMinutes = 0;
          mat.minStock = mat.stock;
        }
        for (const ord of orders) {
          ord.releasedQty = 0;
          ord.completedQty = 0;
          ord.scrappedQty = 0;
          ord.leadTimeSum = 0;
          ord.onTimeCount = 0;
          ord.tardinessSum = 0;
        }
        continue;
      }

      if (ev.type === 'timeline_sample') {
        if (rep === 0 && observing) timeline.push(takeSnapshot(t));
        continue;
      }

      if (ev.type === 'shift_end') {
        if (!working) continue;
        // Pause all active timers cleanly at exact shift boundary
        for (const st of stations) {
          for (const m of st.machines) {
            const phaseElapsed = Math.max(0, t - m.phaseResumeCal);
            if (m.phase === 'setup') m.setupRemMin = Math.max(0, m.setupRemMin - phaseElapsed);
            else if (m.phase === 'busy') m.procRemMin = Math.max(0, m.procRemMin - phaseElapsed);
            else if (m.phase === 'down') m.downRemMin = Math.max(0, m.downRemMin - phaseElapsed);
            else if (m.phase === 'pm') m.pmRemMin = Math.max(0, m.pmRemMin - phaseElapsed);

            const relElapsed = Math.max(0, t - m.relResumeCal);
            if (m.phase !== 'down' && m.phase !== 'pm') {
              if (Number.isFinite(m.failRemMin)) m.failRemMin = Math.max(1e-4, m.failRemMin - relElapsed);
              if (Number.isFinite(m.pmIntervalRemMin)) m.pmIntervalRemMin = Math.max(1e-4, m.pmIntervalRemMin - relElapsed);
            }
            // Invalidate active machine events until next shift start
            m.eventToken++;
            m.failToken++;
            m.pmToken++;
          }
        }
        working = false;
        continue;
      }

      if (ev.type === 'shift_start') {
        if (working) continue;
        working = true;
        for (let si = 0; si < nStations; si++) {
          const st = stations[si];
          for (let mi = 0; mi < st.machines.length; mi++) {
            const m = st.machines[mi];
            m.phaseResumeCal = t;
            if (m.phase === 'setup') {
              m.eventToken++;
              schedule({ time: t + m.setupRemMin, type: 'setup_done', stationIdx: si, machineIdx: mi, token: m.eventToken });
            } else if (m.phase === 'busy') {
              m.eventToken++;
              schedule({ time: t + m.procRemMin, type: 'process_done', stationIdx: si, machineIdx: mi, token: m.eventToken });
            } else if (m.phase === 'down') {
              m.eventToken++;
              schedule({ time: t + m.downRemMin, type: 'repair_done', stationIdx: si, machineIdx: mi, token: m.eventToken });
            } else if (m.phase === 'pm') {
              m.eventToken++;
              schedule({ time: t + m.pmRemMin, type: 'pm_done', stationIdx: si, machineIdx: mi, token: m.eventToken });
            }
            armReliabilityForMachine(si, mi, t);
          }
        }
        for (let si = 0; si < nStations; si++) tryStartStation(si, t);
        continue;
      }

      if (ev.type === 'open_arrival') {
        // Choose route by cumulative mix
        const u = rnd();
        let chosenRouteIdx = 0;
        for (const item of openMix) {
          if (u <= item.cumWeight) {
            chosenRouteIdx = item.routeIdx;
            break;
          }
        }
        const rt = cfg.routes[chosenRouteIdx];
        const dueOffset = openSpec?.defaultLeadAllowanceMin ?? 240;
        admitJob(
          {
            id: nextJobId++,
            orderIdx: -1,
            orderId: 'OPEN',
            routeIdx: chosenRouteIdx,
            sku: rt.sku,
            stepIdx: 0,
            priority: 5,
            releaseAtMin: t,
            dueAtMin: t + dueOffset,
            enteredFloorAt: -1,
            enteredQueueAt: t,
            reworkCount: 0,
            hadRework: false,
            materialConsumed: false,
          },
          t
        );
        scheduleNextOpenArrival(t);
        continue;
      }

      if (ev.type === 'order_release') {
        const oi = ev.orderIdx!;
        const ord = orders[oi];
        const rt = cfg.routes[ord.routeIdx];
        const count = Math.max(1, Math.round(ord.spec.qty));
        for (let k = 0; k < count; k++) {
          admitJob(
            {
              id: nextJobId++,
              orderIdx: oi,
              orderId: ord.spec.id,
              routeIdx: ord.routeIdx,
              sku: ord.spec.sku || rt.sku,
              stepIdx: 0,
              priority: ord.spec.priority ?? 5,
              releaseAtMin: t,
              dueAtMin: ord.spec.dueAtMin ?? t + 480,
              enteredFloorAt: -1,
              enteredQueueAt: t,
              reworkCount: 0,
              hadRework: false,
              materialConsumed: false,
            },
            t
          );
        }
        continue;
      }

      if (ev.type === 'material_arrival') {
        const mi = ev.materialIdx!;
        const mat = materials[mi];
        mat.stock += mat.spec.orderQty;
        mat.onOrder = Math.max(0, mat.onOrder - mat.spec.orderQty);
        for (let si = 0; si < nStations; si++) {
          if (stations[si].waitingMaterial) tryStartStation(si, t);
        }
        continue;
      }

      // Machine-specific events must verify working flag & monotonic token
      const si = ev.stationIdx!;
      const mi = ev.machineIdx!;
      const st = stations[si];
      const m = st.machines[mi];

      if (ev.type === 'setup_done') {
        if (!working || ev.token !== m.eventToken || m.phase !== 'setup') continue;
        m.setupRemMin = 0;
        m.phaseResumeCal = t;
        beginMachineProcessing(si, mi, t);
        continue;
      }

      if (ev.type === 'process_done') {
        if (!working || ev.token !== m.eventToken || m.phase !== 'busy' || !m.job) continue;
        m.procRemMin = 0;
        m.phaseResumeCal = t;
        const job = m.job;
        if (observing) {
          st.processedOps++;
          st.earnedIdealMin += job.nominalIdealEarnedHere ?? st.spec.processDist.mean;
        }
        routeOrFinishJob(si, mi, job, t);
        continue;
      }

      if (ev.type === 'machine_fail') {
        if (!working || ev.token !== m.failToken || m.phase === 'down' || m.phase === 'pm') continue;
        const phaseElapsed = Math.max(0, t - m.phaseResumeCal);
        if (m.phase === 'setup') m.setupRemMin = Math.max(0, m.setupRemMin - phaseElapsed);
        else if (m.phase === 'busy') m.procRemMin = Math.max(0, m.procRemMin - phaseElapsed);
        const relElapsed = Math.max(0, t - m.relResumeCal);
        if (Number.isFinite(m.pmIntervalRemMin)) {
          m.pmIntervalRemMin = Math.max(1e-4, m.pmIntervalRemMin - relElapsed);
        }

        // Preempt only idle/setup/busy; preserve blocked state cleanly across breakdown if blocked
        m.pausedByDownPhase = m.phase === 'setup' || m.phase === 'busy' ? m.phase : 'idle';
        const wasBlockedTarget = m.phase === 'blocked' ? m.blockedTargetStationIdx : -1;
        m.blockedTargetStationIdx = wasBlockedTarget;

        const repairDur = sampleRepairDur(st.spec);
        m.phase = 'down';
        m.downRemMin = repairDur;
        m.failRemMin = Infinity;
        m.phaseResumeCal = t;
        m.relResumeCal = t;
        m.eventToken++;
        m.pmToken++;
        if (observing) m.failuresCount++;
        schedule({
          time: t + repairDur,
          type: 'repair_done',
          stationIdx: si,
          machineIdx: mi,
          token: m.eventToken,
        });
        continue;
      }

      if (ev.type === 'repair_done') {
        if (!working || ev.token !== m.eventToken || m.phase !== 'down') continue;
        m.downRemMin = 0;
        m.phaseResumeCal = t;
        m.failRemMin = sampleFailureInterval(st.spec);

        if (m.blockedTargetStationIdx >= 0 && m.job) {
          // Was blocked before breakdown: check if target freed while repairing
          const targetSi = m.blockedTargetStationIdx;
          if (stations[targetSi].queue.length < stations[targetSi].spec.bufferCapacity) {
            const job = m.job;
            m.job = null;
            m.phase = 'idle';
            m.blockedTargetStationIdx = -1;
            enqueueAtStation(targetSi, job, t);
            tryStartStation(targetSi, t);
            tryStartStation(si, t);
            wakeBlockedSendersFor(si, t);
          } else {
            m.phase = 'blocked';
          }
        } else if (m.pausedByDownPhase === 'setup' && m.job) {
          m.phase = 'setup';
          m.eventToken++;
          schedule({ time: t + m.setupRemMin, type: 'setup_done', stationIdx: si, machineIdx: mi, token: m.eventToken });
        } else if (m.pausedByDownPhase === 'busy' && m.job) {
          m.phase = 'busy';
          m.eventToken++;
          schedule({ time: t + m.procRemMin, type: 'process_done', stationIdx: si, machineIdx: mi, token: m.eventToken });
        } else {
          m.phase = 'idle';
          tryStartStation(si, t);
        }
        armReliabilityForMachine(si, mi, t);
        continue;
      }

      if (ev.type === 'pm_due') {
        if (!working || ev.token !== m.pmToken || m.phase === 'down' || m.phase === 'pm') continue;
        if (m.phase !== 'idle') {
          m.pmToken++;
          schedule({ time: t + 2, type: 'pm_due', stationIdx: si, machineIdx: mi, token: m.pmToken });
          continue;
        }
        const relElapsed = Math.max(0, t - m.relResumeCal);
        if (Number.isFinite(m.failRemMin)) m.failRemMin = Math.max(1e-4, m.failRemMin - relElapsed);

        const pmDur = Math.max(1, Number(st.spec.pmDurationMin ?? 10));
        m.phase = 'pm';
        m.pmRemMin = pmDur;
        m.pmIntervalRemMin = Infinity;
        m.phaseResumeCal = t;
        m.relResumeCal = t;
        m.eventToken++;
        m.failToken++;
        if (observing) m.pmEventsCount++;
        schedule({
          time: t + pmDur,
          type: 'pm_done',
          stationIdx: si,
          machineIdx: mi,
          token: m.eventToken,
        });
        continue;
      }

      if (ev.type === 'pm_done') {
        if (!working || ev.token !== m.eventToken || m.phase !== 'pm') continue;
        m.pmRemMin = 0;
        m.phase = 'idle';
        m.phaseResumeCal = t;
        m.pmIntervalRemMin =
          st.spec.pmIntervalMin && st.spec.pmIntervalMin > 0 ? st.spec.pmIntervalMin : Infinity;
        armReliabilityForMachine(si, mi, t);
        tryStartStation(si, t);
        continue;
      }
    }

    // End of replication conservation & telemetry rollup
    const wipAtEnd =
      stagingQueue.length +
      stations.reduce(
        (sumSt, st) => sumSt + st.queue.length + st.machines.filter((m) => m.job !== null).length,
        0
      );
    const residual = (wipAtWarmupStart + arrivedAfterWarmup) - (goodCompleted + scrappedCompleted + wipAtEnd);

    const obsSchedHr = observedSchedMin / 60;
    const obsCalHr = Math.max(1e-6, observedCalMin / 60);

    repTpSched.push(goodCompleted / obsSchedHr);
    repTpCal.push(goodCompleted / obsCalHr);
    repCycle.push(cycleCount > 0 ? cycleSum / cycleCount : 0);
    repLead.push(leadCount > 0 ? leadSum / leadCount : 0);
    repWip.push(wipArea / Math.max(1e-6, observedCalMin));
    repFloorWip.push(floorWipArea / Math.max(1e-6, observedCalMin));
    maxWipAcrossReps = Math.max(maxWipAcrossReps, maxWip);

    aggGood += goodCompleted;
    aggScrap += scrappedCompleted;
    aggRework += reworkEvents;
    aggFirstPass += firstPassCompleted;
    aggEnteredPostWarmup += arrivedAfterWarmup;
    aggWipStart += wipAtWarmupStart;
    aggWipEnd += wipAtEnd;
    aggGateRejected += rejectedAtGate;
    aggConservationResidual += residual;
    aggOnTimeCount += onTimeGood;
    aggDeliveredTracked += goodCompleted;

    stations.forEach((st, i) => {
      const a = aggStation[i];
      a.busyMin += st.busyMin;
      a.setupMin += st.setupMin;
      a.blockedMin += st.blockedMin;
      a.starvedMin += st.starvedMin;
      a.downMin += st.downMin;
      a.pmMin += st.pmMin;
      a.matWaitMin += st.matWaitMin;
      a.offShiftMin += st.offShiftMin;
      a.earnedIdealMin += st.earnedIdealMin;
      a.queueArea += st.queueArea;
      a.waitSum += st.waitTimeSum;
      a.waitCount += st.waitCount;
      a.maxQueue = Math.max(a.maxQueue, st.maxQueueLen);
      a.processedOps += st.processedOps;
      a.failures += st.machines.reduce((s, m) => s + m.failuresCount, 0);
      a.pmEvents += st.machines.reduce((s, m) => s + m.pmEventsCount, 0);
      a.setups += st.machines.reduce((s, m) => s + m.setupCount, 0);
    });

    materials.forEach((mat, i) => {
      const a = aggMats[i];
      a.endStock += mat.stock;
      a.minStock = Math.min(a.minStock, mat.minStock);
      a.consumed += mat.totalConsumed;
      a.orders += mat.replenishmentOrders;
      a.orderedQty += mat.totalOrderedQty;
      a.starveEvents += mat.starvationEvents;
      a.starvedMin += mat.starvedMinutes;
    });

    orders.forEach((ord, i) => {
      const a = aggOrders[i];
      const remainingOrderWip =
        stagingQueue.filter((j) => j.orderIdx === i).length +
        stations.reduce(
          (sumSt, st) =>
            sumSt +
            st.queue.filter((j) => j.orderIdx === i).length +
            st.machines.filter((m) => m.job?.orderIdx === i).length,
          0
        );
      a.released += ord.releasedQty;
      a.completed += ord.completedQty;
      a.scrapped += ord.scrappedQty;
      a.inWip += remainingOrderWip;
      a.leadSum += ord.leadTimeSum;
      a.onTime += ord.onTimeCount;
      a.tardinessSum += ord.tardinessSum;
    });

    if (rep === 0) sampleTimeline = timeline;
  }

  const tpSchedCI = summarizeDesCI(repTpSched);
  const tpCalCI = summarizeDesCI(repTpCal);
  const cycleCI = summarizeDesCI(repCycle);
  const leadCI = summarizeDesCI(repLead);
  const wipCI = summarizeDesCI(repWip);

  const avgGood = aggGood / reps;
  const avgScrap = aggScrap / reps;
  const avgRework = aggRework / reps;
  const avgFirstPass = aggFirstPass / reps;
  const avgEntered = aggEnteredPostWarmup / reps;

  const totalAttempts = avgGood + avgScrap;
  const oeeQualityPct = totalAttempts > 0 ? Math.min(100, (avgGood / totalAttempts) * 100) : 0;
  const firstPassYieldPct = totalAttempts > 0 ? Math.min(100, (avgFirstPass / totalAttempts) * 100) : 0;

  // Completion rate: against scheduled order qty when order-driven, or against entered post-warmup + initial WIP
  const totalOrderedDemand = (cfg.orders ?? []).reduce((s, o) => s + Math.round(o.qty), 0);
  const avgAvailableWork = aggWipStart / reps + avgEntered;
  const completionDenom =
    openRatePerHr <= 0 && warmupMin <= 1e-9 && totalOrderedDemand > 0
      ? totalOrderedDemand
      : Math.max(1, avgAvailableWork);
  const completionRatePct = Math.min(100, (avgGood / completionDenom) * 100);
  const onTimeDeliveryPct =
    aggDeliveredTracked > 0 ? Math.min(100, (aggOnTimeCount / aggDeliveredTracked) * 100) : 100;

  // Station Telemetry & Exact OEE vs Asset Utilization Separation
  const stationResults: DesStationTelemetry[] = cfg.stations.map((spec, i) => {
    const a = aggStation[i];
    const mCount = Math.max(1, Math.round(spec.machineCount));
    const machineSchedMinTotal = observedSchedMin * mCount * reps;
    const machineCalMinTotal = Math.max(1e-6, observedCalMin * mCount * reps);

    const busyMin = a.busyMin / reps;
    const setupMin = a.setupMin / reps;
    const blockedMin = a.blockedMin / reps;
    const starvedMin = a.starvedMin / reps;
    const downMin = a.downMin / reps;
    const pmMin = a.pmMin / reps;
    const offShiftMin = a.offShiftMin / reps;

    const busyPct = (a.busyMin / machineSchedMinTotal) * 100;
    const setupPct = (a.setupMin / machineSchedMinTotal) * 100;
    const blockedPct = (a.blockedMin / machineSchedMinTotal) * 100;
    const downPct = (a.downMin / machineSchedMinTotal) * 100;
    const pmPct = (a.pmMin / machineSchedMinTotal) * 100;
    const matWaitPct = (a.matWaitMin / machineSchedMinTotal) * 100;
    const starvedPct = Math.max(0, 100 - busyPct - setupPct - blockedPct - downPct - pmPct);

    // Distinct metrics: Asset Utilization includes starvation/blocking losses; Availability only deducts mechanical downtime + PM.
    const assetUtilizationPct = Math.min(100, busyPct);
    const oeeAvailabilityPct = Math.max(
      0,
      Math.min(100, ((machineSchedMinTotal - a.downMin - a.pmMin) / machineSchedMinTotal) * 100)
    );

    const activePlusBlockedMin = a.busyMin + a.setupMin + a.blockedMin;
    const oeePerformancePct =
      activePlusBlockedMin > 1e-6
        ? Math.max(0, Math.min(100, (a.earnedIdealMin / activePlusBlockedMin) * 100))
        : 100;

    return {
      index: i,
      id: spec.id,
      name: spec.name,
      machineCount: mCount,
      bufferCapacity: spec.bufferCapacity,
      nominalCycleMin: spec.processDist.mean / mCount,
      assetUtilizationPct,
      busyPct,
      setupPct,
      blockedPct,
      starvedPct,
      downPct,
      pmPct,
      materialWaitPct: matWaitPct,
      offShiftCalendarPct: (a.offShiftMin / machineCalMinTotal) * 100,
      oeeAvailabilityPct,
      oeePerformancePct,
      busyMin,
      setupMin,
      blockedMin,
      starvedMin,
      downMin,
      pmMin,
      offShiftMin,
      avgQueueLen: a.queueArea / (Math.max(1e-6, observedCalMin) * reps),
      maxQueueLen: a.maxQueue,
      avgWaitMin: a.waitCount > 0 ? a.waitSum / a.waitCount : 0,
      processedOps: Math.round(a.processedOps / reps),
      failuresCount: Number((a.failures / reps).toFixed(2)),
      pmEventsCount: Number((a.pmEvents / reps).toFixed(2)),
      setupCount: Number((a.setups / reps).toFixed(2)),
      isBottleneck: false,
    };
  });

  // Identify Bottleneck: highest combined active+down workload (tie-broken by highest nominalCycleMin)
  let bnIdx = 0;
  for (let i = 1; i < stationResults.length; i++) {
    const scoreCur = stationResults[i].busyPct + stationResults[i].setupPct + stationResults[i].downPct * 0.5;
    const scoreBest =
      stationResults[bnIdx].busyPct + stationResults[bnIdx].setupPct + stationResults[bnIdx].downPct * 0.5;
    if (
      scoreCur > scoreBest + 0.05 ||
      (Math.abs(scoreCur - scoreBest) <= 0.05 &&
        stationResults[i].nominalCycleMin > stationResults[bnIdx].nominalCycleMin)
    ) {
      bnIdx = i;
    }
  }
  stationResults[bnIdx].isBottleneck = true;
  const bn = stationResults[bnIdx];

  // Line OEE computed cleanly from Bottleneck / Pacing Resource (distinct from raw Utilization!)
  const oeeAvailabilityPct = bn.oeeAvailabilityPct;
  const oeePerformancePct = bn.oeePerformancePct;
  const oeePct = (oeeAvailabilityPct / 100) * (oeePerformancePct / 100) * (oeeQualityPct / 100) * 100;
  const scheduleRatio = observedCalMin > 0 ? observedSchedMin / observedCalMin : 1;
  const teepPct = oeePct * scheduleRatio;
  const avgAssetUtilPct =
    stationResults.reduce((s, st) => s + st.assetUtilizationPct, 0) / stationResults.length;

  // Queue wait & Little's Law: L_expected = lambda_calendar * W_calendar
  const totalWaitWeighted = aggStation.reduce((s, a) => s + a.waitSum, 0);
  const totalWaitOps = aggStation.reduce((s, a) => s + a.waitCount, 0);
  const avgQueueWaitMin = totalWaitOps > 0 ? totalWaitWeighted / totalWaitOps : 0;

  // For Little's Law in observed floor residence: L_floor = lambda_cal * W_floor
  // Exclude external stagingQueue wait from both sides of the shop-floor identity.
  const avgFloorWip = repFloorWip.reduce((a, b) => a + b, 0) / reps;
  const lambdaPerCalMin = tpCalCI.mean / 60;
  const littlesExpected = lambdaPerCalMin * cycleCI.mean;
  const littlesGapPct =
    avgFloorWip > 0.05
      ? (Math.abs(avgFloorWip - littlesExpected) / Math.max(avgFloorWip, littlesExpected, 0.1)) * 100
      : 0;

  // Economics
  const obsSchedHr = observedSchedMin / 60;
  const laborRate = Math.max(0, Number(cfg.laborRatePerHour ?? 28));
  const wipHoldRate = Math.max(0, Number(cfg.wipHoldingCostPerJobHour ?? 1.5));
  const machineCostTotal = cfg.stations.reduce(
    (s, st) => s + (st.hourlyMachineCost ?? 40) * st.machineCount * obsSchedHr,
    0
  );
  const laborCostTotal = cfg.stations.reduce(
    (s, st) => s + (st.operatorsPerMachine ?? 1) * st.machineCount * laborRate * obsSchedHr,
    0
  );
  const matCostTotal = matsSpec.reduce((s, m, idx) => s + (aggMats[idx].consumed / reps) * m.unitCost, 0);
  const wipCostTotal = wipCI.mean * wipHoldRate * (observedCalMin / 60);
  const costPerGoodUnit = avgGood > 0 ? (machineCostTotal + laborCostTotal + matCostTotal + wipCostTotal) / avgGood : 0;

  const orderResults: DesOrderTelemetry[] = (cfg.orders ?? []).map((ordSpec, i) => {
    const a = aggOrders[i];
    const relAvg = a.released / reps;
    const compAvg = a.completed / reps;
    const scrapAvg = a.scrapped / reps;
    const wipAvg = a.inWip / reps;
    const ordered = Math.round(ordSpec.qty);
    return {
      id: ordSpec.id,
      sku: ordSpec.sku,
      routeId: ordSpec.routeId,
      orderedQty: ordered,
      releasedQty: Math.round(relAvg),
      completedQty: Number(compAvg.toFixed(1)),
      scrappedQty: Number(scrapAvg.toFixed(1)),
      inWipQty: Number(wipAvg.toFixed(1)),
      completionRatePct: ordered > 0 ? Math.min(100, (compAvg / ordered) * 100) : 0,
      avgLeadTimeMin: a.completed > 0 ? a.leadSum / a.completed : 0,
      onTimePct: a.completed > 0 ? Math.min(100, (a.onTime / a.completed) * 100) : 0,
      avgTardinessMin: a.completed > 0 ? a.tardinessSum / a.completed : 0,
    };
  });

  const materialResults: DesMaterialTelemetry[] = matsSpec.map((spec, i) => {
    const a = aggMats[i];
    const minStock = a.minStock === Infinity ? spec.initialStock : a.minStock;
    return {
      sku: spec.sku,
      name: spec.name,
      unit: spec.unit,
      initialStock: spec.initialStock,
      endingStock: a.endStock / reps,
      minStock,
      totalConsumed: a.consumed / reps,
      replenishmentOrders: a.orders / reps,
      totalOrderedQty: a.orderedQty / reps,
      starvationEvents: Math.round(a.starveEvents / reps),
      starvedMinutes: a.starvedMin / reps,
      stockoutOccurred: minStock <= 1e-6 || a.starveEvents > 0,
    };
  });

  const totalIdleStarvedMin = stationResults.reduce((s, st) => s + st.starvedMin, 0);
  const totalDowntimeMin = stationResults.reduce((s, st) => s + st.downMin + st.pmMin, 0);

  return {
    valid: true,
    reason: '',
    provenance: 'SIMULATED_MODEL',
    provenanceNotice:
      'Simulated discrete-event output (MinHeap event clock). Not live empirical shop-floor telemetry.',
    deterministic,
    seed: baseSeed,
    replications: reps,
    calendarHours: Number((totalCalMin / 60).toFixed(2)),
    scheduledWorkingHours: Number((scheduledTotalMin / 60).toFixed(2)),
    warmupCalendarHours: Number((warmupMin / 60).toFixed(2)),
    observedCalendarHours: Number((observedCalMin / 60).toFixed(2)),
    observedScheduledHours: Number((observedSchedMin / 60).toFixed(2)),
    throughputPerScheduledHour: tpSchedCI,
    throughputPerCalendarHour: tpCalCI,
    avgCycleTimeMin: cycleCI,
    avgLeadTimeMin: leadCI,
    avgWip: wipCI,
    maxWip: maxWipAcrossReps,
    totalThroughputGood: Number(avgGood.toFixed(2)),
    rejectedQty: Number(avgScrap.toFixed(2)),
    reworkedQty: Number(avgRework.toFixed(2)),
    firstPassGoodQty: Number(avgFirstPass.toFixed(2)),
    totalEnteredPostWarmup: Number(avgEntered.toFixed(2)),
    completionRatePct,
    onTimeDeliveryPct,
    firstPassYieldPct,
    assetUtilizationPct: avgAssetUtilPct,
    oeeAvailabilityPct,
    oeePerformancePct,
    oeeQualityPct,
    oeePct,
    teepPct,
    avgQueueWaitMin,
    bottleneckIndex: bnIdx,
    bottleneckId: bn.id,
    bottleneckName: bn.name,
    bottleneckWorkloadPct: bn.assetUtilizationPct + bn.setupPct,
    totalIdleStarvedMin,
    totalDowntimeMin,
    littlesLawExpectedWip: littlesExpected,
    littlesLawGapPct: littlesGapPct,
    flowBalance: {
      wipAtWarmupStart: Number((aggWipStart / reps).toFixed(4)),
      arrivedAfterWarmup: Number(avgEntered.toFixed(4)),
      completedGood: Number(avgGood.toFixed(4)),
      rejectedScrapped: Number(avgScrap.toFixed(4)),
      wipAtEnd: Number((aggWipEnd / reps).toFixed(4)),
      rejectedAtFiniteGate: Number((aggGateRejected / reps).toFixed(4)),
      conservationResidual: Number((aggConservationResidual / reps).toFixed(6)),
    },
    costPerGoodUnit,
    stations: stationResults,
    orders: orderResults,
    materials: materialResults,
    timeline: sampleTimeline,
  };
}

/* -------------------------------------------------------------------------- */
/*  Experimentation Suite (Buffers, Machines, Volumes, Breakdowns)            */
/* -------------------------------------------------------------------------- */

export function runDesExperimentSuite(
  baseConfig: DesConfig,
  options?: {
    bufferCaps?: number[];
    volumeMultipliers?: number[];
    includeReliabilityCases?: boolean;
    includeMachineCases?: boolean;
  }
): DesExperimentPoint[] {
  const base = runDiscreteEventSimulation(baseConfig);
  if (!base.valid) return [];

  const points: DesExperimentPoint[] = [];
  const bnIdx = base.bottleneckIndex;
  const bnSpec = baseConfig.stations[bnIdx];

  const pushPoint = (
    id: string,
    label: string,
    category: DesExperimentPoint['category'],
    paramValue: string,
    simCfg: DesConfig
  ) => {
    const res = runDiscreteEventSimulation(simCfg);
    if (!res.valid) return;
    const baseTp = Math.max(1e-6, base.throughputPerScheduledHour.mean);
    points.push({
      id,
      label,
      category,
      paramValue,
      throughputPerHour: res.throughputPerScheduledHour.mean,
      throughputDeltaPct: ((res.throughputPerScheduledHour.mean - baseTp) / baseTp) * 100,
      avgCycleTimeMin: res.avgCycleTimeMin.mean,
      avgLeadTimeMin: res.avgLeadTimeMin.mean,
      avgWip: res.avgWip.mean,
      oeePct: res.oeePct,
      assetUtilizationPct: res.assetUtilizationPct,
      rejectedQty: res.rejectedQty,
      completionRatePct: res.completionRatePct,
      bottleneckName: res.bottleneckName,
    });
  };

  // 1. Buffer Capacity Experimentation
  const caps = options?.bufferCaps ?? [1, 2, 4, 8, 16];
  for (const cap of caps) {
    pushPoint(
      `buf-${cap}`,
      `Uniform Inter-Station Buffer = ${cap}`,
      'buffer',
      `${cap} units`,
      {
        ...baseConfig,
        stations: baseConfig.stations.map((s) => ({ ...s, bufferCapacity: cap })),
      }
    );
  }

  // 2. Machine Configuration Experimentation
  if (options?.includeMachineCases ?? true) {
    pushPoint(
      'mach-bn-plus1',
      `+1 Parallel Machine @ ${bnSpec.id} (${bnSpec.machineCount} -> ${bnSpec.machineCount + 1})`,
      'machines',
      `${bnSpec.machineCount + 1}x ${bnSpec.id}`,
      {
        ...baseConfig,
        stations: baseConfig.stations.map((s, i) =>
          i === bnIdx ? { ...s, machineCount: s.machineCount + 1 } : s
        ),
      }
    );
  }

  // 3. Volume / Arrival Scaling Experimentation
  const mults = options?.volumeMultipliers ?? [0.75, 1.25, 1.5];
  for (const mult of mults) {
    pushPoint(
      `vol-${mult}`,
      `Demand Volume ×${mult.toFixed(2)}`,
      'volume',
      `×${mult.toFixed(2)}`,
      {
        ...baseConfig,
        openArrivals: baseConfig.openArrivals
          ? { ...baseConfig.openArrivals, ratePerHour: baseConfig.openArrivals.ratePerHour * mult }
          : undefined,
        orders: baseConfig.orders?.map((o) => ({ ...o, qty: Math.max(1, Math.round(o.qty * mult)) })),
      }
    );
  }

  // 4. Breakdown & Preventive Maintenance Scenarios
  if (options?.includeReliabilityCases ?? true) {
    pushPoint(
      'rel-pm',
      'Scheduled PM (240m / 12m) + 40% MTTR Reduction',
      'reliability',
      'PM + Fast Repair',
      {
        ...baseConfig,
        stations: baseConfig.stations.map((s) => ({
          ...s,
          mttrMin: s.mttrMin ? Math.max(1, s.mttrMin * 0.6) : 0,
          pmIntervalMin: s.pmIntervalMin && s.pmIntervalMin > 0 ? s.pmIntervalMin : 240,
          pmDurationMin: s.pmDurationMin && s.pmDurationMin > 0 ? s.pmDurationMin : 12,
        })),
      }
    );
    pushPoint(
      'rel-stress',
      'Degraded Reliability (0.5× MTBF, 1.5× MTTR)',
      'reliability',
      'Breakdown Stress',
      {
        ...baseConfig,
        stations: baseConfig.stations.map((s) => ({
          ...s,
          mtbfMin: s.mtbfMin && s.mtbfMin > 0 ? Math.max(10, s.mtbfMin * 0.5) : 120,
          mttrMin: s.mttrMin && s.mttrMin > 0 ? s.mttrMin * 1.5 : 15,
        })),
      }
    );
  }

  return points;
}

/* -------------------------------------------------------------------------- */
/*  Workspace Adapter: Bridge Existing FactorySimConfig & MRP/Orders to DES   */
/* -------------------------------------------------------------------------- */

export interface FactoryDesBridgeOptions {
  enableShifts?: boolean;
  workingDaysPerWeek?: number;
  interShiftGapMin?: number;
  failureDistKind?: 'exponential' | 'weibull' | 'lognormal';
  orders?: DesOrderSpec[];
  includeOpenArrivals?: boolean;
  customSecondaryRoute?: boolean;
}

/**
 * Converts existing FactoryMind `FactorySimConfig` (linked to Line Balance, Demand Forecast,
 * Inventory ROP/BOM, and SPC profiles) into a genuine Priority-Queue `DesConfig` with
 * explicit multi-product routings, working calendar shifts, and production orders.
 */
export function buildDesConfigFromFactorySim(
  cfg: FactorySimConfig,
  opts?: FactoryDesBridgeOptions
): DesConfig {
  const stations: DesStationSpec[] = cfg.stations.map((s) => ({
    id: s.id,
    name: s.name,
    machineCount: Math.max(1, Math.round(s.machineCount || 1)),
    bufferCapacity: Math.max(1, Math.round(s.bufferCapacity || 4)),
    processDist: {
      kind: cfg.serviceDist === 'constant' ? 'constant' : cfg.serviceDist,
      mean: Math.max(0.1, s.meanTimeMin),
      cv: Math.max(0, s.cv),
    },
    setupTimeMin: Math.max(0, s.setupTimeMin || 0),
    setupOnSkuChangeOnly: false,
    queueDiscipline: 'edd',
    mtbfMin: Math.max(0, s.mtbfMin || 0),
    failureDistKind: opts?.failureDistKind ?? 'weibull',
    failureWeibullShape: 1.6,
    mttrMin: Math.max(0, s.mttrMin || 0),
    repairDistKind: 'lognormal',
    repairCv: 0.35,
    pmIntervalMin: Math.max(0, s.pmIntervalMin || 0),
    pmDurationMin: Math.max(0, s.pmDurationMin || 0),
    hourlyMachineCost: s.hourlyMachineCost,
    operatorsPerMachine: s.operatorsPerMachine,
  }));

  const defectProb = Math.max(0, Math.min(0.4, (cfg.defectRatePct || 0) / 100));
  const reworkIdx = Math.max(0, Math.min(stations.length - 1, cfg.reworkTargetStationIdx || 0));
  const bomItems: DesBomItem[] = cfg.enforceMaterialFlow
    ? cfg.materials.map((m) => ({ materialSku: m.sku, qtyPerJob: m.qtyPerJob }))
    : [];

  const primarySteps: DesRouteStep[] = stations.map((st, idx) => ({
    stationId: st.id,
    cycleTimeMult: 1.0,
    ...(idx === stations.length - 1
      ? {
          scrapRate: cfg.routingMode === 'rework-loop' ? defectProb * 0.25 : defectProb,
          reworkProb: cfg.routingMode === 'rework-loop' ? defectProb * 0.75 : 0,
          reworkToStepIdx: reworkIdx,
          maxRework: Math.max(0, cfg.maxReworkLoops ?? 2),
        }
      : {}),
  }));

  const routes: DesRouteSpec[] = [
    {
      id: `RT-${cfg.assemblySku}`,
      sku: cfg.assemblySku,
      name: cfg.assemblyName,
      steps: primarySteps,
      materialsPerJob: bomItems,
    },
  ];

  // Optional alternate SKU variant route (express / reverse-finish route when >= 2 stations)
  if (opts?.customSecondaryRoute && stations.length >= 2) {
    const revSteps: DesRouteStep[] = [
      { stationId: stations[0].id, cycleTimeMult: 0.9 },
      ...stations
        .slice(1)
        .reverse()
        .map((st, idx, arr) => ({
          stationId: st.id,
          cycleTimeMult: 1.05,
          ...(idx === arr.length - 1
            ? {
                scrapRate: defectProb * 0.5,
                reworkProb: cfg.routingMode === 'rework-loop' ? defectProb * 0.5 : 0,
                reworkToStepIdx: 0,
                maxRework: 1,
              }
            : {}),
        })),
    ];
    routes.push({
      id: `RT-${cfg.assemblySku}-VAR`,
      sku: `${cfg.assemblySku}-V2`,
      name: `${cfg.assemblyName} (Custom Route V2)`,
      steps: revSteps,
      materialsPerJob: bomItems,
    });
  }

  const horizonHours = Math.max(1, cfg.daysToSimulate * 24);
  const warmupHours = Math.min(horizonHours * 0.4, Math.max(0, cfg.warmupHours || 0));

  const calendar: DesShiftCalendar | undefined =
    opts?.enableShifts === false
      ? undefined
      : {
          shiftsPerDay: cfg.shiftsPerDay,
          shiftHours: cfg.shiftHours,
          interShiftGapMin: opts?.interShiftGapMin ?? 15,
          workingDaysPerWeek: opts?.workingDaysPerWeek ?? 7,
        };

  const hoursPerDay = Math.max(1, cfg.shiftsPerDay * cfg.shiftHours);
  const materials: DesMaterialSpec[] = cfg.enforceMaterialFlow
    ? cfg.materials.map((m) => ({
        sku: m.sku,
        name: m.name,
        unit: m.unit,
        initialStock: m.initialStock,
        rop: m.rop,
        orderQty: m.orderQty,
        leadTimeMin: Math.max(30, m.leadTimeDays * hoursPerDay * 60),
        unitCost: m.unitCost,
      }))
    : [];

  // Default order batch synced to scheduled volume if none supplied
  const defaultOrders: DesOrderSpec[] =
    opts?.orders ??
    [
      {
        id: 'PO-101',
        sku: cfg.assemblySku,
        routeId: routes[0].id,
        qty: Math.max(4, Math.round(cfg.arrivalRatePerHour * 2)),
        releaseAtMin: 0,
        dueAtMin: Math.min(horizonHours * 60, warmupHours * 60 + 360),
        priority: 1,
      },
      ...(routes[1]
        ? [
            {
              id: 'PO-102',
              sku: routes[1].sku,
              routeId: routes[1].id,
              qty: Math.max(2, Math.round(cfg.arrivalRatePerHour)),
              releaseAtMin: Math.min(horizonHours * 30, 120),
              dueAtMin: Math.min(horizonHours * 60, warmupHours * 60 + 480),
              priority: 2,
            },
          ]
        : []),
    ];

  return {
    name: `${cfg.name} (Event-Driven DES)`,
    horizonHours,
    warmupHours,
    calendar,
    deterministic: false,
    replications: cfg.replications,
    seed: cfg.seed,
    laborRatePerHour: cfg.laborRatePerHour,
    wipHoldingCostPerJobHour: cfg.wipHoldingCostPerJobHour,
    stations,
    routes,
    orders: defaultOrders,
    openArrivals:
      opts?.includeOpenArrivals === false
        ? undefined
        : {
            ratePerHour: cfg.arrivalRatePerHour,
            cv: cfg.arrivalCv,
            clockMode: 'working',
            mix: routes.map((r, ri) => ({ routeId: r.id, weight: ri === 0 ? 0.75 : 0.25 })),
          },
    materials,
  };
}

// Re-export cross-module connectors so consumers can import a unified DES+Workspace interface
export { estimateSpcQualityProfile, extractBomMaterialsForFactory, forecastDemandSignalForProduct };
export type { SpcQualityProfileKey };
