/**
 * Procedural Three.js industrial assembly & live plant floor digital twin builders.
 * Produces multi-part articulated THREE.Group meshes with beveled extrusions,
 * lathe profiles, tube piping, PBR materials, bottom-center pivots, and
 * full geometry/material/texture disposal tracking.
 */

import * as THREE from 'three';
import {
  classifyMachineVisualStatus,
  formatRackLocation,
  MachineVisualStatus,
  mapStockToInventoryVisualStatus,
  VISUAL_INDICATOR_SPECS,
} from './digitalTwin';
import { StockStatus } from './ipe';
import {
  AssemblySku,
  FINISH_PRESETS,
  FinishPresetId,
} from './threeSpecs';

export interface PartUserData {
  partId: string;
  label: string;
  sku: string;
  qtyPer?: number;
  role: string;
  basePos: [number, number, number];
  explodeOffset: [number, number, number];
  status?: StockStatus;
  stationNumber?: number;
  rackCode?: string;
  machineState?: MachineVisualStatus;
  focusTarget?: [number, number, number];
  usedInAssemblies?: string[];
}

export interface PlantRackProductInput {
  id: string;
  sku: string;
  name: string;
  category: string;
  stock: number;
  rop: number;
  unit: string;
  status: StockStatus;
  rackCode?: string;
  usedInAssemblies?: string[];
  starvedInSimulation?: boolean;
}

export interface PlantStationInput {
  stationNumber: number;
  utilizationPct: number;
  taskCount: number;
  tasksLabel: string;
  isBottleneck?: boolean;
  avgQueueLen?: number;
  throughputPerHour?: number;
  stationId?: string;
  stationName?: string;
  machineState?: MachineVisualStatus;
  bufferCapacity?: number;
  downPct?: number;
  pmPct?: number;
  blockedPct?: number;
  activeOrderIds?: string[];
}

export interface BuiltSceneRoot {
  root: THREE.Group;
  parts: THREE.Object3D[];
  conveyorItems: Array<{ mesh: THREE.Object3D; phase: number; speed: number }>;
  materialCarriers?: Array<{
    mesh: THREE.Object3D;
    start: THREE.Vector3;
    end: THREE.Vector3;
    phase: number;
    speed: number;
    stalled: boolean;
  }>;
  animatedHeads?: Array<{
    mesh: THREE.Object3D;
    baseY: number;
    phase: number;
    active: boolean;
    state: MachineVisualStatus;
  }>;
  floorAnchors?: Map<string, [number, number, number]>;
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Procedural Texture Helpers (Zero External Assets)
// ---------------------------------------------------------------------------

function createBrushedMetalTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y++) {
      const v = 115 + Math.round(Math.sin(y * 1.7) * 18 + ((y * 37) % 24));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, y, 256, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

function createRibbedBeltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 16) {
      ctx.fillStyle = '#334155';
      ctx.fillRect(x, 0, 5, 256);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x + 5, 0, 2, 256);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createFloorGridTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 512; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.24)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 510, 510);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Resource Tracker + Grounding
// ---------------------------------------------------------------------------

class SceneResourceBag {
  geometries: THREE.BufferGeometry[] = [];
  materials: THREE.Material[] = [];
  textures: THREE.Texture[] = [];

  trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  trackMat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  trackTex<T extends THREE.Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.geometries = [];
    this.materials = [];
    this.textures = [];
  }
}

function registerPart(
  parent: THREE.Group,
  partGroup: THREE.Group,
  parts: THREE.Object3D[],
  meta: Omit<PartUserData, 'basePos'>
) {
  const basePos: [number, number, number] = [partGroup.position.x, partGroup.position.y, partGroup.position.z];
  partGroup.userData = { ...meta, basePos };
  partGroup.traverse((child) => {
    child.userData = { ...meta, basePos };
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  parent.add(partGroup);
  parts.push(partGroup);
}

function groundGroup(root: THREE.Group, parts: THREE.Object3D[]) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    const shiftY = -box.min.y;
    root.position.y += shiftY;
    // Also keep part basePos in local space unchanged since root shifts cleanly
    const center = new THREE.Vector3();
    box.getCenter(center);
    root.position.x -= center.x;
    root.position.z -= center.z;
  }
  // Ensure every part remembers its initial local basePos
  parts.forEach((p) => {
    p.userData.basePos = [p.position.x, p.position.y, p.position.z];
  });
}

function makeGearGeometry(
  bag: SceneResourceBag,
  teeth: number,
  outerRadius: number,
  innerRadius: number,
  boreRadius: number,
  depth: number
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const a1 = a0 + step * 0.22;
    const a2 = a0 + step * 0.34;
    const a3 = a0 + step * 0.66;
    const a4 = a0 + step * 0.78;
    if (i === 0) shape.moveTo(Math.cos(a0) * innerRadius, Math.sin(a0) * innerRadius);
    else shape.lineTo(Math.cos(a0) * innerRadius, Math.sin(a0) * innerRadius);
    shape.lineTo(Math.cos(a1) * innerRadius, Math.sin(a1) * innerRadius);
    shape.lineTo(Math.cos(a2) * outerRadius, Math.sin(a2) * outerRadius);
    shape.lineTo(Math.cos(a3) * outerRadius, Math.sin(a3) * outerRadius);
    shape.lineTo(Math.cos(a4) * innerRadius, Math.sin(a4) * innerRadius);
  }
  shape.closePath();

  if (boreRadius > 0.01) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, boreRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 2,
  });
  geo.center();
  return bag.trackGeo(geo);
}

function makeMaterialPalette(bag: SceneResourceBag, finishId: FinishPresetId) {
  const f = FINISH_PRESETS[finishId] || FINISH_PRESETS.steel;
  const brushed = bag.trackTex(createBrushedMetalTexture());
  const beltTex = bag.trackTex(createRibbedBeltTexture());

  const primary = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: f.primaryHex,
      metalness: f.metalness,
      roughness: f.roughness,
      roughnessMap: brushed,
    })
  );
  const secondary = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: f.secondaryHex,
      metalness: 0.45,
      roughness: 0.58,
    })
  );
  const accent = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: f.accentHex,
      metalness: 0.35,
      roughness: 0.36,
    })
  );
  const chrome = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      metalness: 0.92,
      roughness: 0.16,
      roughnessMap: brushed,
    })
  );
  const rubber = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: '#18181b',
      metalness: 0.04,
      roughness: 0.86,
      map: beltTex,
    })
  );
  const rubberPlain = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: '#1e293b',
      metalness: 0.05,
      roughness: 0.88,
    })
  );
  const brass = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: '#d97706',
      metalness: 0.86,
      roughness: 0.25,
    })
  );
  const copper = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: '#b45309',
      metalness: 0.88,
      roughness: 0.24,
    })
  );
  const glass = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: '#93c5fd',
      metalness: 0.1,
      roughness: 0.12,
      transparent: true,
      opacity: 0.42,
    })
  );
  const amberLiquid = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: '#f59e0b',
      metalness: 0.08,
      roughness: 0.18,
      transparent: true,
      opacity: 0.78,
    })
  );
  return { primary, secondary, accent, chrome, rubber, rubberPlain, brass, copper, glass, amberLiquid };
}

// ---------------------------------------------------------------------------
// 1. Conveyor Module ASM-CM200
// ---------------------------------------------------------------------------

function buildConveyorModule(bag: SceneResourceBag, finishId: FinishPresetId): BuiltSceneRoot {
  const root = new THREE.Group();
  const parts: THREE.Object3D[] = [];
  const p = makeMaterialPalette(bag, finishId);

  // Part 1: Twin Extruded C-Channel Steel Rails & Legs (STL-1045)
  const railsGrp = new THREE.Group();
  const railShape = new THREE.Shape();
  railShape.moveTo(-0.04, -0.09);
  railShape.lineTo(0.04, -0.09);
  railShape.lineTo(0.04, -0.06);
  railShape.lineTo(-0.01, -0.06);
  railShape.lineTo(-0.01, 0.06);
  railShape.lineTo(0.04, 0.06);
  railShape.lineTo(0.04, 0.09);
  railShape.lineTo(-0.04, 0.09);
  railShape.closePath();

  const railGeo = bag.trackGeo(
    new THREE.ExtrudeGeometry(railShape, {
      depth: 2.8,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 2,
    })
  );
  railGeo.center();
  railGeo.rotateY(Math.PI / 2);

  [-0.56, 0.56].forEach((z, idx) => {
    const rail = new THREE.Mesh(railGeo, p.primary);
    rail.position.set(0, 0.68, z);
    if (idx === 1) rail.rotation.y = Math.PI;
    railsGrp.add(rail);
  });

  const legGeo = bag.trackGeo(new THREE.BoxGeometry(0.08, 0.66, 0.08));
  const footGeo = bag.trackGeo(new THREE.CylinderGeometry(0.07, 0.08, 0.03, 16));
  const crossGeo = bag.trackGeo(new THREE.BoxGeometry(0.06, 0.06, 1.12));
  [-1.08, 1.08].forEach((x) => {
    [-0.54, 0.54].forEach((z) => {
      const leg = new THREE.Mesh(legGeo, p.secondary);
      leg.position.set(x, 0.34, z);
      railsGrp.add(leg);
      const foot = new THREE.Mesh(footGeo, p.rubberPlain);
      foot.position.set(x, 0.015, z);
      railsGrp.add(foot);
    });
    const cross = new THREE.Mesh(crossGeo, p.secondary);
    cross.position.set(x, 0.24, 0);
    railsGrp.add(cross);
  });
  registerPart(root, railsGrp, parts, {
    partId: 'cm-rails',
    label: 'Extruded Frame Rails',
    sku: 'STL-1045',
    qtyPer: 2,
    role: 'Structural load-bearing C-channel chassis',
    explodeOffset: [0, -0.35, 0],
  });

  // Part 2: Continuous PVC Conveyor Belt 500mm (CNV-B500)
  const beltGrp = new THREE.Group();
  const beltShape = new THREE.Shape();
  const beltLen = 1.24;
  const beltR = 0.095;
  beltShape.absarc(beltLen, 0, beltR, -Math.PI / 2, Math.PI / 2, false);
  beltShape.absarc(-beltLen, 0, beltR, Math.PI / 2, (Math.PI * 3) / 2, false);
  beltShape.closePath();

  const beltHole = new THREE.Path();
  beltHole.absarc(beltLen, 0, beltR - 0.024, -Math.PI / 2, Math.PI / 2, false);
  beltHole.absarc(-beltLen, 0, beltR - 0.024, Math.PI / 2, (Math.PI * 3) / 2, false);
  beltHole.closePath();
  beltShape.holes.push(beltHole);

  const beltGeo = bag.trackGeo(
    new THREE.ExtrudeGeometry(beltShape, {
      depth: 0.96,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.006,
      bevelSegments: 2,
    })
  );
  beltGeo.center();
  const beltMesh = new THREE.Mesh(beltGeo, p.rubber);
  beltMesh.position.set(0, 0.72, 0);
  beltGrp.add(beltMesh);

  // Subtle belt ribs on top
  const cleatGeo = bag.trackGeo(new THREE.BoxGeometry(0.025, 0.016, 0.92));
  for (let x = -1.05; x <= 1.05; x += 0.26) {
    const cleat = new THREE.Mesh(cleatGeo, p.secondary);
    cleat.position.set(x, 0.822, 0);
    beltGrp.add(cleat);
  }
  registerPart(root, beltGrp, parts, {
    partId: 'cm-belt',
    label: 'PVC Conveyor Belt 500mm',
    sku: 'CNV-B500',
    qtyPer: 6,
    role: 'Continuous ribbed high-grip transport loop',
    explodeOffset: [0, 0.65, 0],
  });

  // Part 3: Drive & Idler Rollers + Sealed 6205 Bearings (BRG-6205)
  const rollersGrp = new THREE.Group();
  const rollerGeo = bag.trackGeo(new THREE.CylinderGeometry(0.068, 0.068, 0.98, 24));
  rollerGeo.rotateX(Math.PI / 2);
  const shaftGeo = bag.trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 1.24, 16));
  shaftGeo.rotateX(Math.PI / 2);
  const brgGeo = bag.trackGeo(new THREE.CylinderGeometry(0.048, 0.048, 0.04, 18));
  brgGeo.rotateX(Math.PI / 2);

  [-1.24, -0.42, 0.42, 1.24].forEach((x) => {
    const rMesh = new THREE.Mesh(rollerGeo, p.chrome);
    rMesh.position.set(x, 0.72, 0);
    rollersGrp.add(rMesh);

    const sMesh = new THREE.Mesh(shaftGeo, p.secondary);
    sMesh.position.set(x, 0.72, 0);
    rollersGrp.add(sMesh);

    [-0.56, 0.56].forEach((z) => {
      const bMesh = new THREE.Mesh(brgGeo, p.brass);
      bMesh.position.set(x, 0.72, z);
      rollersGrp.add(bMesh);
    });
  });
  registerPart(root, rollersGrp, parts, {
    partId: 'cm-rollers',
    label: 'Drive & Idler Rollers + Bearings',
    sku: 'BRG-6205',
    qtyPer: 4,
    role: 'Precision-turned shafts with sealed 6205 bearings',
    explodeOffset: [0, 0.22, 0],
  });

  // Part 4: IP54 Side Control Enclosure + Conduit (PNL-CTL3)
  const panelGrp = new THREE.Group();
  const cabGeo = bag.trackGeo(new THREE.BoxGeometry(0.42, 0.44, 0.22));
  const cab = new THREE.Mesh(cabGeo, p.accent);
  cab.position.set(-0.78, 0.62, 0.74);
  panelGrp.add(cab);

  const bezelGeo = bag.trackGeo(new THREE.BoxGeometry(0.32, 0.28, 0.02));
  const bezel = new THREE.Mesh(bezelGeo, p.secondary);
  bezel.position.set(-0.78, 0.65, 0.855);
  panelGrp.add(bezel);

  const dialGeo = bag.trackGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 16));
  dialGeo.rotateX(Math.PI / 2);
  const dial = new THREE.Mesh(dialGeo, p.brass);
  dial.position.set(-0.68, 0.54, 0.87);
  panelGrp.add(dial);

  const conduitCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.99, 0.62, 0.74),
    new THREE.Vector3(-1.18, 0.66, 0.68),
    new THREE.Vector3(-1.24, 0.72, 0.56),
  ]);
  const conduitGeo = bag.trackGeo(new THREE.TubeGeometry(conduitCurve, 16, 0.018, 10, false));
  panelGrp.add(new THREE.Mesh(conduitGeo, p.chrome));

  registerPart(root, panelGrp, parts, {
    partId: 'cm-panel',
    label: 'Control Enclosure IP54',
    sku: 'PNL-CTL3',
    qtyPer: 1,
    role: 'Side-mounted VFD starter & safety interlock housing',
    explodeOffset: [0, 0, 0.72],
  });

  // Part 5: Hex Bolt Array (BLT-M8X40)
  const boltGrp = new THREE.Group();
  const boltGeo = bag.trackGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.04, 6));
  boltGeo.rotateX(Math.PI / 2);
  [-1.1, -0.55, 0, 0.55, 1.1].forEach((x) => {
    [-0.59, 0.59].forEach((z) => {
      const bolt = new THREE.Mesh(boltGeo, p.chrome);
      bolt.position.set(x, 0.74, z);
      boltGrp.add(bolt);
    });
  });
  registerPart(root, boltGrp, parts, {
    partId: 'cm-fasteners',
    label: 'M8 Frame Fastener Set',
    sku: 'BLT-M8X40',
    qtyPer: 12,
    role: 'Grade 8.8 hex bolts & DIN 934 lock nuts',
    explodeOffset: [0, 0, -0.58],
  });

  // Part 6: Field Maintenance Pack (KIT-MK5)
  const kitGrp = new THREE.Group();
  const caseGeo = bag.trackGeo(new THREE.BoxGeometry(0.32, 0.14, 0.22));
  const caseMesh = new THREE.Mesh(caseGeo, p.secondary);
  caseMesh.position.set(0.74, 0.33, -0.54);
  kitGrp.add(caseMesh);
  const latchGeo = bag.trackGeo(new THREE.BoxGeometry(0.04, 0.05, 0.02));
  [-0.08, 0.08].forEach((dx) => {
    const l = new THREE.Mesh(latchGeo, p.brass);
    l.position.set(0.74 + dx, 0.36, -0.655);
    kitGrp.add(l);
  });
  registerPart(root, kitGrp, parts, {
    partId: 'cm-kit',
    label: 'Field Maintenance Pack',
    sku: 'KIT-MK5',
    qtyPer: 1,
    role: 'Clip-on lubrication & spare seal cassette',
    explodeOffset: [0.45, -0.05, -0.6],
  });

  groundGroup(root, parts);
  return { root, parts, conveyorItems: [], dispose: () => bag.dispose() };
}

// ---------------------------------------------------------------------------
// 2. Pump Assembly ASM-PA100
// ---------------------------------------------------------------------------

function buildPumpAssembly(bag: SceneResourceBag, finishId: FinishPresetId): BuiltSceneRoot {
  const root = new THREE.Group();
  const parts: THREE.Object3D[] = [];
  const p = makeMaterialPalette(bag, finishId);

  // Part 1: Induction Motor (MOT-05HP) with radial cooling fins
  const motorGrp = new THREE.Group();
  const bodyGeo = bag.trackGeo(new THREE.CylinderGeometry(0.28, 0.28, 0.72, 28));
  bodyGeo.rotateZ(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, p.accent);
  body.position.set(-0.48, 0.48, 0);
  motorGrp.add(body);

  const finGeo = bag.trackGeo(new THREE.BoxGeometry(0.56, 0.022, 0.62));
  for (let i = 0; i < 6; i++) {
    const fin = new THREE.Mesh(finGeo, p.accent);
    fin.position.set(-0.48, 0.48, 0);
    fin.rotation.x = (i * Math.PI) / 6;
    motorGrp.add(fin);
  }
  const jbox = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(0.22, 0.14, 0.22)), p.secondary);
  jbox.position.set(-0.48, 0.8, 0);
  motorGrp.add(jbox);

  registerPart(root, motorGrp, parts, {
    partId: 'pa-motor',
    label: 'AC Induction Motor 0.5 HP',
    sku: 'MOT-05HP',
    qtyPer: 1,
    role: 'TEFC finned stator housing with cooling fan cowl',
    explodeOffset: [-0.75, 0.15, 0],
  });

  // Part 2: Lathe Volute Pump Housing + Discharge Flange (ASM-PA100)
  const voluteGrp = new THREE.Group();
  const profile = [
    new THREE.Vector2(0.0, -0.14),
    new THREE.Vector2(0.32, -0.14),
    new THREE.Vector2(0.38, -0.06),
    new THREE.Vector2(0.38, 0.08),
    new THREE.Vector2(0.24, 0.16),
    new THREE.Vector2(0.14, 0.18),
    new THREE.Vector2(0.14, 0.34),
    new THREE.Vector2(0.0, 0.34),
  ];
  const volGeo = bag.trackGeo(new THREE.LatheGeometry(profile, 32));
  volGeo.rotateZ(-Math.PI / 2);
  const vol = new THREE.Mesh(volGeo, p.primary);
  vol.position.set(0.52, 0.48, 0);
  voluteGrp.add(vol);

  // Top discharge neck & flange
  const neck = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.1, 0.11, 0.38, 22)), p.primary);
  neck.position.set(0.52, 0.84, 0);
  voluteGrp.add(neck);
  const disFlange = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 24)), p.chrome);
  disFlange.position.set(0.52, 1.03, 0);
  voluteGrp.add(disFlange);

  // Skid Baseplate
  const skid = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(1.75, 0.12, 0.82)), p.secondary);
  skid.position.set(0, 0.06, 0);
  voluteGrp.add(skid);

  registerPart(root, voluteGrp, parts, {
    partId: 'pa-volute',
    label: 'Volute Pump Housing & Skid',
    sku: 'ASM-PA100',
    qtyPer: 1,
    role: 'Lathe-profiled radial discharge chamber & cast base skid',
    explodeOffset: [0.55, 0.15, 0],
  });

  // Part 3: Coupling Shaft & Dual 6205 Bearings (BRG-6205)
  const brgGrp = new THREE.Group();
  const shaft = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.042, 0.042, 0.65, 20)), p.chrome);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(0.05, 0.48, 0);
  brgGrp.add(shaft);

  [-0.08, 0.16].forEach((x) => {
    const brg = new THREE.Mesh(bag.trackGeo(new THREE.TorusGeometry(0.085, 0.032, 14, 24)), p.brass);
    brg.rotation.y = Math.PI / 2;
    brg.position.set(x, 0.48, 0);
    brgGrp.add(brg);
  });
  registerPart(root, brgGrp, parts, {
    partId: 'pa-bearings',
    label: 'Coupling & Bearing Cartridge',
    sku: 'BRG-6205',
    qtyPer: 2,
    role: 'Dual deep-groove radial shaft support bearings',
    explodeOffset: [0, 0.55, 0],
  });

  // Part 4: Mechanical Seal Cartridge (HYD-SK21)
  const sealGrp = new THREE.Group();
  const sealRing = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.07, 24)), p.copper);
  sealRing.rotation.z = Math.PI / 2;
  sealRing.position.set(0.32, 0.48, 0);
  sealGrp.add(sealRing);
  registerPart(root, sealGrp, parts, {
    partId: 'pa-seal',
    label: 'Hydraulic Mechanical Seal',
    sku: 'HYD-SK21',
    qtyPer: 1,
    role: 'Ø21 ceramic-carbon rotary shaft seal assembly',
    explodeOffset: [0.22, 0.42, 0.48],
  });

  // Part 5: Rubber Flange Gaskets (GSK-R120)
  const gskGrp = new THREE.Group();
  const gskGeo = bag.trackGeo(new THREE.TorusGeometry(0.15, 0.016, 12, 24));
  const g1 = new THREE.Mesh(gskGeo, p.rubberPlain);
  g1.rotation.x = Math.PI / 2;
  g1.position.set(0.52, 1.06, 0);
  gskGrp.add(g1);
  const g2 = new THREE.Mesh(gskGeo, p.rubberPlain);
  g2.rotation.y = Math.PI / 2;
  g2.position.set(0.88, 0.48, 0);
  gskGrp.add(g2);
  registerPart(root, gskGrp, parts, {
    partId: 'pa-gasket',
    label: 'NBR Flange Gaskets',
    sku: 'GSK-R120',
    qtyPer: 2,
    role: 'Ø120 nitrile elastomer pressure-retaining seals',
    explodeOffset: [0.35, 0.6, 0],
  });

  // Part 6: Anchor Bolts (BLT-M8X40)
  const boltsGrp = new THREE.Group();
  const bGeo = bag.trackGeo(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 6));
  [-0.76, -0.25, 0.25, 0.76].forEach((x) => {
    [-0.33, 0.33].forEach((z) => {
      const b = new THREE.Mesh(bGeo, p.chrome);
      b.position.set(x, 0.14, z);
      boltsGrp.add(b);
    });
  });
  registerPart(root, boltsGrp, parts, {
    partId: 'pa-bolts',
    label: 'Skid Anchor Fasteners',
    sku: 'BLT-M8X40',
    qtyPer: 8,
    role: 'Baseplate & volute flange Grade 8.8 fasteners',
    explodeOffset: [0, -0.35, 0],
  });

  groundGroup(root, parts);
  return { root, parts, conveyorItems: [], dispose: () => bag.dispose() };
}

// ---------------------------------------------------------------------------
// 3. Gearbox Set ASM-GS350
// ---------------------------------------------------------------------------

function buildGearboxSet(bag: SceneResourceBag, finishId: FinishPresetId): BuiltSceneRoot {
  const root = new THREE.Group();
  const parts: THREE.Object3D[] = [];
  const p = makeMaterialPalette(bag, finishId);

  // Part 1: Split Cast Gear Housing (ASM-GS350)
  const housingGrp = new THREE.Group();
  const lower = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(1.18, 0.44, 0.76)), p.secondary);
  lower.position.set(0, 0.24, 0);
  housingGrp.add(lower);

  const upper = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(1.14, 0.38, 0.72)), p.primary);
  upper.position.set(0, 0.68, 0);
  housingGrp.add(upper);

  const flange = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(1.3, 0.06, 0.88)), p.primary);
  flange.position.set(0, 0.46, 0);
  housingGrp.add(flange);

  registerPart(root, housingGrp, parts, {
    partId: 'gs-housing',
    label: 'Split Cast Gear Housing',
    sku: 'ASM-GS350',
    qtyPer: 1,
    role: 'Ribbed upper & lower precision-milled casing',
    explodeOffset: [0, 0.58, 0],
  });

  // Part 2: Internal Spur Gear Train + Shafts + Bearings (BRG-6205)
  const gearGrp = new THREE.Group();
  const bullGear = new THREE.Mesh(makeGearGeometry(bag, 20, 0.34, 0.27, 0.08, 0.16), p.chrome);
  bullGear.position.set(0.22, 0.46, 0);
  gearGrp.add(bullGear);

  const pinion = new THREE.Mesh(makeGearGeometry(bag, 12, 0.2, 0.14, 0.06, 0.18), p.brass);
  pinion.position.set(-0.28, 0.46, 0);
  gearGrp.add(pinion);

  const inShaft = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.055, 0.055, 1.12, 18)), p.chrome);
  inShaft.rotation.x = Math.PI / 2;
  inShaft.position.set(-0.28, 0.46, 0);
  gearGrp.add(inShaft);

  const outShaft = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.075, 0.075, 1.16, 18)), p.chrome);
  outShaft.rotation.x = Math.PI / 2;
  outShaft.position.set(0.22, 0.46, 0);
  gearGrp.add(outShaft);

  registerPart(root, gearGrp, parts, {
    partId: 'gs-gears',
    label: 'Hardened Spur Gear Train',
    sku: 'BRG-6205',
    qtyPer: 4,
    role: 'Input pinion & high-torque bull gear on dual 6205 bearings',
    explodeOffset: [0, 0.08, 0],
  });

  // Part 3: Shaft Lip Seals (HYD-SK21)
  const sealGrp = new THREE.Group();
  [
    [-0.28, 0.46, 0.42],
    [0.22, 0.46, 0.42],
    [-0.28, 0.46, -0.42],
    [0.22, 0.46, -0.42],
  ].forEach(([x, y, z]) => {
    const cap = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 20)), p.copper);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(x, y, z);
    sealGrp.add(cap);
  });
  registerPart(root, sealGrp, parts, {
    partId: 'gs-seals',
    label: 'Shaft Lip Seal Kits',
    sku: 'HYD-SK21',
    qtyPer: 2,
    role: 'Input/output rotary oil-retention cartridges',
    explodeOffset: [0, 0, 0.65],
  });

  // Part 4: NBR Split-Line Gasket (GSK-R120)
  const gskGrp = new THREE.Group();
  const gskFrame = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(1.26, 0.018, 0.84)), p.rubberPlain);
  gskFrame.position.set(0, 0.46, 0);
  gskGrp.add(gskFrame);
  registerPart(root, gskGrp, parts, {
    partId: 'gs-gaskets',
    label: 'Split-Line NBR Gaskets',
    sku: 'GSK-R120',
    qtyPer: 4,
    role: 'Bearing cap & case perimeter sealing rings',
    explodeOffset: [0, 0.3, 0],
  });

  // Part 5: Oil Sump & Sight Glass (LUB-ISO68)
  const oilGrp = new THREE.Group();
  const sight = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.085, 0.085, 0.04, 20)), p.amberLiquid);
  sight.rotation.x = Math.PI / 2;
  sight.position.set(0, 0.24, 0.39);
  oilGrp.add(sight);
  const sumpPool = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(0.95, 0.12, 0.56)), p.amberLiquid);
  sumpPool.position.set(0, 0.12, 0);
  oilGrp.add(sumpPool);
  registerPart(root, oilGrp, parts, {
    partId: 'gs-oil',
    label: 'ISO VG 68 Sump Reservoir',
    sku: 'LUB-ISO68',
    qtyPer: 1.5,
    role: 'Synthetic gear oil bath & inspection sight glass',
    explodeOffset: [0, -0.35, 0.45],
  });

  // Part 6: Perimeter Bolts (BLT-M8X40)
  const boltGrp = new THREE.Group();
  const bGeo = bag.trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 6));
  [-0.56, -0.18, 0.18, 0.56].forEach((x) => {
    [-0.38, 0.38].forEach((z) => {
      const b = new THREE.Mesh(bGeo, p.chrome);
      b.position.set(x, 0.52, z);
      boltGrp.add(b);
    });
  });
  registerPart(root, boltGrp, parts, {
    partId: 'gs-bolts',
    label: 'Case Clamp Bolt Array',
    sku: 'BLT-M8X40',
    qtyPer: 16,
    role: 'Perimeter flange tension bolts & M8 nuts',
    explodeOffset: [0, 0.85, 0],
  });

  groundGroup(root, parts);
  return { root, parts, conveyorItems: [], dispose: () => bag.dispose() };
}

// ---------------------------------------------------------------------------
// 4. Motor Control Panel ASM-CP120
// ---------------------------------------------------------------------------

function buildControlPanel(bag: SceneResourceBag, finishId: FinishPresetId): BuiltSceneRoot {
  const root = new THREE.Group();
  const parts: THREE.Object3D[] = [];
  const p = makeMaterialPalette(bag, finishId);

  // Part 1: IP54 Cabinet Shell & Polycarbonate Door (PNL-CTL3)
  const cabGrp = new THREE.Group();
  const back = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(1.18, 1.48, 0.42)), p.primary);
  back.position.set(0, 0.78, -0.08);
  cabGrp.add(back);

  const door = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(1.12, 1.42, 0.04)), p.secondary);
  door.position.set(0, 0.78, 0.16);
  cabGrp.add(door);

  const windowGlass = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(0.76, 0.58, 0.02)), p.glass);
  windowGlass.position.set(0, 1.0, 0.185);
  cabGrp.add(windowGlass);

  const handle = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 16)), p.brass);
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0.38, 0.52, 0.2);
  cabGrp.add(handle);

  registerPart(root, cabGrp, parts, {
    partId: 'cp-cabinet',
    label: 'IP54 Sheet-Steel Enclosure',
    sku: 'PNL-CTL3',
    qtyPer: 1,
    role: 'Gasketed NEMA/IP54 housing with polycarbonate inspection door',
    explodeOffset: [0, 0, 0.72],
  });

  // Part 2: Dual Motor Drive Modules (MOT-05HP)
  const drivesGrp = new THREE.Group();
  [-0.28, 0.28].forEach((x) => {
    const vfd = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(0.36, 0.52, 0.2)), p.accent);
    vfd.position.set(x, 0.96, 0.02);
    drivesGrp.add(vfd);

    const screen = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(0.22, 0.12, 0.02)), p.chrome);
    screen.position.set(x, 1.08, 0.125);
    drivesGrp.add(screen);
  });
  registerPart(root, drivesGrp, parts, {
    partId: 'cp-drives',
    label: 'Dual Motor Drive Modules',
    sku: 'MOT-05HP',
    qtyPer: 2,
    role: 'Paired 0.5 HP load contactors & thermal overload blocks',
    explodeOffset: [0, 0.2, -0.55],
  });

  // Part 3: Copper Busbars & DIN Rails (WLD-ER70)
  const busGrp = new THREE.Group();
  [-0.18, 0, 0.18].forEach((x, idx) => {
    const bar = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(0.05, 0.95, 0.03)), idx === 1 ? p.copper : p.brass);
    bar.position.set(x, 0.7, -0.18);
    busGrp.add(bar);
  });
  const din = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(0.92, 0.06, 0.04)), p.chrome);
  din.position.set(0, 0.45, -0.05);
  busGrp.add(din);
  registerPart(root, busGrp, parts, {
    partId: 'cp-bus',
    label: 'DIN Rail & Copper Busbars',
    sku: 'WLD-ER70',
    qtyPer: 0.3,
    role: 'Grounded backplane rail & welded chassis lugs',
    explodeOffset: [0, -0.25, -0.55],
  });

  // Part 4: Mounting Hardware (BLT-M8X40)
  const hwGrp = new THREE.Group();
  [-0.5, 0.5].forEach((x) => {
    [0.14, 1.4].forEach((y) => {
      const bolt = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.06, 6)), p.chrome);
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(x, y, -0.3);
      hwGrp.add(bolt);
    });
  });
  registerPart(root, hwGrp, parts, {
    partId: 'cp-fasteners',
    label: 'Backplate Mounting Hardware',
    sku: 'BLT-M8X40',
    qtyPer: 8,
    role: 'M8 DIN-frame & grounding stud fasteners',
    explodeOffset: [0, 0, -0.82],
  });

  groundGroup(root, parts);
  return { root, parts, conveyorItems: [], dispose: () => bag.dispose() };
}

// ---------------------------------------------------------------------------
// 5. Maintenance Kit KIT-MK5
// ---------------------------------------------------------------------------

function buildMaintenanceKit(bag: SceneResourceBag, finishId: FinishPresetId): BuiltSceneRoot {
  const root = new THREE.Group();
  const parts: THREE.Object3D[] = [];
  const p = makeMaterialPalette(bag, finishId);

  // Part 1: Molded Case (KIT-MK5)
  const caseGrp = new THREE.Group();
  const bottom = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(1.52, 0.24, 1.04)), p.secondary);
  bottom.position.set(0, 0.12, 0);
  caseGrp.add(bottom);

  const lid = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(1.52, 0.1, 1.04)), p.accent);
  lid.position.set(0, 0.31, 0);
  caseGrp.add(lid);

  const handle = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(0.42, 0.06, 0.1)), p.chrome);
  handle.position.set(0, 0.16, 0.55);
  caseGrp.add(handle);

  registerPart(root, caseGrp, parts, {
    partId: 'mk-case',
    label: 'Molded Service Case',
    sku: 'KIT-MK5',
    qtyPer: 1,
    role: 'Impact-resistant latching shell with precision foam tray',
    explodeOffset: [0, -0.35, 0],
  });

  // Part 2: Sealed Bearings (BRG-6205)
  const brgGrp = new THREE.Group();
  [-0.45, -0.15].forEach((x) => {
    const outer = new THREE.Mesh(bag.trackGeo(new THREE.TorusGeometry(0.11, 0.036, 16, 28)), p.chrome);
    outer.rotation.x = Math.PI / 2;
    outer.position.set(x, 0.28, -0.22);
    brgGrp.add(outer);
    const inner = new THREE.Mesh(bag.trackGeo(new THREE.TorusGeometry(0.058, 0.02, 12, 24)), p.brass);
    inner.rotation.x = Math.PI / 2;
    inner.position.set(x, 0.28, -0.22);
    brgGrp.add(inner);
  });
  registerPart(root, brgGrp, parts, {
    partId: 'mk-bearings',
    label: 'Sealed Ball Bearings 6205',
    sku: 'BRG-6205',
    qtyPer: 2,
    role: 'Factory-greased replacement radial bearings',
    explodeOffset: [-0.4, 0.55, -0.25],
  });

  // Part 3: Hydraulic Seal Sets (HYD-SK21)
  const sealGrp = new THREE.Group();
  [-0.45, -0.15].forEach((x) => {
    const c = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.095, 0.095, 0.1, 22)), p.copper);
    c.position.set(x, 0.28, 0.2);
    sealGrp.add(c);
  });
  registerPart(root, sealGrp, parts, {
    partId: 'mk-seals',
    label: 'Hydraulic Seal Sets Ø21',
    sku: 'HYD-SK21',
    qtyPer: 2,
    role: 'Twin elastomer + PTFE shaft seal replacement cartridges',
    explodeOffset: [-0.35, 0.55, 0.3],
  });

  // Part 4: NBR Gasket Stack (GSK-R120)
  const gskGrp = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const ring = new THREE.Mesh(bag.trackGeo(new THREE.TorusGeometry(0.14, 0.015, 10, 26)), p.rubberPlain);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0.18, 0.22 + i * 0.026, 0);
    gskGrp.add(ring);
  }
  registerPart(root, gskGrp, parts, {
    partId: 'mk-gaskets',
    label: 'NBR Gasket Stack (×6)',
    sku: 'GSK-R120',
    qtyPer: 6,
    role: 'Six Ø120 nitrile flange seal rings',
    explodeOffset: [0.15, 0.72, 0],
  });

  // Part 5: ISO 68 Lubricant Flasks (LUB-ISO68)
  const oilGrp = new THREE.Group();
  [-0.22, 0.2].forEach((z) => {
    const flask = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.09, 0.095, 0.26, 20)), p.amberLiquid);
    flask.position.set(0.5, 0.29, z);
    oilGrp.add(flask);
    const cap = new THREE.Mesh(bag.trackGeo(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 14)), p.secondary);
    cap.position.set(0.5, 0.44, z);
    oilGrp.add(cap);
  });
  registerPart(root, oilGrp, parts, {
    partId: 'mk-oil',
    label: 'ISO VG 68 Lubricant Flasks',
    sku: 'LUB-ISO68',
    qtyPer: 4,
    role: 'Pre-measured hydraulic & gearbox top-off bottles',
    explodeOffset: [0.55, 0.52, 0],
  });

  groundGroup(root, parts);
  return { root, parts, conveyorItems: [], dispose: () => bag.dispose() };
}

// ---------------------------------------------------------------------------
// 6. Live Plant & Warehouse Digital Twin
// ---------------------------------------------------------------------------

export function buildPlantFloorTwin(
  products: PlantRackProductInput[],
  stations: PlantStationInput[],
  finishId: FinishPresetId
): BuiltSceneRoot {
  const bag = new SceneResourceBag();
  const root = new THREE.Group();
  const parts: THREE.Object3D[] = [];
  const conveyorItems: Array<{ mesh: THREE.Object3D; phase: number; speed: number }> = [];
  const materialCarriers: NonNullable<BuiltSceneRoot['materialCarriers']> = [];
  const animatedHeads: NonNullable<BuiltSceneRoot['animatedHeads']> = [];
  const floorAnchors = new Map<string, [number, number, number]>();
  const p = makeMaterialPalette(bag, finishId);

  const floorTex = bag.trackTex(createFloorGridTexture());
  const floorMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.78,
      metalness: 0.14,
    })
  );

  // Epoxy Factory Floor Slab
  const floor = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(13.2, 0.12, 8.8)), floorMat);
  floor.position.set(0, -0.06, 0);
  floor.receiveShadow = true;
  root.add(floor);

  // Yellow/Amber Safety Aisle Stripes
  const stripeMat = bag.trackMat(new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.5, metalness: 0.1 }));
  const stripeGeo = bag.trackGeo(new THREE.BoxGeometry(11.8, 0.01, 0.08));
  [-0.55, 3.65].forEach((z) => {
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(0, 0.006, z);
    root.add(stripe);
  });

  // Instanced floor aisle studs for spatial rhythm (1 draw call)
  const studGeo = bag.trackGeo(new THREE.CylinderGeometry(0.035, 0.04, 0.015, 8));
  const studCount = 24;
  const studInst = new THREE.InstancedMesh(studGeo, p.brass, studCount);
  const studDummy = new THREE.Object3D();
  for (let i = 0; i < studCount; i++) {
    const row = Math.floor(i / 12);
    const col = i % 12;
    studDummy.position.set(-5.5 + col * 1.0, 0.008, row === 0 ? -0.35 : 0.25);
    studDummy.updateMatrix();
    studInst.setMatrixAt(i, studDummy.matrix);
  }
  studInst.instanceMatrix.needsUpdate = true;
  studInst.computeBoundingSphere();
  root.add(studInst);

  // -------------------------------------------------------------------------
  // Zone A: Automated Multi-Station Conveyor Line (Front Bay z = +1.55)
  // -------------------------------------------------------------------------
  const beltBase = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(9.4, 0.22, 0.86)), p.secondary);
  beltBase.position.set(0, 0.56, 1.55);
  beltBase.castShadow = true;
  beltBase.receiveShadow = true;
  root.add(beltBase);

  const beltTop = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(9.3, 0.04, 0.72)), p.rubber);
  beltTop.position.set(0, 0.69, 1.55);
  root.add(beltTop);

  // Conveyor Legs (shared geometry)
  const cLegGeo = bag.trackGeo(new THREE.BoxGeometry(0.1, 0.45, 0.74));
  [-4.2, -1.4, 1.4, 4.2].forEach((x) => {
    const leg = new THREE.Mesh(cLegGeo, p.primary);
    leg.position.set(x, 0.225, 1.55);
    leg.castShadow = true;
    root.add(leg);
  });

  const activeStations: PlantStationInput[] = stations.length
    ? stations.slice(0, 6)
    : [
        { stationNumber: 1, stationId: 'S1', stationName: 'Subassembly', utilizationPct: 86, taskCount: 4, tasksLabel: 'Subassembly mount', machineState: 'processing', bufferCapacity: 6 },
        { stationNumber: 2, stationId: 'S2', stationName: 'Drive & Tension', utilizationPct: 96, taskCount: 5, tasksLabel: 'Drive & belt tension', isBottleneck: true, machineState: 'bottleneck', bufferCapacity: 6, avgQueueLen: 3.8 },
        { stationNumber: 3, stationId: 'S3', stationName: 'Final QA & Pack', utilizationPct: 78, taskCount: 4, tasksLabel: 'Inspection & pack', machineState: 'processing', bufferCapacity: 6 },
      ];

  const anyLineDown = activeStations.every((s) => s.machineState === 'breakdown' || s.machineState === 'maintenance');
  const avgThroughput =
    activeStations.find((s) => typeof s.throughputPerHour === 'number' && s.throughputPerHour > 0)?.throughputPerHour ?? 45;
  const conveyorSpeed = anyLineDown ? 0 : Math.max(0.03, Math.min(0.16, 0.04 + (avgThroughput / 60) * 0.05));

  // Animated assembly workpieces moving along conveyor scaled to live throughput
  const workGeo = bag.trackGeo(new THREE.BoxGeometry(0.36, 0.2, 0.36));
  const capGeo = bag.trackGeo(new THREE.CylinderGeometry(0.09, 0.09, 0.09, 10));
  for (let i = 0; i < 4; i++) {
    const itemGrp = new THREE.Group();
    const base = new THREE.Mesh(workGeo, p.accent);
    base.position.y = 0.1;
    base.castShadow = true;
    itemGrp.add(base);
    const cap = new THREE.Mesh(capGeo, p.chrome);
    cap.position.y = 0.24;
    itemGrp.add(cap);
    itemGrp.position.set(-4.0 + i * 2.4, 0.71, 1.55);
    root.add(itemGrp);
    conveyorItems.push({ mesh: itemGrp, phase: i * 0.25, speed: conveyorSpeed });
  }

  // Pre-build 6 machine status materials (consistent with VISUAL_INDICATOR_SPECS)
  const machineMatMap: Record<MachineVisualStatus, THREE.MeshStandardMaterial> = {
    processing: bag.trackMat(new THREE.MeshStandardMaterial({ color: VISUAL_INDICATOR_SPECS.processing.hexColor, emissive: VISUAL_INDICATOR_SPECS.processing.hexColor, emissiveIntensity: 0.22, roughness: 0.32, metalness: 0.2 })),
    idle: bag.trackMat(new THREE.MeshStandardMaterial({ color: VISUAL_INDICATOR_SPECS.idle.hexColor, roughness: 0.55, metalness: 0.2 })),
    congested: bag.trackMat(new THREE.MeshStandardMaterial({ color: VISUAL_INDICATOR_SPECS.congested.hexColor, emissive: VISUAL_INDICATOR_SPECS.congested.hexColor, emissiveIntensity: 0.28, roughness: 0.35, metalness: 0.2 })),
    bottleneck: bag.trackMat(new THREE.MeshStandardMaterial({ color: VISUAL_INDICATOR_SPECS.bottleneck.hexColor, emissive: VISUAL_INDICATOR_SPECS.bottleneck.hexColor, emissiveIntensity: 0.42, roughness: 0.28, metalness: 0.2 })),
    breakdown: bag.trackMat(new THREE.MeshStandardMaterial({ color: VISUAL_INDICATOR_SPECS.breakdown.hexColor, emissive: VISUAL_INDICATOR_SPECS.breakdown.hexColor, emissiveIntensity: 0.55, roughness: 0.28, metalness: 0.15 })),
    maintenance: bag.trackMat(new THREE.MeshStandardMaterial({ color: VISUAL_INDICATOR_SPECS.maintenance.hexColor, emissive: VISUAL_INDICATOR_SPECS.maintenance.hexColor, emissiveIntensity: 0.32, roughness: 0.32, metalness: 0.25 })),
  };

  // Shared station geometries (memory & draw-call optimized)
  const colGeo = bag.trackGeo(new THREE.BoxGeometry(0.12, 1.78, 0.12));
  const beamGeo = bag.trackGeo(new THREE.BoxGeometry(0.24, 0.14, 1.44));
  const headGeo = bag.trackGeo(new THREE.CylinderGeometry(0.08, 0.11, 0.36, 12));
  const beaconGeo = bag.trackGeo(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 10));
  const apronGeo = bag.trackGeo(new THREE.BoxGeometry(0.95, 0.014, 1.56));
  const qBoxGeo = bag.trackGeo(new THREE.BoxGeometry(0.18, 0.11, 0.18));
  const bufFrameGeo = bag.trackGeo(new THREE.BoxGeometry(0.46, 0.02, 0.46));
  const orderToteGeo = bag.trackGeo(new THREE.BoxGeometry(0.22, 0.12, 0.14));

  const stCount = activeStations.length;
  const stSpan = Math.min(7.9, Math.max(4.4, (stCount - 1) * 2.05));
  const stationPositionsX: number[] = [];

  activeStations.forEach((st, idx) => {
    const x = stCount === 1 ? 0 : -stSpan / 2 + (idx * stSpan) / (stCount - 1);
    stationPositionsX.push(x);
    const stGrp = new THREE.Group();
    stGrp.position.set(x, 0, 1.55);

    const bufCap = Math.max(1, st.bufferCapacity ?? 6);
    const qLen = st.avgQueueLen ?? 0;
    const machineState: MachineVisualStatus =
      st.machineState ??
      classifyMachineVisualStatus({
        queueLen: qLen,
        bufferCapacity: bufCap,
        isBottleneck: Boolean(st.isBottleneck),
        downPct: st.downPct ?? 0,
        pmPct: st.pmPct ?? 0,
        blockedPct: st.blockedPct ?? 0,
        utilizationPct: st.utilizationPct,
      });

    const stateMat = machineMatMap[machineState];

    // Floor status apron strip around workstation footprint
    const apron = new THREE.Mesh(apronGeo, stateMat);
    apron.position.set(0, 0.008, 0);
    stGrp.add(apron);

    // Gantry pillars & overhead bridge
    [-0.64, 0.64].forEach((dz) => {
      const col = new THREE.Mesh(colGeo, p.primary);
      col.position.set(0, 0.89, dz);
      stGrp.add(col);
    });
    const beam = new THREE.Mesh(beamGeo, p.secondary);
    beam.position.set(0, 1.8, 0);
    stGrp.add(beam);

    // Spindle / Robot head (animated when processing or bottleneck)
    const headBaseY = machineState === 'maintenance' ? 1.36 : 1.52;
    const head = new THREE.Mesh(headGeo, p.chrome);
    head.position.set(0, headBaseY, 0);
    stGrp.add(head);
    animatedHeads.push({
      mesh: head,
      baseY: headBaseY,
      phase: idx * 1.15,
      active: machineState === 'processing' || machineState === 'bottleneck',
      state: machineState,
    });

    // Utilization gauge bar on gantry face
    const utilFrac = Math.max(0.15, Math.min(1, st.utilizationPct / 100));
    const bar = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(0.16, 0.11, 0.92 * utilFrac)), stateMat);
    bar.position.set(0.08, 1.9, 0);
    stGrp.add(bar);

    // Overhead Machine State Tower Beacon
    const beacon = new THREE.Mesh(beaconGeo, stateMat);
    beacon.position.set(0, 2.02, 0);
    stGrp.add(beacon);

    // Inter-station Input Buffer Rack + WIP Stack
    const bufBase = new THREE.Mesh(bufFrameGeo, p.secondary);
    bufBase.position.set(-0.34, 0.02, 1.02);
    stGrp.add(bufBase);

    const qBoxes = Math.min(6, Math.max(0, Math.round(qLen)));
    const qMat = qLen / bufCap >= 0.75 || machineState === 'congested' ? machineMatMap.congested : p.brass;
    for (let q = 0; q < qBoxes; q++) {
      const colSlot = q % 2;
      const layer = Math.floor(q / 2);
      const qMesh = new THREE.Mesh(qBoxGeo, qMat);
      qMesh.position.set(-0.44 + colSlot * 0.2, 0.085 + layer * 0.12, 1.02);
      stGrp.add(qMesh);
    }

    // Active Production Order badge tote on gantry front rail
    if (st.activeOrderIds && st.activeOrderIds.length > 0) {
      const orderTote = new THREE.Mesh(orderToteGeo, p.accent);
      orderTote.position.set(0.32, 0.08, 0.96);
      stGrp.add(orderTote);
    }

    const qInfo = typeof st.avgQueueLen === 'number' ? ` · Q ${st.avgQueueLen.toFixed(1)}/${bufCap}` : '';
    const stateLabel = VISUAL_INDICATOR_SPECS[machineState].label;
    const partId = `station-${st.stationNumber}`;
    floorAnchors.set(partId, [x, 0.95, 1.55]);
    if (st.stationId) floorAnchors.set(st.stationId.toUpperCase(), [x, 0.95, 1.55]);

    registerPart(root, stGrp, parts, {
      partId,
      label: `${st.stationId || `S${st.stationNumber}`} · ${st.stationName || `Workstation ${st.stationNumber}`} (${Math.round(st.utilizationPct)}%)`,
      sku: 'ASM-CM200',
      qtyPer: st.taskCount,
      role: `${stateLabel} · ${st.tasksLabel}${qInfo}`,
      explodeOffset: [0, 0.35, 0],
      stationNumber: st.stationNumber,
      machineState,
      focusTarget: [x, 0.95, 1.55],
    });
  });

  // -------------------------------------------------------------------------
  // Zone B: Live Inventory Warehouse Racks (Rear Bay z = -2.25)
  // -------------------------------------------------------------------------
  const statusMats: Record<StockStatus, THREE.MeshStandardMaterial> = {
    ok: bag.trackMat(new THREE.MeshStandardMaterial({ color: VISUAL_INDICATOR_SPECS.normal.hexColor, roughness: 0.4, metalness: 0.25 })),
    reorder: bag.trackMat(new THREE.MeshStandardMaterial({ color: VISUAL_INDICATOR_SPECS.reorder.hexColor, roughness: 0.38, metalness: 0.25 })),
    critical: bag.trackMat(new THREE.MeshStandardMaterial({ color: VISUAL_INDICATOR_SPECS.low.hexColor, roughness: 0.36, metalness: 0.25 })),
    out: bag.trackMat(new THREE.MeshStandardMaterial({ color: '#991b1b', roughness: 0.55, metalness: 0.2 })),
  };

  // Shared Rack Frame Geometries
  const postGeo = bag.trackGeo(new THREE.BoxGeometry(0.09, 2.35, 0.09));
  const shelfGeo = bag.trackGeo(new THREE.BoxGeometry(3.04, 0.06, 1.18));
  const rackCenters = [-3.9, 0, 3.9];
  rackCenters.forEach((rx) => {
    const rack = new THREE.Group();
    rack.position.set(rx, 0, -2.25);

    [-1.45, 1.45].forEach((dx) => {
      [-0.55, 0.55].forEach((dz) => {
        const post = new THREE.Mesh(postGeo, p.primary);
        post.position.set(dx, 1.175, dz);
        post.castShadow = true;
        rack.add(post);
      });
    });

    [0.14, 1.12, 2.08].forEach((sy) => {
      const shelf = new THREE.Mesh(shelfGeo, p.secondary);
      shelf.position.set(0, sy, 0);
      shelf.receiveShadow = true;
      rack.add(shelf);
    });
    root.add(rack);
  });

  // Populate Rack Bins directly from Live Catalog / Scenario SKUs (up to 18 visible bays)
  const displaySkus = products.slice(0, 18);
  const stripGeo = bag.trackGeo(new THREE.BoxGeometry(0.73, 0.08, 0.05));
  const cratePositions: Array<{ sku: string; pos: [number, number, number]; status: StockStatus; starved: boolean }> = [];

  displaySkus.forEach((prod, i) => {
    const rackIdx = Math.floor(i / 6);
    const inRack = i % 6;
    const tier = Math.floor(inRack / 3);
    const slot = inRack % 3;
    const rx = rackCenters[rackIdx] ?? 0;
    const bx = rx + (slot - 1) * 0.92;
    const by = tier === 0 ? 0.17 : 1.15;
    const bz = -2.25;

    const fillRatio = prod.rop > 0 ? Math.min(1.25, Math.max(0.16, prod.stock / (prod.rop * 2))) : 0.7;
    const binHeight = 0.22 + fillRatio * 0.42;

    const binGrp = new THREE.Group();
    binGrp.position.set(bx, by, bz);

    const crate = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(0.72, binHeight, 0.86)), p.primary);
    crate.position.y = binHeight / 2;
    binGrp.add(crate);

    // Status collar strip on front face of crate
    const visualInv = mapStockToInventoryVisualStatus(prod.status, prod.stock, prod.rop);
    const collarMat = statusMats[prod.status] || statusMats[visualInv === 'normal' ? 'ok' : visualInv === 'reorder' ? 'reorder' : 'critical'];
    const strip = new THREE.Mesh(stripGeo, collarMat);
    strip.position.set(0, Math.max(0.08, binHeight - 0.06), 0.42);
    binGrp.add(strip);

    const rackCode = prod.rackCode || formatRackLocation(i).code;
    const partId = `sku-${prod.sku}`;
    const anchor: [number, number, number] = [bx, by + binHeight * 0.5, bz + 0.35];
    floorAnchors.set(partId, anchor);
    floorAnchors.set(prod.sku.toUpperCase(), anchor);

    cratePositions.push({
      sku: prod.sku,
      pos: [bx, 0.12, bz + 0.7],
      status: prod.status,
      starved: Boolean(prod.starvedInSimulation),
    });

    registerPart(root, binGrp, parts, {
      partId,
      label: `${prod.sku} · ${prod.name}`,
      sku: prod.sku,
      qtyPer: prod.stock,
      role: `${rackCode} · On hand ${prod.stock.toLocaleString()} ${prod.unit} (ROP ${Math.round(prod.rop).toLocaleString()})`,
      explodeOffset: [0, 0.35, 0.45],
      status: prod.status,
      rackCode,
      focusTarget: anchor,
      usedInAssemblies: prod.usedInAssemblies,
    });
  });

  // -------------------------------------------------------------------------
  // Zone C: Material Transfer Lanes & Shuttles (Racks -> Assembly Line)
  // -------------------------------------------------------------------------
  const railMat = bag.trackMat(new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.65, metalness: 0.3 }));
  const railGeo = bag.trackGeo(new THREE.BoxGeometry(0.06, 0.015, 2.35));
  const toteGeo = bag.trackGeo(new THREE.BoxGeometry(0.28, 0.16, 0.28));

  const transferLanesX = rackCenters;
  transferLanesX.forEach((lx, laneIdx) => {
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(lx, 0.009, -0.35);
    root.add(rail);

    const matchedBin = cratePositions[laneIdx * 6] || cratePositions[laneIdx];
    const toteMat =
      matchedBin && (matchedBin.starved || matchedBin.status === 'critical' || matchedBin.status === 'out')
        ? statusMats.critical
        : matchedBin && matchedBin.status === 'reorder'
          ? statusMats.reorder
          : statusMats.ok;

    const carrierGrp = new THREE.Group();
    const pallet = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(0.36, 0.04, 0.36)), p.secondary);
    pallet.position.y = 0.02;
    carrierGrp.add(pallet);
    const tote = new THREE.Mesh(toteGeo, toteMat);
    tote.position.y = 0.12;
    carrierGrp.add(tote);

    const start = new THREE.Vector3(lx, 0.01, -1.45);
    const targetX = stationPositionsX[Math.min(laneIdx, Math.max(0, stationPositionsX.length - 1))] ?? lx;
    const end = new THREE.Vector3(targetX, 0.01, 0.72);
    const phase = (laneIdx * 0.31) % 1;
    carrierGrp.position.copy(start).lerp(end, phase);
    root.add(carrierGrp);

    materialCarriers.push({
      mesh: carrierGrp,
      start,
      end,
      phase,
      speed: anyLineDown ? 0 : Math.max(0.04, conveyorSpeed * 1.15),
      stalled: Boolean(matchedBin?.status === 'out' || anyLineDown),
    });
  });

  return {
    root,
    parts,
    conveyorItems,
    materialCarriers,
    animatedHeads,
    floorAnchors,
    dispose: () => bag.dispose(),
  };
}

export function buildAssembly3D(sku: AssemblySku, finishId: FinishPresetId): BuiltSceneRoot {
  const bag = new SceneResourceBag();
  switch (sku) {
    case 'ASM-CM200':
      return buildConveyorModule(bag, finishId);
    case 'ASM-PA100':
      return buildPumpAssembly(bag, finishId);
    case 'ASM-GS350':
      return buildGearboxSet(bag, finishId);
    case 'ASM-CP120':
      return buildControlPanel(bag, finishId);
    case 'KIT-MK5':
      return buildMaintenanceKit(bag, finishId);
    default:
      return buildConveyorModule(bag, finishId);
  }
}
