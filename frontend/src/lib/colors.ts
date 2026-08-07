import { hcl } from "d3-color";
import { interpolateHcl } from "d3-interpolate";

/**
 * Two-level colour system.
 *
 *  - A family owns one **hue**, taken from the eight validated categorical slots.
 *  - A member's **lightness** steps along that hue by generation, so reading a
 *    family left to right you watch it darken as generations advance.
 *
 * The eight slots are a fixed, validated order (worst adjacent CVD ΔE 9.1 light
 * / 8.4 dark). There is no ninth: families past the cap are not given a
 * generated hue, they simply cannot be selected at once.
 */
export const SLOT_COUNT = 8;

const LIGHT_SLOTS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
];

const DARK_SLOTS = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];

export function slotColor(slot: number, dark: boolean): string {
  const slots = dark ? DARK_SLOTS : LIGHT_SLOTS;
  return slots[((slot % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT];
}

/**
 * Generational ramp within one family.
 *
 * Interpolating in HCL keeps the lightness steps perceptually even regardless of
 * how many members a family has — a 2-member family and an 8-member one both
 * read as "light -> dark" at the same pace.
 *
 * The pale end is floored so the oldest generation still separates from the
 * surface (the ordinal-ramp rule: the step nearest the surface clears 2:1).
 */
export function generationRamp(base: string, count: number, dark: boolean): string[] {
  const anchor = hcl(base);
  const pale = hcl(anchor.h, Math.max(anchor.c * 0.55, 18), dark ? 42 : 78);
  const deep = hcl(anchor.h, anchor.c, dark ? 82 : Math.max(anchor.l - 8, 30));

  if (count <= 1) return [anchor.formatHex()];

  const interpolate = interpolateHcl(pale.formatHex(), deep.formatHex());
  return Array.from({ length: count }, (_, i) => interpolate(i / (count - 1)));
}

/** Variants share the family hue but are desaturated: they sit outside the
 *  generational sequence and must not compete with it. */
export function variantColor(base: string, dark: boolean): string {
  const c = hcl(base);
  return hcl(c.h, c.c * 0.35, dark ? 60 : 68).formatHex();
}

export const DIRECTION_COLOR: Record<string, string> = {
  cheaper: "var(--good)",
  pricier: "var(--warning)",
  flat: "var(--text-muted)",
  unknown: "var(--text-muted)",
};
