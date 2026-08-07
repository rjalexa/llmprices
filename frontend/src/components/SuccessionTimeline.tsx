import { curveStepAfter, line as d3line } from "d3-shape";
import { useMemo, useState } from "react";
import type { Handoff, Metric } from "../api/client";
import {
  addDays,
  daysBetween,
  formatAxisPrice,
  formatMonth,
  formatPrice,
  parseDay,
  toDay,
} from "../lib/format";
import { placeLabels, truncate, type LabelInput } from "../lib/labelPlacement";
import { logTicks, makePlot, makeX, makeY, type YScaleKind } from "../lib/scales";
import { valueOn, type RenderModel } from "../lib/seriesView";
import { buildSuccession, type ReignSegment } from "../lib/succession";
import { useMeasure } from "../lib/useMeasure";
import { ForkConnectors, forkLabelBoxes } from "./ForkConnectors";
import { HandoffConnectors } from "./HandoffConnectors";
import { Tooltip, type TooltipRow } from "./Tooltip";

const HEIGHT = 560;
const FADE_PX = 46;
// extra top room for the reign labels that sit above the line
const MARGIN = { top: 30, right: 196, bottom: 34, left: 58 };
const CHAR_PX = 6.2;

interface Props {
  models: RenderModel[];
  handoffs: Handoff[];
  metric: Metric;
  metricLabel: string;
  yScale: YScaleKind;
  from: string;
  to: string;
  focused: string | null;
  onFocusFamily: (key: string | null) => void;
}

/**
 * One line per family: at every date, the price of whichever model was the
 * family's current one. Segments darken with each generation (the family ramp),
 * and the dashed connector at each handoff carries the signed delta — so
 * reading a single line left to right answers "who was current, at what price,
 * and what replaced it".
 */
export function SuccessionTimeline({
  models,
  handoffs,
  metric,
  metricLabel,
  yScale,
  from,
  to,
  focused,
  onFocusFamily,
}: Props) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const segments = useMemo(() => buildSuccession(models), [models]);

  const plot = useMemo(() => makePlot(Math.max(width, 320), HEIGHT, MARGIN), [width]);
  const x = useMemo(() => makeX(from, to, plot), [from, to, plot]);
  const y = useMemo(() => {
    const values: number[] = [];
    for (const seg of segments) {
      for (const [, v] of seg.points) if (v != null && Number.isFinite(v) && v > 0) values.push(v);
    }
    return makeY(values, yScale, plot);
  }, [segments, yScale, plot]);

  const yTicks = useMemo(() => {
    const [lo, hi] = y.domain() as [number, number];
    return yScale === "log" ? logTicks(lo, hi) : (y.ticks?.(6) ?? []);
  }, [y, yScale]);
  const xTicks = useMemo(
    () => x.ticks(Math.max(4, Math.floor(plot.innerWidth / 90))),
    [x, plot],
  );

  const isDim = (seg: ReignSegment) => focused !== null && seg.model.familyKey !== focused;

  const paths = useMemo(() => {
    const gen = d3line<[string, number | null]>()
      .defined((p) => {
        const v = p[1];
        if (v == null || !Number.isFinite(v)) return false;
        return yScale === "linear" ? v >= 0 : v > 0;
      })
      .x((p) => x(parseDay(p[0])))
      .y((p) => y(p[1] as number))
      .curve(curveStepAfter);

    return segments
      .map((seg) => {
        const pts = [...seg.points];
        const last = pts[pts.length - 1];
        // hold the last value through the end of the reign
        if (last[0] < seg.end) pts.push([seg.end, last[1]]);
        const d = gen(pts);
        return d ? { seg, d } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [segments, x, y, yScale]);

  const drawnIds = useMemo(() => new Set(segments.map((s) => s.model.id)), [segments]);

  const { successions, forks } = useMemo(() => {
    const keys = new Set(segments.map((s) => s.model.familyKey));
    const visible = handoffs.filter(
      (h) => keys.has(h.family_key) && (focused === null || h.family_key === focused),
    );
    return {
      successions: visible.filter((h) => h.kind !== "fork"),
      forks: visible.filter((h) => h.kind === "fork"),
    };
  }, [handoffs, segments, focused]);

  const forkBoxes = useMemo(
    () => forkLabelBoxes(forks, metric, x, y, plot.innerWidth, drawnIds),
    [forks, metric, x, y, plot.innerWidth, drawnIds],
  );

  // A name over each reign, when the segment is wide enough to letter. The
  // current generation is named by its end label instead.
  //
  // Labels from different families can land on the same spot (two flagships at
  // similar prices at the same time), so each label tries a few vertical slots
  // around its line and is dropped rather than drawn overlapping — the tooltip
  // still names everything.
  const reignLabels = useMemo(() => {
    interface Placed {
      seg: ReignSegment | null;
      x: number;
      y: number;
      w: number;
      text: string;
    }
    // Seed the occupied set with the fan labels: they carry price and delta, so
    // when the two systems compete the reign name is the one that gives way.
    const placed: Placed[] = forkBoxes.map((b) => ({
      seg: null,
      x: b.x + b.w / 2,
      y: b.y + b.h / 2,
      w: b.w,
      text: "",
    }));

    const candidates = segments
      .filter((seg) => !seg.isCurrent)
      .map((seg) => {
        const text = seg.model.shortLabel;
        const segW = x(parseDay(seg.end)) - x(parseDay(seg.start));
        if (segW < text.length * CHAR_PX + 14) return null;
        const midDay = addDays(seg.start, Math.floor(daysBetween(seg.start, seg.end) / 2));
        const v = valueOn(seg.model.series, midDay);
        if (v == null || v <= 0) return null;
        const lineY = y(v);
        if (!Number.isFinite(lineY)) return null;
        return { seg, text, cx: (x(parseDay(seg.start)) + x(parseDay(seg.end))) / 2, lineY };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => a.cx - b.cx);

    for (const c of candidates) {
      const w = c.text.length * CHAR_PX;
      // above the line first, then below, then one step further out
      const slots = [c.lineY - 10, c.lineY + 16, c.lineY - 24, c.lineY + 30];
      const slot = slots.find(
        (ly) =>
          ly >= 8 &&
          ly <= plot.innerHeight - 8 &&
          !placed.some(
            (p) => Math.abs(p.x - c.cx) < (p.w + w) / 2 + 8 && Math.abs(p.y - ly) < 13,
          ),
      );
      if (slot === undefined) continue;
      placed.push({ seg: c.seg, x: c.cx, y: slot, w, text: c.text });
    }
    return placed.filter((p): p is Placed & { seg: ReignSegment } => p.seg !== null);
  }, [segments, x, y, plot.innerHeight, forkBoxes]);

  // Right-margin label for each family's current model: name + today's price —
  // the "and where did it end up" of the story.
  const endLabels = useMemo(() => {
    const inputs: LabelInput[] = [];
    for (const seg of segments) {
      if (!seg.isCurrent) continue;
      let last: number | null = null;
      for (const [, v] of seg.points) if (v != null) last = v;
      if (last == null) continue;
      const ay = y(last);
      if (!Number.isFinite(ay)) continue;
      inputs.push({
        id: seg.model.id,
        label: `${truncate(seg.model.shortLabel, 18)} · ${formatPrice(last)}`,
        color: seg.model.color,
        anchorX: x(parseDay(seg.end)),
        anchorY: ay,
      });
    }
    return placeLabels(inputs, plot.innerWidth + 10, plot.innerHeight);
  }, [segments, x, y, plot.innerWidth, plot.innerHeight]);

  const tooltipRows: TooltipRow[] = useMemo(() => {
    if (!hoverDay) return [];
    const rows: TooltipRow[] = [];
    for (const seg of segments) {
      if (hoverDay < seg.start || hoverDay > seg.end) continue;
      const v = valueOn(seg.model.series, hoverDay);
      if (v == null) continue;
      rows.push({
        id: seg.model.id,
        label: `${seg.model.familyLabel} — ${seg.model.shortLabel}`,
        family: seg.model.familyKey,
        color: seg.model.color,
        value: v,
      });
    }
    return rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  }, [segments, hoverDay]);

  function handleMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const day = toDay(x.invert(px));
    setHoverDay(day < from ? from : day > to ? to : day);
    setHoverPos({ x: px + plot.margin.left, y: e.clientY - rect.top + plot.margin.top });
  }

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={plot.width}
        height={plot.height}
        role="img"
        aria-label={`Price of each family's current model over time, ${metricLabel}, ${yScale} scale`}
        onMouseLeave={() => {
          setHoverDay(null);
          setHoverPos(null);
        }}
      >
        <defs>
          {segments
            .filter((seg) => seg.model.censored)
            .map((seg) => {
              const x0 = x(parseDay(seg.start));
              return (
                <linearGradient
                  key={`sfade-${seg.model.id}`}
                  id={`sfade-${cssId(seg.model.id)}`}
                  gradientUnits="userSpaceOnUse"
                  x1={x0}
                  x2={x0 + FADE_PX}
                >
                  <stop offset="0%" stopColor={seg.model.color} stopOpacity={0} />
                  <stop offset="100%" stopColor={seg.model.color} stopOpacity={1} />
                </linearGradient>
              );
            })}
        </defs>

        <g transform={`translate(${plot.margin.left}, ${plot.margin.top})`}>
          {/* grid */}
          <g aria-hidden="true">
            {yTicks.map((t) => (
              <line
                key={`gy-${t}`}
                x1={0}
                x2={plot.innerWidth}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--gridline)"
                strokeWidth={1}
              />
            ))}
            <line
              x1={0}
              x2={plot.innerWidth}
              y1={plot.innerHeight}
              y2={plot.innerHeight}
              stroke="var(--baseline)"
              strokeWidth={1}
            />
          </g>

          {/* axes */}
          <g aria-hidden="true" fontSize={11} fill="var(--text-muted)">
            {yTicks.map((t) => (
              <text
                key={`ty-${t}`}
                x={-8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="central"
                className="tabular-nums"
              >
                {formatAxisPrice(t)}
              </text>
            ))}
            {xTicks.map((t) => (
              <text
                key={`tx-${t.getTime()}`}
                x={x(t)}
                y={plot.innerHeight + 18}
                textAnchor="middle"
                className="tabular-nums"
              >
                {formatMonth(t)}
              </text>
            ))}
          </g>

          {/* reign segments */}
          <g>
            {paths.map(({ seg, d }) => (
              <path
                key={seg.model.id}
                d={d}
                fill="none"
                stroke={
                  seg.model.censored ? `url(#sfade-${cssId(seg.model.id)})` : seg.model.color
                }
                strokeWidth={2.25}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={isDim(seg) ? 0.15 : 1}
              />
            ))}
          </g>

          <HandoffConnectors
            handoffs={successions}
            metric={metric}
            x={x}
            y={y}
            innerHeight={plot.innerHeight}
            labelled
          />

          <ForkConnectors
            forks={forks}
            metric={metric}
            x={x}
            y={y}
            innerHeight={plot.innerHeight}
            innerWidth={plot.innerWidth}
            resolvedIds={drawnIds}
          />

          {/* reign names above their segments */}
          <g>
            {reignLabels.map((l) => (
              <text
                key={`rl-${l.seg.model.id}`}
                x={l.x}
                y={l.y}
                textAnchor="middle"
                fontSize={11}
                fill="var(--text-secondary)"
                opacity={isDim(l.seg) ? 0.25 : 1}
                paintOrder="stroke"
                stroke="var(--surface-1)"
                strokeWidth={3}
                strokeLinejoin="round"
              >
                {l.text}
              </text>
            ))}
          </g>

          {/* current model + current price, per family */}
          <g>
            {endLabels.map((l) => {
              const seg = segments.find((s) => s.model.id === l.id);
              const dim = seg ? isDim(seg) : false;
              return (
                <g key={`el-${l.id}`} opacity={dim ? 0.3 : 1}>
                  <path
                    d={`M ${l.anchorX} ${l.anchorY} L ${l.x - 4} ${l.y}`}
                    fill="none"
                    stroke={l.color}
                    strokeWidth={1}
                    opacity={0.45}
                  />
                  <text
                    x={l.x}
                    y={l.y}
                    fontSize={11}
                    fontWeight={600}
                    dominantBaseline="central"
                    fill="var(--text-primary)"
                    paintOrder="stroke"
                    stroke="var(--surface-1)"
                    strokeWidth={3}
                    strokeLinejoin="round"
                  >
                    {l.label}
                  </text>
                </g>
              );
            })}
          </g>

          {/* crosshair */}
          {hoverDay && (
            <line
              x1={x(parseDay(hoverDay))}
              x2={x(parseDay(hoverDay))}
              y1={0}
              y2={plot.innerHeight}
              stroke="var(--text-muted)"
              strokeWidth={1}
              pointerEvents="none"
            />
          )}

          <rect
            width={plot.innerWidth}
            height={plot.innerHeight}
            fill="transparent"
            onMouseMove={handleMove}
            onClick={() => onFocusFamily(null)}
          />
        </g>
      </svg>

      {hoverDay && hoverPos && (
        <Tooltip
          day={hoverDay}
          rows={tooltipRows}
          x={hoverPos.x}
          y={hoverPos.y}
          containerWidth={plot.width}
          metricLabel={metricLabel}
        />
      )}
    </div>
  );
}

function cssId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}
