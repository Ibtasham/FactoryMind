import React, { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, Circle, Compass, History, Search, Trash2 } from 'lucide-react';
import { RouteId } from '../layout/AppShell';
import { Button, ConfirmDialog, EmptyState, Input, Modal, SegmentedControl } from '../ui/Primitives';
import { relTime } from '../../engine/formatters';
import {
  computeOnboardingProgress,
  HELP_TOPICS,
  MODEL_ASSUMPTIONS,
  ONBOARDING_STEPS,
} from '../../engine/uxHelpers';
import { ActionLogEntry } from '../../store/store';
import { useStore } from '../../store/StoreContext';

export const HelpCenterModal: React.FC<{
  open: boolean;
  onClose: () => void;
  initialTopicId?: string | null;
  onNavigate: (r: RouteId) => void;
  onOpenOnboarding: () => void;
  onOpenShortcuts: () => void;
}> = ({ open, onClose, initialTopicId, onNavigate, onOpenOnboarding, onOpenShortcuts }) => {
  const { datasetProvenance } = useStore();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'guides' | 'models'>('guides');

  const filteredTopics = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return HELP_TOPICS;
    return HELP_TOPICS.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        t.details.toLowerCase().includes(q) ||
        t.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }, [query]);

  const assumptionsList = useMemo(() => {
    const all = Object.values(MODEL_ASSUMPTIONS);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.formula.toLowerCase().includes(q) ||
        m.units.toLowerCase().includes(q) ||
        m.assumptions.some((a) => a.toLowerCase().includes(q))
    );
  }, [query]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Interactive Help & Engineering Reference"
      subtitle={`Active data: ${datasetProvenance.label} · Search workflows, equations, and caveats`}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl
            ariaLabel="Help section tabs"
            value={tab}
            onChange={(v) => setTab(v as 'guides' | 'models')}
            options={[
              { value: 'guides', label: `Workflow Guides (${filteredTopics.length})` },
              { value: 'models', label: `Equations & Assumptions (${assumptionsList.length})` },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onClose();
                onOpenOnboarding();
              }}
            >
              <Compass className="h-3.5 w-3.5" /> Guided Tour
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onClose();
                onOpenShortcuts();
              }}
            >
              Shortcuts
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help topics, EOQ, OEE, MRP, 3D twin, or keyboard accessibility..."
            aria-label="Search help topics"
            className="pl-8 font-sans"
          />
        </div>

        {tab === 'guides' ? (
          filteredTopics.length ? (
            <div className="space-y-2.5">
              {filteredTopics.map((topic) => {
                const highlighted = initialTopicId === topic.id;
                return (
                  <article
                    key={topic.id}
                    className={`rounded-lg border p-3.5 space-y-1.5 ${
                      highlighted
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <BookOpen className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{topic.title}</span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">{topic.category}</span>
                      </div>
                      {topic.route && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            onClose();
                            onNavigate(topic.route as RouteId);
                          }}
                        >
                          Open module <ArrowRight className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{topic.summary}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{topic.details}</p>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No matching help guides"
              message="Try searching for EOQ, simulation, MRP, 3D twin, CSV, or accessibility."
              action={
                <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                  Reset search
                </Button>
              }
            />
          )
        ) : assumptionsList.length ? (
          <div className="space-y-3">
            {assumptionsList.map((spec) => (
              <article
                key={spec.id}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3.5 space-y-2"
              >
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{spec.title}</div>
                <div className="font-mono text-[11px] text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 overflow-x-auto">
                  {spec.formula}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="font-semibold">Units:</span> {spec.units}
                </div>
                <ul className="list-disc pl-4 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                  {spec.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  Caveat: {spec.caveats}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No matching model formulas"
            message="Clear the search filter to browse all industrial engineering equations."
            action={
              <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                Reset search
              </Button>
            }
          />
        )}
      </div>
    </Modal>
  );
};

export const GuidedOnboardingModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onNavigate: (r: RouteId) => void;
}> = ({ open, onClose, onNavigate }) => {
  const { settings, completeOnboardingStep, resetOnboarding, setSetting, datasetProvenance } = useStore();
  const completedIds = settings.onboardingCompletedSteps || [];
  const progress = computeOnboardingProgress(completedIds);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="FactoryMind Guided Tour"
      subtitle={`${progress.completed} of ${progress.total} core workflows explored · ${datasetProvenance.label}`}
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-200">Workbench familiarization</span>
            <span className="font-mono tabular-nums font-semibold text-[var(--accent)]">{progress.pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
          {ONBOARDING_STEPS.map((step, idx) => {
            const done = completedIds.includes(step.id);
            return (
              <div key={step.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <button
                    type="button"
                    aria-label={done ? `${step.title} completed` : `Mark ${step.title} as complete`}
                    onClick={() => completeOnboardingStep(step.id)}
                    className="mt-0.5 text-[var(--accent)] cursor-pointer shrink-0"
                  >
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Circle className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                    )}
                  </button>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {idx + 1}. {step.title}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={done ? 'secondary' : 'primary'}
                  className="shrink-0"
                  onClick={() => {
                    completeOnboardingStep(step.id);
                    onClose();
                    onNavigate(step.route as RouteId);
                  }}
                >
                  {step.ctaLabel} <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              resetOnboarding();
            }}
          >
            Reset checklist
          </Button>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setSetting('onboardingDismissed', true);
                onClose();
              }}
            >
              Hide banner on Dashboard
            </Button>
            <Button size="sm" variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export const ActionHistoryModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onNavigate: (r: RouteId) => void;
}> = ({ open, onClose, onNavigate }) => {
  const { actionLog, clearActionLog, pushToast } = useStore();
  const [catFilter, setCatFilter] = useState<'all' | ActionLogEntry['category']>('all');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const visibleEntries = useMemo(() => {
    if (catFilter === 'all') return actionLog;
    return actionLog.filter((e) => e.category === catFilter);
  }, [actionLog, catFilter]);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Workspace Action History"
        subtitle={`${actionLog.length} recent audit event(s) stored locally across inventory, BOM, scenarios & imports`}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl
              ariaLabel="Filter action history category"
              value={catFilter}
              onChange={(v) => setCatFilter(v as typeof catFilter)}
              options={[
                { value: 'all', label: `All (${actionLog.length})` },
                { value: 'inventory', label: 'Inventory' },
                { value: 'scenario', label: 'Scenarios' },
                { value: 'import', label: 'Imports' },
                { value: 'system', label: 'System' },
              ]}
            />
            {actionLog.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setConfirmClearOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Clear history
              </Button>
            )}
          </div>

          {visibleEntries.length ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg max-h-[52vh] overflow-y-auto">
              {visibleEntries.map((entry) => (
                <div key={entry.id} className="px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <History className="h-3.5 w-3.5 text-[var(--accent)] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{entry.action}</div>
                      <div className="text-slate-600 dark:text-slate-300 mt-0.5">
                        <span className="font-mono uppercase text-[10px] text-slate-500 dark:text-slate-400 mr-1.5">
                          {entry.category}
                        </span>
                        <span aria-hidden="true" className="text-slate-400 mr-1.5">·</span>
                        <span>{entry.detail}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {relTime(entry.ts)}
                    </span>
                    {entry.route && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          onClose();
                          onNavigate(entry.route as RouteId);
                        }}
                      >
                        View
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No logged actions yet"
              message="Adding SKUs, recording stock movements, editing BOMs, importing files, or applying scenarios automatically logs here."
            />
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        onConfirm={() => {
          clearActionLog();
          pushToast({ type: 'info', message: 'Action history cleared.' });
        }}
        title="Clear action history?"
        message="This removes the audit log of workspace edits and imports. Your SKUs, BOMs, and ledger transactions remain untouched."
        confirmLabel="Clear history"
        danger
      />
    </>
  );
};
