import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from './ui';

/** Series colours: slots 1 to 3 of the validated categorical palette, then the one-hue blue ramp for ordinal data. */
export const VIZ = { blue: 'var(--viz-1)', orange: 'var(--viz-2)', aqua: 'var(--viz-3)' } as const;
export const AGEING_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281', '#0d366b'] as const;

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  /** One raw value per category (money as strings); null leaves a gap. Plotted as numbers, shown via `format`. */
  values: Array<string | null>;
};

const compact = new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 });
export const compactNumber = (value: number) => compact.format(value);

/** Rounded axis maximum and evenly spaced ticks starting at zero. */
export function niceScale(max: number, ticks = 4): { max: number; values: number[] } {
  if (!(max > 0)) return { max: 1, values: [0, 1] };
  const rough = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const top = Math.ceil(max / step) * step;
  const values: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) values.push(Number(v.toFixed(6)));
  return { max: top, values };
}

function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    setWidth(Math.max(240, Math.floor(element.clientWidth || fallback)));
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const num = (value: string | null) => (value === null ? null : Number(value));

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  if (items.length < 2) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

type TimeChartProps = {
  /** Category labels shown on the axis, e.g. "Oct". */
  labels: string[];
  /** Longer labels shown in the tooltip and table, e.g. "October 2026 (to date)". */
  detailLabels?: string[];
  series: ChartSeries[];
  /** Exact formatting for tooltip and table values. */
  format: (raw: string) => string;
  /** Short formatting for the value axis. */
  tick?: (value: number) => string;
  kind?: 'line' | 'bar';
  height?: number;
  /** Accessible name for the chart; also used as the table caption. */
  title: string;
  /** When given, a click (or Enter) on a point selects it and the returned actions are shown beneath the chart. */
  drill?: (index: number) => ReactNode;
};

/**
 * Line (with soft area under a single series) or column chart over a category axis. Hover or touch shows a
 * crosshair and tooltip; arrow keys move through the points; a table view exposes the same numbers.
 */
export function TimeChart({ labels, detailLabels, series, format, tick = compactNumber, kind = 'line', height = 240, title, drill }: TimeChartProps) {
  const { ref, width } = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const gradientId = useId();
  const count = labels.length;

  const margin = { top: 12, right: 12, bottom: 26, left: 46 };
  const plotW = Math.max(10, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const maxValue = Math.max(0, ...series.flatMap((s) => s.values.map((v) => num(v) ?? 0)));
  const scale = niceScale(maxValue);
  const x = (i: number) => (kind === 'bar' ? ((i + 0.5) / count) * plotW : count === 1 ? plotW / 2 : (i / (count - 1)) * plotW);
  const y = (v: number) => plotH - (v / scale.max) * plotH;
  const everyNth = Math.ceil(count / Math.max(1, Math.floor(plotW / 56)));

  function indexFromPointer(event: PointerEvent<SVGRectElement> | MouseEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const raw = kind === 'bar' ? Math.floor((px / plotW) * count) : Math.round((px / plotW) * (count - 1));
    return Math.min(count - 1, Math.max(0, raw));
  }

  function onKey(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === 'ArrowRight') setActive((a) => Math.min(count - 1, (a ?? -1) + 1));
    else if (event.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? count) - 1));
    else if (event.key === 'Escape') {
      setActive(null);
      setSelected(null);
    } else if ((event.key === 'Enter' || event.key === ' ') && drill && active !== null) setSelected(active);
    else return;
    event.preventDefault();
  }

  const detail = (i: number) => detailLabels?.[i] ?? labels[i];
  const tooltipLeft = active === null ? 0 : margin.left + x(active);
  const flip = active !== null && tooltipLeft > width * 0.6;

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="ml-auto mb-2 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          {asTable ? 'Show chart' : 'View as table'}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th scope="col" className="py-1 pr-3 font-medium">
                  Month
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="py-1 pl-3 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((_, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    {detail(i)}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} className="num py-1 pl-3">
                      {s.values[i] === null ? '—' : format(s.values[i] as string)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative w-full min-w-0 select-none overflow-hidden">
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${title}. Use the left and right arrow keys to read each month, or choose View as table.`}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className="block overflow-visible rounded focus-visible:outline-2"
          >
            <defs>
              {series.length === 1 && (
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={series[0].color} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={series[0].color} stopOpacity="0" />
                </linearGradient>
              )}
            </defs>
            <g transform={`translate(${margin.left},${margin.top})`}>
              {scale.values.map((value) => (
                <g key={value}>
                  <line x1={0} x2={plotW} y1={y(value)} y2={y(value)} stroke="var(--viz-grid)" strokeWidth={1} />
                  <text x={-8} y={y(value)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[11px]">
                    {tick(value)}
                  </text>
                </g>
              ))}
              {labels.map((label, i) =>
                i % everyNth === 0 || i === count - 1 ? (
                  <text
                    key={label + i}
                    x={x(i)}
                    y={plotH + 18}
                    textAnchor="middle"
                    className={cx('text-[11px]', active === i ? 'fill-slate-900 font-medium' : 'fill-slate-500')}
                  >
                    {label}
                  </text>
                ) : null,
              )}

              {kind === 'bar'
                ? series.map((s, si) =>
                    s.values.map((raw, i) => {
                      const v = num(raw);
                      if (v === null) return null;
                      const slot = plotW / count;
                      const barW = Math.max(3, Math.min(28, (slot * 0.62) / series.length));
                      const left = x(i) - (barW * series.length) / 2 + si * barW;
                      const h = plotH - y(v);
                      return (
                        <rect
                          key={s.key + i}
                          x={left}
                          y={y(v)}
                          width={barW - 1}
                          height={Math.max(h, v > 0 ? 1 : 0)}
                          rx={3}
                          fill={s.color}
                          opacity={active === null || active === i ? 1 : 0.45}
                        />
                      );
                    }),
                  )
                : series.map((s) => {
                    const points = s.values.map((raw, i) => ({ v: num(raw), i }));
                    const path = points.reduce(
                      (d, p, k) => (p.v === null ? d : `${d}${k === 0 || points[k - 1].v === null ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`),
                      '',
                    );
                    const first = points.find((p) => p.v !== null);
                    const last = [...points].reverse().find((p) => p.v !== null);
                    return (
                      <g key={s.key}>
                        {series.length === 1 && first && last && path && (
                          <path d={`${path}L${x(last.i).toFixed(1)},${plotH}L${x(first.i).toFixed(1)},${plotH}Z`} fill={`url(#${gradientId})`} />
                        )}
                        <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                        {last && last.v !== null && active === null && (
                          <circle cx={x(last.i)} cy={y(last.v)} r={4} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />
                        )}
                      </g>
                    );
                  })}

              {active !== null && (
                <g pointerEvents="none">
                  {kind === 'line' && (
                    <line x1={x(active)} x2={x(active)} y1={0} y2={plotH} stroke="var(--viz-crosshair)" strokeWidth={1} strokeDasharray="3 3" />
                  )}
                  {kind === 'line' &&
                    series.map((s) => {
                      const v = num(s.values[active]);
                      return v === null ? null : (
                        <circle key={s.key} cx={x(active)} cy={y(v)} r={5} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />
                      );
                    })}
                </g>
              )}

              {selected !== null && kind === 'line' && (
                <line x1={x(selected)} x2={x(selected)} y1={0} y2={plotH} stroke="var(--viz-1)" strokeWidth={1.5} pointerEvents="none" />
              )}
              {selected !== null && kind === 'bar' && (
                <rect x={x(selected) - plotW / count / 2} y={0} width={plotW / count} height={plotH} fill="var(--viz-1)" opacity={0.08} pointerEvents="none" />
              )}
              <rect
                x={0}
                y={0}
                width={plotW}
                height={plotH}
                fill="transparent"
                className={drill ? 'cursor-pointer' : undefined}
                onClick={(event) => {
                  if (!drill) return;
                  // Read the position now: the event is not available inside the state updater.
                  const index = indexFromPointer(event);
                  setSelected((current) => (current === index ? null : index));
                }}
                onPointerMove={(event) => setActive(indexFromPointer(event))}
                onPointerDown={(event) => setActive(indexFromPointer(event))}
                onPointerLeave={(event) => event.pointerType === 'mouse' && setActive(null)}
              />
            </g>
          </svg>

          {active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
              style={{ left: tooltipLeft, transform: `translateX(${flip ? 'calc(-100% - 12px)' : '12px'})` }}
            >
              <p className="mb-1 font-semibold text-slate-900">{detail(active)}</p>
              {series.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-4 text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-medium tabular-nums text-slate-900">{s.values[active] === null ? '—' : format(s.values[active] as string)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {drill && !asTable && (
        <div className="mt-2 text-sm">
          {selected !== null ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-slate-50 px-3 py-2">
              <span className="font-medium text-slate-800">{detail(selected)}</span>
              {drill(selected)}
              <button type="button" className="ml-auto text-xs text-slate-500 hover:text-slate-800" onClick={() => setSelected(null)}>
                Clear
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Click a point to open its records or focus the dashboard on it.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Tiny trend line for KPI cards. Decorative: the figure beside it carries the information. */
export function Sparkline({ values, color = VIZ.blue, width = 96, height = 32 }: { values: string[]; color?: string; width?: number; height?: number }) {
  const gradientId = useId();
  const nums = values.map(Number);
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const pad = 3;
  const points = nums.map((v, i) => [pad + (i / (nums.length - 1)) * (width - pad * 2), pad + (1 - (v - min) / range) * (height - pad * 2)] as const);
  const line = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const [lx, ly] = points[points.length - 1];
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${lx.toFixed(1)},${height}L${points[0][0].toFixed(1)},${height}Z`} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={2.5} fill={color} />
    </svg>
  );
}

export type Segment = { key: string; label: string; value: string; color: string };

/** One horizontal bar split into labelled parts, with the values listed beneath it. */
export function SegmentedBar({ segments, format, total }: { segments: Segment[]; format: (raw: string) => string; total: string }) {
  const sum = Number(total);
  return (
    <div>
      <div
        className="flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={segments.map((s) => `${s.label} ${format(s.value)}`).join(', ')}
      >
        {segments.map((s) => {
          const share = sum > 0 ? (Number(s.value) / sum) * 100 : 0;
          return share > 0 ? <span key={s.key} title={`${s.label}: ${format(s.value)}`} style={{ width: `${share}%`, background: s.color }} /> : null;
        })}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        {segments.map((s) => (
          <div key={s.key} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-slate-500">
              <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="truncate">{s.label}</span>
            </dt>
            <dd className="text-sm font-semibold tabular-nums text-slate-900">{format(s.value)}</dd>
            <dd className="text-xs tabular-nums text-slate-400">{sum > 0 ? `${((Number(s.value) / sum) * 100).toFixed(1)}%` : '0.0%'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export type RankedItem = { key: string; label: ReactNode; value: string; secondary?: string };

/** Horizontal ranking bars, largest first. */
export function RankedBars({
  items,
  format,
  color = VIZ.blue,
  secondaryLabel,
}: {
  items: RankedItem[];
  format: (raw: string) => string;
  color?: string;
  secondaryLabel?: string;
}) {
  const max = Math.max(0, ...items.map((i) => Number(i.value)));
  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const share = max > 0 ? (Number(item.value) / max) * 100 : 0;
        return (
          <li key={item.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-700">{item.label}</span>
              <span className="font-semibold tabular-nums text-slate-900">{format(item.value)}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100">
              <div className="h-2 rounded-full" style={{ width: `${Math.max(share, item.value !== '0.00' && share > 0 ? 1.5 : 0)}%`, background: color }} />
            </div>
            {item.secondary && secondaryLabel && (
              <p className="mt-0.5 text-xs text-slate-400">
                {secondaryLabel} {item.secondary}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
