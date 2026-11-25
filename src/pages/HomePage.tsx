import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Box,
  ChevronDown,
  ClipboardList,
  Database,
  Factory,
  GitBranch,
  HelpCircle,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Moon,
  Package,
  PackagePlus,
  Search,
  Sliders,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import { RealTimeMetricsWidget } from '../components/home/RealTimeMetricsWidget';
import { RouteId } from '../components/layout/AppShell';
import { fmtInt, fmtMoney } from '../engine/formatters';
import {
  computeHomeLiveMetrics,
  HOME_CAPABILITY_CARDS,
  HOME_FOOTER_COLUMNS,
  HOME_MORE_NAV,
  HOME_PRIMARY_NAV,
  HomeCapabilityCard,
  WorkbenchRouteId,
} from '../engine/homeData';
import { Product } from '../store/store';
import { useStore } from '../store/StoreContext';
import { publicAsset } from '../utils/assetUrl';

interface HomePageProps {
  onNavigate: (r: RouteId) => void;
  onAddProduct: () => void;
  onOpenProduct: (p: Product) => void;
  onOpenCommandPalette: () => void;
  onOpenHelp: (topicId?: string) => void;
  onOpenOnboarding: () => void;
  onOpenHistory: () => void;
}

const NAV_ICONS: Partial<Record<WorkbenchRouteId, React.FC<{ className?: string }>>> = {
  'factory-sim': Factory,
  'scenario-studio': Sliders,
  inventory: Package,
  forecast: TrendingUp,
  'models-3d': Box,
};

function renderCapabilityIcon(key: HomeCapabilityCard['iconKey']) {
  switch (key) {
    case 'factory':
      return <Factory className="h-5 w-5" />;
    case 'sliders':
      return <Sliders className="h-5 w-5" />;
    case 'package':
      return <Package className="h-5 w-5" />;
    case 'box':
      return <Box className="h-5 w-5" />;
    case 'assistant':
      return <MessageSquareText className="h-5 w-5" />;
    case 'trending':
      return <TrendingUp className="h-5 w-5" />;
    case 'gitbranch':
      return <GitBranch className="h-5 w-5" />;
    case 'reports':
      return <ClipboardList className="h-5 w-5" />;
  }
}

export const HomePage: React.FC<HomePageProps> = ({
  onNavigate,
  onAddProduct,
  onOpenProduct,
  onOpenCommandPalette,
  onOpenHelp,
  onOpenOnboarding,
  onOpenHistory,
}) => {
  const {
    products,
    transactions,
    summary,
    visibleSmartAlerts,
    factorySimConfig,
    settings,
    setSetting,
    datasetProvenance,
  } = useStore();

  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  const metrics = useMemo(
    () =>
      computeHomeLiveMetrics({
        products,
        transactions,
        summary,
        visibleSmartAlerts,
        factorySimConfig,
      }),
    [products, transactions, summary, visibleSmartAlerts, factorySimConfig]
  );

  useEffect(() => {
    if (!moreOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  const provenanceTag =
    datasetProvenance.kind === 'demo'
      ? 'Seeded plant'
      : datasetProvenance.kind === 'empty'
        ? 'Empty catalog'
        : 'Active workspace';

  const go = (route: WorkbenchRouteId) => {
    setMoreOpen(false);
    setMobileMenuOpen(false);
    onNavigate(route as RouteId);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-[#080c0a] dark:text-slate-100">
      <a
        href="#home-main"
        onClick={(e) => {
          e.preventDefault();
          const target = document.getElementById('home-main');
          target?.focus();
          target?.scrollIntoView({ behavior: 'auto', block: 'start' });
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:px-3 focus:py-2 focus:rounded-md focus:bg-[var(--accent)] focus:text-white focus:text-xs focus:font-semibold"
      >
        Skip to main content
      </a>

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 dark:border-[#18261f] bg-white/95 dark:bg-[#080c0a]/95 backdrop-blur">
        <div className="max-w-[1320px] mx-auto px-3 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-2 sm:gap-3">
          {/* Brand */}
          <div className="flex items-center gap-4 lg:gap-6 min-w-0">
            <button
              type="button"
              onClick={() => go('home')}
              className="flex items-center gap-2 shrink-0 cursor-pointer focus:outline-none"
            >
              <img
                src={publicAsset('assets/aistudio/factorymind-mark.png')}
                alt="FactoryMind"
                className="h-8 w-8 rounded-lg object-cover border border-slate-300/70 dark:border-slate-700/80 shadow-xs shrink-0"
              />
              <span className="text-[14px] sm:text-[15px] font-bold tracking-tight text-slate-950 dark:text-white whitespace-nowrap">
                FactoryMind
              </span>
            </button>

            {/* Primary Nav Links */}
            <nav aria-label="Primary modules" className="hidden lg:flex items-center gap-1">
              {HOME_PRIMARY_NAV.map((item) => {
                const Icon = NAV_ICONS[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#13201a] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {Icon && <Icon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0" />}
                    <span>{item.label}</span>
                  </button>
                );
              })}

              {/* More Dropdown */}
              <div className="relative" ref={moreRef}>
                <button
                  type="button"
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                  onClick={() => setMoreOpen((v) => !v)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#13201a] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>More</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                </button>

                {moreOpen && (
                  <div
                    role="menu"
                    aria-label="Additional engineering modules"
                    className="absolute left-0 mt-2 w-[340px] rounded-xl border border-slate-200 dark:border-[#1c2b23] bg-white dark:bg-[#0d1511] shadow-2xl p-2 z-50 grid grid-cols-1 gap-0.5 max-h-[75vh] overflow-y-auto"
                  >
                    {HOME_MORE_NAV.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        onClick={() => go(item.id)}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-[#15241c] transition-colors flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {item.label}
                          </div>
                          {item.description && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {item.description}
                            </div>
                          )}
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </nav>
          </div>

          {/* Right Utilities */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              type="button"
              data-testid="home-search-trigger"
              onClick={onOpenCommandPalette}
              aria-label="Search modules, SKUs, scenarios and help"
              className="inline-flex items-center justify-center gap-2 px-2 sm:px-2.5 py-1.5 min-h-[34px] min-w-[34px] sm:min-h-0 sm:min-w-0 rounded-lg border border-slate-200 dark:border-[#1e2e25] bg-slate-50 dark:bg-[#0d1411] text-xs text-slate-700 dark:text-slate-200 hover:border-[var(--accent)]/50 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">Search...</span>
              <kbd className="hidden md:inline font-mono text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-[#142019] border border-slate-200 dark:border-[#24362c] text-slate-600 dark:text-slate-300 shrink-0">
                ⌘K
              </kbd>
            </button>

            <button
              type="button"
              onClick={() => onOpenHelp()}
              aria-label="Equations and Help Reference"
              title="Equations & Help Reference"
              className="hidden sm:inline-flex p-1.5 rounded-lg border border-slate-200 dark:border-[#1e2e25] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#13201a] transition-colors cursor-pointer"
            >
              <HelpCircle className="h-4 w-4" />
            </button>

            {/* Segmented Light / Dark Switcher */}
            <div
              role="group"
              aria-label="Color theme"
              className="inline-flex items-center rounded-lg border border-slate-200 dark:border-[#1e2e25] bg-slate-100/80 dark:bg-[#0d1411] p-0.5"
            >
              <button
                type="button"
                aria-label="Light theme"
                aria-pressed={settings.theme === 'light'}
                onClick={() => setSetting('theme', 'light')}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  settings.theme === 'light'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Sun className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Dark theme"
                aria-pressed={settings.theme === 'dark'}
                onClick={() => setSetting('theme', 'dark')}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  settings.theme === 'dark'
                    ? 'bg-[#172820] text-[var(--accent)] shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Moon className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => go('dashboard')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#13201a] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LayoutDashboard className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span>Workbench</span>
            </button>

            <button
              type="button"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden p-1.5 min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-[#1e2e25] text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Panel */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-200 dark:border-[#18261f] bg-white dark:bg-[#0a100d] px-4 py-3 space-y-2 max-h-[75vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-1.5">
              {[...HOME_PRIMARY_NAV, { id: 'dashboard' as WorkbenchRouteId, label: 'Dashboard' }, { id: 'decision-assistant' as WorkbenchRouteId, label: 'Assistant' }, { id: 'production' as WorkbenchRouteId, label: 'MRP & BOM' }, { id: 'reports' as WorkbenchRouteId, label: 'Reports' }].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item.id)}
                  className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-[#1c2b23] text-xs font-semibold text-slate-800 dark:text-slate-100 hover:border-[var(--accent)]/60 cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200/70 dark:border-[#18261f]">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenHelp();
                }}
                className="text-xs font-medium text-[var(--accent)] cursor-pointer"
              >
                Help &amp; Equations
              </button>
              <button
                type="button"
                onClick={() => go('settings')}
                className="text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                Settings &amp; Backups
              </button>
            </div>
          </div>
        )}
      </header>

      <main id="home-main" tabIndex={-1} className="flex-1 focus:outline-none">
        {/* Hero Split */}
        <section className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-12 sm:pt-14 sm:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            {/* Left Copy Column */}
            <div className="lg:col-span-7">
              <div className="text-[11px] font-mono uppercase tracking-[0.12em] font-semibold text-[var(--accent)]">
                INDUSTRIAL ENGINEERING · DISCRETE-EVENT SIMULATION &amp; MRP
              </div>

              <h1
                className="mt-3 font-extrabold tracking-tight text-slate-950 dark:text-white leading-[1.07]"
                style={{ fontSize: 'clamp(2rem, 4.1vw, 3.35rem)' }}
              >
                Every machine, order, and SKU, simulated in sync.
              </h1>

              <p className="mt-5 text-[15px] sm:text-[17px] leading-relaxed text-slate-600 dark:text-slate-300 max-w-2xl">
                Deterministic inventory control, multi-level MRP, 12-model demand forecasting, discrete-event shop-floor simulation, and interactive 3D digital twin for{' '}
                <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{fmtInt(metrics.skuCount)}</span>{' '}
                plant SKUs across{' '}
                <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{fmtInt(metrics.workstationsCount)}</span>{' '}
                workstations — running locally in your browser.
              </p>

              {/* Action Buttons Row 1 */}
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => go('factory-sim')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent)] hover:brightness-110 text-white text-sm font-semibold shadow-xs transition-all whitespace-nowrap cursor-pointer"
                >
                  <Factory className="h-4 w-4 shrink-0" />
                  <span>Enter Simulation Lab</span>
                </button>

                <button
                  type="button"
                  onClick={() => go('scenario-studio')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[var(--accent)]/45 bg-[var(--accent-soft)] text-[var(--accent)] hover:border-[var(--accent)] text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Sliders className="h-4 w-4 shrink-0" />
                  <span>Scenario Studio</span>
                </button>

                <button
                  type="button"
                  onClick={() => go('decision-assistant')}
                  className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-[#13201a] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <MessageSquareText className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                  <span>Ask Decision Assistant</span>
                </button>
              </div>

              {/* Action Row 2 */}
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => go('models-3d')}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:text-[var(--accent)] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Box className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span>3D Digital Twin Lab</span>
                </button>

                <button
                  type="button"
                  onClick={onAddProduct}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:text-[var(--accent)] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <PackagePlus className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span>Add SKU to catalog</span>
                </button>
              </div>
            </div>

            {/* Right Elevated Telemetry Card */}
            <div className="lg:col-span-5">
              <div className="rounded-2xl border border-slate-200 dark:border-[#1c2b23] bg-white dark:bg-[#0d1511] p-5 sm:p-6 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      PLANT COMMAND TELEMETRY
                    </div>
                    <div className="text-base font-bold text-slate-950 dark:text-white mt-0.5">
                      Plant engine ready
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] shrink-0">
                    <Database className="h-3.5 w-3.5 shrink-0" />
                    <span>{provenanceTag}</span>
                  </div>
                </div>

                {/* 2x2 Metric Grid */}
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <div className="rounded-xl border border-slate-200/80 dark:border-[#1a2820] bg-slate-50/75 dark:bg-[#080d0a] px-4 py-3.5">
                    <div className="font-display text-2xl font-bold tabular-nums text-[var(--accent)]">
                      {fmtInt(metrics.skuCount)}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">Catalogued SKUs</div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 dark:border-[#1a2820] bg-slate-50/75 dark:bg-[#080d0a] px-4 py-3.5">
                    <div className="font-display text-2xl font-bold tabular-nums text-[var(--accent)]">
                      {fmtInt(metrics.bomCount)}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">Multi-level BOMs</div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 dark:border-[#1a2820] bg-slate-50/75 dark:bg-[#080d0a] px-4 py-3.5">
                    <div className="font-display text-2xl font-bold tabular-nums text-[var(--accent)]">
                      {fmtMoney(metrics.stockValue, 0)}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">On-hand stock value</div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 dark:border-[#1a2820] bg-slate-50/75 dark:bg-[#080d0a] px-4 py-3.5">
                    <div className="font-display text-2xl font-bold tabular-nums text-[var(--accent)]">
                      {fmtInt(metrics.alertCount)}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">Reorder exceptions</div>
                  </div>
                </div>

                {/* Card Divider Row */}
                <div className="mt-5 pt-4 border-t border-slate-200 dark:border-[#1c2b23] flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-600 dark:text-slate-400">
                    Instant local simulation — zero signup barrier.
                  </span>
                  <button
                    type="button"
                    onClick={() => go('dashboard')}
                    className="font-semibold text-[var(--accent)] hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>Browse Dashboard</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Quick Search Bar Button */}
                <button
                  type="button"
                  onClick={onOpenCommandPalette}
                  className="mt-3 w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-[#1e2f26] bg-slate-50 dark:bg-[#080d0a] px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-300 hover:border-[var(--accent)]/50 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2 min-w-0 truncate">
                    <Search className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                    <span className="truncate">Jump anywhere with Quick Search</span>
                  </span>
                  <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-[#132019] border border-slate-200 dark:border-[#24362c] shrink-0">
                    ⌘K
                  </kbd>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 5-Column KPI Proof Band */}
        <section
          aria-label="Live plant summary metrics"
          className="border-y border-slate-200/80 dark:border-[#16221c] bg-white/60 dark:bg-[#0a100d]"
        >
          <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6 text-center">
            <div>
              <div className="font-display text-2xl sm:text-3xl font-bold tabular-nums text-[var(--accent)]">
                {fmtInt(metrics.skuCount)}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Catalogued SKUs</div>
            </div>
            <div>
              <div className="font-display text-2xl sm:text-3xl font-bold tabular-nums text-[var(--accent)]">
                {fmtInt(metrics.bomCount)}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">BOM assemblies</div>
            </div>
            <div>
              <div className="font-display text-2xl sm:text-3xl font-bold tabular-nums text-[var(--accent)]">
                {fmtInt(metrics.txCount)}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Ledger movements</div>
            </div>
            <div>
              <div className="font-display text-2xl sm:text-3xl font-bold tabular-nums text-[var(--accent)]">
                {fmtInt(metrics.forecastModelCount)}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Forecast models</div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <div className="font-display text-2xl sm:text-3xl font-bold tabular-nums text-[var(--accent)]">
                {fmtInt(metrics.smartAlertCount)}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Forecast alerts active</div>
            </div>
          </div>
        </section>

        {/* Real-time Metrics Widget */}
        <RealTimeMetricsWidget onNavigate={onNavigate} onOpenProduct={onOpenProduct} />

        {/* "Jump straight in" 8-Card Module Grid */}
        <section className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
                Jump straight in
              </h2>
              <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 mt-1.5">
                Every module shares one validated inventory catalog, BOM hierarchy, and discrete-event plant model.
              </p>
            </div>
            <button
              type="button"
              onClick={() => go('reports')}
              className="text-sm font-semibold text-[var(--accent)] hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Analytics &amp; Reports</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {HOME_CAPABILITY_CARDS.map((card) => (
              <div
                key={card.id}
                className="rounded-2xl border border-slate-200 dark:border-[#1b2922] bg-white dark:bg-[#0d1511] p-6 flex flex-col justify-between transition-colors hover:border-[var(--accent)]/60"
              >
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="h-10 w-10 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent)]/20 flex items-center justify-center text-[var(--accent)] shrink-0">
                      {renderCapabilityIcon(card.iconKey)}
                    </div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">
                      {card.meta}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-950 dark:text-white mt-5">{card.title}</h3>
                  <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300 mt-2">
                    {card.description}
                  </p>
                </div>

                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => go(card.id)}
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    <span>Open module</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA Band */}
        <section className="bg-[var(--accent-soft)] border-y border-[var(--accent)]/20 py-14 px-4 sm:px-6 text-center">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
              Start with your plant catalogue
            </h2>
            <p className="text-sm sm:text-base text-slate-700 dark:text-slate-300 mt-3 leading-relaxed">
              Explore {fmtInt(metrics.skuCount)} seeded industrial SKUs or import your own CSV/JSON. Everything stays local in your browser and can be exported or reset anytime.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => go('dashboard')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent)] hover:brightness-110 text-white text-sm font-semibold shadow-xs transition-all cursor-pointer"
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                <span>Open the dashboard</span>
              </button>
              <button
                type="button"
                onClick={onOpenOnboarding}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-[#24362c] bg-white/80 dark:bg-[#0d1511] text-slate-800 dark:text-slate-200 hover:border-[var(--accent)] text-sm font-semibold transition-colors cursor-pointer"
              >
                <span>Take guided tour</span>
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Multi-Column Footer */}
      <footer className="bg-white dark:bg-[#080c0a] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-[1320px] mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-8 pb-10 border-b border-slate-200 dark:border-[#18261f]">
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <img
                src={publicAsset('assets/aistudio/factorymind-mark.png')}
                alt="FactoryMind"
                className="h-8 w-8 rounded-lg object-cover border border-slate-300/70 dark:border-slate-700/80 shadow-xs shrink-0"
              />
              <span className="text-base font-bold tracking-tight text-slate-950 dark:text-white">
                FactoryMind
              </span>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-sm">
              Integrated Industrial Engineering &amp; Discrete-Event Manufacturing Simulation Workbench.
            </p>
            <div>
              <button
                type="button"
                onClick={() => onOpenHelp()}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[var(--accent)]/40 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors cursor-pointer"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                <span>Equations &amp; Engineering Help</span>
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
              Deterministic calculations run locally in your browser; always validate production policy changes against plant constraints.
            </p>
          </div>

          {HOME_FOOTER_COLUMNS.map((col, idx) => (
            <div key={col.heading} className={idx === 1 ? 'lg:col-span-3' : 'lg:col-span-2'}>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-white mb-3">
                {col.heading}
              </div>
              <ul className="space-y-2">
                {col.links.map((lnk) => (
                  <li key={lnk.label}>
                    <button
                      type="button"
                      onClick={() => {
                        if (lnk.route) go(lnk.route);
                        else if (lnk.action === 'history') onOpenHistory();
                        else if (lnk.action === 'onboarding') onOpenOnboarding();
                        else if (lnk.action === 'help') onOpenHelp();
                      }}
                      className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white transition-colors cursor-pointer"
                    >
                      {lnk.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="max-w-[1320px] mx-auto pt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>© 2026 FactoryMind · Industrial Engineering &amp; Manufacturing Simulation Platform</span>
          <span>
            Made by <span className="font-medium text-slate-800 dark:text-slate-200">Md Ibtashamur Rahman</span>
          </span>
        </div>
      </footer>
    </div>
  );
};
