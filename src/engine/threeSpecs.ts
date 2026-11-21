/**
 * Pure metadata, finish presets, camera presets, and BOM-to-3D part mappings
 * for FactoryMind's procedural 3D industrial assemblies and plant digital twin.
 */

export type AssemblySku = 'ASM-CM200' | 'ASM-PA100' | 'ASM-GS350' | 'ASM-CP120' | 'KIT-MK5';
export type FinishPresetId = 'steel' | 'slate' | 'cobalt';
export type CameraPresetId = 'iso' | 'front' | 'top' | 'detail';
export type SceneModeId = 'assembly' | 'plant';

export interface AssemblyPartSpec {
  partId: string;
  label: string;
  sku: string;
  qtyPer: number;
  role: string;
}

export interface Assembly3DSpec {
  sku: AssemblySku;
  title: string;
  subtitle: string;
  dimensionsLabel: string;
  massLabel: string;
  parts: AssemblyPartSpec[];
}

export interface FinishPreset {
  id: FinishPresetId;
  label: string;
  primaryHex: string;
  secondaryHex: string;
  accentHex: string;
  metalness: number;
  roughness: number;
}

export interface CameraPreset {
  id: CameraPresetId;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

export const FINISH_PRESETS: Record<FinishPresetId, FinishPreset> = {
  steel: {
    id: 'steel',
    label: 'Brushed Steel',
    primaryHex: '#94a3b8',
    secondaryHex: '#334155',
    accentHex: '#2563eb',
    metalness: 0.78,
    roughness: 0.34,
  },
  slate: {
    id: 'slate',
    label: 'Anodized Slate',
    primaryHex: '#475569',
    secondaryHex: '#1e293b',
    accentHex: '#10b981',
    metalness: 0.62,
    roughness: 0.42,
  },
  cobalt: {
    id: 'cobalt',
    label: 'Industrial Cobalt',
    primaryHex: '#2563eb',
    secondaryHex: '#1e293b',
    accentHex: '#f59e0b',
    metalness: 0.45,
    roughness: 0.38,
  },
};

export const ASSEMBLY_CAMERA_PRESETS: Record<CameraPresetId, CameraPreset> = {
  iso: { id: 'iso', label: 'Iso', position: [3.9, 2.75, 4.1], target: [0, 0.65, 0] },
  front: { id: 'front', label: 'Front', position: [0.0, 1.35, 4.8], target: [0, 0.65, 0] },
  top: { id: 'top', label: 'Top', position: [0.01, 5.1, 0.9], target: [0, 0.45, 0] },
  detail: { id: 'detail', label: 'Detail', position: [2.15, 1.55, 2.25], target: [0, 0.65, 0] },
};

export const PLANT_CAMERA_PRESETS: Record<CameraPresetId, CameraPreset> = {
  iso: { id: 'iso', label: 'Iso', position: [10.8, 7.6, 11.4], target: [0, 0.75, -0.35] },
  front: { id: 'front', label: 'Front', position: [0.0, 3.6, 12.6], target: [0, 0.75, -0.2] },
  top: { id: 'top', label: 'Top', position: [0.01, 14.5, 1.4], target: [0, 0.2, -0.2] },
  detail: { id: 'detail', label: 'Line', position: [4.5, 2.9, 4.9], target: [0, 0.75, 1.2] },
};

export const ASSEMBLY_3D_SPECS: Record<AssemblySku, Assembly3DSpec> = {
  'ASM-CM200': {
    sku: 'ASM-CM200',
    title: 'Conveyor Module CM-200',
    subtitle: 'Modular belt transfer unit with IP54 drive cabinet and sealed roller bearings',
    dimensionsLabel: '2400 × 640 × 820 mm',
    massLabel: '142 kg',
    parts: [
      { partId: 'cm-rails', label: 'Extruded Frame Rails', sku: 'STL-1045', qtyPer: 2, role: 'Structural load-bearing C-channel chassis' },
      { partId: 'cm-belt', label: 'PVC Conveyor Belt 500mm', sku: 'CNV-B500', qtyPer: 6, role: 'Continuous ribbed high-grip transport loop' },
      { partId: 'cm-rollers', label: 'Drive & Idler Rollers + Bearings', sku: 'BRG-6205', qtyPer: 4, role: 'Precision-turned shafts with sealed 6205 bearings' },
      { partId: 'cm-panel', label: 'Control Enclosure IP54', sku: 'PNL-CTL3', qtyPer: 1, role: 'Side-mounted VFD starter & safety interlock housing' },
      { partId: 'cm-fasteners', label: 'M8 Frame Fastener Set', sku: 'BLT-M8X40', qtyPer: 12, role: 'Grade 8.8 hex bolts & DIN 934 lock nuts' },
      { partId: 'cm-kit', label: 'Field Maintenance Pack', sku: 'KIT-MK5', qtyPer: 1, role: 'Clip-on lubrication & spare seal cassette' },
    ],
  },
  'ASM-PA100': {
    sku: 'ASM-PA100',
    title: 'Pump Assembly PA-100',
    subtitle: 'Direct-coupled centrifugal fluid transfer skid with 0.5 HP induction drive',
    dimensionsLabel: '780 × 390 × 410 mm',
    massLabel: '48 kg',
    parts: [
      { partId: 'pa-motor', label: 'AC Induction Motor 0.5 HP', sku: 'MOT-05HP', qtyPer: 1, role: 'TEFC finned stator housing with cooling fan cowl' },
      { partId: 'pa-volute', label: 'Volute Pump Housing', sku: 'ASM-PA100', qtyPer: 1, role: 'Lathe-profiled radial discharge chamber & suction flange' },
      { partId: 'pa-bearings', label: 'Coupling & Bearing Cartridge', sku: 'BRG-6205', qtyPer: 2, role: 'Dual deep-groove radial shaft support bearings' },
      { partId: 'pa-seal', label: 'Hydraulic Mechanical Seal', sku: 'HYD-SK21', qtyPer: 1, role: 'Ø21 ceramic-carbon rotary shaft seal assembly' },
      { partId: 'pa-gasket', label: 'NBR Flange Gaskets', sku: 'GSK-R120', qtyPer: 2, role: 'Ø120 nitrile elastomer pressure-retaining seals' },
      { partId: 'pa-bolts', label: 'Skid Anchor Fasteners', sku: 'BLT-M8X40', qtyPer: 8, role: 'Baseplate & volute flange Grade 8.8 fasteners' },
    ],
  },
  'ASM-GS350': {
    sku: 'ASM-GS350',
    title: 'Gearbox Set GS-350',
    subtitle: 'Parallel-shaft industrial speed reducer with sight glass & dual tapered bearings',
    dimensionsLabel: '540 × 440 × 490 mm',
    massLabel: '64 kg',
    parts: [
      { partId: 'gs-housing', label: 'Split Cast Gear Housing', sku: 'ASM-GS350', qtyPer: 1, role: 'Ribbed upper & lower precision-milled casing' },
      { partId: 'gs-gears', label: 'Hardened Spur Gear Train', sku: 'BRG-6205', qtyPer: 4, role: 'Input pinion & high-torque bull gear on dual 6205 bearings' },
      { partId: 'gs-seals', label: 'Shaft Lip Seal Kits', sku: 'HYD-SK21', qtyPer: 2, role: 'Input/output rotary oil-retention cartridges' },
      { partId: 'gs-gaskets', label: 'Split-Line NBR Gaskets', sku: 'GSK-R120', qtyPer: 4, role: 'Bearing cap & case perimeter sealing rings' },
      { partId: 'gs-oil', label: 'ISO VG 68 Sump Reservoir', sku: 'LUB-ISO68', qtyPer: 1.5, role: 'Synthetic gear oil bath & inspection sight glass' },
      { partId: 'gs-bolts', label: 'Case Clamp Bolt Array', sku: 'BLT-M8X40', qtyPer: 16, role: 'Perimeter flange tension bolts & M8 nuts' },
    ],
  },
  'ASM-CP120': {
    sku: 'ASM-CP120',
    title: 'Motor Control Panel CP-120',
    subtitle: 'Dual-drive IP54 automation enclosure with DIN busbars, drives, and rotary disconnect',
    dimensionsLabel: '800 × 600 × 320 mm',
    massLabel: '52 kg',
    parts: [
      { partId: 'cp-cabinet', label: 'IP54 Sheet-Steel Enclosure', sku: 'PNL-CTL3', qtyPer: 1, role: 'Gasketed NEMA/IP54 housing with polycarbonate inspection door' },
      { partId: 'cp-drives', label: 'Dual Motor Drive Modules', sku: 'MOT-05HP', qtyPer: 2, role: 'Paired 0.5 HP load contactors & thermal overload blocks' },
      { partId: 'cp-bus', label: 'DIN Rail & Copper Busbars', sku: 'WLD-ER70', qtyPer: 0.3, role: 'Grounded backplane rail & welded chassis lugs' },
      { partId: 'cp-fasteners', label: 'Backplate Mounting Hardware', sku: 'BLT-M8X40', qtyPer: 8, role: 'M8 DIN-frame & grounding stud fasteners' },
    ],
  },
  'KIT-MK5': {
    sku: 'KIT-MK5',
    title: 'Maintenance Kit MK-5',
    subtitle: 'Field-ready preventive maintenance case with bearings, seals, gaskets & ISO 68 oil',
    dimensionsLabel: '460 × 340 × 150 mm',
    massLabel: '6.8 kg',
    parts: [
      { partId: 'mk-case', label: 'Molded Service Case', sku: 'KIT-MK5', qtyPer: 1, role: 'Impact-resistant latching shell with precision foam tray' },
      { partId: 'mk-bearings', label: 'Sealed Ball Bearings 6205', sku: 'BRG-6205', qtyPer: 2, role: 'Factory-greased replacement radial bearings' },
      { partId: 'mk-seals', label: 'Hydraulic Seal Sets Ø21', sku: 'HYD-SK21', qtyPer: 2, role: 'Twin elastomer + PTFE shaft seal replacement cartridges' },
      { partId: 'mk-gaskets', label: 'NBR Gasket Stack (×6)', sku: 'GSK-R120', qtyPer: 6, role: 'Six Ø120 nitrile flange seal rings' },
      { partId: 'mk-oil', label: 'ISO VG 68 Lubricant Flasks', sku: 'LUB-ISO68', qtyPer: 4, role: 'Pre-measured hydraulic & gearbox top-off bottles' },
    ],
  },
};

export const ASSEMBLY_SKU_LIST: AssemblySku[] = [
  'ASM-CM200',
  'ASM-PA100',
  'ASM-GS350',
  'ASM-CP120',
  'KIT-MK5',
];

export function isAssemblySku(sku: string): sku is AssemblySku {
  return sku in ASSEMBLY_3D_SPECS;
}

export function getAssemblySpec(sku: string): Assembly3DSpec {
  if (isAssemblySku(sku)) return ASSEMBLY_3D_SPECS[sku];
  return ASSEMBLY_3D_SPECS['ASM-CM200'];
}
