const DAY_MS = 86_400_000;

/** Ledger days are plain YYYY-MM-DD with no timezone; parse them as UTC so a
 *  negative local offset can't shift a date back by one day. */
export function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return toDay(new Date(parseDay(day).getTime() + n * DAY_MS));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / DAY_MS);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatDay(day: string): string {
  const d = parseDay(day);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatMonth(date: Date): string {
  return date.getUTCMonth() === 0
    ? String(date.getUTCFullYear())
    : MONTHS[date.getUTCMonth()];
}

/** Prices span $0.03 to $75, so significant digits matter more than a fixed
 *  decimal count. */
export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  if (value < 10) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
}

export function formatAxisPrice(value: number): string {
  if (value < 0.01) return `$${value.toFixed(3)}`;
  if (value < 1) return `$${value.toFixed(2)}`;
  return `$${value}`;
}

export function formatDelta(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const rounded = Math.abs(pct) >= 100 ? Math.round(pct) : Number(pct.toFixed(1));
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/** Strips the vendor prefix that every label in a family already shares. */
export function shortName(name: string): string {
  const idx = name.indexOf(": ");
  return idx === -1 ? name : name.slice(idx + 2);
}
