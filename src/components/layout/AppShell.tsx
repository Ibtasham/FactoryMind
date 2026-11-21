import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bell,
  Box,
  Calculator,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Compass,
  Cpu,
  Factory,
  FileText,
  FlaskConical,
  GitBranch,
  HelpCircle,
  History,
  Home,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  MessageSquareText,
  Moon,
  Package,
  Search,
  Settings,
  Sliders,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import { fmtInt, fmtMoney } from '../../engine/formatters';
import { Product } from '../../store/store';
import { useStore } from '../../store/StoreContext';
import { StatusLabel, ToastContainer } from '../ui/Primitives';

export type RouteId =
  | 'home'
  | 'factory-sim'
  | 'scenario-studio'
  | 'decision-assistant'
  | 'one-for-all'
  | 'dashboard'
  | 'advisor'
  | 'inventory'
  | 'eoq'
  | 'abc'
  | 'forecast'
  | 'models-3d'
  | 'production'
  | 'decision-lab'
  | 'line-balance'
  | 'spc'
  | 'research'
  | 'ledger'
  | 'brief'
  | 'reports'
  | 'settings';

export type NavGroupId =
  | 'Unified'
  | 'Inventory & Policy'
  | 'Forecast & Simulation'
  | 'Production & 3D Twin'
  | 'Ledger & System';

export interface NavItem {
  id: RouteId;
  label: string;
  subtitle: string;
  group: NavGroupId;
  icon: React.FC<{ className?: string }>;
}

export const SUBMENU_GROUPS: Array<{ id: Exclude<NavGroupId, 'Unified'>; label: string }> = [
  { id: 'Inventory & Policy', label: 'Inventory & Policy' },
  { id: 'Forecast & Simulation', label: 'Forecast & Simulation' },
  { id: 'Production & 3D Twin', label: 'Production & 3D Twin' },
  { id: 'Ledger & System', label: 'Ledger & System' },
];

export const NAV_ITEMS: NavItem[] = [
  { id: 'factory-sim', label: 'Factory Simulation Lab', subtitle: 'Integrated DES, BOM material flow, OEE, Monte Carlo & 3D twin', group: 'Unified', icon: Factory },
  { id: 'scenario-studio', label: 'Scenario Studio', subtitle: 'Cross-module strategy counterfactuals, explainability & safe apply', group: 'Unified', icon: Sliders },
  { id: 'decision-assistant', label: 'Decision Assistant', subtitle: 'Deterministic operational Q&A, counterfactuals & optional Gemini AI explanation', group: 'Unified', icon: MessageSquareText },
  { id: 'one-for-all', label: 'One-for-All Hub', subtitle: 'Every FactoryMind engine, 3D model, KPI & export in one workspace', group: 'Unified', icon: LayoutGrid },
  { id: 'dashboard', label: 'Dashboard', subtitle: 'Live plant inventory overview and exceptions', group: 'Unified', icon: LayoutDashboard },
  { id: 'inventory', label: 'Inventory', subtitle: 'SKU catalogue, reorder points, and stock actions', group: 'Inventory & Policy', icon: Package },
  { id: 'advisor', label: 'Advisor', subtitle: 'Priced inventory policy findings and simulator', group: 'Inventory & Policy', icon: Compass },
  { id: 'eoq', label: 'EOQ & ROP', subtitle: 'Wilson EOQ, finite-rate EPQ, and quantity discounts', group: 'Inventory & Policy', icon: Calculator },
  { id: 'abc', label: 'ABC Analysis', subtitle: 'Pareto annual usage classification and thresholds', group: 'Inventory & Policy', icon: Layers },
  { id: 'forecast', label: 'Forecasting', subtitle: '12-model demand comparison & rolling backtesting', group: 'Forecast & Simulation', icon: TrendingUp },
  { id: 'decision-lab', label: 'Decision Lab', subtitle: 'Monte Carlo (Q,R), Newsvendor, and Queueing', group: 'Forecast & Simulation', icon: Cpu },
  { id: 'research', label: 'Research Lab', subtitle: 'Reproducible catalogue benchmarks and exports', group: 'Forecast & Simulation', icon: FlaskConical },
  { id: 'models-3d', label: '3D Digital Twin', subtitle: 'Interactive BOM assemblies & live warehouse floor', group: 'Production & 3D Twin', icon: Box },
  { id: 'production', label: 'Production & MRP', subtitle: 'Multi-level BOM explosion and time-phased MRP', group: 'Production & 3D Twin', icon: Factory },
  { id: 'line-balance', label: 'Line Balancing', subtitle: 'RPW, LCR, K&W, COMSOAL, and Branch & Bound', group: 'Production & 3D Twin', icon: GitBranch },
  { id: 'spc', label: 'SPC & Quality', subtitle: 'X̄/R control charts, capability, EWMA & CUSUM', group: 'Production & 3D Twin', icon: Activity },
  { id: 'ledger', label: 'Stock Ledger', subtitle: '30-day stock flow and movement audit log', group: 'Ledger & System', icon: History },
  { id: 'brief', label: 'Executive Brief', subtitle: 'Board-ready single-page brief synced to policy', group: 'Ledger & System', icon: FileText },
  { id: 'reports', label: 'Reports', subtitle: 'Print-ready inventory & methodology dossier', group: 'Ledger & System', icon: ClipboardList },
  { id: 'settings', label: 'Settings', subtitle: 'Appearance, JSON/CSV backups, and shortcuts', group: 'Ledger & System', icon: Settings },
];

export const AppShell: React.FC<{
  route: RouteId;
  onNavigate: (r: RouteId) => void;
  onOpenProduct: (p: Product) => void;
  onOpenShortcuts: () => void;
  onOpenHelp: (topicId?: string) => void;
  onOpenHistory: () => void;
  onOpenCommandPalette: () => void;
  children: React.ReactNode;
}> = ({
  route,
  onNavigate,
  onOpenProduct,
  onOpenShortcuts,
  onOpenHelp,
  onOpenHistory,
  onOpenCommandPalette,
  children,
}) => {
  const {
    products,
    summary,
    settings,
    setSetting,
    metricsOf,
    visibleSmartAlerts,
    toasts,
    dismissToast,
    actionLog,
    datasetProvenance,
  } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const alertsWrapRef = useRef<HTMLDivElement | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'Inventory & Policy': true,
    'Forecast & Simulation': false,
    'Production & 3D Twin': true,
    'Ledger & System': false,
  });

  const currentNav = NAV_ITEMS.find((n) => n.id === route) || NAV_ITEMS[0];

  useEffect(() => {
    if (currentNav.group !== 'Unified') {
      setExpandedGroups((prev) => (prev[currentNav.group] ? prev : { ...prev, [currentNav.group]: true }));
    }
  }, [currentNav.group]);

  // Close Alerts popover on Escape or outside pointer click
  useEffect(() => {
    if (!alertsOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (alertsWrapRef.current && !alertsWrapRef.current.contains(e.target as Node)) {
        setAlertsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAlertsOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [alertsOpen]);

  // Close mobile drawer on Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const activeSubMenuItems = useMemo(() => {
    if (currentNav.group === 'Unified') {
      return NAV_ITEMS.filter((n) => n.group === 'Unified');
    }
    return NAV_ITEMS.filter((n) => n.group === currentNav.group);
  }, [currentNav.group]);

  const alertProducts = useMemo(
    () =>
      products
        .map((p) => ({ p, m: metricsOf(p) }))
        .filter(({ m }) => m.status !== 'ok')
        .sort((a, b) => {
          const order = { out: 0, critical: 1, reorder: 2, ok: 3 };
          return order[a.m.status] - order[b.m.status];
        }),
    [products, metricsOf]
  );

  const NavContent = () => (
    <div className="flex flex-col h-full">
      <div className="px-4 h-12 sm:h-14 flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <button
          type="button"
          onClick={() => {
            onNavigate('home');
            setMobileOpen(false);
          }}
          title="Return to FactoryMind Homepage"
          className="flex items-center gap-2.5 min-w-0 text-left hover:opacity-85 transition-opacity cursor-pointer"
        >
          <img src="/assets/aistudio/logo_0620d144.svg" alt="FactoryMind logo" className="h-7 w-7 rounded shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-white leading-none">
              FactoryMind
            </div>
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 mt-1 leading-none">
              Production Suite
            </div>
          </div>
        </button>
        <button
          type="button"
          aria-label="Go to Homepage"
          title="Homepage"
          onClick={() => {
            onNavigate('home');
            setMobileOpen(false);
          }}
          className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-[var(--accent)] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
        >
          <Home className="h-3.5 w-3.5" />
        </button>
      </div>

      <nav aria-label="Main modules" className="flex-1 overflow-y-auto px-2.5 py-3 space-y-3">
        <div className="space-y-1 pb-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
          {NAV_ITEMS.filter((n) => n.group === 'Unified').map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-route={item.id}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  onNavigate(item.id);
                  setMobileOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  active
                    ? 'bg-[var(--accent)] text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-200 bg-slate-100/70 dark:bg-slate-800/50 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'one-for-all' && (
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                      active ? 'bg-white/20 text-white' : 'bg-slate-200/80 dark:bg-slate-700/70 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    ALL
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="space-y-1.5">
          {SUBMENU_GROUPS.map((grp) => {
            const items = NAV_ITEMS.filter((n) => n.group === grp.id);
            const isOpen = !!expandedGroups[grp.id];
            const hasActive = items.some((n) => n.id === route);
            return (
              <div
                key={grp.id}
                className="rounded-lg border border-transparent data-[open=true]:border-slate-200/70 dark:data-[open=true]:border-slate-800/70 data-[open=true]:bg-slate-50/50 dark:data-[open=true]:bg-slate-950/35 transition-colors"
                data-open={isOpen}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  data-submenu={grp.id}
                  onClick={() => toggleGroup(grp.id)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-semibold tracking-wide transition-colors cursor-pointer ${
                    hasActive
                      ? 'text-[var(--accent)]'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{grp.label}</span>
                  </span>
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{items.length}</span>
                </button>

                {isOpen && (
                  <div className="px-1.5 pb-1.5 pt-0.5 space-y-0.5">
                    {items.map((item) => {
                      const Icon = item.icon;
                      const active = route === item.id;
                      const badge =
                        item.id === 'inventory' && summary.alertCount > 0 ? summary.alertCount : null;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-route={item.id}
                          aria-current={active ? 'page' : undefined}
                          onClick={() => {
                            onNavigate(item.id);
                            setMobileOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                            active
                              ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </span>
                          {badge !== null && (
                            <span className="font-mono tabular-nums text-[11px] text-amber-700 dark:text-amber-400">
                              {badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
        <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between">
          <span>
            {summary.skuCount} SKUs · {datasetProvenance.kind === 'demo' ? 'Demo' : datasetProvenance.kind === 'empty' ? 'Empty' : 'Live'}
          </span>
          <span className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200">
            {fmtMoney(summary.stockValue, 0)}
          </span>
        </div>
        <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
          Made by <span className="font-medium text-slate-800 dark:text-slate-100">Md Ibtashamur Rahman</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:px-3 focus:py-2 focus:rounded-md focus:bg-[var(--accent)] focus:text-white focus:text-xs focus:font-semibold"
      >
        Skip to main content
      </a>

      {/* Desktop Sidebar */}
      <aside
        aria-label="Primary Sidebar"
        className="hidden lg:block w-[252px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 sticky top-0 h-screen no-print"
      >
        <NavContent />
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden bg-slate-950/50 no-print"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMobileOpen(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation drawer"
            className="w-[260px] h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 relative"
          >
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute top-3 right-3 p-1.5 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
            <NavContent />
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-12 sm:h-14 shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/85 backdrop-blur px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-3 sticky top-0 z-30 no-print">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              className="lg:hidden p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer shrink-0"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">
                {currentNav.label}
              </h1>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate hidden md:block">
                {currentNav.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              data-testid="cmd-palette-trigger"
              onClick={onOpenCommandPalette}
              aria-label="Search modules, SKUs, scenarios and help"
              className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden md:inline font-mono text-[10px] px-1 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                ⌘K
              </kbd>
            </button>

            <button
              type="button"
              data-testid="action-history-trigger"
              aria-label={`Action history (${actionLog.length} events)`}
              title={`Action history (${actionLog.length})`}
              onClick={onOpenHistory}
              className="relative p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <History className="h-4 w-4" />
              {actionLog.length > 0 && (
                <span className="sr-only">{actionLog.length} logged actions</span>
              )}
            </button>

            <button
              type="button"
              data-testid="interactive-help-trigger"
              aria-label="Interactive Help & Engineering Reference"
              title="Interactive Help & Reference"
              onClick={() => onOpenHelp()}
              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <HelpCircle className="h-4 w-4" />
            </button>

            <div className="relative" ref={alertsWrapRef}>
              <button
                type="button"
                aria-label="Stock alerts"
                aria-expanded={alertsOpen}
                aria-controls="header-alerts-popover"
                onClick={() => setAlertsOpen((v) => !v)}
                className="relative p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Bell className="h-4 w-4" />
                {(visibleSmartAlerts.length > 0 || alertProducts.length > 0) && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-amber-600 text-white font-mono text-[10px] leading-4 text-center">
                    {Math.max(visibleSmartAlerts.length, alertProducts.length)}
                  </span>
                )}
              </button>

              {alertsOpen && (
                <div
                  id="header-alerts-popover"
                  role="region"
                  aria-label="Stock alerts summary"
                  className="absolute right-0 mt-2 w-72 sm:w-96 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl z-50"
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-slate-800 text-xs font-semibold">
                    <span>Smart Forecast Alerts ({visibleSmartAlerts.length})</span>
                    <button
                      type="button"
                      onClick={() => {
                        setAlertsOpen(false);
                        onNavigate('dashboard');
                      }}
                      className="text-[var(--accent)] font-medium hover:underline cursor-pointer"
                    >
                      View on Dashboard
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {visibleSmartAlerts.length > 0 && (
                      <div className="bg-slate-50/70 dark:bg-slate-950/50 divide-y divide-slate-100 dark:divide-slate-800">
                        {visibleSmartAlerts.slice(0, 4).map((sa) => (
                          <button
                            key={sa.id}
                            type="button"
                            onClick={() => {
                              setAlertsOpen(false);
                              onOpenProduct(sa.product);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 flex items-center justify-between gap-2 cursor-pointer"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-medium truncate text-slate-900 dark:text-slate-100">
                                {sa.product.sku} · {sa.product.name}
                              </div>
                              <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 mt-0.5">
                                {sa.daysUntilStockout <= 0.5 ? '<1d' : `${sa.daysUntilStockout.toFixed(1)}d`} left vs {sa.leadTimeDays}d LT · {sa.forecastModel}
                              </div>
                            </div>
                            <span
                              className={`text-[11px] font-mono font-semibold shrink-0 ${
                                sa.runsOutBeforeLeadTime
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {sa.runsOutBeforeLeadTime ? 'Lead-time risk' : 'Predicted'}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="px-3 py-1.5 flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900">
                      <span>ROP Exceptions ({alertProducts.length})</span>
                      <button
                        type="button"
                        onClick={() => {
                          setAlertsOpen(false);
                          onNavigate('advisor');
                        }}
                        className="text-[var(--accent)] font-medium hover:underline cursor-pointer"
                      >
                        Open Advisor
                      </button>
                    </div>

                    {alertProducts.length ? (
                      alertProducts.map(({ p, m }) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setAlertsOpen(false);
                            onOpenProduct(p);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate text-slate-800 dark:text-slate-200">
                              {p.sku} · {p.name}
                            </div>
                            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 mt-0.5">
                              {fmtInt(p.stock)} / ROP {fmtInt(m.rop)} {p.unit}
                            </div>
                          </div>
                          <StatusLabel status={m.status} />
                        </button>
                      ))
                    ) : (
                      <div className="p-4 text-xs text-slate-600 dark:text-slate-300 text-center">
                        All items are above reorder points.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              aria-label={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() => setSetting('theme', settings.theme === 'dark' ? 'light' : 'dark')}
              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {settings.theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              type="button"
              aria-label="Keyboard shortcuts"
              onClick={onOpenShortcuts}
              className="hidden sm:inline-flex p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-mono text-xs w-7 h-7 items-center justify-center cursor-pointer"
            >
              ?
            </button>
          </div>
        </header>

        {/* Non-sticky Divided Contextual Sub-Menu Bar + One-for-All Quick Switch */}
        <div className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/75 dark:bg-slate-900/50 px-3 sm:px-4 lg:px-6 py-2 no-print">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <nav aria-label="Section sub-navigation" className="flex items-center gap-1.5 overflow-x-auto max-w-full">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 mr-1 whitespace-nowrap">
                {currentNav.group === 'Unified' ? 'Mode:' : `${currentNav.group}:`}
              </span>
              {activeSubMenuItems.map((item) => {
                const Icon = item.icon;
                const active = route === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onNavigate(item.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                      active
                        ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {route !== 'one-for-all' && (
              <button
                type="button"
                onClick={() => onNavigate('one-for-all')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors whitespace-nowrap cursor-pointer"
              >
                <LayoutGrid className="h-3.5 w-3.5 text-[var(--accent)]" />
                <span>Switch to One-for-All</span>
              </button>
            )}
          </div>
        </div>

        <main id="main-content" tabIndex={-1} className="flex-1 p-3 sm:p-4 lg:p-6 max-w-[1440px] w-full mx-auto focus:outline-none">
          {children}
        </main>
        <footer className="max-w-[1440px] w-full mx-auto px-4 lg:px-6 py-3 border-t border-slate-200/70 dark:border-slate-800/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300 no-print">
          <span>FactoryMind · Smart Inventory &amp; Production Engineering Workbench</span>
          <span>
            Made by <span className="font-medium text-slate-800 dark:text-slate-100">Md Ibtashamur Rahman</span>
          </span>
        </footer>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
