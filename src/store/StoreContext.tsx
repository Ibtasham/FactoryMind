import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { FactoryScenarioRecord, FactorySimConfig } from '../engine/factorySim';
import { ScenarioDefinition } from '../engine/scenarioStudio';
import { predictSmartAlerts, SmartAlertsResult, SmartStockAlert } from '../engine/smartAlerts';
import { computeDatasetProvenance, DatasetProvenance } from '../engine/uxHelpers';
import {
  ActionLogEntry,
  BomLine,
  createSafeStorage,
  CsvImportResult,
  FactoryStore,
  JsonValidationReport,
  PersistedLineBalance,
  Product,
  ProductMetrics,
  ProductSnapshot,
  StorageHealth,
  Transaction,
  WorkspaceSettings,
  WorkspaceSummary,
} from './store';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warn';
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface StoreContextValue {
  products: Product[];
  transactions: Transaction[];
  settings: WorkspaceSettings;
  summary: WorkspaceSummary;
  datasetProvenance: DatasetProvenance;
  actionLog: ActionLogEntry[];
  clearActionLog: () => void;
  recordAction: (category: ActionLogEntry['category'], action: string, detail: string, route?: string) => void;
  completeOnboardingStep: (stepId: string) => void;
  resetOnboarding: () => void;
  storageMode: string;
  storageHealth: StorageHealth;
  undoLastWorkspaceReplace: () => boolean;
  getCorruptedBackupRaw: () => string | null;
  dismissCorruptedBackup: () => void;
  validateJSONImport: (text: string) => JsonValidationReport;
  validateProductsCSV: (text: string) => {
    valid: boolean;
    wouldCreate: number;
    wouldUpdate: number;
    skipped: Array<{ line: number; reason: string }>;
    fatalError?: string;
  };
  version: number;
  metricsOf: (p: Product) => ProductMetrics;
  getProduct: (id: string) => Product | null;
  bomOf: (productId: string) => Array<{ componentId: string; qtyPer: number; product: Product }>;
  materialCost: (productId: string) => number;
  categories: () => string[];
  valueHistory: (days?: number) => Array<{ ts: number; value: number }>;
  flowHistory: (days?: number) => Array<{ ts: number; inn: number; out: number }>;
  addProduct: (data: Partial<Product>) => Product;
  updateProduct: (id: string, data: Partial<Product>) => Product | null;
  deleteProductWithUndo: (id: string) => void;
  setBom: (productId: string, lines: BomLine[]) => void;
  moveStock: (productId: string, type: 'in' | 'out', qty: number, note?: string) => Transaction | null;
  setSetting: <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => void;
  lineBalance: PersistedLineBalance;
  setLineBalance: (lb: PersistedLineBalance) => void;
  smartAlertsResult: SmartAlertsResult;
  visibleSmartAlerts: SmartStockAlert[];
  smartAlertHorizonDays: number;
  dismissedSmartAlertIds: string[];
  setSmartAlertHorizonDays: (days: number) => void;
  dismissSmartAlert: (id: string) => void;
  restoreAllSmartAlerts: () => void;
  resetDemo: () => void;
  clearAll: () => void;
  exportJSON: () => string;
  importJSON: (text: string) => number;
  exportProductsCSV: () => string;
  exportTransactionsCSV: () => string;
  csvTemplate: () => string;
  importProductsCSV: (text: string) => CsvImportResult;
  toasts: ToastMessage[];
  pushToast: (t: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
  factorySimConfig: FactorySimConfig;
  setFactorySimConfig: (cfg: FactorySimConfig) => void;
  factoryScenarios: FactoryScenarioRecord[];
  saveFactoryScenario: (name: string, notes: string, cfg: FactorySimConfig) => FactoryScenarioRecord;
  deleteFactoryScenario: (id: string) => void;
  scenarioStudioRecords: ScenarioDefinition[];
  saveScenarioStudioRecord: (def: Omit<ScenarioDefinition, 'createdAt'> & { createdAt?: number }) => ScenarioDefinition;
  deleteScenarioStudioRecord: (id: string) => void;
  importScenarioStudioRecords: (defs: ScenarioDefinition[]) => number;
  applyScenarioToWorkspace: (def: ScenarioDefinition) => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const storageWarnedRef = useRef(false);
  const pushToastRef = useRef<(t: Omit<ToastMessage, 'id'>) => void>(() => {});
  const storeRef = useRef<FactoryStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new FactoryStore(
      createSafeStorage(() => {
        if (!storageWarnedRef.current) {
          storageWarnedRef.current = true;
          pushToastRef.current({
            type: 'warn',
            message: 'Browser storage quota exceeded — changes kept in memory until exported.',
          });
        }
      })
    );
  }
  const store = storeRef.current;

  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const pushToast = useCallback((t: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 5500);
  }, []);
  pushToastRef.current = pushToast;

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const corruptWarnedRef = useRef(false);
  useEffect(() => {
    const health = store.getStorageHealth();
    if (health.corruptedDetected && !corruptWarnedRef.current) {
      corruptWarnedRef.current = true;
      pushToast({
        type: 'error',
        message: 'Saved browser storage was corrupted and quarantined — open Settings to recover or reset.',
      });
    }
  }, [store, pushToast]);

  const settings = store.settings();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', settings.theme === 'dark');
    root.setAttribute('data-accent', settings.accent || 'emerald');
    const osReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.classList.toggle('reduce-motion', Boolean(settings.reduceMotion || osReduced));
  }, [settings.theme, settings.accent, settings.reduceMotion, version]);

  const alertPrefs = store.getSmartAlertPrefs();
  const productsSnapshot = store.products();
  const smartAlertsResult = useMemo(() => {
    void version;
    return predictSmartAlerts(store.products(), (p) => store.metrics(p), {
      horizonDays: alertPrefs.horizonDays,
    });
  }, [store, productsSnapshot, alertPrefs.horizonDays, version]);

  const visibleSmartAlerts = useMemo(
    () => smartAlertsResult.alerts.filter((a) => !alertPrefs.dismissedIds.includes(a.id)),
    [smartAlertsResult, alertPrefs.dismissedIds]
  );

  const value = useMemo<StoreContextValue>(() => {
    void version;
    const products = [...store.products()];
    const transactions = [...store.transactions()];
    const currentSettings = { ...store.settings() };
    const datasetProvenance = computeDatasetProvenance(products, transactions.length);

    return {
      products,
      transactions,
      settings: currentSettings,
      summary: store.summary(),
      datasetProvenance,
      actionLog: [...store.actionLog()],
      clearActionLog: () => {
        store.clearActionLog();
        bump();
      },
      recordAction: (category, action, detail, route) => {
        store.recordAction(category, action, detail, route);
        bump();
      },
      completeOnboardingStep: (stepId) => {
        const cur = currentSettings.onboardingCompletedSteps || [];
        if (!cur.includes(stepId)) {
          store.setSetting('onboardingCompletedSteps', [...cur, stepId]);
          bump();
        }
      },
      resetOnboarding: () => {
        store.setSetting('onboardingDismissed', false);
        store.setSetting('onboardingCompletedSteps', []);
        bump();
      },
      storageMode: store.storageMode,
      storageHealth: store.getStorageHealth(),
      undoLastWorkspaceReplace: () => {
        const ok = store.undoLastWorkspaceReplace();
        bump();
        return ok;
      },
      getCorruptedBackupRaw: () => store.getCorruptedBackupRaw(),
      dismissCorruptedBackup: () => {
        store.dismissCorruptedBackup();
        bump();
      },
      validateJSONImport: (text) => store.validateJSONImport(text).report,
      validateProductsCSV: (text) => store.validateProductsCSV(text),
      version,
      metricsOf: (p: Product) => store.metrics(p),
      getProduct: (id: string) => store.getProduct(id),
      bomOf: (id: string) => store.bomOf(id),
      materialCost: (id: string) => store.materialCost(id),
      categories: () => store.categories(),
      valueHistory: (days = 30) => store.valueHistory(days),
      flowHistory: (days = 30) => store.flowHistory(days),
      addProduct: (data) => {
        const res = store.addProduct(data);
        bump();
        return res;
      },
      updateProduct: (id, data) => {
        const res = store.updateProduct(id, data);
        bump();
        return res;
      },
      deleteProductWithUndo: (id) => {
        const snap: ProductSnapshot | null = store.deleteProductSnapshot(id);
        if (!snap) return;
        store.deleteProduct(id);
        bump();
        pushToast({
          type: 'info',
          message: `Removed ${snap.product.sku} · ${snap.product.name}`,
          actionLabel: 'Undo',
          onAction: () => {
            store.restoreProduct(snap);
            bump();
            pushToast({ type: 'success', message: `Restored ${snap.product.sku}.` });
          },
        });
      },
      setBom: (productId, lines) => {
        const p = store.getProduct(productId);
        store.setBom(productId, lines);
        if (p) {
          store.recordAction('bom', `Updated BOM for ${p.sku}`, `${lines.length} component line(s) saved`, 'production');
        }
        bump();
      },
      moveStock: (productId, type, qty, note) => {
        const tx = store.addTransaction(productId, type, qty, note);
        bump();
        return tx;
      },
      setSetting: (key, val) => {
        store.setSetting(key, val);
        bump();
      },
      lineBalance: store.getLineBalance(),
      setLineBalance: (lb) => {
        store.setLineBalance(lb);
        bump();
      },
      smartAlertsResult,
      visibleSmartAlerts,
      smartAlertHorizonDays: alertPrefs.horizonDays,
      dismissedSmartAlertIds: alertPrefs.dismissedIds,
      setSmartAlertHorizonDays: (days) => {
        store.setSmartAlertHorizonDays(days);
        bump();
      },
      dismissSmartAlert: (id) => {
        store.dismissSmartAlert(id);
        bump();
      },
      restoreAllSmartAlerts: () => {
        store.restoreAllSmartAlerts();
        bump();
      },
      resetDemo: () => {
        store.reset();
        bump();
      },
      clearAll: () => {
        store.clearAll();
        bump();
      },
      exportJSON: () => store.exportJSON(),
      importJSON: (text) => {
        const count = store.importJSON(text);
        bump();
        return count;
      },
      exportProductsCSV: () => store.exportProductsCSV(),
      exportTransactionsCSV: () => store.exportTransactionsCSV(),
      csvTemplate: () => store.csvTemplate(),
      importProductsCSV: (text) => {
        const res = store.importProductsCSV(text);
        bump();
        return res;
      },
      toasts,
      pushToast,
      dismissToast,
      factorySimConfig: store.getFactorySimConfig(),
      setFactorySimConfig: (cfg) => {
        store.setFactorySimConfig(cfg);
        bump();
      },
      factoryScenarios: [...store.getFactoryScenarios()],
      saveFactoryScenario: (name, notes, cfg) => {
        const rec = store.saveFactoryScenario(name, notes, cfg);
        store.recordAction('scenario', `Saved simulation scenario "${rec.name}"`, `${cfg.stations.length} stations · ${cfg.replications} reps`, 'factory-sim');
        bump();
        return rec;
      },
      deleteFactoryScenario: (id) => {
        store.deleteFactoryScenario(id);
        bump();
      },
      scenarioStudioRecords: [...store.getScenarioStudioRecords()],
      saveScenarioStudioRecord: (def) => {
        const rec = store.saveScenarioStudioRecord(def);
        store.recordAction('scenario', `Saved Studio scenario "${rec.name}"`, rec.notes || 'Counterfactual saved', 'scenario-studio');
        bump();
        return rec;
      },
      deleteScenarioStudioRecord: (id) => {
        store.deleteScenarioStudioRecord(id);
        bump();
      },
      importScenarioStudioRecords: (defs) => {
        const count = store.importScenarioStudioRecords(defs);
        bump();
        return count;
      },
      applyScenarioToWorkspace: (def) => {
        store.applyScenarioToWorkspace(def);
        bump();
      },
    };
  }, [store, version, bump, toasts, pushToast, dismissToast, smartAlertsResult, visibleSmartAlerts, alertPrefs]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
