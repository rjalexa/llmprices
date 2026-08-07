import { forceCollide, forceSimulation, forceY } from "d3-force";
import type { ScaleContinuousNumeric, ScaleTime } from "d3-scale";
import { useMemo } from "react";
import { parseDay } from "../lib/format";
import type { RenderModel } from "../lib/seriesView";

interface Props {
  models: RenderModel[];
  x: ScaleTime<number, number>;
  y: ScaleContinuousNumeric<number, number>;
  innerHeight: number;
  innerWidth: number;
  /** Only the focused family gets labels; ticks are cheap enough to always show. */
  labelled: boolean;
}

interface Node {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  targetY: number;
  /** false when a neighbour already occupies this horizontal band */
  showLabel: boolean;
}

const CHAR_PX = 6.2;
const LABEL_GAP = 8;

/**
 * A tick from the axis at each member's launch, plus a dot on its first priced
 * point. Labels are nudged apart vertically by a force sim so a cluster of
 * releases doesn't stack into an unreadable pile.
 */
export function ReleaseMarkers({ models, x, y, innerHeight, innerWidth, labelled }: Props) {
  const nodes = useMemo(() => {
    const raw: Node[] = [];
    for (const m of models) {
      if (m.isVariant) continue;
      const first = m.series?.points[0];
      if (!first || first[1] == null) continue;
      const px = x(parseDay(first[0]));
      const py = y(first[1]);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      raw.push({
        id: m.id,
        label: m.shortLabel,
        color: m.color,
        x: px,
        y: py,
        targetY: py,
        showLabel: true,
      });
    }
    if (!labelled || raw.length === 0) return raw;

    const sim = forceSimulation(raw as never[])
      .force("y", forceY<never>((d: never) => (d as unknown as Node).targetY).strength(0.9))
      .force("collide", forceCollide(9))
      .stop();
    for (let i = 0; i < 120; i++) sim.tick();
    for (const n of raw) n.y = Math.min(Math.max(n.y, 8), innerHeight - 8);

    // The force sim separates points, not glyphs: two labels 70px wide sitting
    // 20px apart still collide. Where a run of releases is too tight to letter,
    // drop the later labels — the tick and dot still mark every release, and
    // the tooltip names them.
    let occupiedUntil = -Infinity;
    for (const n of [...raw].sort((a, b) => a.x - b.x)) {
      const width = n.label.length * CHAR_PX;
      if (n.x < occupiedUntil) {
        n.showLabel = false;
        continue;
      }
      occupiedUntil = n.x + width + LABEL_GAP;
    }
    return raw;
  }, [models, x, y, innerHeight, labelled]);

  return (
    <g aria-hidden="true">
      {nodes.map((n) => {
        // Flip the label to the left when it would run off the right edge.
        const flip = n.x + n.label.length * 6.2 + 14 > innerWidth;
        return (
          <g key={n.id}>
            <line
              x1={n.x}
              x2={n.x}
              y1={innerHeight}
              y2={innerHeight - 6}
              stroke={n.color}
              strokeWidth={1.5}
            />
            <circle
              cx={n.x}
              cy={n.targetY}
              r={3.5}
              fill={n.color}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
            {labelled && n.showLabel && (
              <>
                {Math.abs(n.y - n.targetY) > 1 && (
                  <line
                    x1={n.x}
                    y1={n.targetY}
                    x2={n.x + (flip ? -5 : 5)}
                    y2={n.y}
                    stroke={n.color}
                    strokeWidth={1}
                    opacity={0.5}
                  />
                )}
                <text
                  x={n.x + (flip ? -8 : 8)}
                  y={n.y}
                  textAnchor={flip ? "end" : "start"}
                  dominantBaseline="central"
                  fontSize={11}
                  fill="var(--text-secondary)"
                  paintOrder="stroke"
                  stroke="var(--surface-1)"
                  strokeWidth={3}
                  strokeLinejoin="round"
                >
                  {n.label}
                </text>
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}
