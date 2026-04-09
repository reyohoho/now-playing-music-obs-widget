import { describe, expect, it, vi } from "vitest";
import { TwitchService } from "../src/background/twitch/service";

function createService(overrides = {}) {
  const onControl = vi.fn(async () => ({ ok: true }));
  const service = new TwitchService({
    onStatus: vi.fn(),
    onLog: vi.fn(),
    onControl,
    getActiveSnapshot: () => ({
      sourceId: "youtube",
      title: "Track",
      artist: "Artist",
    }),
    patchSettings: vi.fn(async () => ({})),
    ...overrides,
  });
  service.client.connect = vi.fn();
  service.client.sendChat = vi.fn(() => true);
  return { service, onControl };
}

describe("TwitchService command router", () => {
  it("executes control command via new router", async () => {
    const { service, onControl } = createService();
    service.updateSettings({
      enabled: true,
      controlEnabled: true,
      announceEnabled: false,
      channel: "demo",
      username: "bot",
      oauthToken: "token",
      controlRouter: {
        trigger: "!ww",
      },
    });

    await service.handlePrivmsg({
      user: "owner",
      roles: ["broadcaster"],
      text: "!ww pause",
    });

    expect(onControl).toHaveBeenCalledTimes(1);
    expect(onControl.mock.calls[0][0]).toBe("pause");
  });

  it("applies per-command access rules", async () => {
    const { service, onControl } = createService();
    service.updateSettings({
      enabled: true,
      controlEnabled: true,
      announceEnabled: false,
      channel: "demo",
      username: "bot",
      oauthToken: "token",
      controlRouter: {
        trigger: "!ww",
        rateLimit: {
          globalMs: 0,
          perUserMs: 0,
          perCommandMs: 0,
        },
        commands: {
          pause: {
            enabled: true,
            aliases: ["pause"],
            access: {
              mode: "roles",
              allowedRoles: ["broadcaster"],
            },
          },
          seek: {
            enabled: true,
            aliases: ["seek"],
            access: {
              mode: "users",
              allowedUsers: ["vip-user"],
            },
          },
        },
      },
    });

    await service.handlePrivmsg({
      user: "owner",
      roles: ["broadcaster"],
      text: "!ww pause",
    });
    await service.handlePrivmsg({
      user: "owner",
      roles: ["broadcaster"],
      text: "!ww seek 0:45",
    });
    await service.handlePrivmsg({
      user: "vip-user",
      roles: ["viewer"],
      text: "!ww seek 0:45",
    });

    expect(onControl).toHaveBeenCalledTimes(2);
    expect(onControl.mock.calls[0][0]).toBe("pause");
    expect(onControl.mock.calls[1][0]).toBe("seek");
    expect(onControl.mock.calls[1][1]).toBe(45);
    expect(service.logs.some((entry) => String(entry.text || "").includes("access_denied"))).toBe(
      true
    );
  });

  it("applies source policy and rate limit after access checks", async () => {
    const { service, onControl } = createService();
    service.updateSettings({
      enabled: true,
      controlEnabled: true,
      announceEnabled: false,
      controlRouter: {
        trigger: "!ww",
        rateLimit: {
          globalMs: 100000,
          perUserMs: 100000,
          perCommandMs: 100000,
        },
        sources: {
          globalAllowed: ["spotify"],
        },
        commands: {
          pause: {
            enabled: true,
            aliases: ["pause"],
            access: {
              mode: "everyone",
            },
          },
        },
      },
    });

    await service.handlePrivmsg({
      user: "viewer-a",
      roles: ["viewer"],
      text: "!ww pause",
    });

    expect(onControl).toHaveBeenCalledTimes(0);
    expect(service.logs[0]?.text || "").toContain("source_denied");

    service.updateSettings({
      enabled: true,
      controlEnabled: true,
      announceEnabled: false,
      controlRouter: {
        trigger: "!ww",
        rateLimit: {
          globalMs: 100000,
          perUserMs: 100000,
          perCommandMs: 100000,
        },
        commands: {
          pause: {
            enabled: true,
            aliases: ["pause"],
            access: {
              mode: "everyone",
            },
          },
        },
      },
    });

    await service.handlePrivmsg({
      user: "viewer-a",
      roles: ["viewer"],
      text: "!ww pause",
    });
    await service.handlePrivmsg({
      user: "viewer-a",
      roles: ["viewer"],
      text: "!ww pause",
    });

    expect(onControl).toHaveBeenCalledTimes(1);
    expect(service.logs[0]?.text || "").toContain("rate_limited");
  });

  it("writes parse_failed log when command is invalid", async () => {
    const { service, onControl } = createService();
    service.updateSettings({
      enabled: true,
      controlEnabled: true,
      announceEnabled: false,
      controlRouter: {
        trigger: "!ww",
      },
    });

    await service.handlePrivmsg({
      user: "owner",
      roles: ["broadcaster"],
      text: "!ww seek nope",
    });

    expect(onControl).not.toHaveBeenCalled();
    expect(service.logs[0]?.text || "").toContain("parse_failed");
  });

  it("logs unsupported reason when control is not available for source", async () => {
    const onControl = vi.fn(async () => ({
      ok: false,
      reason: "unsupported",
      unsupportedReason: "capability-missing",
      message: "unsupported action next",
    }));
    const service = new TwitchService({
      onStatus: vi.fn(),
      onLog: vi.fn(),
      onControl,
      getActiveSnapshot: () => ({
        sourceId: "youtube",
        title: "Track",
        artist: "Artist",
      }),
      patchSettings: vi.fn(async () => ({})),
    });
    service.client.connect = vi.fn();
    service.client.sendChat = vi.fn(() => true);

    service.updateSettings({
      enabled: true,
      controlEnabled: true,
      announceEnabled: false,
      controlRouter: {
        trigger: "!ww",
        rateLimit: {
          globalMs: 0,
          perUserMs: 0,
          perCommandMs: 0,
        },
        commands: {
          next: {
            enabled: true,
            aliases: ["next"],
            access: {
              mode: "everyone",
            },
          },
        },
      },
    });

    await service.handlePrivmsg({
      user: "viewer-a",
      roles: ["viewer"],
      text: "!ww next",
    });

    expect(onControl).toHaveBeenCalledTimes(1);
    expect(service.logs[0]?.text || "").toContain("unsupported");
  });

  it("treats trigger-only message as np command and sends announce", async () => {
    const { service } = createService();
    service.updateSettings({
      enabled: true,
      controlEnabled: true,
      announceEnabled: false,
      controlRouter: {
        trigger: "!ww",
      },
    });

    await service.handlePrivmsg({
      user: "owner",
      roles: ["broadcaster"],
      text: "!ww",
    });

    expect(service.client.sendChat).toHaveBeenCalledTimes(1);
  });
});
