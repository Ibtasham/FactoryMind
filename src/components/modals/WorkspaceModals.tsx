import React, { useEffect, useState } from 'react';
import { Box } from 'lucide-react';
import { fmtCover, fmtInt, fmtMoney, fmtNum, relTime } from '../../engine/formatters';
import { isAssemblySku } from '../../engine/threeSpecs';
import {
  ProductFormField,
  validateBomLines,
  validateProductForm,
  validateStockMove,
} from '../../engine/uxHelpers';
import { useStore } from '../../store/StoreContext';
import { BomLine, DemandSource, genHistory, monthLabels, Product } from '../../store/store';
import { LineChart } from '../charts/Charts';
import { Button, Field, Input, Modal, Select, StatusLabel } from '../ui/Primitives';

export const ProductFormModal: React.FC<{
  open: boolean;
  product: Product | null;
  onClose: () => void;
}> = ({ open, product, onClose }) => {
  const { products, addProduct, updateProduct, categories, pushToast } = useStore();
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Component');
  const [unit, setUnit] = useState('pcs');
  const [unitCost, setUnitCost] = useState('10');
  const [stock, setStock] = useState('100');
  const [annualDemand, setAnnualDemand] = useState('1200');
  const [orderCost, setOrderCost] = useState('50');
  const [holdingRate, setHoldingRate] = useState('20');
  const [leadTime, setLeadTime] = useState('10');
  const [serviceLevel, setServiceLevel] = useState('95');
  const [historyText, setHistoryText] = useState('');
  const [generatedSample, setGeneratedSample] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProductFormField, string>>>({});

  useEffect(() => {
    if (!open) return;
    setGeneratedSample(false);
    setSubmitted(false);
    setFieldErrors({});
    if (product) {
      setSku(product.sku);
      setName(product.name);
      setCategory(product.category);
      setUnit(product.unit);
      setUnitCost(String(product.unitCost));
      setStock(String(product.stock));
      setAnnualDemand(String(product.annualDemand));
      setOrderCost(String(product.orderCost));
      setHoldingRate(String(product.holdingRate));
      setLeadTime(String(product.leadTime));
      setServiceLevel(String(product.serviceLevel));
      setHistoryText(product.demandHistory.join(', '));
    } else {
      setSku('');
      setName('');
      setCategory('Component');
      setUnit('pcs');
      setUnitCost('12');
      setStock('120');
      setAnnualDemand('2400');
      setOrderCost('45');
      setHoldingRate('22');
      setLeadTime('10');
      setServiceLevel('95');
      setHistoryText('');
    }
  }, [open, product]);

  const runValidation = (overrides?: Partial<Record<ProductFormField, string>>) => {
    return validateProductForm(
      {
        sku: overrides?.sku ?? sku,
        name: overrides?.name ?? name,
        unit: overrides?.unit ?? unit,
        unitCost: overrides?.unitCost ?? unitCost,
        stock: overrides?.stock ?? stock,
        annualDemand: overrides?.annualDemand ?? annualDemand,
        orderCost: overrides?.orderCost ?? orderCost,
        holdingRate: overrides?.holdingRate ?? holdingRate,
        leadTime: overrides?.leadTime ?? leadTime,
        serviceLevel: overrides?.serviceLevel ?? serviceLevel,
        historyText: overrides?.historyText ?? historyText,
      },
      {
        existingSkus: products.map((p) => p.sku),
        editingProductSku: product?.sku,
      }
    );
  };

  useEffect(() => {
    if (!submitted) return;
    setFieldErrors(runValidation().errors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted, sku, name, unit, unitCost, stock, annualDemand, orderCost, holdingRate, leadTime, serviceLevel, historyText]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const res = runValidation();
    setFieldErrors(res.errors);
    if (!res.valid) return;

    const parsedHistory = res.parsedHistory;
    const demandSource: DemandSource = generatedSample
      ? 'synthetic'
      : product?.demandSource && parsedHistory.join(',') === product.demandHistory.join(',')
        ? product.demandSource
        : 'user';

    const payload: Partial<Product> = {
      sku: sku.trim().toUpperCase(),
      name: name.trim(),
      category: category.trim() || 'Other',
      unit: unit.trim() || 'pcs',
      unitCost: Number(unitCost) || 0,
      stock: Number(stock) || 0,
      annualDemand: Number(annualDemand) || 0,
      orderCost: Number(orderCost) || 0,
      holdingRate: Number(holdingRate) || 20,
      leadTime: Number(leadTime) || 7,
      serviceLevel: Number(serviceLevel) || 95,
      demandHistory: parsedHistory,
      demandSource,
    };

    if (product) {
      updateProduct(product.id, payload);
      pushToast({ type: 'success', message: `Updated ${payload.sku || product.sku}.` });
    } else {
      const created = addProduct(payload);
      pushToast({ type: 'success', message: `Added ${created.sku} · ${created.name}.` });
    }
    onClose();
  };

  const catList = categories();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? `Edit ${product.sku}` : 'Add SKU to catalogue'}
      subtitle="Parameters drive EOQ, Reorder Point, Safety Stock, ABC, and Advisor pricing."
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="SKU" error={fieldErrors.sku}>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. BRG-6206" required />
          </Field>
          <Field label="Product name" error={fieldErrors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sealed Ball Bearing" required />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {[...new Set(['Raw Material', 'Component', 'Fastener', 'Electrical', 'Machinery', 'Maintenance', 'Consumable', 'Assembly', ...catList])].map(
                (c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                )
              )}
            </Select>
          </Field>
          <Field label="Unit of measure" error={fieldErrors.unit}>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs / m / kg" />
          </Field>
          <Field label="Unit cost ($)" error={fieldErrors.unitCost}>
            <Input type="number" step="0.01" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </Field>
          <Field label="Current stock" error={fieldErrors.stock}>
            <Input type="number" step="any" min="0" value={stock} onChange={(e) => setStock(e.target.value)} />
          </Field>
          <Field label="Annual demand" error={fieldErrors.annualDemand}>
            <Input type="number" step="any" min="0" value={annualDemand} onChange={(e) => setAnnualDemand(e.target.value)} />
          </Field>
          <Field label="Order / setup cost ($)" error={fieldErrors.orderCost}>
            <Input type="number" step="0.01" min="0" value={orderCost} onChange={(e) => setOrderCost(e.target.value)} />
          </Field>
          <Field label="Holding rate (%/yr)" error={fieldErrors.holdingRate}>
            <Input type="number" step="0.1" min="0.1" max="100" value={holdingRate} onChange={(e) => setHoldingRate(e.target.value)} />
          </Field>
          <Field label="Lead time (days)" error={fieldErrors.leadTime}>
            <Input type="number" step="1" min="0" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
          </Field>
          <Field label="Target service level (%)" hint="50 – 99.9" error={fieldErrors.serviceLevel}>
            <Input type="number" step="0.5" min="50" max="99.9" value={serviceLevel} onChange={(e) => setServiceLevel(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="sku-demand-history" className="text-xs font-medium text-slate-700 dark:text-slate-200">
              Monthly demand history (optional)
            </label>
            <button
              type="button"
              onClick={() => {
                const sample = genHistory(Math.max(12, Number(annualDemand) || 1200), 42);
                setHistoryText(sample.join(', '));
                setGeneratedSample(true);
              }}
              className="text-[11px] font-medium text-[var(--accent)] hover:underline whitespace-nowrap cursor-pointer"
            >
              Generate deterministic 12m sample
            </button>
          </div>
          <textarea
            id="sku-demand-history"
            rows={2}
            value={historyText}
            aria-invalid={fieldErrors.historyText ? true : undefined}
            aria-describedby={fieldErrors.historyText ? 'sku-demand-history-err' : undefined}
            onChange={(e) => {
              setHistoryText(e.target.value);
              setGeneratedSample(false);
            }}
            placeholder="Comma-separated monthly quantities (leave empty to use 30% assumed daily σ fallback)"
            className={`w-full rounded-md border ${
              fieldErrors.historyText
                ? 'border-rose-500 dark:border-rose-400 focus:ring-rose-500/35'
                : 'border-slate-200 dark:border-slate-700 focus:ring-[var(--accent)]/40'
            } bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2`}
          />
          {fieldErrors.historyText && (
            <p id="sku-demand-history-err" role="alert" className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
              {fieldErrors.historyText}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {product ? 'Save changes' : 'Create SKU'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const StockMoveModal: React.FC<{
  open: boolean;
  product: Product | null;
  type: 'in' | 'out';
  onClose: () => void;
}> = ({ open, product, type, onClose }) => {
  const { metricsOf, moveStock, pushToast } = useStore();
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [qtyError, setQtyError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open || !product) return;
    setQtyError(undefined);
    const m = metricsOf(product);
    if (type === 'in') {
      setQty(String(Math.max(1, Math.round(m.eoq.Q || 50))));
      setNote(`PO replenishment — ${product.sku}`);
    } else {
      setQty(String(Math.min(product.stock, Math.max(1, Math.round(product.annualDemand / 24) || 10))));
      setNote(`Production issue — ${product.sku}`);
    }
  }, [open, product, type, metricsOf]);

  if (!product) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateStockMove(qty, type, product.stock);
    if (!check.valid) {
      setQtyError(check.error);
      return;
    }
    const tx = moveStock(product.id, type, check.qty, note);
    if (tx) {
      pushToast({
        type: 'success',
        message: `${type === 'in' ? 'Received' : 'Issued'} ${fmtInt(tx.qty)} ${product.unit} of ${product.sku}.`,
      });
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={type === 'in' ? `Receive stock · ${product.sku}` : `Issue stock · ${product.sku}`}
      subtitle={`${product.name} · Current stock: ${fmtInt(product.stock)} ${product.unit}`}
      maxWidth="max-w-md"
    >
      <form onSubmit={submit} noValidate className="space-y-3.5">
        <Field
          label={`Quantity (${product.unit})`}
          hint={type === 'out' ? `Max ${fmtInt(product.stock)}` : 'Suggested EOQ'}
          error={qtyError}
        >
          <Input
            type="number"
            step="any"
            min="0.01"
            value={qty}
            onChange={(e) => {
              const val = e.target.value;
              setQty(val);
              if (qtyError) {
                const check = validateStockMove(val, type, product.stock);
                setQtyError(check.error);
              }
            }}
            required
          />
        </Field>
        <Field label="Reference / Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={type === 'in' ? 'primary' : 'danger'}>
            {type === 'in' ? 'Confirm receipt' : 'Confirm issue'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const ProductDetailModal: React.FC<{
  open: boolean;
  product: Product | null;
  onClose: () => void;
  onEdit: (p: Product) => void;
  onMove: (p: Product, type: 'in' | 'out') => void;
  onInspect3D?: (sku?: string) => void;
}> = ({ open, product, onClose, onEdit, onMove, onInspect3D }) => {
  const { metricsOf, transactions } = useStore();
  if (!product) return null;
  const m = metricsOf(product);
  const txs = transactions.filter((t) => t.productId === product.id).slice(0, 6);
  const labels = monthLabels(product.demandHistory.length || 12);

  return (
    <Modal open={open} onClose={onClose} title={`${product.sku} · ${product.name}`} subtitle={product.category} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
          <StatusLabel status={m.status} />
          <div className="flex flex-wrap gap-2">
            {onInspect3D && isAssemblySku(product.sku) && (
              <Button size="sm" variant="secondary" onClick={() => { onClose(); onInspect3D(product.sku); }}>
                <Box className="h-3.5 w-3.5" /> Inspect 3D
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => { onClose(); onMove(product, 'in'); }}>
              Receive stock
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { onClose(); onMove(product, 'out'); }} disabled={product.stock <= 0}>
              Issue stock
            </Button>
            <Button size="sm" variant="primary" onClick={() => { onClose(); onEdit(product); }}>
              Edit parameters
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded border border-slate-200 dark:border-slate-800 p-2.5">
            <div className="text-[11px] text-slate-600 dark:text-slate-300">On hand</div>
            <div className="text-sm font-semibold font-mono tabular-nums mt-0.5">
              {fmtInt(product.stock)} {product.unit}
            </div>
          </div>
          <div className="rounded border border-slate-200 dark:border-slate-800 p-2.5">
            <div className="text-[11px] text-slate-600 dark:text-slate-300">Reorder point</div>
            <div className="text-sm font-semibold font-mono tabular-nums mt-0.5">
              {fmtInt(m.rop)} {product.unit}
            </div>
          </div>
          <div className="rounded border border-slate-200 dark:border-slate-800 p-2.5">
            <div className="text-[11px] text-slate-600 dark:text-slate-300">Wilson EOQ</div>
            <div className="text-sm font-semibold font-mono tabular-nums mt-0.5">
              {fmtInt(m.eoq.Q)} {product.unit}
            </div>
          </div>
          <div className="rounded border border-slate-200 dark:border-slate-800 p-2.5">
            <div className="text-[11px] text-slate-600 dark:text-slate-300">Stock value / Cover</div>
            <div className="text-sm font-semibold font-mono tabular-nums mt-0.5">
              {fmtMoney(m.stockValue)} · {fmtCover(m.monthsOfCover)}
            </div>
          </div>
        </div>

        {product.demandHistory.length > 1 && (
          <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-200 mb-2">
              12-month historical demand ({fmtNum(m.dBar, 1)} /day avg · {product.serviceLevel}% SL)
            </div>
            <LineChart
              labels={labels}
              height={160}
              series={[{ name: 'Demand', data: product.demandHistory, area: true }]}
            />
          </div>
        )}

        <div>
          <div className="text-xs font-medium text-slate-700 dark:text-slate-200 mb-2">Recent ledger activity</div>
          {txs.length ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded">
              {txs.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-3 py-2 text-xs">
                  <div>
                    <span className={t.type === 'in' ? 'text-emerald-700 dark:text-emerald-400 font-mono mr-2' : 'text-rose-700 dark:text-rose-400 font-mono mr-2'}>
                      {t.type === 'in' ? '+' : '−'}
                      {fmtInt(t.qty)}
                    </span>
                    <span className="text-slate-700 dark:text-slate-200">{t.note}</span>
                  </div>
                  <span className="text-slate-500 dark:text-slate-400 font-mono">{relTime(t.ts)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-600 dark:text-slate-300">No recorded ledger entries yet.</div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export const BomEditorModal: React.FC<{
  open: boolean;
  parent: Product | null;
  onClose: () => void;
}> = ({ open, parent, onClose }) => {
  const { products, setBom, pushToast } = useStore();
  const [lines, setLines] = useState<BomLine[]>([]);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!open || !parent) return;
    setLines(parent.bom.map((b) => ({ ...b })));
    setLineErrors({});
  }, [open, parent]);

  if (!parent) return null;
  const candidates = products.filter((p) => p.id !== parent.id);

  const addLine = () => {
    const used = new Set(lines.map((l) => l.componentId));
    const next = candidates.find((c) => !used.has(c.id));
    if (!next) {
      pushToast({ type: 'info', message: 'All other SKUs are already included in this BOM.' });
      return;
    }
    setLines((prev) => [...prev, { componentId: next.id, qtyPer: 1 }]);
  };

  const save = () => {
    const check = validateBomLines(lines, parent.id);
    setLineErrors(check.lineErrors);
    if (!check.valid) return;
    setBom(parent.id, lines);
    pushToast({ type: 'success', message: `Saved BOM for ${parent.sku} (${lines.length} components).` });
    onClose();
  };

  const rolledCost = lines.reduce((sum, l) => {
    const comp = products.find((p) => p.id === l.componentId);
    return sum + (comp ? comp.unitCost * (Number(l.qtyPer) || 0) : 0);
  }, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit Bill of Materials · ${parent.sku}`}
      subtitle={`${parent.name} · Material cost rollup: ${fmtMoney(rolledCost)}`}
    >
      <div className="space-y-3">
        {lines.map((l, idx) => (
          <div key={idx} className="space-y-1">
            <div className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-7">
                <Select
                  aria-label={`BOM component ${idx + 1}`}
                  aria-invalid={lineErrors[idx] ? true : undefined}
                  value={l.componentId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, componentId: val } : x)));
                  }}
                >
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.sku} · {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-3">
                <Input
                  type="number"
                  step="0.1"
                  min="0.01"
                  aria-label={`Quantity per assembly for line ${idx + 1}`}
                  aria-invalid={lineErrors[idx] ? true : undefined}
                  value={l.qtyPer}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, qtyPer: v } : x)));
                  }}
                />
              </div>
              <div className="col-span-2 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                >
                  Remove
                </Button>
              </div>
            </div>
            {lineErrors[idx] && (
              <p role="alert" className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                {lineErrors[idx]}
              </p>
            )}
          </div>
        ))}

        <Button size="sm" variant="secondary" onClick={addLine}>
          + Add component line
        </Button>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save BOM
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export const ShortcutsModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const rows = [
    ['Ctrl/Cmd + K', 'Open Command Palette (views, SKUs, scenarios & help)'],
    ['G then O', 'Go to One-for-All Hub'],
    ['G then D', 'Go to Dashboard'],
    ['G then F', 'Go to Factory Simulation Lab'],
    ['G then S', 'Go to Scenario Studio'],
    ['G then I', 'Go to Inventory'],
    ['G then A', 'Go to Advisor'],
    ['G then 3', 'Go to 3D Digital Twin'],
    ['G then R', 'Go to Reports'],
    ['?', 'Open this shortcuts reference'],
    ['Esc', 'Close active dialog, menu, or palette'],
  ];
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" subtitle="Quick navigation across the workbench" maxWidth="max-w-md">
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map(([keys, desc]) => (
          <div key={keys} className="flex items-center justify-between py-2 text-xs gap-4">
            <span className="text-slate-700 dark:text-slate-200">{desc}</span>
            <kbd className="font-mono text-[11px] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 shrink-0">
              {keys}
            </kbd>
          </div>
        ))}
      </div>
    </Modal>
  );
};
