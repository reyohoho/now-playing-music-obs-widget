import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __selectorPickerInternals } from "../src/content/selectorPickerController";

class FakeClassList {
  constructor(values = []) {
    this.values = new Set(values);
  }

  add(value) {
    this.values.add(String(value || ""));
  }

  remove(value) {
    this.values.delete(String(value || ""));
  }

  [Symbol.iterator]() {
    return this.values.values();
  }
}

class FakeElement {
  constructor({ id = "", classes = [] } = {}) {
    this.id = id;
    this.classList = new FakeClassList(classes);
  }
}

describe("selector picker internals", () => {
  const previousElement = globalThis.Element;

  beforeEach(() => {
    globalThis.Element = FakeElement;
  });

  afterEach(() => {
    globalThis.Element = previousElement;
  });

  it("normalizes stack level into 1..9", () => {
    expect(__selectorPickerInternals.normalizePickerStackLevel(0)).toBe(1);
    expect(__selectorPickerInternals.normalizePickerStackLevel(1)).toBe(1);
    expect(__selectorPickerInternals.normalizePickerStackLevel(4)).toBe(4);
    expect(__selectorPickerInternals.normalizePickerStackLevel(11)).toBe(9);
  });

  it("parses numeric keyboard shortcuts", () => {
    expect(__selectorPickerInternals.resolveStackLevelFromKeyEvent({ key: "3" })).toBe(3);
    expect(__selectorPickerInternals.resolveStackLevelFromKeyEvent({ key: "", code: "Digit7" })).toBe(7);
    expect(__selectorPickerInternals.resolveStackLevelFromKeyEvent({ key: "", code: "Numpad5" })).toBe(5);
    expect(__selectorPickerInternals.resolveStackLevelFromKeyEvent({ key: "0", code: "Digit0" })).toBe(0);
  });

  it("picks requested element from elementsFromPoint stack", () => {
    const top = new FakeElement({ id: "top" });
    const middle = new FakeElement({ id: "middle" });
    const bottom = new FakeElement({ id: "bottom" });
    const doc = {
      elementsFromPoint() {
        return [top, middle, bottom];
      },
    };

    expect(__selectorPickerInternals.resolveElementFromStack(doc, 10, 10, 1)).toMatchObject({
      element: top,
      level: 1,
      total: 3,
    });
    expect(__selectorPickerInternals.resolveElementFromStack(doc, 10, 10, 2)).toMatchObject({
      element: middle,
      level: 2,
      total: 3,
    });
    expect(__selectorPickerInternals.resolveElementFromStack(doc, 10, 10, 9)).toMatchObject({
      element: bottom,
      level: 3,
      total: 3,
    });
  });

  it("prefers inner shadow element over host in composed stack", () => {
    const inner = new FakeElement({ id: "inner" });
    const host = new FakeElement({ id: "host" });
    host.shadowRoot = {
      elementsFromPoint() {
        return [inner];
      },
    };
    const outer = new FakeElement({ id: "outer" });

    const doc = {
      elementsFromPoint() {
        return [host, outer];
      },
    };

    const stack = __selectorPickerInternals.resolveElementStackDeep(doc, 10, 10);
    expect(stack).toEqual([inner, host, outer]);

    expect(__selectorPickerInternals.resolveElementFromStack(doc, 10, 10, 1)).toMatchObject({
      element: inner,
      level: 1,
      total: 3,
    });
    expect(__selectorPickerInternals.resolveElementFromStack(doc, 10, 10, 2)).toMatchObject({
      element: host,
      level: 2,
      total: 3,
    });
  });
});
