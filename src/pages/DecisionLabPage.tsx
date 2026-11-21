import React, { useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { LineChart } from '../components/charts/Charts';
import { AssumptionPanel, Button, Field, Input, Panel, SegmentedControl, Select, StatCard } from '../components/ui/Primitives';
import { fmtInt, fmtMoney, fmtNum } from '../engine/formatters';
import {
  DemandDistributionInput,
  inventoryOptimizer,
  LeadTimeModelInput,
  queueCurveExtended,
  queueMeckley,
  queueMG1,
  simulateMonteCarlo,
} from '../engine/inventory';
import { newsvendor, newsvendorProfit } from '../engine/ipe';
import { compareAlgorithms } from '../engine/linebal';
import { ProductionStationInput, ServiceDistType, simulateProductionLine, stationsFromLineBalance } from '../engine/prodsim';
import { useStore } from '../store/StoreContext';

export const DecisionLabPage: React.FC = () => {
  const { lineBalance } = useStore();
  const [lab, setLab] = useState<'mc' | 'newsvendor' | 'queue' | 'prodsim'>('mc');

  // Monte Carlo (Q, R)
  const [Q, setQ] = useState(280);
  const [R, setR] = useState(145);
  const [dType, setDType] = useState<'normal' | 'poisson' | 'lognormal' | 'gamma' | 'constant'>('normal');
  const [dMean, setDMean] = useState(12);
  const [dSd, setDSd] = useState(4);
  const [ltType, setLtType] = useState<'deterministic' | 'normal' | 'gamma'>('normal');
  const [ltMean, setLtMean] = useState(8);
  const [ltSd, setLtSd] = useState(2);
  const [unitCost, setUnitCost] = useState(22);
  const [orderCost, setOrderCost] = useState(60);
  const [holdingRate] = useState(20);
  const [shortageCost, setShortageCost] = useState(6);
  const [reps, setReps] = useState(120);
  const [seed, setSeed] = useState(42);
  const [optResult, setOptResult] = useState<ReturnType<typeof inventoryOptimizer> | null>(null);
  const [optimizing, setOptimizing] = useState(false);

  // Newsvendor
  const [nvPrice, setNvPrice] = useState(45);
  const [nvCost, setNvCost] = useState(22);
  const [nvSalvage, setNvSalvage] = useState(8);
  const [nvMean, setNvMean] = useState(250);
  const [nvSd, setNvSd] = useState(55);

  // Queueing
  const [qModel, setQModel] = useState<'mmc' | 'mmck' | 'mg1'>('mmc');
  const [qLambda, setQLambda] = useState(18);
  const [qMu, setQMu] = useState(8);
  const [qServers, setQServers] = useState(3);
  const [qCap, setQCap] = useState(12);
  const [qScv2, setQScv2] = useState(1.2);

  // Production Line DES
  const [desArrivalRate, setDesArrivalRate] = useState<number>(5.4);
  const [desArrivalCv, setDesArrivalCv] = useState<number>(0.6);
  const [desServiceDist, setDesServiceDist] = useState<ServiceDistType>('lognormal');
  const [desServiceCv, setDesServiceCv] = useState<number>(0.18);
  const [desBufferCap, setDesBufferCap] = useState<number>(6);
  const [desMtbf, setDesMtbf] = useState<number>(180);
  const [desMttr, setDesMttr] = useState<number>(8);
  const [desShiftMin, setDesShiftMin] = useState<number>(480);
  const [desWarmupMin, setDesWarmupMin] = useState<number>(60);
  const [desReps, setDesReps] = useState<number>(20);
  const [desSeed, setDesSeed] = useState<number>(42);
  const [desCustomStations, setDesCustomStations] = useState<ProductionStationInput[] | null>(null);

  const demandCfg = useMemo<DemandDistributionInput>(() => {
    if (dType === 'poisson') return { type: 'poisson', mean: dMean };
    if (dType === 'constant') return { type: 'constant', mean: dMean };
    if (dType === 'lognormal') {
      const v = Math.max(0.01, (dSd / Math.max(0.1, dMean)) ** 2);
      const sdLog = Math.sqrt(Math.log(1 + v));
      const meanLog = Math.log(Math.max(0.1, dMean)) - (sdLog * sdLog) / 2;
      return { type: 'lognormal', meanLog, sdLog };
    }
    if (dType === 'gamma') {
      const k = (dMean / Math.max(0.1, dSd)) ** 2;
      const scale = (dSd * dSd) / Math.max(0.1, dMean);
      return { type: 'gamma', shape: k, scale };
    }
    return { type: 'normal', mean: dMean, sd: dSd };
  }, [dType, dMean, dSd]);

  const ltCfg = useMemo<LeadTimeModelInput>(() => {
    if (ltType === 'deterministic') return { type: 'deterministic', mean: ltMean };
    if (ltType === 'gamma') {
      const k = (ltMean / Math.max(0.1, ltSd)) ** 2;
      const scale = (ltSd * ltSd) / Math.max(0.1, ltMean);
      return { type: 'gamma', shape: k, scale };
    }
    return { type: 'normal', mean: ltMean, sd: ltSd };
  }, [ltType, ltMean, ltSd]);

  const mcRes = useMemo(
    () =>
      simulateMonteCarlo({
        Q,
        R,
        days: 180,
        unitCost,
        holdingRate,
        orderCost,
        shortageCost,
        replications: reps,
        seed,
        demand: demandCfg,
        leadTime: ltCfg,
      }),
    [Q, R, unitCost, holdingRate, orderCost, shortageCost, reps, seed, demandCfg, ltCfg]
  );

  const runOptimizer = () => {
    setOptimizing(true);
    setTimeout(() => {
      try {
        const res = inventoryOptimizer(
          {
            days: 180,
            unitCost,
            holdingRate,
            orderCost,
            shortageCost,
            demand: demandCfg,
            leadTime: ltCfg,
          },
          'minCost',
          { replications: Math.max(10, Math.min(reps, 120)), seed }
        );
        setOptResult(res);
        if (res.valid && res.best) {
          setQ(res.best.Q);
          setR(res.best.R);
        }
      } finally {
        setOptimizing(false);
      }
    }, 16);
  };

  const nvRes = useMemo(
    () => newsvendor({ price: nvPrice, cost: nvCost, salvage: nvSalvage, mean: nvMean, sd: nvSd }),
    [nvPrice, nvCost, nvSalvage, nvMean, nvSd]
  );

  const nvCurve = useMemo(() => {
    if (!nvRes.valid) return { labels: [], profit: [] };
    const lo = Math.max(10, Math.round(nvMean - 2.5 * nvSd));
    const hi = Math.round(nvMean + 2.5 * nvSd);
    const steps = 28;
    const labels: string[] = [];
    const profit: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const q = lo + ((hi - lo) * i) / steps;
      labels.push(String(Math.round(q)));
      profit.push(newsvendorProfit(q, { price: nvPrice, cost: nvCost, salvage: nvSalvage, mean: nvMean, sd: nvSd }));
    }
    return { labels, profit };
  }, [nvRes.valid, nvPrice, nvCost, nvSalvage, nvMean, nvSd]);

  const qRes = useMemo(() => {
    if (qModel === 'mg1') return queueMG1({ lambda: qLambda, mu: qMu, scv2: qScv2 });
    return queueMeckley({
      lambda: qLambda,
      mu: qMu,
      servers: qServers,
      capacity: qModel === 'mmck' ? qCap : Infinity,
    });
  }, [qModel, qLambda, qMu, qServers, qCap, qScv2]);

  const qCurve = useMemo(
    () =>
      queueCurveExtended({
        mu: qMu,
        servers: qModel === 'mg1' ? 1 : qServers,
        capacity: qModel === 'mmck' ? qCap : Infinity,
        scv2: qModel === 'mg1' ? qScv2 : undefined,
        steps: 25,
      }),
    [qModel, qMu, qServers, qCap, qScv2]
  );

  const syncedLineStations = useMemo<ProductionStationInput[]>(() => {
    const cmp = compareAlgorithms({
      tasks: lineBalance.tasks,
      cycleTime: lineBalance.cycleTime,
      algorithms: ['rpw', 'lcr', 'kw', 'comsoal', 'exact'],
    });
    const algo = lineBalance.selectedAlgo === 'comsail' ? 'comsoal' : lineBalance.selectedAlgo;
    const sol = cmp.algorithms[algo] || cmp.best || cmp.algorithms.exact || cmp.algorithms.rpw;
    return stationsFromLineBalance(sol, {
      cv: desServiceCv,
      bufferCapacity: desBufferCap,
      mtbfMin: desMtbf,
      mttrMin: desMttr,
    });
  }, [lineBalance, desServiceCv, desBufferCap, desMtbf, desMttr]);

  const syncFromLineBalance = () => {
    setDesCustomStations(null);
    const nominal = 60 / Math.max(1, lineBalance.cycleTime);
    setDesArrivalRate(Number((nominal * 0.9).toFixed(2)));
  };

  const activeDesStations = useMemo<ProductionStationInput[]>(() => {
    const base = desCustomStations || syncedLineStations;
    return base.map((st) => ({
      ...st,
      cv: desServiceCv,
      bufferCapacity: desBufferCap,
      mtbfMin: desMtbf,
      mttrMin: desMttr,
    }));
  }, [desCustomStations, syncedLineStations, desServiceCv, desBufferCap, desMtbf, desMttr]);

  const desRes = useMemo(
    () =>
      simulateProductionLine({
        stations: activeDesStations,
        arrivalRatePerHour: desArrivalRate,
        arrivalCv: desArrivalCv,
        shiftMinutes: desShiftMin,
        warmupMinutes: desWarmupMin,
        replications: desReps,
        seed: desSeed,
        serviceDist: desServiceDist,
      }),
    [activeDesStations, desArrivalRate, desArrivalCv, desShiftMin, desWarmupMin, desReps, desSeed, desServiceDist]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={lab}
          onChange={(v) => setLab(v as typeof lab)}
          options={[
            { value: 'mc', label: 'Monte Carlo (Q,R) & Optimizer' },
            { value: 'prodsim', label: 'Production DES' },
            { value: 'newsvendor', label: 'Newsvendor' },
            { value: 'queue', label: 'Queueing Lab (M/M/c, M/M/c/K, M/G/1)' },
          ]}
        />
      </div>

      {/* Monte Carlo (Q,R) */}
      {lab === 'mc' && (
        <>
          <Panel
            title="Stochastic (Q, R) simulation & grid optimizer"
            subtitle="Multi-replication discrete-day inventory dynamics with non-normal demand & stochastic lead time"
            actions={
              <Button size="sm" variant="primary" onClick={runOptimizer} disabled={optimizing}>
                <Sparkles className="h-3.5 w-3.5" /> {optimizing ? 'Optimizing…' : 'Run Grid Optimizer'}
              </Button>
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Field label="Order qty (Q)">
                <Input type="number" min="1" value={Q} onChange={(e) => setQ(Number(e.target.value))} />
              </Field>
              <Field label="Reorder point (R)">
                <Input type="number" min="0" value={R} onChange={(e) => setR(Number(e.target.value))} />
              </Field>
              <Field label="Demand distribution">
                <Select value={dType} onChange={(e) => setDType(e.target.value as typeof dType)}>
                  <option value="normal">Normal</option>
                  <option value="poisson">Poisson</option>
                  <option value="lognormal">Lognormal</option>
                  <option value="gamma">Gamma</option>
                  <option value="constant">Constant</option>
                </Select>
              </Field>
              <Field label="Daily demand μ">
                <Input type="number" min="0.5" step="0.5" value={dMean} onChange={(e) => setDMean(Number(e.target.value))} />
              </Field>
              <Field label="Demand σ">
                <Input type="number" min="0" step="0.5" value={dSd} onChange={(e) => setDSd(Number(e.target.value))} disabled={dType === 'poisson' || dType === 'constant'} />
              </Field>
              <Field label="Lead-time model">
                <Select value={ltType} onChange={(e) => setLtType(e.target.value as typeof ltType)}>
                  <option value="normal">Normal</option>
                  <option value="gamma">Gamma</option>
                  <option value="deterministic">Deterministic</option>
                </Select>
              </Field>
              <Field label="Lead time μ (d)">
                <Input type="number" min="0" value={ltMean} onChange={(e) => setLtMean(Number(e.target.value))} />
              </Field>
              <Field label="Lead time σ (d)">
                <Input type="number" min="0" step="0.5" value={ltSd} onChange={(e) => setLtSd(Number(e.target.value))} disabled={ltType === 'deterministic'} />
              </Field>
              <Field label="Unit cost ($)">
                <Input type="number" min="0.1" step="0.5" value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value))} />
              </Field>
              <Field label="Order cost ($)">
                <Input type="number" min="0" value={orderCost} onChange={(e) => setOrderCost(Number(e.target.value))} />
              </Field>
              <Field label="Shortage ($/day)">
                <Input type="number" min="0" step="0.5" value={shortageCost} onChange={(e) => setShortageCost(Number(e.target.value))} />
              </Field>
              <Field label="Replications / Seed">
                <div className="grid grid-cols-2 gap-1.5">
                  <Input type="number" min="10" max="500" value={reps} onChange={(e) => setReps(Number(e.target.value))} />
                  <Input type="number" min="1" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
                </div>
              </Field>
            </div>
          </Panel>

          {!mcRes.valid ? (
            <Panel title="Invalid simulation setup">
              <p className="text-xs text-rose-600">{mcRes.reason}</p>
            </Panel>
          ) : (
            <>
              {mcRes.truncationWarning && (
                <div
                  role="alert"
                  className="rounded-lg border border-amber-300/70 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{mcRes.truncationWarning}</span>
                </div>
              )}

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <StatCard
                  label="Fill rate (95% CI)"
                  value={`${fmtNum(mcRes.fillRate, 1)}%`}
                  sub={`CI [${fmtNum(mcRes.fillRateCI95[0], 1)}%, ${fmtNum(mcRes.fillRateCI95[1], 1)}%] · ${reps} reps`}
                  tone={mcRes.fillRate >= 95 ? 'good' : mcRes.fillRate >= 90 ? 'warn' : 'bad'}
                />
                <StatCard
                  label="Cycle / Period service"
                  value={`${fmtNum(mcRes.cycleService, 1)}%`}
                  sub={`Period ${fmtNum(mcRes.periodService, 1)}% · ${fmtNum(mcRes.stockoutDays, 1)} stockout days`}
                />
                <StatCard
                  label="180-day total cost"
                  value={fmtMoney(mcRes.totalCost)}
                  sub={`Hold ${fmtMoney(mcRes.holdingCost)} · Ord ${fmtMoney(mcRes.orderingCost)} · Short ${fmtMoney(mcRes.shortageCost)}`}
                />
                <StatCard
                  label="Avg inventory & pipeline"
                  value={`${fmtNum(mcRes.avgInventory, 0)} units`}
                  sub={`${fmtNum(mcRes.orders, 1)} orders · Avg ${fmtNum(mcRes.avgOrdersInPipeline, 2)} in flight`}
                />
              </div>

              {optResult?.valid && optResult.best && (
                <Panel
                  title={`Grid optimizer solution: Q* = ${fmtInt(optResult.best.Q)}, R* = ${fmtInt(optResult.best.R)}`}
                  subtitle={`Tested ${optResult.grid.length} (Q, R) combinations · Minimum expected 180-day cost ${fmtMoney(optResult.best.totalCost)} (${fmtNum(optResult.best.fillRate, 1)}% fill rate)`}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono">
                    {optResult.grid
                      .slice()
                      .sort((a, b) => a.totalCost - b.totalCost)
                      .slice(0, 5)
                      .map((g, i) => (
                        <button
                          key={`${g.Q}-${g.R}`}
                          type="button"
                          onClick={() => {
                            setQ(g.Q);
                            setR(g.R);
                          }}
                          className={`p-2.5 rounded border text-left cursor-pointer ${
                            i === 0
                              ? 'border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/30'
                              : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="font-semibold">
                            #{i + 1} ({g.Q}, {g.R})
                          </div>
                          <div className="text-slate-500 mt-0.5">{fmtMoney(g.totalCost)}</div>
                          <div className="text-[11px] text-slate-400">Fill {fmtNum(g.fillRate, 1)}%</div>
                        </button>
                      ))}
                  </div>
                </Panel>
              )}

              <Panel title="Sample replication stock & backlog trajectory (180 days)" subtitle={`${mcRes.demandDist.label} · ${mcRes.leadTimeModel.label}`}>
                <LineChart
                  labels={mcRes.series.stock.map((_, i) => `D${i + 1}`)}
                  height={250}
                  yMinZero
                  referenceLines={[{ value: R, label: `ROP (${R})`, color: '#f59e0b' }]}
                  series={[
                    { name: 'On-hand stock', data: mcRes.series.stock, color: '#2563eb', area: true },
                    { name: 'Backlog', data: mcRes.series.backlog, color: '#ef4444' },
                  ]}
                />
              </Panel>
            </>
          )}
        </>
      )}

      {/* Newsvendor */}
      {lab === 'newsvendor' && (
        <>
          <Panel title="Single-period Newsvendor model" subtitle="Balances underage opportunity margin (p − c) against overage salvage loss (c − v)">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Field label="Selling price ($)">
                <Input type="number" min="0.1" step="0.5" value={nvPrice} onChange={(e) => setNvPrice(Number(e.target.value))} />
              </Field>
              <Field label="Unit cost ($)">
                <Input type="number" min="0.1" step="0.5" value={nvCost} onChange={(e) => setNvCost(Number(e.target.value))} />
              </Field>
              <Field label="Salvage value ($)">
                <Input type="number" min="0" step="0.5" value={nvSalvage} onChange={(e) => setNvSalvage(Number(e.target.value))} />
              </Field>
              <Field label="Mean demand μ">
                <Input type="number" min="1" value={nvMean} onChange={(e) => setNvMean(Number(e.target.value))} />
              </Field>
              <Field label="Demand σ">
                <Input type="number" min="0.5" value={nvSd} onChange={(e) => setNvSd(Number(e.target.value))} />
              </Field>
            </div>
          </Panel>

          {!nvRes.valid ? (
            <Panel title="Invalid Newsvendor inputs">
              <p className="text-xs text-rose-600">{nvRes.reason}</p>
            </Panel>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <StatCard label="Optimal order qty Q*" value={fmtInt(nvRes.Q)} sub={`z = ${fmtNum(nvRes.z, 2)}`} tone="good" />
                <StatCard label="Critical ratio" value={fmtNum(nvRes.criticalRatio, 3)} sub={`Cu $${fmtNum(nvRes.cu, 2)} / Co $${fmtNum(nvRes.co, 2)}`} />
                <StatCard label="Expected profit" value={fmtMoney(nvRes.expectedProfit)} sub={`Expected sold ${fmtNum(nvRes.expectedSold, 1)}`} tone="good" />
                <StatCard label="Leftover / Shortage" value={`${fmtNum(nvRes.expectedLeftover, 1)} / ${fmtNum(nvRes.expectedShortage, 1)}`} sub={`Cycle service ${fmtNum(nvRes.cycleService, 1)}%`} />
              </div>

              <Panel title="Expected profit curve vs order quantity Q" subtitle={`Peak profit at Q* = ${fmtInt(nvRes.Q)}`}>
                <LineChart
                  labels={nvCurve.labels}
                  height={240}
                  formatValue={(v) => fmtMoney(v)}
                  series={[{ name: 'Expected profit', data: nvCurve.profit, color: '#10b981', area: true }]}
                />
              </Panel>
            </>
          )}
        </>
      )}

      {/* Queueing Lab */}
      {lab === 'queue' && (
        <>
          <Panel title="Service & workstation queueing calculator" subtitle="Exact Erlang-C (M/M/c), finite-buffer blocking (M/M/c/K), and Pollaczek–Khinchine (M/G/1)">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Field label="Queueing model">
                <Select value={qModel} onChange={(e) => setQModel(e.target.value as typeof qModel)}>
                  <option value="mmc">M/M/c (Erlang-C)</option>
                  <option value="mmck">M/M/c/K (Finite buffer)</option>
                  <option value="mg1">M/G/1 (General service)</option>
                </Select>
              </Field>
              <Field label="Arrival rate λ (/hr)">
                <Input type="number" min="0.1" step="0.5" value={qLambda} onChange={(e) => setQLambda(Number(e.target.value))} />
              </Field>
              <Field label="Service rate μ (/hr)">
                <Input type="number" min="0.1" step="0.5" value={qMu} onChange={(e) => setQMu(Number(e.target.value))} />
              </Field>
              {qModel !== 'mg1' ? (
                <Field label="Servers (c)">
                  <Input type="number" min="1" max="50" value={qServers} onChange={(e) => setQServers(Math.max(1, Number(e.target.value) || 1))} />
                </Field>
              ) : (
                <Field label="Service SCV²">
                  <Input type="number" min="0" step="0.1" value={qScv2} onChange={(e) => setQScv2(Number(e.target.value))} />
                </Field>
              )}
              {qModel === 'mmck' && (
                <Field label="System capacity (K)">
                  <Input type="number" min={qServers} value={qCap} onChange={(e) => setQCap(Math.max(qServers, Number(e.target.value) || qServers))} />
                </Field>
              )}
            </div>
          </Panel>

          {!qRes.valid ? (
            <Panel title="Queueing state invalid">
              <p className="text-xs text-rose-600">{qRes.reason}</p>
            </Panel>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <StatCard
                  label="Server utilization (ρ)"
                  value={`${fmtNum(qRes.utilPct, 1)}%`}
                  sub={`P₀ = ${fmtNum(qRes.p0 * 100, 1)}% idle`}
                  tone={qRes.utilPct < 85 ? 'good' : 'warn'}
                />
                <StatCard label="Avg queue length (Lq)" value={`${fmtNum(qRes.Lq, 2)} jobs`} sub={`In system L = ${fmtNum(qRes.L, 2)}`} />
                <StatCard label="Avg queue wait (Wq)" value={`${fmtNum(qRes.Wq * 60, 1)} min`} sub={`Total time W = ${fmtNum(qRes.W * 60, 1)} min`} />
                <StatCard
                  label={qModel === 'mmck' ? 'Blocking probability' : 'Wait probability'}
                  value={qModel === 'mmck' ? `${fmtNum(qRes.pBlock * 100, 2)}%` : `${fmtNum(qRes.pWait * 100, 1)}%`}
                  sub={`Effective λ = ${fmtNum(qRes.lambdaEff, 2)} /hr`}
                />
              </div>

              <Panel title="Congestion scaling: queue wait time (Wq) vs server utilization (ρ)" subtitle="Non-linear hockey-stick queue growth above 80% utilization">
                <LineChart
                  labels={qCurve.map((pt) => `${Math.round(pt.rho)}%`)}
                  height={230}
                  yMinZero
                  series={[{ name: 'Mean wait Wq (hrs)', data: qCurve.map((pt) => pt.wq), color: '#f59e0b', area: true }]}
                />
              </Panel>
            </>
          )}
        </>
      )}

      {/* Production Line DES */}
      {lab === 'prodsim' && (
        <>
          <Panel
            title="Discrete-Event Production Line Simulation (DES)"
            subtitle="Multi-stage serial flow with finite buffers (blocking/starvation), stochastic cycle times, MTBF/MTTR failures, and Little's Law verification"
            actions={
              <Button size="sm" variant="secondary" onClick={syncFromLineBalance}>
                <RefreshCw className="h-3.5 w-3.5" /> Sync from Line Balance ({syncedLineStations.length} stations)
              </Button>
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Field label="Arrival rate (/hr)">
                <Input type="number" min="0.5" step="0.2" value={desArrivalRate} onChange={(e) => setDesArrivalRate(Number(e.target.value))} />
              </Field>
              <Field label="Arrival CV">
                <Input type="number" min="0" max="2" step="0.1" value={desArrivalCv} onChange={(e) => setDesArrivalCv(Number(e.target.value))} />
              </Field>
              <Field label="Service distribution">
                <Select value={desServiceDist} onChange={(e) => setDesServiceDist(e.target.value as ServiceDistType)}>
                  <option value="lognormal">Lognormal</option>
                  <option value="normal">Normal (truncated)</option>
                  <option value="exponential">Exponential</option>
                  <option value="constant">Constant</option>
                </Select>
              </Field>
              <Field label="Service CV">
                <Input
                  type="number"
                  min="0"
                  max="1.5"
                  step="0.02"
                  value={desServiceCv}
                  disabled={desServiceDist === 'constant' || desServiceDist === 'exponential'}
                  onChange={(e) => setDesServiceCv(Number(e.target.value))}
                />
              </Field>
              <Field label="Inter-station buffer">
                <Input type="number" min="0" max="50" value={desBufferCap} onChange={(e) => setDesBufferCap(Math.max(0, Number(e.target.value) || 0))} />
              </Field>
              <Field label="Replications / Seed">
                <div className="grid grid-cols-2 gap-1.5">
                  <Input type="number" min="1" max="100" value={desReps} onChange={(e) => setDesReps(Number(e.target.value))} />
                  <Input type="number" min="1" value={desSeed} onChange={(e) => setDesSeed(Number(e.target.value))} />
                </div>
              </Field>
              <Field label="MTBF (min, 0=none)">
                <Input type="number" min="0" step="10" value={desMtbf} onChange={(e) => setDesMtbf(Math.max(0, Number(e.target.value) || 0))} />
              </Field>
              <Field label="MTTR (min)">
                <Input type="number" min="0" step="1" value={desMttr} disabled={desMtbf <= 0} onChange={(e) => setDesMttr(Math.max(0, Number(e.target.value) || 0))} />
              </Field>
              <Field label="Shift length (min)">
                <Input type="number" min="60" max="4800" step="30" value={desShiftMin} onChange={(e) => setDesShiftMin(Number(e.target.value))} />
              </Field>
              <Field label="Warmup (min)">
                <Input type="number" min="0" max="600" step="15" value={desWarmupMin} onChange={(e) => setDesWarmupMin(Number(e.target.value))} />
              </Field>
            </div>
          </Panel>

          {!desRes.valid ? (
            <Panel title="Invalid DES configuration">
              <p className="text-xs text-rose-600">{desRes.reason}</p>
            </Panel>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <StatCard
                  label="Effective throughput"
                  value={`${fmtNum(desRes.effectiveThroughputPerHour, 2)} /hr`}
                  sub={`Theoretical max ${fmtNum(desRes.theoreticalMaxThroughputPerHour, 2)}/hr (${fmtNum(desRes.lineEfficiencyPct, 1)}% eff)`}
                  tone={desRes.lineEfficiencyPct >= 85 ? 'good' : 'warn'}
                />
                <StatCard
                  label="Avg flow cycle time & WIP"
                  value={`${fmtNum(desRes.avgCycleTimeMin, 1)} min`}
                  sub={`Avg WIP ${fmtNum(desRes.avgWip, 2)} jobs · Completed ${fmtNum(desRes.totalCompletedJobs, 1)}`}
                />
                <StatCard
                  label="Little's Law check (L = λW)"
                  value={`${fmtNum(desRes.littlesLawGapPct, 2)}% gap`}
                  sub={`Expected WIP ${fmtNum(desRes.littlesLawExpectedWip, 2)} vs observed ${fmtNum(desRes.avgWip, 2)}`}
                  tone={desRes.littlesLawGapPct <= 5 ? 'good' : 'warn'}
                />
                <StatCard
                  label="Line bottleneck"
                  value={desRes.bottleneckName}
                  sub={`${fmtNum(desRes.bottleneckUtilPct, 1)}% busy+blocked+down util`}
                  tone={desRes.bottleneckUtilPct >= 90 ? 'bad' : 'warn'}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <Panel
                  title="Per-station blocking, starvation & queue telemetry"
                  subtitle={`${desRes.replications} replications · Station times in minutes`}
                  className="lg:col-span-7"
                >
                  <div className="overflow-x-auto -mx-4 px-4">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                          <th className="pb-2 font-medium">Station</th>
                          <th className="pb-2 font-medium text-right">Mean</th>
                          <th className="pb-2 font-medium text-right">Busy</th>
                          <th className="pb-2 font-medium text-right">Blocked</th>
                          <th className="pb-2 font-medium text-right">Starved</th>
                          <th className="pb-2 font-medium text-right">Down</th>
                          <th className="pb-2 font-medium text-right">Avg Q</th>
                          <th className="pb-2 font-medium text-right">Max Q</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {desRes.stations.map((st) => (
                          <tr
                            key={st.id}
                            className={st.isBottleneck ? 'bg-rose-50/60 dark:bg-rose-950/25 font-medium' : ''}
                          >
                            <td className="py-2 pr-2">
                              <span className="text-slate-900 dark:text-slate-100">{st.name}</span>
                              {st.isBottleneck && (
                                <span className="ml-1.5 text-[10px] font-mono text-rose-600 dark:text-rose-400">
                                  BOTTLENECK
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-2 text-right font-mono tabular-nums">{fmtNum(st.meanTimeMin, 1)}m</td>
                            <td className="py-2 pr-2 text-right font-mono tabular-nums">{fmtNum(st.busyPct, 1)}%</td>
                            <td className="py-2 pr-2 text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">
                              {fmtNum(st.blockedPct, 1)}%
                            </td>
                            <td className="py-2 pr-2 text-right font-mono tabular-nums text-slate-500">
                              {fmtNum(st.starvedPct, 1)}%
                            </td>
                            <td className="py-2 pr-2 text-right font-mono tabular-nums text-rose-500">
                              {fmtNum(st.downPct, 1)}%
                            </td>
                            <td className="py-2 pr-2 text-right font-mono tabular-nums">{fmtNum(st.avgQueueLen, 2)}</td>
                            <td className="py-2 text-right font-mono tabular-nums">{fmtNum(st.maxQueueLen, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>

                <Panel
                  title="Replication #1 WIP & throughput trace"
                  subtitle="Cumulative jobs/hr and active WIP over post-warmup shift"
                  className="lg:col-span-5"
                >
                  <LineChart
                    labels={desRes.timeline.map((pt) => `${Math.round(pt.minute)}m`)}
                    height={230}
                    yMinZero
                    series={[
                      { name: 'Active WIP (jobs)', data: desRes.timeline.map((pt) => pt.wip), color: '#2563eb', area: true },
                      {
                        name: 'Throughput (/hr)',
                        data: desRes.timeline.map((pt) => pt.completedPerHour),
                        color: '#10b981',
                      },
                    ]}
                  />
                </Panel>
              </div>
            </>
          )}
        </>
      )}

      <AssumptionPanel topicId="decision-lab" />
    </div>
  );
};
