/**
 * FactoryMind Scenario Studio — Integrated Multi-Module Decision & Comparison Engine.
 *
 * Connects the full Industrial Engineering analytical chain without mutating live
 * workspace records during simulation:
 *   Demand Forecasting (forecast.ts)
 *     -> Inventory Optimization (ipe.ts)
 *     -> Time-Phased MRP (mrp.ts)
 *     -> Line Balancing & Production Config (linebal.ts, factorySim.ts)
 *     -> Priority-Queue Discrete-Event Simulation (desEngine.ts)
 *     -> Baseline-vs-Scenario Comparison, Explainability & Sensitivity Analysis
 *
 * Pure TypeScript, zero DOM dependencies.
 */

import {
  DesConfig,
  DesResult,
  DesRouteStep,
  DesStationSpec,
  runDiscreteEventSimulation,
} from './desEngine.ts';
import {
  FactorySimConfig,
  stationsFromLineBalanceForFactory,
  WorkspaceLineBalanceInput,
} from './factorySim.ts';
import {
  compareMethods,
  emaMethod,
  ForecastOutput,
  holtLinear,
  linregMethod,
  MethodSpec,
  smaMethod,
  wmaMethod,
} from './forecast.ts';
import { eoq, normCdf, rop } from './ipe.ts';
import { compareAlgorithms, LineBalTaskInput } from './linebal.ts';
import { LotRule, mrpPlan, MrpItemInput, MrpPlanResult } from './mrp.ts';

/* -------------------------------------------------------------------------- */
/*  Public Types                                                              */
/* -------------------------------------------------------------------------- */

export type ScenarioReorderPolicy = 'eoq-rop' | 'service-target' | 'l4l' | 'poq';

export interface ScenarioParams {
  assemblySku: string;
  demandVolumeMult: number;
  demandVariabilityMult: number;
  supplierLeadTimeMult: number;
  safetyStockMult: number;
  reorderPolicy: ScenarioReorderPolicy;
  targetServiceLevelPct: number;
  productionBatchQty: number;
  machineCycleMult: number;
  breakdownFreqMult: number;
  extraBottleneckMachines: number;
  operatorsAvailable: number;
  shiftHours: number;
  shiftsPerDay: number;
  scrapRatePct: number;
  bufferCapacity: number;
  horizonHours: number;
  replications: number;
  seed: number;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  notes: string;
  createdAt: number;
  isBaseline?: boolean;
  params: ScenarioParams;
}

export interface ScenarioWorkspaceInput {
  products: ReadonlyArray<{
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
    demandHistory: ReadonlyArray<number>;
    bom: ReadonlyArray<{ componentId: string; qtyPer: number }>;
  }>;
  lineBalance: WorkspaceLineBalanceInput;
  factorySimConfig: FactorySimConfig;
}

export interface ScenarioKpis {
  totalInventoryCostAnnual: number;
  serviceLevelPct: number;
  shortageRiskPct: number;
  replenishmentQtyTotal: number;
  plannedOrdersCount: number;
  throughputPerHour: number;
  avgCycleTimeMin: number;
  avgWip: number;
  machineUtilizationPct: number;
  downtimePct: number;
  downtimeHours: number;
  oeePct: number;
  oeeAvailabilityPct: number;
  oeePerformancePct: number;
  oeeQualityPct: number;
  productionCompletionPct: number;
  onTimeDeliveryPct: number;
  operatingCostPerUnit: number;
  totalPeriodOperatingCost: number;
}

export interface ScenarioEvaluation {
  scenarioId: string;
  scenarioName: string;
  provenance: 'SCENARIO_SIMULATION_MODEL';
  provenanceNotice: string;
  valid: boolean;
  reason: string;
  params: ScenarioParams;
  kpis: ScenarioKpis;
  forecastSummary: {
    modelName: string;
    monthlyForecast: number;
    annualForecast: number;
    backtestMapePct: number | null;
    arrivalRatePerHour: number;
    arrivalCv: number;
  };
  inventorySummary: {
    skuCountInScope: number;
    holdingCostAnnual: number;
    orderingCostAnnual: number;
    safetyStockUnits: number;
    avgRopUnits: number;
    exposedSkusCount: number;
  };
  mrpSummary: {
    shortageCount: number;
    lateOrdersCount: number;
    plannedOrdersCount: number;
    replenishmentCostEstimate: number;
    criticalComponents: string[];
  };
  lineBalanceSummary: {
    algorithm: string;
    effectiveCycleTimeMin: number;
    stationCount: number;
    lineEfficiencyPct: number;
    smoothnessIndex: number;
    operatorsRequired: number;
    workforceStaffingRatio: number;
  };
  desResult: DesResult;
  confidence: {
    level: 'High' | 'Moderate' | 'Low';
    scorePct: number;
    throughputCiHalfPct: number;
    forecastFitPct: number;
    summary: string;
  };
}

export interface KpiDelta {
  key: keyof ScenarioKpis;
  label: string;
  unit: string;
  baseline: number;
  scenario: number;
  delta: number;
  deltaPct: number;
  betterWhen: 'higher' | 'lower';
  status: 'improved' | 'deteriorated' | 'neutral';
}

export interface ScenarioExplanation {
  whatChanged: string[];
  modelsUsed: string[];
  assumptions: string[];
  whatImproved: string[];
  whatDeteriorated: string[];
  remainingConstraints: string[];
  confidenceStatement: string;
  recommendationHeadline: string;
}

export interface ScenarioComparison {
  baseline: ScenarioEvaluation;
  scenario: ScenarioEvaluation;
  deltas: KpiDelta[];
  explanation: ScenarioExplanation;
}

export interface ScenarioSensitivityRow {
  id: string;
  label: string;
  parameterChanged: string;
  throughputDeltaPct: number;
  inventoryCostDeltaPct: number;
  oeeDeltaPts: number;
  shortageRiskDeltaPts: number;
  operatingCostDeltaPct: number;
  bottleneckName: string;
}

export interface ScenarioApplyPreview {
  scenarioName: string;
  assemblySku: string;
  changes: Array<{ target: string; field: string; currentValue: string; nextValue: string }>;
}

/* -------------------------------------------------------------------------- */
/*  Sanitization & Default Params                                             */
/* -------------------------------------------------------------------------- */

const FORECAST_CANDIDATES: MethodSpec[] = [
  { name: 'SMA (3)', shortKey: 'sma', method: smaMethod, params: { w: 3 } },
  { name: 'WMA (3)', shortKey: 'wma', method: wmaMethod, params: { w: 3 } },
  { name: 'EMA (0.35)', shortKey: 'ema', method: emaMethod, params: { alpha: 0.35 } },
  { name: 'Holt Linear', shortKey: 'holt', method: holtLinear, params: { alpha: 0.3, beta: 0.1 } },
  { name: 'Linear Trend', shortKey: 'lin', method: linregMethod },
];

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function sanitizeScenarioParams(
  raw: Partial<ScenarioParams> | undefined,
  fallbackAssembly = 'ASM-PA100'
): ScenarioParams {
  const policy = raw?.reorderPolicy;
  const reorderPolicy: ScenarioReorderPolicy =
    policy === 'service-target' || policy === 'l4l' || policy === 'poq' || policy === 'eoq-rop'
      ? policy
      : 'eoq-rop';

  return {
    assemblySku: String(raw?.assemblySku || fallbackAssembly).trim() || fallbackAssembly,
    demandVolumeMult: Number(clampNum(raw?.demandVolumeMult, 0.3, 3.0, 1.0).toFixed(3)),
    demandVariabilityMult: Number(clampNum(raw?.demandVariabilityMult, 0.2, 3.0, 1.0).toFixed(3)),
    supplierLeadTimeMult: Number(clampNum(raw?.supplierLeadTimeMult, 0.25, 3.5, 1.0).toFixed(3)),
    safetyStockMult: Number(clampNum(raw?.safetyStockMult, 0.25, 3.5, 1.0).toFixed(3)),
    reorderPolicy,
    targetServiceLevelPct: Number(clampNum(raw?.targetServiceLevelPct, 80, 99.5, 95).toFixed(1)),
    productionBatchQty: Math.round(clampNum(raw?.productionBatchQty, 2, 1000, 24)),
    machineCycleMult: Number(clampNum(raw?.machineCycleMult, 0.4, 2.5, 1.0).toFixed(3)),
    breakdownFreqMult: Number(clampNum(raw?.breakdownFreqMult, 0.1, 4.0, 1.0).toFixed(3)),
    extraBottleneckMachines: Math.round(clampNum(raw?.extraBottleneckMachines, 0, 4, 0)),
    operatorsAvailable: Math.round(clampNum(raw?.operatorsAvailable, 1, 80, 4)),
    shiftHours: Number(clampNum(raw?.shiftHours, 4, 12, 8).toFixed(1)),
    shiftsPerDay: Math.round(clampNum(raw?.shiftsPerDay, 1, 3, 2)),
    scrapRatePct: Number(clampNum(raw?.scrapRatePct, 0, 35, 0.6).toFixed(2)),
    bufferCapacity: Math.round(clampNum(raw?.bufferCapacity, 1, 40, 6)),
    horizonHours: Math.round(clampNum(raw?.horizonHours, 8, 168, 24)),
    replications: Math.round(clampNum(raw?.replications, 1, 25, 6)),
    seed: Math.round(clampNum(raw?.seed, 1, 9999999, 2026)),
  };
}

export function buildBaselineScenarioFromWorkspace(ws: ScenarioWorkspaceInput): ScenarioDefinition {
  const fcfg = ws.factorySimConfig;
  const avgBuffer =
    fcfg.stations.length > 0
      ? Math.round(fcfg.stations.reduce((s, st) => s + st.bufferCapacity, 0) / fcfg.stations.length)
      : 6;

  return {
    id: 'baseline-live',
    name: 'Baseline (Live Workspace)',
    notes: 'Read-only baseline snapshot calibrated from current Catalog, Line Balance & Factory Sim config.',
    createdAt: Date.now(),
    isBaseline: true,
    params: sanitizeScenarioParams({
      assemblySku: fcfg.assemblySku,
      demandVolumeMult: 1.0,
      demandVariabilityMult: 1.0,
      supplierLeadTimeMult: 1.0,
      safetyStockMult: 1.0,
      reorderPolicy: 'eoq-rop',
      targetServiceLevelPct: 95,
      productionBatchQty: Math.max(12, Math.round(fcfg.arrivalRatePerHour * 4)),
      machineCycleMult: 1.0,
      breakdownFreqMult: 1.0,
      extraBottleneckMachines: 0,
      operatorsAvailable: Math.max(1, fcfg.operatorsAvailable),
      shiftHours: fcfg.shiftHours,
      shiftsPerDay: fcfg.shiftsPerDay,
      scrapRatePct: fcfg.defectRatePct,
      bufferCapacity: avgBuffer,
      horizonHours: Math.max(16, fcfg.daysToSimulate * 24),
      replications: Math.min(10, Math.max(3, fcfg.replications)),
      seed: fcfg.seed,
    }),
  };
}

export function buildPresetScenarioDefinitions(ws: ScenarioWorkspaceInput): ScenarioDefinition[] {
  const base = buildBaselineScenarioFromWorkspace(ws).params;
  const now = Date.now();
  return [
    {
      id: 'preset-lean-flow',
      name: 'Lean SMED & Low Batch',
      notes: '18% faster station cycle time, smaller transfer batches, POQ replenishment, and tighter WIP buffers (3 jobs).',
      createdAt: now - 3000,
      params: sanitizeScenarioParams({
        ...base,
        machineCycleMult: 0.82,
        productionBatchQty: Math.max(8, Math.round(base.productionBatchQty * 0.6)),
        reorderPolicy: 'poq',
        bufferCapacity: 3,
        scrapRatePct: Math.max(0.2, Number((base.scrapRatePct * 0.7).toFixed(2))),
      }),
    },
    {
      id: 'preset-capacity-resilience',
      name: 'Capacity & Buffer Expansion',
      notes: '+1 parallel bottleneck machine & operator, 10% faster cycle, balanced buffers (8), and 0.6× breakdown rate.',
      createdAt: now - 2000,
      params: sanitizeScenarioParams({
        ...base,
        machineCycleMult: 0.9,
        extraBottleneckMachines: 1,
        operatorsAvailable: base.operatorsAvailable + 1,
        bufferCapacity: 8,
        breakdownFreqMult: 0.6,
        safetyStockMult: 1.15,
      }),
    },
    {
      id: 'preset-demand-surge',
      name: 'Peak Demand Surge (+30%)',
      notes: 'Stress-test 1.30× order volume and 1.35× demand variability without expanding floor capacity.',
      createdAt: now - 1000,
      params: sanitizeScenarioParams({
        ...base,
        demandVolumeMult: 1.3,
        demandVariabilityMult: 1.35,
        productionBatchQty: Math.round(base.productionBatchQty * 1.3),
      }),
    },
    {
      id: 'preset-supply-shock',
      name: 'Supplier Lead-Time Shock (1.8×)',
      notes: 'Evaluates 1.8× vendor lead times cushioned by 98% target service level and 1.35× safety stock.',
      createdAt: now,
      params: sanitizeScenarioParams({
        ...base,
        supplierLeadTimeMult: 1.8,
        reorderPolicy: 'service-target',
        targetServiceLevelPct: 98,
        safetyStockMult: 1.35,
      }),
    },
  ];
}

/* -------------------------------------------------------------------------- */
/*  Integrated Multi-Engine Evaluation Pipeline (Pure & Non-Mutating)         */
/* -------------------------------------------------------------------------- */

export function evaluateScenario(
  scenario: ScenarioDefinition,
  ws: ScenarioWorkspaceInput
): ScenarioEvaluation {
  const p = sanitizeScenarioParams(scenario.params, ws.factorySimConfig.assemblySku);

  const products = ws.products;
  if (!products.length) {
    return buildInvalidScenarioEval(scenario, p, 'Workspace has no products to evaluate.');
  }

  const assembly =
    products.find((item) => item.sku.toUpperCase() === p.assemblySku.toUpperCase()) ||
    products.find((item) => item.bom && item.bom.length > 0) ||
    products[0];

  const prodById = new Map(products.map((item) => [item.id, item]));

  /* --- 1. Demand Forecasting (forecast.ts) --- */
  const rawHist = (assembly.demandHistory || []).map(Number).filter((v) => Number.isFinite(v) && v >= 0);
  const histMean = rawHist.length ? rawHist.reduce((a, b) => a + b, 0) / rawHist.length : assembly.annualDemand / 12;
  const scaledHist = rawHist.map((v) =>
    Math.max(0.5, (histMean + (v - histMean) * p.demandVariabilityMult) * p.demandVolumeMult)
  );

  let monthlyForecast = Math.max(1, (assembly.annualDemand / 12) * p.demandVolumeMult);
  let forecastModelName = 'Scaled annual demand';
  let backtestMapePct: number | null = null;

  if (scaledHist.length >= 6) {
    const minTrain = Math.min(6, Math.max(3, scaledHist.length - 3));
    const cmp = compareMethods(scaledHist, FORECAST_CANDIDATES, { minTrainSize: minTrain, horizon: 3 });
    if (cmp.best) {
      const out: ForecastOutput = cmp.best.method(scaledHist, { ...cmp.best.params, horizon: 3 });
      const next3 = out.forecast.slice(0, 3).map((x) => Math.max(0, Number(x) || 0));
      if (next3.length > 0) {
        monthlyForecast = Math.max(1, next3.reduce((a, b) => a + b, 0) / next3.length);
      }
      forecastModelName = cmp.best.name;
      backtestMapePct = cmp.best.metrics.mape != null && Number.isFinite(cmp.best.metrics.mape) ? cmp.best.metrics.mape : null;
    }
  }
  const annualForecast = monthlyForecast * 12;

  /* --- 2. Inventory Optimization (ipe.ts) --- */
  const bomComps = (assembly.bom || [])
    .map((line) => ({ line, comp: prodById.get(line.componentId) }))
    .filter((pair): pair is { line: { componentId: string; qtyPer: number }; comp: typeof assembly } =>
      Boolean(pair.comp && pair.line.qtyPer > 0)
    );

  const scopeItems = [assembly, ...bomComps.map((c) => c.comp)];
  let holdingCostAnnual = 0;
  let orderingCostAnnual = 0;
  let totalSafetyStockUnits = 0;
  let ropSum = 0;
  let weightedServiceSum = 0;
  let exposedSkus = 0;
  let totalDailyUsageWeighted = 0;

  interface BomSimMat {
    sku: string;
    name: string;
    unit: string;
    initialStock: number;
    qtyPerJob: number;
    rop: number;
    orderQty: number;
    leadTimeDays: number;
    unitCost: number;
  }

  const scenMaterials: BomSimMat[] = [];
  const scenMrpOverrides = new Map<string, { effLt: number; effSs: number; eoqQty: number }>();

  for (const item of scopeItems) {
    const isAssembly = item.id === assembly.id;
    const itemAnnualD = isAssembly ? annualForecast : item.annualDemand * p.demandVolumeMult;
    const H = Math.max(0.01, (item.unitCost * item.holdingRate) / 100);
    const effLt = Math.max(0.5, item.leadTime * p.supplierLeadTimeMult);
    const baseHist = (item.demandHistory || []).map(Number).filter((v) => Number.isFinite(v) && v >= 0);
    const itemMean = baseHist.length ? baseHist.reduce((a, b) => a + b, 0) / baseHist.length : itemAnnualD / 12;
    const scaledItemHist =
      baseHist.length >= 2
        ? baseHist.map((v) => Math.max(0.5, (itemMean + (v - itemMean) * p.demandVariabilityMult) * p.demandVolumeMult))
        : null;
    const effSl =
      p.reorderPolicy === 'service-target'
        ? p.targetServiceLevelPct
        : Math.max(80, Math.min(99.5, item.serviceLevel || p.targetServiceLevelPct));

    const eoqRes = eoq({
      annualDemand: itemAnnualD,
      orderCost: item.orderCost,
      unitCost: item.unitCost,
      holdingRate: item.holdingRate,
    });
    const ropRes = rop({
      annualDemand: itemAnnualD,
      leadTimeDays: effLt,
      serviceLevel: effSl,
      history: scaledItemHist,
    });
    const varFallbackScale = ropRes.sigmaFallback ? p.demandVariabilityMult : 1;
    const effSs = Math.max(0, ropRes.safetyStock * varFallbackScale * p.safetyStockMult);
    const dBar = itemAnnualD / 365;
    const effRop = dBar * effLt + effSs;
    const achievedSl =
      Number.isFinite(ropRes.z) && ropRes.z > 0
        ? Math.min(99.95, Math.max(50, normCdf(ropRes.z * p.safetyStockMult) * 100))
        : effSl;

    let lotQty = Math.max(1, eoqRes.Q);
    if (p.reorderPolicy === 'l4l') lotQty = Math.max(1, dBar * 7);
    else if (p.reorderPolicy === 'poq') lotQty = Math.max(1, dBar * 14);

    const cycleHolding = (lotQty / 2) * H;
    const ssHolding = effSs * H;
    const orderFreq = lotQty > 0 ? itemAnnualD / lotQty : 0;
    const ordCostYr = orderFreq * item.orderCost;

    holdingCostAnnual += cycleHolding + ssHolding;
    orderingCostAnnual += ordCostYr;
    totalSafetyStockUnits += effSs;
    ropSum += effRop;

    const usageWeight = Math.max(1, itemAnnualD * item.unitCost);
    weightedServiceSum += achievedSl * usageWeight;
    totalDailyUsageWeighted += usageWeight;

    if (item.stock < effRop) exposedSkus++;

    scenMrpOverrides.set(item.id, { effLt, effSs, eoqQty: lotQty });

    const bomEntry = bomComps.find((c) => c.comp.id === item.id);
    if (bomEntry) {
      scenMaterials.push({
        sku: item.sku,
        name: item.name,
        unit: item.unit,
        initialStock: item.stock,
        qtyPerJob: bomEntry.line.qtyPer,
        rop: Math.max(1, Math.round(effRop)),
        orderQty: Math.max(1, Math.round(lotQty)),
        leadTimeDays: effLt,
        unitCost: item.unitCost,
      });
    }
  }

  const totalInventoryCostAnnual = holdingCostAnnual + orderingCostAnnual;
  const serviceLevelPct = totalDailyUsageWeighted > 0 ? weightedServiceSum / totalDailyUsageWeighted : p.targetServiceLevelPct;

  /* --- 3. Time-Phased MRP (mrp.ts) --- */
  const mrpLotRule: LotRule =
    p.reorderPolicy === 'l4l' ? 'l4l' : p.reorderPolicy === 'poq' ? 'poq' : 'eoq';

  const mrpItems: Record<string, MrpItemInput> = {};
  for (const prod of products) {
    const ov = scenMrpOverrides.get(prod.id);
    mrpItems[prod.id] = {
      id: prod.id,
      sku: prod.sku,
      name: prod.name,
      unit: prod.unit,
      bom: prod.bom.map((b) => ({ componentId: b.componentId, qtyPer: b.qtyPer })),
      onHand: prod.stock,
      safetyStock: ov ? ov.effSs : 0,
      leadTimeDays: ov ? ov.effLt : Math.max(0.5, prod.leadTime * p.supplierLeadTimeMult),
      lotRule: mrpLotRule,
      eoqQty: ov ? ov.eoqQty : Math.max(1, Math.round(prod.annualDemand / 12)),
      scrapPct: prod.id === assembly.id ? p.scrapRatePct : Math.min(15, p.scrapRatePct * 0.25),
      yieldPct: 100,
    };
  }

  const mrpRes: MrpPlanResult = mrpPlan({
    rootId: assembly.id,
    planQuantity: p.productionBatchQty,
    needInDays: 14,
    items: mrpItems,
    horizonDays: 60,
    bucketSizeDays: 7,
    lotRule: mrpLotRule,
  });

  const replenishmentQtyTotal = mrpRes.plannedOrderReleases.reduce((s, r) => s + r.quantity, 0);
  const replenishmentCostEstimate = mrpRes.plannedOrderReleases.reduce((s, r) => {
    const prod = prodById.get(r.componentId);
    return s + r.quantity * (prod?.unitCost ?? 0);
  }, 0);

  /* --- 4. Line Balancing & Workstation Configuration (linebal.ts + factorySim.ts) --- */
  const baseLb = ws.lineBalance;
  const effectiveCycleTime = Math.max(1, (baseLb.cycleTime || 10) * p.machineCycleMult);
  const tasksInput: LineBalTaskInput[] = baseLb.tasks.length
    ? baseLb.tasks
    : [
        { id: 'T1', name: 'Prep', time: 4, successors: ['T2'] },
        { id: 'T2', name: 'Assemble', time: 5, successors: ['T3'] },
        { id: 'T3', name: 'Test', time: 3, successors: [] },
      ];

  const lbCmp = compareAlgorithms({
    tasks: tasksInput,
    cycleTime: effectiveCycleTime,
    algorithms: ['rpw', 'lcr', 'kw', 'comsoal', 'exact'],
    exactMaxTimeMs: 350,
  });
  const algoKey = baseLb.selectedAlgo === 'comsail' ? 'comsoal' : baseLb.selectedAlgo || 'exact';
  const lbSol = lbCmp.algorithms[algoKey] || lbCmp.best || Object.values(lbCmp.algorithms)[0] || null;
  const baseStations = stationsFromLineBalanceForFactory(lbSol);

  // Scale station processing times if LB hit max task ceiling vs cycle mult
  const lbCycleScale = lbSol && lbSol.valid ? 1 : p.machineCycleMult;

  // Identify nominal bottleneck before adding extra machines
  let bnBaseIdx = 0;
  for (let i = 1; i < baseStations.length; i++) {
    if (baseStations[i].meanTimeMin / baseStations[i].machineCount > baseStations[bnBaseIdx].meanTimeMin / baseStations[bnBaseIdx].machineCount) {
      bnBaseIdx = i;
    }
  }

  const operatorsRequired = baseStations.reduce((s, st, i) => {
    const mCnt = st.machineCount + (i === bnBaseIdx ? p.extraBottleneckMachines : 0);
    return s + mCnt * st.operatorsPerMachine;
  }, 0);
  const workforceStaffingRatio = Math.min(1, Math.max(0.25, p.operatorsAvailable / Math.max(1, operatorsRequired)));

  const baseSimCfg = ws.factorySimConfig;
  const desStations: DesStationSpec[] = baseStations.map((st, i) => {
    const mCount = st.machineCount + (i === bnBaseIdx ? p.extraBottleneckMachines : 0);
    const meanTime = Math.max(0.25, (st.meanTimeMin * lbCycleScale) / workforceStaffingRatio);
    const effMtbf = st.mtbfMin > 0 ? st.mtbfMin / p.breakdownFreqMult : 0;
    return {
      id: st.id,
      name: st.name,
      machineCount: mCount,
      bufferCapacity: Math.max(1, p.bufferCapacity),
      processDist: {
        kind: baseSimCfg.serviceDist === 'constant' ? 'constant' : baseSimCfg.serviceDist,
        mean: meanTime,
        cv: Math.max(0, st.cv * (0.85 + 0.15 * p.demandVariabilityMult)),
      },
      setupTimeMin: st.setupTimeMin,
      setupOnSkuChangeOnly: false,
      queueDiscipline: 'edd',
      mtbfMin: effMtbf,
      failureDistKind: 'weibull',
      failureWeibullShape: 1.6,
      mttrMin: st.mttrMin,
      repairDistKind: 'lognormal',
      repairCv: 0.35,
      pmIntervalMin: st.pmIntervalMin,
      pmDurationMin: st.pmDurationMin,
      hourlyMachineCost: st.hourlyMachineCost,
      operatorsPerMachine: st.operatorsPerMachine,
    };
  });

  /* --- 5. Discrete-Event Simulation (desEngine.ts) --- */
  const rawHourlyDemand = monthlyForecast / (22 * p.shiftsPerDay * p.shiftHours);
  const nominalTaktRate = (60 / Math.max(1, effectiveCycleTime)) * 0.85 * p.demandVolumeMult;
  const arrivalRatePerHour = Number((rawHourlyDemand >= 0.9 ? rawHourlyDemand : Math.max(1.2, nominalTaktRate)).toFixed(2));
  const arrivalCv = Math.max(0.05, Math.min(1.8, (baseSimCfg.arrivalCv || 0.45) * p.demandVariabilityMult));

  const defectProb = Math.max(0, Math.min(0.4, p.scrapRatePct / 100));
  const reworkIdx = Math.max(0, Math.min(desStations.length - 1, Math.floor(desStations.length / 2)));

  const desSteps: DesRouteStep[] = desStations.map((st, idx) => ({
    stationId: st.id,
    cycleTimeMult: 1.0,
    ...(idx === desStations.length - 1
      ? {
          scrapRate: defectProb * 0.3,
          reworkProb: defectProb * 0.7,
          reworkToStepIdx: reworkIdx,
          maxRework: 2,
        }
      : {}),
  }));

  const hoursPerDay = Math.max(1, p.shiftsPerDay * p.shiftHours);
  const desCfg: DesConfig = {
    name: scenario.name,
    horizonHours: p.horizonHours,
    warmupHours: Math.min(p.horizonHours * 0.2, 2),
    calendar: {
      shiftsPerDay: p.shiftsPerDay,
      shiftHours: p.shiftHours,
      interShiftGapMin: 15,
      workingDaysPerWeek: 7,
    },
    replications: p.replications,
    seed: p.seed,
    laborRatePerHour: baseSimCfg.laborRatePerHour,
    wipHoldingCostPerJobHour: baseSimCfg.wipHoldingCostPerJobHour,
    stations: desStations,
    routes: [
      {
        id: `RT-${assembly.sku}`,
        sku: assembly.sku,
        name: assembly.name,
        steps: desSteps,
        materialsPerJob: scenMaterials.map((m) => ({ materialSku: m.sku, qtyPerJob: m.qtyPerJob })),
      },
    ],
    orders: [
      {
        id: 'PO-SCEN-BATCH',
        sku: assembly.sku,
        routeId: `RT-${assembly.sku}`,
        qty: p.productionBatchQty,
        releaseAtMin: 0,
        dueAtMin: p.horizonHours * 45,
        priority: 1,
      },
    ],
    openArrivals: {
      ratePerHour: arrivalRatePerHour,
      cv: arrivalCv,
      clockMode: 'working',
    },
    materials: scenMaterials.map((m) => ({
      sku: m.sku,
      name: m.name,
      unit: m.unit,
      initialStock: m.initialStock,
      rop: m.rop,
      orderQty: m.orderQty,
      leadTimeMin: Math.max(30, m.leadTimeDays * hoursPerDay * 60),
      unitCost: m.unitCost,
    })),
  };

  const desRes = runDiscreteEventSimulation(desCfg);

  /* --- 6. Performance Analysis & Confidence Scoring --- */
  const uncoveredLtSkus = scopeItems.filter((item) => {
    const isAssembly = item.id === assembly.id;
    const itemAnnualD = isAssembly ? annualForecast : item.annualDemand * p.demandVolumeMult;
    const effLt = Math.max(0.5, item.leadTime * p.supplierLeadTimeMult);
    return item.stock < (itemAnnualD / 365) * effLt;
  }).length;
  const steadyStateRiskPct = Math.min(50, Math.max(0, (100 - serviceLevelPct) * 1.4));
  const ltDeficitRiskPct = (uncoveredLtSkus / Math.max(1, scopeItems.length)) * 30;
  const lateMrpRiskPct = Math.min(20, mrpRes.lateOrderWarnings.length * 6);
  const simStarveHours = desRes.materials.reduce((s, m) => s + m.starvedMinutes / 60, 0);
  const simStarveRiskPct = Math.min(25, (simStarveHours / Math.max(1, desRes.observedScheduledHours)) * 40);
  const shortageRiskPct = Math.min(100, steadyStateRiskPct + ltDeficitRiskPct + lateMrpRiskPct + simStarveRiskPct);

  const avgDowntimePct =
    desRes.stations.length > 0
      ? desRes.stations.reduce((s, st) => s + st.downPct + st.pmPct, 0) / desRes.stations.length
      : 0;
  const totalDowntimeHours = desRes.totalDowntimeMin / 60;

  const operatingCostPerUnit = desRes.costPerGoodUnit;
  const totalPeriodOperatingCost = operatingCostPerUnit * desRes.totalThroughputGood;

  const kpis: ScenarioKpis = {
    totalInventoryCostAnnual: Number(totalInventoryCostAnnual.toFixed(2)),
    serviceLevelPct: Number(serviceLevelPct.toFixed(2)),
    shortageRiskPct: Number(shortageRiskPct.toFixed(1)),
    replenishmentQtyTotal: Number(replenishmentQtyTotal.toFixed(1)),
    plannedOrdersCount: mrpRes.plannedOrderReleases.length,
    throughputPerHour: Number(desRes.throughputPerScheduledHour.mean.toFixed(2)),
    avgCycleTimeMin: Number(desRes.avgCycleTimeMin.mean.toFixed(2)),
    avgWip: Number(desRes.avgWip.mean.toFixed(2)),
    machineUtilizationPct: Number(desRes.assetUtilizationPct.toFixed(1)),
    downtimePct: Number(avgDowntimePct.toFixed(1)),
    downtimeHours: Number(totalDowntimeHours.toFixed(2)),
    oeePct: Number(desRes.oeePct.toFixed(1)),
    oeeAvailabilityPct: Number(desRes.oeeAvailabilityPct.toFixed(1)),
    oeePerformancePct: Number(desRes.oeePerformancePct.toFixed(1)),
    oeeQualityPct: Number(desRes.oeeQualityPct.toFixed(1)),
    productionCompletionPct: Number(desRes.completionRatePct.toFixed(1)),
    onTimeDeliveryPct: Number(desRes.onTimeDeliveryPct.toFixed(1)),
    operatingCostPerUnit: Number(operatingCostPerUnit.toFixed(2)),
    totalPeriodOperatingCost: Number(totalPeriodOperatingCost.toFixed(2)),
  };

  // Empirical Confidence Score from Forecast Fit + DES CI Precision
  const tpMean = Math.max(1e-4, desRes.throughputPerScheduledHour.mean);
  const ciHalf = (desRes.throughputPerScheduledHour.ci95High - desRes.throughputPerScheduledHour.ci95Low) / 2;
  const throughputCiHalfPct = Math.min(100, (ciHalf / tpMean) * 100);
  const forecastFitPct = backtestMapePct != null ? Math.max(40, Math.min(99, 100 - backtestMapePct)) : 75;
  const ciStabilityScore = Math.max(40, Math.min(100, 100 - throughputCiHalfPct * 2.5));
  const repBonus = Math.min(10, p.replications);
  const confScore = Math.max(30, Math.min(98, 0.45 * forecastFitPct + 0.45 * ciStabilityScore + repBonus));
  const confLevel: 'High' | 'Moderate' | 'Low' = confScore >= 80 ? 'High' : confScore >= 60 ? 'Moderate' : 'Low';

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    provenance: 'SCENARIO_SIMULATION_MODEL',
    provenanceNotice:
      'Integrated multi-engine scenario projection (Forecast -> EOQ/ROP -> MRP -> Line Balance -> DES). Simulated counterfactual; live workspace unchanged.',
    valid: desRes.valid,
    reason: desRes.reason,
    params: p,
    kpis,
    forecastSummary: {
      modelName: forecastModelName,
      monthlyForecast: Number(monthlyForecast.toFixed(1)),
      annualForecast: Number(annualForecast.toFixed(1)),
      backtestMapePct: backtestMapePct != null ? Number(backtestMapePct.toFixed(1)) : null,
      arrivalRatePerHour,
      arrivalCv: Number(arrivalCv.toFixed(2)),
    },
    inventorySummary: {
      skuCountInScope: scopeItems.length,
      holdingCostAnnual: Number(holdingCostAnnual.toFixed(2)),
      orderingCostAnnual: Number(orderingCostAnnual.toFixed(2)),
      safetyStockUnits: Number(totalSafetyStockUnits.toFixed(1)),
      avgRopUnits: Number((ropSum / Math.max(1, scopeItems.length)).toFixed(1)),
      exposedSkusCount: exposedSkus,
    },
    mrpSummary: {
      shortageCount: mrpRes.shortageAlerts.length,
      lateOrdersCount: mrpRes.lateOrderWarnings.length,
      plannedOrdersCount: mrpRes.plannedOrderReleases.length,
      replenishmentCostEstimate: Number(replenishmentCostEstimate.toFixed(2)),
      criticalComponents: mrpRes.criticalComponents.slice(0, 4).map((c) => c.componentName),
    },
    lineBalanceSummary: {
      algorithm: lbSol?.label || 'Heuristic',
      effectiveCycleTimeMin: Number(effectiveCycleTime.toFixed(2)),
      stationCount: desStations.length,
      lineEfficiencyPct: Number((lbSol?.efficiency ?? 80).toFixed(1)),
      smoothnessIndex: Number((lbSol?.smoothnessIndex ?? 0).toFixed(2)),
      operatorsRequired,
      workforceStaffingRatio: Number(workforceStaffingRatio.toFixed(2)),
    },
    desResult: desRes,
    confidence: {
      level: confLevel,
      scorePct: Number(confScore.toFixed(0)),
      throughputCiHalfPct: Number(throughputCiHalfPct.toFixed(1)),
      forecastFitPct: Number(forecastFitPct.toFixed(0)),
      summary: `${confLevel} (${confScore.toFixed(0)}/100) — DES 95% CI ±${throughputCiHalfPct.toFixed(1)}% over ${p.replications} reps; Forecast fit ${forecastFitPct.toFixed(0)}%`,
    },
  };
}

function buildInvalidScenarioEval(
  sc: ScenarioDefinition,
  p: ScenarioParams,
  reason: string
): ScenarioEvaluation {
  const emptyDes = runDiscreteEventSimulation({
    name: sc.name,
    horizonHours: 1,
    stations: [],
    routes: [],
  });
  return {
    scenarioId: sc.id,
    scenarioName: sc.name,
    provenance: 'SCENARIO_SIMULATION_MODEL',
    provenanceNotice: reason,
    valid: false,
    reason,
    params: p,
    kpis: {
      totalInventoryCostAnnual: 0,
      serviceLevelPct: 0,
      shortageRiskPct: 0,
      replenishmentQtyTotal: 0,
      plannedOrdersCount: 0,
      throughputPerHour: 0,
      avgCycleTimeMin: 0,
      avgWip: 0,
      machineUtilizationPct: 0,
      downtimePct: 0,
      downtimeHours: 0,
      oeePct: 0,
      oeeAvailabilityPct: 0,
      oeePerformancePct: 0,
      oeeQualityPct: 0,
      productionCompletionPct: 0,
      onTimeDeliveryPct: 0,
      operatingCostPerUnit: 0,
      totalPeriodOperatingCost: 0,
    },
    forecastSummary: { modelName: 'N/A', monthlyForecast: 0, annualForecast: 0, backtestMapePct: null, arrivalRatePerHour: 0, arrivalCv: 0 },
    inventorySummary: { skuCountInScope: 0, holdingCostAnnual: 0, orderingCostAnnual: 0, safetyStockUnits: 0, avgRopUnits: 0, exposedSkusCount: 0 },
    mrpSummary: { shortageCount: 0, lateOrdersCount: 0, plannedOrdersCount: 0, replenishmentCostEstimate: 0, criticalComponents: [] },
    lineBalanceSummary: { algorithm: 'N/A', effectiveCycleTimeMin: 0, stationCount: 0, lineEfficiencyPct: 0, smoothnessIndex: 0, operatorsRequired: 0, workforceStaffingRatio: 1 },
    desResult: emptyDes,
    confidence: { level: 'Low', scorePct: 0, throughputCiHalfPct: 0, forecastFitPct: 0, summary: reason },
  };
}

/* -------------------------------------------------------------------------- */
/*  Baseline vs. Scenario Delta & Full Explainability Generator               */
/* -------------------------------------------------------------------------- */

const KPI_META: Array<{
  key: keyof ScenarioKpis;
  label: string;
  unit: string;
  betterWhen: 'higher' | 'lower';
  relThresholdPct: number;
}> = [
  { key: 'totalInventoryCostAnnual', label: 'Total Inventory Policy Cost', unit: '$/yr', betterWhen: 'lower', relThresholdPct: 0.5 },
  { key: 'serviceLevelPct', label: 'Weighted Service Level', unit: '%', betterWhen: 'higher', relThresholdPct: 0.3 },
  { key: 'shortageRiskPct', label: 'Composite Shortage Risk', unit: '%', betterWhen: 'lower', relThresholdPct: 1.0 },
  { key: 'replenishmentQtyTotal', label: 'MRP Replenishment Volume', unit: 'units', betterWhen: 'lower', relThresholdPct: 0.5 },
  { key: 'throughputPerHour', label: 'Production Throughput', unit: 'jobs/hr', betterWhen: 'higher', relThresholdPct: 1.0 },
  { key: 'avgCycleTimeMin', label: 'Average Floor Cycle Time', unit: 'min', betterWhen: 'lower', relThresholdPct: 1.5 },
  { key: 'avgWip', label: 'Work-In-Process (WIP)', unit: 'jobs', betterWhen: 'lower', relThresholdPct: 1.5 },
  { key: 'machineUtilizationPct', label: 'Asset Machine Utilization', unit: '%', betterWhen: 'higher', relThresholdPct: 1.0 },
  { key: 'downtimePct', label: 'Breakdown & PM Downtime', unit: '%', betterWhen: 'lower', relThresholdPct: 1.0 },
  { key: 'oeePct', label: 'Line OEE (A × P × Q)', unit: '%', betterWhen: 'higher', relThresholdPct: 0.8 },
  { key: 'productionCompletionPct', label: 'Production Completion Rate', unit: '%', betterWhen: 'higher', relThresholdPct: 1.0 },
  { key: 'operatingCostPerUnit', label: 'Operating Cost / Good Unit', unit: '$/unit', betterWhen: 'lower', relThresholdPct: 0.8 },
];

export function compareScenarioToBaseline(
  baseline: ScenarioEvaluation,
  scenario: ScenarioEvaluation
): ScenarioComparison {
  const deltas: KpiDelta[] = KPI_META.map((meta) => {
    const b = baseline.kpis[meta.key];
    const s = scenario.kpis[meta.key];
    const delta = s - b;
    const denom = Math.abs(b) > 1e-6 ? Math.abs(b) : 1;
    const deltaPct = (delta / denom) * 100;
    let status: KpiDelta['status'] = 'neutral';
    if (Math.abs(deltaPct) >= meta.relThresholdPct && Math.abs(delta) > 1e-4) {
      const good = meta.betterWhen === 'higher' ? delta > 0 : delta < 0;
      status = good ? 'improved' : 'deteriorated';
    }
    return {
      key: meta.key,
      label: meta.label,
      unit: meta.unit,
      baseline: b,
      scenario: s,
      delta,
      deltaPct,
      betterWhen: meta.betterWhen,
      status,
    };
  });

  // 1. What changed
  const bp = baseline.params;
  const sp = scenario.params;
  const whatChanged: string[] = [];
  if (Math.abs(sp.demandVolumeMult - bp.demandVolumeMult) > 0.01) {
    whatChanged.push(`Demand volume ×${sp.demandVolumeMult.toFixed(2)} vs ×${bp.demandVolumeMult.toFixed(2)}`);
  }
  if (Math.abs(sp.demandVariabilityMult - bp.demandVariabilityMult) > 0.01) {
    whatChanged.push(`Demand variability ×${sp.demandVariabilityMult.toFixed(2)} vs ×${bp.demandVariabilityMult.toFixed(2)}`);
  }
  if (Math.abs(sp.supplierLeadTimeMult - bp.supplierLeadTimeMult) > 0.01) {
    whatChanged.push(`Supplier lead times ×${sp.supplierLeadTimeMult.toFixed(2)}`);
  }
  if (Math.abs(sp.safetyStockMult - bp.safetyStockMult) > 0.01) {
    whatChanged.push(`Safety stock multiplier ×${sp.safetyStockMult.toFixed(2)}`);
  }
  if (sp.reorderPolicy !== bp.reorderPolicy || Math.abs(sp.targetServiceLevelPct - bp.targetServiceLevelPct) > 0.1) {
    whatChanged.push(`Reorder policy: ${sp.reorderPolicy.toUpperCase()} (target SL ${sp.targetServiceLevelPct}%)`);
  }
  if (sp.productionBatchQty !== bp.productionBatchQty) {
    whatChanged.push(`Production batch qty: ${bp.productionBatchQty} → ${sp.productionBatchQty} units`);
  }
  if (Math.abs(sp.machineCycleMult - bp.machineCycleMult) > 0.01) {
    whatChanged.push(`Machine cycle factor ×${sp.machineCycleMult.toFixed(2)}`);
  }
  if (Math.abs(sp.breakdownFreqMult - bp.breakdownFreqMult) > 0.01) {
    whatChanged.push(`Breakdown frequency ×${sp.breakdownFreqMult.toFixed(2)} (MTBF scaled inversely)`);
  }
  if (sp.extraBottleneckMachines !== bp.extraBottleneckMachines) {
    whatChanged.push(`+${sp.extraBottleneckMachines} parallel bottleneck machine(s)`);
  }
  if (sp.operatorsAvailable !== bp.operatorsAvailable) {
    whatChanged.push(`Operators on shift: ${bp.operatorsAvailable} → ${sp.operatorsAvailable}`);
  }
  if (sp.shiftHours !== bp.shiftHours || sp.shiftsPerDay !== bp.shiftsPerDay) {
    whatChanged.push(`Shift schedule: ${sp.shiftsPerDay}×${sp.shiftHours}h/day`);
  }
  if (Math.abs(sp.scrapRatePct - bp.scrapRatePct) > 0.05) {
    whatChanged.push(`Scrap/defect rate: ${bp.scrapRatePct}% → ${sp.scrapRatePct}%`);
  }
  if (sp.bufferCapacity !== bp.bufferCapacity) {
    whatChanged.push(`Inter-station buffer capacity: ${bp.bufferCapacity} → ${sp.bufferCapacity}`);
  }
  if (!whatChanged.length) {
    whatChanged.push('No parameter modifications from live baseline (re-verified at current settings).');
  }

  // 2. Models used
  const modelsUsed = [
    `Demand Forecasting: ${scenario.forecastSummary.modelName} (MAPE ${scenario.forecastSummary.backtestMapePct ?? 'N/A'}%)`,
    `Inventory Optimization: Wilson EOQ & Normal ROP / Safety Stock across ${scenario.inventorySummary.skuCountInScope} SKUs`,
    `MRP Explosion: Multi-level net-requirement planner (${sp.reorderPolicy.toUpperCase()}, 60d weekly buckets)`,
    `Line Balancing: ${scenario.lineBalanceSummary.algorithm} (${scenario.lineBalanceSummary.stationCount} stations @ C=${scenario.lineBalanceSummary.effectiveCycleTimeMin}m)`,
    `DES Engine: MinHeap Priority-Queue (${sp.replications} reps × ${sp.horizonHours}h, Seed #${sp.seed})`,
  ];

  // 3. Assumptions
  const assumptions = [
    `Stochastic arrivals scale with ${sp.shiftsPerDay}×${sp.shiftHours}h active shifts (${scenario.forecastSummary.arrivalRatePerHour} jobs/hr, CV ${scenario.forecastSummary.arrivalCv}).`,
    `Workforce constraint factor applied when available operators (${sp.operatorsAvailable}) < required (${scenario.lineBalanceSummary.operatorsRequired}); current staffing ratio = ${(scenario.lineBalanceSummary.workforceStaffingRatio * 100).toFixed(0)}%.`,
    `Inventory stock-out risk combines EOQ/ROP safety-stock deficits, MRP 60-day planned shortages, and DES BOM starvation hours.`,
    `Operating cost includes labor, machine overhead, BOM unit costs, and WIP holding over ${scenario.desResult.observedScheduledHours}h scheduled time.`,
  ];

  // 4 & 5. What improved / What deteriorated
  const whatImproved = deltas
    .filter((d) => d.status === 'improved')
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 5)
    .map((d) => `${d.label}: ${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(1)} ${d.unit} (${d.deltaPct >= 0 ? '+' : ''}${d.deltaPct.toFixed(1)}%)`);

  const whatDeteriorated = deltas
    .filter((d) => d.status === 'deteriorated')
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 5)
    .map((d) => `${d.label}: ${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(1)} ${d.unit} (${d.deltaPct >= 0 ? '+' : ''}${d.deltaPct.toFixed(1)}%)`);

  // 6. Remaining constraints
  const remainingConstraints: string[] = [];
  remainingConstraints.push(
    `Pacing bottleneck remains ${scenario.desResult.bottleneckName} (${scenario.desResult.bottleneckWorkloadPct.toFixed(1)}% busy/setup workload).`
  );
  if (scenario.lineBalanceSummary.workforceStaffingRatio < 0.99) {
    remainingConstraints.push(
      `Operator staffing shortfall (${sp.operatorsAvailable}/${scenario.lineBalanceSummary.operatorsRequired}) scales active cycle times by ${(1 / scenario.lineBalanceSummary.workforceStaffingRatio).toFixed(2)}×.`
    );
  }
  if (scenario.mrpSummary.shortageCount > 0) {
    remainingConstraints.push(
      `MRP flags ${scenario.mrpSummary.shortageCount} net component shortage(s) & ${scenario.mrpSummary.lateOrdersCount} past-due order release(s) (${scenario.mrpSummary.criticalComponents.join(', ') || 'check BOM'}).`
    );
  }
  const matBottleneck = scenario.desResult.materials.find((m) => m.stockoutOccurred);
  if (matBottleneck) {
    remainingConstraints.push(
      `BOM component ${matBottleneck.sku} hits stockout in DES (${matBottleneck.starvedMinutes.toFixed(0)} min wait).`
    );
  }

  const netImp = whatImproved.length - whatDeteriorated.length;
  const recommendationHeadline =
    netImp > 0
      ? `Net favorable strategy (${whatImproved.length} metrics improved vs ${whatDeteriorated.length} trade-offs).`
      : whatImproved.length === 0 && whatDeteriorated.length === 0
        ? 'Neutral operational impact relative to baseline.'
        : `Trade-off heavy strategy (${whatDeteriorated.length} regressions vs ${whatImproved.length} gains) — inspect constraints before applying.`;

  return {
    baseline,
    scenario,
    deltas,
    explanation: {
      whatChanged,
      modelsUsed,
      assumptions,
      whatImproved: whatImproved.length ? whatImproved : ['No statistically significant improvement over baseline.'],
      whatDeteriorated: whatDeteriorated.length ? whatDeteriorated : ['No material KPI degradation detected.'],
      remainingConstraints,
      confidenceStatement: scenario.confidence.summary,
      recommendationHeadline,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Cross-Module Sensitivity Matrix                                           */
/* -------------------------------------------------------------------------- */

export function runScenarioSensitivity(
  baseScenario: ScenarioDefinition,
  ws: ScenarioWorkspaceInput
): ScenarioSensitivityRow[] {
  const baseEval = evaluateScenario(baseScenario, ws);
  if (!baseEval.valid) return [];

  const cases: Array<{ id: string; label: string; parameterChanged: string; patch: Partial<ScenarioParams> }> = [
    { id: 'sens-dem-up', label: 'Demand Surge (+25%)', parameterChanged: 'demandVolumeMult ×1.25', patch: { demandVolumeMult: Number((baseEval.params.demandVolumeMult * 1.25).toFixed(2)) } },
    { id: 'sens-ss-up', label: 'Safety Buffer (+35%)', parameterChanged: 'safetyStockMult ×1.35', patch: { safetyStockMult: Number((baseEval.params.safetyStockMult * 1.35).toFixed(2)) } },
    { id: 'sens-bn-mach', label: '+1 Bottleneck Machine', parameterChanged: 'extraBottleneckMachines +1', patch: { extraBottleneckMachines: baseEval.params.extraBottleneckMachines + 1, operatorsAvailable: baseEval.params.operatorsAvailable + 1 } },
    { id: 'sens-cyc-fast', label: 'SMED / Cycle -15%', parameterChanged: 'machineCycleMult ×0.85', patch: { machineCycleMult: Number((baseEval.params.machineCycleMult * 0.85).toFixed(2)) } },
    { id: 'sens-rel-good', label: 'Reliability 2× MTBF', parameterChanged: 'breakdownFreqMult ×0.50', patch: { breakdownFreqMult: Number((baseEval.params.breakdownFreqMult * 0.5).toFixed(2)) } },
    { id: 'sens-buf-2x', label: 'Double Inter-Station Buffer', parameterChanged: 'bufferCapacity ×2', patch: { bufferCapacity: Math.min(40, baseEval.params.bufferCapacity * 2) } },
  ];

  const pct = (cur: number, base: number) => ((cur - base) / Math.max(1e-6, Math.abs(base))) * 100;

  return cases.map((c) => {
    const ev = evaluateScenario(
      {
        ...baseScenario,
        id: c.id,
        name: c.label,
        params: { ...baseEval.params, ...c.patch },
      },
      ws
    );
    return {
      id: c.id,
      label: c.label,
      parameterChanged: c.parameterChanged,
      throughputDeltaPct: Number(pct(ev.kpis.throughputPerHour, baseEval.kpis.throughputPerHour).toFixed(1)),
      inventoryCostDeltaPct: Number(pct(ev.kpis.totalInventoryCostAnnual, baseEval.kpis.totalInventoryCostAnnual).toFixed(1)),
      oeeDeltaPts: Number((ev.kpis.oeePct - baseEval.kpis.oeePct).toFixed(1)),
      shortageRiskDeltaPts: Number((ev.kpis.shortageRiskPct - baseEval.kpis.shortageRiskPct).toFixed(1)),
      operatingCostDeltaPct: Number(pct(ev.kpis.operatingCostPerUnit, baseEval.kpis.operatingCostPerUnit).toFixed(1)),
      bottleneckName: ev.desResult.bottleneckName,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Safe Export / Import & Explicit Apply Preview                             */
/* -------------------------------------------------------------------------- */

export function exportScenarioPackageJSON(scenarios: ReadonlyArray<ScenarioDefinition>): string {
  return JSON.stringify(
    {
      app: 'FactoryMind Scenario Studio',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      scenarios,
    },
    null,
    2
  );
}

export function importScenarioPackageJSON(text: string, fallbackAssembly = 'ASM-PA100'): ScenarioDefinition[] {
  if (typeof text !== 'string' || text.length > 2_000_000) {
    throw new Error('Scenario package exceeds 2 MB limit or is empty.');
  }
  const parsed = JSON.parse(text, (key, val) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    return val;
  }) as { scenarios?: unknown[] };

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.scenarios)) {
    throw new Error('Invalid scenario JSON package: missing scenarios[] array.');
  }

  return parsed.scenarios.slice(0, 30).map((raw, idx) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Partial<ScenarioDefinition>;
    return {
      id: String(item.id || `sc-imp-${Date.now()}-${idx}`).slice(0, 64),
      name: String(item.name || `Imported Scenario ${idx + 1}`).trim().slice(0, 100),
      notes: String(item.notes || '').trim().slice(0, 400),
      createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now(),
      isBaseline: false,
      params: sanitizeScenarioParams(item.params, fallbackAssembly),
    };
  });
}

export function buildWorkspaceApplyPreview(
  scenario: ScenarioDefinition,
  ws: ScenarioWorkspaceInput
): ScenarioApplyPreview {
  const p = sanitizeScenarioParams(scenario.params, ws.factorySimConfig.assemblySku);
  const f = ws.factorySimConfig;
  const changes: ScenarioApplyPreview['changes'] = [];

  changes.push({
    target: 'Factory Simulation Lab',
    field: 'Target assembly & shifts',
    currentValue: `${f.assemblySku} · ${f.shiftsPerDay}×${f.shiftHours}h`,
    nextValue: `${p.assemblySku} · ${p.shiftsPerDay}×${p.shiftHours}h`,
  });
  changes.push({
    target: 'Factory Simulation Lab',
    field: 'Operators & Buffer Capacity',
    currentValue: `${f.operatorsAvailable} ops · buf ${f.stations[0]?.bufferCapacity ?? 6}`,
    nextValue: `${p.operatorsAvailable} ops · buf ${p.bufferCapacity} (+${p.extraBottleneckMachines} bn machine)`,
  });
  changes.push({
    target: 'Line Balancing',
    field: 'Takt Cycle Time',
    currentValue: `${ws.lineBalance.cycleTime} min`,
    nextValue: `${(ws.lineBalance.cycleTime * p.machineCycleMult).toFixed(1)} min`,
  });
  changes.push({
    target: 'Inventory / BOM Policy',
    field: `${p.assemblySku} Target SL & Lead Time Multiplier`,
    currentValue: `1.00× LT · existing SL`,
    nextValue: `${p.supplierLeadTimeMult.toFixed(2)}× LT · ${p.targetServiceLevelPct}% SL (${p.reorderPolicy.toUpperCase()})`,
  });

  return {
    scenarioName: scenario.name,
    assemblySku: p.assemblySku,
    changes,
  };
}
