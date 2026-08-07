import type { Family, FamilyMember, Series } from "../api/client";
import { generationRamp, slotColor, variantColor } from "./colors";

export interface RenderModel {
  id: string;
  name: string;
  shortLabel: string;
  familyKey: string;
  familyLabel: string;
  ordinal: number;
  isVariant: boolean;
  color: string;
  censored: boolean;
  presentNow: boolean;
  releaseDate: string | null;
  series: Series | null;
}

/** Forward-fill: the value in force on `day` is the last vertex at or before it. */
export function valueOn(series: Series | null, day: string): number | null {
  if (!series || !series.points.length) return null;
  if (series.first_day && day < series.first_day) return null;
  if (series.last_day && day > series.last_day) return null;
  let current: number | null = null;
  for (const [d, v] of series.points) {
    if (d > day) break;
    current = v;
  }
  return current;
}

export function lastValue(series: Series | null): number | null {
  if (!series || !series.points.length) return null;
  return series.points[series.points.length - 1][1];
}

/**
 * Flattens the selected families into drawable models, assigning each member its
 * colour: the family's hue from its held slot, stepped by generation.
 */
export function buildRenderModels(
  families: Family[],
  slots: Record<string, number>,
  seriesById: Map<string, Series>,
  dark: boolean,
  showVariants: boolean,
): RenderModel[] {
  const out: RenderModel[] = [];

  for (const family of families) {
    const slot = slots[family.key];
    if (slot === undefined) continue;
    const base = slotColor(slot, dark);
    const ramp = generationRamp(base, family.members.length, dark);

    const push = (member: FamilyMember, color: string) =>
      out.push({
        id: member.model_id,
        name: member.name,
        shortLabel: member.name.includes(": ")
          ? member.name.slice(member.name.indexOf(": ") + 2)
          : member.name,
        familyKey: family.key,
        familyLabel: family.label,
        ordinal: member.ordinal,
        isVariant: member.is_variant,
        color,
        censored: member.date_is_censored,
        presentNow: member.present_now,
        releaseDate: member.release_date,
        series: seriesById.get(member.model_id) ?? null,
      });

    family.members.forEach((m, i) => push(m, ramp[i] ?? base));
    if (showVariants) family.variants.forEach((m) => push(m, variantColor(base, dark)));
  }

  return out;
}

/** Every finite value on screen — the y-domain source. */
export function domainValues(models: RenderModel[]): number[] {
  const out: number[] = [];
  for (const m of models) {
    for (const [, v] of m.series?.points ?? []) {
      if (v != null && Number.isFinite(v) && v > 0) out.push(v);
    }
  }
  return out;
}
