import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsvCell } from '../engine/formatters.ts';
import { mrpPlan, mrpToCSV } from '../engine/mrp.ts';
import {
  createSafeStorage,
  CURRENT_SCHEMA_VERSION,
  FactoryStore,
  StorageBackend,
} from './store.ts';

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

test('Data Reliability [JSON]: validates malformed syntax, schema versions, duplicates, numeric ranges & full backup fidelity without corrupting existing data', () => {
  const storage = memoryBackend();
  const s = new FactoryStore(storage);
  const custom = s.addProduct({
    sku: 'REL-001',
    name: 'Precision Valve',
    category: 'Component',
    unit: 'pcs',
    unitCost: 42.5,
    stock: 80,
    annualDemand: 960,
    orderCost: 55,
    holdingRate: 22,
    leadTime: 14,
    serviceLevel: 97.5,
    demandHistory: [70, 75, 80, 82, 79, 85, 90, 88, 76, 80, 81, 74],
  });
  s.addTransaction(custom.id, 'in', 20, 'Initial PO');
  s.setSetting('reduceMotion', true);
  s.setSetting('advCover', 2.5);
  s.setSetting('advSlLow', 92);
  s.setSetting('advSlHigh', 99);
  const initialCount = s.products().length;
  const initialStock = s.getProduct(custom.id)!.stock;

  // 1. Malformed syntax, missing products[], and unsupported future schema version
  assert.throws(() => s.importJSON('{bad json'), /Malformed JSON syntax/i);
  assert.throws(() => s.importJSON(JSON.stringify({ app: 'FactoryMind' })), /missing products\[\]/i);
  assert.throws(
    () => s.importJSON(JSON.stringify({ version: CURRENT_SCHEMA_VERSION + 5, products: [] })),
    /newer schema/i
  );

  // 2. Duplicate SKU inside JSON payload rejected atomically
  assert.throws(
    () =>
      s.importJSON(
        JSON.stringify({
          products: [
            { id: 'p1', sku: 'DUP-1', name: 'Item A', unitCost: 10, stock: 5, annualDemand: 100, orderCost: 10, holdingRate: 20, leadTime: 5 },
            { id: 'p2', sku: 'dup-1', name: 'Item B', unitCost: 12, stock: 8, annualDemand: 200, orderCost: 10, holdingRate: 20, leadTime: 5 },
          ],
        })
      ),
    /Duplicate SKU/i
  );

  // 3. Invalid negative/NaN/out-of-range numeric fields & orphan transactions rejected
  assert.throws(
    () =>
      s.importJSON(
        JSON.stringify({
          products: [
            { id: 'p1', sku: 'NEG-COST', name: 'Bad Cost', unitCost: -1, stock: 5, annualDemand: 10, orderCost: 10, holdingRate: 20, leadTime: 5 },
          ],
        })
      ),
    /Unit cost/i
  );
  assert.throws(
    () =>
      s.importJSON(
        JSON.stringify({
          products: [
            { id: 'p1', sku: 'BAD-HR', name: 'Bad Holding', unitCost: 5, stock: 5, annualDemand: 10, orderCost: 10, holdingRate: 150, leadTime: 5 },
          ],
        })
      ),
    /Holding rate/i
  );
  assert.throws(
    () =>
      s.importJSON(
        JSON.stringify({
          products: [
            { id: 'p1', sku: 'OK-1', name: 'Good Item', unitCost: 5, stock: 5, annualDemand: 10, orderCost: 10, holdingRate: 20, leadTime: 5 },
          ],
          transactions: [{ id: 'tx1', productId: 'missing-id', type: 'in', qty: 5, ts: Date.now() }],
        })
      ),
    /unknown productId/i
  );

  // Existing workspace must be completely intact after all rejected imports
  assert.equal(s.products().length, initialCount);
  assert.equal(s.getProduct(custom.id)!.stock, initialStock);

  // 4. Legacy schema v1 JSON backup migrates cleanly to v2 & preserves full workspace
  s.saveScenarioStudioRecord({
    id: 'sc-studio-1',
    name: 'Line Expansion',
    notes: '+1 CNC machine',
    isBaseline: false,
    params: {
      demandVolumeMult: 1.15,
      demandVariabilityMult: 1,
      supplierLeadTimeMult: 0.9,
      targetServiceLevelPct: 97,
      reorderPolicy: 'service-target',
      machineCycleMult: 0.95,
      breakdownFreqMult: 1,
      scrapRatePct: 1,
      shiftsPerDay: 2,
      shiftHours: 8,
      operatorsAvailable: 6,
      bufferCapacity: 8,
      extraBottleneckMachines: 1,
      safetyStockMult: 1,
      productionBatchQty: 10,
      horizonHours: 48,
      assemblySku: 'ASM-PA100',
      replications: 8,
      seed: 123,
    },
  });
  const backupV2 = s.exportJSON();
  const parsedV2 = JSON.parse(backupV2) as Record<string, unknown>;
  assert.equal(parsedV2.version, CURRENT_SCHEMA_VERSION);
  // Simulate a v1 backup file
  const v1Text = JSON.stringify({ ...parsedV2, version: 1, schemaVersion: undefined });
  const target = new FactoryStore(memoryBackend());
  const { report } = target.validateJSONImport(v1Text);
  assert.equal(report.valid, true);
  assert.equal(report.migratedFromVersion, 1);
  target.importJSON(v1Text);

  const restoredProd = target.products().find((p) => p.sku === 'REL-001');
  assert.ok(restoredProd);
  assert.equal(restoredProd.stock, 100);
  assert.equal(restoredProd.serviceLevel, 97.5);
  assert.deepEqual(restoredProd.demandHistory, custom.demandHistory);
  assert.equal(target.settings().reduceMotion, true);
  assert.equal(target.settings().advCover, 2.5);
  assert.equal(target.settings().advSlLow, 92);
  assert.equal(target.settings().advSlHigh, 99);
  assert.equal(target.getScenarioStudioRecords().length, 1);
  assert.equal(target.db.version, CURRENT_SCHEMA_VERSION);

  // Undo last JSON replace restores pre-import state
  assert.equal(target.getStorageHealth().canUndoLastReplace, true);
  assert.equal(target.undoLastWorkspaceReplace(), true);
  assert.equal(target.products().some((p) => p.sku === 'REL-001'), false);
});

test('Data Reliability [CSV & Ledger]: validates malformed CSV, duplicate SKUs, numeric bounds, name non-hijacking, formula defense & stock reconciliation', () => {
  const storage = memoryBackend();
  const s = new FactoryStore(storage);
  const startCount = s.products().length;

  // 1. Malformed CSV (unclosed quote, header-only, missing SKU/Name column)
  assert.throws(() => s.importProductsCSV('SKU,Name,Stock\n"ABC-1,Unclosed,10'), /unclosed quotation/i);
  assert.throws(() => s.importProductsCSV('SKU,Name,Stock\n'), /headers only/i);
  assert.throws(() => s.importProductsCSV('Price,Qty\n10,5'), /no SKU or Name column/i);

  // 2. Duplicate SKU within same CSV + out-of-range holdingRate/serviceLevel + invalid number
  const csvWithErrors = [
    '\uFEFFSKU,Name,Unit Cost,Stock,Holding Rate %,Lead Time (days),Service Level',
    'CSV-NEW-1,Valid Spacer,2.50,40,20,5,95',
    'csv-new-1,Duplicate Spacer Row,3.00,99,20,5,95',
    'BAD-HR,Bad Holding,5,10,150,5,95',
    'BAD-SL,Bad Service Level,5,10,20,5,25',
    'BAD-NUM,Formula Number,=1+1,10,20,5,95',
  ].join('\n');

  const preCheck = s.validateProductsCSV(csvWithErrors);
  assert.equal(preCheck.valid, false);
  assert.equal(preCheck.wouldCreate, 1);
  assert.equal(preCheck.skipped.length, 4);

  const res = s.importProductsCSV(csvWithErrors);
  assert.equal(res.created, 1);
  assert.equal(res.skipped.length, 4);
  assert.ok(res.skipped.some((x) => /duplicate SKU "CSV-NEW-1"/i.test(x.reason)));
  assert.equal(s.products().length, startCount + 1);
  const createdSpacer = s.products().find((p) => p.sku === 'CSV-NEW-1')!;
  assert.equal(createdSpacer.stock, 40);
  assert.equal(s.transactionsFor(createdSpacer.id).length, 1);

  // 3. Name coincidence MUST NOT overwrite an existing SKU when a different SKU is given
  const sameNameNewSkuCsv = [
    'SKU,Name,Unit Cost,Stock',
    'STL-NEW-2,Steel Rod Ø12mm (1045),4.50,15',
  ].join('\n');
  const nameCheck = s.importProductsCSV(sameNameNewSkuCsv);
  assert.equal(nameCheck.created, 1);
  assert.equal(nameCheck.updated, 0);
  assert.ok(s.products().some((p) => p.sku === 'STL-1045'));
  assert.ok(s.products().some((p) => p.sku === 'STL-NEW-2'));

  // 4. Updating stock directly via updateProduct reconciles ledger history automatically
  const beforeTx = s.transactionsFor(createdSpacer.id).length;
  s.updateProduct(createdSpacer.id, { stock: 65 });
  assert.equal(s.getProduct(createdSpacer.id)!.stock, 65);
  const afterTxs = s.transactionsFor(createdSpacer.id);
  assert.equal(afterTxs.length, beforeTx + 1);
  assert.equal(afterTxs[0].type, 'in');
  assert.equal(afterTxs[0].qty, 25);

  // 5. Duplicate SKU guard on programmatic addProduct & updateProduct
  assert.throws(() => s.addProduct({ sku: 'csv-new-1', name: 'Dup' }), /Duplicate SKU/i);

  // 6. Formula injection protection across escapeCsvCell & mrpToCSV (without double-escaping)
  assert.equal(escapeCsvCell('\tcmd'), "'\tcmd");
  assert.equal(escapeCsvCell('\rcmd'), '"\'\rcmd"');
  const badPlan = mrpPlan({ rootId: 'MISSING', planQuantity: 10, items: {} });
  const mrpCsv = mrpToCSV(badPlan);
  assert.ok(!mrpCsv.includes("''="));
});

test('Data Reliability [Storage]: startup preserves empty user workspace, quarantines corrupted storage without sample replacement, and handles QuotaExceededError', () => {
  // 1. Valid empty workspace (user explicitly cleared data) stays empty on restart — NOT seeded with demo data
  const emptyUserStorage = memoryBackend();
  const sClear = new FactoryStore(emptyUserStorage);
  sClear.clearAll();
  assert.equal(sClear.products().length, 0);
  const sReloadEmpty = new FactoryStore(emptyUserStorage);
  assert.equal(sReloadEmpty.products().length, 0);
  assert.equal(sReloadEmpty.getStorageHealth().corruptedDetected, false);

  // 2. Corrupted browser storage MUST be quarantined, NEVER replaced with demo dataset on startup
  const corruptMap: Record<string, string> = {
    'factorymind.db.v3': '{"version":2,"products":[{"sku":"USR-KEEP", CORRUPT_TRUNCATED',
  };
  const corruptStorage: StorageBackend = {
    persistent: true,
    get: (k) => (k in corruptMap ? corruptMap[k] : null),
    set: (k, v) => {
      corruptMap[k] = v;
      return true;
    },
    del: (k) => {
      delete corruptMap[k];
    },
  };
  const sRecovered = new FactoryStore(corruptStorage);
  const health = sRecovered.getStorageHealth();
  assert.equal(health.status, 'corrupted');
  assert.equal(health.corruptedDetected, true);
  assert.equal(sRecovered.products().length, 0);
  assert.ok(sRecovered.getCorruptedBackupRaw()?.includes('USR-KEEP'));
  // Original corrupted primary key was NOT overwritten with demo sample data on startup
  assert.ok(corruptMap['factorymind.db.v3'].includes('CORRUPT_TRUNCATED'));
  assert.equal(corruptMap['factorymind.db.corrupt_backup'], corruptMap['factorymind.db.v3']);

  // 3. Simulated browser localStorage QuotaExceededError via createSafeStorage
  const lsBacking: Record<string, string> = {};
  let blockWrites = false;
  const fakeLs = {
    get length() {
      return Object.keys(lsBacking).length;
    },
    clear() {
      Object.keys(lsBacking).forEach((k) => delete lsBacking[k]);
    },
    key(idx: number) {
      return Object.keys(lsBacking)[idx] ?? null;
    },
    getItem(k: string) {
      return k in lsBacking ? lsBacking[k] : null;
    },
    setItem(k: string, v: string) {
      if (blockWrites && k !== '__fm_probe__') {
        throw new Error('QuotaExceededError: Storage quota exceeded');
      }
      lsBacking[k] = v;
    },
    removeItem(k: string) {
      delete lsBacking[k];
    },
  };
  const prevDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: fakeLs, configurable: true, writable: true });
  try {
    let errorCallbackFired = 0;
    const safeLs = createSafeStorage(() => {
      errorCallbackFired++;
    });
    const sQuota = new FactoryStore(safeLs);
    assert.equal(sQuota.getStorageHealth().persisted, true);

    // Hit quota limit on subsequent mutation
    blockWrites = true;
    sQuota.addProduct({ sku: 'MEM-ONLY-1', name: 'In-Memory Resilient Part', unitCost: 15, stock: 30, annualDemand: 300 });
    assert.ok(errorCallbackFired >= 1);
    const qHealth = sQuota.getStorageHealth();
    assert.equal(qHealth.status, 'quota_exceeded');
    assert.equal(qHealth.quotaExceeded, true);
    assert.equal(qHealth.persisted, false);
    // Subsequent read from storage sees latest memDirty payload rather than stale lsBacking!
    const memPayload = safeLs.get('factorymind.db.v3') || '';
    assert.ok(memPayload.includes('MEM-ONLY-1'));
    assert.ok(sQuota.exportJSON().includes('MEM-ONLY-1'));
  } finally {
    if (prevDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', prevDescriptor);
    } else {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  }
});


