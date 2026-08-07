import type { RenderModel } from "./seriesView";

export interface ReignSegment {
  model: RenderModel;
  /** first day this member was the family's current model */
  start: string;
  /** last day it was current — its successor's launch, or its own last_seen */
  end: string;
  points: [string, number | null][];
  isCurrent: boolean;
}

/**
 * Reduce a family to its line of succession.
 *
 * Each member "reigns" from its own first priced day until its successor's, so
 * at any date exactly one member per family is on screen. This is what answers
 * "what was the best model from X at time T, what did it cost, and what
 * superseded it" — the full-history view can't, because superseded models keep
 * being served (and priced) long after they stop being the current one.
 */
export function buildSuccession(models: RenderModel[]): ReignSegment[] {
  const byFamily = new Map<string, RenderModel[]>();
  for (const m of models) {
    if (m.isVariant) continue; // variants are side branches, never reigns
    const s = m.series;
    if (!s || !s.first_day || !s.last_day || s.points.length === 0) continue;
    const list = byFamily.get(m.familyKey) ?? [];
    list.push(m);
    byFamily.set(m.familyKey, list);
  }

  const out: ReignSegment[] = [];
  for (const list of byFamily.values()) {
    list.sort((a, b) => a.ordinal - b.ordinal);
    list.forEach((m, i) => {
      const s = m.series!;
      const start = s.first_day!;
      const successorStart = list[i + 1]?.series?.first_day ?? null;
      const end =
        successorStart && successorStart < s.last_day! ? successorStart : s.last_day!;
      if (end < start) return; // successor predates this member entirely

      const points = s.points.filter((p) => p[0] >= start && p[0] <= end);
      if (points.length === 0 || points[0][0] > start) {
        // carry in the value already in force at the reign's start
        let carried: number | null = null;
        for (const p of s.points) {
          if (p[0] > start) break;
          carried = p[1];
        }
        points.unshift([start, carried]);
      }
      out.push({ model: m, start, end, points, isCurrent: i === list.length - 1 });
    });
  }
  return out;
}
