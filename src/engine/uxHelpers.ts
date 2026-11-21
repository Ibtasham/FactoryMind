/**
 * Pure UX, validation, dataset provenance, onboarding, help, and cross-module
 * search logic. Decoupled from React so every rule is unit-tested via node:test.
 */

export const DEMO_CATALOG_SKUS = [
  'STL-1045',
  'ALU-6061',
  'BLT-M8X40',
  'NUT-M8',
  'BRG-6205',
  'GSK-R120',
  'MOT-05HP',
  'PNL-CTL3',
  'CNV-B500',
  'HYD-SK21',
  'LUB-ISO68',
  'WLD-ER70',
  'ASM-PA100',
  'ASM-CM200',
  'ASM-GS350',
  'ASM-CP120',
  'KIT-MK5',
] as const;

export type ProductFormField =
  | 'sku'
  | 'name'
  | 'unit'
  | 'unitCost'
  | 'stock'
  | 'annualDemand'
  | 'orderCost'
  | 'holdingRate'
  | 'leadTime'
  | 'serviceLevel'
  | 'historyText';

export interface ProductFormInput {
  sku: string;
  name: string;
  unit: string;
  unitCost: string;
  stock: string;
  annualDemand: string;
  orderCost: string;
  holdingRate: string;
  leadTime: string;
  serviceLevel: string;
  historyText: string;
}

export interface ProductFormValidationResult {
  valid: boolean;
  errors: Partial<Record<ProductFormField, string>>;
  parsedHistory: number[];
}

export function validateProductForm(
  input: ProductFormInput,
  options: { existingSkus?: string[]; editingProductSku?: string } = {}
): ProductFormValidationResult {
  const errors: Partial<Record<ProductFormField, string>> = {};
  const skuNorm = input.sku.trim().toUpperCase();
  const editingNorm = options.editingProductSku?.trim().toUpperCase();

  if (!skuNorm) {
    errors.sku = 'Enter a unique SKU code (e.g. BRG-6206).';
  } else if (!/^[A-Z0-9][A-Z0-9\-_.]{1,31}$/.test(skuNorm)) {
    errors.sku = 'Use 2–32 letters, numbers, hyphens, dots, or underscores.';
  } else if (options.existingSkus) {
    const conflict = options.existingSkus.some(
      (s) => s.trim().toUpperCase() === skuNorm && s.trim().toUpperCase() !== editingNorm
    );
    if (conflict) {
      errors.sku = `SKU "${skuNorm}" already exists in the catalogue.`;
    }
  }

  if (!input.name.trim()) {
    errors.name = 'Product name is required.';
  } else if (input.name.trim().length < 2) {
    errors.name = 'Enter at least 2 characters for the item name.';
  }

  if (!input.unit.trim()) {
    errors.unit = 'Specify a unit of measure (e.g. pcs, m, kg).';
  }

  const parseNum = (raw: string): number => (raw.trim() === '' ? NaN : Number(raw));

  const unitCost = parseNum(input.unitCost);
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    errors.unitCost = 'Unit cost must be 0 or greater.';
  }

  const stock = parseNum(input.stock);
  if (!Number.isFinite(stock) || stock < 0) {
    errors.stock = 'Current stock cannot be negative.';
  }

  const annualDemand = parseNum(input.annualDemand);
  if (!Number.isFinite(annualDemand) || annualDemand < 0) {
    errors.annualDemand = 'Annual demand must be 0 or greater.';
  }

  const orderCost = parseNum(input.orderCost);
  if (!Number.isFinite(orderCost) || orderCost < 0) {
    errors.orderCost = 'Order/setup cost must be 0 or greater.';
  }

  const holdingRate = parseNum(input.holdingRate);
  if (!Number.isFinite(holdingRate) || holdingRate < 0.1 || holdingRate > 100) {
    errors.holdingRate = 'Holding rate must be between 0.1% and 100%.';
  }

  const leadTime = parseNum(input.leadTime);
  if (!Number.isFinite(leadTime) || leadTime < 0 || leadTime > 3650) {
    errors.leadTime = 'Lead time must be between 0 and 3,650 days.';
  }

  const serviceLevel = parseNum(input.serviceLevel);
  if (!Number.isFinite(serviceLevel) || serviceLevel < 50 || serviceLevel > 99.9) {
    errors.serviceLevel = 'Service level must be between 50% and 99.9%.';
  }

  const parsedHistory: number[] = [];
  const rawTokens = input.historyText
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawTokens.length > 0) {
    for (const tok of rawTokens) {
      const v = Number(tok);
      if (!Number.isFinite(v) || v < 0) {
        errors.historyText = `Invalid demand value "${tok}". Enter non-negative numbers separated by commas.`;
        break;
      }
      parsedHistory.push(v);
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    parsedHistory,
  };
}

export function validateStockMove(
  qtyRaw: string,
  type: 'in' | 'out',
  currentStock: number
): { valid: boolean; error?: string; qty: number } {
  const qty = qtyRaw.trim() === '' ? NaN : Number(qtyRaw);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { valid: false, error: 'Enter a quantity strictly greater than 0.', qty: 0 };
  }
  if (type === 'out' && qty > currentStock) {
    return {
      valid: false,
      error: `Cannot issue ${qty.toLocaleString()} units — only ${currentStock.toLocaleString()} currently on hand.`,
      qty,
    };
  }
  return { valid: true, qty };
}

export function validateBomLines(
  lines: Array<{ componentId: string; qtyPer: number }>,
  parentId: string
): { valid: boolean; error?: string; lineErrors: Record<number, string> } {
  const lineErrors: Record<number, string> = {};
  const seen = new Set<string>();

  lines.forEach((l, idx) => {
    if (!l.componentId) {
      lineErrors[idx] = 'Choose a component SKU.';
      return;
    }
    if (l.componentId === parentId) {
      lineErrors[idx] = 'An assembly cannot reference itself in its own BOM.';
      return;
    }
    if (seen.has(l.componentId)) {
      lineErrors[idx] = 'Duplicate component — combine quantities into a single line.';
      return;
    }
    seen.add(l.componentId);
    if (!Number.isFinite(l.qtyPer) || l.qtyPer <= 0) {
      lineErrors[idx] = 'Quantity per assembly must be greater than 0.';
    }
  });

  const firstErr = Object.values(lineErrors)[0];
  return {
    valid: Object.keys(lineErrors).length === 0,
    error: firstErr,
    lineErrors,
  };
}

export type DatasetProvenanceKind = 'demo' | 'modified-demo' | 'custom' | 'empty';

export interface DatasetProvenance {
  kind: DatasetProvenanceKind;
  label: string;
  summary: string;
  skuCount: number;
  demoSkuCount: number;
  customSkuCount: number;
  importedSkuCount: number;
}

export function computeDatasetProvenance(
  products: Array<{ sku: string; demandSource?: string }>,
  transactionCount = 0
): DatasetProvenance {
  if (!products.length) {
    return {
      kind: 'empty',
      label: 'Empty Workspace',
      summary: 'No SKUs loaded. Add a SKU, import CSV/JSON, or restore the 17-SKU demo dataset in Settings.',
      skuCount: 0,
      demoSkuCount: 0,
      customSkuCount: 0,
      importedSkuCount: 0,
    };
  }

  const demoSet = new Set<string>(DEMO_CATALOG_SKUS);
  let demoSkuCount = 0;
  let customSkuCount = 0;
  let importedSkuCount = 0;

  products.forEach((p) => {
    const skuUp = String(p.sku || '').trim().toUpperCase();
    if (p.demandSource === 'imported') {
      importedSkuCount++;
    } else if (demoSet.has(skuUp) && (p.demandSource === 'demo' || p.demandSource === undefined)) {
      demoSkuCount++;
    } else {
      customSkuCount++;
    }
  });

  const allExactDemo =
    products.length === DEMO_CATALOG_SKUS.length &&
    demoSkuCount === DEMO_CATALOG_SKUS.length &&
    customSkuCount === 0 &&
    importedSkuCount === 0 &&
    transactionCount <= 34;

  if (allExactDemo) {
    return {
      kind: 'demo',
      label: 'Demo Dataset (Seeded 17-SKU Plant)',
      summary: 'Running on FactoryMind’s reproducible 17-SKU manufacturing benchmark (5 BOMs, 34 ledger entries). Replace anytime via CSV/JSON.',
      skuCount: products.length,
      demoSkuCount,
      customSkuCount,
      importedSkuCount,
    };
  }

  if (demoSkuCount > 0) {
    return {
      kind: 'modified-demo',
      label: 'Modified Demo + User Data',
      summary: `${demoSkuCount} demo SKUs combined with ${customSkuCount + importedSkuCount} user/imported SKUs or live stock updates.`,
      skuCount: products.length,
      demoSkuCount,
      customSkuCount,
      importedSkuCount,
    };
  }

  return {
    kind: 'custom',
    label: 'Custom Plant Dataset',
    summary: `Operating on ${products.length} user-supplied or imported SKUs (${importedSkuCount} CSV/JSON imported).`,
    skuCount: products.length,
    demoSkuCount,
    customSkuCount,
    importedSkuCount,
  };
}

export interface OnboardingStepSpec {
  id: string;
  title: string;
  description: string;
  route: string;
  ctaLabel: string;
}

export const ONBOARDING_STEPS: OnboardingStepSpec[] = [
  {
    id: 'review-alerts',
    title: 'Inspect replenishment & stockout risks',
    description: 'Check Smart Forecast Alerts and the Reorder Exception Queue to catch items below ROP.',
    route: 'inventory',
    ctaLabel: 'Open Inventory',
  },
  {
    id: 'run-des-sim',
    title: 'Run Discrete-Event Production Simulation',
    description: 'Model machine breakdowns, shift calendars, queue WIP, and OEE in Factory Simulation Lab.',
    route: 'factory-sim',
    ctaLabel: 'Open Sim Lab',
  },
  {
    id: 'compare-scenarios',
    title: 'Test counterfactuals in Scenario Studio',
    description: 'Compare lead-time shocks, machine additions, and safety stock targets before applying.',
    route: 'scenario-studio',
    ctaLabel: 'Open Scenarios',
  },
  {
    id: 'inspect-3d-twin',
    title: 'Explore the connected 3D Digital Twin',
    description: 'Click warehouse racks, machines, or exploded BOM sub-assemblies tied to live store metrics.',
    route: 'models-3d',
    ctaLabel: 'Open 3D Twin',
  },
  {
    id: 'ask-assistant',
    title: 'Query the Decision Assistant',
    description: 'Ask why an SKU is flagged or which workstation bottlenecks throughput using verified calculations.',
    route: 'decision-assistant',
    ctaLabel: 'Open Assistant',
  },
];

export function computeOnboardingProgress(
  completedIds: string[] | undefined,
  total = ONBOARDING_STEPS.length
): { completed: number; total: number; pct: number; done: boolean } {
  const validSet = new Set(ONBOARDING_STEPS.map((s) => s.id));
  const uniqueCompleted = new Set((completedIds || []).filter((id) => validSet.has(id)));
  const completed = Math.min(total, uniqueCompleted.size);
  const pct = total > 0 ? Math.round((completed / total) * 100) : 100;
  return { completed, total, pct, done: completed >= total };
}

export interface ModelAssumptionSpec {
  id: string;
  title: string;
  formula: string;
  units: string;
  assumptions: string[];
  caveats: string;
}

export const MODEL_ASSUMPTIONS: Record<string, ModelAssumptionSpec> = {
  eoq: {
    id: 'eoq',
    title: 'Wilson EOQ, Finite-Rate EPQ & Safety Stock ROP',
    formula: 'Q* = sqrt(2DS / H) · ROP = d̄·L + z·σ_d·sqrt(L) · H = UnitCost × HoldingRate%',
    units: 'Demand (units/yr), Lead time (days), Cost ($/order & $/unit/yr), 365-day year',
    assumptions: [
      'Deterministic average demand rate (d̄ = D/365) with normally distributed lead-time demand variance.',
      'Instantaneous replenishment for Wilson EOQ; finite replenishment rate P > D for EPQ.',
      'When monthly history is absent, daily demand σ defaults to 30% of d̄ (marked ~σ in tables).',
    ],
    caveats: 'Verify holding rate reflects capital + storage + obsolescence before locking PO quantities.',
  },
  forecast: {
    id: 'forecast',
    title: '12-Model Rolling-Origin Cross-Validation',
    formula: 'WAPE = Σ|e_t| / Σ|y_t| · PI(95%) = ŷ ± 1.96·σ_residual·sqrt(h)',
    units: 'Monthly periods; prediction intervals expand with horizon step h',
    assumptions: [
      'Rolling-origin evaluation trains strictly on past windows without future leakage.',
      'Croston & SBA decompose intermittent demand into inter-arrival interval and non-zero size.',
      'Requires sufficient series length for seasonal decomposition (seasonPeriod × 2 recommended).',
    ],
    caveats: 'Short histories (<6 periods) trigger automatic fallback toward simpler smoothing/mean baselines.',
  },
  production: {
    id: 'production',
    title: 'Multi-Level BOM Explosion & Time-Phased MRP',
    formula: 'NetReq_t = max(0, GrossReq_t + SafetyStock − OnHand − ScheduledReceipts_t)',
    units: 'Days/weeks planning buckets; integer or fractional BOM qtyPer',
    assumptions: [
      'Low-level coding orders assemblies before shared sub-components to aggregate gross demand accurately.',
      'Lead-time offsetting shifts planned order releases earlier by exact component leadTimeDays.',
      'Circular BOM dependencies are automatically detected and halted before explosion.',
    ],
    caveats: 'Scheduled receipts must be manually logged if open supplier POs are not yet received into stock.',
  },
  'factory-sim': {
    id: 'factory-sim',
    title: 'Priority-Queue Discrete-Event Simulation (DES) & OEE',
    formula: 'OEE = Availability × Performance × Quality · Availability = OperatingTime / PlannedShiftTime',
    units: 'Simulation clock in minutes; arrival rates in jobs/hr; seeded PRNG (Mulberry32)',
    assumptions: [
      'Workstations process jobs across finite intermediate buffers; blocked stations pause upstream flow.',
      'OEE cleanly separates downtime/shifts (Availability), speed/idle losses (Performance), and scrap (Quality).',
      'Warmup hours are discarded from steady-state averages; deterministic mode suppresses random jitter.',
    ],
    caveats: 'Simulated telemetry is mathematically derived from configured distributions—not live PLC sensor feeds.',
  },
  'scenario-studio': {
    id: 'scenario-studio',
    title: 'Cross-Module Counterfactual Pipeline',
    formula: 'Forecast → Inventory (Q,R) → MRP Netting → Line Balance → DES Replication Suite',
    units: 'Multipliers normalized against active Workspace Baseline (= 1.00×)',
    assumptions: [
      'Consistent demand, lead-time, scrap, and shift parameters propagate simultaneously across all engines.',
      'All baseline vs scenario comparisons use common random numbers (CRN) via matching seed.',
      'Applying a scenario mutates workspace configuration with full confirmation and audit logging.',
    ],
    caveats: 'Cost deltas reflect configured holding, ordering, labor, WIP, and stockout penalty assumptions.',
  },
  'decision-lab': {
    id: 'decision-lab',
    title: 'Stochastic (Q,R), Newsvendor & Queueing Solvers',
    formula: 'Critical Ratio CR = C_u / (C_u + C_o) · Erlang-C / Kingman VUT M/G/1 approximations',
    units: 'Daily simulation horizon (Monte Carlo), single-period units (Newsvendor), hourly rates (Queueing)',
    assumptions: [
      'Monte Carlo simulates daily demand & stochastic lead-time draws using seeded PRNG.',
      'Newsvendor assumes single perishable selling window with salvage recovery C_o = c − v.',
      'Queueing stability requires traffic intensity ρ = λ / (c·μ) < 1 unless finite buffer K bounds M/M/c/K.',
    ],
    caveats: 'Exceeding ρ ≥ 1 causes unbounded queue growth in infinite-buffer queueing models.',
  },
  'models-3d': {
    id: 'models-3d',
    title: 'Data-Connected 3D Digital Twin & Telemetry',
    formula: 'State Mapping: OnHand vs ROP/SafetyStock (Racks) · DES Utilization/Downtime (Stations)',
    units: 'Meters (scene scale); counts & percentages directly linked to Store & DES engine',
    assumptions: [
      'Every rack fill level, alert color, and machine KPI originates from Workspace Store or seeded DES runs.',
      '2D SVG twin provides identical interactive inspection on devices without hardware WebGL acceleration.',
      'Before/After toggle switches scene state cleanly between Baseline and Scenario Studio evaluations.',
    ],
    caveats: 'Playback clock steps through simulated DES frames—never fabricated live shop-floor sensors.',
  },
};

export interface HelpTopicSpec {
  id: string;
  category: 'Workflow' | 'Inventory' | 'Simulation' | 'Quality & Twin' | 'Accessibility';
  title: string;
  summary: string;
  details: string;
  route?: string;
  keywords: string[];
}

export const HELP_TOPICS: HelpTopicSpec[] = [
  {
    id: 'help-dataset-origin',
    category: 'Workflow',
    title: 'Demo Dataset vs Your Own Plant Data',
    summary: 'How FactoryMind identifies the seeded 17-SKU benchmark vs imported or custom SKUs.',
    details:
      'On first launch, FactoryMind seeds 17 realistic industrial SKUs, 5 BOMs, and 34 transactions so every solver works immediately. A provenance banner on the Dashboard shows whether you are viewing the Demo Dataset, Modified Demo Data, or a Custom Plant Dataset. You can import your own CSV/JSON or clear the workspace in Settings.',
    route: 'settings',
    keywords: ['demo', 'seed', 'csv', 'import', 'custom', 'reset', 'dataset'],
  },
  {
    id: 'help-eoq-rop',
    category: 'Inventory',
    title: 'EOQ, Reorder Point & Fallback Volatility (~σ)',
    summary: 'Exact formulas used across Inventory, EOQ & ROP, and Advisor.',
    details:
      'Wilson EOQ balances ordering cost (S) against annual holding cost (H = UnitCost × HoldingRate%). Reorder Point adds expected lead-time demand (d̄·L) and safety stock (z·σ_d·√L). Items marked ~σ have no monthly history yet and use a transparent 30% daily volatility fallback until history is added.',
    route: 'eoq',
    keywords: ['eoq', 'rop', 'safety stock', 'sigma', 'holding', 'order cost', 'lead time'],
  },
  {
    id: 'help-des-oee',
    category: 'Simulation',
    title: 'Discrete-Event Simulation vs Monte Carlo Inventory',
    summary: 'Why Factory Simulation Lab uses an event-driven priority queue.',
    details:
      'Monte Carlo (Decision Lab) samples daily inventory demand and lead times, whereas Factory Simulation Lab runs a chronological min-heap priority queue tracking individual jobs, buffers, operator constraints, shift calendars, Weibull/exponential breakdowns, and rework loops to measure Availability × Performance × Quality (OEE).',
    route: 'factory-sim',
    keywords: ['des', 'simulation', 'oee', 'bottleneck', 'breakdown', 'queue', 'wip', 'shift'],
  },
  {
    id: 'help-scenario-studio',
    category: 'Simulation',
    title: 'Testing Operational Changes in Scenario Studio',
    summary: 'Compare demand, lead time, machine, and shift changes safely.',
    details:
      'Scenario Studio links Forecasting → Inventory → MRP → Line Balancing → DES with shared units and common random seeds. Compare any strategy side-by-side against your active Baseline, inspect per-driver attribution, and preview exact SKU/station changes before clicking Apply to Workspace.',
    route: 'scenario-studio',
    keywords: ['scenario', 'what if', 'counterfactual', 'sensitivity', 'apply', 'baseline'],
  },
  {
    id: 'help-3d-twin',
    category: 'Quality & Twin',
    title: 'Using the 3D Digital Twin & 2D Fallback',
    summary: 'Inspect BOM assemblies, warehouse racks, and bottleneck stations.',
    details:
      'Click any machine or warehouse rack in 3D/2D view to view real store stock or DES telemetry. Use the Explode slider for assembly inspection, Play Trace to scrub hourly DES states, and Before/After toggles to visualize scenario impact.',
    route: 'models-3d',
    keywords: ['3d', 'twin', 'bom', 'explode', 'rack', 'machine', 'webgl'],
  },
  {
    id: 'help-accessibility',
    category: 'Accessibility',
    title: 'Keyboard Navigation, Chart Tables & Reduced Motion',
    summary: 'Accessible shortcuts, chart data tables, and visual comfort controls.',
    details:
      'Press Cmd/Ctrl + K anytime to search modules, SKUs, scenarios, and help topics using arrow keys. On any Line, Bar, Pareto, or Donut chart, focus the chart and use Left/Right Arrow keys to inspect values or toggle "Data table" to read structured values. Reduced Motion honors both OS settings and the Settings toggle.',
    route: 'settings',
    keywords: ['keyboard', 'shortcut', 'accessibility', 'a11y', 'chart', 'table', 'motion', 'screen reader'],
  },
];

export interface SearchableRoute {
  id: string;
  label: string;
  subtitle: string;
  group: string;
}

export interface SearchableProduct {
  id: string;
  sku: string;
  name: string;
  category: string;
  stock: number;
  unit: string;
}

export interface SearchableScenario {
  id: string;
  name: string;
  notes?: string;
}

export type WorkbenchSearchResult =
  | { kind: 'route'; id: string; title: string; meta: string; routeId: string }
  | { kind: 'sku'; id: string; title: string; meta: string; productId: string }
  | { kind: 'scenario'; id: string; title: string; meta: string; scenarioId: string }
  | { kind: 'help'; id: string; title: string; meta: string; helpId: string; routeId?: string };

export function searchWorkbench(input: {
  query: string;
  routes: SearchableRoute[];
  products: SearchableProduct[];
  scenarios?: SearchableScenario[];
  helpTopics?: HelpTopicSpec[];
}): WorkbenchSearchResult[] {
  const q = input.query.trim().toLowerCase();
  const routes = input.routes;
  const products = input.products;
  const scenarios = input.scenarios || [];
  const helpTopics = input.helpTopics || HELP_TOPICS;

  if (!q) {
    return [
      ...routes.slice(0, 6).map((r) => ({
        kind: 'route' as const,
        id: `route:${r.id}`,
        title: r.label,
        meta: r.group,
        routeId: r.id,
      })),
      ...products.slice(0, 4).map((p) => ({
        kind: 'sku' as const,
        id: `sku:${p.id}`,
        title: `${p.sku} · ${p.name}`,
        meta: `${p.stock.toLocaleString()} ${p.unit} · ${p.category}`,
        productId: p.id,
      })),
    ];
  }

  const scoreMatch = (primary: string, secondary = ''): number => {
    const pLow = primary.toLowerCase();
    const sLow = secondary.toLowerCase();
    if (pLow === q) return 100;
    if (pLow.startsWith(q)) return 80;
    if (pLow.includes(q)) return 60;
    if (sLow.includes(q)) return 35;
    return 0;
  };

  const ranked: Array<{ score: number; item: WorkbenchSearchResult }> = [];

  routes.forEach((r) => {
    const sc = scoreMatch(r.label, `${r.subtitle} ${r.group}`);
    if (sc > 0) {
      ranked.push({
        score: sc + 5,
        item: {
          kind: 'route',
          id: `route:${r.id}`,
          title: r.label,
          meta: `${r.group} · ${r.subtitle}`,
          routeId: r.id,
        },
      });
    }
  });

  products.forEach((p) => {
    const sc = Math.max(scoreMatch(p.sku, p.category), scoreMatch(p.name, p.category));
    if (sc > 0) {
      ranked.push({
        score: sc + 2,
        item: {
          kind: 'sku',
          id: `sku:${p.id}`,
          title: `${p.sku} · ${p.name}`,
          meta: `${p.stock.toLocaleString()} ${p.unit} · ${p.category}`,
          productId: p.id,
        },
      });
    }
  });

  scenarios.forEach((s) => {
    const sc = scoreMatch(s.name, s.notes || '');
    if (sc > 0) {
      ranked.push({
        score: sc,
        item: {
          kind: 'scenario',
          id: `scenario:${s.id}`,
          title: s.name,
          meta: s.notes || 'Saved / preset counterfactual scenario',
          scenarioId: s.id,
        },
      });
    }
  });

  helpTopics.forEach((h) => {
    const sc = scoreMatch(h.title, `${h.summary} ${h.keywords.join(' ')}`);
    if (sc > 0) {
      ranked.push({
        score: sc - 3,
        item: {
          kind: 'help',
          id: `help:${h.id}`,
          title: h.title,
          meta: `${h.category} · ${h.summary}`,
          helpId: h.id,
          routeId: h.route,
        },
      });
    }
  });

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)
    .map((r) => r.item);
}
