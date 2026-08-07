import { useMemo } from "react";
import type { Family } from "../api/client";
import { slotColor } from "../lib/colors";
import { MAX_FAMILIES } from "../state/useAtlasStore";

const GROUP_LABEL: Record<string, string> = {
  "frontier-us": "US frontier",
  china: "China",
  eu: "EU",
};

interface Props {
  families: Family[];
  selected: string[];
  slots: Record<string, number>;
  focused: string | null;
  dark: boolean;
  notice: string | null;
  onToggle: (key: string) => void;
  onToggleMany: (keys: string[], label: string) => void;
  onFocus: (key: string | null) => void;
  onClear: () => void;
  onDismissNotice: () => void;
}

type Selection = "none" | "some" | "all";

function selectionOf(keys: string[], selected: string[]): Selection {
  const on = keys.filter((k) => selected.includes(k)).length;
  return on === 0 ? "none" : on === keys.length ? "all" : "some";
}

/**
 * Region -> vendor -> family. Every level is clickable: the vendor row selects
 * or deselects that whole vendor at once, which is how people actually think
 * about this ("show me OpenAI", not "show me these four lineages").
 */
export function FamilyPicker({
  families,
  selected,
  slots,
  focused,
  dark,
  notice,
  onToggle,
  onToggleMany,
  onFocus,
  onClear,
  onDismissNotice,
}: Props) {
  // region -> vendor -> families, preserving the roster's order throughout
  const tree = useMemo(() => {
    const byGroup = new Map<string, Map<string, Family[]>>();
    for (const f of families) {
      const vendors = byGroup.get(f.group) ?? new Map<string, Family[]>();
      const list = vendors.get(f.vendor) ?? [];
      list.push(f);
      vendors.set(f.vendor, list);
      byGroup.set(f.group, vendors);
    }
    return byGroup;
  }, [families]);

  const atCap = selected.length >= MAX_FAMILIES;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--text-muted)" }}
        >
          Families
        </h2>
        <div className="flex items-baseline gap-2">
          {/* the colour budget, always visible — the cap should never be a surprise */}
          <span
            className="text-[11px] tabular-nums"
            style={{ color: atCap ? "var(--warning)" : "var(--text-muted)" }}
            title={`${MAX_FAMILIES} distinguishable colours`}
          >
            {selected.length}/{MAX_FAMILIES}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="text-xs underline underline-offset-2 disabled:opacity-40"
            style={{ color: "var(--text-secondary)" }}
            disabled={selected.length === 0}
          >
            clear
          </button>
        </div>
      </div>

      {notice && (
        <button
          type="button"
          onClick={onDismissNotice}
          className="w-full rounded border px-2 py-1.5 text-left text-[11px] leading-snug"
          style={{ borderColor: "var(--warning)", color: "var(--text-secondary)" }}
        >
          {notice}
        </button>
      )}

      {[...tree.entries()].map(([group, vendors]) => {
        const groupKeys = [...vendors.values()].flat().map((f) => f.key);
        const groupState = selectionOf(groupKeys, selected);
        return (
          <div key={group}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span
                className="text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                {GROUP_LABEL[group] ?? group}
              </span>
              <button
                type="button"
                onClick={() => onToggleMany(groupKeys, GROUP_LABEL[group] ?? group)}
                className="text-[11px] underline underline-offset-2"
                style={{ color: "var(--text-muted)" }}
              >
                {groupState === "all" ? "none" : "all"}
              </button>
            </div>

            <ul className="space-y-1.5">
              {[...vendors.entries()].map(([vendor, list]) => {
                const keys = list.map((f) => f.key);
                const state = selectionOf(keys, selected);
                const modelCount = list.reduce((n, f) => n + f.members.length, 0);
                return (
                  <li key={vendor}>
                    <button
                      type="button"
                      onClick={() => onToggleMany(keys, vendor)}
                      className="flex min-h-6 w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs font-medium"
                      style={{ color: "var(--text-primary)" }}
                      aria-pressed={state === "all"}
                      title={`Select or deselect all ${list.length} ${vendor} lineages`}
                    >
                      <TriState state={state} />
                      <span className="truncate">{vendor}</span>
                      <span
                        className="ml-auto shrink-0 tabular-nums text-[10px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {modelCount}
                      </span>
                    </button>

                    <ul className="ml-3 border-l pl-2" style={{ borderColor: "var(--border)" }}>
                      {list.map((f) => {
                        const on = selected.includes(f.key);
                        const slot = slots[f.key];
                        const color =
                          slot === undefined ? "var(--text-muted)" : slotColor(slot, dark);
                        const isFocused = focused === f.key;
                        return (
                          <li key={f.key}>
                            <div
                              className="flex items-center gap-1 rounded px-1 py-0.5 text-sm"
                              style={{ background: isFocused ? "var(--gridline)" : undefined }}
                            >
                              <button
                                type="button"
                                onClick={() => onToggle(f.key)}
                                className="flex min-h-6 min-w-0 flex-1 items-center gap-2 text-left"
                                aria-pressed={on}
                              >
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{
                                    background: on ? color : "transparent",
                                    boxShadow: on
                                      ? undefined
                                      : "inset 0 0 0 1.5px var(--baseline)",
                                  }}
                                  aria-hidden="true"
                                />
                                <span
                                  className="truncate"
                                  style={{
                                    color: on ? "var(--text-primary)" : "var(--text-secondary)",
                                    opacity: !on && atCap ? 0.55 : 1,
                                  }}
                                >
                                  {f.label}
                                </span>
                                <span
                                  className="ml-auto shrink-0 tabular-nums text-[11px]"
                                  style={{ color: "var(--text-muted)" }}
                                >
                                  {f.members.length}
                                </span>
                              </button>
                              {on && (
                                <button
                                  type="button"
                                  onClick={() => onFocus(isFocused ? null : f.key)}
                                  className="shrink-0 rounded px-1 text-[11px]"
                                  style={{
                                    color: isFocused
                                      ? "var(--text-primary)"
                                      : "var(--text-muted)",
                                  }}
                                  aria-pressed={isFocused}
                                  title="Isolate this lineage and show its labels"
                                >
                                  {isFocused ? "◉" : "○"}
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function TriState({ state }: { state: Selection }) {
  return (
    <span
      className="flex h-3 w-3 shrink-0 items-center justify-center rounded-sm"
      style={{
        boxShadow: "inset 0 0 0 1.5px var(--baseline)",
        background: state === "all" ? "var(--text-primary)" : "transparent",
      }}
      aria-hidden="true"
    >
      {state === "all" && (
        <svg viewBox="0 0 10 10" className="h-2 w-2">
          <path
            d="M1.5 5.2 L4 7.5 L8.5 2.5"
            fill="none"
            stroke="var(--surface-1)"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {state === "some" && (
        <span className="h-[2px] w-1.5 rounded" style={{ background: "var(--text-primary)" }} />
      )}
    </span>
  );
}
