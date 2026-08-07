import { scaleLinear, scaleLog, scaleUtc } from "d3-scale";
import { parseDay } from "./format";

export type YScaleKind = "log" | "linear";

export interface Plot {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  innerWidth: number;
  innerHeight: number;
}

export function makePlot(
  width: number,
  height: number,
  margin = { top: 16, right: 132, bottom: 34, left: 54 },
): Plot {
  return {
    width,
    height,
    margin,
    innerWidth: Math.max(1, width - margin.left - margin.right),
    innerHeight: Math.max(1, height - margin.top - margin.bottom),
  };
}

export function makeX(from: string, to: string, plot: Plot) {
  return scaleUtc().domain([parseDay(from), parseDay(to)]).range([0, plot.innerWidth]);
}

export function makeY(values: number[], kind: YScaleKind, plot: Plot) {
  const finite = values.filter((v) => Number.isFinite(v) && v > 0);
  const lo = finite.length ? Math.min(...finite) : 0.01;
  const hi = finite.length ? Math.max(...finite) : 100;

  if (kind === "log") {
    // Pad by a multiplicative factor so the padding is even in log space.
    return scaleLog()
      .domain([lo / 1.6, hi * 1.6])
      .range([plot.innerHeight, 0])
      .clamp(true);
  }
  return scaleLinear()
    .domain([0, hi * 1.08])
    .range([plot.innerHeight, 0])
    .nice()
    .clamp(true);
}

/** Log ticks at 1-2-5 per decade, thinned to whatever fits the height. */
export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  const startExp = Math.floor(Math.log10(lo));
  const endExp = Math.ceil(Math.log10(hi));
  for (let e = startExp; e <= endExp; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out;
}
