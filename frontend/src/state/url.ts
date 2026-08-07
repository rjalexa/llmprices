import type { Metric } from "../api/client";
import type { AtlasState, Tab, Theme, YScaleKind } from "./useAtlasStore";

/** Selection lives in the query string so a view can be pasted to someone else. */
export function readUrl(): Partial<AtlasState> {
  const p = new URLSearchParams(window.location.search);
  const patch: Partial<AtlasState> = {};

  const fams = p.get("f");
  if (fams) patch.selected = fams.split(",").filter(Boolean);

  const metric = p.get("m");
  if (metric === "prompt" || metric === "completion" || metric === "blended") {
    patch.metric = metric as Metric;
  }
  const scale = p.get("y");
  if (scale === "log" || scale === "linear") patch.yScale = scale as YScaleKind;

  const tab = p.get("v");
  if (tab === "timeline" || tab === "ladder" || tab === "snapshot" || tab === "decay") {
    patch.tab = tab as Tab;
  }
  const mode = p.get("mode");
  if (mode === "succession" || mode === "all") patch.mode = mode;
  const theme = p.get("t");
  if (theme === "light" || theme === "dark" || theme === "system") patch.theme = theme as Theme;

  if (p.get("var") === "1") patch.showVariants = true;
  if (p.get("cheap") === "1") patch.cheaperOnly = true;
  if (p.get("from")) patch.from = p.get("from");
  if (p.get("to")) patch.to = p.get("to");
  if (p.get("d")) patch.snapshotDate = p.get("d");
  if (p.get("focus")) patch.focused = p.get("focus");

  return patch;
}

export function writeUrl(s: AtlasState): void {
  const p = new URLSearchParams();
  if (s.selected.length) p.set("f", s.selected.join(","));
  if (s.metric !== "blended") p.set("m", s.metric);
  if (s.yScale !== "log") p.set("y", s.yScale);
  if (s.tab !== "timeline") p.set("v", s.tab);
  if (s.mode !== "succession") p.set("mode", s.mode);
  if (s.theme !== "system") p.set("t", s.theme);
  if (s.showVariants) p.set("var", "1");
  if (s.cheaperOnly) p.set("cheap", "1");
  if (s.from) p.set("from", s.from);
  if (s.to) p.set("to", s.to);
  if (s.snapshotDate) p.set("d", s.snapshotDate);
  if (s.focused) p.set("focus", s.focused);

  const qs = p.toString();
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", next);
}
