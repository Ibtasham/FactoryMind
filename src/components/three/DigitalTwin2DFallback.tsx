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
  onRetry3D?: () => void;
  theme?: 'dark' | 'light';
}

export const DigitalTwin2DFallback: React.FC<DigitalTwin2DFallbackProps> = React.memo(({
  mode,
  assemblySku,
  explodeAmount,
  plantProducts,
  plantStations,
  selectedPartId,
  onSelectPart,
  simPlaying = false,
  reason,
  onRetry3D,
}) => {
  const spec = getAssemblySpec(assemblySku);
  const displaySkus = plantProducts.slice(0, 18);
  const stations: PlantStationInput[] = plantStations.slice(0, 6);

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
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">
                {reason}
              </span>
              {onRetry3D && (
                <button
                  type="button"
                  onClick={onRetry3D}
                  className="text-[11px] font-mono px-2 py-0.5 rounded border border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-90 cursor-pointer"
                >
                  Retry 3D
                </button>
              )}
            </div>
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
                  aria-pressed={selected}
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
                    <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      ×{part.qtyPer}
                    </span>
                  </div>
                  <div className="text-xs font-semibold mt-1">{part.label}</div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">
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
        <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
          2D Architectural Floor &amp; Rack Map · Click any rack bin or station
        </div>
        {reason && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">
              {reason}
            </span>
            {onRetry3D && (
              <button
                type="button"
                onClick={onRetry3D}
                className="text-[11px] font-mono px-2 py-0.5 rounded border border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-90 cursor-pointer"
              >
                Retry 3D
              </button>
            )}
          </div>
        )}
      </div>

      {/* Zone B: Rear Warehouse Racks (R1..R3) */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-300 mb-2">
          <span>ZONE B · WAREHOUSE RACKS (R1–R3 · RACK-SHELF-BAY)</span>
          <span>{displaySkus.length} ACTIVE BINS</span>
        </div>
        {displaySkus.length === 0 ? (
          <div className="rounded border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center text-xs text-slate-600 dark:text-slate-300">
            No warehouse SKUs in workspace. Add or import items in Inventory to populate Zone B racks.
          </div>
        ) : (
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
                aria-pressed={selected}
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
                  <span className="text-slate-600 dark:text-slate-300">{loc}</span>
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
        )}
      </div>

      {/* Zone C: Material Transfer Spine */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded border border-dashed border-slate-300 dark:border-slate-700 text-[11px] font-mono text-slate-600 dark:text-slate-300">
        <span>AGV / MATERIAL TRANSFER CORRIDOR</span>
        <span>
          {stations.length === 0
            ? 'LINE IDLE'
            : simPlaying
              ? 'CONVEYOR FEED ACTIVE'
              : 'PLAYBACK PAUSED'}
        </span>
      </div>

      {/* Zone A: Production Conveyor & Workstations */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-300 mb-2">
          <span>ZONE A · PRODUCTION CONVEYOR &amp; WORKSTATIONS</span>
          <span>{stations.length} STATIONS</span>
        </div>
        {stations.length === 0 ? (
          <div className="rounded border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center text-xs text-slate-600 dark:text-slate-300">
            No active production stations configured. Open Line Balance or Factory Simulation Lab to populate workstations.
          </div>
        ) : (
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
                aria-pressed={selected}
                onClick={() =>
                  onSelectPart?.({
                    partId,
                    label: `${st.stationId || `S${st.stationNumber}`} · ${st.stationName || `Workstation ${st.stationNumber}`} (${Math.round(st.utilizationPct)}%)`,
                    sku: assemblySku,
                    qtyPer: st.taskCount,
                    role: `${ind.label} · ${st.tasksLabel}`,
                    stationNumber: st.stationNumber,
                    machineState: mState,
                  })
                }
                className={`text-left rounded-lg border p-2.5 transition-colors cursor-pointer min-w-0 ${
                  selected
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-slate-400 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <span className="font-mono text-xs font-semibold truncate">
                    {st.stationId || `S${st.stationNumber}`} · {st.stationName || `Station ${st.stationNumber}`}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold shrink-0 ${ind.badgeCls}`}
                  >
                    {ind.shortCode}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-300">
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
        )}
      </div>
    </div>
  );
});
