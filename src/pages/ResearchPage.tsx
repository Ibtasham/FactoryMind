import React, { useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Download, FileUp, Play, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { BarChart, LineChart } from '../components/charts/Charts';
import {
  Button,
  downloadFile,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Panel,
  SegmentedControl,
  Select,
  StatCard,
  TermTooltip,
} from '../components/ui/Primitives';
import { fmtNum } from '../engine/formatters';
import {
  AggregateMethodRow,
  BENCHMARK_LIMITATIONS,
  BenchmarkConfig,
  BenchmarkVerificationReport,
  buildBenchmarkExportPayload,
  buildConfigExportPayload,
  buildResearchMarkdownReport,
  CohortScope,
  DEFAULT_BENCHMARK_CONFIG,
  ExternalSeriesInput,
  FORECAST_ALGORITHM_DOCS,
  FORECAST_METRIC_DOCS,
  parseExternalSeriesInput,
  ResearchProvenanceClass,
  runResearchBenchmark,
  sanitizeBenchmarkConfig,
  TrainWindowType,
  verifyAndLoadBenchmarkArtifact,
} from '../engine/researchBenchmark';
import { useStore } from '../store/StoreContext';

type ResearchTab = 'benchmarks' | 'windows' | 'methodology';
type LeaderboardCohortView = 'evaluated' | 'workspace' | 'synthetic' | 'external';

const PROVENANCE_TONE: Record<ResearchProvenanceClass, string> = {
  'illustrative-catalogue': 'text-blue-700 dark:text-blue-400',
  'user-imported': 'text-emerald-700 dark:text-emerald-400',
  'synthetic-generated': 'text-amber-700 dark:text-amber-400',
  'external-dataset': 'text-cyan-700 dark:text-cyan-400',
};

function heatmapCellClass(wape: number | null | undefined): string {
  if (wape == null || !Number.isFinite(wape)) {
    return 'bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400';
  }
  if (wape <= 5) {
    return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 font-semibold';
  }
  if (wape <= 12) {
    return 'bg-emerald-500/5 text-slate-900 dark:text-slate-100';
  }
  if (wape <= 25) {
    return 'bg-amber-500/10 text-amber-800 dark:text-amber-300';
  }
  return 'bg-rose-500/12 text-rose-800 dark:text-rose-300';
}

export const ResearchPage: React.FC = () => {
  const { products, settings } = useStore();
  const [config, setConfig] = useState<BenchmarkConfig>(DEFAULT_BENCHMARK_CONFIG);
  const [activeTab, setActiveTab] = useState<ResearchTab>('benchmarks');
  const [leaderboardView, setLeaderboardView] = useState<LeaderboardCohortView>('evaluated');
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);
  const [showExternalDrawer, setShowExternalDrawer] = useState(false);

  const [externalSeries, setExternalSeries] = useState<ExternalSeriesInput[]>([]);
  const [extLabel, setExtLabel] = useState('');
  const [extValues, setExtValues] = useState('');
  const [extError, setExtError] = useState<string | null>(null);

  const [selectedSeriesId, setSelectedSeriesId] = useState<string>('');
  const [selectedOriginIdx, setSelectedOriginIdx] = useState<number>(0);
  const [algoFamilyFilter, setAlgoFamilyFilter] = useState<string>('All');
  const [verifyReport, setVerifyReport] = useState<BenchmarkVerificationReport | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const benchmark = useMemo(
    () =>
      runResearchBenchmark({
        products,
        config,
        externalSeries,
      }),
    [products, config, externalSeries]
  );

  const activeLeaderboard: AggregateMethodRow[] = useMemo(() => {
    if (leaderboardView === 'workspace') return benchmark.leaderboardWorkspace;
    if (leaderboardView === 'synthetic') return benchmark.leaderboardSynthetic;
    if (leaderboardView === 'external') return benchmark.leaderboardExternal;
    return benchmark.leaderboardAll;
  }, [benchmark, leaderboardView]);

  const activeSeriesResult = useMemo(() => {
    if (!benchmark.perSeries.length) return null;
    const found = benchmark.perSeries.find((s) => s.series.id === selectedSeriesId);
    return found || benchmark.perSeries[0];
  }, [benchmark.perSeries, selectedSeriesId]);

  const activeOrigin = useMemo(() => {
    if (!activeSeriesResult || !activeSeriesResult.originsAudit.length) return null;
    const idx = Math.max(0, Math.min(activeSeriesResult.originsAudit.length - 1, selectedOriginIdx));
    return { origin: activeSeriesResult.originsAudit[idx], idx };
  }, [activeSeriesResult, selectedOriginIdx]);

  const updateConfig = <K extends keyof BenchmarkConfig>(key: K, val: BenchmarkConfig[K]) => {
    setConfig((prev) => sanitizeBenchmarkConfig({ ...prev, [key]: val }));
  };

  const handleAddExternal = () => {
    const parsed = parseExternalSeriesInput(extLabel, extValues);
    if (!parsed.valid || !parsed.series) {
      setExtError(parsed.error || 'Unable to parse external series.');
      return;
    }
    setExternalSeries((prev) => {
      const next = prev.filter((x) => x.id !== parsed.series!.id);
      return [...next, parsed.series!];
    });
    setExtLabel('');
    setExtValues('');
    setExtError(null);
    setSelectedSeriesId(parsed.series.id);
  };

  const handleExportBenchmarkJSON = () => {
    const payload = buildBenchmarkExportPayload(benchmark);
    downloadFile('factorymind-research-benchmark.json', JSON.stringify(payload, null, 2), 'application/json');
  };

  const handleExportConfigJSON = () => {
    const payload = buildConfigExportPayload(benchmark.config, externalSeries);
    downloadFile('factorymind-benchmark-config.json', JSON.stringify(payload, null, 2), 'application/json');
  };

  const handleExportMarkdown = () => {
    const md = buildResearchMarkdownReport(benchmark);
    downloadFile('factorymind-research-benchmark.md', md, 'text/markdown');
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const report = verifyAndLoadBenchmarkArtifact(text);
      setVerifyReport(report);
      if (report.valid && report.restoredConfig) {
        setConfig(report.restoredConfig);
        if (report.restoredExternalSeries) {
          setExternalSeries(report.restoredExternalSeries);
        }
      }
    } catch {
      setVerifyReport({
        valid: false,
        kind: 'config-only',
        error: 'Failed to read selected JSON file.',
      });
    }
  };

  const topMethod = benchmark.leaderboardAll[0] || null;
  const bestRankMethod = useMemo(
    () =>
      benchmark.leaderboardAll
        .slice()
        .sort((a, b) => (a.meanRank ?? Infinity) - (b.meanRank ?? Infinity) || b.wins - a.wins)[0] || null,
    [benchmark.leaderboardAll]
  );

  const syntheticColumns = useMemo(
    () => benchmark.perSeries.filter((s) => s.series.provenanceClass === 'synthetic-generated'),
    [benchmark.perSeries]
  );

  const windowChartData = useMemo(() => {
    if (!activeSeriesResult || !activeOrigin) return null;
    const hist = activeSeriesResult.series.history;
    const o = activeOrigin.origin;
    const labels = hist.map((_, idx) => `T${idx + 1}`);
    const trainData: Array<number | null> = hist.map((v, idx) =>
      idx >= o.trainStart && idx <= o.trainEnd ? v : null
    );
    const futureHoldout: Array<number | null> = hist.map((v, idx) => (idx >= o.testStart ? v : null));
    const bestPredLine: Array<number | null> = hist.map((_, idx) => {
      if (idx === o.trainEnd) return hist[o.trainEnd];
      const off = idx - o.testStart;
      return off >= 0 && off < o.bestPred.length ? o.bestPred[off] : null;
    });
    const naivePredLine: Array<number | null> = hist.map((_, idx) => {
      if (idx === o.trainEnd) return hist[o.trainEnd];
      const off = idx - o.testStart;
      return off >= 0 && off < o.baselinePred.length ? o.baselinePred[off] : null;
    });
    return {
      labels,
      trainData,
      futureHoldout,
      bestPredLine,
      naivePredLine,
    };
  }, [activeSeriesResult, activeOrigin]);

  const filteredAlgorithmDocs = useMemo(() => {
    if (algoFamilyFilter === 'All') return FORECAST_ALGORITHM_DOCS;
    return FORECAST_ALGORITHM_DOCS.filter((a) => a.family === algoFamilyFilter);
  }, [algoFamilyFilter]);

  const { provenanceCountsAllWorkspaceAndSynth, provenanceCountsEvaluated, leakageAudit, checksums } = benchmark;

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="Import benchmark configuration or report JSON"
        onChange={handleImportJsonFile}
      />

      {/* Primary Configuration & Reproducibility Control Panel */}
      <Panel
        title="Reproducible forecasting benchmark suite"
        subtitle="Chronological evaluation of all 12 models with deterministic seeding, strict causal windows, and verifiable exports"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()} data-testid="research-load-json">
              <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Load / Verify JSON
            </Button>
            <Button size="sm" variant="secondary" onClick={handleExportConfigJSON} data-testid="research-export-config">
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export Config
            </Button>
            <Button size="sm" variant="secondary" onClick={handleExportMarkdown} data-testid="research-export-md">
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export Markdown
            </Button>
            <Button size="sm" variant="primary" onClick={handleExportBenchmarkJSON} data-testid="research-export-json">
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export Benchmark JSON
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <Field label="PRNG Seed" hint="Mulberry32">
            <Input
              type="number"
              min="1"
              value={config.seed}
              onChange={(e) => updateConfig('seed', Number(e.target.value))}
            />
          </Field>

          <Field label="Dataset Scope">
            <Select
              value={config.cohortScope}
              onChange={(e) => updateConfig('cohortScope', e.target.value as CohortScope)}
            >
              <option value="all">All cohorts (Mixed)</option>
              <option value="catalogue">Workspace SKUs only</option>
              <option value="synthetic">Synthetic suites only</option>
              <option value="external">External series only ({externalSeries.length})</option>
            </Select>
          </Field>

          <Field label="Training Window" termKey="rollingOrigin">
            <Select
              value={config.trainWindowType}
              onChange={(e) => updateConfig('trainWindowType', e.target.value as TrainWindowType)}
            >
              <option value="expanding">Expanding [0 .. t−1]</option>
              <option value="rolling">Rolling (fixed width)</option>
            </Select>
          </Field>

          {config.trainWindowType === 'rolling' ? (
            <Field label="Rolling Max Width" hint="4–24">
              <Input
                type="number"
                min="4"
                max="24"
                value={config.rollingMaxTrain}
                onChange={(e) => updateConfig('rollingMaxTrain', Number(e.target.value))}
              />
            </Field>
          ) : (
            <Field label="SKU Horizon (h)" hint="1–4">
              <Input
                type="number"
                min="1"
                max="4"
                value={config.skuHorizon}
                onChange={(e) => updateConfig('skuHorizon', Number(e.target.value))}
              />
            </Field>
          )}

          <Field label="Synth Horizon (h)" hint="1–6">
            <Input
              type="number"
              min="1"
              max="6"
              value={config.synthHorizon}
              onChange={(e) => updateConfig('synthHorizon', Number(e.target.value))}
            />
          </Field>

          <div className="flex items-end gap-2">
            <Button variant="secondary" className="w-full whitespace-nowrap" onClick={() => updateConfig('seed', config.seed + 1)}>
              <Play className="h-3.5 w-3.5" aria-hidden="true" /> Seed #{config.seed + 1}
            </Button>
          </div>
        </div>

        {/* Toggle rows for model parameters & external empirical series */}
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              aria-expanded={showAdvancedParams}
              onClick={() => setShowAdvancedParams((v) => !v)}
              className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200 hover:text-[var(--accent)] cursor-pointer"
            >
              {showAdvancedParams ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span>
                Smoothing &amp; generator parameters (w={config.maWindow}, α={config.alpha.toFixed(2)}, β={config.beta.toFixed(2)}, γ={config.gamma.toFixed(2)}, p={config.seasonPeriod})
              </span>
            </button>
            <span aria-hidden="true" className="text-slate-400 hidden sm:inline">·</span>
            <button
              type="button"
              aria-expanded={showExternalDrawer}
              onClick={() => setShowExternalDrawer((v) => !v)}
              className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>External empirical series ({externalSeries.length} loaded)</span>
            </button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setConfig(DEFAULT_BENCHMARK_CONFIG)}>
            <RotateCcw className="h-3 w-3" aria-hidden="true" /> Reset defaults
          </Button>
        </div>

        {showAdvancedParams && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <Field label="MA Window (w)">
              <Input type="number" min="2" max="12" value={config.maWindow} onChange={(e) => updateConfig('maWindow', Number(e.target.value))} />
            </Field>
            <Field label="Alpha (α)">
              <Input type="number" min="0.05" max="0.95" step="0.05" value={config.alpha} onChange={(e) => updateConfig('alpha', Number(e.target.value))} />
            </Field>
            <Field label="Beta (β)">
              <Input type="number" min="0.05" max="0.95" step="0.05" value={config.beta} onChange={(e) => updateConfig('beta', Number(e.target.value))} />
            </Field>
            <Field label="Gamma (γ)">
              <Input type="number" min="0.05" max="0.95" step="0.05" value={config.gamma} onChange={(e) => updateConfig('gamma', Number(e.target.value))} />
            </Field>
            <Field label="Season Period (p)">
              <Input type="number" min="2" max="24" value={config.seasonPeriod} onChange={(e) => updateConfig('seasonPeriod', Number(e.target.value))} />
            </Field>
            <Field label="Synth Length (n)">
              <Input type="number" min="18" max="60" value={config.synthLength} onChange={(e) => updateConfig('synthLength', Number(e.target.value))} />
            </Field>
            <Field label="Synth Base">
              <Input type="number" min="20" max="1000" value={config.synthBase} onChange={(e) => updateConfig('synthBase', Number(e.target.value))} />
            </Field>
            <Field label="Synth Noise σ">
              <Input type="number" min="0" max="200" value={config.synthNoise} onChange={(e) => updateConfig('synthNoise', Number(e.target.value))} />
            </Field>
          </div>
        )}

        {showExternalDrawer && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              FactoryMind ships zero external empirical datasets by default. Add session-only external CSV demand observations here to benchmark them alongside or separately from workspace and synthetic cohorts.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-3">
                <Field label="Series label">
                  <Input
                    placeholder="e.g., M4-Monthly-Demo"
                    value={extLabel}
                    onChange={(e) => setExtLabel(e.target.value)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-7">
                <Field label="Demand observations (≥ 6 non-negative numbers)">
                  <Input
                    placeholder="e.g., 142, 138, 151, 165, 179, 160, 148, 133, 144, 159, 174, 188"
                    value={extValues}
                    onChange={(e) => setExtValues(e.target.value)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Button size="md" variant="primary" className="w-full" onClick={handleAddExternal}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add Series
                </Button>
              </div>
            </div>
            {extError && <ErrorBanner title="Invalid external series input" message={extError} />}
            {externalSeries.length > 0 && (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                {externalSeries.map((ext) => (
                  <div key={ext.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{ext.label}</span>
                      <span aria-hidden="true" className="mx-1.5 text-slate-400">·</span>
                      <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        n={ext.history.length} periods
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExternalSeries((prev) => prev.filter((x) => x.id !== ext.id))}
                      aria-label={`Remove external series ${ext.label}`}
                      className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:underline cursor-pointer shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* Verification result banner when user loads/verifies a JSON export */}
      {verifyReport && (
        verifyReport.valid ? (
          <div
            role="status"
            data-testid="research-verify-banner"
            className={`rounded-xl border px-4 py-3 text-xs flex flex-wrap items-start justify-between gap-3 ${
              verifyReport.kind === 'config-only' || verifyReport.exactMatch
                ? 'border-emerald-300/80 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                : 'border-amber-300/80 dark:border-amber-800/80 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                <div className="font-semibold">
                  {verifyReport.kind === 'config-only'
                    ? 'Benchmark configuration restored cleanly.'
                    : verifyReport.exactMatch
                      ? `Independent reproduction verified — 100% deterministic match across ${verifyReport.seriesChecked} series.`
                      : 'Imported benchmark differed from recomputed results.'}
                </div>
                {verifyReport.kind === 'full-benchmark' && (
                  <div className="font-mono tabular-nums text-[11px]">
                    Exported hash: {verifyReport.expectedResultsChecksum || 'N/A'} · Recomputed hash: {verifyReport.recomputedResultsChecksum} · Max |ΔWAPE|: {(verifyReport.maxWapeDiff ?? 0).toFixed(8)}%
                  </div>
                )}
                {verifyReport.mismatches && verifyReport.mismatches.length > 0 && (
                  <ul className="list-disc pl-4 space-y-0.5">
                    {verifyReport.mismatches.slice(0, 4).map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setVerifyReport(null)}
              className="text-xs font-medium underline cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        ) : (
          <ErrorBanner
            title="Unable to verify imported JSON artifact"
            message={verifyReport.error || 'Malformed JSON file.'}
            action={
              <Button size="sm" variant="ghost" onClick={() => setVerifyReport(null)}>
                Dismiss
              </Button>
            }
          />
        )
      )}

      {/* Dataset Provenance & Causal Leakage Audit Ribbon (Zero Pill Capsules) */}
      <section
        aria-label="Dataset provenance and causal leakage audit"
        className="rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-slate-900/85 px-4 py-3 text-xs space-y-2"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div>
            <span className={`font-semibold ${PROVENANCE_TONE['illustrative-catalogue']}`}>
              Illustrative Catalogue
            </span>
            <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {provenanceCountsEvaluated['illustrative-catalogue']}/{provenanceCountsAllWorkspaceAndSynth['illustrative-catalogue']}
            </span>
            <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
              Seeded 17-SKU factory items (not ERP logs)
            </div>
          </div>

          <div>
            <span className={`font-semibold ${PROVENANCE_TONE['user-imported']}`}>
              User-Imported / Entered
            </span>
            <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {provenanceCountsEvaluated['user-imported']}/{provenanceCountsAllWorkspaceAndSynth['user-imported']}
            </span>
            <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
              Workspace CSV/JSON imports &amp; user edits
            </div>
          </div>

          <div>
            <span className={`font-semibold ${PROVENANCE_TONE['synthetic-generated']}`}>
              Generated Synthetic
            </span>
            <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {provenanceCountsEvaluated['synthetic-generated']}/{provenanceCountsAllWorkspaceAndSynth['synthetic-generated']}
            </span>
            <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
              Mulberry32 + Box-Muller regimes (Seed #{config.seed})
            </div>
          </div>

          <div>
            <span className={`font-semibold ${PROVENANCE_TONE['external-dataset']}`}>
              External Empirical Data
            </span>
            <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {provenanceCountsEvaluated['external-dataset']}/{provenanceCountsAllWorkspaceAndSynth['external-dataset']}
            </span>
            <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
              {provenanceCountsAllWorkspaceAndSynth['external-dataset'] === 0
                ? 'None bundled by default (session CSV optional)'
                : 'Session-uploaded empirical series'}
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`inline-flex items-center gap-1 font-semibold ${
                leakageAudit.passed ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {leakageAudit.passed ? 'Causal Leakage Check Passed' : 'Causal Leakage Warning'}
            </span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-200">
              {leakageAudit.verifiedOriginsCount} origins verified ({config.trainWindowType})
            </span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
              Perturbation max |Δŷ| = {leakageAudit.maxFuturePerturbationDelta.toFixed(6)} ({leakageAudit.perturbationModelsTested} models)
            </span>
          </div>
          {benchmark.excludedSeries.length > 0 && (
            <span className="text-amber-700 dark:text-amber-400 font-medium">
              Excluded (&lt;{config.minSeriesLength} pts): {benchmark.excludedSeries.map((e) => e.label).join(', ')}
            </span>
          )}
        </div>
      </section>

      {/* Precision Telemetry Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          label="Series evaluated"
          value={String(benchmark.includedSeries.length)}
          sub={`${provenanceCountsEvaluated['illustrative-catalogue'] + provenanceCountsEvaluated['user-imported']} workspace · ${provenanceCountsEvaluated['synthetic-generated']} synth · ${provenanceCountsEvaluated['external-dataset']} ext`}
        />
        <StatCard
          label="Lowest mean WAPE"
          termKey="wape"
          value={topMethod ? topMethod.name : '—'}
          sub={
            topMethod && topMethod.avgWape != null
              ? `Mean ${fmtNum(topMethod.avgWape, 1)}% · Med ${fmtNum(topMethod.medianWape ?? 0, 1)}% · MASE ${topMethod.avgMase != null ? fmtNum(topMethod.avgMase, 2) : '—'}`
              : 'No series evaluated'
          }
          tone={topMethod ? 'good' : 'neutral'}
        />
        <StatCard
          label="Lowest mean rank"
          value={bestRankMethod ? bestRankMethod.name : '—'}
          sub={
            bestRankMethod && bestRankMethod.meanRank != null
              ? `Rank ${fmtNum(bestRankMethod.meanRank, 2)} · ${bestRankMethod.wins} series wins`
              : '—'
          }
        />
        <StatCard
          label="Seed & repro hash"
          value={`#${config.seed}`}
          sub={`Res ${checksums.resultsChecksum} · Data ${checksums.datasetChecksum}`}
        />
      </div>

      {/* Primary Section Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          ariaLabel="Research Lab section views"
          value={activeTab}
          onChange={(v) => setActiveTab(v as ResearchTab)}
          options={[
            { value: 'benchmarks', label: 'Benchmarks & Stats' },
            { value: 'windows', label: 'Windows & Series Explorer' },
            { value: 'methodology', label: 'Methodology & Algorithms' },
          ]}
        />
        <span className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
          Config checksum: {checksums.configChecksum}
        </span>
      </div>

      {activeTab === 'benchmarks' && (
        <>
          {benchmark.includedSeries.length === 0 ? (
            <EmptyState
              title="No series match the selected dataset scope"
              message="Add an external empirical series above or switch Dataset Scope back to All cohorts to evaluate workspace SKUs and synthetic suites."
              action={
                <Button size="sm" variant="primary" onClick={() => updateConfig('cohortScope', 'all')}>
                  Switch to All cohorts
                </Button>
              }
            />
          ) : (
            <>
              <Panel
                title="12-model out-of-sample statistical summary"
                subtitle="Evaluated across strictly past training slices. Scale-free WAPE, Median WAPE, IQR, MASE, sMAPE, and Mean Rank prevent large-volume SKUs from masking low-volume errors."
                actions={
                  <SegmentedControl
                    ariaLabel="Filter summary table by provenance cohort"
                    value={leaderboardView}
                    onChange={(v) => setLeaderboardView(v as LeaderboardCohortView)}
                    options={[
                      { value: 'evaluated', label: `Evaluated (${benchmark.perSeries.length})` },
                      {
                        value: 'workspace',
                        label: `Workspace (${provenanceCountsEvaluated['illustrative-catalogue'] + provenanceCountsEvaluated['user-imported']})`,
                      },
                      { value: 'synthetic', label: `Synthetic (${provenanceCountsEvaluated['synthetic-generated']})` },
                      ...(provenanceCountsEvaluated['external-dataset'] > 0
                        ? [{ value: 'external', label: `External (${provenanceCountsEvaluated['external-dataset']})` }]
                        : []),
                    ]}
                  />
                }
              >
                {activeLeaderboard.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-600 dark:text-slate-300">
                    No series present in this sub-cohort under the current Dataset Scope filter.
                  </div>
                ) : (
                  <>
                    {/* Mobile card layout */}
                    <div className="md:hidden space-y-2">
                      {activeLeaderboard.map((r, i) => (
                        <div
                          key={r.name}
                          className={`rounded-lg border p-3 text-xs space-y-2 ${
                            i === 0
                              ? 'border-emerald-300/80 dark:border-emerald-800/80 bg-emerald-50/40 dark:bg-emerald-950/20'
                              : 'border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              #{i + 1} · {r.name}
                            </span>
                            <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300">
                              {r.wins} wins · N={r.totalPoints}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 font-mono tabular-nums text-[11px]">
                            <div>
                              <span className="block font-sans text-slate-600 dark:text-slate-300">Mean WAPE</span>
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {r.avgWape != null ? `${fmtNum(r.avgWape, 1)}%` : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="block font-sans text-slate-600 dark:text-slate-300">Med / IQR</span>
                              <span>
                                {r.medianWape != null ? `${fmtNum(r.medianWape, 1)}%` : '—'} / {r.iqrWape != null ? fmtNum(r.iqrWape, 1) : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="block font-sans text-slate-600 dark:text-slate-300">MASE</span>
                              <span>{r.avgMase != null ? fmtNum(r.avgMase, 2) : '—'}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop precision table */}
                    <div className="hidden md:block overflow-x-auto -mx-4 px-4">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-600 dark:text-slate-300">
                            <th scope="col" className="pb-2 font-medium">#</th>
                            <th scope="col" className="pb-2 font-medium">Method</th>
                            <th scope="col" className="pb-2 font-medium text-right">
                              <span className="inline-flex items-center justify-end gap-1">Mean WAPE <TermTooltip termKey="wape" /></span>
                            </th>
                            <th scope="col" className="pb-2 font-medium text-right">Med WAPE</th>
                            <th scope="col" className="pb-2 font-medium text-right">WAPE IQR</th>
                            <th scope="col" className="pb-2 font-medium text-right">
                              <span className="inline-flex items-center justify-end gap-1">MASE <TermTooltip termKey="mase" /></span>
                            </th>
                            <th scope="col" className="pb-2 font-medium text-right">
                              <span className="inline-flex items-center justify-end gap-1">sMAPE <TermTooltip termKey="smape" /></span>
                            </th>
                            <th scope="col" className="pb-2 font-medium text-right">
                              <span className="inline-flex items-center justify-end gap-1">Bias <TermTooltip termKey="forecastBias" /></span>
                            </th>
                            <th scope="col" className="pb-2 font-medium text-right">Mean RMSE</th>
                            <th scope="col" className="pb-2 font-medium text-right">Mean MAE</th>
                            <th scope="col" className="pb-2 font-medium text-right">Mean Rank</th>
                            <th scope="col" className="pb-2 font-medium text-right">Wins</th>
                            <th scope="col" className="pb-2 font-medium text-right">Pts</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {activeLeaderboard.map((r, i) => (
                            <tr
                              key={r.name}
                              className={i === 0 ? 'bg-emerald-50/55 dark:bg-emerald-950/25 font-medium' : ''}
                            >
                              <td className="py-2 pr-2 font-mono tabular-nums text-slate-600 dark:text-slate-300">{i + 1}</td>
                              <td className="py-2 pr-3 text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                {r.name}
                                {r.degradedSeriesCount > 0 && (
                                  <span
                                    title={`Degraded to additive variant on ${r.degradedSeriesCount} series with zero/non-positive demand`}
                                    className="ml-1.5 text-[10px] font-mono text-amber-700 dark:text-amber-400"
                                  >
                                    (add-fallback ×{r.degradedSeriesCount})
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                                {r.avgWape != null ? `${fmtNum(r.avgWape, 1)}%` : '—'}
                              </td>
                              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                                {r.medianWape != null ? `${fmtNum(r.medianWape, 1)}%` : '—'}
                              </td>
                              <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {r.iqrWape != null ? `${fmtNum(r.iqrWape, 1)}%` : '—'}
                              </td>
                              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                                {r.avgMase != null ? fmtNum(r.avgMase, 2) : '—'}
                              </td>
                              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                                {r.avgSmape != null ? `${fmtNum(r.avgSmape, 1)}%` : '—'}
                              </td>
                              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                                {r.avgBias != null ? fmtNum(r.avgBias, 2) : '—'}
                              </td>
                              <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {r.avgRmse != null ? fmtNum(r.avgRmse, 1) : '—'}
                              </td>
                              <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {r.avgMae != null ? fmtNum(r.avgMae, 1) : '—'}
                              </td>
                              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                                {r.meanRank != null ? fmtNum(r.meanRank, 2) : '—'}
                              </td>
                              <td className="py-2 pr-3 text-right font-mono tabular-nums">{r.wins}</td>
                              <td className="py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {r.totalPoints}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <p className="mt-3 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      Methodological note: Mean RMSE, Mean MAE, and Mean Bias combine series with different volume scales (e.g., high-volume fasteners vs. low-volume assemblies). Rely on dimensionless WAPE, Median WAPE, MASE, and Mean Rank when comparing cross-SKU generalization.
                    </p>
                  </>
                )}
              </Panel>

              {/* Comparative Visualizations: WAPE Bar Comparison & Regime Heatmap Matrix */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <Panel
                  title="Mean WAPE (%) comparison"
                  subtitle="All 12 models in current cohort view (lower is better)"
                  className="lg:col-span-5"
                >
                  {activeLeaderboard.length ? (
                    <BarChart
                      horizontal
                      labels={activeLeaderboard.map((r) => r.name)}
                      series={[
                        {
                          name: 'Mean WAPE %',
                          data: activeLeaderboard.map((r) => (r.avgWape != null && Number.isFinite(r.avgWape) ? r.avgWape : 0)),
                        },
                      ]}
                      formatValue={(v) => `${fmtNum(v, 1)}%`}
                    />
                  ) : (
                    <div className="py-8 text-center text-xs text-slate-600 dark:text-slate-300">No data in selected cohort</div>
                  )}
                </Panel>

                <Panel
                  title="Regime & cohort WAPE (%) matrix"
                  subtitle="Performance sensitivity across workspace SKUs and canonical synthetic patterns (* = additive fallback on zeros)"
                  className="lg:col-span-7"
                >
                  <div className="overflow-x-auto -mx-4 px-4">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-600 dark:text-slate-300">
                          <th scope="col" className="pb-2 pr-3 font-medium">Method</th>
                          {benchmark.leaderboardWorkspace.length > 0 && (
                            <th scope="col" className="pb-2 px-2 font-medium text-right whitespace-nowrap">
                              Workspace Avg
                            </th>
                          )}
                          {syntheticColumns.map((col) => (
                            <th key={col.series.id} scope="col" className="pb-2 px-2 font-medium text-right whitespace-nowrap">
                              {col.series.label.replace('synth:', '')}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {benchmark.leaderboardAll.map((row) => {
                          const wsMatch = benchmark.leaderboardWorkspace.find((w) => w.name === row.name);
                          return (
                            <tr key={row.name}>
                              <th scope="row" className="py-1.5 pr-3 text-left font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                {row.name}
                              </th>
                              {benchmark.leaderboardWorkspace.length > 0 && (
                                <td
                                  className={`py-1.5 px-2 text-right font-mono tabular-nums rounded-xs ${heatmapCellClass(wsMatch?.avgWape)}`}
                                >
                                  {wsMatch?.avgWape != null ? `${fmtNum(wsMatch.avgWape, 1)}%` : '—'}
                                </td>
                              )}
                              {syntheticColumns.map((col) => {
                                const m = col.methods.find((x) => x.name === row.name);
                                const w = m?.metrics.wape;
                                return (
                                  <td
                                    key={col.series.id}
                                    className={`py-1.5 px-2 text-right font-mono tabular-nums ${heatmapCellClass(w)}`}
                                    title={m?.degradedVariant ? 'HWMultiplicative fell back to additive mode due to zero values' : undefined}
                                  >
                                    {w != null ? `${fmtNum(w, 1)}%` : '—'}
                                    {m?.degradedVariant ? '*' : ''}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Discrete color scale legend */}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="font-medium">WAPE bands:</span>
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="h-2.5 w-3 rounded-[2px] bg-emerald-500/25 border border-emerald-500/40" /> ≤ 5%
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="h-2.5 w-3 rounded-[2px] bg-emerald-500/8 border border-slate-300 dark:border-slate-700" /> 5–12%
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="h-2.5 w-3 rounded-[2px] bg-amber-500/18 border border-amber-500/40" /> 12–25%
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="h-2.5 w-3 rounded-[2px] bg-rose-500/18 border border-rose-500/40" /> &gt; 25%
                    </span>
                  </div>
                </Panel>
              </div>
            </>
          )}
        </>
      )}

      {activeTab === 'windows' && (
        <>
          {!activeSeriesResult ? (
            <EmptyState
              title="No evaluated series to inspect"
              message="Include at least one series with 6 or more non-negative demand observations."
              action={
                <Button size="sm" variant="primary" onClick={() => updateConfig('cohortScope', 'all')}>
                  Reset Dataset Scope
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              <Panel
                title="Series & chronological origin window inspector"
                subtitle="Step through exact train [start..end] and evaluation [testStart..testEnd] partitions to verify zero future leakage"
                actions={
                  <div className="w-full sm:w-72">
                    <Select
                      aria-label="Select evaluated series"
                      value={activeSeriesResult.series.id}
                      onChange={(e) => {
                        setSelectedSeriesId(e.target.value);
                        setSelectedOriginIdx(0);
                      }}
                    >
                      {benchmark.perSeries.map((sr) => (
                        <option key={sr.series.id} value={sr.series.id}>
                          {sr.series.label} ({sr.series.provenanceLabel})
                        </option>
                      ))}
                    </Select>
                  </div>
                }
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs pb-3 border-b border-slate-100 dark:border-slate-800/80">
                  <div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">Provenance</div>
                    <div className={`font-semibold ${PROVENANCE_TONE[activeSeriesResult.series.provenanceClass]}`}>
                      {activeSeriesResult.series.provenanceLabel}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">Observations</div>
                    <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      n={activeSeriesResult.series.history.length} ({activeSeriesResult.series.zeroCount} zeros)
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">Eval protocol</div>
                    <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      h={activeSeriesResult.series.horizon} · minTrain={activeSeriesResult.series.minTrainSize}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">Season cap / CV</div>
                    <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      p={activeSeriesResult.series.effectiveSeasonPeriod} · CV {fmtNum(activeSeriesResult.series.cv, 2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">Best method</div>
                    <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                      {activeSeriesResult.bestMethodName || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">Series checksum</div>
                    <div className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {activeSeriesResult.series.checksum}
                    </div>
                  </div>
                </div>

                {activeOrigin && windowChartData && (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200">
                        Origin #{activeOrigin.idx + 1} of {activeSeriesResult.originsAudit.length}
                        <span className="mx-2 text-slate-400" aria-hidden="true">|</span>
                        Train indices [{activeOrigin.origin.trainStart}..{activeOrigin.origin.trainEnd}] ({activeOrigin.origin.trainSize} pts)
                        <span className="mx-2 text-slate-400" aria-hidden="true">→</span>
                        Eval indices [{activeOrigin.origin.testStart}..{activeOrigin.origin.testEnd}]
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={activeOrigin.idx <= 0}
                          onClick={() => setSelectedOriginIdx((i) => Math.max(0, i - 1))}
                        >
                          Prev origin
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={activeOrigin.idx >= activeSeriesResult.originsAudit.length - 1}
                          onClick={() =>
                            setSelectedOriginIdx((i) => Math.min(activeSeriesResult.originsAudit.length - 1, i + 1))
                          }
                        >
                          Next origin
                        </Button>
                      </div>
                    </div>

                    <LineChart
                      labels={windowChartData.labels}
                      height={250}
                      yMinZero
                      caption={`Origin ${activeOrigin.idx + 1} chronological split for ${activeSeriesResult.series.label}: training slice ends at index ${activeOrigin.origin.trainEnd}, evaluation horizon covers ${activeOrigin.origin.testStart} through ${activeOrigin.origin.testEnd}.`}
                      series={[
                        {
                          name: 'Training window (observed past)',
                          data: windowChartData.trainData,
                          color: settings.theme === 'dark' ? '#e2e8f0' : '#0f172a',
                        },
                        {
                          name: 'Holdout actuals (unseen by model)',
                          data: windowChartData.futureHoldout,
                          color: '#64748b',
                          dashed: true,
                        },
                        {
                          name: `${activeSeriesResult.bestMethodName || 'Best'} forecast`,
                          data: windowChartData.bestPredLine,
                          color: '#10b981',
                        },
                        {
                          name: 'Naive (last) baseline',
                          data: windowChartData.naivePredLine,
                          color: '#f59e0b',
                          dashed: true,
                        },
                      ]}
                    />
                  </div>
                )}
              </Panel>

              {/* Full 12-Method Evaluation Detail for Selected Series */}
              <Panel
                title={`Per-method accuracy breakdown — ${activeSeriesResult.series.label}`}
                subtitle="Compares WAPE, strictly in-sample-scaled MASE, sMAPE, non-zero MAPE (showing skipped zero periods), RMSE, MAE, and Bias"
              >
                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-600 dark:text-slate-300">
                        <th scope="col" className="pb-2 font-medium">Rank</th>
                        <th scope="col" className="pb-2 font-medium">Method</th>
                        <th scope="col" className="pb-2 font-medium text-right">WAPE</th>
                        <th scope="col" className="pb-2 font-medium text-right">MASE</th>
                        <th scope="col" className="pb-2 font-medium text-right">sMAPE</th>
                        <th scope="col" className="pb-2 font-medium text-right">MAPE (valid/N)</th>
                        <th scope="col" className="pb-2 font-medium text-right">RMSE</th>
                        <th scope="col" className="pb-2 font-medium text-right">MAE</th>
                        <th scope="col" className="pb-2 font-medium text-right">Bias</th>
                        <th scope="col" className="pb-2 font-medium text-right">Variant</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {activeSeriesResult.methods
                        .slice()
                        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                        .map((m) => (
                          <tr
                            key={m.name}
                            className={m.rank === 1 ? 'bg-emerald-50/55 dark:bg-emerald-950/25 font-medium' : ''}
                          >
                            <td className="py-2 pr-2 font-mono tabular-nums text-slate-600 dark:text-slate-300">{m.rank ?? '—'}</td>
                            <td className="py-2 pr-3 text-slate-900 dark:text-slate-100 whitespace-nowrap">{m.name}</td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums">
                              {m.metrics.wape != null ? `${fmtNum(m.metrics.wape, 1)}%` : '—'}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums">
                              {m.mase != null ? fmtNum(m.mase, 2) : '—'}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums">
                              {m.metrics.smape != null ? `${fmtNum(m.metrics.smape, 1)}%` : '—'}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums">
                              {m.metrics.mape != null ? `${fmtNum(m.metrics.mape, 1)}%` : '—'}{' '}
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                ({m.mapeValidPoints}/{m.metrics.n})
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums">
                              {m.metrics.rmse != null ? fmtNum(m.metrics.rmse, 2) : '—'}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums">
                              {m.metrics.mae != null ? fmtNum(m.metrics.mae, 2) : '—'}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums">
                              {m.metrics.bias != null ? fmtNum(m.metrics.bias, 2) : '—'}
                            </td>
                            <td className="py-2 text-right font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                              {m.degradedVariant ? (
                                <span className="text-amber-700 dark:text-amber-400">Additive fallback</span>
                              ) : (
                                m.lastModelTag
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              {/* Origin Split Log */}
              <Panel
                title="Origin-by-origin partition ledger"
                subtitle="Verifies trainEnd = origin − 1 and strict isolation from holdout test windows"
              >
                <div className="max-h-64 overflow-auto -mx-4 px-4">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                      <tr className="text-left text-[11px] text-slate-600 dark:text-slate-300">
                        <th scope="col" className="pb-2 font-medium">Origin</th>
                        <th scope="col" className="pb-2 font-medium">Train Slice</th>
                        <th scope="col" className="pb-2 font-medium text-right">Train N</th>
                        <th scope="col" className="pb-2 font-medium">Test Slice</th>
                        <th scope="col" className="pb-2 font-medium text-right">In-Sample Naive MAE</th>
                        <th scope="col" className="pb-2 font-medium text-right">Actuals</th>
                        <th scope="col" className="pb-2 font-medium text-right">Best Model Pred</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
                      {activeSeriesResult.originsAudit.map((o, idx) => (
                        <tr
                          key={o.originIndex}
                          onClick={() => setSelectedOriginIdx(idx)}
                          className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                            activeOrigin?.idx === idx ? 'bg-slate-100/80 dark:bg-slate-800/60' : ''
                          }`}
                        >
                          <td className="py-1.5 pr-3">#{idx + 1} (t={o.originIndex})</td>
                          <td className="py-1.5 pr-3">[{o.trainStart}..{o.trainEnd}]</td>
                          <td className="py-1.5 pr-3 text-right">{o.trainSize}</td>
                          <td className="py-1.5 pr-3">[{o.testStart}..{o.testEnd}]</td>
                          <td className="py-1.5 pr-3 text-right">
                            {o.trainNaiveMae != null ? fmtNum(o.trainNaiveMae, 2) : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-right">{o.testActual.map((v) => fmtNum(v, 0)).join(', ')}</td>
                          <td className="py-1.5 text-right text-emerald-700 dark:text-emerald-400">
                            {o.bestPred.map((v) => (v != null ? fmtNum(v, 1) : '—')).join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          )}
        </>
      )}

      {activeTab === 'methodology' && (
        <div className="space-y-4">
          {/* Metric Mathematical Definitions */}
          <Panel
            title="Forecasting error metrics & scale-aggregation rules"
            subtitle="Exact equations used in accuracy computation, backtesting, and leaderboard ranking"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {FORECAST_METRIC_DOCS.map((m) => (
                <article
                  key={m.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-1.5"
                >
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{m.name}</div>
                  <div className="font-mono text-[11px] bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 rounded px-2.5 py-1.5 text-[var(--accent)] overflow-x-auto">
                    {m.formula}
                  </div>
                  <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300">Units: {m.units}</div>
                  <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">{m.interpretation}</p>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                    Caveat: {m.caveats}
                  </p>
                </article>
              ))}
            </div>
          </Panel>

          {/* All 12 Forecasting Algorithms Reference */}
          <Panel
            title="12 forecasting algorithms — mathematical specifications"
            subtitle="Equations, state initialization rules, active hyperparameters, and edge-case limitations"
            actions={
              <SegmentedControl
                ariaLabel="Filter algorithm reference by family"
                value={algoFamilyFilter}
                onChange={setAlgoFamilyFilter}
                options={[
                  { value: 'All', label: 'All (12)' },
                  { value: 'Baseline', label: 'Baseline' },
                  { value: 'Moving Average', label: 'MA' },
                  { value: 'Exponential Smoothing', label: 'Smoothing' },
                  { value: 'Seasonal', label: 'Seasonal' },
                  { value: 'Regression', label: 'Regression' },
                  { value: 'Intermittent', label: 'Intermittent' },
                ]}
              />
            }
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {filteredAlgorithmDocs.map((algo) => (
                <article
                  key={algo.shortKey}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">{algo.name}</h3>
                    <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">{algo.family}</span>
                  </div>
                  <div className="font-mono text-[11px] bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 rounded px-2.5 py-1.5 text-slate-800 dark:text-slate-200 overflow-x-auto">
                    {algo.formula}
                  </div>
                  <div className="text-xs text-slate-700 dark:text-slate-200 space-y-1">
                    <div>
                      <span className="font-medium text-slate-900 dark:text-slate-100">Initialization:</span> {algo.initialization}
                    </div>
                    <div>
                      <span className="font-medium text-slate-900 dark:text-slate-100">Parameters:</span> {algo.hyperparameters}
                    </div>
                    <div>
                      <span className="font-medium text-slate-900 dark:text-slate-100">Best suited for:</span> {algo.bestFor}
                    </div>
                    <div className="text-amber-700 dark:text-amber-400">
                      <span className="font-medium">Limitation:</span> {algo.limitations}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </Panel>

          {/* Benchmark Methodology, PRNG & Transparent Limitations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel
              title="Synthetic generator & reproducibility specification"
              subtitle="Deterministic Mulberry32 PRNG + Box-Muller Gaussian transforms"
            >
              <div className="space-y-2.5 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                <p>
                  All 5 canonical synthetic regimes (<span className="font-mono">n={config.synthLength}</span>, base <span className="font-mono">{config.synthBase}</span>, noise <span className="font-mono">σ={config.synthNoise}</span>, seed <span className="font-mono">#{config.seed}</span>) use identical deterministic PRNG constants (<span className="font-mono">0x6d2b79f5</span>) across Node.js tests and browser runs:
                </p>
                <ul className="list-disc pl-4 space-y-1 text-[11px] font-mono text-slate-700 dark:text-slate-200">
                  <li>stationary: max(1, round(base + N(0,1) · σ))</li>
                  <li>trend: max(1, round(base · (1 + 0.035·t) + N(0,1) · σ))</li>
                  <li>seasonal: max(1, round(base · (1 + 0.32·sin(2πt/12)) + N(0,1) · 0.5σ))</li>
                  <li>intermittent: Bernoulli(0.32) · max(1, round(85·(0.4 + 1.2·U)))</li>
                  <li>structural-break: (t &lt; ⌊n/2⌋ ? base : 1.55·base) + N(0,1) · σ</li>
                </ul>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 pt-1">
                  Independent verification: click <span className="font-semibold">Export Benchmark JSON</span> to download exact raw numeric series, config, checksums, and per-series metrics; re-import via <span className="font-semibold">Load / Verify JSON</span> to audit exact checksum reproducibility.
                </p>
              </div>
            </Panel>

            <Panel
              title="Methodological assumptions & known limitations"
              subtitle="Explicit scope boundaries for academic & operational review"
            >
              <ul className="space-y-2.5 text-xs">
                {BENCHMARK_LIMITATIONS.map((lim) => (
                  <li key={lim.id} className="space-y-0.5">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{lim.title}</div>
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{lim.detail}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
};
