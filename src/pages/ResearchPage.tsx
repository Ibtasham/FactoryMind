import React, { useMemo, useState } from 'react';
import { Download, Play } from 'lucide-react';
import { BarChart } from '../components/charts/Charts';
import { Button, downloadFile, Input, Panel, StatCard } from '../components/ui/Primitives';
import {
  compareMethods,
  crostonMethod,
  emaMethod,
  generateDemandDataset,
  holtLinear,
  hwAdditive,
  hwMultiplicative,
  linregMethod,
  MethodSpec,
  sbaMethod,
  seasonalNaive,
  smaMethod,
  wmaMethod,
} from '../engine/forecast';
import { fmtNum } from '../engine/formatters';
import { useStore } from '../store/StoreContext';

export const ResearchPage: React.FC = () => {
  const { products } = useStore();
  const [seed, setSeed] = useState(42);
  const [horizon, setHorizon] = useState(2);

  const buildSpecs = (len: number): MethodSpec[] => {
    const p = Math.min(12, Math.max(2, Math.floor(len / 2)));
    return [
      { name: 'SMA (w=3)', shortKey: 'sma', method: smaMethod, params: { w: 3 } },
      { name: 'WMA (w=3)', shortKey: 'wma', method: wmaMethod, params: { w: 3 } },
      { name: 'SES (α=0.3)', shortKey: 'ema', method: emaMethod, params: { alpha: 0.3 } },
      { name: 'Holt Linear', shortKey: 'holt', method: holtLinear, params: { alpha: 0.3, beta: 0.1 } },
      { name: 'Holt-Winters Add', shortKey: 'hwa', method: hwAdditive, params: { alpha: 0.3, beta: 0.1, gamma: 0.2, seasonPeriod: p } },
      { name: 'Holt-Winters Mult', shortKey: 'hwm', method: hwMultiplicative, params: { alpha: 0.3, beta: 0.1, gamma: 0.2, seasonPeriod: p } },
      { name: 'Seasonal Naive', shortKey: 'sn', method: seasonalNaive, params: { period: p } },
      { name: 'Linear Trend', shortKey: 'lin', method: linregMethod },
      { name: 'Croston', shortKey: 'croston', method: crostonMethod, params: { alpha: 0.3 } },
      { name: 'SBA', shortKey: 'sba', method: sbaMethod, params: { alpha: 0.3 } },
    ];
  };

  const benchmark = useMemo(() => {
    const eligible = products.filter((p) => p.demandHistory.length >= 6);
    const perSku = eligible.map((p) => {
      const specs = buildSpecs(p.demandHistory.length);
      const cmp = compareMethods(p.demandHistory, specs, {
        horizon,
        minTrainSize: Math.min(6, Math.max(3, Math.floor(p.demandHistory.length / 2))),
      });
      return { p, best: cmp.best, methods: cmp.methods };
    });

    const synthPatterns: Array<'stationary' | 'trend' | 'seasonal' | 'intermittent' | 'structural-break'> = [
      'stationary',
      'trend',
      'seasonal',
      'intermittent',
      'structural-break',
    ];
    const synthSpecs = buildSpecs(36);
    const perSynth = synthPatterns.map((pat) => {
      const ds = generateDemandDataset(pat, { n: 36, base: 120, noise: 9, seed });
      const cmp = compareMethods(ds.history, synthSpecs, { horizon: 3, minTrainSize: 12 });
      return { pattern: pat, best: cmp.best, methods: cmp.methods };
    });

    const agg: Record<string, { name: string; wapes: number[]; rmses: number[]; maes: number[]; wins: number }> = {};
    [...perSku, ...perSynth].forEach((row) => {
      row.methods.forEach((m) => {
        if (!agg[m.name]) agg[m.name] = { name: m.name, wapes: [], rmses: [], maes: [], wins: 0 };
        if (m.metrics.wape != null) agg[m.name].wapes.push(m.metrics.wape);
        if (m.metrics.rmse != null) agg[m.name].rmses.push(m.metrics.rmse);
        if (m.metrics.mae != null) agg[m.name].maes.push(m.metrics.mae);
      });
      if (row.best && agg[row.best.name]) {
        agg[row.best.name].wins++;
      }
    });

    const summaryRows = Object.values(agg)
      .map((a) => ({
        name: a.name,
        avgWape: a.wapes.length ? a.wapes.reduce((s, x) => s + x, 0) / a.wapes.length : Infinity,
        avgRmse: a.rmses.length ? a.rmses.reduce((s, x) => s + x, 0) / a.rmses.length : Infinity,
        avgMae: a.maes.length ? a.maes.reduce((s, x) => s + x, 0) / a.maes.length : Infinity,
        wins: a.wins,
      }))
      .sort((a, b) => a.avgWape - b.avgWape);

    return { perSku, perSynth, summaryRows };
  }, [products, horizon, seed]);

  const exportJSON = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      seed,
      horizon,
      skuCount: benchmark.perSku.length,
      syntheticSuites: benchmark.perSynth.map((s) => ({
        pattern: s.pattern,
        winner: s.best?.name,
        wape: s.best?.metrics.wape,
      })),
      leaderboard: benchmark.summaryRows,
    };
    downloadFile('factorymind-research-benchmark.json', JSON.stringify(payload, null, 2), 'application/json');
  };

  const exportMarkdown = () => {
    const lines = [
      '# FactoryMind Forecasting Benchmark Report',
      '',
      `- Seed: ${seed}`,
      `- Horizon: ${horizon}`,
      `- Catalogue SKUs tested: ${benchmark.perSku.length}`,
      `- Synthetic suites tested: ${benchmark.perSynth.length}`,
      '',
      '| Method | Avg WAPE (%) | Avg RMSE | Avg MAE | Series Wins |',
      '|---|---:|---:|---:|---:|',
      ...benchmark.summaryRows.map(
        (r) =>
          `| ${r.name} | ${Number.isFinite(r.avgWape) ? r.avgWape.toFixed(2) : '—'} | ${Number.isFinite(r.avgRmse) ? r.avgRmse.toFixed(2) : '—'} | ${Number.isFinite(r.avgMae) ? r.avgMae.toFixed(2) : '—'} | ${r.wins} |`
      ),
    ];
    downloadFile('factorymind-research-benchmark.md', lines.join('\n'), 'text/markdown');
  };

  const topMethod = benchmark.summaryRows[0];

  return (
    <div className="space-y-4">
      <Panel
        title="Cross-catalogue reproducible benchmark suite"
        subtitle="Evaluates all 12 forecasting models across your active catalogue SKUs plus 5 canonical demand regimes"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={exportMarkdown}>
              <Download className="h-3.5 w-3.5" /> Export Markdown
            </Button>
            <Button size="sm" variant="primary" onClick={exportJSON}>
              <Download className="h-3.5 w-3.5" /> Export JSON
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl">
          <div>
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">PRNG Seed</div>
            <Input type="number" min="1" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 42)} />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">SKU backtest horizon</div>
            <Input type="number" min="1" max="4" value={horizon} onChange={(e) => setHorizon(Math.max(1, Number(e.target.value) || 2))} />
          </div>
          <div className="col-span-2 flex items-end">
            <Button variant="secondary" onClick={() => setSeed((s) => s + 1)}>
              <Play className="h-3.5 w-3.5" /> Resample synthetic suite (Seed {seed + 1})
            </Button>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard label="Series benchmarked" value={String(benchmark.perSku.length + benchmark.perSynth.length)} sub={`${benchmark.perSku.length} catalogue + 5 synthetic`} />
        <StatCard label="Lowest average WAPE" value={topMethod ? topMethod.name : '—'} sub={topMethod ? `${fmtNum(topMethod.avgWape, 1)}% avg WAPE` : ''} tone="good" />
        <StatCard label="Most series wins" value={[...benchmark.summaryRows].sort((a, b) => b.wins - a.wins)[0]?.name || '—'} sub={`${[...benchmark.summaryRows].sort((a, b) => b.wins - a.wins)[0]?.wins || 0} wins`} />
        <StatCard label="Reproducible seed" value={`#${seed}`} sub="Mulberry32 deterministic PRNG" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Panel title="Aggregate 12-model performance" subtitle="Mean out-of-sample error across all benchmarked series" className="lg:col-span-7">
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                  <th className="pb-2 font-medium">Method</th>
                  <th className="pb-2 font-medium text-right">Avg WAPE</th>
                  <th className="pb-2 font-medium text-right">Avg RMSE</th>
                  <th className="pb-2 font-medium text-right">Avg MAE</th>
                  <th className="pb-2 font-medium text-right">Wins</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {benchmark.summaryRows.map((r, i) => (
                  <tr key={r.name} className={i === 0 ? 'bg-emerald-50/50 dark:bg-emerald-950/20 font-medium' : ''}>
                    <td className="py-2 pr-3">{r.name}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{Number.isFinite(r.avgWape) ? `${fmtNum(r.avgWape, 1)}%` : '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{Number.isFinite(r.avgRmse) ? fmtNum(r.avgRmse, 2) : '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{Number.isFinite(r.avgMae) ? fmtNum(r.avgMae, 2) : '—'}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{r.wins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Average WAPE comparison (%)" subtitle="Lower is better" className="lg:col-span-5">
          <BarChart
            horizontal
            labels={benchmark.summaryRows.slice(0, 8).map((r) => r.name)}
            series={[{ name: 'Avg WAPE %', data: benchmark.summaryRows.slice(0, 8).map((r) => (Number.isFinite(r.avgWape) ? r.avgWape : 0)) }]}
            formatValue={(v) => `${fmtNum(v, 1)}%`}
          />
        </Panel>
      </div>

      <Panel title="Synthetic regime winners" subtitle={`Seed #${seed} canonical tests (n=36 periods)`}>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {benchmark.perSynth.map((s) => (
            <div key={s.pattern} className="rounded border border-slate-200 dark:border-slate-800 p-3 text-xs">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">{s.pattern}</div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 mt-1">{s.best?.name || '—'}</div>
              <div className="font-mono text-slate-500 mt-0.5">
                WAPE {s.best?.metrics.wape != null ? `${fmtNum(s.best.metrics.wape, 1)}%` : '—'}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
};
