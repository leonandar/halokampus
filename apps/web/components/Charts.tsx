"use client";
import { useId, useState } from "react";

/*
 * Small inline-SVG charts for the KPI dashboard (dataviz method): thin marks (bars ≤ 24 px,
 * 4 px rounded data-end, square at the baseline), 2 px lines, recessive solid hairline
 * grid, text in text colours, a hover/focus tooltip on every mark, and a table view.
 */

export interface Datum {
  label: string;
  value: number | null;
  display?: string;
  color?: string;
}

function Tooltip({ tip }: { tip: { x: number; y: number; text: string } | null }) {
  if (!tip) return null;
  return (
    <div role="status" className="pointer-events-none absolute z-10 rounded-md border border-[var(--color-line)] bg-white px-2 py-1 text-xs shadow-md" style={{ left: tip.x, top: tip.y, transform: "translate(-50%, -110%)" }}>
      {tip.text}
    </div>
  );
}

function TableView({ caption, rows, head }: { caption: string; rows: Array<Array<string | number>>; head: string[] }) {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-[var(--color-brand)]">Lihat sebagai tabel</summary>
      <table className="tabular mt-1 w-full text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs text-[var(--color-muted)]"><tr>{head.map((h) => <th key={h} className="py-1 pr-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-[var(--color-line)]">{r.map((c, j) => <td key={j} className="py-1 pr-2">{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

/** Horizontal bars (one series): labels left, value printed at the bar end in text ink. */
export function HBarChart({ title, data, max, unit = "", ordinal = false }: { title: string; data: Datum[]; max?: number; unit?: string; ordinal?: boolean }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const rowH = 36;
  const bar = 20;
  const labelW = 170;
  const width = 560;
  const plotW = width - labelW - 120;
  const m = max ?? Math.max(1, ...data.map((d) => d.value ?? 0));
  const ramp = ["var(--ordinal-1)", "var(--ordinal-2)", "var(--ordinal-3)", "var(--ordinal-4)", "var(--ordinal-5)"];
  const h = data.length * rowH + 8;
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${width} ${h}`} className="w-full" role="img" aria-label={title}>
        <line x1={labelW} x2={labelW} y1={0} y2={h} stroke="var(--grid)" strokeWidth={1} />
        {data.map((d, i) => {
          const y = i * rowH + (rowH - bar) / 2 + 4;
          const w = d.value === null ? 0 : Math.max(d.value > 0 ? 2 : 0, (d.value / m) * plotW);
          const fill = d.color ?? (ordinal ? ramp[Math.min(i, ramp.length - 1)] : "var(--series-1)");
          const text = `${d.label}: ${d.display ?? (d.value === null ? "tidak ada data" : `${d.value}${unit}`)}`;
          const show = (e: React.MouseEvent | React.FocusEvent) => {
            const box = (e.currentTarget as SVGGElement).ownerSVGElement!.getBoundingClientRect();
            setTip({ x: ((labelW + w / 2) / width) * box.width, y: (y / h) * box.height, text });
          };
          return (
            <g key={d.label} role="img" tabIndex={0} aria-label={text} onMouseEnter={show} onFocus={show} onMouseLeave={() => setTip(null)} onBlur={() => setTip(null)} className="outline-none focus:[&>rect:first-child]:fill-slate-100">
              <rect x={0} y={i * rowH + 4} width={width} height={rowH} fill="transparent" />
              <text x={labelW - 8} y={y + bar / 2 + 4} textAnchor="end" fontSize={13} fill="var(--color-ink)">{d.label}</text>
              {w > 0 ? <path d={`M${labelW},${y} h${Math.max(0, w - 4)} a4,4 0 0 1 4,4 v${bar - 8} a4,4 0 0 1 -4,4 h${-Math.max(0, w - 4)} z`} fill={fill} /> : null}
              <text x={labelW + w + 6} y={y + bar / 2 + 4} fontSize={12} fill="var(--color-muted)" className="tabular">{d.display ?? (d.value === null ? "–" : `${d.value}${unit}`)}</text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
      <TableView caption={title} head={["Kategori", "Nilai"]} rows={data.map((d) => [d.label, d.display ?? (d.value === null ? "–" : `${d.value}${unit}`)])} />
    </figure>
  );
}

/** Vertical columns (one series) with an optional reference line (e.g. PRM-01). */
export function ColumnChart({ title, data, refLine, unit = "" }: { title: string; data: Datum[]; refLine?: { at: number; label: string }; unit?: string }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const width = 560;
  const height = 200;
  const left = 32;
  const bottom = 28;
  const plotH = height - bottom - 12;
  const band = (width - left) / Math.max(1, data.length);
  const bw = Math.min(24, band - 6);
  const m = Math.max(1, ...data.map((d) => d.value ?? 0));
  const ticks = [0, Math.ceil(m / 2), m];
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={title}>
        {ticks.map((t) => {
          const y = 12 + plotH - (t / m) * plotH;
          return (
            <g key={t}>
              <line x1={left} x2={width} y1={y} y2={y} stroke="var(--grid)" strokeWidth={1} />
              <text x={left - 6} y={y + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)" className="tabular">{t}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = left + i * band + (band - bw) / 2;
          const hgt = d.value ? (d.value / m) * plotH : 0;
          const y = 12 + plotH - hgt;
          const text = `${d.label}: ${d.value ?? 0}${unit}`;
          const show = (e: React.MouseEvent | React.FocusEvent) => {
            const box = (e.currentTarget as SVGGElement).ownerSVGElement!.getBoundingClientRect();
            setTip({ x: ((x + bw / 2) / width) * box.width, y: (y / height) * box.height, text });
          };
          return (
            <g key={d.label} role="img" tabIndex={0} aria-label={text} onMouseEnter={show} onFocus={show} onMouseLeave={() => setTip(null)} onBlur={() => setTip(null)} className="outline-none">
              <rect x={left + i * band} y={12} width={band} height={plotH} fill="transparent" />
              {hgt > 0 ? <path d={`M${x},${12 + plotH} v${-Math.max(0, hgt - 4)} a4,4 0 0 1 4,-4 h${bw - 8} a4,4 0 0 1 4,4 v${Math.max(0, hgt - 4)} z`} fill={d.color ?? "var(--series-1)"} /> : null}
              {i % Math.ceil(data.length / 12) === 0 ? <text x={x + bw / 2} y={height - 10} textAnchor="middle" fontSize={11} fill="var(--color-muted)">{d.label}</text> : null}
            </g>
          );
        })}
        {refLine ? (() => {
          const x = left + refLine.at * (width - left);
          return (
            <g>
              <line x1={x} x2={x} y1={8} y2={12 + plotH} stroke="var(--color-ink)" strokeWidth={1.5} />
              <text x={x + 4} y={18} fontSize={11} fill="var(--color-ink)">{refLine.label}</text>
            </g>
          );
        })() : null}
      </svg>
      <Tooltip tip={tip} />
      <TableView caption={title} head={["Kategori", "Nilai"]} rows={data.map((d) => [d.label, d.value ?? 0])} />
    </figure>
  );
}

/** Multi-series line chart over days: legend + direct end labels, crosshair tooltip. */
export function LineChart({ title, labels, series }: { title: string; labels: string[]; series: Array<{ name: string; color: string; values: number[] }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const width = 560;
  const height = 210;
  const left = 32;
  const right = 90;
  const top = 12;
  const plotH = height - 40;
  const m = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => left + (labels.length <= 1 ? (width - left - right) / 2 : (i / (labels.length - 1)) * (width - left - right));
  const y = (v: number) => top + plotH - (v / m) * plotH;
  const ticks = [0, Math.ceil(m / 2), m];
  return (
    <figure className="relative">
      <div className="mb-1 flex flex-wrap gap-3 text-xs" aria-hidden="true">
        {series.map((s) => <span key={s.name} className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: s.color }} />{s.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-labelledby={`${id}-t`} onMouseLeave={() => setHover(null)}>
        <title id={`${id}-t`}>{title}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)" className="tabular">{t}</text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.values.length ? (
              <>
                <circle cx={x(s.values.length - 1)} cy={y(s.values.at(-1)!)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
                <text x={x(s.values.length - 1) + 8} y={y(s.values.at(-1)!) + 4} fontSize={11} fill="var(--color-ink)">{s.name}</text>
              </>
            ) : null}
          </g>
        ))}
        {labels.map((l, i) => (
          <g key={l} role="img" tabIndex={0} aria-label={`${l}: ${series.map((s) => `${s.name} ${s.values[i]}`).join(", ")}`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} className="outline-none">
            <rect x={x(i) - (width - left - right) / Math.max(2, labels.length) / 2} y={top} width={(width - left - right) / Math.max(1, labels.length)} height={plotH} fill="transparent" />
            {i % Math.ceil(labels.length / 7) === 0 ? <text x={x(i)} y={height - 10} textAnchor="middle" fontSize={11} fill="var(--color-muted)">{l.slice(5)}</text> : null}
          </g>
        ))}
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + plotH} stroke="var(--color-muted)" strokeWidth={1} /> : null}
      </svg>
      {hover !== null ? (
        <div role="status" className="pointer-events-none absolute right-2 top-6 rounded-md border border-[var(--color-line)] bg-white px-2 py-1 text-xs shadow-md">
          <div className="font-semibold">{labels[hover]}</div>
          {series.map((s) => <div key={s.name}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}: {s.values[hover]}</div>)}
        </div>
      ) : null}
      <TableView caption={title} head={["Tanggal", ...series.map((s) => s.name)]} rows={labels.map((l, i) => [l, ...series.map((s) => s.values[i] ?? 0)])} />
    </figure>
  );
}
