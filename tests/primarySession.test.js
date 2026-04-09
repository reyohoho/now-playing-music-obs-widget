import { describe, expect, it } from "vitest";
import { createPrimarySessionState, reducePrimarySession } from "../src/core/primarySession";

function s(sessionId, sourceId = "") {
  return {
    sessionId,
    sourceId,
  };
}

describe("primary session state", () => {
  it("auto-picks first session on transition from empty and when exactly one session remains", () => {
    let state = createPrimarySessionState();

    state = reducePrimarySession(state, {
      type: "SYNC",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });
    expect(state.primarySessionId).toBe("1:youtube");

    state = reducePrimarySession(state, { type: "SYNC", sessions: [s("2:spotify", "spotify")] });
    expect(state.primarySessionId).toBe("2:spotify");
  });

  it("keeps selected primary while it exists", () => {
    let state = createPrimarySessionState();
    state = reducePrimarySession(state, {
      type: "SYNC",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });
    state = reducePrimarySession(state, {
      type: "SELECT",
      sessionId: "2:spotify",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });

    state = reducePrimarySession(state, {
      type: "SYNC",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });
    expect(state.primarySessionId).toBe("2:spotify");
  });

  it("allows selecting primary by click", () => {
    let state = createPrimarySessionState();
    state = reducePrimarySession(state, {
      type: "SYNC",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });
    state = reducePrimarySession(state, {
      type: "SELECT",
      sessionId: "2:spotify",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });

    expect(state.primarySessionId).toBe("2:spotify");
  });

  it("falls back to only remaining session even if user-selected source autopick is disabled", () => {
    let state = createPrimarySessionState();
    state = reducePrimarySession(state, {
      type: "SYNC",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });
    state = reducePrimarySession(state, {
      type: "SELECT",
      sessionId: "2:spotify",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });

    state = reducePrimarySession(state, {
      type: "SYNC",
      sessions: [s("1:youtube", "youtube")],
      sourceAutoPickMap: {
        spotify: false,
      },
    });
    expect(state.primarySessionId).toBe("1:youtube");
    expect(state.selectedByUser).toBe(false);
  });

  it("does not auto-pick only remaining session when that source auto-pick is disabled", () => {
    let state = createPrimarySessionState();
    state = reducePrimarySession(state, {
      type: "SYNC",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });
    state = reducePrimarySession(state, {
      type: "SELECT",
      sessionId: "2:spotify",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });

    state = reducePrimarySession(state, {
      type: "SYNC",
      sessions: [s("1:youtube", "youtube")],
      sourceAutoPickMap: {
        spotify: false,
        youtube: false,
      },
    });
    expect(state.primarySessionId).toBe("2:spotify");
    expect(state.selectedByUser).toBe(true);
  });

  it("switches to another session of the same source when source autopick enabled", () => {
    let state = createPrimarySessionState();
    state = reducePrimarySession(state, {
      type: "SYNC",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });
    state = reducePrimarySession(state, {
      type: "SELECT",
      sessionId: "2:spotify",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });

    state = reducePrimarySession(state, {
      type: "SYNC",
      sessions: [s("1:youtube", "youtube"), s("3:spotify", "spotify")],
      sourceAutoPickMap: {
        spotify: true,
      },
    });
    expect(state.primarySessionId).toBe("3:spotify");
  });

  it("falls back to the only remaining session when user-selected source disappears", () => {
    let state = createPrimarySessionState();
    state = reducePrimarySession(state, {
      type: "SYNC",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });
    state = reducePrimarySession(state, {
      type: "SELECT",
      sessionId: "2:spotify",
      sessions: [s("1:youtube", "youtube"), s("2:spotify", "spotify")],
    });

    state = reducePrimarySession(state, {
      type: "SYNC",
      sessions: [s("1:youtube", "youtube")],
      sourceAutoPickMap: {
        spotify: false,
      },
    });
    expect(state.primarySessionId).toBe("1:youtube");
    expect(state.selectedByUser).toBe(false);
  });
});
