import { describe, expect, it } from "vitest";
import {
  buildCommandAliasIndex,
  normalizeTwitchControlRouter,
} from "../src/shared/twitchControlRouter";

describe("twitch control router schema", () => {
  it("applies per-command access defaults", () => {
    const router = normalizeTwitchControlRouter({
      trigger: "!ww",
      commands: {
        pause: {
          aliases: ["pause"],
        },
      },
    });

    expect(router.commands.pause.access).toEqual({
      mode: "roles",
      allowedRoles: ["broadcaster", "moderator"],
      allowedUsers: [],
      deniedUsers: [],
    });
  });

  it("normalizes and deduplicates per-command access lists", () => {
    const router = normalizeTwitchControlRouter({
      commands: {
        seek: {
          access: {
            mode: "users",
            allowedRoles: ["Moderator", "moderator"],
            allowedUsers: ["UserA", "usera", "userB"],
            deniedUsers: ["BadGuy", "badguy"],
          },
        },
      },
    });

    expect(router.commands.seek.access).toEqual({
      mode: "users",
      allowedRoles: ["moderator"],
      allowedUsers: ["usera", "userb"],
      deniedUsers: ["badguy"],
    });
  });

  it("keeps empty allowedRoles as deny-all for roles mode", () => {
    const router = normalizeTwitchControlRouter({
      commands: {
        pause: {
          access: {
            mode: "roles",
            allowedRoles: [],
          },
        },
      },
    });

    expect(router.commands.pause.access.mode).toBe("roles");
    expect(router.commands.pause.access.allowedRoles).toEqual([]);
  });

  it("does not auto-expand play/pause roles from broadcaster to moderator", () => {
    const router = normalizeTwitchControlRouter({
      commands: {
        play: {
          access: {
            mode: "roles",
            allowedRoles: ["broadcaster"],
          },
        },
        pause: {
          access: {
            mode: "roles",
            allowedRoles: ["broadcaster"],
          },
        },
      },
    });

    expect(router.commands.play.access.allowedRoles).toEqual(["broadcaster"]);
    expect(router.commands.pause.access.allowedRoles).toEqual(["broadcaster"]);
  });

  it("detects alias collisions between commands", () => {
    const router = normalizeTwitchControlRouter({
      commands: {
        play: { aliases: ["go"] },
        pause: { aliases: ["go"] },
      },
    });
    const { duplicates } = buildCommandAliasIndex(router.commands);
    expect(duplicates.length).toBeGreaterThan(0);
    expect(duplicates[0].alias).toBe("go");
  });
});
