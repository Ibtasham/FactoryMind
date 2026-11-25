import React, { useMemo } from 'react';
import { Download } from 'lucide-react';
import { DonutChart, ParetoChart } from '../components/charts/Charts';
import { Button, downloadFile, EmptyState, Panel, StatCard } from '../components/ui/Primitives';
import { compactMoney, fmtInt, fmtMoney, fmtNum } from '../engine/formatters';
import { ABC_ADVICE, abcAnalysis, abcSummary } from '../engine/ipe';
import { Product, toCSV } from '../store/store';
import { useStore } from '../store/StoreContext';

export const AbcPage: React.FC<{ onOpenProduct: (p: Product) => void }> = ({ onOpenProduct }) => {
  const { products, settings, setSetting } = useStore();

  const aThreshold = settings.abcA || 70;
  const bThreshold = settings.abcB || 90;

  const abcRows = useMemo(
    () => abcAnalysis(products, { aThreshold, bThreshold }),
    [products, aThreshold, bThreshold]
  );
  const summary = useMemo(() => abcSummary(abcRows), [abcRows]);

  const exportAbcCsv = () => {
    const csv = toCSV(
      ['Rank', 'SKU', 'Name', 'Category', 'Class', 'AnnualUsage', 'SharePct', 'CumPct'],
      abcRows.map((r) => [
        r.rank,
        r.sku,
        r.name,
        r.category,
        r.cls,
        r.usage.toFixed(2),
        r.pct.toFixed(2),
        r.cumPct.toFixed(2),
      ])
    );
    downloadFile('factorymind-abc-pareto.csv', csv, 'text/csv');
  };

  if (!products.length) {
    return (
      <EmptyState
        title="No SKUs for Pareto ranking"
        message="Add products with unit cost and annual demand to compute ABC consumption tiers."
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Threshold Controls + Class Cards */}
      <Panel
        title="Pareto cutoff thresholds"
        subtitle="Cumulative annual usage cutoffs persist automatically across sessions"
        actions={
          <Button size="sm" variant="secondary" onClick={exportAbcCsv}>
            <Download className="h-3.5 w-3.5" /> Export ABC CSV
          </Button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="font-medium text-slate-700 dark:text-slate-300">Class A cutoff</span>
              <span className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                Top {aThreshold}% usage
              </span>
            </div>
            <input
              type="range"
              aria-label="Class A cumulative usage cutoff percent"
              min={50}
              max={85}
              step={5}
              value={aThreshold}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSetting('abcA', v);
                if (bThreshold <= v) setSetting('abcB', Math.min(98, v + 10));
              }}
              className="w-full accent-blue-600"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="font-medium text-slate-700 dark:text-slate-300">Class B cutoff</span>
              <span className="font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                Up to {bThreshold}% usage
              </span>
            </div>
            <input
              type="range"
              aria-label="Class B cumulative usage cutoff percent"
              min={Math.min(95, aThreshold + 5)}
              max={98}
              step={2}
              value={bThreshold}
              onChange={(e) => setSetting('abcB', Number(e.target.value))}
              className="w-full accent-emerald-600"
            />
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        <StatCard
          label={`Class A · ${summary.A.count} SKUs (${fmtNum(summary.A.countPct, 0)}%)`}
          termKey="abcPareto"
          value={fmtMoney(summary.A.usage)}
          sub={`${fmtNum(summary.A.usagePct, 1)}% of usage · ${ABC_ADVICE.A}`}
        />
        <StatCard
          label={`Class B · ${summary.B.count} SKUs (${fmtNum(summary.B.countPct, 0)}%)`}
          value={fmtMoney(summary.B.usage)}
          sub={`${fmtNum(summary.B.usagePct, 1)}% of usage · ${ABC_ADVICE.B}`}
        />
        <StatCard
          label={`Class C · ${summary.C.count} SKUs (${fmtNum(summary.C.countPct, 0)}%)`}
          value={fmtMoney(summary.C.usage)}
          sub={`${fmtNum(summary.C.usagePct, 1)}% of usage · ${ABC_ADVICE.C}`}
        />
      </div>

      {/* Pareto & Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Panel title="ABC Pareto curve" subtitle="Ranked annual usage spend & cumulative percentage" className="lg:col-span-8">
          <ParetoChart
            labels={abcRows.map((r) => r.sku)}
            values={abcRows.map((r) => r.usage)}
            cumPct={abcRows.map((r) => r.cumPct)}
            classes={abcRows.map((r) => r.cls)}
            aThreshold={aThreshold}
            bThreshold={bThreshold}
            formatValue={(v) => compactMoney(v)}
          />
        </Panel>

        <Panel title="Annual spend share" subtitle={`Total ${fmtMoney(summary.total)}`} className="lg:col-span-4">
          <DonutChart
            centerLabel="Annual"
            centerValue={compactMoney(summary.total)}
            formatValue={(v) => compactMoney(v)}
            segments={[
              { label: `Class A (${summary.A.count})`, value: summary.A.usage, color: '#2563eb' },
              { label: `Class B (${summary.B.count})`, value: summary.B.usage, color: '#10b981' },
              { label: `Class C (${summary.C.count})`, value: summary.C.usage, color: '#94a3b8' },
            ]}
          />
        </Panel>
      </div>

      {/* Ranked Table */}
      <Panel title="Ranked SKU breakdown" subtitle="Sorted descending by annual consumption value (Unit cost × Annual demand)">
        <div className="md:hidden space-y-2">
          {abcRows.map((r) => {
            const clsColor =
              r.cls === 'A'
                ? 'text-blue-700 dark:text-blue-400 font-semibold'
                : r.cls === 'B'
                  ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                  : 'text-slate-600 dark:text-slate-300';
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpenProduct(r.ref)}
                className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 p-3 space-y-1.5 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      #{r.rank} · {r.name}
                    </div>
                    <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">{r.sku}</div>
                  </div>
                  <span className={`font-mono text-xs shrink-0 ${clsColor}`}>Class {r.cls}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums pt-1 border-t border-slate-200/70 dark:border-slate-800">
                  <div>
                    <span className="block font-sans text-slate-600 dark:text-slate-300">Annual usage</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{fmtMoney(r.usage)}</span>
                  </div>
                  <div>
                    <span className="block font-sans text-slate-600 dark:text-slate-300">Share</span>
                    <span>{fmtNum(r.pct, 1)}%</span>
                  </div>
                  <div>
                    <span className="block font-sans text-slate-600 dark:text-slate-300">Cumulative</span>
                    <span>{fmtNum(r.cumPct, 1)}%</span>
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
                <th scope="col" className="pb-2 font-medium">#</th>
                <th scope="col" className="pb-2 font-medium">SKU / Product</th>
                <th scope="col" className="pb-2 font-medium">Class</th>
                <th scope="col" className="pb-2 font-medium text-right">Annual demand</th>
                <th scope="col" className="pb-2 font-medium text-right">Unit cost</th>
                <th scope="col" className="pb-2 font-medium text-right">Annual usage</th>
                <th scope="col" className="pb-2 font-medium text-right">Share</th>
                <th scope="col" className="pb-2 font-medium text-right">Cumulative</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {abcRows.map((r) => {
                const clsColor =
                  r.cls === 'A'
                    ? 'text-blue-700 dark:text-blue-400 font-semibold'
                    : r.cls === 'B'
                      ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-300';
                return (
                  <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-2 pr-3 font-mono text-slate-500 dark:text-slate-400">{r.rank}</td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => onOpenProduct(r.ref)}
                        className="text-left hover:text-[var(--accent)] cursor-pointer"
                      >
                        <span className="font-mono text-slate-600 dark:text-slate-300 mr-2">{r.sku}</span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">{r.name}</span>
                      </button>
                    </td>
                    <td className={`py-2 pr-3 font-mono ${clsColor}`}>{r.cls}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtInt(r.ref.annualDemand)}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtMoney(r.ref.unitCost, 2)}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums font-medium">{fmtMoney(r.usage)}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">{fmtNum(r.pct, 1)}%</td>
                    <td className="py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                      {fmtNum(r.cumPct, 1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
};
