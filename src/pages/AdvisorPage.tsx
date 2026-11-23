import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Check, FileText, RotateCcw, Save, Sliders } from 'lucide-react';
import { BarChart } from '../components/charts/Charts';
import { RouteId } from '../components/layout/AppShell';
import { Button, EmptyState, Modal, ModuleSkeleton, Panel, SegmentedControl, StatCard } from '../components/ui/Primitives';

const DecisionAssistantPanel = lazy(() =>
  import('../components/assistant/DecisionAssistantPanel').then((m) => ({ default: m.DecisionAssistantPanel }))
);
import {
  advisorAnalyse,
  AdvisorFinding,
  advisorHealth,
  advisorPolicyFromSettings,
  advisorScenario,
  DEFAULT_ADVISOR_POLICY,
} from '../engine/advisor';
import { compactMoney, fmtInt, fmtMoney, fmtNum } from '../engine/formatters';
import { Product } from '../store/store';
import { useStore } from '../store/StoreContext';

function parseAdvisorHashParams(): { tab: 'audit' | 'assistant'; sku: string | null; q: string | null } {
  if (typeof window === 'undefined') return { tab: 'audit', sku: null, q: null };
  const hash = window.location.hash || '';
  const queryPart = hash.includes('?') ? hash.split('?')[1] : '';
  const sp = new URLSearchParams(queryPart);
  const tab = sp.get('tab') === 'assistant' ? 'assistant' : 'audit';
  return {
    tab,
    sku: sp.get('sku'),
    q: sp.get('q'),
  };
}

export const AdvisorPage: React.FC<{
  onNavigate: (r: RouteId) => void;
  onOpenProduct: (p: Product) => void;
  onEditProduct: (p: Product) => void;
}> = ({ onNavigate, onOpenProduct, onEditProduct }) => {
  const { products, transactions, settings, summary, metricsOf, updateProduct, moveStock, setSetting, pushToast } =
    useStore();

  const initialHash = useMemo(() => parseAdvisorHashParams(), []);
  const [advisorMode, setAdvisorMode] = useState<'audit' | 'assistant'>(initialHash.tab);
  const [assistantSku, setAssistantSku] = useState<string | null>(initialHash.sku);
  const [assistantQuery, setAssistantQuery] = useState<string | null>(initialHash.q);

  useEffect(() => {
    const onHash = () => {
      const next = parseAdvisorHashParams();
      if (next.tab === 'assistant' || next.sku || next.q) {
        setAdvisorMode(next.tab);
        if (next.sku) setAssistantSku(next.sku);
        if (next.q) setAssistantQuery(next.q);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const savedPolicy = useMemo(() => advisorPolicyFromSettings(settings), [settings]);
  const [simCover, setSimCover] = useState<number>(savedPolicy.cover);
  const [simSlLow, setSimSlLow] = useState<number>(savedPolicy.band[0]);
  const [simSlHigh, setSimSlHigh] = useState<number>(savedPolicy.band[1]);
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);

  useEffect(() => {
    setSimCover(savedPolicy.cover);
    setSimSlLow(savedPolicy.band[0]);
    setSimSlHigh(savedPolicy.band[1]);
  }, [savedPolicy]);

  const rows = useMemo(() => products.map((p) => ({ p, m: metricsOf(p) })), [products, metricsOf]);

  const activePolicy = useMemo(
    () => ({
      ...savedPolicy,
      cover: simCover,
      band: [Math.min(simSlLow, simSlHigh), Math.max(simSlLow, simSlHigh)] as [number, number],
    }),
    [savedPolicy, simCover, simSlLow, simSlHigh]
  );

  const analysis = useMemo(
    () => advisorAnalyse(rows, transactions, activePolicy),
    [rows, transactions, activePolicy]
  );
  const health = useMemo(
    () => advisorHealth(rows, analysis.findings, analysis.totals, summary),
    [rows, analysis, summary]
  );
  const scenario = useMemo(
    () =>
      advisorScenario(
        rows,
        { cover: simCover, band: [Math.min(simSlLow, simSlHigh), Math.max(simSlLow, simSlHigh)] },
        savedPolicy
      ),
    [rows, simCover, simSlLow, simSlHigh, savedPolicy]
  );

  const visibleFindings = useMemo(
    () =>
      kindFilter === 'all'
        ? analysis.findings
        : analysis.findings.filter((f) => f.kind === kindFilter),
    [analysis.findings, kindFilter]
  );

  const categoryStakes = useMemo(() => {
    const map: Record<string, number> = {};
    analysis.findings.forEach((f) => {
      if (f.money == null) return;
      const cat = f.product.category || 'Other';
      map[cat] = (map[cat] || 0) + f.money;
    });
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
    return {
      labels: sorted.map(([c]) => c),
      values: sorted.map(([, v]) => v),
    };
  }, [analysis.findings]);

  const policyFindings = useMemo(
    () => analysis.findings.filter((f) => f.action.type === 'set-sl'),
    [analysis.findings]
  );

  const handleFindingAction = (f: AdvisorFinding) => {
    if (f.action.type === 'open') {
      onOpenProduct(f.product);
    } else if (f.action.type === 'edit') {
      onEditProduct(f.product);
    } else if (f.action.type === 'receive') {
      moveStock(f.product.id, 'in', f.action.qty, `Advisor replenishment — ${f.sku}`);
      pushToast({
        type: 'success',
        message: `Received ${fmtInt(f.action.qty)} ${f.product.unit} of ${f.sku}.`,
      });
    } else if (f.action.type === 'set-sl') {
      updateProduct(f.product.id, { serviceLevel: f.action.value });
      pushToast({
        type: 'success',
        message: `Updated ${f.sku} service level to ${f.action.value}%.`,
      });
    }
  };

  const savePolicy = () => {
    const lo = Math.min(simSlLow, simSlHigh);
    const hi = Math.max(simSlLow, simSlHigh);
    setSetting('advCover', simCover);
    setSetting('advSlLow', lo);
    setSetting('advSlHigh', hi);
    pushToast({
      type: 'success',
      message: `Saved plant policy (${simCover} mo cover · ${lo}–${hi}% SL) — synced to Executive Brief.`,
    });
  };

  const resetPolicy = () => {
    setSimCover(DEFAULT_ADVISOR_POLICY.cover);
    setSimSlLow(DEFAULT_ADVISOR_POLICY.band[0]);
    setSimSlHigh(DEFAULT_ADVISOR_POLICY.band[1]);
    setSetting('advCover', DEFAULT_ADVISOR_POLICY.cover);
    setSetting('advSlLow', DEFAULT_ADVISOR_POLICY.band[0]);
    setSetting('advSlHigh', DEFAULT_ADVISOR_POLICY.band[1]);
    pushToast({ type: 'info', message: 'Reset advisor policy to catalogue defaults.' });
  };

  const applyAllPolicyFixes = () => {
    let changed = 0;
    policyFindings.forEach((f) => {
      if (f.action.type === 'set-sl') {
        updateProduct(f.product.id, { serviceLevel: f.action.value });
        changed++;
      }
    });
    setConfirmBulkOpen(false);
    pushToast({
      type: 'success',
      message: `Aligned service levels for ${changed} SKU(s) to ${simSlLow}–${simSlHigh}%.`,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={advisorMode}
          onChange={(v) => setAdvisorMode(v === 'assistant' ? 'assistant' : 'audit')}
          options={[
            { value: 'audit', label: 'Policy Audit & Simulator' },
            { value: 'assistant', label: 'Decision Assistant' },
          ]}
        />
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {advisorMode === 'assistant'
            ? 'Deterministic Engines + Optional Server-Side Gemini Synthesis'
            : `Active Policy: ${fmtNum(simCover, 1)} mo cover · ${fmtNum(simSlLow, 1)}–${fmtNum(simSlHigh, 1)}% SL`}
        </span>
      </div>

      {advisorMode === 'assistant' ? (
        <Suspense fallback={<ModuleSkeleton label="Loading Decision Assistant…" />}>
          <DecisionAssistantPanel
            onNavigate={onNavigate}
            initialSku={assistantSku}
            initialQuestion={assistantQuery}
          />
        </Suspense>
      ) : !products.length ? (
        <EmptyState
          title="No SKUs to audit"
          message="Add inventory items first to generate priced excess-cover, stockout, and service-level findings."
        />
      ) : (
        <>
          {/* Top Health + Priced Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <StatCard
          label="Inventory health"
          value={`${health.score}/100`}
          sub={`${health.label}${health.reasons.length ? ` · ${health.reasons.slice(0, 2).join(', ')}` : ''}`}
          tone={health.score >= 85 ? 'good' : health.score >= 70 ? 'warn' : 'bad'}
        />
        <StatCard
          label="Cash parked"
          value={fmtMoney(analysis.totals.parkedCash)}
          sub={`Above ${fmtNum(simCover, 1)}-mo cover target`}
          tone={analysis.totals.parkedCash > 0 ? 'warn' : 'good'}
        />
        <StatCard
          label="Replenishment due"
          value={fmtMoney(analysis.totals.orderValue)}
          sub="At or below ROP"
          tone={analysis.totals.orderValue > 0 ? 'bad' : 'good'}
        />
        <StatCard
          label="Annual saving"
          value={fmtMoney(analysis.totals.annualSaving)}
          sub="Right-sizing over-specified SL"
          tone={analysis.totals.annualSaving > 0 ? 'good' : 'neutral'}
        />
        <StatCard
          label="Open findings"
          value={fmtInt(analysis.totals.problems)}
          sub={`${analysis.totals.priced} priced · ${analysis.findings.filter((f) => f.kind === 'data').length} data gaps`}
        />
      </div>

      {/* Policy Simulator + Value at Stake */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Panel
          title="Policy simulator"
          subtitle="Test cover targets and service-level guardrails live, then save to sync Executive Brief"
          className="lg:col-span-7"
          actions={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={resetPolicy}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onNavigate('brief')}>
                <FileText className="h-3.5 w-3.5" /> Open Brief
              </Button>
              <Button size="sm" variant="primary" onClick={savePolicy}>
                <Save className="h-3.5 w-3.5" /> Save policy
              </Button>
            </div>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-700 dark:text-slate-300">Cover target</span>
                <span className="font-mono tabular-nums text-[var(--accent)] font-semibold">
                  {fmtNum(simCover, 1)} mo
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={6}
                step={0.5}
                value={simCover}
                onChange={(e) => setSimCover(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-700 dark:text-slate-300">Service floor</span>
                <span className="font-mono tabular-nums text-[var(--accent)] font-semibold">
                  {fmtNum(simSlLow, 1)}%
                </span>
              </div>
              <input
                type="range"
                min={85}
                max={99}
                step={0.5}
                value={simSlLow}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSimSlLow(v);
                  if (v > simSlHigh) setSimSlHigh(v);
                }}
                className="w-full accent-[var(--accent)]"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-700 dark:text-slate-300">Service ceiling</span>
                <span className="font-mono tabular-nums text-[var(--accent)] font-semibold">
                  {fmtNum(simSlHigh, 1)}%
                </span>
              </div>
              <input
                type="range"
                min={90}
                max={99.5}
                step={0.5}
                value={simSlHigh}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSimSlHigh(v);
                  if (v < simSlLow) setSimSlLow(v);
                }}
                className="w-full accent-[var(--accent)]"
              />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-slate-500">Cash delta vs saved</div>
              <div className="font-mono tabular-nums font-semibold mt-0.5">
                {scenario.deltaCash >= 0 ? '+' : '−'}
                {fmtMoney(Math.abs(scenario.deltaCash))}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Holding delta /yr</div>
              <div className="font-mono tabular-nums font-semibold mt-0.5">
                {scenario.carryingDelta >= 0 ? '+' : '−'}
                {fmtMoney(Math.abs(scenario.carryingDelta))}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Weighted service</div>
              <div className="font-mono tabular-nums font-semibold mt-0.5">
                {fmtNum(scenario.slNow, 1)}% → {fmtNum(scenario.slAfter, 1)}%
              </div>
            </div>
            <div>
              <div className="text-slate-500">Policy shifts</div>
              <div className="font-mono tabular-nums font-semibold mt-0.5">
                {scenario.policyItems} SL · {scenario.coverItems} cover
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title="Value at stake by category"
          subtitle="Combined parked cash, replenishment order spend, and holding adjustments"
          className="lg:col-span-5"
        >
          <BarChart
            horizontal
            labels={categoryStakes.labels}
            series={[{ name: 'Value at stake', data: categoryStakes.values }]}
            formatValue={(v) => compactMoney(v)}
          />
        </Panel>
      </div>

      {/* Findings Feed */}
      <Panel
        title="Audited findings"
        subtitle="Prioritized by financial impact — trigger single-item actions or align policy in bulk"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              value={kindFilter}
              onChange={setKindFilter}
              options={[
                { value: 'all', label: `All (${analysis.findings.length})` },
                { value: 'cash', label: `Cash (${analysis.findings.filter((f) => f.kind === 'cash').length})` },
                { value: 'stock', label: `Stock (${analysis.findings.filter((f) => f.kind === 'stock').length})` },
                { value: 'policy', label: `Policy (${analysis.findings.filter((f) => f.kind === 'policy').length})` },
                { value: 'data', label: `Data (${analysis.findings.filter((f) => f.kind === 'data').length})` },
              ]}
            />
            {policyFindings.length > 0 && (
              <Button size="sm" variant="primary" onClick={() => setConfirmBulkOpen(true)}>
                <Sliders className="h-3.5 w-3.5" /> Apply {policyFindings.length} policy fix
                {policyFindings.length > 1 ? 'es' : ''}
              </Button>
            )}
          </div>
        }
      >
        {visibleFindings.length ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md">
            {visibleFindings.map((f) => {
              const sevDot =
                f.severity === 'bad'
                  ? 'bg-rose-500'
                  : f.severity === 'warn'
                    ? 'bg-amber-500'
                    : 'bg-blue-500';
              return (
                <div
                  key={f.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${sevDot}`} />
                      <span className="font-mono text-slate-500">{f.sku}</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {f.title}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 pl-4">{f.detail}</p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 pl-4 sm:pl-0 shrink-0">
                    <span className="font-mono tabular-nums text-xs font-medium text-slate-700 dark:text-slate-200">
                      {f.impactLabel}
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => handleFindingAction(f)}>
                      {f.action.label}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-slate-500">
            No open findings under the selected filter.
          </div>
        )}
      </Panel>

      <Modal
        open={confirmBulkOpen}
        onClose={() => setConfirmBulkOpen(false)}
        title="Align service levels to active policy"
        subtitle={`Updates ${policyFindings.length} SKU(s) to stay within ${simSlLow}% – ${simSlHigh}%`}
        maxWidth="max-w-md"
      >
        <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
          <p>
            This updates each flagged SKU’s target service level to match your floor/ceiling policy band and
            immediately recalculates safety stock and reorder points.
          </p>
          <div className="border border-slate-200 dark:border-slate-800 rounded divide-y divide-slate-100 dark:divide-slate-800 max-h-48 overflow-y-auto">
            {policyFindings.map((f) => (
              <div key={f.id} className="px-3 py-2 flex items-center justify-between">
                <span className="font-mono">{f.sku}</span>
                <span>
                  {f.product.serviceLevel}% →{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {f.action.type === 'set-sl' ? f.action.value : ''}%
                  </strong>
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setConfirmBulkOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={applyAllPolicyFixes}>
              <Check className="h-3.5 w-3.5" /> Apply changes
            </Button>
          </div>
        </div>
      </Modal>
        </>
      )}
    </div>
  );
};
