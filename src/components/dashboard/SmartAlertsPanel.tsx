import React, { useMemo, useState } from 'react';
import { ArrowRight, BellRing, Check, PackageCheck, RotateCcw } from 'lucide-react';
import { RouteId } from '../layout/AppShell';
import { Button, Panel, SegmentedControl } from '../ui/Primitives';
import { fmtInt, fmtMoney, shortDate } from '../../engine/formatters';
import {
  SmartAlertSeverity,
  SmartAlertsResult,
  SmartStockAlert,
} from '../../engine/smartAlerts';
import { Product } from '../../store/store';

type SeverityFilter = 'all' | 'urgent' | 'warning' | 'watch';

const SEVERITY_STYLES: Record<SmartAlertSeverity, { label: string; textClass: string }> = {
  imminent: {
    label: 'Imminent stockout',
    textClass: 'text-rose-600 dark:text-rose-400',
  },
  critical: {
    label: 'Critical · before lead time',
    textClass: 'text-rose-600 dark:text-rose-400',
  },
  warning: {
    label: 'Reorder soon',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  watch: {
    label: 'Trending watch',
    textClass: 'text-sky-600 dark:text-sky-400',
  },
};

const BAR_FILL_COLORS: Record<SmartAlertSeverity, string> = {
  imminent: 'bg-rose-500',
  critical: 'bg-rose-500',
  warning: 'bg-amber-500',
  watch: 'bg-sky-500',
};

export const SmartAlertsPanel: React.FC<{
  result: SmartAlertsResult;
  horizonDays: number;
  onHorizonChange: (days: number) => void;
  dismissedIds: string[];
  onDismiss: (id: string) => void;
  onRestoreAll: () => void;
  onOpenProduct: (p: Product) => void;
  onMoveStock: (p: Product, type: 'in' | 'out') => void;
  onNavigate: (r: RouteId) => void;
}> = ({
  result,
  horizonDays,
  onHorizonChange,
  dismissedIds,
  onDismiss,
  onRestoreAll,
  onOpenProduct,
  onMoveStock,
  onNavigate,
}) => {
  const [filter, setFilter] = useState<SeverityFilter>('all');
  const [showAllRows, setShowAllRows] = useState(false);

  const dismissedSet = useMemo(() => new Set(dismissedIds), [dismissedIds]);

  const activeAlerts = useMemo(
    () => result.alerts.filter((al) => !dismissedSet.has(al.id)),
    [result.alerts, dismissedSet]
  );

  const acknowledgedCount = result.alerts.length - activeAlerts.length;

  const counts = useMemo(() => {
    let urgent = 0;
    let warning = 0;
    let watch = 0;
    for (const al of activeAlerts) {
      if (al.severity === 'imminent' || al.severity === 'critical') urgent++;
      else if (al.severity === 'warning') warning++;
      else watch++;
    }
    return { all: activeAlerts.length, urgent, warning, watch };
  }, [activeAlerts]);

  const filteredAlerts = useMemo(() => {
    if (filter === 'all') return activeAlerts;
    if (filter === 'urgent') {
      return activeAlerts.filter((a) => a.severity === 'imminent' || a.severity === 'critical');
    }
    return activeAlerts.filter((a) => a.severity === filter);
  }, [activeAlerts, filter]);

  const visibleAlerts = showAllRows ? filteredAlerts : filteredAlerts.slice(0, 5);

  const filterButtons: Array<{ id: SeverityFilter; label: string; count: number }> = [
    { id: 'all', label: 'All predictions', count: counts.all },
    { id: 'urgent', label: 'Critical / Lead-time risk', count: counts.urgent },
    { id: 'warning', label: 'Within horizon', count: counts.warning },
    { id: 'watch', label: 'Demand surge watch', count: counts.watch },
  ];

  return (
    <section aria-label="Smart Alerts predictive stockout notifications">
      <Panel
        title="Smart Alerts — Predictive Stockout Early Warning"
        subtitle={`Forecasting stock depletion across the next ${horizonDays} days using backtested demand curves and supplier lead times`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              value={String(horizonDays)}
              onChange={(v) => onHorizonChange(Number(v))}
              options={[
                { value: '30', label: '30d horizon' },
                { value: '45', label: '45d horizon' },
                { value: '60', label: '60d horizon' },
              ]}
            />
            <Button size="sm" variant="ghost" onClick={() => onNavigate('forecast')}>
              Forecast Lab <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      >
        {/* Summary Telemetry Strip & Filter Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter smart alerts">
            {filterButtons.map((btn) => {
              const selected = filter === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setFilter(btn.id)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    selected
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {btn.label}{' '}
                  <span className="font-mono tabular-nums text-[11px] opacity-80">
                    ({btn.count})
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono tabular-nums">
              <strong className="font-semibold text-slate-900 dark:text-slate-100">
                {result.summary.beforeLeadTimeCount}
              </strong>{' '}
              run out before supplier lead time
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Buffer PO{' '}
              <strong className="font-semibold text-slate-900 dark:text-slate-100">
                {fmtMoney(result.summary.atRiskOrderValue)}
              </strong>
            </span>
            {acknowledgedCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={onRestoreAll}
                  className="inline-flex items-center gap-1 text-[var(--accent)] font-medium hover:underline cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" /> Restore {acknowledgedCount} acknowledged
                </button>
              </>
            )}
          </div>
        </div>

        {/* Predictive Stockout Feed */}
        {visibleAlerts.length > 0 ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {visibleAlerts.map((alert: SmartStockAlert) => {
              const sev = SEVERITY_STYLES[alert.severity];
              const scaleMax = Math.max(horizonDays, alert.leadTimeDays * 1.4, alert.daysUntilStockout + 5);
              const stockoutPct = Math.max(2, Math.min(100, (alert.daysUntilStockout / scaleMax) * 100));
              const leadPct = Math.max(4, Math.min(96, (alert.leadTimeDays / scaleMax) * 100));

              return (
                <div
                  key={alert.id}
                  data-testid={`smart-alert-${alert.product.sku}`}
                  className="py-3.5 first:pt-4 last:pb-1 grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4 items-center"
                >
                  {/* SKU Identity + Prediction Diagnosis */}
                  <div className="lg:col-span-5 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`font-semibold ${sev.textClass}`}>{sev.label}</span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {alert.forecastModel} ({alert.confidencePct}% fit)
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenProduct(alert.product)}
                      className="text-left group cursor-pointer block max-w-full"
                    >
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 group-hover:text-[var(--accent)] transition-colors">
                        {alert.product.name}
                      </span>{' '}
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                        {alert.product.sku}
                      </span>
                    </button>

                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {alert.reason}
                    </p>
                  </div>

                  {/* Forecast Runway Gauge vs Supplier Lead Time */}
                  <div className="lg:col-span-4 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                      <span className="text-slate-700 dark:text-slate-200 font-medium">
                        Zero in {alert.daysUntilStockout <= 0.5 ? '<1d' : `${alert.daysUntilStockout.toFixed(1)}d`}
                        <span className="text-slate-400 font-normal">
                          {' '}
                          ({shortDate(alert.predictedStockoutTs)})
                        </span>
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        LT {alert.leadTimeDays}d
                      </span>
                    </div>

                    <div className="relative h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${BAR_FILL_COLORS[alert.severity]}`}
                        style={{ width: `${stockoutPct}%` }}
                      />
                      <div
                        title={`Supplier lead time: ${alert.leadTimeDays} days`}
                        className="absolute top-0 bottom-0 w-0.5 bg-slate-900/70 dark:bg-white/80"
                        style={{ left: `${leadPct}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      <span>
                        Stock {fmtInt(alert.product.stock)} {alert.product.unit} · {Math.round(alert.forecastDailyDemand)}/day burn
                      </span>
                      <span
                        className={
                          alert.demandShiftPct >= 5
                            ? 'text-amber-600 dark:text-amber-400 font-medium'
                            : ''
                        }
                      >
                        {alert.demandShiftPct >= 0 ? '+' : ''}
                        {Math.round(alert.demandShiftPct)}% demand
                      </span>
                    </div>
                  </div>

                  {/* Operational Actions */}
                  <div className="lg:col-span-3 flex items-center justify-start lg:justify-end gap-2">
                    <Button
                      size="sm"
                      variant={alert.runsOutBeforeLeadTime ? 'primary' : 'secondary'}
                      onClick={() => onMoveStock(alert.product, 'in')}
                    >
                      <PackageCheck className="h-3.5 w-3.5" /> Receive +{fmtInt(alert.recommendedOrderQty)}
                    </Button>
                    <button
                      type="button"
                      aria-label={`Acknowledge alert for ${alert.product.sku}`}
                      title="Acknowledge notification"
                      onClick={() => onDismiss(alert.id)}
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span className="sr-only sm:not-sr-only">Ack</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 flex flex-col items-center justify-center text-center gap-2">
            <BellRing className="h-5 w-5 text-emerald-500" />
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {activeAlerts.length === 0 && acknowledgedCount > 0
                ? 'All predicted stockout alerts acknowledged'
                : 'No predicted stockouts in this filter'}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
              {acknowledgedCount > 0
                ? 'You can restore acknowledged notifications anytime or widen the forecast horizon.'
                : `Current forecasted consumption keeps all SKUs stocked beyond the ${horizonDays}-day window.`}
            </p>
          </div>
        )}

        {filteredAlerts.length > 5 && (
          <div className="pt-3 mt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              Showing {visibleAlerts.length} of {filteredAlerts.length} forecasted risks
            </span>
            <button
              type="button"
              onClick={() => setShowAllRows((v) => !v)}
              className="font-medium text-[var(--accent)] hover:underline cursor-pointer"
            >
              {showAllRows ? 'Show top 5 alerts' : `Show all ${filteredAlerts.length} predictions`}
            </button>
          </div>
        )}
      </Panel>
    </section>
  );
};
