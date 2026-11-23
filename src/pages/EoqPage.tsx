import React, { useEffect, useMemo, useState } from 'react';
import { LineChart } from '../components/charts/Charts';
import { AssumptionPanel, Button, Field, Input, Panel, SegmentedControl, Select, StatCard } from '../components/ui/Primitives';
import { clampNumericInput, fmtInt, fmtMoney, fmtNum } from '../engine/formatters';
import { DiscountTierInput, eoq, epq, epqProfile, quantityDiscount, rop, totalCostAtQ } from '../engine/ipe';
import { useStore } from '../store/StoreContext';

export const EoqPage: React.FC = () => {
  const { products } = useStore();
  const [tab, setTab] = useState<'eoq' | 'epq' | 'discount'>('eoq');
  const [selectedId, setSelectedId] = useState<string>(products[0]?.id || 'custom');

  // Shared / Wilson EOQ inputs
  const [annualDemand, setAnnualDemand] = useState<number>(products[0]?.annualDemand || 4200);
  const [orderCost, setOrderCost] = useState<number>(products[0]?.orderCost || 65);
  const [unitCost, setUnitCost] = useState<number>(products[0]?.unitCost || 18.5);
  const [holdingRate, setHoldingRate] = useState<number>(products[0]?.holdingRate || 22);
  const [leadTime, setLeadTime] = useState<number>(products[0]?.leadTime || 10);
  const [serviceLevel, setServiceLevel] = useState<number>(products[0]?.serviceLevel || 95);

  // EPQ extra input
  const [prodRate, setProdRate] = useState<number>(18000);

  // Quantity discount tiers
  const [tiers, setTiers] = useState<DiscountTierInput[]>([
    { minQty: 1, discountPct: 0 },
    { minQty: 250, discountPct: 4 },
    { minQty: 600, discountPct: 8.5 },
    { minQty: 1200, discountPct: 12 },
  ]);

  const activeProduct = products.find((p) => p.id === selectedId) || null;

  useEffect(() => {
    if (selectedId === 'custom') return;
    const p = products.find((x) => x.id === selectedId) || products[0];
    if (!p) {
      setSelectedId('custom');
      return;
    }
    if (p.id !== selectedId) setSelectedId(p.id);
    setAnnualDemand(p.annualDemand || 1200);
    setOrderCost(p.orderCost || 50);
    setUnitCost(p.unitCost || 10);
    setHoldingRate(p.holdingRate || 20);
    setLeadTime(p.leadTime || 7);
    setServiceLevel(p.serviceLevel || 95);
    setProdRate(Math.max(2400, Math.round((p.annualDemand || 1200) * 3)));
  }, [products, selectedId]);

  const selectSku = (id: string) => {
    setSelectedId(id);
    const p = products.find((x) => x.id === id);
    if (p) {
      setAnnualDemand(p.annualDemand || 1200);
      setOrderCost(p.orderCost || 50);
      setUnitCost(p.unitCost || 10);
      setHoldingRate(p.holdingRate || 20);
      setLeadTime(p.leadTime || 7);
      setServiceLevel(p.serviceLevel || 95);
      setProdRate(Math.max(2400, Math.round((p.annualDemand || 1200) * 3)));
    }
  };

  const eoqRes = useMemo(
    () => eoq({ annualDemand, orderCost, unitCost, holdingRate }),
    [annualDemand, orderCost, unitCost, holdingRate]
  );

  const ropRes = useMemo(
    () =>
      rop({
        annualDemand,
        leadTimeDays: leadTime,
        serviceLevel,
        history: activeProduct?.demandHistory || null,
      }),
    [annualDemand, leadTime, serviceLevel, activeProduct]
  );

  const costCurve = useMemo(() => {
    if (!eoqRes.valid) return { labels: [], ordering: [], holding: [], total: [] };
    const qStar = eoqRes.Q;
    const minQ = Math.max(1, qStar * 0.25);
    const maxQ = qStar * 2.2;
    const steps = 25;
    const labels: string[] = [];
    const ordering: number[] = [];
    const holding: number[] = [];
    const total: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const q = minQ + ((maxQ - minQ) * i) / steps;
      const c = totalCostAtQ(q, { annualDemand, orderCost, unitCost, holdingRate });
      labels.push(String(Math.round(q)));
      ordering.push(c.ordering);
      holding.push(c.holding);
      total.push(c.variable);
    }
    return { labels, ordering, holding, total };
  }, [eoqRes, annualDemand, orderCost, unitCost, holdingRate]);

  const epqRes = useMemo(
    () =>
      epq({
        annualDemand,
        setupCost: orderCost,
        unitCost,
        holdingRate,
        productionRate: prodRate,
      }),
    [annualDemand, orderCost, unitCost, holdingRate, prodRate]
  );

  const epqSawtooth = useMemo(() => {
    if (!epqRes.valid) return { labels: [], inv: [] };
    const prof = epqProfile(epqRes.Q, annualDemand, prodRate, 48);
    return {
      labels: prof.days.map((d) => `${d.toFixed(1)}d`),
      inv: prof.inv,
    };
  }, [epqRes, annualDemand, prodRate]);

  const discountRes = useMemo(
    () =>
      quantityDiscount({
        annualDemand,
        orderCost,
        unitCost,
        holdingRate,
        tiers,
      }),
    [annualDemand, orderCost, unitCost, holdingRate, tiers]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          options={[
            { value: 'eoq', label: 'Wilson EOQ & ROP' },
            { value: 'epq', label: 'Finite-Rate EPQ' },
            { value: 'discount', label: 'Quantity Discounts' },
          ]}
        />

        <div className="w-full sm:w-72">
          <Select value={selectedId} onChange={(e) => selectSku(e.target.value)}>
            <option value="custom">Custom parameter set</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Parameter Panel */}
      <Panel title="Model parameters" subtitle="Load any catalogue SKU or tweak parameters interactively">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Field label="Annual demand (D)">
            <Input type="number" min="1" max="10000000" value={annualDemand} onChange={(e) => setAnnualDemand(clampNumericInput(e.target.value, 1, 1, 10000000))} />
          </Field>
          <Field label={tab === 'epq' ? 'Setup cost (S)' : 'Order cost (S)'}>
            <Input type="number" min="0.1" max="1000000" step="0.5" value={orderCost} onChange={(e) => setOrderCost(clampNumericInput(e.target.value, 50, 0.1, 1000000))} />
          </Field>
          <Field label="Unit cost ($)">
            <Input type="number" min="0.01" max="1000000" step="0.1" value={unitCost} onChange={(e) => setUnitCost(clampNumericInput(e.target.value, 10, 0.01, 1000000))} />
          </Field>
          <Field label="Holding rate (%/yr)">
            <Input type="number" min="0.5" max="200" step="0.5" value={holdingRate} onChange={(e) => setHoldingRate(clampNumericInput(e.target.value, 20, 0.5, 200))} />
          </Field>
          {tab === 'eoq' && (
            <>
              <Field label="Lead time (days)">
                <Input type="number" min="0" max="365" value={leadTime} onChange={(e) => setLeadTime(clampNumericInput(e.target.value, 0, 0, 365))} />
              </Field>
              <Field label="Service level (%)">
                <Input type="number" min="50" max="99.9" step="0.5" value={serviceLevel} onChange={(e) => setServiceLevel(clampNumericInput(e.target.value, 95, 50, 99.9))} />
              </Field>
            </>
          )}
          {tab === 'epq' && (
            <Field label="Production rate p (/yr)" hint="Must exceed D">
              <Input type="number" min="1" max="100000000" value={prodRate} onChange={(e) => setProdRate(clampNumericInput(e.target.value, 2400, 1, 100000000))} />
            </Field>
          )}
        </div>
      </Panel>

      {/* Tab 1: Wilson EOQ & ROP */}
      {tab === 'eoq' && (
        <>
          {!eoqRes.valid ? (
            <Panel title="Invalid parameters">
              <p className="text-xs text-rose-600 dark:text-rose-400">{eoqRes.reason}</p>
            </Panel>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <StatCard label="Optimal order qty (EOQ)" value={fmtInt(eoqRes.Q)} sub={`${fmtNum(eoqRes.ordersPerYear, 1)} orders/yr`} tone="good" />
                <StatCard label="Reorder point (ROP)" value={fmtInt(ropRes.rop)} sub={`Safety stock ${fmtInt(ropRes.safetyStock)} (${ropRes.sigmaSource})`} />
                <StatCard label="Cycle length" value={`${fmtNum(eoqRes.cycleDays, 1)} days`} sub={`Daily demand ${fmtNum(ropRes.dBar, 1)}`} />
                <StatCard label="Annual variable cost" value={fmtMoney(eoqRes.variableCost)} sub={`Order ${fmtMoney(eoqRes.orderingCost)} + Hold ${fmtMoney(eoqRes.holdingCost)}`} />
              </div>

              <Panel title="Total annual variable cost vs order quantity Q" subtitle={`Ordering = Holding at Q* = ${fmtInt(eoqRes.Q)}`}>
                <LineChart
                  labels={costCurve.labels}
                  height={250}
                  formatValue={(v) => fmtMoney(v)}
                  series={[
                    { name: 'Total variable cost', data: costCurve.total, color: '#2563eb' },
                    { name: 'Ordering cost', data: costCurve.ordering, color: '#f59e0b', dashed: true },
                    { name: 'Holding cost', data: costCurve.holding, color: '#10b981', dashed: true },
                  ]}
                />
              </Panel>
            </>
          )}
        </>
      )}

      {/* Tab 2: Finite-Rate EPQ */}
      {tab === 'epq' && (
        <>
          {!epqRes.valid ? (
            <Panel title="Invalid EPQ parameters">
              <p className="text-xs text-rose-600 dark:text-rose-400">{epqRes.reason}</p>
            </Panel>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <StatCard label="Optimal batch qty (EPQ)" value={fmtInt(epqRes.Q)} sub={`${fmtNum(epqRes.runsPerYear, 1)} runs/yr`} tone="good" />
                <StatCard label="Max inventory (Imax)" value={fmtInt(epqRes.maxInventory)} sub={`Utilization ρ = D/p = ${fmtNum(epqRes.rho * 100, 1)}%`} />
                <StatCard label="Production run length" value={`${fmtNum(epqRes.runDays, 1)} days`} sub={`Total cycle ${fmtNum(epqRes.cycleDays, 1)} days`} />
                <StatCard label="Annual variable cost" value={fmtMoney(epqRes.variableCost)} sub={`Setup ${fmtMoney(epqRes.setupCost)} + Hold ${fmtMoney(epqRes.holdingCost)}`} />
              </div>

              <Panel title="Single-cycle sawtooth inventory profile" subtitle="Ramp-up slope (p − d) during production run followed by depletion slope (−d)">
                <LineChart
                  labels={epqSawtooth.labels}
                  height={240}
                  yMinZero
                  series={[{ name: 'On-hand units', data: epqSawtooth.inv, area: true, color: '#10b981' }]}
                />
              </Panel>
            </>
          )}
        </>
      )}

      {/* Tab 3: Quantity Discounts */}
      {tab === 'discount' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <Panel
            title="Supplier price-break tiers"
            subtitle="Edit break quantities and % discounts"
            className="lg:col-span-5"
            actions={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setTiers((prev) => [...prev, { minQty: (prev[prev.length - 1]?.minQty || 100) * 2, discountPct: 15 }])}
              >
                + Add tier
              </Button>
            }
          >
            <div className="space-y-2.5">
              {tiers.map((t, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    <Field label={i === 0 ? 'Min qty' : ''}>
                      <Input
                        type="number"
                        min="0"
                        value={t.minQty}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setTiers((prev) => prev.map((x, idx) => (idx === i ? { ...x, minQty: v } : x)));
                        }}
                      />
                    </Field>
                  </div>
                  <div className="col-span-4">
                    <Field label={i === 0 ? 'Discount %' : ''}>
                      <Input
                        type="number"
                        min="0"
                        max="90"
                        step="0.5"
                        value={t.discountPct}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setTiers((prev) => prev.map((x, idx) => (idx === i ? { ...x, discountPct: v } : x)));
                        }}
                      />
                    </Field>
                  </div>
                  <div className="col-span-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={tiers.length <= 1}
                      onClick={() => setTiers((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Price-break evaluation"
            subtitle={
              discountRes.valid && discountRes.best
                ? `Optimal tier: Q = ${fmtInt(discountRes.best.Q)} (${discountRes.best.discountPct}% off) · saves ${fmtMoney(discountRes.savings)}/yr vs base`
                : discountRes.reason
            }
            className="lg:col-span-7"
          >
            {discountRes.valid && (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                      <th className="pb-2 font-medium">Min qty</th>
                      <th className="pb-2 font-medium text-right">Discount</th>
                      <th className="pb-2 font-medium text-right">Unit price</th>
                      <th className="pb-2 font-medium text-right">Tier EOQ</th>
                      <th className="pb-2 font-medium text-right">Order Q*</th>
                      <th className="pb-2 font-medium text-right">Total annual cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {discountRes.rows.map((r, i) => {
                      const isBest = i === discountRes.bestIndex;
                      return (
                        <tr
                          key={i}
                          className={isBest ? 'bg-emerald-50/70 dark:bg-emerald-950/30 font-medium' : ''}
                        >
                          <td className="py-2.5 pr-3 font-mono tabular-nums">
                            {fmtInt(r.minQty)}
                            {isBest && <span className="ml-2 text-emerald-600 dark:text-emerald-400">Optimal</span>}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{fmtNum(r.discountPct, 1)}%</td>
                          <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{fmtMoney(r.price, 2)}</td>
                          <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-500">
                            {fmtInt(r.qEoq)} {r.eoqFeasible ? '✓' : '↑'}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{fmtInt(r.Q)}</td>
                          <td className="py-2.5 text-right font-mono tabular-nums font-semibold">
                            {fmtMoney(r.totalCost)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      <AssumptionPanel topicId="eoq" />
    </div>
  );
};
