/**
 * Time-phased Material Requirements Planning (MRP) engine.
 * Pure TypeScript, zero DOM dependencies.
 */

import { csvRow } from './formatters.ts';

export type LotRule = 'l4l' | 'foq' | 'eoq' | 'poq';

export interface BomLineInput {
  componentId: string;
  qtyPer: number;
}

export interface ScheduledReceiptInput {
  qty: number;
  daysFromStart: number;
}

export interface MrpItemInput {
  id?: string;
  name?: string;
  sku?: string;
  unit?: string;
  bom?: BomLineInput[];
  onHand?: number;
  scheduledReceipts?: ScheduledReceiptInput[];
  safetyStock?: number;
  leadTimeDays?: number;
  lotRule?: LotRule | string;
  foqQty?: number;
  eoqQty?: number;
  periodDemand?: number;
  periodCount?: number;
  scrapPct?: number;
  yieldPct?: number;
}

export interface TimeBucket {
  index: number;
  start: Date;
  end: Date;
  label: string;
  daysOffset: number;
}

export interface MrpRow {
  bucketIndex: number;
  grossReq: number;
  scheduledReceipts: number;
  projectedOnHandBefore: number;
  projectedOnHandAfter: number;
  netRequirement: number;
  plannedOrderReceipt: number;
  plannedOrderRelease: number | null;
  lotRuleApplied: string;
}

export interface MrpComponentRecord {
  id: string;
  name: string;
  sku: string;
  unit: string;
  level: number;
  lotRule: string;
  onHand: number;
  safetyStock: number;
  leadTimeDays: number;
  totalGross: number;
  totalNetRequirement: number;
  totalPlannedReceipts: number;
  totalPlannedReleases: number;
  finalProjectedOnHand: number;
  shortage: boolean;
  pastDue: boolean;
  mrpRows: MrpRow[];
}

export interface PlannedOrderRelease {
  componentId: string;
  componentName: string;
  bucketIndex: number;
  releaseDate: Date;
  quantity: number;
  lotRule: string;
  leadTimeDays: number;
  needDate: Date;
  bucketDaysOffset: number;
}

export interface ShortageAlert {
  componentId: string;
  componentName: string;
  shortfall: number;
  severity: 'high' | 'medium';
}

export interface LateOrderWarning {
  componentId: string;
  componentName: string;
  needDate: Date;
  releaseBi: number;
  daysOverdue: number;
  message: string;
}

export interface CriticalComponent {
  componentId: string;
  componentName: string;
  gross: number;
  onHand: number;
  deficit: number;
}

export interface BomTreeNode {
  componentId: string;
  name: string;
  sku: string;
  qtyPer: number;
  level: number;
  children: BomTreeNode[];
  isRoot: boolean;
  explosionFactor: number;
  totalGross: number;
  onHand: number;
  safetyStock: number;
  leadTimeDays: number;
}

export interface BomVisualRow {
  componentId: string;
  name: string;
  sku: string;
  level: number;
  qtyPer: number;
  path: string;
  explosionFactor: number;
  totalGross: number;
  isRoot: boolean;
  childrenCount: number;
}

export interface MrpPlanResult {
  valid: boolean;
  reason: string;
  rootId: string;
  planQuantity: number;
  needDate: Date;
  startDate: Date;
  horizonDays: number;
  bucketSizeDays: number;
  bucketCount: number;
  buckets: TimeBucket[];
  topology: {
    ordered: string[];
    levels: Record<string, number>;
    hasCycle: boolean;
    missingIds: string[];
  };
  components: Record<string, MrpComponentRecord>;
  plannedOrderReleases: PlannedOrderRelease[];
  shortageAlerts: ShortageAlert[];
  lateOrderWarnings: LateOrderWarning[];
  criticalComponents: CriticalComponent[];
  bomTree: BomTreeNode | null;
  bomVisual: BomVisualRow[];
  summary: {
    componentCount: number;
    totalGrossRequirements: number;
    totalNetRequirements: number;
    totalPlannedReceipts: number;
    shortageAlerts: number;
    lateOrderWarnings: number;
    criticalComponents: number;
    hasCycle: boolean;
    missingComponents: number;
    planFeasible: boolean;
  };
  explosionFactor: Record<string, number>;
  grossProfiles: Record<
    string,
    {
      totalGross: number;
      buckets: number[];
      grossReqFn: (b: number) => number;
      needBucket: number;
    }
  >;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function sum(a: ReadonlyArray<number>): number {
  return (Array.isArray(a) ? a : []).reduce((s, v) => s + (num(v) || 0), 0);
}

function roundTo(v: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

export function lotSize(
  netReq: number,
  {
    lotRule = 'l4l',
    foqQty = 0,
    eoqQty = 0,
    periodDemand = 0,
    periodCount = 1,
  }: {
    lotRule?: string;
    foqQty?: number;
    eoqQty?: number;
    periodDemand?: number;
    periodCount?: number;
  } = {}
): { orderQty: number; lotRuleApplied: string; explanation: string } {
  const req = Math.max(0, num(netReq) || 0);
  if (req <= 0) {
    return { orderQty: 0, lotRuleApplied: lotRule, explanation: 'no net requirement' };
  }

  let orderQty: number;
  switch (lotRule) {
    case 'l4l':
      orderQty = req;
      break;
    case 'foq': {
      const foq = num(foqQty) || 0;
      orderQty = foq <= 0 ? req : Math.ceil(req / foq) * foq;
      break;
    }
    case 'eoq': {
      const eoq = num(eoqQty) || 0;
      orderQty = eoq <= 0 ? req : Math.ceil(req / eoq) * eoq;
      break;
    }
    case 'poq': {
      const pd = Math.max(0, num(periodDemand) || 0);
      const pc = Math.max(1, Math.round(num(periodCount) || 1));
      if (pd <= 0) {
        orderQty = req;
      } else {
        orderQty = Math.max(req, pd * pc);
        const eoq = num(eoqQty) || 0;
        if (eoq > 0) {
          orderQty = Math.ceil(orderQty / eoq) * eoq;
        }
      }
      break;
    }
    default:
      orderQty = req;
  }

  orderQty = roundTo(Math.max(req, orderQty), 4);
  return { orderQty, lotRuleApplied: lotRule, explanation: '' };
}

export function buildTimeBuckets(horizon: number, bucketSize = 1, startDate?: Date | number | null): TimeBucket[] {
  const h = Math.max(1, Math.round(num(horizon) || 1));
  const bs = Math.max(1, num(bucketSize) || 1);
  const base = startDate instanceof Date ? startDate.getTime() : num(startDate) || Date.now();
  const buckets: TimeBucket[] = [];
  for (let i = 0; i < h; i++) {
    const start = base + i * bs * 86400000;
    buckets.push({
      index: i,
      start: new Date(start),
      end: new Date(start + bs * 86400000 - 1),
      label: `P${i + 1}`,
      daysOffset: i * bs,
    });
  }
  return buckets;
}

export function leadTimeToBuckets(leadTimeDays: number, bucketSize: number): number {
  const lt = num(leadTimeDays) || 0;
  const bs = num(bucketSize) || 1;
  if (bs <= 0 || lt <= 0) return 0;
  return Math.max(1, Math.ceil(lt / bs));
}

export function bomTopology(
  rootId: string,
  items: Record<string, { bom?: BomLineInput[] }>
): { ordered: string[]; levels: Record<string, number>; hasCycle: boolean; missingIds: string[] } {
  const ids = Object.keys(items || {});
  const idSet = new Set(ids);
  const levels: Record<string, number> = { [rootId]: 0 };
  const ordered: string[] = [rootId];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const missingIds: string[] = [];
  let hasCycle = false;

  const cap = ids.length + 1;
  for (let iter = 0; iter < cap; iter++) {
    let changed = false;
    for (const id of ids) {
      const it = items[id];
      if (!it || !Array.isArray(it.bom)) continue;
      for (const b of it.bom) {
        const cid = String(b && b.componentId);
        if (cid === id) continue;
        if (!idSet.has(cid)) {
          if (!missingIds.includes(cid)) missingIds.push(cid);
          continue;
        }
        const parentLevel = levels[id] != null ? levels[id] : 0;
        const childLevel = parentLevel + 1;
        if (levels[cid] == null || childLevel > levels[cid]) {
          levels[cid] = childLevel;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  function dfs(id: string) {
    if (inStack.has(id)) {
      hasCycle = true;
      return;
    }
    if (visited.has(id)) return;
    inStack.add(id);
    const it = items[id];
    if (it && Array.isArray(it.bom)) {
      for (const b of it.bom) {
        const cid = String(b && b.componentId);
        if (cid === id) continue;
        if (idSet.has(cid)) dfs(cid);
      }
    }
    inStack.delete(id);
    visited.add(id);
    if (!ordered.includes(id)) ordered.push(id);
  }

  const sortedIds = ids.slice().sort((a, b) => {
    const la = levels[a] != null ? levels[a] : 0;
    const lb = levels[b] != null ? levels[b] : 0;
    return la - lb || a.localeCompare(b);
  });

  for (const id of sortedIds) {
    if (!visited.has(id)) dfs(id);
  }

  ordered.sort((a, b) => {
    const la = levels[a] != null ? levels[a] : 0;
    const lb = levels[b] != null ? levels[b] : 0;
    return la - lb || ids.indexOf(a) - ids.indexOf(b);
  });

  return { ordered, levels, hasCycle, missingIds };
}

export function buildTimePhasedMRP({
  grossReqFn,
  scheduledReceipts = [],
  initialOnHand = 0,
  safetyStock = 0,
  bucketCount,
  lotRule = 'l4l',
  foqQty = 0,
  eoqQty = 0,
  periodDemand = 0,
  periodCount = 1,
  leadTimeBuckets = 0,
}: {
  componentId?: string;
  grossReqFn: (bucketIndex: number) => number;
  scheduledReceipts?: Array<{ bucketIndex: number; qty: number }>;
  initialOnHand?: number;
  safetyStock?: number;
  bucketCount: number;
  lotRule?: string;
  foqQty?: number;
  eoqQty?: number;
  periodDemand?: number;
  periodCount?: number;
  leadTimeBuckets?: number;
}): MrpRow[] {
  const count = Math.max(1, Math.round(num(bucketCount) || 1));
  const safety = num(safetyStock) || 0;
  const onHand0 = num(initialOnHand) || 0;
  const srMap: Record<number, number> = {};
  for (const sr of Array.isArray(scheduledReceipts) ? scheduledReceipts : []) {
    const bi = Math.max(0, Math.round(num(sr.bucketIndex) || 0));
    srMap[bi] = (srMap[bi] || 0) + num(sr.qty || 0);
  }

  const projected = new Array<number>(count).fill(0);
  const netReq = new Array<number>(count).fill(0);
  const plannedReceipt = new Array<number>(count).fill(0);
  const plannedRelease = new Array<number | null>(count).fill(null);

  let prevProjected = onHand0;

  for (let b = 0; b < count; b++) {
    const gross = num(grossReqFn(b)) || 0;
    const scheduled = srMap[b] || 0;
    const projectedOnHand = prevProjected + scheduled - gross;
    projected[b] = roundTo(projectedOnHand, 4);

    const deficit = Math.max(0, safety - projectedOnHand);
    netReq[b] = roundTo(deficit, 4);

    const ls = lotSize(netReq[b], { lotRule, foqQty, eoqQty, periodDemand, periodCount });
    plannedReceipt[b] = roundTo(ls.orderQty, 4);

    prevProjected = projectedOnHand + plannedReceipt[b];
  }

  for (let b = 0; b < count; b++) {
    if (plannedReceipt[b] > 0) {
      const releaseBucket = b - leadTimeBuckets;
      if (releaseBucket >= 0) {
        plannedRelease[releaseBucket] = (plannedRelease[releaseBucket] || 0) + plannedReceipt[b];
      } else {
        plannedRelease[0] = (plannedRelease[0] || 0) + plannedReceipt[b];
      }
    }
  }

  const rows: MrpRow[] = [];
  for (let b = 0; b < count; b++) {
    const scheduled = srMap[b] || 0;
    const gross = num(grossReqFn(b)) || 0;
    const postActionProjected = projected[b] + plannedReceipt[b];

    rows.push({
      bucketIndex: b,
      grossReq: roundTo(gross, 4),
      scheduledReceipts: scheduled,
      projectedOnHandBefore: roundTo(projected[b], 4),
      projectedOnHandAfter: roundTo(postActionProjected, 4),
      netRequirement: roundTo(netReq[b], 4),
      plannedOrderReceipt: roundTo(plannedReceipt[b], 4),
      plannedOrderRelease: plannedRelease[b] != null ? roundTo(plannedRelease[b] as number, 4) : null,
      lotRuleApplied: lotRule,
    });
  }

  return rows;
}

export function mrpPlan({
  rootId,
  planQuantity = 1,
  needInDays = 0,
  items = {},
  startDate = null,
  horizonDays = 90,
  bucketSizeDays = 1,
  lotRule = 'l4l',
}: {
  rootId: string;
  planQuantity?: number;
  needInDays?: number;
  items?: Record<string, MrpItemInput>;
  startDate?: Date | number | null;
  horizonDays?: number;
  bucketSizeDays?: number;
  lotRule?: LotRule | string;
}): MrpPlanResult {
  const planQty = Math.max(0, num(planQuantity) || 0);
  const needDays = Math.max(0, num(needInDays) || 0);
  const now = startDate instanceof Date ? startDate.getTime() : num(startDate) || Date.now();
  const start = new Date(now);
  const horizon = Math.max(1, Math.round(num(horizonDays) || 90));
  const bucketSize = Math.max(1, num(bucketSizeDays) || 1);
  const bucketCount = Math.max(1, Math.ceil(horizon / bucketSize));
  const buckets = buildTimeBuckets(bucketCount, bucketSize, start);

  interface NormalizedItem {
    id: string;
    name: string;
    sku: string;
    unit: string;
    bom: Array<{ componentId: string; qtyPer: number }>;
    onHand: number;
    scheduledReceipts: Array<{ qty: number; daysFromStart: number }>;
    safetyStock: number;
    leadTimeDays: number;
    lotRule: string;
    foqQty: number;
    eoqQty: number;
    periodDemand: number;
    periodCount: number;
    scrapPct: number;
    yieldPct: number;
  }

  const itemMap: Record<string, NormalizedItem> = {};
  for (const id of Object.keys(items || {})) {
    const it = items[id];
    if (!it || typeof it !== 'object') continue;
    itemMap[id] = {
      id,
      name: String(it.name || it.id || id),
      sku: String(it.sku || ''),
      unit: String(it.unit || ''),
      bom: Array.isArray(it.bom)
        ? it.bom
            .map((b) => ({
              componentId: String(b && b.componentId),
              qtyPer: Math.max(0, num(b && b.qtyPer) || 0),
            }))
            .filter((b) => b.qtyPer > 0)
        : [],
      onHand: Math.max(0, num(it.onHand) || 0),
      scheduledReceipts: Array.isArray(it.scheduledReceipts)
        ? it.scheduledReceipts.map((sr) => ({
            qty: Math.max(0, num(sr.qty) || 0),
            daysFromStart: Math.max(0, num(sr.daysFromStart) || 0),
          }))
        : [],
      safetyStock: Math.max(0, num(it.safetyStock) || 0),
      leadTimeDays: Math.max(0, num(it.leadTimeDays) || 0),
      lotRule: String(it.lotRule || lotRule || 'l4l'),
      foqQty: Math.max(0, num(it.foqQty) || 0),
      eoqQty: Math.max(0, num(it.eoqQty) || 0),
      periodDemand: Math.max(0, num(it.periodDemand) || 0),
      periodCount: Math.max(1, Math.round(num(it.periodCount) || 1)),
      scrapPct: clamp(num(it.scrapPct) || 0, 0, 100),
      yieldPct: clamp(it.yieldPct != null ? num(it.yieldPct) : 100, 0, 100),
    };
  }

  const { ordered, levels, hasCycle, missingIds } = bomTopology(rootId, itemMap);
  const missingComponents = missingIds.filter((mid) => !itemMap[mid]);

  const needBi = Math.min(bucketCount - 1, Math.max(0, Math.floor(needDays / bucketSize)));
  const explosionFactor: Record<string, number> = { [rootId]: 1 };
  const bucketDemand: Record<string, number[]> = {};
  for (const id of Object.keys(itemMap)) {
    bucketDemand[id] = new Array<number>(bucketCount).fill(0);
  }

  if (hasCycle) {
    // Bounded path-safe traversal when a circular BOM is present so quantities remain finite
    const accumulateCyclicSafe = (parentId: string, parentFactor: number, ancestors: Set<string>) => {
      const item = itemMap[parentId];
      if (!item) return;
      for (const b of item.bom) {
        const childId = b.componentId;
        if (ancestors.has(childId)) continue;
        const childItem = itemMap[childId];
        if (!childItem) continue;
        const childScrap = 1 - (num(childItem.scrapPct) || 0) / 100;
        const childYield = (num(childItem.yieldPct) || 100) / 100;
        const childEffYield = Math.max(0.0001, childScrap * childYield);
        const contribution = (parentFactor * num(b.qtyPer)) / childEffYield;
        explosionFactor[childId] = (explosionFactor[childId] || 0) + contribution;
        ancestors.add(childId);
        accumulateCyclicSafe(childId, contribution, ancestors);
        ancestors.delete(childId);
      }
    };
    accumulateCyclicSafe(rootId, 1, new Set([rootId]));
    for (const id of Object.keys(itemMap)) {
      const grossQty = planQty * (explosionFactor[id] || 0);
      if (grossQty > 0) bucketDemand[id][needBi] = grossQty;
    }
  } else if (itemMap[rootId]) {
    // Compute nominal static BOM explosionFactor for structural BOM tree display
    for (const pid of ordered) {
      const pf = explosionFactor[pid] || 0;
      if (pf <= 0) continue;
      const pItem = itemMap[pid];
      if (!pItem) continue;
      for (const b of pItem.bom) {
        const childItem = itemMap[b.componentId];
        if (!childItem) continue;
        const childScrap = 1 - (num(childItem.scrapPct) || 0) / 100;
        const childYield = (num(childItem.yieldPct) || 100) / 100;
        const childEffYield = Math.max(0.0001, childScrap * childYield);
        explosionFactor[b.componentId] = (explosionFactor[b.componentId] || 0) + (pf * num(b.qtyPer)) / childEffYield;
      }
    }
    if (planQty > 0) bucketDemand[rootId][needBi] = planQty;
    // Explode root batch down to Level 1 immediately (root planQuantity is planned lot quantity)
    for (const b of itemMap[rootId].bom) {
      const childId = b.componentId;
      const childItem = itemMap[childId];
      if (!childItem || planQty <= 0) continue;
      const childScrap = 1 - (num(childItem.scrapPct) || 0) / 100;
      const childYield = (num(childItem.yieldPct) || 100) / 100;
      const childEffYield = Math.max(0.0001, childScrap * childYield);
      bucketDemand[childId][needBi] += (planQty * num(b.qtyPer)) / childEffYield;
    }
  }

  function scheduledReceiptsFor(itemId: string) {
    const item = itemMap[itemId];
    if (!item) return [];
    return item.scheduledReceipts
      .map((sr) => ({
        bucketIndex: Math.min(bucketCount - 1, Math.max(0, Math.floor(num(sr.daysFromStart) / bucketSize))),
        qty: num(sr.qty) || 0,
      }))
      .filter((sr) => sr.qty > 0 && sr.bucketIndex < bucketCount);
  }

  const grossProfiles: MrpPlanResult['grossProfiles'] = {};
  const componentRecords: Record<string, MrpComponentRecord> = {};
  const plannedReleases: PlannedOrderRelease[] = [];
  const shortageAlerts: ShortageAlert[] = [];
  const lateOrderWarnings: LateOrderWarning[] = [];
  const criticalComponents: CriticalComponent[] = [];

  for (const id of ordered) {
    const profileArr = bucketDemand[id] || new Array<number>(bucketCount).fill(0);
    const totalGrossRaw = sum(profileArr);
    const firstGrossBi = profileArr.findIndex((v) => v > 0);
    grossProfiles[id] = {
      totalGross: roundTo(totalGrossRaw, 4),
      buckets: profileArr.map((v) => roundTo(v, 4)),
      grossReqFn: (b) => num(profileArr[b]) || 0,
      needBucket: firstGrossBi >= 0 ? firstGrossBi : needBi,
    };

    if (id === rootId) continue;
    const item = itemMap[id];
    if (!item || totalGrossRaw <= 0) continue;

    const srList = scheduledReceiptsFor(id);
    const leadTimeBuckets =
      item.leadTimeDays > 0
        ? Math.min(bucketCount, Math.max(1, Math.ceil(item.leadTimeDays / bucketSize)))
        : 0;

    const mrpRows = buildTimePhasedMRP({
      componentId: id,
      grossReqFn: (b) => num(profileArr[b]) || 0,
      scheduledReceipts: srList,
      initialOnHand: item.onHand,
      safetyStock: item.safetyStock,
      bucketCount,
      lotRule: item.lotRule || lotRule,
      foqQty: item.foqQty || 0,
      eoqQty: item.eoqQty || 0,
      periodDemand: item.periodDemand || 0,
      periodCount: item.periodCount || 1,
      leadTimeBuckets,
    });

    // In acyclic BOMs, level-by-level Orlicky explosion passes this subassembly's planned order
    // receipts (offset by its own leadTimeBuckets) down to lower-level children.
    if (!hasCycle && item.bom.length > 0) {
      for (let b = 0; b < bucketCount; b++) {
        const plannedQty = mrpRows[b].plannedOrderReceipt;
        if (plannedQty <= 0) continue;
        const childNeedBi = Math.max(0, b - leadTimeBuckets);
        for (const bl of item.bom) {
          const childId = bl.componentId;
          const childItem = itemMap[childId];
          if (!childItem) continue;
          const childScrap = 1 - (num(childItem.scrapPct) || 0) / 100;
          const childYield = (num(childItem.yieldPct) || 100) / 100;
          const childEffYield = Math.max(0.0001, childScrap * childYield);
          bucketDemand[childId][childNeedBi] += (plannedQty * num(bl.qtyPer)) / childEffYield;
        }
      }
    }

    const lastRow = mrpRows[mrpRows.length - 1];
    const totalPlannedReceipt = sum(mrpRows.map((r) => r.plannedOrderReceipt));
    const totalNetReq = sum(mrpRows.map((r) => r.netRequirement));
    const finalProjected = lastRow ? lastRow.projectedOnHandAfter : item.onHand;

    componentRecords[id] = {
      id,
      name: item.name,
      sku: item.sku,
      unit: item.unit,
      level: levels[id] != null ? levels[id] : 0,
      lotRule: item.lotRule || lotRule,
      onHand: item.onHand,
      safetyStock: item.safetyStock,
      leadTimeDays: item.leadTimeDays,
      totalGross: roundTo(totalGrossRaw, 4),
      totalNetRequirement: roundTo(totalNetReq, 4),
      totalPlannedReceipts: roundTo(totalPlannedReceipt, 4),
      totalPlannedReleases: roundTo(
        sum(mrpRows.filter((r) => r.plannedOrderRelease != null).map((r) => r.plannedOrderRelease as number)),
        4
      ),
      finalProjectedOnHand: roundTo(finalProjected, 4),
      shortage: totalNetReq > 0,
      pastDue: false,
      mrpRows,
    };

    for (let b = 0; b < bucketCount; b++) {
      const release = mrpRows[b].plannedOrderRelease;
      if (release != null && release > 0) {
        plannedReleases.push({
          componentId: id,
          componentName: item.name,
          bucketIndex: b,
          releaseDate: new Date(start.getTime() + b * bucketSize * 86400000),
          quantity: roundTo(release, 4),
          lotRule: item.lotRule || lotRule,
          leadTimeDays: item.leadTimeDays,
          needDate: new Date(start.getTime() + (b + leadTimeBuckets) * bucketSize * 86400000),
          bucketDaysOffset: b * bucketSize,
        });
      }
    }

    if (totalNetReq > 0) {
      const firstNetBi = mrpRows.findIndex((r) => r.netRequirement > 0);
      const compNeedBi = firstNetBi >= 0 ? firstNetBi : needBi;
      const compNeedDays = firstNetBi >= 0 ? Math.min(needDays, firstNetBi * bucketSize) : needDays;
      const releaseBi = compNeedBi - leadTimeBuckets;
      const receiptShortfall = Math.max(0, totalNetReq - totalPlannedReceipt);
      const ssDeficit = Math.max(0, item.safetyStock - finalProjected);
      const effectiveShortfall =
        receiptShortfall > 0.001
          ? receiptShortfall
          : releaseBi < 0 || item.leadTimeDays > compNeedDays
            ? totalNetReq
            : ssDeficit;

      if (effectiveShortfall > 0.001) {
        shortageAlerts.push({
          componentId: id,
          componentName: item.name,
          shortfall: roundTo(effectiveShortfall, 4),
          severity:
            releaseBi < 0 || item.leadTimeDays > compNeedDays || effectiveShortfall > totalNetReq * 0.5
              ? 'high'
              : 'medium',
        });
      }
      if (releaseBi < 0) {
        componentRecords[id].pastDue = true;
        lateOrderWarnings.push({
          componentId: id,
          componentName: item.name,
          needDate: new Date(start.getTime() + compNeedDays * 86400000),
          releaseBi,
          daysOverdue: Math.abs(releaseBi * bucketSize),
          message: `"${item.name}" must be released ${Math.abs(releaseBi * bucketSize)} days before the planning start — order is past due.`,
        });
      }
      if (item.leadTimeDays > compNeedDays && totalNetReq > 0 && !componentRecords[id].pastDue) {
        componentRecords[id].pastDue = true;
        lateOrderWarnings.push({
          componentId: id,
          componentName: item.name,
          needDate: new Date(start.getTime() + compNeedDays * 86400000),
          releaseBi,
          daysOverdue: Math.ceil(item.leadTimeDays - compNeedDays),
          message: `"${item.name}" lead time (${item.leadTimeDays} days) exceeds the need date (${compNeedDays} days) — order is past due.`,
        });
      }
    }

    const compProfile = grossProfiles[id];
    if (compProfile.totalGross > 0 && item.onHand < compProfile.totalGross * 0.1) {
      criticalComponents.push({
        componentId: id,
        componentName: item.name,
        gross: compProfile.totalGross,
        onHand: item.onHand,
        deficit: roundTo(compProfile.totalGross - item.onHand, 4),
      });
    }
  }

  plannedReleases.sort((a, b) => a.releaseDate.getTime() - b.releaseDate.getTime());

  function buildBomTree(itemId: string, depth = 0, visited = new Set<string>(), qtyPerSelf = 1): BomTreeNode | null {
    if (visited.has(itemId)) return null;
    visited.add(itemId);
    const item = itemMap[itemId];
    if (!item) return null;
    const children: BomTreeNode[] = [];
    for (const b of item.bom) {
      const childId = b.componentId;
      const childItem = itemMap[childId];
      if (childItem && childId !== rootId) {
        const childTree = buildBomTree(childId, depth + 1, new Set(visited), num(b.qtyPer) || 0);
        if (childTree) {
          children.push(childTree);
        }
      }
    }
    return {
      componentId: itemId,
      name: item.name,
      sku: item.sku,
      qtyPer: itemId === rootId ? 1 : qtyPerSelf,
      level: depth,
      children,
      isRoot: itemId === rootId,
      explosionFactor: roundTo(explosionFactor[itemId] || 0, 4),
      totalGross: roundTo(grossProfiles[itemId] ? grossProfiles[itemId].totalGross : 0, 4),
      onHand: item.onHand,
      safetyStock: item.safetyStock,
      leadTimeDays: item.leadTimeDays,
    };
  }

  const bomTree = buildBomTree(rootId);

  function flattenBom(node: BomTreeNode | null, parentPath = ''): BomVisualRow[] {
    if (!node) return [];
    const path = parentPath ? `${parentPath} > ${node.name}` : node.name;
    const flat: BomVisualRow[] = [
      {
        componentId: node.componentId,
        name: node.name,
        sku: node.sku || '',
        level: node.level,
        qtyPer: node.qtyPer,
        path,
        explosionFactor: node.explosionFactor,
        totalGross: node.totalGross,
        isRoot: node.isRoot,
        childrenCount: node.children ? node.children.length : 0,
      },
    ];
    if (node.children) {
      for (const child of node.children) {
        flat.push(...flattenBom(child, path));
      }
    }
    return flat;
  }

  const bomVisual = flattenBom(bomTree);

  const totalGrossAll = sum(Object.values(componentRecords).map((c) => c.totalGross));
  const totalNetAll = sum(Object.values(componentRecords).map((c) => c.totalNetRequirement));
  const totalPlannedAll = sum(Object.values(componentRecords).map((c) => c.totalPlannedReceipts));
  const shortageCount = shortageAlerts.length;
  const lateCount = lateOrderWarnings.length;
  const criticalCount = criticalComponents.length;

  const summary = {
    componentCount: Object.keys(componentRecords).length,
    totalGrossRequirements: roundTo(totalGrossAll, 4),
    totalNetRequirements: roundTo(totalNetAll, 4),
    totalPlannedReceipts: roundTo(totalPlannedAll, 4),
    shortageAlerts: shortageCount,
    lateOrderWarnings: lateCount,
    criticalComponents: criticalCount,
    hasCycle,
    missingComponents: missingComponents.length,
    planFeasible: shortageCount === 0 && missingComponents.length === 0 && !hasCycle,
  };

  const validIssues: string[] = [];
  if (hasCycle) validIssues.push('BOM contains a cycle');
  if (missingComponents.length > 0) validIssues.push(`Missing components: ${missingComponents.join(', ')}`);
  if (shortageAlerts.length > 0) validIssues.push(`${shortageAlerts.length} component(s) have shortages`);
  if (lateOrderWarnings.length > 0) validIssues.push(`${lateOrderWarnings.length} late-order warning(s)`);

  const valid = validIssues.length === 0;
  const reason = valid
    ? planQty > 0
      ? 'Plan is feasible.'
      : 'Plan is empty (zero quantity or no requirements).'
    : validIssues.length === 1
      ? validIssues[0]
      : validIssues.join('; ');

  return {
    valid,
    reason,
    rootId,
    planQuantity: planQty,
    needDate: new Date(start.getTime() + needDays * 86400000),
    startDate: start,
    horizonDays: horizon,
    bucketSizeDays: bucketSize,
    bucketCount,
    buckets,
    topology: {
      ordered,
      levels,
      hasCycle,
      missingIds: missingComponents,
    },
    components: componentRecords,
    plannedOrderReleases: plannedReleases,
    shortageAlerts,
    lateOrderWarnings,
    criticalComponents,
    bomTree,
    bomVisual,
    summary,
    explosionFactor,
    grossProfiles,
  };
}

export function mrpToCSV(plan: MrpPlanResult): string {
  const lines: string[] = [];
  lines.push('FactoryMind MRP Export');
  lines.push(csvRow(['Root item', plan.rootId || '']));
  lines.push(csvRow(['Plan quantity', Number(plan.planQuantity) || 0]));
  lines.push(csvRow(['Need date', plan.needDate ? plan.needDate.toISOString() : '']));
  lines.push(csvRow(['Start date', plan.startDate ? plan.startDate.toISOString() : '']));
  lines.push(csvRow(['Horizon (days)', Number(plan.horizonDays) || 0]));
  lines.push(csvRow(['Bucket size (days)', Number(plan.bucketSizeDays) || 0]));
  lines.push(csvRow(['Bucket count', Number(plan.bucketCount) || 0]));
  lines.push(csvRow(['Valid', plan.valid ? 'yes' : 'no']));
  lines.push(csvRow(['Reason', plan.reason || '']));
  lines.push('');

  lines.push('Planned Order Releases');
  lines.push(csvRow(['Component', 'Name', 'Bucket', 'Release Date', 'Quantity', 'Lead Time (days)', 'Need Date', 'Lot Rule']));
  for (const r of plan.plannedOrderReleases || []) {
    const rd = r.releaseDate instanceof Date ? r.releaseDate.toISOString() : '';
    const nd = r.needDate instanceof Date ? r.needDate.toISOString() : '';
    lines.push(csvRow([r.componentId, r.componentName, r.bucketIndex, rd, r.quantity, r.leadTimeDays, nd, r.lotRule]));
  }
  lines.push('');

  lines.push('Component Time-Phased Detail');
  lines.push(
    csvRow([
      'Component',
      'Name',
      'Level',
      'On Hand',
      'Safety Stock',
      'Lead Time (days)',
      'Total Gross',
      'Total Net Req',
      'Total Planned Receipts',
      'Total Planned Releases',
      'Final Projected On Hand',
      'Shortage',
      'Lot Rule',
    ])
  );
  for (const cid of Object.keys(plan.components || {})) {
    const c = plan.components[cid];
    if (!c) continue;
    lines.push(
      csvRow([
        c.id,
        c.name,
        c.level,
        c.onHand,
        c.safetyStock,
        c.leadTimeDays,
        c.totalGross,
        c.totalNetRequirement,
        c.totalPlannedReceipts,
        c.totalPlannedReleases,
        c.finalProjectedOnHand,
        c.shortage ? 'yes' : 'no',
        c.lotRule,
      ])
    );
  }
  return lines.join('\r\n');
}
