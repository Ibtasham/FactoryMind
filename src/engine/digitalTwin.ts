/**
 * FactoryMind 3D Digital Twin State & Relationship Engine
 *
 * Pure TypeScript module (zero DOM or Three.js dependencies) connecting:
 *   - Live Workspace Catalog & Stock Status (`store.ts` / `ipe.ts`)
 *   - BOM Parent-Child Component Relationships & Warehouse Rack Addressing
 *   - Discrete-Event Production Simulation (`desEngine.ts`)
 *   - Scenario Studio Before-vs-After Counterfactuals (`scenarioStudio.ts`)
 *
 * Strict Provenance Discipline:
 *   - Warehouse SKU stock & BOM structure are tagged `'WORKSPACE_CATALOG'`
 *     (or `'SCENARIO_COUNTERFACTUAL'` when simulating scenario inventory policies).
 *   - Workstation queues, utilization, breakdowns, PM, and active orders are
 *     explicitly tagged `'SIMULATED_DES_MODEL'` and never presented as live telemetry.
 */

import { DesTimelineSample } from './desEngine.ts';
import { StockStatus } from './ipe.ts';
import {
  compareScenarioToBaseline,
  evaluateScenario,
  ScenarioDefinition,
  ScenarioEvaluation,
  ScenarioWorkspaceInput,
} from './scenarioStudio.ts';
import { ASSEMBLY_3D_SPECS, AssemblySku, isAssemblySku } from './threeSpecs.ts';

/* -------------------------------------------------------------------------- */
/*  Visual Status Taxonomy (9 Consistent States across 3D, 2D & Inspector)   */
/* -------------------------------------------------------------------------- */

export type InventoryVisualStatus = 'normal' | 'reorder' | 'low';

export type MachineVisualStatus =
  | 'idle'
  | 'processing'
  | 'breakdown'
  | 'maintenance'
  | 'congested'
  | 'bottleneck';

export type TwinDataProvenance =
  | 'WORKSPACE_CATALOG'
  | 'SIMULATED_DES_MODEL'
  | 'SCENARIO_COUNTERFACTUAL';

export interface VisualIndicatorSpec {
  id: InventoryVisualStatus | MachineVisualStatus;
  group: 'inventory' | 'machine';
  label: string;
  shortCode: string;
  hexColor: string;
  badgeCls: string;
  description: string;
}

export const VISUAL_INDICATOR_SPECS: Record<
  InventoryVisualStatus | MachineVisualStatus,
  VisualIndicatorSpec
> = {
  // Inventory states (3)
  normal: {
    id: 'normal',
    group: 'inventory',
    label: 'Normal Inventory',
    shortCode: 'OK',
    hexColor: '#10b981',
    badgeCls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35',
    description: 'On-hand stock above reorder point (ROP).',
  },
  reorder: {
    id: 'reorder',
    group: 'inventory',
    label: 'Reorder Triggered',
    shortCode: 'ROP',
    hexColor: '#f59e0b',
    badgeCls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
    description: 'On-hand stock at or below ROP; replenishment order needed.',
  },
  low: {
    id: 'low',
    group: 'inventory',
    label: 'Low / Critical Stock',
    shortCode: 'LOW',
    hexColor: '#ef4444',
    badgeCls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
    description: 'At or below safety stock (or stocked out); immediate shortage risk.',
  },

  // Machine / Workstation states (6)
  processing: {
    id: 'processing',
    group: 'machine',
    label: 'Machine Processing',
    shortCode: 'RUN',
    hexColor: '#10b981',
    badgeCls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35',
    description: 'Active value-adding cycle or SKU setup changeover in progress.',
  },
  idle: {
    id: 'idle',
    group: 'machine',
    label: 'Machine Idle',
    shortCode: 'IDLE',
    hexColor: '#64748b',
    badgeCls: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/35',
    description: 'Waiting for upstream WIP / material availability or off-shift.',
  },
  congested: {
    id: 'congested',
    group: 'machine',
    label: 'Buffer Congestion',
    shortCode: 'CONG',
    hexColor: '#f59e0b',
    badgeCls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
    description: 'Downstream blocked or WIP queue >= 75% of station buffer capacity.',
  },
  bottleneck: {
    id: 'bottleneck',
    group: 'machine',
    label: 'Production Bottleneck',
    shortCode: 'BN',
    hexColor: '#f43f5e',
    badgeCls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
    description: 'Highest utilization / constraint station governing line throughput.',
  },
  breakdown: {
    id: 'breakdown',
    group: 'machine',
    label: 'Machine Breakdown',
    shortCode: 'DOWN',
    hexColor: '#dc2626',
    badgeCls: 'bg-red-600/20 text-red-700 dark:text-red-300 border-red-500/50',
    description: 'Unplanned stochastic failure active; waiting on MTTR repair.',
  },
  maintenance: {
    id: 'maintenance',
    group: 'machine',
    label: 'Planned Maintenance',
    shortCode: 'PM',
    hexColor: '#0ea5e9',
    badgeCls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40',
    description: 'Scheduled preventive maintenance window active.',
  },
};

/* -------------------------------------------------------------------------- */
/*  Data Structures                                                           */
/* -------------------------------------------------------------------------- */

export interface TwinCatalogMetricInput {
  rop: number;
  safetyStock: number;
  status: StockStatus;
  eoqQty?: number;
}

export interface RackCoordinate {
  code: string;
  rack: number; // 1-based (R1, R2, R3...)
  shelf: number; // 1-based (S1 lower, S2 upper)
  bay: number; // 1-based (B1..B3)
}

export interface TwinRackBin {
  productId: string;
  partId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  rop: number;
  safetyStock: number;
  fillRatio: number;
  stockStatus: StockStatus;
  visualStatus: InventoryVisualStatus;
  location: RackCoordinate;
  usedInAssemblies: string[];
  starvedInSimulation: boolean;
  provenance: TwinDataProvenance;
}

export interface TwinBomLink {
  parentSku: string;
  parentName: string;
  componentSku: string;
  componentName: string;
  componentPartId: string;
  qtyPer: number;
  rackLocation: string;
  availableStock: number;
  stockStatus: StockStatus;
  visualStatus: InventoryVisualStatus;
  buildableUnits: number;
  shortageForBatch: number;
}

export interface TwinStationSnapshot {
  stationNumber: number;
  partId: string;
  id: string;
  name: string;
  machineCount: number;
  nominalCycleMin: number;
  machineState: MachineVisualStatus;
  utilizationPct: number;
  avgQueueLen: number;
  currentQueueLen: number;
  bufferCapacity: number;
  congestionPct: number;
  downPct: number;
  pmPct: number;
  blockedPct: number;
  starvedPct: number;
  oeeAvailabilityPct: number;
  oeePerformancePct: number;
  isBottleneck: boolean;
  throughputPerHour: number;
  activeOrderIds: string[];
  tasksLabel: string;
  provenance: TwinDataProvenance;
}

export interface TwinOrderProgress {
  id: string;
  sku: string;
  orderedQty: number;
  releasedQty: number;
  completedQty: number;
  scrappedQty: number;
  inWipQty: number;
  completionRatePct: number;
  avgLeadTimeMin: number;
  onTimePct: number;
}

export interface TwinMaterialFlow {
  id: string;
  componentSku: string;
  componentName: string;
  rackCode: string;
  targetStationId: string;
  targetStationNumber: number;
  qtyPerJob: number;
  endingStock: number;
  stockoutOccurred: boolean;
  visualStatus: InventoryVisualStatus;
}

export interface TwinTimelineCursor {
  frameIndex: number;
  totalFrames: number;
  minute: number;
  hour: number;
  label: string;
  isWorking: boolean;
  wip: number;
  completedCumulative: number;
  scrappedCumulative: number;
  throughputPerScheduledHr: number;
}

export interface DigitalTwinSnapshot {
  snapshotOrigin: 'baseline' | 'scenario';
  scenarioId: string;
  scenarioName: string;
  assemblySku: string;
  rackBins: TwinRackBin[];
  bomLinks: TwinBomLink[];
  stations: TwinStationSnapshot[];
  orders: TwinOrderProgress[];
  materialFlows: TwinMaterialFlow[];
  timeline: TwinTimelineCursor | null;
  summary: {
    throughputPerHour: number;
    oeePct: number;
    avgCycleTimeMin: number;
    avgWip: number;
    completionRatePct: number;
    bottleneckStationId: string;
    bottleneckStationName: string;
    congestedStationsCount: number;
    downOrPmStationsCount: number;
    lowOrReorderBinsCount: number;
    starvedMaterialSkusCount: number;
    valid: boolean;
  };
  provenanceNote: string;
}

export interface TwinScenarioComparison {
  baseline: DigitalTwinSnapshot;
  scenario: DigitalTwinSnapshot;
  headline: string;
  deltas: {
    throughputPerHrDelta: number;
    throughputDeltaPct: number;
    oeeDeltaPts: number;
    cycleTimeDeltaMin: number;
    avgWipDelta: number;
    congestedStationsDelta: number;
    lowStockBinsDelta: number;
    bottleneckShifted: boolean;
    baselineBottleneck: string;
    scenarioBottleneck: string;
  };
  whatChanged: string[];
  whatImproved: string[];
  whatDeteriorated: string[];
  confidenceLabel: string;
}

/* -------------------------------------------------------------------------- */
/*  Pure Classification & Location Helpers                                    */
/* -------------------------------------------------------------------------- */

export function formatRackLocation(index: number): RackCoordinate {
  const safeIdx = Math.max(0, Math.floor(index));
  const rackIdx = Math.floor(safeIdx / 6);
  const inRack = safeIdx % 6;
  const shelfIdx = Math.floor(inRack / 3);
  const bayIdx = inRack % 3;
  const rack = rackIdx + 1;
  const shelf = shelfIdx + 1;
  const bay = bayIdx + 1;
  return {
    code: `R${rack}-S${shelf}-B${bay}`,
    rack,
    shelf,
    bay,
  };
}

export function mapStockToInventoryVisualStatus(
  stockStatus: StockStatus,
  stock?: number,
  rop?: number,
  safetyStock?: number
): InventoryVisualStatus {
  if (stockStatus === 'critical' || stockStatus === 'out') return 'low';
  if (stockStatus === 'reorder') return 'reorder';
  if (
    typeof stock === 'number' &&
    typeof safetyStock === 'number' &&
    stock <= safetyStock
  ) {
    return 'low';
  }
  if (typeof stock === 'number' && typeof rop === 'number' && stock <= rop) {
    return 'reorder';
  }
  return 'normal';
}

export function classifyMachineVisualStatus(params: {
  frameState?: DesTimelineSample['stationStates'][number] | null;
  queueLen: number;
  bufferCapacity: number;
  isBottleneck: boolean;
  downPct: number;
  pmPct: number;
  blockedPct: number;
  utilizationPct: number;
}): MachineVisualStatus {
  const cap = Math.max(1, params.bufferCapacity);
  const queueRatio = params.queueLen / cap;

  // Timeline sample takes precedence during active frame inspection / playback
  if (params.frameState) {
    switch (params.frameState) {
      case 'down':
        return 'breakdown';
      case 'pm':
        return 'maintenance';
      case 'blocked':
        return 'congested';
      case 'starved':
      case 'offShift':
        return 'idle';
      case 'busy':
      case 'setup':
        if (queueRatio >= 0.75) return 'congested';
        if (params.isBottleneck) return 'bottleneck';
        return 'processing';
    }
  }

  // Aggregate mode across full DES horizon
  if (params.downPct >= 15) return 'breakdown';
  if (params.pmPct >= 12) return 'maintenance';
  if (params.isBottleneck) return 'bottleneck';
  if (params.blockedPct >= 10 || queueRatio >= 0.75) return 'congested';
  if (params.utilizationPct >= 20) return 'processing';
  return 'idle';
}

/* -------------------------------------------------------------------------- */
/*  BOM Relationship & Warehouse Mapping                                      */
/* -------------------------------------------------------------------------- */

export function buildWarehouseRackBins(
  products: ScenarioWorkspaceInput['products'],
  metricsMap: ReadonlyMap<string, TwinCatalogMetricInput>,
  desMaterials: ReadonlyArray<{ sku: string; endingStock: number; stockoutOccurred: boolean }> = [],
  origin: 'baseline' | 'scenario' = 'baseline'
): TwinRackBin[] {
  const parentMap = new Map<string, Set<string>>();
  const prodById = new Map(products.map((p) => [p.id, p]));

  products.forEach((parent) => {
    (parent.bom || []).forEach((line) => {
      const comp = prodById.get(line.componentId);
      if (!comp) return;
      if (!parentMap.has(comp.sku.toUpperCase())) {
        parentMap.set(comp.sku.toUpperCase(), new Set());
      }
      parentMap.get(comp.sku.toUpperCase())!.add(parent.sku);
    });
  });

  // Also ensure ASSEMBLY_3D_SPECS part SKUs show procedural 3D parent links
  (Object.keys(ASSEMBLY_3D_SPECS) as AssemblySku[]).forEach((asmSku) => {
    ASSEMBLY_3D_SPECS[asmSku].parts.forEach((part) => {
      const key = part.sku.toUpperCase();
      if (!parentMap.has(key)) parentMap.set(key, new Set());
      parentMap.get(key)!.add(asmSku);
    });
  });

  const simMatMap = new Map(desMaterials.map((m) => [m.sku.toUpperCase(), m]));

  return products.map((p, idx) => {
    const m = metricsMap.get(p.id) ?? {
      rop: Math.max(1, Math.round((p.annualDemand / 365) * p.leadTime * 1.25)),
      safetyStock: Math.max(1, Math.round((p.annualDemand / 365) * p.leadTime * 0.25)),
      status: p.stock <= 0 ? 'out' : 'ok',
    };
    const simMat = origin === 'scenario' ? simMatMap.get(p.sku.toUpperCase()) : undefined;
    const effectiveStock = simMat ? Math.max(0, simMat.endingStock) : p.stock;
    const effectiveStatus: StockStatus =
      effectiveStock <= 0
        ? 'out'
        : effectiveStock <= m.safetyStock
          ? 'critical'
          : effectiveStock <= m.rop
            ? 'reorder'
            : 'ok';

    const visualStatus = mapStockToInventoryVisualStatus(
      effectiveStatus,
      effectiveStock,
      m.rop,
      m.safetyStock
    );

    const fillRatio =
      m.rop > 0
        ? Math.min(1.25, Math.max(0.14, effectiveStock / (m.rop * 2)))
        : effectiveStock > 0
          ? 0.75
          : 0.14;

    return {
      productId: p.id,
      partId: `sku-${p.sku}`,
      sku: p.sku,
      name: p.name,
      category: p.category,
      unit: p.unit,
      stock: effectiveStock,
      rop: m.rop,
      safetyStock: m.safetyStock,
      fillRatio,
      stockStatus: effectiveStatus,
      visualStatus,
      location: formatRackLocation(idx),
      usedInAssemblies: Array.from(parentMap.get(p.sku.toUpperCase()) || []),
      starvedInSimulation: Boolean(simMatMap.get(p.sku.toUpperCase())?.stockoutOccurred),
      provenance: simMat ? 'SCENARIO_COUNTERFACTUAL' : 'WORKSPACE_CATALOG',
    };
  });
}

export function buildBomRelationshipLinks(
  products: ScenarioWorkspaceInput['products'],
  rackBins: ReadonlyArray<TwinRackBin>,
  assemblySku: string,
  plannedBatchQty = 20
): TwinBomLink[] {
  const binBySku = new Map(rackBins.map((b) => [b.sku.toUpperCase(), b]));
  const prodById = new Map(products.map((p) => [p.id, p]));
  const parentProd = products.find((p) => p.sku.toUpperCase() === assemblySku.toUpperCase());

  if (parentProd && parentProd.bom.length > 0) {
    return parentProd.bom
      .map((line) => {
        const comp = prodById.get(line.componentId);
        if (!comp || line.qtyPer <= 0) return null;
        const bin = binBySku.get(comp.sku.toUpperCase());
        const stock = bin ? bin.stock : comp.stock;
        const status = bin ? bin.stockStatus : 'ok';
        const visual = bin ? bin.visualStatus : mapStockToInventoryVisualStatus(status);
        const buildableUnits = Math.floor(stock / line.qtyPer);
        const requiredForBatch = line.qtyPer * plannedBatchQty;
        return {
          parentSku: parentProd.sku,
          parentName: parentProd.name,
          componentSku: comp.sku,
          componentName: comp.name,
          componentPartId: bin ? bin.partId : `sku-${comp.sku}`,
          qtyPer: line.qtyPer,
          rackLocation: bin ? bin.location.code : 'UNASSIGNED',
          availableStock: stock,
          stockStatus: status,
          visualStatus: visual,
          buildableUnits,
          shortageForBatch: Math.max(0, Number((requiredForBatch - stock).toFixed(2))),
        };
      })
      .filter((x): x is TwinBomLink => x !== null);
  }

  // Fallback to procedural assembly spec links
  if (isAssemblySku(assemblySku)) {
    const spec = ASSEMBLY_3D_SPECS[assemblySku];
    return spec.parts.map((part) => {
      const bin = binBySku.get(part.sku.toUpperCase());
      const stock = bin?.stock ?? 0;
      const status = bin?.stockStatus ?? 'ok';
      const visual = bin?.visualStatus ?? 'normal';
      const buildableUnits = part.qtyPer > 0 ? Math.floor(stock / part.qtyPer) : 0;
      const req = part.qtyPer * plannedBatchQty;
      return {
        parentSku: spec.sku,
        parentName: spec.title,
        componentSku: part.sku,
        componentName: part.label,
        componentPartId: bin ? bin.partId : part.partId,
        qtyPer: part.qtyPer,
        rackLocation: bin ? bin.location.code : 'UNASSIGNED',
        availableStock: stock,
        stockStatus: status,
        visualStatus: visual,
        buildableUnits,
        shortageForBatch: Math.max(0, Number((req - stock).toFixed(2))),
      };
    });
  }

  return [];
}

/* -------------------------------------------------------------------------- */
/*  Main Snapshot Builder (DES + Catalog -> 3D/2D Twin State)                 */
/* -------------------------------------------------------------------------- */

export function buildDigitalTwinSnapshot(input: {
  products: ScenarioWorkspaceInput['products'];
  metricsMap: ReadonlyMap<string, TwinCatalogMetricInput>;
  evaluation: ScenarioEvaluation;
  assemblySku: string;
  frameIdx?: number | null;
  origin?: 'baseline' | 'scenario';
}): DigitalTwinSnapshot {
  const origin = input.origin ?? 'baseline';
  const { evaluation } = input;
  const des = evaluation.desResult;
  const timelineArr = des.timeline || [];

  let activeFrame: DesTimelineSample | null = null;
  let resolvedFrameIdx = -1;
  if (typeof input.frameIdx === 'number' && timelineArr.length > 0) {
    resolvedFrameIdx = Math.max(0, Math.min(timelineArr.length - 1, Math.floor(input.frameIdx)));
    activeFrame = timelineArr[resolvedFrameIdx];
  } else if (timelineArr.length > 0) {
    resolvedFrameIdx = timelineArr.length - 1;
    activeFrame = timelineArr[resolvedFrameIdx];
  }

  const rackBins = buildWarehouseRackBins(
    input.products,
    input.metricsMap,
    des.materials || [],
    origin
  );

  const bomLinks = buildBomRelationshipLinks(
    input.products,
    rackBins,
    input.assemblySku,
    evaluation.params.productionBatchQty
  );

  const orders: TwinOrderProgress[] = (des.orders || []).map((o) => ({
    id: o.id,
    sku: o.sku,
    orderedQty: o.orderedQty,
    releasedQty: o.releasedQty,
    completedQty: o.completedQty,
    scrappedQty: o.scrappedQty,
    inWipQty: o.inWipQty,
    completionRatePct: o.completionRatePct,
    avgLeadTimeMin: o.avgLeadTimeMin,
    onTimePct: o.onTimePct,
  }));

  const activeOrderIds = orders
    .filter((o) => o.inWipQty > 0 || o.completionRatePct < 100)
    .map((o) => o.id);

  const throughputPerHr = des.throughputPerScheduledHour.mean;

  const stations: TwinStationSnapshot[] = (des.stations || []).map((st, idx) => {
    const frameState = activeFrame?.stationStates?.[idx] ?? null;
    const currentQueueLen =
      activeFrame && Array.isArray(activeFrame.stationQueues) && typeof activeFrame.stationQueues[idx] === 'number'
        ? activeFrame.stationQueues[idx]
        : st.avgQueueLen;
    const cap = Math.max(1, st.bufferCapacity);
    const congestionPct = Math.min(100, Math.round((currentQueueLen / cap) * 100));

    const machineState = classifyMachineVisualStatus({
      frameState,
      queueLen: currentQueueLen,
      bufferCapacity: cap,
      isBottleneck: st.isBottleneck,
      downPct: st.downPct,
      pmPct: st.pmPct,
      blockedPct: st.blockedPct,
      utilizationPct: st.assetUtilizationPct,
    });

    return {
      stationNumber: idx + 1,
      partId: `station-${idx + 1}`,
      id: st.id,
      name: st.name,
      machineCount: st.machineCount,
      nominalCycleMin: st.nominalCycleMin,
      machineState,
      utilizationPct: Math.round(st.assetUtilizationPct),
      avgQueueLen: st.avgQueueLen,
      currentQueueLen,
      bufferCapacity: cap,
      congestionPct,
      downPct: st.downPct,
      pmPct: st.pmPct,
      blockedPct: st.blockedPct,
      starvedPct: st.starvedPct,
      oeeAvailabilityPct: st.oeeAvailabilityPct,
      oeePerformancePct: st.oeePerformancePct,
      isBottleneck: st.isBottleneck,
      throughputPerHour: throughputPerHr,
      activeOrderIds: activeOrderIds.slice(0, 3),
      tasksLabel: `${st.id} · ${st.machineCount}×M · ${st.nominalCycleMin.toFixed(1)}m/u`,
      provenance: 'SIMULATED_DES_MODEL',
    };
  });

  // Connect BOM materials feeding into station 1 (material intake station)
  const firstStation = stations[0];
  const desMatMap = new Map((des.materials || []).map((m) => [m.sku.toUpperCase(), m]));
  const materialFlows: TwinMaterialFlow[] = bomLinks.map((link, idx) => {
    const desMat = desMatMap.get(link.componentSku.toUpperCase());
    const targetStation = stations[Math.min(idx % Math.max(1, stations.length), stations.length - 1)] || firstStation;
    return {
      id: `flow-${link.componentSku}-${targetStation ? targetStation.id : 'S1'}`,
      componentSku: link.componentSku,
      componentName: link.componentName,
      rackCode: link.rackLocation,
      targetStationId: targetStation ? targetStation.id : 'S1',
      targetStationNumber: targetStation ? targetStation.stationNumber : 1,
      qtyPerJob: link.qtyPer,
      endingStock: desMat ? desMat.endingStock : link.availableStock,
      stockoutOccurred: Boolean(desMat?.stockoutOccurred),
      visualStatus: link.visualStatus,
    };
  });

  const timelineCursor: TwinTimelineCursor | null = activeFrame
    ? {
        frameIndex: resolvedFrameIdx,
        totalFrames: timelineArr.length,
        minute: activeFrame.minute,
        hour: activeFrame.hour,
        label: activeFrame.label,
        isWorking: activeFrame.isWorking,
        wip: activeFrame.wip,
        completedCumulative: activeFrame.completedCumulative,
        scrappedCumulative: activeFrame.scrappedCumulative,
        throughputPerScheduledHr: activeFrame.throughputPerScheduledHr,
      }
    : null;

  return {
    snapshotOrigin: origin,
    scenarioId: evaluation.scenarioId,
    scenarioName: evaluation.scenarioName,
    assemblySku: input.assemblySku,
    rackBins,
    bomLinks,
    stations,
    orders,
    materialFlows,
    timeline: timelineCursor,
    summary: {
      throughputPerHour: throughputPerHr,
      oeePct: des.oeePct,
      avgCycleTimeMin: des.avgCycleTimeMin.mean,
      avgWip: des.avgWip.mean,
      completionRatePct: des.completionRatePct,
      bottleneckStationId: des.bottleneckId,
      bottleneckStationName: des.bottleneckName,
      congestedStationsCount: stations.filter((s) => s.machineState === 'congested').length,
      downOrPmStationsCount: stations.filter(
        (s) => s.machineState === 'breakdown' || s.machineState === 'maintenance'
      ).length,
      lowOrReorderBinsCount: rackBins.filter((b) => b.visualStatus !== 'normal').length,
      starvedMaterialSkusCount: (des.materials || []).filter((m) => m.stockoutOccurred).length,
      valid: evaluation.valid && des.valid,
    },
    provenanceNote:
      origin === 'baseline'
        ? 'Warehouse bins reflect Workspace Catalog stock & ROP; workstation queues, OEE, and breakdowns come from the Priority-Queue DES Model (simulated, not live PLC telemetry).'
        : 'Counterfactual Scenario Mode: Both factory floor dynamics and simulated ending material balances reflect DES scenario projections (non-mutating).',
  };
}

/* -------------------------------------------------------------------------- */
/*  Before-vs-After Scenario Comparison Twin                                  */
/* -------------------------------------------------------------------------- */

export function buildTwinScenarioComparison(
  ws: ScenarioWorkspaceInput,
  baselineDef: ScenarioDefinition,
  candidateDef: ScenarioDefinition,
  metricsMap: ReadonlyMap<string, TwinCatalogMetricInput>,
  frameIdx?: number | null
): TwinScenarioComparison {
  const baselineEval = evaluateScenario(baselineDef, ws);
  const candidateEval = evaluateScenario(candidateDef, ws);
  const cmp = compareScenarioToBaseline(baselineEval, candidateEval);

  const baselineSnap = buildDigitalTwinSnapshot({
    products: ws.products,
    metricsMap,
    evaluation: baselineEval,
    assemblySku: candidateEval.params.assemblySku,
    frameIdx,
    origin: 'baseline',
  });

  const scenarioSnap = buildDigitalTwinSnapshot({
    products: ws.products,
    metricsMap,
    evaluation: candidateEval,
    assemblySku: candidateEval.params.assemblySku,
    frameIdx,
    origin: 'scenario',
  });

  const baseTp = baselineSnap.summary.throughputPerHour;
  const scenTp = scenarioSnap.summary.throughputPerHour;
  const tpDelta = scenTp - baseTp;
  const tpDeltaPct = baseTp > 0 ? (tpDelta / baseTp) * 100 : 0;

  return {
    baseline: baselineSnap,
    scenario: scenarioSnap,
    headline: cmp.explanation.recommendationHeadline,
    deltas: {
      throughputPerHrDelta: Number(tpDelta.toFixed(2)),
      throughputDeltaPct: Number(tpDeltaPct.toFixed(1)),
      oeeDeltaPts: Number((scenarioSnap.summary.oeePct - baselineSnap.summary.oeePct).toFixed(1)),
      cycleTimeDeltaMin: Number(
        (scenarioSnap.summary.avgCycleTimeMin - baselineSnap.summary.avgCycleTimeMin).toFixed(1)
      ),
      avgWipDelta: Number((scenarioSnap.summary.avgWip - baselineSnap.summary.avgWip).toFixed(1)),
      congestedStationsDelta:
        scenarioSnap.summary.congestedStationsCount - baselineSnap.summary.congestedStationsCount,
      lowStockBinsDelta:
        scenarioSnap.summary.lowOrReorderBinsCount - baselineSnap.summary.lowOrReorderBinsCount,
      bottleneckShifted:
        baselineSnap.summary.bottleneckStationId !== scenarioSnap.summary.bottleneckStationId,
      baselineBottleneck: baselineSnap.summary.bottleneckStationName || baselineSnap.summary.bottleneckStationId,
      scenarioBottleneck: scenarioSnap.summary.bottleneckStationName || scenarioSnap.summary.bottleneckStationId,
    },
    whatChanged: cmp.explanation.whatChanged,
    whatImproved: cmp.explanation.whatImproved,
    whatDeteriorated: cmp.explanation.whatDeteriorated,
    confidenceLabel: `${candidateEval.confidence.level} (${candidateEval.confidence.scorePct.toFixed(0)}%)`,
  };
}
