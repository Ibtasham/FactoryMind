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
          <Field
            label="Target cycle time (C)"
            error={
              !comparison.problem.hasCycle && !activeSolution?.valid
                ? activeSolution?.reason || 'Must be ≥ longest individual task time.'
                : undefined
            }
          >
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

        {/* Mobile Editable Task Cards (320px–767px) */}
        <div className="md:hidden space-y-2.5 max-h-80 overflow-y-auto pr-0.5">
          {tasks.map((t, idx) => (
            <div
              key={t.id + idx}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Task {t.id}
                </span>
                <button
                  type="button"
                  disabled={tasks.length <= 2}
                  aria-label={`Remove task ${t.id}`}
                  onClick={() =>
                    setTasks((prev) =>
                      prev
                        .filter((_, i) => i !== idx)
                        .map((item) => ({
                          ...item,
                          successors: (item.successors || []).filter(
                            (succ) => succ.trim().toUpperCase() !== t.id.trim().toUpperCase()
                          ),
                        }))
                    )
                  }
                  className="p-1.5 rounded text-rose-600 dark:text-rose-400 disabled:opacity-30 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <Field label="Description">
                <Input
                  value={t.name || t.id}
                  aria-label={`Task ${t.id} description`}
                  className="font-sans"
                  onChange={(e) => {
                    const v = e.target.value;
                    setTasks((prev) => prev.map((x, i) => (i === idx ? { ...x, name: v } : x)));
                  }}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Time">
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
                </Field>
                <Field label="Successors">
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
                </Field>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop Editable Task Table */}
        <div className="hidden md:block overflow-x-auto -mx-4 px-4 max-h-60 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-600 dark:text-slate-300">
                <th scope="col" className="pb-2 font-medium">ID</th>
                <th scope="col" className="pb-2 font-medium">Task description</th>
                <th scope="col" className="pb-2 font-medium w-24">Time</th>
                <th scope="col" className="pb-2 font-medium">Successors (comma-separated)</th>
                <th scope="col" className="pb-2 font-medium text-right">Remove</th>
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
                      onClick={() =>
                        setTasks((prev) =>
                          prev
                            .filter((_, i) => i !== idx)
                            .map((item) => ({
                              ...item,
                              successors: (item.successors || []).filter(
                                (succ) => succ.trim().toUpperCase() !== t.id.trim().toUpperCase()
                              ),
                            }))
                        )
                      }
                      className="p-1.5 text-rose-600 dark:text-rose-400 disabled:opacity-30 cursor-pointer"
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
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
          termKey="smoothnessIndex"
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
          <div className="md:hidden space-y-2">
            {comparison.comparison.map((row) => {
              const selected = row.algorithm === selectedAlgo;
              return (
                <button
                  key={row.algorithm}
                  type="button"
                  onClick={() => setLineBalance({ ...lineBalance, selectedAlgo: row.algorithm })}
                  className={`w-full text-left rounded-lg border p-3 space-y-1.5 cursor-pointer ${
                    selected
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    <span>{row.label}</span>
                    <span className="font-mono">{row.stationCount ?? '—'} stns</span>
                  </div>
                  {!row.valid && <p className="text-[11px] text-rose-600 dark:text-rose-400">{row.reason}</p>}
                  <div className="grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums pt-1 border-t border-slate-200/70 dark:border-slate-800">
                    <div>
                      <span className="block font-sans text-slate-600 dark:text-slate-300">Efficiency</span>
                      <span>{row.efficiency != null ? `${fmtNum(row.efficiency, 1)}%` : '—'}</span>
                    </div>
                    <div>
                      <span className="block font-sans text-slate-600 dark:text-slate-300">Delay</span>
                      <span>{row.balanceDelay != null ? `${fmtNum(row.balanceDelay, 1)}%` : '—'}</span>
                    </div>
                    <div>
                      <span className="block font-sans text-slate-600 dark:text-slate-300">Smoothness</span>
                      <span>{row.smoothnessIndex != null ? fmtNum(row.smoothnessIndex, 2) : '—'}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="hidden md:block overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-600 dark:text-slate-300">
                  <th scope="col" className="pb-2 font-medium">Algorithm</th>
                  <th scope="col" className="pb-2 font-medium text-right">Stations</th>
                  <th scope="col" className="pb-2 font-medium text-right">Efficiency</th>
                  <th scope="col" className="pb-2 font-medium text-right">Delay</th>
                  <th scope="col" className="pb-2 font-medium text-right">Smoothness</th>
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
                        {!row.valid && <span className="ml-2 text-rose-600 dark:text-rose-400 text-[11px]">({row.reason})</span>}
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
          <div className="md:hidden space-y-2">
            {allocRows.map((r) => (
              <div
                key={r.taskId}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 p-2.5 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    <span className="font-mono text-[var(--accent)] mr-1.5">S{r.station}</span>
                    {r.taskName}
                  </div>
                  <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    {fmtNum(r.startTime, 1)} → {fmtNum(r.endTime, 1)} · PW {fmtNum(r.positionalWeight, 1)}
                  </div>
                </div>
                <span className="font-mono font-semibold shrink-0">{fmtNum(r.time, 1)}s</span>
              </div>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-600 dark:text-slate-300">
                  <th scope="col" className="pb-2 font-medium">Station</th>
                  <th scope="col" className="pb-2 font-medium">Task</th>
                  <th scope="col" className="pb-2 font-medium text-right">Start</th>
                  <th scope="col" className="pb-2 font-medium text-right">Duration</th>
                  <th scope="col" className="pb-2 font-medium text-right">Finish</th>
                  <th scope="col" className="pb-2 font-medium text-right">Positional weight</th>
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
                    <td className="py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">{fmtNum(r.positionalWeight, 1)}</td>
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
