/**
 * Assembly Line Balancing optimization laboratory.
 * 5 algorithms (RPW, LCR, K&W, COMSOAL, Exact Branch & Bound) + 6 textbook benchmarks.
 * Pure TypeScript, zero DOM dependencies.
 */

export interface LineBalTaskInput {
  id: string;
  name?: string;
  time: number;
  successors?: string[];
}

export interface AnalyzedTask {
  id: string;
  name: string;
  time: number;
  successors: string[];
  predecessorIds: string[];
  positionalWeight: number;
  level: number;
}

export interface GraphAnalysis {
  tasks: AnalyzedTask[];
  byId: Record<string, AnalyzedTask>;
  roots: AnalyzedTask[];
  sinks: AnalyzedTask[];
  levels: Record<string, number>;
  positionalWeights: Record<string, number>;
  hasCycle: boolean;
  cycleTasks: string[];
  missingSuccessors: string[];
  totalTime: number;
  taskCount: number;
}

export interface StationResult {
  index: number;
  taskIds: string[];
  tasks: AnalyzedTask[];
  taskCount: number;
  used: number;
  idle: number;
  time: number;
  utilization: number;
  capacity: number;
}

export interface LineBalanceSolution {
  valid: boolean;
  inputsOk: boolean;
  reason: string;
  algorithm: string;
  label?: string;
  exact: boolean;
  timedOut?: boolean;
  infeasible?: boolean;
  nodesExplored: number;
  trials?: number;
  trial?: number;
  optimal?: boolean;
  cycleTime: number;
  totalTime: number;
  theoreticalMin: number;
  stationCount: number | null;
  stations: StationResult[];
  stationOf?: Record<string, number>;
  efficiency: number | null;
  balanceDelay: number | null;
  idle?: number[];
  minIdle?: number | null;
  maxIdle?: number | null;
  avgIdle?: number | null;
  smoothnessIndex?: number | null;
  bottleneck?: StationResult | null;
  prodCapacity?: number | null;
  utilizations?: number[];
  stationTimes?: number[];
  gapToTheoretical?: number | null;
  graph: GraphAnalysis;
  message?: string;
}

export interface LineBalBenchmark {
  key: string;
  name: string;
  tasks: LineBalTaskInput[];
  optimalStations: number;
  defaultCycleTime: number;
  source: string;
}

function sum(a: ReadonlyArray<number>): number {
  return (Array.isArray(a) ? a : []).reduce((s, v) => s + (Number(v) || 0), 0);
}

function mean(a: ReadonlyArray<number>): number {
  return a.length ? sum(a) / a.length : 0;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function roundTo(v: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

function mulberry32(seed: number): () => number {
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneTasks(tasks: ReadonlyArray<LineBalTaskInput>): AnalyzedTask[] {
  return (Array.isArray(tasks) ? tasks : []).map((t) => ({
    id: String(t.id != null ? t.id : ''),
    name: String(t.name || t.id || ''),
    time: Math.max(0, num(t.time) || 0),
    successors: (Array.isArray(t.successors) ? t.successors : [])
      .map(String)
      .filter((s: string) => s !== String(t.id)),
    predecessorIds: [],
    positionalWeight: 0,
    level: 0,
  }));
}

export function analyzeGraph(tasks: ReadonlyArray<LineBalTaskInput>): GraphAnalysis {
  const ts = cloneTasks(tasks);
  const byId: Record<string, AnalyzedTask> = {};
  ts.forEach((t) => {
    byId[t.id] = t;
  });

  ts.forEach((t) => {
    t.predecessorIds = [];
  });
  ts.forEach((t) => {
    t.successors.forEach((s) => {
      const st = byId[s];
      if (st) st.predecessorIds.push(t.id);
    });
  });

  const ids = new Set(ts.map((t) => t.id));
  const missingSuccs = new Set<string>();
  ts.forEach((t) => {
    t.successors.forEach((s) => {
      if (!ids.has(s)) missingSuccs.add(s);
    });
  });

  const roots = ts.filter((t) => t.predecessorIds.length === 0);
  const sinks = ts.filter((t) => t.successors.length === 0);

  const level: Record<string, number> = {};
  ts.forEach((t) => {
    level[t.id] = 0;
  });
  let changed = true;
  let iter = 0;
  const maxIter = ts.length + 1;
  while (changed && iter < maxIter) {
    changed = false;
    iter++;
    for (const t of ts) {
      let best = 0;
      for (const p of t.predecessorIds) {
        if (byId[p] && level[p] != null) best = Math.max(best, level[p] + 1);
      }
      if (t.time > 0 || best > level[t.id]) {
        const nl = Math.max(level[t.id], best);
        if (nl > level[t.id] + 1e-9) {
          level[t.id] = nl;
          changed = true;
        }
      }
    }
  }

  const pw: Record<string, number> = {};
  ts.forEach((t) => {
    pw[t.id] = t.time;
  });
  for (let it = 0; it <= ts.length; it++) {
    let ch = false;
    for (const t of ts) {
      let best = 0;
      for (const s of t.successors) {
        if (byId[s] && pw[s] != null) best = Math.max(best, pw[s]);
      }
      const npw = t.time + best;
      if (npw > pw[t.id] + 1e-9) {
        pw[t.id] = npw;
        ch = true;
      }
    }
    if (!ch) break;
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  let hasCycle = false;
  const cycleTasks: string[] = [];

  function dfs(id: string) {
    if (inStack.has(id)) {
      hasCycle = true;
      return;
    }
    if (visited.has(id)) return;
    inStack.add(id);
    const t = byId[id];
    if (t) {
      for (const s of t.successors) {
        if (ids.has(s)) dfs(s);
        if (hasCycle) {
          cycleTasks.push(s);
          return;
        }
      }
    }
    inStack.delete(id);
    visited.add(id);
  }

  for (const t of ts) {
    if (!visited.has(t.id)) dfs(t.id);
    if (hasCycle) break;
  }

  ts.forEach((t) => {
    t.level = level[t.id] != null ? level[t.id] : 0;
    t.positionalWeight = pw[t.id] != null ? pw[t.id] : t.time;
  });

  return {
    tasks: ts,
    byId,
    roots,
    sinks,
    levels: level,
    positionalWeights: pw,
    hasCycle,
    cycleTasks,
    missingSuccessors: [...missingSuccs],
    totalTime: sum(ts.map((t) => t.time)),
    taskCount: ts.length,
  };
}

function makeBlankSolution(C: number, graph: GraphAnalysis, reason: string, algorithm = 'heuristic'): LineBalanceSolution {
  return {
    valid: false,
    inputsOk: true,
    reason,
    algorithm,
    exact: false,
    nodesExplored: 0,
    cycleTime: C,
    totalTime: graph.totalTime,
    theoreticalMin: graph.totalTime > 0 && C > 0 ? Math.max(1, Math.ceil(graph.totalTime / C - 1e-9)) : 0,
    stationCount: 0,
    stations: [],
    efficiency: 0,
    balanceDelay: 100,
    graph,
  };
}

interface RawStation {
  index: number;
  taskIds: string[];
  taskCount: number;
  used: number;
  idle: number;
  time: number;
  utilization: number;
}

function makeSolution(
  C: number,
  graph: GraphAnalysis,
  stationsRaw: RawStation[],
  stationOf: Record<string, number>,
  valid: boolean,
  reason: string,
  extra: Partial<LineBalanceSolution> = {}
): LineBalanceSolution {
  const totalTime = graph.totalTime;
  const stationCount = stationsRaw.length;
  const capacity = stationCount * C;
  const efficiency = capacity > 0 ? (totalTime / capacity) * 100 : 0;
  const balanceDelay = 100 - efficiency;
  const idle = stationsRaw.map((s) => C - s.time);
  const minIdle = idle.length ? Math.min(...idle) : 0;
  const maxIdle = idle.length ? Math.max(...idle) : 0;
  const avgIdle = idle.length ? mean(idle) : 0;
  const siNumerator = sum(idle.map((idl) => idl * idl));
  const siDenominator = totalTime * totalTime;
  const smoothnessIndex = siDenominator > 0 ? Math.sqrt(siNumerator / siDenominator) * 100 : 0;

  const detailedStations: StationResult[] = stationsRaw.map((s) => {
    const tasks = s.taskIds.map((id) => graph.byId[id]).filter(Boolean);
    return {
      index: s.index,
      taskIds: s.taskIds,
      tasks,
      taskCount: s.taskCount,
      used: s.used,
      idle: s.idle,
      time: s.time,
      utilization: s.utilization,
      capacity: C,
    };
  });

  const bottleneckStation = detailedStations.length
    ? detailedStations.reduce((best, s) => (s.time > best.time ? s : best), detailedStations[0])
    : null;
  const prodCapacity = C > 0 ? 3600 / C : 0;
  const utilizations = detailedStations.map((s) => (C > 0 ? (s.time / C) * 100 : 0));
  const theoreticalMin = totalTime > 0 && C > 0 ? Math.max(1, Math.ceil(totalTime / C - 1e-9)) : 0;
  const gapToTheoretical = stationCount > 0 && totalTime > 0 && C > 0 ? stationCount - theoreticalMin : 0;

  return {
    valid,
    inputsOk: true,
    reason,
    algorithm: extra.algorithm || 'heuristic',
    exact: !!extra.exact,
    nodesExplored: extra.nodesExplored || 0,
    trials: extra.trials,
    trial: extra.trial,
    optimal: extra.optimal,
    cycleTime: C,
    totalTime,
    theoreticalMin,
    stationCount,
    stations: detailedStations,
    stationOf,
    efficiency: roundTo(efficiency, 2),
    balanceDelay: roundTo(balanceDelay, 2),
    idle,
    minIdle: roundTo(minIdle, 2),
    maxIdle: roundTo(maxIdle, 2),
    avgIdle: roundTo(avgIdle, 2),
    smoothnessIndex: roundTo(smoothnessIndex, 2),
    bottleneck: bottleneckStation,
    prodCapacity: roundTo(prodCapacity, 2),
    utilizations,
    stationTimes: detailedStations.map((s) => s.time),
    gapToTheoretical,
    graph,
  };
}

export interface LineBalanceOpts {
  tasks: ReadonlyArray<LineBalTaskInput>;
  cycleTime: number;
  stationCapacity?: number;
  trials?: number;
  seed?: number | null;
  maxTimeMs?: number;
  maxTasks?: number;
}

export function lineBalanceRPW({ tasks, cycleTime, stationCapacity = Infinity }: LineBalanceOpts): LineBalanceSolution {
  const rawC = num(cycleTime);
  const graph = analyzeGraph(tasks);
  if (!(rawC > 0)) return { ...makeBlankSolution(0, graph, 'cycle time must be greater than 0', 'rpw'), inputsOk: false };
  const C = rawC;
  if (graph.hasCycle) return makeBlankSolution(C, graph, 'precedence cycle detected', 'rpw');
  if (!graph.roots.length) return makeBlankSolution(C, graph, 'no root tasks (all have predecessors)', 'rpw');
  if (graph.missingSuccessors.length) {
    return makeBlankSolution(C, graph, `missing successor references: ${graph.missingSuccessors.join(', ')}`, 'rpw');
  }
  const tooLong = graph.tasks.filter((t) => t.time > C);
  if (tooLong.length) {
    return makeBlankSolution(C, graph, `task(s) ${tooLong.map((t) => t.name).join(', ')} exceed cycle time`, 'rpw');
  }

  const order = graph.tasks.slice().sort(
    (a, b) => b.positionalWeight - a.positionalWeight || b.time - a.time || a.id.localeCompare(b.id)
  );

  const remaining = new Set(graph.tasks.map((t) => t.id));
  const assigned = new Set<string>();
  const stationOf: Record<string, number> = {};
  const stations: RawStation[] = [];

  let guard = graph.tasks.length * (graph.tasks.length + 1);
  while (remaining.size && guard-- > 0) {
    let rem = C;
    const stationTasks: string[] = [];
    let placed = true;
    while (placed) {
      placed = false;
      for (const t of order) {
        if (!remaining.has(t.id)) continue;
        if (t.time > rem + 1e-9) continue;
        if (!t.predecessorIds.every((p) => assigned.has(p))) continue;
        if (sum(stationTasks.map((id) => graph.byId[id]?.time || 0)) + t.time > stationCapacity + 1e-9) continue;
        remaining.delete(t.id);
        assigned.add(t.id);
        stationOf[t.id] = stations.length;
        stationTasks.push(t.id);
        rem -= t.time;
        placed = true;
        break;
      }
    }
    if (!stationTasks.length) break;
    const used = C - rem;
    stations.push({
      index: stations.length,
      taskIds: stationTasks,
      taskCount: stationTasks.length,
      used,
      idle: rem,
      time: used,
      utilization: C > 0 ? (used / C) * 100 : 0,
    });
  }

  const unassigned = graph.tasks.filter((t) => !assigned.has(t.id));
  const valid = unassigned.length === 0 && !graph.hasCycle;
  const reason = valid ? '' : `could not assign ${unassigned.length} task(s) — check precedence constraints`;
  return makeSolution(C, graph, stations, stationOf, valid, reason, { algorithm: 'rpw' });
}

export function lineBalanceLCR({ tasks, cycleTime, stationCapacity = Infinity }: LineBalanceOpts): LineBalanceSolution {
  const rawC = num(cycleTime);
  const graph = analyzeGraph(tasks);
  if (!(rawC > 0)) return { ...makeBlankSolution(0, graph, 'cycle time must be greater than 0', 'lcr'), inputsOk: false };
  const C = rawC;
  if (graph.hasCycle) return makeBlankSolution(C, graph, 'precedence cycle detected', 'lcr');
  if (!graph.roots.length) return makeBlankSolution(C, graph, 'no root tasks', 'lcr');
  if (graph.missingSuccessors.length) {
    return makeBlankSolution(C, graph, `missing successor references: ${graph.missingSuccessors.join(', ')}`, 'lcr');
  }
  const tooLong = graph.tasks.filter((t) => t.time > C);
  if (tooLong.length) return makeBlankSolution(C, graph, 'task(s) exceed cycle time', 'lcr');

  const remaining = new Set(graph.tasks.map((t) => t.id));
  const assigned = new Set<string>();
  const stationOf: Record<string, number> = {};
  const stations: RawStation[] = [];

  let guard = graph.tasks.length * (graph.tasks.length + 1);
  while (remaining.size && guard-- > 0) {
    let rem = C;
    const stationTasks: string[] = [];
    let placed = true;
    while (placed) {
      placed = false;
      const feasible = graph.tasks.filter(
        (t) =>
          remaining.has(t.id) &&
          t.predecessorIds.every((p) => assigned.has(p)) &&
          t.time <= rem + 1e-9 &&
          sum(stationTasks.map((id) => graph.byId[id]?.time || 0)) + t.time <= stationCapacity + 1e-9
      );
      if (!feasible.length) break;
      feasible.sort((a, b) => b.positionalWeight - a.positionalWeight || b.time - a.time || a.id.localeCompare(b.id));
      const chosen = feasible[0];
      remaining.delete(chosen.id);
      assigned.add(chosen.id);
      stationOf[chosen.id] = stations.length;
      stationTasks.push(chosen.id);
      rem -= chosen.time;
      placed = true;
    }
    if (!stationTasks.length) break;
    const used = C - rem;
    stations.push({
      index: stations.length,
      taskIds: stationTasks,
      taskCount: stationTasks.length,
      used,
      idle: rem,
      time: used,
      utilization: C > 0 ? (used / C) * 100 : 0,
    });
  }

  const unassigned = graph.tasks.filter((t) => !assigned.has(t.id));
  const valid = unassigned.length === 0 && !graph.hasCycle;
  return makeSolution(C, graph, stations, stationOf, valid, valid ? '' : 'could not assign all tasks', {
    algorithm: 'lcr',
  });
}

export function lineBalanceKW({ tasks, cycleTime, stationCapacity = Infinity }: LineBalanceOpts): LineBalanceSolution {
  const rawC = num(cycleTime);
  const graph = analyzeGraph(tasks);
  if (!(rawC > 0)) return { ...makeBlankSolution(0, graph, 'cycle time must be greater than 0', 'kw'), inputsOk: false };
  const C = rawC;
  if (graph.hasCycle) return makeBlankSolution(C, graph, 'precedence cycle detected', 'kw');
  if (!graph.roots.length) return makeBlankSolution(C, graph, 'no root tasks', 'kw');
  if (graph.missingSuccessors.length) {
    return makeBlankSolution(C, graph, `missing successor references: ${graph.missingSuccessors.join(', ')}`, 'kw');
  }
  const tooLong = graph.tasks.filter((t) => t.time > C);
  if (tooLong.length) return makeBlankSolution(C, graph, 'task(s) exceed cycle time', 'kw');

  const byLevel: Record<number, AnalyzedTask[]> = {};
  const maxLevel = Math.max(0, ...graph.tasks.map((t) => t.level));
  for (let lv = 0; lv <= maxLevel; lv++) byLevel[lv] = [];
  graph.tasks.forEach((t) => byLevel[t.level].push(t));
  for (const lv of Object.keys(byLevel)) {
    byLevel[Number(lv)].sort(
      (a, b) => b.positionalWeight - a.positionalWeight || b.time - a.time || a.id.localeCompare(b.id)
    );
  }

  const assigned = new Set<string>();
  const stationOf: Record<string, number> = {};
  const stations: RawStation[] = [];
  let currentLevel = 0;
  let guard = graph.tasks.length * (graph.tasks.length + 1);

  while (assigned.size < graph.tasks.length && guard-- > 0) {
    let rem = C;
    const stationTasks: string[] = [];
    let level = currentLevel;
    let madeProgress = true;
    let attempts = 0;
    const maxAttempts = graph.tasks.length + 1;

    while (madeProgress && attempts < maxAttempts) {
      madeProgress = false;
      attempts++;
      for (let lv = level; lv >= 0 && lv <= maxLevel; lv--) {
        const candidates = byLevel[lv].filter(
          (t) =>
            !assigned.has(t.id) &&
            t.predecessorIds.every((p) => assigned.has(p)) &&
            t.time <= rem + 1e-9 &&
            sum(stationTasks.map((id) => graph.byId[id]?.time || 0)) + t.time <= stationCapacity + 1e-9
        );
        if (candidates.length) {
          const chosen = candidates[0];
          assigned.add(chosen.id);
          stationOf[chosen.id] = stations.length;
          stationTasks.push(chosen.id);
          rem -= chosen.time;
          madeProgress = true;
          break;
        }
      }
      if (!madeProgress) {
        if (level < maxLevel) level++;
        else break;
      }
    }

    if (!stationTasks.length) break;
    const used = C - rem;
    stations.push({
      index: stations.length,
      taskIds: stationTasks,
      taskCount: stationTasks.length,
      used,
      idle: rem,
      time: used,
      utilization: C > 0 ? (used / C) * 100 : 0,
    });

    for (let lv = maxLevel; lv >= 0; lv--) {
      if (byLevel[lv].some((t) => !assigned.has(t.id))) {
        currentLevel = lv;
        break;
      }
    }
  }

  const unassigned = graph.tasks.filter((t) => !assigned.has(t.id));
  const valid = unassigned.length === 0 && !graph.hasCycle;
  return makeSolution(C, graph, stations, stationOf, valid, valid ? '' : 'could not assign all tasks', {
    algorithm: 'kw',
  });
}

export function lineBalanceCOMSOAL({
  tasks,
  cycleTime,
  stationCapacity = Infinity,
  trials = 50,
  seed = 42,
}: LineBalanceOpts): LineBalanceSolution {
  const rawC = num(cycleTime);
  const graph = analyzeGraph(tasks);
  if (!(rawC > 0)) return { ...makeBlankSolution(0, graph, 'cycle time must be greater than 0', 'comsoal'), inputsOk: false };
  const C = rawC;
  if (graph.hasCycle) return makeBlankSolution(C, graph, 'precedence cycle detected', 'comsoal');
  if (!graph.roots.length) return makeBlankSolution(C, graph, 'no root tasks', 'comsoal');
  if (graph.missingSuccessors.length) {
    return makeBlankSolution(C, graph, `missing successor references: ${graph.missingSuccessors.join(', ')}`, 'comsoal');
  }
  const tooLong = graph.tasks.filter((t) => t.time > C);
  if (tooLong.length) return makeBlankSolution(C, graph, 'task(s) exceed cycle time', 'comsoal');

  const T = Math.max(1, Math.min(500, Math.round(num(trials) || 50)));
  const rnd = seed != null ? mulberry32(seed) : mulberry32(Date.now() & 0xffffffff);

  let bestSol: {
    stations: RawStation[];
    stationOf: Record<string, number>;
    trial: number;
    optimal?: boolean;
  } | null = null;
  let bestStationCount = Infinity;

  for (let trial = 0; trial < T; trial++) {
    const assigned = new Set<string>();
    const stationOf: Record<string, number> = {};
    const stations: RawStation[] = [];
    let guard = graph.tasks.length * (graph.tasks.length + 1);

    while (assigned.size < graph.tasks.length && guard-- > 0) {
      let rem = C;
      const stationTasks: string[] = [];
      let placed = true;
      while (placed) {
        placed = false;
        const feasible = graph.tasks.filter(
          (t) =>
            !assigned.has(t.id) &&
            t.predecessorIds.every((p) => assigned.has(p)) &&
            t.time <= rem + 1e-9 &&
            sum(stationTasks.map((id) => graph.byId[id]?.time || 0)) + t.time <= stationCapacity + 1e-9
        );
        if (!feasible.length) break;
        const totalPW = sum(feasible.map((t) => t.positionalWeight + 0.01));
        let r = rnd() * totalPW;
        let chosen = feasible[0];
        for (const f of feasible) {
          r -= f.positionalWeight + 0.01;
          if (r <= 0) {
            chosen = f;
            break;
          }
        }
        assigned.add(chosen.id);
        stationOf[chosen.id] = stations.length;
        stationTasks.push(chosen.id);
        rem -= chosen.time;
        placed = true;
      }
      if (!stationTasks.length) break;
      const used = C - rem;
      stations.push({
        index: stations.length,
        taskIds: stationTasks,
        taskCount: stationTasks.length,
        used,
        idle: rem,
        time: used,
        utilization: C > 0 ? (used / C) * 100 : 0,
      });
    }

    const unassigned = graph.tasks.filter((t) => !assigned.has(t.id));
    if (unassigned.length === 0 && stations.length < bestStationCount) {
      bestStationCount = stations.length;
      bestSol = { stations, stationOf, trial: trial + 1 };
    }
    const theoreticalMin = graph.totalTime > 0 && C > 0 ? Math.max(1, Math.ceil(graph.totalTime / C - 1e-9)) : 0;
    if (stations.length === theoreticalMin && unassigned.length === 0) {
      bestSol = { stations, stationOf, trial: trial + 1, optimal: true };
      break;
    }
  }

  if (!bestSol) {
    return makeBlankSolution(C, graph, `all ${T} COMSOAL trials failed`, 'comsoal');
  }

  return makeSolution(C, graph, bestSol.stations, bestSol.stationOf, true, '', {
    algorithm: 'comsoal',
    trials: T,
    trial: bestSol.trial,
    optimal: bestSol.optimal,
  });
}

export function lineBalanceExact({
  tasks,
  cycleTime,
  stationCapacity = Infinity,
  maxTimeMs = 2000,
  maxTasks = 20,
}: LineBalanceOpts): LineBalanceSolution {
  const rawC = num(cycleTime);
  const graph = analyzeGraph(tasks);
  if (!(rawC > 0)) return { ...makeBlankSolution(0, graph, 'cycle time must be greater than 0', 'exact'), inputsOk: false };
  const C = rawC;
  if (graph.hasCycle) return makeBlankSolution(C, graph, 'precedence cycle detected', 'exact');
  if (!graph.roots.length) return makeBlankSolution(C, graph, 'no root tasks', 'exact');
  if (graph.missingSuccessors.length) {
    return makeBlankSolution(C, graph, `missing successor references: ${graph.missingSuccessors.join(', ')}`, 'exact');
  }
  const tooLong = graph.tasks.filter((t) => t.time > C);
  if (tooLong.length) return makeBlankSolution(C, graph, 'task(s) exceed cycle time', 'exact');

  const totalTime = graph.totalTime;
  const theoreticalMin = totalTime > 0 && C > 0 ? Math.max(1, Math.ceil(totalTime / C - 1e-9)) : 0;

  if (graph.tasks.length > maxTasks) {
    return {
      valid: false,
      inputsOk: true,
      reason: `Exact optimization is limited to ${maxTasks} tasks — this problem has ${graph.tasks.length} tasks.`,
      algorithm: 'exact',
      cycleTime: C,
      totalTime,
      theoreticalMin,
      stationCount: null,
      stations: [],
      efficiency: null,
      balanceDelay: null,
      exact: false,
      timedOut: false,
      infeasible: false,
      nodesExplored: 0,
      graph,
      message: 'Problem too large for exact optimization',
    };
  }

  const taskOrder = graph.tasks
    .slice()
    .sort((a, b) => a.level - b.level || b.positionalWeight - a.positionalWeight || b.time - a.time || a.id.localeCompare(b.id));

  let bestSolution: LineBalanceSolution | null = null;
  let bestStationCount = graph.tasks.length + 1;
  let nodesExplored = 0;
  const startTime = Date.now();
  let timedOut = false;

  const rpwSol = lineBalanceRPW({ tasks, cycleTime, stationCapacity });
  const lcrSol = lineBalanceLCR({ tasks, cycleTime, stationCapacity });
  const kwSol = lineBalanceKW({ tasks, cycleTime, stationCapacity });
  const comsolSol = lineBalanceCOMSOAL({ tasks, cycleTime, stationCapacity, trials: 200, seed: 42 });

  function search(stationLoads: number[], taskStation: Map<string, number>, nextTaskIdx: number) {
    nodesExplored++;
    if (Date.now() - startTime > maxTimeMs) {
      timedOut = true;
      return;
    }
    const assignedTime = sum(stationLoads);
    const remainingTime = totalTime - assignedTime;
    const currentStations = stationLoads.length;
    const openSlack = Math.max(0, currentStations * C - assignedTime);
    const extraWork = Math.max(0, remainingTime - openSlack);
    const minAdditionalStations = extraWork > 1e-9 ? Math.ceil(extraWork / C - 1e-9) : 0;
    if (currentStations + minAdditionalStations >= bestStationCount) return;

    if (nextTaskIdx >= taskOrder.length) {
      if (currentStations < bestStationCount) {
        bestStationCount = currentStations;
        const maxS = Math.max(...taskStation.values());
        const stationsRaw: RawStation[] = [];
        const stationOfObj: Record<string, number> = {};
        for (const [tid, st] of taskStation) stationOfObj[tid] = st;
        for (let s = 0; s <= maxS; s++) {
          const taskIds: string[] = [];
          for (const [taskId, station] of taskStation) {
            if (station === s) taskIds.push(taskId);
          }
          const stTime = sum(taskIds.map((id) => graph.byId[id]?.time || 0));
          stationsRaw.push({
            index: s,
            taskIds,
            taskCount: taskIds.length,
            used: stTime,
            idle: C - stTime,
            time: stTime,
            utilization: C > 0 ? (stTime / C) * 100 : 0,
          });
        }
        bestSolution = makeSolution(C, graph, stationsRaw, stationOfObj, true, '', {
          algorithm: 'exact',
          exact: true,
          nodesExplored,
        });
      }
      return;
    }

    const task = taskOrder[nextTaskIdx];
    let minStation = 0;
    for (const predId of task.predecessorIds) {
      if (taskStation.has(predId)) minStation = Math.max(minStation, taskStation.get(predId) as number);
      else return;
    }
    const maxStationToTry = Math.min(currentStations, bestStationCount - 2);
    for (let s = minStation; s <= maxStationToTry; s++) {
      const currentLoad = s < stationLoads.length ? stationLoads[s] : 0;
      if (currentLoad + task.time > C + 1e-9) continue;
      if (currentLoad + task.time > stationCapacity + 1e-9) continue;
      const newLoads = stationLoads.slice();
      if (s >= newLoads.length) newLoads.push(task.time);
      else newLoads[s] = currentLoad + task.time;
      const newTaskStation = new Map(taskStation);
      newTaskStation.set(task.id, s);
      search(newLoads, newTaskStation, nextTaskIdx + 1);
      if (bestStationCount === theoreticalMin) return;
    }
  }

  search([], new Map(), 0);

  if (bestSolution) {
    const provenOptimal = !timedOut || bestStationCount <= theoreticalMin;
    (bestSolution as LineBalanceSolution).exact = provenOptimal;
    (bestSolution as LineBalanceSolution).nodesExplored = nodesExplored;
    (bestSolution as LineBalanceSolution).timedOut = !provenOptimal;
    (bestSolution as LineBalanceSolution).infeasible = false;
    return bestSolution;
  }

  if (timedOut) {
    const bestHeuristic = [rpwSol, lcrSol, kwSol, comsolSol]
      .filter((s) => s && s.valid && s.stationCount != null)
      .sort((a, b) => (a.stationCount || Infinity) - (b.stationCount || Infinity))[0];
    return {
      valid: !!bestHeuristic,
      inputsOk: true,
      reason: `Branch-and-bound timed out after ${maxTimeMs} ms (${nodesExplored} nodes). Used best heuristic fallback.`,
      algorithm: 'exact',
      exact: false,
      timedOut: true,
      infeasible: !bestHeuristic,
      nodesExplored,
      cycleTime: C,
      totalTime,
      theoreticalMin,
      stationCount: bestHeuristic ? bestHeuristic.stationCount : null,
      stations: bestHeuristic ? bestHeuristic.stations : [],
      efficiency: bestHeuristic ? bestHeuristic.efficiency : null,
      balanceDelay: bestHeuristic ? bestHeuristic.balanceDelay : null,
      smoothnessIndex: bestHeuristic ? bestHeuristic.smoothnessIndex : null,
      minIdle: bestHeuristic ? bestHeuristic.minIdle : null,
      maxIdle: bestHeuristic ? bestHeuristic.maxIdle : null,
      avgIdle: bestHeuristic ? bestHeuristic.avgIdle : null,
      bottleneck: bestHeuristic ? bestHeuristic.bottleneck : null,
      prodCapacity: bestHeuristic ? bestHeuristic.prodCapacity : null,
      utilizations: bestHeuristic ? bestHeuristic.utilizations : [],
      stationTimes: bestHeuristic ? bestHeuristic.stationTimes : [],
      gapToTheoretical: bestHeuristic ? bestHeuristic.gapToTheoretical : null,
      graph,
    };
  }

  return makeBlankSolution(C, graph, `No feasible solution at C = ${C}`, 'exact');
}

export function compareAlgorithms({
  tasks,
  cycleTime,
  stationCapacity = Infinity,
  algorithms = ['rpw', 'lcr', 'kw', 'comsoal', 'exact'],
  exactMaxTimeMs = 2000,
}: {
  tasks: ReadonlyArray<LineBalTaskInput>;
  cycleTime: number;
  stationCapacity?: number;
  algorithms?: string[];
  exactMaxTimeMs?: number;
}) {
  const C = Math.max(1, num(cycleTime) || 0);
  const graph = analyzeGraph(tasks);
  const results: Record<string, LineBalanceSolution & { label: string }> = {};
  const normalizedAlgos = algorithms.map((a) => (a === 'comsail' ? 'comsoal' : a));

  const order: Array<{ key: string; label: string; fn: (opts: LineBalanceOpts) => LineBalanceSolution }> = [
    { key: 'rpw', label: 'Ranked Positional Weight', fn: lineBalanceRPW },
    { key: 'lcr', label: 'Largest Candidate Rule', fn: lineBalanceLCR },
    { key: 'kw', label: 'Kilbridge & Wester', fn: lineBalanceKW },
    { key: 'comsoal', label: 'COMSOAL (100 trials)', fn: lineBalanceCOMSOAL },
    { key: 'exact', label: 'Exact (Branch & Bound)', fn: lineBalanceExact },
  ];

  for (const algo of order) {
    if (!normalizedAlgos.includes(algo.key)) continue;
    const opts: LineBalanceOpts = {
      tasks,
      cycleTime: C,
      stationCapacity,
      ...(algo.key === 'comsoal' ? { trials: 100, seed: 42 } : {}),
      ...(algo.key === 'exact' ? { maxTimeMs: exactMaxTimeMs, maxTasks: 20 } : {}),
    };
    const result = algo.fn(opts);
    results[algo.key] = {
      ...result,
      label: algo.label,
      algorithm: algo.key,
    };
  }

  let best: (LineBalanceSolution & { label: string }) | null = null;
  for (const key of Object.keys(results)) {
    const r = results[key];
    if (r.valid && r.stationCount != null && r.stationCount > 0) {
      if (!best || r.stationCount < (best.stationCount || Infinity)) best = r;
    }
  }

  const theoreticalMin = graph.totalTime > 0 && C > 0 ? Math.max(1, Math.ceil(graph.totalTime / C - 1e-9)) : 0;

  return {
    problem: {
      taskCount: graph.tasks.length,
      totalTime: graph.totalTime,
      cycleTime: C,
      theoreticalMin,
      hasCycle: graph.hasCycle,
      roots: graph.roots.map((t) => t.id),
      sinks: graph.sinks.map((t) => t.id),
    },
    algorithms: results,
    best,
    theoreticalMin,
    comparison: Object.keys(results).map((key) => {
      const r = results[key];
      return {
        algorithm: key,
        label: r.label,
        valid: r.valid,
        stationCount: r.stationCount,
        efficiency: r.efficiency,
        balanceDelay: r.balanceDelay,
        smoothnessIndex: r.smoothnessIndex,
        gapToTheoretical: r.gapToTheoretical,
        minIdle: r.minIdle,
        maxIdle: r.maxIdle,
        reason: r.reason || '',
      };
    }),
  };
}

const BENCHMARKS: Record<string, LineBalBenchmark> = {
  'bosch-13': {
    key: 'bosch-13',
    name: 'Bosch 13-task assembly',
    defaultCycleTime: 10,
    optimalStations: 3,
    source: 'Textbook example (adapted)',
    tasks: [
      { id: 'A', name: 'A – Mount housing', time: 2, successors: ['B', 'C'] },
      { id: 'B', name: 'B – Install motor', time: 3, successors: ['D'] },
      { id: 'C', name: 'C – Fit shaft', time: 1, successors: ['D', 'E'] },
      { id: 'D', name: 'D – Attach gears', time: 4, successors: ['F'] },
      { id: 'E', name: 'E – Wire electronics', time: 3, successors: ['F', 'G'] },
      { id: 'F', name: 'F – Test function', time: 2, successors: ['H'] },
      { id: 'G', name: 'G – Paint housing', time: 4, successors: ['H'] },
      { id: 'H', name: 'H – Final assembly', time: 3, successors: ['I', 'J'] },
      { id: 'I', name: 'I – Pack unit', time: 2, successors: ['K'] },
      { id: 'J', name: 'J – Label unit', time: 1, successors: ['K'] },
      { id: 'K', name: 'K – Ship to warehouse', time: 2, successors: [] },
      { id: 'L', name: 'L – Prep documentation', time: 2, successors: ['M'] },
      { id: 'M', name: 'M – File report', time: 1, successors: [] },
    ],
  },
  'simple-6': {
    key: 'simple-6',
    name: 'Simple 6-task line',
    defaultCycleTime: 10,
    optimalStations: 3,
    source: 'Textbook',
    tasks: [
      { id: '1', name: 'Task 1', time: 4, successors: ['2', '3'] },
      { id: '2', name: 'Task 2', time: 6, successors: ['4'] },
      { id: '3', name: 'Task 3', time: 2, successors: ['4'] },
      { id: '4', name: 'Task 4', time: 3, successors: ['5', '6'] },
      { id: '5', name: 'Task 5', time: 5, successors: [] },
      { id: '6', name: 'Task 6', time: 3, successors: [] },
    ],
  },
  'levitt-7': {
    key: 'levitt-7',
    name: 'Levitt 7-task cell',
    defaultCycleTime: 8,
    optimalStations: 3,
    source: 'Levitt (adapted)',
    tasks: [
      { id: '1', name: '1 – Study', time: 4, successors: ['2', '3'] },
      { id: '2', name: '2 – Draft', time: 3, successors: ['4'] },
      { id: '3', name: '3 – Review', time: 2, successors: ['4'] },
      { id: '4', name: '4 – Revise', time: 3, successors: ['5', '6'] },
      { id: '5', name: '5 – Finalize doc', time: 4, successors: [] },
      { id: '6', name: '6 – Print', time: 2, successors: [] },
      { id: '7', name: '7 – Distribute', time: 1, successors: [] },
    ],
  },
  'helgeson-15': {
    key: 'helgeson-15',
    name: 'Helgeson & Birnie 15-task',
    defaultCycleTime: 8,
    optimalStations: 6,
    source: 'Helgeson & Birnie (1961), adapted',
    tasks: [
      { id: '1', name: 'Task 1', time: 2, successors: ['2', '3'] },
      { id: '2', name: 'Task 2', time: 3, successors: ['4'] },
      { id: '3', name: 'Task 3', time: 1, successors: ['4', '5'] },
      { id: '4', name: 'Task 4', time: 4, successors: ['6'] },
      { id: '5', name: 'Task 5', time: 3, successors: ['6', '7'] },
      { id: '6', name: 'Task 6', time: 2, successors: ['8'] },
      { id: '7', name: 'Task 7', time: 4, successors: ['8'] },
      { id: '8', name: 'Task 8', time: 3, successors: ['9', '10'] },
      { id: '9', name: 'Task 9', time: 2, successors: ['11'] },
      { id: '10', name: 'Task 10', time: 1, successors: ['11'] },
      { id: '11', name: 'Task 11', time: 4, successors: ['12', '13'] },
      { id: '12', name: 'Task 12', time: 3, successors: ['14'] },
      { id: '13', name: 'Task 13', time: 2, successors: ['14'] },
      { id: '14', name: 'Task 14', time: 3, successors: ['15'] },
      { id: '15', name: 'Task 15', time: 2, successors: [] },
    ],
  },
  'bartholdi-12': {
    key: 'bartholdi-12',
    name: 'Bartholdi & Gunther 12-task',
    defaultCycleTime: 10,
    optimalStations: 4,
    source: 'Bartholdi & Gunther (1992), adapted',
    tasks: [
      { id: 'A', name: 'Task A', time: 2, successors: ['B', 'C'] },
      { id: 'B', name: 'Task B', time: 3, successors: ['D'] },
      { id: 'C', name: 'Task C', time: 2, successors: ['D', 'E'] },
      { id: 'D', name: 'Task D', time: 4, successors: ['F'] },
      { id: 'E', name: 'Task E', time: 1, successors: ['F', 'G'] },
      { id: 'F', name: 'Task F', time: 3, successors: ['H'] },
      { id: 'G', name: 'Task G', time: 2, successors: ['H'] },
      { id: 'H', name: 'Task H', time: 4, successors: ['I', 'J'] },
      { id: 'I', name: 'Task I', time: 2, successors: ['K'] },
      { id: 'J', name: 'Task J', time: 1, successors: ['K'] },
      { id: 'K', name: 'Task K', time: 3, successors: ['L'] },
      { id: 'L', name: 'Task L', time: 2, successors: [] },
    ],
  },
  'large-20': {
    key: 'large-20',
    name: '20-task multi-stage line',
    defaultCycleTime: 12,
    optimalStations: 6,
    source: 'Generated benchmark',
    tasks: [
      { id: 'T1', name: 'T1 – Frame prep', time: 3, successors: ['T2', 'T3'] },
      { id: 'T2', name: 'T2 – Sub-mount A', time: 4, successors: ['T4'] },
      { id: 'T3', name: 'T3 – Sub-mount B', time: 2, successors: ['T4', 'T5'] },
      { id: 'T4', name: 'T4 – Torque bolts', time: 5, successors: ['T6'] },
      { id: 'T5', name: 'T5 – Route harness', time: 3, successors: ['T6', 'T7'] },
      { id: 'T6', name: 'T6 – Drive assembly', time: 4, successors: ['T8'] },
      { id: 'T7', name: 'T7 – Sensor fit', time: 2, successors: ['T8', 'T9'] },
      { id: 'T8', name: 'T8 – Calibration', time: 5, successors: ['T10'] },
      { id: 'T9', name: 'T9 – Seal check', time: 3, successors: ['T10'] },
      { id: 'T10', name: 'T10 – Main housing', time: 4, successors: ['T11', 'T12'] },
      { id: 'T11', name: 'T11 – Guard install', time: 3, successors: ['T13'] },
      { id: 'T12', name: 'T12 – Label plate', time: 2, successors: ['T13', 'T14'] },
      { id: 'T13', name: 'T13 – Functional run', time: 4, successors: ['T15'] },
      { id: 'T14', name: 'T14 – Safety interlock', time: 3, successors: ['T15'] },
      { id: 'T15', name: 'T15 – Final inspection', time: 5, successors: ['T16', 'T17'] },
      { id: 'T16', name: 'T16 – Accessory kit', time: 2, successors: ['T18'] },
      { id: 'T17', name: 'T17 – User manual', time: 3, successors: ['T18'] },
      { id: 'T18', name: 'T18 – Carton seal', time: 4, successors: ['T19', 'T20'] },
      { id: 'T19', name: 'T19 – Palletize', time: 2, successors: [] },
      { id: 'T20', name: 'T20 – Manifest scan', time: 3, successors: [] },
    ],
  },
};

export function getBenchmark(name: string): LineBalBenchmark | null {
  return BENCHMARKS[name] || null;
}

export function listBenchmarks(): LineBalBenchmark[] {
  return Object.values(BENCHMARKS);
}

export function taskAllocationTable(solution: LineBalanceSolution | null) {
  if (!solution || !solution.stations) return [];
  const rows: Array<{
    taskId: string;
    taskName: string;
    station: number;
    stationIndex: number;
    startTime: number;
    time: number;
    endTime: number;
    predecessors: string[];
    successors: string[];
    level: number;
    positionalWeight: number;
  }> = [];
  for (const station of solution.stations) {
    let currentTime = 0;
    for (const task of station.tasks) {
      rows.push({
        taskId: task.id,
        taskName: task.name,
        station: station.index + 1,
        stationIndex: station.index,
        startTime: currentTime,
        time: task.time,
        endTime: currentTime + task.time,
        predecessors: task.predecessorIds,
        successors: task.successors,
        level: task.level,
        positionalWeight: task.positionalWeight,
      });
      currentTime += task.time;
    }
  }
  return rows;
}

export function nextUniqueTaskId(tasks: ReadonlyArray<Pick<LineBalTaskInput, 'id'>>): string {
  const existing = new Set(tasks.map((t) => String(t.id || '').trim().toUpperCase()));
  let maxNum = 0;
  existing.forEach((id) => {
    const m = /^T(\d+)$/.exec(id);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  });
  let candidateNum = Math.max(tasks.length + 1, maxNum + 1);
  while (existing.has(`T${candidateNum}`)) {
    candidateNum++;
  }
  return `T${candidateNum}`;
}

export function clampTaskDuration(v: number | string, fallback = 2): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0.5, Math.min(1000, n));
}
