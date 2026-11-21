/**
 * Workspace data layer: persistence (localStorage with in-memory fallback),
 * seeded manufacturing catalogue (17 SKUs + 5 BOMs + 34 transactions), CRUD,
 * CSV/JSON import & export, and derived inventory/ledger analytics.
 */

import {
  buildDefaultFactoryConfigFromWorkspace,
  FactoryScenarioRecord,
  FactorySimConfig,
  RoutingMode,
} from '../engine/factorySim';
import { clamp, num } from '../engine/formatters';
import { EoqResult, eoq, mulberry32, rop, STATUS_META, statusFor, StockStatus } from '../engine/ipe';
import { getBenchmark, LineBalTaskInput } from '../engine/linebal';
import { sanitizeScenarioParams, ScenarioDefinition } from '../engine/scenarioStudio';

export interface BomLine {
  componentId: string;
  qtyPer: number;
}

export type DemandSource = 'demo' | 'user' | 'imported' | 'synthetic';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  unitCost: number;
  stock: number;
  annualDemand: number;
  orderCost: number;
  holdingRate: number;
  leadTime: number;
  serviceLevel: number;
  demandHistory: number[];
  demandSource?: DemandSource;
  bom: BomLine[];
  createdAt: number;
}

export interface Transaction {
  id: string;
  productId: string;
  type: 'in' | 'out';
  qty: number;
  note: string;
  ts: number;
}

export interface ActionLogEntry {
  id: string;
  ts: number;
  category: 'inventory' | 'bom' | 'scenario' | 'settings' | 'import' | 'system';
  action: string;
  detail: string;
  route?: string;
}

export interface WorkspaceSettings {
  theme: 'dark' | 'light';
  accent: 'blue' | 'emerald' | 'amber' | 'violet';
  reduceMotion?: boolean;
  abcA: number;
  abcB: number;
  smaW: number;
  wmaW: number;
  emaAlpha: number;
  advCover?: number;
  advSlLow?: number;
  advSlHigh?: number;
  onboardingDismissed?: boolean;
  onboardingCompletedSteps?: string[];
}

export interface PersistedLineBalance {
  benchmarkKey: string;
  cycleTime: number;
  tasks: LineBalTaskInput[];
  selectedAlgo: string;
}

export interface WorkspaceDB {
  version: number;
  seededAt: number;
  products: Product[];
  transactions: Transaction[];
  settings: WorkspaceSettings;
  lineBalance?: PersistedLineBalance;
  dismissedSmartAlertIds?: string[];
  smartAlertHorizonDays?: number;
  factorySimConfig?: FactorySimConfig;
  factoryScenarios?: FactoryScenarioRecord[];
  scenarioStudioRecords?: ScenarioDefinition[];
  actionLog?: ActionLogEntry[];
}

export interface ProductMetrics {
  H: number;
  eoq: EoqResult;
  rop: number;
  safetyStock: number;
  z: number;
  dBar: number;
  sigmaD: number;
  sigmaSource: string;
  sigmaFallback: boolean;
  status: StockStatus;
  statusMeta: { label: string; cls: 'ok' | 'warn' | 'bad' };
  stockValue: number;
  usageValue: number;
  monthsOfCover: number;
  suggestedOrderQty: number;
}

export interface WorkspaceSummary {
  skuCount: number;
  stockValue: number;
  usageValue: number;
  counts: Record<StockStatus, number>;
  byCategory: Record<string, number>;
  alertCount: number;
  txCount: number;
}

export interface ProductSnapshot {
  product: Product;
  transactions: Transaction[];
}

const DB_STORAGE_KEY = 'factorymind.db.v3';

export interface StorageBackend {
  persistent: boolean;
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
}

export function createSafeStorage(onError?: (err: unknown) => void): StorageBackend {
  let ls: Storage | null = null;
  const mem: Record<string, string> = {};
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      ls = globalThis.localStorage;
      ls.setItem('__fm_probe__', '1');
      ls.removeItem('__fm_probe__');
    }
  } catch {
    ls = null;
  }
  return {
    persistent: !!ls,
    get(k: string) {
      try {
        return ls ? ls.getItem(k) : k in mem ? mem[k] : null;
      } catch {
        return k in mem ? mem[k] : null;
      }
    },
    set(k: string, v: string) {
      try {
        if (ls) ls.setItem(k, v);
        else mem[k] = v;
      } catch (err) {
        mem[k] = v;
        if (onError) onError(err);
      }
    },
    del(k: string) {
      try {
        if (ls) ls.removeItem(k);
        delete mem[k];
      } catch {
        delete mem[k];
      }
    },
  };
}

interface CatalogSeedItem {
  sku: string;
  name: string;
  category: string;
  unit: string;
  unitCost: number;
  stock: number;
  annualDemand: number;
  orderCost: number;
  holdingRate: number;
  leadTime: number;
  serviceLevel?: number;
  seed: number;
  trend: number;
  season: number;
  bom?: Array<[string, number]>;
}

const CATALOG: CatalogSeedItem[] = [
  { sku: 'STL-1045', name: 'Steel Rod Ø12mm (1045)', category: 'Raw Material', unit: 'm', unitCost: 4.2, stock: 430, annualDemand: 12000, orderCost: 60, holdingRate: 22, leadTime: 14, seed: 11, trend: 0.1, season: 0.1 },
  { sku: 'ALU-6061', name: 'Aluminum Sheet 2mm (6061)', category: 'Raw Material', unit: 'sheet', unitCost: 9.75, stock: 1150, annualDemand: 6400, orderCost: 85, holdingRate: 20, leadTime: 21, seed: 22, trend: -0.06, season: 0.12 },
  { sku: 'BLT-M8X40', name: 'Hex Bolt M8×40 (Gr 8.8)', category: 'Fastener', unit: 'pcs', unitCost: 0.12, stock: 42000, annualDemand: 180000, orderCost: 25, holdingRate: 30, leadTime: 7, seed: 33, trend: 0.08, season: 0.05 },
  { sku: 'NUT-M8', name: 'Hex Nut M8 (DIN 934)', category: 'Fastener', unit: 'pcs', unitCost: 0.06, stock: 600, annualDemand: 175000, orderCost: 25, holdingRate: 30, leadTime: 7, seed: 44, trend: 0.05, season: 0.06 },
  { sku: 'BRG-6205', name: 'Ball Bearing 6205-2RS', category: 'Component', unit: 'pcs', unitCost: 3.85, stock: 2600, annualDemand: 9600, orderCost: 45, holdingRate: 25, leadTime: 10, seed: 55, trend: 0.12, season: 0.08, serviceLevel: 99 },
  { sku: 'GSK-R120', name: 'Rubber Gasket Ø120 (NBR)', category: 'Component', unit: 'pcs', unitCost: 0.95, stock: 1500, annualDemand: 42000, orderCost: 30, holdingRate: 28, leadTime: 12, seed: 66, trend: 0, season: 0.15 },
  { sku: 'MOT-05HP', name: 'AC Induction Motor 0.5 HP', category: 'Electrical', unit: 'pcs', unitCost: 78.0, stock: 55, annualDemand: 950, orderCost: 120, holdingRate: 18, leadTime: 30, seed: 77, trend: 0.15, season: 0.1, serviceLevel: 92 },
  { sku: 'PNL-CTL3', name: 'Control Panel Enclosure IP54', category: 'Electrical', unit: 'pcs', unitCost: 240.0, stock: 38, annualDemand: 320, orderCost: 150, holdingRate: 15, leadTime: 45, seed: 88, trend: 0.2, season: 0.08 },
  { sku: 'CNV-B500', name: 'PVC Conveyor Belt 500mm', category: 'Machinery', unit: 'm', unitCost: 14.5, stock: 900, annualDemand: 2400, orderCost: 95, holdingRate: 20, leadTime: 25, seed: 99, trend: 0.04, season: 0.18 },
  { sku: 'HYD-SK21', name: 'Hydraulic Seal Kit Ø21', category: 'Maintenance', unit: 'set', unitCost: 12.4, stock: 410, annualDemand: 3600, orderCost: 40, holdingRate: 24, leadTime: 9, seed: 110, trend: 0.06, season: 0.1 },
  { sku: 'LUB-ISO68', name: 'Hydraulic Oil ISO VG 68', category: 'Maintenance', unit: 'L', unitCost: 2.85, stock: 380, annualDemand: 22000, orderCost: 35, holdingRate: 26, leadTime: 6, seed: 121, trend: 0.03, season: 0.22 },
  { sku: 'WLD-ER70', name: 'Welding Wire ER70S-6 1.2mm', category: 'Consumable', unit: 'kg', unitCost: 3.1, stock: 1600, annualDemand: 8200, orderCost: 50, holdingRate: 24, leadTime: 11, seed: 132, trend: 0.09, season: 0.12 },
  {
    sku: 'ASM-PA100', name: 'Pump Assembly PA-100', category: 'Assembly', unit: 'pcs', unitCost: 132.0, stock: 24, annualDemand: 260, orderCost: 90, holdingRate: 18, leadTime: 12, seed: 143, trend: 0.14, season: 0.1,
    bom: [['MOT-05HP', 1], ['BRG-6205', 2], ['HYD-SK21', 1], ['GSK-R120', 2], ['BLT-M8X40', 8], ['NUT-M8', 8]],
  },
  {
    sku: 'ASM-CM200', name: 'Conveyor Module CM-200', category: 'Assembly', unit: 'pcs', unitCost: 428.0, stock: 9, annualDemand: 180, orderCost: 130, holdingRate: 16, leadTime: 18, seed: 154, trend: 0.18, season: 0.12,
    bom: [['CNV-B500', 6], ['BRG-6205', 4], ['STL-1045', 2], ['PNL-CTL3', 1], ['KIT-MK5', 1], ['BLT-M8X40', 12], ['NUT-M8', 12], ['WLD-ER70', 0.5]],
  },
  {
    sku: 'ASM-GS350', name: 'Gearbox Set GS-350', category: 'Assembly', unit: 'set', unitCost: 189.0, stock: 17, annualDemand: 420, orderCost: 110, holdingRate: 18, leadTime: 15, seed: 165, trend: 0.12, season: 0.1,
    bom: [['BRG-6205', 4], ['HYD-SK21', 2], ['LUB-ISO68', 1.5], ['GSK-R120', 4], ['BLT-M8X40', 16], ['NUT-M8', 16]],
  },
  {
    sku: 'ASM-CP120', name: 'Motor Control Panel CP-120', category: 'Assembly', unit: 'pcs', unitCost: 465.0, stock: 6, annualDemand: 150, orderCost: 140, holdingRate: 16, leadTime: 20, seed: 176, trend: 0.16, season: 0.08,
    bom: [['PNL-CTL3', 1], ['MOT-05HP', 2], ['BLT-M8X40', 8], ['NUT-M8', 8], ['WLD-ER70', 0.3]],
  },
  {
    sku: 'KIT-MK5', name: 'Maintenance Kit MK-5', category: 'Assembly', unit: 'kit', unitCost: 64.0, stock: 42, annualDemand: 900, orderCost: 55, holdingRate: 20, leadTime: 8, seed: 187, trend: 0.07, season: 0.14,
    bom: [['HYD-SK21', 2], ['LUB-ISO68', 4], ['GSK-R120', 6], ['BRG-6205', 2]],
  },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabels(count = 12): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`);
  }
  return out;
}

export function genHistory(annualDemand: number, seed: number, trend = 0, season = 0.1): number[] {
  const rnd = mulberry32(seed);
  const base = annualDemand / 12;
  const hist: number[] = [];
  for (let m = 0; m < 12; m++) {
    const trendF = 1 + trend * ((m - 5.5) / 11);
    const seasonF = 1 + season * Math.sin((m / 12) * Math.PI * 2 + (seed % 6));
    const noise = 0.88 + rnd() * 0.24;
    hist.push(Math.max(1, Math.round(base * trendF * seasonF * noise)));
  }
  const scale = annualDemand / hist.reduce((a, b) => a + b, 0);
  return hist.map((v) => Math.max(1, Math.round(v * scale)));
}

let seq = 0;
export function uid(prefix = 'id'): string {
  seq = (seq + 1) % 10000;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const IN_NOTES = ['Goods received — PO', 'Supplier delivery — PO'];
const OUT_NOTES = ['Issued to production — WO', 'Line consumption — WO', 'Quality sample taken', 'Maintenance issue — WO', 'Customer order shipment'];

function seedTransactions(products: Product[]): Transaction[] {
  const rnd = mulberry32(777);
  const txs: Transaction[] = [];
  const now = Date.now();
  for (let i = 0; i < 34; i++) {
    const p = products[Math.floor(rnd() * products.length)];
    const isIn = rnd() < 0.42;
    const monthly = p.annualDemand / 12;
    const qty = isIn
      ? Math.max(1, Math.round(monthly * (0.5 + rnd() * 0.9)))
      : Math.max(1, Math.round(monthly * (0.06 + rnd() * 0.2)));
    const note = isIn
      ? `${IN_NOTES[Math.floor(rnd() * IN_NOTES.length)]}-${2200 + Math.floor(rnd() * 99)}`
      : `${OUT_NOTES[Math.floor(rnd() * OUT_NOTES.length)]}-${1000 + Math.floor(rnd() * 899)}`;
    txs.push({
      id: uid('tx'),
      productId: p.id,
      type: isIn ? 'in' : 'out',
      qty,
      note,
      ts: now - Math.floor(rnd() * 45 * 86400000) - i * 3600000,
    });
  }
  txs.sort((a, b) => b.ts - a.ts);
  return txs;
}

function defaultLineBalance(): PersistedLineBalance {
  const b = getBenchmark('bosch-13');
  return {
    benchmarkKey: 'bosch-13',
    cycleTime: b ? b.defaultCycleTime : 10,
    tasks: b ? b.tasks.map((t) => ({ ...t, successors: [...(t.successors || [])] })) : [],
    selectedAlgo: 'exact',
  };
}

export function createSeedDB(): WorkspaceDB {
  const products: Product[] = CATALOG.map((c) => ({
    id: `p-${c.sku.toLowerCase()}`,
    sku: c.sku,
    name: c.name,
    category: c.category,
    unit: c.unit,
    unitCost: c.unitCost,
    stock: c.stock,
    annualDemand: c.annualDemand,
    orderCost: c.orderCost,
    holdingRate: c.holdingRate,
    leadTime: c.leadTime,
    serviceLevel: c.serviceLevel ?? 95,
    demandHistory: genHistory(c.annualDemand, c.seed, c.trend, c.season),
    demandSource: 'demo',
    bom: [],
    createdAt: Date.now() - Math.floor(mulberry32(c.seed)() * 200) * 86400000,
  }));

  const bySku: Record<string, Product> = {};
  products.forEach((p) => {
    bySku[p.sku] = p;
  });

  CATALOG.forEach((c) => {
    if (!Array.isArray(c.bom)) return;
    bySku[c.sku].bom = c.bom
      .map(([sku, qtyPer]) => ({
        componentId: bySku[sku] ? bySku[sku].id : '',
        qtyPer: num(qtyPer),
      }))
      .filter((x) => x.componentId && x.qtyPer > 0);
  });

  return {
    version: 1,
    seededAt: Date.now(),
    products,
    transactions: seedTransactions(products),
    settings: {
      theme: 'dark',
      accent: 'emerald',
      reduceMotion: false,
      abcA: 70,
      abcB: 90,
      smaW: 3,
      wmaW: 3,
      emaAlpha: 0.3,
    },
    lineBalance: defaultLineBalance(),
    dismissedSmartAlertIds: [],
    smartAlertHorizonDays: 45,
  };
}

function sanitizeFactorySimConfig(
  raw: Partial<FactorySimConfig> | undefined,
  products: Product[],
  lineBalance: PersistedLineBalance
): FactorySimConfig | undefined {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.stations) || !raw.stations.length) {
    return undefined;
  }
  const validRouting: RoutingMode[] = ['serial', 'rework-loop', 'parallel-cell'];
  const routingMode: RoutingMode = validRouting.includes(raw.routingMode as RoutingMode)
    ? (raw.routingMode as RoutingMode)
    : 'rework-loop';
  const validDist = ['lognormal', 'normal', 'exponential', 'constant'];
  const serviceDist = (validDist.includes(String(raw.serviceDist)) ? raw.serviceDist : 'lognormal') as FactorySimConfig['serviceDist'];

  const stations = raw.stations.slice(0, 20).map((st, idx) => ({
    id: String(st.id || `ST-${idx + 1}`),
    name: String(st.name || `Station ${idx + 1}`),
    meanTimeMin: Math.max(0.2, num(st.meanTimeMin, 6)),
    cv: clamp(num(st.cv, 0.18), 0, 2),
    machineCount: clamp(Math.round(num(st.machineCount, 1)), 1, 6),
    bufferCapacity: clamp(Math.round(num(st.bufferCapacity, 6)), 1, 50),
    setupTimeMin: Math.max(0, num(st.setupTimeMin, 0.25)),
    operatorsPerMachine: clamp(num(st.operatorsPerMachine, 1), 0.5, 4),
    mtbfMin: Math.max(0, num(st.mtbfMin, 200)),
    mttrMin: Math.max(0, num(st.mttrMin, 10)),
    pmIntervalMin: Math.max(0, num(st.pmIntervalMin, 0)),
    pmDurationMin: Math.max(0, num(st.pmDurationMin, 0)),
    hourlyMachineCost: Math.max(0, num(st.hourlyMachineCost, 45)),
  }));

  const materials = Array.isArray(raw.materials)
    ? raw.materials.map((m) => ({
        productId: String(m.productId || ''),
        sku: String(m.sku || 'MAT'),
        name: String(m.name || 'Material'),
        unit: String(m.unit || 'pcs'),
        initialStock: Math.max(0, num(m.initialStock, 0)),
        qtyPerJob: Math.max(0.01, num(m.qtyPerJob, 1)),
        rop: Math.max(0, num(m.rop, 10)),
        orderQty: Math.max(1, num(m.orderQty, 20)),
        leadTimeDays: Math.max(0.5, num(m.leadTimeDays, 7)),
        unitCost: Math.max(0, num(m.unitCost, 1)),
      }))
    : [];

  return {
    name: String(raw.name || 'Factory Simulation Experiment'),
    assemblySku: String(raw.assemblySku || products[0]?.sku || 'ASM-PA100'),
    assemblyName: String(raw.assemblyName || products[0]?.name || 'Assembly Line'),
    arrivalRatePerHour: clamp(num(raw.arrivalRatePerHour, 4.5), 0.1, 120),
    arrivalCv: clamp(num(raw.arrivalCv, 0.45), 0, 2),
    serviceDist,
    routingMode,
    defectRatePct: clamp(num(raw.defectRatePct, 0.8), 0, 45),
    reworkTargetStationIdx: clamp(Math.round(num(raw.reworkTargetStationIdx, 0)), 0, Math.max(0, stations.length - 1)),
    maxReworkLoops: clamp(Math.round(num(raw.maxReworkLoops, 2)), 0, 3),
    shiftsPerDay: clamp(Math.round(num(raw.shiftsPerDay, 2)), 1, 3),
    shiftHours: clamp(num(raw.shiftHours, 8), 4, 12),
    daysToSimulate: clamp(Math.round(num(raw.daysToSimulate, 3)), 1, 30),
    warmupHours: clamp(num(raw.warmupHours, 4), 0, 72),
    operatorsAvailable: clamp(Math.round(num(raw.operatorsAvailable, stations.length)), 1, 100),
    laborRatePerHour: Math.max(1, num(raw.laborRatePerHour, 28)),
    wipHoldingCostPerJobHour: Math.max(0, num(raw.wipHoldingCostPerJobHour, 3.5)),
    stockoutPenaltyPerMissedJob: Math.max(0, num(raw.stockoutPenaltyPerMissedJob, 14)),
    replications: clamp(Math.round(num(raw.replications, 12)), 1, 80),
    seed: (Math.round(num(raw.seed, 2026)) >>> 0) || 101,
    enforceMaterialFlow: Boolean(raw.enforceMaterialFlow),
    stations,
    materials,
    sourceNotes: {
      demandOrigin: String(raw.sourceNotes?.demandOrigin || 'Synced workspace demand'),
      lineBalanceOrigin: String(raw.sourceNotes?.lineBalanceOrigin || lineBalance.benchmarkKey),
      bomOrigin: String(raw.sourceNotes?.bomOrigin || 'Catalog BOM'),
      spcOrigin: String(raw.sourceNotes?.spcOrigin || 'SPC baseline'),
    },
  };
}

export function normalizeDB(obj: Partial<WorkspaceDB>): WorkspaceDB {
  const settings: WorkspaceSettings = {
    theme: obj.settings?.theme === 'light' ? 'light' : 'dark',
    accent: (['blue', 'emerald', 'amber', 'violet'].includes(String(obj.settings?.accent))
      ? obj.settings?.accent
      : 'emerald') as WorkspaceSettings['accent'],
    reduceMotion: !!obj.settings?.reduceMotion,
    abcA: clamp(num(obj.settings?.abcA, 70), 40, 95),
    abcB: clamp(num(obj.settings?.abcB, 90), 50, 99),
    smaW: clamp(num(obj.settings?.smaW, 3), 2, 12),
    wmaW: clamp(num(obj.settings?.wmaW, 3), 2, 12),
    emaAlpha: clamp(num(obj.settings?.emaAlpha, 0.3), 0.05, 0.95),
    advCover: obj.settings?.advCover != null ? num(obj.settings.advCover) : undefined,
    advSlLow: obj.settings?.advSlLow != null ? num(obj.settings.advSlLow) : undefined,
    advSlHigh: obj.settings?.advSlHigh != null ? num(obj.settings.advSlHigh) : undefined,
    onboardingDismissed: Boolean(obj.settings?.onboardingDismissed),
    onboardingCompletedSteps: Array.isArray(obj.settings?.onboardingCompletedSteps)
      ? [...new Set(obj.settings.onboardingCompletedSteps.map((x) => String(x)).filter(Boolean))]
      : [],
  };

  const validSources: DemandSource[] = ['demo', 'user', 'imported', 'synthetic'];
  const products: Product[] = (Array.isArray(obj.products) ? obj.products : []).map((p) => ({
    id: p.id || uid('p'),
    sku: String(p.sku || 'SKU').trim().toUpperCase(),
    name: String(p.name || 'Item').trim(),
    category: String(p.category || 'Other').trim(),
    unit: String(p.unit || 'pcs').trim(),
    unitCost: Math.max(0, num(p.unitCost)),
    stock: Math.max(0, num(p.stock)),
    annualDemand: Math.max(0, num(p.annualDemand)),
    orderCost: Math.max(0, num(p.orderCost)),
    holdingRate: clamp(num(p.holdingRate, 20), 0.1, 100),
    leadTime: Math.max(0, num(p.leadTime, 7)),
    serviceLevel: clamp(num(p.serviceLevel, 95), 50, 99.9),
    demandHistory: Array.isArray(p.demandHistory) ? p.demandHistory.map((v) => Math.max(0, num(v))) : [],
    demandSource: validSources.includes(p.demandSource as DemandSource) ? p.demandSource : undefined,
    bom: Array.isArray(p.bom)
      ? p.bom.map((b) => ({ componentId: String(b.componentId || ''), qtyPer: num(b.qtyPer) }))
      : [],
    createdAt: num(p.createdAt, Date.now()),
  }));

  const ids = new Set(products.map((p) => p.id));
  products.forEach((p) => {
    p.bom = p.bom.filter((b) => b.qtyPer > 0 && ids.has(b.componentId) && b.componentId !== p.id);
  });

  const transactions: Transaction[] = (Array.isArray(obj.transactions) ? obj.transactions : [])
    .filter((t) => t && ids.has(t.productId))
    .map((t) => ({
      id: t.id || uid('tx'),
      productId: t.productId,
      type: t.type === 'in' ? ('in' as const) : ('out' as const),
      qty: Math.abs(num(t.qty)),
      note: String(t.note || ''),
      ts: num(t.ts, Date.now()),
    }))
    .sort((a, b) => b.ts - a.ts);

  const fallbackLb = defaultLineBalance();
  const rawLb = obj.lineBalance;
  const lineBalance: PersistedLineBalance =
    rawLb && Array.isArray(rawLb.tasks) && rawLb.tasks.length
      ? {
          benchmarkKey: String(rawLb.benchmarkKey || 'bosch-13'),
          cycleTime: Math.max(1, num(rawLb.cycleTime, fallbackLb.cycleTime)),
          tasks: rawLb.tasks.map((t) => ({
            id: String(t.id || '').trim().toUpperCase() || 'T',
            ...(t.name ? { name: String(t.name) } : {}),
            time: Math.max(0.1, num(t.time, 1)),
            successors: Array.isArray(t.successors)
              ? t.successors.map((x) => String(x).trim().toUpperCase()).filter(Boolean)
              : [],
          })),
          selectedAlgo: rawLb.selectedAlgo === 'comsail' ? 'comsoal' : String(rawLb.selectedAlgo || 'exact'),
        }
      : fallbackLb;

  const dismissedSmartAlertIds = Array.isArray(obj.dismissedSmartAlertIds)
    ? obj.dismissedSmartAlertIds.map((x) => String(x))
    : [];
  const smartAlertHorizonDays = clamp(num(obj.smartAlertHorizonDays, 45), 7, 180);

  const factorySimConfig = sanitizeFactorySimConfig(obj.factorySimConfig, products, lineBalance);
  const factoryScenarios: FactoryScenarioRecord[] = Array.isArray(obj.factoryScenarios)
    ? obj.factoryScenarios
        .map((sc) => {
          const cleanCfg = sanitizeFactorySimConfig(sc?.config, products, lineBalance);
          if (!cleanCfg || !sc?.name) return null;
          return {
            id: String(sc.id || uid('fsc')),
            name: String(sc.name),
            notes: String(sc.notes || ''),
            createdAt: num(sc.createdAt, Date.now()),
            config: cleanCfg,
          };
        })
        .filter((x): x is FactoryScenarioRecord => x !== null)
    : [];

  const scenarioStudioRecords: ScenarioDefinition[] = Array.isArray(obj.scenarioStudioRecords)
    ? obj.scenarioStudioRecords
        .slice(0, 30)
        .filter((sc) => sc && typeof sc === 'object' && sc.name && sc.params)
        .map((sc, idx) => ({
          id: String(sc.id || uid('scst') + idx).slice(0, 64),
          name: String(sc.name || `Scenario ${idx + 1}`).trim().slice(0, 100),
          notes: String(sc.notes || '').trim().slice(0, 400),
          createdAt: num(sc.createdAt, Date.now()),
          isBaseline: false,
          params: sanitizeScenarioParams(sc.params),
        }))
    : [];

  const validActionCats = new Set(['inventory', 'bom', 'scenario', 'settings', 'import', 'system']);
  const actionLog: ActionLogEntry[] = Array.isArray(obj.actionLog)
    ? obj.actionLog
        .slice(0, 100)
        .filter((e) => e && typeof e === 'object' && e.action)
        .map((e, idx) => ({
          id: String(e.id || uid('act') + idx).slice(0, 64),
          ts: num(e.ts, Date.now()),
          category: (validActionCats.has(String(e.category)) ? e.category : 'system') as ActionLogEntry['category'],
          action: String(e.action).slice(0, 120),
          detail: String(e.detail || '').slice(0, 300),
          ...(e.route ? { route: String(e.route).slice(0, 64) } : {}),
        }))
    : [];

  return {
    version: 1,
    seededAt: num(obj.seededAt, Date.now()),
    products,
    transactions,
    settings,
    lineBalance,
    dismissedSmartAlertIds,
    smartAlertHorizonDays,
    ...(factorySimConfig ? { factorySimConfig } : {}),
    ...(factoryScenarios.length ? { factoryScenarios } : {}),
    ...(scenarioStudioRecords.length ? { scenarioStudioRecords } : {}),
    ...(actionLog.length ? { actionLog } : {}),
  };
}

export function computeMetrics(p: Product): ProductMetrics {
  const e = eoq({
    annualDemand: p.annualDemand,
    orderCost: p.orderCost,
    unitCost: p.unitCost,
    holdingRate: p.holdingRate,
  });
  const r = rop({
    annualDemand: p.annualDemand,
    leadTimeDays: p.leadTime,
    serviceLevel: p.serviceLevel,
    history: p.demandHistory,
  });
  const status = statusFor(p.stock, r.rop, r.safetyStock);
  return {
    H: e.H,
    eoq: e,
    rop: r.rop,
    safetyStock: r.safetyStock,
    z: r.z,
    dBar: r.dBar,
    sigmaD: r.sigmaD,
    sigmaSource: r.sigmaSource,
    sigmaFallback: r.sigmaFallback,
    status,
    statusMeta: STATUS_META[status],
    stockValue: p.stock * p.unitCost,
    usageValue: p.unitCost * p.annualDemand,
    monthsOfCover: p.annualDemand > 0 ? p.stock / (p.annualDemand / 12) : Infinity,
    suggestedOrderQty: Math.max(1, Math.round(e.Q || 0)),
  };
}

export function toCSV(header: string[], rows: Array<Array<string | number>>): string {
  const esc = (v: string | number | null | undefined) => {
    const raw = String(v == null ? '' : v);
    const safe = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

export function parseCSV(text: string): string[][] {
  const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

export class FactoryStore {
  db: WorkspaceDB;
  private storage: StorageBackend;
  readonly storageMode: string;

  constructor(storage: StorageBackend = createSafeStorage()) {
    this.storage = storage;
    this.storageMode = storage.persistent ? 'localStorage' : 'memory';
    this.db = this.loadOrSeed();
  }

  private loadOrSeed(): WorkspaceDB {
    const raw = this.storage.get(DB_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<WorkspaceDB>;
        if (parsed && Array.isArray(parsed.products)) {
          return normalizeDB(parsed);
        }
      } catch {
        // fall through to seed
      }
    }
    const seeded = createSeedDB();
    this.storage.set(DB_STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  save(): void {
    this.storage.set(DB_STORAGE_KEY, JSON.stringify(this.db));
  }

  reset(): void {
    const theme = this.db.settings.theme;
    const accent = this.db.settings.accent;
    const reduceMotion = this.db.settings.reduceMotion;
    this.db = createSeedDB();
    this.db.settings.theme = theme;
    this.db.settings.accent = accent;
    this.db.settings.reduceMotion = reduceMotion;
    this.recordAction('system', 'Restored demo dataset', 'Reset workspace to 17 seeded SKUs, 5 BOMs, and 34 transactions', 'settings', false);
    this.save();
  }

  clearAll(): void {
    this.db = normalizeDB({ version: 1, products: [], transactions: [], settings: this.db.settings, actionLog: this.db.actionLog });
    this.recordAction('system', 'Cleared workspace', 'Removed all SKUs and transactions for clean-slate entry', 'settings', false);
    this.save();
  }

  actionLog(): ActionLogEntry[] {
    return Array.isArray(this.db.actionLog) ? this.db.actionLog : [];
  }

  recordAction(
    category: ActionLogEntry['category'],
    action: string,
    detail: string,
    route?: string,
    persist = true
  ): ActionLogEntry {
    const entry: ActionLogEntry = {
      id: uid('act'),
      ts: Date.now(),
      category,
      action: String(action).slice(0, 120),
      detail: String(detail).slice(0, 300),
      ...(route ? { route } : {}),
    };
    this.db.actionLog = [entry, ...(this.db.actionLog || [])].slice(0, 100);
    if (persist) this.save();
    return entry;
  }

  clearActionLog(): void {
    this.db.actionLog = [];
    this.save();
  }

  products(): Product[] {
    return this.db.products;
  }

  getProduct(id: string): Product | null {
    return this.db.products.find((p) => p.id === id) || null;
  }

  addProduct(data: Partial<Product>): Product {
    const annualDemand = Math.max(0, num(data.annualDemand));
    const hasExplicitHistory = Array.isArray(data.demandHistory) && data.demandHistory.length > 0;
    const p: Product = {
      id: uid('p'),
      sku: String(data.sku || '').trim().toUpperCase() || `SKU-${this.db.products.length + 1}`,
      name: String(data.name || 'Unnamed item').trim(),
      category: String(data.category || 'Other').trim(),
      unit: String(data.unit || 'pcs').trim(),
      unitCost: Math.max(0, num(data.unitCost)),
      stock: Math.max(0, num(data.stock)),
      annualDemand,
      orderCost: Math.max(0, num(data.orderCost)),
      holdingRate: clamp(num(data.holdingRate, 20), 0.1, 100),
      leadTime: Math.max(0, num(data.leadTime, 7)),
      serviceLevel: clamp(num(data.serviceLevel, 95), 50, 99.9),
      demandHistory: hasExplicitHistory ? data.demandHistory!.map((v) => Math.max(0, num(v))) : [],
      demandSource: data.demandSource || 'user',
      bom: Array.isArray(data.bom) ? data.bom : [],
      createdAt: Date.now(),
    };
    this.db.products.push(p);
    this.recordAction('inventory', `Added SKU ${p.sku}`, `${p.name} · ${p.stock} ${p.unit}`, 'inventory', false);
    this.save();
    return p;
  }

  updateProduct(id: string, data: Partial<Product>): Product | null {
    const p = this.getProduct(id);
    if (!p) return null;
    if (data.sku !== undefined) p.sku = String(data.sku).trim().toUpperCase();
    if (data.name !== undefined) p.name = String(data.name).trim();
    if (data.category !== undefined) p.category = String(data.category).trim();
    if (data.unit !== undefined) p.unit = String(data.unit).trim();
    if (data.unitCost !== undefined) p.unitCost = Math.max(0, num(data.unitCost, p.unitCost));
    if (data.stock !== undefined) p.stock = Math.max(0, num(data.stock, p.stock));
    if (data.annualDemand !== undefined) p.annualDemand = Math.max(0, num(data.annualDemand, p.annualDemand));
    if (data.orderCost !== undefined) p.orderCost = Math.max(0, num(data.orderCost, p.orderCost));
    if (data.holdingRate !== undefined) p.holdingRate = clamp(num(data.holdingRate, p.holdingRate), 0.1, 100);
    if (data.leadTime !== undefined) p.leadTime = Math.max(0, num(data.leadTime, p.leadTime));
    if (data.serviceLevel !== undefined) p.serviceLevel = clamp(num(data.serviceLevel, p.serviceLevel), 50, 99.9);
    if (Array.isArray(data.demandHistory)) {
      p.demandHistory = data.demandHistory.map((v) => Math.max(0, num(v)));
    }
    if (data.demandSource !== undefined) p.demandSource = data.demandSource;
    this.recordAction('inventory', `Updated SKU ${p.sku}`, `${p.name} parameters saved`, 'inventory', false);
    this.save();
    return p;
  }

  deleteProductSnapshot(id: string): ProductSnapshot | null {
    const p = this.getProduct(id);
    if (!p) return null;
    return {
      product: JSON.parse(JSON.stringify(p)) as Product,
      transactions: JSON.parse(JSON.stringify(this.transactionsFor(id))) as Transaction[],
    };
  }

  deleteProduct(id: string): void {
    const target = this.getProduct(id);
    this.db.products = this.db.products.filter((p) => p.id !== id);
    this.db.transactions = this.db.transactions.filter((t) => t.productId !== id);
    this.db.products.forEach((p) => {
      p.bom = (p.bom || []).filter((b) => b.componentId !== id);
    });
    if (target) {
      this.recordAction('inventory', `Deleted SKU ${target.sku}`, `${target.name} removed (undo available in toast)`, 'inventory', false);
    }
    this.save();
  }

  restoreProduct(snap: ProductSnapshot): Product | null {
    if (!snap || !snap.product) return null;
    if (this.getProduct(snap.product.id)) return null;
    this.db.products.push(snap.product);
    (snap.transactions || []).forEach((t) => this.db.transactions.push(t));
    this.db.transactions.sort((a, b) => b.ts - a.ts);
    this.recordAction('inventory', `Restored SKU ${snap.product.sku}`, `${snap.product.name} undone from delete`, 'inventory', false);
    this.save();
    return snap.product;
  }

  bomOf(productId: string): Array<{ componentId: string; qtyPer: number; product: Product }> {
    const p = this.getProduct(productId);
    if (!p) return [];
    return (p.bom || [])
      .map((b) => ({ componentId: b.componentId, qtyPer: b.qtyPer, product: this.getProduct(b.componentId)! }))
      .filter((b) => !!b.product);
  }

  setBom(productId: string, lines: BomLine[]): BomLine[] | null {
    const p = this.getProduct(productId);
    if (!p) return null;
    const seen = new Set<string>();
    p.bom = (lines || [])
      .map((l) => ({ componentId: String(l.componentId || ''), qtyPer: Math.max(0, num(l.qtyPer)) }))
      .filter((l) => {
        if (!l.componentId || l.componentId === productId) return false;
        if (!this.getProduct(l.componentId) || seen.has(l.componentId)) return false;
        if (!(l.qtyPer > 0)) return false;
        seen.add(l.componentId);
        return true;
      });
    this.save();
    return p.bom;
  }

  productsWithBom(): Product[] {
    return this.db.products.filter((p) => Array.isArray(p.bom) && p.bom.length > 0);
  }

  materialCost(productId: string): number {
    return this.bomOf(productId).reduce((s, b) => s + b.product.unitCost * b.qtyPer, 0);
  }

  categories(): string[] {
    return [...new Set(this.db.products.map((p) => p.category).filter(Boolean))].sort();
  }

  addTransaction(productId: string, type: 'in' | 'out', qty: number, note = ''): Transaction | null {
    const p = this.getProduct(productId);
    if (!p) return null;
    let q = Math.abs(num(qty));
    if (!(q > 0)) return null;
    if (type === 'out' && q > p.stock) q = p.stock;
    p.stock = Math.max(0, Math.round((p.stock + (type === 'in' ? q : -q)) * 1e6) / 1e6);
    const tx: Transaction = {
      id: uid('tx'),
      productId,
      type,
      qty: q,
      note: String(note || '').trim() || (type === 'in' ? 'Stock received' : 'Stock issued'),
      ts: Date.now(),
    };
    this.db.transactions.unshift(tx);
    if (this.db.transactions.length > 2000) this.db.transactions.length = 2000;
    this.recordAction(
      'inventory',
      `${type === 'in' ? 'Received' : 'Issued'} ${q} ${p.unit} of ${p.sku}`,
      tx.note,
      'ledger',
      false
    );
    this.save();
    return tx;
  }

  transactions(): Transaction[] {
    return this.db.transactions;
  }

  transactionsFor(productId: string): Transaction[] {
    return this.db.transactions.filter((t) => t.productId === productId);
  }

  settings(): WorkspaceSettings {
    return this.db.settings;
  }

  setSetting<K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]): void {
    this.db.settings[key] = value;
    this.save();
  }

  getLineBalance(): PersistedLineBalance {
    if (!this.db.lineBalance) this.db.lineBalance = defaultLineBalance();
    return this.db.lineBalance;
  }

  setLineBalance(lb: PersistedLineBalance): void {
    this.db.lineBalance = {
      benchmarkKey: String(lb.benchmarkKey || 'bosch-13'),
      cycleTime: Math.max(1, num(lb.cycleTime, 10)),
      tasks: lb.tasks.map((t) => ({
        id: String(t.id || '').trim().toUpperCase() || 'T',
        ...(t.name ? { name: String(t.name) } : {}),
        time: Math.max(0.1, num(t.time, 1)),
        successors: Array.isArray(t.successors)
          ? t.successors.map((x) => String(x).trim().toUpperCase()).filter(Boolean)
          : [],
      })),
      selectedAlgo: lb.selectedAlgo === 'comsail' ? 'comsoal' : String(lb.selectedAlgo || 'exact'),
    };
    this.save();
  }

  getSmartAlertPrefs(): { horizonDays: number; dismissedIds: string[] } {
    return {
      horizonDays: clamp(num(this.db.smartAlertHorizonDays, 45), 7, 180),
      dismissedIds: Array.isArray(this.db.dismissedSmartAlertIds) ? [...this.db.dismissedSmartAlertIds] : [],
    };
  }

  setSmartAlertHorizonDays(days: number): void {
    this.db.smartAlertHorizonDays = clamp(Math.round(num(days, 45)), 7, 180);
    this.save();
  }

  dismissSmartAlert(id: string): void {
    const list = this.db.dismissedSmartAlertIds || [];
    if (!list.includes(id)) {
      this.db.dismissedSmartAlertIds = [...list, id];
      this.save();
    }
  }

  restoreAllSmartAlerts(): void {
    this.db.dismissedSmartAlertIds = [];
    this.save();
  }

  getFactorySimConfig(): FactorySimConfig {
    if (!this.db.factorySimConfig) {
      this.db.factorySimConfig = buildDefaultFactoryConfigFromWorkspace({
        products: this.db.products,
        lineBalance: this.getLineBalance(),
        metricsOf: (p) => this.metrics(p as Product),
      });
    }
    return this.db.factorySimConfig;
  }

  setFactorySimConfig(cfg: FactorySimConfig): void {
    const clean = sanitizeFactorySimConfig(cfg, this.db.products, this.getLineBalance());
    if (clean) {
      this.db.factorySimConfig = clean;
      this.save();
    }
  }

  getFactoryScenarios(): FactoryScenarioRecord[] {
    return Array.isArray(this.db.factoryScenarios) ? this.db.factoryScenarios : [];
  }

  saveFactoryScenario(name: string, notes: string, config: FactorySimConfig): FactoryScenarioRecord {
    const clean = sanitizeFactorySimConfig(config, this.db.products, this.getLineBalance()) || this.getFactorySimConfig();
    const rec: FactoryScenarioRecord = {
      id: uid('fsc'),
      name: String(name || 'Saved Scenario').trim(),
      notes: String(notes || '').trim(),
      createdAt: Date.now(),
      config: JSON.parse(JSON.stringify(clean)) as FactorySimConfig,
    };
    const existing = this.getFactoryScenarios();
    this.db.factoryScenarios = [rec, ...existing].slice(0, 24);
    this.save();
    return rec;
  }

  deleteFactoryScenario(id: string): void {
    this.db.factoryScenarios = this.getFactoryScenarios().filter((s) => s.id !== id);
    this.save();
  }

  getScenarioStudioRecords(): ScenarioDefinition[] {
    return Array.isArray(this.db.scenarioStudioRecords) ? this.db.scenarioStudioRecords : [];
  }

  saveScenarioStudioRecord(
    def: Omit<ScenarioDefinition, 'createdAt'> & { createdAt?: number }
  ): ScenarioDefinition {
    const clean: ScenarioDefinition = {
      id: String(def.id || uid('scst')).slice(0, 64),
      name: String(def.name || 'Saved Scenario').trim().slice(0, 100),
      notes: String(def.notes || '').trim().slice(0, 400),
      createdAt: def.createdAt ?? Date.now(),
      isBaseline: false,
      params: sanitizeScenarioParams(def.params, this.getFactorySimConfig().assemblySku),
    };
    const existing = this.getScenarioStudioRecords().filter((s) => s.id !== clean.id);
    this.db.scenarioStudioRecords = [clean, ...existing].slice(0, 30);
    this.save();
    return clean;
  }

  deleteScenarioStudioRecord(id: string): void {
    this.db.scenarioStudioRecords = this.getScenarioStudioRecords().filter((s) => s.id !== id);
    this.save();
  }

  importScenarioStudioRecords(defs: ScenarioDefinition[]): number {
    const fallbackAsm = this.getFactorySimConfig().assemblySku;
    const sanitized = defs.slice(0, 30).map((d, i) => ({
      id: String(d.id || uid('scimp') + i).slice(0, 64),
      name: String(d.name || `Imported Scenario ${i + 1}`).trim().slice(0, 100),
      notes: String(d.notes || '').trim().slice(0, 400),
      createdAt: num(d.createdAt, Date.now()),
      isBaseline: false,
      params: sanitizeScenarioParams(d.params, fallbackAsm),
    }));
    const existingIds = new Set(sanitized.map((s) => s.id));
    const merged = [...sanitized, ...this.getScenarioStudioRecords().filter((s) => !existingIds.has(s.id))].slice(0, 30);
    this.db.scenarioStudioRecords = merged;
    this.save();
    return sanitized.length;
  }

  applyScenarioToWorkspace(def: ScenarioDefinition): void {
    const curSim = this.getFactorySimConfig();
    const p = sanitizeScenarioParams(def.params, curSim.assemblySku);
    const curLb = this.getLineBalance();

    // 1. Update Line Balance Cycle Time
    const nextCycle = Math.max(1, Number((curLb.cycleTime * p.machineCycleMult).toFixed(2)));
    this.setLineBalance({ ...curLb, cycleTime: nextCycle });

    // 2. Update Factory Simulation Config
    let bnIdx = 0;
    for (let i = 1; i < curSim.stations.length; i++) {
      const rateCur = curSim.stations[i].meanTimeMin / Math.max(1, curSim.stations[i].machineCount);
      const rateBn = curSim.stations[bnIdx].meanTimeMin / Math.max(1, curSim.stations[bnIdx].machineCount);
      if (rateCur > rateBn) bnIdx = i;
    }
    const targetAsm =
      this.db.products.find((pr) => pr.sku.toUpperCase() === p.assemblySku.toUpperCase()) ||
      this.db.products[0];
    const nextSim: FactorySimConfig = {
      ...curSim,
      assemblySku: targetAsm ? targetAsm.sku : p.assemblySku,
      assemblyName: targetAsm ? targetAsm.name : curSim.assemblyName,
      arrivalRatePerHour: clamp(Number((curSim.arrivalRatePerHour * p.demandVolumeMult).toFixed(2)), 0.1, 120),
      arrivalCv: clamp(Number((curSim.arrivalCv * p.demandVariabilityMult).toFixed(2)), 0, 2),
      shiftsPerDay: p.shiftsPerDay,
      shiftHours: p.shiftHours,
      operatorsAvailable: p.operatorsAvailable,
      defectRatePct: p.scrapRatePct,
      replications: p.replications,
      seed: p.seed,
      stations: curSim.stations.map((st, idx) => ({
        ...st,
        meanTimeMin: Math.max(0.25, Number((st.meanTimeMin * p.machineCycleMult).toFixed(2))),
        bufferCapacity: p.bufferCapacity,
        mtbfMin: st.mtbfMin > 0 ? Math.max(10, Math.round(st.mtbfMin / p.breakdownFreqMult)) : 0,
        machineCount: idx === bnIdx ? Math.min(6, st.machineCount + p.extraBottleneckMachines) : st.machineCount,
      })),
    };
    this.setFactorySimConfig(nextSim);

    // 3. Optionally update target assembly & direct BOM service level / lead-time parameters
    if (targetAsm) {
      const inScopeIds = new Set<string>([targetAsm.id, ...(targetAsm.bom || []).map((b) => b.componentId)]);
      this.db.products.forEach((prod) => {
        if (!inScopeIds.has(prod.id)) return;
        if (Math.abs(p.supplierLeadTimeMult - 1) > 0.01) {
          prod.leadTime = Math.max(0.5, Number((prod.leadTime * p.supplierLeadTimeMult).toFixed(1)));
        }
        if (p.reorderPolicy === 'service-target') {
          prod.serviceLevel = clamp(p.targetServiceLevelPct, 50, 99.9);
        }
      });
    }
    this.recordAction(
      'scenario',
      `Applied scenario "${def.name}"`,
      `Demand ${p.demandVolumeMult.toFixed(2)}×, cycle ${p.machineCycleMult.toFixed(2)}×, ${p.shiftsPerDay} shifts/day`,
      'scenario-studio',
      false
    );
    this.save();
  }

  metrics(p: Product): ProductMetrics {
    return computeMetrics(p);
  }

  summary(): WorkspaceSummary {
    const products = this.db.products;
    let stockValue = 0;
    let usageValue = 0;
    const counts: Record<StockStatus, number> = { ok: 0, reorder: 0, critical: 0, out: 0 };
    const byCategory: Record<string, number> = {};
    products.forEach((p) => {
      const m = this.metrics(p);
      stockValue += m.stockValue;
      usageValue += m.usageValue;
      counts[m.status]++;
      byCategory[p.category] = (byCategory[p.category] || 0) + m.stockValue;
    });
    return {
      skuCount: products.length,
      stockValue,
      usageValue,
      counts,
      byCategory,
      alertCount: counts.reorder + counts.critical + counts.out,
      txCount: this.db.transactions.length,
    };
  }

  valueHistory(days = 30): Array<{ ts: number; value: number }> {
    const prods = this.products();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byDay: Record<number, Transaction[]> = {};
    this.transactions().forEach((t) => {
      const d = new Date(t.ts);
      d.setHours(0, 0, 0, 0);
      const k = d.getTime();
      (byDay[k] = byDay[k] || []).push(t);
    });
    let cur = prods.reduce((s, p) => s + p.stock * p.unitCost, 0);
    const series: Array<{ ts: number; value: number }> = [{ ts: today.getTime(), value: cur }];
    for (let k = 1; k < days; k++) {
      const dayTs = today.getTime() - (k - 1) * 86400000;
      (byDay[dayTs] || []).forEach((t) => {
        const p = this.getProduct(t.productId);
        if (p) cur -= (t.type === 'in' ? t.qty : -t.qty) * p.unitCost;
      });
      series.push({ ts: today.getTime() - k * 86400000, value: Math.max(0, cur) });
    }
    return series.reverse();
  }

  flowHistory(days = 30): Array<{ ts: number; inn: number; out: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const map: Record<number, { inn: number; out: number }> = {};
    for (let k = days - 1; k >= 0; k--) map[today.getTime() - k * 86400000] = { inn: 0, out: 0 };
    this.transactions().forEach((t) => {
      const d = new Date(t.ts);
      d.setHours(0, 0, 0, 0);
      const b = map[d.getTime()];
      if (b) {
        if (t.type === 'in') b.inn += t.qty;
        else b.out += t.qty;
      }
    });
    return Object.entries(map).map(([ts, v]) => ({ ts: Number(ts), inn: v.inn, out: v.out }));
  }

  exportJSON(): string {
    return JSON.stringify({ ...this.db, exportedAt: new Date().toISOString(), app: 'FactoryMind', version: 1 }, null, 2);
  }

  importJSON(text: string): number {
    if (typeof text !== 'string' || text.length > 5_000_000) {
      throw new Error('JSON file exceeds 5 MB limit or is invalid.');
    }
    const obj = JSON.parse(text, (key, val) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
      return val;
    }) as Partial<WorkspaceDB>;
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.products)) {
      throw new Error('Invalid file: missing products[]');
    }
    obj.products.forEach((p) => {
      if (!p || typeof p !== 'object' || !p.name) throw new Error('Invalid file: product without a name');
    });
    this.db = normalizeDB(obj);
    this.recordAction('import', 'Imported JSON backup', `Loaded ${this.db.products.length} SKUs into workspace`, 'settings', false);
    this.save();
    return this.db.products.length;
  }

  exportProductsCSV(): string {
    const rows = this.db.products.map((p) => {
      const m = this.metrics(p);
      return [
        p.sku,
        p.name,
        p.category,
        p.unit,
        p.unitCost,
        p.stock,
        p.annualDemand,
        p.orderCost,
        p.holdingRate,
        p.leadTime,
        m.rop.toFixed(0),
        m.safetyStock.toFixed(0),
        m.eoq.Q.toFixed(0),
        m.status,
        m.stockValue.toFixed(2),
      ];
    });
    return toCSV(
      [
        'SKU',
        'Name',
        'Category',
        'Unit',
        'Unit Cost',
        'Stock',
        'Annual Demand',
        'Order Cost',
        'Holding Rate %',
        'Lead Time (days)',
        'ROP',
        'Safety Stock',
        'EOQ',
        'Status',
        'Stock Value',
      ],
      rows
    );
  }

  exportTransactionsCSV(): string {
    const rows = this.db.transactions.map((t) => {
      const p = this.getProduct(t.productId);
      return [new Date(t.ts).toISOString(), p ? p.sku : '?', p ? p.name : 'Deleted item', t.type, t.qty, t.note];
    });
    return toCSV(['Timestamp', 'SKU', 'Product', 'Type', 'Qty', 'Note'], rows);
  }

  csvTemplate(): string {
    return toCSV(
      ['SKU', 'Name', 'Category', 'Unit', 'Unit Cost', 'Stock', 'Annual Demand', 'Order Cost', 'Holding Rate %', 'Lead Time (days)', 'Service Level'],
      [
        ['BRG-6204', 'Ball bearing 6204', 'Component', 'pcs', 3.8, 250, 9000, 45, 24, 5, 95],
        ['BLT-M8X40-EX', 'Hex bolt M8x40', 'Fastener', 'pcs', 0.14, 12000, 48000, 25, 18, 3, 97],
      ]
    );
  }

  importProductsCSV(text: string): { created: number; updated: number; skipped: Array<{ line: number; reason: string }> } {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error('The file is empty — nothing to import.');
    const head = rows.shift()!.map((h) => String(h || '').trim().toLowerCase());
    const ALIASES: Record<string, string[]> = {
      sku: ['sku', 'code', 'item code'],
      name: ['name', 'product', 'product name', 'item'],
      category: ['category', 'group', 'type'],
      unit: ['unit', 'uom'],
      unitCost: ['unit cost', 'cost', 'unit price', 'price'],
      stock: ['stock', 'on hand', 'onhand', 'qty', 'quantity'],
      annualDemand: ['annual demand', 'demand', 'yearly demand'],
      orderCost: ['order cost', 'ordering cost', 'setup cost'],
      holdingRate: ['holding rate %', 'holding rate', 'holding %', 'holding cost %'],
      leadTime: ['lead time (days)', 'lead time', 'lead time days'],
      serviceLevel: ['service level', 'service level %', 'service %'],
    };
    const col: Record<string, number> = {};
    Object.keys(ALIASES).forEach((f) => {
      col[f] = ALIASES[f].map((a) => head.indexOf(a)).find((i) => i >= 0) ?? -1;
    });
    if (col.sku < 0 && col.name < 0) {
      throw new Error('No SKU or Name column found.');
    }
    const NUMERIC = ['unitCost', 'stock', 'annualDemand', 'orderCost', 'holdingRate', 'leadTime', 'serviceLevel'] as const;
    const get = (row: string[], f: string) => (col[f] >= 0 ? String(row[col[f]] == null ? '' : row[col[f]]).trim() : '');
    const out = { created: 0, updated: 0, skipped: [] as Array<{ line: number; reason: string }> };

    rows.forEach((row, i) => {
      const line = i + 2;
      const sku = get(row, 'sku').toUpperCase();
      const name = get(row, 'name');
      if (!sku && !name) {
        out.skipped.push({ line, reason: 'no SKU or name' });
        return;
      }
      for (const f of NUMERIC) {
        const raw = get(row, f);
        if (raw !== '' && Number.isNaN(parseFloat(raw))) {
          out.skipped.push({ line, reason: `${f} is not a number` });
          return;
        }
      }
      const data: Partial<Product> = {};
      if (name) data.name = name;
      if (sku) data.sku = sku;
      const cat = get(row, 'category');
      if (cat) data.category = cat;
      const unit = get(row, 'unit');
      if (unit) data.unit = unit;
      for (const f of NUMERIC) {
        const v = get(row, f);
        if (v !== '') data[f] = parseFloat(v);
      }
      if (data.stock !== undefined) data.stock = Math.max(0, data.stock);

      const existing =
        (sku ? this.db.products.find((p) => p.sku === sku) : undefined) ||
        (name ? this.db.products.find((p) => p.name.toLowerCase() === name.toLowerCase()) : undefined);

      if (existing) {
        const wantStock = data.stock;
        delete data.stock;
        this.updateProduct(existing.id, data);
        if (wantStock !== undefined && wantStock !== existing.stock) {
          this.addTransaction(
            existing.id,
            wantStock > existing.stock ? 'in' : 'out',
            Math.abs(wantStock - existing.stock),
            'CSV import'
          );
        }
        out.updated++;
      } else {
        const wantStock = data.stock || 0;
        delete data.stock;
        const created = this.addProduct({
          ...data,
          sku,
          name: name || sku || 'Imported item',
          stock: 0,
          demandSource: 'imported',
        });
        if (wantStock > 0) this.addTransaction(created.id, 'in', wantStock, 'CSV import');
        out.created++;
      }
    });
    this.recordAction(
      'import',
      'Imported product CSV',
      `${out.created} created, ${out.updated} updated${out.skipped.length ? `, ${out.skipped.length} skipped` : ''}`,
      'inventory',
      false
    );
    this.save();
    return out;
  }
}
