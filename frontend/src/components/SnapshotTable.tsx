import { useMemo, useState } from "react";
import type { Metric, SnapshotRow } from "../api/client";
import { formatPrice } from "../lib/format";
import type { RenderModel } from "../lib/seriesView";

type SortKey = "name" | "prompt" | "completion" | "blended";

interface Props {
  rows: SnapshotRow[];
  models: RenderModel[];
  date: string;
  minDate: string;
  maxDate: string;
  metric: Metric;
  onDate: (d: string) => void;
}

/** The table view twin: every value the chart encodes in colour is readable here
 *  as text, which is also the relief for the sub-3:1 hues. */
export function SnapshotTable({ rows, models, date, minDate, maxDate, metric, onDate }: Props) {
  const [sort, setSort] = useState<SortKey>(metric);
  const [asc, setAsc] = useState(false);

  const modelById = useMemo(
    () => new Map(models.map((m) => [m.id, m])),
    [models],
  );

  const sorted = useMemo(() => {
    const live = rows.filter((r) => r.live);
    return [...live].sort((a, b) => {
      if (sort === "name") return asc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      const av = a[sort] ?? -Infinity;
      const bv = b[sort] ?? -Infinity;
      return asc ? av - bv : bv - av;
    });
  }, [rows, sort, asc]);

  function toggle(key: SortKey) {
    if (key === sort) setAsc(!asc);
    else {
      setSort(key);
      setAsc(key === "name");
    }
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          Priced on
          <input
            type="date"
            value={date}
            min={minDate}
            max={maxDate}
            onChange={(e) => e.target.value && onDate(e.target.value)}
            className="rounded border px-2 py-1 text-xs"
            style={{ borderColor: "var(--border)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          />
        </label>
        <input
          type="range"
          min={0}
          max={dayDiff(minDate, maxDate)}
          value={dayDiff(minDate, date)}
          onChange={(e) => onDate(addDays(minDate, Number(e.target.value)))}
          className="min-w-40 flex-1"
          aria-label="Scrub the snapshot date"
        />
        <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
          {sorted.length} priced
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Nothing in the selection was priced on {date}.
        </p>
      ) : (
        <div className="scroll-x rounded-lg border" style={{ borderColor: "var(--border)" }}>
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr style={{ background: "var(--surface-1)" }}>
                <Th onClick={() => toggle("name")} active={sort === "name"} asc={asc} align="left">
                  Model
                </Th>
                <Th onClick={() => toggle("prompt")} active={sort === "prompt"} asc={asc}>
                  Input $/M
                </Th>
                <Th onClick={() => toggle("completion")} active={sort === "completion"} asc={asc}>
                  Output $/M
                </Th>
                <Th onClick={() => toggle("blended")} active={sort === "blended"} asc={asc}>
                  Blended $/M
                </Th>
                <th className="px-3 py-2 text-right text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Since launch
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const m = modelById.get(r.model_id);
                return (
                  <tr key={r.model_id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: m?.color ?? "var(--text-muted)" }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{r.name}</span>
                      </span>
                    </td>
                    <Td>{formatPrice(r.prompt)}</Td>
                    <Td>{formatPrice(r.completion)}</Td>
                    <Td>{formatPrice(r.blended)}</Td>
                    <td className="px-3 py-1.5">
                      <Sparkline model={m} upTo={date} metric={metric} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  asc,
  align = "right",
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  asc: boolean;
  align?: "left" | "right";
}) {
  return (
    <th className={`px-3 py-2 text-xs font-medium ${align === "left" ? "text-left" : "text-right"}`}>
      <button
        type="button"
        onClick={onClick}
        className="min-h-6"
        style={{ color: active ? "var(--text-primary)" : "var(--text-muted)" }}
      >
        {children}
        {active ? (asc ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-1.5 text-right tabular-nums">{children}</td>;
}

function Sparkline({
  model,
  upTo,
  metric,
}: {
  model: RenderModel | undefined;
  upTo: string;
  metric: Metric;
}) {
  const W = 90;
  const H = 18;
  if (!model?.series?.points.length) return <span style={{ color: "var(--text-muted)" }}>—</span>;

  const pts = model.series.points.filter((p) => p[0] <= upTo && p[1] != null) as [string, number][];
  if (pts.length < 2) return <span style={{ color: "var(--text-muted)" }}>flat</span>;

  const values = pts.map((p) => p[1]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = W / (pts.length - 1);
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${H - ((p[1] - lo) / span) * (H - 3) - 1.5}`)
    .join(" ");

  return (
    <svg width={W} height={H} role="img" aria-label={`${model.shortLabel} ${metric} trend`} className="ml-auto block">
      <path d={d} fill="none" stroke={model.color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function dayDiff(a: string, b: string): number {
  return Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000));
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
