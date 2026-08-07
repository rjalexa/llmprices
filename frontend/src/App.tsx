import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, isStatic, type Family, type Series } from "./api/client";
import { Controls } from "./components/Controls";
import { DecayView } from "./components/DecayView";
import { FamilyPicker } from "./components/FamilyPicker";
import { Footer } from "./components/Footer";
import { LadderView } from "./components/LadderView";
import { Legend } from "./components/Legend";
import { PriceTimeline } from "./components/PriceTimeline";
import { RefreshButton } from "./components/RefreshButton";
import { SuccessionTimeline } from "./components/SuccessionTimeline";
import { SnapshotTable } from "./components/SnapshotTable";
import { buildRenderModels } from "./lib/seriesView";
import { useAtlasStore } from "./state/useAtlasStore";
import { readUrl, writeUrl } from "./state/url";

/**
 * The opening view answers the canonical question directly: each major vendor's
 * flagship line — who was the best model, what it cost, what superseded it.
 *
 * The tier families that the flagships fan out into (GPT Terra, OpenAI mini,
 * Claude Fable) are included so the fork brackets connect to real lines rather
 * than pointing at nothing.
 */
const DEFAULT_FAMILIES = [
  "openai-flagship",
  "anthropic-opus",
  "google-pro",
  "mistral-large",
];

const METRIC_LABEL: Record<string, string> = {
  prompt: "input $/M",
  completion: "output $/M",
  blended: "blended $/M",
};

export function App() {
  const store = useAtlasStore();
  const [hydrated, setHydrated] = useState(false);

  const familiesQ = useQuery({ queryKey: ["families"], queryFn: api.families });
  const healthQ = useQuery({ queryKey: ["health"], queryFn: api.health });

  const dark = useIsDark(store.theme);

  // URL -> store, once, before anything else selects a default.
  useEffect(() => {
    const patch = readUrl();
    if (patch.selected?.length) {
      const { selected, ...rest } = patch;
      useAtlasStore.getState().hydrate(rest);
      useAtlasStore.getState().setSelected(selected);
    } else {
      useAtlasStore.getState().hydrate(patch);
    }
    setHydrated(true);
  }, []);

  // Seed the default selection only when the URL carried none, and only ONCE.
  // Without the ref this re-fires every time the selection reaches zero, so
  // deselecting your last family (or pressing "clear") silently re-adds all the
  // defaults — which reads as "deselecting one thing changed everything else".
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !hydrated || !familiesQ.data) return;
    seeded.current = true;
    if (useAtlasStore.getState().selected.length > 0) return;
    const keys = new Set(familiesQ.data.families.map((f) => f.key));
    useAtlasStore.getState().setSelected(DEFAULT_FAMILIES.filter((k) => keys.has(k)));
  }, [hydrated, familiesQ.data]);

  useEffect(() => {
    if (hydrated) writeUrl(useAtlasStore.getState());
  });

  useEffect(() => {
    const root = document.documentElement;
    if (store.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", store.theme);
  }, [store.theme]);

  const selectedFamilies: Family[] = useMemo(
    () => (familiesQ.data?.families ?? []).filter((f) => store.selected.includes(f.key)),
    [familiesQ.data, store.selected],
  );

  const modelIds = useMemo(() => {
    const ids: string[] = [];
    for (const f of selectedFamilies) {
      ids.push(...f.members.map((m) => m.model_id));
      if (store.showVariants) ids.push(...f.variants.map((m) => m.model_id));
    }
    return ids;
  }, [selectedFamilies, store.showVariants]);

  const seriesQ = useQuery({
    queryKey: ["series", modelIds, store.metric, store.from, store.to],
    queryFn: () => api.series(modelIds, store.metric, store.from ?? undefined, store.to ?? undefined),
    enabled: modelIds.length > 0,
    placeholderData: (prev) => prev, // hold the previous render — no skeleton flash
  });

  const releasesQ = useQuery({
    queryKey: ["releases"],
    queryFn: () => api.releases(),
  });

  const window_ = familiesQ.data?.window;
  const minDate = window_?.from ?? "2024-09-21";
  const maxDate = window_?.to ?? "2026-08-06";
  const snapshotDate = store.snapshotDate ?? maxDate;

  const snapshotQ = useQuery({
    queryKey: ["snapshot", snapshotDate, modelIds],
    queryFn: () => api.snapshot(snapshotDate, modelIds),
    enabled: store.tab === "snapshot" && modelIds.length > 0,
    placeholderData: (prev) => prev,
  });

  const seriesById = useMemo(() => {
    const map = new Map<string, Series>();
    for (const s of seriesQ.data?.series ?? []) map.set(s.model_id, s);
    return map;
  }, [seriesQ.data]);

  const renderModels = useMemo(
    () => buildRenderModels(selectedFamilies, store.slots, seriesById, dark, store.showVariants),
    [selectedFamilies, store.slots, seriesById, dark, store.showVariants],
  );

  const handoffs = useMemo(() => {
    const keys = new Set(store.selected);
    return (releasesQ.data?.handoffs ?? []).filter((h) => keys.has(h.family_key));
  }, [releasesQ.data, store.selected]);

  // Default the x-domain to the selection's own extent. Pinning it to the full
  // ledger window leaves half the canvas empty whenever the chosen families all
  // launched late; an explicit brush still overrides.
  const dataExtent = useMemo(() => {
    let lo: string | null = null;
    let hi: string | null = null;
    for (const m of renderModels) {
      const s = m.series;
      if (!s?.first_day || !s.last_day) continue;
      if (!lo || s.first_day < lo) lo = s.first_day;
      if (!hi || s.last_day > hi) hi = s.last_day;
    }
    return { from: lo ?? minDate, to: hi ?? maxDate };
  }, [renderModels, minDate, maxDate]);

  const censoredCount = renderModels.filter((m) => m.censored).length;
  const error = familiesQ.error ?? seriesQ.error ?? releasesQ.error;

  return (
    <div className="flex min-h-full flex-col">
      <header
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3"
        style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
      >
        <h1 className="text-base font-semibold">LLM Price Atlas</h1>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          What each generation cost when it shipped — and what happened to the price afterwards.
        </p>
        <span className="ml-auto flex items-center gap-3">
          <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {healthQ.data?.model_count ?? 0} models · ledger {healthQ.data?.ledger_as_of ?? "—"}
          </span>
          {/* a static build has no backend to re-ingest; its data is baked at
              build time and refreshed by the scheduled deploy */}
          {!isStatic && <RefreshButton />}
        </span>
      </header>

      <Controls
        tab={store.tab}
        mode={store.mode}
        metric={store.metric}
        yScale={store.yScale}
        showVariants={store.showVariants}
        cheaperOnly={store.cheaperOnly}
        theme={store.theme}
        blendRatio={familiesQ.data?.blend_ratio ?? { input: 3, output: 1 }}
        exportHref={api.exportUrl(modelIds, store.metric)}
        from={store.from}
        to={store.to}
        minDate={minDate}
        maxDate={maxDate}
        onRange={store.setRange}
        onTab={store.setTab}
        onMode={store.setMode}
        onMetric={store.setMetric}
        onYScale={store.setYScale}
        onShowVariants={store.setShowVariants}
        onCheaperOnly={store.setCheaperOnly}
        onTheme={store.setTheme}
      />

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* the roster is taller than the viewport, so it scrolls on its own
            rather than pushing the chart down the page */}
        <aside
          className="shrink-0 border-b p-4 lg:sticky lg:top-0 lg:max-h-screen lg:w-60 lg:overflow-y-auto lg:border-b-0 lg:border-r"
          style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
        >
          {familiesQ.data && (
            <FamilyPicker
              families={familiesQ.data.families}
              selected={store.selected}
              slots={store.slots}
              focused={store.focused}
              dark={dark}
              notice={store.notice}
              onToggle={store.toggleFamily}
              onToggleMany={store.toggleMany}
              onFocus={store.setFocused}
              onClear={store.clearSelection}
              onDismissNotice={store.dismissNotice}
            />
          )}
        </aside>

        <main className="min-w-0 flex-1">
          {error && (
            <div
              className="m-4 rounded border p-4 text-sm"
              style={{ borderColor: "var(--critical)", color: "var(--text-primary)" }}
            >
              <p className="font-medium">Could not load the atlas.</p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                {String(error)}
              </p>
              <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                If the database is empty, run <code>docker compose --profile ingest up ingest</code>.
              </p>
            </div>
          )}

          {!error && familiesQ.isLoading && <Muted>Loading the roster…</Muted>}

          {!error && familiesQ.data && store.selected.length === 0 && (
            <Muted>Pick a family on the left to begin.</Muted>
          )}

          {!error && store.selected.length > 0 && (
            <div style={{ opacity: seriesQ.isFetching ? 0.6 : 1 }}>
              {store.tab === "timeline" && (
                <div className="p-4">
                  {store.mode === "succession" ? (
                    <SuccessionTimeline
                      models={renderModels}
                      handoffs={handoffs}
                      metric={store.metric}
                      metricLabel={METRIC_LABEL[store.metric]}
                      yScale={store.yScale}
                      from={store.from ?? dataExtent.from}
                      to={store.to ?? dataExtent.to}
                      focused={store.focused}
                      onFocusFamily={store.setFocused}
                    />
                  ) : (
                    <PriceTimeline
                      models={renderModels}
                      handoffs={handoffs}
                      metric={store.metric}
                      metricLabel={METRIC_LABEL[store.metric]}
                      yScale={store.yScale}
                      from={store.from ?? dataExtent.from}
                      to={store.to ?? dataExtent.to}
                      focused={store.focused}
                      onFocusFamily={store.setFocused}
                    />
                  )}
                  <Legend models={renderModels} focused={store.focused} onFocus={store.setFocused} />
                </div>
              )}

              {store.tab === "ladder" && familiesQ.data && (
                <LadderView
                  families={selectedFamilies}
                  slots={store.slots}
                  handoffs={handoffs}
                  metric={store.metric}
                  dark={dark}
                  cheaperOnly={store.cheaperOnly}
                  onFocus={(k) => {
                    store.setFocused(k);
                    store.setTab("timeline");
                  }}
                />
              )}

              {store.tab === "snapshot" && (
                <SnapshotTable
                  rows={snapshotQ.data?.rows ?? []}
                  models={renderModels}
                  date={snapshotDate}
                  minDate={minDate}
                  maxDate={maxDate}
                  metric={store.metric}
                  onDate={store.setSnapshotDate}
                />
              )}

              {store.tab === "decay" && (
                <DecayView models={renderModels} focused={store.focused} onFocus={store.setFocused} />
              )}
            </div>
          )}
        </main>
      </div>

      <Footer ledgerAsOf={healthQ.data?.ledger_as_of ?? null} censoredCount={censoredCount} />
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="p-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
      {children}
    </p>
  );
}

/** Resolves "system" against the OS preference, and tracks changes to it. */
function useIsDark(theme: string): boolean {
  const [systemDark, setSystemDark] = useState(
    () => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  useEffect(() => {
    const mq = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return theme === "dark" || (theme === "system" && systemDark);
}
