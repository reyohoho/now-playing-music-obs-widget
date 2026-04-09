import { describe, expect, it } from "vitest";
import { dispatchAction, fail, ok, unsupported } from "../src/sources/shared/control";

describe("source shared control helpers", () => {
  it("returns null for unknown action in dispatcher", async () => {
    const handlers = {
      play: async () => ok("play-path"),
    };

    const result = await dispatchAction("pause", handlers, {});
    expect(result).toBeNull();
  });

  it("returns handler result for known action", async () => {
    const handlers = {
      play: async () => ok("play-path", { note: "ok" }),
    };

    const result = await dispatchAction("play", handlers, {});
    expect(result).toEqual({
      ok: true,
      path: "play-path",
      note: "ok",
    });
  });

  it("creates stable result shapes", () => {
    expect(ok("path", { x: 1 })).toEqual({ ok: true, path: "path", x: 1 });
    expect(fail("boom", { x: 1 })).toEqual({ ok: false, message: "boom", x: 1 });
    expect(unsupported("next")).toEqual({
      ok: false,
      message: "next unsupported",
      reason: "unsupported",
    });
  });
});
