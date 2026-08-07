import { useMemo, useState } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import { daysBetween } from "../lib/format";
import { placeLabels, truncate } from "../lib/labelPlacement";
import type { RenderModel } from "../lib/seriesView";
import { makePlot } from "../lib/scales";
import { useMeasure } from "../lib/useMeasure";

const HEIGHT = 460;

interface Props {
  models: RenderModel[];
  focused: string | null;
  onFocus: (key: string | null) => void;
}

/**
 * x = days since that model's own launch, y = price indexed to 100 at launch.
 * Overlaying every model on a common origin puts the open-weight price collapse
 * directly beside the closed models' dead-flat lines — the contrast the timeline
 * can only imply.
 */
export function DecayView({ models, focused, onFocus }: Props) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);

  const plot = useMemo(
    () => makePlot(Math.max(width, 320), HEIGHT, { top: 16, right: 168, bottom: 36, left: 48 }),
    [width],
  );

  const tracks = useMemo(() => {
    const out: { id: string; label: string; color: string; family: string; pts: [number, number][] }[] = [];
    for (const m of models) {
      // A handful of ledger points are a genuine $0 (a host briefly serving the
      // model free). They are real, but they have no place on a ratio scale —
      // indexing against or plotting them yields 0/±Infinity — so they are
      // dropped here rather than allowed to poison the whole domain.
      const pts = (m.series?.points ?? []).filter(
        (p) => p[1] != null && Number.isFinite(p[1]) && (p[1] as number) > 0,
      ) as [string, number][];
      if (pts.length === 0) continue;
      const [launchDay, launchValue] = pts[0];
      if (!launchValue) continue;
      const indexed: [number, number][] = pts.map(([d, v]) => [
        daysBetween(launchDay, d),
        (v / launchValue) * 100,
      ]);
      const endDay = m.series?.last_day;
      if (endDay) {
        const span = daysBetween(launchDay, endDay);
        if (span > indexed[indexed.length - 1][0]) {
          indexed.push([span, indexed[indexed.length - 1][1]]);
        }
      }
      out.push({ id: m.id, label: m.shortLabel, color: m.color, family: m.familyKey, pts: indexed });
    }
    return out;
  }, [models]);

  const maxDays = Math.max(30, ...tracks.map((t) => t.pts[t.pts.length - 1][0]));
  const allY = tracks.flatMap((t) => t.pts.map((p) => p[1])).filter((v) => v > 0);
  // Floor the domain above zero: this axis is a log scale, so a zero bound
  // would make every tick NaN.
  const yLo = Math.max(1, Math.min(50, ...allY));
  const yHi = Math.max(150, ...allY);

  const x = scaleLinear().domain([0, maxDays]).range([0, plot.innerWidth]);
  const y = scaleLog().domain([yLo * 0.95, yHi * 1.05]).range([plot.innerHeight, 0]).clamp(true);

  const yTicks = [25, 50, 75, 100, 150, 200, 300].filter((v) => v >= yLo * 0.95 && v <= yHi * 1.05);
  const xTicks = x.ticks(6);

  // Only the movers get a label; a name on every line still pinned at 100 is noise.
  const labels = placeLabels(
    tracks
      .filter((t) => Math.abs(t.pts[t.pts.length - 1][1] - 100) > 6)
      .map((t) => {
        const last = t.pts[t.pts.length - 1];
        return {
          id: t.id,
          label: `${truncate(t.label, 18)} ${Math.round(last[1])}`,
          color: t.color,
          anchorX: x(last[0]),
          anchorY: y(last[1]),
        };
      }),
    plot.innerWidth + 10,
    plot.innerHeight,
  );

  const dimFamilies = new Set(
    tracks.filter((t) => focused !== null && t.family !== focused).map((t) => t.id),
  );

  if (tracks.length === 0) {
    return (
      <p className="p-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        Select a family to see how its prices moved after launch.
      </p>
    );
  }

  return (
    <div ref={ref} className="w-full p-4">
      <p className="mb-2 max-w-2xl text-xs" style={{ color: "var(--text-secondary)" }}>
        Each model starts at 100 on its own launch day. Flat lines are prices fixed for the
        model's life; falling lines are OpenRouter re-routing between hosts.
      </p>
      <svg
        width={plot.width}
        height={plot.height}
        role="img"
        aria-label="Price indexed to 100 at each model's launch, by days since launch"
      >
        <g transform={`translate(${plot.margin.left},${plot.margin.top})`}>
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={0}
                x2={plot.innerWidth}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 100 ? "var(--baseline)" : "var(--gridline)"}
                strokeWidth={1}
              />
              <text
                x={-8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={11}
                fill="var(--text-muted)"
                className="tabular-nums"
              >
                {t}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text
              key={t}
              x={x(t)}
              y={plot.innerHeight + 18}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
              className="tabular-nums"
            >
              {t}d
            </text>
          ))}

          {tracks.map((t) => {
            const dim = focused !== null && t.family !== focused;
            const active = hover === t.id;
            return (
              <path
                key={t.id}
                d={t.pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p[0])} ${y(p[1])}`).join(" ")}
                fill="none"
                stroke={t.color}
                strokeWidth={active ? 2.5 : 1.75}
                strokeLinejoin="round"
                opacity={dim ? 0.15 : 1}
                onMouseEnter={() => setHover(t.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onFocus(focused === t.family ? null : t.family)}
                style={{ cursor: "pointer" }}
              >
                <title>{`${t.label}: ${Math.round(t.pts[t.pts.length - 1][1])}% of launch price after ${
                  t.pts[t.pts.length - 1][0]
                } days`}</title>
              </path>
            );
          })}

          {/* label only the movers — a label on every flat line at 100 is noise */}
          {labels.map((l) => {
            const dim = focused !== null && dimFamilies.has(l.id);
            return (
              <g key={`l-${l.id}`} opacity={dim ? 0.25 : 1}>
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
        <text x={plot.margin.left} y={plot.height - 4} fontSize={11} fill="var(--text-muted)">
          days since that model's launch
        </text>
      </svg>
    </div>
  );
}
