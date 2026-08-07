import type {
  AtlasApi,
  FamiliesResponse,
  Family,
  Handoff,
  Health,
  Metric,
  Series,
  SeriesResponse,
  SnapshotRow,
} from "./client";

/** One change point: [day, prompt $/M, completion $/M] */
type RawPoint = [string, number | null, number | null];

interface RawModel {
  name: string;
  vendor: string;
  first_day: string;
  last_day: string;
  present_now: boolean;
  points: RawPoint[];
}

interface Payload {
  generated_at: string;
  ledger_as_of: string | null;
  last_ingest: string | null;
  model_count: number;
  blend_ratio: { input: number; output: number };
  window: { from: string | null; to: string | null };
  families: Family[];
  handoffs: Handoff[];
  models: Record<string, RawModel>;
}

/**
 * The API surface, served entirely from one baked JSON file.
 *
 * GitHub Pages has no backend, so the forward-fill, window clipping and metric
 * blending that `series.py` does server-side happen here instead. The rules must
 * match the backend exactly — same left/right clip, same carried-in vertex, same
 * blend — or the hosted build would tell a different story from the self-hosted
 * one.
 */
export function createStaticApi(url: string): AtlasApi {
  let cache: Promise<Payload> | null = null;
  // `exportUrl` has to be synchronous (it fills an href during render), so the
  // resolved payload is kept alongside the promise.
  let resolved: Payload | null = null;

  const load = () =>
    (cache ??= fetch(url).then((r) => {
      if (!r.ok) throw new Error(`could not load ${url}: ${r.status} ${r.statusText}`);
      return r.json().then((p: Payload) => (resolved = p));
    }));

  const ratio = (p: Payload): [number, number] => [p.blend_ratio.input, p.blend_ratio.output];

  return {
    health: async () => {
      const p = await load();
      return {
        status: "ok",
        ledger_as_of: p.ledger_as_of,
        last_ingest: p.last_ingest,
        model_count: p.model_count,
      } satisfies Health;
    },

    families: async () => {
      const p = await load();
      return {
        families: p.families,
        blend_ratio: p.blend_ratio,
        window: p.window,
      } satisfies FamiliesResponse;
    },

    releases: async (family?: string) => {
      const p = await load();
      return {
        handoffs: family ? p.handoffs.filter((h) => h.family_key === family) : p.handoffs,
      };
    },

    series: async (ids, metric, from, to) => {
      const p = await load();
      return {
        metric,
        series: ids
          .filter((id) => p.models[id])
          .map((id) => buildSeries(id, p.models[id], metric, ratio(p), from, to)),
      } satisfies SeriesResponse;
    },

    snapshot: async (date, ids) => {
      const p = await load();
      const wanted = ids?.length ? ids : Object.keys(p.models);
      const rows: SnapshotRow[] = [];
      for (const id of wanted) {
        const m = p.models[id];
        if (!m) continue;
        const live = m.first_day <= date && date <= m.last_day;
        const current = live ? pointOn(m.points, date) : null;
        rows.push({
          model_id: id,
          name: m.name,
          vendor: m.vendor,
          live: live && current !== null,
          prompt: current?.[1] ?? null,
          completion: current?.[2] ?? null,
          blended: current ? blend(current[1], current[2], ratio(p)) : null,
        });
      }
      rows.sort((a, b) => a.model_id.localeCompare(b.model_id));
      return { date, rows };
    },

    // No streaming endpoint to hit, so the CSV is built here and handed over as
    // a data URL — stateless, so re-rendering can't leak object URLs.
    exportUrl: (ids, metric) => {
      if (!resolved) return "";
      const p = resolved;
      const wanted = ids.length ? ids : Object.keys(p.models);
      const lines = ["model_id,name,vendor,day," + metric];
      for (const id of wanted) {
        const m = p.models[id];
        if (!m) continue;
        const s = buildSeries(id, m, metric, ratio(p), undefined, undefined);
        for (const [day, value] of s.points) {
          lines.push(
            [id, csvCell(m.name), m.vendor, day, value == null ? "" : value].join(","),
          );
        }
      }
      return `data:text/csv;charset=utf-8,${encodeURIComponent(lines.join("\n"))}`;
    },
  };
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function blend(
  prompt: number | null,
  completion: number | null,
  [wIn, wOut]: [number, number],
): number | null {
  if (prompt == null || completion == null) return null;
  return (wIn * prompt + wOut * completion) / (wIn + wOut);
}

function pick(p: RawPoint, metric: Metric, ratio: [number, number]): number | null {
  if (metric === "prompt") return p[1];
  if (metric === "completion") return p[2];
  return blend(p[1], p[2], ratio);
}

/** The last change point at or before `day`; null before the first one. */
function pointOn(points: RawPoint[], day: string): RawPoint | null {
  let current: RawPoint | null = null;
  for (const p of points) {
    if (p[0] > day) break;
    current = p;
  }
  return current;
}

function buildSeries(
  id: string,
  m: RawModel,
  metric: Metric,
  ratio: [number, number],
  from?: string,
  to?: string,
): Series {
  const start = from && from > m.first_day ? from : m.first_day;
  const end = to && to < m.last_day ? to : m.last_day;
  if (start > end) return { model_id: id, points: [], first_day: null, last_day: null, encoding: "step-after" };

  const inside = m.points.filter((p) => p[0] >= start && p[0] <= end);
  const out: [string, number | null][] = [];
  // Carry in whatever was in force at the window's start, so a model whose price
  // never moved still gets a vertex to draw from.
  if (inside.length === 0 || inside[0][0] > start) {
    const carried = pointOn(m.points, start);
    out.push([start, carried ? pick(carried, metric, ratio) : null]);
  }
  for (const p of inside) out.push([p[0], pick(p, metric, ratio)]);

  return { model_id: id, points: out, first_day: start, last_day: end, encoding: "step-after" };
}
