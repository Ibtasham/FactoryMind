import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Box,
  Cpu,
  Crosshair,
  Factory,
  GitCompare,
  Layers,
  MapPin,
  PackageCheck,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Warehouse,
} from 'lucide-react';
import { RouteId } from '../components/layout/AppShell';
import type { Selected3DPart } from '../components/three/Factory3DViewport';
import { LazyFactory3DViewport } from '../components/three/LazyFactory3DViewport';
import {
  AssumptionPanel,
  Button,
  Panel,
  SegmentedControl,
  StatCard,
  StatusLabel,
} from '../components/ui/Primitives';
import {
  buildDigitalTwinSnapshot,
  TwinCatalogMetricInput,
  VISUAL_INDICATOR_SPECS,
} from '../engine/digitalTwin';
import { fmtCover, fmtInt, fmtMoney, fmtNum } from '../engine/formatters';
import {
  buildBaselineScenarioFromWorkspace,
  buildPresetScenarioDefinitions,
  compareScenarioToBaseline,
  evaluateScenario,
  ScenarioDefinition,
  ScenarioWorkspaceInput,
} from '../engine/scenarioStudio';
import { PlantRackProductInput, PlantStationInput } from '../engine/threeModels';
import {
  ASSEMBLY_3D_SPECS,
  ASSEMBLY_SKU_LIST,
  AssemblySku,
  FinishPresetId,
  getAssemblySpec,
  isAssemblySku,
  SceneModeId,
} from '../engine/threeSpecs';
import { Product } from '../store/store';
import { useStore } from '../store/StoreContext';

export const Models3DPage: React.FC<{
  initialSku?: AssemblySku;
  onSelectSku?: (sku: AssemblySku) => void;
  onOpenProduct: (p: Product) => void;
  onMoveStock: (p: Product, type: 'in' | 'out') => void;
  onNavigate: (r: RouteId) => void;
}> = ({ initialSku = 'ASM-CM200', onSelectSku, onOpenProduct, onMoveStock, onNavigate }) => {
  const {
    products,
    metricsOf,
    settings,
    lineBalance,
    factorySimConfig,
    scenarioStudioRecords,
  } = useStore();

  const [mode, setMode] = useState<SceneModeId>('plant');
  const [assemblySku, setAssemblySku] = useState<AssemblySku>(initialSku);
  const [explodeAmount, setExplodeAmount] = useState<number>(0);
  const [finish, setFinish] = useState<FinishPresetId>('steel');
  const [selectedPart, setSelectedPart] = useState<Selected3DPart | null>(null);
  const [focusTargetId, setFocusTargetId] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<'3d' | '2d'>('3d');

  // Simulation Playback & DES Timeline Cursor
  const [simPlaying, setSimPlaying] = useState<boolean>(!settings.reduceMotion);
  const [simSpeed, setSimSpeed] = useState<0.5 | 1 | 2>(1);
  const [clockPlaying, setClockPlaying] = useState<boolean>(false);
  const [timelineFrameIdx, setTimelineFrameIdx] = useState<number | null>(null);

  // Before-vs-After Scenario Comparison
  const [compareView, setCompareView] = useState<'baseline' | 'scenario'>('baseline');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('preset-capacity-resilience');

  useEffect(() => {
    setAssemblySku(initialSku);
  }, [initialSku]);

  const selectAssembly = (sku: AssemblySku) => {
    setAssemblySku(sku);
    setSelectedPart(null);
    setFocusTargetId(null);
    onSelectSku?.(sku);
  };

  const spec = useMemo(() => getAssemblySpec(assemblySku), [assemblySku]);

  const productBySku = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.sku.toUpperCase(), p));
    return map;
  }, [products]);

  const metricsMap = useMemo(() => {
    const map = new Map<string, TwinCatalogMetricInput>();
    products.forEach((p) => {
      const m = metricsOf(p);
      map.set(p.id, {
        rop: m.rop,
        safetyStock: m.safetyStock,
        status: m.status,
        eoqQty: m.eoq.Q,
      });
    });
    return map;
  }, [products, metricsOf]);

  const workspaceInput = useMemo<ScenarioWorkspaceInput>(
    () => ({
      products,
      lineBalance,
      factorySimConfig,
    }),
    [products, lineBalance, factorySimConfig]
  );

  const baselineDef = useMemo(
    () => buildBaselineScenarioFromWorkspace(workspaceInput),
    [workspaceInput]
  );

  const scenarioOptions = useMemo<ScenarioDefinition[]>(() => {
    const presets = buildPresetScenarioDefinitions(workspaceInput);
    const seen = new Set<string>();
    const combined: ScenarioDefinition[] = [];
    [...scenarioStudioRecords, ...presets].forEach((sc) => {
      if (sc.isBaseline || seen.has(sc.id)) return;
      seen.add(sc.id);
      combined.push(sc);
    });
    return combined;
  }, [workspaceInput, scenarioStudioRecords]);

  const activeScenarioDef = useMemo(
    () =>
      scenarioOptions.find((s) => s.id === selectedScenarioId) ||
      scenarioOptions[0] ||
      baselineDef,
    [scenarioOptions, selectedScenarioId, baselineDef]
  );

  // Heavy DES + Forecast + MRP + Line-Balance runs cached cleanly independent of frame ticks
  const baselineEval = useMemo(
    () => evaluateScenario(baselineDef, workspaceInput),
    [baselineDef, workspaceInput]
  );
  const scenarioEval = useMemo(
    () => evaluateScenario(activeScenarioDef, workspaceInput),
    [activeScenarioDef, workspaceInput]
  );
  const scenarioComparison = useMemo(
    () => compareScenarioToBaseline(baselineEval, scenarioEval),
    [baselineEval, scenarioEval]
  );

  const baselineSnapshot = useMemo(
    () =>
      buildDigitalTwinSnapshot({
        products,
        metricsMap,
        evaluation: baselineEval,
        assemblySku,
        frameIdx: timelineFrameIdx,
        origin: 'baseline',
      }),
    [products, metricsMap, baselineEval, assemblySku, timelineFrameIdx]
  );

  const scenarioSnapshot = useMemo(
    () =>
      buildDigitalTwinSnapshot({
        products,
        metricsMap,
        evaluation: scenarioEval,
        assemblySku,
        frameIdx: timelineFrameIdx,
        origin: 'scenario',
      }),
    [products, metricsMap, scenarioEval, assemblySku, timelineFrameIdx]
  );

  const activeSnapshot = compareView === 'scenario' ? scenarioSnapshot : baselineSnapshot;
  const activeTotalFrames =
    (compareView === 'scenario' ? scenarioEval : baselineEval).desResult.timeline.length || 0;

  // Advance DES timeline hour cursor smoothly only when user plays DES hour trace
  useEffect(() => {
    if (mode !== 'plant' || !clockPlaying || activeTotalFrames <= 1) return;
    const stepMs = Math.round(1150 / simSpeed);
    const id = window.setInterval(() => {
      setTimelineFrameIdx((prev) => {
        if (prev === null || prev >= activeTotalFrames - 1) return 0;
        return prev + 1;
      });
    }, stepMs);
    return () => window.clearInterval(id);
  }, [mode, clockPlaying, simSpeed, activeTotalFrames]);

  // Adapt Digital Twin snapshots into Three.js Viewport props
  const plantProducts = useMemo<PlantRackProductInput[]>(() => {
    return activeSnapshot.rackBins.map((bin) => ({
      id: bin.productId,
      sku: bin.sku,
      name: bin.name,
      category: bin.category,
      stock: bin.stock,
      rop: bin.rop,
      unit: bin.unit,
      status: bin.stockStatus,
      rackCode: bin.location.code,
      usedInAssemblies: bin.usedInAssemblies,
      starvedInSimulation: bin.starvedInSimulation,
    }));
  }, [activeSnapshot.rackBins]);

  const plantStations = useMemo<PlantStationInput[]>(() => {
    return activeSnapshot.stations.map((st) => ({
      stationNumber: st.stationNumber,
      stationId: st.id,
      stationName: st.name,
      utilizationPct: st.utilizationPct,
      taskCount: st.machineCount,
      tasksLabel: st.tasksLabel,
      isBottleneck: st.isBottleneck,
      avgQueueLen: st.currentQueueLen,
      throughputPerHour: st.throughputPerHour,
      machineState: st.machineState,
      bufferCapacity: st.bufferCapacity,
      downPct: st.downPct,
      pmPct: st.pmPct,
      blockedPct: st.blockedPct,
      activeOrderIds: st.activeOrderIds,
    }));
  }, [activeSnapshot.stations]);

  const activeAssemblyProduct = productBySku.get(assemblySku) || null;

  // Currently inspected item resolution (Station vs Warehouse Rack Bin vs Assembly Component)
  const selectedStation = useMemo(() => {
    if (!selectedPart) return null;
    if (typeof selectedPart.stationNumber === 'number') {
      return (
        activeSnapshot.stations.find((s) => s.stationNumber === selectedPart.stationNumber) || null
      );
    }
    if (selectedPart.partId.startsWith('station-')) {
      const n = Number(selectedPart.partId.replace('station-', ''));
      return activeSnapshot.stations.find((s) => s.stationNumber === n) || null;
    }
    return null;
  }, [selectedPart, activeSnapshot.stations]);

  const inspectedSku = !selectedStation ? selectedPart?.sku || assemblySku : '';
  const inspectedBin = useMemo(
    () =>
      inspectedSku
        ? activeSnapshot.rackBins.find((b) => b.sku.toUpperCase() === inspectedSku.toUpperCase()) ||
          null
        : null,
    [activeSnapshot.rackBins, inspectedSku]
  );
  const inspectedProduct = inspectedSku
    ? productBySku.get(inspectedSku.toUpperCase()) || activeAssemblyProduct
    : null;
  const inspectedMetrics = inspectedProduct ? metricsOf(inspectedProduct) : null;

  // Scenario Deltas Summary
  const baseTp = baselineSnapshot.summary.throughputPerHour;
  const scenTp = scenarioSnapshot.summary.throughputPerHour;
  const tpDeltaPct = baseTp > 0 ? ((scenTp - baseTp) / baseTp) * 100 : 0;
  const oeeDeltaPts = scenarioSnapshot.summary.oeePct - baselineSnapshot.summary.oeePct;
  const cycleDeltaMin =
    scenarioSnapshot.summary.avgCycleTimeMin - baselineSnapshot.summary.avgCycleTimeMin;
  const wipDelta = scenarioSnapshot.summary.avgWip - baselineSnapshot.summary.avgWip;

  const locateSkuInPlantRack = (sku: string) => {
    const bin = activeSnapshot.rackBins.find((b) => b.sku.toUpperCase() === sku.toUpperCase());
    setMode('plant');
    if (bin) {
      const part: Selected3DPart = {
        partId: bin.partId,
        label: `${bin.sku} · ${bin.name}`,
        sku: bin.sku,
        qtyPer: bin.stock,
        role: `${bin.location.code} · On hand ${fmtInt(bin.stock)} ${bin.unit}`,
        rackCode: bin.location.code,
      };
      setSelectedPart(part);
      setFocusTargetId(bin.partId);
    }
  };

  const selectStationForInspect = (stationNumber: number) => {
    const st = activeSnapshot.stations.find((s) => s.stationNumber === stationNumber);
    if (!st) return;
    setMode('plant');
    setSelectedPart({
      partId: st.partId,
      label: `${st.id} · ${st.name} (${st.utilizationPct}%)`,
      sku: assemblySku,
      qtyPer: st.machineCount,
      role: `${VISUAL_INDICATOR_SPECS[st.machineState].label} · ${st.tasksLabel}`,
      stationNumber: st.stationNumber,
      machineState: st.machineState,
    });
    setFocusTargetId(st.partId);
  };

  return (
    <div className="space-y-4">
      {/* Top Studio Header Bar */}
      <Panel
        title="3D Digital Twin & Assembly Studio"
        subtitle="Data-connected warehouse racks, DES workstation telemetry, material flow playback, exploded BOM structures, and before-vs-after scenario states"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              value={mode}
              onChange={(v) => {
                setMode(v as SceneModeId);
                setSelectedPart(null);
                setFocusTargetId(null);
              }}
              options={[
                { value: 'plant', label: 'Plant & Warehouse Twin' },
                { value: 'assembly', label: 'Exploded BOM Assemblies' },
              ]}
            />
          </div>
        }
      >
        {mode === 'assembly' ? (
          <div className="flex flex-wrap items-center gap-2">
            {ASSEMBLY_SKU_LIST.map((sku) => {
              const s = ASSEMBLY_3D_SPECS[sku];
              const active = sku === assemblySku;
              const prod = productBySku.get(sku);
              return (
                <button
                  key={sku}
                  type="button"
                  onClick={() => selectAssembly(sku)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-slate-900 dark:text-white shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <Box
                    className={`h-4 w-4 shrink-0 ${
                      active ? 'text-[var(--accent)]' : 'text-slate-400'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-semibold leading-tight">{s.title}</div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                      {sku} {prod ? `· ${fmtInt(prod.stock)} on hand` : ''}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Before vs After Scenario Bar & Playback Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={simPlaying ? 'primary' : 'secondary'}
                  onClick={() => setSimPlaying((v) => !v)}
                  aria-label={simPlaying ? 'Pause twin playback' : 'Start twin playback'}
                >
                  {simPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  <span>{simPlaying ? 'Pause Playback' : 'Start Playback'}</span>
                </Button>

                {activeTotalFrames > 1 && (
                  <div className="flex items-center gap-1.5 ml-1">
                    <Button
                      size="sm"
                      variant={clockPlaying ? 'primary' : 'ghost'}
                      onClick={() => {
                        setClockPlaying((v) => {
                          const next = !v;
                          if (next && timelineFrameIdx === null) setTimelineFrameIdx(0);
                          return next;
                        });
                      }}
                      title="Step through hourly DES timeline frames"
                    >
                      {clockPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      <span>{clockPlaying ? 'Stop Trace' : 'Play Trace'}</span>
                    </Button>
                    <label htmlFor="twin-hour-slider" className="sr-only">
                      DES timeline clock scrubber
                    </label>
                    <input
                      id="twin-hour-slider"
                      type="range"
                      min={0}
                      max={activeTotalFrames - 1}
                      value={
                        timelineFrameIdx === null
                          ? Math.max(0, activeTotalFrames - 1)
                          : timelineFrameIdx
                      }
                      onChange={(e) => {
                        setClockPlaying(false);
                        setTimelineFrameIdx(Number(e.target.value));
                      }}
                      className="w-24 sm:w-32 accent-[var(--accent)] cursor-pointer"
                    />
                    <span className="text-[11px] font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-200 min-w-[74px]">
                      {timelineFrameIdx !== null && activeSnapshot.timeline
                        ? `t=${activeSnapshot.timeline.label}`
                        : 'Horizon Avg'}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setClockPlaying(false);
                        setTimelineFrameIdx(null);
                      }}
                      title="Reset to full-horizon summary"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Before vs After Scenario Switcher */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <GitCompare className="h-3.5 w-3.5 text-[var(--accent)]" />
                  Compare State:
                </span>
                <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden text-[11px] font-medium">
                  <button
                    type="button"
                    data-testid="twin-state-baseline-btn"
                    onClick={() => setCompareView('baseline')}
                    className={`px-2.5 py-1 cursor-pointer transition-colors ${
                      compareView === 'baseline'
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    Before (Baseline)
                  </button>
                  <button
                    type="button"
                    data-testid="twin-state-scenario-btn"
                    onClick={() => setCompareView('scenario')}
                    className={`px-2.5 py-1 cursor-pointer transition-colors ${
                      compareView === 'scenario'
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    After Scenario
                  </button>
                </div>

                <label htmlFor="twin-scenario-select" className="sr-only">
                  Select comparison scenario
                </label>
                <select
                  id="twin-scenario-select"
                  value={activeScenarioDef.id}
                  onChange={(e) => {
                    setSelectedScenarioId(e.target.value);
                    setCompareView('scenario');
                  }}
                  className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200"
                >
                  {scenarioOptions.map((sc) => (
                    <option key={sc.id} value={sc.id}>
                      {sc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* KPI Strip synced to Active DES State + Before/After Delta */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                label="DES Line Throughput"
                value={`${fmtNum(activeSnapshot.summary.throughputPerHour, 2)} u/hr`}
                sub={
                  compareView === 'scenario'
                    ? `Δ vs Baseline: ${tpDeltaPct >= 0 ? '+' : ''}${fmtNum(tpDeltaPct, 1)}%`
                    : `Bottleneck: ${activeSnapshot.summary.bottleneckStationId || 'Balanced'}`
                }
                tone={
                  compareView === 'scenario'
                    ? tpDeltaPct >= 0
                      ? 'good'
                      : 'bad'
                    : 'neutral'
                }
              />
              <StatCard
                label="Simulated Plant OEE"
                value={`${fmtNum(activeSnapshot.summary.oeePct, 1)}%`}
                sub={
                  compareView === 'scenario'
                    ? `Δ vs Baseline: ${oeeDeltaPts >= 0 ? '+' : ''}${fmtNum(oeeDeltaPts, 1)} pts`
                    : `Cycle ${fmtNum(activeSnapshot.summary.avgCycleTimeMin, 1)}m · WIP ${fmtNum(activeSnapshot.summary.avgWip, 1)}`
                }
                tone={activeSnapshot.summary.oeePct >= 75 ? 'good' : 'warn'}
              />
              <StatCard
                label="Warehouse Alerts"
                value={fmtInt(activeSnapshot.summary.lowOrReorderBinsCount)}
                sub={`${activeSnapshot.rackBins.length} racks · ${activeSnapshot.summary.starvedMaterialSkusCount} BOM starved`}
                tone={activeSnapshot.summary.lowOrReorderBinsCount > 0 ? 'warn' : 'good'}
              />
              <StatCard
                label="Floor Constraints"
                value={`${activeSnapshot.summary.congestedStationsCount} cong · ${activeSnapshot.summary.downOrPmStationsCount} down`}
                sub={
                  compareView === 'scenario'
                    ? `WIP Δ ${wipDelta >= 0 ? '+' : ''}${fmtNum(wipDelta, 1)} · Cycle Δ ${cycleDeltaMin >= 0 ? '+' : ''}${fmtNum(cycleDeltaMin, 1)}m`
                    : `${activeSnapshot.orders.length} DES active orders`
                }
                tone={
                  activeSnapshot.summary.downOrPmStationsCount > 0
                    ? 'bad'
                    : activeSnapshot.summary.congestedStationsCount > 0
                      ? 'warn'
                      : 'good'
                }
              />
            </div>
          </div>
        )}
      </Panel>

      {/* Main 3D / 2D Twin Viewport + Data-Connected Telemetry Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-8 space-y-3">
          <LazyFactory3DViewport
            mode={mode}
            assemblySku={assemblySku}
            plantProducts={plantProducts}
            plantStations={plantStations}
            plantFlows={activeSnapshot.materialFlows}
            explodeAmount={explodeAmount}
            onExplodeChange={setExplodeAmount}
            finish={finish}
            onFinishChange={setFinish}
            selectedPartId={selectedPart?.partId || null}
            onSelectPart={(part) => {
              setSelectedPart(part);
              if (part) setFocusTargetId(null);
            }}
            focusTargetId={focusTargetId}
            simPlaying={simPlaying}
            onSimPlayingChange={setSimPlaying}
            simSpeed={simSpeed}
            onSimSpeedChange={setSimSpeed}
            renderMode={renderMode}
            onRenderModeChange={setRenderMode}
            theme={settings.theme}
            reduceMotion={Boolean(settings.reduceMotion)}
          />

          {/* Consistent 9-State Visual Indicator Legend + Data Provenance Disclosure */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                9-State Visual Indicator Legend (Synced across 3D &amp; 2D Twin)
              </span>
              <span className="font-mono text-slate-500 dark:text-slate-400">
                {compareView === 'scenario'
                  ? 'PROVENANCE: SCENARIO COUNTERFACTUAL (NON-MUTATING)'
                  : 'PROVENANCE: WORKSPACE CATALOG + DES SIMULATED MODEL'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.values(VISUAL_INDICATOR_SPECS).map((item) => (
                <span
                  key={item.id}
                  title={item.description}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium ${item.badgeCls}`}
                >
                  <span
                    className="h-2 w-2 rounded-xs shrink-0"
                    style={{ backgroundColor: item.hexColor }}
                  />
                  <span>{item.label}</span>
                </span>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {activeSnapshot.provenanceNote}
            </p>
          </div>
        </div>

        {/* Live Telemetry, Component Relationships & Scenario Inspector */}
        <div className="lg:col-span-4 space-y-4">
          <Panel
            title={
              selectedStation
                ? `${selectedStation.id} · ${selectedStation.name} (${selectedStation.utilizationPct}%)`
                : inspectedBin && selectedPart
                  ? `${inspectedBin.sku} · ${inspectedBin.name}`
                  : selectedPart
                    ? selectedPart.label
                    : mode === 'assembly'
                      ? spec.title
                      : 'Digital Twin Telemetry Inspector'
            }
            subtitle={
              selectedStation
                ? `${VISUAL_INDICATOR_SPECS[selectedStation.machineState].label} · ${selectedStation.tasksLabel}`
                : inspectedBin && selectedPart
                  ? `${inspectedBin.location.code} · On hand ${fmtInt(inspectedBin.stock)} ${inspectedBin.unit} (ROP ${fmtInt(inspectedBin.rop)})`
                  : selectedPart
                    ? selectedPart.role
                    : mode === 'assembly'
                      ? spec.subtitle
                      : 'Click any warehouse rack crate or production gantry'
            }
            actions={
              selectedPart ? (
                <button
                  type="button"
                  onClick={() => setFocusTargetId(selectedPart.partId)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline cursor-pointer"
                >
                  <Crosshair className="h-3 w-3" /> Focus
                </button>
              ) : undefined
            }
          >
            <div className="space-y-3.5">
              {/* 1A. Selected Production Workstation DES Telemetry */}
              {selectedStation && (
                <div
                  data-testid="twin-station-inspector"
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-mono text-[11px] text-[var(--accent)] font-semibold">
                        {selectedStation.id} · {selectedStation.machineCount}× PARALLEL MACHINES
                      </div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {selectedStation.name}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded border text-[10px] font-mono font-semibold ${
                        VISUAL_INDICATOR_SPECS[selectedStation.machineState].badgeCls
                      }`}
                    >
                      {VISUAL_INDICATOR_SPECS[selectedStation.machineState].label}
                    </span>
                  </div>

                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Source: {selectedStation.provenance} (No fake PLC stream)
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800 text-xs">
                    <div>
                      <div className="text-[11px] text-slate-500">Asset Utilization</div>
                      <div className="font-mono tabular-nums font-semibold">
                        {selectedStation.utilizationPct}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Buffer Queue</div>
                      <div className="font-mono tabular-nums font-semibold">
                        {fmtNum(selectedStation.currentQueueLen, 1)} /{' '}
                        {selectedStation.bufferCapacity} ({selectedStation.congestionPct}%)
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">OEE Avail · Perf</div>
                      <div className="font-mono tabular-nums font-medium">
                        {fmtNum(selectedStation.oeeAvailabilityPct, 1)}% ·{' '}
                        {fmtNum(selectedStation.oeePerformancePct, 1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Down · PM · Blocked</div>
                      <div className="font-mono tabular-nums font-medium">
                        {fmtNum(selectedStation.downPct, 1)}% · {fmtNum(selectedStation.pmPct, 1)}% ·{' '}
                        {fmtNum(selectedStation.blockedPct, 1)}%
                      </div>
                    </div>
                  </div>

                  {activeSnapshot.orders.length > 0 && (
                    <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-1">
                      <div className="text-[11px] font-medium text-slate-500">
                        Active DES Production Orders
                      </div>
                      {activeSnapshot.orders.slice(0, 3).map((ord) => (
                        <div
                          key={ord.id}
                          className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-300"
                        >
                          <span>
                            {ord.id} ({ord.sku})
                          </span>
                          <span>
                            {ord.completedQty}/{ord.orderedQty} ({fmtNum(ord.completionRatePct, 0)}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 1B. Selected Warehouse Rack Bin / SKU Telemetry + BOM Relationships */}
              {!selectedStation && inspectedProduct && inspectedMetrics && (
                <div
                  data-testid="twin-sku-inspector"
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-[var(--accent)]">
                        <span>{inspectedProduct.sku}</span>
                        {inspectedBin && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-slate-200/80 dark:bg-slate-800 text-[10px] text-slate-700 dark:text-slate-300">
                            <MapPin className="h-2.5 w-2.5" />
                            {inspectedBin.location.code}
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate mt-0.5">
                        {inspectedProduct.name}
                      </div>
                    </div>
                    <StatusLabel
                      status={inspectedBin ? inspectedBin.stockStatus : inspectedMetrics.status}
                    />
                  </div>

                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Source: {inspectedBin?.provenance || 'WORKSPACE_CATALOG'}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800 text-xs">
                    <div>
                      <div className="text-[11px] text-slate-500">
                        {compareView === 'scenario' ? 'Sim Stock / ROP' : 'On hand / ROP'}
                      </div>
                      <div className="font-mono tabular-nums font-semibold">
                        {fmtInt(inspectedBin ? inspectedBin.stock : inspectedProduct.stock)} /{' '}
                        {fmtInt(inspectedMetrics.rop)} {inspectedProduct.unit}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Unit Cost · EOQ</div>
                      <div className="font-mono tabular-nums font-semibold">
                        {fmtMoney(inspectedProduct.unitCost)} · {fmtInt(inspectedMetrics.eoq.Q)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Safety Stock</div>
                      <div className="font-mono tabular-nums font-medium">
                        {fmtInt(inspectedMetrics.safetyStock)} {inspectedProduct.unit}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Cover / Lead Time</div>
                      <div className="font-mono tabular-nums font-medium">
                        {fmtCover(inspectedMetrics.monthsOfCover)} · {inspectedProduct.leadTime}d
                      </div>
                    </div>
                  </div>

                  {/* Component Parent Relationships (Used In Assemblies) */}
                  {inspectedBin && inspectedBin.usedInAssemblies.length > 0 && (
                    <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-1.5">
                      <div className="text-[11px] font-medium text-slate-500">
                        BOM Component Relationships (Used In)
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {inspectedBin.usedInAssemblies.map((parentSku) => (
                          <button
                            key={parentSku}
                            type="button"
                            onClick={() => {
                              if (isAssemblySku(parentSku)) {
                                setAssemblySku(parentSku);
                                onSelectSku?.(parentSku);
                                setMode('assembly');
                                setExplodeAmount(0.85);
                              }
                            }}
                            className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-mono text-[var(--accent)] hover:border-[var(--accent)] cursor-pointer"
                          >
                            {parentSku} ↗
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => onOpenProduct(inspectedProduct)}
                    >
                      Inspect SKU
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onMoveStock(inspectedProduct, 'in')}
                    >
                      <PackageCheck className="h-3.5 w-3.5" /> Receive
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onNavigate('production')}
                    >
                      MRP <ArrowRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}

              {/* 2. Mode-Specific Navigator Lists */}
              {mode === 'assembly' ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-semibold uppercase tracking-wider">
                      Exploded BOM &amp; Rack Locations
                    </span>
                    <span className="font-mono">
                      {spec.dimensionsLabel} · {spec.massLabel}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg max-h-[260px] overflow-y-auto">
                    {spec.parts.map((part) => {
                      const isSelected = selectedPart?.partId === part.partId;
                      const compProd = productBySku.get(part.sku);
                      const compMetrics = compProd ? metricsOf(compProd) : null;
                      const rackBin = activeSnapshot.rackBins.find(
                        (b) => b.sku.toUpperCase() === part.sku.toUpperCase()
                      );
                      return (
                        <div
                          key={part.partId}
                          className={`px-3 py-2 flex items-center justify-between gap-2 text-xs transition-colors ${
                            isSelected
                              ? 'bg-[var(--accent-soft)] text-slate-900 dark:text-white'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedPart({
                                partId: part.partId,
                                label: part.label,
                                sku: part.sku,
                                qtyPer: part.qtyPer,
                                role: part.role,
                                rackCode: rackBin?.location.code,
                              })
                            }
                            className="min-w-0 text-left flex-1 cursor-pointer"
                          >
                            <div className="font-medium truncate">{part.label}</div>
                            <div className="font-mono text-[11px] text-slate-500">
                              {part.sku} · ×{fmtNum(part.qtyPer, 1)}
                              {rackBin ? ` · ${rackBin.location.code}` : ''}
                            </div>
                          </button>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {compMetrics && <StatusLabel status={compMetrics.status} />}
                            {rackBin && (
                              <button
                                type="button"
                                title={`Locate ${part.sku} in Plant Rack ${rackBin.location.code}`}
                                onClick={() => locateSkuInPlantRack(part.sku)}
                                className="p-1 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-[var(--accent)] cursor-pointer"
                              >
                                <Warehouse className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Quick Assembly Explode Shortcuts */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <SlidersHorizontal className="h-3 w-3" /> Quick Explode View
                    </span>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setExplodeAmount(0)}>
                        Assembled
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setExplodeAmount(1)}>
                        <Layers className="h-3 w-3" /> Explode 100%
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Before vs After Scenario Summary Card */}
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-[var(--accent)]" />
                        Scenario Impact: {activeScenarioDef.name}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {scenarioEval.confidence.level} conf
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                      {scenarioComparison.explanation.recommendationHeadline}
                    </p>
                  </div>

                  {/* DES Workstations List */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-semibold uppercase tracking-wider">
                        DES Workstations ({activeSnapshot.stations.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => onNavigate('factory-sim')}
                        className="text-[var(--accent)] hover:underline cursor-pointer"
                      >
                        Simulation Lab
                      </button>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg max-h-[175px] overflow-y-auto">
                      {activeSnapshot.stations.map((st) => {
                        const ind = VISUAL_INDICATOR_SPECS[st.machineState];
                        return (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => selectStationForInspect(st.stationNumber)}
                            className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer ${
                              selectedPart?.partId === st.partId
                                ? 'bg-[var(--accent-soft)]'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-medium flex items-center gap-1.5 truncate">
                                <Factory className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                                <span className="truncate">
                                  {st.id} · {st.name}
                                </span>
                              </div>
                              <div className="text-[11px] font-mono text-slate-500">
                                Q {fmtNum(st.currentQueueLen, 1)}/{st.bufferCapacity} ·{' '}
                                {st.utilizationPct}% util
                              </div>
                            </div>
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold shrink-0 ${ind.badgeCls}`}
                            >
                              {ind.shortCode}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Warehouse Rack Locations Quick Picker */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-semibold uppercase tracking-wider">
                        Warehouse Racks ({activeSnapshot.rackBins.slice(0, 18).length})
                      </span>
                      <span className="font-mono">R1–R3 · Bay</span>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg max-h-[155px] overflow-y-auto">
                      {activeSnapshot.rackBins.slice(0, 18).map((bin) => {
                        const ind = VISUAL_INDICATOR_SPECS[bin.visualStatus];
                        return (
                          <button
                            key={bin.partId}
                            type="button"
                            onClick={() => locateSkuInPlantRack(bin.sku)}
                            className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 text-xs cursor-pointer ${
                              selectedPart?.partId === bin.partId
                                ? 'bg-[var(--accent-soft)]'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-mono text-[11px] font-semibold truncate">
                                {bin.location.code} · {bin.sku}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {fmtInt(bin.stock)} {bin.unit} (ROP {fmtInt(bin.rop)})
                              </div>
                            </div>
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold shrink-0 ${ind.badgeCls}`}
                            >
                              {ind.shortCode}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {/* Integrated Engineering Navigation Card */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <Cpu className="h-4 w-4 text-[var(--accent)] shrink-0" />
              <span>Run full multi-module scenarios for {assemblySku}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="whitespace-nowrap shrink-0"
                onClick={() => onNavigate('scenario-studio')}
              >
                Scenario Studio <ArrowRight className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="whitespace-nowrap shrink-0"
                onClick={() => onNavigate('factory-sim')}
              >
                Simulation Lab <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <AssumptionPanel topicId="models-3d" />
    </div>
  );
};
