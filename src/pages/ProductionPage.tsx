import React, { useMemo, useState } from 'react';
import { AlertTriangle, Box, Download, Edit3, Factory, Plus, Trash2 } from 'lucide-react';
import { RouteId } from '../components/layout/AppShell';
import { AssumptionPanel, Button, downloadFile, EmptyState, Field, Input, Panel, Select, StatCard } from '../components/ui/Primitives';
import { fmtInt, fmtNum, shortDate } from '../engine/formatters';
import { LotRule, MrpItemInput, mrpPlan, mrpToCSV } from '../engine/mrp';
import { isAssemblySku } from '../engine/threeSpecs';
import { Product } from '../store/store';
import { useStore } from '../store/StoreContext';

interface OpenReceiptRow {
  id: string;
  componentId: string;
  qty: number;
  daysFromStart: number;
}

export const ProductionPage: React.FC<{
  onEditBom: (p: Product) => void;
  onInspect3D?: (sku?: string) => void;
  onNavigate?: (r: RouteId) => void;
}> = ({ onEditBom, onInspect3D, onNavigate }) => {
  const { products, metricsOf } = useStore();

  const defaultRoot = useMemo(
    () =>
      products.find((p) => p.sku === 'ASM-CM200') ||
      products.find((p) => p.bom.length > 0) ||
      products[0] ||
      null,
    [products]
  );

  const [rootId, setRootId] = useState<string>(defaultRoot?.id || '');
  const [planQty, setPlanQty] = useState<number>(25);
  const [needInDays, setNeedInDays] = useState<number>(35);
  const [horizonDays, setHorizonDays] = useState<number>(60);
  const [bucketSizeDays, setBucketSizeDays] = useState<number>(7);
  const [lotRule, setLotRule] = useState<LotRule>('l4l');
  const [selectedComponentId, setSelectedComponentId] = useState<string>('');
  const [openReceipts, setOpenReceipts] = useState<OpenReceiptRow[]>([]);
  const [rcptComponentId, setRcptComponentId] = useState<string>(products[0]?.id || '');
  const [rcptQty, setRcptQty] = useState<number>(20);
  const [rcptDays, setRcptDays] = useState<number>(7);

  const activeRoot = products.find((p) => p.id === rootId) || defaultRoot;

  const plan = useMemo(() => {
    if (!activeRoot) return null;
    const items: Record<string, MrpItemInput> = {};
    products.forEach((p) => {
      const m = metricsOf(p);
      const receiptsForSku = openReceipts
        .filter((r) => r.componentId === p.id && r.qty > 0)
        .map((r) => ({ qty: r.qty, daysFromStart: r.daysFromStart }));
      items[p.id] = {
        id: p.id,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        bom: p.bom,
        onHand: p.stock,
        scheduledReceipts: receiptsForSku,
        safetyStock: Math.round(m.safetyStock),
        leadTimeDays: p.leadTime,
        lotRule,
        eoqQty: Math.max(1, Math.round(m.eoq.Q)),
        foqQty: Math.max(10, Math.round(m.eoq.Q)),
        periodDemand: Math.max(1, Math.round(m.dBar * bucketSizeDays)),
        periodCount: 2,
      };
    });

    return mrpPlan({
      rootId: activeRoot.id,
      planQuantity: planQty,
      needInDays,
      items,
      horizonDays,
      bucketSizeDays,
      lotRule,
    });
  }, [activeRoot, products, metricsOf, openReceipts, planQty, needInDays, horizonDays, bucketSizeDays, lotRule]);

  const addScheduledReceipt = () => {
    const compId = rcptComponentId || products[0]?.id;
    if (!compId || rcptQty <= 0) return;
    setOpenReceipts((prev) => [
      ...prev,
      { id: `sr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, componentId: compId, qty: rcptQty, daysFromStart: Math.max(0, rcptDays) },
    ]);
  };

  const componentList = useMemo(() => {
    if (!plan) return [];
    return Object.values(plan.components);
  }, [plan]);

  const activeComponent = useMemo(() => {
    if (!componentList.length) return null;
    return componentList.find((c) => c.id === selectedComponentId) || componentList[0];
  }, [componentList, selectedComponentId]);

  if (!activeRoot || !plan) {
    return (
      <EmptyState
        title="No assemblies available"
        message="Add products and define a Bill of Materials to run multi-level time-phased MRP."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Master production schedule & explosion controls"
        subtitle="Multi-level low-level-coded BOM explosion with lead-time offsetting and lot sizing"
        actions={
          <div className="flex flex-wrap gap-2">
            {onInspect3D && isAssemblySku(activeRoot.sku) && (
              <Button size="sm" variant="primary" onClick={() => onInspect3D(activeRoot.sku)}>
                <Box className="h-3.5 w-3.5" /> Inspect 3D Model
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => onEditBom(activeRoot)}>
              <Edit3 className="h-3.5 w-3.5" /> Edit BOM ({activeRoot.bom.length})
            </Button>
            {onNavigate && (
              <Button size="sm" variant="secondary" onClick={() => onNavigate('factory-sim')}>
                <Factory className="h-3.5 w-3.5" /> Simulate in Factory Lab
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => downloadFile(`mrp-${activeRoot.sku}.csv`, mrpToCSV(plan), 'text/csv')}
            >
              <Download className="h-3.5 w-3.5" /> Export MRP CSV
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="col-span-2">
            <Field label="Parent assembly / SKU">
              <Select value={activeRoot.id} onChange={(e) => setRootId(e.target.value)}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {p.name} {p.bom.length ? `(${p.bom.length} BOM lines)` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Build quantity">
            <Input type="number" min="1" value={planQty} onChange={(e) => setPlanQty(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Need in (days)">
            <Input type="number" min="0" value={needInDays} onChange={(e) => setNeedInDays(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Bucket size (days)">
            <Select value={bucketSizeDays} onChange={(e) => setBucketSizeDays(Number(e.target.value))}>
              <option value={1}>1 day</option>
              <option value={7}>7 days (Weekly)</option>
              <option value={14}>14 days</option>
            </Select>
          </Field>
          <Field label="Lot sizing rule">
            <Select value={lotRule} onChange={(e) => setLotRule(e.target.value as LotRule)}>
              <option value="l4l">L4L (Lot-for-Lot)</option>
              <option value="eoq">EOQ multiples</option>
              <option value="foq">FOQ fixed batch</option>
              <option value="poq">POQ (2-period cover)</option>
            </Select>
          </Field>
        </div>

        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-3">
            <Field label="Planning horizon (days)">
              <Input
                type="number"
                min="14"
                max="365"
                value={horizonDays}
                onChange={(e) => setHorizonDays(Math.max(14, Number(e.target.value) || 60))}
              />
            </Field>
          </div>
          <div className="lg:col-span-4">
            <Field label="Scheduled receipt SKU (Open PO)">
              <Select value={rcptComponentId || products[0]?.id || ''} onChange={(e) => setRcptComponentId(e.target.value)}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="lg:col-span-2">
            <Field label="Open PO qty">
              <Input type="number" min="1" value={rcptQty} onChange={(e) => setRcptQty(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          </div>
          <div className="lg:col-span-2">
            <Field label="Arrives (days)">
              <Input type="number" min="0" value={rcptDays} onChange={(e) => setRcptDays(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          </div>
          <div className="lg:col-span-1">
            <Button size="sm" variant="secondary" onClick={addScheduledReceipt} className="w-full whitespace-nowrap">
              <Plus className="h-3.5 w-3.5" /> Add PO
            </Button>
          </div>
        </div>

        {openReceipts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {openReceipts.map((r) => {
              const p = products.find((x) => x.id === r.componentId);
              return (
                <div
                  key={r.id}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1 text-xs"
                >
                  <span className="font-mono font-medium">{p?.sku || r.componentId}</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">+{fmtInt(r.qty)}</span>
                  <span className="text-slate-500">in {r.daysFromStart}d</span>
                  <button
                    type="button"
                    aria-label={`Remove scheduled receipt for ${p?.sku || r.componentId}`}
                    onClick={() => setOpenReceipts((prev) => prev.filter((x) => x.id !== r.id))}
                    className="text-rose-500 hover:text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          label="BOM components exploded"
          value={fmtInt(plan.summary.componentCount)}
          sub={`Gross req ${fmtInt(plan.summary.totalGrossRequirements)} units`}
        />
        <StatCard
          label="Net requirements"
          value={fmtInt(plan.summary.totalNetRequirements)}
          sub={`Planned receipts ${fmtInt(plan.summary.totalPlannedReceipts)}`}
          tone={plan.summary.totalNetRequirements > 0 ? 'warn' : 'good'}
        />
        <StatCard
          label="Planned releases"
          value={fmtInt(plan.plannedOrderReleases.length)}
          sub={`${plan.summary.lateOrderWarnings} past-due warning(s)`}
          tone={plan.summary.lateOrderWarnings > 0 ? 'bad' : 'good'}
        />
        <StatCard
          label="Plan feasibility"
          value={plan.valid ? 'Feasible' : 'Action needed'}
          sub={plan.reason}
          tone={plan.valid ? 'good' : 'bad'}
        />
      </div>

      {/* Shortage Alerts & Past-Due Warnings */}
      {plan.shortageAlerts.length > 0 && (
        <Panel
          title={`MRP shortage alerts (${plan.shortageAlerts.length})`}
          subtitle="Components projected to breach safety stock, fall short of receipts, or miss lead-time window"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {plan.shortageAlerts.map((sa) => (
              <div
                key={sa.componentId}
                className={`rounded-md border px-3 py-2 text-xs flex items-center justify-between gap-2 ${
                  sa.severity === 'high'
                    ? 'border-rose-300/70 dark:border-rose-800/70 bg-rose-50/70 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
                    : 'border-amber-300/70 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
                }`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-medium">{sa.componentName}</span>
                </span>
                <span className="font-mono shrink-0">
                  {sa.shortfall > 0 ? `-${fmtInt(sa.shortfall)}` : 'Lead-time'}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {plan.lateOrderWarnings.length > 0 && (
        <Panel title="Schedule feasibility warnings" subtitle="Lead time exceeds remaining window before need date">
          <ul className="space-y-1.5 text-xs text-rose-600 dark:text-rose-400">
            {plan.lateOrderWarnings.map((w, idx) => (
              <li key={idx} className="font-mono">
                • {w.message}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Multi-level BOM Tree + Planned Order Releases */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Panel title="Indented Bill of Materials" subtitle="Multi-level explosion factors & gross needs" className="lg:col-span-5">
          {plan.bomVisual.length > 1 ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded">
              {plan.bomVisual.map((row, idx) => (
                <div
                  key={`${row.componentId}-${idx}`}
                  style={{ paddingLeft: `${12 + row.level * 18}px` }}
                  className="pr-3 py-2 flex items-center justify-between text-xs gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {row.level > 0 && <span className="text-slate-400 mr-1.5">└─</span>}
                      {row.name}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">
                      L{row.level} · {row.sku} · ×{fmtNum(row.qtyPer, 2)}/parent
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-medium shrink-0">
                    {row.isRoot ? fmtInt(planQty) : fmtInt(row.totalGross)} req
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500 py-6 text-center">
              {activeRoot.sku} has no BOM components yet. Click “Edit BOM” above to attach subassemblies or raw materials.
            </div>
          )}
        </Panel>

        <Panel title="Planned order releases" subtitle="Lead-time-offset procurement & shop-floor orders" className="lg:col-span-7">
          {plan.plannedOrderReleases.length ? (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                    <th className="pb-2 font-medium">Component</th>
                    <th className="pb-2 font-medium">Bucket</th>
                    <th className="pb-2 font-medium">Release date</th>
                    <th className="pb-2 font-medium text-right">Lead time</th>
                    <th className="pb-2 font-medium text-right">Order qty</th>
                    <th className="pb-2 font-medium text-right">Rule</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {plan.plannedOrderReleases.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">{r.componentName}</td>
                      <td className="py-2 pr-3 font-mono text-slate-500">P{r.bucketIndex + 1}</td>
                      <td className="py-2 pr-3 font-mono">{shortDate(r.releaseDate.getTime())}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{r.leadTimeDays}d</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                        {fmtInt(r.quantity)}
                      </td>
                      <td className="py-2 text-right font-mono uppercase text-slate-500">{r.lotRule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-slate-500 py-6 text-center">
              All gross requirements are covered by existing on-hand inventory.
            </div>
          )}
        </Panel>
      </div>

      {/* Time-Phased MRP Pegging Grid */}
      {activeComponent && (
        <Panel
          title={`Time-phased MRP schedule · ${activeComponent.sku} (${activeComponent.name})`}
          subtitle={`On hand: ${fmtInt(activeComponent.onHand)} · Safety stock: ${fmtInt(activeComponent.safetyStock)} · Lead time: ${activeComponent.leadTimeDays}d`}
          actions={
            <div className="w-64">
              <Select
                value={activeComponent.id}
                onChange={(e) => setSelectedComponentId(e.target.value)}
              >
                {componentList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.sku} · {c.name} (Net {fmtInt(c.totalNetRequirement)})
                  </option>
                ))}
              </Select>
            </div>
          }
        >
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500 font-sans">
                  <th className="pb-2 font-medium pr-3">Metric</th>
                  {plan.buckets.map((b) => (
                    <th key={b.index} className="pb-2 font-medium text-right px-2">
                      {b.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                <tr>
                  <td className="py-2 pr-3 font-sans text-slate-600 dark:text-slate-300">Gross requirements</td>
                  {activeComponent.mrpRows.map((r) => (
                    <td key={r.bucketIndex} className="py-2 px-2 text-right">
                      {r.grossReq ? fmtInt(r.grossReq) : '0'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-sans text-slate-600 dark:text-slate-300">Projected on hand</td>
                  {activeComponent.mrpRows.map((r) => (
                    <td key={r.bucketIndex} className="py-2 px-2 text-right">
                      {fmtInt(r.projectedOnHandAfter)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-sans text-slate-600 dark:text-slate-300">Net requirements</td>
                  {activeComponent.mrpRows.map((r) => (
                    <td
                      key={r.bucketIndex}
                      className={`py-2 px-2 text-right ${
                        r.netRequirement > 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {fmtInt(r.netRequirement)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-sans text-slate-600 dark:text-slate-300">Planned order receipts</td>
                  {activeComponent.mrpRows.map((r) => (
                    <td key={r.bucketIndex} className="py-2 px-2 text-right text-emerald-600 dark:text-emerald-400">
                      {fmtInt(r.plannedOrderReceipt)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-sans text-slate-600 dark:text-slate-300">Planned order releases</td>
                  {activeComponent.mrpRows.map((r) => (
                    <td
                      key={r.bucketIndex}
                      className={`py-2 px-2 text-right ${
                        r.plannedOrderRelease ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {r.plannedOrderRelease ? fmtInt(r.plannedOrderRelease) : '0'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <AssumptionPanel topicId="production" />
    </div>
  );
};
