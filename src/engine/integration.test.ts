import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeMetrics,
  createSeedDB,
  Product,
  toCSV,
  Transaction,
} from '../store/store.ts';
import { computeDashboardSummary } from './dashboardSummary.ts';
import { predictSmartAlerts } from './smartAlerts.ts';
import {
  buildOperationsReport,
  fullOperationsDossierCSV,
  inventoryMetricsToCSV,
  operationsReportToMarkdown,
} from './reports.ts';
import {
  buildDefaultFactoryConfigFromWorkspace,
  runFactorySimulation,
  runSensitivitySweep,
} from './factorySim.ts';

function computeSeedSummary(db: ReturnType<typeof createSeedDB>) {
  const rows = db.products.map((p) => ({ p, m: computeMetrics(p) }));
  let stockValue = 0;
  let usageValue = 0;
  const counts = { ok: 0, reorder: 0, critical: 0, out: 0 };
  const byCategory: Record<string, number> = {};
  rows.forEach(({ p, m }) => {
    stockValue += m.stockValue;
    usageValue += m.usageValue;
    counts[m.status]++;
    byCategory[p.category] = (byCategory[p.category] || 0) + m.stockValue;
  });
  return {
    skuCount: db.products.length,
    stockValue,
    usageValue,
    counts,
    byCategory,
    alertCount: counts.reorder + counts.critical + counts.out,
    txCount: db.transactions.length,
  };
}

test('Integration: Store mutations propagate consistently across Dashboard, Smart Alerts, and Reports', () => {
  const db = createSeedDB();
  const baseSummary = computeSeedSummary(db);
  const now = Date.now();

  const dashBefore = computeDashboardSummary(db.products, db.transactions, db.settings, { nowTs: now, windowDays: 30 });
  const alertsBefore = predictSmartAlerts(db.products, computeMetrics, { horizonDays: 45, nowTs: now });

  // Mutate a critical/out component (restock heavily & add recent outbound transaction)
  const targetIdx = db.products.findIndex((p) => computeMetrics(p).status !== 'ok');
  assert.ok(targetIdx >= 0, 'Seed should contain at least one low-stock item');
  const mutatedProducts: Product[] = db.products.map((p, idx) =>
    idx === targetIdx ? { ...p, stock: p.annualDemand + 5000 } : p
  );
  const targetSku = db.products[targetIdx].sku;

  const addedTx: Transaction = {
    id: 'tx-int-1',
    productId: db.products[targetIdx].id,
    type: 'out',
    qty: 50,
    ts: now - 3600_000,
    note: 'Integration test work order issue',
  };
  const nextTx: Transaction[] = [addedTx, ...db.transactions];
  const dashAfter = computeDashboardSummary(mutatedProducts, nextTx, db.settings, { nowTs: now, windowDays: 30 });
  const alertsAfter = predictSmartAlerts(mutatedProducts, computeMetrics, { horizonDays: 45, nowTs: now });

  // Inventory value increases by restocked units * unitCost
  const deltaStock = mutatedProducts[targetIdx].stock - db.products[targetIdx].stock;
  assert.ok(
    Math.abs(dashAfter.inventory.totalValue - dashBefore.inventory.totalValue - deltaStock * db.products[targetIdx].unitCost) < 1e-6
  );
  // Outbound throughput increases by +50 units
  assert.equal(dashAfter.throughput.outboundUnits - dashBefore.throughput.outboundUnits, 50);
  // Restocked SKU exits low-stock alerts and smart predictive stockout list
  assert.equal(dashAfter.alerts.totalAlerts, dashBefore.alerts.totalAlerts - 1);
  assert.equal(alertsAfter.alerts.some((a) => a.product.sku === targetSku), false);
  assert.ok(alertsBefore.alerts.length >= alertsAfter.alerts.length);

  // Reports snapshot reflects live mutated store metrics identically
  const nextSummary = computeSeedSummary({ ...db, products: mutatedProducts, transactions: nextTx });
  assert.ok(Math.abs(baseSummary.stockValue - dashBefore.inventory.totalValue) < 1e-6);
  const report = buildOperationsReport(mutatedProducts, nextSummary, db.settings, {
    buildQty: 20,
    needInDays: 30,
    benchmarkKey: 'bosch-13',
    cycleTime: 10,
  });
  assert.ok(Math.abs(report.inventory.stockValue - dashAfter.inventory.totalValue) < 1e-4);
  const invCsv = inventoryMetricsToCSV(report);
  const fullCsv = fullOperationsDossierCSV(report);
  const md = operationsReportToMarkdown(report);
  assert.ok(invCsv.includes(targetSku));
  assert.ok(fullCsv.includes('INVENTORY & ABC METRICS'));
  assert.ok(md.includes('Inventory at Cost:'));
});

test('Integration: Live Workspace -> Line Balance -> BOM -> Factory Simulation Lab -> Sensitivity Sweep', () => {
  const db = createSeedDB();
  const lb = db.lineBalance || null;

  const cfg = buildDefaultFactoryConfigFromWorkspace({
    products: db.products,
    lineBalance: lb,
    metricsOf: computeMetrics,
    assemblySku: 'ASM-CM200',
    spcProfile: 'stable',
  });

  assert.equal(cfg.assemblySku, 'ASM-CM200');
  assert.ok(cfg.stations.length >= 3);
  assert.ok(cfg.materials.length >= 4, 'ASM-CM200 BOM materials synced from store');

  const sim = runFactorySimulation(cfg);
  assert.equal(sim.valid, true);
  assert.equal(sim.provenance, 'SIMULATED_MODEL');
  assert.ok(sim.provenanceNotice.length > 0);
  assert.equal(sim.materials.length, cfg.materials.length);
  assert.ok(sim.oeePct > 0 && sim.oeePct <= 100);
  assert.ok(Number.isFinite(sim.littlesLawGapPct) && sim.littlesLawExpectedWip >= 0);

  // Steady-state unconstrained horizon verifies Little's Law conservation L = lambda * W closely
  const steadySim = runFactorySimulation({
    ...cfg,
    enforceMaterialFlow: false,
    daysToSimulate: 5,
    warmupHours: 8,
    replications: 8,
  });
  assert.equal(steadySim.valid, true);
  assert.ok(
    steadySim.littlesLawGapPct < 10,
    `Expected steady-state Little's Law gap < 10%, got ${steadySim.littlesLawGapPct.toFixed(2)}%`
  );

  // Replicating stock depletion on a BOM component increases material starvation risk when enforcing material flow
  const starvedProducts = db.products.map((p) => {
    const isCmPart = cfg.materials.some((m) => m.productId === p.id);
    return isCmPart ? { ...p, stock: 1, leadTime: 30 } : p;
  });
  const starvedCfg = buildDefaultFactoryConfigFromWorkspace({
    products: starvedProducts,
    lineBalance: lb,
    metricsOf: computeMetrics,
    assemblySku: 'ASM-CM200',
    spcProfile: 'stable',
  });
  const starvedSim = runFactorySimulation({ ...starvedCfg, daysToSimulate: 3, replications: 4 });
  assert.equal(starvedSim.valid, true);
  assert.ok(starvedSim.materials.some((m) => m.stockoutOccurred || m.starvationEvents > 0));

  // Sensitivity sweep produces ranked levers
  const sweep = runSensitivitySweep({ ...cfg, replications: 4, daysToSimulate: 1 });
  assert.ok(sweep.levers.length >= 4);
  for (const row of sweep.levers) {
    assert.ok(Number.isFinite(row.throughputDeltaPct));
    assert.ok(Number.isFinite(row.costDeltaPerUnit));
  }

  // CSV formula-injection neutralization check across generic store CSV exporter
  const unsafe = toCSV(['Name', 'SKU'], [['=CMD|calc', 'X1']]);
  assert.ok(unsafe.includes("'=CMD|calc"));
});
