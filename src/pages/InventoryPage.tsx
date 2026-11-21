import React, { useMemo, useRef, useState } from 'react';
import { Download, Edit3, Eye, PackageMinus, PackagePlus, Plus, Search, Trash2, Upload } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DatasetProvenanceIndicator,
  downloadFile,
  EmptyState,
  Input,
  Panel,
  SegmentedControl,
  Select,
  StatusLabel,
} from '../components/ui/Primitives';
import { fmtCover, fmtInt, fmtMoney } from '../engine/formatters';
import { Product } from '../store/store';
import { useStore } from '../store/StoreContext';

export const InventoryPage: React.FC<{
  onAddProduct: () => void;
  onEditProduct: (p: Product) => void;
  onOpenProduct: (p: Product) => void;
  onMoveStock: (p: Product, type: 'in' | 'out') => void;
}> = ({ onAddProduct, onEditProduct, onOpenProduct, onMoveStock }) => {
  const {
    products,
    datasetProvenance,
    categories,
    metricsOf,
    deleteProductWithUndo,
    exportProductsCSV,
    csvTemplate,
    importProductsCSV,
    pushToast,
  } = useStore();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'sku' | 'stock' | 'value' | 'usage' | 'cover'>('usage');
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const catList = useMemo(() => categories(), [categories]);

  const rows = useMemo(() => products.map((p) => ({ p, m: metricsOf(p) })), [products, metricsOf]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter(({ p, m }) => {
        if (
          q &&
          !p.sku.toLowerCase().includes(q) &&
          !p.name.toLowerCase().includes(q) &&
          !p.category.toLowerCase().includes(q)
        ) {
          return false;
        }
        if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
        if (statusFilter === 'ok' && m.status !== 'ok') return false;
        if (statusFilter === 'action' && m.status === 'ok') return false;
        if (statusFilter === 'out' && m.status !== 'out') return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'sku') return a.p.sku.localeCompare(b.p.sku);
        if (sortBy === 'stock') return b.p.stock - a.p.stock;
        if (sortBy === 'value') return b.m.stockValue - a.m.stockValue;
        if (sortBy === 'cover') return a.m.monthsOfCover - b.m.monthsOfCover;
        return b.m.usageValue - a.m.usageValue;
      });
  }, [rows, query, statusFilter, categoryFilter, sortBy]);

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const res = importProductsCSV(String(reader.result || ''));
        pushToast({
          type: 'success',
          message: `Imported CSV: ${res.created} created, ${res.updated} updated${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}.`,
        });
      } catch (err) {
        pushToast({ type: 'error', message: (err as Error).message });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-4">
      <DatasetProvenanceIndicator provenance={datasetProvenance} />

      <Panel
        title="SKU catalogue"
        subtitle={`${filtered.length} of ${products.length} items shown · click any SKU for demand history & ledger`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvFile} />
            <Button size="sm" variant="secondary" onClick={() => downloadFile('factorymind-template.csv', csvTemplate(), 'text/csv')}>
              Template
            </Button>
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Import CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={() => downloadFile('factorymind-inventory.csv', exportProductsCSV(), 'text/csv')}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button size="sm" variant="primary" onClick={onAddProduct}>
              <Plus className="h-3.5 w-3.5" /> Add SKU
            </Button>
          </div>
        }
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative w-full sm:w-64">
              <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <Input
                value={query}
                aria-label="Filter inventory SKUs"
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search SKU, name, category..."
                className="pl-8 font-sans"
              />
            </div>

            <div className="w-40">
              <Select aria-label="Filter by category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">All categories</option>
                {catList.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>

            <div className="w-40">
              <Select aria-label="Sort inventory catalogue" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                <option value="usage">Sort: Annual usage</option>
                <option value="value">Sort: Stock value</option>
                <option value="cover">Sort: Lowest cover</option>
                <option value="stock">Sort: Stock qty</option>
                <option value="sku">Sort: SKU</option>
              </Select>
            </div>
          </div>

          <SegmentedControl
            ariaLabel="Filter by replenishment status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'ok', label: 'Healthy' },
              { value: 'action', label: 'To action' },
              { value: 'out', label: 'Stockout' },
            ]}
          />
        </div>

        {filtered.length ? (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-600 dark:text-slate-300">
                  <th scope="col" className="pb-2 pr-3 font-medium whitespace-nowrap">SKU / Name</th>
                  <th scope="col" className="pb-2 pr-3 font-medium whitespace-nowrap">Category</th>
                  <th scope="col" className="pb-2 pr-3 font-medium whitespace-nowrap">Status</th>
                  <th scope="col" className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Stock vs ROP</th>
                  <th scope="col" className="pb-2 pr-3 font-medium text-right whitespace-nowrap">EOQ</th>
                  <th scope="col" className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Unit cost</th>
                  <th scope="col" className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Stock value</th>
                  <th scope="col" className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Cover</th>
                  <th scope="col" className="pb-2 font-medium text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filtered.map(({ p, m }) => {
                  const ratio = m.rop > 0 ? Math.min(100, (p.stock / (m.rop * 1.6)) * 100) : 100;
                  const barCls =
                    m.status === 'out' || m.status === 'critical'
                      ? 'bg-rose-500'
                      : m.status === 'reorder'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500';
                  return (
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
                      <td className="py-2.5 pr-3 text-slate-700 dark:text-slate-200">{p.category}</td>
                      <td className="py-2.5 pr-3">
                        <StatusLabel status={m.status} />
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        <div className="font-mono tabular-nums">
                          {fmtInt(p.stock)}{' '}
                          <span className="text-slate-500 dark:text-slate-400">/ {fmtInt(m.rop)}</span>
                          {m.sigmaFallback && (
                            <span
                              title={`Estimated σ using ${m.sigmaSource}`}
                              className="ml-1 text-[10px] font-mono text-amber-700 dark:text-amber-400"
                            >
                              ~σ
                            </span>
                          )}
                        </div>
                        <div className="mt-1 h-1 w-20 ml-auto rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div className={`h-full ${barCls}`} style={{ width: `${ratio}%` }} />
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{fmtInt(m.eoq.Q)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{fmtMoney(p.unitCost, 2)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-medium">
                        {fmtMoney(m.stockValue)}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {fmtCover(m.monthsOfCover)}
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            title="View details"
                            aria-label={`View ${p.sku}`}
                            onClick={() => onOpenProduct(p)}
                            className="p-1 rounded text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Receive stock"
                            aria-label={`Receive ${p.sku}`}
                            onClick={() => onMoveStock(p, 'in')}
                            className="p-1 rounded text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 cursor-pointer"
                          >
                            <PackagePlus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Issue stock"
                            aria-label={`Issue ${p.sku}`}
                            disabled={p.stock <= 0}
                            onClick={() => onMoveStock(p, 'out')}
                            className="p-1 rounded text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/50 disabled:opacity-30 cursor-pointer"
                          >
                            <PackageMinus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Edit SKU"
                            aria-label={`Edit ${p.sku}`}
                            onClick={() => onEditProduct(p)}
                            className="p-1 rounded text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Delete SKU"
                            aria-label={`Delete ${p.sku}`}
                            onClick={() => setDeleteTarget(p)}
                            className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No matching items"
            message="Adjust your search term or status/category filters, or add a new SKU."
            action={
              <Button variant="secondary" onClick={() => { setQuery(''); setStatusFilter('all'); setCategoryFilter('all'); }}>
                Clear filters
              </Button>
            }
          />
        )}
      </Panel>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteProductWithUndo(deleteTarget.id);
        }}
        title={deleteTarget ? `Remove ${deleteTarget.sku}?` : 'Remove SKU?'}
        message={
          deleteTarget
            ? `This removes "${deleteTarget.name}" (${deleteTarget.sku}) and detaches it from assembly BOMs. An Undo action will remain available in the toast banner.`
            : ''
        }
        confirmLabel="Remove SKU"
        danger
      />
    </div>
  );
};
