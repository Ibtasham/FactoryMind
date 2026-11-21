import type { Product, Transaction, WorkspaceSummary } from '../store/store';
import type { SmartStockAlert } from './smartAlerts';
import type { FactorySimConfig } from './factorySim';

export type WorkbenchRouteId =
  | 'home'
  | 'factory-sim'
  | 'scenario-studio'
  | 'decision-assistant'
  | 'one-for-all'
  | 'dashboard'
  | 'advisor'
  | 'inventory'
  | 'eoq'
  | 'abc'
  | 'forecast'
  | 'models-3d'
  | 'production'
  | 'decision-lab'
  | 'line-balance'
  | 'spc'
  | 'research'
  | 'ledger'
  | 'brief'
  | 'reports'
  | 'settings';

export interface HomeLiveMetrics {
  skuCount: number;
  bomCount: number;
  txCount: number;
  stockValue: number;
  alertCount: number;
  smartAlertCount: number;
  workstationsCount: number;
  forecastModelCount: number;
}

export function computeHomeLiveMetrics(input: {
  products: Product[];
  transactions: Transaction[];
  summary: WorkspaceSummary;
  visibleSmartAlerts: SmartStockAlert[];
  factorySimConfig: FactorySimConfig;
}): HomeLiveMetrics {
  const bomCount = input.products.filter((p) => p.bom && p.bom.length > 0).length;
  return {
    skuCount: input.products.length,
    bomCount,
    txCount: input.transactions.length,
    stockValue: input.summary.stockValue,
    alertCount: input.summary.alertCount,
    smartAlertCount: input.visibleSmartAlerts.length,
    workstationsCount: input.factorySimConfig.stations.length,
    forecastModelCount: 12,
  };
}

export interface RealTimeAlertItem {
  id: string;
  productId: string;
  sku: string;
  name: string;
  category: string;
  severity: 'out' | 'critical' | 'reorder' | 'forecast';
  severityLabel: string;
  metricSummary: string;
  suggestedQty: number;
  unit: string;
  isForecastRisk: boolean;
}

export interface LatestLedgerMove {
  id: string;
  sku: string;
  productName: string;
  type: 'in' | 'out';
  qty: number;
  unit: string;
  note: string;
  ts: number;
}

export interface RealTimeMetricsWidgetData {
  skuCount: number;
  okCount: number;
  healthySkuPct: number;
  totalInventoryValue: number;
  annualUsageValue: number;
  avgLeadTimeDays: number;
  minLeadTimeDays: number;
  maxLeadTimeDays: number;
  outCount: number;
  criticalCount: number;
  reorderCount: number;
  smartAlertCount: number;
  totalAlertSignals: number;
  workstationsCount: number;
  bomCount: number;
  recentAlerts: RealTimeAlertItem[];
  latestMove: LatestLedgerMove | null;
}

export function computeRealTimeMetricsWidget(input: {
  products: Product[];
  transactions: Transaction[];
  summary: WorkspaceSummary;
  metricsOf: (p: Product) => {
    status: 'ok' | 'reorder' | 'critical' | 'out';
    rop: number;
    suggestedOrderQty: number;
  };
  visibleSmartAlerts: SmartStockAlert[];
  factorySimConfig: FactorySimConfig;
}): RealTimeMetricsWidgetData {
  const { products, transactions, summary, metricsOf, visibleSmartAlerts, factorySimConfig } = input;
  const skuCount = products.length;
  const bomCount = products.filter((p) => p.bom && p.bom.length > 0).length;

  let leadSum = 0;
  let minLead = skuCount > 0 ? Infinity : 0;
  let maxLead = 0;

  const smartByProductId = new Map<string, SmartStockAlert>();
  for (const sa of visibleSmartAlerts) {
    if (!smartByProductId.has(sa.product.id)) {
      smartByProductId.set(sa.product.id, sa);
    }
  }

  const candidates: Array<{ item: RealTimeAlertItem; rank: number }> = [];

  for (const p of products) {
    const lt = Number.isFinite(p.leadTime) ? p.leadTime : 0;
    leadSum += lt;
    if (lt < minLead) minLead = lt;
    if (lt > maxLead) maxLead = lt;

    const m = metricsOf(p);
    const smart = smartByProductId.get(p.id);

    if (m.status !== 'ok') {
      const rank =
        m.status === 'out'
          ? 0
          : m.status === 'critical'
            ? 1
            : smart?.runsOutBeforeLeadTime
              ? 2
              : 3;
      const severityLabel =
        m.status === 'out'
          ? 'Stockout'
          : m.status === 'critical'
            ? 'Critical'
            : 'Reorder';
      const coverNote = smart
        ? ` · ${smart.daysUntilStockout <= 0.5 ? '<1d' : `${smart.daysUntilStockout.toFixed(1)}d`} cover`
        : '';
      candidates.push({
        rank,
        item: {
          id: `rt-${p.id}`,
          productId: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          severity: m.status,
          severityLabel,
          metricSummary: `${Math.round(p.stock)} / ROP ${Math.round(m.rop)} ${p.unit}${coverNote}`,
          suggestedQty: m.suggestedOrderQty,
          unit: p.unit,
          isForecastRisk: Boolean(smart?.runsOutBeforeLeadTime),
        },
      });
    } else if (smart) {
      candidates.push({
        rank: smart.runsOutBeforeLeadTime ? 4 : 5,
        item: {
          id: `rt-smart-${p.id}`,
          productId: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          severity: 'forecast',
          severityLabel: smart.runsOutBeforeLeadTime ? 'Lead-time risk' : 'Forecast watch',
          metricSummary: `${smart.daysUntilStockout <= 0.5 ? '<1d' : `${smart.daysUntilStockout.toFixed(1)}d`} cover vs ${smart.leadTimeDays}d LT`,
          suggestedQty: m.suggestedOrderQty,
          unit: p.unit,
          isForecastRisk: true,
        },
      });
    }
  }

  candidates.sort((a, b) => a.rank - b.rank || a.item.sku.localeCompare(b.item.sku));

  const outCount = summary.counts.out;
  const criticalCount = summary.counts.critical;
  const reorderCount = summary.counts.reorder;
  const okCount = summary.counts.ok;
  const healthySkuPct = skuCount > 0 ? (okCount / skuCount) * 100 : 100;
  const avgLeadTimeDays = skuCount > 0 ? leadSum / skuCount : 0;

  let latestMove: LatestLedgerMove | null = null;
  if (transactions.length > 0) {
    const sortedTx = [...transactions].sort((a, b) => b.ts - a.ts);
    const latest = sortedTx[0];
    const prod = products.find((p) => p.id === latest.productId);
    latestMove = {
      id: latest.id,
      sku: prod?.sku || 'SKU',
      productName: prod?.name || 'Catalog Item',
      type: latest.type,
      qty: latest.qty,
      unit: prod?.unit || 'pcs',
      note: latest.note,
      ts: latest.ts,
    };
  }

  return {
    skuCount,
    okCount,
    healthySkuPct,
    totalInventoryValue: summary.stockValue,
    annualUsageValue: summary.usageValue,
    avgLeadTimeDays,
    minLeadTimeDays: skuCount > 0 ? minLead : 0,
    maxLeadTimeDays: maxLead,
    outCount,
    criticalCount,
    reorderCount,
    smartAlertCount: visibleSmartAlerts.length,
    totalAlertSignals: Math.max(summary.alertCount, visibleSmartAlerts.length),
    workstationsCount: factorySimConfig.stations.length,
    bomCount,
    recentAlerts: candidates.slice(0, 5).map((c) => c.item),
    latestMove,
  };
}

export interface HomeNavLink {
  id: WorkbenchRouteId;
  label: string;
  description?: string;
}

export const HOME_PRIMARY_NAV: HomeNavLink[] = [
  { id: 'factory-sim', label: 'Factory Lab' },
  { id: 'scenario-studio', label: 'Scenario Studio' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'models-3d', label: '3D Twin' },
];

export const HOME_MORE_NAV: HomeNavLink[] = [
  { id: 'dashboard', label: 'Dashboard', description: 'Live KPIs, alerts & plant overview' },
  { id: 'decision-assistant', label: 'Decision Assistant', description: 'Deterministic & AI operational Q&A' },
  { id: 'one-for-all', label: 'One-for-All Hub', description: 'Unified single-screen engineering view' },
  { id: 'advisor', label: 'Inventory Advisor', description: 'Priced safety stock & policy findings' },
  { id: 'eoq', label: 'EOQ & ROP', description: 'Wilson EOQ, EPQ & quantity discounts' },
  { id: 'abc', label: 'ABC Analysis', description: 'Pareto usage classification' },
  { id: 'production', label: 'Production & MRP', description: 'Multi-level BOM & time-phased MRP' },
  { id: 'line-balance', label: 'Line Balancing', description: 'RPW, COMSOAL & Branch-and-Bound' },
  { id: 'decision-lab', label: 'Decision Lab', description: 'Monte Carlo (Q,R), Newsvendor & Queueing' },
  { id: 'spc', label: 'SPC & Quality', description: 'X-bar/R, capability, EWMA & CUSUM' },
  { id: 'research', label: 'Research Lab', description: 'Reproducible catalog benchmarks' },
  { id: 'ledger', label: 'Stock Ledger', description: '30-day stock flow & movement log' },
  { id: 'brief', label: 'Executive Brief', description: 'Board-ready operational summary' },
  { id: 'reports', label: 'Reports', description: 'PDF & CSV engineering dossier' },
  { id: 'settings', label: 'Settings & Data', description: 'Theme, backups & CSV import' },
];

export interface HomeCapabilityCard {
  id: WorkbenchRouteId;
  title: string;
  meta: string;
  description: string;
  iconKey:
    | 'factory'
    | 'sliders'
    | 'package'
    | 'box'
    | 'assistant'
    | 'trending'
    | 'gitbranch'
    | 'reports';
}

export const HOME_CAPABILITY_CARDS: HomeCapabilityCard[] = [
  {
    id: 'factory-sim',
    title: 'Factory Simulation Lab',
    meta: 'DISCRETE-EVENT · OEE',
    description:
      'Event-driven multi-station DES engine modeling job arrivals, queues, buffers, shifts, breakdowns, rework loops, and bottleneck utilization.',
    iconKey: 'factory',
  },
  {
    id: 'scenario-studio',
    title: 'Scenario Studio',
    meta: 'WHAT-IF · SENSITIVITY',
    description:
      'Test demand shocks, lead-time increases, staffing shifts, and scrap changes across Forecast, Inventory, MRP, Line Balance, and DES together.',
    iconKey: 'sliders',
  },
  {
    id: 'inventory',
    title: 'Inventory & EOQ Control',
    meta: 'STOCK · ROP · ABC',
    description:
      'Manage SKU balances, safety stock, reorder points, Wilson EOQ, finite-rate EPQ, quantity discounts, and stock movement receipts.',
    iconKey: 'package',
  },
  {
    id: 'models-3d',
    title: '3D Digital Twin Lab',
    meta: 'INTERACTIVE 3D FLOOR',
    description:
      'Inspect live warehouse racks, production workstations, BOM exploded assemblies, congestion states, and before/after scenario deltas in 3D.',
    iconKey: 'box',
  },
  {
    id: 'decision-assistant',
    title: 'Decision Assistant',
    meta: 'DETERMINISTIC + AI',
    description:
      'Ask why a SKU is flagged high-risk, locate bottlenecks, or compare policy runs with source-cited deterministic figures and optional Gemini synthesis.',
    iconKey: 'assistant',
  },
  {
    id: 'forecast',
    title: '12-Model Forecasting',
    meta: 'ROLLING CV · CROSTON',
    description:
      'Compare SMA, WMA, SES, Holt, Damped Trend, Winters, Croston, SBA, TSB, Theta, and Linear Trend with rolling-origin error backtesting.',
    iconKey: 'trending',
  },
  {
    id: 'production',
    title: 'Production, MRP & Balance',
    meta: 'BOM · LINE BALANCING',
    description:
      'Explode multi-level bills of materials, detect component shortages with lot-for-lot or POQ rules, and balance workstation precedence graphs.',
    iconKey: 'gitbranch',
  },
  {
    id: 'reports',
    title: 'SPC Quality & Reports',
    meta: 'CONTROL CHARTS · PDF',
    description:
      'Monitor process capability (Cp/Cpk), EWMA and CUSUM shifts, and export auditable PDF dossiers, CSV ledgers, or executive briefs.',
    iconKey: 'reports',
  },
];

export interface HomeFooterColumn {
  heading: string;
  links: Array<{ label: string; route?: WorkbenchRouteId; action?: 'history' | 'onboarding' | 'help' }>;
}

export const HOME_FOOTER_COLUMNS: HomeFooterColumn[] = [
  {
    heading: 'Modules',
    links: [
      { label: 'Dashboard', route: 'dashboard' },
      { label: 'Factory Simulation Lab', route: 'factory-sim' },
      { label: 'Scenario Studio', route: 'scenario-studio' },
      { label: 'Inventory & EOQ', route: 'inventory' },
      { label: 'Reports & Export', route: 'reports' },
    ],
  },
  {
    heading: 'Engineering',
    links: [
      { label: '12-Model Forecasting', route: 'forecast' },
      { label: '3D Digital Twin', route: 'models-3d' },
      { label: 'Decision Assistant', route: 'decision-assistant' },
      { label: 'Production & MRP', route: 'production' },
      { label: 'Line Balancing', route: 'line-balance' },
      { label: 'SPC & Quality', route: 'spc' },
    ],
  },
  {
    heading: 'System',
    links: [
      { label: 'Guided Tour', action: 'onboarding' },
      { label: 'Action History', action: 'history' },
      { label: 'Equations & Help', action: 'help' },
      { label: 'Settings & Backups', route: 'settings' },
    ],
  },
];
