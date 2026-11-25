/**
 * Workspace data layer: persistence (localStorage with in-memory fallback),
 * seeded manufacturing catalogue (17 SKUs + 5 BOMs + 34 transactions), CRUD,
 * CSV/JSON import & export, and derived inventory/ledger analytics.
 */

import {
  buildDefaultFactoryConfigFromWorkspace,
  FactoryDesPersistedOptions,
  FactoryScenarioRecord,
  FactorySimConfig,
  RoutingMode,
} from '../engine/factorySim';
import { clamp, escapeCsvCell, num } from '../engine/formatters';
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

export const CURRENT_SCHEMA_VERSION = 2;
const DB_STORAGE_KEY = 'factorymind.db.v3';
const LEGACY_STORAGE_KEYS = ['factorymind.db.v2', 'factorymind.db.v1', 'factorymind.db'] as const;
const CORRUPT_BACKUP_KEY = 'factorymind.db.corrupt_backup';

export type StorageHealthStatus = 'ok' | 'memory_only' | 'quota_exceeded' | 'corrupted';

export interface StorageHealth {
  status: StorageHealthStatus;
  persisted: boolean;
  quotaExceeded: boolean;
  corruptedDetected: boolean;
  estimatedBytes: number;
  corruptedRaw: string | null;
  canUndoLastReplace: boolean;
  lastError?: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface JsonValidationReport {
  valid: boolean;
  migratedFromVersion: number;
  schemaVersion: number;
  productCount: number;
  transactionCount: number;
  errors: ValidationIssue[];
  warnings: string[];
}

export interface CsvImportResult {
  created: number;
  updated: number;
  skipped: Array<{ line: number; reason: string }>;
  warnings?: string[];
}

export interface StorageBackend {
  persistent: boolean;
  get(key: string): string | null;
  set(key: string, value: string): boolean | void;
  del(key: string): void;
  lastError?: () => string | null;
}

export function createSafeStorage(onError?: (err: unknown) => void): StorageBackend {
  let ls: Storage | null = null;
  const mem: Record<string, string> = {};
  const memDirty = new Set<string>();
  let lastErrMsg: string | null = null;
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      ls = globalThis.localStorage;
      ls.setItem('__fm_probe__', '1');
      ls.removeItem('__fm_probe__');
    }
  } catch (err) {
    lastErrMsg = err instanceof Error ? err.message : 'Browser storage unavailable';
    ls = null;
  }
  return {
    persistent: !!ls,
    lastError: () => lastErrMsg,
    get(k: string) {
      if (memDirty.has(k)) {
        return k in mem ? mem[k] : null;
      }
      try {
        if (ls) {
          const val = ls.getItem(k);
          if (val !== null) return val;
        }
        return k in mem ? mem[k] : null;
      } catch (err) {
        lastErrMsg = err instanceof Error ? err.message : 'Failed reading browser storage';
        return k in mem ? mem[k] : null;
      }
    },
    set(k: string, v: string): boolean {
      try {
        if (ls) {
          ls.setItem(k, v);
          mem[k] = v;
          memDirty.delete(k);
          lastErrMsg = null;
          return true;
        }
        mem[k] = v;
        lastErrMsg = null;
        return true;
      } catch (err) {
        mem[k] = v;
        memDirty.add(k);
        lastErrMsg = err instanceof Error ? err.message : 'Storage write failed';
        if (onError) onError(err);
        return false;
      }
    },
    del(k: string) {
      try {
        if (ls) ls.removeItem(k);
      } catch {
        // ignore removal error on restricted storage
      }
      delete mem[k];
      memDirty.delete(k);
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
    version: CURRENT_SCHEMA_VERSION,
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

  const rawDes = raw.desOptions;
  let desOptions: FactoryDesPersistedOptions | undefined;
  if (rawDes && typeof rawDes === 'object') {
    const validFailureDist = new Set(['weibull', 'exponential', 'lognormal']);
    const failureDist = validFailureDist.has(String(rawDes.failureDist))
      ? (rawDes.failureDist as FactoryDesPersistedOptions['failureDist'])
      : 'weibull';
    const cleanOrders = Array.isArray(rawDes.orders)
      ? rawDes.orders.slice(0, 30).map((o, idx) => ({
          id: String(o?.id || `PO-${101 + idx}`),
          sku: String(o?.sku || raw.assemblySku || 'ASM-PA100'),
          routeId: String(o?.routeId || `RT-${raw.assemblySku || 'ASM-PA100'}`),
          qty: clamp(Math.round(num(o?.qty, 10)), 1, 200),
          releaseAtMin: Math.max(0, num(o?.releaseAtMin, 0)),
          ...(o?.dueAtMin != null ? { dueAtMin: Math.max(60, num(o.dueAtMin, 480)) } : {}),
          ...(o?.priority != null ? { priority: Math.max(1, Math.round(num(o.priority, idx + 1))) } : {}),
        }))
      : [];
    desOptions = {
      deterministic: Boolean(rawDes.deterministic),
      enableShifts: rawDes.enableShifts !== false,
      workDaysPerWeek: clamp(Math.round(num(rawDes.workDaysPerWeek, 5)), 1, 7),
      shiftGapMin: clamp(Math.round(num(rawDes.shiftGapMin, 15)), 0, 120),
      failureDist,
      secondaryRoute: rawDes.secondaryRoute !== false,
      includeOpenArrivals: rawDes.includeOpenArrivals !== false,
      orders: cleanOrders,
    };
  }

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
    ...(desOptions ? { desOptions } : {}),
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
    version: CURRENT_SCHEMA_VERSION,
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

export function migrateWorkspacePayload(raw: unknown): {
  migratedFrom: number;
  data: Partial<WorkspaceDB>;
  notes: string[];
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Backup payload must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;
  const rawVer = obj.version ?? obj.schemaVersion;
  const ver = rawVer === undefined || rawVer === null ? 0 : Number(rawVer);
  if (!Number.isFinite(ver) || ver < 0 || !Number.isInteger(ver)) {
    throw new Error(`Invalid backup schema version "${String(rawVer)}".`);
  }
  if (ver > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Backup uses newer schema v${ver} (supported up to v${CURRENT_SCHEMA_VERSION}). Update FactoryMind before restoring.`
    );
  }
  const notes: string[] = [];
  if (ver < CURRENT_SCHEMA_VERSION) {
    notes.push(`Migrated schema from v${ver} to v${CURRENT_SCHEMA_VERSION}.`);
  }
  return {
    migratedFrom: ver,
    data: { ...(obj as Partial<WorkspaceDB>), version: CURRENT_SCHEMA_VERSION },
    notes,
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
  return [header.map(escapeCsvCell).join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join('\r\n');
}

export function parseCSVStrict(text: string): string[][] {
  if (typeof text !== 'string') {
    throw new Error('CSV input must be text.');
  }
  if (text.length > 5_000_000) {
    throw new Error('CSV file exceeds the 5 MB limit.');
  }
  const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (quoted) {
      if (c === '"') {
        if (cleaned[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      if (cell.trim() !== '') {
        throw new Error(`Malformed CSV at line ${rows.length + 1}: unexpected quotation mark inside unquoted field.`);
      }
      cell = '';
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
  if (quoted) {
    throw new Error(`Malformed CSV near line ${rows.length + 1}: unclosed quotation mark before end of file.`);
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

export function parseCSV(text: string): string[][] {
  const s = String(text == null ? '' : text)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
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
  private quotaExceeded = false;
  private corruptedDetected = false;
  private corruptedRaw: string | null = null;
  private lastStorageError: string | undefined;
  private estimatedBytes = 0;
  private rollbackSnapshot: WorkspaceDB | null = null;

  constructor(storage: StorageBackend = createSafeStorage()) {
    this.storage = storage;
    this.storageMode = storage.persistent ? 'localStorage' : 'memory';
    this.db = this.loadOrSeed();
    if (!this.corruptedDetected) {
      this.estimatedBytes = JSON.stringify(this.db).length;
    }
  }

  getStorageHealth(): StorageHealth {
    return {
      status: this.corruptedDetected
        ? 'corrupted'
        : this.quotaExceeded
          ? 'quota_exceeded'
          : this.storage.persistent
            ? 'ok'
            : 'memory_only',
      persisted: this.storage.persistent && !this.quotaExceeded && !this.corruptedDetected,
      quotaExceeded: this.quotaExceeded,
      corruptedDetected: this.corruptedDetected,
      estimatedBytes: this.estimatedBytes,
      corruptedRaw: this.corruptedRaw,
      canUndoLastReplace: this.rollbackSnapshot !== null,
      lastError: this.lastStorageError,
    };
  }

  getCorruptedBackupRaw(): string | null {
    return this.corruptedRaw ?? this.storage.get(CORRUPT_BACKUP_KEY);
  }

  dismissCorruptedBackup(): void {
    this.corruptedDetected = false;
    this.corruptedRaw = null;
    this.storage.del(CORRUPT_BACKUP_KEY);
    this.save();
  }

  private captureRollbackSnapshot(): void {
    this.rollbackSnapshot = JSON.parse(JSON.stringify(this.db)) as WorkspaceDB;
  }

  undoLastWorkspaceReplace(): boolean {
    if (!this.rollbackSnapshot) return false;
    const restored = normalizeDB(this.rollbackSnapshot);
    this.rollbackSnapshot = null;
    this.db = restored;
    this.corruptedDetected = false;
    this.recordAction('system', 'Undid workspace replacement', `Restored ${this.db.products.length} SKUs and ${this.db.transactions.length} transactions`, 'settings', false);
    this.save();
    return true;
  }

  private writePayload(serialized: string): boolean {
    this.estimatedBytes = serialized.length;
    try {
      const result = this.storage.set(DB_STORAGE_KEY, serialized);
      if (result === false) {
        this.quotaExceeded = true;
        this.lastStorageError = this.storage.lastError?.() || 'Browser storage write failed (quota limit or permission restriction).';
        return false;
      }
      this.quotaExceeded = false;
      this.lastStorageError = undefined;
      return true;
    } catch (err) {
      this.quotaExceeded = true;
      this.lastStorageError = err instanceof Error ? err.message : 'Browser storage quota exceeded.';
      return false;
    }
  }

  private loadOrSeed(): WorkspaceDB {
    let raw = this.storage.get(DB_STORAGE_KEY);
    if (raw === null) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacyRaw = this.storage.get(legacyKey);
        if (legacyRaw !== null) {
          raw = legacyRaw;
          break;
        }
      }
    }

    if (raw !== null) {
      try {
        if (!raw.trim()) {
          throw new Error('Stored workspace payload is empty.');
        }
        const parsed = JSON.parse(raw, (key, val) => {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
          return val;
        }) as unknown;
        const migrated = migrateWorkspacePayload(parsed);
        if (!Array.isArray(migrated.data.products)) {
          throw new Error('Stored workspace data is missing products[].');
        }
        const normalized = normalizeDB(migrated.data);
        if (migrated.migratedFrom < CURRENT_SCHEMA_VERSION) {
          this.writePayload(JSON.stringify(normalized));
        }
        return normalized;
      } catch (err) {
        // NEVER overwrite corrupted user data with sample demo data on startup.
        // Quarantine raw data for forensic recovery and open a clean non-destructive workspace.
        this.corruptedDetected = true;
        this.corruptedRaw = raw;
        this.lastStorageError = err instanceof Error ? err.message : 'Saved workspace data is corrupted.';
        try {
          this.storage.set(CORRUPT_BACKUP_KEY, raw);
        } catch {
          // keep corruptedRaw in memory even if storage write fails
        }
        return normalizeDB({ version: CURRENT_SCHEMA_VERSION, products: [], transactions: [] });
      }
    }

    const seeded = createSeedDB();
    this.writePayload(JSON.stringify(seeded));
    return seeded;
  }

  save(): boolean {
    const serialized = JSON.stringify(this.db);
    if (this.writePayload(serialized)) {
      this.corruptedDetected = false;
      return true;
    }
    // Non-destructive compaction: trim only ephemeral actionLog tail if storage quota was hit;
    // never discard products, BOMs, transactions, scenarios, or settings.
    if (Array.isArray(this.db.actionLog) && this.db.actionLog.length > 15) {
      const compacted: WorkspaceDB = {
        ...this.db,
        actionLog: this.db.actionLog.slice(0, 15),
      };
      if (this.writePayload(JSON.stringify(compacted))) {
        this.db = compacted;
        return true;
      }
    }
    return false;
  }

  reset(): void {
    this.captureRollbackSnapshot();
    const theme = this.db.settings.theme;
    const accent = this.db.settings.accent;
    const reduceMotion = this.db.settings.reduceMotion;
    this.db = createSeedDB();
    this.db.settings.theme = theme;
    this.db.settings.accent = accent;
    this.db.settings.reduceMotion = reduceMotion;
    this.corruptedDetected = false;
    this.corruptedRaw = null;
    this.storage.del(CORRUPT_BACKUP_KEY);
    this.recordAction('system', 'Restored demo dataset', 'Reset workspace to 17 seeded SKUs, 5 BOMs, and 34 transactions', 'settings', false);
    this.save();
  }

  clearAll(): void {
    this.captureRollbackSnapshot();
    this.db = normalizeDB({
      version: CURRENT_SCHEMA_VERSION,
      products: [],
      transactions: [],
      settings: this.db.settings,
      actionLog: this.db.actionLog,
    });
    this.corruptedDetected = false;
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
    const skuNorm = String(data.sku || '').trim().toUpperCase() || `SKU-${this.db.products.length + 1}`;
    if (this.db.products.some((existing) => existing.sku.trim().toUpperCase() === skuNorm)) {
      throw new Error(`Duplicate SKU "${skuNorm}" already exists in the catalogue.`);
    }
    const validateNonNeg = (v: unknown, label: string) => {
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
        throw new Error(`${label} must be a non-negative finite number.`);
      }
    };
    validateNonNeg(data.unitCost, 'Unit cost');
    validateNonNeg(data.stock, 'Stock');
    validateNonNeg(data.annualDemand, 'Annual demand');
    validateNonNeg(data.orderCost, 'Order cost');
    validateNonNeg(data.leadTime, 'Lead time');

    const annualDemand = Math.max(0, num(data.annualDemand));
    const hasExplicitHistory = Array.isArray(data.demandHistory) && data.demandHistory.length > 0;
    const p: Product = {
      id: uid('p'),
      sku: skuNorm,
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
    if (data.sku !== undefined) {
      const nextSku = String(data.sku).trim().toUpperCase();
      if (!nextSku) throw new Error('SKU code cannot be empty.');
      if (this.db.products.some((other) => other.id !== id && other.sku.trim().toUpperCase() === nextSku)) {
        throw new Error(`Duplicate SKU "${nextSku}" already exists in the catalogue.`);
      }
      p.sku = nextSku;
    }
    const validateNonNeg = (v: unknown, label: string) => {
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
        throw new Error(`${label} must be a non-negative finite number.`);
      }
    };
    validateNonNeg(data.unitCost, 'Unit cost');
    validateNonNeg(data.stock, 'Stock');
    validateNonNeg(data.annualDemand, 'Annual demand');
    validateNonNeg(data.orderCost, 'Order cost');
    validateNonNeg(data.leadTime, 'Lead time');

    const prevStock = p.stock;
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

    if (data.stock !== undefined && Math.abs(p.stock - prevStock) > 1e-6) {
      const delta = Math.round((p.stock - prevStock) * 1e6) / 1e6;
      this.db.transactions.unshift({
        id: uid('tx'),
        productId: p.id,
        type: delta > 0 ? 'in' : 'out',
        qty: Math.abs(delta),
        note: 'Manual stock adjustment (SKU edit)',
        ts: Date.now(),
      });
      if (this.db.transactions.length > 2000) this.db.transactions.length = 2000;
    }

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
    const skuNorm = snap.product.sku.trim().toUpperCase();
    if (
      this.getProduct(snap.product.id) ||
      this.db.products.some((p) => p.sku.trim().toUpperCase() === skuNorm)
    ) {
      return null;
    }
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
    if (type === 'out') {
      if (!(p.stock > 0)) return null;
      if (q > p.stock) q = p.stock;
    }
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
    return JSON.stringify(
      {
        ...this.db,
        exportedAt: new Date().toISOString(),
        app: 'FactoryMind',
        version: CURRENT_SCHEMA_VERSION,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      },
      null,
      2
    );
  }

  validateJSONImport(text: string): {
    report: JsonValidationReport;
    migratedData: Partial<WorkspaceDB> | null;
  } {
    const errors: ValidationIssue[] = [];
    const warnings: string[] = [];
    if (typeof text !== 'string' || !text.trim()) {
      return {
        report: {
          valid: false,
          migratedFromVersion: 0,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          productCount: 0,
          transactionCount: 0,
          errors: [{ path: 'file', message: 'JSON file is empty.' }],
          warnings,
        },
        migratedData: null,
      };
    }
    if (text.length > 5_000_000) {
      return {
        report: {
          valid: false,
          migratedFromVersion: 0,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          productCount: 0,
          transactionCount: 0,
          errors: [{ path: 'file', message: 'JSON file exceeds 5 MB limit.' }],
          warnings,
        },
        migratedData: null,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text, (key, val) => {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
        return val;
      });
    } catch (err) {
      return {
        report: {
          valid: false,
          migratedFromVersion: 0,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          productCount: 0,
          transactionCount: 0,
          errors: [{ path: 'json', message: `Malformed JSON syntax: ${err instanceof Error ? err.message : 'parse error'}` }],
          warnings,
        },
        migratedData: null,
      };
    }

    let migrated: { migratedFrom: number; data: Partial<WorkspaceDB>; notes: string[] };
    try {
      migrated = migrateWorkspacePayload(parsed);
      warnings.push(...migrated.notes);
    } catch (err) {
      return {
        report: {
          valid: false,
          migratedFromVersion: 0,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          productCount: 0,
          transactionCount: 0,
          errors: [{ path: 'version', message: err instanceof Error ? err.message : 'Invalid backup payload.' }],
          warnings,
        },
        migratedData: null,
      };
    }

    const obj = migrated.data;
    if (!Array.isArray(obj.products)) {
      return {
        report: {
          valid: false,
          migratedFromVersion: migrated.migratedFrom,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          productCount: 0,
          transactionCount: 0,
          errors: [{ path: 'products', message: 'Invalid file: missing products[] array.' }],
          warnings,
        },
        migratedData: null,
      };
    }

    const seenSkus = new Map<string, number>();
    const seenIds = new Map<string, number>();
    const validProductIds = new Set<string>();

    const checkFiniteRange = (
      path: string,
      val: unknown,
      min: number,
      max: number,
      label: string
    ) => {
      if (val === undefined) return;
      if (typeof val !== 'number' || !Number.isFinite(val) || val < min || val > max) {
        const rangeDesc = max === Infinity ? `>= ${min}` : `between ${min} and ${max}`;
        errors.push({ path, message: `${label} (${String(val)}) must be a finite number ${rangeDesc}.` });
      }
    };

    obj.products.forEach((rawProd, idx) => {
      const pPrefix = `products[${idx}]`;
      if (!rawProd || typeof rawProd !== 'object' || Array.isArray(rawProd)) {
        errors.push({ path: pPrefix, message: `Product #${idx + 1} must be an object.` });
        return;
      }
      const p = rawProd as Partial<Product>;
      const nameStr = typeof p.name === 'string' ? p.name.trim() : '';
      if (!nameStr) {
        errors.push({ path: `${pPrefix}.name`, message: `Product #${idx + 1} is missing a product name.` });
      }

      const skuStr = typeof p.sku === 'string' ? p.sku.trim().toUpperCase() : '';
      if (!skuStr) {
        errors.push({ path: `${pPrefix}.sku`, message: `Product #${idx + 1} ("${nameStr || 'unnamed'}") is missing a SKU.` });
      } else {
        if (skuStr.length > 40) {
          errors.push({ path: `${pPrefix}.sku`, message: `SKU "${skuStr}" exceeds 40 characters.` });
        }
        const prevIdx = seenSkus.get(skuStr);
        if (prevIdx !== undefined) {
          errors.push({
            path: `${pPrefix}.sku`,
            message: `Duplicate SKU "${skuStr}" found at product #${idx + 1} (first defined at #${prevIdx + 1}).`,
          });
        } else {
          seenSkus.set(skuStr, idx);
        }
      }

      const idStr = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : '';
      if (idStr) {
        const prevIdIdx = seenIds.get(idStr);
        if (prevIdIdx !== undefined) {
          errors.push({
            path: `${pPrefix}.id`,
            message: `Duplicate internal product ID "${idStr}" at product #${idx + 1}.`,
          });
        } else {
          seenIds.set(idStr, idx);
          validProductIds.add(idStr);
        }
      }

      checkFiniteRange(`${pPrefix}.unitCost`, p.unitCost, 0, Infinity, 'Unit cost');
      checkFiniteRange(`${pPrefix}.stock`, p.stock, 0, Infinity, 'Stock');
      checkFiniteRange(`${pPrefix}.annualDemand`, p.annualDemand, 0, Infinity, 'Annual demand');
      checkFiniteRange(`${pPrefix}.orderCost`, p.orderCost, 0, Infinity, 'Order cost');
      checkFiniteRange(`${pPrefix}.holdingRate`, p.holdingRate, 0.1, 100, 'Holding rate (%)');
      checkFiniteRange(`${pPrefix}.leadTime`, p.leadTime, 0, 3650, 'Lead time (days)');
      checkFiniteRange(`${pPrefix}.serviceLevel`, p.serviceLevel, 50, 99.9, 'Service level (%)');

      if (p.demandHistory !== undefined) {
        if (!Array.isArray(p.demandHistory)) {
          errors.push({ path: `${pPrefix}.demandHistory`, message: `SKU "${skuStr || idx + 1}": demandHistory must be an array.` });
        } else {
          p.demandHistory.forEach((v, hIdx) => {
            if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
              errors.push({
                path: `${pPrefix}.demandHistory[${hIdx}]`,
                message: `SKU "${skuStr || idx + 1}": demandHistory[${hIdx}] (${String(v)}) must be a non-negative finite number.`,
              });
            }
          });
        }
      }

      if (p.bom !== undefined) {
        if (!Array.isArray(p.bom)) {
          errors.push({ path: `${pPrefix}.bom`, message: `SKU "${skuStr || idx + 1}": bom must be an array.` });
        } else {
          p.bom.forEach((line, bIdx) => {
            if (!line || typeof line !== 'object') {
              errors.push({ path: `${pPrefix}.bom[${bIdx}]`, message: `Invalid BOM line in "${skuStr || idx + 1}".` });
              return;
            }
            if (!line.componentId || typeof line.componentId !== 'string') {
              errors.push({ path: `${pPrefix}.bom[${bIdx}].componentId`, message: `Missing BOM componentId in "${skuStr || idx + 1}".` });
            } else if (idStr && line.componentId === idStr) {
              errors.push({ path: `${pPrefix}.bom[${bIdx}]`, message: `SKU "${skuStr}" references itself in its own BOM.` });
            }
            if (typeof line.qtyPer !== 'number' || !Number.isFinite(line.qtyPer) || line.qtyPer <= 0) {
              errors.push({
                path: `${pPrefix}.bom[${bIdx}].qtyPer`,
                message: `BOM qtyPer in "${skuStr || idx + 1}" must be a positive number.`,
              });
            }
          });
        }
      }
    });

    if (errors.length === 0 && seenIds.size === obj.products.length) {
      obj.products.forEach((p, idx) => {
        (p.bom || []).forEach((line, bIdx) => {
          if (line.componentId && !validProductIds.has(line.componentId)) {
            errors.push({
              path: `products[${idx}].bom[${bIdx}]`,
              message: `BOM component "${line.componentId}" in "${p.sku}" does not match any product in the backup.`,
            });
          }
        });
      });
    }

    if (obj.transactions !== undefined) {
      if (!Array.isArray(obj.transactions)) {
        errors.push({ path: 'transactions', message: 'transactions must be an array.' });
      } else {
        obj.transactions.forEach((rawTx, idx) => {
          const tPrefix = `transactions[${idx}]`;
          if (!rawTx || typeof rawTx !== 'object' || Array.isArray(rawTx)) {
            errors.push({ path: tPrefix, message: `Transaction #${idx + 1} must be an object.` });
            return;
          }
          const t = rawTx as Partial<Transaction>;
          if (t.type !== 'in' && t.type !== 'out') {
            errors.push({ path: `${tPrefix}.type`, message: `Transaction #${idx + 1} has invalid type "${String(t.type)}" (expected "in" or "out").` });
          }
          if (typeof t.qty !== 'number' || !Number.isFinite(t.qty) || t.qty <= 0) {
            errors.push({ path: `${tPrefix}.qty`, message: `Transaction #${idx + 1} qty (${String(t.qty)}) must be a finite number > 0.` });
          }
          if (!t.productId || typeof t.productId !== 'string') {
            errors.push({ path: `${tPrefix}.productId`, message: `Transaction #${idx + 1} is missing productId.` });
          } else if (seenIds.size === obj.products!.length && !validProductIds.has(t.productId)) {
            errors.push({
              path: `${tPrefix}.productId`,
              message: `Transaction #${idx + 1} references unknown productId "${t.productId}".`,
            });
          }
          if (t.ts !== undefined && (typeof t.ts !== 'number' || !Number.isFinite(t.ts) || t.ts < 0)) {
            errors.push({ path: `${tPrefix}.ts`, message: `Transaction #${idx + 1} has invalid timestamp.` });
          }
        });
      }
    }

    return {
      report: {
        valid: errors.length === 0,
        migratedFromVersion: migrated.migratedFrom,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        productCount: obj.products.length,
        transactionCount: Array.isArray(obj.transactions) ? obj.transactions.length : 0,
        errors,
        warnings,
      },
      migratedData: errors.length === 0 ? obj : null,
    };
  }

  importJSON(text: string): number {
    const { report, migratedData } = this.validateJSONImport(text);
    if (!report.valid || !migratedData) {
      const firstErr = report.errors[0]?.message || 'Invalid JSON backup.';
      const extraCount = report.errors.length - 1;
      throw new Error(extraCount > 0 ? `${firstErr} (+${extraCount} more validation error${extraCount > 1 ? 's' : ''})` : firstErr);
    }
    this.captureRollbackSnapshot();
    const nextDb = normalizeDB(migratedData);
    this.db = nextDb;
    this.corruptedDetected = false;
    this.corruptedRaw = null;
    this.storage.del(CORRUPT_BACKUP_KEY);
    this.recordAction(
      'import',
      'Imported JSON backup',
      `Loaded ${this.db.products.length} SKUs and ${this.db.transactions.length} transactions (schema v${CURRENT_SCHEMA_VERSION})`,
      'settings',
      false
    );
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
        p.serviceLevel,
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
        'Service Level',
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

  private prepareProductsCSV(text: string): {
    planned: Array<{
      line: number;
      mode: 'create' | 'update';
      targetId?: string;
      data: Partial<Product>;
      wantStock?: number;
      sku: string;
      name: string;
    }>;
    skipped: Array<{ line: number; reason: string }>;
  } {
    const rows = parseCSVStrict(text);
    if (!rows.length) throw new Error('The file is empty — nothing to import.');
    const head = rows.shift()!.map((h) => String(h || '').trim().toLowerCase());
    if (rows.length === 0) {
      throw new Error('The CSV file contains headers only — add at least one product row.');
    }

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
      throw new Error('Invalid CSV header: no SKU or Name column found.');
    }

    const NUMERIC = ['unitCost', 'stock', 'annualDemand', 'orderCost', 'holdingRate', 'leadTime', 'serviceLevel'] as const;
    const NUMERIC_LABELS: Record<(typeof NUMERIC)[number], string> = {
      unitCost: 'Unit Cost',
      stock: 'Stock',
      annualDemand: 'Annual Demand',
      orderCost: 'Order Cost',
      holdingRate: 'Holding Rate %',
      leadTime: 'Lead Time (days)',
      serviceLevel: 'Service Level %',
    };
    const parseCsvNumber = (raw: string): number | null => {
      if (!/^[+-]?(?:\d+(?:,\d{3})*|\d+)(?:\.\d+)?$/.test(raw)) return null;
      const n = Number(raw.replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    };

    const get = (row: string[], f: string) => (col[f] >= 0 ? String(row[col[f]] == null ? '' : row[col[f]]).trim() : '');
    const skipped: Array<{ line: number; reason: string }> = [];
    const planned: Array<{
      line: number;
      mode: 'create' | 'update';
      targetId?: string;
      data: Partial<Product>;
      wantStock?: number;
      sku: string;
      name: string;
    }> = [];
    const seenCsvSkus = new Map<string, number>();

    rows.forEach((row, i) => {
      const line = i + 2;
      if (row.length > head.length) {
        skipped.push({
          line,
          reason: `row has ${row.length} columns but header has ${head.length} (check unquoted commas)`,
        });
        return;
      }

      const sku = get(row, 'sku').toUpperCase();
      const name = get(row, 'name');
      if (!sku && !name) {
        skipped.push({ line, reason: 'missing both SKU and Name' });
        return;
      }
      if (sku) {
        if (sku.length > 32 || /[\r\n\t]/.test(sku)) {
          skipped.push({ line, reason: `SKU "${sku}" is invalid (max 32 characters, no control chars)` });
          return;
        }
        const firstLine = seenCsvSkus.get(sku);
        if (firstLine !== undefined) {
          skipped.push({ line, reason: `duplicate SKU "${sku}" (already listed on line ${firstLine})` });
          return;
        }
        seenCsvSkus.set(sku, line);
      }

      const parsedNums: Partial<Record<(typeof NUMERIC)[number], number>> = {};
      for (const f of NUMERIC) {
        const raw = get(row, f);
        if (raw === '') continue;
        const parsed = parseCsvNumber(raw);
        if (parsed === null || parsed < 0) {
          skipped.push({ line, reason: `${NUMERIC_LABELS[f]} ("${raw}") must be a valid non-negative number` });
          return;
        }
        if (f === 'holdingRate' && (parsed < 0.1 || parsed > 100)) {
          skipped.push({ line, reason: `Holding Rate % (${parsed}) must be between 0.1 and 100` });
          return;
        }
        if (f === 'leadTime' && parsed > 3650) {
          skipped.push({ line, reason: `Lead Time (${parsed} days) must be 3,650 days or less` });
          return;
        }
        if (f === 'serviceLevel' && (parsed < 50 || parsed > 99.9)) {
          skipped.push({ line, reason: `Service Level % (${parsed}) must be between 50 and 99.9` });
          return;
        }
        parsedNums[f] = parsed;
      }

      const data: Partial<Product> = {};
      if (name) data.name = name;
      if (sku) data.sku = sku;
      const cat = get(row, 'category');
      if (cat) data.category = cat;
      const unit = get(row, 'unit');
      if (unit) data.unit = unit;
      for (const f of NUMERIC) {
        if (parsedNums[f] !== undefined) data[f] = parsedNums[f];
      }

      // Match by SKU strictly whenever SKU is present; only fall back to Name if CSV SKU cell is empty.
      const existing = sku
        ? this.db.products.find((p) => p.sku.trim().toUpperCase() === sku)
        : this.db.products.find((p) => p.name.toLowerCase() === name.toLowerCase());

      const wantStock = data.stock;
      delete data.stock;

      if (existing) {
        planned.push({
          line,
          mode: 'update',
          targetId: existing.id,
          data,
          wantStock,
          sku: sku || existing.sku,
          name: name || existing.name,
        });
      } else {
        planned.push({
          line,
          mode: 'create',
          data,
          wantStock,
          sku: sku || `SKU-${this.db.products.length + planned.length + 1}`,
          name: name || sku || 'Imported item',
        });
      }
    });

    return { planned, skipped };
  }

  validateProductsCSV(text: string): {
    valid: boolean;
    wouldCreate: number;
    wouldUpdate: number;
    skipped: Array<{ line: number; reason: string }>;
    fatalError?: string;
  } {
    try {
      const { planned, skipped } = this.prepareProductsCSV(text);
      const wouldCreate = planned.filter((r) => r.mode === 'create').length;
      const wouldUpdate = planned.filter((r) => r.mode === 'update').length;
      return {
        valid: skipped.length === 0 && (wouldCreate + wouldUpdate > 0),
        wouldCreate,
        wouldUpdate,
        skipped,
      };
    } catch (err) {
      return {
        valid: false,
        wouldCreate: 0,
        wouldUpdate: 0,
        skipped: [],
        fatalError: err instanceof Error ? err.message : 'Invalid CSV file.',
      };
    }
  }

  importProductsCSV(text: string): CsvImportResult {
    const { planned, skipped } = this.prepareProductsCSV(text);
    const out: CsvImportResult = { created: 0, updated: 0, skipped };
    if (planned.length === 0) {
      return out;
    }

    for (const row of planned) {
      if (row.mode === 'update' && row.targetId) {
        const existing = this.getProduct(row.targetId);
        if (!existing) continue;
        this.updateProduct(existing.id, row.data);
        if (row.wantStock !== undefined && Math.abs(row.wantStock - existing.stock) > 1e-6) {
          this.addTransaction(
            existing.id,
            row.wantStock > existing.stock ? 'in' : 'out',
            Math.abs(row.wantStock - existing.stock),
            'CSV import'
          );
        }
        out.updated++;
      } else {
        const created = this.addProduct({
          ...row.data,
          sku: row.sku,
          name: row.name,
          stock: 0,
          demandSource: 'imported',
        });
        if (row.wantStock !== undefined && row.wantStock > 0) {
          this.addTransaction(created.id, 'in', row.wantStock, 'CSV import');
        }
        out.created++;
      }
    }

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
