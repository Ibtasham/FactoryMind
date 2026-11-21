/**
 * Consolidated Inventory & Production Operations Report Engine.
 * Pure TypeScript, zero DOM dependencies.
 */

import { fmtCover, fmtInt, fmtMoney, fmtNum, shortDate } from './formatters.ts';
import { abcAnalysis, AbcRow, abcSummary, StockStatus } from './ipe.ts';
import { compareAlgorithms, getBenchmark, LineBalTaskInput } from './linebal.ts';
import { LotRule, MrpItemInput, MrpPlanResult, mrpPlan } from './mrp.ts';
import { computeMetrics, Product, ProductMetrics, WorkspaceSettings, WorkspaceSummary } from '../store/store.ts';

export interface ReportScopeOptions {
  category?: string;
  status?: 'all' | 'action' | 'ok';
  buildQty?: number;
  needInDays?: number;
  horizonDays?: number;
  lotRule?: LotRule;
  benchmarkKey?: string;
  cycleTime?: number;
  selectedAssemblyId?: string;
  customTasks?: LineBalTaskInput[];
}

export interface ReportInventoryRow {
  product: Product;
  metrics: ProductMetrics;
  abcClass: 'A' | 'B' | 'C';
  abcCumulativePct: number;
  suggestedPoValue: number;
  turnoverRatio: number | null;
}

export interface ReportCategoryRow {
  category: string;
  skuCount: number;
  stockValue: number;
  usageValue: number;
  sharePct: number;
  turnover: number | null;
  actionCount: number;
}

export interface AssemblyReadinessRow {
  product: Product;
  bomLineCount: number;
  unitBomCost: number;
  buildableNow: number;
  bottleneckSku: string;
  bottleneckName: string;
  batchQty: number;
  totalNetUnits: number;
  netReqSpend: number;
  shortageCount: number;
  lateOrderCount: number;
  plan: MrpPlanResult;
}

export interface OperationsReportSnapshot {
  generatedTs: number;
  generatedIso: string;
  generatedDisplay: string;
  scope: Required<Omit<ReportScopeOptions, 'customTasks'>> & { customTasks?: LineBalTaskInput[] };
  policy: {
    cover: number;
    serviceLow: number;
    serviceHigh: number;
  };
  inventory: {
    totalCatalogSkus: number;
    filteredSkuCount: number;
    stockValue: number;
    usageValue: number;
    turnover: number | null;
    avgCoverMonths: number | null;
    openPoValue: number;
    counts: Record<StockStatus, number>;
    abcStats: ReturnType<typeof abcSummary>;
    rows: ReportInventoryRow[];
  };
  replenishment: {
    rows: ReportInventoryRow[];
    totalPoValue: number;
    totalOrderUnits: number;
  };
  categories: ReportCategoryRow[];
  production: {
    assemblies: AssemblyReadinessRow[];
    selectedAssembly: AssemblyReadinessRow | null;
    totalBuildableAssemblies: number;
    totalShortages: number;
    totalLateOrders: number;
    totalNetReqSpend: number;
    lineBalance: {
      benchmarkKey: string;
      benchmarkName: string;
      cycleTime: number;
      taskCount: number;
      totalWorkTime: number;
      theoreticalMin: number;
      bestAlgorithm: string;
      bestStations: number | null;
      efficiencyPct: number | null;
      balanceDelayPct: number | null;
      hourlyOutput: number | null;
      comparison: Array<{
        algorithm: string;
        label: string;
        valid: boolean;
        stationCount: number | null;
        efficiency: number | null;
        balanceDelay: number | null;
        smoothnessIndex: number | null;
      }>;
    };
  };
}

function csvCell(v: unknown): string {
  const raw = String(v == null ? '' : v);
  const safe = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(safe)) return '"' + safe.replace(/"/g, '""') + '"';
  return safe;
}

function buildCSV(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

function recursiveBomMaterialCost(
  productId: string,
  byId: Record<string, Product>,
  visited: Set<string> = new Set()
): number {
  if (visited.has(productId)) return 0;
  const prod = byId[productId];
  if (!prod) return 0;
  if (!prod.bom || prod.bom.length === 0) return prod.unitCost;
  const nextVisited = new Set(visited);
  nextVisited.add(productId);
  return prod.bom.reduce((sum, line) => {
    const child = byId[line.componentId];
    if (!child) return sum;
    const unitMaterial =
      child.bom && child.bom.length > 0
        ? recursiveBomMaterialCost(child.id, byId, nextVisited)
        : child.unitCost;
    return sum + unitMaterial * line.qtyPer;
  }, 0);
}

function leafRequirementsPerUnit(
  productId: string,
  byId: Record<string, Product>,
  multiplier = 1,
  out: Record<string, number> = {},
  visited: Set<string> = new Set()
): Record<string, number> {
  if (visited.has(productId)) return out;
  const prod = byId[productId];
  if (!prod || !prod.bom || prod.bom.length === 0) return out;
  const nextVisited = new Set(visited);
  nextVisited.add(productId);
  for (const line of prod.bom) {
    const child = byId[line.componentId];
    if (!child) continue;
    const req = multiplier * line.qtyPer;
    if (child.bom && child.bom.length > 0) {
      leafRequirementsPerUnit(child.id, byId, req, out, nextVisited);
    } else {
      out[child.id] = (out[child.id] || 0) + req;
    }
  }
  return out;
}

export function buildOperationsReport(
  products: Product[],
  _summary: WorkspaceSummary,
  settings: WorkspaceSettings,
  options: ReportScopeOptions = {}
): OperationsReportSnapshot {
  const scope: OperationsReportSnapshot['scope'] = {
    category: options.category || 'ALL',
    status: options.status || 'all',
    buildQty: Math.max(1, Math.round(options.buildQty ?? 25)),
    needInDays: Math.max(0, Math.round(options.needInDays ?? 35)),
    horizonDays: Math.max(14, Math.round(options.horizonDays ?? 60)),
    lotRule: options.lotRule || 'l4l',
    benchmarkKey: options.benchmarkKey || 'bosch-13',
    cycleTime: Math.max(1, Number(options.cycleTime) || 10),
    selectedAssemblyId: options.selectedAssemblyId || '',
    ...(Array.isArray(options.customTasks) ? { customTasks: options.customTasks } : {}),
  };

  const generatedTs = Date.now();
  const byId: Record<string, Product> = {};
  products.forEach((p) => {
    byId[p.id] = p;
  });

  // ABC ranking across full catalogue so class assignment stays globally consistent
  const abcList = abcAnalysis(products, {
    aThreshold: settings.abcA || 70,
    bThreshold: settings.abcB || 90,
  });
  const abcById: Record<string, AbcRow> = {};
  abcList.forEach((row) => {
    abcById[row.id] = row;
  });

  const allEnriched: ReportInventoryRow[] = products.map((p) => {
    const m = computeMetrics(p);
    const abc = abcById[p.id];
    const poVal = m.status !== 'ok' ? m.suggestedOrderQty * p.unitCost : 0;
    const turnoverRatio = m.stockValue > 0 ? m.usageValue / m.stockValue : null;
    return {
      product: p,
      metrics: m,
      abcClass: abc?.cls || 'C',
      abcCumulativePct: abc?.cumPct ?? 100,
      suggestedPoValue: poVal,
      turnoverRatio,
    };
  });

  const filteredRows = allEnriched.filter((row) => {
    if (scope.category !== 'ALL' && row.product.category !== scope.category) return false;
    if (scope.status === 'action' && row.metrics.status === 'ok') return false;
    if (scope.status === 'ok' && row.metrics.status !== 'ok') return false;
    return true;
  });

  let stockValue = 0;
  let usageValue = 0;
  let openPoValue = 0;
  const counts: Record<StockStatus, number> = { ok: 0, reorder: 0, critical: 0, out: 0 };
  const coverSamples: number[] = [];

  filteredRows.forEach((r) => {
    stockValue += r.metrics.stockValue;
    usageValue += r.metrics.usageValue;
    openPoValue += r.suggestedPoValue;
    counts[r.metrics.status]++;
    if (Number.isFinite(r.metrics.monthsOfCover)) {
      coverSamples.push(r.metrics.monthsOfCover);
    }
  });

  const filteredAbcRows = abcAnalysis(
    filteredRows.map((r) => r.product),
    { aThreshold: settings.abcA || 70, bThreshold: settings.abcB || 90 }
  );
  const abcStats = abcSummary(filteredAbcRows);

  const turnover = stockValue > 0 ? usageValue / stockValue : null;
  const avgCoverMonths = coverSamples.length
    ? coverSamples.reduce((s, x) => s + x, 0) / coverSamples.length
    : null;

  const statusRank: Record<StockStatus, number> = { out: 0, critical: 1, reorder: 2, ok: 3 };
  const replenishmentRows = filteredRows
    .filter((r) => r.metrics.status !== 'ok')
    .sort(
      (a, b) =>
        statusRank[a.metrics.status] - statusRank[b.metrics.status] ||
        b.suggestedPoValue - a.suggestedPoValue
    );

  const totalOrderUnits = replenishmentRows.reduce((s, r) => s + r.metrics.suggestedOrderQty, 0);

  // Category breakdown (on filtered rows)
  const catMap = new Map<string, { skuCount: number; stockValue: number; usageValue: number; actionCount: number }>();
  filteredRows.forEach((r) => {
    const cat = r.product.category || 'Other';
    const cur = catMap.get(cat) || { skuCount: 0, stockValue: 0, usageValue: 0, actionCount: 0 };
    cur.skuCount++;
    cur.stockValue += r.metrics.stockValue;
    cur.usageValue += r.metrics.usageValue;
    if (r.metrics.status !== 'ok') cur.actionCount++;
    catMap.set(cat, cur);
  });

  const categories: ReportCategoryRow[] = Array.from(catMap.entries())
    .map(([category, v]) => ({
      category,
      skuCount: v.skuCount,
      stockValue: v.stockValue,
      usageValue: v.usageValue,
      sharePct: stockValue > 0 ? (v.stockValue / stockValue) * 100 : 0,
      turnover: v.stockValue > 0 ? v.usageValue / v.stockValue : null,
      actionCount: v.actionCount,
    }))
    .sort((a, b) => b.stockValue - a.stockValue);

  // Build MRP item dictionary once
  const mrpItems: Record<string, MrpItemInput> = {};
  products.forEach((p) => {
    const m = computeMetrics(p);
    mrpItems[p.id] = {
      id: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      bom: p.bom,
      onHand: p.stock,
      safetyStock: Math.round(m.safetyStock),
      leadTimeDays: p.leadTime,
      lotRule: scope.lotRule,
      eoqQty: Math.max(1, Math.round(m.eoq.Q)),
      foqQty: Math.max(10, Math.round(m.eoq.Q)),
      periodDemand: Math.max(1, Math.round(m.dBar * 7)),
      periodCount: 2,
    };
  });

  const bomProducts = products.filter((p) => Array.isArray(p.bom) && p.bom.length > 0);
  const assemblies: AssemblyReadinessRow[] = bomProducts.map((asm) => {
    const plan = mrpPlan({
      rootId: asm.id,
      planQuantity: scope.buildQty,
      needInDays: scope.needInDays,
      horizonDays: scope.horizonDays,
      bucketSizeDays: 7,
      lotRule: scope.lotRule,
      items: mrpItems,
    });

    // Immediate buildable capacity from current leaf component stock (ignoring safety stock floor)
    const leafReqs = leafRequirementsPerUnit(asm.id, byId);
    let buildableNow = Infinity;
    let bottleneckSku = '—';
    let bottleneckName = 'Sufficient stock';
    Object.entries(leafReqs).forEach(([cid, reqPerUnit]) => {
      const comp = byId[cid];
      if (!comp || reqPerUnit <= 0) return;
      const possible = Math.floor(comp.stock / reqPerUnit);
      if (possible < buildableNow) {
        buildableNow = possible;
        bottleneckSku = comp.sku;
        bottleneckName = comp.name;
      }
    });
    if (!Number.isFinite(buildableNow)) buildableNow = 0;

    const unitBomCost = recursiveBomMaterialCost(asm.id, byId);
    const comps = Object.values(plan.components);
    const totalNetUnits = comps.reduce((s, c) => s + c.totalNetRequirement, 0);
    const netReqSpend = comps.reduce((s, c) => {
      const prod = byId[c.id];
      return s + c.totalNetRequirement * (prod ? prod.unitCost : 0);
    }, 0);

    return {
      product: asm,
      bomLineCount: asm.bom.length,
      unitBomCost,
      buildableNow,
      bottleneckSku,
      bottleneckName,
      batchQty: scope.buildQty,
      totalNetUnits,
      netReqSpend,
      shortageCount: plan.shortageAlerts.length,
      lateOrderCount: plan.lateOrderWarnings.length,
      plan,
    };
  });

  const selectedAssembly =
    assemblies.find((a) => a.product.id === scope.selectedAssemblyId) ||
    assemblies.find((a) => a.product.sku === 'ASM-CM200') ||
    assemblies[0] ||
    null;

  // Line balancing snapshot (uses active workspace tasks when supplied)
  const benchmark = getBenchmark(scope.benchmarkKey) || getBenchmark('bosch-13')!;
  const activeTasks =
    Array.isArray(options.customTasks) && options.customTasks.length ? options.customTasks : benchmark.tasks;
  const C = Math.max(
    scope.cycleTime,
    ...activeTasks.map((t) => t.time)
  );
  const lb = compareAlgorithms({
    tasks: activeTasks,
    cycleTime: C,
    algorithms: ['rpw', 'lcr', 'kw', 'comsoal', 'exact'],
    exactMaxTimeMs: 1200,
  });
  const bestLb = lb.best;
  const hourlyOutput = bestLb && C > 0 ? 3600 / C : null;

  return {
    generatedTs,
    generatedIso: new Date(generatedTs).toISOString(),
    generatedDisplay: shortDate(generatedTs),
    scope,
    policy: {
      cover: settings.advCover || 2.5,
      serviceLow: settings.advSlLow || 94,
      serviceHigh: settings.advSlHigh || 97,
    },
    inventory: {
      totalCatalogSkus: products.length,
      filteredSkuCount: filteredRows.length,
      stockValue,
      usageValue,
      turnover,
      avgCoverMonths,
      openPoValue,
      counts,
      abcStats,
      rows: filteredRows,
    },
    replenishment: {
      rows: replenishmentRows,
      totalPoValue: openPoValue,
      totalOrderUnits,
    },
    categories,
    production: {
      assemblies,
      selectedAssembly,
      totalBuildableAssemblies: assemblies.filter((a) => a.buildableNow >= scope.buildQty).length,
      totalShortages: assemblies.reduce((s, a) => s + a.shortageCount, 0),
      totalLateOrders: assemblies.reduce((s, a) => s + a.lateOrderCount, 0),
      totalNetReqSpend: assemblies.reduce((s, a) => s + a.netReqSpend, 0),
      lineBalance: {
        benchmarkKey: benchmark.key,
        benchmarkName: benchmark.name,
        cycleTime: C,
        taskCount: lb.problem.taskCount,
        totalWorkTime: lb.problem.totalTime,
        theoreticalMin: lb.theoreticalMin,
        bestAlgorithm: bestLb ? bestLb.label : 'None',
        bestStations: bestLb?.stationCount ?? null,
        efficiencyPct: bestLb?.efficiency ?? null,
        balanceDelayPct: bestLb?.balanceDelay ?? null,
        hourlyOutput,
        comparison: lb.comparison.map((c) => ({
          algorithm: c.algorithm,
          label: c.label,
          valid: c.valid,
          stationCount: c.stationCount,
          efficiency: c.efficiency,
          balanceDelay: c.balanceDelay,
          smoothnessIndex: c.smoothnessIndex ?? null,
        })),
      },
    },
  };
}

export function inventoryMetricsToCSV(snapshot: OperationsReportSnapshot): string {
  return buildCSV(
    [
      'SKU',
      'Name',
      'Category',
      'Unit',
      'ABC Class',
      'Status',
      'On Hand',
      'Unit Cost ($)',
      'Stock Value ($)',
      'Annual Demand',
      'Annual Usage Value ($)',
      'Turnover Ratio',
      'EOQ (units)',
      'Safety Stock',
      'Reorder Point (ROP)',
      'Months of Cover',
      'Lead Time (days)',
      'Service Level (%)',
      'Suggested Order Qty',
      'Estimated PO Value ($)',
    ],
    snapshot.inventory.rows.map((r) => [
      r.product.sku,
      r.product.name,
      r.product.category,
      r.product.unit,
      r.abcClass,
      r.metrics.status.toUpperCase(),
      r.product.stock,
      r.product.unitCost.toFixed(2),
      r.metrics.stockValue.toFixed(2),
      r.product.annualDemand,
      r.metrics.usageValue.toFixed(2),
      r.turnoverRatio != null ? r.turnoverRatio.toFixed(2) : '',
      Math.round(r.metrics.eoq.Q),
      Math.round(r.metrics.safetyStock),
      Math.round(r.metrics.rop),
      Number.isFinite(r.metrics.monthsOfCover) ? r.metrics.monthsOfCover.toFixed(2) : 'INF',
      r.product.leadTime,
      r.product.serviceLevel.toFixed(1),
      r.metrics.status !== 'ok' ? r.metrics.suggestedOrderQty : 0,
      r.suggestedPoValue.toFixed(2),
    ])
  );
}

export function replenishmentScheduleToCSV(snapshot: OperationsReportSnapshot): string {
  return buildCSV(
    [
      'Urgency',
      'SKU',
      'Name',
      'Category',
      'On Hand',
      'Unit',
      'Reorder Point (ROP)',
      'Safety Stock',
      'Suggested Order Qty (EOQ)',
      'Unit Cost ($)',
      'Estimated PO Value ($)',
      'Lead Time (days)',
      'Months Cover',
    ],
    snapshot.replenishment.rows.map((r) => [
      r.metrics.status.toUpperCase(),
      r.product.sku,
      r.product.name,
      r.product.category,
      r.product.stock,
      r.product.unit,
      Math.round(r.metrics.rop),
      Math.round(r.metrics.safetyStock),
      r.metrics.suggestedOrderQty,
      r.product.unitCost.toFixed(2),
      r.suggestedPoValue.toFixed(2),
      r.product.leadTime,
      Number.isFinite(r.metrics.monthsOfCover) ? r.metrics.monthsOfCover.toFixed(2) : 'INF',
    ])
  );
}

export function productionMetricsToCSV(snapshot: OperationsReportSnapshot): string {
  const rows: Array<Array<unknown>> = [];
  rows.push(['SECTION', 'ASSEMBLY BUILD READINESS']);
  rows.push([
    'Assembly SKU',
    'Assembly Name',
    'Batch Qty',
    'BOM Lines',
    'Material Cost / Unit ($)',
    'Buildable Now (from Stock)',
    'Bottleneck Component',
    'Total Net Req (units)',
    'Net Req Spend ($)',
    'Shortages',
    'Late Orders',
  ]);
  snapshot.production.assemblies.forEach((a) => {
    rows.push([
      a.product.sku,
      a.product.name,
      a.batchQty,
      a.bomLineCount,
      a.unitBomCost.toFixed(2),
      a.buildableNow,
      a.bottleneckSku,
      a.totalNetUnits,
      a.netReqSpend.toFixed(2),
      a.shortageCount,
      a.lateOrderCount,
    ]);
  });

  if (snapshot.production.selectedAssembly) {
    const sel = snapshot.production.selectedAssembly;
    rows.push([]);
    rows.push(['SECTION', `MRP COMPONENT EXPLOSION (${sel.product.sku} x ${sel.batchQty})`]);
    rows.push([
      'Component SKU',
      'Component Name',
      'BOM Level',
      'Unit',
      'On Hand',
      'Safety Stock',
      'Lead Time (d)',
      'Total Gross Req',
      'Total Net Req',
      'Planned Releases',
      'Projected Ending Stock',
      'Shortage Flag',
      'Past Due Flag',
    ]);
    Object.values(sel.plan.components).forEach((c) => {
      rows.push([
        c.sku,
        c.name,
        c.level,
        c.unit,
        c.onHand,
        c.safetyStock,
        c.leadTimeDays,
        c.totalGross,
        c.totalNetRequirement,
        c.totalPlannedReleases,
        c.finalProjectedOnHand,
        c.shortage ? 'YES' : 'NO',
        c.pastDue ? 'YES' : 'NO',
      ]);
    });
  }

  rows.push([]);
  rows.push(['SECTION', `LINE BALANCING (${snapshot.production.lineBalance.benchmarkName}, C=${snapshot.production.lineBalance.cycleTime})`]);
  rows.push(['Algorithm', 'Valid', 'Stations', 'Efficiency (%)', 'Balance Delay (%)', 'Smoothness Index']);
  snapshot.production.lineBalance.comparison.forEach((c) => {
    rows.push([
      c.label,
      c.valid ? 'YES' : 'NO',
      c.stationCount ?? '',
      c.efficiency != null ? c.efficiency.toFixed(1) : '',
      c.balanceDelay != null ? c.balanceDelay.toFixed(1) : '',
      c.smoothnessIndex != null ? c.smoothnessIndex.toFixed(2) : '',
    ]);
  });

  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function fullOperationsDossierCSV(snapshot: OperationsReportSnapshot): string {
  const sections: string[] = [];
  sections.push(
    buildCSV(
      ['FactoryMind Operations Dossier', 'Generated', 'Scope Category', 'Scope Status', 'Target Cover (mo)', 'Service Band (%)'],
      [[
        'Consolidated Inventory & Production Report',
        snapshot.generatedIso,
        snapshot.scope.category,
        snapshot.scope.status,
        snapshot.policy.cover.toFixed(1),
        `${snapshot.policy.serviceLow.toFixed(1)}-${snapshot.policy.serviceHigh.toFixed(1)}`,
      ]]
    )
  );
  sections.push('');
  sections.push(
    buildCSV(
      ['KPI Metric', 'Value'],
      [
        ['Filtered SKUs', snapshot.inventory.filteredSkuCount],
        ['Inventory at Cost ($)', snapshot.inventory.stockValue.toFixed(2)],
        ['Annual Usage Value ($)', snapshot.inventory.usageValue.toFixed(2)],
        ['Inventory Turnover (x)', snapshot.inventory.turnover != null ? snapshot.inventory.turnover.toFixed(2) : 'N/A'],
        ['Open Replenishment Orders', snapshot.replenishment.rows.length],
        ['Open Replenishment PO Spend ($)', snapshot.replenishment.totalPoValue.toFixed(2)],
        ['BOM Assemblies Analyzed', snapshot.production.assemblies.length],
        ['Line Balance Efficiency (%)', snapshot.production.lineBalance.efficiencyPct != null ? snapshot.production.lineBalance.efficiencyPct.toFixed(1) : 'N/A'],
      ]
    )
  );
  sections.push('');
  sections.push('REPLENISHMENT SCHEDULE');
  sections.push(replenishmentScheduleToCSV(snapshot));
  sections.push('');
  sections.push('PRODUCTION & MRP METRICS');
  sections.push(productionMetricsToCSV(snapshot));
  sections.push('');
  sections.push('INVENTORY & ABC METRICS');
  sections.push(inventoryMetricsToCSV(snapshot));
  return sections.join('\r\n');
}

export function operationsReportToMarkdown(snapshot: OperationsReportSnapshot): string {
  const lines: string[] = [];
  lines.push(`# FactoryMind Operations Report (${snapshot.generatedDisplay})`);
  lines.push(
    `Scope: Category **${snapshot.scope.category}** · Status **${snapshot.scope.status}** · Target policy **${fmtNum(snapshot.policy.cover, 1)} mo cover** (${fmtNum(snapshot.policy.serviceLow, 1)}–${fmtNum(snapshot.policy.serviceHigh, 1)}% SL)`
  );
  lines.push('');
  lines.push('## Portfolio KPIs');
  lines.push(`- **Active SKUs (in scope):** ${fmtInt(snapshot.inventory.filteredSkuCount)} / ${fmtInt(snapshot.inventory.totalCatalogSkus)}`);
  lines.push(`- **Inventory at Cost:** ${fmtMoney(snapshot.inventory.stockValue)}`);
  lines.push(`- **Annual Usage Value:** ${fmtMoney(snapshot.inventory.usageValue)} (${snapshot.inventory.turnover != null ? `${fmtNum(snapshot.inventory.turnover, 1)}x turns/yr` : '—'})`);
  lines.push(`- **Open Replenishments:** ${fmtInt(snapshot.replenishment.rows.length)} SKUs (${fmtMoney(snapshot.replenishment.totalPoValue)} est. PO spend)`);
  lines.push(
    `- **Line Balance (${snapshot.production.lineBalance.benchmarkName}):** ${snapshot.production.lineBalance.bestStations ?? '—'} stations · ${snapshot.production.lineBalance.efficiencyPct != null ? `${fmtNum(snapshot.production.lineBalance.efficiencyPct, 1)}% efficiency` : '—'}`
  );
  lines.push('');
  if (snapshot.replenishment.rows.length) {
    lines.push('## Top Replenishment Actions');
    lines.push('| SKU | Item | Status | On Hand | ROP | Order Qty | Est. PO | Cover |');
    lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |');
    snapshot.replenishment.rows.slice(0, 10).forEach((r) => {
      lines.push(
        `| ${r.product.sku} | ${r.product.name} | ${r.metrics.status.toUpperCase()} | ${fmtInt(r.product.stock)} ${r.product.unit} | ${fmtInt(r.metrics.rop)} | ${fmtInt(r.metrics.suggestedOrderQty)} | ${fmtMoney(r.suggestedPoValue)} | ${fmtCover(r.metrics.monthsOfCover)} |`
      );
    });
    lines.push('');
  }
  if (snapshot.production.assemblies.length) {
    lines.push(`## Production & MRP Readiness (Batch = ${snapshot.scope.buildQty} units)`);
    lines.push('| Assembly | Buildable Now | Bottleneck | BOM Cost | Net Req Spend | Shortages | Late Orders |');
    lines.push('| --- | ---: | --- | ---: | ---: | ---: | ---: |');
    snapshot.production.assemblies.forEach((a) => {
      lines.push(
        `| ${a.product.sku} (${a.product.name}) | ${fmtInt(a.buildableNow)} | ${a.bottleneckSku} | ${fmtMoney(a.unitBomCost)} | ${fmtMoney(a.netReqSpend)} | ${a.shortageCount} | ${a.lateOrderCount} |`
      );
    });
  }
  return lines.join('\n');
}
