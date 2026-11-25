import React, { useEffect, useState } from 'react';
import { ArrowRight, Pause, Play, RotateCcw } from 'lucide-react';
import { FactorySimConfig, FactorySimResult } from '../../engine/factorySim';
import { fmtInt, fmtNum } from '../../engine/formatters';
import { Button } from '../ui/Primitives';

interface FactoryFloor2DProps {
  config: FactorySimConfig;
  result: FactorySimResult;
  selectedStationIdx: number | null;
  onSelectStation: (idx: number) => void;
  onInspectMaterials?: () => void;
  reduceMotion?: boolean;
}

const STATE_STYLES: Record<
  'busy' | 'blocked' | 'starved' | 'down' | 'pm',
  { label: string; textCls: string; borderCls: string; barCls: string }
> = {
  busy: {
    label: 'Running',
    textCls: 'text-emerald-600 dark:text-emerald-400',
    borderCls: 'border-emerald-500/40',
    barCls: 'bg-emerald-500',
  },
  blocked: {
    label: 'Blocked',
    textCls: 'text-amber-600 dark:text-amber-400',
    borderCls: 'border-amber-500/50',
    barCls: 'bg-amber-500',
  },
  starved: {
    label: 'Idle / Wait',
    textCls: 'text-slate-500 dark:text-slate-400',
    borderCls: 'border-slate-300 dark:border-slate-700',
    barCls: 'bg-slate-400',
  },
  down: {
    label: 'Breakdown',
    textCls: 'text-rose-600 dark:text-rose-400',
    borderCls: 'border-rose-500/60',
    barCls: 'bg-rose-500',
  },
  pm: {
    label: 'Maint (PM)',
    textCls: 'text-sky-600 dark:text-sky-400',
    borderCls: 'border-sky-500/50',
    barCls: 'bg-sky-500',
  },
};

export const FactoryFloor2D: React.FC<FactoryFloor2DProps> = React.memo(({
  config,
  result,
  selectedStationIdx,
  onSelectStation,
  onInspectMaterials,
  reduceMotion = false,
}) => {
  const frames = result.timeline || [];
  const [frameIdx, setFrameIdx] = useState<number>(() => Math.max(0, frames.length - 1));
  const [playing, setPlaying] = useState<boolean>(false);

  useEffect(() => {
    setPlaying(false);
    setFrameIdx(Math.max(0, frames.length - 1));
  }, [result.configHash, frames.length]);

  useEffect(() => {
    if (!playing || frames.length <= 1) return;
    const intervalMs = reduceMotion ? 600 : 340;
    const timer = window.setInterval(() => {
      setFrameIdx((prev) => {
        if (prev + 1 >= frames.length) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [playing, frames.length, reduceMotion]);

  const safeFrameIdx = frames.length ? Math.max(0, Math.min(frameIdx, frames.length - 1)) : 0;
  const activeFrame = frames[safeFrameIdx] || null;
  const routingLabel =
    config.routingMode === 'rework-loop'
      ? `Closed-loop rework → S${config.reworkTargetStationIdx + 1} (max ${config.maxReworkLoops}×)`
      : config.routingMode === 'parallel-cell'
        ? 'U-Cell quick changeover (−70% setup drag)'
        : 'Serial flow-line (scrap on defect)';

  return (
    <div className="space-y-4" data-testid="factory-floor-2d">
      {/* Timeline Playback Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Button
            size="sm"
            variant={playing ? 'primary' : 'secondary'}
            aria-label={playing ? 'Pause simulation playback' : 'Play simulation timeline'}
            onClick={() => {
              if (!playing && safeFrameIdx >= frames.length - 1) setFrameIdx(0);
              setPlaying((v) => !v);
            }}
            disabled={frames.length <= 1}
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{playing ? 'Pause' : 'Play Trace'}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Reset playback to hour zero"
            onClick={() => {
              setPlaying(false);
              setFrameIdx(0);
            }}
            disabled={frames.length <= 1}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 ml-1">
            {activeFrame ? `t = ${activeFrame.label} / ${result.observedHours}h` : `${result.observedHours}h run`}
          </span>
        </div>

        {frames.length > 1 && (
          <div className="flex-1 min-w-[160px] max-w-md flex items-center gap-2.5">
            <label htmlFor="floor-timeline-slider" className="sr-only">
              Simulation timeline hour scrubber
            </label>
            <input
              id="floor-timeline-slider"
              type="range"
              min={0}
              max={frames.length - 1}
              value={safeFrameIdx}
              onChange={(e) => {
                setPlaying(false);
                setFrameIdx(Number(e.target.value));
              }}
              className="w-full accent-[var(--accent)] cursor-pointer"
            />
          </div>
        )}

        {activeFrame && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
            <span>WIP {activeFrame.wip}</span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span>Out {fmtInt(activeFrame.completedCumulative)}</span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span>Rate {fmtNum(activeFrame.throughputPerHour, 2)}/hr</span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span
              className={
                activeFrame.minMaterialCoverPct <= 10
                  ? 'text-rose-600 dark:text-rose-400 font-semibold'
                  : 'text-slate-600 dark:text-slate-300'
              }
            >
              Mat {activeFrame.minMaterialCoverPct}%
            </span>
          </div>
        )}
      </div>

      {/* Routing & Physical Layout Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5 items-stretch">
        {/* Warehouse BOM Feed Bay */}
        <div className="xl:col-span-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-3 flex flex-col justify-between gap-2.5 min-w-0">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Material Feed Bay</div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300">
                {config.enforceMaterialFlow ? `${result.materials.length} BOM SKUs enforced` : 'Unconstrained feed'}
              </div>
            </div>
            {onInspectMaterials && (
              <button
                type="button"
                onClick={onInspectMaterials}
                className="text-[11px] font-medium text-[var(--accent)] hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                Inspect BOM
              </button>
            )}
          </div>

          {config.enforceMaterialFlow && result.materials.length > 0 ? (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {result.materials.slice(0, 5).map((mat) => {
                const denom = Math.max(1, mat.initialStock);
                const pct = Math.max(0, Math.min(100, (mat.endingStock / denom) * 100));
                return (
                  <div key={mat.sku} className="space-y-1 text-[11px]">
                    <div className="flex items-center justify-between gap-1 font-mono tabular-nums">
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate">{mat.sku}</span>
                      <span
                        className={
                          mat.stockoutOccurred
                            ? 'text-rose-600 dark:text-rose-400 font-semibold'
                            : 'text-slate-600 dark:text-slate-300'
                        }
                      >
                        {fmtInt(mat.endingStock)} / {fmtInt(mat.initialStock)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded ${
                          mat.stockoutOccurred ? 'bg-rose-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.max(4, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {result.materialBottleneckSku && (
                <div className="text-[11px] text-rose-600 dark:text-rose-400 font-mono pt-1">
                  Starvation limit: {result.materialBottleneckSku} ({fmtNum(result.materialStarvedHours, 1)}h wait)
                </div>
              )}
            </div>
          ) : (
            <div className="py-4 text-xs text-slate-600 dark:text-slate-300">
              {config.enforceMaterialFlow
                ? 'Selected assembly has no BOM lines configured.'
                : 'Material constraints paused — stations pull jobs freely.'}
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
            <span>Arrival rate</span>
            <span className="text-slate-800 dark:text-slate-200 font-medium">
              {fmtNum(config.arrivalRatePerHour, 2)} jobs/hr
            </span>
          </div>
        </div>

        {/* Workstations Flow Grid */}
        <div className="xl:col-span-7 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-3.5 flex flex-col justify-between gap-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Workstation Routing Blueprint
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300">{routingLabel}</div>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
              Click a station to tune parameters
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {result.stations.map((st, idx) => {
              const spec = config.stations[idx];
              const frameState = activeFrame?.stationStates[idx] || 'busy';
              const frameQueue = activeFrame ? activeFrame.stationQueues[idx] : st.avgQueueLen;
              const style = STATE_STYLES[frameState];
              const selected = selectedStationIdx === idx;
              const rawBufCap = spec?.bufferCapacity ?? 6;
              const bufCap = idx === 0 ? Math.max(10, rawBufCap * 2) : rawBufCap;
              const qPct = Math.max(0, Math.min(100, (frameQueue / Math.max(1, bufCap)) * 100));

              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onSelectStation(idx)}
                  aria-pressed={selected}
                  className={`text-left rounded-lg border p-3 transition-colors cursor-pointer min-w-0 ${
                    selected
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : st.isBottleneck
                        ? 'border-rose-500/50 bg-rose-50/40 dark:bg-rose-950/20 hover:border-rose-500'
                        : `${style.borderCls} bg-slate-50/60 dark:bg-slate-950/50 hover:border-slate-400 dark:hover:border-slate-600`
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-1">
                        <span>{st.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>{st.machineCount}×</span>
                        {st.isBottleneck && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-rose-600 dark:text-rose-400 font-semibold">Bottleneck</span>
                          </>
                        )}
                      </div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5">
                        {st.name}
                      </div>
                    </div>
                    {idx < result.stations.length - 1 && (
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                    )}
                  </div>

                  {/* Utilization & State */}
                  <div className="mt-2.5 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono tabular-nums">
                      <span className={`font-medium ${style.textCls}`}>{style.label}</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        {fmtNum(st.utilizationPct, 1)}% util
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded ${st.isBottleneck ? 'bg-rose-500' : style.barCls}`}
                        style={{ width: `${Math.min(100, Math.max(2, st.utilizationPct))}%` }}
                      />
                    </div>
                  </div>

                  {/* Buffer Queue & Cycle Time */}
                  <div className="mt-2.5 pt-2 border-t border-slate-200/70 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-1.5 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    <span>
                      Buf {activeFrame ? fmtInt(frameQueue) : fmtNum(st.avgQueueLen, 1)}/{bufCap} ({fmtInt(qPct)}%)
                    </span>
                    <span>{fmtNum(st.effectiveCycleMin, 1)}m</span>
                  </div>
                </button>
              );
            })}
          </div>

          {config.routingMode === 'rework-loop' && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
              <span>
                Rework loop active: {fmtNum(config.defectRatePct, 1)}% inspect fail → routes back to{' '}
                {config.stations[config.reworkTargetStationIdx]?.id || 'S1'}
              </span>
              <span>
                {fmtNum(result.reworkCount, 1)} avg loops · {fmtNum(result.firstPassYieldPct, 1)}% FPY
              </span>
            </div>
          )}
        </div>

        {/* QC & Output Shipping Gate */}
        <div className="xl:col-span-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-3 flex flex-col justify-between gap-2.5 min-w-0">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">QC & Output Gate</div>
            <div className="text-[11px] text-slate-600 dark:text-slate-300">{result.observedHours}h observed</div>
          </div>

          <div className="space-y-2.5 text-xs font-mono tabular-nums">
            <div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300">Good units out</div>
              <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                {fmtInt(result.goodUnitsCompleted)}
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-600 dark:text-slate-300">First-pass yield</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {fmtNum(result.firstPassYieldPct, 1)}%
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-600 dark:text-slate-300">Rework loops</span>
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {fmtNum(result.reworkCount, 1)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-600 dark:text-slate-300">Scrap exits</span>
              <span className="font-medium text-rose-600 dark:text-rose-400">
                {fmtNum(result.scrapUnits, 1)}
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
            Staffing {result.operatorsAvailable}/{result.operatorsRequired} ops (
            {Math.round(result.effectiveStaffingRatio * 100)}%)
          </div>
        </div>
      </div>
    </div>
  );
});
