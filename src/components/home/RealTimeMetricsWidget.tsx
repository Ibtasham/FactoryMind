import React, { useMemo } from 'react';
import { Activity, AlertTriangle, ArrowRight, Clock, DollarSign, History, PackageCheck } from 'lucide-react';
import { RouteId } from '../layout/AppShell';
import { fmtInt, fmtMoney } from '../../engine/formatters';
import { computeRealTimeMetricsWidget, RealTimeAlertItem } from '../../engine/homeData';
import { Product } from '../../store/store';
import { useStore } from '../../store/StoreContext';

interface RealTimeMetricsWidgetProps {
  onNavigate: (r: RouteId) => void;
  onOpenProduct: (p: Product) => void;
}

function severityStyle(severity: RealTimeAlertItem['severity']): string {
  switch (severity) {
    case 'out':
    case 'critical':
      return 'text-rose-700 dark:text-rose-400';
    case 'reorder':
    case 'forecast':
      return 'text-amber-700 dark:text-amber-400';
  }
}

export const RealTimeMetricsWidget: React.FC<RealTimeMetricsWidgetProps> = ({
  onNavigate,
  onOpenProduct,
}) => {
  const {
    products,
    transactions,
    summary,
    metricsOf,
    visibleSmartAlerts,
    factorySimConfig,
    getProduct,
  } = useStore();

  const data = useMemo(
    () =>
      computeRealTimeMetricsWidget({
        products,
        transactions,
        summary,
        metricsOf,
        visibleSmartAlerts,
        factorySimConfig,
      }),
    [products, transactions, summary, metricsOf, visibleSmartAlerts, factorySimConfig]
  );

  return (
    <section
      aria-labelledby="realtime-metrics-heading"
      data-testid="realtime-metrics-widget"
      className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-14"
    >
      <div className="rounded-2xl border border-slate-200 dark:border-[#1c2b23] bg-white dark:bg-[#0d1511] p-5 sm:p-6 shadow-sm">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4 pb-5 border-b border-slate-200/80 dark:border-[#1a2820]">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.12em] font-semibold text-[var(--accent)]">
              <Activity className="h-3.5 w-3.5 shrink-0" />
              <span>LIVE STORE TELEMETRY</span>
            </div>
            <h2
              id="realtime-metrics-heading"
              className="text-xl sm:text-2xl font-bold tracking-tight text-slate-950 dark:text-white mt-1"
            >
              Real-time Metrics
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
              Calculated directly from active catalog stock, supplier lead times, and production alerts.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="font-semibold text-[var(--accent)] hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Manage Inventory</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('advisor')}
              className="font-semibold text-slate-700 dark:text-slate-200 hover:text-[var(--accent)] inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Open Advisor</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 4 Operational KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mt-5">
          <div className="rounded-xl border border-slate-200/80 dark:border-[#1a2820] bg-slate-50/75 dark:bg-[#080d0a] p-4">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span>Total Inventory Value</span>
              <DollarSign className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
            </div>
            <div className="font-display text-2xl font-bold tabular-nums text-slate-950 dark:text-white mt-2">
              {fmtMoney(data.totalInventoryValue, 0)}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400 mt-1">
              {fmtMoney(data.annualUsageValue, 0)} annual usage · {fmtInt(data.skuCount)} SKUs
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/80 dark:border-[#1a2820] bg-slate-50/75 dark:bg-[#080d0a] p-4">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span>Average Lead Time</span>
              <Clock className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
            </div>
            <div className="font-display text-2xl font-bold tabular-nums text-slate-950 dark:text-white mt-2">
              {data.avgLeadTimeDays.toFixed(1)} days
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400 mt-1">
              Supplier span {fmtInt(data.minLeadTimeDays)}–{fmtInt(data.maxLeadTimeDays)}d
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/80 dark:border-[#1a2820] bg-slate-50/75 dark:bg-[#080d0a] p-4">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span>Production &amp; Stock Alerts</span>
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            </div>
            <div className="font-display text-2xl font-bold tabular-nums text-slate-950 dark:text-white mt-2">
              {fmtInt(data.totalAlertSignals)} active
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400 mt-1">
              {fmtInt(data.outCount)} out · {fmtInt(data.criticalCount)} critical · {fmtInt(data.reorderCount)} reorder
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/80 dark:border-[#1a2820] bg-slate-50/75 dark:bg-[#080d0a] p-4">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span>Catalog Health Ratio</span>
              <PackageCheck className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
            </div>
            <div className="font-display text-2xl font-bold tabular-nums text-[var(--accent)] mt-2">
              {data.healthySkuPct.toFixed(0)}% nominal
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400 mt-1">
              {fmtInt(data.okCount)}/{fmtInt(data.skuCount)} OK · {fmtInt(data.workstationsCount)} DES stations
            </div>
          </div>
        </div>

        {/* Recent Production & Inventory Alerts List */}
        <div className="mt-5 rounded-xl border border-slate-200/80 dark:border-[#1a2820] bg-slate-50/60 dark:bg-[#080d0a] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200/80 dark:border-[#1a2820] flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Recent Production &amp; Inventory Alerts
            </span>
            <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
              {data.recentAlerts.length > 0
                ? `Top ${data.recentAlerts.length} prioritized SKUs`
                : 'No active exceptions'}
            </span>
          </div>

          {data.recentAlerts.length > 0 ? (
            <div className="divide-y divide-slate-200/70 dark:divide-[#16221c]">
              {data.recentAlerts.map((alert) => (
                <button
                  key={alert.id}
                  type="button"
                  onClick={() => {
                    const found = getProduct(alert.productId);
                    if (found) onOpenProduct(found);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-slate-100/80 dark:hover:bg-[#111c16] transition-colors flex flex-wrap items-center justify-between gap-2 cursor-pointer"
                >
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-w-0">
                    <span className={`font-mono text-[11px] font-semibold uppercase tracking-wide shrink-0 sm:w-20 ${severityStyle(alert.severity)}`}>
                      {alert.severityLabel}
                    </span>
                    <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white whitespace-nowrap shrink-0">
                      {alert.sku}
                    </span>
                    <span className="text-xs text-slate-600 dark:text-slate-300 truncate">
                      {alert.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {alert.metricSummary}
                    </span>
                    <span className="text-[11px] font-semibold text-[var(--accent)]">Inspect →</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4 py-4 text-xs text-slate-600 dark:text-slate-300">
              All catalogued SKUs are above safety thresholds and lead-time cover targets.
            </div>
          )}

          {/* Latest Ledger Movement Footer */}
          {data.latestMove && (
            <div className="px-4 py-2.5 border-t border-slate-200/80 dark:border-[#1a2820] bg-white/60 dark:bg-[#0b120e] flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0 text-slate-600 dark:text-slate-300">
                <History className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                <span className="truncate">
                  Latest movement:{' '}
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    {data.latestMove.type === 'in' ? '+' : '-'}
                    {fmtInt(data.latestMove.qty)} {data.latestMove.unit}
                  </span>{' '}
                  · {data.latestMove.sku} ({data.latestMove.note})
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('ledger')}
                className="text-[11px] font-semibold text-[var(--accent)] hover:underline shrink-0 cursor-pointer"
              >
                View Stock Ledger →
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
