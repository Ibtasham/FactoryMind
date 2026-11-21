import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Download,
  Plus,
  RefreshCw,
  Save,
  Sliders,
  Trash2,
} from 'lucide-react';
import { BarChart, LineChart } from '../components/charts/Charts';
import { RouteId } from '../components/layout/AppShell';
import { FactoryFloor2D } from '../components/sim/FactoryFloor2D';
import { LazyFactory3DViewport } from '../components/three/LazyFactory3DViewport';
import {
  AssumptionPanel,
  Button,
  EmptyState,
  Field,
  Input,
  Panel,
  SegmentedControl,
  Select,
  StatCard,
  downloadFile,
} from '../components/ui/Primitives';
import {
  buildDesConfigFromFactorySim,
  DesExperimentPoint,
  DesOrderSpec,
  runDesExperimentSuite,
  runDiscreteEventSimulation,
} from '../engine/desEngine';
import {
  buildDefaultFactoryConfigFromWorkspace,
  estimateSpcQualityProfile,
  extractBomMaterialsForFactory,
  FactorySimConfig,
  FactoryStationConfig,
  forecastDemandSignalForProduct,
  resolveActiveLineBalanceSolution,
  RoutingMode,
  runFactorySimulation,
  runSensitivitySweep,
  SensitivityLeverResult,
  SpcQualityProfileKey,
  stationsFromLineBalanceForFactory,
} from '../engine/factorySim';
import { fmtMoney, fmtNum } from '../engine/formatters';
import { ServiceDistType } from '../engine/prodsim';
import { PlantRackProductInput, PlantStationInput } from '../engine/threeModels';
import { AssemblySku, isAssemblySku } from '../engine/threeSpecs';
import { toCSV } from '../store/store';
import { useStore } from '../store/StoreContext';

type LabTab = 'floor' | 'des' | 'materials' | 'montecarlo' | 'scenarios';
type TwinView = '2d' | '3d';

export const FactorySimLabPage: React.FC<{
  onNavigate: (r: RouteId) => void;
}> = ({ onNavigate }) => {
  const {
    products,
    metricsOf,
    settings,
    lineBalance,
    factorySimConfig,
    setFactorySimConfig,
    factoryScenarios,
    saveFactoryScenario,
    deleteFactoryScenario,
    pushToast,
  } = useStore();

  const [activeTab, setActiveTab] = useState<LabTab>('floor');
  const [twinView, setTwinView] = useState<TwinView>('2d');
  const [selectedStationIdx, setSelectedStationIdx] = useState<number>(0);
  const [spcProfile, setSpcProfile] = useState<SpcQualityProfileKey>('stable');
  const [sweepSeedHash, setSweepSeedHash] = useState<string>('');
  const [sweepLevers, setSweepLevers] = useState<SensitivityLeverResult[]>([]);
  const [scenarioName, setScenarioName] = useState<string>('');
  const [scenarioNotes, setScenarioNotes] = useState<string>('');

  // Priority-Queue DES Engine controls (Shift Calendar, Orders, Failure Distribution & Experimentation)
  const [desDeterministic, setDesDeterministic] = useState<boolean>(false);
  const [desEnableShifts, setDesEnableShifts] = useState<boolean>(true);
  const [desWorkDaysPerWeek, setDesWorkDaysPerWeek] = useState<number>(5);
  const [desShiftGapMin, setDesShiftGapMin] = useState<number>(15);
  const [desFailureDist, setDesFailureDist] = useState<'weibull' | 'exponential' | 'lognormal'>('weibull');
  const [desSecondaryRoute, setDesSecondaryRoute] = useState<boolean>(true);
  const [desIncludeOpen, setDesIncludeOpen] = useState<boolean>(true);
  const [desOrders, setDesOrders] = useState<DesOrderSpec[]>([
    { id: 'PO-101', sku: factorySimConfig.assemblySku, routeId: `RT-${factorySimConfig.assemblySku}`, qty: 14, releaseAtMin: 0, dueAtMin: 480, priority: 1 },
    { id: 'PO-102', sku: `${factorySimConfig.assemblySku}-V2`, routeId: `RT-${factorySimConfig.assemblySku}-VAR`, qty: 8, releaseAtMin: 120, dueAtMin: 720, priority: 2 },
  ]);
  const [desExperiments, setDesExperiments] = useState<DesExperimentPoint[]>([]);

  const config = factorySimConfig;

  useEffect(() => {
    if (selectedStationIdx >= config.stations.length) {
      setSelectedStationIdx(Math.max(0, config.stations.length - 1));
    }
  }, [config.stations.length, selectedStationIdx]);

  const result = useMemo(() => runFactorySimulation(config), [config]);

  const desConfig = useMemo(() => {
    const primaryRouteId = `RT-${config.assemblySku}`;
    const varRouteId = `RT-${config.assemblySku}-VAR`;
    const validOrders = desOrders.map((o) => ({
      ...o,
      routeId: desSecondaryRoute && o.sku.endsWith('-V2') ? varRouteId : primaryRouteId,
    }));
    const baseDes = buildDesConfigFromFactorySim(config, {
      enableShifts: desEnableShifts,
      workingDaysPerWeek: desWorkDaysPerWeek,
      interShiftGapMin: desShiftGapMin,
      failureDistKind: desFailureDist,
      customSecondaryRoute: desSecondaryRoute,
      includeOpenArrivals: desIncludeOpen,
      orders: validOrders,
    });
    return { ...baseDes, deterministic: desDeterministic };
  }, [
    config,
    desDeterministic,
    desEnableShifts,
    desWorkDaysPerWeek,
    desShiftGapMin,
    desFailureDist,
    desSecondaryRoute,
    desIncludeOpen,
    desOrders,
  ]);

  const desResult = useMemo(() => runDiscreteEventSimulation(desConfig), [desConfig]);

  const updateConfig = (updater: (prev: FactorySimConfig) => FactorySimConfig) => {
    setFactorySimConfig(updater(config));
  };

  const updateStation = (idx: number, patch: Partial<FactoryStationConfig>) => {
    updateConfig((prev) => ({
      ...prev,
      stations: prev.stations.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));
  };

  // Cross-module sync handlers
  const handleSelectAssembly = (sku: string) => {
    const fresh = buildDefaultFactoryConfigFromWorkspace({
      products,
      lineBalance,
      metricsOf,
      assemblySku: sku,
      spcProfile,
    });
    setFactorySimConfig({
      ...config,
      name: `${fresh.assemblySku} Simulation`,
      assemblySku: fresh.assemblySku,
      assemblyName: fresh.assemblyName,
      arrivalRatePerHour: fresh.arrivalRatePerHour,
      materials: fresh.materials,
      enforceMaterialFlow: fresh.materials.length > 0,
      sourceNotes: fresh.sourceNotes,
    });
    setDesOrders((prev) =>
      prev.map((o) => ({
        ...o,
        sku: o.sku.endsWith('-V2') ? `${fresh.assemblySku}-V2` : fresh.assemblySku,
      }))
    );
    pushToast({ type: 'info', message: `Synced BOM & demand profile for ${fresh.assemblySku}.` });
  };

  const handleSyncLineBalance = () => {
    const lbSol = resolveActiveLineBalanceSolution(lineBalance);
    const nextStations = stationsFromLineBalanceForFactory(lbSol);
    const opsReq = nextStations.reduce((s, st) => s + st.machineCount * st.operatorsPerMachine, 0);
    updateConfig((prev) => ({
      ...prev,
      stations: nextStations,
      operatorsAvailable: Math.max(prev.operatorsAvailable, opsReq),
      reworkTargetStationIdx: Math.min(prev.reworkTargetStationIdx, Math.max(0, nextStations.length - 1)),
      sourceNotes: {
        ...prev.sourceNotes,
        lineBalanceOrigin: lbSol
          ? `${lineBalance.benchmarkKey} · ${lbSol.label} (${lbSol.stationCount} stns @ C=${lineBalance.cycleTime}m)`
          : 'Default 3-station line',
      },
    }));
    setSelectedStationIdx(0);
    pushToast({ type: 'success', message: `Imported ${nextStations.length} stations from Line Balancing.` });
  };

  const handleSyncForecastDemand = () => {
    const assembly = products.find((p) => p.sku.toUpperCase() === config.assemblySku.toUpperCase()) || products[0];
    if (!assembly) return;
    const fc = forecastDemandSignalForProduct(assembly);
    const cycleMin = Math.max(1, lineBalance.cycleTime || 10);
    const rawHourly = fc.monthlyForecast / (22 * config.shiftsPerDay * config.shiftHours);
    const nextRate = Number((rawHourly >= 0.9 ? rawHourly : Math.max(2.2, (60 / cycleMin) * 0.85)).toFixed(2));
    updateConfig((prev) => ({
      ...prev,
      arrivalRatePerHour: nextRate,
      sourceNotes: {
        ...prev.sourceNotes,
        demandOrigin:
          rawHourly >= 0.9
            ? `Forecast (${fc.modelName}: ${fc.monthlyForecast.toFixed(0)}/mo)`
            : `Takt-scaled from ${assembly.sku} (${fc.modelName}: ${fc.monthlyForecast.toFixed(0)}/mo at C=${cycleMin}m)`,
      },
    }));
    pushToast({ type: 'success', message: `Arrival rate synced to ${nextRate} jobs/hr (${fc.modelName}).` });
  };

  const handleSyncBom = () => {
    const assembly = products.find((p) => p.sku.toUpperCase() === config.assemblySku.toUpperCase());
    const mats = extractBomMaterialsForFactory(products, assembly, metricsOf);
    updateConfig((prev) => ({
      ...prev,
      materials: mats,
      enforceMaterialFlow: mats.length > 0,
      sourceNotes: {
        ...prev.sourceNotes,
        bomOrigin: mats.length
          ? `${assembly?.sku || prev.assemblySku} BOM (${mats.length} live warehouse SKUs)`
          : 'No BOM components linked',
      },
    }));
    pushToast({
      type: mats.length ? 'success' : 'info',
      message: mats.length
        ? `Synced ${mats.length} BOM components from Inventory & ROP.`
        : 'Selected SKU has no BOM lines.',
    });
  };

  const handleApplySpcProfile = (key: SpcQualityProfileKey) => {
    setSpcProfile(key);
    const spcEst = estimateSpcQualityProfile(key);
    updateConfig((prev) => ({
      ...prev,
      defectRatePct: spcEst.defectRatePct,
      sourceNotes: { ...prev.sourceNotes, spcOrigin: spcEst.label },
    }));
    pushToast({ type: 'info', message: `Defect rate updated to ${spcEst.defectRatePct}% (${spcEst.label}).` });
  };

  const handleAddStation = () => {
    const nextNum = config.stations.length + 1;
    const newSt: FactoryStationConfig = {
      id: `ST-${nextNum}`,
      name: `Station ${nextNum} Aux`,
      meanTimeMin: 6.5,
      cv: 0.16,
      machineCount: 1,
      bufferCapacity: 6,
      setupTimeMin: 0.25,
      operatorsPerMachine: 1,
      mtbfMin: 240,
      mttrMin: 10,
      pmIntervalMin: 0,
      pmDurationMin: 0,
      hourlyMachineCost: 42,
    };
    updateConfig((prev) => ({
      ...prev,
      operatorsAvailable: prev.operatorsAvailable + 1,
      stations: [...prev.stations, newSt],
    }));
    setSelectedStationIdx(config.stations.length);
  };

  const handleRemoveStation = (idx: number) => {
    if (config.stations.length <= 1) return;
    updateConfig((prev) => ({
      ...prev,
      reworkTargetStationIdx: Math.min(prev.reworkTargetStationIdx, Math.max(0, prev.stations.length - 2)),
      stations: prev.stations.filter((_, i) => i !== idx),
    }));
  };

  // Run automated bottleneck sensitivity sweep
  const handleRunSweep = () => {
    const sweep = runSensitivitySweep(config);
    setSweepLevers(sweep.levers);
    setSweepSeedHash(result.configHash);
    pushToast({ type: 'success', message: `Evaluated ${sweep.levers.length} operational improvement levers.` });
  };

  const handleApplyLever = (leverId: string) => {
    const bnIdx = result.bottleneckIndex;
    const bnSt = config.stations[bnIdx];
    if (leverId === 'add-bn-machine' && bnSt) {
      updateConfig((prev) => ({
        ...prev,
        operatorsAvailable: prev.operatorsAvailable + Math.ceil(bnSt.operatorsPerMachine || 1),
        stations: prev.stations.map((s, idx) => (idx === bnIdx ? { ...s, machineCount: s.machineCount + 1 } : s)),
      }));
    } else if (leverId === 'double-buffers') {
      updateConfig((prev) => ({
        ...prev,
        stations: prev.stations.map((s) => ({
          ...s,
          bufferCapacity: Math.min(30, Math.max(4, s.bufferCapacity * 2)),
        })),
      }));
    } else if (leverId === 'enable-pm') {
      updateConfig((prev) => ({
        ...prev,
        stations: prev.stations.map((s) => ({ ...s, pmIntervalMin: 240, pmDurationMin: 6 })),
      }));
    } else if (leverId === 'smed-cv') {
      updateConfig((prev) => ({
        ...prev,
        defectRatePct: Math.max(0.4, Number((prev.defectRatePct * 0.6).toFixed(2))),
        stations: prev.stations.map((s) => ({
          ...s,
          cv: Math.max(0.05, Number((s.cv * 0.65).toFixed(2))),
          setupTimeMin: Number((s.setupTimeMin * 0.5).toFixed(2)),
        })),
      }));
    } else if (leverId === 'raise-rop') {
      updateConfig((prev) => ({
        ...prev,
        materials: prev.materials.map((m) => ({
          ...m,
          rop: Math.round(m.rop * 1.4),
          orderQty: Math.round(m.orderQty * 1.25),
          initialStock: Math.max(m.initialStock, Math.round(m.rop * 1.5)),
        })),
      }));
    }
    pushToast({ type: 'success', message: 'Applied lever to active Factory Simulation config.' });
  };

  // Scenarios
  const handleSaveScenario = (e: React.FormEvent) => {
    e.preventDefault();
    const label = scenarioName.trim() || `${config.assemblySku} Scenario ${factoryScenarios.length + 1}`;
    saveFactoryScenario(label, scenarioNotes.trim(), config);
    setScenarioName('');
    setScenarioNotes('');
    pushToast({ type: 'success', message: `Saved scenario "${label}".` });
  };

  const handleLoadQuickPreset = (preset: 'surge' | 'optimized' | 'reset') => {
    if (preset === 'reset') {
      const fresh = buildDefaultFactoryConfigFromWorkspace({
        products,
        lineBalance,
        metricsOf,
        assemblySku: config.assemblySku,
        spcProfile: 'stable',
      });
      setFactorySimConfig(fresh);
      pushToast({ type: 'info', message: 'Reset simulation parameters to workspace baseline.' });
      return;
    }
    if (preset === 'surge') {
      updateConfig((prev) => ({
        ...prev,
        name: `${prev.assemblySku} +35% Demand Surge`,
        arrivalRatePerHour: Number((prev.arrivalRatePerHour * 1.35).toFixed(2)),
      }));
      pushToast({ type: 'warn', message: 'Loaded +35% arrival rate stress test.' });
      return;
    }
    const bnIdx = result.bottleneckIndex;
    updateConfig((prev) => ({
      ...prev,
      name: `${prev.assemblySku} Balanced Cell + PM`,
      routingMode: 'parallel-cell',
      operatorsAvailable:
        prev.operatorsAvailable + (prev.stations[bnIdx]?.operatorsPerMachine || 1),
      stations: prev.stations.map((s, idx) => ({
        ...s,
        machineCount: idx === bnIdx ? Math.min(6, s.machineCount + 1) : s.machineCount,
        bufferCapacity: Math.max(8, s.bufferCapacity),
        pmIntervalMin: 240,
        pmDurationMin: 6,
      })),
    }));
    pushToast({ type: 'success', message: 'Loaded U-Cell + Bottleneck Relief + PM configuration.' });
  };

  const scenarioComparison = useMemo(() => {
    const activeRow = {
      id: '__active__',
      name: `Active: ${config.name}`,
      isActive: true,
      config,
      res: result,
    };
    const savedRows = factoryScenarios.map((sc) => ({
      id: sc.id,
      name: sc.name,
      isActive: false,
      config: sc.config,
      res: runFactorySimulation(sc.config),
    }));
    return [activeRow, ...savedRows];
  }, [config, result, factoryScenarios]);

  // Simulation-driven 3D Twin inputs
  const simPlantProducts = useMemo<PlantRackProductInput[]>(() => {
    const matMap = new Map(result.materials.map((m) => [m.sku.toUpperCase(), m]));
    return products.map((p) => {
      const m = metricsOf(p);
      const simMat = matMap.get(p.sku.toUpperCase());
      const effectiveStock = simMat ? simMat.endingStock : p.stock;
      const status =
        effectiveStock <= 0
          ? 'out'
          : effectiveStock <= m.safetyStock
            ? 'critical'
            : effectiveStock <= m.rop
              ? 'reorder'
              : 'ok';
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        stock: effectiveStock,
        rop: simMat ? config.materials.find((cm) => cm.sku.toUpperCase() === p.sku.toUpperCase())?.rop ?? m.rop : m.rop,
        unit: p.unit,
        status,
      };
    });
  }, [products, metricsOf, result.materials, config.materials]);

  const simPlantStations = useMemo<PlantStationInput[]>(() => {
    return result.stations.map((st, idx) => ({
      stationNumber: idx + 1,
      utilizationPct: Math.round(st.utilizationPct),
      taskCount: st.machineCount,
      tasksLabel: `${st.id} · ${st.machineCount}×M · ${fmtNum(st.effectiveCycleMin, 1)}m`,
      isBottleneck: st.isBottleneck,
      avgQueueLen: st.avgQueueLen,
      throughputPerHour: result.throughputPerHour.mean,
    }));
  }, [result.stations, result.throughputPerHour.mean]);

  const threeSku: AssemblySku = isAssemblySku(config.assemblySku) ? config.assemblySku : 'ASM-CM200';

  const exportDossierJSON = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'FactoryMind Simulation Lab',
      provenance: result.provenance,
      provenanceNotice: result.provenanceNotice,
      configHash: result.configHash,
      config,
      result,
    };
    downloadFile(`factory-sim-${config.assemblySku}-${result.configHash}.json`, JSON.stringify(payload, null, 2), 'application/json');
    pushToast({ type: 'success', message: 'Exported reproducible simulation JSON dossier.' });
  };

  const exportDossierCSV = () => {
    const rows = result.stations.map((s) => [
      s.id,
      s.name,
      s.machineCount,
      s.meanTimeMin.toFixed(2),
      s.effectiveCycleMin.toFixed(2),
      s.utilizationPct.toFixed(1),
      s.busyPct.toFixed(1),
      s.blockedPct.toFixed(1),
      s.starvedPct.toFixed(1),
      s.downPct.toFixed(1),
      s.pmPct.toFixed(1),
      s.avgQueueLen.toFixed(2),
      s.maxQueueLen,
      s.avgWaitMin.toFixed(2),
      s.processedJobs,
      s.isBottleneck ? 'YES' : 'NO',
    ]);
    const csv = toCSV(
      [
        'Station ID',
        'Name',
        'Machines',
        'Mean Cycle (min)',
        'Effective Cycle (min)',
        'Utilization %',
        'Busy %',
        'Blocked %',
        'Starved %',
        'Breakdown %',
        'PM %',
        'Avg Queue',
        'Max Queue',
        'Avg Wait (min)',
        'Jobs Processed',
        'Bottleneck',
      ],
      rows
    );
    downloadFile(`factory-sim-stations-${result.configHash}.csv`, csv, 'text/csv');
    pushToast({ type: 'success', message: 'Exported station telemetry CSV.' });
  };

  if (!products.length) {
    return (
      <EmptyState
        title="No workspace items available"
        message="Add inventory SKUs or restore the sample catalog in Settings to run integrated factory simulations."
        action={
          <Button variant="primary" onClick={() => onNavigate('settings')}>
            Open Settings
          </Button>
        }
      />
    );
  }

  const selectedStation = config.stations[selectedStationIdx] || config.stations[0];
  const selectedStationResult = result.stations[selectedStationIdx] || result.stations[0];
  const assembliesWithBom = products.filter((p) => Array.isArray(p.bom) && p.bom.length > 0);
  const skuOptions = assembliesWithBom.length ? assembliesWithBom : products;

  return (
    <div className="space-y-4">
      {/* Provenance & Cross-Module Integration Banner */}
      <Panel
        title="Factory Simulation Lab — Integrated Virtual Plant"
        subtitle={`Simulated Model · Seed #${result.seed} · Hash ${result.configHash} · Traceable discrete-event & Monte Carlo output (not live plant measurements)`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={exportDossierCSV}>
              <Download className="h-3.5 w-3.5" /> Station CSV
            </Button>
            <Button size="sm" variant="primary" onClick={exportDossierJSON}>
              <Download className="h-3.5 w-3.5" /> Dossier JSON
            </Button>
          </div>
        }
      >
        {/* Cross-Module Sync Bar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-3">
            <Field label="Target assembly / product">
              <Select
                aria-label="Target assembly SKU"
                value={
                  skuOptions.some((p) => p.sku === config.assemblySku)
                    ? config.assemblySku
                    : skuOptions[0]?.sku || ''
                }
                onChange={(e) => handleSelectAssembly(e.target.value)}
              >
                {skuOptions.map((p) => (
                  <option key={p.id} value={p.sku}>
                    {p.sku} · {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="lg:col-span-2">
            <Field label="SPC quality profile">
              <Select
                aria-label="SPC quality profile"
                value={spcProfile}
                onChange={(e) => handleApplySpcProfile(e.target.value as SpcQualityProfileKey)}
              >
                <option value="stable">Stable (Cpk &ge; 1.6)</option>
                <option value="drift">Tool-Wear Drift</option>
                <option value="ooc">Out-of-Control Spike</option>
              </Select>
            </Field>
          </div>

          <div className="lg:col-span-1">
            <Field label="Reps" hint="1–80">
              <Input
                type="number"
                min={1}
                max={80}
                value={config.replications}
                onChange={(e) =>
                  updateConfig((p) => ({
                    ...p,
                    replications: Math.max(1, Math.min(80, Math.round(Number(e.target.value) || 1))),
                  }))
                }
              />
            </Field>
          </div>

          <div className="lg:col-span-2">
            <Field label="PRNG Seed">
              <div className="flex gap-1.5">
                <Input
                  type="number"
                  value={config.seed}
                  onChange={(e) =>
                    updateConfig((p) => ({ ...p, seed: Math.max(1, Math.round(Number(e.target.value) || 101)) }))
                  }
                />
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="Step random seed"
                  onClick={() => updateConfig((p) => ({ ...p, seed: p.seed + 7 }))}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Field>
          </div>

          <div className="lg:col-span-4 flex flex-wrap xl:flex-nowrap gap-1.5 justify-start lg:justify-end">
            <Button size="sm" variant="secondary" onClick={handleSyncLineBalance} className="whitespace-nowrap shrink-0">
              Sync Line Bal
            </Button>
            <Button size="sm" variant="secondary" onClick={handleSyncForecastDemand} className="whitespace-nowrap shrink-0">
              Sync Forecast
            </Button>
            <Button size="sm" variant="secondary" onClick={handleSyncBom} className="whitespace-nowrap shrink-0">
              Sync BOM
            </Button>
          </div>
        </div>

        {/* Traceable Origin Summary */}
        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          <span>
            <strong className="font-medium text-slate-700 dark:text-slate-200">Demand:</strong>{' '}
            {config.sourceNotes.demandOrigin}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="font-medium text-slate-700 dark:text-slate-200">Line:</strong>{' '}
            {config.sourceNotes.lineBalanceOrigin}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="font-medium text-slate-700 dark:text-slate-200">BOM:</strong>{' '}
            {config.sourceNotes.bomOrigin}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="font-medium text-slate-700 dark:text-slate-200">SPC:</strong>{' '}
            {config.sourceNotes.spcOrigin}
          </span>
        </div>
      </Panel>

      {/* Validation Alert if invalid */}
      {!result.valid && (
        <div
          role="alert"
          className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{result.reason}</span>
        </div>
      )}

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          label="Simulated Throughput"
          value={`${fmtNum(result.throughputPerHour.mean, 2)} /hr`}
          sub={`95% CI [${fmtNum(result.throughputPerHour.ci95Low, 2)}, ${fmtNum(result.throughputPerHour.ci95High, 2)}] · Max ${fmtNum(result.theoreticalMaxPerHour, 1)}/hr`}
          tone={result.throughputPerHour.mean >= config.arrivalRatePerHour * 0.9 ? 'good' : 'warn'}
        />
        <StatCard
          label="Flow Cycle Time"
          value={`${fmtNum(result.cycleTimeMin.mean, 1)} min`}
          sub={`95% CI [${fmtNum(result.cycleTimeMin.ci95Low, 1)}, ${fmtNum(result.cycleTimeMin.ci95High, 1)}] · WIP ${fmtNum(result.avgWip.mean, 1)}`}
        />
        <StatCard
          label="Line OEE"
          value={`${fmtNum(result.oeePct, 1)}%`}
          sub={`A ${fmtNum(result.oeeAvailabilityPct, 0)}% · P ${fmtNum(result.oeePerformancePct, 0)}% · Q ${fmtNum(result.oeeQualityPct, 1)}%`}
          tone={result.oeePct >= 75 ? 'good' : result.oeePct >= 55 ? 'warn' : 'bad'}
        />
        <StatCard
          label="Unit Cost / Good Unit"
          value={fmtMoney(result.costPerGoodUnit)}
          sub={`Bottleneck: ${result.bottleneckName} (${fmtNum(result.bottleneckUtilPct, 0)}%)`}
          tone={result.materialStarvedHours > 1 || result.bottleneckUtilPct >= 92 ? 'bad' : 'neutral'}
        />
      </div>

      {/* Sub-view Tab Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={activeTab}
          onChange={(v) => setActiveTab(v as LabTab)}
          options={[
            { value: 'floor', label: 'Virtual Factory & Twin' },
            { value: 'des', label: `DES Event Engine (${desResult.orders.length} Orders)` },
            { value: 'materials', label: `Material Flow (${result.materials.length})` },
            { value: 'montecarlo', label: 'Monte Carlo & Optimization' },
            { value: 'scenarios', label: `Scenario Lab (${factoryScenarios.length})` },
          ]}
        />

        {activeTab === 'floor' && (
          <SegmentedControl
            value={twinView}
            onChange={(v) => setTwinView(v as TwinView)}
            options={[
              { value: '2d', label: '2D Floor Blueprint' },
              { value: '3d', label: '3D Plant Digital Twin' },
            ]}
          />
        )}
      </div>

      {/* TAB 1: VIRTUAL FACTORY & TWIN */}
      {activeTab === 'floor' && (
        <div className="space-y-4">
          <Panel
            title={twinView === '2d' ? 'Interactive 2D Factory Floor & Trace Playback' : 'Live 3D Plant & Warehouse Twin'}
            subtitle={
              twinView === '2d'
                ? 'Live queue depths, station blocking/starvation states, and material feed from Seed #' + result.seed
                : 'Warehouse rack stock levels & station utilization/queues driven directly by active simulation output'
            }
            actions={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => onNavigate('line-balance')}>
                  Line Balance
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onNavigate('models-3d')}>
                  <Box className="h-3.5 w-3.5" /> 3D Studio
                </Button>
              </div>
            }
          >
            {twinView === '2d' ? (
              <FactoryFloor2D
                config={config}
                result={result}
                selectedStationIdx={selectedStationIdx}
                onSelectStation={setSelectedStationIdx}
                onInspectMaterials={() => setActiveTab('materials')}
                reduceMotion={Boolean(settings.reduceMotion)}
              />
            ) : (
              <LazyFactory3DViewport
                mode="plant"
                assemblySku={threeSku}
                plantProducts={simPlantProducts}
                plantStations={simPlantStations}
                explodeAmount={0}
                finish="steel"
                theme={settings.theme}
                reduceMotion={Boolean(settings.reduceMotion)}
              />
            )}
          </Panel>

          {/* Line & Workstation Editor Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Global Routing, Demand, Shift & Workforce Parameters */}
            <Panel
              title="Routing, Demand & Workforce"
              subtitle="Shift schedule, arrival variability, quality rework loop & operator constraints"
              className="lg:col-span-5"
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="Arrival rate (jobs/hr)">
                  <Input
                    type="number"
                    min={0.2}
                    step={0.2}
                    value={config.arrivalRatePerHour}
                    onChange={(e) =>
                      updateConfig((p) => ({
                        ...p,
                        arrivalRatePerHour: Math.max(0.1, Number(e.target.value) || 1),
                      }))
                    }
                  />
                </Field>
                <Field label="Arrival CV">
                  <Input
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    value={config.arrivalCv}
                    onChange={(e) =>
                      updateConfig((p) => ({
                        ...p,
                        arrivalCv: Math.max(0, Math.min(2, Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </Field>
                <Field label="Routing topology">
                  <Select
                    value={config.routingMode}
                    onChange={(e) => updateConfig((p) => ({ ...p, routingMode: e.target.value as RoutingMode }))}
                  >
                    <option value="rework-loop">Closed-Loop Rework</option>
                    <option value="serial">Serial Flow (Scrap)</option>
                    <option value="parallel-cell">U-Cell Quick Setup</option>
                  </Select>
                </Field>
                <Field label="Service distribution">
                  <Select
                    value={config.serviceDist}
                    onChange={(e) =>
                      updateConfig((p) => ({ ...p, serviceDist: e.target.value as ServiceDistType }))
                    }
                  >
                    <option value="lognormal">Lognormal</option>
                    <option value="normal">Normal</option>
                    <option value="exponential">Exponential</option>
                    <option value="constant">Deterministic</option>
                  </Select>
                </Field>
                <Field label="SPC defect rate (%)">
                  <Input
                    type="number"
                    min={0}
                    max={45}
                    step={0.2}
                    value={config.defectRatePct}
                    onChange={(e) =>
                      updateConfig((p) => ({
                        ...p,
                        defectRatePct: Math.max(0, Math.min(45, Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </Field>
                <Field label="Rework return station">
                  <Select
                    disabled={config.routingMode !== 'rework-loop'}
                    value={config.reworkTargetStationIdx}
                    onChange={(e) =>
                      updateConfig((p) => ({ ...p, reworkTargetStationIdx: Number(e.target.value) || 0 }))
                    }
                  >
                    {config.stations.map((s, idx) => (
                      <option key={s.id} value={idx}>
                        {s.id} · {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Shifts / day" hint="1–3">
                  <Input
                    type="number"
                    min={1}
                    max={3}
                    value={config.shiftsPerDay}
                    onChange={(e) =>
                      updateConfig((p) => ({
                        ...p,
                        shiftsPerDay: Math.max(1, Math.min(3, Math.round(Number(e.target.value) || 1))),
                      }))
                    }
                  />
                </Field>
                <Field label="Hours / shift" hint="4–12">
                  <Input
                    type="number"
                    min={4}
                    max={12}
                    value={config.shiftHours}
                    onChange={(e) =>
                      updateConfig((p) => ({
                        ...p,
                        shiftHours: Math.max(4, Math.min(12, Number(e.target.value) || 8)),
                      }))
                    }
                  />
                </Field>
                <Field label="Days simulated" hint="1–30">
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={config.daysToSimulate}
                    onChange={(e) =>
                      updateConfig((p) => ({
                        ...p,
                        daysToSimulate: Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 1))),
                      }))
                    }
                  />
                </Field>
                <Field label="Operators available" hint={`Req ${result.operatorsRequired}`}>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={config.operatorsAvailable}
                    onChange={(e) =>
                      updateConfig((p) => ({
                        ...p,
                        operatorsAvailable: Math.max(1, Math.round(Number(e.target.value) || 1)),
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={config.enforceMaterialFlow}
                    onChange={(e) => updateConfig((p) => ({ ...p, enforceMaterialFlow: e.target.checked }))}
                    className="rounded border-slate-300 accent-[var(--accent)]"
                  />
                  <span>Enforce live BOM warehouse stock &amp; ROP lead times</span>
                </label>
              </div>
            </Panel>

            {/* Selected Workstation Configurator */}
            <Panel
              title={`Workstation Inspector: ${selectedStation?.id || ''}`}
              subtitle="Configure parallel machines, buffer queues, changeover setup, breakdowns & PM"
              className="lg:col-span-7"
              actions={
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="secondary" onClick={handleAddStation}>
                    <Plus className="h-3.5 w-3.5" /> Add Station
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={config.stations.length <= 1}
                    onClick={() => handleRemoveStation(selectedStationIdx)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </Button>
                </div>
              }
            >
              {/* Quick Station Selector Strip */}
              <div className="flex flex-wrap gap-1.5 mb-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                {config.stations.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedStationIdx(idx)}
                    className={`px-2.5 py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
                      idx === selectedStationIdx
                        ? 'bg-[var(--accent)] text-white'
                        : result.stations[idx]?.isBottleneck
                          ? 'border border-rose-400/60 text-rose-600 dark:text-rose-400'
                          : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {s.id} ({s.machineCount}×)
                  </button>
                ))}
              </div>

              {selectedStation && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="col-span-2 sm:col-span-3">
                    <Field label="Station name">
                      <Input
                        className="font-sans"
                        value={selectedStation.name}
                        onChange={(e) => updateStation(selectedStationIdx, { name: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="Mean cycle (min)">
                    <Input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={selectedStation.meanTimeMin}
                      onChange={(e) =>
                        updateStation(selectedStationIdx, {
                          meanTimeMin: Math.max(0.2, Number(e.target.value) || 0.5),
                        })
                      }
                    />
                  </Field>
                  <Field label="Parallel machines" hint="1–6">
                    <Input
                      type="number"
                      min={1}
                      max={6}
                      value={selectedStation.machineCount}
                      onChange={(e) =>
                        updateStation(selectedStationIdx, {
                          machineCount: Math.max(1, Math.min(6, Math.round(Number(e.target.value) || 1))),
                        })
                      }
                    />
                  </Field>
                  <Field label="Buffer capacity" hint="1–50">
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={selectedStation.bufferCapacity}
                      onChange={(e) =>
                        updateStation(selectedStationIdx, {
                          bufferCapacity: Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 1))),
                        })
                      }
                    />
                  </Field>
                  <Field label="Service CV">
                    <Input
                      type="number"
                      min={0}
                      max={2}
                      step={0.02}
                      value={selectedStation.cv}
                      onChange={(e) =>
                        updateStation(selectedStationIdx, {
                          cv: Math.max(0, Math.min(2, Number(e.target.value) || 0)),
                        })
                      }
                    />
                  </Field>
                  <Field label="Setup time (min)">
                    <Input
                      type="number"
                      min={0}
                      step={0.1}
                      value={selectedStation.setupTimeMin}
                      onChange={(e) =>
                        updateStation(selectedStationIdx, {
                          setupTimeMin: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                    />
                  </Field>
                  <Field label="Ops / machine">
                    <Input
                      type="number"
                      min={0.5}
                      max={4}
                      step={0.5}
                      value={selectedStation.operatorsPerMachine}
                      onChange={(e) =>
                        updateStation(selectedStationIdx, {
                          operatorsPerMachine: Math.max(0.5, Math.min(4, Number(e.target.value) || 1)),
                        })
                      }
                    />
                  </Field>
                  <Field label="MTBF (min)" hint="0 = none">
                    <Input
                      type="number"
                      min={0}
                      step={10}
                      value={selectedStation.mtbfMin}
                      onChange={(e) =>
                        updateStation(selectedStationIdx, { mtbfMin: Math.max(0, Number(e.target.value) || 0) })
                      }
                    />
                  </Field>
                  <Field label="MTTR (min)">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={selectedStation.mttrMin}
                      onChange={(e) =>
                        updateStation(selectedStationIdx, { mttrMin: Math.max(0, Number(e.target.value) || 0) })
                      }
                    />
                  </Field>
                  <Field label="PM interval (min)" hint="0 = off">
                    <Input
                      type="number"
                      min={0}
                      step={30}
                      value={selectedStation.pmIntervalMin}
                      onChange={(e) =>
                        updateStation(selectedStationIdx, {
                          pmIntervalMin: Math.max(0, Number(e.target.value) || 0),
                          pmDurationMin:
                            Number(e.target.value) > 0 && selectedStation.pmDurationMin <= 0
                              ? 6
                              : selectedStation.pmDurationMin,
                        })
                      }
                    />
                  </Field>
                </div>
              )}

              {selectedStationResult && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  <div>
                    <div className="text-slate-400">Busy</div>
                    <div className="font-semibold">{fmtNum(selectedStationResult.busyPct, 1)}%</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Blocked</div>
                    <div className="font-semibold">{fmtNum(selectedStationResult.blockedPct, 1)}%</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Down / PM</div>
                    <div className="font-semibold">
                      {fmtNum(selectedStationResult.downPct, 1)}% / {fmtNum(selectedStationResult.pmPct, 1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Avg Wait</div>
                    <div className="font-semibold">{fmtNum(selectedStationResult.avgWaitMin, 1)} min</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Max Queue</div>
                    <div className="font-semibold">{selectedStationResult.maxQueueLen} jobs</div>
                  </div>
                </div>
              )}
            </Panel>
          </div>

          {/* Trajectory Chart + Engineering Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <Panel
              title="Simulated Throughput & WIP Trajectory"
              subtitle="Replication #1 time-series after steady-state warmup"
              className="lg:col-span-8"
            >
              <LineChart
                labels={result.timeline.map((f) => f.label)}
                height={220}
                yMinZero
                series={[
                  { name: 'Throughput (jobs/hr)', data: result.timeline.map((f) => f.throughputPerHour), color: '#2563eb' },
                  { name: 'Line WIP (jobs)', data: result.timeline.map((f) => f.wip), color: '#f59e0b', dashed: true },
                ]}
              />
            </Panel>

            <Panel
              title="Engineering Action Findings"
              subtitle="Bottleneck, buffer & material observations"
              className="lg:col-span-4"
            >
              <ul className="space-y-2.5 text-xs text-slate-700 dark:text-slate-300">
                {result.recommendations.map((rec, i) => (
                  <li key={i} className="pb-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0 last:pb-0 leading-relaxed">
                    {rec}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}

      {/* TAB 1B: PRIORITY-QUEUE DES ENGINE, SHIFTS, ORDERS & OEE DECOMPOSITION */}
      {activeTab === 'des' && (
        <div className="space-y-4">
          {/* Top DES KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <StatCard
              label="DES Scheduled Throughput"
              value={`${fmtNum(desResult.throughputPerScheduledHour.mean, 2)} /sched hr`}
              sub={`${fmtNum(desResult.totalThroughputGood, 1)} good · ${fmtNum(desResult.rejectedQty, 1)} rejected · ${fmtNum(desResult.reworkedQty, 1)} rework`}
              tone="good"
            />
            <StatCard
              label="Cycle vs Order Lead Time"
              value={`${fmtNum(desResult.avgCycleTimeMin.mean, 1)}m / ${fmtNum(desResult.avgLeadTimeMin.mean, 1)}m`}
              sub={`Completion ${fmtNum(desResult.completionRatePct, 1)}% · OTD ${fmtNum(desResult.onTimeDeliveryPct, 1)}%`}
            />
            <StatCard
              label="OEE vs Asset Utilization"
              value={`${fmtNum(desResult.oeePct, 1)}% / ${fmtNum(desResult.assetUtilizationPct, 1)}%`}
              sub={`A ${fmtNum(desResult.oeeAvailabilityPct, 1)}% · P ${fmtNum(desResult.oeePerformancePct, 1)}% · Q ${fmtNum(desResult.oeeQualityPct, 1)}% · TEEP ${fmtNum(desResult.teepPct, 1)}%`}
              tone={desResult.oeePct >= 75 ? 'good' : 'warn'}
            />
            <StatCard
              label="Flow Conservation Check"
              value={`Residual = ${fmtNum(desResult.flowBalance.conservationResidual, 4)}`}
              sub={
                desResult.flowBalance.wipAtEnd > desResult.flowBalance.wipAtWarmupStart * 1.4 + 5
                  ? `WIP ${fmtNum(desResult.avgWip.mean, 1)} (max ${desResult.maxWip}) · Transient queue buildup`
                  : `WIP ${fmtNum(desResult.avgWip.mean, 1)} (max ${desResult.maxWip}) · Little gap ${fmtNum(desResult.littlesLawGapPct, 1)}%`
              }
              tone={Math.abs(desResult.flowBalance.conservationResidual) < 1e-6 ? 'good' : 'bad'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* DES Calendar, Failure Model & Clock Policy */}
            <Panel
              title="Event Clock, Working Calendar & Failure Model"
              subtitle="Binary MinHeap event clock with exact shift pause/resume & Weibull/Gamma reliability"
              className="lg:col-span-5"
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="Simulation clock mode">
                  <Select
                    aria-label="DES simulation mode"
                    value={desDeterministic ? 'det' : 'stoch'}
                    onChange={(e) => setDesDeterministic(e.target.value === 'det')}
                  >
                    <option value="stoch">Seeded Stochastic (MC)</option>
                    <option value="det">Deterministic Benchmark</option>
                  </Select>
                </Field>
                <Field label="Failure distribution">
                  <Select
                    aria-label="DES failure distribution"
                    value={desFailureDist}
                    onChange={(e) => setDesFailureDist(e.target.value as 'weibull' | 'exponential' | 'lognormal')}
                  >
                    <option value="weibull">Weibull (Wear-out k=1.6)</option>
                    <option value="exponential">Exponential (Memoryless)</option>
                    <option value="lognormal">Lognormal</option>
                  </Select>
                </Field>
                <Field label="Working days / week" hint="1–7">
                  <Input
                    type="number"
                    min={1}
                    max={7}
                    value={desWorkDaysPerWeek}
                    onChange={(e) => setDesWorkDaysPerWeek(Math.max(1, Math.min(7, Math.round(Number(e.target.value) || 5))))}
                  />
                </Field>
                <Field label="Inter-shift gap (min)" hint="0–120">
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    step={5}
                    value={desShiftGapMin}
                    onChange={(e) => setDesShiftGapMin(Math.max(0, Math.min(120, Math.round(Number(e.target.value) || 0))))}
                  />
                </Field>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs text-slate-700 dark:text-slate-300">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={desEnableShifts}
                    onChange={(e) => setDesEnableShifts(e.target.checked)}
                    className="rounded border-slate-300 accent-[var(--accent)]"
                  />
                  <span>Enforce shift calendar breaks &amp; off-shift pause/resume ({desResult.scheduledWorkingHours}h work / {desResult.calendarHours}h cal)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={desSecondaryRoute}
                    onChange={(e) => setDesSecondaryRoute(e.target.checked)}
                    className="rounded border-slate-300 accent-[var(--accent)]"
                  />
                  <span>Enable multi-product non-linear V2 routing branch ({desConfig.routes.length} active routes)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={desIncludeOpen}
                    onChange={(e) => setDesIncludeOpen(e.target.checked)}
                    className="rounded border-slate-300 accent-[var(--accent)]"
                  />
                  <span>Include continuous stochastic open arrivals ({config.arrivalRatePerHour}/hr) alongside scheduled orders</span>
                </label>
              </div>

              {/* Exact Flow Conservation Ledger */}
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-2">
                  Exact Job Conservation Ledger (Post-Warmup)
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                  <div>
                    <div className="text-[10px] text-slate-400">WIP@Start + Arrived</div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {fmtNum(desResult.flowBalance.wipAtWarmupStart, 1)} + {fmtNum(desResult.flowBalance.arrivedAfterWarmup, 1)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">Good + Scrap + WIP@End</div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {fmtNum(desResult.flowBalance.completedGood, 1)} + {fmtNum(desResult.flowBalance.rejectedScrapped, 1)} + {fmtNum(desResult.flowBalance.wipAtEnd, 1)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">FPY / OEE Quality</div>
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {fmtNum(desResult.firstPassYieldPct, 1)}% / {fmtNum(desResult.oeeQualityPct, 1)}%
                    </div>
                  </div>
                </div>
              </div>
            </Panel>

            {/* Production Orders & Multi-SKU Route Queue */}
            <Panel
              title="Production Orders & Multi-Product Routing Queue"
              subtitle="EDD / Priority release queue tracking order-level completion, lead time, and on-time delivery"
              className="lg:col-span-7"
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setDesOrders((prev) => [
                      ...prev,
                      {
                        id: `PO-${101 + prev.length}`,
                        sku: desSecondaryRoute && prev.length % 2 === 1 ? `${config.assemblySku}-V2` : config.assemblySku,
                        routeId: `RT-${config.assemblySku}`,
                        qty: 10,
                        releaseAtMin: prev.length * 120,
                        dueAtMin: prev.length * 120 + 480,
                        priority: prev.length + 1,
                      },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Add Order
                </Button>
              }
            >
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                      <th className="pb-2 pr-2 font-medium">Order</th>
                      <th className="pb-2 pr-2 font-medium">SKU Route</th>
                      <th className="pb-2 pr-2 font-medium text-right">Qty</th>
                      <th className="pb-2 pr-2 font-medium text-right">Release (m)</th>
                      <th className="pb-2 pr-2 font-medium text-right">Due (m)</th>
                      <th className="pb-2 pr-2 font-medium text-right">Good / Scrap</th>
                      <th className="pb-2 pr-2 font-medium text-right">Lead Time</th>
                      <th className="pb-2 font-medium text-right">OTD %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
                    {desOrders.map((ord, oi) => {
                      const tel = desResult.orders[oi];
                      return (
                        <tr key={`${ord.id}-${oi}`}>
                          <td className="py-1.5 pr-2 font-medium whitespace-nowrap text-slate-900 dark:text-slate-100">{ord.id}</td>
                          <td className="py-1.5 pr-2 min-w-[135px]">
                            <Select
                              value={ord.sku.endsWith('-V2') && desSecondaryRoute ? 'V2' : 'MAIN'}
                              onChange={(e) => {
                                const useV2 = e.target.value === 'V2';
                                setDesOrders((prev) =>
                                  prev.map((row, idx) =>
                                    idx === oi
                                      ? { ...row, sku: useV2 ? `${config.assemblySku}-V2` : config.assemblySku }
                                      : row
                                  )
                                );
                              }}
                            >
                              <option value="MAIN">{config.assemblySku} · Serial</option>
                              {desSecondaryRoute && <option value="V2">{config.assemblySku}-V2 · Alt</option>}
                            </Select>
                          </td>
                          <td className="py-1.5 pr-2 w-16">
                            <Input
                              type="number"
                              min={1}
                              max={200}
                              className="text-right"
                              value={ord.qty}
                              onChange={(e) => {
                                const v = Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1)));
                                setDesOrders((prev) => prev.map((r, idx) => (idx === oi ? { ...r, qty: v } : r)));
                              }}
                            />
                          </td>
                          <td className="py-1.5 pr-2 w-20">
                            <Input
                              type="number"
                              min={0}
                              step={30}
                              className="text-right"
                              value={ord.releaseAtMin}
                              onChange={(e) => {
                                const v = Math.max(0, Number(e.target.value) || 0);
                                setDesOrders((prev) => prev.map((r, idx) => (idx === oi ? { ...r, releaseAtMin: v } : r)));
                              }}
                            />
                          </td>
                          <td className="py-1.5 pr-2 w-20">
                            <Input
                              type="number"
                              min={60}
                              step={60}
                              className="text-right"
                              value={ord.dueAtMin ?? 480}
                              onChange={(e) => {
                                const v = Math.max(60, Number(e.target.value) || 480);
                                setDesOrders((prev) => prev.map((r, idx) => (idx === oi ? { ...r, dueAtMin: v } : r)));
                              }}
                            />
                          </td>
                          <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                            {tel ? `${fmtNum(tel.completedQty, 1)} / ${fmtNum(tel.scrappedQty, 1)}` : '—'}
                          </td>
                          <td className="py-1.5 pr-2 text-right whitespace-nowrap">{tel && tel.avgLeadTimeMin > 0 ? `${fmtNum(tel.avgLeadTimeMin, 1)}m` : '—'}</td>
                          <td className="py-1.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <span>{tel ? `${fmtNum(tel.onTimePct, 0)}%` : '—'}</span>
                              {desOrders.length > 1 && (
                                <button
                                  type="button"
                                  aria-label={`Remove ${ord.id}`}
                                  onClick={() => setDesOrders((prev) => prev.filter((_, idx) => idx !== oi))}
                                  className="p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded cursor-pointer"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          {/* Per-Station DES State Partition & OEE vs Asset Utilization Matrix */}
          <Panel
            title="Workstation DES Telemetry — OEE Components vs Asset Utilization"
            subtitle="Mutually exclusive scheduled shift states (Busy + Setup + Blocked + Starved + Down + PM = 100%); Availability excludes low-demand starvation"
          >
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Station</th>
                    <th className="pb-2 pr-2 font-medium text-right">Asset Util %</th>
                    <th className="pb-2 pr-2 font-medium text-right">OEE Avail %</th>
                    <th className="pb-2 pr-2 font-medium text-right">OEE Perf %</th>
                    <th className="pb-2 pr-2 font-medium text-right">Setup %</th>
                    <th className="pb-2 pr-2 font-medium text-right">Blocked %</th>
                    <th className="pb-2 pr-2 font-medium text-right">Starved %</th>
                    <th className="pb-2 pr-2 font-medium text-right">Down+PM %</th>
                    <th className="pb-2 pr-2 font-medium text-right">Avg Wait</th>
                    <th className="pb-2 font-medium text-right">Ops</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
                  {desResult.stations.map((st) => (
                    <tr key={st.id} className={st.isBottleneck ? 'bg-rose-50/50 dark:bg-rose-950/20' : ''}>
                      <td className="py-2 pr-3 font-sans">
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{st.id}</span> · {st.name}{' '}
                        {st.isBottleneck && (
                          <span className="ml-1 text-[10px] font-mono font-semibold text-rose-600 dark:text-rose-400">
                            [BOTTLENECK]
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right font-semibold">{fmtNum(st.assetUtilizationPct, 1)}%</td>
                      <td className="py-2 pr-2 text-right text-emerald-600 dark:text-emerald-400">{fmtNum(st.oeeAvailabilityPct, 1)}%</td>
                      <td className="py-2 pr-2 text-right text-sky-600 dark:text-sky-400">{fmtNum(st.oeePerformancePct, 1)}%</td>
                      <td className="py-2 pr-2 text-right">{fmtNum(st.setupPct, 1)}%</td>
                      <td className="py-2 pr-2 text-right text-amber-600 dark:text-amber-400">{fmtNum(st.blockedPct, 1)}%</td>
                      <td className="py-2 pr-2 text-right text-slate-500">{fmtNum(st.starvedPct, 1)}%</td>
                      <td className="py-2 pr-2 text-right text-rose-600 dark:text-rose-400">{fmtNum(st.downPct + st.pmPct, 1)}%</td>
                      <td className="py-2 pr-2 text-right">{fmtNum(st.avgWaitMin, 1)}m</td>
                      <td className="py-2 text-right">{st.processedOps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Multi-Factor DES Experimentation Suite */}
          <Panel
            title="DES Multi-Factor Experimentation Matrix (Buffers, Machines, Volume, Reliability)"
            subtitle="Controlled counterfactual DES runs evaluating buffer capacities, parallel bottleneck machines, volume stress, and PM/MTBF changes"
            actions={
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const pts = runDesExperimentSuite(desConfig, {
                    bufferCaps: [1, 2, 4, 8, 16],
                    volumeMultipliers: [0.75, 1.25, 1.5],
                  });
                  setDesExperiments(pts);
                  pushToast({ type: 'success', message: `Executed ${pts.length} DES experiments.` });
                }}
              >
                <Sliders className="h-3.5 w-3.5" /> Run DES Experiment Suite
              </Button>
            }
          >
            {desExperiments.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Click <strong>Run DES Experiment Suite</strong> to sweep intermediate buffer capacities (1–16), parallel bottleneck
                machines, demand volume multipliers, and breakdown/PM scenarios with exact Seed #{desResult.seed}.
              </div>
            ) : (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                      <th className="pb-2 pr-3 font-medium">Experiment</th>
                      <th className="pb-2 pr-2 font-medium">Factor</th>
                      <th className="pb-2 pr-2 font-medium text-right">Throughput / hr</th>
                      <th className="pb-2 pr-2 font-medium text-right">Δ %</th>
                      <th className="pb-2 pr-2 font-medium text-right">Cycle Time</th>
                      <th className="pb-2 pr-2 font-medium text-right">Lead Time</th>
                      <th className="pb-2 pr-2 font-medium text-right">OEE %</th>
                      <th className="pb-2 pr-2 font-medium text-right">Asset Util %</th>
                      <th className="pb-2 font-medium">Bottleneck</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
                    {desExperiments.map((pt) => (
                      <tr key={pt.id}>
                        <td className="py-2 pr-3 font-sans font-medium text-slate-900 dark:text-slate-100">{pt.label}</td>
                        <td className="py-2 pr-2 uppercase text-[10px] text-slate-500">{pt.category}</td>
                        <td className="py-2 pr-2 text-right">{fmtNum(pt.throughputPerHour, 2)}</td>
                        <td
                          className={`py-2 pr-2 text-right font-semibold ${
                            pt.throughputDeltaPct > 0.5
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : pt.throughputDeltaPct < -0.5
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-slate-500'
                          }`}
                        >
                          {pt.throughputDeltaPct >= 0 ? '+' : ''}
                          {fmtNum(pt.throughputDeltaPct, 1)}%
                        </td>
                        <td className="py-2 pr-2 text-right">{fmtNum(pt.avgCycleTimeMin, 1)}m</td>
                        <td className="py-2 pr-2 text-right">{fmtNum(pt.avgLeadTimeMin, 1)}m</td>
                        <td className="py-2 pr-2 text-right">{fmtNum(pt.oeePct, 1)}%</td>
                        <td className="py-2 pr-2 text-right">{fmtNum(pt.assetUtilizationPct, 1)}%</td>
                        <td className="py-2 font-sans text-slate-600 dark:text-slate-300">{pt.bottleneckName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* TAB 2: MATERIAL FLOW & BOM */}
      {activeTab === 'materials' && (
        <div className="space-y-4">
          <Panel
            title={`BOM Material Flow & Warehouse Replenishment (${config.assemblySku})`}
            subtitle="Interactive BOM stock, ROP triggers, supplier lead-time delays, and line starvation hours"
            actions={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={handleSyncBom}>
                  Re-sync Live Catalog Stock
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onNavigate('production')}>
                  Open MRP
                </Button>
              </div>
            }
          >
            {!config.materials.length ? (
              <EmptyState
                title="No BOM components linked"
                message="Select a manufactured assembly with a Bill of Materials above, or configure BOM lines in Production & MRP."
              />
            ) : (
              <div className="space-y-4">
                {result.materialBottleneckSku && (
                  <div
                    role="alert"
                    className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50/80 dark:bg-rose-950/30 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3"
                  >
                    <span>
                      Material starvation active on <strong>{result.materialBottleneckSku}</strong> — Station 1 stalled{' '}
                      <strong>{fmtNum(result.materialStarvedHours, 1)} hrs</strong> waiting for supplier receipts. Adjust
                      sandbox ROP/stock below or test raising buffers.
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => handleApplyLever('raise-rop')}>
                      Boost Sandbox ROP (+40%)
                    </Button>
                  </div>
                )}

                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                        <th className="pb-2 font-medium">SKU / Component</th>
                        <th className="pb-2 font-medium text-right">Qty / Job</th>
                        <th className="pb-2 font-medium text-right">Initial Stock</th>
                        <th className="pb-2 font-medium text-right">Sandbox ROP</th>
                        <th className="pb-2 font-medium text-right">Lead Time (d)</th>
                        <th className="pb-2 font-medium text-right">Consumed</th>
                        <th className="pb-2 font-medium text-right">POs Placed</th>
                        <th className="pb-2 font-medium text-right">Ending Stock</th>
                        <th className="pb-2 font-medium text-right">Starve Wait</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
                      {config.materials.map((mat, idx) => {
                        const res = result.materials[idx];
                        return (
                          <tr key={mat.sku}>
                            <td className="py-2 pr-3 font-sans">
                              <div className="font-medium text-slate-900 dark:text-slate-100">{mat.name}</div>
                              <div className="font-mono text-[11px] text-slate-500">{mat.sku}</div>
                            </td>
                            <td className="py-2 pr-3 text-right">{mat.qtyPerJob}</td>
                            <td className="py-2 pr-3 text-right w-24">
                              <Input
                                type="number"
                                min={0}
                                value={mat.initialStock}
                                aria-label={`${mat.sku} initial stock`}
                                className="text-right"
                                onChange={(e) => {
                                  const val = Math.max(0, Number(e.target.value) || 0);
                                  updateConfig((p) => ({
                                    ...p,
                                    materials: p.materials.map((m, i) => (i === idx ? { ...m, initialStock: val } : m)),
                                  }));
                                }}
                              />
                            </td>
                            <td className="py-2 pr-3 text-right w-24">
                              <Input
                                type="number"
                                min={0}
                                value={mat.rop}
                                aria-label={`${mat.sku} sandbox ROP`}
                                className="text-right"
                                onChange={(e) => {
                                  const val = Math.max(0, Number(e.target.value) || 0);
                                  updateConfig((p) => ({
                                    ...p,
                                    materials: p.materials.map((m, i) => (i === idx ? { ...m, rop: val } : m)),
                                  }));
                                }}
                              />
                            </td>
                            <td className="py-2 pr-3 text-right w-20">
                              <Input
                                type="number"
                                min={0.5}
                                step={0.5}
                                value={mat.leadTimeDays}
                                aria-label={`${mat.sku} lead time days`}
                                className="text-right"
                                onChange={(e) => {
                                  const val = Math.max(0.5, Number(e.target.value) || 1);
                                  updateConfig((p) => ({
                                    ...p,
                                    materials: p.materials.map((m, i) => (i === idx ? { ...m, leadTimeDays: val } : m)),
                                  }));
                                }}
                              />
                            </td>
                            <td className="py-2 pr-3 text-right">{res ? fmtNum(res.totalConsumed, 1) : '—'}</td>
                            <td className="py-2 pr-3 text-right">{res ? fmtNum(res.replenishmentOrders, 1) : '—'}</td>
                            <td
                              className={`py-2 pr-3 text-right font-semibold ${
                                res?.stockoutOccurred
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {res ? fmtNum(res.endingStock, 1) : '—'}
                            </td>
                            <td className="py-2 text-right text-slate-500">
                              {res && res.starvedMinutes > 0 ? `${fmtNum(res.starvedMinutes / 60, 1)}h` : '0h'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* TAB 3: MONTE CARLO, OEE & SENSITIVITY OPTIMIZATION */}
      {activeTab === 'montecarlo' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <Panel
              title="Unit Economics & Little's Law Verification"
              subtitle="Cost per good unit & steady-state conservation law (L = λ · W)"
              className="lg:col-span-6"
            >
              <BarChart
                horizontal
                labels={['Material BOM', 'Machine Overhead', 'Direct Labor', 'WIP Holding', 'Scrap & Missed Demand']}
                series={[
                  {
                    name: '$/good unit',
                    data: [
                      result.costBreakdown.material,
                      result.costBreakdown.machine,
                      result.costBreakdown.labor,
                      result.costBreakdown.wipHolding,
                      result.costBreakdown.scrapAndPenalty,
                    ],
                  },
                ]}
                formatValue={(v) => fmtMoney(v)}
              />

              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-3 gap-3 text-xs font-mono tabular-nums">
                <div>
                  <div className="text-[11px] text-slate-500">Simulated WIP (L)</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {fmtNum(result.avgWip.mean, 2)} jobs
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">λ · W Expected</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {fmtNum(result.littlesLawExpectedWip, 2)} jobs
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Conservation Gap</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {fmtNum(result.littlesLawGapPct, 1)}%
                  </div>
                </div>
              </div>
            </Panel>

            <Panel
              title="Station Capacity Utilization Breakdown"
              subtitle="Busy, Blocked, Breakdown & Preventive Maintenance shares"
              className="lg:col-span-6"
            >
              <BarChart
                labels={result.stations.map((s) => s.id)}
                height={230}
                series={[
                  { name: 'Busy %', data: result.stations.map((s) => Number(s.busyPct.toFixed(1))), color: '#10b981' },
                  { name: 'Blocked %', data: result.stations.map((s) => Number(s.blockedPct.toFixed(1))), color: '#f59e0b' },
                  { name: 'Down + PM %', data: result.stations.map((s) => Number((s.downPct + s.pmPct).toFixed(1))), color: '#ef4444' },
                ]}
                formatValue={(v) => `${fmtNum(v, 1)}%`}
              />
            </Panel>
          </div>

          {/* Sensitivity Sweep & Lever Optimization */}
          <Panel
            title="Automated Bottleneck & Sensitivity Sweep"
            subtitle="Runs deterministic counter-factual experiments against current configuration to rank highest-leverage improvements"
            actions={
              <Button size="sm" variant="primary" onClick={handleRunSweep}>
                <Sliders className="h-3.5 w-3.5" /> Run Sensitivity Sweep
              </Button>
            }
          >
            {sweepLevers.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Click <strong>Run Sensitivity Sweep</strong> to test parallel bottleneck capacity, buffer expansion,
                preventive maintenance, SMED variance reduction, and BOM ROP boosts against your active model.
              </div>
            ) : (
              <div className="space-y-3">
                {sweepSeedHash !== result.configHash && (
                  <div className="text-[11px] text-amber-600 dark:text-amber-400 font-mono">
                    Configuration changed since sweep ran — click Run Sensitivity Sweep to refresh comparisons.
                  </div>
                )}
                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                        <th className="pb-2 pr-3 font-medium">Engineering Intervention</th>
                        <th className="pb-2 pr-3 font-medium text-right">Throughput</th>
                        <th className="pb-2 pr-3 font-medium text-right">Throughput Δ</th>
                        <th className="pb-2 pr-3 font-medium text-right">Cycle Time Δ</th>
                        <th className="pb-2 pr-3 font-medium text-right">OEE</th>
                        <th className="pb-2 pr-3 font-medium text-right">$/Unit Δ</th>
                        <th className="pb-2 pr-3 font-medium">New Bottleneck</th>
                        <th className="pb-2 font-medium text-right">Apply</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
                      {sweepLevers.map((lv) => (
                        <tr key={lv.id}>
                          <td className="py-2.5 pr-3 font-sans font-medium text-slate-900 dark:text-slate-100">
                            {lv.label}
                          </td>
                          <td className="py-2.5 pr-3 text-right">{fmtNum(lv.throughputPerHour, 2)}/hr</td>
                          <td
                            className={`py-2.5 pr-3 text-right font-semibold ${
                              lv.throughputDeltaPct > 0.5
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-slate-500'
                            }`}
                          >
                            {lv.throughputDeltaPct >= 0 ? '+' : ''}
                            {fmtNum(lv.throughputDeltaPct, 1)}%
                          </td>
                          <td className="py-2.5 pr-3 text-right">
                            {lv.cycleTimeDeltaPct >= 0 ? '+' : ''}
                            {fmtNum(lv.cycleTimeDeltaPct, 1)}%
                          </td>
                          <td className="py-2.5 pr-3 text-right">{fmtNum(lv.oeePct, 1)}%</td>
                          <td
                            className={`py-2.5 pr-3 text-right ${
                              lv.costDeltaPerUnit < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {lv.costDeltaPerUnit >= 0 ? '+' : ''}
                            {fmtMoney(lv.costDeltaPerUnit)}
                          </td>
                          <td className="py-2.5 pr-3 font-sans text-slate-600 dark:text-slate-300">{lv.newBottleneck}</td>
                          <td className="py-2.5 text-right">
                            <Button size="sm" variant="secondary" onClick={() => handleApplyLever(lv.id)}>
                              Apply Lever
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* TAB 4: SCENARIO LAB & MULTI-SCENARIO COMPARISON */}
      {activeTab === 'scenarios' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <Panel
              title="Save Current Experiment Snapshot"
              subtitle="Persist named parameter configurations locally to compare trade-offs"
              className="lg:col-span-5"
            >
              <form onSubmit={handleSaveScenario} className="space-y-3">
                <Field label="Scenario name">
                  <Input
                    className="font-sans"
                    placeholder={`${config.assemblySku} +1 Mach at Bottleneck`}
                    value={scenarioName}
                    onChange={(e) => setScenarioName(e.target.value)}
                  />
                </Field>
                <Field label="Engineering notes (optional)">
                  <Input
                    className="font-sans"
                    placeholder="Tested PM interval 240m + 2 shifts"
                    value={scenarioNotes}
                    onChange={(e) => setScenarioNotes(e.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="submit" size="sm" variant="primary">
                    <Save className="h-3.5 w-3.5" /> Save Scenario
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => handleLoadQuickPreset('surge')}>
                    Stress Test (+35% Demand)
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => handleLoadQuickPreset('optimized')}>
                    Load U-Cell + PM Preset
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => handleLoadQuickPreset('reset')}>
                    Reset Baseline
                  </Button>
                </div>
              </form>
            </Panel>

            <Panel
              title="Scenario Throughput & OEE Comparison"
              subtitle="Side-by-side performance across active & saved factory runs"
              className="lg:col-span-7"
            >
              <BarChart
                labels={scenarioComparison.map((r) => r.name.slice(0, 18))}
                height={200}
                series={[
                  { name: 'Throughput (jobs/hr)', data: scenarioComparison.map((r) => Number(r.res.throughputPerHour.mean.toFixed(2))), color: '#2563eb' },
                  { name: 'OEE %', data: scenarioComparison.map((r) => Number(r.res.oeePct.toFixed(1))), color: '#10b981' },
                ]}
              />
            </Panel>
          </div>

          <Panel
            title="Saved Scenarios Matrix"
            subtitle="Click Load to restore any persisted experiment into the Virtual Factory floor"
          >
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500">
                    <th className="pb-2 font-medium">Scenario</th>
                    <th className="pb-2 font-medium">Seed / Hash</th>
                    <th className="pb-2 font-medium text-right">Throughput</th>
                    <th className="pb-2 font-medium text-right">Cycle Time</th>
                    <th className="pb-2 font-medium text-right">OEE</th>
                    <th className="pb-2 font-medium text-right">$/Good Unit</th>
                    <th className="pb-2 font-medium">Bottleneck</th>
                    <th className="pb-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
                  {scenarioComparison.map((row) => (
                    <tr key={row.id} className={row.isActive ? 'bg-[var(--accent-soft)]' : ''}>
                      <td className="py-2.5 pr-3 font-sans font-medium text-slate-900 dark:text-slate-100">
                        {row.name}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-500">
                        #{row.res.seed} · {row.res.configHash}
                      </td>
                      <td className="py-2.5 pr-3 text-right">{fmtNum(row.res.throughputPerHour.mean, 2)}/hr</td>
                      <td className="py-2.5 pr-3 text-right">{fmtNum(row.res.cycleTimeMin.mean, 1)}m</td>
                      <td className="py-2.5 pr-3 text-right">{fmtNum(row.res.oeePct, 1)}%</td>
                      <td className="py-2.5 pr-3 text-right">{fmtMoney(row.res.costPerGoodUnit)}</td>
                      <td className="py-2.5 pr-3 font-sans text-slate-600 dark:text-slate-300">
                        {row.res.bottleneckName}
                      </td>
                      <td className="py-2.5 text-right">
                        {row.isActive ? (
                          <span className="text-[11px] font-sans font-medium text-[var(--accent)]">Active</span>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setFactorySimConfig(row.config);
                                pushToast({ type: 'info', message: `Loaded scenario "${row.name}".` });
                              }}
                            >
                              Load
                            </Button>
                            <button
                              type="button"
                              aria-label={`Delete scenario ${row.name}`}
                              onClick={() => deleteFactoryScenario(row.id)}
                              className="p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      <AssumptionPanel topicId="factory-sim" />
    </div>
  );
};
