import { describe, expect, it } from "vitest";
import { __selectorControlInternals } from "../src/sources/shared/selectorControl";

function makeNode({
  ariaOrientation = "",
  dataOrientation = "",
  className = "",
  rect = { left: 100, top: 20, width: 200, height: 20 },
} = {}) {
  return {
    className,
    parentElement: null,
    getAttribute(name) {
      if (name === "aria-orientation") return ariaOrientation;
      if (name === "data-orientation") return dataOrientation;
      return "";
    },
    getBoundingClientRect() {
      return {
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
      };
    },
  };
}

describe("selectorControl volume orientation", () => {
  it("detects vertical orientation from aria attribute", () => {
    const node = makeNode({ ariaOrientation: "vertical" });
    expect(__selectorControlInternals.resolveSliderOrientation(node)).toBe("vertical");
  });

  it("detects vertical orientation from geometry", () => {
    const node = makeNode({ rect: { left: 10, top: 10, width: 20, height: 140 } });
    expect(__selectorControlInternals.resolveSliderOrientation(node)).toBe("vertical");
  });

  it("maps horizontal ratio to left->right click point", () => {
    const node = makeNode({ rect: { left: 10, top: 20, width: 200, height: 20 } });
    const point = __selectorControlInternals.resolveVolumeClickPoint(node, 0.25);
    expect(point).toMatchObject({
      orientation: "horizontal",
      clientX: 60,
      clientY: 30,
    });
  });

  it("maps vertical ratio to bottom->top click point", () => {
    const node = makeNode({ ariaOrientation: "vertical", rect: { left: 10, top: 20, width: 20, height: 200 } });
    const point = __selectorControlInternals.resolveVolumeClickPoint(node, 0.25);
    expect(point).toMatchObject({
      orientation: "vertical",
      clientX: 20,
      clientY: 170,
    });
  });

  it("keeps custom element as volume target when no standard slider descendants found", () => {
    const customBar = {
      className: "custom-volume-track",
      querySelectorAll() {
        return [];
      },
      closest() {
        return null;
      },
    };

    expect(__selectorControlInternals.resolveVolumeTargetNode(customBar)).toBe(customBar);
  });

  it("finds wider ancestor as drag base for knob-like role slider", () => {
    const base = makeNode({ rect: { left: 10, top: 20, width: 120, height: 8 } });
    const wrapper = makeNode({ rect: { left: 10, top: 18, width: 120, height: 12 } });
    const parent = makeNode({ rect: { left: 20, top: 10, width: 50, height: 50 } });
    const handle = makeNode({ rect: { left: 25, top: 15, width: 50, height: 50 } });

    handle.parentElement = parent;
    parent.parentElement = wrapper;
    wrapper.parentElement = base;

    expect(__selectorControlInternals.resolveSliderDragBase(handle)).toBe(wrapper);
  });

  it("detects unchanged slider as ineffective when target is far away", () => {
    const effective = __selectorControlInternals.isSliderAdjustmentEffective(0.2, 0.2, 0.8);
    expect(effective).toBe(false);
  });

  it("treats changed slider ratio as effective", () => {
    const effective = __selectorControlInternals.isSliderAdjustmentEffective(0.2, 0.76, 0.8);
    expect(effective).toBe(true);
  });

  it("does not treat unknown before/after ratios as effective", () => {
    const effective = __selectorControlInternals.isSliderAdjustmentEffective(Number.NaN, Number.NaN, 0.8);
    expect(effective).toBe(false);
  });
});
