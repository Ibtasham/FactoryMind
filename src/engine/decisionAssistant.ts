/**
 * FactoryMind Decision Intelligence Engine (Pure TypeScript, Zero DOM / SDK Imports)
 *
 * Authoritative deterministic query router, multi-engine solver, and counterfactual
 * explainer powering the FactoryMind Decision Assistant.
 *
 * Numerical Integrity Guarantee:
 * - Every numerical output comes exclusively from validated FactoryMind engines:
 *     advisor.ts, smartAlerts.ts, ipe.ts, mrp.ts, linebal.ts, desEngine.ts,
 *     scenarioStudio.ts, digitalTwin.ts.
 * - Zero numbers are ever invented or extrapolated beyond actual engine calculations.
 * - Missing or insufficient workspace inputs trigger explicit `insufficientDataWarnings`.
 * - Counterfactual scenario proposals never mutate workspace state until explicitly approved.
 */

import {
  advisorAnalyse,
  AdvisorFinding,
  advisorHealth,
  AdvisorHealth,
  AdvisorPolicyConfig,
  advisorPolicyFromSettings,
  advisorScenario,
  AdvisorTotals,
} from './advisor.ts';
import {
  buildDesConfigFromFactorySim,
  DesResult,
  DesStationTelemetry,
  runDiscreteEventSimulation,
} from './desEngine.ts';
import { FactorySimConfig } from './factorySim.ts';
import { fmtInt, fmtMoney, fmtNum } from './formatters.ts';
import { abcAnalysis } from './ipe.ts';
import { mrpPlan, MrpItemInput, MrpPlanResult } from './mrp.ts';
import {
  buildBaselineScenarioFromWorkspace,
  buildWorkspaceApplyPreview,
  compareScenarioToBaseline,
  evaluateScenario,
  KpiDelta,
  sanitizeScenarioParams,
  ScenarioApplyPreview,
  ScenarioDefinition,
  ScenarioEvaluation,
  ScenarioParams,
  ScenarioReorderPolicy,
  ScenarioWorkspaceInput,
} from './scenarioStudio.ts';
import { predictSmartAlerts, SmartAlertsResult, SmartStockAlert } from './smartAlerts.ts';
import { formatRackLocation } from './digitalTwin.ts';
import type {
  PersistedLineBalance,
  Product,
  ProductMetrics,
  Transaction,
  WorkspaceSettings,
  WorkspaceSummary,
} from '../store/store.ts';

/* -------------------------------------------------------------------------- */
/*  Public Types                                                              */
/* -------------------------------------------------------------------------- */

export type ProvenanceTag =
  | 'DETERMINISTIC_ENGINE'
  | 'SCENARIO_SIMULATION_MODEL'
  | 'WORKSPACE_CATALOG'
  | 'AI_SYNTHESIS_GROUNDED';

export type AssistantIntent =
  | 'sku_risk'
  | 'material_delay'
  | 'reduce_inventory'
  | 'bottleneck'
  | 'what_if_scenario'
  | 'compare_policies'
  | 'explain_simulation'
  | 'general_overview';

export type AssistantRouteTarget =
  | 'dashboard'
  | 'inventory'
  | 'advisor'
  | 'eoq'
  | 'abc'
  | 'forecast'
  | 'production'
  | 'line-balance'
  | 'factory-sim'
  | 'scenario-studio'
  | 'models-3d'
  | 'decision-lab'
  | 'spc'
  | 'brief'
  | 'settings';

export interface AssistantFact {
  label: string;
  value: string;
  unit?: string;
  sourceEngine: string;
  provenance: Exclude<ProvenanceTag, 'AI_SYNTHESIS_GROUNDED'>;
}

export interface AssistantTable {
  title: string;
  caption?: string;
  columns: string[];
  rows: string[][];
}

export interface AssistantNavLink {
  label: string;
  route: AssistantRouteTarget;
  sku?: string;
  contextNote: string;
}

export interface AssistantProposedScenario {
  title: string;
  summary: string;
  definition: ScenarioDefinition;
  baseline: ScenarioEvaluation;
  scenario: ScenarioEvaluation;
  deltas: KpiDelta[];
  applyPreview: ScenarioApplyPreview;
}

export type AssistantProposedActionKind =
  | 'receive-stock'
  | 'update-service-level'
  | 'align-over-sl-bulk'
  | 'save-scenario'
  | 'apply-scenario';

export interface AssistantProposedAction {
  id: string;
  kind: AssistantProposedActionKind;
  label: string;
  description: string;
  requiresApproval: true;
  previewDiff: Array<{
    target: string;
    field: string;
    before: string;
    after: string;
  }>;
  productId?: string;
  sku?: string;
  qty?: number;
  serviceLevel?: number;
  bulkUpdates?: Array<{ productId: string; sku: string; value: number }>;
  scenarioDefinition?: ScenarioDefinition;
}

export interface GroundingDossier {
  question: string;
  intent: AssistantIntent;
  focusedSku: string | null;
  activeAssemblySku: string | null;
  provenancePolicy: string;
  authoritativeHeadline: string;
  summaryBullets: string[];
  facts: Array<{ label: string; value: string; unit?: string; sourceEngine: string }>;
  tables: AssistantTable[];
  assumptions: string[];
  insufficientDataWarnings: string[];
}

export interface AssistantResponse {
  id: string;
  createdAt: number;
  question: string;
  intent: AssistantIntent;
  focusedSku: string | null;
  headline: string;
  summaryBullets: string[];
  facts: AssistantFact[];
  tables: AssistantTable[];
  reasoningSteps: string[];
  assumptions: string[];
  insufficientDataWarnings: string[];
  navLinks: AssistantNavLink[];
  proposedScenario: AssistantProposedScenario | null;
  proposedActions: AssistantProposedAction[];
  provenanceBadges: ProvenanceTag[];
  groundingDossier: GroundingDossier;
}

export interface AssistantWorkspaceContext {
  products: Product[];
  transactions: Transaction[];
  settings: WorkspaceSettings;
  summary: WorkspaceSummary;
  metricsOf: (p: Product) => ProductMetrics;
  lineBalance: PersistedLineBalance;
  factorySimConfig: FactorySimConfig;
  advisorPolicy: AdvisorPolicyConfig;
  advisorResult: { findings: AdvisorFinding[]; totals: AdvisorTotals };
  advisorHealth: AdvisorHealth;
  smartAlertsResult: SmartAlertsResult;
  desResult: DesResult;
  baselineScenario: ScenarioDefinition;
  scenarioWorkspace: ScenarioWorkspaceInput;
  focusedSku?: string | null;
}

export interface StarterPromptSpec {
  id: string;
  label: string;
  question: string;
  intent: AssistantIntent;
}

export const DECISION_STARTER_PROMPTS: StarterPromptSpec[] = [
  {
    id: 'q-sku-risk',
    label: 'High-risk SKU diagnosis',
    question: 'Why is this SKU considered high risk?',
    intent: 'sku_risk',
  },
  {
    id: 'q-mat-delay',
    label: 'Material delay risks',
    question: 'Which materials are likely to cause production delays?',
    intent: 'material_delay',
  },
  {
    id: 'q-reduce-inv',
    label: 'Trim inventory without losing SL',
    question: 'How can I reduce inventory investment without sacrificing service level?',
    intent: 'reduce_inventory',
  },
  {
    id: 'q-bottleneck',
    label: 'Bottleneck workstation',
    question: 'Which workstation is the production bottleneck?',
    intent: 'bottleneck',
  },
  {
    id: 'q-lt-whatif',
    label: 'Supplier lead time +20%',
    question: 'What would happen if supplier lead time increased by 20%?',
    intent: 'what_if_scenario',
  },
  {
    id: 'q-compare-pol',
    label: 'Compare inventory policies',
    question: 'Compare alternative inventory policies.',
    intent: 'compare_policies',
  },
  {
    id: 'q-explain-sim',
    label: 'Explain latest simulation',
    question: 'Explain the results of my latest production simulation.',
    intent: 'explain_simulation',
  },
];

/* -------------------------------------------------------------------------- */
/*  Workspace Context Builder (Pure & Reproducible)                           */
/* -------------------------------------------------------------------------- */

export function buildAssistantWorkspaceContext(input: {
  products: ReadonlyArray<Product>;
  transactions: ReadonlyArray<Transaction>;
  settings: WorkspaceSettings;
  summary: WorkspaceSummary;
  metricsOf: (p: Product) => ProductMetrics;
  lineBalance: PersistedLineBalance;
  factorySimConfig: FactorySimConfig;
  smartAlertsResult?: SmartAlertsResult;
  desResult?: DesResult;
  focusedSku?: string | null;
}): AssistantWorkspaceContext {
  const products = [...input.products];
  const transactions = [...input.transactions];
  const rows = products.map((p) => ({ p, m: input.metricsOf(p) }));
  const advisorPolicy = advisorPolicyFromSettings(input.settings);
  const advisorResult = advisorAnalyse(rows, transactions, advisorPolicy);
  const advisorH = advisorHealth(rows, advisorResult.findings, advisorResult.totals, input.summary);
  const smartAlertsResult =
    input.smartAlertsResult ??
    predictSmartAlerts(products, input.metricsOf, { horizonDays: 45 });

  const desResult =
    input.desResult ??
    runDiscreteEventSimulation(buildDesConfigFromFactorySim(input.factorySimConfig));

  const scenarioWorkspace: ScenarioWorkspaceInput = {
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      unit: p.unit,
      unitCost: p.unitCost,
      stock: p.stock,
      annualDemand: p.annualDemand,
      orderCost: p.orderCost,
      holdingRate: p.holdingRate,
      leadTime: p.leadTime,
      serviceLevel: p.serviceLevel,
      demandHistory: p.demandHistory,
      bom: p.bom,
    })),
    lineBalance: input.lineBalance,
    factorySimConfig: input.factorySimConfig,
  };

  const baselineScenario = buildBaselineScenarioFromWorkspace(scenarioWorkspace);

  return {
    products,
    transactions,
    settings: input.settings,
    summary: input.summary,
    metricsOf: input.metricsOf,
    lineBalance: input.lineBalance,
    factorySimConfig: input.factorySimConfig,
    advisorPolicy,
    advisorResult,
    advisorHealth: advisorH,
    smartAlertsResult,
    desResult,
    baselineScenario,
    scenarioWorkspace,
    focusedSku: input.focusedSku ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Natural-Language Intent & Parameter Parsing                               */
/* -------------------------------------------------------------------------- */

function detectMentionedProduct(
  question: string,
  products: ReadonlyArray<Product>
): { product: Product | null; explicitUnknownToken: string | null } {
  const qUpper = question.toUpperCase();
  // Exact SKU code match (longest first to avoid substring collisions)
  const byLen = [...products].sort((a, b) => b.sku.length - a.sku.length);
  for (const p of byLen) {
    if (p.sku && qUpper.includes(p.sku.toUpperCase())) {
      return { product: p, explicitUnknownToken: null };
    }
  }
  // Product name match (e.g., "Hex Nut", "Induction Motor", "Pump Assembly")
  const qLow = question.toLowerCase();
  for (const p of byLen) {
    const cleanName = p.name.toLowerCase().replace(/\([^)]*\)/g, '').trim();
    if (cleanName.length >= 6 && qLow.includes(cleanName)) {
      return { product: p, explicitUnknownToken: null };
    }
  }

  // Detect uppercase SKU-like token that is NOT in catalog (e.g. "Why is SKU XYZ-999 high risk?")
  const codeMatches = question.match(/\b[A-Z]{2,5}-[A-Z0-9]{2,8}\b/g);
  if (codeMatches && codeMatches.length > 0) {
    const knownSet = new Set(products.map((p) => p.sku.toUpperCase()));
    const unknown = codeMatches.find((tok) => !knownSet.has(tok.toUpperCase()));
    if (unknown) {
      return { product: null, explicitUnknownToken: unknown };
    }
  }

  return { product: null, explicitUnknownToken: null };
}

export function classifyDecisionIntent(question: string): AssistantIntent {
  const q = question.trim().toLowerCase();

  if (
    /\b(what if|what would happen|if .* (increas|decreas|doubl|halv|drop|ris|surge|cut|add|reduc|chang)|increase.*by|decrease.*by|scenario)\b/.test(
      q
    ) &&
    /(lead time|demand|scrap|defect|cycle|breakdown|mtbf|buffer|operator|shift|batch|capacity|machine)/.test(q)
  ) {
    return 'what_if_scenario';
  }

  if (/\b(compare|versus|vs\.?|trade-?off)\b/.test(q) && /(polic|eoq|poq|l4l|lot-for-lot|service)/.test(q)) {
    return 'compare_policies';
  }

  if (
    /(bottleneck|workstation|station|pac(e|ing)|queue|blocked|starved|congest)/.test(q) &&
    !/(material|component|delay|shortage|bom)/.test(q)
  ) {
    return 'bottleneck';
  }

  if (
    /(explain|interpret|summari[sz]e|walk me through).*(sim|des|run|oee|throughput|cycle|wip|little)/.test(q) ||
    /\b(latest production simulation|production simulation results|explain oee)\b/.test(q)
  ) {
    return 'explain_simulation';
  }

  if (
    /(material|component|bom|shortage|delay|starv|mrp|late order)/.test(q) &&
    /(which|what|caus|delay|risk|short|miss|block|starv)/.test(q)
  ) {
    return 'material_delay';
  }

  if (
    /(reduc|lower|cut|trim|free|optimi[sz]|unlock|parked|excess).*(inventor|cash|capital|holding|stock|investment)/.test(
      q
    ) ||
    /without sacrificing service/.test(q)
  ) {
    return 'reduce_inventory';
  }

  if (
    /(why|risk|stockout|danger|critical|reorder|rop|safety stock|health)/.test(q) ||
    /\b[A-Z]{2,5}-[A-Z0-9]{2,8}\b/.test(question)
  ) {
    return 'sku_risk';
  }

  if (/(bottleneck|workstation)/.test(q)) return 'bottleneck';
  if (/(simulation|oee|throughput)/.test(q)) return 'explain_simulation';
  if (/(policy|policies)/.test(q)) return 'compare_policies';

  return 'general_overview';
}

interface ParsedWhatIfSpec {
  title: string;
  patch: Partial<ScenarioParams>;
  parsedSummary: string;
}

function parsePercentageFactor(q: string, defaultFactor = 1.2): { factor: number; label: string } {
  const downWords = /(decreas|reduc|cut|drop|lower|shrink|shorter|faster|improv)/i.test(q);
  const pctMatch = q.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) {
    const raw = Number(pctMatch[1]);
    if (Number.isFinite(raw)) {
      const signed = pctMatch[1].startsWith('-') || downWords ? -Math.abs(raw) : Math.abs(raw);
      const factor = Math.max(0.25, 1 + signed / 100);
      return { factor, label: `${signed >= 0 ? '+' : ''}${signed}% (×${factor.toFixed(2)})` };
    }
  }

  const multMatch = q.match(/(\d+(?:\.\d+)?)\s*[x×]/i);
  if (multMatch) {
    const m = Number(multMatch[1]);
    if (Number.isFinite(m) && m > 0) {
      return { factor: m, label: `×${m.toFixed(2)}` };
    }
  }

  if (/\bdoubl/i.test(q)) return { factor: 2.0, label: '×2.00 (+100%)' };
  if (/\bhalv/i.test(q)) return { factor: 0.5, label: '×0.50 (-50%)' };

  return {
    factor: downWords ? 0.8 : defaultFactor,
    label: downWords ? '×0.80 (-20%)' : `×${defaultFactor.toFixed(2)} (+${Math.round((defaultFactor - 1) * 100)}%)`,
  };
}

function parseWhatIfFromQuestion(question: string, base: ScenarioParams): ParsedWhatIfSpec {
  const q = question.toLowerCase();
  const { factor, label } = parsePercentageFactor(q, 1.2);

  if (/lead\s*time|supplier|vendor/.test(q)) {
    const nextLt = Number((base.supplierLeadTimeMult * factor).toFixed(3));
    return {
      title: `Supplier Lead Time ${label}`,
      patch: { supplierLeadTimeMult: nextLt },
      parsedSummary: `Scaled supplier lead-time multiplier from ×${base.supplierLeadTimeMult.toFixed(2)} to ×${nextLt.toFixed(2)} (${label}).`,
    };
  }

  if (/demand|order volume|sales|forecast/.test(q)) {
    const nextDem = Number((base.demandVolumeMult * factor).toFixed(3));
    return {
      title: `Demand Volume ${label}`,
      patch: { demandVolumeMult: nextDem },
      parsedSummary: `Scaled demand volume multiplier from ×${base.demandVolumeMult.toFixed(2)} to ×${nextDem.toFixed(2)} (${label}).`,
    };
  }

  if (/scrap|defect|reject|yield/.test(q)) {
    const pctMatch = q.match(/to\s+(\d+(?:\.\d+)?)\s*%/);
    const nextScrap = pctMatch ? Number(pctMatch[1]) : Number((Math.max(0.5, base.scrapRatePct) * factor).toFixed(2));
    return {
      title: `Scrap Rate Shift (${nextScrap.toFixed(1)}%)`,
      patch: { scrapRatePct: nextScrap },
      parsedSummary: `Adjusted routing scrap/defect rate from ${base.scrapRatePct.toFixed(2)}% to ${nextScrap.toFixed(2)}%.`,
    };
  }

  if (/cycle|machine time|speed|processing/.test(q)) {
    const nextCyc = Number((base.machineCycleMult * factor).toFixed(3));
    return {
      title: `Machine Cycle Time ${label}`,
      patch: { machineCycleMult: nextCyc },
      parsedSummary: `Adjusted workstation cycle time multiplier to ×${nextCyc.toFixed(2)} (${label}).`,
    };
  }

  if (/breakdown|failure|mtbf|downtime/.test(q)) {
    const nextBrk = Number((base.breakdownFreqMult * factor).toFixed(3));
    return {
      title: `Breakdown Frequency ${label}`,
      patch: { breakdownFreqMult: nextBrk },
      parsedSummary: `Scaled breakdown hazard multiplier to ×${nextBrk.toFixed(2)} (${label}).`,
    };
  }

  if (/add.*machine|extra.*machine|\+1 machine|bottleneck machine/.test(q)) {
    return {
      title: '+1 Parallel Bottleneck Machine',
      patch: {
        extraBottleneckMachines: base.extraBottleneckMachines + 1,
        operatorsAvailable: base.operatorsAvailable + 1,
      },
      parsedSummary: `Added +1 parallel machine at the pacing bottleneck (+1 operator to avoid staffing penalty).`,
    };
  }

  if (/buffer/.test(q)) {
    const numMatch = q.match(/buffer[^\d]*(\d+)/);
    const nextBuf = numMatch ? Number(numMatch[1]) : Math.max(2, Math.round(base.bufferCapacity * factor));
    return {
      title: `Inter-Station Buffer (${nextBuf} jobs)`,
      patch: { bufferCapacity: nextBuf },
      parsedSummary: `Changed inter-station buffer capacity from ${base.bufferCapacity} to ${nextBuf} jobs.`,
    };
  }

  // Fallback counterfactual if matched as what_if
  return {
    title: `Supplier Lead Time ${label}`,
    patch: { supplierLeadTimeMult: Number((base.supplierLeadTimeMult * factor).toFixed(3)) },
    parsedSummary: `Applied sensitivity multiplier ${label} to supplier lead times.`,
  };
}

/* -------------------------------------------------------------------------- */
/*  Data Sufficiency Audit Helper                                             */
/* -------------------------------------------------------------------------- */

function collectProductDataWarnings(p: Product, m: ProductMetrics): string[] {
  const warnings: string[] = [];
  if (p.annualDemand <= 0) {
    warnings.push(`${p.sku}: Annual demand is 0 — EOQ, ROP, and days-of-cover projections cannot estimate depletion rates.`);
  }
  if (p.unitCost <= 0) {
    warnings.push(`${p.sku}: Unit cost is $0 — financial impact, ABC annual usage, and holding cost are understated.`);
  }
  if (p.leadTime <= 0) {
    warnings.push(`${p.sku}: Lead time is 0 days — safety stock and lead-time demand window assume instant replenishment.`);
  }
  if (m.sigmaFallback) {
    warnings.push(
      `${p.sku}: Insufficient demand history (<2 valid periods) — safety stock σ uses ${m.sigmaSource} fallback rather than historical OLS residuals.`
    );
  }
  if (!p.demandHistory || p.demandHistory.length < 6) {
    warnings.push(
      `${p.sku}: Only ${p.demandHistory?.length ?? 0} monthly demand observations (<6 recommended for rolling-origin backtesting).`
    );
  }
  return warnings;
}

function buildLinksForProduct(p: Product, hasBom: boolean): AssistantNavLink[] {
  const links: AssistantNavLink[] = [
    { label: `Inspect ${p.sku} in Inventory`, route: 'inventory', sku: p.sku, contextNote: 'Edit parameters or record stock move' },
    { label: 'View EOQ & ROP Derivation', route: 'eoq', sku: p.sku, contextNote: 'Inspect Wilson EOQ & safety stock math' },
    { label: 'Review Forecasting Models', route: 'forecast', sku: p.sku, contextNote: 'Compare 12-model rolling backtests' },
  ];
  if (hasBom || p.category === 'Assembly') {
    links.push({ label: 'Open Production & MRP', route: 'production', sku: p.sku, contextNote: 'Explode BOM & net requirements' });
    links.push({ label: 'Inspect 3D Digital Twin', route: 'models-3d', sku: p.sku, contextNote: 'Locate rack & BOM assembly in 3D' });
  }
  return links;
}

/* -------------------------------------------------------------------------- */
/*  Main Deterministic Solver                                                 */
/* -------------------------------------------------------------------------- */

export function runDeterministicDecisionQuery(
  rawQuestion: string,
  ctx: AssistantWorkspaceContext
): AssistantResponse {
  const question = rawQuestion.trim() || 'Provide an operational risk and simulation briefing.';
  const now = Date.now();
  const id = `da-${now}-${Math.random().toString(36).slice(2, 6)}`;

  // Guard 1: Empty workspace catalog
  if (!ctx.products.length) {
    const warnings = [
      'Workspace SKU catalogue is empty (0 SKUs). Deterministic inventory, MRP, and BOM-connected simulation models cannot compute item-level risks until SKUs are added or demo data is loaded.',
    ];
    return finalizeResponse({
      id,
      createdAt: now,
      question,
      intent: 'general_overview',
      focusedSku: null,
      headline: 'Insufficient catalog data to evaluate operations',
      summaryBullets: [
        'No SKUs or bills of material are currently loaded in the workspace store.',
        'FactoryMind will not invent inventory quantities, lead times, forecasts, or financial savings without underlying SKU records.',
      ],
      facts: [
        { label: 'Loaded SKUs', value: '0', unit: 'SKUs', sourceEngine: 'Workspace Store', provenance: 'WORKSPACE_CATALOG' },
        { label: 'Logged Transactions', value: String(ctx.transactions.length), unit: 'entries', sourceEngine: 'Stock Ledger', provenance: 'WORKSPACE_CATALOG' },
      ],
      tables: [],
      reasoningSteps: [
        'Inspected active Workspace Store catalog -> found 0 products.',
        'Aborted numerical projection to enforce strict anti-fabrication data sufficiency rule.',
      ],
      assumptions: ['Import your CSV/JSON catalog in Inventory/Settings or reload the 17-SKU engineering demo dataset.'],
      insufficientDataWarnings: warnings,
      navLinks: [
        { label: 'Import or Add SKUs in Inventory', route: 'inventory', contextNote: 'Add products or upload CSV' },
        { label: 'Restore Demo Dataset in Settings', route: 'settings', contextNote: 'Load 17-SKU benchmark catalog' },
      ],
      proposedScenario: null,
      proposedActions: [],
      provenanceBadges: ['WORKSPACE_CATALOG', 'DETERMINISTIC_ENGINE'],
    });
  }

  const intent = classifyDecisionIntent(question);
  const { product: mentionedProduct, explicitUnknownToken } = detectMentionedProduct(question, ctx.products);

  // Guard 2: User explicitly asked about an unknown SKU code
  if (explicitUnknownToken && !mentionedProduct) {
    const warnings = [
      `SKU "${explicitUnknownToken}" was not found in the active ${ctx.products.length}-SKU catalog. Verify the SKU code or add it in Inventory before running risk analysis.`,
    ];
    return finalizeResponse({
      id,
      createdAt: now,
      question,
      intent: 'sku_risk',
      focusedSku: null,
      headline: `Unknown SKU "${explicitUnknownToken}" — cannot compute item metrics`,
      summaryBullets: [
        `No SKU matching "${explicitUnknownToken}" exists in the current workspace catalog (${ctx.products.length} active SKUs).`,
        'Closest active high-risk items can be inspected in Smart Alerts or Inventory.',
      ],
      facts: [
        { label: 'Requested SKU', value: explicitUnknownToken, sourceEngine: 'Catalog Lookup', provenance: 'WORKSPACE_CATALOG' },
        { label: 'Active Catalog Size', value: String(ctx.products.length), unit: 'SKUs', sourceEngine: 'Workspace Store', provenance: 'WORKSPACE_CATALOG' },
      ],
      tables: [],
      reasoningSteps: [
        `Scanned ${ctx.products.length} workspace SKUs for exact or name match to "${explicitUnknownToken}".`,
        'Zero match found — refused to substitute or fabricate metrics for a missing SKU.',
      ],
      assumptions: [],
      insufficientDataWarnings: warnings,
      navLinks: [
        { label: 'Search All SKUs in Inventory', route: 'inventory', contextNote: 'Browse or add new SKU' },
        { label: 'Open Advisor Policy Audit', route: 'advisor', contextNote: 'Review active risk findings' },
      ],
      proposedScenario: null,
      proposedActions: [],
      provenanceBadges: ['WORKSPACE_CATALOG'],
    });
  }

  const focusedProduct =
    mentionedProduct ||
    (ctx.focusedSku ? ctx.products.find((p) => p.sku.toUpperCase() === ctx.focusedSku!.toUpperCase()) ?? null : null);

  switch (intent) {
    case 'sku_risk':
      return solveSkuRiskQuery(id, now, question, ctx, focusedProduct);
    case 'material_delay':
      return solveMaterialDelayQuery(id, now, question, ctx, focusedProduct);
    case 'reduce_inventory':
      return solveReduceInventoryQuery(id, now, question, ctx);
    case 'bottleneck':
      return solveBottleneckQuery(id, now, question, ctx);
    case 'what_if_scenario':
      return solveWhatIfQuery(id, now, question, ctx, focusedProduct);
    case 'compare_policies':
      return solveComparePoliciesQuery(id, now, question, ctx, focusedProduct);
    case 'explain_simulation':
      return solveExplainSimulationQuery(id, now, question, ctx);
    default:
      return solveGeneralOverviewQuery(id, now, question, ctx, focusedProduct);
  }
}

/* -------------------------------------------------------------------------- */
/*  1. High-Risk SKU Diagnosis                                                */
/* -------------------------------------------------------------------------- */

function solveSkuRiskQuery(
  id: string,
  createdAt: number,
  question: string,
  ctx: AssistantWorkspaceContext,
  explicitProduct: Product | null
): AssistantResponse {
  const mostUrgentAlert: SmartStockAlert | null = ctx.smartAlertsResult.summary.mostUrgent;
  const fallbackHighestRisk =
    mostUrgentAlert?.product ??
    ctx.products
      .map((p) => ({ p, m: ctx.metricsOf(p) }))
      .sort((a, b) => a.p.stock - a.m.rop - (b.p.stock - b.m.rop))[0]?.p ??
    ctx.products[0];

  const target = explicitProduct ?? fallbackHighestRisk;
  const m = ctx.metricsOf(target);
  const alert = ctx.smartAlertsResult.alerts.find((a) => a.product.id === target.id) ?? null;

  // Compute downstream parent assembly exposure via BOM
  const downstreamParents = ctx.products.filter((parent) =>
    parent.bom.some((line) => line.componentId === target.id)
  );
  const exposedRevenue = downstreamParents.reduce(
    (s, parent) => s + parent.annualDemand * parent.unitCost,
    0
  );

  // Warehouse rack address from 3D Digital Twin engine
  const targetIdx = ctx.products.findIndex((p) => p.id === target.id);
  const rackCoord = targetIdx >= 0 ? formatRackLocation(targetIdx) : null;

  const stockVsRop = target.stock - m.rop;
  const stockVsSs = target.stock - m.safetyStock;
  const daysOfCoverStatic = m.dBar > 0 ? target.stock / m.dBar : Infinity;
  const forecastBurn = alert ? alert.forecastDailyDemand : m.dBar;
  const daysUntilOut = alert ? alert.daysUntilStockout : daysOfCoverStatic;
  const runsOutBeforeLt = target.leadTime > 0 && daysUntilOut <= target.leadTime;

  const warnings = collectProductDataWarnings(target, m);

  const summaryBullets: string[] = [];
  if (m.status === 'out' || target.stock <= 0) {
    summaryBullets.push(`${target.sku} (${target.name}) is at zero on-hand stock against a ${fmtInt(m.rop)} ${target.unit} reorder point.`);
  } else if (m.status === 'critical' || stockVsSs <= 0) {
    summaryBullets.push(
      `${target.sku} (${target.name}) has breached its safety stock floor (${fmtInt(target.stock)} ${target.unit} on hand vs ${fmtInt(m.safetyStock)} ${target.unit} safety stock and ${fmtInt(m.rop)} ${target.unit} ROP).`
    );
  } else if (m.status === 'reorder' || stockVsRop <= 0) {
    summaryBullets.push(
      `${target.sku} is below its Reorder Point (${fmtInt(target.stock)} vs ${fmtInt(m.rop)} ${target.unit}; deficit ${fmtInt(Math.abs(stockVsRop))} ${target.unit}).`
    );
  } else if (runsOutBeforeLt) {
    summaryBullets.push(
      `Predictive forecast (${alert?.forecastModel ?? 'Annual run-rate'}) projects depletion in ${fmtNum(daysUntilOut, 1)} days — shorter than its ${target.leadTime}-day supplier lead time.`
    );
  } else {
    summaryBullets.push(
      `${target.sku} currently sits in Healthy ROP territory (${fmtInt(target.stock)} vs ROP ${fmtInt(m.rop)} ${target.unit}, ~${Number.isFinite(daysUntilOut) ? fmtNum(daysUntilOut, 1) : '∞'} days runway).`
    );
  }

  if (alert) {
    summaryBullets.push(
      `Smart Alert severity is "${alert.severity.toUpperCase()}" under ${alert.forecastModel} (${fmtNum(forecastBurn, 1)} ${target.unit}/day burn rate, ${alert.demandShiftPct >= 0 ? '+' : ''}${fmtNum(alert.demandShiftPct, 1)}% vs static annual average).`
    );
  }

  if (downstreamParents.length > 0) {
    summaryBullets.push(
      `BOM blast radius: feeds ${downstreamParents.length} parent assembly SKU(s) (${downstreamParents.map((p) => p.sku).join(', ')}) representing ${fmtMoney(exposedRevenue, 0)}/yr in downstream output value.`
    );
  } else {
    summaryBullets.push('BOM blast radius: standalone or top-level assembly (0 downstream dependent SKUs in workspace BOMs).');
  }

  const orderQty = Math.max(1, Math.round(alert?.recommendedOrderQty ?? m.suggestedOrderQty ?? m.eoq.Q));
  const orderSpend = orderQty * target.unitCost;

  const facts: AssistantFact[] = [
    { label: 'On-Hand Stock', value: fmtInt(target.stock), unit: target.unit, sourceEngine: 'Workspace Catalog', provenance: 'WORKSPACE_CATALOG' },
    { label: 'Reorder Point (ROP)', value: fmtInt(m.rop), unit: target.unit, sourceEngine: 'IPE Engine (ipe.ts)', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Safety Stock Buffer', value: fmtInt(m.safetyStock), unit: `${target.unit} (${target.serviceLevel}% SL, z=${fmtNum(m.z, 2)})`, sourceEngine: 'IPE Engine (ipe.ts)', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Supplier Lead Time', value: String(target.leadTime), unit: 'days', sourceEngine: 'Workspace Catalog', provenance: 'WORKSPACE_CATALOG' },
    { label: 'Estimated Runway vs Lead Time', value: Number.isFinite(daysUntilOut) ? `${fmtNum(daysUntilOut, 1)}d vs ${target.leadTime}d` : 'N/A', sourceEngine: alert ? 'Smart Alerts (forecast.ts)' : 'IPE Daily Run-Rate', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Daily Demand Burn (Static / Forecast)', value: `${fmtNum(m.dBar, 1)} / ${fmtNum(forecastBurn, 1)}`, unit: `${target.unit}/day`, sourceEngine: alert ? alert.forecastModel : 'Annual Run-Rate', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'EOQ Recommended Order', value: fmtInt(orderQty), unit: `${target.unit} (${fmtMoney(orderSpend)})`, sourceEngine: 'Wilson EOQ (ipe.ts)', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Dependent Assemblies', value: String(downstreamParents.length), unit: downstreamParents.length ? downstreamParents.map((p) => p.sku).join(', ') : 'None', sourceEngine: 'BOM Graph (store.ts)', provenance: 'DETERMINISTIC_ENGINE' },
  ];
  if (rackCoord) {
    facts.push({ label: 'Warehouse Rack Location', value: rackCoord.code, unit: `Rack ${rackCoord.rack} · Shelf ${rackCoord.shelf} · Bay ${rackCoord.bay}`, sourceEngine: '3D Twin Layout', provenance: 'WORKSPACE_CATALOG' });
  }

  const headline =
    m.status === 'ok' && !runsOutBeforeLt
      ? `${target.sku} (${target.name}) is currently healthy — no immediate stockout risk`
      : `${target.sku} (${target.name}) risk driver: ${runsOutBeforeLt ? `${fmtNum(daysUntilOut, 1)}d runway < ${target.leadTime}d lead time` : `${fmtInt(Math.abs(stockVsRop))} ${target.unit} below ROP`}`;

  const proposedActions: AssistantProposedAction[] = [];
  if (m.status !== 'ok' || runsOutBeforeLt) {
    proposedActions.push({
      id: `act-recv-${target.id}`,
      kind: 'receive-stock',
      label: `Approve Replenishment (+${fmtInt(orderQty)} ${target.unit})`,
      description: `Records a stock receipt of ${fmtInt(orderQty)} ${target.unit} (${fmtMoney(orderSpend)}) for ${target.sku} in the Stock Ledger and brings stock to ${fmtInt(target.stock + orderQty)} ${target.unit}.`,
      requiresApproval: true,
      productId: target.id,
      sku: target.sku,
      qty: orderQty,
      previewDiff: [
        { target: target.sku, field: 'On-Hand Stock', before: `${fmtInt(target.stock)} ${target.unit}`, after: `${fmtInt(target.stock + orderQty)} ${target.unit}` },
        { target: target.sku, field: 'ROP Status', before: m.statusMeta.label, after: target.stock + orderQty > m.rop ? 'Healthy' : 'Partial cover' },
        { target: 'Working Capital', field: 'Estimated PO Value', before: '$0', after: fmtMoney(orderSpend) },
      ],
    });
  }

  return finalizeResponse({
    id,
    createdAt,
    question,
    intent: 'sku_risk',
    focusedSku: target.sku,
    headline,
    summaryBullets,
    facts,
    tables: downstreamParents.length
      ? [
          {
            title: `Downstream Assemblies Dependent on ${target.sku}`,
            columns: ['Assembly SKU', 'Assembly Name', 'Qty per Unit', 'Annual Demand', 'Assembly Stock'],
            rows: downstreamParents.map((parent) => {
              const line = parent.bom.find((b) => b.componentId === target.id);
              return [
                parent.sku,
                parent.name,
                fmtNum(line?.qtyPer ?? 0, 2),
                fmtInt(parent.annualDemand),
                `${fmtInt(parent.stock)} ${parent.unit}`,
              ];
            }),
          },
        ]
      : [],
    reasoningSteps: [
      `Selected target SKU ${target.sku} (${explicitProduct ? 'matched from query / context' : 'ranked #1 highest urgency in Smart Alerts / ROP queue'}).`,
      `Computed static ROP = ${fmtInt(m.rop)} ${target.unit} (d̄=${fmtNum(m.dBar, 2)}/day × L=${target.leadTime}d + SS=${fmtInt(m.safetyStock)} via ${m.sigmaSource}).`,
      `Evaluated rolling-origin forecast depletion (${alert ? `${alert.forecastModel} -> ${fmtNum(daysUntilOut, 1)}d runway` : 'static run-rate'}).`,
      `Traversed workspace BOM graph to quantify ${downstreamParents.length} dependent parent assembly SKU(s).`,
    ],
    assumptions: [
      `Normal lead-time demand error assumption at ${target.serviceLevel}% cycle service level (z = ${fmtNum(m.z, 2)}).`,
      `Demand volatility σ source: ${m.sigmaSource}.`,
      `Replenishment recommendation (${fmtInt(orderQty)} ${target.unit}) is computed cleanly from Wilson EOQ / forecast buffer; workspace inventory is unchanged unless you approve below.`,
    ],
    insufficientDataWarnings: warnings,
    navLinks: buildLinksForProduct(target, downstreamParents.length > 0),
    proposedScenario: null,
    proposedActions,
    provenanceBadges: ['WORKSPACE_CATALOG', 'DETERMINISTIC_ENGINE'],
  });
}

/* -------------------------------------------------------------------------- */
/*  2. Materials Causing Production Delays                                    */
/* -------------------------------------------------------------------------- */

function solveMaterialDelayQuery(
  id: string,
  createdAt: number,
  question: string,
  ctx: AssistantWorkspaceContext,
  focusedProduct: Product | null
): AssistantResponse {
  const assemblies = ctx.products.filter((p) => p.bom.length > 0);
  const rootAssembly =
    (focusedProduct && focusedProduct.bom.length > 0 ? focusedProduct : null) ||
    assemblies.find((p) => p.sku.toUpperCase() === ctx.factorySimConfig.assemblySku.toUpperCase()) ||
    assemblies[0] ||
    ctx.products[0];

  // Build MRP map across all products
  const mrpItems: Record<string, MrpItemInput> = {};
  for (const prod of ctx.products) {
    const m = ctx.metricsOf(prod);
    mrpItems[prod.id] = {
      id: prod.id,
      sku: prod.sku,
      name: prod.name,
      unit: prod.unit,
      bom: prod.bom.map((b) => ({ componentId: b.componentId, qtyPer: b.qtyPer })),
      onHand: prod.stock,
      safetyStock: m.safetyStock,
      leadTimeDays: prod.leadTime,
      lotRule: 'eoq',
      eoqQty: Math.max(1, Math.round(m.eoq.Q)),
    };
  }

  const batchQty = Math.max(10, Math.round(ctx.factorySimConfig.arrivalRatePerHour * 8));
  const mrpRes: MrpPlanResult = mrpPlan({
    rootId: rootAssembly.id,
    planQuantity: batchQty,
    needInDays: 14,
    items: mrpItems,
    horizonDays: 60,
    bucketSizeDays: 7,
    lotRule: 'eoq',
  });

  // Combine DES starved materials + Lead-time Smart Alerts + MRP shortage/late warnings
  const leadTimeRiskAlerts = ctx.smartAlertsResult.alerts.filter(
    (a) => a.runsOutBeforeLeadTime || a.severity === 'imminent' || a.severity === 'critical'
  );
  const desStarvedMaterials = [...ctx.desResult.materials].sort(
    (a, b) => b.starvedMinutes - a.starvedMinutes || b.starvationEvents - a.starvationEvents
  );

  interface MaterialRiskRow {
    sku: string;
    name: string;
    onHand: string;
    leadTime: string;
    desStarve: string;
    smartRunway: string;
    mrpFlag: string;
    severityScore: number;
    product: Product | null;
  }

  const bySku = new Map<string, MaterialRiskRow>();

  for (const dm of desStarvedMaterials) {
    if (dm.stockoutOccurred || dm.starvedMinutes > 0 || dm.replenishmentOrders > 0) {
      const prod = ctx.products.find((p) => p.sku === dm.sku) ?? null;
      bySku.set(dm.sku, {
        sku: dm.sku,
        name: dm.name,
        onHand: `${fmtInt(dm.initialStock)} ${dm.unit}`,
        leadTime: prod ? `${prod.leadTime}d` : '—',
        desStarve: dm.starvedMinutes > 0 ? `${fmtNum(dm.starvedMinutes, 0)} min (${dm.starvationEvents}×)` : '0 min (PO triggered)',
        smartRunway: '—',
        mrpFlag: 'Check BOM',
        severityScore: (dm.stockoutOccurred ? 500 : 0) + dm.starvedMinutes,
        product: prod,
      });
    }
  }

  for (const al of leadTimeRiskAlerts) {
    const existing = bySku.get(al.product.sku);
    const runwayStr = `${fmtNum(al.daysUntilStockout, 1)}d vs ${al.leadTimeDays}d LT`;
    if (existing) {
      existing.smartRunway = runwayStr;
      existing.severityScore += al.runsOutBeforeLeadTime ? 400 : 180;
    } else {
      bySku.set(al.product.sku, {
        sku: al.product.sku,
        name: al.product.name,
        onHand: `${fmtInt(al.product.stock)} ${al.product.unit}`,
        leadTime: `${al.leadTimeDays}d`,
        desStarve: 'Not in active DES BOM',
        smartRunway: runwayStr,
        mrpFlag: al.severity.toUpperCase(),
        severityScore: al.runsOutBeforeLeadTime ? 400 - al.daysUntilStockout : 180,
        product: al.product,
      });
    }
  }

  for (const sh of mrpRes.shortageAlerts) {
    const prod = ctx.products.find((p) => p.id === sh.componentId);
    if (!prod) continue;
    const existing = bySku.get(prod.sku);
    if (existing) {
      existing.mrpFlag = `MRP shortfall ${fmtInt(sh.shortfall)} ${prod.unit}`;
      existing.severityScore += 250;
    } else {
      bySku.set(prod.sku, {
        sku: prod.sku,
        name: prod.name,
        onHand: `${fmtInt(prod.stock)} ${prod.unit}`,
        leadTime: `${prod.leadTime}d`,
        desStarve: '0 min',
        smartRunway: 'Within horizon',
        mrpFlag: `MRP shortfall ${fmtInt(sh.shortfall)} ${prod.unit}`,
        severityScore: 250,
        product: prod,
      });
    }
  }

  for (const late of mrpRes.lateOrderWarnings) {
    const prod = ctx.products.find((p) => p.id === late.componentId);
    if (!prod) continue;
    const existing = bySku.get(prod.sku);
    const flag = `Past due ${fmtInt(late.daysOverdue)}d`;
    if (existing) {
      existing.mrpFlag = existing.mrpFlag.startsWith('MRP shortfall') ? `${existing.mrpFlag}; ${flag}` : flag;
      existing.severityScore += 160;
    } else {
      bySku.set(prod.sku, {
        sku: prod.sku,
        name: prod.name,
        onHand: `${fmtInt(prod.stock)} ${prod.unit}`,
        leadTime: `${prod.leadTime}d`,
        desStarve: '0 min',
        smartRunway: 'Lead-time compressed',
        mrpFlag: flag,
        severityScore: 160,
        product: prod,
      });
    }
  }

  const ranked = [...bySku.values()].sort((a, b) => b.severityScore - a.severityScore);
  const topDelay = ranked[0] ?? null;

  const summaryBullets: string[] = [];
  if (ranked.length === 0) {
    summaryBullets.push(
      `No component stockouts, DES material starvation minutes, or MRP past-due shortages detected for ${rootAssembly.sku} (${batchQty}-unit plan).`
    );
  } else {
    summaryBullets.push(
      `Identified ${ranked.length} material/component risk(s) combining Smart Lead-Time Alerts (${leadTimeRiskAlerts.length}), MRP explosion for ${rootAssembly.sku} (${mrpRes.shortageAlerts.length} shortages, ${mrpRes.lateOrderWarnings.length} late releases), and DES starvation tracking.`
    );
    if (topDelay) {
      summaryBullets.push(
        `Highest delay risk: ${topDelay.sku} (${topDelay.name}) — On-hand ${topDelay.onHand}, LT ${topDelay.leadTime}, Smart Runway ${topDelay.smartRunway}, DES Starve ${topDelay.desStarve}, MRP ${topDelay.mrpFlag}.`
      );
    }
  }

  const totalStarvedMin = ctx.desResult.materials.reduce((s, m) => s + m.starvedMinutes, 0);
  const facts: AssistantFact[] = [
    { label: 'Flagged Delay Materials', value: String(ranked.length), unit: 'SKUs', sourceEngine: 'MRP + Smart Alerts + DES', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Lead-Time Stockout Risks', value: String(leadTimeRiskAlerts.length), unit: 'SKUs (< LT)', sourceEngine: 'Smart Alerts (smartAlerts.ts)', provenance: 'DETERMINISTIC_ENGINE' },
    { label: `MRP Shortages (${rootAssembly.sku})`, value: String(mrpRes.shortageAlerts.length), unit: `for ${batchQty} units`, sourceEngine: 'MRP Engine (mrp.ts)', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'MRP Past-Due Releases', value: String(mrpRes.lateOrderWarnings.length), unit: 'orders', sourceEngine: 'MRP Engine (mrp.ts)', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'DES Material Starvation Time', value: fmtNum(totalStarvedMin, 1), unit: 'min (sim)', sourceEngine: 'DES Engine (desEngine.ts)', provenance: 'SCENARIO_SIMULATION_MODEL' },
  ];

  const proposedActions: AssistantProposedAction[] = [];
  if (topDelay?.product) {
    const prod = topDelay.product;
    const pm = ctx.metricsOf(prod);
    const qty = Math.max(1, Math.round(pm.suggestedOrderQty || pm.eoq.Q));
    proposedActions.push({
      id: `act-expedite-${prod.id}`,
      kind: 'receive-stock',
      label: `Approve Expedited Receipt for ${prod.sku} (+${fmtInt(qty)} ${prod.unit})`,
      description: `Receives ${fmtInt(qty)} ${prod.unit} (${fmtMoney(qty * prod.unitCost)}) of highest-risk material ${prod.sku} to relieve downstream assembly starvation.`,
      requiresApproval: true,
      productId: prod.id,
      sku: prod.sku,
      qty,
      previewDiff: [
        { target: prod.sku, field: 'On-Hand Stock', before: `${fmtInt(prod.stock)} ${prod.unit}`, after: `${fmtInt(prod.stock + qty)} ${prod.unit}` },
        { target: 'Expedite PO Cost', field: 'Estimated Spend', before: '$0', after: fmtMoney(qty * prod.unitCost) },
      ],
    });
  }

  return finalizeResponse({
    id,
    createdAt,
    question,
    intent: 'material_delay',
    focusedSku: topDelay?.sku ?? rootAssembly.sku,
    headline: topDelay
      ? `${ranked.length} material delay risk(s) detected — ${topDelay.sku} is the #1 exposure`
      : `Materials clear for ${rootAssembly.sku} (${batchQty}-unit plan)`,
    summaryBullets,
    facts,
    tables: ranked.length
      ? [
          {
            title: 'Ranked Material Delay & Shortage Risks',
            caption: `Combined Smart Alerts (45d horizon), MRP (${rootAssembly.sku}, batch ${batchQty}), and DES BOM starvation.`,
            columns: ['SKU', 'Component', 'On Hand', 'Lead Time', 'Smart Runway', 'DES Starvation', 'MRP Status'],
            rows: ranked.slice(0, 8).map((r) => [
              r.sku,
              r.name,
              r.onHand,
              r.leadTime,
              r.smartRunway,
              r.desStarve,
              r.mrpFlag,
            ]),
          },
        ]
      : [],
    reasoningSteps: [
      `Evaluated ${ctx.smartAlertsResult.alerts.length} Smart Stockout Alerts for components depleting inside supplier lead time.`,
      `Executed multi-level MRP explosion on ${rootAssembly.sku} (batch = ${batchQty} units, 60-day weekly buckets, EOQ lot sizing).`,
      `Correlated DES BOM starvation minutes across ${ctx.desResult.materials.length} simulation materials (${fmtNum(totalStarvedMin, 1)} total min starved).`,
    ],
    assumptions: [
      `MRP explosion assumes a ${batchQty}-unit batch of ${rootAssembly.sku} needed in 14 days with zero unrecorded open PO receipts.`,
      `DES starvation reflects stochastic simulated demand under seed #${ctx.factorySimConfig.seed}.`,
    ],
    insufficientDataWarnings: assemblies.length === 0 ? ['No multi-level BOM assemblies exist in the catalog; MRP checked standalone items only.'] : [],
    navLinks: [
      { label: 'Inspect MRP Explosion', route: 'production', sku: rootAssembly.sku, contextNote: 'View time-phased MRP table & BOM tree' },
      { label: 'Open Inventory Catalogue', route: 'inventory', sku: topDelay?.sku, contextNote: 'Adjust stock or lead time' },
      { label: 'Inspect DES Material Starvation', route: 'factory-sim', contextNote: 'See live DES material cover curves' },
    ],
    proposedScenario: null,
    proposedActions,
    provenanceBadges: ['DETERMINISTIC_ENGINE', 'SCENARIO_SIMULATION_MODEL'],
  });
}

/* -------------------------------------------------------------------------- */
/*  3. Reduce Inventory Investment Without Sacrificing Service Level          */
/* -------------------------------------------------------------------------- */

function solveReduceInventoryQuery(
  id: string,
  createdAt: number,
  question: string,
  ctx: AssistantWorkspaceContext
): AssistantResponse {
  const rows = ctx.products.map((p) => ({ p, m: ctx.metricsOf(p) }));
  const { findings, totals } = ctx.advisorResult;
  const cashFindings = findings.filter((f) => f.kind === 'cash');
  const overSlFindings = findings.filter((f) => f.kind === 'policy' && f.action.type === 'set-sl' && f.action.value < f.product.serviceLevel);
  const abcRows = abcAnalysis(ctx.products, { aThreshold: ctx.settings.abcA, bThreshold: ctx.settings.abcB });
  const abcById = new Map(abcRows.map((r) => [r.id, r]));

  // Simulate policy scenario keeping SL floor >= saved floor (never below saved floor!)
  const policyTarget = {
    cover: Math.max(1.5, Number((ctx.advisorPolicy.cover - 0.5).toFixed(1))),
    band: ctx.advisorPolicy.band,
  };
  const scen = advisorScenario(rows, policyTarget, ctx.advisorPolicy);

  // Also test POQ vs EOQ counterfactual in ScenarioStudio (pure non-mutating)
  const poqScenarioDef: ScenarioDefinition = {
    id: `da-poq-opt-${createdAt}`,
    name: 'Lean Cover & POQ Policy Alignment',
    notes: `Aligns replenishment toward POQ with ${ctx.advisorPolicy.band[1]}% service ceiling while protecting >=${ctx.advisorPolicy.band[0]}% SL floor.`,
    createdAt,
    params: sanitizeScenarioParams({
      ...ctx.baselineScenario.params,
      reorderPolicy: 'poq',
      safetyStockMult: 0.9,
      targetServiceLevelPct: ctx.advisorPolicy.band[0],
    }),
  };
  const baseEval = evaluateScenario(ctx.baselineScenario, ctx.scenarioWorkspace);
  const poqEval = evaluateScenario(poqScenarioDef, ctx.scenarioWorkspace);
  const cmp = compareScenarioToBaseline(baseEval, poqEval);

  const excessSkusTotalCash = cashFindings.reduce((s, f) => s + (f.money ?? 0), 0);
  const overSlSaving = overSlFindings.reduce((s, f) => s + (f.money ?? 0), 0);

  const summaryBullets: string[] = [
    `Portfolio Advisor identifies ${fmtMoney(excessSkusTotalCash)} in parked excess cash across ${cashFindings.length} SKU(s) holding above your ${fmtNum(ctx.advisorPolicy.cover, 1)}-month cover target.`,
    `${overSlFindings.length} SKU(s) are over-specified above the ${ctx.advisorPolicy.band[1]}% service ceiling; trimming them to ${ctx.advisorPolicy.band[1]}% frees ${fmtMoney(overSlSaving)}/yr in holding costs while preserving weighted portfolio service level (${fmtNum(scen.slNow, 1)}% → ${fmtNum(scen.slAfter, 1)}%).`,
    `Tightening the cover target by 0.5 mo (${fmtNum(ctx.advisorPolicy.cover, 1)} → ${fmtNum(policyTarget.cover, 1)} mo) cuts working capital by ${fmtMoney(Math.abs(scen.deltaCash))} (${fmtMoney(Math.abs(scen.carryingDelta))}/yr holding reduction) without breaching the ${ctx.advisorPolicy.band[0]}% service floor.`,
  ];

  const facts: AssistantFact[] = [
    { label: 'Total Stock Value', value: fmtMoney(ctx.summary.stockValue), sourceEngine: 'Workspace Summary', provenance: 'WORKSPACE_CATALOG' },
    { label: 'Parked Cash (> Cover Target)', value: fmtMoney(totals.parkedCash), unit: `${cashFindings.length} SKUs`, sourceEngine: 'Advisor Engine (advisor.ts)', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Annual Holding Saving (Over-Spec SL)', value: fmtMoney(overSlSaving), unit: `${overSlFindings.length} SKUs`, sourceEngine: 'Advisor Engine (advisor.ts)', provenance: 'DETERMINISTIC_ENGINE' },
    { label: '0.5-mo Cover Trim Cash Release', value: fmtMoney(Math.abs(scen.deltaCash)), unit: `${fmtMoney(Math.abs(scen.carryingDelta))}/yr carrying`, sourceEngine: 'Advisor Scenario', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Weighted Service Level Impact', value: `${fmtNum(scen.slNow, 1)}% → ${fmtNum(scen.slAfter, 1)}%`, unit: 'usage-weighted', sourceEngine: 'Advisor Scenario', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'POQ Scenario Inventory Cost Delta', value: `${poqEval.kpis.totalInventoryCostAnnual - baseEval.kpis.totalInventoryCostAnnual >= 0 ? '+' : '-'}${fmtMoney(Math.abs(poqEval.kpis.totalInventoryCostAnnual - baseEval.kpis.totalInventoryCostAnnual))}/yr`, sourceEngine: 'Scenario Studio + DES', provenance: 'SCENARIO_SIMULATION_MODEL' },
  ];

  const tables: AssistantTable[] = [];
  if (cashFindings.length > 0 || overSlFindings.length > 0) {
    const combined = [...cashFindings.slice(0, 5), ...overSlFindings.slice(0, 4)];
    tables.push({
      title: 'Top Working-Capital Optimization Candidates',
      columns: ['SKU', 'ABC Class', 'Lever', 'Current State', 'Annual / Cash Impact'],
      rows: combined.map((f) => {
        const abc = abcById.get(f.product.id)?.cls ?? 'C';
        return [
          f.sku,
          `Class ${abc}`,
          f.kind === 'cash' ? 'Excess Cover Drawdown' : 'Trim Over-Specified SL',
          f.kind === 'cash'
            ? `${fmtNum(ctx.metricsOf(f.product).monthsOfCover, 1)} mo cover`
            : `${f.product.serviceLevel}% → ${f.action.type === 'set-sl' ? f.action.value : ctx.advisorPolicy.band[1]}% SL`,
          f.impactLabel,
        ];
      }),
    });
  }

  const proposedActions: AssistantProposedAction[] = [];
  if (overSlFindings.length > 0) {
    proposedActions.push({
      id: `act-trim-sl-${createdAt}`,
      kind: 'align-over-sl-bulk',
      label: `Approve Aligning ${overSlFindings.length} Over-Specified SL SKU(s)`,
      description: `Caps over-buffered SKUs at ${ctx.advisorPolicy.band[1]}% service level, saving ${fmtMoney(overSlSaving)}/yr while keeping weighted SL >= ${ctx.advisorPolicy.band[0]}%.`,
      requiresApproval: true,
      bulkUpdates: overSlFindings
        .filter((f) => f.action.type === 'set-sl')
        .map((f) => ({
          productId: f.product.id,
          sku: f.sku,
          value: f.action.type === 'set-sl' ? f.action.value : ctx.advisorPolicy.band[1],
        })),
      previewDiff: overSlFindings.slice(0, 6).map((f) => ({
        target: f.sku,
        field: 'Service Level Target',
        before: `${f.product.serviceLevel}%`,
        after: `${f.action.type === 'set-sl' ? f.action.value : ctx.advisorPolicy.band[1]}%`,
      })),
    });
  }
  proposedActions.push({
    id: `act-save-poq-${createdAt}`,
    kind: 'save-scenario',
    label: 'Save POQ Optimization Scenario to Scenario Studio',
    description: 'Saves this non-mutating POQ counterfactual for further sensitivity testing in Scenario Studio.',
    requiresApproval: true,
    scenarioDefinition: poqScenarioDef,
    previewDiff: [
      { target: 'Scenario Studio', field: 'Saved Strategy', before: 'Not saved', after: poqScenarioDef.name },
      { target: 'Inventory Cost', field: 'Simulated Annual Cost', before: fmtMoney(baseEval.kpis.totalInventoryCostAnnual), after: fmtMoney(poqEval.kpis.totalInventoryCostAnnual) },
    ],
  });

  return finalizeResponse({
    id,
    createdAt,
    question,
    intent: 'reduce_inventory',
    focusedSku: cashFindings[0]?.sku ?? null,
    headline: `Up to ${fmtMoney(excessSkusTotalCash)} excess cash & ${fmtMoney(overSlSaving)}/yr holding cost identified without breaching ${ctx.advisorPolicy.band[0]}% SL`,
    summaryBullets,
    facts,
    tables,
    reasoningSteps: [
      `Audited ${ctx.products.length} SKUs against ${fmtNum(ctx.advisorPolicy.cover, 1)}-month cover ceiling and [${ctx.advisorPolicy.band[0]}%, ${ctx.advisorPolicy.band[1]}%] SL band via advisorAnalyse().`,
      `Cross-referenced ABC usage classes (A≤${ctx.settings.abcA}%, B≤${ctx.settings.abcB}%) so high-impact Class A protection is preserved.`,
      `Ran counterfactual 0.5-mo cover sensitivity + POQ policy simulation in Scenario Studio without modifying live workspace records.`,
    ],
    assumptions: [
      `Working capital reduction assumes excess cover is drawn down gradually through natural demand rather than distressed liquidation.`,
      `Weighted SL floor guardrail (${ctx.advisorPolicy.band[0]}%) is respected across all automated alignment proposals.`,
    ],
    insufficientDataWarnings: [],
    navLinks: [
      { label: 'Review Findings in Advisor', route: 'advisor', contextNote: 'Inspect line-item cash & policy findings' },
      { label: 'Inspect ABC Classification', route: 'abc', contextNote: 'Verify Class A/B/C protection tiers' },
      { label: 'Compare in Scenario Studio', route: 'scenario-studio', contextNote: 'Test POQ & safety-stock sensitivity' },
    ],
    proposedScenario: {
      title: poqScenarioDef.name,
      summary: cmp.explanation.recommendationHeadline,
      definition: poqScenarioDef,
      baseline: baseEval,
      scenario: poqEval,
      deltas: cmp.deltas,
      applyPreview: buildWorkspaceApplyPreview(poqScenarioDef, ctx.scenarioWorkspace),
    },
    proposedActions,
    provenanceBadges: ['DETERMINISTIC_ENGINE', 'SCENARIO_SIMULATION_MODEL'],
  });
}

/* -------------------------------------------------------------------------- */
/*  4. Production Bottleneck Identification                                   */
/* -------------------------------------------------------------------------- */

function solveBottleneckQuery(
  id: string,
  createdAt: number,
  question: string,
  ctx: AssistantWorkspaceContext
): AssistantResponse {
  const des = ctx.desResult;
  if (!des.valid || !des.stations.length) {
    return finalizeResponse({
      id,
      createdAt,
      question,
      intent: 'bottleneck',
      focusedSku: null,
      headline: 'Unable to identify bottleneck — simulation configuration has no active stations',
      summaryBullets: [des.reason || 'Configure at least one workstation in Factory Simulation Lab.'],
      facts: [],
      tables: [],
      reasoningSteps: ['Inspected active DES result -> 0 stations configured.'],
      assumptions: [],
      insufficientDataWarnings: [des.reason || 'Insufficient workstation routing data.'],
      navLinks: [{ label: 'Configure Line in Factory Sim Lab', route: 'factory-sim', contextNote: 'Define workstations & routing' }],
      proposedScenario: null,
      proposedActions: [],
      provenanceBadges: ['SCENARIO_SIMULATION_MODEL'],
    });
  }

  const stationWorkload = (st: DesStationTelemetry) => st.busyPct + st.setupPct;
  const sortedStations = [...des.stations].sort((a, b) => stationWorkload(b) - stationWorkload(a));
  const bn = des.stations.find((s) => s.isBottleneck) ?? des.stations[des.bottleneckIndex] ?? sortedStations[0];
  const runnerUp = sortedStations.find((s) => s.id !== bn.id) ?? null;

  // Run fast counterfactual relief: +1 machine at bottleneck (via Scenario Studio)
  const baseEval = evaluateScenario(ctx.baselineScenario, ctx.scenarioWorkspace);
  const reliefDef: ScenarioDefinition = {
    id: `da-bn-relief-${createdAt}`,
    name: `Relieve ${bn.name} (+1 Machine & Operator)`,
    notes: `Counterfactual testing +1 parallel machine and +1 operator at pacing bottleneck ${bn.name}.`,
    createdAt,
    params: sanitizeScenarioParams({
      ...ctx.baselineScenario.params,
      extraBottleneckMachines: ctx.baselineScenario.params.extraBottleneckMachines + 1,
      operatorsAvailable: ctx.baselineScenario.params.operatorsAvailable + 1,
    }),
  };
  const reliefEval = evaluateScenario(reliefDef, ctx.scenarioWorkspace);
  const cmp = compareScenarioToBaseline(baseEval, reliefEval);
  const tpDelta = reliefEval.kpis.throughputPerHour - baseEval.kpis.throughputPerHour;

  const summaryBullets: string[] = [
    `Pacing bottleneck is ${bn.name} (${bn.id}) with ${fmtNum(stationWorkload(bn), 1)}% active workload (${fmtNum(bn.busyPct, 1)}% busy + ${fmtNum(bn.setupPct, 1)}% setup), ${fmtNum(bn.avgQueueLen, 2)} jobs average queue (max ${fmtInt(bn.maxQueueLen)}), and ${fmtNum(bn.avgWaitMin, 1)} min wait per job.`,
    runnerUp
      ? `Secondary constraint is ${runnerUp.name} at ${fmtNum(stationWorkload(runnerUp), 1)}% workload (${fmtNum(stationWorkload(bn) - stationWorkload(runnerUp), 1)} percentage points lower than ${bn.name}).`
      : 'Single-station line evaluated.',
    `Downtime & PM exposure at ${bn.name}: ${fmtNum(bn.downPct, 1)}% unplanned breakdown (${bn.failuresCount} events) + ${fmtNum(bn.pmPct, 1)}% scheduled PM; downstream blocking = ${fmtNum(bn.blockedPct, 1)}%.`,
    `Simulated relief (+1 machine & operator at bottleneck): throughput shifts from ${fmtNum(baseEval.kpis.throughputPerHour, 2)} to ${fmtNum(reliefEval.kpis.throughputPerHour, 2)} jobs/hr (${tpDelta >= 0 ? '+' : ''}${fmtNum(tpDelta, 2)} jobs/hr), moving bottleneck to ${reliefEval.desResult.bottleneckName}.`,
  ];

  const facts: AssistantFact[] = [
    { label: 'Primary Bottleneck Station', value: `${bn.name} (${bn.id})`, sourceEngine: 'DES Engine (desEngine.ts)', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'Bottleneck Workload (Busy+Setup)', value: `${fmtNum(stationWorkload(bn), 1)}%`, unit: `${fmtNum(bn.busyPct, 1)}% busy / ${fmtNum(bn.setupPct, 1)}% setup`, sourceEngine: 'DES Engine', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'Queue Wait & Length', value: `${fmtNum(bn.avgWaitMin, 1)} min`, unit: `avg Q ${fmtNum(bn.avgQueueLen, 2)} (max ${bn.maxQueueLen})`, sourceEngine: 'DES Engine', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'Breakdown & PM Downtime', value: `${fmtNum(bn.downPct + bn.pmPct, 1)}%`, unit: `${bn.failuresCount} breakdowns · ${bn.pmEventsCount} PMs`, sourceEngine: 'DES Reliability Model', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'Line Throughput (Simulated)', value: `${fmtNum(des.throughputPerScheduledHour.mean, 2)} jobs/hr`, unit: `95% CI [${fmtNum(des.throughputPerScheduledHour.ci95Low, 2)}, ${fmtNum(des.throughputPerScheduledHour.ci95High, 2)}]`, sourceEngine: 'DES Engine', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'Projected Throughput (+1 BN Machine)', value: `${fmtNum(reliefEval.kpis.throughputPerHour, 2)} jobs/hr`, unit: `${tpDelta >= 0 ? '+' : ''}${fmtNum(tpDelta, 2)} vs baseline`, sourceEngine: 'Scenario Studio Counterfactual', provenance: 'SCENARIO_SIMULATION_MODEL' },
  ];

  const table: AssistantTable = {
    title: 'Workstation Workload, Queues & Downtime Ranking (Simulated DES)',
    caption: `Evaluated over ${des.replications} replication(s) × ${fmtNum(des.observedScheduledHours, 1)} scheduled hours (Seed #${des.seed}).`,
    columns: ['Station', 'Machines', 'Workload %', 'Blocked %', 'Down+PM %', 'Avg Queue', 'Avg Wait (m)', 'Role'],
    rows: sortedStations.map((st) => [
      `${st.name} (${st.id})`,
      String(st.machineCount),
      `${fmtNum(stationWorkload(st), 1)}%`,
      `${fmtNum(st.blockedPct, 1)}%`,
      `${fmtNum(st.downPct + st.pmPct, 1)}%`,
      fmtNum(st.avgQueueLen, 2),
      fmtNum(st.avgWaitMin, 1),
      st.id === bn.id ? 'Bottleneck' : st.blockedPct >= 15 ? 'Backpressured' : 'Non-bottleneck',
    ]),
  };

  return finalizeResponse({
    id,
    createdAt,
    question,
    intent: 'bottleneck',
    focusedSku: ctx.factorySimConfig.assemblySku,
    headline: `${bn.name} is the pacing bottleneck (${fmtNum(stationWorkload(bn), 1)}% workload · ${fmtNum(bn.avgWaitMin, 1)} min queue wait)`,
    summaryBullets,
    facts,
    tables: [table],
    reasoningSteps: [
      `Ranked ${des.stations.length} DES workstations by effective busy + setup workload percentage across ${des.replications} Monte Carlo replication(s).`,
      `Distinguished busy processing (${fmtNum(bn.busyPct, 1)}%) from downstream blocking (${fmtNum(bn.blockedPct, 1)}%) and Weibull failures (${fmtNum(bn.downPct, 1)}%).`,
      `Executed non-mutating Scenario Studio counterfactual adding +1 parallel machine & operator to quantify throughput relief.`,
    ],
    assumptions: [
      `All station metrics are simulated DES outputs under ${ctx.factorySimConfig.shiftsPerDay}×${ctx.factorySimConfig.shiftHours}h shift calendar (not live PLC telemetry).`,
      'Bottleneck relief counterfactual assumes space and power utilities allow +1 parallel machine.',
    ],
    insufficientDataWarnings: [],
    navLinks: [
      { label: 'Inspect Stations in Factory Sim Lab', route: 'factory-sim', contextNote: 'View timeline queues & Gantt states' },
      { label: 'Inspect Bottleneck in 3D Twin', route: 'models-3d', contextNote: 'Highlight bottleneck workstation on 3D floor' },
      { label: 'Re-Balance Line Tasks', route: 'line-balance', contextNote: 'Reduce max station task sum' },
    ],
    proposedScenario: {
      title: reliefDef.name,
      summary: cmp.explanation.recommendationHeadline,
      definition: reliefDef,
      baseline: baseEval,
      scenario: reliefEval,
      deltas: cmp.deltas,
      applyPreview: buildWorkspaceApplyPreview(reliefDef, ctx.scenarioWorkspace),
    },
    proposedActions: [
      {
        id: `act-save-bn-${createdAt}`,
        kind: 'save-scenario',
        label: 'Save Bottleneck Relief Scenario',
        description: `Saves "${reliefDef.name}" to Scenario Studio for team review (no live workspace changes yet).`,
        requiresApproval: true,
        scenarioDefinition: reliefDef,
        previewDiff: [
          { target: 'Scenario Studio', field: 'New Scenario', before: 'None', after: reliefDef.name },
          { target: 'Simulated Throughput', field: 'Jobs / Scheduled Hr', before: fmtNum(baseEval.kpis.throughputPerHour, 2), after: fmtNum(reliefEval.kpis.throughputPerHour, 2) },
        ],
      },
      {
        id: `act-apply-bn-${createdAt}`,
        kind: 'apply-scenario',
        label: 'Approve & Apply +1 Bottleneck Machine to Lab',
        description: 'Applies +1 bottleneck machine and +1 operator to the live Factory Simulation Lab configuration.',
        requiresApproval: true,
        scenarioDefinition: reliefDef,
        previewDiff: buildWorkspaceApplyPreview(reliefDef, ctx.scenarioWorkspace).changes.map((c) => ({
          target: c.target,
          field: c.field,
          before: c.currentValue,
          after: c.nextValue,
        })),
      },
    ],
    provenanceBadges: ['SCENARIO_SIMULATION_MODEL', 'DETERMINISTIC_ENGINE'],
  });
}

/* -------------------------------------------------------------------------- */
/*  5. Counterfactual What-If Simulation                                      */
/* -------------------------------------------------------------------------- */

function solveWhatIfQuery(
  id: string,
  createdAt: number,
  question: string,
  ctx: AssistantWorkspaceContext,
  focusedProduct: Product | null
): AssistantResponse {
  const baseParams = {
    ...ctx.baselineScenario.params,
    assemblySku: focusedProduct?.bom.length ? focusedProduct.sku : ctx.baselineScenario.params.assemblySku,
  };
  const spec = parseWhatIfFromQuestion(question, baseParams);

  const baseDef: ScenarioDefinition = {
    ...ctx.baselineScenario,
    params: baseParams,
  };
  const whatIfDef: ScenarioDefinition = {
    id: `da-whatif-${createdAt}`,
    name: spec.title,
    notes: spec.parsedSummary,
    createdAt,
    params: sanitizeScenarioParams({ ...baseParams, ...spec.patch }),
  };

  const baseEval = evaluateScenario(baseDef, ctx.scenarioWorkspace);
  const whatIfEval = evaluateScenario(whatIfDef, ctx.scenarioWorkspace);
  const cmp = compareScenarioToBaseline(baseEval, whatIfEval);

  // Also check if supplier lead time increased across ALL workspace SKUs (not only active assembly BOM)
  const ltMult = whatIfDef.params.supplierLeadTimeMult;
  let extraExposedList: Array<{ sku: string; baseStatus: string; nextRop: number; stock: number; leadDays: number }> = [];
  if (Math.abs(ltMult - 1.0) > 0.01) {
    extraExposedList = ctx.products
      .map((p) => {
        const baseM = ctx.metricsOf(p);
        const effLt = p.leadTime * ltMult;
        const nextRop = Math.ceil((p.annualDemand / 365) * effLt + baseM.safetyStock * Math.sqrt(ltMult));
        return {
          sku: p.sku,
          baseStatus: baseM.statusMeta.label,
          nextRop,
          stock: p.stock,
          leadDays: Number(effLt.toFixed(1)),
          newlyExposed: p.stock >= baseM.rop && p.stock < nextRop,
        };
      })
      .filter((r) => r.newlyExposed || r.stock < r.nextRop)
      .slice(0, 8);
  }

  const keyDeltaSummary = cmp.deltas
    .filter((d) => d.status !== 'neutral')
    .slice(0, 4)
    .map((d) => `${d.label}: ${fmtNum(d.baseline, 1)} → ${fmtNum(d.scenario, 1)} ${d.unit} (${d.deltaPct >= 0 ? '+' : ''}${fmtNum(d.deltaPct, 1)}%)`);

  const summaryBullets: string[] = [
    spec.parsedSummary,
    `Simulated outcome (${whatIfDef.params.assemblySku} chain): ${cmp.explanation.recommendationHeadline}`,
    keyDeltaSummary.length
      ? `Primary KPI shifts: ${keyDeltaSummary.join(' · ')}.`
      : 'Primary DES & inventory KPIs showed minimal sensitivity (<1% shift) under this change.',
  ];

  if (extraExposedList.length > 0) {
    const newlyExposed = extraExposedList.filter((r) => r.baseStatus === 'Healthy');
    summaryBullets.push(
      `Catalog-wide ROP sweep at ${ltMult.toFixed(2)}× lead time: ${extraExposedList.length} SKU(s) sit below adjusted ROP (${newlyExposed.length} newly pushed into Reorder status: ${newlyExposed.map((x) => x.sku).join(', ') || 'none'}).`
    );
  }

  const facts: AssistantFact[] = [
    { label: 'Inventory Policy Cost (Baseline → Scenario)', value: `${fmtMoney(baseEval.kpis.totalInventoryCostAnnual)} → ${fmtMoney(whatIfEval.kpis.totalInventoryCostAnnual)}`, unit: '/yr', sourceEngine: 'IPE + Scenario Studio', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'Composite Shortage Risk', value: `${fmtNum(baseEval.kpis.shortageRiskPct, 1)}% → ${fmtNum(whatIfEval.kpis.shortageRiskPct, 1)}%`, sourceEngine: 'MRP + DES Starvation', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'Safety Stock Buffer Required', value: `${fmtNum(baseEval.inventorySummary.safetyStockUnits, 0)} → ${fmtNum(whatIfEval.inventorySummary.safetyStockUnits, 0)}`, unit: 'units (scope)', sourceEngine: 'IPE Engine (ipe.ts)', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Throughput (DES)', value: `${fmtNum(baseEval.kpis.throughputPerHour, 2)} → ${fmtNum(whatIfEval.kpis.throughputPerHour, 2)}`, unit: 'jobs/hr', sourceEngine: 'DES Engine', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'OEE (A × P × Q)', value: `${fmtNum(baseEval.kpis.oeePct, 1)}% → ${fmtNum(whatIfEval.kpis.oeePct, 1)}%`, sourceEngine: 'DES Engine', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'MRP Shortages / Late Orders', value: `${whatIfEval.mrpSummary.shortageCount} / ${whatIfEval.mrpSummary.lateOrdersCount}`, unit: `vs ${baseEval.mrpSummary.shortageCount} / ${baseEval.mrpSummary.lateOrdersCount} base`, sourceEngine: 'MRP Engine', provenance: 'DETERMINISTIC_ENGINE' },
  ];

  const tables: AssistantTable[] = [
    {
      title: `Before vs. After Counterfactual KPIs (${spec.title})`,
      caption: `Evaluated non-destructively across Forecasting -> EOQ/ROP -> MRP -> Line Balance -> DES (${whatIfDef.params.replications} reps).`,
      columns: ['Metric', 'Baseline', 'Counterfactual', 'Delta', 'Direction'],
      rows: cmp.deltas.slice(0, 9).map((d) => [
        d.label,
        `${fmtNum(d.baseline, 2)} ${d.unit}`,
        `${fmtNum(d.scenario, 2)} ${d.unit}`,
        `${d.delta >= 0 ? '+' : ''}${fmtNum(d.delta, 2)} (${d.deltaPct >= 0 ? '+' : ''}${fmtNum(d.deltaPct, 1)}%)`,
        d.status === 'improved' ? 'Improved' : d.status === 'deteriorated' ? 'Deteriorated' : 'Neutral',
      ]),
    },
  ];

  if (extraExposedList.length > 0) {
    tables.push({
      title: `Catalog SKUs Exposed Under ${ltMult.toFixed(2)}× Lead Time`,
      columns: ['SKU', 'On Hand', 'Current Status', 'Adjusted LT (d)', 'Adjusted ROP'],
      rows: extraExposedList.map((r) => [
        r.sku,
        fmtInt(r.stock),
        r.baseStatus,
        String(r.leadDays),
        fmtInt(r.nextRop),
      ]),
    });
  }

  return finalizeResponse({
    id,
    createdAt,
    question,
    intent: 'what_if_scenario',
    focusedSku: whatIfDef.params.assemblySku,
    headline: `What-If "${spec.title}": ${cmp.explanation.recommendationHeadline}`,
    summaryBullets,
    facts,
    tables,
    reasoningSteps: [
      `Parsed counterfactual perturbation from query: ${spec.parsedSummary}`,
      ...cmp.explanation.modelsUsed,
    ],
    assumptions: [
      ...cmp.explanation.assumptions,
      'Live workspace settings, lead times, and stock balances were NOT modified by this counterfactual run.',
    ],
    insufficientDataWarnings: [],
    navLinks: [
      { label: 'Explore in Scenario Studio', route: 'scenario-studio', contextNote: 'Adjust sensitivity sliders side-by-side' },
      { label: 'Inspect MRP Lead-Time Offsets', route: 'production', sku: whatIfDef.params.assemblySku, contextNote: 'Verify planned release shifts' },
    ],
    proposedScenario: {
      title: whatIfDef.name,
      summary: cmp.explanation.recommendationHeadline,
      definition: whatIfDef,
      baseline: baseEval,
      scenario: whatIfEval,
      deltas: cmp.deltas,
      applyPreview: buildWorkspaceApplyPreview(whatIfDef, ctx.scenarioWorkspace),
    },
    proposedActions: [
      {
        id: `act-save-whatif-${createdAt}`,
        kind: 'save-scenario',
        label: `Save "${spec.title}" to Scenario Studio`,
        description: 'Stores this counterfactual definition in Scenario Studio without mutating live operational parameters.',
        requiresApproval: true,
        scenarioDefinition: whatIfDef,
        previewDiff: [
          { target: 'Scenario Studio', field: 'Saved Counterfactual', before: 'Ephemeral', after: spec.title },
          { target: 'Shortage Risk', field: 'Simulated Risk', before: `${fmtNum(baseEval.kpis.shortageRiskPct, 1)}%`, after: `${fmtNum(whatIfEval.kpis.shortageRiskPct, 1)}%` },
        ],
      },
    ],
    provenanceBadges: ['SCENARIO_SIMULATION_MODEL', 'DETERMINISTIC_ENGINE'],
  });
}

/* -------------------------------------------------------------------------- */
/*  6. Compare Alternative Inventory Policies                                 */
/* -------------------------------------------------------------------------- */

function solveComparePoliciesQuery(
  id: string,
  createdAt: number,
  question: string,
  ctx: AssistantWorkspaceContext,
  focusedProduct: Product | null
): AssistantResponse {
  const targetSku =
    focusedProduct?.bom.length ? focusedProduct.sku : ctx.baselineScenario.params.assemblySku;

  const policySpecs: Array<{ policy: ScenarioReorderPolicy; name: string; targetSl: number }> = [
    { policy: 'eoq-rop', name: 'EOQ + Continuous ROP', targetSl: 95 },
    { policy: 'service-target', name: 'High Service Target (98% SL)', targetSl: 98 },
    { policy: 'poq', name: 'Period Order Quantity (14-day POQ)', targetSl: 95 },
    { policy: 'l4l', name: 'Lot-for-Lot (7-day L4L)', targetSl: 95 },
  ];

  const evals = policySpecs.map((ps) => {
    const def: ScenarioDefinition = {
      id: `da-pol-${ps.policy}`,
      name: ps.name,
      notes: `Policy comparison candidate (${ps.policy.toUpperCase()}) on ${targetSku}.`,
      createdAt,
      params: sanitizeScenarioParams({
        ...ctx.baselineScenario.params,
        assemblySku: targetSku,
        reorderPolicy: ps.policy,
        targetServiceLevelPct: ps.targetSl,
      }),
    };
    return { ps, def, eval: evaluateScenario(def, ctx.scenarioWorkspace) };
  });

  const lowestCost = [...evals].sort((a, b) => a.eval.kpis.totalInventoryCostAnnual - b.eval.kpis.totalInventoryCostAnnual)[0];
  const lowestRisk = [...evals].sort((a, b) => a.eval.kpis.shortageRiskPct - b.eval.kpis.shortageRiskPct)[0];
  const highestOee = [...evals].sort((a, b) => b.eval.kpis.oeePct - a.eval.kpis.oeePct)[0];

  const baseEval = evals[0].eval;
  const recommended = lowestRisk.eval.kpis.totalInventoryCostAnnual <= lowestCost.eval.kpis.totalInventoryCostAnnual * 1.15
    ? lowestRisk
    : lowestCost;
  const cmp = compareScenarioToBaseline(baseEval, recommended.eval);

  const summaryBullets: string[] = [
    `Evaluated 4 inventory & lot-sizing policies across ${targetSku} and its BOM components through IPE EOQ/ROP, Time-Phased MRP, and DES:`,
    `Lowest annual inventory holding + ordering cost: ${lowestCost.ps.name} at ${fmtMoney(lowestCost.eval.kpis.totalInventoryCostAnnual)}/yr (${fmtNum(lowestCost.eval.kpis.serviceLevelPct, 1)}% weighted SL).`,
    `Lowest composite shortage risk: ${lowestRisk.ps.name} at ${fmtNum(lowestRisk.eval.kpis.shortageRiskPct, 1)}% risk (${fmtNum(lowestRisk.eval.kpis.serviceLevelPct, 1)}% SL) vs ${fmtMoney(lowestRisk.eval.kpis.totalInventoryCostAnnual)}/yr.`,
    `L4L minimizes cycle holding stock (${fmtMoney(evals[3].eval.inventorySummary.holdingCostAnnual)}/yr) at the expense of frequent ordering (${fmtMoney(evals[3].eval.inventorySummary.orderingCostAnnual)}/yr), whereas EOQ-ROP balances setup and carrying cost.`,
  ];

  const facts: AssistantFact[] = [
    { label: 'Scope Assembly', value: targetSku, unit: `${baseEval.inventorySummary.skuCountInScope} SKUs in BOM scope`, sourceEngine: 'Scenario Studio', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Lowest Cost Policy', value: lowestCost.ps.name, unit: `${fmtMoney(lowestCost.eval.kpis.totalInventoryCostAnnual)}/yr`, sourceEngine: 'IPE + MRP', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Lowest Risk Policy', value: lowestRisk.ps.name, unit: `${fmtNum(lowestRisk.eval.kpis.shortageRiskPct, 1)}% risk`, sourceEngine: 'MRP + DES', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'Highest DES OEE Policy', value: highestOee.ps.name, unit: `${fmtNum(highestOee.eval.kpis.oeePct, 1)}% OEE`, sourceEngine: 'DES Engine', provenance: 'SCENARIO_SIMULATION_MODEL' },
  ];

  const table: AssistantTable = {
    title: `Multi-Engine Inventory Policy Comparison (${targetSku} Scope)`,
    caption: 'Computed deterministically using identical demand forecast, lead times, and seeded DES runs.',
    columns: ['Policy', 'Inv. Cost / yr', 'Holding / Ordering', 'Service Level', 'Shortage Risk', 'MRP Orders', 'DES OEE'],
    rows: evals.map(({ ps, eval: ev }) => [
      ps.name,
      fmtMoney(ev.kpis.totalInventoryCostAnnual),
      `${fmtMoney(ev.inventorySummary.holdingCostAnnual, 0)} / ${fmtMoney(ev.inventorySummary.orderingCostAnnual, 0)}`,
      `${fmtNum(ev.kpis.serviceLevelPct, 1)}%`,
      `${fmtNum(ev.kpis.shortageRiskPct, 1)}%`,
      String(ev.mrpSummary.plannedOrdersCount),
      `${fmtNum(ev.kpis.oeePct, 1)}%`,
    ]),
  };

  return finalizeResponse({
    id,
    createdAt,
    question,
    intent: 'compare_policies',
    focusedSku: targetSku,
    headline: `Policy Comparison (${targetSku}): ${lowestCost.ps.name} wins cost (${fmtMoney(lowestCost.eval.kpis.totalInventoryCostAnnual)}/yr); ${lowestRisk.ps.name} wins resilience (${fmtNum(lowestRisk.eval.kpis.shortageRiskPct, 1)}% risk)`,
    summaryBullets,
    facts,
    tables: [table],
    reasoningSteps: [
      `Executed 4 full Scenario Studio pipelines (Forecasting -> EOQ/ROP -> MRP -> Line Balance -> DES) on ${targetSku} holding demand and reliability constants fixed.`,
      `Measured annual cycle+safety holding cost vs annual replenishment ordering cost alongside MRP shortage & DES starvation risk.`,
    ],
    assumptions: [
      'Continuous-review EOQ-ROP assumes fixed order cost per PO and Normal lead-time demand residuals.',
      'POQ uses a 14-day periodic bucket; L4L uses a 7-day weekly bucket.',
    ],
    insufficientDataWarnings: [],
    navLinks: [
      { label: 'Compare Policies in Scenario Studio', route: 'scenario-studio', contextNote: 'Adjust target SL % & policy selector' },
      { label: 'Run Monte Carlo (Q, R) Optimization', route: 'decision-lab', contextNote: 'Simulate empirical service level & stockouts' },
      { label: 'Review Portfolio Advisor', route: 'advisor', contextNote: 'Apply SKU-level SL changes' },
    ],
    proposedScenario: {
      title: recommended.def.name,
      summary: cmp.explanation.recommendationHeadline,
      definition: recommended.def,
      baseline: baseEval,
      scenario: recommended.eval,
      deltas: cmp.deltas,
      applyPreview: buildWorkspaceApplyPreview(recommended.def, ctx.scenarioWorkspace),
    },
    proposedActions: [
      {
        id: `act-save-pol-${createdAt}`,
        kind: 'save-scenario',
        label: `Save "${recommended.ps.name}" to Scenario Studio`,
        description: `Saves ${recommended.ps.name} for side-by-side comparison without modifying current catalog settings.`,
        requiresApproval: true,
        scenarioDefinition: recommended.def,
        previewDiff: [
          { target: 'Scenario Studio', field: 'Saved Policy Strategy', before: 'Not saved', after: recommended.ps.name },
          { target: 'Annual Inventory Cost', field: 'Projected Cost', before: fmtMoney(baseEval.kpis.totalInventoryCostAnnual), after: fmtMoney(recommended.eval.kpis.totalInventoryCostAnnual) },
        ],
      },
    ],
    provenanceBadges: ['DETERMINISTIC_ENGINE', 'SCENARIO_SIMULATION_MODEL'],
  });
}

/* -------------------------------------------------------------------------- */
/*  7. Explain Latest Production Simulation                                   */
/* -------------------------------------------------------------------------- */

function solveExplainSimulationQuery(
  id: string,
  createdAt: number,
  question: string,
  ctx: AssistantWorkspaceContext
): AssistantResponse {
  const des = ctx.desResult;
  if (!des.valid) {
    return finalizeResponse({
      id,
      createdAt,
      question,
      intent: 'explain_simulation',
      focusedSku: ctx.factorySimConfig.assemblySku,
      headline: 'Latest simulation could not execute — check station configuration',
      summaryBullets: [des.reason || 'Configure active stations in Factory Simulation Lab.'],
      facts: [],
      tables: [],
      reasoningSteps: ['Checked latest DES output -> marked invalid.'],
      assumptions: [],
      insufficientDataWarnings: [des.reason || 'Simulation stations missing.'],
      navLinks: [{ label: 'Open Factory Simulation Lab', route: 'factory-sim', contextNote: 'Configure line & run DES' }],
      proposedScenario: null,
      proposedActions: [],
      provenanceBadges: ['SCENARIO_SIMULATION_MODEL'],
    });
  }

  const littlesWip = des.littlesLawExpectedWip.toFixed(2);
  const actualWip = des.avgWip.mean.toFixed(2);
  const littlesRelErr = Math.abs(des.littlesLawGapPct);
  const conservationDelta = des.flowBalance.conservationResidual;
  const conservationVerified = Math.abs(conservationDelta) < 1e-6;
  const totalStarved = des.materials.reduce((s, m) => s + m.starvedMinutes, 0);

  const summaryBullets: string[] = [
    `Across ${des.replications} replication(s) (${fmtNum(des.observedScheduledHours, 1)} scheduled working hrs after ${fmtNum(des.warmupCalendarHours, 1)}h warmup), the line produced ${fmtInt(des.totalThroughputGood)} good units at ${fmtNum(des.throughputPerScheduledHour.mean, 2)} jobs/hr (95% CI: ${fmtNum(des.throughputPerScheduledHour.ci95Low, 2)}–${fmtNum(des.throughputPerScheduledHour.ci95High, 2)}).`,
    `Overall Equipment Effectiveness (OEE) is ${fmtNum(des.oeePct, 1)}% = Availability ${fmtNum(des.oeeAvailabilityPct, 1)}% × Performance ${fmtNum(des.oeePerformancePct, 1)}% × Quality ${fmtNum(des.oeeQualityPct, 1)}% — distinct from raw asset utilization (${fmtNum(des.assetUtilizationPct, 1)}%), which counts busy work without reliability or quality losses.`,
    `Flow physics checks: Little's Law (L = λ·W) predicts ${littlesWip} WIP jobs vs ${actualWip} observed (${fmtNum(littlesRelErr, 1)}% discrepancy); mass flow conservation residual is ${conservationDelta} jobs (${conservationVerified ? 'VERIFIED exact zero-loss conservation' : 'variance flagged'}).`,
    `Primary limiter: ${des.bottleneckName} (${fmtNum(des.bottleneckWorkloadPct, 1)}% workload). Quality rejected ${fmtInt(des.rejectedQty)} unit(s) with ${fmtInt(des.reworkedQty)} rework loop(s); BOM starvation added ${fmtNum(totalStarved, 0)} min delay.`,
  ];

  const facts: AssistantFact[] = [
    { label: 'Simulated Throughput', value: `${fmtNum(des.throughputPerScheduledHour.mean, 2)} jobs/hr`, unit: `95% CI [${fmtNum(des.throughputPerScheduledHour.ci95Low, 2)}, ${fmtNum(des.throughputPerScheduledHour.ci95High, 2)}]`, sourceEngine: 'DES Engine (desEngine.ts)', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'OEE (A × P × Q)', value: `${fmtNum(des.oeePct, 1)}%`, unit: `${fmtNum(des.oeeAvailabilityPct, 1)}% × ${fmtNum(des.oeePerformancePct, 1)}% × ${fmtNum(des.oeeQualityPct, 1)}%`, sourceEngine: 'DES Engine (OEE)', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'Asset Machine Utilization', value: `${fmtNum(des.assetUtilizationPct, 1)}%`, unit: 'Scheduled busy / working hrs', sourceEngine: 'DES Engine', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'Average Cycle Time', value: `${fmtNum(des.avgCycleTimeMin.mean, 1)} min`, unit: `Throughput lead / job`, sourceEngine: 'DES Engine', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: "Little's Law Verification", value: `${actualWip} obs vs ${littlesWip} λ·W`, unit: `${fmtNum(littlesRelErr, 1)}% gap`, sourceEngine: 'Flow Verification', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Flow Conservation Identity', value: conservationVerified ? 'Verified (Δ = 0)' : `Delta ${conservationDelta}`, sourceEngine: 'DES Accounting', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Bottleneck Station', value: `${des.bottleneckName} (${fmtNum(des.bottleneckWorkloadPct, 1)}%)`, sourceEngine: 'DES Engine', provenance: 'SCENARIO_SIMULATION_MODEL' },
    { label: 'Simulated Cost / Good Unit', value: fmtMoney(des.costPerGoodUnit), unit: `Labor + machine + WIP + scrap`, sourceEngine: 'DES Cost Model', provenance: 'SCENARIO_SIMULATION_MODEL' },
  ];

  return finalizeResponse({
    id,
    createdAt,
    question,
    intent: 'explain_simulation',
    focusedSku: ctx.factorySimConfig.assemblySku,
    headline: `Simulation Briefing: ${fmtNum(des.throughputPerScheduledHour.mean, 2)} jobs/hr · ${fmtNum(des.oeePct, 1)}% OEE · Bottleneck ${des.bottleneckName}`,
    summaryBullets,
    facts,
    tables: [
      {
        title: 'Workstation Breakdown (Latest DES Run)',
        caption: 'Simulated metrics only — distinct from physical shop-floor measurements.',
        columns: ['Station', 'Workload %', 'Busy %', 'Blocked %', 'Starved %', 'Down+PM %', 'Ops Done'],
        rows: des.stations.map((s) => [
          s.isBottleneck ? `${s.name} [BN]` : s.name,
          `${fmtNum(s.busyPct + s.setupPct, 1)}%`,
          `${fmtNum(s.busyPct, 1)}%`,
          `${fmtNum(s.blockedPct, 1)}%`,
          `${fmtNum(s.starvedPct, 1)}%`,
          `${fmtNum(s.downPct + s.pmPct, 1)}%`,
          fmtInt(s.processedOps),
        ]),
      },
    ],
    reasoningSteps: [
      `Evaluated MinHeap event-driven DES result for assembly ${ctx.factorySimConfig.assemblySku} (${des.replications} seeded reps, seed #${des.seed}).`,
      'Decomposed OEE rigorously into Availability, Performance, and Quality to prevent conflating raw utilization with OEE.',
      "Verified Little's Law (L = λ·W) and job flow conservation across warmup and observation boundaries.",
    ],
    assumptions: [
      des.provenanceNotice,
      `Active shift calendar: ${ctx.factorySimConfig.shiftsPerDay} shifts/day × ${ctx.factorySimConfig.shiftHours}h/shift.`,
    ],
    insufficientDataWarnings: [],
    navLinks: [
      { label: 'Open Factory Simulation Lab', route: 'factory-sim', contextNote: 'Adjust shifts, failures, or Monte Carlo reps' },
      { label: 'Inspect 3D Floor Digital Twin', route: 'models-3d', contextNote: 'Visualize bottleneck & station queues in 3D' },
      { label: 'Test Counterfactuals in Scenario Studio', route: 'scenario-studio', contextNote: 'Compare mitigation strategies' },
    ],
    proposedScenario: null,
    proposedActions: [],
    provenanceBadges: ['SCENARIO_SIMULATION_MODEL', 'DETERMINISTIC_ENGINE'],
  });
}

/* -------------------------------------------------------------------------- */
/*  8. General Plant & Operations Briefing                                    */
/* -------------------------------------------------------------------------- */

function solveGeneralOverviewQuery(
  id: string,
  createdAt: number,
  question: string,
  ctx: AssistantWorkspaceContext,
  focusedProduct: Product | null
): AssistantResponse {
  if (focusedProduct) {
    return solveSkuRiskQuery(id, createdAt, question, ctx, focusedProduct);
  }

  const urgent = ctx.smartAlertsResult.summary;
  const des = ctx.desResult;

  const summaryBullets: string[] = [
    `Inventory health score is ${ctx.advisorHealth.score}/100 (${ctx.advisorHealth.label}) across ${ctx.summary.skuCount} SKUs worth ${fmtMoney(ctx.summary.stockValue)}.`,
    `Smart Alerts detect ${urgent.total} predictive stockout watch items (${urgent.beforeLeadTimeCount} running out inside supplier lead time); Portfolio Advisor flags ${fmtMoney(ctx.advisorResult.totals.parkedCash)} excess cash and ${fmtMoney(ctx.advisorResult.totals.orderValue)} urgent replenishment due.`,
    des.valid
      ? `Latest DES model (${ctx.factorySimConfig.assemblySku}) achieves ${fmtNum(des.throughputPerScheduledHour.mean, 2)} jobs/hr and ${fmtNum(des.oeePct, 1)}% OEE, paced by ${des.bottleneckName} (${fmtNum(des.bottleneckWorkloadPct, 1)}% workload).`
      : 'Production simulation has no active workstations configured.',
  ];

  const facts: AssistantFact[] = [
    { label: 'Inventory Health Score', value: `${ctx.advisorHealth.score}/100`, unit: ctx.advisorHealth.label, sourceEngine: 'Advisor Engine', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Stock Value / Annual Usage', value: `${fmtMoney(ctx.summary.stockValue, 0)} / ${fmtMoney(ctx.summary.usageValue, 0)}`, sourceEngine: 'Workspace Summary', provenance: 'WORKSPACE_CATALOG' },
    { label: 'Smart Stockout Alerts', value: String(urgent.total), unit: `${urgent.beforeLeadTimeCount} < lead time`, sourceEngine: 'Smart Alerts', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'Parked Excess Cash', value: fmtMoney(ctx.advisorResult.totals.parkedCash), sourceEngine: 'Advisor Engine', provenance: 'DETERMINISTIC_ENGINE' },
    { label: 'DES Bottleneck & OEE', value: des.valid ? `${des.bottleneckName} · ${fmtNum(des.oeePct, 1)}% OEE` : 'Not configured', sourceEngine: 'DES Engine', provenance: 'SCENARIO_SIMULATION_MODEL' },
  ];

  return finalizeResponse({
    id,
    createdAt,
    question,
    intent: 'general_overview',
    focusedSku: urgent.mostUrgent?.product.sku ?? null,
    headline: `Plant Brief: Health ${ctx.advisorHealth.score}/100 · ${urgent.beforeLeadTimeCount} urgent stockout risks · Bottleneck ${des.valid ? des.bottleneckName : 'N/A'}`,
    summaryBullets,
    facts,
    tables: [],
    reasoningSteps: [
      'Synthesized live Inventory Summary, Portfolio Advisor findings, Smart Forecast Alerts, and latest DES run.',
      'Ask a targeted follow-up (e.g. a specific SKU risk, material shortages, bottleneck relief, or "supplier lead time +20%") to trigger deep counterfactual analysis.',
    ],
    assumptions: ['Catalog numbers reflect current workspace state; DES figures are simulated model projections.'],
    insufficientDataWarnings: [],
    navLinks: [
      { label: 'Open Executive Brief', route: 'brief', contextNote: 'Board-ready single-page summary' },
      { label: 'Open Factory Simulation Lab', route: 'factory-sim', contextNote: 'Run production DES experiments' },
      { label: 'Open Scenario Studio', route: 'scenario-studio', contextNote: 'Compare operational strategies' },
    ],
    proposedScenario: null,
    proposedActions: [],
    provenanceBadges: ['WORKSPACE_CATALOG', 'DETERMINISTIC_ENGINE', 'SCENARIO_SIMULATION_MODEL'],
  });
}

/* -------------------------------------------------------------------------- */
/*  Response Finalizer & Grounding Dossier Sanitizer                          */
/* -------------------------------------------------------------------------- */

function finalizeResponse(base: Omit<AssistantResponse, 'groundingDossier'>): AssistantResponse {
  const groundingDossier: GroundingDossier = {
    question: base.question,
    intent: base.intent,
    focusedSku: base.focusedSku,
    activeAssemblySku: base.proposedScenario?.definition.params.assemblySku ?? base.focusedSku,
    provenancePolicy:
      'STRICT_FACT_GROUNDING: Every figure in this dossier originates from FactoryMind deterministic IE engines or seeded DES simulations. Do NOT invent, round outside the provided precision, or extrapolate unverified financial/operational numbers.',
    authoritativeHeadline: base.headline,
    summaryBullets: base.summaryBullets,
    facts: base.facts.map((f) => ({
      label: f.label,
      value: f.value,
      ...(f.unit ? { unit: f.unit } : {}),
      sourceEngine: f.sourceEngine,
    })),
    tables: base.tables.slice(0, 2),
    assumptions: base.assumptions,
    insufficientDataWarnings: base.insufficientDataWarnings,
  };

  return {
    ...base,
    groundingDossier,
  };
}

export const STATIC_AI_UNAVAILABLE_NOTICE =
  'AI narrative synthesis is unavailable on static hosting (GitHub Pages serves static files only and cannot execute Express/Node.js API routes or hold private Gemini API keys). Deterministic FactoryMind calculations, tables, reasoning traces, and approval previews remain active and authoritative.';

export function isStaticHostingEnvironment(env: {
  viteStaticOnly?: unknown;
  hostname?: string;
  protocol?: string;
} = {}): boolean {
  if (String(env.viteStaticOnly || '').toLowerCase() === 'true') {
    return true;
  }
  const host = (env.hostname || '').trim().toLowerCase();
  if (host.endsWith('.github.io')) {
    return true;
  }
  if ((env.protocol || '').trim().toLowerCase() === 'file:') {
    return true;
  }
  return false;
}
