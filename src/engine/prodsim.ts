/**
 * Discrete-Event Production Line Simulation (DES) Engine.
 * Simulates multi-stage serial assembly lines with stochastic arrivals,
 * variable workstation cycle times, finite inter-station buffers (blocking/starvation),
 * optional reliability failures (MTBF / MTTR), and Little's Law verification.
 * Pure TypeScript, zero DOM dependencies.
 */

import { mulberry32, normalFrom } from './ipe.ts';
import { LineBalanceSolution } from './linebal.ts';

export type ServiceDistType = 'normal' | 'lognormal' | 'exponential' | 'constant';

export interface ProductionStationInput {
  id: string;
  name: string;
  meanTimeMin: number;
  cv?: number;
  bufferCapacity?: number;
  mtbfMin?: number;
  mttrMin?: number;
}

export interface ProductionSimOptions {
  stations: ReadonlyArray<ProductionStationInput>;
  arrivalRatePerHour: number;
  arrivalCv?: number;
  shiftMinutes?: number;
  warmupMinutes?: number;
  replications?: number;
  seed?: number;
  serviceDist?: ServiceDistType;
}

export interface StationSimTelemetry {
  index: number;
  id: string;
  name: string;
  meanTimeMin: number;
  effectiveMeanMin: number;
  utilizationPct: number;
  busyPct: number;
  blockedPct: number;
  starvedPct: number;
  downPct: number;
  avgQueueLen: number;
  maxQueueLen: number;
  avgWaitMin: number;
  processedJobs: number;
  isBottleneck: boolean;
}

export interface ProductionSimResult {
  valid: boolean;
  reason: string;
  replications: number;
  shiftMinutes: number;
  warmupMinutes: number;
  arrivalRatePerHour: number;
  effectiveThroughputPerHour: number;
  throughputSd: number;
  theoreticalMaxThroughputPerHour: number;
  lineEfficiencyPct: number;
  avgCycleTimeMin: number;
  cycleTimeSd: number;
  avgWip: number;
  littlesLawExpectedWip: number;
  littlesLawGapPct: number;
  totalCompletedJobs: number;
  bottleneckIndex: number;
  bottleneckName: string;
  bottleneckUtilPct: number;
  stations: StationSimTelemetry[];
  timeline: Array<{ minute: number; wip: number; completedPerHour: number }>;
}

function samplePositiveDuration(
  rnd: () => number,
  meanVal: number,
  cv: number,
  dist: ServiceDistType
): number {
  const m = Math.max(0.01, meanVal);
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
    return Math.max(0.01, Math.exp(normalFrom(rnd, muLog, sdLog)));
  }
  // Normal truncated safely above 0.05 * mean to preserve realistic positive cycle times
  return Math.max(m * 0.05, normalFrom(rnd, m, m * c));
}

function sampleInterarrival(rnd: () => number, meanInterarrivalMin: number, cv: number): number {
  if (cv <= 1e-6) return meanInterarrivalMin;
  if (Math.abs(cv - 1) < 0.05) {
    let u = rnd();
    while (u <= 1e-9) u = rnd();
    return -meanInterarrivalMin * Math.log(u);
  }
  // Gamma approximation via Marsaglia & Tsang for general arrival CV
  const shape = 1 / (cv * cv);
  const scale = meanInterarrivalMin / shape;
  if (shape < 1) {
    let u = rnd();
    while (u <= 1e-9) u = rnd();
    return Math.max(0.01, sampleGamma(rnd, shape + 1, scale) * Math.pow(u, 1 / shape));
  }
  return Math.max(0.01, sampleGamma(rnd, shape, scale));
}

function sampleGamma(rnd: () => number, shape: number, scale: number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
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
}

interface Job {
  id: number;
  arrivalTime: number;
  enteredQueueAt: number;
}

interface StationState {
  queue: Job[];
  busyJob: Job | null;
  busyUntil: number;
  blockedJob: Job | null;
  downUntil: number;
  nextFailureAt: number;
  busyTime: number;
  blockedTime: number;
  downTime: number;
  queueArea: number;
  waitTimeSum: number;
  waitCount: number;
  maxQueueLen: number;
  processedJobs: number;
}

export function stationsFromLineBalance(
  sol: LineBalanceSolution | null | undefined,
  opts: { cv?: number; bufferCapacity?: number; mtbfMin?: number; mttrMin?: number } = {}
): ProductionStationInput[] {
  if (!sol || !sol.stations || !sol.stations.length) return [];
  return sol.stations.map((st, idx) => ({
    id: `ST-${idx + 1}`,
    name: `Station ${idx + 1} (${st.tasks.map((t) => t.id).join('+') || `${st.taskCount} tasks`})`,
    meanTimeMin: Math.max(0.1, Number(st.time) || 1),
    cv: opts.cv ?? 0.18,
    bufferCapacity: opts.bufferCapacity ?? 8,
    mtbfMin: opts.mtbfMin ?? 0,
    mttrMin: opts.mttrMin ?? 0,
  }));
}

export function simulateProductionLine(opts: ProductionSimOptions): ProductionSimResult {
  const stationsIn = Array.isArray(opts.stations) ? opts.stations : [];
  const arrivalRate = Number(opts.arrivalRatePerHour) || 0;
  const arrivalCv = Math.max(0, Math.min(2, Number(opts.arrivalCv ?? 0.6)));
  const shiftMinutes = Math.max(60, Math.min(4800, Number(opts.shiftMinutes ?? 480)));
  const warmupMinutes = Math.max(0, Math.min(shiftMinutes * 0.4, Number(opts.warmupMinutes ?? Math.min(60, shiftMinutes * 0.15))));
  const reps = Math.max(1, Math.min(100, Math.round(Number(opts.replications ?? 20))));
  const seed = (Number(opts.seed ?? 42) >>> 0) || 42;
  const dist: ServiceDistType = opts.serviceDist ?? 'lognormal';

  const blank = (reason: string): ProductionSimResult => ({
    valid: false,
    reason,
    replications: reps,
    shiftMinutes,
    warmupMinutes,
    arrivalRatePerHour: arrivalRate,
    effectiveThroughputPerHour: 0,
    throughputSd: 0,
    theoreticalMaxThroughputPerHour: 0,
    lineEfficiencyPct: 0,
    avgCycleTimeMin: 0,
    cycleTimeSd: 0,
    avgWip: 0,
    littlesLawExpectedWip: 0,
    littlesLawGapPct: 0,
    totalCompletedJobs: 0,
    bottleneckIndex: 0,
    bottleneckName: '—',
    bottleneckUtilPct: 0,
    stations: [],
    timeline: [],
  });

  if (!stationsIn.length) return blank('Provide at least one workstation to simulate.');
  if (!(arrivalRate > 0)) return blank('Arrival rate must be greater than 0 jobs/hr.');
  for (const st of stationsIn) {
    if (!(Number(st.meanTimeMin) > 0)) return blank(`Workstation "${st.name}" cycle time must be > 0.`);
  }

  const nStations = stationsIn.length;
  const totalSimTime = warmupMinutes + shiftMinutes;
  const meanInterarrivalMin = 60 / arrivalRate;

  const repThroughputs: number[] = [];
  const repCycleTimes: number[] = [];
  const repWips: number[] = [];
  const repCompleted: number[] = [];

  const aggBusy = new Array<number>(nStations).fill(0);
  const aggBlocked = new Array<number>(nStations).fill(0);
  const aggDown = new Array<number>(nStations).fill(0);
  const aggQueueArea = new Array<number>(nStations).fill(0);
  const aggWaitSum = new Array<number>(nStations).fill(0);
  const aggWaitCount = new Array<number>(nStations).fill(0);
  const aggMaxQ = new Array<number>(nStations).fill(0);
  const aggProcessed = new Array<number>(nStations).fill(0);
  let sampleTimeline: Array<{ minute: number; wip: number; completedPerHour: number }> = [];

  for (let rep = 0; rep < reps; rep++) {
    const rnd = mulberry32((seed + Math.imul(rep + 1, 0x9e3779b1)) >>> 0);
    const states: StationState[] = stationsIn.map((spec) => {
      const mtbf = Number(spec.mtbfMin) || 0;
      const mttr = Number(spec.mttrMin) || 0;
      let firstFail = Infinity;
      if (mtbf > 0 && mttr > 0) {
        let u = rnd();
        while (u <= 1e-9) u = rnd();
        firstFail = -mtbf * Math.log(u);
      }
      return {
        queue: [],
        busyJob: null,
        busyUntil: Infinity,
        blockedJob: null,
        downUntil: Infinity,
        nextFailureAt: firstFail,
        busyTime: 0,
        blockedTime: 0,
        downTime: 0,
        queueArea: 0,
        waitTimeSum: 0,
        waitCount: 0,
        maxQueueLen: 0,
        processedJobs: 0,
      };
    });

    let t = 0;
    let nextArrival = sampleInterarrival(rnd, meanInterarrivalMin, arrivalCv);
    let nextJobId = 1;
    let wip = 0;
    let wipArea = 0;
    let completed = 0;
    let cycleSum = 0;
    let cycleCount = 0;

    // Sample trace on first replication
    const traceInterval = Math.max(15, Math.round(shiftMinutes / 24));
    let nextSampleAt = warmupMinutes + traceInterval;
    const timeline: Array<{ minute: number; wip: number; completedPerHour: number }> = [];

    const accumulateIntervals = (prevT: number, newT: number) => {
      if (newT <= warmupMinutes) return;
      const startObs = Math.max(prevT, warmupMinutes);
      const dt = newT - startObs;
      if (dt <= 0) return;

      wipArea += wip * dt;
      for (let i = 0; i < nStations; i++) {
        const st = states[i];
        if (st.downUntil < Infinity) {
          st.downTime += dt;
        } else if (st.blockedJob) {
          st.blockedTime += dt;
        } else if (st.busyJob) {
          st.busyTime += dt;
        }
        st.queueArea += st.queue.length * dt;
      }
    };

    const canAcceptJob = (idx: number): boolean => {
      if (idx >= nStations) return true;
      const cap = stationsIn[idx].bufferCapacity ?? Infinity;
      return states[idx].queue.length < cap;
    };

    const tryStartStation = (idx: number, now: number) => {
      const st = states[idx];
      const spec = stationsIn[idx];
      if (st.busyJob || st.blockedJob || st.downUntil < Infinity) return;
      if (!st.queue.length) return;
      const job = st.queue.shift()!;
      if (now >= warmupMinutes) {
        st.waitTimeSum += now - Math.max(job.enteredQueueAt, warmupMinutes);
        st.waitCount++;
      }
      st.busyJob = job;
      const svc = samplePositiveDuration(rnd, spec.meanTimeMin, spec.cv ?? 0.18, dist);
      st.busyUntil = now + svc;
    };

    const pushDownstream = (idx: number, now: number) => {
      // Try clearing upstream blocked jobs from downstream back to upstream
      for (let i = idx; i >= 0; i--) {
        const st = states[i];
        if (!st.blockedJob) continue;
        if (i === nStations - 1 || canAcceptJob(i + 1)) {
          const job = st.blockedJob;
          st.blockedJob = null;
          if (i === nStations - 1) {
            wip = Math.max(0, wip - 1);
            if (now >= warmupMinutes) {
              completed++;
              cycleSum += now - job.arrivalTime;
              cycleCount++;
            }
          } else {
            job.enteredQueueAt = now;
            states[i + 1].queue.push(job);
            if (now >= warmupMinutes) {
              states[i + 1].maxQueueLen = Math.max(states[i + 1].maxQueueLen, states[i + 1].queue.length);
            }
            tryStartStation(i + 1, now);
          }
          tryStartStation(i, now);
        }
      }
    };

    let guard = 0;
    const maxEvents = 500000;
    while (t < totalSimTime && guard++ < maxEvents) {
      let nextT = Math.min(totalSimTime, nextArrival);
      let kind: 'end' | 'arrival' | 'finish' | 'fail' | 'repair' = nextArrival <= totalSimTime ? 'arrival' : 'end';
      let targetIdx = -1;

      for (let i = 0; i < nStations; i++) {
        const st = states[i];
        if (st.busyUntil < nextT) {
          nextT = st.busyUntil;
          kind = 'finish';
          targetIdx = i;
        }
        if (st.nextFailureAt < nextT) {
          nextT = st.nextFailureAt;
          kind = 'fail';
          targetIdx = i;
        }
        if (st.downUntil < nextT) {
          nextT = st.downUntil;
          kind = 'repair';
          targetIdx = i;
        }
      }

      accumulateIntervals(t, nextT);
      t = nextT;

      if (rep === 0 && t >= nextSampleAt) {
        while (nextSampleAt <= t && nextSampleAt <= totalSimTime) {
          const elapsedHrs = Math.max(1 / 60, (nextSampleAt - warmupMinutes) / 60);
          timeline.push({
            minute: Math.round(nextSampleAt - warmupMinutes),
            wip,
            completedPerHour: Number((completed / elapsedHrs).toFixed(2)),
          });
          nextSampleAt += traceInterval;
        }
      }

      if (kind === 'end' || t >= totalSimTime) break;

      if (kind === 'arrival') {
        const job: Job = { id: nextJobId++, arrivalTime: t, enteredQueueAt: t };
        // Line entry queue 0 accepts arrivals (if station 0 buffer is full, job enters queue 0 wait area for open-shop arrivals)
        states[0].queue.push(job);
        wip++;
        if (t >= warmupMinutes) {
          states[0].maxQueueLen = Math.max(states[0].maxQueueLen, states[0].queue.length);
        }
        tryStartStation(0, t);
        nextArrival = t + sampleInterarrival(rnd, meanInterarrivalMin, arrivalCv);
      } else if (kind === 'finish') {
        const st = states[targetIdx];
        const job = st.busyJob!;
        st.busyJob = null;
        st.busyUntil = Infinity;
        if (t >= warmupMinutes) st.processedJobs++;

        if (targetIdx === nStations - 1) {
          wip = Math.max(0, wip - 1);
          if (t >= warmupMinutes) {
            completed++;
            cycleSum += t - job.arrivalTime;
            cycleCount++;
          }
          tryStartStation(targetIdx, t);
          pushDownstream(targetIdx - 1, t);
        } else if (canAcceptJob(targetIdx + 1)) {
          job.enteredQueueAt = t;
          states[targetIdx + 1].queue.push(job);
          if (t >= warmupMinutes) {
            states[targetIdx + 1].maxQueueLen = Math.max(
              states[targetIdx + 1].maxQueueLen,
              states[targetIdx + 1].queue.length
            );
          }
          tryStartStation(targetIdx + 1, t);
          tryStartStation(targetIdx, t);
          pushDownstream(targetIdx - 1, t);
        } else {
          st.blockedJob = job;
        }
      } else if (kind === 'fail') {
        const st = states[targetIdx];
        const spec = stationsIn[targetIdx];
        const mttr = Number(spec.mttrMin) || 5;
        let u = rnd();
        while (u <= 1e-9) u = rnd();
        const repairDur = Math.max(0.5, -mttr * Math.log(u));
        // Freeze remaining service time by pushing busyUntil out by repairDur
        if (st.busyJob && Number.isFinite(st.busyUntil)) {
          st.busyUntil += repairDur;
        }
        st.downUntil = t + repairDur;
        st.nextFailureAt = Infinity;
      } else if (kind === 'repair') {
        const st = states[targetIdx];
        const spec = stationsIn[targetIdx];
        const mtbf = Number(spec.mtbfMin) || 0;
        st.downUntil = Infinity;
        if (mtbf > 0) {
          let u = rnd();
          while (u <= 1e-9) u = rnd();
          st.nextFailureAt = t + -mtbf * Math.log(u);
        }
        tryStartStation(targetIdx, t);
      }
    }

    const obsHours = shiftMinutes / 60;
    repThroughputs.push(completed / obsHours);
    repCycleTimes.push(cycleCount > 0 ? cycleSum / cycleCount : 0);
    repWips.push(wipArea / shiftMinutes);
    repCompleted.push(completed);

    for (let i = 0; i < nStations; i++) {
      aggBusy[i] += states[i].busyTime;
      aggBlocked[i] += states[i].blockedTime;
      aggDown[i] += states[i].downTime;
      aggQueueArea[i] += states[i].queueArea;
      aggWaitSum[i] += states[i].waitTimeSum;
      aggWaitCount[i] += states[i].waitCount;
      aggMaxQ[i] = Math.max(aggMaxQ[i], states[i].maxQueueLen);
      aggProcessed[i] += states[i].processedJobs;
    }

    if (rep === 0) sampleTimeline = timeline;
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
  const sd = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const m = avg(arr);
    return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
  };

  const effectiveThroughputPerHour = avg(repThroughputs);
  const avgCycleTimeMin = avg(repCycleTimes);
  const avgWip = avg(repWips);
  const littlesLawExpectedWip = (effectiveThroughputPerHour / 60) * avgCycleTimeMin;
  const littlesLawGapPct =
    avgWip > 1e-6 ? (Math.abs(avgWip - littlesLawExpectedWip) / avgWip) * 100 : 0;

  const denom = shiftMinutes * reps;
  const rawStations: StationSimTelemetry[] = stationsIn.map((spec, i) => {
    const busyPct = (aggBusy[i] / denom) * 100;
    const blockedPct = (aggBlocked[i] / denom) * 100;
    const downPct = (aggDown[i] / denom) * 100;
    const utilizationPct = Math.min(100, busyPct);
    const starvedPct = Math.max(0, 100 - busyPct - blockedPct - downPct);
    const availFactor =
      spec.mtbfMin && spec.mttrMin && spec.mtbfMin > 0
        ? (spec.mtbfMin + spec.mttrMin) / spec.mtbfMin
        : 1;
    return {
      index: i,
      id: spec.id,
      name: spec.name,
      meanTimeMin: spec.meanTimeMin,
      effectiveMeanMin: spec.meanTimeMin * availFactor,
      utilizationPct,
      busyPct,
      blockedPct,
      starvedPct,
      downPct,
      avgQueueLen: aggQueueArea[i] / denom,
      maxQueueLen: aggMaxQ[i],
      avgWaitMin: aggWaitCount[i] > 0 ? aggWaitSum[i] / aggWaitCount[i] : 0,
      processedJobs: Math.round(aggProcessed[i] / reps),
      isBottleneck: false,
    };
  });

  let bnIdx = 0;
  for (let i = 1; i < rawStations.length; i++) {
    const scoreI = rawStations[i].busyPct + rawStations[i].downPct * 0.5;
    const scoreBn = rawStations[bnIdx].busyPct + rawStations[bnIdx].downPct * 0.5;
    if (
      scoreI > scoreBn ||
      (Math.abs(scoreI - scoreBn) < 0.05 && rawStations[i].effectiveMeanMin > rawStations[bnIdx].effectiveMeanMin)
    ) {
      bnIdx = i;
    }
  }
  rawStations[bnIdx].isBottleneck = true;

  const slowestEffCycleMin = Math.max(...rawStations.map((s) => s.effectiveMeanMin));
  const theoreticalMaxThroughputPerHour = slowestEffCycleMin > 0 ? 60 / slowestEffCycleMin : 0;
  const lineEfficiencyPct =
    theoreticalMaxThroughputPerHour > 0
      ? Math.min(100, (effectiveThroughputPerHour / theoreticalMaxThroughputPerHour) * 100)
      : 0;

  return {
    valid: true,
    reason: '',
    replications: reps,
    shiftMinutes,
    warmupMinutes,
    arrivalRatePerHour: arrivalRate,
    effectiveThroughputPerHour,
    throughputSd: sd(repThroughputs),
    theoreticalMaxThroughputPerHour,
    lineEfficiencyPct,
    avgCycleTimeMin,
    cycleTimeSd: sd(repCycleTimes),
    avgWip,
    littlesLawExpectedWip,
    littlesLawGapPct,
    totalCompletedJobs: Math.round(avg(repCompleted)),
    bottleneckIndex: bnIdx,
    bottleneckName: rawStations[bnIdx].name,
    bottleneckUtilPct: rawStations[bnIdx].utilizationPct,
    stations: rawStations,
    timeline: sampleTimeline,
  };
}
