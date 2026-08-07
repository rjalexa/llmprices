import { line as d3line, curveStepAfter } from "d3-shape";
import { useMemo, useState } from "react";
import type { Handoff, Metric } from "../api/client";
import { formatAxisPrice, formatMonth, parseDay, toDay } from "../lib/format";
import { placeLabels, truncate, type LabelInput, type PlacedLabel } from "../lib/labelPlacement";
import { logTicks, makePlot, makeX, makeY, type YScaleKind } from "../lib/scales";
import { domainValues, lastValue, valueOn, type RenderModel } from "../lib/seriesView";
import { useMeasure } from "../lib/useMeasure";
import { ForkConnectors } from "./ForkConnectors";
import { HandoffConnectors } from "./HandoffConnectors";
import { ReleaseMarkers } from "./ReleaseMarkers";
import { Tooltip, type TooltipRow } from "./Tooltip";

const HEIGHT = 560;
const FADE_PX = 46; // width of the left-edge fade on left-truncated series
const MARGIN = { top: 16, right: 158, bottom: 34, left: 58 };
const LABEL_MAX = 20; // characters before truncation, sized to the right margin

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

export function PriceTimeline({
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

  const plot = useMemo(() => makePlot(Math.max(width, 320), HEIGHT, MARGIN), [width]);
  const x = useMemo(() => makeX(from, to, plot), [from, to, plot]);
  const y = useMemo(
    () => makeY(domainValues(models), yScale, plot),
    [models, yScale, plot],
  );

  const paths = useMemo(() => buildPaths(models, x, y, to, yScale), [models, x, y, to, yScale]);
  const endLabels = useMemo(
    () => buildEndLabels(models, x, y, plot.innerHeight, plot.innerWidth, to),
    [models, x, y, plot.innerHeight, plot.innerWidth, to],
  );

  const yTicks = useMemo(() => {
    const [lo, hi] = y.domain() as [number, number];
    return yScale === "log" ? logTicks(lo, hi) : (y.ticks?.(6) ?? []);
  }, [y, yScale]);

  const xTicks = useMemo(() => x.ticks(Math.max(4, Math.floor(plot.innerWidth / 90))), [x, plot]);

  const visibleHandoffs = useMemo(() => {
    const ids = new Set(models.map((m) => m.id));
    return handoffs.filter((h) => ids.has(h.prev_id) && ids.has(h.next_id));
  }, [handoffs, models]);

  // Delta labels are the point of the chart, so show them whenever they fit;
  // past a handful of families at once they overlap into soup and only the
  // focused family keeps them.
  const familyCount = new Set(models.map((m) => m.familyKey)).size;
  const labelHandoffs = focused !== null || familyCount <= 3;

  const tooltipRows: TooltipRow[] = useMemo(() => {
    if (!hoverDay) return [];
    return models
      .map((m) => ({
        id: m.id,
        label: m.shortLabel,
        family: m.familyLabel,
        color: m.color,
        value: valueOn(m.series, hoverDay),
      }))
      .filter((r) => r.value != null)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, 12);
  }, [models, hoverDay]);

  function handleMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const day = toDay(x.invert(px));
    setHoverDay(day < from ? from : day > to ? to : day);
    setHoverPos({ x: px + plot.margin.left, y: e.clientY - rect.top + plot.margin.top });
  }

  const isDim = (m: RenderModel) => focused !== null && m.familyKey !== focused;
  const dimIds = useMemo(
    () => new Set(models.filter(isDim).map((m) => m.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [models, focused],
  );

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={plot.width}
        height={plot.height}
        role="img"
        aria-label={`Price per million tokens over time, ${metricLabel}, ${yScale} scale`}
        onMouseLeave={() => {
          setHoverDay(null);
          setHoverPos(null);
        }}
      >
        <defs>
          {models
            .filter((m) => m.censored && m.series?.first_day)
            .map((m) => {
              const x0 = x(parseDay(m.series!.first_day!));
              return (
                <linearGradient
                  key={`fade-${m.id}`}
                  id={`fade-${cssId(m.id)}`}
                  gradientUnits="userSpaceOnUse"
                  x1={x0}
                  x2={x0 + FADE_PX}
                >
                  <stop offset="0%" stopColor={m.color} stopOpacity={0} />
                  <stop offset="100%" stopColor={m.color} stopOpacity={1} />
                </linearGradient>
              );
            })}
        </defs>

        <g transform={`translate(${plot.margin.left}, ${plot.margin.top})`}>
          {/* grid — solid hairlines, one shade off the surface */}
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
              <text key={`ty-${t}`} x={-8} y={y(t)} textAnchor="end" dominantBaseline="central" className="tabular-nums">
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

          {/* step lines */}
          <g>
            {paths.map((p) => (
              <path
                key={p.id}
                d={p.d}
                fill="none"
                stroke={p.censored ? `url(#fade-${cssId(p.id)})` : p.color}
                strokeWidth={p.dim ? 1.5 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={p.isVariant ? "5 3" : undefined}
                opacity={dimIds.has(p.id) ? 0.18 : 1}
              />
            ))}
          </g>

          {/* a retired model's line stops at last_seen; the cap says that is an
              end, not a gap in the data */}
          <g aria-hidden="true">
            {models
              .filter((m) => !m.presentNow && m.series?.last_day)
              .map((m) => {
                const v = lastValue(m.series);
                if (v == null) return null;
                return (
                  <circle
                    key={`end-${m.id}`}
                    cx={x(parseDay(m.series!.last_day!))}
                    cy={y(v)}
                    r={3}
                    fill="var(--surface-1)"
                    stroke={m.color}
                    strokeWidth={2}
                    opacity={isDim(m) ? 0.25 : 1}
                  />
                );
              })}
          </g>

          <ReleaseMarkers
            models={models.filter((m) => !isDim(m))}
            x={x}
            y={y}
            innerHeight={plot.innerHeight}
            innerWidth={plot.innerWidth}
            labelled={focused !== null}
          />

          <HandoffConnectors
            handoffs={visibleHandoffs.filter(
              (h) => h.kind !== "fork" && (focused === null || h.family_key === focused),
            )}
            metric={metric}
            x={x}
            y={y}
            innerHeight={plot.innerHeight}
            labelled={labelHandoffs}
          />

          <ForkConnectors
            forks={visibleHandoffs.filter(
              (h) => h.kind === "fork" && (focused === null || h.family_key === focused),
            )}
            metric={metric}
            x={x}
            y={y}
            innerHeight={plot.innerHeight}
            innerWidth={plot.innerWidth}
            resolvedIds={new Set(models.map((m) => m.id))}
          />

          {/* direct labels at each line's end — the relief for the sub-3:1 hues,
              and how identity survives without reading the legend */}
          <g>
            {endLabels.map((l) => {
              const dim = dimIds.has(l.id);
              return (
                <g key={`lb-${l.id}`} opacity={dim ? 0.3 : 1}>
                  {/* leader back to the line's real endpoint, so a nudged label
                      still says which line it belongs to */}
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
                    dominantBaseline="central"
                    fill="var(--text-secondary)"
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

interface PathSpec {
  id: string;
  d: string;
  color: string;
  censored: boolean;
  isVariant: boolean;
  dim: boolean;
}

function buildPaths(
  models: RenderModel[],
  x: ReturnType<typeof makeX>,
  y: ReturnType<typeof makeY>,
  to: string,
  kind: YScaleKind,
): PathSpec[] {
  // A few points are a genuine $0. Linear can draw that; log cannot, so there
  // the line breaks rather than silently snapping to the axis floor.
  const gen = d3line<[string, number | null]>()
    .defined((p) => {
      const v = p[1];
      if (v == null || !Number.isFinite(v)) return false;
      return kind === "linear" ? v >= 0 : v > 0;
    })
    .x((p) => x(parseDay(p[0])))
    .y((p) => y(p[1] as number))
    .curve(curveStepAfter);

  const out: PathSpec[] = [];
  for (const m of models) {
    const s = m.series;
    if (!s || s.points.length === 0) continue;

    const pts: [string, number | null][] = [...s.points];
    // Hold the last known value out to the model's own end (last_seen, clipped to
    // the window) — that flat run is the point for closed models whose price
    // never moves.
    const end = s.last_day && s.last_day < to ? s.last_day : to;
    const lastDay = pts[pts.length - 1][0];
    if (lastDay < end) pts.push([end, pts[pts.length - 1][1]]);

    const d = gen(pts);
    if (d) {
      out.push({
        id: m.id,
        d,
        color: m.color,
        censored: m.censored,
        isVariant: m.isVariant,
        dim: m.isVariant,
      });
    }
  }
  return out;
}

function buildEndLabels(
  models: RenderModel[],
  x: ReturnType<typeof makeX>,
  y: ReturnType<typeof makeY>,
  innerHeight: number,
  innerWidth: number,
  to: string,
): PlacedLabel[] {
  const inputs: LabelInput[] = [];
  for (const m of models) {
    const v = lastValue(m.series);
    const s = m.series;
    if (v == null || !s) continue;
    const endDay = s.last_day && s.last_day < to ? s.last_day : to;
    const ax = x(parseDay(endDay));
    const ay = y(v);
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) continue;
    inputs.push({
      id: m.id,
      label: truncate(m.shortLabel, LABEL_MAX),
      color: m.color,
      anchorX: ax,
      anchorY: ay,
    });
  }
  return placeLabels(inputs, innerWidth + 10, innerHeight);
}
