import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  PackagePlus,
  Printer,
  Search,
} from 'lucide-react';
import { BarChart, DonutChart } from '../components/charts/Charts';
import { RouteId } from '../components/layout/AppShell';
import {
  Button,
  downloadFile,
  EmptyState,
  Field,
  Input,
  Panel,
  SegmentedControl,
  Select,
  StatCard,
  StatusLabel,
} from '../components/ui/Primitives';
import { fmtCover, fmtInt, fmtMoney, fmtNum } from '../engine/formatters';
import { getBenchmark, listBenchmarks } from '../engine/linebal';
import { LotRule } from '../engine/mrp';
import { generateOperationsPdf, PdfSectionFlags } from '../engine/pdfReport';
import {
  buildOperationsReport,
  fullOperationsDossierCSV,
  inventoryMetricsToCSV,
  operationsReportToMarkdown,
  productionMetricsToCSV,
  replenishmentScheduleToCSV,
} from '../engine/reports';
import { Product } from '../store/store';
import { useStore } from '../store/StoreContext';

type ReportTab = 'overview' | 'production' | 'inventory' | 'document';
type SortField = 'sku' | 'stockValue' | 'usageValue' | 'monthsOfCover' | 'eoq';

export const ReportsPage: React.FC<{
  onNavigate?: (r: RouteId) => void;
  onOpenProduct?: (p: Product) => void;
  onMoveStock?: (p: Product, type: 'in' | 'out') => void;
}> = ({ onNavigate, onOpenProduct, onMoveStock }) => {
  const { products, settings, summary, categories: storeCategories, lineBalance, pushToast } = useStore();

  const [tab, setTab] = useState<ReportTab>('overview');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'all' | 'action' | 'ok'>('all');
  const [buildQty, setBuildQty] = useState<number>(25);
  const [needInDays, setNeedInDays] = useState<number>(35);
  const [lotRule, setLotRule] = useState<LotRule>('l4l');
  const [benchmarkKey, setBenchmarkKey] = useState<string>(lineBalance.benchmarkKey || 'bosch-13');
  const [cycleTime, setCycleTime] = useState<number>(lineBalance.cycleTime || 10);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string>('');
  const [skuSearch, setSkuSearch] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortField>('usageValue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [sections, setSections] = useState<PdfSectionFlags>({
    includeSummary: true,
    includeReplenishment: true,
    includeProduction: true,
    includeInventory: true,
    includeCategories: true,
  });

  const categoryList = useMemo(() => storeCategories(), [storeCategories]);

  const snapshot = useMemo(
    () =>
      buildOperationsReport(products, summary, settings, {
        category: categoryFilter,
        status: statusFilter,
        buildQty,
        needInDays,
        lotRule,
        benchmarkKey,
        cycleTime,
        selectedAssemblyId,
        customTasks: benchmarkKey === lineBalance.benchmarkKey ? lineBalance.tasks : undefined,
      }),
    [products, summary, settings, categoryFilter, statusFilter, buildQty, needInDays, lotRule, benchmarkKey, cycleTime, selectedAssemblyId, lineBalance]
  );

  const toggleSection = (key: keyof PdfSectionFlags) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleBenchmarkChange = (key: string) => {
    setBenchmarkKey(key);
    const bm = getBenchmark(key);
    if (bm) setCycleTime(bm.defaultCycleTime);
  };

  const handleExportPdf = () => {
    const anySection = Object.values(sections).some(Boolean);
    if (!anySection) {
      pushToast({ type: 'error', message: 'Select at least one report section before exporting PDF.' });
      return;
    }
    try {
      const res = generateOperationsPdf(snapshot, sections);
      pushToast({
        type: 'success',
        message: `Downloaded ${res.filename} (${res.pageCount} page${res.pageCount === 1 ? '' : 's'}).`,
      });
    } catch (err) {
      pushToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'PDF generation failed.',
      });
    }
  };

  const handleExportCsv = (mode: 'full' | 'inventory' | 'production' | 'replenishment') => {
    const dateStamp = snapshot.generatedIso.slice(0, 10);
    if (mode === 'inventory') {
      const name = `factorymind-inventory-metrics-${dateStamp}.csv`;
      downloadFile(name, inventoryMetricsToCSV(snapshot), 'text/csv;charset=utf-8');
      pushToast({ type: 'success', message: `Exported ${name}.` });
      return;
    }
    if (mode === 'production') {
      const name = `factorymind-production-mrp-${dateStamp}.csv`;
      downloadFile(name, productionMetricsToCSV(snapshot), 'text/csv;charset=utf-8');
      pushToast({ type: 'success', message: `Exported ${name}.` });
      return;
    }
    if (mode === 'replenishment') {
      const name = `factorymind-replenishment-schedule-${dateStamp}.csv`;
      downloadFile(name, replenishmentScheduleToCSV(snapshot), 'text/csv;charset=utf-8');
      pushToast({ type: 'success', message: `Exported ${name}.` });
      return;
    }
    const name = `factorymind-operations-dossier-${dateStamp}.csv`;
    downloadFile(name, fullOperationsDossierCSV(snapshot), 'text/csv;charset=utf-8');
    pushToast({ type: 'success', message: `Exported ${name}.` });
  };

  const handleCopyMarkdown = async () => {
    const md = operationsReportToMarkdown(snapshot);
    try {
      await navigator.clipboard.writeText(md);
      pushToast({ type: 'success', message: 'Markdown operations summary copied to clipboard.' });
    } catch {
      downloadFile(`factorymind-operations-${snapshot.generatedIso.slice(0, 10)}.md`, md, 'text/markdown;charset=utf-8');
      pushToast({ type: 'info', message: 'Clipboard restricted — downloaded Markdown file instead.' });
    }
  };

  const auditedSkus = useMemo(() => {
    const q = skuSearch.trim().toLowerCase();
    const list = snapshot.inventory.rows.filter((r) => {
      if (!q) return true;
      return (
        r.product.sku.toLowerCase().includes(q) ||
        r.product.name.toLowerCase().includes(q) ||
        r.product.category.toLowerCase().includes(q) ||
        r.abcClass.toLowerCase() === q
      );
    });
    const mult = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortBy === 'sku') return a.product.sku.localeCompare(b.product.sku) * mult;
      if (sortBy === 'stockValue') return (a.metrics.stockValue - b.metrics.stockValue) * mult;
      if (sortBy === 'usageValue') return (a.metrics.usageValue - b.metrics.usageValue) * mult;
      if (sortBy === 'eoq') return (a.metrics.eoq.Q - b.metrics.eoq.Q) * mult;
      const ca = Number.isFinite(a.metrics.monthsOfCover) ? a.metrics.monthsOfCover : 9999;
      const cb = Number.isFinite(b.metrics.monthsOfCover) ? b.metrics.monthsOfCover : 9999;
      return (ca - cb) * mult;
    });
  }, [snapshot.inventory.rows, skuSearch, sortBy, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(field);
      setSortDir(field === 'sku' ? 'asc' : 'desc');
    }
  };

  const categoryChartData = useMemo(() => {
    const top = snapshot.categories.slice(0, 8);
    return {
      labels: top.map((c) => c.category.slice(0, 12)),
      series: [
        { name: 'Stock value', data: top.map((c) => Math.round(c.stockValue)), color: '#2563eb' },
        { name: 'Annual usage / 10', data: top.map((c) => Math.round(c.usageValue / 10)), color: '#10b981' },
      ],
    };
  }, [snapshot.categories]);

  const abcDonutSegments = useMemo(() => {
    const sums = { A: 0, B: 0, C: 0 };
    const counts = { A: 0, B: 0, C: 0 };
    snapshot.inventory.rows.forEach((r) => {
      sums[r.abcClass] += r.metrics.stockValue;
      counts[r.abcClass]++;
    });
    return [
      { label: `Class A (${counts.A} SKUs)`, value: sums.A, color: '#2563eb' },
      { label: `Class B (${counts.B} SKUs)`, value: sums.B, color: '#10b981' },
      { label: `Class C (${counts.C} SKUs)`, value: sums.C, color: '#64748b' },
    ];
  }, [snapshot.inventory.rows]);

  if (!products.length) {
    return (
      <EmptyState
        title="No inventory or production data"
        message="Add SKUs in the Inventory catalogue or restore the seed dataset in Settings to generate PDF and CSV operations reports."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Export Toolbar & Section Controls */}
      <Panel
        className="no-print"
        title="Operations report builder & export"
        subtitle="Configure scope, MRP production batch parameters, and export multi-page PDF or structured CSV datasets"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={handleCopyMarkdown} className="whitespace-nowrap shrink-0">
              <Copy className="h-3.5 w-3.5" /> Copy Markdown
            </Button>
            <Button size="sm" variant="secondary" onClick={() => handleExportCsv('inventory')} className="whitespace-nowrap shrink-0">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Inventory CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={() => handleExportCsv('production')} className="whitespace-nowrap shrink-0">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Production CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={() => handleExportCsv('full')} className="whitespace-nowrap shrink-0">
              <Download className="h-3.5 w-3.5" /> Full Dossier CSV
            </Button>
            <Button size="sm" variant="primary" onClick={handleExportPdf} className="whitespace-nowrap shrink-0">
              <FileText className="h-3.5 w-3.5" /> Download PDF Report
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Field label="Category scope">
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="ALL">All categories ({categoryList.length})</option>
              {categoryList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Inventory status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | 'action' | 'ok')}>
              <option value="all">All SKUs ({products.length})</option>
              <option value="action">Action required ({summary.alertCount})</option>
              <option value="ok">Healthy only ({summary.counts.ok})</option>
            </Select>
          </Field>

          <Field label="MRP batch qty">
            <Input
              type="number"
              min="1"
              value={buildQty}
              onChange={(e) => setBuildQty(Math.max(1, Number(e.target.value) || 1))}
            />
          </Field>

          <Field label="MRP need (days)">
            <Input
              type="number"
              min="0"
              value={needInDays}
              onChange={(e) => setNeedInDays(Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>

          <Field label="MRP lot rule">
            <Select value={lotRule} onChange={(e) => setLotRule(e.target.value as LotRule)}>
              <option value="l4l">Lot-for-Lot (L4L)</option>
              <option value="eoq">EOQ</option>
              <option value="foq">Fixed Order Qty</option>
              <option value="poq">Period Order Qty</option>
            </Select>
          </Field>

          <Field label="Line benchmark / C">
            <div className="grid grid-cols-3 gap-1.5">
              <div className="col-span-2">
                <Select value={benchmarkKey} onChange={(e) => handleBenchmarkChange(e.target.value)}>
                  {listBenchmarks().map((b) => (
                    <option key={b.key} value={b.key}>
                      {b.name.split(' ')[0]} ({b.tasks.length}t)
                    </option>
                  ))}
                </Select>
              </div>
              <Input
                type="number"
                min="1"
                value={cycleTime}
                aria-label="Cycle time"
                onChange={(e) => setCycleTime(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </Field>
        </div>

        {/* Section Checkboxes for PDF Export + Tab Switcher */}
        <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">PDF sections:</span>
            {[
              { key: 'includeSummary' as const, label: 'Executive KPIs' },
              { key: 'includeReplenishment' as const, label: 'Replenishment POs' },
              { key: 'includeProduction' as const, label: 'Production & MRP' },
              { key: 'includeCategories' as const, label: 'Categories & Line Balance' },
              { key: 'includeInventory' as const, label: 'Full SKU Ledger' },
            ].map((item) => (
              <label key={item.key} className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sections[item.key]}
                  onChange={() => toggleSection(item.key)}
                  className="rounded border-slate-300 dark:border-slate-700 accent-[var(--accent)]"
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <SegmentedControl
              value={tab}
              onChange={(v) => setTab(v as ReportTab)}
              options={[
                { value: 'overview', label: 'Overview & POs' },
                { value: 'production', label: 'Production & MRP' },
                { value: 'inventory', label: `SKU Audit (${snapshot.inventory.filteredSkuCount})` },
                { value: 'document', label: 'Print Sheet' },
              ]}
            />
          </div>
        </div>
      </Panel>

      {/* Top KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 no-print">
        <StatCard
          label="Inventory at cost"
          value={fmtMoney(snapshot.inventory.stockValue)}
          sub={`${fmtInt(snapshot.inventory.filteredSkuCount)} SKUs · ${
            snapshot.inventory.turnover != null ? `${fmtNum(snapshot.inventory.turnover, 1)}x turns/yr` : '—'
          }`}
        />
        <StatCard
          label="Annual usage value"
          value={fmtMoney(snapshot.inventory.usageValue)}
          sub={`Class A: ${fmtNum(snapshot.inventory.abcStats.A.usagePct, 0)}% usage · ${fmtInt(snapshot.inventory.abcStats.A.count)} SKUs`}
        />
        <StatCard
          label="Open replenishment POs"
          value={fmtMoney(snapshot.replenishment.totalPoValue)}
          sub={`${fmtInt(snapshot.replenishment.rows.length)} SKUs due (${snapshot.inventory.counts.out} out · ${snapshot.inventory.counts.critical} low)`}
          tone={snapshot.replenishment.rows.length > 0 ? 'warn' : 'good'}
        />
        <StatCard
          label="Production & line efficiency"
          value={
            snapshot.production.lineBalance.efficiencyPct != null
              ? `${fmtNum(snapshot.production.lineBalance.efficiencyPct, 1)}%`
              : '—'
          }
          sub={`${fmtInt(snapshot.production.totalBuildableAssemblies)}/${fmtInt(snapshot.production.assemblies.length)} BOMs ready for Q=${buildQty} · ${fmtMoney(snapshot.production.totalNetReqSpend)} net MRP`}
          tone={snapshot.production.totalShortages > 0 ? 'warn' : 'good'}
        />
      </div>

      {/* TAB 1: Overview & Replenishment */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <Panel
                title="Category capital & usage comparison"
                subtitle="On-hand valuation vs scaled annual usage (÷10) across active categories"
              >
                <BarChart
                  labels={categoryChartData.labels}
                  series={categoryChartData.series}
                  height={230}
                  formatValue={(v) => fmtMoney(v)}
                />
              </Panel>
            </div>
            <Panel
              title="ABC inventory concentration"
              subtitle="Capital allocated across Class A, B, and C SKUs"
            >
              <DonutChart
                segments={abcDonutSegments}
                centerLabel="On hand"
                centerValue={fmtMoney(snapshot.inventory.stockValue)}
                formatValue={(v) => fmtMoney(v)}
              />
            </Panel>
          </div>

          <Panel
            title="Replenishment action schedule"
            subtitle="Purchase or shop-floor orders recommended by EOQ and Reorder Point"
            actions={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleExportCsv('replenishment')}
                disabled={snapshot.replenishment.rows.length === 0}
                className="whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" /> Export Schedule CSV
              </Button>
            }
          >
            {snapshot.replenishment.rows.length ? (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                      <th className="pb-2 font-medium">SKU</th>
                      <th className="pb-2 font-medium">Description</th>
                      <th className="pb-2 font-medium">ABC</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium text-right">On hand</th>
                      <th className="pb-2 font-medium text-right">ROP</th>
                      <th className="pb-2 font-medium text-right">Order qty</th>
                      <th className="pb-2 font-medium text-right">Est. PO value</th>
                      <th className="pb-2 font-medium text-right">Cover</th>
                      {onMoveStock && <th className="pb-2 font-medium text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {snapshot.replenishment.rows.map(({ product: p, metrics: m, abcClass, suggestedPoValue }) => (
                      <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2 pr-3 font-mono text-slate-500">
                          {onOpenProduct ? (
                            <button
                              type="button"
                              onClick={() => onOpenProduct(p)}
                              className="hover:text-[var(--accent)] hover:underline cursor-pointer"
                            >
                              {p.sku}
                            </button>
                          ) : (
                            p.sku
                          )}
                        </td>
                        <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">{p.name}</td>
                        <td className="py-2 pr-3 font-mono text-slate-500">{abcClass}</td>
                        <td className="py-2 pr-3">
                          <StatusLabel status={m.status} />
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {fmtInt(p.stock)} {p.unit}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtInt(m.rop)}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums font-semibold">
                          {fmtInt(m.suggestedOrderQty)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtMoney(suggestedPoValue)}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-500">
                          {fmtCover(m.monthsOfCover)}
                        </td>
                        {onMoveStock && (
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              onClick={() => onMoveStock(p, 'in')}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline cursor-pointer whitespace-nowrap"
                            >
                              <PackagePlus className="h-3 w-3" /> Receive
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-500">No replenishment actions are due inside the selected scope.</p>
            )}
          </Panel>

          <Panel title="Category capital & turnover breakdown" subtitle="On-hand cost, annual usage, and inventory turns per category">
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                    <th className="pb-2 font-medium">Category</th>
                    <th className="pb-2 font-medium text-right">SKUs</th>
                    <th className="pb-2 font-medium text-right">Alerts</th>
                    <th className="pb-2 font-medium text-right">Stock value</th>
                    <th className="pb-2 font-medium text-right">Annual usage</th>
                    <th className="pb-2 font-medium text-right">Share</th>
                    <th className="pb-2 font-medium text-right">Turnover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {snapshot.categories.map((c) => (
                    <tr key={c.category}>
                      <td className="py-2 font-medium text-slate-900 dark:text-slate-100">{c.category}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{c.skuCount}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">
                        {c.actionCount}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">{fmtMoney(c.stockValue)}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{fmtMoney(c.usageValue)}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-slate-500">{fmtNum(c.sharePct, 1)}%</td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {c.turnover != null ? `${fmtNum(c.turnover, 1)}x` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* TAB 2: Production & MRP */}
      {tab === 'production' && (
        <div className="space-y-4">
          <Panel
            title={`Assembly BOM readiness & MRP batch requirements (Q = ${buildQty} units)`}
            subtitle="Evaluates immediate build capacity from on-hand components and net purchase requirements over lead time"
            actions={
              <div className="flex items-center gap-2">
                {onNavigate && (
                  <Button size="sm" variant="ghost" onClick={() => onNavigate('production')} className="whitespace-nowrap shrink-0">
                    Open MRP Workbench <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => handleExportCsv('production')} className="whitespace-nowrap shrink-0">
                  <Download className="h-3.5 w-3.5" /> Export Production CSV
                </Button>
              </div>
            }
          >
            {snapshot.production.assemblies.length ? (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                      <th className="pb-2 pr-3 font-medium">Assembly</th>
                      <th className="pb-2 pr-3 font-medium text-right">BOM lines</th>
                      <th className="pb-2 pr-3 font-medium text-right">Unit BOM cost</th>
                      <th className="pb-2 pr-3 font-medium text-right">Buildable now</th>
                      <th className="pb-2 pr-3 font-medium">Limiting bottleneck</th>
                      <th className="pb-2 pr-3 font-medium text-right">Net req spend</th>
                      <th className="pb-2 pr-3 font-medium text-right">Shortages</th>
                      <th className="pb-2 font-medium text-right">Late releases</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {snapshot.production.assemblies.map((a) => {
                      const isSelected = snapshot.production.selectedAssembly?.product.id === a.product.id;
                      return (
                        <tr
                          key={a.product.id}
                          tabIndex={0}
                          role="button"
                          aria-pressed={isSelected}
                          onClick={() => setSelectedAssemblyId(a.product.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedAssemblyId(a.product.id);
                            }
                          }}
                          className={`cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--accent)] ${
                            isSelected
                              ? 'bg-slate-100/90 dark:bg-slate-800/70'
                              : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <td className="py-2 pr-3">
                            <div className="font-mono text-[11px] text-slate-500">{a.product.sku}</div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">{a.product.name}</div>
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{a.bomLineCount}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtMoney(a.unitBomCost)}</td>
                          <td
                            className={`py-2 pr-3 text-right font-mono tabular-nums font-semibold ${
                              a.buildableNow >= buildQty
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {fmtInt(a.buildableNow)} {a.product.unit}
                          </td>
                          <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                            <span className="font-mono text-[11px] text-slate-500 mr-1.5">{a.bottleneckSku}</span>
                            {a.bottleneckName}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtMoney(a.netReqSpend)}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">
                            {a.shortageCount > 0 ? (
                              <span className="text-rose-600 dark:text-rose-400 font-semibold">{a.shortageCount}</span>
                            ) : (
                              '0'
                            )}
                          </td>
                          <td className="py-2 text-right font-mono tabular-nums">
                            {a.lateOrderCount > 0 ? (
                              <span className="text-amber-600 dark:text-amber-400 font-semibold">{a.lateOrderCount}</span>
                            ) : (
                              '0'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-500">No BOM assemblies defined in the catalogue.</p>
            )}
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {snapshot.production.selectedAssembly && (
              <Panel
                title={`Exploded MRP breakdown: ${snapshot.production.selectedAssembly.product.sku}`}
                subtitle={`Batch ${buildQty} units · Need in ${needInDays}d · Click any assembly row above to inspect`}
              >
                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                        <th className="pb-2 font-medium">Component</th>
                        <th className="pb-2 font-medium text-center">Lvl</th>
                        <th className="pb-2 font-medium text-right">On hand</th>
                        <th className="pb-2 font-medium text-right">Gross req</th>
                        <th className="pb-2 font-medium text-right">Net req</th>
                        <th className="pb-2 font-medium text-right">Lead</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {Object.values(snapshot.production.selectedAssembly.plan.components).map((c) => (
                        <tr key={c.id}>
                          <td className="py-1.5 pr-2">
                            <span className="font-mono text-[11px] text-slate-500 mr-1.5">{c.sku}</span>
                            <span className="text-slate-800 dark:text-slate-200">{c.name}</span>
                          </td>
                          <td className="py-1.5 text-center font-mono text-slate-500">{c.level}</td>
                          <td className="py-1.5 text-right font-mono tabular-nums">
                            {fmtInt(c.onHand)} {c.unit}
                          </td>
                          <td className="py-1.5 text-right font-mono tabular-nums">{fmtInt(c.totalGross)}</td>
                          <td
                            className={`py-1.5 text-right font-mono tabular-nums font-semibold ${
                              c.totalNetRequirement > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'
                            }`}
                          >
                            {fmtInt(c.totalNetRequirement)}
                          </td>
                          <td className="py-1.5 text-right font-mono tabular-nums text-slate-500">{c.leadTimeDays}d</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}

            <Panel
              title={`Assembly line balancing benchmark (${snapshot.production.lineBalance.benchmarkName})`}
              subtitle={`Target cycle C = ${snapshot.production.lineBalance.cycleTime}s · Theoretical min ${snapshot.production.lineBalance.theoreticalMin} stations · ${
                snapshot.production.lineBalance.hourlyOutput != null
                  ? `${fmtNum(snapshot.production.lineBalance.hourlyOutput, 1)} units/hr`
                  : '—'
              }`}
              actions={
                onNavigate && (
                  <Button size="sm" variant="ghost" onClick={() => onNavigate('line-balance')} className="whitespace-nowrap shrink-0">
                    Open Line Lab <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )
              }
            >
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                      <th className="pb-2 font-medium">Algorithm</th>
                      <th className="pb-2 font-medium text-right">Stations</th>
                      <th className="pb-2 font-medium text-right">Efficiency</th>
                      <th className="pb-2 font-medium text-right">Balance delay</th>
                      <th className="pb-2 font-medium text-right">Smoothness</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {snapshot.production.lineBalance.comparison.map((c) => {
                      const isBest = c.stationCount === snapshot.production.lineBalance.bestStations && c.valid;
                      return (
                        <tr key={c.algorithm} className={isBest ? 'bg-emerald-50/50 dark:bg-emerald-950/25 font-medium' : ''}>
                          <td className="py-2 pr-3 text-slate-900 dark:text-slate-100">{c.label}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{c.stationCount ?? '—'}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                            {c.efficiency != null ? `${fmtNum(c.efficiency, 1)}%` : '—'}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">
                            {c.balanceDelay != null ? `${fmtNum(c.balanceDelay, 1)}%` : '—'}
                          </td>
                          <td className="py-2 text-right font-mono tabular-nums text-slate-500">
                            {c.smoothnessIndex != null ? fmtNum(c.smoothnessIndex, 2) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* TAB 3: Full SKU Audit */}
      {tab === 'inventory' && (
        <Panel
          title="Complete SKU valuation & policy audit"
          subtitle="EOQ, safety stock, reorder point, ABC Pareto class, and stock cover across filtered items"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={skuSearch}
                  onChange={(e) => setSkuSearch(e.target.value)}
                  placeholder="Filter SKU, name, A/B/C..."
                  className="pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                />
              </div>
              <Button size="sm" variant="secondary" onClick={() => handleExportCsv('inventory')} className="whitespace-nowrap shrink-0">
                <Download className="h-3.5 w-3.5" /> Export SKU CSV
              </Button>
            </div>
          }
        >
          {auditedSkus.length ? (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                    <th className="pb-2 font-medium" aria-sort={sortBy === 'sku' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" onClick={() => toggleSort('sku')} className="hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer">
                        SKU {sortBy === 'sku' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="pb-2 font-medium">Item</th>
                    <th className="pb-2 font-medium">Category</th>
                    <th className="pb-2 font-medium text-center">ABC</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium text-right">On hand</th>
                    <th className="pb-2 font-medium text-right" aria-sort={sortBy === 'eoq' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" onClick={() => toggleSort('eoq')} className="hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer">
                        EOQ {sortBy === 'eoq' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="pb-2 font-medium text-right">ROP</th>
                    <th className="pb-2 font-medium text-right" aria-sort={sortBy === 'monthsOfCover' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" onClick={() => toggleSort('monthsOfCover')} className="hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer">
                        Cover {sortBy === 'monthsOfCover' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="pb-2 font-medium text-right" aria-sort={sortBy === 'stockValue' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" onClick={() => toggleSort('stockValue')} className="hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer">
                        Stock value {sortBy === 'stockValue' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="pb-2 font-medium text-right" aria-sort={sortBy === 'usageValue' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" onClick={() => toggleSort('usageValue')} className="hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer">
                        Annual usage {sortBy === 'usageValue' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {auditedSkus.map(({ product: p, metrics: m, abcClass }) => (
                    <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2 pr-3 font-mono text-slate-500">
                        {onOpenProduct ? (
                          <button
                            type="button"
                            onClick={() => onOpenProduct(p)}
                            className="hover:text-[var(--accent)] hover:underline cursor-pointer"
                          >
                            {p.sku}
                          </button>
                        ) : (
                          p.sku
                        )}
                      </td>
                      <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">{p.name}</td>
                      <td className="py-2 pr-3 text-slate-500">{p.category}</td>
                      <td className="py-2 pr-3 text-center font-mono font-semibold text-slate-700 dark:text-slate-200">
                        {abcClass}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusLabel status={m.status} />
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        {fmtInt(p.stock)} {p.unit}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtInt(m.eoq.Q)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtInt(m.rop)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-500">
                        {fmtCover(m.monthsOfCover)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtMoney(m.stockValue)}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{fmtMoney(m.usageValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No SKUs match the current search or scope filters.</p>
          )}
        </Panel>
      )}

      {/* TAB 4: Print Sheet / Board Document Preview */}
      {tab === 'document' && (
        <div className="space-y-3">
          <div className="flex justify-end gap-2 no-print">
            <Button size="sm" variant="secondary" onClick={() => window.print()} className="whitespace-nowrap shrink-0">
              <Printer className="h-3.5 w-3.5" /> Browser Print Dialog
            </Button>
            <Button size="sm" variant="primary" onClick={handleExportPdf} className="whitespace-nowrap shrink-0">
              <FileText className="h-3.5 w-3.5" /> Download PDF File
            </Button>
          </div>

          <article className="print-surface max-w-4xl mx-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white text-slate-900 p-6 sm:p-10 shadow-sm space-y-6">
            <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                  FactoryMind · Consolidated Operations Dossier
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-950 mt-1">
                  Inventory & Production Engineering Report
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {snapshot.generatedDisplay} · Category: {snapshot.scope.category} · Status: {snapshot.scope.status} · Policy: {fmtNum(snapshot.policy.cover, 1)} mo cover
                </p>
              </div>
              <div className="text-left sm:text-right font-mono tabular-nums">
                <div className="text-[11px] text-slate-500">Portfolio Valuation</div>
                <div className="text-xl font-bold text-slate-950">{fmtMoney(snapshot.inventory.stockValue)}</div>
              </div>
            </header>

            <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-3 border-b border-slate-200">
              <div>
                <div className="text-[11px] text-slate-500">Active SKUs</div>
                <div className="text-base font-semibold font-mono tabular-nums">{fmtInt(snapshot.inventory.filteredSkuCount)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Annual Usage</div>
                <div className="text-base font-semibold font-mono tabular-nums">{fmtMoney(snapshot.inventory.usageValue)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Open Replenishment</div>
                <div className="text-base font-semibold font-mono tabular-nums">{fmtMoney(snapshot.replenishment.totalPoValue)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Line Balance Efficiency</div>
                <div className="text-base font-semibold font-mono tabular-nums">
                  {snapshot.production.lineBalance.efficiencyPct != null
                    ? `${fmtNum(snapshot.production.lineBalance.efficiencyPct, 1)}%`
                    : '—'}
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">Production & BOM Readiness (Batch = {buildQty})</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] text-slate-500">
                    <th className="pb-1.5 pr-3 font-medium">Assembly</th>
                    <th className="pb-1.5 pr-3 font-medium text-right">Unit BOM</th>
                    <th className="pb-1.5 pr-3 font-medium text-right">Buildable Now</th>
                    <th className="pb-1.5 pr-3 font-medium">Bottleneck</th>
                    <th className="pb-1.5 font-medium text-right">Net MRP Spend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {snapshot.production.assemblies.map((a) => (
                    <tr key={a.product.id}>
                      <td className="py-1.5 pr-3 font-medium">
                        {a.product.sku} · {a.product.name}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{fmtMoney(a.unitBomCost)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{fmtInt(a.buildableNow)}</td>
                      <td className="py-1.5 pr-3 font-mono text-slate-600">{a.bottleneckSku}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{fmtMoney(a.netReqSpend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">Engineering Methodology</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="font-semibold text-slate-900">Wilson EOQ & Safety Stock</dt>
                  <dd className="text-slate-600 font-mono text-[11px]">Q* = √(2DS / H) · ROP = d̄·L + z·σ_d·√L</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900">Time-Phased MRP Explosion</dt>
                  <dd className="text-slate-600 font-mono text-[11px]">Low-level coded BOM · Net = max(0, SS − POH)</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900">Forecast Selection & Validation</dt>
                  <dd className="text-slate-600 font-mono text-[11px]">12 models · Rolling-origin WAPE ranking</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900">Quality & Line Balancing</dt>
                  <dd className="text-slate-600 font-mono text-[11px]">Shewhart X̄/R + EWMA/CUSUM · Branch & Bound</dd>
                </div>
              </dl>
            </section>
          </article>
        </div>
      )}
    </div>
  );
};
