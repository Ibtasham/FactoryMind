import React, { useMemo, useState } from 'react';
import { LineChart } from '../components/charts/Charts';
import { ErrorBanner, Field, Input, Panel, SegmentedControl, StatCard } from '../components/ui/Primitives';
import { clampNumericInput, fmtNum } from '../engine/formatters';
import { spcAnalysis, spcDrift } from '../engine/ipe';

const PRESETS: Record<string, { label: string; lsl: number; usl: number; rows: string }> = {
  stable: {
    label: 'Stable bearing bore (mm)',
    lsl: 24.94,
    usl: 25.06,
    rows: [
      '25.002, 24.996, 25.005, 24.998, 25.001',
      '24.997, 25.004, 25.000, 24.995, 25.003',
      '25.006, 24.999, 25.002, 24.997, 25.001',
      '24.994, 25.001, 25.003, 24.999, 25.000',
      '25.005, 25.002, 24.996, 25.001, 24.998',
      '24.998, 25.003, 24.999, 25.004, 24.997',
      '25.001, 24.995, 25.002, 25.000, 24.999',
      '25.004, 24.998, 25.001, 24.996, 25.003',
      '24.999, 25.005, 25.000, 24.997, 25.002',
      '25.002, 24.997, 25.004, 25.001, 24.998',
    ].join('\n'),
  },
  drift: {
    label: 'Tool-wear upward drift',
    lsl: 24.94,
    usl: 25.06,
    rows: [
      '24.995, 25.001, 24.998, 25.002, 24.999',
      '24.998, 25.003, 24.997, 25.000, 25.001',
      '25.001, 24.999, 25.004, 25.002, 25.000',
      '25.004, 25.002, 25.006, 25.003, 25.005',
      '25.007, 25.005, 25.009, 25.006, 25.008',
      '25.011, 25.008, 25.012, 25.010, 25.009',
      '25.014, 25.012, 25.016, 25.013, 25.015',
      '25.018, 25.016, 25.020, 25.017, 25.019',
      '25.022, 25.019, 25.024, 25.021, 25.023',
      '25.026, 25.024, 25.028, 25.025, 25.027',
    ].join('\n'),
  },
  ooc: {
    label: 'Out-of-control spike',
    lsl: 24.94,
    usl: 25.06,
    rows: [
      '25.001, 24.998, 25.003, 24.999, 25.000',
      '24.999, 25.002, 25.000, 24.997, 25.001',
      '25.002, 24.998, 25.004, 25.001, 24.999',
      '25.024, 25.028, 25.021, 25.026, 25.023',
      '25.000, 25.003, 24.997, 25.001, 24.999',
      '24.998, 25.001, 25.002, 24.996, 25.000',
      '25.002, 24.999, 25.001, 25.003, 24.998',
      '24.997, 25.000, 25.004, 24.999, 25.001',
    ].join('\n'),
  },
};

export const SpcPage: React.FC = () => {
  const [preset, setPreset] = useState<'stable' | 'drift' | 'ooc'>('drift');
  const [rawText, setRawText] = useState(PRESETS.drift.rows);
  const [lsl, setLsl] = useState(PRESETS.drift.lsl);
  const [usl, setUsl] = useState(PRESETS.drift.usl);
  const [lambda, setLambda] = useState(0.2);
  const [cusumK, setCusumK] = useState(0.5);
  const [cusumH, setCusumH] = useState(4);

  const loadPreset = (key: 'stable' | 'drift' | 'ooc') => {
    setPreset(key);
    setRawText(PRESETS[key].rows);
    setLsl(PRESETS[key].lsl);
    setUsl(PRESETS[key].usl);
  };

  const parsedSubgroups = useMemo(() => {
    const groups: number[][] = [];
    const rejectedTokens: string[] = [];
    rawText.split('\n').forEach((line) => {
      const vals: number[] = [];
      line
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .forEach((tok) => {
          const n = Number(tok);
          if (Number.isFinite(n)) {
            vals.push(n);
          } else {
            rejectedTokens.push(tok);
          }
        });
      if (vals.length > 0) groups.push(vals);
    });
    return { subgroups: groups, rejectedTokens };
  }, [rawText]);

  const subgroups = parsedSubgroups.subgroups;

  const spc = useMemo(() => spcAnalysis({ subgroups, usl, lsl }), [subgroups, usl, lsl]);
  const drift = useMemo(
    () => spcDrift({ subgroups, usl, lsl, lambda, k: cusumK, h: cusumH }),
    [subgroups, usl, lsl, lambda, cusumK, cusumH]
  );

  const labels = useMemo(() => spc.means.map((_, i) => `S${i + 1}`), [spc.means]);

  return (
    <div className="space-y-4">
      <Panel
        title="Subgroup measurements & specification limits"
        subtitle="One subgroup per line (2–10 equal measurements) · Western Electric Rules 1–3 + EWMA/CUSUM"
        actions={
          <SegmentedControl
            value={preset}
            onChange={(v) => loadPreset(v as typeof preset)}
            options={[
              { value: 'drift', label: 'Tool-wear Drift' },
              { value: 'ooc', label: 'OOC Spike' },
              { value: 'stable', label: 'Stable' },
            ]}
          />
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7">
            <Field label="Subgroup matrix (comma or space separated)">
              <textarea
                rows={5}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
              />
            </Field>
          </div>
          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
            <Field label="Lower spec limit (LSL)">
              <Input type="number" step="0.01" value={lsl} onChange={(e) => setLsl(clampNumericInput(e.target.value, lsl, -1000000, 1000000))} />
            </Field>
            <Field
              label="Upper spec limit (USL)"
              error={usl <= lsl ? `Must exceed LSL (${lsl}).` : undefined}
            >
              <Input type="number" step="0.01" value={usl} onChange={(e) => setUsl(clampNumericInput(e.target.value, usl, -1000000, 1000000))} />
            </Field>
            <Field label="EWMA weight λ" termKey="ewma">
              <Input type="number" min="0.05" max="0.95" step="0.05" value={lambda} onChange={(e) => setLambda(clampNumericInput(e.target.value, lambda, 0.05, 0.95))} />
            </Field>
            <Field label="CUSUM allowance k" termKey="cusum">
              <Input type="number" min="0.1" max="5" step="0.1" value={cusumK} onChange={(e) => setCusumK(clampNumericInput(e.target.value, cusumK, 0.1, 5))} />
            </Field>
            <Field label="CUSUM decision limit h">
              <Input type="number" min="0.5" max="20" step="0.5" value={cusumH} onChange={(e) => setCusumH(clampNumericInput(e.target.value, cusumH, 0.5, 20))} />
            </Field>
          </div>
        </div>
      </Panel>

      {parsedSubgroups.rejectedTokens.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300/70 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
        >
          Ignored {parsedSubgroups.rejectedTokens.length} non-numeric measurement token(s) ({parsedSubgroups.rejectedTokens.slice(0, 4).join(', ')}).
        </div>
      )}

      {usl <= lsl && (
        <ErrorBanner
          title="Specification limits invalid (USL ≤ LSL)"
          message={`Upper specification limit (${usl}) must be strictly greater than lower specification limit (${lsl}) to compute Cp, Cpk, and out-of-spec percentage.`}
        />
      )}

      {!spc.valid ? (
        <ErrorBanner title="Invalid SPC input" message={spc.reason || 'Enter at least 2 subgroups with 2–10 measurements per line.'} />
      ) : (
        <>
          {spc.dropped > 0 && (
            <div
              role="alert"
              className="rounded-lg border border-amber-300/70 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
            >
              {spc.dropped} subgroup row(s) had inconsistent sample size and were excluded (expected n={spc.n}).
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <StatCard
              label="Process capability (Cpk)"
              termKey="cpk"
              value={spc.cap ? fmtNum(spc.cap.Cpk, 2) : '—'}
              sub={
                spc.cap
                  ? spc.phase2Cap
                    ? `Cp ${fmtNum(spc.cap.Cp, 2)} · Phase II in-ctrl Cpk ${fmtNum(spc.phase2Cap.Cpk, 2)} (${spc.phase2Cap.subgroupsKept}/${spc.subgroups})`
                    : `Cp ${fmtNum(spc.cap.Cp, 2)} · Pp ${fmtNum(spc.cap.Pp, 2)} · ${spc.capabilityLevel}`
                  : spc.capabilityLevel
              }
              tone={!spc.cap ? 'neutral' : spc.cap.Cpk >= 1.33 ? 'good' : spc.cap.Cpk >= 1.0 ? 'warn' : 'bad'}
            />
            <StatCard
              label="Grand mean (X̄̄) & R̄"
              value={fmtNum(spc.xbar, 4)}
              sub={`R̄ ${fmtNum(spc.rbar, 4)} · σ̂ = ${fmtNum(spc.sigma, 4)}`}
            />
            <StatCard
              label="Western Electric violations"
              termKey="westernElectric"
              value={String(spc.oocCount)}
              sub={`R1: ${spc.ruleCounts[1]} · R2: ${spc.ruleCounts[2]} · R3: ${spc.ruleCounts[3]}`}
              tone={spc.oocCount > 0 ? 'bad' : 'good'}
            />
            <StatCard
              label="EWMA / CUSUM drift alarm"
              termKey="ewma"
              value={drift.valid && drift.firstAlarm != null ? `Subgroup S${drift.firstAlarm + 1}` : 'In control'}
              sub={
                spc.outOfSpecPct != null
                  ? `Est. out of spec: ${fmtNum(spc.outOfSpecPct, 3)}%`
                  : 'No drift alarms'
              }
              tone={drift.valid && drift.firstAlarm != null ? 'warn' : 'good'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="X̄ Control Chart" subtitle={`UCL ${fmtNum(spc.ucl, 4)} · CL ${fmtNum(spc.centre, 4)} · LCL ${fmtNum(spc.lcl, 4)}`}>
              <LineChart
                labels={labels}
                height={240}
                formatValue={(v) => v.toFixed(3)}
                referenceLines={[
                  { value: spc.ucl, label: `UCL ${fmtNum(spc.ucl, 3)}`, color: '#ef4444' },
                  { value: spc.centre, label: `CL ${fmtNum(spc.centre, 3)}`, color: '#64748b' },
                  { value: spc.lcl, label: `LCL ${fmtNum(spc.lcl, 3)}`, color: '#ef4444' },
                ]}
                series={[
                  {
                    name: 'Subgroup mean X̄',
                    data: spc.means,
                    color: '#2563eb',
                    pointFlags: spc.flags.map((f) => f.length > 0),
                  },
                ]}
              />
            </Panel>

            <Panel title="R (Range) Control Chart" subtitle={`UCL ${fmtNum(spc.rUcl, 4)} · R̄ ${fmtNum(spc.rCentre, 4)} · LCL ${fmtNum(spc.rLcl, 4)}`}>
              <LineChart
                labels={labels}
                height={240}
                yMinZero
                formatValue={(v) => v.toFixed(4)}
                referenceLines={[
                  { value: spc.rUcl, label: `UCL ${fmtNum(spc.rUcl, 3)}`, color: '#ef4444' },
                  { value: spc.rCentre, label: `R̄ ${fmtNum(spc.rCentre, 3)}`, color: '#64748b' },
                ]}
                series={[
                  {
                    name: 'Subgroup range R',
                    data: spc.ranges,
                    color: '#10b981',
                    pointFlags: spc.rFlags.map((f) => f.length > 0),
                  },
                ]}
              />
            </Panel>
          </div>

          {drift.valid && drift.ewma && drift.cusum && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel
                title={`EWMA Drift Chart (λ = ${lambda})`}
                subtitle={`Target ${fmtNum(drift.ewma.target, 3)} · Asymptotic [${fmtNum(drift.ewma.lcl, 4)}, ${fmtNum(drift.ewma.ucl, 4)}] (exact finite-horizon startup flags)`}
              >
                <LineChart
                  labels={labels}
                  height={220}
                  formatValue={(v) => v.toFixed(3)}
                  referenceLines={[
                    { value: drift.ewma.ucl, label: 'EWMA UCL', color: '#ef4444' },
                    { value: drift.ewma.lcl, label: 'EWMA LCL', color: '#ef4444' },
                  ]}
                  series={[
                    {
                      name: 'EWMA Z_i',
                      data: drift.ewma.series,
                      color: '#8b5cf6',
                      pointFlags: drift.ewma.flags,
                    },
                  ]}
                />
              </Panel>

              <Panel
                title={`Two-Sided CUSUM Chart (k = ${cusumK}, h = ${cusumH})`}
                subtitle="Detects sustained small mean shifts (0.5σ–1.5σ) earlier than Shewhart X̄"
              >
                <LineChart
                  labels={labels}
                  height={220}
                  yMinZero
                  formatValue={(v) => v.toFixed(2)}
                  referenceLines={[{ value: cusumH, label: `Decision h=${cusumH}`, color: '#ef4444' }]}
                  series={[
                    { name: 'Upper CUSUM (C+)', data: drift.cusum.up, color: '#f59e0b' },
                    { name: 'Lower CUSUM (C−)', data: drift.cusum.down, color: '#06b6d4' },
                  ]}
                />
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  );
};
