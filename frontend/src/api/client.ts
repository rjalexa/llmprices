import { createStaticApi } from "./staticClient";

export type Metric = "prompt" | "completion" | "blended";

export interface FamilyMember {
  model_id: string;
  name: string;
  ordinal: number;
  is_variant: boolean;
  release_date: string | null;
  first_seen: string;
  last_seen: string;
  present_now: boolean;
  date_is_censored: boolean;
}

export interface Family {
  key: string;
  label: string;
  vendor: string;
  group: string;
  members: FamilyMember[];
  variants: FamilyMember[];
}

export interface FamiliesResponse {
  families: Family[];
  blend_ratio: { input: number; output: number };
  window: { from: string | null; to: string | null };
}

export interface Series {
  model_id: string;
  points: [string, number | null][];
  first_day: string | null;
  last_day: string | null;
  encoding: string;
}

export interface SeriesResponse {
  metric: Metric;
  series: Series[];
}

export type Direction = "cheaper" | "pricier" | "flat" | "unknown";

export type HandoffKind = "succession" | "fork";

export interface Handoff {
  family_key: string;
  prev_id: string;
  next_id: string;
  prev_name: string;
  next_name: string;
  launch_date: string;
  prev_price: Record<Metric, number | null>;
  next_price: Record<Metric, number | null>;
  delta_pct: Record<Metric, number | null>;
  direction: Record<Metric, Direction>;
  /** succession = the next generation of one line; fork = a tier branching off */
  kind: HandoffKind;
}

export interface SnapshotRow {
  model_id: string;
  name: string;
  vendor: string;
  live: boolean;
  prompt: number | null;
  completion: number | null;
  blended: number | null;
}

export interface Health {
  status: string;
  ledger_as_of: string | null;
  last_ingest: string | null;
  model_count: number;
}

export interface AtlasApi {
  health: () => Promise<Health>;
  families: () => Promise<FamiliesResponse>;
  series: (
    ids: string[],
    metric: Metric,
    from?: string,
    to?: string,
  ) => Promise<SeriesResponse>;
  releases: (family?: string) => Promise<{ handoffs: Handoff[] }>;
  snapshot: (date: string, ids?: string[]) => Promise<{ date: string; rows: SnapshotRow[] }>;
  exportUrl: (ids: string[], metric: Metric, dense?: boolean) => string;
}

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  return res.json() as Promise<T>;
}

const liveApi: AtlasApi = {
  health: () => get<Health>("/api/health"),
  families: () => get<FamiliesResponse>("/api/families"),
  series: (ids: string[], metric: Metric, from?: string, to?: string) =>
    get<SeriesResponse>("/api/series", { ids: ids.join(","), metric, from, to }),
  releases: (family?: string) =>
    get<{ handoffs: Handoff[] }>("/api/releases", { family }),
  snapshot: (date: string, ids?: string[]) =>
    get<{ date: string; rows: SnapshotRow[] }>("/api/snapshot", {
      date,
      ids: ids?.length ? ids.join(",") : undefined,
    }),
  exportUrl: (ids: string[], metric: Metric, dense = false) => {
    const p = new URLSearchParams({ metric });
    if (ids.length) p.set("ids", ids.join(","));
    if (dense) p.set("dense", "true");
    return `${BASE}/api/export.csv?${p}`;
  },
};

/**
 * Static builds (GitHub Pages) have no backend, so they read one baked JSON
 * file instead and do the series work in the browser. Everything above this
 * line is the self-hosted path; the UI can't tell the difference.
 */
const STATIC_DATA = import.meta.env.VITE_STATIC_DATA === "1";

export const api: AtlasApi = STATIC_DATA
  ? createStaticApi(`${import.meta.env.BASE_URL}atlas.json`)
  : liveApi;

export const isStatic = STATIC_DATA;
