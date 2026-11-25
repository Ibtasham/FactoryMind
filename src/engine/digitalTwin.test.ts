import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDigitalTwinSnapshot,
  buildTwinScenarioComparison,
  classifyMachineVisualStatus,
  formatRackLocation,
  mapStockToInventoryVisualStatus,
  TwinCatalogMetricInput,
  VISUAL_INDICATOR_SPECS,
} from './digitalTwin.ts';
import {
  buildBaselineScenarioFromWorkspace,
  buildPresetScenarioDefinitions,
  evaluateScenario,
  ScenarioWorkspaceInput,
} from './scenarioStudio.ts';
import { buildAssembly3D, buildPlantFloorTwin, updatePlantFloorTwin } from './threeModels.ts';
import { ASSEMBLY_3D_SPECS, ASSEMBLY_SKU_LIST } from './threeSpecs.ts';
import { FactoryStore, StorageBackend } from '../store/store.ts';

function memoryStorage(): StorageBackend {
  const map = new Map<string, string>();
  return {
    persistent: false,
    get: (k) => (map.has(k) ? map.get(k)! : null),
    set: (k, v) => {
      map.set(k, v);
    },
    del: (k) => {
      map.delete(k);
    },
  };
}

function buildWorkspace(): {
  ws: ScenarioWorkspaceInput;
  metricsMap: Map<string, TwinCatalogMetricInput>;
} {
  const store = new FactoryStore(memoryStorage());
  const products = store.products();
  const lb = store.getLineBalance();
  const fcfg = store.getFactorySimConfig();

  const metricsMap = new Map<string, TwinCatalogMetricInput>();
  products.forEach((p) => {
    const m = store.metrics(p);
    metricsMap.set(p.id, {
      rop: m.rop,
      safetyStock: m.safetyStock,
      status: m.status,
      eoqQty: m.eoq.Q,
    });
  });

  return {
    ws: {
      products,
      lineBalance: lb,
      factorySimConfig: fcfg,
    },
    metricsMap,
  };
}

test('Visual indicator taxonomy covers all 9 required inventory and machine states', () => {
  const keys = Object.keys(VISUAL_INDICATOR_SPECS);
  assert.equal(keys.length, 9);
  for (const key of ['normal', 'reorder', 'low', 'idle', 'processing', 'breakdown', 'maintenance', 'congested', 'bottleneck']) {
    assert.ok(keys.includes(key), `Missing visual indicator spec: ${key}`);
  }
});

test('Inventory visual mapping distinguishes normal, reorder, and low/critical stock', () => {
  assert.equal(mapStockToInventoryVisualStatus('ok', 120, 40, 15), 'normal');
  assert.equal(mapStockToInventoryVisualStatus('reorder', 35, 40, 15), 'reorder');
  assert.equal(mapStockToInventoryVisualStatus('critical', 10, 40, 15), 'low');
  assert.equal(mapStockToInventoryVisualStatus('out', 0, 40, 15), 'low');
});

test('Machine visual classification maps timeline and aggregate DES states consistently', () => {
  assert.equal(
    classifyMachineVisualStatus({
      frameState: 'down',
      queueLen: 1,
      bufferCapacity: 6,
      isBottleneck: false,
      downPct: 5,
      pmPct: 0,
      blockedPct: 0,
      utilizationPct: 50,
    }),
    'breakdown'
  );
  assert.equal(
    classifyMachineVisualStatus({
      frameState: 'pm',
      queueLen: 0,
      bufferCapacity: 6,
      isBottleneck: false,
      downPct: 0,
      pmPct: 10,
      blockedPct: 0,
      utilizationPct: 40,
    }),
    'maintenance'
  );
  assert.equal(
    classifyMachineVisualStatus({
      frameState: 'busy',
      queueLen: 5,
      bufferCapacity: 6,
      isBottleneck: false,
      downPct: 0,
      pmPct: 0,
      blockedPct: 0,
      utilizationPct: 80,
    }),
    'congested'
  );
  assert.equal(
    classifyMachineVisualStatus({
      frameState: 'busy',
      queueLen: 2,
      bufferCapacity: 6,
      isBottleneck: true,
      downPct: 0,
      pmPct: 0,
      blockedPct: 0,
      utilizationPct: 95,
    }),
    'bottleneck'
  );
  assert.equal(
    classifyMachineVisualStatus({
      frameState: 'starved',
      queueLen: 0,
      bufferCapacity: 6,
      isBottleneck: false,
      downPct: 0,
      pmPct: 0,
      blockedPct: 0,
      utilizationPct: 10,
    }),
    'idle'
  );
  assert.equal(
    classifyMachineVisualStatus({
      frameState: 'busy',
      queueLen: 1,
      bufferCapacity: 6,
      isBottleneck: false,
      downPct: 0,
      pmPct: 0,
      blockedPct: 0,
      utilizationPct: 68,
    }),
    'processing'
  );
});

test('Rack addressing produces deterministic R#-S#-B# coordinates and BOM parent links', () => {
  assert.deepEqual(formatRackLocation(0), { code: 'R1-S1-B1', rack: 1, shelf: 1, bay: 1 });
  assert.deepEqual(formatRackLocation(5), { code: 'R1-S2-B3', rack: 1, shelf: 2, bay: 3 });
  assert.deepEqual(formatRackLocation(6), { code: 'R2-S1-B1', rack: 2, shelf: 1, bay: 1 });
  assert.deepEqual(formatRackLocation(17), { code: 'R3-S2-B3', rack: 3, shelf: 2, bay: 3 });

  const { ws, metricsMap } = buildWorkspace();
  const baseDef = buildBaselineScenarioFromWorkspace(ws);
  const evalRes = evaluateScenario(baseDef, ws);
  const snap = buildDigitalTwinSnapshot({
    products: ws.products,
    metricsMap,
    evaluation: evalRes,
    assemblySku: 'ASM-CM200',
    origin: 'baseline',
  });

  assert.ok(snap.rackBins.length > 0);
  assert.ok(snap.bomLinks.length > 0, 'Should resolve BOM component links for ASM-CM200');
  assert.ok(snap.stations.length >= 2, 'Should map DES stations into twin stations');
  assert.ok(snap.orders.length > 0, 'Should surface DES order telemetry');
  assert.ok(snap.materialFlows.length > 0, 'Should map warehouse-to-station material flows');

  // Provenance tagging discipline: catalog stock vs simulated machine telemetry
  assert.equal(snap.rackBins[0].provenance, 'WORKSPACE_CATALOG');
  assert.equal(snap.stations[0].provenance, 'SIMULATED_DES_MODEL');

  // Verify bearing BRG-6205 shows multi-assembly parent usage
  const bearingBin = snap.rackBins.find((b) => b.sku === 'BRG-6205');
  assert.ok(bearingBin);
  assert.ok(bearingBin.usedInAssemblies.length >= 2);
});

test('Playback timeline cursor reflects exact DES frame and scenario comparison computes before-vs-after deltas', () => {
  const { ws, metricsMap } = buildWorkspace();
  const baseDef = buildBaselineScenarioFromWorkspace(ws);
  const presets = buildPresetScenarioDefinitions(ws);
  const capacityPreset = presets.find((p) => p.id === 'preset-capacity-resilience')!;

  const baseEval = evaluateScenario(baseDef, ws);
  const snapStart = buildDigitalTwinSnapshot({
    products: ws.products,
    metricsMap,
    evaluation: baseEval,
    assemblySku: baseDef.params.assemblySku,
    frameIdx: 0,
    origin: 'baseline',
  });
  const snapEnd = buildDigitalTwinSnapshot({
    products: ws.products,
    metricsMap,
    evaluation: baseEval,
    assemblySku: baseDef.params.assemblySku,
    frameIdx: Math.max(0, (baseEval.desResult.timeline.length || 1) - 1),
    origin: 'baseline',
  });

  assert.ok(snapStart.timeline && snapEnd.timeline);
  assert.ok(snapEnd.timeline.completedCumulative >= snapStart.timeline.completedCumulative);

  const comparison = buildTwinScenarioComparison(ws, baseDef, capacityPreset, metricsMap);
  assert.equal(comparison.baseline.snapshotOrigin, 'baseline');
  assert.equal(comparison.scenario.snapshotOrigin, 'scenario');
  assert.ok(comparison.scenario.rackBins.some((b) => b.provenance === 'SCENARIO_COUNTERFACTUAL' || b.provenance === 'WORKSPACE_CATALOG'));
  assert.ok(Number.isFinite(comparison.deltas.throughputDeltaPct));
  assert.ok(Number.isFinite(comparison.deltas.oeeDeltaPts));
  assert.ok(comparison.whatChanged.length > 0);
});

test('All 5 assembly projects build project-matched workshop machine bays without polluting selectable BOM parts', () => {
  const meshCountByProject = new Map<string, number>();

  for (const sku of ASSEMBLY_SKU_LIST) {
    const built = buildAssembly3D(sku, 'steel');
    const spec = ASSEMBLY_3D_SPECS[sku];

    assert.equal(
      built.parts.length,
      spec.parts.length,
      `${sku}: selectable parts[] should match BOM spec length without background props`
    );
    assert.ok(
      built.root.children.length >= 2,
      `${sku}: outer root must contain both workshop environment and grounded hero assembly`
    );

    let totalMeshes = 0;
    built.root.traverse((obj) => {
      if ((obj as { isMesh?: boolean }).isMesh) totalMeshes += 1;
    });
    let partMeshes = 0;
    built.parts.forEach((p) => {
      p.traverse((obj) => {
        if ((obj as { isMesh?: boolean }).isMesh) partMeshes += 1;
      });
    });

    assert.ok(
      totalMeshes - partMeshes >= 15,
      `${sku}: workshop environment should render rich machine/bay geometry (got ${totalMeshes - partMeshes})`
    );
    meshCountByProject.set(sku, totalMeshes - partMeshes);

    // Every BOM part retains valid basePos & explodeOffset for explode slider
    built.parts.forEach((p) => {
      assert.ok(Array.isArray(p.userData.basePos) && p.userData.basePos.length === 3);
      assert.ok(Array.isArray(p.userData.explodeOffset) && p.userData.explodeOffset.length === 3);
      assert.ok(typeof p.userData.partId === 'string' && p.userData.partId.length > 0);
    });

    built.dispose();
  }

  // Different projects must yield distinct workshop layouts/machine mesh counts
  const uniqueEnvMeshCounts = new Set(meshCountByProject.values());
  assert.ok(uniqueEnvMeshCounts.size >= 3, 'Different assembly projects should generate distinct background machinery');
});

test('Plant Digital Twin adds perimeter hall & overhead bridge crane outside selectable parts[] and preserves in-place telemetry updates', () => {
  const { ws, metricsMap } = buildWorkspace();
  const baseDef = buildBaselineScenarioFromWorkspace(ws);
  const evalRes = evaluateScenario(baseDef, ws);
  const snap = buildDigitalTwinSnapshot({
    products: ws.products,
    metricsMap,
    evaluation: evalRes,
    assemblySku: 'ASM-CM200',
    origin: 'baseline',
  });

  const productsInput = snap.rackBins.map((b) => ({
    id: b.productId,
    sku: b.sku,
    name: b.name,
    category: b.category,
    stock: b.stock,
    rop: b.rop,
    unit: b.unit,
    status: b.stockStatus,
    rackCode: b.location.code,
    usedInAssemblies: b.usedInAssemblies,
    starvedInSimulation: b.starvedInSimulation,
  }));
  const stationsInput = snap.stations.map((s) => ({
    stationNumber: s.stationNumber,
    utilizationPct: s.utilizationPct,
    taskCount: s.machineCount,
    tasksLabel: s.tasksLabel,
    isBottleneck: s.isBottleneck,
    avgQueueLen: s.avgQueueLen,
    throughputPerHour: s.throughputPerHour,
    stationId: s.id,
    stationName: s.name,
    machineState: s.machineState,
    bufferCapacity: s.bufferCapacity,
  }));

  const plant = buildPlantFloorTwin(productsInput, stationsInput, 'cobalt', { assemblySku: 'ASM-CM200' });
  const expectedSelectable = Math.min(18, productsInput.length) + Math.min(6, stationsInput.length);
  assert.equal(plant.parts.length, expectedSelectable, 'Background crane & perimeter machines must stay outside parts[]');

  let totalMeshes = 0;
  plant.root.traverse((obj) => {
    if ((obj as { isMesh?: boolean }).isMesh) totalMeshes += 1;
  });
  assert.ok(totalMeshes >= expectedSelectable + 35, 'Plant Twin should render outer hall, bridge crane & auxiliary machines');

  // Verify incremental update still succeeds cleanly
  const mutatedStations = stationsInput.map((s, idx) =>
    idx === 0 ? { ...s, utilizationPct: 91, machineState: 'bottleneck' as const } : s
  );
  assert.equal(updatePlantFloorTwin(plant, productsInput, mutatedStations, { assemblySku: 'ASM-CM200' }), true);

  plant.dispose();
});

