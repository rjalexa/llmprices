import { beforeEach, describe, expect, it } from "vitest";
import { MAX_FAMILIES, useAtlasStore } from "./useAtlasStore";

const initial = useAtlasStore.getState();
const s = () => useAtlasStore.getState();

beforeEach(() => {
  useAtlasStore.setState(initial, true);
});

describe("toggling one family leaves every other one alone", () => {
  it("keeps the other selections and their colour slots on deselect", () => {
    s().setSelected(["a", "b", "c"]);
    const before = { ...s().slots };

    s().toggleFamily("b");

    expect(s().selected).toEqual(["a", "c"]);
    // survivors must not be repainted — a reader who learned "a is blue"
    // should still see a as blue
    expect(s().slots.a).toBe(before.a);
    expect(s().slots.c).toBe(before.c);
    expect(s().slots.b).toBeUndefined();
  });

  it("keeps the other selections and their slots on select", () => {
    s().setSelected(["a", "b"]);
    const before = { ...s().slots };

    s().toggleFamily("c");

    expect(s().selected).toEqual(["a", "b", "c"]);
    expect(s().slots.a).toBe(before.a);
    expect(s().slots.b).toBe(before.b);
  });

  it("a freed slot is reused by the next family, not stolen from a survivor", () => {
    s().setSelected(["a", "b", "c"]);
    const bSlot = s().slots.b;
    const cSlot = s().slots.c;

    s().toggleFamily("b");
    s().toggleFamily("d");

    expect(s().slots.d).toBe(bSlot);
    expect(s().slots.c).toBe(cSlot);
  });

  it("deselecting the last family leaves the selection empty", () => {
    // Regression: a default-seeding effect used to re-fire whenever the
    // selection hit zero, so removing your last family silently added several.
    s().setSelected(["a"]);
    s().toggleFamily("a");
    expect(s().selected).toEqual([]);
    expect(s().slots).toEqual({});
  });

  it("clearing the selection leaves it empty", () => {
    s().setSelected(["a", "b"]);
    s().clearSelection();
    expect(s().selected).toEqual([]);
  });

  it("drops focus only when the focused family is the one removed", () => {
    s().setSelected(["a", "b"]);
    s().setFocused("a");

    s().toggleFamily("b");
    expect(s().focused).toBe("a");

    s().toggleFamily("a");
    expect(s().focused).toBeNull();
  });
});

describe("the colour cap refuses loudly", () => {
  const many = Array.from({ length: MAX_FAMILIES }, (_, i) => `f${i}`);

  it("does not silently ignore a click past the cap", () => {
    s().setSelected(many);
    s().toggleFamily("one-too-many");

    expect(s().selected).toEqual(many);
    expect(s().notice).toMatch(/colour limit/i);
  });

  it("clears the notice once something succeeds", () => {
    s().setSelected(many);
    s().toggleFamily("one-too-many");
    expect(s().notice).not.toBeNull();

    s().toggleFamily(many[0]);
    expect(s().notice).toBeNull();
  });

  it("every selected family always holds a slot", () => {
    s().setSelected(many);
    s().toggleFamily("one-too-many");
    for (const k of s().selected) expect(s().slots[k]).toBeTypeOf("number");
    expect(new Set(Object.values(s().slots)).size).toBe(s().selected.length);
  });
});

describe("vendor / group bulk toggle", () => {
  it("selects every family of the vendor", () => {
    s().toggleMany(["v1", "v2", "v3"], "Anthropic");
    expect(s().selected).toEqual(["v1", "v2", "v3"]);
    expect(s().notice).toBeNull();
  });

  it("deselects the vendor without touching anything else", () => {
    s().setSelected(["other"]);
    s().toggleMany(["v1", "v2"], "Anthropic");
    const otherSlot = s().slots.other;

    s().toggleMany(["v1", "v2"], "Anthropic");

    expect(s().selected).toEqual(["other"]);
    expect(s().slots.other).toBe(otherSlot);
  });

  it("only deselects when the whole vendor is already on", () => {
    s().setSelected(["v1"]);
    s().toggleMany(["v1", "v2"], "Anthropic");
    // v1 was on but v2 was not, so this is an "add the rest", not a "remove"
    expect(s().selected).toEqual(["v1", "v2"]);
  });

  it("adds what fits and names what did not", () => {
    const filled = Array.from({ length: MAX_FAMILIES - 1 }, (_, i) => `f${i}`);
    s().setSelected(filled);

    s().toggleMany(["v1", "v2", "v3"], "OpenAI");

    expect(s().selected).toHaveLength(MAX_FAMILIES);
    expect(s().selected).toContain("v1");
    expect(s().notice).toContain("OpenAI");
    expect(s().notice).toContain("2 more");
  });
});
