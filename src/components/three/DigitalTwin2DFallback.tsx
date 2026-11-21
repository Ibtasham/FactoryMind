import React from 'react';
import {
  classifyMachineVisualStatus,
  formatRackLocation,
  MachineVisualStatus,
  mapStockToInventoryVisualStatus,
  VISUAL_INDICATOR_SPECS,
} from '../../engine/digitalTwin';
import { PlantRackProductInput, PlantStationInput } from '../../engine/threeModels';
import { AssemblySku, getAssemblySpec, SceneModeId } from '../../engine/threeSpecs';

export interface SelectedTwinPartSimple {
  partId: string;
  label: string;
  sku: string;
  qtyPer?: number;
  role: string;
  stationNumber?: number;
  rackCode?: string;
  machineState?: MachineVisualStatus;
}

interface DigitalTwin2DFallbackProps {
  mode: SceneModeId;
  assemblySku: AssemblySku;
  explodeAmount: number;
  plantProducts: PlantRackProductInput[];
  plantStations: PlantStationInput[];
  selectedPartId?: string | null;
  onSelectPart?: (part: SelectedTwinPartSimple | null) => void;
  simPlaying?: boolean;
  reason?: string | null;
  theme?: 'dark' | 'light';
}

export const DigitalTwin2DFallback: React.FC<DigitalTwin2DFallbackProps> = ({
  mode,
  assemblySku,
  explodeAmount,
  plantProducts,
  plantStations,
  selectedPartId,
  onSelectPart,
  simPlaying = false,
  reason,
}) => {
  const spec = getAssemblySpec(assemblySku);
  const displaySkus = plantProducts.slice(0, 18);
  const stations: PlantStationInput[] = plantStations.length
    ? plantStations.slice(0, 6)
    : [
        {
          stationNumber: 1,
          stationId: 'S1',
          stationName: 'Subassembly',
          utilizationPct: 86,
          taskCount: 4,
          tasksLabel: 'Subassembly mount',
          machineState: 'processing',
          bufferCapacity: 6,
        },
        {
          stationNumber: 2,
          stationId: 'S2',
          stationName: 'Drive & Tension',
          utilizationPct: 96,
          taskCount: 5,
          tasksLabel: 'Drive & tension',
          isBottleneck: true,
          machineState: 'bottleneck',
          bufferCapacity: 6,
          avgQueueLen: 3.8,
        },
        {
          stationNumber: 3,
          stationId: 'S3',
          stationName: 'Final QA & Pack',
          utilizationPct: 78,
          taskCount: 4,
          tasksLabel: 'Inspect & pack',
          machineState: 'processing',
          bufferCapacity: 6,
        },
      ];

  if (mode === 'assembly') {
    const spread = Math.round(explodeAmount * 46);
    return (
      <div
        data-testid="digital-twin-2d-fallback"
        className="w-full h-full flex flex-col justify-between p-4 pt-16 pb-20 overflow-y-auto bg-slate-50 dark:bg-[#0b1120] text-slate-900 dark:text-slate-100"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--accent)]">
              2D Schematic Engineering Projection · {spec.sku}
            </div>
            <div className="text-xs font-semibold">{spec.title}</div>
          </div>
          {reason && (
            <span className="text-[11px] font-mono px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              {reason}
            </span>
          )}
        </div>

        {/* Exploded 2D BOM Assembly Schematic */}
        <div className="my-auto py-3">
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 transition-all"
            style={{ gap: `${10 + Math.round(spread * 0.35)}px` }}
          >
            {spec.parts.map((part, idx) => {
              const selected = selectedPartId === part.partId;
              const offsetY = (idx % 2 === 0 ? -1 : 1) * Math.round(explodeAmount * 10);
              return (
                <button
                  key={part.partId}
                  type="button"
                  onClick={() =>
                    onSelectPart?.({
                      partId: part.partId,
                      label: part.label,
                      sku: part.sku,
                      qtyPer: part.qtyPer,
                      role: part.role,
                    })
                  }
                  style={{ transform: `translateY(${offsetY}px)` }}
                  className={`text-left rounded-lg border p-3 transition-all cursor-pointer ${
                    selected
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/90 hover:border-[var(--accent)]/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold text-[var(--accent)]">
                      {part.sku}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      ×{part.qtyPer}
                    </span>
                  </div>
                  <div className="text-xs font-semibold mt-1">{part.label}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                    {part.role}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="digital-twin-2d-fallback"
      className="w-full h-full flex flex-col gap-3 p-3.5 pt-16 pb-20 overflow-y-auto bg-slate-50 dark:bg-[#0b1120] text-slate-900 dark:text-slate-100"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
          2D Architectural Floor &amp; Rack Map · Click any rack bin or station
        </div>
        {reason && (
          <span className="text-[11px] font-mono px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            {reason}
          </span>
        )}
      </div>

      {/* Zone B: Rear Warehouse Racks (R1..R3) */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 p-2.5">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 mb-2">
          <span>ZONE B · WAREHOUSE RACKS (R1–R3 · RACK-SHELF-BAY)</span>
          <span>{displaySkus.length} ACTIVE BINS</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1.5">
          {displaySkus.map((prod, idx) => {
            const loc = prod.rackCode || formatRackLocation(idx).code;
            const partId = `sku-${prod.sku}`;
            const selected = selectedPartId === partId;
            const vis = mapStockToInventoryVisualStatus(prod.status, prod.stock, prod.rop);
            const specColor = VISUAL_INDICATOR_SPECS[vis];
            const fillPct = prod.rop > 0 ? Math.min(100, Math.max(10, (prod.stock / (prod.rop * 2)) * 100)) : 70;

            return (
              <button
                key={partId}
                type="button"
                onClick={() =>
                  onSelectPart?.({
                    partId,
                    label: `${prod.sku} · ${prod.name}`,
                    sku: prod.sku,
                    qtyPer: prod.stock,
                    role: `${loc} · On hand ${prod.stock.toLocaleString()} ${prod.unit} (ROP ${Math.round(prod.rop).toLocaleString()})`,
                    rackCode: loc,
                  })
                }
                className={`text-left rounded border p-2 transition-colors cursor-pointer ${
                  selected
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-slate-400 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between gap-1 text-[10px] font-mono">
                  <span className="text-slate-500 dark:text-slate-400">{loc}</span>
                  <span
                    className="px-1 rounded text-[9px] font-semibold"
                    style={{ color: specColor.hexColor }}
                  >
                    {specColor.shortCode}
                  </span>
                </div>
                <div className="font-mono text-[11px] font-semibold truncate mt-0.5">{prod.sku}</div>
                <div className="mt-1.5 h-1.5 w-full rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{ width: `${fillPct}%`, backgroundColor: specColor.hexColor }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Zone C: Material Transfer Spine */}
      <div className="flex items-center justify-between px-3 py-1.5 rounded border border-dashed border-slate-300 dark:border-slate-700 text-[11px] font-mono text-slate-500 dark:text-slate-400">
        <span>AGV / MATERIAL TRANSFER CORRIDOR</span>
        <span>{simPlaying ? 'CONVEYOR FEED ACTIVE' : 'PLAYBACK PAUSED'}</span>
      </div>

      {/* Zone A: Production Conveyor & Workstations */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 p-2.5">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 mb-2">
          <span>ZONE A · PRODUCTION CONVEYOR &amp; WORKSTATIONS</span>
          <span>{stations.length} STATIONS</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {stations.map((st) => {
            const partId = `station-${st.stationNumber}`;
            const selected = selectedPartId === partId;
            const bufCap = Math.max(1, st.bufferCapacity ?? 6);
            const qLen = st.avgQueueLen ?? 0;
            const mState =
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
            const ind = VISUAL_INDICATOR_SPECS[mState];
            const qPct = Math.min(100, Math.round((qLen / bufCap) * 100));

            return (
              <button
                key={partId}
                type="button"
                onClick={() =>
                  onSelectPart?.({
                    partId,
                    label: `${st.stationId || `S${st.stationNumber}`} · ${st.stationName || `Workstation ${st.stationNumber}`} (${Math.round(st.utilizationPct)}%)`,
                    sku: 'ASM-CM200',
                    qtyPer: st.taskCount,
                    role: `${ind.label} · ${st.tasksLabel}`,
                    stationNumber: st.stationNumber,
                    machineState: mState,
                  })
                }
                className={`text-left rounded-lg border p-2.5 transition-colors cursor-pointer ${
                  selected
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-slate-400 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold">
                    {st.stationId || `S${st.stationNumber}`} · {st.stationName || `Station ${st.stationNumber}`}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold ${ind.badgeCls}`}
                  >
                    {ind.shortCode}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  <span>Util {Math.round(st.utilizationPct)}%</span>
                  <span>
                    Buf {qLen.toFixed(1)}/{bufCap} ({qPct}%)
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${Math.max(4, Math.min(100, st.utilizationPct))}%`,
                      backgroundColor: ind.hexColor,
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
