import type { Metric } from "../api/client";
import type { LineMode, Tab, Theme, YScaleKind } from "../state/useAtlasStore";

const METRICS: { value: Metric; label: string }[] = [
  { value: "prompt", label: "Input" },
  { value: "completion", label: "Output" },
  { value: "blended", label: "Blended" },
];

const TABS: { value: Tab; label: string }[] = [
  { value: "timeline", label: "Timeline" },
  { value: "ladder", label: "Ladder" },
  { value: "snapshot", label: "Snapshot" },
  { value: "decay", label: "Decay" },
];

interface Props {
  tab: Tab;
  mode: LineMode;
  metric: Metric;
  yScale: YScaleKind;
  showVariants: boolean;
  cheaperOnly: boolean;
  theme: Theme;
  exportHref: string;
  blendRatio: { input: number; output: number };
  from: string | null;
  to: string | null;
  minDate: string;
  maxDate: string;
  onTab: (t: Tab) => void;
  onMode: (m: LineMode) => void;
  onMetric: (m: Metric) => void;
  onYScale: (s: YScaleKind) => void;
  onShowVariants: (v: boolean) => void;
  onCheaperOnly: (v: boolean) => void;
  onTheme: (t: Theme) => void;
  onRange: (from: string | null, to: string | null) => void;
}

/** One filter row above everything it scopes — never per-chart filters. */
export function Controls(p: Props) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5"
      style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
    >
      <Segmented
        label="View"
        options={TABS}
        value={p.tab}
        onChange={(v) => p.onTab(v as Tab)}
      />
      {p.tab === "timeline" && (
        <Segmented
          label="Lines"
          options={[
            { value: "succession", label: "Succession" },
            { value: "all", label: "All models" },
          ]}
          value={p.mode}
          onChange={(v) => p.onMode(v as LineMode)}
          hint="Succession: one line per family — whichever model was current at each date"
        />
      )}
      <Segmented
        label="Metric"
        options={METRICS}
        value={p.metric}
        onChange={(v) => p.onMetric(v as Metric)}
        hint={`Blended = (${p.blendRatio.input}·input + ${p.blendRatio.output}·output) / ${
          p.blendRatio.input + p.blendRatio.output
        }`}
      />

      {(p.tab === "timeline" || p.tab === "decay") && (
        <Segmented
          label="Scale"
          options={[
            { value: "log", label: "Log" },
            { value: "linear", label: "Linear" },
          ]}
          value={p.yScale}
          onChange={(v) => p.onYScale(v as YScaleKind)}
        />
      )}

      {(p.tab === "timeline" || p.tab === "decay") && (
        <DateBrush
          from={p.from}
          to={p.to}
          minDate={p.minDate}
          maxDate={p.maxDate}
          onRange={p.onRange}
        />
      )}

      {/* variants sit outside the succession, so the toggle is meaningless there */}
      {!(p.tab === "timeline" && p.mode === "succession") && (
        <label className="flex cursor-pointer items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input
            type="checkbox"
            checked={p.showVariants}
            onChange={(e) => p.onShowVariants(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Variants
        </label>
      )}

      {p.tab === "ladder" && (
        <label className="flex cursor-pointer items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input
            type="checkbox"
            checked={p.cheaperOnly}
            onChange={(e) => p.onCheaperOnly(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Cheaper handoffs only
        </label>
      )}

      <div className="ml-auto flex items-center gap-3">
        <a
          href={p.exportHref}
          className="text-xs underline underline-offset-2"
          style={{ color: "var(--text-secondary)" }}
          download
        >
          CSV
        </a>
        <ThemeToggle theme={p.theme} onTheme={p.onTheme} />
      </div>
    </div>
  );
}

function DateBrush({
  from,
  to,
  minDate,
  maxDate,
  onRange,
}: {
  from: string | null;
  to: string | null;
  minDate: string;
  maxDate: string;
  onRange: (from: string | null, to: string | null) => void;
}) {
  const custom = from !== null || to !== null;
  return (
    <div className="flex items-center gap-1.5" title="Restrict the visible date window">
      <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        Range
      </span>
      <input
        type="date"
        value={from ?? ""}
        min={minDate}
        max={to ?? maxDate}
        onChange={(e) => onRange(e.target.value || null, to)}
        className="rounded border px-1.5 py-0.5 text-xs"
        style={{ borderColor: "var(--border)", background: "var(--surface-1)", color: "var(--text-primary)" }}
        aria-label="Range start"
      />
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        →
      </span>
      <input
        type="date"
        value={to ?? ""}
        min={from ?? minDate}
        max={maxDate}
        onChange={(e) => onRange(from, e.target.value || null)}
        className="rounded border px-1.5 py-0.5 text-xs"
        style={{ borderColor: "var(--border)", background: "var(--surface-1)", color: "var(--text-primary)" }}
        aria-label="Range end"
      />
      {custom && (
        <button
          type="button"
          onClick={() => onRange(null, null)}
          className="text-[11px] underline underline-offset-2"
          style={{ color: "var(--text-secondary)" }}
        >
          fit
        </button>
      )}
    </div>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-2" title={hint}>
      <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <div
        className="flex overflow-hidden rounded border"
        style={{ borderColor: "var(--border)" }}
        role="group"
        aria-label={label}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={on}
              className="min-h-6 px-2 py-1 text-xs"
              style={{
                background: on ? "var(--text-primary)" : "transparent",
                color: on ? "var(--surface-1)" : "var(--text-secondary)",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ThemeToggle({ theme, onTheme }: { theme: Theme; onTheme: (t: Theme) => void }) {
  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const icon: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };
  return (
    <button
      type="button"
      onClick={() => onTheme(next[theme])}
      className="min-h-6 rounded px-1.5 text-sm"
      style={{ color: "var(--text-secondary)" }}
      title={`Theme: ${theme}`}
      aria-label={`Theme: ${theme}. Click for ${next[theme]}.`}
    >
      {icon[theme]}
    </button>
  );
}
