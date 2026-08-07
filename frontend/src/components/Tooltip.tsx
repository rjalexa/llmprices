import { formatDay, formatPrice } from "../lib/format";

export interface TooltipRow {
  id: string;
  label: string;
  family: string;
  color: string;
  value: number | null;
}

interface Props {
  day: string;
  rows: TooltipRow[];
  x: number;
  y: number;
  containerWidth: number;
  metricLabel: string;
}

/** Enhances, never gates: every value here is also reachable from the snapshot
 *  table and the CSV export. */
export function Tooltip({ day, rows, x, y, containerWidth, metricLabel }: Props) {
  const width = 250;
  const flip = x + width + 24 > containerWidth;
  const left = flip ? x - width - 14 : x + 14;

  return (
    <div
      className="pointer-events-none absolute z-20 rounded-md border px-3 py-2 text-xs shadow-lg"
      style={{
        left: Math.max(4, left),
        top: Math.max(4, y - 12),
        width,
        background: "var(--surface-1)",
        borderColor: "var(--border)",
        color: "var(--text-primary)",
      }}
      role="status"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="font-semibold">{formatDay(day)}</span>
        <span style={{ color: "var(--text-muted)" }}>{metricLabel}</span>
      </div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: r.color }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-secondary)" }}>
              {r.label}
            </span>
            <span className="tabular-nums font-medium">{formatPrice(r.value)}</span>
          </li>
        ))}
        {rows.length === 0 && (
          <li style={{ color: "var(--text-muted)" }}>nothing priced on this date</li>
        )}
      </ul>
    </div>
  );
}
