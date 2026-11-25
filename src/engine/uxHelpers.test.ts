import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeDatasetProvenance,
  computeOnboardingProgress,
  DEMO_CATALOG_SKUS,
  HELP_TOPICS,
  MODEL_ASSUMPTIONS,
  searchWorkbench,
  validateBomLines,
  validateProductForm,
  validateStockMove,
} from './uxHelpers';

test('validateProductForm rejects empty fields, duplicate SKUs, and bad history tokens', () => {
  const invalid = validateProductForm(
    {
      sku: 'brg-6205',
      name: '',
      unit: 'pcs',
      unitCost: '-5',
      stock: '10',
      annualDemand: '100',
      orderCost: '50',
      holdingRate: '120',
      leadTime: '10',
      serviceLevel: '45',
      historyText: '10, abc, 30',
    },
    { existingSkus: ['BRG-6205', 'STL-1045'] }
  );

  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.sku?.includes('already exists'));
  assert.ok(invalid.errors.name);
  assert.ok(invalid.errors.unitCost);
  assert.ok(invalid.errors.holdingRate);
  assert.ok(invalid.errors.serviceLevel);
  assert.ok(invalid.errors.historyText?.includes('abc'));

  const valid = validateProductForm(
    {
      sku: 'BRG-6205',
      name: 'Ball Bearing 6205-2RS',
      unit: 'pcs',
      unitCost: '3.85',
      stock: '2600',
      annualDemand: '9600',
      orderCost: '45',
      holdingRate: '25',
      leadTime: '10',
      serviceLevel: '99',
      historyText: '800, 820, 790',
    },
    { existingSkus: ['BRG-6205', 'STL-1045'], editingProductSku: 'BRG-6205' }
  );

  assert.equal(valid.valid, true);
  assert.deepEqual(valid.parsedHistory, [800, 820, 790]);
});

test('validateStockMove blocks zero, negative, and over-stock outbound issues', () => {
  assert.equal(validateStockMove('0', 'in', 100).valid, false);
  assert.equal(validateStockMove('-4', 'in', 100).valid, false);
  assert.equal(validateStockMove('150', 'out', 100).valid, false);
  assert.equal(validateStockMove('150', 'in', 100).valid, true);
  const okOut = validateStockMove('40', 'out', 100);
  assert.equal(okOut.valid, true);
  assert.equal(okOut.qty, 40);
});

test('validateBomLines catches self-reference, duplicates, and non-positive quantities', () => {
  const bad = validateBomLines(
    [
      { componentId: 'p1', qtyPer: 2 },
      { componentId: 'p2', qtyPer: 1 },
      { componentId: 'p2', qtyPer: 0 },
    ],
    'p1'
  );
  assert.equal(bad.valid, false);
  assert.ok(bad.lineErrors[0]?.includes('itself'));
  assert.ok(bad.lineErrors[2]?.includes('Duplicate'));

  const good = validateBomLines([{ componentId: 'p2', qtyPer: 2.5 }], 'p1');
  assert.equal(good.valid, true);
});

test('computeDatasetProvenance accurately classifies demo, modified-demo, custom, and empty datasets', () => {
  assert.equal(computeDatasetProvenance([], 0).kind, 'empty');

  const exactDemo = DEMO_CATALOG_SKUS.map((sku) => ({ sku, demandSource: 'demo' }));
  assert.equal(computeDatasetProvenance(exactDemo, 34).kind, 'demo');

  const modified = [...exactDemo, { sku: 'CUSTOM-99', demandSource: 'user' }];
  assert.equal(computeDatasetProvenance(modified, 35).kind, 'modified-demo');

  const customOnly = [
    { sku: 'PLANT-A1', demandSource: 'imported' },
    { sku: 'PLANT-B2', demandSource: 'user' },
  ];
  assert.equal(computeDatasetProvenance(customOnly, 2).kind, 'custom');
});

test('computeOnboardingProgress tracks unique valid steps accurately', () => {
  const p = computeOnboardingProgress(['review-alerts', 'review-alerts', 'run-des-sim', 'bogus-id']);
  assert.equal(p.completed, 2);
  assert.equal(p.total, 5);
  assert.equal(p.pct, 40);
  assert.equal(p.done, false);
});

test('searchWorkbench searches across routes, SKUs, scenarios, and help topics', () => {
  const routes = [
    { id: 'factory-sim', label: 'Factory Simulation Lab', subtitle: 'DES and OEE', group: 'Unified' },
    { id: 'eoq', label: 'EOQ & ROP', subtitle: 'Wilson EOQ', group: 'Inventory & Policy' },
  ];
  const products = [
    { id: 'p1', sku: 'MOT-05HP', name: 'AC Induction Motor 0.5 HP', category: 'Electrical', stock: 55, unit: 'pcs' },
  ];
  const scenarios = [
    { id: 'sc1', name: 'Motor Lead-Time Buffer', notes: 'Mitigate MOT-05HP shortage' },
  ];

  const motorHits = searchWorkbench({ query: 'MOT-05HP', routes, products, scenarios, helpTopics: HELP_TOPICS });
  assert.ok(motorHits.some((r) => r.kind === 'sku' && r.productId === 'p1'));
  assert.ok(motorHits.some((r) => r.kind === 'scenario' && r.scenarioId === 'sc1'));

  const oeeHits = searchWorkbench({ query: 'oee', routes, products, scenarios, helpTopics: HELP_TOPICS });
  assert.ok(oeeHits.some((r) => r.kind === 'route' && r.routeId === 'factory-sim'));
  assert.ok(oeeHits.some((r) => r.kind === 'help'));

  assert.ok(MODEL_ASSUMPTIONS.eoq.formula.includes('Q*'));
});

test('homeData computes exact live plant metrics and exports 8 valid capability cards', async () => {
  const { createSeedDB, computeMetrics } = await import('../store/store');
  const { predictSmartAlerts } = await import('./smartAlerts');
  const { buildDefaultFactoryConfigFromWorkspace } = await import('./factorySim');
  const {
    computeHomeLiveMetrics,
    computeRealTimeMetricsWidget,
    HOME_CAPABILITY_CARDS,
    HOME_FOOTER_COLUMNS,
    HOME_MORE_NAV,
    HOME_PRIMARY_NAV,
  } = await import('./homeData');

  const db = createSeedDB();
  let stockValue = 0;
  let usageValue = 0;
  const counts = { ok: 0, reorder: 0, critical: 0, out: 0 };
  const byCategory: Record<string, number> = {};
  for (const p of db.products) {
    const m = computeMetrics(p);
    stockValue += m.stockValue;
    usageValue += m.usageValue;
    counts[m.status]++;
    byCategory[p.category] = (byCategory[p.category] || 0) + m.stockValue;
  }
  const summary = {
    skuCount: db.products.length,
    stockValue,
    usageValue,
    counts,
    byCategory,
    alertCount: counts.reorder + counts.critical + counts.out,
    txCount: db.transactions.length,
  };
  const alerts = predictSmartAlerts(db.products, computeMetrics, { horizonDays: 45 });
  const factorySimConfig = buildDefaultFactoryConfigFromWorkspace({
    products: db.products,
    lineBalance: db.lineBalance || null,
    metricsOf: computeMetrics,
  });

  const live = computeHomeLiveMetrics({
    products: db.products,
    transactions: db.transactions,
    summary,
    visibleSmartAlerts: alerts.alerts,
    factorySimConfig,
  });

  assert.equal(live.skuCount, 17);
  assert.equal(live.bomCount, 5);
  assert.equal(live.txCount, 34);
  assert.equal(live.forecastModelCount, 12);
  assert.ok(live.stockValue > 0);
  assert.ok(live.workstationsCount >= 3);
  assert.equal(HOME_CAPABILITY_CARDS.length, 8);
  assert.equal(HOME_PRIMARY_NAV.length, 5);
  assert.ok(HOME_MORE_NAV.length >= 10);
  assert.equal(HOME_FOOTER_COLUMNS.length, 3);

  const widget = computeRealTimeMetricsWidget({
    products: db.products,
    transactions: db.transactions,
    summary,
    metricsOf: computeMetrics,
    visibleSmartAlerts: alerts.alerts,
    factorySimConfig,
  });

  const expectedAvgLt = db.products.reduce((s, p) => s + p.leadTime, 0) / db.products.length;
  assert.ok(Math.abs(widget.totalInventoryValue - stockValue) < 1e-6);
  assert.ok(Math.abs(widget.avgLeadTimeDays - expectedAvgLt) < 1e-6);
  assert.ok(widget.minLeadTimeDays > 0 && widget.maxLeadTimeDays >= widget.minLeadTimeDays);
  assert.ok(widget.recentAlerts.length > 0 && widget.recentAlerts.length <= 5);
  assert.ok(widget.latestMove !== null);

  const emptyWidget = computeRealTimeMetricsWidget({
    products: [],
    transactions: [],
    summary: { skuCount: 0, stockValue: 0, usageValue: 0, counts: { ok: 0, reorder: 0, critical: 0, out: 0 }, byCategory: {}, alertCount: 0, txCount: 0 },
    metricsOf: computeMetrics,
    visibleSmartAlerts: [],
    factorySimConfig,
  });
  assert.equal(emptyWidget.totalInventoryValue, 0);
  assert.equal(emptyWidget.avgLeadTimeDays, 0);
  assert.equal(emptyWidget.recentAlerts.length, 0);
  assert.equal(emptyWidget.latestMove, null);
});

test('publicAsset resolves root and GitHub Pages subpath asset URLs cleanly', async () => {
  const { publicAsset } = await import('../utils/assetUrl');
  assert.equal(publicAsset('/assets/aistudio/logo_0620d144.svg', '/'), '/assets/aistudio/logo_0620d144.svg');
  assert.equal(
    publicAsset('/assets/aistudio/logo_0620d144.svg', '/FactoryMind/'),
    '/FactoryMind/assets/aistudio/logo_0620d144.svg'
  );
  assert.equal(
    publicAsset('assets/aistudio/logo_0620d144.svg', '/my-repo'),
    '/my-repo/assets/aistudio/logo_0620d144.svg'
  );
});

test('engineering glossary, related-module workflow graph, and validation helpers work deterministically', async () => {
  const {
    ENGINEERING_GLOSSARY,
    getEngineeringTerm,
    getRelatedModules,
    inferOnboardingStepForRoute,
    validateNumberRange,
  } = await import('./uxHelpers');

  assert.ok(Object.keys(ENGINEERING_GLOSSARY).length >= 20);
  const cpk = getEngineeringTerm('cpk');
  assert.ok(cpk.term.includes('Cpk'));
  assert.ok(cpk.formula && cpk.formula.includes('USL'));
  assert.ok(cpk.definition.length > 20);

  const invRelated = getRelatedModules('inventory');
  assert.equal(invRelated.length, 3);
  assert.ok(invRelated.some((r) => r.route === 'eoq'));
  assert.deepEqual(getRelatedModules('nonexistent-route'), []);

  assert.equal(inferOnboardingStepForRoute('factory-sim'), 'run-des-sim');
  assert.equal(inferOnboardingStepForRoute('dashboard'), null);

  const okInt = validateNumberRange('42', { label: 'Lead time', min: 0, max: 365, integer: true });
  assert.equal(okInt.valid, true);
  assert.equal(okInt.value, 42);

  const badStrict = validateNumberRange('0', { label: 'Production rate', min: 0, strictMin: true });
  assert.equal(badStrict.valid, false);
  assert.ok(badStrict.error?.includes('greater than 0'));

  const badNaN = validateNumberRange('', { label: 'Holding rate', min: 0.1 });
  assert.equal(badNaN.valid, false);
  assert.ok(badNaN.error?.includes('valid number'));
});

