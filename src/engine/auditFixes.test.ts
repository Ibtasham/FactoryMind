import assert from 'node:assert/strict';
import test from 'node:test';
import { isStaticHostingEnvironment, STATIC_AI_UNAVAILABLE_NOTICE } from './decisionAssistant.ts';
import { clampNumericInput, csvRow, escapeCsvCell } from './formatters.ts';
import { clampTaskDuration, nextUniqueTaskId } from './linebal.ts';
import { mrpPlan, mrpToCSV } from './mrp.ts';
import {
  buildPlantFloorTwin,
  computePlantTopologyKey,
  PlantRackProductInput,
  PlantStationInput,
  updatePlantFloorTwin,
} from './threeModels.ts';

test('escapeCsvCell and csvRow neutralize spreadsheet formula prefixes and quote special characters', () => {
  assert.equal(escapeCsvCell('=SUM(A1:A5)'), "'=SUM(A1:A5)");
  assert.equal(escapeCsvCell('+cmd'), "'+cmd");
  assert.equal(escapeCsvCell('-10'), "'-10");
  assert.equal(escapeCsvCell('@RISK'), "'@RISK");
  assert.equal(escapeCsvCell('  =1+1'), "'  =1+1");
  assert.equal(escapeCsvCell('Bolt, M8 "Hex"'), '"Bolt, M8 ""Hex"""');
  assert.equal(csvRow(['SKU-1', '=1+1', 'Alpha, Inc']), 'SKU-1,\'=1+1,"Alpha, Inc"');
});

test('mrpToCSV uses CRLF line endings and escapes formula-injected root/component metadata', () => {
  const plan = mrpPlan({
    rootId: '=ASM-ROOT',
    planQuantity: 10,
    needInDays: 14,
    horizonDays: 30,
    items: {
      '=ASM-ROOT': {
        id: '=ASM-ROOT',
        name: '=Malicious, Root',
        bom: [{ componentId: '+CMP-1', qtyPer: 2 }],
      },
      '+CMP-1': {
        id: '+CMP-1',
        name: '@Component "One"',
        onHand: 2,
        safetyStock: 5,
        leadTimeDays: 7,
      },
    },
  });

  const csv = mrpToCSV(plan);
  assert.ok(csv.includes('\r\n'));
  const lines = csv.split('\r\n');
  assert.ok(lines.some((l) => l.startsWith('Root item,\'=ASM-ROOT')));
  assert.ok(lines.some((l) => l.includes('\'+CMP-1') && l.includes('"\'@Component ""One"""')));
});

test('nextUniqueTaskId skips existing IDs with gaps and clampTaskDuration enforces [0.5, 1000]', () => {
  assert.equal(nextUniqueTaskId([{ id: 'T1' }, { id: 'T3' }]), 'T4');
  assert.equal(nextUniqueTaskId([{ id: 't1' }, { id: 'T2' }, { id: 'T4' }]), 'T5');
  assert.equal(nextUniqueTaskId([]), 'T1');

  assert.equal(clampTaskDuration(0, 2), 0.5);
  assert.equal(clampTaskDuration('1500', 2), 1000);
  assert.equal(clampTaskDuration('bad', 3.5), 3.5);
  assert.equal(clampTaskDuration(4.25, 2), 4.25);
});

test('clampNumericInput preserves explicit 0 when min=0, enforces bounds, and rounds when requested', () => {
  assert.equal(clampNumericInput('0', 0.25, 0, 2), 0);
  assert.equal(clampNumericInput(0, 10, 0, 100), 0);
  assert.equal(clampNumericInput('', 0.35, 0, 1), 0.35);
  assert.equal(clampNumericInput('abc', 5, 1, 10), 5);
  assert.equal(clampNumericInput('-5', 5, 0, 10), 0);
  assert.equal(clampNumericInput('42.7', 1, 1, 20, true), 20);
  assert.equal(clampNumericInput('7.6', 1, 1, 20, true), 8);
});

test('updatePlantFloorTwin updates stations, queues, racks, and carriers in-place when topology matches', () => {
  const products: PlantRackProductInput[] = [
    {
      id: 'p1',
      sku: 'BRG-6205',
      name: 'Radial Bearing 6205',
      category: 'Bearings',
      stock: 120,
      rop: 50,
      unit: 'pcs',
      status: 'ok',
    },
    {
      id: 'p2',
      sku: 'MOT-05HP',
      name: 'Induction Motor 0.5HP',
      category: 'Motors',
      stock: 40,
      rop: 30,
      unit: 'pcs',
      status: 'reorder',
    },
  ];

  const stations: PlantStationInput[] = [
    {
      stationNumber: 1,
      stationId: 'S1',
      stationName: 'Subassembly',
      utilizationPct: 68,
      taskCount: 3,
      tasksLabel: 'Frame prep',
      machineState: 'processing',
      bufferCapacity: 6,
      avgQueueLen: 1,
      throughputPerHour: 40,
      activeOrderIds: ['WO-101'],
    },
    {
      stationNumber: 2,
      stationId: 'S2',
      stationName: 'Final Test',
      utilizationPct: 92,
      taskCount: 2,
      tasksLabel: 'Run-in & QA',
      isBottleneck: true,
      machineState: 'bottleneck',
      bufferCapacity: 6,
      avgQueueLen: 4,
      throughputPerHour: 40,
    },
  ];

  const built = buildPlantFloorTwin(products, stations, 'slate');
  assert.ok(built.plantHandle);
  assert.equal(built.plantHandle.topologyKey, computePlantTopologyKey(products, stations));

  // Mutate telemetry without changing station count or SKU list -> updates in place
  const nextProducts: PlantRackProductInput[] = [
    { ...products[0], stock: 12, status: 'critical', starvedInSimulation: true },
    { ...products[1], stock: 0, status: 'out' },
  ];
  const nextStations: PlantStationInput[] = [
    { ...stations[0], utilizationPct: 10, machineState: 'breakdown', avgQueueLen: 5, activeOrderIds: [] },
    { ...stations[1], utilizationPct: 45, machineState: 'idle', isBottleneck: false, avgQueueLen: 0, activeOrderIds: ['WO-102'] },
  ];

  const updated = updatePlantFloorTwin(built, nextProducts, nextStations);
  assert.equal(updated, true);
  assert.equal(built.plantHandle.stationHandles[0].apronMesh.material, built.plantHandle.machineMatMap.breakdown);
  assert.equal(built.plantHandle.stationHandles[0].orderToteMesh.visible, false);
  assert.equal(built.plantHandle.stationHandles[1].orderToteMesh.visible, true);
  assert.equal(
    built.plantHandle.stationHandles[0].qBoxMeshes.filter((m) => m.visible).length,
    5
  );
  assert.equal(
    built.plantHandle.stationHandles[1].qBoxMeshes.filter((m) => m.visible).length,
    0
  );
  assert.equal(built.plantHandle.binHandles[0].stripMesh.material, built.plantHandle.statusMats.critical);
  assert.equal(built.plantHandle.carrierHandles[0].toteMesh.material, built.plantHandle.statusMats.critical);

  // Changing SKU list or station count requires structural rebuild (returns false)
  assert.equal(updatePlantFloorTwin(built, [products[0]], nextStations), false);
  assert.equal(updatePlantFloorTwin(built, nextProducts, [nextStations[0]]), false);

  built.dispose();
});

test('isStaticHostingEnvironment identifies GitHub Pages, VITE_STATIC_ONLY builds, and file:// safely', () => {
  assert.equal(isStaticHostingEnvironment({ viteStaticOnly: 'true', hostname: 'factorymind.example.com' }), true);
  assert.equal(isStaticHostingEnvironment({ hostname: 'ibtasham.github.io' }), true);
  assert.equal(isStaticHostingEnvironment({ protocol: 'file:', hostname: '' }), true);
  assert.equal(isStaticHostingEnvironment({ viteStaticOnly: '', hostname: 'localhost', protocol: 'http:' }), false);
  assert.ok(STATIC_AI_UNAVAILABLE_NOTICE.includes('GitHub Pages'));
  assert.ok(STATIC_AI_UNAVAILABLE_NOTICE.includes('Deterministic'));
});
