import React, { useRef, useState } from 'react';
import { Compass, Download, History, Keyboard, Play, RotateCcw, Trash2, Upload } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DatasetProvenanceIndicator,
  downloadFile,
  Panel,
  SegmentedControl,
} from '../components/ui/Primitives';
import { useStore } from '../store/StoreContext';

export const SettingsPage: React.FC<{
  onOpenShortcuts: () => void;
  onReplaySplash?: () => void;
  onOpenOnboarding?: () => void;
  onOpenHistory?: () => void;
}> = ({ onOpenShortcuts, onReplaySplash, onOpenOnboarding, onOpenHistory }) => {
  const {
    settings,
    storageMode,
    datasetProvenance,
    setSetting,
    exportJSON,
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

  const handleJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const count = importJSON(String(reader.result || ''));
        pushToast({ type: 'success', message: `Restored ${count} SKUs from JSON backup.` });
      } catch (err) {
        pushToast({ type: 'error', message: (err as Error).message });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const res = importProductsCSV(String(reader.result || ''));
        pushToast({
          type: 'success',
          message: `CSV import: ${res.created} created, ${res.updated} updated.`,
        });
      } catch (err) {
        pushToast({ type: 'error', message: (err as Error).message });
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

  return (
    <div className="space-y-4 max-w-4xl">
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
        subtitle={`Storage backend: ${storageMode === 'localStorage' ? 'Browser localStorage (persistent)' : 'In-memory session'}`}
      >
        <input ref={jsonFileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleJsonUpload} />
        <input ref={csvFileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvUpload} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2.5">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">Full JSON Workspace Snapshot</div>
            <p className="text-xs text-slate-600 dark:text-slate-300">Includes all SKUs, BOMs, demand histories, transactions, scenarios, and settings.</p>
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
            <p className="text-xs text-slate-600 dark:text-slate-300">Export inventory or stock ledger tables, or import SKUs from a CSV template.</p>
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
            ? 'Restores the 17 seeded industrial SKUs, 5 BOMs, and 34 transactions. Any unsaved edits will be replaced.'
            : 'Removes every SKU and ledger entry from storage so you can start with a blank plant dataset.'
        }
        confirmLabel={confirmMode === 'reset' ? 'Confirm reset' : 'Confirm clear'}
        danger={confirmMode === 'clear'}
        onConfirm={() => {
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
