import React, { useRef, useState } from 'react';
import { AlertTriangle, Compass, Download, History, Keyboard, Play, RotateCcw, Trash2, Undo2, Upload } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DatasetProvenanceIndicator,
  downloadFile,
  ErrorBanner,
  Panel,
  SegmentedControl,
} from '../components/ui/Primitives';
import { useStore } from '../store/StoreContext';

interface ImportReportState {
  kind: 'json' | 'csv';
  status: 'error' | 'warn' | 'success';
  title: string;
  details: string[];
}

export const SettingsPage: React.FC<{
  onOpenShortcuts: () => void;
  onReplaySplash?: () => void;
  onOpenOnboarding?: () => void;
  onOpenHistory?: () => void;
}> = ({ onOpenShortcuts, onReplaySplash, onOpenOnboarding, onOpenHistory }) => {
  const {
    settings,
    storageMode,
    storageHealth,
    undoLastWorkspaceReplace,
    getCorruptedBackupRaw,
    dismissCorruptedBackup,
    datasetProvenance,
    setSetting,
    exportJSON,
    validateJSONImport,
    importJSON,
    exportProductsCSV,
    exportTransactionsCSV,
    csvTemplate,
    importProductsCSV,
    resetDemo,
    clearAll,
    pushToast,
  } = useStore();

  const jsonFileRef = useRef<HTMLInputElement | null>(null);
  const csvFileRef = useRef<HTMLInputElement | null>(null);
  const [confirmMode, setConfirmMode] = useState<'reset' | 'clear' | null>(null);
  const [importReport, setImportReport] = useState<ImportReportState | null>(null);

  const handleJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => {
      pushToast({ type: 'error', message: `Could not read "${file.name}".` });
    };
    reader.onload = () => {
      const raw = String(reader.result || '');
      const validation = validateJSONImport(raw);
      if (!validation.valid) {
        setImportReport({
          kind: 'json',
          status: 'error',
          title: `JSON backup "${file.name}" failed validation — existing workspace untouched.`,
          details: validation.errors.slice(0, 8).map((err) => `${err.path}: ${err.message}`),
        });
        pushToast({ type: 'error', message: validation.errors[0]?.message || 'Invalid JSON backup.' });
        return;
      }
      try {
        const count = importJSON(raw);
        setImportReport({
          kind: 'json',
          status: 'success',
          title: `Restored ${count} SKUs and ${validation.transactionCount} transactions from JSON backup (schema v${validation.schemaVersion}).`,
          details: validation.warnings,
        });
        pushToast({ type: 'success', message: `Restored ${count} SKUs from JSON backup.` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to import JSON backup.';
        setImportReport({ kind: 'json', status: 'error', title: 'JSON restore rejected', details: [msg] });
        pushToast({ type: 'error', message: msg });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => {
      pushToast({ type: 'error', message: `Could not read "${file.name}".` });
    };
    reader.onload = () => {
      try {
        const res = importProductsCSV(String(reader.result || ''));
        if (res.created === 0 && res.updated === 0 && res.skipped.length > 0) {
          setImportReport({
            kind: 'csv',
            status: 'error',
            title: `CSV import skipped all ${res.skipped.length} row(s) — existing workspace untouched.`,
            details: res.skipped.slice(0, 8).map((s) => `Line ${s.line}: ${s.reason}`),
          });
          pushToast({
            type: 'error',
            message: `CSV import skipped all ${res.skipped.length} row(s): ${res.skipped[0].reason}.`,
          });
        } else {
          setImportReport({
            kind: 'csv',
            status: res.skipped.length > 0 ? 'warn' : 'success',
            title: `CSV import: ${res.created} created, ${res.updated} updated${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}.`,
            details: res.skipped.slice(0, 8).map((s) => `Line ${s.line}: ${s.reason}`),
          });
          pushToast({
            type: res.skipped.length > 0 ? 'warn' : 'success',
            message: `CSV import: ${res.created} created, ${res.updated} updated${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}.`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Malformed CSV file.';
        setImportReport({ kind: 'csv', status: 'error', title: `CSV import rejected (${file.name})`, details: [msg] });
        pushToast({ type: 'error', message: msg });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const accents: Array<{ id: 'blue' | 'emerald' | 'amber' | 'violet'; label: string; dot: string }> = [
    { id: 'blue', label: 'Industrial Blue', dot: 'bg-blue-600' },
    { id: 'emerald', label: 'Emerald', dot: 'bg-emerald-600' },
    { id: 'amber', label: 'Amber', dot: 'bg-amber-600' },
    { id: 'violet', label: 'Violet', dot: 'bg-violet-600' },
  ];

  const storageSubtitle =
    storageHealth.status === 'corrupted'
      ? 'Storage recovery mode (corrupted data quarantined — download or restore below)'
      : storageHealth.status === 'quota_exceeded'
        ? `Browser quota limit hit (~${Math.round(storageHealth.estimatedBytes / 1024)} KB) — edits kept in memory until exported`
        : storageMode === 'localStorage'
          ? `Browser localStorage (persistent · ~${Math.max(1, Math.round(storageHealth.estimatedBytes / 1024))} KB)`
          : 'In-memory session (browser storage unavailable)';

  return (
    <div className="space-y-4 max-w-4xl">
      {storageHealth.corruptedDetected && (
        <ErrorBanner
          title="Saved workspace storage was corrupted — recovered safely without overwriting with sample data"
          message={
            storageHealth.lastError ||
            'Your previous browser storage payload could not be parsed cleanly. It has been preserved in quarantine so you can download it or restore a clean backup.'
          }
          action={
            <div className="flex flex-wrap gap-2">
              {getCorruptedBackupRaw() && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => downloadFile('factorymind-corrupted-raw.json', getCorruptedBackupRaw() || '', 'application/json')}
                >
                  <Download className="h-3.5 w-3.5" /> Download raw data
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => jsonFileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Restore JSON
              </Button>
              <Button size="sm" variant="ghost" onClick={dismissCorruptedBackup}>
                Dismiss quarantine
              </Button>
            </div>
          }
        />
      )}

      {storageHealth.quotaExceeded && !storageHealth.corruptedDetected && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300/80 dark:border-amber-800/80 bg-amber-50/70 dark:bg-amber-950/35 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                Browser localStorage quota reached (~{Math.round(storageHealth.estimatedBytes / 1024)} KB)
              </div>
              <p className="text-xs text-amber-800 dark:text-amber-300/90 mt-0.5">
                Recent changes are preserved in active memory. Export a JSON backup now so nothing is lost on tab close.
              </p>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => downloadFile('factorymind-backup.json', exportJSON(), 'application/json')}>
            <Download className="h-3.5 w-3.5" /> Export JSON backup
          </Button>
        </div>
      )}

      <DatasetProvenanceIndicator provenance={datasetProvenance} />

      <Panel title="Appearance & accessibility" subtitle="Theme and accent preferences save automatically">
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Color theme</div>
              <div className="text-xs text-slate-600 dark:text-slate-300">Switch between crisp daylight and control-room dark UI</div>
            </div>
            <SegmentedControl
              ariaLabel="Color theme"
              value={settings.theme}
              onChange={(v) => setSetting('theme', v as 'light' | 'dark')}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Accent palette</div>
              <div className="text-xs text-slate-600 dark:text-slate-300">Primary focus color across charts, active navigation, and controls</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {accents.map((a) => {
                const active = settings.accent === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSetting('accent', a.id)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium cursor-pointer ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-slate-900 dark:text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${a.dot}`} />
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Reduce motion</div>
              <div className="text-xs text-slate-600 dark:text-slate-300">Disables interface transitions (also honors OS reduced-motion setting)</div>
            </div>
            <SegmentedControl
              ariaLabel="Motion preference"
              value={settings.reduceMotion ? 'on' : 'off'}
              onChange={(v) => setSetting('reduceMotion', v === 'on')}
              options={[
                { value: 'off', label: 'Standard' },
                { value: 'on', label: 'Reduced' },
              ]}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="Data portability & backups"
        subtitle={`Storage backend: ${storageSubtitle}`}
        actions={
          storageHealth.canUndoLastReplace ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (undoLastWorkspaceReplace()) {
                  setImportReport(null);
                  pushToast({ type: 'success', message: 'Reverted previous workspace replacement.' });
                }
              }}
            >
              <Undo2 className="h-3.5 w-3.5" /> Undo last replace
            </Button>
          ) : undefined
        }
      >
        <input ref={jsonFileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleJsonUpload} />
        <input ref={csvFileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvUpload} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2.5">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">Full JSON Workspace Snapshot (Schema v2)</div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Includes all SKUs, BOMs, demand histories, transactions, line balance, scenarios, and settings. Validates schema and duplicates before applying.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => downloadFile('factorymind-backup.json', exportJSON(), 'application/json')}>
                <Download className="h-3.5 w-3.5" /> Export JSON
              </Button>
              <Button size="sm" variant="secondary" onClick={() => jsonFileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Restore JSON
              </Button>
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">CSV Spreadsheets</div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Formula-escaped CSV exports for inventory or stock ledger, plus line-validated SKU imports with duplicate detection.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => downloadFile('factorymind-inventory.csv', exportProductsCSV(), 'text/csv')}>
                Inventory CSV
              </Button>
              <Button size="sm" variant="secondary" onClick={() => downloadFile('factorymind-ledger.csv', exportTransactionsCSV(), 'text/csv')}>
                Ledger CSV
              </Button>
              <Button size="sm" variant="secondary" onClick={() => downloadFile('factorymind-template.csv', csvTemplate(), 'text/csv')}>
                Template
              </Button>
              <Button size="sm" variant="secondary" onClick={() => csvFileRef.current?.click()}>
                Import CSV
              </Button>
            </div>
          </div>
        </div>

        {importReport && (
          <div
            role={importReport.status === 'error' ? 'alert' : 'status'}
            className={`mt-4 rounded-lg border p-3 text-xs ${
              importReport.status === 'error'
                ? 'border-rose-300/80 dark:border-rose-800/80 bg-rose-50/70 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
                : importReport.status === 'warn'
                  ? 'border-amber-300/80 dark:border-amber-800/80 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                  : 'border-emerald-300/80 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2 font-semibold">
              <span>{importReport.title}</span>
              <button type="button" onClick={() => setImportReport(null)} className="underline text-[11px] cursor-pointer">
                Dismiss
              </button>
            </div>
            {importReport.details.length > 0 && (
              <ul className="mt-1.5 list-disc list-inside space-y-0.5 font-mono text-[11px]">
                {importReport.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Workspace controls & attribution" subtitle="Reset demo catalogue, inspect action history, guided tour, and shortcuts">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {onOpenOnboarding && (
              <Button size="sm" variant="secondary" onClick={onOpenOnboarding}>
                <Compass className="h-3.5 w-3.5" /> Guided tour
              </Button>
            )}
            {onOpenHistory && (
              <Button size="sm" variant="secondary" onClick={onOpenHistory}>
                <History className="h-3.5 w-3.5" /> Action history
              </Button>
            )}
            {onReplaySplash && (
              <Button size="sm" variant="secondary" onClick={onReplaySplash}>
                <Play className="h-3.5 w-3.5" /> Replay loading screen
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={onOpenShortcuts}>
              <Keyboard className="h-3.5 w-3.5" /> Keyboard shortcuts
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmMode('reset')}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset demo dataset
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmMode('clear')}>
              <Trash2 className="h-3.5 w-3.5" /> Clear all data
            </Button>
          </div>
          <div className="text-xs text-slate-600 dark:text-slate-300 font-mono">
            Made by <span className="font-semibold text-slate-900 dark:text-white">Md Ibtashamur Rahman</span> · Department of IPE, SUST
          </div>
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmMode !== null}
        onClose={() => setConfirmMode(null)}
        title={confirmMode === 'reset' ? 'Reset demo workspace?' : 'Clear entire workspace?'}
        message={
          confirmMode === 'reset'
            ? 'Restores the 17 seeded industrial SKUs, 5 BOMs, and 34 transactions. An undo snapshot of your current workspace will be kept for this session.'
            : 'Removes every SKU and ledger entry from storage so you can start with a blank plant dataset. An undo snapshot will be kept for this session.'
        }
        confirmLabel={confirmMode === 'reset' ? 'Confirm reset' : 'Confirm clear'}
        danger={confirmMode === 'clear'}
        onConfirm={() => {
          setImportReport(null);
          if (confirmMode === 'reset') {
            resetDemo();
            pushToast({ type: 'success', message: 'Demo workspace restored (17 SKUs, 34 movements).' });
          } else {
            clearAll();
            pushToast({ type: 'info', message: 'Cleared all SKUs and ledger entries.' });
          }
        }}
      />
    </div>
  );
};
