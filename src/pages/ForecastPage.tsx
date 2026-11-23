import React, { useEffect, useMemo, useState } from 'react';
import { LineChart } from '../components/charts/Charts';
import { AssumptionPanel, Button, EmptyState, Field, Input, Panel, SegmentedControl, Select, StatCard } from '../components/ui/Primitives';
import {
  crostonMethod,
  emaMethod,
  forecastProfile,
  generateDemandDataset,
  holtLinear,
  hwAdditive,
  hwMultiplicative,
  linregMethod,
  MethodSpec,
  recommendForecast,
  sbaMethod,
  seasonalNaive,
  smaMethod,
  wmaMethod,
} from '../engine/forecast';
import { clampNumericInput, fmtNum } from '../engine/formatters';
import { monthLabels } from '../store/store';
import { useStore } from '../store/StoreContext';

export const ForecastPage: React.FC = () => {
  const { products, settings } = useStore();
  const [sourceMode, setSourceMode] = useState<'sku' | 'pattern' | 'custom'>('pattern');
  const [skuId, setSkuId] = useState<string>(products[0]?.id || '');
  const [pattern, setPattern] = useState<'stationary' | 'trend' | 'seasonal' | 'intermittent' | 'structural-break'>('seasonal');
  const [customCsv, setCustomCsv] = useState<string>('118, 125, 142, 160, 155, 132, 108, 94, 102, 119, 138, 154, 122, 130, 148, 165, 158, 134, 112, 98, 105, 124, 141, 161');

  const [horizon, setHorizon] = useState<number>(6);
  const [windowLen, setWindowLen] = useState<number>(settings.smaW || 3);
  const [alpha, setAlpha] = useState<number>(settings.emaAlpha || 0.3);
  const [beta, setBeta] = useState<number>(0.15);
  const [gamma, setGamma] = useState<number>(0.2);
  const [seasonPeriod, setSeasonPeriod] = useState<number>(12);
  const [selectedMethodKey, setSelectedMethodKey] = useState<string>('auto');

  useEffect(() => {
    setWindowLen(settings.smaW || 3);
    setAlpha(settings.emaAlpha || 0.3);
  }, [settings.smaW, settings.emaAlpha]);

  useEffect(() => {
    if (products.length && !products.some((p) => p.id === skuId)) {
      setSkuId(products[0].id);
    }
  }, [products, skuId]);

  const history = useMemo(() => {
    if (sourceMode === 'sku') {
      const p = products.find((x) => x.id === skuId) || products[0];
      return p?.demandHistory || [];
    }
    if (sourceMode === 'pattern') {
      return generateDemandDataset(pattern, { n: 36, base: 120, noise: 8, seed: 42 }).history;
    }
    return customCsv
      .split(/[\s,;]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 0);
  }, [sourceMode, skuId, products, pattern, customCsv]);

  const methodSpecs = useMemo<MethodSpec[]>(() => {
    const p = Math.max(2, Math.min(seasonPeriod, Math.max(2, Math.floor(history.length / 2))));
    return [
      { name: `SMA (w=${windowLen})`, shortKey: 'sma', method: smaMethod, params: { w: windowLen } },
      { name: `WMA (w=${windowLen})`, shortKey: 'wma', method: wmaMethod, params: { w: windowLen } },
      { name: `SES (α=${alpha})`, shortKey: 'ema', method: emaMethod, params: { alpha } },
      { name: `Holt Linear`, shortKey: 'holt', method: holtLinear, params: { alpha, beta } },
      { name: `Holt-Winters Add (p=${p})`, shortKey: 'hwa', method: hwAdditive, params: { alpha, beta, gamma, seasonPeriod: p } },
      { name: `Holt-Winters Mult (p=${p})`, shortKey: 'hwm', method: hwMultiplicative, params: { alpha, beta, gamma, seasonPeriod: p } },
      { name: `Seasonal Naive (p=${p})`, shortKey: 'sn', method: seasonalNaive, params: { period: p } },
      { name: `Linear Trend`, shortKey: 'lin', method: linregMethod },
      { name: `Croston`, shortKey: 'croston', method: crostonMethod, params: { alpha } },
      { name: `SBA (Syntetos–Boylan)`, shortKey: 'sba', method: sbaMethod, params: { alpha } },
    ];
  }, [windowLen, alpha, beta, gamma, seasonPeriod, history.length]);

  const rec = useMemo(() => {
    const minTrain = Math.min(12, Math.max(3, Math.floor(history.length / 2)));
    return recommendForecast(history, methodSpecs, {
      horizon: Math.min(horizon, Math.max(2, Math.floor(history.length / 4))),
      minTrainSize: minTrain,
      seasonPeriod,
    });
  }, [history, methodSpecs, horizon, seasonPeriod]);

  const activeSpec = useMemo(() => {
    if (selectedMethodKey !== 'auto') {
      const found = rec.methods.find((m) => m.shortKey === selectedMethodKey || m.name === selectedMethodKey);
      if (found) return found;
    }
    return rec.bestMethod || rec.methods[0] || null;
  }, [selectedMethodKey, rec]);

  const profile = useMemo(() => {
    if (!activeSpec || !history.length) return null;
    return forecastProfile(history, activeSpec.method, activeSpec.params, horizon);
  }, [activeSpec, history, horizon]);

  const chartData = useMemo(() => {
    if (!history.length || !profile) {
      return { labels: [], actual: [], fitted: [], forecast: [], band: undefined };
    }
    const baseLabels = monthLabels(history.length);
    const futureLabels = Array.from({ length: horizon }, (_, i) => `F+${i + 1}`);
    const labels = [...baseLabels, ...futureLabels];
    const actual: Array<number | null> = [...history, ...new Array(horizon).fill(null)];
    const fitted: Array<number | null> = [...profile.fitted, ...new Array(horizon).fill(null)];
    const forecast: Array<number | null> = [
      ...new Array(Math.max(0, history.length - 1)).fill(null),
      history[history.length - 1],
      ...profile.forecast,
    ];
    const lower: Array<number | null> = [
      ...new Array(history.length).fill(null),
      ...profile.intervals.map((iv) => (iv ? iv.lower : null)),
    ];
    const upper: Array<number | null> = [
      ...new Array(history.length).fill(null),
      ...profile.intervals.map((iv) => (iv ? iv.upper : null)),
    ];
    return {
      labels,
      actual,
      fitted,
      forecast,
      band: { lower, upper, color: '#2563eb' },
    };
  }, [history, profile, horizon]);

  const rankedMethods = useMemo(
    () =>
      [...rec.methods].sort(
        (a, b) =>
          (a.metrics.wape ?? Infinity) - (b.metrics.wape ?? Infinity) ||
          (a.metrics.rmse ?? Infinity) - (b.metrics.rmse ?? Infinity)
      ),
    [rec.methods]
  );

  return (
    <div className="space-y-4">
      <Panel
        title="Demand source & smoothing controls"
        subtitle="Runs rolling-origin cross-validation across all 12 models (including Naive & Mean baselines)"
        actions={
          <SegmentedControl
            value={sourceMode}
            onChange={(v) => setSourceMode(v as typeof sourceMode)}
            options={[
              { value: 'pattern', label: 'Synthetic Pattern' },
              { value: 'sku', label: 'Catalogue SKU' },
              { value: 'custom', label: 'Custom CSV' },
            ]}
          />
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {sourceMode === 'sku' && (
            <div className="col-span-2">
              <Field label="Select SKU">
                <Select value={skuId} onChange={(e) => setSkuId(e.target.value)}>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} · {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          {sourceMode === 'pattern' && (
            <div className="col-span-2">
              <Field label="Synthetic demand pattern (n=36)">
                <Select value={pattern} onChange={(e) => setPattern(e.target.value as typeof pattern)}>
                  <option value="seasonal">Seasonal cycle (sinusoidal)</option>
                  <option value="trend">Directional linear trend</option>
                  <option value="stationary">Stationary normal</option>
                  <option value="intermittent">Intermittent spare-parts</option>
                  <option value="structural-break">Structural level break</option>
                </Select>
              </Field>
            </div>
          )}

          {sourceMode === 'custom' && (
            <div className="col-span-2">
              <Field label="Custom comma-separated series">
                <Input value={customCsv} onChange={(e) => setCustomCsv(e.target.value)} />
              </Field>
            </div>
          )}

          <Field label="Forecast horizon">
            <Input type="number" min="1" max="24" value={horizon} onChange={(e) => setHorizon(clampNumericInput(e.target.value, 6, 1, 24, true))} />
          </Field>
          <Field label="MA window (w)">
            <Input type="number" min="2" max="12" value={windowLen} onChange={(e) => setWindowLen(clampNumericInput(e.target.value, 3, 2, 12, true))} />
          </Field>
          <Field label="Alpha (α)">
            <Input type="number" min="0.05" max="0.95" step="0.05" value={alpha} onChange={(e) => setAlpha(clampNumericInput(e.target.value, 0.3, 0.05, 0.95))} />
          </Field>
          <Field label="Plotted method">
            <Select value={selectedMethodKey} onChange={(e) => setSelectedMethodKey(e.target.value)}>
              <option value="auto">Auto-selected winner ({rec.bestMethod?.name || 'N/A'})</option>
              {rankedMethods.map((m) => {
                const key = m.shortKey || m.name;
                return (
                  <option key={m.name} value={key}>
                    {m.name}
                  </option>
                );
              })}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-3 max-w-md">
          <Field label="Holt β">
            <Input type="number" min="0.05" max="0.95" step="0.05" value={beta} onChange={(e) => setBeta(clampNumericInput(e.target.value, 0.15, 0.05, 0.95))} />
          </Field>
          <Field label="Season γ">
            <Input type="number" min="0.05" max="0.95" step="0.05" value={gamma} onChange={(e) => setGamma(clampNumericInput(e.target.value, 0.2, 0.05, 0.95))} />
          </Field>
          <Field label="Season p">
            <Input type="number" min="2" max="24" value={seasonPeriod} onChange={(e) => setSeasonPeriod(clampNumericInput(e.target.value, 12, 2, 24, true))} />
          </Field>
        </div>
      </Panel>

      {history.length === 0 ? (
        <EmptyState
          title="No historical demand points for this source"
          message="Select a SKU with historical demand observations, switch to Synthetic Pattern, or paste comma-separated demand numbers in Custom CSV."
          action={
            <Button size="sm" variant="secondary" onClick={() => setSourceMode('pattern')}>
              Switch to Synthetic Pattern
            </Button>
          }
        />
      ) : (
        <>

      {/* Diagnostic KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          label="Recommended model"
          value={rec.bestMethod?.name || 'Insufficient data'}
          sub={rec.bestMethod?.metrics.wape != null ? `WAPE ${fmtNum(rec.bestMethod.metrics.wape, 1)}%` : rec.reason}
          tone="good"
        />
        <StatCard
          label="Demand classification"
          value={rec.classification?.type || 'unknown'}
          sub={`AC ${rec.classification?.ac || '—'} · CV ${fmtNum(rec.classification?.cv || 0, 2)} · Non-zero ${fmtNum((rec.classification?.pdt || 0) * 100, 0)}%`}
        />
        <StatCard
          label="Backtest confidence"
          value={`${Math.round((rec.confidence || 0) * 100)}%`}
          sub={`${history.length} historical periods`}
        />
        <StatCard
          label="Next-period forecast"
          value={profile?.forecast.length ? fmtNum(profile.forecast[0], 1) : '—'}
          sub={
            profile?.intervals[0]
              ? `95% PI: ${fmtNum(profile.intervals[0].lower, 0)} – ${fmtNum(profile.intervals[0].upper, 0)}`
              : 'Prediction interval needs ≥4 fitted points'
          }
        />
      </div>

      {/* Forecast Trajectory Chart */}
      <Panel
        title={`Actual, fitted & ${horizon}-period forecast (${activeSpec?.name || 'Model'})`}
        subtitle={rec.reason}
      >
        <LineChart
          labels={chartData.labels}
          height={270}
          band={chartData.band}
          series={[
            {
              name: 'Actual demand',
              data: chartData.actual,
              color: settings.theme === 'dark' ? '#e2e8f0' : '#0f172a',
            },
            { name: 'In-sample fit', data: chartData.fitted, color: '#10b981', dashed: true },
            { name: 'Forecast (95% PI)', data: chartData.forecast, color: '#2563eb' },
          ]}
        />
      </Panel>

      {/* 12-Model Leaderboard */}
      <Panel
        title="12-model rolling-origin backtest leaderboard"
        subtitle="Ranked by out-of-sample WAPE (Weighted Absolute Percentage Error), tie-broken by RMSE / MAE"
      >
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                <th className="pb-2 font-medium">Rank</th>
                <th className="pb-2 font-medium">Method</th>
                <th className="pb-2 font-medium text-right">WAPE</th>
                <th className="pb-2 font-medium text-right">RMSE</th>
                <th className="pb-2 font-medium text-right">MAE</th>
                <th className="pb-2 font-medium text-right">sMAPE</th>
                <th className="pb-2 font-medium text-right">Bias</th>
                <th className="pb-2 font-medium text-right">Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {rankedMethods.map((m, i) => {
                const isBest = rec.bestMethod?.name === m.name;
                const key = m.shortKey || m.name;
                return (
                  <tr
                    key={m.name}
                    onClick={() => setSelectedMethodKey(key)}
                    className={`cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                      isBest ? 'bg-emerald-50/60 dark:bg-emerald-950/30 font-medium' : ''
                    }`}
                  >
                    <td className="py-2 pr-3 font-mono text-slate-400">{i + 1}</td>
                    <td className="py-2 pr-3 flex items-center gap-2">
                      <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: m.color }} />
                      <span className="text-slate-900 dark:text-slate-100">{m.name}</span>
                      {isBest && <span className="text-emerald-600 dark:text-emerald-400 text-[11px]">Winner</span>}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {m.metrics.wape != null ? `${fmtNum(m.metrics.wape, 1)}%` : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {m.metrics.rmse != null ? fmtNum(m.metrics.rmse, 2) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {m.metrics.mae != null ? fmtNum(m.metrics.mae, 2) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {m.metrics.smape != null ? `${fmtNum(m.metrics.smape, 1)}%` : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {m.metrics.bias != null ? fmtNum(m.metrics.bias, 2) : '—'}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-slate-500">{m.metrics.n}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
        </>
      )}

      <AssumptionPanel topicId="forecast" />
    </div>
  );
};
