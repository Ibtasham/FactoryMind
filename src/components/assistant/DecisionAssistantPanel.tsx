import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  ExternalLink,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { RouteId } from '../layout/AppShell';
import { Button, Panel } from '../ui/Primitives';
import {
  AssistantProposedAction,
  AssistantResponse,
  buildAssistantWorkspaceContext,
  DECISION_STARTER_PROMPTS,
  ProvenanceTag,
  runDeterministicDecisionQuery,
} from '../../engine/decisionAssistant';
import { fmtInt, fmtNum } from '../../engine/formatters';
import { useStore } from '../../store/StoreContext';

interface GeminiStatusPayload {
  geminiConfigured: boolean;
  model: string;
  engineMode: string;
}

interface GeminiSynthesisPayload {
  executiveNarrative: string;
  keyInsights: string[];
  riskCaveats: string[];
  recommendedNextStep: string;
  followUpQuestions: string[];
}

interface AiExplainState {
  status: 'idle' | 'loading' | 'ready' | 'unconfigured' | 'error';
  model?: string;
  message?: string;
  synthesis?: GeminiSynthesisPayload;
}

function provenanceLabel(tag: ProvenanceTag): string {
  switch (tag) {
    case 'DETERMINISTIC_ENGINE':
      return 'Deterministic Engine';
    case 'SCENARIO_SIMULATION_MODEL':
      return 'Simulated Model Output';
    case 'WORKSPACE_CATALOG':
      return 'Workspace Catalog';
    case 'AI_SYNTHESIS_GROUNDED':
      return 'Gemini Narrative (Grounded)';
  }
}

export const DecisionAssistantPanel: React.FC<{
  onNavigate: (r: RouteId) => void;
  initialSku?: string | null;
  initialQuestion?: string | null;
}> = ({ onNavigate, initialSku = null, initialQuestion = null }) => {
  const {
    products,
    transactions,
    settings,
    summary,
    metricsOf,
    lineBalance,
    factorySimConfig,
    smartAlertsResult,
    moveStock,
    updateProduct,
    saveScenarioStudioRecord,
    applyScenarioToWorkspace,
    pushToast,
  } = useStore();

  const [focusedSku, setFocusedSku] = useState<string>(initialSku || '');
  const [questionInput, setQuestionInput] = useState<string>(
    initialQuestion || DECISION_STARTER_PROMPTS[0].question
  );
  const [history, setHistory] = useState<AssistantResponse[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [approvedActionIds, setApprovedActionIds] = useState<Record<string, boolean>>({});
  const [traceExpanded, setTraceExpanded] = useState<boolean>(true);
  const [autoAiSynthesis, setAutoAiSynthesis] = useState<boolean>(false);

  const [backendStatus, setBackendStatus] = useState<GeminiStatusPayload | null>(null);
  const [statusLoading, setStatusLoading] = useState<boolean>(true);
  const [aiByResponseId, setAiByResponseId] = useState<Record<string, AiExplainState>>({});

  useEffect(() => {
    if (initialSku) setFocusedSku(initialSku);
  }, [initialSku]);

  // Query server capability without exposing any secrets
  useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);
    fetch(`${import.meta.env.BASE_URL}api/assistant/status`)
      .then(async (res) => {
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('application/json')) throw new Error(`Status ${res.status}`);
        return (await res.json()) as GeminiStatusPayload;
      })
      .then((data) => {
        if (!cancelled) {
          setBackendStatus(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBackendStatus({
            geminiConfigured: false,
            model: 'gemini-4-hydrogen',
            engineMode: 'deterministic-only',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const assistantCtx = useMemo(
    () =>
      buildAssistantWorkspaceContext({
        products,
        transactions,
        settings,
        summary,
        metricsOf,
        lineBalance,
        factorySimConfig,
        smartAlertsResult,
        focusedSku: focusedSku || null,
      }),
    [
      products,
      transactions,
      settings,
      summary,
      metricsOf,
      lineBalance,
      factorySimConfig,
      smartAlertsResult,
      focusedSku,
    ]
  );

  const requestGeminiSynthesis = useCallback(async (resp: AssistantResponse) => {
    setAiByResponseId((prev) => ({
      ...prev,
      [resp.id]: { status: 'loading' },
    }));
    try {
      const httpRes = await fetch(`${import.meta.env.BASE_URL}api/assistant/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: resp.question,
          groundingDossier: resp.groundingDossier,
        }),
      });
      const ct = httpRes.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        setAiByResponseId((prev) => ({
          ...prev,
          [resp.id]: {
            status: 'unconfigured',
            message:
              'Static hosting detected (no /api/assistant backend). Deterministic FactoryMind outputs remain active and authoritative.',
          },
        }));
        return;
      }
      const payload = (await httpRes.json()) as {
        code?: string;
        error?: string;
        model?: string;
        synthesis?: GeminiSynthesisPayload;
      };
      if (!httpRes.ok) {
        const isMissingKey = payload.code === 'GEMINI_NOT_CONFIGURED';
        setAiByResponseId((prev) => ({
          ...prev,
          [resp.id]: {
            status: isMissingKey ? 'unconfigured' : 'error',
            message:
              payload.error ||
              'Server AI synthesis is unavailable. Deterministic FactoryMind outputs remain authoritative.',
          },
        }));
        return;
      }
      if (!payload.synthesis) {
        throw new Error('Malformed server synthesis payload.');
      }
      setAiByResponseId((prev) => ({
        ...prev,
        [resp.id]: {
          status: 'ready',
          model: payload.model || 'gemini-4-hydrogen',
          synthesis: payload.synthesis,
        },
      }));
    } catch (err) {
      setAiByResponseId((prev) => ({
        ...prev,
        [resp.id]: {
          status: 'error',
          message: err instanceof Error ? err.message : 'Unable to reach AI explanation endpoint.',
        },
      }));
    }
  }, []);

  const submitQuestion = useCallback(
    (qText: string) => {
      const cleaned = qText.trim();
      if (!cleaned) return;
      setQuestionInput(cleaned);
      const result = runDeterministicDecisionQuery(cleaned, assistantCtx);
      setHistory((prev) => [result, ...prev.slice(0, 11)]);
      setActiveId(result.id);
      if (autoAiSynthesis && backendStatus?.geminiConfigured) {
        void requestGeminiSynthesis(result);
      }
    },
    [assistantCtx, autoAiSynthesis, backendStatus?.geminiConfigured, requestGeminiSynthesis]
  );

  // Seed initial deterministic briefing cleanly on first load
  useEffect(() => {
    if (history.length === 0) {
      const seedQ = initialQuestion || DECISION_STARTER_PROMPTS[0].question;
      const first = runDeterministicDecisionQuery(seedQ, assistantCtx);
      setHistory([first]);
      setActiveId(first.id);
    }
  }, [history.length, initialQuestion, assistantCtx]);

  const activeResponse = useMemo(
    () => history.find((item) => item.id === activeId) ?? history[0] ?? null,
    [history, activeId]
  );

  const activeAiState: AiExplainState = activeResponse
    ? aiByResponseId[activeResponse.id] ?? { status: 'idle' }
    : { status: 'idle' };

  const handleApproveAction = (action: AssistantProposedAction) => {
    if (approvedActionIds[action.id]) return;

    if (action.kind === 'receive-stock' && action.productId && action.qty) {
      moveStock(
        action.productId,
        'in',
        action.qty,
        `Decision Assistant approved replenishment — ${action.sku || action.productId}`
      );
      pushToast({
        type: 'success',
        message: `Approved & recorded +${fmtInt(action.qty)} units for ${action.sku || 'SKU'}.`,
      });
    } else if (action.kind === 'update-service-level' && action.productId && action.serviceLevel != null) {
      updateProduct(action.productId, { serviceLevel: action.serviceLevel });
      pushToast({
        type: 'success',
        message: `Approved service level update for ${action.sku} → ${action.serviceLevel}%.`,
      });
    } else if (action.kind === 'align-over-sl-bulk' && action.bulkUpdates?.length) {
      action.bulkUpdates.forEach((u) => {
        updateProduct(u.productId, { serviceLevel: u.value });
      });
      pushToast({
        type: 'success',
        message: `Approved policy ceiling alignment for ${action.bulkUpdates.length} SKU(s).`,
      });
    } else if (action.kind === 'save-scenario' && action.scenarioDefinition) {
      saveScenarioStudioRecord(action.scenarioDefinition);
      pushToast({
        type: 'success',
        message: `Saved "${action.scenarioDefinition.name}" to Scenario Studio.`,
      });
    } else if (action.kind === 'apply-scenario' && action.scenarioDefinition) {
      saveScenarioStudioRecord(action.scenarioDefinition);
      applyScenarioToWorkspace(action.scenarioDefinition);
      pushToast({
        type: 'success',
        message: `Approved & applied "${action.scenarioDefinition.name}" to live workspace.`,
      });
    }

    setApprovedActionIds((prev) => ({ ...prev, [action.id]: true }));
  };

  return (
    <div className="space-y-4">
      {/* Query Console & Workspace Context */}
      <Panel
        title="Decision Intelligence Assistant"
        subtitle="Natural-language operational Q&A backed deterministically by FactoryMind engines and optional server-side Gemini synthesis"
        actions={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              Deterministic Engines Authoritative
            </span>
            <span aria-hidden="true" className="hidden sm:inline text-slate-300 dark:text-slate-700">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
              <Cpu className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              {statusLoading
                ? 'Checking Gemini server...'
                : backendStatus?.geminiConfigured
                  ? `Server AI Ready (${backendStatus.model})`
                  : 'Deterministic-Only Mode (No Server API Key)'}
            </span>
          </div>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitQuestion(questionInput);
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
            <div className="lg:col-span-3">
              <label
                htmlFor="da-focus-sku"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Context SKU (optional)
              </label>
              <select
                id="da-focus-sku"
                value={focusedSku}
                onChange={(e) => setFocusedSku(e.target.value)}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
              >
                <option value="">Auto-detect from query / top urgency</option>
                {products.map((p) => (
                  <option key={p.id} value={p.sku}>
                    {p.sku} · {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-7">
              <label
                htmlFor="da-question-input"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Ask an operational, inventory, MRP, bottleneck, or counterfactual question
              </label>
              <input
                id="da-question-input"
                type="text"
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                placeholder="e.g., What would happen if supplier lead time increased by 20%?"
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
              />
            </div>

            <div className="lg:col-span-2 flex items-center justify-end gap-2">
              <Button type="submit" variant="primary" className="w-full whitespace-nowrap shrink-0">
                <Send className="h-3.5 w-3.5" /> Ask Assistant
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sample decision queries">
              {DECISION_STARTER_PROMPTS.map((starter) => (
                <button
                  key={starter.id}
                  type="button"
                  onClick={() => submitQuestion(starter.question)}
                  className={`px-2.5 py-1.5 rounded-md border text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    activeResponse?.question === starter.question
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/60 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {starter.label}
                </button>
              ))}
            </div>

            {backendStatus?.geminiConfigured && (
              <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={autoAiSynthesis}
                  onChange={(e) => setAutoAiSynthesis(e.target.checked)}
                  className="rounded border-slate-300 accent-[var(--accent)]"
                />
                <span>Auto-synthesize with Gemini</span>
              </label>
            )}
          </div>
        </form>
      </Panel>

      {/* Main Split: History Rail + Structured Authoritative Output */}
      {activeResponse && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Session History Rail */}
          <aside className="lg:col-span-3 space-y-2">
            <Panel title="Query History" subtitle={`${history.length} analysis snapshot(s)`}>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 -mx-4 -my-4">
                {history.map((item) => {
                  const selected = item.id === activeResponse.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveId(item.id)}
                      className={`w-full text-left px-4 py-2.5 transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[var(--accent-soft)] text-slate-900 dark:text-white'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="text-xs font-medium line-clamp-2">{item.question}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        <span>{item.intent.replace('_', ' ')}</span>
                        {item.focusedSku && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{item.focusedSku}</span>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </aside>

          {/* Right Authoritative Analysis & Optional AI Narrative */}
          <div className="lg:col-span-9 space-y-4">
            <Panel
              title={activeResponse.headline}
              subtitle={`Sources: ${activeResponse.provenanceBadges.map(provenanceLabel).join(' · ')}`}
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void requestGeminiSynthesis(activeResponse)}
                  disabled={activeAiState.status === 'loading'}
                  className="whitespace-nowrap shrink-0"
                >
                  {activeAiState.status === 'loading' ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {activeAiState.status === 'ready' ? 'Refresh Gemini Synthesis' : 'Synthesize with Gemini'}
                </Button>
              }
            >
              <div className="space-y-5">
                {/* Explicit Insufficient Data Warnings */}
                {activeResponse.insufficientDataWarnings.length > 0 && (
                  <div
                    role="alert"
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-200 space-y-1.5"
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>Data Sufficiency Guardrail</span>
                    </div>
                    <ul className="list-disc pl-5 space-y-1">
                      {activeResponse.insufficientDataWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Authoritative Summary Bullets */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Computed Findings (Authoritative Numerical Basis)
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                    {activeResponse.summaryBullets.map((b, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="font-mono text-slate-400 mt-0.5">{String(i + 1).padStart(2, '0')}.</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Optional Server-Side Gemini Narrative Synthesis (Positioned Directly Under Computed Findings) */}
                {activeAiState.status !== 'idle' && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800 pb-2.5">
                      <div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          AI Executive Narrative Synthesis (Grounded on Computed Facts)
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {activeAiState.status === 'ready'
                            ? `Synthesized via server-side ${activeAiState.model} · Explanatory prose only (authoritative numbers remain below)`
                            : 'Server-side Gemini explanation channel'}
                        </div>
                      </div>
                      {activeAiState.status === 'error' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void requestGeminiSynthesis(activeResponse)}
                          className="whitespace-nowrap shrink-0"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Retry Synthesis
                        </Button>
                      )}
                    </div>

                    {activeAiState.status === 'loading' && (
                      <div className="space-y-2 animate-pulse" aria-busy="true">
                        <div className="h-3.5 w-5/6 rounded bg-slate-200 dark:bg-slate-800" />
                        <div className="h-3.5 w-2/3 rounded bg-slate-200 dark:bg-slate-800" />
                        <div className="h-3.5 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
                      </div>
                    )}

                    {(activeAiState.status === 'unconfigured' || activeAiState.status === 'error') && (
                      <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                        <div className="font-semibold text-slate-800 dark:text-slate-100">
                          {activeAiState.status === 'unconfigured'
                            ? 'Server-Side Gemini API Not Configured — Deterministic Engine Mode Active'
                            : 'Gemini Explanation Temporarily Unavailable'}
                        </div>
                        <p>{activeAiState.message}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          All deterministic inventory calculations, MRP explosions, DES runs, and scenario comparisons
                          remain unaffected and fully operational.
                        </p>
                      </div>
                    )}

                    {activeAiState.status === 'ready' && activeAiState.synthesis && (
                      <div className="space-y-4 text-xs text-slate-700 dark:text-slate-200">
                        <p className="leading-relaxed">{activeAiState.synthesis.executiveNarrative}</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                              Key Takeaways
                            </div>
                            <ul className="list-disc pl-4 space-y-1">
                              {activeAiState.synthesis.keyInsights.map((ins, i) => (
                                <li key={i}>{ins}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                              Risk &amp; Model Caveats
                            </div>
                            <ul className="list-disc pl-4 space-y-1">
                              {activeAiState.synthesis.riskCaveats.map((cav, i) => (
                                <li key={i}>{cav}</li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-semibold text-slate-900 dark:text-white">
                              Recommended Next Step:{' '}
                            </span>
                            <span>{activeAiState.synthesis.recommendedNextStep}</span>
                          </div>
                        </div>

                        {activeAiState.synthesis.followUpQuestions.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">Follow up:</span>
                            {activeAiState.synthesis.followUpQuestions.map((fq, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => submitQuestion(fq)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-[var(--accent)] text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer"
                              >
                                <span>{fq}</span>
                                <ArrowRight className="h-3 w-3" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Verified Numerical Facts Table */}
                {activeResponse.facts.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                      Verified Metrics &amp; Source Attribution
                    </div>
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                            <th className="py-2 px-3 font-medium">Metric</th>
                            <th className="py-2 px-3 font-medium whitespace-nowrap">Computed Value</th>
                            <th className="py-2 px-3 font-medium whitespace-nowrap">Context / Unit</th>
                            <th className="py-2 px-3 font-medium whitespace-nowrap">Source Engine</th>
                            <th className="py-2 px-3 font-medium whitespace-nowrap">Origin</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {activeResponse.facts.map((fact, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/35">
                              <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                                {fact.label}
                              </td>
                              <td className="py-2 px-3 font-mono tabular-nums font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                                {fact.value}
                              </td>
                              <td className="py-2 px-3 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                                {fact.unit || '—'}
                              </td>
                              <td className="py-2 px-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                {fact.sourceEngine}
                              </td>
                              <td className="py-2 px-3 text-[11px] font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                {provenanceLabel(fact.provenance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Supporting Analytical Tables */}
                {activeResponse.tables.map((tbl, tIdx) => (
                  <div key={tIdx} className="space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-100">{tbl.title}</h3>
                      {tbl.caption && (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">{tbl.caption}</span>
                      )}
                    </div>
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                            {tbl.columns.map((col, cIdx) => (
                              <th key={cIdx} className="py-2 px-3 font-medium whitespace-nowrap">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {tbl.rows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/35">
                              {row.map((cell, cIdx) => (
                                <td
                                  key={cIdx}
                                  className={`py-2 px-3 ${
                                    cIdx === 0
                                      ? 'font-medium text-slate-900 dark:text-slate-100'
                                      : 'font-mono tabular-nums text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {/* Transparent Reasoning & Assumptions Trace */}
                <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                  <button
                    type="button"
                    aria-expanded={traceExpanded}
                    onClick={() => setTraceExpanded((v) => !v)}
                    className="flex items-center justify-between w-full text-left text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  >
                    <span>Reasoning Trace &amp; Modeling Assumptions ({activeResponse.reasoningSteps.length} steps)</span>
                    {traceExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>

                  {traceExpanded && (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600 dark:text-slate-400">
                      <div>
                        <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                          Calculation Sequence
                        </div>
                        <ol className="list-decimal pl-4 space-y-1">
                          {activeResponse.reasoningSteps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                          Active Model Assumptions
                        </div>
                        <ul className="list-disc pl-4 space-y-1">
                          {activeResponse.assumptions.length ? (
                            activeResponse.assumptions.map((a, i) => <li key={i}>{a}</li>)
                          ) : (
                            <li>No parametric forecast/simulation assumptions active for this lookup.</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>

                {/* User Approval Gate for Proposed Operational Actions */}
                {activeResponse.proposedActions.length > 0 && (
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          Proposed Actions (User Approval Required)
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          FactoryMind never alters stock balances, policies, or simulation parameters automatically.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {activeResponse.proposedActions.map((act) => {
                        const isApproved = Boolean(approvedActionIds[act.id]);
                        return (
                          <div
                            key={act.id}
                            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3.5 space-y-3"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="space-y-0.5">
                                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                  {act.label}
                                </div>
                                <div className="text-xs text-slate-600 dark:text-slate-400">{act.description}</div>
                              </div>
                              <Button
                                size="sm"
                                variant={isApproved ? 'secondary' : 'primary'}
                                disabled={isApproved}
                                onClick={() => handleApproveAction(act)}
                                className="whitespace-nowrap shrink-0"
                              >
                                {isApproved ? (
                                  <>
                                    <Check className="h-3.5 w-3.5 text-emerald-500" /> Approved &amp; Applied
                                  </>
                                ) : (
                                  <>
                                    <Check className="h-3.5 w-3.5" /> Approve &amp; Apply
                                  </>
                                )}
                              </Button>
                            </div>

                            {act.previewDiff.length > 0 && (
                              <div className="overflow-x-auto border border-slate-200/80 dark:border-slate-800 rounded bg-white dark:bg-slate-900/70">
                                <table className="w-full text-left text-[11px]">
                                  <thead>
                                    <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500">
                                      <th className="py-1.5 px-2.5 font-medium">Target</th>
                                      <th className="py-1.5 px-2.5 font-medium">Parameter</th>
                                      <th className="py-1.5 px-2.5 font-medium">Current</th>
                                      <th className="py-1.5 px-2.5 font-medium">After Approval</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                                    {act.previewDiff.map((diff, dIdx) => (
                                      <tr key={dIdx}>
                                        <td className="py-1.5 px-2.5 text-slate-700 dark:text-slate-300">
                                          {diff.target}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-slate-600 dark:text-slate-400 font-sans">
                                          {diff.field}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-slate-500">{diff.before}</td>
                                        <td className="py-1.5 px-2.5 font-semibold text-slate-900 dark:text-white">
                                          {diff.after}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Deep Links to Underlying Engineering Workbenches */}
                {activeResponse.navLinks.length > 0 && (
                  <div className="border-t border-slate-100 dark:border-slate-800 pt-3 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1">
                      Inspect supporting modules:
                    </span>
                    {activeResponse.navLinks.map((lnk, idx) => (
                      <Button
                        key={idx}
                        size="sm"
                        variant="secondary"
                        onClick={() => onNavigate(lnk.route)}
                        title={lnk.contextNote}
                        className="whitespace-nowrap shrink-0"
                      >
                        <span>{lnk.label}</span>
                        <ExternalLink className="h-3 w-3 opacity-70" />
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </Panel>

          </div>
        </div>
      )}

      {/* Subtle footer attribution for simulation parameters */}
      {activeResponse?.proposedScenario && (
        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2 px-1">
          <span>
            Counterfactual Seed #{activeResponse.proposedScenario.definition.params.seed} ·{' '}
            {fmtInt(activeResponse.proposedScenario.definition.params.replications)} DES reps ·{' '}
            Confidence: {fmtNum(activeResponse.proposedScenario.scenario.confidence.scorePct, 0)}/100 (
            {activeResponse.proposedScenario.scenario.confidence.level})
          </span>
          <span>Live workspace remains unmodified until approved</span>
        </div>
      )}
    </div>
  );
};
