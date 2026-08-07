import type { Family, Handoff, Metric } from "../api/client";
import { generationRamp, slotColor, DIRECTION_COLOR } from "../lib/colors";
import { formatDelta, formatPrice, shortName } from "../lib/format";

interface Props {
  families: Family[];
  slots: Record<string, number>;
  handoffs: Handoff[];
  metric: Metric;
  dark: boolean;
  cheaperOnly: boolean;
  onFocus: (key: string) => void;
}

/**
 * Small multiples, one panel per family: x = generation, y = launch price.
 * Answers "is each generation cheaper than the last" across every family at
 * once, without the within-model decay noise of the timeline.
 */
export function LadderView({
  families,
  slots,
  handoffs,
  metric,
  dark,
  cheaperOnly,
  onFocus,
}: Props) {
  const byFamily = new Map<string, Handoff[]>();
  for (const h of handoffs) {
    const list = byFamily.get(h.family_key) ?? [];
    list.push(h);
    byFamily.set(h.family_key, list);
  }

  const panels = families
    .map((f) => ({ family: f, handoffs: byFamily.get(f.key) ?? [] }))
    .filter((p) => (cheaperOnly ? p.handoffs.some((h) => h.direction[metric] === "cheaper") : true));

  if (panels.length === 0) {
    return <Empty message="No families match this filter." />;
  }

  return (
    <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {panels.map(({ family, handoffs: hs }) => (
        <Panel
          key={family.key}
          family={family}
          handoffs={hs}
          metric={metric}
          dark={dark}
          slot={slots[family.key]}
          cheaperOnly={cheaperOnly}
          onFocus={onFocus}
        />
      ))}
    </div>
  );
}

function Panel({
  family,
  handoffs,
  metric,
  dark,
  slot,
  cheaperOnly,
  onFocus,
}: {
  family: Family;
  handoffs: Handoff[];
  metric: Metric;
  dark: boolean;
  slot: number | undefined;
  cheaperOnly: boolean;
  onFocus: (key: string) => void;
}) {
  const W = 260;
  const H = 132;
  const pad = { top: 14, right: 12, bottom: 26, left: 40 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;

  // Launch price per generation: the successor's price at its own launch, plus
  // the first generation's own launch price from the leading handoff.
  const points: { id: string; label: string; value: number }[] = [];
  if (handoffs.length) {
    const first = handoffs[0].prev_price[metric];
    if (first != null) {
      points.push({ id: handoffs[0].prev_id, label: shortName(handoffs[0].prev_name), value: first });
    }
    for (const h of handoffs) {
      const v = h.next_price[metric];
      if (v != null) points.push({ id: h.next_id, label: shortName(h.next_name), value: v });
    }
  }

  if (points.length < 2) {
    return (
      <figure
        className="rounded-lg border p-3"
        style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
      >
        <figcaption className="mb-1 text-sm font-medium">{family.label}</figcaption>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Only one priced generation — nothing to compare yet.
        </p>
      </figure>
    );
  }

  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const yOf = (v: number) => {
    if (hi === lo) return ih / 2;
    // Log positioning: a 2x drop should look the same wherever it happens.
    const l = Math.log10(v);
    return ih - ((l - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * ih;
  };
  const xOf = (i: number) => (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);

  const base = slot === undefined ? "var(--text-muted)" : slotColor(slot, dark);
  const ramp = generationRamp(
    slot === undefined ? "#888888" : slotColor(slot, dark),
    points.length,
    dark,
  );

  const shown = cheaperOnly
    ? handoffs.filter((h) => h.direction[metric] === "cheaper")
    : handoffs;

  return (
    <figure
      className="rounded-lg border p-3"
      style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
    >
      <figcaption className="mb-1 flex items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={() => onFocus(family.key)}
          className="text-sm font-medium underline-offset-2 hover:underline"
        >
          {family.label}
        </button>
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {family.vendor}
        </span>
      </figcaption>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${family.label} launch price by generation`}>
        <g transform={`translate(${pad.left},${pad.top})`}>
          {[hi, lo].map((v) => (
            <g key={v}>
              <line x1={0} x2={iw} y1={yOf(v)} y2={yOf(v)} stroke="var(--gridline)" strokeWidth={1} />
              <text
                x={-6}
                y={yOf(v)}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={9}
                fill="var(--text-muted)"
                className="tabular-nums"
              >
                {formatPrice(v)}
              </text>
            </g>
          ))}

          <path
            d={points.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(p.value)}`).join(" ")}
            fill="none"
            stroke={base}
            strokeWidth={1.5}
            opacity={0.45}
          />

          {shown.map((h) => {
            const i = points.findIndex((p) => p.id === h.next_id);
            if (i <= 0) return null;
            const delta = h.delta_pct[metric];
            const color = DIRECTION_COLOR[h.direction[metric]] ?? DIRECTION_COLOR.flat;
            return (
              <text
                key={h.next_id}
                x={(xOf(i - 1) + xOf(i)) / 2}
                y={(yOf(points[i - 1].value) + yOf(points[i].value)) / 2 - 5}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill={color}
                paintOrder="stroke"
                stroke="var(--surface-1)"
                strokeWidth={2.5}
                strokeLinejoin="round"
              >
                {formatDelta(delta)}
              </text>
            );
          })}

          {points.map((p, i) => (
            <circle
              key={p.id}
              cx={xOf(i)}
              cy={yOf(p.value)}
              r={4}
              fill={ramp[i] ?? base}
              stroke="var(--surface-1)"
              strokeWidth={2}
            >
              <title>{`${p.label}: ${formatPrice(p.value)}/M`}</title>
            </circle>
          ))}
        </g>
        <text x={pad.left} y={H - 8} fontSize={9} fill="var(--text-muted)">
          {shortName(points[0].label)}
        </text>
        <text x={W - pad.right} y={H - 8} fontSize={9} textAnchor="end" fill="var(--text-muted)">
          {shortName(points[points.length - 1].label)}
        </text>
      </svg>
    </figure>
  );
}

export function Empty({ message }: { message: string }) {
  return (
    <div className="p-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
      {message}
    </div>
  );
}
