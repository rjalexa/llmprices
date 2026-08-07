import type { ScaleContinuousNumeric, ScaleTime } from "d3-scale";
import type { Handoff, Metric } from "../api/client";
import { DIRECTION_COLOR } from "../lib/colors";
import { formatDelta, formatPrice, parseDay, shortName } from "../lib/format";

const SPINE_DX = 26; // how far right of the fork date the spine sits
const STUB = 14; // horizontal run from spine to each tier
const LABEL_H = 17;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function labelWidth(h: Handoff, metric: Metric, resolved: boolean): number {
  const delta = formatDelta(h.delta_pct[metric]);
  if (resolved) return delta.length * 6.6 + 10;
  const to = h.next_price[metric];
  return (shortName(h.next_name).length + formatPrice(to).length + delta.length + 4) * 6.2;
}

/** Where this fan's labels will land. The timeline feeds these to its reign-label
 *  placer so the two label systems don't draw on top of each other. */
export function forkLabelBoxes(
  forks: Handoff[],
  metric: Metric,
  x: ScaleTime<number, number>,
  y: ScaleContinuousNumeric<number, number>,
  innerWidth: number,
  resolvedIds?: Set<string>,
): Box[] {
  const groups = new Map<string, Handoff[]>();
  for (const f of forks) {
    const list = groups.get(f.prev_id) ?? [];
    list.push(f);
    groups.set(f.prev_id, list);
  }

  const boxes: Box[] = [];
  for (const branches of groups.values()) {
    const cx = x(parseDay(branches[0].launch_date));
    if (!Number.isFinite(cx)) continue;
    const widest = Math.max(
      ...branches.map((b) => labelWidth(b, metric, resolvedIds?.has(b.next_id) ?? false)),
    );
    const mirrored = cx + SPINE_DX + STUB + widest + 8 > innerWidth;
    const dir = mirrored ? -1 : 1;
    const stubEnd = cx + dir * (SPINE_DX + STUB);
    for (const b of branches) {
      const to = b.next_price[metric];
      if (to == null) continue;
      const ty = y(to);
      if (!Number.isFinite(ty)) continue;
      const w = labelWidth(b, metric, resolvedIds?.has(b.next_id) ?? false);
      boxes.push({ x: mirrored ? stubEnd - 6 - w : stubEnd + 6, y: ty - LABEL_H / 2, w, h: LABEL_H });
    }
  }
  return boxes;
}

interface Props {
  /** every fork branch, grouped by source model inside */
  forks: Handoff[];
  metric: Metric;
  x: ScaleTime<number, number>;
  y: ScaleContinuousNumeric<number, number>;
  innerHeight: number;
  innerWidth: number;
  /**
   * Tiers that already have their own line on screen. Their branch shows only
   * the delta — the line's own end label carries the name and price, and
   * repeating it here collides with that label when the fork sits near the
   * right edge.
   */
  resolvedIds?: Set<string>;
  dimmedFamilies?: Set<string>;
}

/**
 * A generation that fans out into several tiers, drawn as one bracket:
 *
 *   GPT-5.5 ─────●┐
 *                 ├─── Sol    $11.25   0%
 *                 ├─── Terra   $5.63  −50%
 *                 └─── Luna    $2.25  −80%
 *
 * Successions are a step from one price to the next; a fork is one price
 * becoming several at once, so it gets a shape of its own rather than three
 * overlapping connectors stacked on the same date.
 */
export function ForkConnectors({
  forks,
  metric,
  x,
  y,
  innerHeight,
  innerWidth,
  resolvedIds,
  dimmedFamilies,
}: Props) {
  // group branches by the model they fork from
  const groups = new Map<string, Handoff[]>();
  for (const f of forks) {
    const list = groups.get(f.prev_id) ?? [];
    list.push(f);
    groups.set(f.prev_id, list);
  }

  return (
    <g>
      {[...groups.entries()].map(([sourceId, branches]) => {
        const source = branches[0];
        const from = source.prev_price[metric];
        if (from == null) return null;

        const cx = x(parseDay(source.launch_date));
        const y0 = y(from);
        if (!Number.isFinite(cx) || !Number.isFinite(y0)) return null;

        const dim = dimmedFamilies?.has(source.family_key) ?? false;

        const legs = branches
          .map((b) => {
            const to = b.next_price[metric];
            if (to == null) return null;
            const ty = y(to);
            if (!Number.isFinite(ty)) return null;
            return { b, ty, to };
          })
          .filter((l): l is NonNullable<typeof l> => l !== null)
          .sort((a, b) => a.ty - b.ty);

        if (legs.length === 0) return null;

        const top = Math.min(y0, ...legs.map((l) => l.ty));
        const bottom = Math.max(y0, ...legs.map((l) => l.ty));

        // A fan launched recently sits hard against the right edge, where its
        // labels would land on top of the end-of-line labels. When the fan
        // doesn't fit, mirror it to the left of the fork date.
        const widest = Math.max(
          ...branches.map((b) => labelWidth(b, metric, resolvedIds?.has(b.next_id) ?? false)),
        );
        const mirrored = cx + SPINE_DX + STUB + widest + 8 > innerWidth;
        const dir = mirrored ? -1 : 1;
        const spineX = cx + dir * SPINE_DX;
        const stubEnd = spineX + dir * STUB;

        return (
          <g key={sourceId} opacity={dim ? 0.25 : 1}>
            {/* lead-in from the source line, then the vertical spine the tiers hang off */}
            <path
              d={`M ${cx} ${y0} L ${spineX} ${y0}`}
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
            {/* mark the fork date itself when the fan is mirrored, so the
                bracket still reads as belonging to that moment */}
            {mirrored && (
              <line
                x1={cx}
                x2={cx}
                y1={y0 - 5}
                y2={y0 + 5}
                stroke="var(--text-muted)"
                strokeWidth={1.5}
              />
            )}
            {/* the spine can span most of the plot, so keep it recessive */}
            <line
              x1={spineX}
              x2={spineX}
              y1={top}
              y2={bottom}
              stroke="var(--text-muted)"
              strokeWidth={1.25}
              opacity={0.7}
            />
            <circle cx={cx} cy={y0} r={3} fill="var(--text-muted)" />

            {legs.map(({ b, ty, to }) => {
              const color = DIRECTION_COLOR[b.direction[metric]] ?? DIRECTION_COLOR.flat;
              const labelY = Math.min(Math.max(ty, 9), innerHeight - 9);
              const resolved = resolvedIds?.has(b.next_id) ?? false;
              const delta = formatDelta(b.delta_pct[metric]);
              return (
                <g key={b.next_id}>
                  <path
                    d={`M ${spineX} ${ty} L ${stubEnd} ${ty}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.75}
                  />
                  <circle cx={stubEnd} cy={ty} r={3} fill={color} />
                  {resolved ? (
                    <DeltaChip
                      x={stubEnd + dir * 6}
                      y={labelY}
                      text={delta}
                      color={color}
                      anchorEnd={mirrored}
                    />
                  ) : (
                    <text
                      x={stubEnd + dir * 7}
                      y={labelY}
                      textAnchor={mirrored ? "end" : "start"}
                      fontSize={11}
                      dominantBaseline="central"
                      fill="var(--text-primary)"
                      paintOrder="stroke"
                      stroke="var(--surface-1)"
                      strokeWidth={3}
                      strokeLinejoin="round"
                    >
                      <tspan fontWeight={600}>{shortName(b.next_name)}</tspan>
                      <tspan fill="var(--text-secondary)"> {formatPrice(to)}</tspan>
                      <tspan fill={color} fontWeight={600}>
                        {"  "}
                        {delta}
                      </tspan>
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

function DeltaChip({
  x,
  y,
  text,
  color,
  anchorEnd = false,
}: {
  x: number;
  y: number;
  text: string;
  color: string;
  anchorEnd?: boolean;
}) {
  const width = text.length * 6.6 + 10;
  return (
    <g transform={`translate(${anchorEnd ? x - width : x}, ${y})`}>
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
