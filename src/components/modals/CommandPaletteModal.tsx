import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { buildPresetScenarioDefinitions } from '../../engine/scenarioStudio';
import { HELP_TOPICS, searchWorkbench, WorkbenchSearchResult } from '../../engine/uxHelpers';
import { Product } from '../../store/store';
import { useStore } from '../../store/StoreContext';
import { NAV_ITEMS, RouteId } from '../layout/AppShell';
import { Modal } from '../ui/Primitives';

interface CommandPaletteModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (r: RouteId) => void;
  onOpenProduct: (p: Product) => void;
  onOpenHelp: (topicId?: string) => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  onClose,
  onNavigate,
  onOpenProduct,
  onOpenHelp,
}) => {
  const { products, lineBalance, factorySimConfig, scenarioStudioRecords } = useStore();
  const [cmdQuery, setCmdQuery] = useState('');
  const [cmdIndex, setCmdIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setCmdQuery('');
      setCmdIndex(0);
    }
  }, [open]);

  const allScenarios = useMemo(() => {
    const presets = buildPresetScenarioDefinitions({ products, lineBalance, factorySimConfig });
    return [...scenarioStudioRecords, ...presets].map((s) => ({
      id: s.id,
      name: s.name,
      notes: s.notes,
    }));
  }, [products, lineBalance, factorySimConfig, scenarioStudioRecords]);

  const searchResults = useMemo(
    () =>
      searchWorkbench({
        query: cmdQuery,
        routes: [
          { id: 'home', label: 'Homepage Overview', subtitle: 'Platform entry and live plant telemetry', group: 'Unified' },
          ...NAV_ITEMS.map((n) => ({
            id: n.id,
            label: n.label,
            subtitle: n.subtitle,
            group: n.group,
          })),
        ],
        products,
        scenarios: allScenarios,
        helpTopics: HELP_TOPICS,
      }),
    [cmdQuery, products, allScenarios]
  );

  useEffect(() => {
    setCmdIndex(0);
  }, [cmdQuery]);

  const executeSearchResult = (res: WorkbenchSearchResult) => {
    onClose();
    if (res.kind === 'route') {
      onNavigate(res.routeId as RouteId);
    } else if (res.kind === 'sku') {
      const found = products.find((p) => p.id === res.productId);
      if (found) onOpenProduct(found);
    } else if (res.kind === 'scenario') {
      onNavigate('scenario-studio');
    } else if (res.kind === 'help') {
      onOpenHelp(res.helpId);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Command Palette"
      subtitle="Search engineering modules, SKUs, scenarios, and help guides (↑/↓ to navigate, Enter to open)"
      maxWidth="max-w-lg"
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input
            autoFocus
            data-autofocus="true"
            value={cmdQuery}
            aria-label="Search modules, SKUs, scenarios and help"
            onChange={(e) => setCmdQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCmdIndex((prev) => Math.min(Math.max(0, searchResults.length - 1), prev + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCmdIndex((prev) => Math.max(0, prev - 1));
              } else if (e.key === 'Enter' && searchResults[cmdIndex]) {
                e.preventDefault();
                executeSearchResult(searchResults[cmdIndex]);
              }
            }}
            placeholder="Search module, SKU (e.g. MOT-05HP), scenario, or help (e.g. OEE)..."
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-8 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
          />
        </div>

        {searchResults.length ? (
          <div
            role="listbox"
            aria-label="Search results"
            className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md max-h-80 overflow-y-auto"
          >
            {searchResults.map((res, idx) => {
              const selected = idx === cmdIndex;
              const kindLabel =
                res.kind === 'route'
                  ? 'Module'
                  : res.kind === 'sku'
                    ? 'SKU'
                    : res.kind === 'scenario'
                      ? 'Scenario'
                      : 'Help';
              return (
                <button
                  key={res.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setCmdIndex(idx)}
                  onClick={() => executeSearchResult(res)}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-3 cursor-pointer ${
                    selected
                      ? 'bg-[var(--accent-soft)] text-slate-900 dark:text-white'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{res.title}</div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">{res.meta}</div>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-300 shrink-0">
                    {kindLabel}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-slate-600 dark:text-slate-300">
            No modules, SKUs, scenarios, or help topics match &ldquo;{cmdQuery}&rdquo;.
          </div>
        )}
      </div>
    </Modal>
  );
};
