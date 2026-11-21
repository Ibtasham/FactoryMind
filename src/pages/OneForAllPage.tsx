import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Box,
  Calculator,
  Compass,
  Download,
  Factory,
  FileSpreadsheet,
  GitBranch,
  Layers,
  PackageCheck,
  Plus,
  TrendingUp,
} from 'lucide-react';
import { DashboardSummaryCard } from '../components/dashboard/DashboardSummaryCard';
import { RouteId } from '../components/layout/AppShell';
import type { Selected3DPart } from '../components/three/Factory3DViewport';
import { LazyFactory3DViewport } from '../components/three/LazyFactory3DViewport';
import {
  Button,
  Panel,
  SegmentedControl,
  StatusLabel,
  downloadFile,
} from '../components/ui/Primitives';
import { advisorAnalyse, advisorHealth, advisorPolicyFromSettings } from '../engine/advisor';
import { abcAnalysis, abcSummary, spcAnalysis } from '../engine/ipe';
import { fmtCover, fmtInt, fmtMoney, fmtNum } from '../engine/formatters';
import { generateDemandDataset, compareMethods, smaMethod, holtLinear, hwAdditive, seasonalNaive, emaMethod, crostonMethod } from '../engine/forecast';
import { compareAlgorithms } from '../engine/linebal';
import { simulateProductionLine, stationsFromLineBalance } from '../engine/prodsim';
import { generateOperationsPdf } from '../engine/pdfReport';
import {
  buildOperationsReport,
  fullOperationsDossierCSV,
  inventoryMetricsToCSV,
  productionMetricsToCSV,
} from '../engine/reports';
import { PlantRackProductInput, PlantStationInput } from '../engine/threeModels';
import {
  ASSEMBLY_3D_SPECS,
  ASSEMBLY_SKU_LIST,
  AssemblySku,
  FinishPresetId,
  SceneModeId,
} from '../engine/threeSpecs';
import { Product } from '../store/store';
import { useStore } from '../store/StoreContext';

type SuiteFocus = 'all' | 'inventory' | 'manufacturing' | 'analytics';

export const OneForAllPage: React.FC<{
  onNavigate: (r: RouteId) => void;
  onOpenProduct: (p: Product) => void;
  onAddProduct: () => void;
  onMoveStock: (p: Product, type: 'in' | 'out') => void;
  onInspect3D: (sku?: string) => void;
}> = ({ onNavigate, onOpenProduct, onAddProduct, onMoveStock, onInspect3D }) => {
  const { products, transactions, settings, summary, metricsOf, lineBalance, pushToast } = useStore();

  const [focus, setFocus] = useState<SuiteFocus>('all');
  const [sceneMode, setSceneMode] = useState<SceneModeId>('assembly');
  const [assemblySku, setAssemblySku] = useState<AssemblySku>('ASM-CM200');
  const [explodeAmount, setExplodeAmount] = useState<number>(0);
  const [finish, setFinish] = useState<FinishPresetId>('steel');
  const [selectedPart, setSelectedPart] = useState<Selected3DPart | null>(null);
  const [selectedEoqId, setSelectedEoqId] = useState<string>('');

  const rows = useMemo(() => products.map((p) => ({ p, m: metricsOf(p) })), [products, metricsOf]);
  const policy = useMemo(() => advisorPolicyFromSettings(settings), [settings]);
  const advisor = useMemo(() => advisorAnalyse(rows, transactions, policy), [rows, transactions, policy]);
  const health = useMemo(
    () => advisorHealth(rows, advisor.findings, advisor.totals, summary),
    [rows, advisor, summary]
  );

  // ABC Summary
  const abcStats = useMemo(() => {
    const analyzed = abcAnalysis(products, { aThreshold: settings.abcA, bThreshold: settings.abcB });
    return abcSummary(analyzed);
  }, [products, settings.abcA, settings.abcB]);

  // Line Balancing + Live DES Station Telemetry
  const lineBalSummary = useMemo(() => {
    const cmp = compareAlgorithms({
      tasks: lineBalance.tasks,
      cycleTime: lineBalance.cycleTime,
      algorithms: ['rpw', 'lcr', 'kw', 'comsoal', 'exact'],
    });
    const algo = lineBalance.selectedAlgo === 'comsail' ? 'comsoal' : lineBalance.selectedAlgo;
    const best = cmp.algorithms[algo] || cmp.best || cmp.algorithms.exact || cmp.algorithms.rpw;
    const simStations = stationsFromLineBalance(best, { cv: 0.2, bufferCapacity: 6 });
    const sim = simStations.length
      ? simulateProductionLine({
          stations: simStations,
          arrivalRatePerHour: Math.max(0.5, (60 / Math.max(1, lineBalance.cycleTime)) * 0.9),
          shiftMinutes: 480,
          warmupMinutes: 60,
          replications: 8,
          seed: 42,
        })
      : null;
    const stations: PlantStationInput[] = (best?.stations || []).map((st, idx) => {
      const telemetry = sim?.valid ? sim.stations[idx] : undefined;
      return {
        stationNumber: idx + 1,
        utilizationPct: Math.round((st.time / lineBalance.cycleTime) * 100),
        taskCount: st.tasks.length,
        tasksLabel: st.tasks.map((t) => t.id).join(', '),
        isBottleneck: telemetry?.isBottleneck ?? false,
        avgQueueLen: telemetry?.avgQueueLen ?? 0,
        throughputPerHour: sim?.valid ? sim.effectiveThroughputPerHour : undefined,
      };
    });
    return {
      bestStations: best?.stationCount ?? 0,
      efficiencyPct: Math.round(best?.efficiency ?? 0),
      stations,
    };
  }, [lineBalance]);

  // Forecast & SPC Snapshots
  const forecastQuick = useMemo(() => {
    const { history } = generateDemandDataset('seasonal', { n: 36, base: 140, noise: 6, seed: 42 });
    const cmp = compareMethods(
      history,
      [
        { name: 'Holt-Winters', method: hwAdditive, params: { seasonPeriod: 12, alpha: 0.3, beta: 0.1, gamma: 0.25 } },
        { name: 'Seasonal Naive', method: seasonalNaive, params: { seasonPeriod: 12 } },
        { name: 'SMA (3)', method: smaMethod, params: { w: 3 } },
        { name: 'EMA', method: emaMethod, params: { alpha: 0.25 } },
        { name: 'Holt', method: holtLinear, params: { alpha: 0.35, beta: 0.15 } },
        { name: 'Croston', method: crostonMethod, params: { alpha: 0.2 } },
      ],
      { minTrainSize: 12, horizon: 3 }
    );
    return {
      bestName: cmp.best?.name || 'Holt-Winters',
      mape: cmp.best?.metrics?.mape ?? 0,
    };
  }, []);

  const spcQuick = useMemo(() => {
    const subgroups = [
      [10.01, 9.99, 10.02, 9.98, 10.0],
      [10.02, 10.01, 9.99, 10.0, 9.98],
      [9.99, 10.01, 10.02, 10.0, 10.01],
      [10.01, 10.02, 9.99, 10.01, 10.0],
      [10.03, 10.01, 10.0, 9.98, 10.01],
    ];
    return spcAnalysis({ subgroups, usl: 10.12, lsl: 9.88 });
  }, []);

  // Operations Report Snapshot for instant One-for-All downloads & MRP readiness
  const reportSnapshot = useMemo(
    () =>
      buildOperationsReport(products, summary, settings, {
        buildQty: 25,
        needInDays: 35,
        benchmarkKey: lineBalance.benchmarkKey,
        cycleTime: lineBalance.cycleTime,
        customTasks: lineBalance.tasks,
      }),
    [products, summary, settings, lineBalance]
  );

  // Live 3D Plant products
  const plantProducts = useMemo<PlantRackProductInput[]>(
    () =>
      rows.map(({ p, m }) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        stock: p.stock,
        rop: m.rop,
        unit: p.unit,
        status: m.status,
      })),
    [rows]
  );

  const activeEoqRow = useMemo(() => {
    if (!rows.length) return null;
    return rows.find((r) => r.p.id === selectedEoqId) || rows[0];
  }, [rows, selectedEoqId]);

  const urgentRows = useMemo(() => {
    const order = { out: 0, critical: 1, reorder: 2, ok: 3 };
    return rows
      .filter(({ m }) => m.status !== 'ok')
      .sort((a, b) => order[a.m.status] - order[b.m.status] || b.m.usageValue - a.m.usageValue)
      .slice(0, 6);
  }, [rows]);

  const handleExportPdf = () => {
    const { filename, pageCount } = generateOperationsPdf(reportSnapshot, {
      includeSummary: true,
      includeReplenishment: true,
      includeProduction: true,
      includeInventory: true,
      includeCategories: true,
    });
    pushToast({ type: 'success', message: `Exported ${filename} (${pageCount} pages).` });
  };

  const showInventory = focus === 'all' || focus === 'inventory';
  const showManufacturing = focus === 'all' || focus === 'manufacturing';
  const showAnalytics = focus === 'all' || focus === 'analytics';

  return (
    <div className="space-y-5">
      {/* Unified One-for-All Command Header */}
      <section className="rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-gradient-to-br from-white via-white to-slate-50/90 dark:from-slate-900 dark:via-slate-900/95 dark:to-slate-950 p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--accent)] font-semibold">
              One-for-All Unified Command Suite
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
              Complete FactoryMind Operations in One Workspace
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
              Switch between unified all-in-one visibility or filter a single discipline below — every metric, 3D assembly, BOM readiness, and export updates live from your catalog.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={handleExportPdf}>
              <Download className="h-3.5 w-3.5" /> Export PDF Dossier
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                downloadFile(
                  `factorymind-all-in-one-${reportSnapshot.generatedIso.slice(0, 10)}.csv`,
                  fullOperationsDossierCSV(reportSnapshot),
                  'text/csv;charset=utf-8'
                );
                pushToast({ type: 'success', message: 'Downloaded consolidated CSV dossier.' });
              }}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Full CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={onAddProduct}>
              <Plus className="h-3.5 w-3.5" /> Add SKU
            </Button>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            value={focus}
            onChange={(v) => setFocus(v as SuiteFocus)}
            options={[
              { value: 'all', label: 'All Modules (One-for-All)' },
              { value: 'inventory', label: 'Inventory & Policy' },
              { value: 'manufacturing', label: '3D Twin & MRP' },
              { value: 'analytics', label: 'Forecast, Line Bal & SPC' },
            ]}
          />
          <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
            Portfolio Health{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {health.score}/100 ({health.label})
            </span>
          </div>
        </div>
      </section>

      {/* Unified KPI Summary Card */}
      <DashboardSummaryCard onNavigate={onNavigate} onOpenProduct={onOpenProduct} />

      {/* Manufacturing & 3D Digital Twin Lane */}
      {showManufacturing && (
        <div className="space-y-4">
          <Panel
            title="Live 3D Digital Twin & BOM Explorer"
            subtitle="Orbit mechanical assemblies in exploded view or inspect live warehouse racks and conveyor stations"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  value={sceneMode}
                  onChange={(v) => {
                    setSceneMode(v as SceneModeId);
                    setSelectedPart(null);
                  }}
                  options={[
                    { value: 'assembly', label: 'BOM Assemblies' },
                    { value: 'plant', label: 'Plant & Warehouse' },
                  ]}
                />
                <Button size="sm" variant="primary" onClick={() => onInspect3D(assemblySku)}>
                  <Box className="h-3.5 w-3.5" /> Full 3D Studio
                </Button>
              </div>
            }
          >
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              <div className="lg:col-span-8 space-y-2.5">
                {sceneMode === 'assembly' && (
                  <div className="flex flex-wrap gap-1.5">
                    {ASSEMBLY_SKU_LIST.map((sku) => (
                      <button
                        key={sku}
                        type="button"
                        onClick={() => {
                          setAssemblySku(sku);
                          setSelectedPart(null);
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors cursor-pointer ${
                          assemblySku === sku
                            ? 'bg-[var(--accent)] text-white'
                            : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {sku} · {ASSEMBLY_3D_SPECS[sku].title}
                      </button>
                    ))}
                  </div>
                )}

                <LazyFactory3DViewport
                  mode={sceneMode}
                  assemblySku={assemblySku}
                  plantProducts={plantProducts}
                  plantStations={lineBalSummary.stations}
                  explodeAmount={explodeAmount}
                  onExplodeChange={setExplodeAmount}
                  finish={finish}
                  onFinishChange={setFinish}
                  selectedPartId={selectedPart?.partId || null}
                  onSelectPart={setSelectedPart}
                  theme={settings.theme}
                  reduceMotion={Boolean(settings.reduceMotion)}
                  compact
                  className="h-[360px]"
                />
              </div>

              {/* BOM Production Readiness Table */}
              <div className="lg:col-span-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    MRP Batch Readiness (Q=25)
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('production')}
                    className="text-[11px] font-medium text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    Open MRP <ArrowRight className="inline h-3 w-3" />
                  </button>
                </div>

                {selectedPart && (
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs">
                    <div className="font-mono text-[11px] font-semibold text-[var(--accent)]">
                      Selected: {selectedPart.sku}
                    </div>
                    <div className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                      {selectedPart.label}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {selectedPart.role}
                    </div>
                  </div>
                )}

                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {reportSnapshot.production.assemblies.map((asm) => {
                    const ready = asm.shortageCount === 0;
                    return (
                      <div key={asm.product.sku} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {asm.product.name}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {asm.product.sku} · On hand {fmtInt(asm.product.stock)}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div
                            className={`font-mono text-xs font-semibold ${
                              ready
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {ready ? 'Ready' : `${asm.shortageCount} short`}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {fmtMoney(asm.netReqSpend)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* Inventory, EOQ & Advisor Lane */}
      {showInventory && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <Panel
            title="Replenishment Queue & Fast Receive"
            subtitle="Urgent SKUs at or below Reorder Point (ROP)"
            className="lg:col-span-7"
            actions={
              <Button size="sm" variant="ghost" onClick={() => onNavigate('inventory')}>
                Full Catalogue <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            }
          >
            {urgentRows.length ? (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                      <th className="pb-2 font-medium">SKU</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium text-right">Stock / ROP</th>
                      <th className="pb-2 font-medium text-right">EOQ</th>
                      <th className="pb-2 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {urgentRows.map(({ p, m }) => (
                      <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2 pr-2">
                          <button
                            type="button"
                            onClick={() => onOpenProduct(p)}
                            className="text-left hover:text-[var(--accent)] cursor-pointer"
                          >
                            <div className="font-medium text-slate-900 dark:text-slate-100">{p.name}</div>
                            <div className="font-mono text-[11px] text-slate-500">{p.sku}</div>
                          </button>
                        </td>
                        <td className="py-2 pr-2">
                          <StatusLabel status={m.status} />
                        </td>
                        <td className="py-2 pr-2 text-right font-mono tabular-nums">
                          {fmtInt(p.stock)} / {fmtInt(m.rop)}
                        </td>
                        <td className="py-2 pr-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {fmtInt(m.eoq.Q)}
                        </td>
                        <td className="py-2 text-right">
                          <Button size="sm" variant="secondary" onClick={() => onMoveStock(p, 'in')}>
                            <PackageCheck className="h-3.5 w-3.5" /> Receive
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-500">
                All SKUs are above safety stock and reorder thresholds.
              </div>
            )}
          </Panel>

          {/* Interactive EOQ / ABC / Advisor Inspector */}
          <Panel
            title="Live EOQ, ROP & ABC Quick Inspector"
            subtitle="Inspect optimal lot sizing & Pareto class for any SKU"
            className="lg:col-span-5"
            actions={
              <Button size="sm" variant="ghost" onClick={() => onNavigate('eoq')}>
                EOQ Lab <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            }
          >
            {activeEoqRow && (
              <div className="space-y-3.5">
                <select
                  aria-label="Select SKU for quick EOQ analysis"
                  value={activeEoqRow.p.id}
                  onChange={(e) => setSelectedEoqId(e.target.value)}
                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                >
                  {rows.map(({ p }) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} · {p.name}
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                    <div className="text-[11px] text-slate-500">Wilson EOQ (Q*)</div>
                    <div className="font-mono text-base font-semibold mt-0.5">
                      {fmtInt(activeEoqRow.m.eoq.Q)} {activeEoqRow.p.unit}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                    <div className="text-[11px] text-slate-500">Reorder Point (ROP)</div>
                    <div className="font-mono text-base font-semibold mt-0.5">
                      {fmtInt(activeEoqRow.m.rop)} {activeEoqRow.p.unit}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                    <div className="text-[11px] text-slate-500">Safety Stock / Cover</div>
                    <div className="font-mono text-sm font-medium mt-0.5">
                      {fmtInt(activeEoqRow.m.safetyStock)} · {fmtCover(activeEoqRow.m.monthsOfCover)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                    <div className="text-[11px] text-slate-500">Class A Capital Share</div>
                    <div className="font-mono text-sm font-medium mt-0.5">
                      {fmtNum(abcStats.A.usagePct, 0)}% ({abcStats.A.count} SKUs)
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    Advisor findings: <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{advisor.findings.length}</span> ({fmtMoney(advisor.totals.parkedCash)} parked cash)
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate('advisor')}
                    className="text-[var(--accent)] font-medium hover:underline cursor-pointer"
                  >
                    Open Advisor
                  </button>
                </div>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* Analytics, Line Balancing, SPC & Direct Exports Lane */}
      {showAnalytics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-slate-900/85 p-4 shadow-xs flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5 font-medium">
                  <TrendingUp className="h-3.5 w-3.5 text-[var(--accent)]" /> Demand Forecast
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('forecast')}
                  className="text-[var(--accent)] hover:underline cursor-pointer"
                >
                  Open
                </button>
              </div>
              <div className="mt-2 text-lg font-semibold font-mono text-slate-900 dark:text-white">
                {forecastQuick.bestName}
              </div>
              <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                {fmtNum(forecastQuick.mape, 1)}% seasonal backtest MAPE
              </div>
            </div>
            <div className="text-[11px] text-slate-500">12-method comparator &amp; Croston/SBA</div>
          </div>

          <div className="rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-slate-900/85 p-4 shadow-xs flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5 font-medium">
                  <GitBranch className="h-3.5 w-3.5 text-[var(--accent)]" /> Line Balancing
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('line-balance')}
                  className="text-[var(--accent)] hover:underline cursor-pointer"
                >
                  Open
                </button>
              </div>
              <div className="mt-2 text-lg font-semibold font-mono text-slate-900 dark:text-white">
                {lineBalSummary.bestStations} Stations
              </div>
              <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                {lineBalSummary.efficiencyPct}% line efficiency ({lineBalance.benchmarkKey})
              </div>
            </div>
            <div className="text-[11px] text-slate-500">RPW, LCR, K&amp;W, COMSOAL &amp; Exact</div>
          </div>

          <div className="rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-slate-900/85 p-4 shadow-xs flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5 font-medium">
                  <Activity className="h-3.5 w-3.5 text-[var(--accent)]" /> SPC Quality Control
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('spc')}
                  className="text-[var(--accent)] hover:underline cursor-pointer"
                >
                  Open
                </button>
              </div>
              <div className="mt-2 text-lg font-semibold font-mono text-slate-900 dark:text-white">
                Cpk {fmtNum(spcQuick.cap?.Cpk ?? 0, 2)}
              </div>
              <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                {spcQuick.oocCount} out-of-control subgroup(s)
              </div>
            </div>
            <div className="text-[11px] text-slate-500">X̄/R, Cp/Cpk, EWMA &amp; CUSUM</div>
          </div>

          <div className="rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-slate-900/85 p-4 shadow-xs flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5 font-medium">
                  <Layers className="h-3.5 w-3.5 text-[var(--accent)]" /> Quick Exports
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('reports')}
                  className="text-[var(--accent)] hover:underline cursor-pointer"
                >
                  Reports
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    downloadFile(
                      `factorymind-inventory-${reportSnapshot.generatedIso.slice(0, 10)}.csv`,
                      inventoryMetricsToCSV(reportSnapshot),
                      'text/csv'
                    )
                  }
                >
                  Inventory CSV
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    downloadFile(
                      `factorymind-production-${reportSnapshot.generatedIso.slice(0, 10)}.csv`,
                      productionMetricsToCSV(reportSnapshot),
                      'text/csv'
                    )
                  }
                >
                  Production CSV
                </Button>
              </div>
            </div>
            <div className="text-[11px] text-slate-500">PDF dossier &amp; CSV audit sheets</div>
          </div>
        </div>
      )}

      {/* Fast Navigation Matrix */}
      <Panel
        title="Module Directory"
        subtitle="Jump straight into any dedicated engineering workbench"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {[
            { id: 'inventory' as RouteId, label: 'SKU Catalogue', icon: Compass },
            { id: 'eoq' as RouteId, label: 'EOQ & Discounts', icon: Calculator },
            { id: 'production' as RouteId, label: 'MRP Explosion', icon: Factory },
            { id: 'models-3d' as RouteId, label: '3D Digital Twin', icon: Box },
            { id: 'reports' as RouteId, label: 'PDF / CSV Reports', icon: FileSpreadsheet },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2 truncate">
                  <Icon className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                <ArrowRight className="h-3 w-3 shrink-0 opacity-60" />
              </button>
            );
          })}
        </div>
      </Panel>
    </div>
  );
};
