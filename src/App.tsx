/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import {
  ActionHistoryModal,
  GuidedOnboardingModal,
  HelpCenterModal,
} from './components/help/HelpAndOnboardingModals';
import { AppShell, NAV_ITEMS, RouteId } from './components/layout/AppShell';
import { CommandPaletteModal } from './components/modals/CommandPaletteModal';
import {
  BomEditorModal,
  ProductDetailModal,
  ProductFormModal,
  ShortcutsModal,
  StockMoveModal,
} from './components/modals/WorkspaceModals';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { ModuleSkeleton, ToastContainer } from './components/ui/Primitives';
import { AbcPage } from './pages/AbcPage';
import { AdvisorPage } from './pages/AdvisorPage';
import { DecisionAssistantPanel } from './components/assistant/DecisionAssistantPanel';
import { BriefPage } from './pages/BriefPage';
import { DashboardPage } from './pages/DashboardPage';
import { EoqPage } from './pages/EoqPage';
import { ForecastPage } from './pages/ForecastPage';
import { HomePage } from './pages/HomePage';
import { InventoryPage } from './pages/InventoryPage';
import { LedgerPage } from './pages/LedgerPage';
import { SettingsPage } from './pages/SettingsPage';
import { AssemblySku, isAssemblySku } from './engine/threeSpecs';
import { Product } from './store/store';
import { StoreProvider, useStore } from './store/StoreContext';

const OneForAllPage = lazy(() => import('./pages/OneForAllPage').then((m) => ({ default: m.OneForAllPage })));
const FactorySimLabPage = lazy(() => import('./pages/FactorySimLabPage').then((m) => ({ default: m.FactorySimLabPage })));
const ScenarioStudioPage = lazy(() => import('./pages/ScenarioStudioPage').then((m) => ({ default: m.ScenarioStudioPage })));
const Models3DPage = lazy(() => import('./pages/Models3DPage').then((m) => ({ default: m.Models3DPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const DecisionLabPage = lazy(() => import('./pages/DecisionLabPage').then((m) => ({ default: m.DecisionLabPage })));
const ResearchPage = lazy(() => import('./pages/ResearchPage').then((m) => ({ default: m.ResearchPage })));
const LineBalancePage = lazy(() => import('./pages/LineBalancePage').then((m) => ({ default: m.LineBalancePage })));
const ProductionPage = lazy(() => import('./pages/ProductionPage').then((m) => ({ default: m.ProductionPage })));
const SpcPage = lazy(() => import('./pages/SpcPage').then((m) => ({ default: m.SpcPage })));

const VALID_ROUTES = new Set<RouteId>(['home', ...NAV_ITEMS.map((n) => n.id)]);

function parseHashRoute(): RouteId {
  if (typeof window === 'undefined') return 'home';
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim() as RouteId;
  if (!raw) return 'home';
  return VALID_ROUTES.has(raw) ? raw : 'home';
}

function hasAutostartParam(): boolean {
  if (typeof window === 'undefined') return false;
  const search = window.location.search || '';
  const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
  return (
    new URLSearchParams(search).get('autostart') === '1' ||
    new URLSearchParams(hashQuery).get('autostart') === '1'
  );
}

function WorkbenchRoot() {
  const { settings, toasts, dismissToast } = useStore();
  const [booting, setBooting] = useState(() => !hasAutostartParam());
  const [route, setRoute] = useState<RouteId>(() => parseHashRoute());
  const [formModal, setFormModal] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [moveModal, setMoveModal] = useState<{ open: boolean; product: Product | null; type: 'in' | 'out' }>({
    open: false,
    product: null,
    type: 'in',
  });
  const [bomParent, setBomParent] = useState<Product | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [helpState, setHelpState] = useState<{ open: boolean; topicId: string | null }>({ open: false, topicId: null });
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selected3DSku, setSelected3DSku] = useState<AssemblySku>('ASM-CM200');

  const navigate = useCallback((r: RouteId) => {
    setRoute(r);
    if (typeof window !== 'undefined') {
      const target = `#/${r}`;
      if (window.location.hash !== target) {
        window.location.hash = target;
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, []);

  const open3D = useCallback(
    (sku?: string) => {
      if (sku && isAssemblySku(sku)) {
        setSelected3DSku(sku);
      }
      navigate('models-3d');
    },
    [navigate]
  );

  useEffect(() => {
    const onHash = () => setRoute(parseHashRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let gPressedAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
        return;
      }
      if (isInput) return;
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (e.key.toLowerCase() === 'g') {
        gPressedAt = Date.now();
        return;
      }
      if (Date.now() - gPressedAt < 900) {
        const k = e.key.toLowerCase();
        if (k === 'h') navigate('home');
        else if (k === 'o') navigate('one-for-all');
        else if (k === 'f') navigate('factory-sim');
        else if (k === 's') navigate('scenario-studio');
        else if (k === 'd') navigate('dashboard');
        else if (k === 'i') navigate('inventory');
        else if (k === 'a') navigate('advisor');
        else if (k === 'r') navigate('reports');
        else if (k === '3') navigate('models-3d');
        gPressedAt = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const openAdd = () => setFormModal({ open: true, product: null });
  const openEdit = (p: Product) => setFormModal({ open: true, product: p });
  const openMove = (p: Product, type: 'in' | 'out') => setMoveModal({ open: true, product: p, type });

  return (
    <>
      {booting && (
        <LoadingScreen
          onComplete={() => setBooting(false)}
          reduceMotion={Boolean(settings.reduceMotion)}
        />
      )}

      {route === 'home' ? (
        <>
          <HomePage
            onNavigate={navigate}
            onAddProduct={openAdd}
            onOpenProduct={(p) => setDetailProduct(p)}
            onOpenCommandPalette={() => setCmdOpen(true)}
            onOpenHelp={(topicId) => setHelpState({ open: true, topicId: topicId ?? null })}
            onOpenOnboarding={() => setOnboardingOpen(true)}
            onOpenHistory={() => setHistoryOpen(true)}
          />
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </>
      ) : (
        <AppShell
          route={route}
          onNavigate={navigate}
          onOpenProduct={(p) => setDetailProduct(p)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onOpenHelp={(topicId) => setHelpState({ open: true, topicId: topicId ?? null })}
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenCommandPalette={() => setCmdOpen(true)}
        >
          <ErrorBoundary routeKey={route} onResetRoute={() => navigate('dashboard')}>
            <Suspense fallback={<ModuleSkeleton label={`Loading ${route} workbench…`} />}>
              {route === 'factory-sim' && <FactorySimLabPage onNavigate={navigate} />}
              {route === 'scenario-studio' && <ScenarioStudioPage onNavigate={navigate} />}
              {route === 'decision-assistant' && <DecisionAssistantPanel onNavigate={navigate} />}
              {route === 'one-for-all' && (
                <OneForAllPage
                  onNavigate={navigate}
                  onOpenProduct={(p) => setDetailProduct(p)}
                  onAddProduct={openAdd}
                  onMoveStock={openMove}
                  onInspect3D={open3D}
                />
              )}
              {route === 'dashboard' && (
                <DashboardPage
                  onNavigate={navigate}
                  onOpenProduct={(p) => setDetailProduct(p)}
                  onAddProduct={openAdd}
                  onMoveStock={openMove}
                  onInspect3D={open3D}
                  onOpenOnboarding={() => setOnboardingOpen(true)}
                  onOpenHelp={(topicId) => setHelpState({ open: true, topicId: topicId ?? null })}
                />
              )}
              {route === 'advisor' && (
                <AdvisorPage
                  onNavigate={navigate}
                  onOpenProduct={(p) => setDetailProduct(p)}
                  onEditProduct={openEdit}
                />
              )}
              {route === 'inventory' && (
                <InventoryPage
                  onAddProduct={openAdd}
                  onEditProduct={openEdit}
                  onOpenProduct={(p) => setDetailProduct(p)}
                  onMoveStock={openMove}
                />
              )}
              {route === 'eoq' && <EoqPage />}
              {route === 'abc' && <AbcPage onOpenProduct={(p) => setDetailProduct(p)} />}
              {route === 'forecast' && <ForecastPage />}
              {route === 'models-3d' && (
                <Models3DPage
                  initialSku={selected3DSku}
                  onSelectSku={setSelected3DSku}
                  onOpenProduct={(p) => setDetailProduct(p)}
                  onMoveStock={openMove}
                  onNavigate={navigate}
                />
              )}
              {route === 'production' && (
                <ProductionPage
                  onEditBom={(p) => setBomParent(p)}
                  onInspect3D={open3D}
                  onNavigate={navigate}
                />
              )}
              {route === 'decision-lab' && <DecisionLabPage />}
              {route === 'line-balance' && <LineBalancePage onNavigate={navigate} />}
              {route === 'spc' && <SpcPage />}
              {route === 'research' && <ResearchPage />}
              {route === 'ledger' && <LedgerPage />}
              {route === 'brief' && <BriefPage onNavigate={navigate} />}
              {route === 'reports' && (
                <ReportsPage
                  onNavigate={navigate}
                  onOpenProduct={(p) => setDetailProduct(p)}
                  onMoveStock={openMove}
                />
              )}
              {route === 'settings' && (
                <SettingsPage
                  onOpenShortcuts={() => setShortcutsOpen(true)}
                  onReplaySplash={() => setBooting(true)}
                  onOpenOnboarding={() => setOnboardingOpen(true)}
                  onOpenHistory={() => setHistoryOpen(true)}
                />
              )}
            </Suspense>
          </ErrorBoundary>
        </AppShell>
      )}

      <CommandPaletteModal
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={navigate}
        onOpenProduct={(p) => setDetailProduct(p)}
        onOpenHelp={(topicId) => setHelpState({ open: true, topicId: topicId ?? null })}
      />
      <ProductFormModal
        open={formModal.open}
        product={formModal.product}
        onClose={() => setFormModal({ open: false, product: null })}
      />
      <ProductDetailModal
        open={detailProduct !== null}
        product={detailProduct}
        onClose={() => setDetailProduct(null)}
        onEdit={openEdit}
        onMove={openMove}
        onInspect3D={open3D}
      />
      <StockMoveModal
        open={moveModal.open}
        product={moveModal.product}
        type={moveModal.type}
        onClose={() => setMoveModal({ open: false, product: null, type: 'in' })}
      />
      <BomEditorModal
        open={bomParent !== null}
        parent={bomParent}
        onClose={() => setBomParent(null)}
      />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <HelpCenterModal
        open={helpState.open}
        initialTopicId={helpState.topicId}
        onClose={() => setHelpState({ open: false, topicId: null })}
        onNavigate={navigate}
        onOpenOnboarding={() => setOnboardingOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <GuidedOnboardingModal
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onNavigate={navigate}
      />
      <ActionHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onNavigate={navigate}
      />
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <WorkbenchRoot />
    </StoreProvider>
  );
}
