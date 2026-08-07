import type { ScaleContinuousNumeric, ScaleTime } from "d3-scale";
import type { Handoff, Metric } from "../api/client";
import { DIRECTION_COLOR } from "../lib/colors";
import { formatDelta, parseDay } from "../lib/format";

interface Props {
  handoffs: Handoff[];
  metric: Metric;
  x: ScaleTime<number, number>;
  y: ScaleContinuousNumeric<number, number>;
  innerHeight: number;
  /** Labels are drawn only for the focused family, or when few are on screen —
   *  every connector labelled at once is soup. */
  labelled: boolean;
  dimmed?: boolean;
}

/**
 * The key element: a dashed elbow at the launch date spanning exactly the
 * generational price gap, arrowhead pointing at the new price, labelled with the
 * signed delta. This is what turns "two lines on a chart" into "the generation
 * got 33% cheaper".
 */
export function HandoffConnectors({
  handoffs,
  metric,
  x,
  y,
  innerHeight,
  labelled,
  dimmed = false,
}: Props) {
  return (
    <g aria-hidden="true" opacity={dimmed ? 0.35 : 1}>
      {handoffs.map((h) => {
        const before = h.prev_price[metric];
        const after = h.next_price[metric];
        if (before == null || after == null) return null;

        const cx = x(parseDay(h.launch_date));
        const y0 = y(before);
        const y1 = y(after);
        if (!Number.isFinite(cx) || !Number.isFinite(y0) || !Number.isFinite(y1)) return null;

        const direction = h.direction[metric];
        const color = DIRECTION_COLOR[direction] ?? DIRECTION_COLOR.flat;
        const goingDown = y1 > y0;
        const gap = Math.abs(y1 - y0);
        // A sub-pixel gap has no arrow to draw and no delta worth reading.
        if (gap < 2) return null;

        const arrowY = y1 + (goingDown ? -5 : 5);
        const key = `${h.prev_id}->${h.next_id}`;

        return (
          <g key={key}>
            {/* short lead-in on the predecessor's level, so the elbow reads as a handoff
                rather than a free-floating vertical rule */}
            <path
              d={`M ${cx - 14} ${y0} L ${cx} ${y0} L ${cx} ${arrowY}`}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              strokeLinecap="round"
            />
            <path
              d={`M ${cx} ${y1} L ${cx - 4} ${arrowY} L ${cx + 4} ${arrowY} Z`}
              fill={color}
            />
            <circle cx={cx} cy={y0} r={2.5} fill={color} />
            {labelled && (
              <DeltaLabel
                x={cx}
                y={(y0 + y1) / 2}
                text={formatDelta(h.delta_pct[metric])}
                color={color}
                innerHeight={innerHeight}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

function DeltaLabel({
  x,
  y,
  text,
  color,
  innerHeight,
}: {
  x: number;
  y: number;
  text: string;
  color: string;
  innerHeight: number;
}) {
  const cy = Math.min(Math.max(y, 10), innerHeight - 10);
  const width = text.length * 6.6 + 10;
  return (
    <g transform={`translate(${x + 7}, ${cy})`}>
      <rect
        x={0}
        y={-8.5}
        width={width}
        height={17}
        rx={3}
        fill="var(--surface-1)"
        stroke={color}
        strokeWidth={1}
      />
      <text
        x={width / 2}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={600}
        fill="var(--text-primary)"
      >
        {text}
      </text>
    </g>
  );
}
