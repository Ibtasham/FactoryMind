import React, { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { BarChart } from '../components/charts/Charts';
import { Button, downloadFile, Input, Panel, SegmentedControl, Select, StatCard } from '../components/ui/Primitives';
import { fmtInt, fmtMoney, relTime, shortDate } from '../engine/formatters';
import { useStore } from '../store/StoreContext';

export const LedgerPage: React.FC = () => {
  const { products, transactions, getProduct, flowHistory, exportTransactionsCSV } = useStore();
  const [typeFilter, setTypeFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [query, setQuery] = useState('');

  const flow = useMemo(() => flowHistory(30), [flowHistory]);

  const totals = useMemo(() => {
    let inUnits = 0;
    let outUnits = 0;
    let inValue = 0;
    let outValue = 0;
    transactions.forEach((t) => {
      const p = getProduct(t.productId);
      const val = (p?.unitCost || 0) * t.qty;
      if (t.type === 'in') {
        inUnits += t.qty;
        inValue += val;
      } else {
        outUnits += t.qty;
        outValue += val;
      }
    });
    return { inUnits, outUnits, inValue, outValue };
  }, [transactions, getProduct]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (productFilter !== 'all' && t.productId !== productFilter) return false;
      if (q) {
        const p = getProduct(t.productId);
        const hay = `${p?.sku || ''} ${p?.name || ''} ${t.note}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, typeFilter, productFilter, query, getProduct]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard label="Recorded movements" value={fmtInt(transactions.length)} sub="Audit log entries" />
        <StatCard label="Total received" value={fmtInt(totals.inUnits)} sub={fmtMoney(totals.inValue)} tone="good" />
        <StatCard label="Total issued" value={fmtInt(totals.outUnits)} sub={fmtMoney(totals.outValue)} />
        <StatCard
          label="Net unit flow"
          value={`${totals.inUnits - totals.outUnits >= 0 ? '+' : '−'}${fmtInt(Math.abs(totals.inUnits - totals.outUnits))}`}
          sub="Inbound minus outbound"
        />
      </div>

      <Panel
        title="30-day stock flow (Units received vs issued)"
        subtitle="Daily aggregated inbound receipts and shop-floor issues"
        actions={
          <Button size="sm" variant="secondary" onClick={() => downloadFile('factorymind-ledger.csv', exportTransactionsCSV(), 'text/csv')}>
            <Download className="h-3.5 w-3.5" /> Export Ledger CSV
          </Button>
        }
      >
        <BarChart
          labels={flow.map((f) => shortDate(f.ts))}
          height={210}
          series={[
            { name: 'Received', data: flow.map((f) => f.inn), color: '#10b981' },
            { name: 'Issued', data: flow.map((f) => f.out), color: '#f59e0b' },
          ]}
        />
      </Panel>

      <Panel title="Transaction audit trail" subtitle={`${filtered.length} matching entries`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-60">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search note or SKU..." className="pl-8 font-sans" />
            </div>
            <div className="w-56">
              <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
                <option value="all">All SKUs</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {p.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <SegmentedControl
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'in', label: 'Receipts' },
              { value: 'out', label: 'Issues' },
            ]}
          />
        </div>

        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">SKU / Item</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium text-right">Quantity</th>
                <th className="pb-2 font-medium text-right">Value</th>
                <th className="pb-2 font-medium">Reference note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filtered.map((t) => {
                const p = getProduct(t.productId);
                return (
                  <tr key={t.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-2 pr-3 font-mono text-slate-500 whitespace-nowrap">
                      {shortDate(t.ts)} · {relTime(t.ts)}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-mono text-slate-500 mr-2">{p?.sku || '—'}</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{p?.name || 'Removed SKU'}</span>
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      <span className={t.type === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                        {t.type === 'in' ? 'RECEIPT' : 'ISSUE'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums font-medium">
                      {t.type === 'in' ? '+' : '−'}
                      {fmtInt(t.qty)} {p?.unit || ''}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-500">
                      {fmtMoney((p?.unitCost || 0) * t.qty)}
                    </td>
                    <td className="py-2 text-slate-600 dark:text-slate-300">{t.note}</td>
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
