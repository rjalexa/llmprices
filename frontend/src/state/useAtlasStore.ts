import { create } from "zustand";
import type { Metric } from "../api/client";
import { SLOT_COUNT } from "../lib/colors";

export type Tab = "timeline" | "ladder" | "snapshot" | "decay";
export type Theme = "light" | "dark" | "system";
export type YScaleKind = "log" | "linear";
/** succession = one line per family (the reigning model); all = every model's full history */
export type LineMode = "succession" | "all";

export interface AtlasState {
  selected: string[];
  /** familyKey -> categorical slot. Held for as long as the family is selected,
   *  so filtering never repaints the survivors. */
  slots: Record<string, number>;
  focused: string | null;
  metric: Metric;
  yScale: YScaleKind;
  tab: Tab;
  mode: LineMode;
  showVariants: boolean;
  cheaperOnly: boolean;
  from: string | null;
  to: string | null;
  snapshotDate: string | null;
  theme: Theme;
  /** why the last action couldn't be carried out in full; null when it could */
  notice: string | null;

  toggleFamily: (key: string) => void;
  setSelected: (keys: string[]) => void;
  /** Select all of `keys`, or deselect them if every one is already on. */
  toggleMany: (keys: string[], label: string) => void;
  clearSelection: () => void;
  dismissNotice: () => void;
  setFocused: (key: string | null) => void;
  setMetric: (m: Metric) => void;
  setYScale: (s: YScaleKind) => void;
  setTab: (t: Tab) => void;
  setMode: (m: LineMode) => void;
  setShowVariants: (v: boolean) => void;
  setCheaperOnly: (v: boolean) => void;
  setRange: (from: string | null, to: string | null) => void;
  setSnapshotDate: (d: string | null) => void;
  setTheme: (t: Theme) => void;
  hydrate: (patch: Partial<AtlasState>) => void;
}

export const MAX_FAMILIES = SLOT_COUNT;

/** Lowest slot not currently held. Returns -1 when the palette is exhausted —
 *  there is no ninth hue, so the selection is refused instead. */
function freeSlot(slots: Record<string, number>): number {
  const taken = new Set(Object.values(slots));
  for (let i = 0; i < SLOT_COUNT; i++) if (!taken.has(i)) return i;
  return -1;
}

function assign(slots: Record<string, number>, key: string): Record<string, number> {
  if (key in slots) return slots;
  const slot = freeSlot(slots);
  return slot === -1 ? slots : { ...slots, [key]: slot };
}

function release(slots: Record<string, number>, key: string): Record<string, number> {
  const next = { ...slots };
  delete next[key];
  return next;
}

export const useAtlasStore = create<AtlasState>((set) => ({
  selected: [],
  slots: {},
  focused: null,
  metric: "blended",
  yScale: "log",
  tab: "timeline",
  mode: "succession",
  showVariants: false,
  cheaperOnly: false,
  from: null,
  to: null,
  snapshotDate: null,
  theme: "system",
  notice: null,

  toggleFamily: (key) =>
    set((s) => {
      if (s.selected.includes(key)) {
        return {
          selected: s.selected.filter((k) => k !== key),
          slots: release(s.slots, key),
          focused: s.focused === key ? null : s.focused,
          notice: null,
        };
      }
      if (s.selected.length >= MAX_FAMILIES) {
        // Refuse loudly. Silently doing nothing reads as a broken button.
        return { notice: `${MAX_FAMILIES} families is the colour limit — deselect one first.` };
      }
      return { selected: [...s.selected, key], slots: assign(s.slots, key), notice: null };
    }),

  setSelected: (keys) =>
    set(() => {
      const capped = keys.slice(0, MAX_FAMILIES);
      let slots: Record<string, number> = {};
      for (const k of capped) slots = assign(slots, k);
      return { selected: capped, slots, notice: null };
    }),

  toggleMany: (keys, label) =>
    set((s) => {
      const allOn = keys.length > 0 && keys.every((k) => s.selected.includes(k));
      if (allOn) {
        let slots = { ...s.slots };
        for (const k of keys) slots = release(slots, k);
        return {
          selected: s.selected.filter((k) => !keys.includes(k)),
          slots,
          focused: s.focused && keys.includes(s.focused) ? null : s.focused,
          notice: null,
        };
      }

      const selected = [...s.selected];
      let slots = { ...s.slots };
      let skipped = 0;
      for (const k of keys) {
        if (selected.includes(k)) continue;
        if (selected.length >= MAX_FAMILIES) {
          skipped++;
          continue;
        }
        selected.push(k);
        slots = assign(slots, k);
      }
      return {
        selected,
        slots,
        // Partial success is still a refusal — say which part didn't fit.
        notice: skipped
          ? `Added what fits; ${skipped} more from ${label} need free slots (limit ${MAX_FAMILIES}).`
          : null,
      };
    }),

  clearSelection: () => set({ selected: [], slots: {}, focused: null, notice: null }),
  dismissNotice: () => set({ notice: null }),
  setFocused: (key) => set({ focused: key }),
  setMetric: (metric) => set({ metric }),
  setYScale: (yScale) => set({ yScale }),
  setTab: (tab) => set({ tab }),
  setMode: (mode) => set({ mode }),
  setShowVariants: (showVariants) => set({ showVariants }),
  setCheaperOnly: (cheaperOnly) => set({ cheaperOnly }),
  setRange: (from, to) => set({ from, to }),
  setSnapshotDate: (snapshotDate) => set({ snapshotDate }),
  setTheme: (theme) => set({ theme }),
  hydrate: (patch) => set(patch),
}));
