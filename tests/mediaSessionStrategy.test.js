import { describe, expect, it } from "vitest";
import { applySnapshotStrategy } from "../src/content/adapters/mediaSession";

describe("media session snapshot strategy", () => {
  it("uses media session metadata and playback state in media-session-first mode", () => {
    const result = applySnapshotStrategy({
      strategy: "media-session-first",
      hasPrimaryMedia: true,
      mediaSnapshot: {
        durationSec: 200,
        positionSec: 42,
        playbackState: "paused",
        coverUrl: "poster.jpg",
      },
      extractedSnapshot: {
        title: "DOM title",
        artist: "DOM artist",
        coverUrl: "dom-cover.jpg",
      },
      mediaSessionSnapshot: {
        title: "MS title",
        artist: "MS artist",
        coverUrl: "ms-cover.jpg",
        playbackState: "playing",
      },
    });

    expect(result.snapshotSource).toBe("mediaSession");
    expect(result.snapshot.title).toBe("MS title");
    expect(result.snapshot.artist).toBe("MS artist");
    expect(result.snapshot.coverUrl).toBe("ms-cover.jpg");
    expect(result.snapshot.playbackState).toBe("playing");
    expect(result.snapshot.positionSec).toBe(42);
  });

  it("falls back when media session metadata is empty", () => {
    const result = applySnapshotStrategy({
      strategy: "media-session-first",
      hasPrimaryMedia: true,
      mediaSnapshot: {
        playbackState: "paused",
      },
      extractedSnapshot: {
        title: "Fallback title",
        artist: "Fallback artist",
        playbackState: "paused",
      },
      mediaSessionSnapshot: {
        title: "",
        artist: "",
        coverUrl: "",
        playbackState: "playing",
      },
    });

    expect(result.snapshotSource).toBe("fallback");
    expect(result.snapshot.title).toBe("Fallback title");
    expect(result.snapshot.artist).toBe("Fallback artist");
    expect(result.snapshot.playbackState).toBe("paused");
  });

  it("does not use legacy metadata fallback in strict media-session mode", () => {
    const result = applySnapshotStrategy({
      strategy: "media-session-first",
      strictMediaMetadata: true,
      hasPrimaryMedia: true,
      mediaSnapshot: {
        playbackState: "paused",
      },
      extractedSnapshot: {
        title: "Legacy title",
        artist: "Legacy artist",
        coverUrl: "legacy.jpg",
      },
      mediaSessionSnapshot: {
        title: "",
        artist: "",
        coverUrl: "",
        playbackState: "playing",
      },
    });

    expect(result.snapshotSource).toBe("mediaSession-empty");
    expect(result.snapshot.title).toBe("");
    expect(result.snapshot.artist).toBe("");
    expect(result.snapshot.coverUrl).toBe("");
    expect(result.snapshot.playbackState).toBe("playing");
  });

  it("keeps legacy behavior for sources with media available", () => {
    const result = applySnapshotStrategy({
      strategy: "legacy",
      hasPrimaryMedia: true,
      mediaSnapshot: {
        playbackState: "paused",
        coverUrl: "poster.jpg",
      },
      extractedSnapshot: {
        title: "DOM title",
      },
      mediaSessionSnapshot: {
        title: "MS title",
        artist: "MS artist",
        coverUrl: "ms-cover.jpg",
        playbackState: "playing",
      },
    });

    expect(result.snapshotSource).toBe("fallback");
    expect(result.snapshot.title).toBe("DOM title");
    expect(result.snapshot.artist).toBe("MS artist");
    expect(result.snapshot.coverUrl).toBe("ms-cover.jpg");
    expect(result.snapshot.playbackState).toBe("paused");
  });

  it("uses media session state in legacy mode when no media element exists", () => {
    const result = applySnapshotStrategy({
      strategy: "legacy",
      hasPrimaryMedia: false,
      mediaSnapshot: {
        playbackState: "idle",
      },
      extractedSnapshot: {},
      mediaSessionSnapshot: {
        title: "MS title",
        artist: "MS artist",
        coverUrl: "ms-cover.jpg",
        playbackState: "playing",
      },
    });

    expect(result.snapshot.playbackState).toBe("playing");
    expect(result.snapshot.title).toBe("MS title");
    expect(result.snapshot.artist).toBe("MS artist");
    expect(result.snapshot.coverUrl).toBe("ms-cover.jpg");
  });
});
