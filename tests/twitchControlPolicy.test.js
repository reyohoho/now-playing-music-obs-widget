import { describe, expect, it } from "vitest";
import {
  checkRateLimit,
  createRateLimitState,
  resolveAccess,
  resolveSourceAccess,
} from "../src/background/twitch/controlPolicy";
import { normalizeTwitchControlRouter } from "../src/shared/twitchControlRouter";

describe("twitch control policy", () => {
  it("denied users always win", () => {
    const result = resolveAccess("vip-user", ["broadcaster"], {
      mode: "everyone",
      deniedUsers: ["vip-user"],
    });
    expect(result).toEqual({ ok: false, reason: "access_denied" });
  });

  it("mode users allows only allowlist users", () => {
    expect(
      resolveAccess("trusted", ["viewer"], {
        mode: "users",
        allowedUsers: ["trusted"],
      })
    ).toEqual({ ok: true, reason: "" });
    expect(
      resolveAccess("other", ["broadcaster"], {
        mode: "users",
        allowedUsers: ["trusted"],
      })
    ).toEqual({ ok: false, reason: "access_denied" });
  });

  it("mode roles allows only allowed roles", () => {
    expect(
      resolveAccess("user-a", ["moderator"], {
        mode: "roles",
        allowedRoles: ["moderator"],
      })
    ).toEqual({ ok: true, reason: "" });
    expect(
      resolveAccess("user-b", ["viewer"], {
        mode: "roles",
        allowedRoles: ["moderator"],
      })
    ).toEqual({ ok: false, reason: "access_denied" });
  });

  it("mode everyone allows any non-denied user", () => {
    expect(
      resolveAccess("anyone", ["viewer"], {
        mode: "everyone",
      })
    ).toEqual({ ok: true, reason: "" });
  });

  it("resolves source access with global + command override intersection", () => {
    const router = normalizeTwitchControlRouter({
      sources: { globalAllowed: ["youtube", "spotify"] },
      commands: {
        seek: { allowedSourcesOverride: ["youtube"] },
      },
    });

    expect(resolveSourceAccess("youtube", router, "seek").ok).toBe(true);
    expect(resolveSourceAccess("spotify", router, "seek")).toEqual({
      ok: false,
      reason: "source_denied",
    });
  });

  it("applies global/per-user/per-command rate limits", () => {
    const state = createRateLimitState();
    const rateLimit = {
      globalMs: 1000,
      perUserMs: 1500,
      perCommandMs: 500,
    };

    expect(
      checkRateLimit(state, {
        user: "alice",
        canonicalCommand: "play",
        rateLimit,
        now: 10000,
      }).ok
    ).toBe(true);

    expect(
      checkRateLimit(state, {
        user: "alice",
        canonicalCommand: "pause",
        rateLimit,
        now: 10400,
      })
    ).toMatchObject({ ok: false, reason: "rate_limited" });

    expect(
      checkRateLimit(state, {
        user: "bob",
        canonicalCommand: "play",
        rateLimit,
        now: 11100,
      }).ok
    ).toBe(true);

    expect(
      checkRateLimit(state, {
        user: "bob",
        canonicalCommand: "play",
        rateLimit,
        now: 11400,
      })
    ).toMatchObject({ ok: false, reason: "rate_limited" });
  });
});
