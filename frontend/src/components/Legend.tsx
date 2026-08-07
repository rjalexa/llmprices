import type { RenderModel } from "../lib/seriesView";

interface Props {
  models: RenderModel[];
  focused: string | null;
  onFocus: (key: string | null) => void;
}

/**
 * Grouped by family so the generational ramp is legible as a ramp: the swatches
 * for one family run light to dark in release order, which is the whole point of
 * the colour system.
 */
export function Legend({ models, focused, onFocus }: Props) {
  const byFamily = new Map<string, RenderModel[]>();
  for (const m of models) {
    const list = byFamily.get(m.familyKey) ?? [];
    list.push(m);
    byFamily.set(m.familyKey, list);
  }

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-3 px-1 py-3">
      {[...byFamily.entries()].map(([key, list]) => {
        const dim = focused !== null && focused !== key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onFocus(focused === key ? null : key)}
            className="text-left"
            style={{ opacity: dim ? 0.4 : 1 }}
            aria-pressed={focused === key}
          >
            <div className="mb-1 text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
              {list[0].familyLabel}
            </div>
            <div className="flex items-center gap-1">
              {list.map((m) => (
                <span
                  key={m.id}
                  title={`${m.name}${m.censored ? " — start date censored" : ""}`}
                  className="h-3 w-5 rounded-sm"
                  style={{
                    background: m.color,
                    outline: m.isVariant ? "1px dashed var(--text-muted)" : undefined,
                    outlineOffset: "-1px",
                  }}
                />
              ))}
              <span className="ml-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                old → new
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
