import React, { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { RouteId } from '../layout/AppShell';
import { SegmentedControl } from '../ui/Primitives';
import { computeDashboardSummary } from '../../engine/dashboardSummary';
import { fmtInt, fmtMoney, fmtNum } from '../../engine/formatters';
import { Product } from '../../store/store';
import { useStore } from '../../store/StoreContext';

export const DashboardSummaryCard: React.FC<{
  onNavigate: (r: RouteId) => void;
  onOpenProduct?: (p: Product) => void;
}> = ({ onNavigate, onOpenProduct }) => {
  const { products, transactions, settings } = useStore();
  const [windowDays, setWindowDays] = useState<'7' | '30'>('30');

  const data = useMemo(
    () =>
      computeDashboardSummary(products, transactions, settings, {
        windowDays: Number(windowDays),
      }),
    [products, transactions, settings, windowDays]
  );

  const alertTone =
    data.alerts.outCount + data.alerts.criticalCount > 0
      ? 'text-rose-600 dark:text-rose-400'
      : data.alerts.totalAlerts > 0
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-emerald-600 dark:text-emerald-400';

  const deltaLabel =
    data.throughput.deltaPct == null
      ? `${fmtInt(data.throughput.txCount)} moves logged`
      : `${data.throughput.deltaPct >= 0 ? '+' : ''}${fmtNum(data.throughput.deltaPct, 0)}% vs prior ${windowDays}d`;

  const deltaTone =
    data.throughput.deltaPct == null
      ? 'text-slate-600 dark:text-slate-300'
      : data.throughput.deltaPct >= 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-amber-600 dark:text-amber-400';

  return (
    <section
      aria-label="Operations summary card"
      className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800/80">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Operations summary
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
            Live valuation, replenishment risk, and recent outbound production throughput
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] text-slate-600 dark:text-slate-300">Throughput window</span>
          <SegmentedControl
            value={windowDays}
            onChange={(v) => setWindowDays(v as '7' | '30')}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
            ]}
          />
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100 dark:divide-slate-800/80">
        {/* 1. Total Inventory Value */}
        <div className="p-4 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Total Inventory Value
              </span>
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                Catalogue <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
              {fmtMoney(data.inventory.totalValue)}
            </div>
            <div className="mt-1.5 text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums">
              {fmtInt(data.inventory.skuCount)} SKUs · {fmtInt(data.inventory.assemblyCount)} BOM assemblies
            </div>
          </div>
          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
            <span>Annual usage {fmtMoney(data.inventory.annualUsageValue)}</span>
            <span className="text-slate-700 dark:text-slate-300 font-medium">
              {data.inventory.turnoverRatio != null ? `${fmtNum(data.inventory.turnoverRatio, 1)}x turns` : '—'}
            </span>
          </div>
        </div>

        {/* 2. Low Stock Alerts */}
        <div className="p-4 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Low Stock Alerts
              </span>
              <button
                type="button"
                onClick={() => onNavigate('advisor')}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                Advisor <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
                {fmtInt(data.alerts.totalAlerts)}
              </span>
              <span className={`text-xs font-mono tabular-nums font-medium ${alertTone}`}>
                {data.alerts.totalAlerts === 0
                  ? 'All healthy'
                  : `${data.alerts.outCount} out · ${data.alerts.criticalCount} low · ${data.alerts.reorderCount} reorder`}
              </span>
            </div>
            <div className="mt-1.5 text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums truncate">
              {data.alerts.mostUrgent ? (
                onOpenProduct ? (
                  <button
                    type="button"
                    onClick={() => onOpenProduct(data.alerts.mostUrgent!.product)}
                    className="hover:text-[var(--accent)] hover:underline cursor-pointer truncate max-w-full text-left"
                  >
                    Priority: {data.alerts.mostUrgent.product.sku} ({fmtInt(data.alerts.mostUrgent.product.stock)} on hand)
                  </button>
                ) : (
                  `Priority: ${data.alerts.mostUrgent.product.sku} (${fmtInt(data.alerts.mostUrgent.product.stock)} on hand)`
                )
              ) : (
                `${fmtInt(data.inventory.healthyCount)} SKUs above reorder threshold`
              )}
            </div>
          </div>
          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
            <span>Est. replenishment PO</span>
            <span className="text-slate-700 dark:text-slate-300 font-medium">
              {fmtMoney(data.alerts.estimatedPoSpend)}
            </span>
          </div>
        </div>

        {/* 3. Recent Production Throughput */}
        <div className="p-4 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Recent Production Throughput ({windowDays}d)
              </span>
              <button
                type="button"
                onClick={() => onNavigate('production')}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                MRP <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
                {fmtInt(data.throughput.outboundUnits)}
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                units issued ({fmtNum(data.throughput.dailyUnitRate, 1)}/day)
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs font-mono tabular-nums">
              <span className="text-slate-600 dark:text-slate-300">
                {fmtMoney(data.throughput.outboundValue)} value
              </span>
              <span aria-hidden="true" className="text-slate-400">·</span>
              <span className={deltaTone}>{deltaLabel}</span>
            </div>
          </div>
          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
            <span>{fmtInt(data.throughput.workOrderCount)} work orders · +{fmtInt(data.throughput.inboundUnits)} in</span>
            <span className="text-slate-700 dark:text-slate-300 font-medium">
              {fmtMoney(data.throughput.inboundValue)} recv
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
