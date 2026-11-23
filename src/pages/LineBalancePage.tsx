import React, { useMemo } from 'react';
import { AlertTriangle, Factory, Plus, Trash2 } from 'lucide-react';
import { BarChart } from '../components/charts/Charts';
import { RouteId } from '../components/layout/AppShell';
import { Button, Field, Input, Panel, Select, StatCard } from '../components/ui/Primitives';
import { clampNumericInput, fmtNum } from '../engine/formatters';
import {
  clampTaskDuration,
  compareAlgorithms,
  getBenchmark,
  LineBalTaskInput,
  listBenchmarks,
  nextUniqueTaskId,
  taskAllocationTable,
} from '../engine/linebal';
import { useStore } from '../store/StoreContext';

export const LineBalancePage: React.FC<{ onNavigate?: (r: RouteId) => void }> = ({ onNavigate }) => {
  const { lineBalance, setLineBalance } = useStore();
  const benchmarks = useMemo(() => listBenchmarks(), []);

  const presetKey = lineBalance.benchmarkKey || benchmarks[0].key;
  const cycleTime = lineBalance.cycleTime || benchmarks[0].defaultCycleTime;
  const tasks = lineBalance.tasks;
  const selectedAlgo = lineBalance.selectedAlgo === 'comsail' ? 'comsoal' : lineBalance.selectedAlgo || 'exact';

  const loadPreset = (key: string) => {
    const b = getBenchmark(key);
    if (b) {
      setLineBalance({
        benchmarkKey: key,
        cycleTime: b.defaultCycleTime,
        tasks: b.tasks.map((t) => ({ ...t, successors: [...(t.successors || [])] })),
        selectedAlgo,
      });
    }
  };

  const setTasks = (updater: (prev: LineBalTaskInput[]) => LineBalTaskInput[]) => {
    setLineBalance({
      ...lineBalance,
      tasks: updater(tasks),
    });
  };

  const comparison = useMemo(
    () =>
      compareAlgorithms({
        tasks,
        cycleTime,
        algorithms: ['rpw', 'lcr', 'kw', 'comsoal', 'exact'],
        exactMaxTimeMs: 1200,
      }),
    [tasks, cycleTime]
  );

  const activeSolution = useMemo(
    () => comparison.algorithms[selectedAlgo] || comparison.best || Object.values(comparison.algorithms)[0],
    [comparison, selectedAlgo]
  );

  const allocRows = useMemo(() => taskAllocationTable(activeSolution || null), [activeSolution]);

  const addTask = () => {
    const nextId = nextUniqueTaskId(tasks);
    setTasks((prev) => [...prev, { id: nextId, name: `${nextId} – New task`, time: 2, successors: [] }]);
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Precedence network & cycle time"
        subtitle="Compare 5 assembly line balancing algorithms side-by-side · Synced to 3D Plant Twin, DES & Reports"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {onNavigate && (
              <Button size="sm" variant="primary" onClick={() => onNavigate('factory-sim')}>
                <Factory className="h-3.5 w-3.5" /> Simulate in Factory Lab
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={addTask}>
              <Plus className="h-3.5 w-3.5" /> Add task
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Field label="Benchmark dataset">
            <Select value={presetKey} onChange={(e) => loadPreset(e.target.value)}>
              {benchmarks.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.name} (opt {b.optimalStations} stn @ C={b.defaultCycleTime})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target cycle time (C)">
            <Input
              type="number"
              min="1"
              max="1000"
              step="0.5"
              value={cycleTime}
              onChange={(e) =>
                setLineBalance({
                  ...lineBalance,
                  cycleTime: clampNumericInput(e.target.value, cycleTime, 1, 1000),
                })
              }
            />
          </Field>
          <Field label="Inspect algorithm schedule">
            <Select
              value={selectedAlgo}
              onChange={(e) => setLineBalance({ ...lineBalance, selectedAlgo: e.target.value })}
            >
              {Object.entries(comparison.algorithms).map(([k, sol]) => (
                <option key={k} value={k}>
                  {sol.label} ({sol.stationCount ?? '—'} stations)
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {(comparison.problem.hasCycle || !activeSolution?.valid) && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-rose-300/70 dark:border-rose-800/70 bg-rose-50/80 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {comparison.problem.hasCycle
                ? 'Precedence network contains a dependency cycle — remove circular successors to compute valid stations.'
                : activeSolution?.reason || 'Target cycle time C is smaller than the longest task duration.'}
            </span>
          </div>
        )}

        <div className="overflow-x-auto -mx-4 px-4 max-h-60 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                <th className="pb-2 font-medium">ID</th>
                <th className="pb-2 font-medium">Task description</th>
                <th className="pb-2 font-medium w-24">Time</th>
                <th className="pb-2 font-medium">Successors (comma-separated)</th>
                <th className="pb-2 font-medium text-right">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {tasks.map((t, idx) => (
                <tr key={t.id + idx}>
                  <td className="py-1.5 pr-2 font-mono font-medium">{t.id}</td>
                  <td className="py-1.5 pr-2">
                    <Input
                      value={t.name || t.id}
                      aria-label={`Task ${t.id} description`}
                      className="font-sans"
                      onChange={(e) => {
                        const v = e.target.value;
                        setTasks((prev) => prev.map((x, i) => (i === idx ? { ...x, name: v } : x)));
                      }}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input
                      type="number"
                      min="0.5"
                      max="1000"
                      step="0.5"
                      value={t.time}
                      aria-label={`Task ${t.id} duration`}
                      onChange={(e) => {
                        const v = clampTaskDuration(e.target.value, t.time);
                        setTasks((prev) => prev.map((x, i) => (i === idx ? { ...x, time: v } : x)));
                      }}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input
                      value={(t.successors || []).join(', ')}
                      aria-label={`Task ${t.id} successors`}
                      onChange={(e) => {
                        const arr = e.target.value
                          .split(/[\s,]+/)
                          .map((s) => s.trim())
                          .filter(Boolean);
                        setTasks((prev) => prev.map((x, i) => (i === idx ? { ...x, successors: arr } : x)));
                      }}
                    />
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      disabled={tasks.length <= 2}
                      aria-label={`Remove task ${t.id}`}
                      onClick={() => setTasks((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1 text-rose-500 disabled:opacity-30 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Active Solution KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          label="Workstations required"
          value={activeSolution?.stationCount != null ? String(activeSolution.stationCount) : 'Infeasible'}
          sub={`Theoretical min ⌈${fmtNum(comparison.problem.totalTime, 1)} / ${cycleTime}⌉ = ${comparison.theoreticalMin}`}
          tone={activeSolution?.valid ? 'good' : 'bad'}
        />
        <StatCard
          label="Line efficiency"
          value={activeSolution?.efficiency != null ? `${fmtNum(activeSolution.efficiency, 1)}%` : '—'}
          sub={`Balance delay ${activeSolution?.balanceDelay != null ? `${fmtNum(activeSolution.balanceDelay, 1)}%` : '—'}`}
        />
        <StatCard
          label="Smoothness index"
          value={activeSolution?.smoothnessIndex != null ? fmtNum(activeSolution.smoothnessIndex, 2) : '—'}
          sub={`Avg station idle ${fmtNum(activeSolution?.avgIdle || 0, 2)}`}
        />
        <StatCard
          label="Hourly line output"
          value={activeSolution?.prodCapacity != null ? `${fmtNum(activeSolution.prodCapacity, 1)} /hr` : '—'}
          sub={`${tasks.length} tasks · Total work ${fmtNum(comparison.problem.totalTime, 1)}s`}
        />
      </div>

      {/* Algorithm Comparison + Workstation Load Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Panel title="5-algorithm benchmark comparison" subtitle="Click any row to inspect its workstation assignment" className="lg:col-span-7">
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                  <th className="pb-2 font-medium">Algorithm</th>
                  <th className="pb-2 font-medium text-right">Stations</th>
                  <th className="pb-2 font-medium text-right">Efficiency</th>
                  <th className="pb-2 font-medium text-right">Delay</th>
                  <th className="pb-2 font-medium text-right">Smoothness</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {comparison.comparison.map((row) => {
                  const selected = row.algorithm === selectedAlgo;
                  return (
                    <tr
                      key={row.algorithm}
                      onClick={() => setLineBalance({ ...lineBalance, selectedAlgo: row.algorithm })}
                      className={`cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                        selected ? 'bg-[var(--accent-soft)] font-medium' : ''
                      }`}
                    >
                      <td className="py-2.5 pr-3 text-slate-900 dark:text-slate-100">
                        {row.label}
                        {!row.valid && <span className="ml-2 text-rose-500 text-[11px]">({row.reason})</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{row.stationCount ?? '—'}</td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                        {row.efficiency != null ? `${fmtNum(row.efficiency, 1)}%` : '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                        {row.balanceDelay != null ? `${fmtNum(row.balanceDelay, 1)}%` : '—'}
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums">
                        {row.smoothnessIndex != null ? fmtNum(row.smoothnessIndex, 2) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title={`Station utilization (${activeSolution?.label || ''})`}
          subtitle={`Target cycle time C = ${cycleTime}`}
          className="lg:col-span-5"
        >
          <BarChart
            horizontal
            labels={(activeSolution?.stations || []).map((s) => `Station ${s.index + 1} (${s.taskIds.join(', ')})`)}
            series={[{ name: 'Load', data: (activeSolution?.stations || []).map((s) => s.time) }]}
            formatValue={(v) => `${fmtNum(v, 1)} / ${cycleTime} (${fmtNum((v / cycleTime) * 100, 0)}%)`}
          />
        </Panel>
      </div>

      {/* Station Allocation Detail */}
      {allocRows.length > 0 && (
        <Panel title="Task-to-workstation schedule" subtitle="Ordered execution sequence inside each workstation">
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                  <th className="pb-2 font-medium">Station</th>
                  <th className="pb-2 font-medium">Task</th>
                  <th className="pb-2 font-medium text-right">Start</th>
                  <th className="pb-2 font-medium text-right">Duration</th>
                  <th className="pb-2 font-medium text-right">Finish</th>
                  <th className="pb-2 font-medium text-right">Positional weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {allocRows.map((r) => (
                  <tr key={r.taskId}>
                    <td className="py-2 pr-3 font-mono font-medium">S{r.station}</td>
                    <td className="py-2 pr-3">{r.taskName}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtNum(r.startTime, 1)}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtNum(r.time, 1)}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtNum(r.endTime, 1)}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-slate-500">{fmtNum(r.positionalWeight, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
};
