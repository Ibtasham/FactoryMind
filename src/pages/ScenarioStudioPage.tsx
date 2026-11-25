import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FlaskConical,
  Layers,
  Play,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Sliders,
  Trash2,
  Upload,
} from 'lucide-react';
import { BarChart } from '../components/charts/Charts';
import { RouteId } from '../components/layout/AppShell';
import {
  AssumptionPanel,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Panel,
  SegmentedControl,
  Select,
  StatCard,
  downloadFile,
} from '../components/ui/Primitives';
import { fmtInt, fmtMoney, fmtNum } from '../engine/formatters';
import {
  buildBaselineScenarioFromWorkspace,
  buildPresetScenarioDefinitions,
  buildWorkspaceApplyPreview,
  compareScenarioToBaseline,
  evaluateScenario,
  exportScenarioPackageJSON,
  importScenarioPackageJSON,
  runScenarioSensitivity,
  sanitizeScenarioParams,
  ScenarioDefinition,
  ScenarioParams,
  ScenarioReorderPolicy,
  ScenarioSensitivityRow,
  ScenarioWorkspaceInput,
} from '../engine/scenarioStudio';
import { useStore } from '../store/StoreContext';

type StudioViewTab = 'compare' | 'explain' | 'sensitivity' | 'pipeline';
type ConfigGroupTab = 'demand-inv' | 'prod-rel' | 'work-des';

export const ScenarioStudioPage: React.FC<{
  onNavigate?: (r: RouteId) => void;
}> = ({ onNavigate }) => {
  const {
    products,
    lineBalance,
    factorySimConfig,
    scenarioStudioRecords,
    saveScenarioStudioRecord,
    deleteScenarioStudioRecord,
    importScenarioStudioRecords,
    applyScenarioToWorkspace,
    pushToast,
  } = useStore();

  const wsInput: ScenarioWorkspaceInput = useMemo(
    () => ({
      products,
      lineBalance,
      factorySimConfig,
    }),
    [products, lineBalance, factorySimConfig]
  );

  const baselineDef = useMemo(() => buildBaselineScenarioFromWorkspace(wsInput), [wsInput]);
  const presets = useMemo(() => buildPresetScenarioDefinitions(wsInput), [wsInput]);

  const [draftName, setDraftName] = useState<string>(() => presets[0]?.name || 'Alternative Strategy A');
  const [draftNotes, setDraftNotes] = useState<string>(() => presets[0]?.notes || '');
  const [draftParams, setDraftParams] = useState<ScenarioParams>(() => presets[0]?.params ?? baselineDef.params);
  const [selectedId, setSelectedId] = useState<string>(() => presets[0]?.id || 'custom-draft');
  const [configTab, setConfigTab] = useState<ConfigGroupTab>('demand-inv');
  const [viewTab, setViewTab] = useState<StudioViewTab>('compare');
  const [sensitivityRows, setSensitivityRows] = useState<ScenarioSensitivityRow[]>([]);
  const [sensitivityStamp, setSensitivityStamp] = useState<string>('');
  const [applyModalOpen, setApplyModalOpen] = useState<boolean>(false);
  const [pendingDeleteScenario, setPendingDeleteScenario] = useState<{ id: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const assemblyOptions = useMemo(() => {
    const withBom = products.filter((p) => p.bom && p.bom.length > 0);
    return withBom.length ? withBom : products.slice(0, 5);
  }, [products]);

  // Keep draft assembly SKU valid if user alters product catalog
  useEffect(() => {
    if (!products.length) return;
    const exists = products.some((p) => p.sku.toUpperCase() === draftParams.assemblySku.toUpperCase());
    if (!exists) {
      setDraftParams((prev) => ({ ...prev, assemblySku: factorySimConfig.assemblySku || products[0].sku }));
    }
  }, [products, draftParams.assemblySku, factorySimConfig.assemblySku]);

  const activeScenarioDef: ScenarioDefinition = useMemo(
    () => ({
      id: selectedId || 'custom-draft',
      name: draftName.trim() || 'Active Scenario Draft',
      notes: draftNotes.trim(),
      createdAt: Date.now(),
      isBaseline: false,
      params: sanitizeScenarioParams(draftParams, factorySimConfig.assemblySku),
    }),
    [selectedId, draftName, draftNotes, draftParams, factorySimConfig.assemblySku]
  );

  const baselineEval = useMemo(() => evaluateScenario(baselineDef, wsInput), [baselineDef, wsInput]);
  const scenarioEval = useMemo(() => evaluateScenario(activeScenarioDef, wsInput), [activeScenarioDef, wsInput]);
  const comparison = useMemo(
    () => compareScenarioToBaseline(baselineEval, scenarioEval),
    [baselineEval, scenarioEval]
  );

  const shortLabel = (txt: string, maxLen = 14) => {
    const clean = txt.trim();
    if (clean.length <= maxLen) return clean;
    const words = clean.split(/\s+/);
    let out = '';
    for (const w of words) {
      const next = out ? `${out} ${w}` : w;
      if (next.length > maxLen) break;
      out = next;
    }
    return out || clean.slice(0, maxLen - 1) + '…';
  };

  // Evaluate up to 3 saved scenarios + active draft for multi-scenario benchmarking chart
  const multiScenarioBench = useMemo(() => {
    const pool = scenarioStudioRecords.length ? scenarioStudioRecords.slice(0, 3) : presets.slice(0, 3);
    const items = [
      { label: 'Baseline', ev: baselineEval },
      { label: shortLabel(activeScenarioDef.name, 14), ev: scenarioEval },
      ...pool
        .filter((s) => s.id !== activeScenarioDef.id)
        .slice(0, 2)
        .map((s) => ({ label: shortLabel(s.name, 14), ev: evaluateScenario(s, wsInput) })),
    ];
    return items;
  }, [baselineEval, scenarioEval, activeScenarioDef, scenarioStudioRecords, presets, wsInput]);

  const applyPreview = useMemo(
    () => buildWorkspaceApplyPreview(activeScenarioDef, wsInput),
    [activeScenarioDef, wsInput]
  );

  const patchParam = <K extends keyof ScenarioParams>(key: K, value: ScenarioParams[K]) => {
    setDraftParams((prev) => ({ ...prev, [key]: value }));
  };

  const loadScenarioDef = (sc: ScenarioDefinition) => {
    setSelectedId(sc.id);
    setDraftName(sc.name);
    setDraftNotes(sc.notes);
    setDraftParams({ ...sc.params });
    setSensitivityRows([]);
  };

  const handleResetToBaseline = () => {
    setSelectedId('custom-draft');
    setDraftName('Baseline Clone');
    setDraftNotes('Reset to mirror live workspace baseline before adjustments.');
    setDraftParams({ ...baselineDef.params });
    setSensitivityRows([]);
  };

  const handleSaveToVault = () => {
    const cleanName = draftName.trim() || `Scenario ${scenarioStudioRecords.length + 1}`;
    const idToSave =
      selectedId.startsWith('preset-') || selectedId === 'custom-draft' || selectedId === 'baseline-live'
        ? `scst-${Date.now().toString(36)}`
        : selectedId;
    const saved = saveScenarioStudioRecord({
      id: idToSave,
      name: cleanName,
      notes: draftNotes.trim(),
      params: activeScenarioDef.params,
    });
    setSelectedId(saved.id);
    pushToast({ type: 'success', message: `Saved scenario "${saved.name}" to Vault (live workspace untouched).` });
  };

  const handleRunSensitivity = () => {
    const rows = runScenarioSensitivity(activeScenarioDef, wsInput);
    setSensitivityRows(rows);
    setSensitivityStamp(`${activeScenarioDef.name} · Seed #${activeScenarioDef.params.seed}`);
    setViewTab('sensitivity');
    pushToast({ type: 'info', message: `Computed ${rows.length} cross-module sensitivity levers.` });
  };

  const handleExportJSON = () => {
    const pkgList = [
      activeScenarioDef,
      ...scenarioStudioRecords.filter((s) => s.id !== activeScenarioDef.id),
    ];
    const json = exportScenarioPackageJSON(pkgList);
    downloadFile(
      `factorymind-scenarios-${activeScenarioDef.params.assemblySku.toLowerCase()}.json`,
      json,
      'application/json;charset=utf-8'
    );
    pushToast({ type: 'success', message: `Exported ${pkgList.length} scenario(s) as JSON.` });
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = importScenarioPackageJSON(String(reader.result || ''), factorySimConfig.assemblySku);
        if (!imported.length) {
          pushToast({ type: 'warn', message: 'Scenario JSON contained 0 valid scenarios.' });
          return;
        }
        const count = importScenarioStudioRecords(imported);
        loadScenarioDef(imported[0]);
        pushToast({ type: 'success', message: `Imported ${count} scenario(s) into Scenario Vault.` });
      } catch (err) {
        pushToast({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to parse scenario JSON.',
        });
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmApply = () => {
    applyScenarioToWorkspace(activeScenarioDef);
    setApplyModalOpen(false);
    pushToast({
      type: 'success',
      message: `Applied "${activeScenarioDef.name}" parameters to live Factory Sim, Line Balance & BOM policy.`,
    });
  };

  if (!products.length) {
    return (
      <EmptyState
        title="No workspace products available"
        message="Add products and BOM assemblies in Inventory & Production before running integrated scenario simulations."
        action={
          onNavigate ? (
            <Button variant="primary" onClick={() => onNavigate('inventory')}>
              Go to Inventory
            </Button>
          ) : undefined
        }
      />
    );
  }

  const tpDelta = comparison.deltas.find((d) => d.key === 'throughputPerHour');
  const oeeDelta = comparison.deltas.find((d) => d.key === 'oeePct');
  const invDelta = comparison.deltas.find((d) => d.key === 'totalInventoryCostAnnual');
  const riskDelta = comparison.deltas.find((d) => d.key === 'shortageRiskPct');
  const costDelta = comparison.deltas.find((d) => d.key === 'operatingCostPerUnit');

  const formatDelta = (val: number | undefined, unit: string, dp = 1) => {
    if (val == null || !Number.isFinite(val)) return '0';
    return `${val >= 0 ? '+' : ''}${val.toFixed(dp)} ${unit}`;
  };

  const formatMoneyDelta = (val: number | undefined) => {
    if (val == null || !Number.isFinite(val)) return '$0.00';
    return `${val >= 0 ? '+$' : '-$'}${Math.abs(val).toFixed(2)}`;
  };

  return (
    <div className="space-y-5">
      {/* Safety Provenance Banner */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <FlaskConical className="h-4 w-4 text-[var(--accent)] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Simulated Scenario Model — Live Production Data Unchanged
              </span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Forecast → EOQ/ROP → MRP → Line Balance → DES
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {scenarioEval.provenanceNotice}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportFile}
            className="hidden"
          />
          <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            Import JSON
          </Button>
          <Button size="sm" variant="secondary" onClick={handleExportJSON}>
            <Download className="h-3.5 w-3.5" />
            Export JSON
          </Button>
          <Button size="sm" variant="primary" onClick={() => setApplyModalOpen(true)}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Apply to Working Config
          </Button>
        </div>
      </div>

      {/* KPI Comparison Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard
          label="Throughput"
          value={`${fmtNum(scenarioEval.kpis.throughputPerHour, 2)} /hr`}
          sub={`vs ${fmtNum(baselineEval.kpis.throughputPerHour, 2)} (${formatDelta(tpDelta?.delta, 'j/h', 2)})`}
          tone={tpDelta?.status === 'improved' ? 'good' : tpDelta?.status === 'deteriorated' ? 'bad' : 'neutral'}
        />
        <StatCard
          label="Line OEE"
          value={`${fmtNum(scenarioEval.kpis.oeePct, 1)}%`}
          sub={`vs ${fmtNum(baselineEval.kpis.oeePct, 1)}% (${formatDelta(oeeDelta?.delta, 'pts', 1)})`}
          tone={oeeDelta?.status === 'improved' ? 'good' : oeeDelta?.status === 'deteriorated' ? 'bad' : 'neutral'}
        />
        <StatCard
          label="Inventory Policy"
          value={fmtMoney(scenarioEval.kpis.totalInventoryCostAnnual, 0)}
          sub={`vs ${fmtMoney(baselineEval.kpis.totalInventoryCostAnnual, 0)}/yr`}
          tone={invDelta?.status === 'improved' ? 'good' : invDelta?.status === 'deteriorated' ? 'warn' : 'neutral'}
        />
        <StatCard
          label="Shortage Risk"
          value={`${fmtNum(scenarioEval.kpis.shortageRiskPct, 1)}%`}
          sub={`SL ${fmtNum(scenarioEval.kpis.serviceLevelPct, 1)}% (${formatDelta(riskDelta?.delta, 'pts', 1)})`}
          tone={riskDelta?.status === 'improved' ? 'good' : riskDelta?.status === 'deteriorated' ? 'bad' : 'neutral'}
        />
        <StatCard
          label="Unit Op. Cost"
          value={fmtMoney(scenarioEval.kpis.operatingCostPerUnit, 2)}
          sub={`vs ${fmtMoney(baselineEval.kpis.operatingCostPerUnit, 2)} (${formatMoneyDelta(costDelta?.delta)})`}
          tone={costDelta?.status === 'improved' ? 'good' : costDelta?.status === 'deteriorated' ? 'bad' : 'neutral'}
        />
        <StatCard
          label="Model Confidence"
          value={`${scenarioEval.confidence.scorePct}/100`}
          sub={`${scenarioEval.confidence.level} · CI ±${scenarioEval.confidence.throughputCiHalfPct}%`}
          tone={
            scenarioEval.confidence.level === 'High'
              ? 'good'
              : scenarioEval.confidence.level === 'Moderate'
                ? 'warn'
                : 'bad'
          }
        />
      </div>

      {/* Main Split: Left Config + Presets & Vault | Right Comparison + Explainability + Sensitivity */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Left Column (4 cols): Presets, Saved Vault & 13-Parameter Configurator */}
        <div className="xl:col-span-4 space-y-4">
          <Panel
            title="Strategy Presets & Saved Vault"
            subtitle="Load counterfactuals without altering live workspace"
            actions={
              <Button size="sm" variant="ghost" onClick={handleResetToBaseline}>
                <RotateCcw className="h-3.5 w-3.5" />
                Mirror Baseline
              </Button>
            }
          >
            <div className="space-y-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Engineering Presets
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-1.5">
                  {presets.map((pr) => {
                    const active = selectedId === pr.id;
                    return (
                      <button
                        key={pr.id}
                        type="button"
                        onClick={() => loadScenarioDef(pr)}
                        className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                          active
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-slate-900 dark:text-white'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <div className="font-semibold truncate">{pr.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                          {pr.notes}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Saved Scenarios ({scenarioStudioRecords.length})
                  </span>
                </div>
                {scenarioStudioRecords.length ? (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {scenarioStudioRecords.map((rec) => {
                      const active = selectedId === rec.id;
                      return (
                        <div
                          key={rec.id}
                          className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border text-xs ${
                            active
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                              : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => loadScenarioDef(rec)}
                            className="flex-1 text-left min-w-0 cursor-pointer"
                          >
                            <div className="font-medium truncate text-slate-900 dark:text-slate-100">{rec.name}</div>
                            <div className="text-[10px] font-mono text-slate-500 truncate">
                              {rec.params.assemblySku} · Dem ×{rec.params.demandVolumeMult} · SS ×{rec.params.safetyStockMult} · +{rec.params.extraBottleneckMachines} bn
                            </div>
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete scenario ${rec.name}`}
                            onClick={() => setPendingDeleteScenario({ id: rec.id, name: rec.name })}
                            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 py-1">
                    No custom scenarios saved yet. Adjust parameters below and click Save to Vault.
                  </p>
                )}
                <ConfirmDialog
                  open={pendingDeleteScenario !== null}
                  onClose={() => setPendingDeleteScenario(null)}
                  onConfirm={() => {
                    if (pendingDeleteScenario) {
                      deleteScenarioStudioRecord(pendingDeleteScenario.id);
                      if (selectedId === pendingDeleteScenario.id) setSelectedId('custom-draft');
                      pushToast({ type: 'info', message: `Deleted scenario "${pendingDeleteScenario.name}".` });
                    }
                  }}
                  title={pendingDeleteScenario ? `Delete "${pendingDeleteScenario.name}"?` : 'Delete scenario?'}
                  message={
                    pendingDeleteScenario
                      ? `Permanently delete "${pendingDeleteScenario.name}" from your Scenario Studio Vault?`
                      : ''
                  }
                  confirmLabel="Delete scenario"
                  danger
                />
              </div>
            </div>
          </Panel>

          <Panel
            title="Scenario Parameter Workbench"
            subtitle="All 13 operational & supply-chain levers"
            actions={
              <Button size="sm" variant="primary" onClick={handleSaveToVault}>
                <Save className="h-3.5 w-3.5" />
                Save to Vault
              </Button>
            }
          >
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 gap-2.5">
                <Field label="Scenario Name">
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="e.g., Peak Surge + Resilience"
                  />
                </Field>
                <Field label="Strategy Notes">
                  <Input
                    value={draftNotes}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    placeholder="Operational hypothesis & rationale"
                  />
                </Field>
              </div>

              <SegmentedControl
                value={configTab}
                onChange={(v) => setConfigTab(v as ConfigGroupTab)}
                options={[
                  { value: 'demand-inv', label: 'Demand & Inventory' },
                  { value: 'prod-rel', label: 'Production & Scrap' },
                  { value: 'work-des', label: 'Workforce & DES' },
                ]}
              />

              {configTab === 'demand-inv' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="sm:col-span-2">
                    <Field label="Target Assembly / Product">
                      <Select
                        value={draftParams.assemblySku}
                        onChange={(e) => patchParam('assemblySku', e.target.value)}
                      >
                        {assemblyOptions.map((p) => (
                          <option key={p.id} value={p.sku}>
                            {p.sku} — {p.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Field label="Demand Vol ×" hint="0.3 – 3.0">
                    <Input
                      type="number"
                      step={0.05}
                      min={0.3}
                      max={3}
                      value={draftParams.demandVolumeMult}
                      onChange={(e) => patchParam('demandVolumeMult', Number(e.target.value) || 1)}
                    />
                  </Field>
                  <Field label="Demand Var ×" hint="0.2 – 3.0">
                    <Input
                      type="number"
                      step={0.05}
                      min={0.2}
                      max={3}
                      value={draftParams.demandVariabilityMult}
                      onChange={(e) => patchParam('demandVariabilityMult', Number(e.target.value) || 1)}
                    />
                  </Field>
                  <Field label="Supplier LT ×" hint="0.25 – 3.5">
                    <Input
                      type="number"
                      step={0.05}
                      min={0.25}
                      max={3.5}
                      value={draftParams.supplierLeadTimeMult}
                      onChange={(e) => patchParam('supplierLeadTimeMult', Number(e.target.value) || 1)}
                    />
                  </Field>
                  <Field label="Safety Stock ×" hint="0.25 – 3.5">
                    <Input
                      type="number"
                      step={0.05}
                      min={0.25}
                      max={3.5}
                      value={draftParams.safetyStockMult}
                      onChange={(e) => patchParam('safetyStockMult', Number(e.target.value) || 1)}
                    />
                  </Field>
                  <Field label="Reorder Policy">
                    <Select
                      value={draftParams.reorderPolicy}
                      onChange={(e) => patchParam('reorderPolicy', e.target.value as ScenarioReorderPolicy)}
                    >
                      <option value="eoq-rop">EOQ + ROP</option>
                      <option value="service-target">Service-Target ROP</option>
                      <option value="poq">Periodic Order Qty (POQ)</option>
                      <option value="l4l">Lot-for-Lot (L4L)</option>
                    </Select>
                  </Field>
                  <Field label="Target SL %" hint="80 – 99.5%">
                    <Input
                      type="number"
                      step={0.5}
                      min={80}
                      max={99.5}
                      value={draftParams.targetServiceLevelPct}
                      onChange={(e) => patchParam('targetServiceLevelPct', Number(e.target.value) || 95)}
                    />
                  </Field>
                </div>
              )}

              {configTab === 'prod-rel' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Field label="Batch Qty" hint="2 – 1000">
                    <Input
                      type="number"
                      step={1}
                      min={2}
                      max={1000}
                      value={draftParams.productionBatchQty}
                      onChange={(e) => patchParam('productionBatchQty', Number(e.target.value) || 24)}
                    />
                  </Field>
                  <Field label="Machine Cycle ×" hint="0.4 – 2.5">
                    <Input
                      type="number"
                      step={0.05}
                      min={0.4}
                      max={2.5}
                      value={draftParams.machineCycleMult}
                      onChange={(e) => patchParam('machineCycleMult', Number(e.target.value) || 1)}
                    />
                  </Field>
                  <Field label="Breakdown Freq ×" hint="0.1 – 4.0">
                    <Input
                      type="number"
                      step={0.1}
                      min={0.1}
                      max={4}
                      value={draftParams.breakdownFreqMult}
                      onChange={(e) => patchParam('breakdownFreqMult', Number(e.target.value) || 1)}
                    />
                  </Field>
                  <Field label="+ BN Machines" hint="0 – 4">
                    <Input
                      type="number"
                      step={1}
                      min={0}
                      max={4}
                      value={draftParams.extraBottleneckMachines}
                      onChange={(e) => patchParam('extraBottleneckMachines', Number(e.target.value) || 0)}
                    />
                  </Field>
                  <Field label="Scrap Rate %" hint="0 – 35%">
                    <Input
                      type="number"
                      step={0.2}
                      min={0}
                      max={35}
                      value={draftParams.scrapRatePct}
                      onChange={(e) => patchParam('scrapRatePct', Number(e.target.value) || 0)}
                    />
                  </Field>
                  <Field label="Buffer Cap." hint="1 – 40 jobs">
                    <Input
                      type="number"
                      step={1}
                      min={1}
                      max={40}
                      value={draftParams.bufferCapacity}
                      onChange={(e) => patchParam('bufferCapacity', Number(e.target.value) || 6)}
                    />
                  </Field>
                </div>
              )}

              {configTab === 'work-des' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Field label="Operators Avail." hint="1 – 80">
                    <Input
                      type="number"
                      step={1}
                      min={1}
                      max={80}
                      value={draftParams.operatorsAvailable}
                      onChange={(e) => patchParam('operatorsAvailable', Number(e.target.value) || 1)}
                    />
                  </Field>
                  <Field label="Shift Hrs" hint="4 – 12h">
                    <Input
                      type="number"
                      step={0.5}
                      min={4}
                      max={12}
                      value={draftParams.shiftHours}
                      onChange={(e) => patchParam('shiftHours', Number(e.target.value) || 8)}
                    />
                  </Field>
                  <Field label="Shifts / Day" hint="1 – 3">
                    <Input
                      type="number"
                      step={1}
                      min={1}
                      max={3}
                      value={draftParams.shiftsPerDay}
                      onChange={(e) => patchParam('shiftsPerDay', Number(e.target.value) || 2)}
                    />
                  </Field>
                  <Field label="Horizon (hrs)" hint="8 – 168h">
                    <Input
                      type="number"
                      step={4}
                      min={8}
                      max={168}
                      value={draftParams.horizonHours}
                      onChange={(e) => patchParam('horizonHours', Number(e.target.value) || 24)}
                    />
                  </Field>
                  <Field label="Replications" hint="1 – 25">
                    <Input
                      type="number"
                      step={1}
                      min={1}
                      max={25}
                      value={draftParams.replications}
                      onChange={(e) => patchParam('replications', Number(e.target.value) || 6)}
                    />
                  </Field>
                  <Field label="PRNG Seed">
                    <Input
                      type="number"
                      step={1}
                      min={1}
                      value={draftParams.seed}
                      onChange={(e) => patchParam('seed', Number(e.target.value) || 2026)}
                    />
                  </Field>
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={handleRunSensitivity}>
                  <Sliders className="h-3.5 w-3.5" />
                  Sensitivity Matrix
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSelectedId(`scst-${Date.now().toString(36)}`);
                    setDraftName(`${draftName.replace(/\s*\(Copy\)$/i, '')} (Copy)`);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Duplicate
                </Button>
              </div>
            </div>
          </Panel>
        </div>

        {/* Right Column (8 cols): Views */}
        <div className="xl:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              value={viewTab}
              onChange={(v) => setViewTab(v as StudioViewTab)}
              options={[
                { value: 'compare', label: 'Baseline vs Scenario' },
                { value: 'explain', label: 'Explainability & Confidence' },
                { value: 'sensitivity', label: 'Sensitivity Analysis' },
                { value: 'pipeline', label: 'Integrated Pipeline' },
              ]}
            />
            <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
              Pacing Bottleneck: <span className="text-slate-800 dark:text-slate-200 font-semibold">{scenarioEval.desResult.bottleneckName}</span> ({fmtNum(scenarioEval.desResult.bottleneckWorkloadPct, 1)}%)
            </div>
          </div>

          {viewTab === 'compare' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Panel
                  title="Operational & Risk Profile (%)"
                  subtitle={`Baseline vs ${activeScenarioDef.name}`}
                >
                  <BarChart
                    labels={['Service Lvl', 'OEE', 'Mach Util', 'Completion', 'Shortage Risk', 'Downtime']}
                    series={[
                      {
                        name: 'Baseline',
                        data: [
                          baselineEval.kpis.serviceLevelPct,
                          baselineEval.kpis.oeePct,
                          baselineEval.kpis.machineUtilizationPct,
                          baselineEval.kpis.productionCompletionPct,
                          baselineEval.kpis.shortageRiskPct,
                          baselineEval.kpis.downtimePct,
                        ],
                        color: '#64748b',
                      },
                      {
                        name: shortLabel(activeScenarioDef.name, 20),
                        data: [
                          scenarioEval.kpis.serviceLevelPct,
                          scenarioEval.kpis.oeePct,
                          scenarioEval.kpis.machineUtilizationPct,
                          scenarioEval.kpis.productionCompletionPct,
                          scenarioEval.kpis.shortageRiskPct,
                          scenarioEval.kpis.downtimePct,
                        ],
                        color: '#3b82f6',
                      },
                    ]}
                    formatValue={(v) => `${v.toFixed(1)}%`}
                    height={215}
                  />
                </Panel>

                <Panel
                  title="Multi-Scenario Benchmark (Throughput vs Cycle Time)"
                  subtitle="Side-by-side comparison across Baseline & alternative strategies"
                >
                  <BarChart
                    labels={multiScenarioBench.map((b) => b.label)}
                    series={[
                      {
                        name: 'Throughput (jobs/hr)',
                        data: multiScenarioBench.map((b) => b.ev.kpis.throughputPerHour),
                        color: '#10b981',
                      },
                      {
                        name: 'Cycle Time / 10 (min)',
                        data: multiScenarioBench.map((b) => Number((b.ev.kpis.avgCycleTimeMin / 10).toFixed(2))),
                        color: '#f59e0b',
                      },
                    ]}
                    formatValue={(v) => v.toFixed(2)}
                    height={215}
                  />
                </Panel>
              </div>

              <Panel
                title="12-KPI Baseline vs. Scenario Delta Matrix"
                subtitle={`${comparison.explanation.recommendationHeadline}`}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        <th className="py-2 pr-3">Metric</th>
                        <th className="py-2 px-3 text-right">Baseline</th>
                        <th className="py-2 px-3 text-right">Scenario</th>
                        <th className="py-2 px-3 text-right">Δ Change</th>
                        <th className="py-2 px-3 text-right">Δ %</th>
                        <th className="py-2 pl-3 text-right">Assessment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {comparison.deltas.map((d) => {
                        const fmtVal = (v: number) =>
                          d.unit.includes('$') ? fmtMoney(v, v >= 1000 ? 0 : 2) : `${fmtNum(v, d.key === 'avgCycleTimeMin' || d.key === 'throughputPerHour' ? 2 : 1)} ${d.unit}`;
                        const badgeCls =
                          d.status === 'improved'
                            ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                            : d.status === 'deteriorated'
                              ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10'
                              : 'text-slate-500 bg-slate-100 dark:bg-slate-800';
                        return (
                          <tr key={d.key} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                            <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-200">
                              {d.label}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              {fmtVal(d.baseline)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                              {fmtVal(d.scenario)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">
                              {d.delta >= 0 ? '+' : ''}
                              {fmtNum(d.delta, d.key === 'totalInventoryCostAnnual' ? 0 : 2)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">
                              {d.deltaPct >= 0 ? '+' : ''}
                              {d.deltaPct.toFixed(1)}%
                            </td>
                            <td className="py-2 pl-3 text-right">
                              <span className={`inline-block px-2 py-0.5 rounded font-mono text-[10px] font-semibold uppercase ${badgeCls}`}>
                                {d.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          )}

          {viewTab === 'explain' && (
            <div className="space-y-4">
              <Panel
                title="Recommendation & Confidence Assessment"
                subtitle={comparison.explanation.confidenceStatement}
              >
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 space-y-2">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {comparison.explanation.recommendationHeadline}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs">
                    <div>
                      <span className="text-slate-400 block">Confidence Score</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {scenarioEval.confidence.scorePct}/100 ({scenarioEval.confidence.level})
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">DES 95% CI Precision</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        ±{scenarioEval.confidence.throughputCiHalfPct}% ({scenarioEval.params.replications} reps)
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Forecast Backtest Fit</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {scenarioEval.confidence.forecastFitPct}% (MAPE {scenarioEval.forecastSummary.backtestMapePct ?? 'N/A'}%)
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">OEE Decomposition</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        A {fmtNum(scenarioEval.kpis.oeeAvailabilityPct, 0)}% · P {fmtNum(scenarioEval.kpis.oeePerformancePct, 0)}% · Q {fmtNum(scenarioEval.kpis.oeeQualityPct, 0)}%
                      </span>
                    </div>
                  </div>
                </div>
              </Panel>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Panel title="What Changed vs. Baseline" subtitle="Modified operational parameters">
                  <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                    {comparison.explanation.whatChanged.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <ArrowRight className="h-3.5 w-3.5 text-[var(--accent)] mt-0.5 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <Panel title="Models Executed" subtitle="Validated FactoryMind calculation chain">
                  <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                    {comparison.explanation.modelsUsed.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Layers className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <Panel title="What Improved" subtitle="Ranked positive operational gains">
                  <ul className="space-y-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                    {comparison.explanation.whatImproved.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <Panel title="What Deteriorated" subtitle="Ranked cost, risk, or flow trade-offs">
                  <ul className="space-y-1.5 text-xs text-rose-700 dark:text-rose-300">
                    {comparison.explanation.whatDeteriorated.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-500 mt-0.5 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <Panel title="Explicit Modeling Assumptions" subtitle="Units, shift calendars & cost boundaries">
                  <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                    {comparison.explanation.assumptions.map((item, idx) => (
                      <li key={idx} className="leading-relaxed">• {item}</li>
                    ))}
                  </ul>
                </Panel>

                <Panel title="Remaining Constraints" subtitle="Active physical or supply-chain bottlenecks">
                  <ul className="space-y-1.5 text-xs text-amber-700 dark:text-amber-300">
                    {comparison.explanation.remainingConstraints.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <ShieldAlert className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            </div>
          )}

          {viewTab === 'sensitivity' && (
            <Panel
              title="Cross-Module Sensitivity Analysis"
              subtitle={
                sensitivityStamp
                  ? `Evaluated around ${sensitivityStamp}`
                  : 'Measure how single-factor perturbations ripple across Demand, Inventory, MRP & DES'
              }
              actions={
                <Button size="sm" variant="primary" onClick={handleRunSensitivity}>
                  <Play className="h-3.5 w-3.5" />
                  Run Sensitivity Sweep
                </Button>
              }
            >
              {sensitivityRows.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        <th className="py-2 pr-3">Lever / Shock</th>
                        <th className="py-2 px-2">Parameter Patch</th>
                        <th className="py-2 px-2 text-right">Throughput</th>
                        <th className="py-2 px-2 text-right">Inv. Cost</th>
                        <th className="py-2 px-2 text-right">OEE Δ</th>
                        <th className="py-2 px-2 text-right">Shortage Risk</th>
                        <th className="py-2 px-2 text-right">Unit Cost</th>
                        <th className="py-2 pl-2">New Bottleneck</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {sensitivityRows.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">{row.label}</td>
                          <td className="py-2 px-2 font-mono text-[11px] text-slate-500">{row.parameterChanged}</td>
                          <td
                            className={`py-2 px-2 text-right font-mono tabular-nums font-semibold ${
                              row.throughputDeltaPct > 0.5
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : row.throughputDeltaPct < -0.5
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-slate-500'
                            }`}
                          >
                            {row.throughputDeltaPct >= 0 ? '+' : ''}
                            {row.throughputDeltaPct}%
                          </td>
                          <td className="py-2 px-2 text-right font-mono tabular-nums">
                            {row.inventoryCostDeltaPct >= 0 ? '+' : ''}
                            {row.inventoryCostDeltaPct}%
                          </td>
                          <td className="py-2 px-2 text-right font-mono tabular-nums">
                            {row.oeeDeltaPts >= 0 ? '+' : ''}
                            {row.oeeDeltaPts} pts
                          </td>
                          <td className="py-2 px-2 text-right font-mono tabular-nums">
                            {row.shortageRiskDeltaPts >= 0 ? '+' : ''}
                            {row.shortageRiskDeltaPts} pts
                          </td>
                          <td className="py-2 px-2 text-right font-mono tabular-nums">
                            {row.operatingCostDeltaPct >= 0 ? '+' : ''}
                            {row.operatingCostDeltaPct}%
                          </td>
                          <td className="py-2 pl-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                            {row.bottleneckName}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="Sensitivity matrix not yet run"
                  message="Run the 6-lever cross-module sweep to perturb demand, safety stock, parallel bottleneck machines, cycle speed, reliability, and buffers around the active scenario."
                  action={
                    <Button size="sm" variant="primary" onClick={handleRunSensitivity}>
                      <Play className="h-3.5 w-3.5" />
                      Run 6-Lever Sweep
                    </Button>
                  }
                />
              )}
            </Panel>
          )}

          {viewTab === 'pipeline' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Panel title="1. Demand Forecasting Signal" subtitle="Rolling-origin cross-validation (forecast.ts)">
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Winning Model</span>
                    <span className="font-mono font-semibold">{scenarioEval.forecastSummary.modelName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Projected Monthly Demand</span>
                    <span className="font-mono">{fmtNum(scenarioEval.forecastSummary.monthlyForecast, 1)} units/mo</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">DES Job Arrival Rate</span>
                    <span className="font-mono">{fmtNum(scenarioEval.forecastSummary.arrivalRatePerHour, 2)} jobs/hr (CV {scenarioEval.forecastSummary.arrivalCv})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Backtest MAPE</span>
                    <span className="font-mono">{scenarioEval.forecastSummary.backtestMapePct ?? 'N/A'}%</span>
                  </div>
                </div>
              </Panel>

              <Panel title="2. Inventory Policy (EOQ & ROP)" subtitle="BOM-scoped continuous review (ipe.ts)">
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">SKUs Evaluated</span>
                    <span className="font-mono font-semibold">{scenarioEval.inventorySummary.skuCountInScope} items</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Annual Holding + Ordering</span>
                    <span className="font-mono">
                      {fmtMoney(scenarioEval.inventorySummary.holdingCostAnnual, 0)} + {fmtMoney(scenarioEval.inventorySummary.orderingCostAnnual, 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Safety Stock Buffer</span>
                    <span className="font-mono">{fmtInt(scenarioEval.inventorySummary.safetyStockUnits)} units</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">SKUs Needing Top-Up vs New ROP</span>
                    <span className="font-mono text-amber-600 dark:text-amber-400">
                      {scenarioEval.inventorySummary.exposedSkusCount} / {scenarioEval.inventorySummary.skuCountInScope}
                    </span>
                  </div>
                </div>
              </Panel>

              <Panel title="3. Time-Phased MRP Explosion" subtitle="60-day weekly buckets for batch order (mrp.ts)">
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Planned Order Releases</span>
                    <span className="font-mono font-semibold">{scenarioEval.mrpSummary.plannedOrdersCount} releases ({fmtInt(scenarioEval.kpis.replenishmentQtyTotal)} units)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Est. Replenishment Value</span>
                    <span className="font-mono">{fmtMoney(scenarioEval.mrpSummary.replenishmentCostEstimate, 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">MRP Shortages / Past-Due</span>
                    <span className="font-mono">
                      {scenarioEval.mrpSummary.shortageCount} shortages · {scenarioEval.mrpSummary.lateOrdersCount} late
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Critical BOM Components</span>
                    <span className="font-mono truncate max-w-[200px]">
                      {scenarioEval.mrpSummary.criticalComponents.join(', ') || 'None'}
                    </span>
                  </div>
                </div>
              </Panel>

              <Panel title="4. Line Balance & DES Floor" subtitle="Workstation allocation & event simulation (desEngine.ts)">
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Balanced Line</span>
                    <span className="font-mono font-semibold">
                      {scenarioEval.lineBalanceSummary.stationCount} stations · {scenarioEval.lineBalanceSummary.lineEfficiencyPct}% eff
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Operators (Avail / Req)</span>
                    <span className="font-mono">
                      {scenarioEval.params.operatorsAvailable} / {scenarioEval.lineBalanceSummary.operatorsRequired} ({Math.round(scenarioEval.lineBalanceSummary.workforceStaffingRatio * 100)}%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Mean Floor WIP & Cycle</span>
                    <span className="font-mono">
                      {fmtNum(scenarioEval.kpis.avgWip, 1)} jobs · {fmtNum(scenarioEval.kpis.avgCycleTimeMin, 1)} min
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Good Throughput & Completion</span>
                    <span className="font-mono">
                      {scenarioEval.desResult.totalThroughputGood} units · {scenarioEval.kpis.productionCompletionPct}%
                    </span>
                  </div>
                </div>
              </Panel>
            </div>
          )}
        </div>
      </div>

      {/* Explicit Confirmation Modal Before Modifying Live Workspace */}
      <Modal
        open={applyModalOpen}
        onClose={() => setApplyModalOpen(false)}
        title="Confirm Scenario Application to Live Workspace"
        subtitle="Explicit approval required — reviewing changes before mutating working configuration"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              Applying <strong>{applyPreview.scenarioName}</strong> will overwrite live working parameters in{' '}
              <strong>Factory Simulation Lab</strong>, <strong>Line Balancing</strong>, and target BOM items in{' '}
              <strong>Inventory &amp; MRP</strong>. Historical stock ledger entries and unit quantities remain untouched.
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-2 px-3">Module</th>
                  <th className="py-2 px-3">Setting</th>
                  <th className="py-2 px-3">Current Live</th>
                  <th className="py-2 px-3">Scenario Proposed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {applyPreview.changes.map((c, idx) => (
                  <tr key={idx}>
                    <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">{c.target}</td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{c.field}</td>
                    <td className="py-2 px-3 font-mono text-slate-500">{c.currentValue}</td>
                    <td className="py-2 px-3 font-mono font-semibold text-[var(--accent)]">{c.nextValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setApplyModalOpen(false)}>
              Cancel (Keep Live Unchanged)
            </Button>
            <Button variant="primary" onClick={handleConfirmApply}>
              <Activity className="h-3.5 w-3.5" />
              Confirm &amp; Apply to Workspace
            </Button>
          </div>
        </div>
      </Modal>

      <AssumptionPanel topicId="scenario-studio" />
    </div>
  );
};
