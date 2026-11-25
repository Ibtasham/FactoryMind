import React, { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Box, CheckCircle2, Compass, PackageCheck, Plus, Sparkles, X } from 'lucide-react';
import { DonutChart, LineChart } from '../components/charts/Charts';
import { DashboardSummaryCard } from '../components/dashboard/DashboardSummaryCard';
import { SmartAlertsPanel } from '../components/dashboard/SmartAlertsPanel';
import { RouteId } from '../components/layout/AppShell';
import { LazyFactory3DViewport } from '../components/three/LazyFactory3DViewport';
import {
  Button,
  DatasetProvenanceIndicator,
  EmptyState,
  Panel,
  StatCard,
  StatusLabel,
  TermTooltip,
} from '../components/ui/Primitives';
import { advisorAnalyse, advisorHealth, advisorPolicyFromSettings } from '../engine/advisor';
import { compactMoney, fmtCover, fmtInt, fmtMoney, fmtNum, relTime, shortDate } from '../engine/formatters';
import { ASSEMBLY_3D_SPECS, ASSEMBLY_SKU_LIST, AssemblySku } from '../engine/threeSpecs';
import { computeOnboardingProgress, ONBOARDING_STEPS } from '../engine/uxHelpers';
import type { PlantRackProductInput, PlantStationInput } from '../engine/threeModels';
import { Product } from '../store/store';
import { useStore } from '../store/StoreContext';

const CAT_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b'];
const EMPTY_PLANT_PRODUCTS: PlantRackProductInput[] = [];
const EMPTY_PLANT_STATIONS: PlantStationInput[] = [];

export const DashboardPage: React.FC<{
  onNavigate: (r: RouteId) => void;
  onOpenProduct: (p: Product) => void;
  onAddProduct: () => void;
  onMoveStock: (p: Product, type: 'in' | 'out') => void;
  onInspect3D?: (sku?: string) => void;
  onOpenOnboarding?: () => void;
  onOpenHelp?: (topicId?: string) => void;
}> = ({ onNavigate, onOpenProduct, onAddProduct, onMoveStock, onInspect3D, onOpenOnboarding, onOpenHelp }) => {
  const {
    products,
    transactions,
    settings,
    setSetting,
    summary,
    datasetProvenance,
    metricsOf,
    valueHistory,
    pushToast,
    smartAlertsResult,
    smartAlertHorizonDays,
    dismissedSmartAlertIds,
    setSmartAlertHorizonDays,
    dismissSmartAlert,
    restoreAllSmartAlerts,
  } = useStore();
  const [previewSku, setPreviewSku] = useState<AssemblySku>('ASM-CM200');
  const [previewExplode, setPreviewExplode] = useState<number>(0);

  const rows = useMemo(() => products.map((p) => ({ p, m: metricsOf(p) })), [products, metricsOf]);

  const handleDismissAlert = (id: string) => {
    dismissSmartAlert(id);
    pushToast({ type: 'info', message: 'Smart alert acknowledged.' });
  };

  const policy = useMemo(() => advisorPolicyFromSettings(settings), [settings]);
  const advisor = useMemo(() => advisorAnalyse(rows, transactions, policy), [rows, transactions, policy]);
  const health = useMemo(() => advisorHealth(rows, advisor.findings, advisor.totals, summary), [rows, advisor, summary]);

  const history = useMemo(() => valueHistory(30), [valueHistory]);
  const historyLabels = useMemo(() => history.map((h) => shortDate(h.ts)), [history]);
  const historyValues = useMemo(() => history.map((h) => h.value), [history]);

  const categorySegments = useMemo(() => {
    const entries = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]);
    return entries.map(([label, value], i) => ({
      label,
      value,
      color: CAT_COLORS[i % CAT_COLORS.length],
    }));
  }, [summary.byCategory]);

  const actionQueue = useMemo(() => {
    const order = { out: 0, critical: 1, reorder: 2, ok: 3 };
    return rows
      .filter(({ m }) => m.status !== 'ok')
      .sort((a, b) => order[a.m.status] - order[b.m.status] || b.m.usageValue - a.m.usageValue);
  }, [rows]);

  const topUsage = useMemo(
    () => [...rows].sort((a, b) => b.m.usageValue - a.m.usageValue).slice(0, 6),
    [rows]
  );

  const healthyPct = summary.skuCount ? (summary.counts.ok / summary.skuCount) * 100 : 100;
  const onboardingProgress = computeOnboardingProgress(settings.onboardingCompletedSteps);

  if (!products.length) {
    return (
      <div className="space-y-4">
        <DatasetProvenanceIndicator provenance={datasetProvenance} onManage={() => onNavigate('settings')} />
        <EmptyState
          title="No SKUs in catalogue"
          message="Add your first part, import a CSV spreadsheet, or restore the 17-SKU industrial demo dataset in Settings."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={onAddProduct}>
                <Plus className="h-3.5 w-3.5" /> Add first SKU
              </Button>
              <Button variant="secondary" onClick={() => onNavigate('settings')}>
                Import / Restore data
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Dataset Provenance & Non-blocking Guided Onboarding */}
      <div className="space-y-2.5">
        <DatasetProvenanceIndicator provenance={datasetProvenance} onManage={() => onNavigate('settings')} />

        {!settings.onboardingDismissed && (
          <section
            aria-label="Getting started checklist"
            data-testid="onboarding-banner"
            className="rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-slate-100/60 dark:bg-slate-900/75 px-3.5 py-3 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex flex-wrap items-center gap-2">
                  <span>Workbench Onboarding ({onboardingProgress.completed}/{onboardingProgress.total} workflows explored)</span>
                  <span aria-hidden="true" className="text-slate-400">·</span>
                  <span className="font-mono text-[11px] text-[var(--accent)]">{onboardingProgress.pct}%</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                  Explore the core engineering loops below—steps mark complete automatically as you visit each module.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
                {onOpenOnboarding && (
                  <Button size="sm" variant="primary" onClick={onOpenOnboarding}>
                    <Compass className="h-3.5 w-3.5" /> Guided Tour
                  </Button>
                )}
                {onOpenHelp && (
                  <Button size="sm" variant="secondary" onClick={() => onOpenHelp('help-dataset-origin')}>
                    <BookOpen className="h-3.5 w-3.5" /> Help &amp; Formulas
                  </Button>
                )}
                <button
                  type="button"
                  aria-label="Dismiss onboarding banner"
                  onClick={() => setSetting('onboardingDismissed', true)}
                  className="p-1.5 min-h-[34px] min-w-[34px] sm:min-h-0 sm:min-w-0 flex items-center justify-center rounded text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              {ONBOARDING_STEPS.map((step, idx) => {
                const done = (settings.onboardingCompletedSteps || []).includes(step.id);
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => onNavigate(step.route as RouteId)}
                    className={`text-left rounded-lg border px-2.5 py-2 transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                      done
                        ? 'border-emerald-300/70 dark:border-emerald-800/70 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60 hover:border-[var(--accent)]/60 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-[10px] text-slate-600 dark:text-slate-300">
                        Step {idx + 1} · {step.ctaLabel}
                      </span>
                      <span className="block text-[11px] font-medium truncate">{step.title}</span>
                    </span>
                    {done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Primary Operations Overview */}
      <DashboardSummaryCard onNavigate={onNavigate} onOpenProduct={onOpenProduct} />

      {/* Focused Policy & Working Capital Indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          label="Portfolio health"
          termKey="portfolioHealth"
          value={`${health.score}/100`}
          sub={`${health.label} · ${fmtNum(healthyPct, 0)}% healthy coverage`}
          tone={health.score >= 85 ? 'good' : health.score >= 70 ? 'warn' : 'bad'}
        />
        <StatCard
          label="Excess cash parked"
          termKey="parkedCash"
          value={fmtMoney(advisor.totals.parkedCash)}
          sub={`Capital above ${policy.cover}-month target cover`}
          tone={advisor.totals.parkedCash > 0 ? 'warn' : 'good'}
        />
        <StatCard
          label="Advisor findings"
          value={fmtInt(advisor.findings.length)}
          sub="Priced inventory policy recommendations"
          tone={advisor.findings.length > 0 ? 'warn' : 'good'}
        />
        <StatCard
          label="Forecast risk alerts"
          value={fmtInt(smartAlertsResult.alerts.length)}
          sub={`Predicted stockouts within ${smartAlertHorizonDays}d horizon`}
          tone={smartAlertsResult.alerts.some((a) => a.runsOutBeforeLeadTime) ? 'bad' : smartAlertsResult.alerts.length > 0 ? 'warn' : 'good'}
        />
      </div>

      {/* Smart Alerts — Demand-Forecast Stockout Early Warning */}
      <SmartAlertsPanel
        result={smartAlertsResult}
        horizonDays={smartAlertHorizonDays}
        onHorizonChange={setSmartAlertHorizonDays}
        dismissedIds={dismissedSmartAlertIds}
        onDismiss={handleDismissAlert}
        onRestoreAll={restoreAllSmartAlerts}
        onOpenProduct={onOpenProduct}
        onMoveStock={onMoveStock}
        onNavigate={onNavigate}
      />

      {/* Valuation Trend + Category Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Panel
          title="30-day stock valuation trajectory"
          subtitle="Daily closing inventory value reconstructed from ledger movements"
          className="lg:col-span-8"
          actions={
            <Button size="sm" variant="ghost" onClick={() => onNavigate('ledger')}>
              Ledger <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          }
        >
          <LineChart
            labels={historyLabels}
            height={230}
            formatValue={(v) => compactMoney(v)}
            series={[
              {
                name: 'Stock valuation',
                data: historyValues,
                area: true,
                color: '#2563eb',
              },
            ]}
          />
        </Panel>

        <Panel
          title="Capital by category"
          subtitle="Current on-hand cost allocation"
          className="lg:col-span-4"
          actions={
            <Button size="sm" variant="ghost" onClick={() => onNavigate('abc')}>
              Pareto <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          }
        >
          <DonutChart
            segments={categorySegments}
            centerLabel="Total"
            centerValue={compactMoney(summary.stockValue)}
            formatValue={(v) => compactMoney(v)}
          />
        </Panel>
      </div>

      {/* Reorder Exception Queue + Top Usage Value */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Panel
          title="Replenishment exception queue"
          subtitle="Items at or below reorder point — ordered by urgency and annual spend"
          className="lg:col-span-7"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => onNavigate('advisor')}>
                <Sparkles className="h-3.5 w-3.5" /> Advisor ({advisor.findings.length})
              </Button>
              <Button size="sm" variant="primary" onClick={onAddProduct}>
                <Plus className="h-3.5 w-3.5" /> Add SKU
              </Button>
            </div>
          }
        >
          {actionQueue.length ? (
            <>
              <div className="md:hidden space-y-2.5">
                {actionQueue.map(({ p, m }) => (
                  <div
                    key={p.id}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenProduct(p)}
                        className="text-left min-w-0 hover:text-[var(--accent)] cursor-pointer"
                      >
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{p.name}</div>
                        <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">{p.sku}</div>
                      </button>
                      <StatusLabel status={m.status} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums pt-1.5 border-t border-slate-200/70 dark:border-slate-800">
                      <div>
                        <span className="block font-sans text-slate-600 dark:text-slate-300">On hand</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{fmtInt(p.stock)} {p.unit}</span>
                      </div>
                      <div>
                        <span className="block font-sans text-slate-600 dark:text-slate-300">ROP</span>
                        <span className="text-slate-700 dark:text-slate-200">{fmtInt(m.rop)}</span>
                      </div>
                      <div>
                        <span className="block font-sans text-slate-600 dark:text-slate-300">EOQ</span>
                        <span className="text-slate-900 dark:text-slate-100 font-semibold">{fmtInt(m.suggestedOrderQty)}</span>
                      </div>
                    </div>
                    <div className="flex justify-end pt-1">
                      <Button size="sm" variant="secondary" onClick={() => onMoveStock(p, 'in')}>
                        <PackageCheck className="h-3.5 w-3.5" /> Receive EOQ
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-600 dark:text-slate-300">
                      <th scope="col" className="pb-2 font-medium">SKU / Item</th>
                      <th scope="col" className="pb-2 font-medium">Status</th>
                      <th scope="col" className="pb-2 font-medium text-right">On hand</th>
                      <th scope="col" className="pb-2 font-medium text-right">
                        <span className="inline-flex items-center justify-end gap-1">ROP <TermTooltip termKey="rop" /></span>
                      </th>
                      <th scope="col" className="pb-2 font-medium text-right">
                        <span className="inline-flex items-center justify-end gap-1">EOQ <TermTooltip termKey="eoq" /></span>
                      </th>
                      <th scope="col" className="pb-2 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {actionQueue.map(({ p, m }) => (
                      <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 pr-3">
                          <button
                            type="button"
                            onClick={() => onOpenProduct(p)}
                            className="text-left hover:text-[var(--accent)] cursor-pointer"
                          >
                            <div className="font-medium text-slate-900 dark:text-slate-100">{p.name}</div>
                            <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">{p.sku}</div>
                          </button>
                        </td>
                        <td className="py-2.5 pr-3">
                          <StatusLabel status={m.status} />
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {fmtInt(p.stock)} {p.unit}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {fmtInt(m.rop)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                          {fmtInt(m.suggestedOrderQty)}
                        </td>
                        <td className="py-2.5 text-right">
                          <Button size="sm" variant="secondary" onClick={() => onMoveStock(p, 'in')}>
                            <PackageCheck className="h-3.5 w-3.5" /> Receive
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="py-6 text-center text-xs text-slate-600 dark:text-slate-300">
              All {fmtInt(summary.skuCount)} SKUs sit above their safety stock and reorder thresholds.
            </div>
          )}
        </Panel>

        <Panel
          title="Top annual usage items"
          subtitle="Highest annual dollar consumption & stock cover"
          className="lg:col-span-5"
          actions={
            <Button size="sm" variant="ghost" onClick={() => onNavigate('inventory')}>
              Catalogue <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          }
        >
          <div className="md:hidden space-y-2">
            {topUsage.map(({ p, m }) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProduct(p)}
                className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 p-2.5 flex items-center justify-between gap-2 cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{p.name}</div>
                  <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">{p.sku} · {fmtCover(m.monthsOfCover)} · {fmtNum(p.serviceLevel, 0)}% SL</div>
                </div>
                <div className="font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                  {fmtMoney(m.usageValue)}
                </div>
              </button>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-600 dark:text-slate-300">
                  <th scope="col" className="pb-2 font-medium">SKU</th>
                  <th scope="col" className="pb-2 font-medium text-right">Annual usage</th>
                  <th scope="col" className="pb-2 font-medium text-right">
                    <span className="inline-flex items-center justify-end gap-1">Cover <TermTooltip termKey="cover" /></span>
                  </th>
                  <th scope="col" className="pb-2 font-medium text-right">
                    <span className="inline-flex items-center justify-end gap-1">SL <TermTooltip termKey="serviceLevel" /></span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {topUsage.map(({ p, m }) => (
                  <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 pr-2">
                      <button
                        type="button"
                        onClick={() => onOpenProduct(p)}
                        className="text-left hover:text-[var(--accent)] cursor-pointer"
                      >
                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-[180px]">
                          {p.name}
                        </div>
                        <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">{p.sku}</div>
                      </button>
                    </td>
                    <td className="py-2.5 pr-2 text-right font-mono tabular-nums font-medium">
                      {fmtMoney(m.usageValue)}
                    </td>
                    <td className="py-2.5 pr-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {fmtCover(m.monthsOfCover)}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {fmtNum(p.serviceLevel, 0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {transactions.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              <span className="truncate">Latest ledger move: {transactions[0].note}</span>
              <span className="font-mono shrink-0">{relTime(transactions[0].ts)}</span>
            </div>
          )}
        </Panel>
      </div>

      {/* Interactive 3D Engineering Showcase */}
      <Panel
        title="3D Digital Twin & BOM Explorer"
        subtitle="Orbit live mechanical BOM assemblies, test exploded disassembly, or launch the full warehouse twin"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {ASSEMBLY_SKU_LIST.map((sku) => (
              <button
                key={sku}
                type="button"
                onClick={() => setPreviewSku(sku)}
                className={`px-2.5 py-1.5 min-h-[34px] sm:min-h-0 rounded-md text-[11px] font-mono transition-colors cursor-pointer ${
                  previewSku === sku
                    ? 'bg-[var(--accent)] text-white'
                    : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {sku}
              </button>
            ))}
            <Button
              size="sm"
              variant="primary"
              onClick={() => (onInspect3D ? onInspect3D(previewSku) : onNavigate('models-3d'))}
            >
              <Box className="h-3.5 w-3.5" /> Open 3D Studio
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-8">
            <LazyFactory3DViewport
              mode="assembly"
              assemblySku={previewSku}
              plantProducts={EMPTY_PLANT_PRODUCTS}
              plantStations={EMPTY_PLANT_STATIONS}
              explodeAmount={previewExplode}
              onExplodeChange={setPreviewExplode}
              finish="steel"
              theme={settings.theme}
              reduceMotion={Boolean(settings.reduceMotion)}
              compact
            />
          </div>
          <div className="lg:col-span-4 space-y-3">
            <div>
              <div className="font-mono text-xs text-[var(--accent)] font-semibold">{previewSku}</div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {ASSEMBLY_3D_SPECS[previewSku].title}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                {ASSEMBLY_3D_SPECS[previewSku].subtitle}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-xs border-y border-slate-100 dark:border-slate-800 py-3">
              <div>
                <div className="text-[11px] text-slate-600 dark:text-slate-300">Envelope</div>
                <div className="font-mono font-medium mt-0.5">
                  {ASSEMBLY_3D_SPECS[previewSku].dimensionsLabel}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-600 dark:text-slate-300">Nominal Mass</div>
                <div className="font-mono font-medium mt-0.5">
                  {ASSEMBLY_3D_SPECS[previewSku].massLabel}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPreviewExplode((v) => (v > 0.5 ? 0 : 0.85))}
              >
                {previewExplode > 0.5 ? 'Collapse Assembly' : 'Preview Exploded View'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => (onInspect3D ? onInspect3D(previewSku) : onNavigate('models-3d'))}
              >
                Full Plant Twin <ArrowRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => onNavigate('factory-sim')}
              >
                Factory Sim Lab <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
};
