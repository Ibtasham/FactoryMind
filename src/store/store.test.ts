import test from 'node:test';
import assert from 'node:assert/strict';
import { FactoryStore, StorageBackend } from './store.ts';

function memoryBackend(): StorageBackend {
  const map: Record<string, string> = {};
  return {
    persistent: false,
    get: (k) => (k in map ? map[k] : null),
    set: (k, v) => {
      map[k] = v;
    },
    del: (k) => {
      delete map[k];
    },
  };
}

test('FactoryStore: seeds 17 SKUs, 5 BOMs, 34 ledger entries, supports CRUD, undo, and CSV roundtrip', () => {
  const storage = memoryBackend();
  const s1 = new FactoryStore(storage);

  assert.equal(s1.products().length, 17);
  assert.equal(s1.productsWithBom().length, 5);
  assert.equal(s1.transactions().length, 34);

  const added = s1.addProduct({
    sku: 'TST-999',
    name: 'Test Valve',
    category: 'Component',
    unit: 'pcs',
    unitCost: 25,
    stock: 100,
    annualDemand: 1200,
    orderCost: 40,
    holdingRate: 20,
    leadTime: 10,
  });
  assert.equal(s1.products().length, 18);

  const tx = s1.addTransaction(added.id, 'in', 50, 'Unit test PO');
  assert.ok(tx);
  assert.equal(s1.getProduct(added.id)!.stock, 150);

  // Reload from same storage backend verifies persistence
  const s2 = new FactoryStore(storage);
  assert.equal(s2.products().length, 18);
  assert.equal(s2.getProduct(added.id)!.stock, 150);

  // Snapshot + delete + restore undo
  const snap = s2.deleteProductSnapshot(added.id)!;
  s2.deleteProduct(added.id);
  assert.equal(s2.products().length, 17);
  s2.restoreProduct(snap);
  assert.equal(s2.products().length, 18);

  // CSV export + import
  const csv = s2.exportProductsCSV();
  assert.ok(csv.includes('TST-999'));
  const imp = s2.importProductsCSV(s2.csvTemplate());
  assert.equal(imp.created, 2);
});

test('FactoryStore Security & Sync: non-synthetic default demand, prototype defense, CSV escaping, LineBalance & SmartAlert persistence', () => {
  const storage = memoryBackend();
  const s = new FactoryStore(storage);

  // 1. Adding a SKU without history should not synthesize random history
  const plain = s.addProduct({
    sku: 'USR-001',
    name: '=CMD|calc',
    category: 'Component',
    unit: 'pcs',
    unitCost: 12,
    stock: 40,
    annualDemand: 480,
    orderCost: 30,
    holdingRate: 20,
    leadTime: 7,
  });
  assert.equal(plain.demandHistory.length, 0);
  assert.equal(plain.demandSource, 'user');
  const csv = s.exportProductsCSV();
  assert.ok(csv.includes("'=CMD|calc"), 'Store CSV export should escape leading formula character');

  // 2. Prototype-pollution defense in importJSON
  const payload = JSON.stringify({
    products: [plain],
    __proto__: { polluted: true },
    constructor: { prototype: { polluted: true } },
  });
  const importedCount = s.importJSON(payload);
  assert.equal(importedCount, 1);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);

  // 3. Persist LineBalance & SmartAlert dismissal + horizon across store instances
  s.setLineBalance({
    benchmarkKey: 'custom',
    cycleTime: 12,
    tasks: [
      { id: 'T1', time: 5, successors: ['T2'] },
      { id: 'T2', time: 6, successors: [] },
    ],
    selectedAlgo: 'rpw',
  });
  s.setSmartAlertHorizonDays(60);
  s.dismissSmartAlert('alert-abc');

  const sReload = new FactoryStore(storage);
  assert.equal(sReload.getLineBalance().tasks.length, 2);
  assert.equal(sReload.getLineBalance().cycleTime, 12);
  assert.equal(sReload.getSmartAlertPrefs().horizonDays, 60);
  assert.deepEqual(sReload.getSmartAlertPrefs().dismissedIds, ['alert-abc']);
  sReload.restoreAllSmartAlerts();
  assert.deepEqual(sReload.getSmartAlertPrefs().dismissedIds, []);

  // 4. Persist Factory Simulation Lab config & saved scenarios across reload & JSON roundtrip
  const simCfg = sReload.getFactorySimConfig();
  assert.ok(simCfg.stations.length >= 1);
  sReload.setFactorySimConfig({ ...simCfg, arrivalRatePerHour: 9.25, seed: 4242 });
  const savedSc = sReload.saveFactoryScenario('High Demand Surge', 'Added +2 ops', {
    ...simCfg,
    arrivalRatePerHour: 9.25,
    seed: 4242,
  });
  assert.ok(savedSc.id);

  const sSimReload = new FactoryStore(storage);
  assert.equal(sSimReload.getFactorySimConfig().arrivalRatePerHour, 9.25);
  assert.equal(sSimReload.getFactorySimConfig().seed, 4242);
  assert.equal(sSimReload.getFactoryScenarios().length, 1);
  assert.equal(sSimReload.getFactoryScenarios()[0].name, 'High Demand Surge');

  const exportedJson = sSimReload.exportJSON();
  const sJsonImport = new FactoryStore(memoryBackend());
  sJsonImport.importJSON(exportedJson);
  assert.equal(sJsonImport.getFactorySimConfig().seed, 4242);
  assert.equal(sJsonImport.getFactoryScenarios().length, 1);

  sSimReload.deleteFactoryScenario(savedSc.id);
  assert.equal(sSimReload.getFactoryScenarios().length, 0);

  // 5. Action History logging & onboarding settings persistence
  sSimReload.setSetting('onboardingDismissed', true);
  sSimReload.setSetting('onboardingCompletedSteps', ['review-alerts', 'run-des-sim']);
  sSimReload.recordAction('inventory', 'Manual audit check', 'Verified action history persistence', 'inventory');
  const sActReload = new FactoryStore(storage);
  assert.equal(sActReload.settings().onboardingDismissed, true);
  assert.deepEqual(sActReload.settings().onboardingCompletedSteps, ['review-alerts', 'run-des-sim']);
  assert.ok(sActReload.actionLog().some((e) => e.action === 'Manual audit check'));
  sActReload.clearActionLog();
  assert.equal(sActReload.actionLog().length, 0);
});


