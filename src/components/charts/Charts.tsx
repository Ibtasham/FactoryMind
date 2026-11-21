import React, { useMemo, useState } from 'react';

export interface LineSeries {
  name: string;
  data: Array<number | null>;
  color?: string;
  dashed?: boolean;
  area?: boolean;
  pointFlags?: boolean[];
}

export interface ReferenceLine {
  value: number;
  label: string;
  color?: string;
  dashed?: boolean;
}

export interface PredictionBand {
  lower: Array<number | null>;
  upper: Array<number | null>;
  color?: string;
}

interface LineChartProps {
  labels: string[];
  series: LineSeries[];
  height?: number;
  formatValue?: (v: number) => string;
  referenceLines?: ReferenceLine[];
  band?: PredictionBand;
  yMinZero?: boolean;
  caption?: string;
}

const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

export const LineChart: React.FC<LineChartProps> = ({
  labels,
  series,
  height = 240,
  formatValue = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(1)),
  referenceLines = [],
  band,
  yMinZero = false,
  caption,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const W = 720;
  const H = height;
  const pad = { top: 18, right: 20, bottom: 30, left: 56 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;
  const n = Math.max(labels.length, ...series.map((s) => s.data.length), 1);

  const { minY, maxY, ticks, rawMin, rawMax } = useMemo(() => {
    const vals: number[] = [];
    series.forEach((s) =>
      s.data.forEach((v) => {
        if (v != null && Number.isFinite(v)) vals.push(v);
      })
    );
    referenceLines.forEach((r) => {
      if (Number.isFinite(r.value)) vals.push(r.value);
    });
    if (band) {
      band.lower.forEach((v) => {
        if (v != null && Number.isFinite(v)) vals.push(v);
      });
      band.upper.forEach((v) => {
        if (v != null && Number.isFinite(v)) vals.push(v);
      });
    }
    let lo = vals.length ? Math.min(...vals) : 0;
    let hi = vals.length ? Math.max(...vals) : 100;
    const rawMinVal = lo;
    const rawMaxVal = hi;
    if (yMinZero) lo = Math.min(0, lo);
    if (Math.abs(hi - lo) < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const span = hi - lo;
    const minVal = yMinZero && lo >= 0 ? 0 : lo - span * 0.08;
    const maxVal = hi + span * 0.08;
    const tickList = Array.from({ length: 5 }, (_, i) => minVal + ((maxVal - minVal) * i) / 4);
    return { minY: minVal, maxY: maxVal, ticks: tickList, rawMin: rawMinVal, rawMax: rawMaxVal };
  }, [series, referenceLines, band, yMinZero]);

  const xAt = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * pw : pw / 2);
  const yAt = (v: number) => pad.top + ph - ((v - minY) / (maxY - minY || 1)) * ph;

  const bandPath = useMemo(() => {
    if (!band) return '';
    const upperPts: string[] = [];
    const lowerPts: string[] = [];
    for (let i = 0; i < n; i++) {
      const u = band.upper[i];
      const l = band.lower[i];
      if (u != null && l != null && Number.isFinite(u) && Number.isFinite(l)) {
        upperPts.push(`${xAt(i).toFixed(1)},${yAt(u).toFixed(1)}`);
        lowerPts.unshift(`${xAt(i).toFixed(1)},${yAt(l).toFixed(1)}`);
      }
    }
    if (upperPts.length < 2) return '';
    return `M ${upperPts.join(' L ')} L ${lowerPts.join(' L ')} Z`;
  }, [band, n, minY, maxY]);

  const visibleXTicks = useMemo(() => {
    const set = new Set<number>();
    if (n <= 1) {
      if (n === 1) set.add(0);
      return set;
    }
    const step = Math.max(1, Math.ceil(n / 6));
    let last = -step;
    for (let i = 0; i < n - 1; i += step) {
      set.add(i);
      last = i;
    }
    if (step > 1 && n - 1 - last < Math.max(2, Math.floor(step * 0.65)) && last > 0) {
      set.delete(last);
    }
    set.add(n - 1);
    return set;
  }, [n]);

  const summaryText =
    caption ||
    `Line chart showing ${series.map((s) => s.name).join(', ')} across ${n} periods (range ${formatValue(rawMin)} to ${formatValue(rawMax)}).`;

  return (
    <figure className="relative w-full select-none">
      <figcaption className="sr-only">{summaryText}</figcaption>

      {showTable ? (
        <div className="max-h-60 overflow-auto rounded-md border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
              <tr className="text-left text-[11px] text-slate-600 dark:text-slate-300">
                <th scope="col" className="px-3 py-1.5 font-medium">Period</th>
                {series.map((s) => (
                  <th key={s.name} scope="col" className="px-3 py-1.5 font-medium text-right">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {Array.from({ length: n }, (_, i) => (
                <tr key={i}>
                  <th scope="row" className="px-3 py-1.5 text-left font-mono font-normal text-slate-700 dark:text-slate-200">
                    {labels[i] ?? `#${i + 1}`}
                  </th>
                  {series.map((s) => {
                    const v = s.data[i];
                    return (
                      <td key={s.name} className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-100">
                        {v != null && Number.isFinite(v) ? formatValue(v) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="rounded focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
          tabIndex={0}
          role="img"
          aria-label={`${summaryText} Use Left and Right arrow keys to inspect individual points.`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              setHoverIdx((prev) => (prev == null ? 0 : Math.min(n - 1, prev + 1)));
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setHoverIdx((prev) => (prev == null ? n - 1 : Math.max(0, prev - 1)));
            } else if (e.key === 'Home') {
              e.preventDefault();
              setHoverIdx(0);
            } else if (e.key === 'End') {
              e.preventDefault();
              setHoverIdx(n - 1);
            } else if (e.key === 'Escape') {
              setHoverIdx(null);
            }
          }}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto overflow-visible"
            aria-hidden="true"
            onMouseLeave={() => setHoverIdx(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * W;
              const clamped = Math.max(pad.left, Math.min(W - pad.right, relX));
              const idx = n > 1 ? Math.round(((clamped - pad.left) / pw) * (n - 1)) : 0;
              setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
            }}
          >
            {ticks.map((t, i) => {
              const y = yAt(t);
              return (
                <g key={i}>
                  <line
                    x1={pad.left}
                    x2={W - pad.right}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800"
                    strokeWidth={1}
                  />
                  <text
                    x={pad.left - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    className="fill-slate-600 dark:fill-slate-300 text-[10px] font-mono tabular-nums"
                  >
                    {formatValue(t)}
                  </text>
                </g>
              );
            })}

            {bandPath && (
              <path d={bandPath} fill={band?.color || '#3b82f6'} fillOpacity={0.14} stroke="none" />
            )}

            {referenceLines.map((rl, i) => {
              const y = yAt(rl.value);
              return (
                <g key={i}>
                  <line
                    x1={pad.left}
                    x2={W - pad.right}
                    y1={y}
                    y2={y}
                    stroke={rl.color || '#ef4444'}
                    strokeWidth={1.25}
                    strokeDasharray={rl.dashed === false ? undefined : '4 4'}
                  />
                  <text
                    x={W - pad.right - 4}
                    y={y - 4}
                    textAnchor="end"
                    fill={rl.color || '#ef4444'}
                    className="text-[10px] font-mono font-medium"
                  >
                    {rl.label}
                  </text>
                </g>
              );
            })}

            {series.map((s, si) => {
              const color = s.color || DEFAULT_COLORS[si % DEFAULT_COLORS.length];
              const segments: Array<Array<{ x: number; y: number; i: number }>> = [];
              let cur: Array<{ x: number; y: number; i: number }> = [];
              s.data.forEach((v, i) => {
                if (v != null && Number.isFinite(v)) {
                  cur.push({ x: xAt(i), y: yAt(v), i });
                } else if (cur.length) {
                  segments.push(cur);
                  cur = [];
                }
              });
              if (cur.length) segments.push(cur);

              return (
                <g key={s.name}>
                  {s.area &&
                    segments.map((seg, k) => {
                      if (seg.length < 2) return null;
                      const areaD = `M ${seg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} L ${seg[seg.length - 1].x.toFixed(1)},${(pad.top + ph).toFixed(1)} L ${seg[0].x.toFixed(1)},${(pad.top + ph).toFixed(1)} Z`;
                      return <path key={k} d={areaD} fill={color} fillOpacity={0.1} />;
                    })}
                  {segments.map((seg, k) => {
                    if (seg.length === 1) {
                      return <circle key={k} cx={seg[0].x} cy={seg[0].y} r={3} fill={color} />;
                    }
                    const d = `M ${seg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')}`;
                    return (
                      <path
                        key={k}
                        d={d}
                        fill="none"
                        stroke={color}
                        strokeWidth={2}
                        strokeDasharray={s.dashed ? '5 4' : undefined}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })}
                  {s.pointFlags &&
                    segments.flat().map((p) => {
                      const flagged = s.pointFlags?.[p.i];
                      return (
                        <circle
                          key={p.i}
                          cx={p.x}
                          cy={p.y}
                          r={flagged ? 4.2 : 2.2}
                          fill={flagged ? '#ef4444' : color}
                          stroke={flagged ? '#ffffff' : 'none'}
                          strokeWidth={flagged ? 1.2 : 0}
                        />
                      );
                    })}
                </g>
              );
            })}

            {labels.map((lbl, i) => {
              if (!visibleXTicks.has(i)) return null;
              return (
                <text
                  key={i}
                  x={xAt(i)}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-slate-600 dark:fill-slate-300 text-[10px] font-mono"
                >
                  {lbl}
                </text>
              );
            })}

            {hoverIdx != null && (
              <g>
                <line
                  x1={xAt(hoverIdx)}
                  x2={xAt(hoverIdx)}
                  y1={pad.top}
                  y2={pad.top + ph}
                  stroke="currentColor"
                  className="text-slate-400 dark:text-slate-500"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                {series.map((s, si) => {
                  const v = s.data[hoverIdx];
                  if (v == null || !Number.isFinite(v)) return null;
                  const color = s.color || DEFAULT_COLORS[si % DEFAULT_COLORS.length];
                  return (
                    <circle
                      key={s.name}
                      cx={xAt(hoverIdx)}
                      cy={yAt(v)}
                      r={4}
                      fill={color}
                      stroke="#ffffff"
                      strokeWidth={1.5}
                    />
                  );
                })}
              </g>
            )}
          </svg>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {series.map((s, si) => (
            <span key={s.name} className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-3 rounded-[2px]"
                style={{
                  backgroundColor: s.color || DEFAULT_COLORS[si % DEFAULT_COLORS.length],
                  opacity: s.dashed ? 0.65 : 1,
                }}
              />
              {s.name}
            </span>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hoverIdx != null && !showTable && (
            <div
              aria-live="polite"
              className="font-mono tabular-nums text-[11px] text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700"
            >
              <span className="text-slate-600 dark:text-slate-300 mr-2">{labels[hoverIdx] ?? `#${hoverIdx + 1}`}</span>
              {series.map((s, si) => {
                const v = s.data[hoverIdx];
                if (v == null || !Number.isFinite(v)) return null;
                return (
                  <span key={s.name} className="mr-2 last:mr-0">
                    <span aria-hidden="true" style={{ color: s.color || DEFAULT_COLORS[si % DEFAULT_COLORS.length] }}>
                      ●
                    </span>{' '}
                    {formatValue(v)}
                  </span>
                );
              })}
            </div>
          )}

          <button
            type="button"
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
            className="text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-[var(--accent)] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            {showTable ? 'Chart view' : 'Data table'}
          </button>
        </div>
      </div>
    </figure>
  );
};

interface BarChartProps {
  labels: string[];
  series: Array<{ name: string; data: number[]; color?: string }>;
  horizontal?: boolean;
  height?: number;
  formatValue?: (v: number) => string;
  caption?: string;
}

export const BarChart: React.FC<BarChartProps> = ({
  labels,
  series,
  horizontal = false,
  height = 220,
  formatValue = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(1)),
  caption,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  if (!labels.length) {
    return <div className="py-8 text-center text-xs text-slate-600 dark:text-slate-300">No data to display</div>;
  }

  const summaryText =
    caption ||
    `Bar chart comparing ${series.map((s) => s.name).join(', ')} across ${labels.length} categories.`;

  if (horizontal) {
    const maxVal = Math.max(1e-9, ...series.flatMap((s) => s.data));
    return (
      <figure className="space-y-2.5">
        <figcaption className="sr-only">{summaryText}</figcaption>
        {labels.map((lbl, i) => {
          const val = series[0]?.data[i] ?? 0;
          const pct = Math.max(2, (val / maxVal) * 100);
          return (
            <div key={lbl} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-700 dark:text-slate-200 truncate pr-2">{lbl}</span>
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-200 shrink-0">
                  {formatValue(val)}
                </span>
              </div>
              <div className="h-2 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: series[0]?.color || 'var(--accent)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </figure>
    );
  }

  const W = 720;
  const H = height;
  const pad = { top: 16, right: 16, bottom: 28, left: 52 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;
  const maxVal = Math.max(1, ...series.flatMap((s) => s.data)) * 1.1;
  const groupW = pw / labels.length;
  const barW = Math.min(26, Math.max(4, (groupW * 0.72) / Math.max(1, series.length)));
  const labelStep = Math.max(1, Math.ceil(labels.length / 8));
  const visibleBarTicks = new Set<number>();
  if (labels.length === 1) {
    visibleBarTicks.add(0);
  } else {
    let last = -labelStep;
    for (let i = 0; i < labels.length - 1; i += labelStep) {
      visibleBarTicks.add(i);
      last = i;
    }
    if (labelStep > 1 && labels.length - 1 - last < Math.max(2, Math.floor(labelStep * 0.65)) && last > 0) {
      visibleBarTicks.delete(last);
    }
    visibleBarTicks.add(labels.length - 1);
  }

  return (
    <figure className="w-full select-none">
      <figcaption className="sr-only">{summaryText}</figcaption>

      {showTable ? (
        <div className="max-h-60 overflow-auto rounded-md border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
              <tr className="text-left text-[11px] text-slate-600 dark:text-slate-300">
                <th scope="col" className="px-3 py-1.5 font-medium">Category</th>
                {series.map((s) => (
                  <th key={s.name} scope="col" className="px-3 py-1.5 font-medium text-right">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {labels.map((lbl, i) => (
                <tr key={lbl}>
                  <th scope="row" className="px-3 py-1.5 text-left font-medium text-slate-700 dark:text-slate-200">
                    {lbl}
                  </th>
                  {series.map((s) => (
                    <td key={s.name} className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-100">
                      {formatValue(s.data[i] || 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="rounded focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
          tabIndex={0}
          role="img"
          aria-label={`${summaryText} Use Left and Right arrow keys to inspect bars.`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              setHoverIdx((prev) => (prev == null ? 0 : Math.min(labels.length - 1, prev + 1)));
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setHoverIdx((prev) => (prev == null ? labels.length - 1 : Math.max(0, prev - 1)));
            } else if (e.key === 'Home') {
              e.preventDefault();
              setHoverIdx(0);
            } else if (e.key === 'End') {
              e.preventDefault();
              setHoverIdx(labels.length - 1);
            } else if (e.key === 'Escape') {
              setHoverIdx(null);
            }
          }}
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" aria-hidden="true" onMouseLeave={() => setHoverIdx(null)}>
            {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => {
              const y = pad.top + ph * (1 - frac);
              const v = maxVal * frac;
              return (
                <g key={idx}>
                  <line
                    x1={pad.left}
                    x2={W - pad.right}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800"
                  />
                  <text
                    x={pad.left - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    className="fill-slate-600 dark:fill-slate-300 text-[10px] font-mono tabular-nums"
                  >
                    {formatValue(v)}
                  </text>
                </g>
              );
            })}

            {labels.map((lbl, i) => {
              const gx = pad.left + i * groupW + groupW / 2;
              const totalBarsW = series.length * barW + (series.length - 1) * 2;
              return (
                <g key={i} onMouseEnter={() => setHoverIdx(i)}>
                  {hoverIdx === i && (
                    <rect
                      x={pad.left + i * groupW}
                      y={pad.top}
                      width={groupW}
                      height={ph}
                      className="fill-slate-200/40 dark:fill-slate-700/30"
                    />
                  )}
                  {series.map((s, si) => {
                    const v = Math.max(0, s.data[i] || 0);
                    const bh = (v / maxVal) * ph;
                    const bx = gx - totalBarsW / 2 + si * (barW + 2);
                    const by = pad.top + ph - bh;
                    return (
                      <rect
                        key={s.name}
                        x={bx}
                        y={by}
                        width={barW}
                        height={bh}
                        rx={2}
                        fill={s.color || DEFAULT_COLORS[si % DEFAULT_COLORS.length]}
                      />
                    );
                  })}
                  {visibleBarTicks.has(i) && (
                    <text
                      x={gx}
                      y={H - 8}
                      textAnchor="middle"
                      className="fill-slate-600 dark:fill-slate-300 text-[10px] font-mono"
                    >
                      {lbl}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {series.map((s, si) => (
            <span key={s.name} className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-[2px]"
                style={{ backgroundColor: s.color || DEFAULT_COLORS[si % DEFAULT_COLORS.length] }}
              />
              {s.name}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hoverIdx != null && !showTable && (
            <div
              aria-live="polite"
              className="font-mono tabular-nums text-[11px] text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700"
            >
              <span className="text-slate-600 dark:text-slate-300 mr-2">{labels[hoverIdx]}</span>
              {series.map((s) => (
                <span key={s.name} className="mr-2 last:mr-0">
                  {s.name}: {formatValue(s.data[hoverIdx] || 0)}
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
            className="text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-[var(--accent)] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            {showTable ? 'Chart view' : 'Data table'}
          </button>
        </div>
      </div>
    </figure>
  );
};

interface ParetoChartProps {
  labels: string[];
  values: number[];
  cumPct: number[];
  classes: Array<'A' | 'B' | 'C'>;
  aThreshold: number;
  bThreshold: number;
  formatValue?: (v: number) => string;
}

export const ParetoChart: React.FC<ParetoChartProps> = ({
  labels,
  values,
  cumPct,
  classes,
  aThreshold,
  bThreshold,
  formatValue = (v) => `$${Math.round(v).toLocaleString()}`,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const W = 720;
  const H = 260;
  const pad = { top: 18, right: 44, bottom: 36, left: 56 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;
  const n = Math.max(1, values.length);
  const maxVal = Math.max(1, ...values) * 1.08;
  const groupW = pw / n;
  const barW = Math.max(6, Math.min(28, groupW * 0.72));

  const classColor = (c: 'A' | 'B' | 'C') => (c === 'A' ? '#2563eb' : c === 'B' ? '#10b981' : '#94a3b8');
  const yPct = (pct: number) => pad.top + ph - (pct / 100) * ph;

  const linePath = cumPct
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(pad.left + i * groupW + groupW / 2).toFixed(1)},${yPct(p).toFixed(1)}`)
    .join(' ');

  const summaryText = `ABC Pareto chart across ${labels.length} SKUs. Class A up to ${aThreshold}%, Class B up to ${bThreshold}%.`;

  return (
    <figure className="w-full select-none">
      <figcaption className="sr-only">{summaryText}</figcaption>

      {showTable ? (
        <div className="max-h-60 overflow-auto rounded-md border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
              <tr className="text-left text-[11px] text-slate-600 dark:text-slate-300">
                <th scope="col" className="px-3 py-1.5 font-medium">SKU</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Class</th>
                <th scope="col" className="px-3 py-1.5 font-medium text-right">Usage Value</th>
                <th scope="col" className="px-3 py-1.5 font-medium text-right">Cumulative %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {labels.map((lbl, i) => (
                <tr key={lbl}>
                  <th scope="row" className="px-3 py-1.5 text-left font-mono font-normal text-slate-700 dark:text-slate-200">
                    {lbl}
                  </th>
                  <td className="px-3 py-1.5 font-mono text-slate-700 dark:text-slate-200">{classes[i]}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-100">
                    {formatValue(values[i] || 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                    {(cumPct[i] || 0).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="rounded focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
          tabIndex={0}
          role="img"
          aria-label={`${summaryText} Use Left and Right arrow keys to inspect ranked SKUs.`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              setHoverIdx((prev) => (prev == null ? 0 : Math.min(labels.length - 1, prev + 1)));
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setHoverIdx((prev) => (prev == null ? labels.length - 1 : Math.max(0, prev - 1)));
            } else if (e.key === 'Escape') {
              setHoverIdx(null);
            }
          }}
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" aria-hidden="true" onMouseLeave={() => setHoverIdx(null)}>
            {[0, 25, 50, 75, 100].map((pct) => {
              const y = yPct(pct);
              return (
                <g key={pct}>
                  <line
                    x1={pad.left}
                    x2={W - pad.right}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800"
                  />
                  <text
                    x={pad.left - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    className="fill-slate-600 dark:fill-slate-300 text-[10px] font-mono tabular-nums"
                  >
                    {formatValue((maxVal * pct) / 100)}
                  </text>
                  <text
                    x={W - pad.right + 8}
                    y={y + 3.5}
                    textAnchor="start"
                    className="fill-slate-600 dark:fill-slate-300 text-[10px] font-mono tabular-nums"
                  >
                    {pct}%
                  </text>
                </g>
              );
            })}

            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={yPct(aThreshold)}
              y2={yPct(aThreshold)}
              stroke="#2563eb"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={yPct(bThreshold)}
              y2={yPct(bThreshold)}
              stroke="#10b981"
              strokeDasharray="4 4"
              strokeWidth={1}
            />

            {values.map((v, i) => {
              const cx = pad.left + i * groupW + groupW / 2;
              const bh = (v / maxVal) * ph;
              return (
                <g key={i} onMouseEnter={() => setHoverIdx(i)}>
                  <rect
                    x={cx - barW / 2}
                    y={pad.top + ph - bh}
                    width={barW}
                    height={bh}
                    rx={2}
                    fill={classColor(classes[i])}
                    opacity={hoverIdx === i ? 1 : 0.85}
                  />
                  {(n <= 18 || i % 2 === 0) && (
                    <text
                      x={cx}
                      y={H - 10}
                      textAnchor="middle"
                      className="fill-slate-600 dark:fill-slate-300 text-[9px] font-mono"
                    >
                      {labels[i].slice(0, 7)}
                    </text>
                  )}
                </g>
              );
            })}

            <path d={linePath} fill="none" stroke="#f59e0b" strokeWidth={2} />
            {cumPct.map((p, i) => (
              <circle
                key={i}
                cx={pad.left + i * groupW + groupW / 2}
                cy={yPct(p)}
                r={hoverIdx === i ? 4.5 : 2.5}
                fill="#f59e0b"
              />
            ))}
          </svg>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-3 text-slate-700 dark:text-slate-200">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-blue-600" /> Class A (≤{aThreshold}%)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-emerald-500" /> Class B (≤{bThreshold}%)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-slate-400" /> Class C
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-3 bg-amber-500" /> Cumulative %
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hoverIdx != null && !showTable && (
            <span aria-live="polite" className="font-mono tabular-nums text-[11px] text-slate-700 dark:text-slate-200">
              {labels[hoverIdx]} · {formatValue(values[hoverIdx])} · {cumPct[hoverIdx].toFixed(1)}% cum
            </span>
          )}
          <button
            type="button"
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
            className="text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-[var(--accent)] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            {showTable ? 'Chart view' : 'Data table'}
          </button>
        </div>
      </div>
    </figure>
  );
};

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export const DonutChart: React.FC<{
  segments: DonutSegment[];
  centerLabel: string;
  centerValue: string;
  formatValue?: (v: number) => string;
}> = ({ segments, centerLabel, centerValue, formatValue = (v) => v.toLocaleString() }) => {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  const r = 54;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <figure
      className="flex flex-col xl:flex-row items-center gap-4"
      aria-label={`Donut breakdown: ${centerLabel} ${centerValue}`}
    >
      <figcaption className="sr-only">
        {`${centerLabel} ${centerValue}: ${segments
          .map((s) => `${s.label} ${formatValue(s.value)} (${((s.value / total) * 100).toFixed(0)}%)`)
          .join(', ')}`}
      </figcaption>

      <div className="relative shrink-0 w-[132px] h-[132px]">
        <svg viewBox="0 0 144 144" className="w-full h-full -rotate-90" aria-hidden="true">
          <circle
            cx={72}
            cy={72}
            r={r}
            fill="none"
            stroke="currentColor"
            className="text-slate-100 dark:text-slate-800"
            strokeWidth={16}
          />
          {segments.map((seg, idx) => {
            const len = (Math.max(0, seg.value) / total) * c;
            const dashArray = `${len} ${c - len}`;
            const dashOffset = -offset;
            offset += len;
            return (
              <circle
                key={seg.label}
                cx={72}
                cy={72}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={activeIdx === idx ? 19 : 16}
                strokeDasharray={dashArray}
                strokeDashoffset={dashOffset}
                className="transition-all cursor-pointer"
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseLeave={() => setActiveIdx(null)}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-300">
            {activeIdx != null && segments[activeIdx] ? segments[activeIdx].label.slice(0, 10) : centerLabel}
          </span>
          <span className="text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {activeIdx != null && segments[activeIdx] ? formatValue(segments[activeIdx].value) : centerValue}
          </span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-1.5">
        {segments.map((seg, idx) => {
          const pct = (seg.value / total) * 100;
          return (
            <button
              key={seg.label}
              type="button"
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseLeave={() => setActiveIdx(null)}
              onFocus={() => setActiveIdx(idx)}
              onBlur={() => setActiveIdx(null)}
              className={`w-full flex items-center justify-between text-xs gap-2 rounded px-1.5 py-0.5 transition-colors cursor-pointer ${
                activeIdx === idx ? 'bg-slate-100 dark:bg-slate-800/70' : ''
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] shrink-0" style={{ backgroundColor: seg.color }} />
                <span className="truncate text-slate-700 dark:text-slate-200">{seg.label}</span>
              </div>
              <div className="font-mono tabular-nums text-slate-600 dark:text-slate-300 shrink-0">
                <span className="text-slate-900 dark:text-slate-100 font-medium">
                  {formatValue(seg.value)}
                </span>
                <span aria-hidden="true" className="text-slate-400 dark:text-slate-600 mx-1.5">·</span>
                <span>{pct.toFixed(0)}%</span>
              </div>
            </button>
          );
        })}
      </div>
    </figure>
  );
};
