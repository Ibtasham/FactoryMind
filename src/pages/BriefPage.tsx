import React, { useMemo } from 'react';
import { Compass, Copy, Download, Printer } from 'lucide-react';
import { RouteId } from '../components/layout/AppShell';
import { Button, downloadFile } from '../components/ui/Primitives';
import { briefHeadline, briefIssue, briefModel, briefParagraph, briefText } from '../engine/advisor';
import { fmtInt, fmtMoney, fmtNum } from '../engine/formatters';
import { useStore } from '../store/StoreContext';

export const BriefPage: React.FC<{ onNavigate: (r: RouteId) => void }> = ({ onNavigate }) => {
  const { products, transactions, summary, settings, metricsOf, pushToast } = useStore();

  const rows = useMemo(() => products.map((p) => ({ p, m: metricsOf(p) })), [products, metricsOf]);
  const model = useMemo(() => briefModel(rows, transactions, summary, settings), [rows, transactions, summary, settings]);

  const headline = briefHeadline(model);
  const paragraph = briefParagraph(model);
  const plainText = useMemo(() => briefText(model), [model]);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(plainText);
      pushToast({ type: 'success', message: 'Executive brief copied to clipboard.' });
    } catch {
      pushToast({ type: 'info', message: 'Clipboard blocked — use Download .txt instead.' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Policy in force:{' '}
          <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
            {fmtNum(model.policy.cover, 1)} mo cover · {fmtNum(model.policy.band[0], 1)}–{fmtNum(model.policy.band[1], 1)}% service band
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => onNavigate('advisor')}>
            <Compass className="h-3.5 w-3.5" /> Adjust policy in Advisor
          </Button>
          <Button size="sm" variant="secondary" onClick={copySummary}>
            <Copy className="h-3.5 w-3.5" /> Copy text
          </Button>
          <Button size="sm" variant="secondary" onClick={() => downloadFile('factorymind-executive-brief.txt', plainText)}>
            <Download className="h-3.5 w-3.5" /> Download .txt
          </Button>
          <Button size="sm" variant="primary" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" /> Print / Save PDF
          </Button>
        </div>
      </div>

      {/* Board Document Sheet */}
      <article className="max-w-4xl mx-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white text-slate-900 p-6 sm:p-10 shadow-sm space-y-7">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
              FactoryMind · Operations Briefing
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-950 mt-1">
              Executive Inventory Brief
            </h2>
            <p className="text-xs text-slate-500 mt-1">{model.generated} · Plant Operations</p>
          </div>

          <div className="text-left sm:text-right">
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
              Health Index
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-950">
              {model.health.score}/100{' '}
              <span className="text-sm font-semibold text-slate-600">· {model.health.label}</span>
            </div>
          </div>
        </header>

        <section className="space-y-2">
          <h3 className="text-base font-semibold text-slate-900">{headline}</h3>
          <p className="text-sm leading-relaxed text-slate-700">{paragraph}</p>
        </section>

        <section className="grid grid-cols-2 sm:grid-cols-5 gap-4 py-4 border-y border-slate-200">
          <div>
            <div className="text-[11px] text-slate-500">Inventory at cost</div>
            <div className="text-base font-semibold font-mono tabular-nums mt-0.5">{fmtMoney(model.summary.stockValue)}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Cash above target</div>
            <div className="text-base font-semibold font-mono tabular-nums mt-0.5">{fmtMoney(model.totals.parkedCash)}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Replenishment due</div>
            <div className="text-base font-semibold font-mono tabular-nums mt-0.5">{fmtMoney(model.totals.orderValue)}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Annual SL saving</div>
            <div className="text-base font-semibold font-mono tabular-nums mt-0.5">{fmtMoney(model.totals.annualSaving)}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Weighted service</div>
            <div className="text-base font-semibold font-mono tabular-nums mt-0.5">{fmtNum(model.service, 1)}%</div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
              Priority Decisions
            </h3>
            <span className="text-xs font-mono text-slate-500">
              {model.belowRop} SKU(s) at or below reorder point
            </span>
          </div>

          {model.decisions.length ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] text-slate-500">
                  <th className="pb-2 font-medium">SKU</th>
                  <th className="pb-2 font-medium">Item</th>
                  <th className="pb-2 font-medium">Issue</th>
                  <th className="pb-2 font-medium text-right">Financial impact</th>
                  <th className="pb-2 font-medium text-right">Recommended action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {model.decisions.map((f) => (
                  <tr key={f.id}>
                    <td className="py-2.5 pr-3 font-mono text-slate-500">{f.sku}</td>
                    <td className="py-2.5 pr-3 font-medium text-slate-900">{f.product.name}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{briefIssue(f)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                      {f.money != null ? fmtMoney(f.money) : '—'}
                    </td>
                    <td className="py-2.5 text-right font-medium text-slate-800">{f.action.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-slate-500">None. Every item is inside policy.</p>
          )}

          {model.remaining > 0 && (
            <p className="text-xs text-slate-500">+ {fmtInt(model.remaining)} additional findings audited in Advisor.</p>
          )}
        </section>

        <footer className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500 font-mono">
          <span>
            Policy: {fmtNum(model.policy.cover, 1)} months cover · {fmtNum(model.policy.band[0], 1)}–{fmtNum(model.policy.band[1], 1)}% service band
          </span>
          <span>FactoryMind Operations Workbench · Made by Md Ibtashamur Rahman</span>
        </footer>
      </article>
    </div>
  );
};
