/**
 * Factory Simulation Lab — Integrated Discrete-Event Manufacturing Simulation Engine.
 *
 * Unifies workstation layout, parallel machines, setup/changeover, stochastic processing
 * times, finite inter-station buffers (blocking & starvation), reliability (MTBF/MTTR +
 * scheduled Preventive Maintenance), SPC-linked quality/rework routing, BOM material flow
 * with ROP replenishment & material-starvation tracking, shift/workforce capacity, OEE,
 * Little's Law verification, Monte Carlo confidence intervals, and scenario optimization.
 *
 * Pure TypeScript, zero DOM dependencies. Every result is deterministic for a given seed
 * and explicitly tagged as simulated model output (never real plant measurements).
 */

import {
  compareMethods,
  emaMethod,
  ForecastOutput,
  holtLinear,
  linregMethod,
  MethodSpec,
  smaMethod,
  wmaMethod,
} from './forecast.ts';
import { mulberry32, normalFrom, spcAnalysis } from './ipe.ts';
import { compareAlgorithms, LineBalanceSolution } from './linebal.ts';
import { ServiceDistType } from './prodsim.ts';

export type RoutingMode = 'serial' | 'rework-loop' | 'parallel-cell';

export interface FactoryStationConfig {
  id: string;
  name: string;
  meanTimeMin: number;
  cv: number;
  machineCount: number;
  bufferCapacity: number;
  setupTimeMin: number;
  operatorsPerMachine: number;
  mtbfMin: number;
  mttrMin: number;
  pmIntervalMin: number;
  pmDurationMin: number;
  hourlyMachineCost: number;
}

export interface FactoryMaterialInput {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  initialStock: number;
  qtyPerJob: number;
  rop: number;
  orderQty: number;
  leadTimeDays: number;
  unitCost: number;
}

export interface FactoryDesOrderConfig {
  id: string;
  sku: string;
  routeId: string;
  qty: number;
  releaseAtMin: number;
  dueAtMin?: number;
  priority?: number;
}

export interface FactoryDesPersistedOptions {
  deterministic: boolean;
  enableShifts: boolean;
  workDaysPerWeek: number;
  shiftGapMin: number;
  failureDist: 'weibull' | 'exponential' | 'lognormal';
  secondaryRoute: boolean;
  includeOpenArrivals: boolean;
  orders: FactoryDesOrderConfig[];
}

export interface FactorySimConfig {
  name: string;
  assemblySku: string;
  assemblyName: string;
  arrivalRatePerHour: number;
  arrivalCv: number;
  serviceDist: ServiceDistType;
  routingMode: RoutingMode;
  defectRatePct: number;
  reworkTargetStationIdx: number;
  maxReworkLoops: number;
  shiftsPerDay: number;
  shiftHours: number;
  daysToSimulate: number;
  warmupHours: number;
  operatorsAvailable: number;
  laborRatePerHour: number;
  wipHoldingCostPerJobHour: number;
  stockoutPenaltyPerMissedJob: number;
  replications: number;
  seed: number;
  enforceMaterialFlow: boolean;
  stations: FactoryStationConfig[];
  materials: FactoryMaterialInput[];
  desOptions?: FactoryDesPersistedOptions;
  sourceNotes: {
    demandOrigin: string;
    lineBalanceOrigin: string;
    bomOrigin: string;
    spcOrigin: string;
  };
}

export interface StationSimResult {
  index: number;
  id: string;
  name: string;
  machineCount: number;
  meanTimeMin: number;
  effectiveCycleMin: number;
  utilizationPct: number;
  busyPct: number;
  blockedPct: number;
  starvedPct: number;
  downPct: number;
  pmPct: number;
  materialWaitPct: number;
  avgQueueLen: number;
  maxQueueLen: number;
  avgWaitMin: number;
  processedJobs: number;
  failuresCount: number;
  pmEventsCount: number;
  isBottleneck: boolean;
}

export interface MaterialSimResult {
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

export interface FactoryTimelineFrame {
  hour: number;
  label: string;
  wip: number;
  completedCumulative: number;
  throughputPerHour: number;
  scrapCumulative: number;
  reworkCumulative: number;
  stationStates: Array<'busy' | 'blocked' | 'starved' | 'down' | 'pm'>;
  stationQueues: number[];
  minMaterialCoverPct: number;
}

export interface ConfidenceInterval {
  mean: number;
  sd: number;
  ci95Low: number;
  ci95High: number;
}

export interface FactorySimResult {
  valid: boolean;
  reason: string;
  provenance: 'SIMULATED_MODEL';
  provenanceNotice: string;
  configHash: string;
  seed: number;
  replications: number;
  observedHours: number;
  warmupHours: number;
  effectiveStaffingRatio: number;
  operatorsRequired: number;
  operatorsAvailable: number;

  // Core KPIs with 95% CI across replications
  throughputPerHour: ConfidenceInterval;
  cycleTimeMin: ConfidenceInterval;
  avgWip: ConfidenceInterval;
  goodUnitsCompleted: number;
  scrapUnits: number;
  reworkCount: number;
  firstPassYieldPct: number;
  theoreticalMaxPerHour: number;

  // OEE = Availability * Performance * Quality
  oeePct: number;
  oeeAvailabilityPct: number;
  oeePerformancePct: number;
  oeeQualityPct: number;

  // Little's Law Verification (L = lambda * W)
  littlesLawExpectedWip: number;
  littlesLawGapPct: number;

  // Bottleneck & Material Flow
  bottleneckIndex: number;
  bottleneckName: string;
  bottleneckUtilPct: number;
  materialStarvedHours: number;
  materialBottleneckSku: string | null;

  // Unit Economics ($/good unit)
  costPerGoodUnit: number;
  costBreakdown: {
    labor: number;
    machine: number;
    material: number;
    wipHolding: number;
    scrapAndPenalty: number;
  };

  stations: StationSimResult[];
  materials: MaterialSimResult[];
  timeline: FactoryTimelineFrame[];
  recommendations: string[];
}

export interface FactoryScenarioRecord {
  id: string;
  name: string;
  notes: string;
  createdAt: number;
  config: FactorySimConfig;
}

export interface SensitivityLeverResult {
  id: string;
  label: string;
  category: 'capacity' | 'buffer' | 'reliability' | 'quality' | 'inventory';
  throughputPerHour: number;
  throughputDeltaPct: number;
  cycleTimeMin: number;
  cycleTimeDeltaPct: number;
  oeePct: number;
  costPerGoodUnit: number;
  costDeltaPerUnit: number;
  newBottleneck: string;
}

function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

function sampleGamma(rnd: () => number, shape: number, scale: number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let iter = 0; iter < 500; iter++) {
    let x: number;
    let v: number;
    do {
      x = normalFrom(rnd, 0, 1);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
    if (Math.log(Math.max(u, 1e-12)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
  return shape * scale;
}

function sampleDuration(rnd: () => number, meanVal: number, cv: number, dist: ServiceDistType): number {
  const m = Math.max(0.05, meanVal);
  const c = Math.max(0, cv);
  if (dist === 'constant' || c <= 1e-6) return m;
  if (dist === 'exponential') {
    let u = rnd();
    while (u <= 1e-9) u = rnd();
    return -m * Math.log(u);
  }
  if (dist === 'lognormal') {
    const s2 = Math.log(1 + c * c);
    const sdLog = Math.sqrt(s2);
    const muLog = Math.log(m) - 0.5 * s2;
    return Math.max(0.05, Math.exp(normalFrom(rnd, muLog, sdLog)));
  }
  return Math.max(m * 0.05, normalFrom(rnd, m, m * c));
}

function sampleInterarrival(rnd: () => number, meanMin: number, cv: number): number {
  if (cv <= 1e-6) return meanMin;
  if (Math.abs(cv - 1) < 0.05) {
    let u = rnd();
    while (u <= 1e-9) u = rnd();
    return -meanMin * Math.log(u);
  }
  const shape = 1 / (cv * cv);
  const scale = meanMin / shape;
  if (shape < 1) {
    let u = rnd();
    while (u <= 1e-9) u = rnd();
    return Math.max(0.05, sampleGamma(rnd, shape + 1, scale) * Math.pow(u, 1 / shape));
  }
  return Math.max(0.05, sampleGamma(rnd, shape, scale));
}

function summarizeCI(values: number[]): ConfidenceInterval {
  const n = values.length;
  if (!n) return { mean: 0, sd: 0, ci95Low: 0, ci95High: 0 };
  const m = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean: m, sd: 0, ci95Low: m, ci95High: m };
  const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(v);
  const tCrit = n < 30 ? 2.09 : 1.96;
  const hw = (tCrit * sd) / Math.sqrt(n);
  return { mean: m, sd, ci95Low: Math.max(0, m - hw), ci95High: m + hw };
}

export function stationsFromLineBalanceForFactory(
  sol: LineBalanceSolution | null | undefined
): FactoryStationConfig[] {
  if (!sol || !sol.stations || !sol.stations.length) {
    return [
      {
        id: 'ST-1',
        name: 'Prep & Frame Weld',
        meanTimeMin: 8.5,
        cv: 0.16,
        machineCount: 1,
        bufferCapacity: 8,
        setupTimeMin: 0.4,
        operatorsPerMachine: 1,
        mtbfMin: 240,
        mttrMin: 10,
        pmIntervalMin: 0,
        pmDurationMin: 0,
        hourlyMachineCost: 42,
      },
      {
        id: 'ST-2',
        name: 'Drive & Assembly',
        meanTimeMin: 10.2,
        cv: 0.2,
        machineCount: 1,
        bufferCapacity: 6,
        setupTimeMin: 0.5,
        operatorsPerMachine: 1,
        mtbfMin: 180,
        mttrMin: 12,
        pmIntervalMin: 0,
        pmDurationMin: 0,
        hourlyMachineCost: 54,
      },
      {
        id: 'ST-3',
        name: 'QC Calibration & Pack',
        meanTimeMin: 7.4,
        cv: 0.14,
        machineCount: 1,
        bufferCapacity: 8,
        setupTimeMin: 0.2,
        operatorsPerMachine: 1,
        mtbfMin: 320,
        mttrMin: 8,
        pmIntervalMin: 0,
        pmDurationMin: 0,
        hourlyMachineCost: 38,
      },
    ];
  }
  return sol.stations.map((st, idx) => ({
    id: `ST-${idx + 1}`,
    name: `Station ${idx + 1} (${st.tasks.length} ops)`,
    meanTimeMin: Math.max(0.5, Number(st.time) || 5),
    cv: 0.18,
    machineCount: 1,
    bufferCapacity: 6,
    setupTimeMin: 0.25,
    operatorsPerMachine: 1,
    mtbfMin: idx === 0 ? 220 : 180,
    mttrMin: 10,
    pmIntervalMin: 0,
    pmDurationMin: 0,
    hourlyMachineCost: 45,
  }));
}

interface SimJob {
  id: number;
  arrivalTime: number;
  enteredQueueAt: number;
  reworkCount: number;
  hadRework: boolean;
}

interface MachineSlot {
  busyJob: SimJob | null;
  busyUntil: number;
  blockedJob: SimJob | null;
  downUntil: number;
  pmUntil: number;
  nextFailureAt: number;
  nextPmAt: number;
  failuresCount: number;
  pmEventsCount: number;
}

interface StationSimState {
  queue: SimJob[];
  machines: MachineSlot[];
  busyTime: number;
  blockedTime: number;
  downTime: number;
  pmTime: number;
  materialWaitTime: number;
  queueArea: number;
  waitTimeSum: number;
  waitCount: number;
  maxQueueLen: number;
  processedJobs: number;
}

interface MaterialRuntime {
  spec: FactoryMaterialInput;
  stock: number;
  onOrder: number;
  pendingArrivals: Array<{ dueMin: number; qty: number }>;
  minStock: number;
  totalConsumed: number;
  replenishmentOrders: number;
  totalOrderedQty: number;
  starvationEvents: number;
  starvedMinutes: number;
}

export function runFactorySimulation(config: FactorySimConfig): FactorySimResult {
  const stationsIn = Array.isArray(config.stations) ? config.stations : [];
  const arrivalRate = Number(config.arrivalRatePerHour) || 0;
  const arrivalCv = Math.max(0, Math.min(2, Number(config.arrivalCv) || 0));
  const shiftsPerDay = Math.max(1, Math.min(3, Math.round(Number(config.shiftsPerDay) || 1)));
  const shiftHours = Math.max(4, Math.min(12, Number(config.shiftHours) || 8));
  const days = Math.max(1, Math.min(30, Math.round(Number(config.daysToSimulate) || 3)));
  const observedHours = shiftsPerDay * shiftHours * days;
  const observedMin = observedHours * 60;
  const warmupHours = Math.max(0, Math.min(observedHours * 0.4, Number(config.warmupHours) || 2));
  const warmupMin = warmupHours * 60;
  const totalSimMin = warmupMin + observedMin;
  const reps = Math.max(1, Math.min(80, Math.round(Number(config.replications) || 15)));
  const seed = (Number(config.seed) >>> 0) || 101;
  const dist: ServiceDistType = config.serviceDist || 'lognormal';

  const operatorsRequired = stationsIn.reduce(
    (sum, st) => sum + Math.max(1, Math.round(st.machineCount)) * Math.max(0.5, Number(st.operatorsPerMachine) || 1),
    0
  );
  const operatorsAvailable = Math.max(1, Number(config.operatorsAvailable) || operatorsRequired || 1);
  const staffingRatio =
    operatorsRequired > 0 ? Math.min(1, Math.max(0.35, operatorsAvailable / operatorsRequired)) : 1;

  const configHash = stableHash(JSON.stringify({ ...config, seed }));
  const provenanceNotice = `Simulated model output (Seed #${seed} · Config ${configHash}) — synthetic/modelled engineering experiment, not live factory telemetry.`;

  const blank = (reason: string): FactorySimResult => ({
    valid: false,
    reason,
    provenance: 'SIMULATED_MODEL',
    provenanceNotice,
    configHash,
    seed,
    replications: reps,
    observedHours,
    warmupHours,
    effectiveStaffingRatio: staffingRatio,
    operatorsRequired,
    operatorsAvailable,
    throughputPerHour: { mean: 0, sd: 0, ci95Low: 0, ci95High: 0 },
    cycleTimeMin: { mean: 0, sd: 0, ci95Low: 0, ci95High: 0 },
    avgWip: { mean: 0, sd: 0, ci95Low: 0, ci95High: 0 },
    goodUnitsCompleted: 0,
    scrapUnits: 0,
    reworkCount: 0,
    firstPassYieldPct: 0,
    theoreticalMaxPerHour: 0,
    oeePct: 0,
    oeeAvailabilityPct: 0,
    oeePerformancePct: 0,
    oeeQualityPct: 0,
    littlesLawExpectedWip: 0,
    littlesLawGapPct: 0,
    bottleneckIndex: 0,
    bottleneckName: '—',
    bottleneckUtilPct: 0,
    materialStarvedHours: 0,
    materialBottleneckSku: null,
    costPerGoodUnit: 0,
    costBreakdown: { labor: 0, machine: 0, material: 0, wipHolding: 0, scrapAndPenalty: 0 },
    stations: [],
    materials: [],
    timeline: [],
    recommendations: [],
  });

  if (!stationsIn.length) return blank('Configure at least one workstation.');
  if (!(arrivalRate > 0)) return blank('Arrival rate must be greater than 0 jobs/hr.');
  for (const st of stationsIn) {
    if (!(Number(st.meanTimeMin) > 0)) return blank(`Workstation "${st.name}" cycle time must be > 0.`);
  }

  const nStations = stationsIn.length;
  const meanInterarrivalMin = 60 / arrivalRate;
  const defectProb = Math.max(0, Math.min(0.45, (Number(config.defectRatePct) || 0) / 100));
  const maxRework = Math.max(0, Math.min(3, Math.round(config.maxReworkLoops ?? 2)));
  const reworkTargetIdx = Math.max(0, Math.min(nStations - 1, Math.round(config.reworkTargetStationIdx ?? 0)));
  const hoursPerDay = shiftsPerDay * shiftHours;

  const repThroughputs: number[] = [];
  const repCycleTimes: number[] = [];
  const repWips: number[] = [];
  const repGoodUnits: number[] = [];
  const repScrapUnits: number[] = [];
  const repReworkCount: number[] = [];
  const repFirstPassCount: number[] = [];
  const repStarvedMin: number[] = [];

  const aggBusy = new Array<number>(nStations).fill(0);
  const aggBlocked = new Array<number>(nStations).fill(0);
  const aggDown = new Array<number>(nStations).fill(0);
  const aggPm = new Array<number>(nStations).fill(0);
  const aggMatWait = new Array<number>(nStations).fill(0);
  const aggQueueArea = new Array<number>(nStations).fill(0);
  const aggWaitSum = new Array<number>(nStations).fill(0);
  const aggWaitCount = new Array<number>(nStations).fill(0);
  const aggMaxQ = new Array<number>(nStations).fill(0);
  const aggProcessed = new Array<number>(nStations).fill(0);
  const aggFailures = new Array<number>(nStations).fill(0);
  const aggPmEvents = new Array<number>(nStations).fill(0);

  const matsIn = config.enforceMaterialFlow ? config.materials || [] : [];
  const aggMatEnd = matsIn.map(() => 0);
  const aggMatMin = matsIn.map(() => Infinity);
  const aggMatConsumed = matsIn.map(() => 0);
  const aggMatOrders = matsIn.map(() => 0);
  const aggMatOrderedQty = matsIn.map(() => 0);
  const aggMatStarveEvents = matsIn.map(() => 0);
  const aggMatStarvedMin = matsIn.map(() => 0);

  let sampleTimeline: FactoryTimelineFrame[] = [];

  for (let rep = 0; rep < reps; rep++) {
    const rnd = mulberry32((seed + Math.imul(rep + 1, 0x9e3779b1)) >>> 0);

    const states: StationSimState[] = stationsIn.map((spec) => {
      const mCount = Math.max(1, Math.min(6, Math.round(spec.machineCount || 1)));
      const mtbf = Number(spec.mtbfMin) || 0;
      const mttr = Number(spec.mttrMin) || 0;
      const pmInt = Number(spec.pmIntervalMin) || 0;
      const pmDur = Number(spec.pmDurationMin) || 0;

      const machines: MachineSlot[] = Array.from({ length: mCount }, (_, mi) => {
        let firstFail = Infinity;
        if (mtbf > 0 && mttr > 0) {
          let u = rnd();
          while (u <= 1e-9) u = rnd();
          // Preventive maintenance lowers random breakdown hazard by 45% inside maintained cycles
          const effectiveMtbf = pmInt > 0 && pmDur > 0 ? mtbf * 1.45 : mtbf;
          firstFail = -effectiveMtbf * Math.log(u);
        }
        return {
          busyJob: null,
          busyUntil: Infinity,
          blockedJob: null,
          downUntil: Infinity,
          pmUntil: Infinity,
          nextFailureAt: firstFail,
          nextPmAt: pmInt > 0 && pmDur > 0 ? pmInt * (0.7 + (mi * 0.3) / Math.max(1, mCount)) : Infinity,
          failuresCount: 0,
          pmEventsCount: 0,
        };
      });

      return {
        queue: [],
        machines,
        busyTime: 0,
        blockedTime: 0,
        downTime: 0,
        pmTime: 0,
        materialWaitTime: 0,
        queueArea: 0,
        waitTimeSum: 0,
        waitCount: 0,
        maxQueueLen: 0,
        processedJobs: 0,
      };
    });

    const materials: MaterialRuntime[] = matsIn.map((spec) => ({
      spec,
      stock: Math.max(0, Number(spec.initialStock) || 0),
      onOrder: 0,
      pendingArrivals: [],
      minStock: Math.max(0, Number(spec.initialStock) || 0),
      totalConsumed: 0,
      replenishmentOrders: 0,
      totalOrderedQty: 0,
      starvationEvents: 0,
      starvedMinutes: 0,
    }));

    let t = 0;
    let nextArrival = sampleInterarrival(rnd, meanInterarrivalMin, arrivalCv);
    let nextJobId = 1;
    let wip = 0;
    let wipArea = 0;
    let goodCompleted = 0;
    let firstPassCompleted = 0;
    let scrapCount = 0;
    let reworkCount = 0;
    let cycleSum = 0;
    let cycleCount = 0;
    let entryMaterialBlocked = false;
    let starvedTotalMin = 0;

    const traceSteps = 32;
    const traceInterval = Math.max(15, Math.round(observedMin / traceSteps));
    let nextSampleAt = warmupMin + traceInterval;
    const timeline: FactoryTimelineFrame[] = [];

    const checkAndOrderMaterial = (now: number) => {
      for (const mat of materials) {
        const pos = mat.stock + mat.onOrder;
        if (pos <= mat.spec.rop && mat.spec.orderQty > 0) {
          const ltMin = Math.max(30, (Number(mat.spec.leadTimeDays) || 1) * hoursPerDay * 60);
          mat.pendingArrivals.push({ dueMin: now + ltMin, qty: mat.spec.orderQty });
          mat.onOrder += mat.spec.orderQty;
          mat.replenishmentOrders++;
          mat.totalOrderedQty += mat.spec.orderQty;
        }
      }
    };

    const hasMaterialsForJob = (): { ok: boolean; missing: MaterialRuntime | null } => {
      if (!materials.length) return { ok: true, missing: null };
      for (const mat of materials) {
        if (mat.stock + 1e-9 < mat.spec.qtyPerJob) {
          return { ok: false, missing: mat };
        }
      }
      return { ok: true, missing: null };
    };

    const consumeMaterialsForJob = (now: number) => {
      for (const mat of materials) {
        mat.stock = Math.max(0, mat.stock - mat.spec.qtyPerJob);
        mat.minStock = Math.min(mat.minStock, mat.stock);
        if (now >= warmupMin) mat.totalConsumed += mat.spec.qtyPerJob;
      }
      checkAndOrderMaterial(now);
    };

    const canAcceptAtStation = (idx: number): boolean => {
      if (idx >= nStations) return true;
      const cap = stationsIn[idx].bufferCapacity ?? Infinity;
      return states[idx].queue.length < cap;
    };

    const tryStartStation = (idx: number, now: number) => {
      const st = states[idx];
      const spec = stationsIn[idx];
      if (!st.queue.length) return;

      for (const m of st.machines) {
        if (!st.queue.length) break;
        if (m.busyJob || m.blockedJob || m.downUntil < Infinity || m.pmUntil < Infinity) continue;

        // Check preventive maintenance due before starting next job
        if (now >= m.nextPmAt && spec.pmIntervalMin > 0 && spec.pmDurationMin > 0) {
          m.pmUntil = now + spec.pmDurationMin;
          m.nextPmAt = Infinity;
          if (now >= warmupMin) m.pmEventsCount++;
          continue;
        }

        // Station 0 pulls BOM components if material flow enabled
        if (idx === 0 && materials.length) {
          const check = hasMaterialsForJob();
          if (!check.ok) {
            if (!entryMaterialBlocked && now >= warmupMin && check.missing) {
              check.missing.starvationEvents++;
            }
            entryMaterialBlocked = true;
            break;
          }
          entryMaterialBlocked = false;
          consumeMaterialsForJob(now);
        }

        const job = st.queue.shift()!;
        if (now >= warmupMin) {
          st.waitTimeSum += now - Math.max(job.enteredQueueAt, warmupMin);
          st.waitCount++;
        }
        m.busyJob = job;
        const setupFactor = config.routingMode === 'parallel-cell' ? 0.3 : 1;
        const baseService = (spec.meanTimeMin + (spec.setupTimeMin || 0) * setupFactor) / staffingRatio;
        const svc = sampleDuration(rnd, baseService, spec.cv ?? 0.18, dist);
        m.busyUntil = now + svc;
      }
    };

    const pushDownstream = (fromIdx: number, now: number) => {
      for (let i = fromIdx; i >= 0; i--) {
        const st = states[i];
        let moved = false;
        for (const m of st.machines) {
          if (!m.blockedJob) continue;
          if (i === nStations - 1 || canAcceptAtStation(i + 1)) {
            const job = m.blockedJob;
            m.blockedJob = null;
            moved = true;
            if (i === nStations - 1) {
              wip = Math.max(0, wip - 1);
              if (now >= warmupMin) {
                goodCompleted++;
                if (!job.hadRework) firstPassCompleted++;
                cycleSum += now - job.arrivalTime;
                cycleCount++;
              }
            } else {
              job.enteredQueueAt = now;
              states[i + 1].queue.push(job);
              if (now >= warmupMin) {
                states[i + 1].maxQueueLen = Math.max(states[i + 1].maxQueueLen, states[i + 1].queue.length);
              }
              tryStartStation(i + 1, now);
            }
          }
        }
        if (moved) tryStartStation(i, now);
      }
    };

    const accumulate = (prevT: number, newT: number) => {
      if (newT <= warmupMin) return;
      const startObs = Math.max(prevT, warmupMin);
      const dt = newT - startObs;
      if (dt <= 0) return;

      wipArea += wip * dt;
      if (entryMaterialBlocked && states[0].queue.length > 0) {
        starvedTotalMin += dt;
        states[0].materialWaitTime += dt;
        for (const mat of materials) {
          if (mat.stock + 1e-9 < mat.spec.qtyPerJob) {
            mat.starvedMinutes += dt;
          }
        }
      }

      for (let i = 0; i < nStations; i++) {
        const st = states[i];
        const mCount = st.machines.length;
        let b = 0;
        let bl = 0;
        let dw = 0;
        let pm = 0;
        for (const m of st.machines) {
          if (m.pmUntil < Infinity) pm++;
          else if (m.downUntil < Infinity) dw++;
          else if (m.blockedJob) bl++;
          else if (m.busyJob) b++;
        }
        st.busyTime += (b / mCount) * dt;
        st.blockedTime += (bl / mCount) * dt;
        st.downTime += (dw / mCount) * dt;
        st.pmTime += (pm / mCount) * dt;
        st.queueArea += st.queue.length * dt;
      }
    };

    const snapshotFrame = (atMin: number): FactoryTimelineFrame => {
      const elapsedHrs = Math.max(1 / 60, (atMin - warmupMin) / 60);
      const stationStates = states.map((st, idx) => {
        if (st.machines.some((m) => m.pmUntil < Infinity)) return 'pm' as const;
        if (st.machines.every((m) => m.downUntil < Infinity)) return 'down' as const;
        if (st.machines.some((m) => m.blockedJob)) return 'blocked' as const;
        if (st.machines.some((m) => m.busyJob)) return 'busy' as const;
        if (idx === 0 && entryMaterialBlocked) return 'starved' as const;
        return 'starved' as const;
      });
      let minCoverPct = 100;
      for (const mat of materials) {
        const ref = Math.max(1, mat.spec.rop * 2, mat.spec.initialStock);
        minCoverPct = Math.min(minCoverPct, Math.round((mat.stock / ref) * 100));
      }
      return {
        hour: Number(((atMin - warmupMin) / 60).toFixed(1)),
        label: `${((atMin - warmupMin) / 60).toFixed(1)}h`,
        wip,
        completedCumulative: goodCompleted,
        throughputPerHour: Number((goodCompleted / elapsedHrs).toFixed(2)),
        scrapCumulative: scrapCount,
        reworkCumulative: reworkCount,
        stationStates,
        stationQueues: states.map((s) => s.queue.length),
        minMaterialCoverPct: minCoverPct,
      };
    };

    let guard = 0;
    const maxEvents = 750000;
    while (t < totalSimMin && guard++ < maxEvents) {
      let nextT = Math.min(totalSimMin, nextArrival);
      let kind: 'end' | 'arrival' | 'finish' | 'fail' | 'repair' | 'pmEnd' | 'matArrival' =
        nextArrival <= totalSimMin ? 'arrival' : 'end';
      let targetSt = -1;
      let targetMachine = -1;
      let targetMat = -1;

      for (let i = 0; i < nStations; i++) {
        const machines = states[i].machines;
        for (let mi = 0; mi < machines.length; mi++) {
          const m = machines[mi];
          if (m.busyUntil < nextT) {
            nextT = m.busyUntil;
            kind = 'finish';
            targetSt = i;
            targetMachine = mi;
          }
          if (m.nextFailureAt < nextT) {
            nextT = m.nextFailureAt;
            kind = 'fail';
            targetSt = i;
            targetMachine = mi;
          }
          if (m.downUntil < nextT) {
            nextT = m.downUntil;
            kind = 'repair';
            targetSt = i;
            targetMachine = mi;
          }
          if (m.pmUntil < nextT) {
            nextT = m.pmUntil;
            kind = 'pmEnd';
            targetSt = i;
            targetMachine = mi;
          }
        }
      }

      for (let mi = 0; mi < materials.length; mi++) {
        for (const po of materials[mi].pendingArrivals) {
          if (po.dueMin < nextT) {
            nextT = po.dueMin;
            kind = 'matArrival';
            targetMat = mi;
          }
        }
      }

      accumulate(t, nextT);
      t = nextT;

      if (rep === 0 && t >= nextSampleAt) {
        while (nextSampleAt <= t && nextSampleAt <= totalSimMin) {
          timeline.push(snapshotFrame(nextSampleAt));
          nextSampleAt += traceInterval;
        }
      }

      if (kind === 'end' || t >= totalSimMin) break;

      if (kind === 'arrival') {
        const intakeCap = Math.max(10, (stationsIn[0].bufferCapacity ?? 6) * 2);
        if (states[0].queue.length < intakeCap) {
          const job: SimJob = { id: nextJobId++, arrivalTime: t, enteredQueueAt: t, reworkCount: 0, hadRework: false };
          states[0].queue.push(job);
          wip++;
          if (t >= warmupMin) {
            states[0].maxQueueLen = Math.max(states[0].maxQueueLen, states[0].queue.length);
          }
          tryStartStation(0, t);
        }
        nextArrival = t + sampleInterarrival(rnd, meanInterarrivalMin, arrivalCv);
      } else if (kind === 'matArrival') {
        const mat = materials[targetMat];
        for (let k = mat.pendingArrivals.length - 1; k >= 0; k--) {
          if (mat.pendingArrivals[k].dueMin <= t + 1e-6) {
            mat.stock += mat.pendingArrivals[k].qty;
            mat.onOrder = Math.max(0, mat.onOrder - mat.pendingArrivals[k].qty);
            mat.pendingArrivals.splice(k, 1);
          }
        }
        entryMaterialBlocked = false;
        tryStartStation(0, t);
      } else if (kind === 'finish') {
        const st = states[targetSt];
        const m = st.machines[targetMachine];
        const job = m.busyJob!;
        m.busyJob = null;
        m.busyUntil = Infinity;
        if (t >= warmupMin) st.processedJobs++;

        if (targetSt === nStations - 1) {
          // Final inspection quality / rework routing
          const defective = defectProb > 0 && rnd() < defectProb;
          if (defective) {
            if (config.routingMode === 'rework-loop' && job.reworkCount < maxRework && canAcceptAtStation(reworkTargetIdx)) {
              job.reworkCount++;
              job.hadRework = true;
              job.enteredQueueAt = t;
              if (t >= warmupMin) reworkCount++;
              states[reworkTargetIdx].queue.push(job);
              tryStartStation(reworkTargetIdx, t);
            } else {
              // Scrapped unit exits WIP
              wip = Math.max(0, wip - 1);
              if (t >= warmupMin) scrapCount++;
            }
          } else {
            wip = Math.max(0, wip - 1);
            if (t >= warmupMin) {
              goodCompleted++;
              if (!job.hadRework) firstPassCompleted++;
              cycleSum += t - job.arrivalTime;
              cycleCount++;
            }
          }
          tryStartStation(targetSt, t);
          pushDownstream(targetSt - 1, t);
        } else if (canAcceptAtStation(targetSt + 1)) {
          job.enteredQueueAt = t;
          states[targetSt + 1].queue.push(job);
          if (t >= warmupMin) {
            states[targetSt + 1].maxQueueLen = Math.max(states[targetSt + 1].maxQueueLen, states[targetSt + 1].queue.length);
          }
          tryStartStation(targetSt + 1, t);
          tryStartStation(targetSt, t);
          pushDownstream(targetSt - 1, t);
        } else {
          m.blockedJob = job;
        }
      } else if (kind === 'fail') {
        const m = states[targetSt].machines[targetMachine];
        const spec = stationsIn[targetSt];
        const mttr = Number(spec.mttrMin) || 8;
        let u = rnd();
        while (u <= 1e-9) u = rnd();
        const repairDur = Math.max(0.5, -mttr * Math.log(u));
        if (m.busyJob && Number.isFinite(m.busyUntil)) {
          m.busyUntil += repairDur;
        }
        m.downUntil = t + repairDur;
        m.nextFailureAt = Infinity;
        if (t >= warmupMin) m.failuresCount++;
      } else if (kind === 'repair') {
        const m = states[targetSt].machines[targetMachine];
        const spec = stationsIn[targetSt];
        const mtbf = Number(spec.mtbfMin) || 0;
        m.downUntil = Infinity;
        if (mtbf > 0) {
          let u = rnd();
          while (u <= 1e-9) u = rnd();
          const effMtbf = spec.pmIntervalMin > 0 && spec.pmDurationMin > 0 ? mtbf * 1.45 : mtbf;
          m.nextFailureAt = t + -effMtbf * Math.log(u);
        }
        tryStartStation(targetSt, t);
      } else if (kind === 'pmEnd') {
        const m = states[targetSt].machines[targetMachine];
        const spec = stationsIn[targetSt];
        m.pmUntil = Infinity;
        if (spec.pmIntervalMin > 0) {
          m.nextPmAt = t + spec.pmIntervalMin;
        }
        tryStartStation(targetSt, t);
      }
    }

    repThroughputs.push(goodCompleted / observedHours);
    repCycleTimes.push(cycleCount > 0 ? cycleSum / cycleCount : 0);
    repWips.push(wipArea / observedMin);
    repGoodUnits.push(goodCompleted);
    repScrapUnits.push(scrapCount);
    repReworkCount.push(reworkCount);
    repFirstPassCount.push(firstPassCompleted);
    repStarvedMin.push(starvedTotalMin);

    for (let i = 0; i < nStations; i++) {
      aggBusy[i] += states[i].busyTime;
      aggBlocked[i] += states[i].blockedTime;
      aggDown[i] += states[i].downTime;
      aggPm[i] += states[i].pmTime;
      aggMatWait[i] += states[i].materialWaitTime;
      aggQueueArea[i] += states[i].queueArea;
      aggWaitSum[i] += states[i].waitTimeSum;
      aggWaitCount[i] += states[i].waitCount;
      aggMaxQ[i] = Math.max(aggMaxQ[i], states[i].maxQueueLen);
      aggProcessed[i] += states[i].processedJobs;
      aggFailures[i] += states[i].machines.reduce((s, m) => s + m.failuresCount, 0);
      aggPmEvents[i] += states[i].machines.reduce((s, m) => s + m.pmEventsCount, 0);
    }

    for (let mi = 0; mi < materials.length; mi++) {
      aggMatEnd[mi] += materials[mi].stock;
      aggMatMin[mi] = Math.min(aggMatMin[mi], materials[mi].minStock);
      aggMatConsumed[mi] += materials[mi].totalConsumed;
      aggMatOrders[mi] += materials[mi].replenishmentOrders;
      aggMatOrderedQty[mi] += materials[mi].totalOrderedQty;
      aggMatStarveEvents[mi] += materials[mi].starvationEvents;
      aggMatStarvedMin[mi] += materials[mi].starvedMinutes;
    }

    if (rep === 0) sampleTimeline = timeline;
  }

  const tpCI = summarizeCI(repThroughputs);
  const ctCI = summarizeCI(repCycleTimes);
  const wipCI = summarizeCI(repWips);

  const avgGood = repGoodUnits.reduce((a, b) => a + b, 0) / reps;
  const avgScrap = repScrapUnits.reduce((a, b) => a + b, 0) / reps;
  const avgRework = repReworkCount.reduce((a, b) => a + b, 0) / reps;
  const avgFirstPass = repFirstPassCount.reduce((a, b) => a + b, 0) / reps;
  const avgStarvedMin = repStarvedMin.reduce((a, b) => a + b, 0) / reps;

  const totalAttempts = Math.max(1, avgGood + avgScrap);
  const firstPassYieldPct = Math.min(100, (avgFirstPass / totalAttempts) * 100);
  const qualityPct = Math.min(100, (avgGood / totalAttempts) * 100);

  const denom = observedMin * reps;
  const stations: StationSimResult[] = stationsIn.map((spec, i) => {
    const busyPct = (aggBusy[i] / denom) * 100;
    const blockedPct = (aggBlocked[i] / denom) * 100;
    const downPct = (aggDown[i] / denom) * 100;
    const pmPct = (aggPm[i] / denom) * 100;
    const materialWaitPct = (aggMatWait[i] / denom) * 100;
    const utilizationPct = Math.min(100, busyPct);
    const starvedPct = Math.max(0, 100 - busyPct - blockedPct - downPct - pmPct);
    const mCount = Math.max(1, Math.round(spec.machineCount || 1));
    const setupFactor = config.routingMode === 'parallel-cell' ? 0.3 : 1;
    const effectiveCycleMin = (spec.meanTimeMin + (spec.setupTimeMin || 0) * setupFactor) / (mCount * staffingRatio);

    return {
      index: i,
      id: spec.id,
      name: spec.name,
      machineCount: mCount,
      meanTimeMin: spec.meanTimeMin,
      effectiveCycleMin,
      utilizationPct,
      busyPct,
      blockedPct,
      starvedPct,
      downPct,
      pmPct,
      materialWaitPct,
      avgQueueLen: aggQueueArea[i] / denom,
      maxQueueLen: aggMaxQ[i],
      avgWaitMin: aggWaitCount[i] > 0 ? aggWaitSum[i] / aggWaitCount[i] : 0,
      processedJobs: Math.round(aggProcessed[i] / reps),
      failuresCount: Number((aggFailures[i] / reps).toFixed(1)),
      pmEventsCount: Number((aggPmEvents[i] / reps).toFixed(1)),
      isBottleneck: false,
    };
  });

  let bnIdx = 0;
  for (let i = 1; i < stations.length; i++) {
    const scoreCur = stations[i].busyPct + stations[i].downPct * 0.5;
    const scoreBest = stations[bnIdx].busyPct + stations[bnIdx].downPct * 0.5;
    if (scoreCur > scoreBest + 0.05 || (Math.abs(scoreCur - scoreBest) <= 0.05 && stations[i].effectiveCycleMin > stations[bnIdx].effectiveCycleMin)) {
      bnIdx = i;
    }
  }
  stations[bnIdx].isBottleneck = true;

  const slowestEffCycle = Math.max(...stations.map((s) => s.effectiveCycleMin));
  const theoreticalMaxPerHour = slowestEffCycle > 0 ? 60 / slowestEffCycle : 0;

  const avgAvailPct = Math.max(
    0,
    Math.min(100, 100 - stations.reduce((s, st) => s + st.downPct + st.pmPct, 0) / stations.length)
  );
  const perfDenom = Math.min(arrivalRate, theoreticalMaxPerHour) || 1;
  const oeePerformancePct = Math.min(100, (tpCI.mean / perfDenom) * 100);
  const oeePct = (avgAvailPct / 100) * (oeePerformancePct / 100) * (qualityPct / 100) * 100;

  const littlesLawExpectedWip = (tpCI.mean / 60) * ctCI.mean;
  const littlesLawGapPct = wipCI.mean > 1e-6 ? (Math.abs(wipCI.mean - littlesLawExpectedWip) / wipCI.mean) * 100 : 0;

  const matResults: MaterialSimResult[] = matsIn.map((spec, mi) => ({
    sku: spec.sku,
    name: spec.name,
    unit: spec.unit,
    initialStock: spec.initialStock,
    endingStock: Number((aggMatEnd[mi] / reps).toFixed(1)),
    minStock: Number((Number.isFinite(aggMatMin[mi]) ? aggMatMin[mi] : spec.initialStock).toFixed(1)),
    totalConsumed: Number((aggMatConsumed[mi] / reps).toFixed(1)),
    replenishmentOrders: Number((aggMatOrders[mi] / reps).toFixed(1)),
    totalOrderedQty: Number((aggMatOrderedQty[mi] / reps).toFixed(1)),
    starvationEvents: Number((aggMatStarveEvents[mi] / reps).toFixed(1)),
    starvedMinutes: Number((aggMatStarvedMin[mi] / reps).toFixed(1)),
    stockoutOccurred: aggMatStarvedMin[mi] > 0.1 || aggMatMin[mi] < spec.qtyPerJob,
  }));

  const starvedMat = [...matResults].sort((a, b) => b.starvedMinutes - a.starvedMinutes)[0];
  const materialBottleneckSku = starvedMat && starvedMat.starvedMinutes > 0.1 ? starvedMat.sku : null;

  // Economics per good unit
  const goodUnits = Math.max(1, avgGood);
  const laborCostTotal = operatorsAvailable * (Number(config.laborRatePerHour) || 28) * observedHours;
  const machineCostTotal =
    stationsIn.reduce((s, st) => s + Math.max(1, st.machineCount) * (Number(st.hourlyMachineCost) || 40), 0) *
    observedHours;
  const materialCostPerUnit = (config.materials || []).reduce(
    (s, m) => s + (Number(m.qtyPerJob) || 0) * (Number(m.unitCost) || 0),
    0
  );
  const wipHoldTotal = wipCI.mean * (Number(config.wipHoldingCostPerJobHour) || 3.5) * observedHours;
  const missedDemand = Math.max(0, arrivalRate * observedHours - avgGood);
  const penaltyTotal =
    (avgScrap * materialCostPerUnit + missedDemand * (Number(config.stockoutPenaltyPerMissedJob) || 12));

  const costBreakdown = {
    labor: laborCostTotal / goodUnits,
    machine: machineCostTotal / goodUnits,
    material: materialCostPerUnit,
    wipHolding: wipHoldTotal / goodUnits,
    scrapAndPenalty: penaltyTotal / goodUnits,
  };
  const costPerGoodUnit =
    costBreakdown.labor +
    costBreakdown.machine +
    costBreakdown.material +
    costBreakdown.wipHolding +
    costBreakdown.scrapAndPenalty;

  const recommendations: string[] = [];
  const bn = stations[bnIdx];
  if (bn && bn.utilizationPct >= 85) {
    recommendations.push(
      `Bottleneck at ${bn.name} (${bn.utilizationPct.toFixed(1)}% util): test adding +1 parallel machine or redistributing Line Balance tasks.`
    );
  }
  if (bn && bn.blockedPct >= 8) {
    recommendations.push(
      `Downstream blocking on ${bn.name} (${bn.blockedPct.toFixed(1)}%): expand inter-station buffer capacity downstream.`
    );
  }
  if (staffingRatio < 0.99) {
    recommendations.push(
      `Workforce constraint active (${operatorsAvailable} available vs ${operatorsRequired} required — ${Math.round(staffingRatio * 100)}% pace).`
    );
  }
  if (materialBottleneckSku) {
    recommendations.push(
      `Material starvation detected on ${materialBottleneckSku} (${(avgStarvedMin / 60).toFixed(1)}h line wait): raise ROP or add safety stock.`
    );
  }
  if (config.defectRatePct > 1.5 && config.routingMode !== 'rework-loop') {
    recommendations.push(
      `Defect rate (${config.defectRatePct.toFixed(1)}%) causes ${avgScrap.toFixed(1)} scrap units — evaluate rework-loop routing or SPC tighter tolerances.`
    );
  }
  if (!recommendations.length) {
    recommendations.push('Line flow is balanced within target buffer and staffing bounds — test demand surge scenarios next.');
  }

  return {
    valid: true,
    reason: '',
    provenance: 'SIMULATED_MODEL',
    provenanceNotice,
    configHash,
    seed,
    replications: reps,
    observedHours,
    warmupHours,
    effectiveStaffingRatio: staffingRatio,
    operatorsRequired,
    operatorsAvailable,
    throughputPerHour: tpCI,
    cycleTimeMin: ctCI,
    avgWip: wipCI,
    goodUnitsCompleted: Math.round(avgGood),
    scrapUnits: Number(avgScrap.toFixed(1)),
    reworkCount: Number(avgRework.toFixed(1)),
    firstPassYieldPct,
    theoreticalMaxPerHour,
    oeePct,
    oeeAvailabilityPct: avgAvailPct,
    oeePerformancePct,
    oeeQualityPct: qualityPct,
    littlesLawExpectedWip,
    littlesLawGapPct,
    bottleneckIndex: bnIdx,
    bottleneckName: bn.name,
    bottleneckUtilPct: bn.utilizationPct,
    materialStarvedHours: avgStarvedMin / 60,
    materialBottleneckSku,
    costPerGoodUnit,
    costBreakdown,
    stations,
    materials: matResults,
    timeline: sampleTimeline,
    recommendations,
  };
}

/**
 * Automated sensitivity & bottleneck-relief experiment sweep.
 * Evaluates targeted interventions against the baseline config deterministically.
 */
export function runSensitivitySweep(baseConfig: FactorySimConfig): {
  baseline: FactorySimResult;
  levers: SensitivityLeverResult[];
} {
  const fastConfig: FactorySimConfig = {
    ...baseConfig,
    replications: Math.min(12, Math.max(5, baseConfig.replications)),
  };
  const baseline = runFactorySimulation(fastConfig);
  if (!baseline.valid) return { baseline, levers: [] };

  const candidates: Array<{ id: string; label: string; category: SensitivityLeverResult['category']; mutate: (c: FactorySimConfig) => FactorySimConfig }> = [];

  // 1. Add +1 parallel machine at current bottleneck
  const bnIdx = baseline.bottleneckIndex;
  const bnStation = fastConfig.stations[bnIdx];
  if (bnStation) {
    candidates.push({
      id: 'add-bn-machine',
      label: `+1 Machine at ${bnStation.name}`,
      category: 'capacity',
      mutate: (c) => ({
        ...c,
        operatorsAvailable: c.operatorsAvailable + Math.ceil(bnStation.operatorsPerMachine || 1),
        stations: c.stations.map((s, idx) => (idx === bnIdx ? { ...s, machineCount: s.machineCount + 1 } : s)),
      }),
    });
  }

  // 2. Double inter-station buffers
  candidates.push({
    id: 'double-buffers',
    label: 'Double Inter-Station WIP Buffers',
    category: 'buffer',
    mutate: (c) => ({
      ...c,
      stations: c.stations.map((s) => ({ ...s, bufferCapacity: Math.min(30, Math.max(4, s.bufferCapacity * 2)) })),
    }),
  });

  // 3. Preventive Maintenance program across stations
  candidates.push({
    id: 'enable-pm',
    label: 'Scheduled Preventive Maintenance (every 240m)',
    category: 'reliability',
    mutate: (c) => ({
      ...c,
      stations: c.stations.map((s) => ({
        ...s,
        pmIntervalMin: 240,
        pmDurationMin: 6,
      })),
    }),
  });

  // 4. SMED Setup & Variability Reduction (-35% CV, -50% setup)
  candidates.push({
    id: 'smed-cv',
    label: 'SMED Setup & Cycle Variance (-35% CV)',
    category: 'quality',
    mutate: (c) => ({
      ...c,
      defectRatePct: Math.max(0.4, c.defectRatePct * 0.6),
      stations: c.stations.map((s) => ({
        ...s,
        cv: Math.max(0.05, Number((s.cv * 0.65).toFixed(2))),
        setupTimeMin: Number((s.setupTimeMin * 0.5).toFixed(2)),
      })),
    }),
  });

  // 5. Raise BOM ROP & safety buffers +40%
  if (fastConfig.enforceMaterialFlow && fastConfig.materials.length > 0) {
    candidates.push({
      id: 'raise-rop',
      label: 'Raise Warehouse ROP & Order Qty (+40%)',
      category: 'inventory',
      mutate: (c) => ({
        ...c,
        materials: c.materials.map((m) => ({
          ...m,
          rop: Math.round(m.rop * 1.4),
          orderQty: Math.round(m.orderQty * 1.25),
          initialStock: Math.max(m.initialStock, Math.round(m.rop * 1.5)),
        })),
      }),
    });
  }

  const levers: SensitivityLeverResult[] = candidates.map((cand) => {
    const res = runFactorySimulation(cand.mutate(fastConfig));
    const tpDelta =
      baseline.throughputPerHour.mean > 0
        ? ((res.throughputPerHour.mean - baseline.throughputPerHour.mean) / baseline.throughputPerHour.mean) * 100
        : 0;
    const ctDelta =
      baseline.cycleTimeMin.mean > 0
        ? ((res.cycleTimeMin.mean - baseline.cycleTimeMin.mean) / baseline.cycleTimeMin.mean) * 100
        : 0;
    return {
      id: cand.id,
      label: cand.label,
      category: cand.category,
      throughputPerHour: res.throughputPerHour.mean,
      throughputDeltaPct: tpDelta,
      cycleTimeMin: res.cycleTimeMin.mean,
      cycleTimeDeltaPct: ctDelta,
      oeePct: res.oeePct,
      costPerGoodUnit: res.costPerGoodUnit,
      costDeltaPerUnit: res.costPerGoodUnit - baseline.costPerGoodUnit,
      newBottleneck: res.bottleneckName,
    };
  });

  levers.sort((a, b) => b.throughputDeltaPct - a.throughputDeltaPct);
  return { baseline, levers };
}

// ---------- Cross-Module Workspace Synchronization Helpers ----------

export interface WorkspaceProductInput {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  unitCost: number;
  stock: number;
  annualDemand: number;
  leadTime: number;
  demandHistory?: number[];
  bom?: Array<{ componentId: string; qtyPer: number }>;
}

export interface WorkspaceMetricsInput {
  rop: number;
  suggestedOrderQty: number;
}

export interface WorkspaceLineBalanceInput {
  benchmarkKey: string;
  cycleTime: number;
  tasks: Array<{ id: string; name?: string; time: number; successors?: string[] }>;
  selectedAlgo: string;
}

const SIM_FORECAST_CANDIDATES: MethodSpec[] = [
  { name: 'SMA (3)', shortKey: 'sma', method: smaMethod, params: { w: 3 } },
  { name: 'WMA (3)', shortKey: 'wma', method: wmaMethod, params: { w: 3 } },
  { name: 'SES', shortKey: 'ema', method: emaMethod, params: { alpha: 0.3 } },
  { name: 'Holt linear', shortKey: 'holt', method: holtLinear, params: { alpha: 0.35, beta: 0.15 } },
  { name: 'Linear trend', shortKey: 'lin', method: linregMethod, params: {} },
];

export type SpcQualityProfileKey = 'stable' | 'drift' | 'ooc';

const SPC_PROFILE_SAMPLES: Record<SpcQualityProfileKey, { label: string; lsl: number; usl: number; subgroups: number[][] }> = {
  stable: {
    label: 'Stable bearing bore (Cpk >= 1.6)',
    lsl: 24.94,
    usl: 25.06,
    subgroups: [
      [25.002, 24.996, 25.005, 24.998, 25.001],
      [24.997, 25.004, 25.000, 24.995, 25.003],
      [25.006, 24.999, 25.002, 24.997, 25.001],
      [24.994, 25.001, 25.003, 24.999, 25.000],
      [25.005, 25.002, 24.996, 25.001, 24.998],
    ],
  },
  drift: {
    label: 'Tool-wear upward drift (SPC warning)',
    lsl: 24.94,
    usl: 25.06,
    subgroups: [
      [24.995, 25.001, 24.998, 25.002, 24.999],
      [25.004, 25.002, 25.006, 25.003, 25.005],
      [25.011, 25.008, 25.012, 25.010, 25.009],
      [25.018, 25.016, 25.020, 25.017, 25.019],
      [25.026, 25.024, 25.028, 25.025, 25.027],
    ],
  },
  ooc: {
    label: 'Out-of-control spike',
    lsl: 24.94,
    usl: 25.06,
    subgroups: [
      [25.001, 24.998, 25.003, 24.999, 25.000],
      [25.024, 25.028, 25.021, 25.026, 25.023],
      [24.998, 25.001, 25.002, 24.996, 25.000],
      [25.002, 24.999, 25.001, 25.003, 24.998],
    ],
  },
};

export function estimateSpcQualityProfile(key: SpcQualityProfileKey): {
  defectRatePct: number;
  label: string;
  cpk: number | null;
} {
  const spec = SPC_PROFILE_SAMPLES[key];
  const spc = spcAnalysis({ subgroups: spec.subgroups, lsl: spec.lsl, usl: spec.usl });
  const rawOut = spc.outOfSpecPct != null ? spc.outOfSpecPct : 1.2;
  const bounded = Math.max(0.25, Math.min(25, Number(Math.max(rawOut, key === 'drift' ? 2.4 : key === 'ooc' ? 4.2 : 0.6).toFixed(2))));
  return {
    defectRatePct: bounded,
    label: `${spec.label}${spc.cap ? ` (Cpk ${spc.cap.Cpk.toFixed(2)})` : ''}`,
    cpk: spc.cap ? spc.cap.Cpk : null,
  };
}

export function forecastDemandSignalForProduct(product: WorkspaceProductInput): {
  monthlyForecast: number;
  modelName: string;
  annualizedRate: number;
} {
  const hist = Array.isArray(product.demandHistory)
    ? product.demandHistory.map(Number).filter((v) => Number.isFinite(v) && v >= 0)
    : [];
  const fallbackMonthly = Math.max(1, (Number(product.annualDemand) || 120) / 12);
  if (hist.length >= 6) {
    const minTrain = Math.min(6, Math.max(3, hist.length - 3));
    const cmp = compareMethods(hist, SIM_FORECAST_CANDIDATES, { minTrainSize: minTrain, horizon: 3 });
    if (cmp.best) {
      const out: ForecastOutput = cmp.best.method(hist, { ...cmp.best.params, horizon: 3 });
      const avg3 =
        out.forecast.slice(0, 3).reduce((s, v) => s + Math.max(0, Number(v) || 0), 0) /
        Math.max(1, out.forecast.slice(0, 3).length);
      return {
        monthlyForecast: Math.max(1, avg3 || fallbackMonthly),
        modelName: cmp.best.name,
        annualizedRate: Math.max(12, (avg3 || fallbackMonthly) * 12),
      };
    }
  }
  return {
    monthlyForecast: fallbackMonthly,
    modelName: 'Annual run-rate',
    annualizedRate: fallbackMonthly * 12,
  };
}

export function extractBomMaterialsForFactory<T extends WorkspaceProductInput>(
  products: T[],
  assembly: T | undefined,
  metricsOf: (p: T) => WorkspaceMetricsInput
): FactoryMaterialInput[] {
  if (!assembly || !assembly.bom || !assembly.bom.length) return [];
  const byId = new Map<string, T>();
  products.forEach((p) => byId.set(p.id, p));

  const out: FactoryMaterialInput[] = [];
  assembly.bom.forEach((line) => {
    const comp = byId.get(line.componentId);
    if (!comp || !(line.qtyPer > 0)) return;
    const m = metricsOf(comp);
    out.push({
      productId: comp.id,
      sku: comp.sku,
      name: comp.name,
      unit: comp.unit,
      initialStock: Math.max(0, Number(comp.stock) || 0),
      qtyPerJob: Number(line.qtyPer),
      rop: Math.max(1, Math.round(m.rop)),
      orderQty: Math.max(1, Math.round(m.suggestedOrderQty)),
      leadTimeDays: Math.max(0.5, Number(comp.leadTime) || 7),
      unitCost: Math.max(0, Number(comp.unitCost) || 0),
    });
  });
  return out;
}

export function resolveActiveLineBalanceSolution(lb: WorkspaceLineBalanceInput | null | undefined): LineBalanceSolution | null {
  if (!lb || !Array.isArray(lb.tasks) || !lb.tasks.length) return null;
  const cmp = compareAlgorithms({
    tasks: lb.tasks,
    cycleTime: lb.cycleTime,
    algorithms: ['rpw', 'lcr', 'kw', 'comsoal', 'exact'],
    exactMaxTimeMs: 600,
  });
  const algoKey = lb.selectedAlgo === 'comsail' ? 'comsoal' : lb.selectedAlgo;
  return cmp.algorithms[algoKey] || cmp.best || Object.values(cmp.algorithms)[0] || null;
}

export function buildDefaultFactoryConfigFromWorkspace<T extends WorkspaceProductInput>(params: {
  products: T[];
  lineBalance?: WorkspaceLineBalanceInput | null;
  metricsOf: (p: T) => WorkspaceMetricsInput;
  assemblySku?: string;
  spcProfile?: SpcQualityProfileKey;
}): FactorySimConfig {
  const { products, lineBalance, metricsOf, assemblySku, spcProfile = 'stable' } = params;
  const assembly =
    (assemblySku ? products.find((p) => p.sku.toUpperCase() === assemblySku.toUpperCase()) : undefined) ||
    products.find((p) => p.sku === 'ASM-PA100') ||
    products.find((p) => Array.isArray(p.bom) && p.bom.length > 0) ||
    products[0];

  const lbSol = resolveActiveLineBalanceSolution(lineBalance);
  const stations = stationsFromLineBalanceForFactory(lbSol);
  const cycleMin = Math.max(1, Number(lineBalance?.cycleTime) || 10);
  const nominalTaktRate = (60 / cycleMin) * 0.85;

  const fc = assembly
    ? forecastDemandSignalForProduct(assembly)
    : { monthlyForecast: 120, modelName: 'Baseline', annualizedRate: 1440 };

  const shiftsPerDay = 2;
  const shiftHours = 8;
  const rawDemandHourly = fc.monthlyForecast / (22 * shiftsPerDay * shiftHours);
  const arrivalRatePerHour = Number(
    (rawDemandHourly >= 0.9 ? rawDemandHourly : Math.max(2.2, nominalTaktRate)).toFixed(2)
  );

  const materials = extractBomMaterialsForFactory(products, assembly, metricsOf);
  const spcEst = estimateSpcQualityProfile(spcProfile);
  const operatorsRequired = stations.reduce((s, st) => s + st.machineCount * st.operatorsPerMachine, 0);

  return {
    name: `${assembly ? assembly.sku : 'Line'} Baseline Experiment`,
    assemblySku: assembly?.sku || 'ASM-LINE',
    assemblyName: assembly?.name || 'Assembly Line',
    arrivalRatePerHour,
    arrivalCv: 0.45,
    serviceDist: 'lognormal',
    routingMode: 'rework-loop',
    defectRatePct: spcEst.defectRatePct,
    reworkTargetStationIdx: Math.max(0, Math.min(stations.length - 1, Math.floor(stations.length / 2))),
    maxReworkLoops: 2,
    shiftsPerDay,
    shiftHours,
    daysToSimulate: 1,
    warmupHours: 2,
    operatorsAvailable: Math.max(1, operatorsRequired),
    laborRatePerHour: 28,
    wipHoldingCostPerJobHour: 3.5,
    stockoutPenaltyPerMissedJob: 14,
    replications: 12,
    seed: 2026,
    enforceMaterialFlow: materials.length > 0,
    stations,
    materials,
    sourceNotes: {
      demandOrigin:
        rawDemandHourly >= 0.9
          ? `Forecast demand (${fc.modelName}: ${fc.monthlyForecast.toFixed(0)}/mo)`
          : `Takt-scaled from ${assembly?.sku || 'line'} (${fc.modelName}: ${fc.monthlyForecast.toFixed(0)}/mo at C=${cycleMin}m)`,
      lineBalanceOrigin: lbSol
        ? `${lineBalance?.benchmarkKey || 'custom'} · ${lbSol.label} (${lbSol.stationCount} stns @ C=${cycleMin}m)`
        : 'Default 3-station assembly cell',
      bomOrigin:
        materials.length > 0
          ? `${assembly?.sku} BOM (${materials.length} warehouse SKUs synced to live stock & ROP)`
          : 'No BOM components linked (material unconstrained)',
      spcOrigin: spcEst.label,
    },
  };
}

