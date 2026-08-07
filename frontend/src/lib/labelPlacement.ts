import { forceCollide, forceSimulation, forceX, forceY } from "d3-force";

export interface LabelInput {
  id: string;
  label: string;
  color: string;
  anchorX: number;
  anchorY: number;
}

export interface PlacedLabel extends LabelInput {
  x: number;
  y: number;
}

/**
 * Parks a set of end-of-line labels at a common x and separates them vertically.
 *
 * The common x is the whole trick: `forceCollide` is a 2D force, so labels left
 * at their own varying x never push each other apart in y and simply overlap.
 * Pinning x with `forceX` reduces the simulation to the 1D problem we have.
 */
export function placeLabels(
  inputs: LabelInput[],
  labelX: number,
  innerHeight: number,
  spacing = 14.4,
): PlacedLabel[] {
  if (inputs.length === 0) return [];

  const nodes = inputs.map((n) => ({ ...n, x: labelX, y: n.anchorY, targetY: n.anchorY }));

  const sim = forceSimulation(nodes as never[])
    .force("x", forceX<never>(labelX).strength(1))
    .force(
      "y",
      forceY<never>((d: never) => (d as unknown as { targetY: number }).targetY).strength(0.55),
    )
    .force("collide", forceCollide(spacing / 2))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();

  return nodes.map((n) => ({
    id: n.id,
    label: n.label,
    color: n.color,
    anchorX: n.anchorX,
    anchorY: n.anchorY,
    x: labelX,
    y: Math.min(Math.max(n.y, 7), innerHeight - 7),
  }));
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
