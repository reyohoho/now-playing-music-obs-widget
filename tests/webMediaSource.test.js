import { describe, expect, it, vi } from "vitest";
import { createDomMediaAdapter } from "../src/content/adapters/domMediaAdapter";
import webMediaModule from "../src/sources/providers/web-media/module";

function makeTrackAnchor({
  href = "/track/1",
  title = "Track Title",
  artist = "Track Artist",
  textContent = "",
  coverUrl = "https://cdn.example/cover.jpg",
  withNestedText = true,
  previousCoverUrl = "",
} = {}) {
  const textNodes = withNestedText
    ? [title, artist].filter(Boolean).map((text) => ({ textContent: text }))
    : [];
  const coverNode = {
    currentSrc: coverUrl,
    getAttribute(name) {
      return name === "src" ? coverUrl : "";
    },
  };
  const previousCoverNode = {
    querySelector(selector) {
      if (selector === "img[src], img[srcset], img" && previousCoverUrl) {
        return {
          currentSrc: previousCoverUrl,
          getAttribute(name) {
            return name === "src" ? previousCoverUrl : "";
          },
        };
      }
      return null;
    },
  };

  return {
    textContent: textContent || [title, artist].filter(Boolean).join(" • "),
    getAttribute(name) {
      return name === "href" ? href : "";
    },
    querySelector(selector) {
      if (selector === "img[src], img[srcset], img" || selector === "img[src], img") return coverNode;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "div,span,p,strong,b") return textNodes;
      return [];
    },
    previousElementSibling: previousCoverUrl ? previousCoverNode : null,
    nextElementSibling: null,
    parentElement: null,
  };
}

function makeDocument({
  trackAnchor = null,
  trackAnchors = null,
  mediaList = [],
  title = "",
  meta = {},
} = {}) {
  const metaBySelector = meta && typeof meta === "object" ? meta : {};

  return {
    title,
    querySelectorAll(selector) {
      if (selector === 'a[href*="/track/"], a[href*="/tracks/"]') {
        if (Array.isArray(trackAnchors)) return trackAnchors;
        return trackAnchor ? [trackAnchor] : [];
      }
      if (selector === "audio,video") {
        return mediaList;
      }
      return [];
    },
    querySelector(selector) {
      const value = String(metaBySelector?.[selector] || "").trim();
      if (!value) return null;
      return {
        getAttribute(name) {
          return name === "content" || name === "href" ? value : "";
        },
      };
    },
  };
}

describe("web-media source", () => {
  it("extracts fallback track metadata from track links", () => {
    const doc = makeDocument({
      trackAnchor: makeTrackAnchor({
        href: "/track/272856",
        title: "One of Us (Record Mix)",
        artist: "DJ DIMIXER/FAVIA",
      }),
      mediaList: [{ paused: false, ended: false }],
    });

    const extracted = webMediaModule.extract({
      document: doc,
      window: {
        location: {
          href: "https://www.radiorecord.ru/",
        },
      },
    });

    expect(extracted).toMatchObject({
      title: "One of Us (Record Mix)",
      artist: "DJ DIMIXER/FAVIA",
      trackUrl: "https://www.radiorecord.ru/track/272856",
      playbackState: "playing",
    });
  });

  it("extracts title/artist from plain text track anchor and nearby cover", () => {
    const doc = makeDocument({
      trackAnchor: makeTrackAnchor({
        href: "/track/302473",
        title: "ignored",
        artist: "",
        textContent: "Deep Inside•FERRECK DAWN/HAYLEY MAY",
        withNestedText: false,
        coverUrl: "",
        previousCoverUrl:
          "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/ab/55/d7/ab55d7cd-9004-d2f4-96c0-3a19be1b58e0/826194699994.png/100x100bb.jpg",
      }),
      mediaList: [{ paused: false, ended: false }],
    });

    const extracted = webMediaModule.extract({
      document: doc,
      window: { location: { href: "https://www.radiorecord.ru/station/record" } },
    });

    expect(extracted).toMatchObject({
      title: "Deep Inside",
      artist: "FERRECK DAWN/HAYLEY MAY",
      coverUrl:
        "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/ab/55/d7/ab55d7cd-9004-d2f4-96c0-3a19be1b58e0/826194699994.png/100x100bb.jpg",
      trackUrl: "https://www.radiorecord.ru/track/302473",
    });
  });

  it("picks richer fallback track candidate when first link has no metadata", () => {
    const poorTrack = makeTrackAnchor({
      href: "/track/1",
      title: "",
      artist: "",
      textContent: "",
      withNestedText: false,
      coverUrl: "",
    });
    const richTrack = makeTrackAnchor({
      href: "/track/2",
      title: "Strong Track",
      artist: "Strong Artist",
      coverUrl: "https://cdn.example/strong.jpg",
    });
    const doc = makeDocument({
      trackAnchors: [poorTrack, richTrack],
      mediaList: [{ paused: false, ended: false }],
    });

    const extracted = webMediaModule.extract({
      document: doc,
      window: { location: { href: "https://example.test/" } },
    });

    expect(extracted).toMatchObject({
      title: "Strong Track",
      artist: "Strong Artist",
      coverUrl: "https://cdn.example/strong.jpg",
      trackUrl: "https://example.test/track/2",
    });
  });

  it("falls back to document title track candidate when anchors are missing", () => {
    const doc = makeDocument({
      title: "SYLVER - Forgiven (Club Caviar rmx) [2001] на Radio Record",
      mediaList: [{ paused: false, ended: false }],
    });

    const extracted = webMediaModule.extract({
      document: doc,
      window: { location: { href: "https://www.radiorecord.ru/station/record" } },
    });

    expect(extracted).toMatchObject({
      title: "Forgiven (Club Caviar rmx) [2001]",
      artist: "SYLVER",
      trackUrl: "https://www.radiorecord.ru/station/record",
      playbackState: "playing",
    });
  });

  it("prefers strong track-link candidate over document title candidate", () => {
    const doc = makeDocument({
      title: "Wrong Artist - Wrong Song на Radio Record",
      trackAnchor: makeTrackAnchor({
        href: "/track/500",
        title: "Right Song",
        artist: "Right Artist",
        coverUrl: "https://cdn.example/right.jpg",
      }),
      mediaList: [{ paused: false, ended: false }],
    });

    const extracted = webMediaModule.extract({
      document: doc,
      window: { location: { href: "https://www.radiorecord.ru/station/record" } },
    });

    expect(extracted).toMatchObject({
      title: "Right Song",
      artist: "Right Artist",
      coverUrl: "https://cdn.example/right.jpg",
      trackUrl: "https://www.radiorecord.ru/track/500",
    });
  });

  it("keeps playback state evidence when identity fallback is missing", () => {
    const extracted = webMediaModule.extract({
      document: makeDocument({
        trackAnchor: null,
        mediaList: [{ paused: true, ended: false }],
      }),
      window: { location: { href: "https://example.test/" } },
    });

    expect(extracted).toMatchObject({
      playbackState: "paused",
      trackUrl: "https://example.test/",
    });
  });

  it("uses bridge snapshot metadata from page-world media session", () => {
    const requestSnapshot = vi.fn();
    const extracted = webMediaModule.extract({
      document: makeDocument({
        trackAnchor: null,
        mediaList: [],
      }),
      window: { location: { href: "https://radiorecord.ru/" } },
      webMediaBridge: {
        getSnapshot: () => ({
          title: "Bridge Track",
          artist: "Bridge Artist",
          playbackState: "playing",
          coverUrl: "https://cdn.example/cover-bridge.jpg",
          trackUrl: "https://radiorecord.ru/live",
        }),
        requestSnapshot,
      },
    });

    expect(requestSnapshot).toHaveBeenCalledTimes(1);
    expect(extracted).toMatchObject({
      title: "Bridge Track",
      artist: "Bridge Artist",
      playbackState: "playing",
      coverUrl: "https://cdn.example/cover-bridge.jpg",
      trackUrl: "https://radiorecord.ru/live",
    });
  });

  it("keeps stronger fallback cover when bridge cover is a non-image link", () => {
    const requestSnapshot = vi.fn();
    const extracted = webMediaModule.extract({
      document: makeDocument({
        trackAnchor: makeTrackAnchor({
          href: "/track/112",
          title: "Fallback Track",
          artist: "Fallback Artist",
          coverUrl: "https://cdn.example/fallback-cover.png",
        }),
        mediaList: [{ paused: false, ended: false }],
      }),
      window: { location: { href: "https://www.radiorecord.ru/" } },
      webMediaBridge: {
        getSnapshot: () => ({
          title: "Bridge Track",
          artist: "Bridge Artist",
          playbackState: "playing",
          coverUrl: "https://www.radiorecord.ru/live",
        }),
        requestSnapshot,
      },
    });

    expect(requestSnapshot).toHaveBeenCalledTimes(1);
    expect(extracted).toMatchObject({
      title: "Bridge Track",
      artist: "Bridge Artist",
      playbackState: "playing",
      coverUrl: "https://cdn.example/fallback-cover.png",
    });
  });

  it("ignores page-like video poster and prefers meta thumbnail candidate", () => {
    const adapter = createDomMediaAdapter(webMediaModule);
    const context = {
      document: makeDocument({
        trackAnchor: null,
        mediaList: [
          {
            tagName: "VIDEO",
            paused: false,
            ended: false,
            duration: 100,
            currentTime: 10,
            volume: 0.7,
            muted: false,
            poster: "https://www.pornhub.com/view_video.php?viewkey=69b276bb07791",
            getBoundingClientRect() {
              return { width: 1280, height: 720 };
            },
          },
        ],
        meta: {
          'meta[property="og:title"]': "Artist Name - Song Name",
          'meta[property="og:image"]':
            "https://pix-cdn77.phncdn.com/c6371/videos/202603/12/41812025/original_41812025.mov/plain/ex:1:no/bg:0:0:0/rs:fit:640:360/vts:1550?hash=test&validto=1775774610",
        },
      }),
      window: { navigator: {}, location: { href: "https://www.pornhub.com/view_video.php?viewkey=69b276bb07791" } },
    };

    const snapshot = adapter.readSnapshot(context);
    expect(snapshot).toMatchObject({
      sourceId: "web-media",
      playbackState: "playing",
      coverUrl:
        "https://pix-cdn77.phncdn.com/c6371/videos/202603/12/41812025/original_41812025.mov/plain/ex:1:no/bg:0:0:0/rs:fit:640:360/vts:1550?hash=test&validto=1775774610",
    });
  });

  it("prefers image-like meta cover urls over generic links", () => {
    const extracted = webMediaModule.extract({
      document: makeDocument({
        trackAnchor: null,
        mediaList: [{ paused: false, ended: false }],
        meta: {
          'meta[property="og:title"]': "Artist Name - Song Name",
          'meta[property="og:image"]': "https://example.test/track/42",
          'meta[name="twitter:image"]': "https://cdn.example/covers/song.webp?size=600",
        },
      }),
      window: { location: { href: "https://example.test/" } },
    });

    expect(extracted).toMatchObject({
      title: "Artist Name",
      artist: "Song Name",
      coverUrl: "https://cdn.example/covers/song.webp?size=600",
      playbackState: "playing",
    });
  });

  it("keeps meta cover even when meta title is missing", () => {
    const extracted = webMediaModule.extract({
      document: makeDocument({
        trackAnchor: null,
        mediaList: [{ paused: false, ended: false }],
        meta: {
          'meta[property="og:image"]':
            "https://pix-cdn77.phncdn.com/c6371/videos/202603/12/41812025/original_41812025.mov/plain/ex:1:no/bg:0:0:0/rs:fit:640:360/vts:1550?hash=test&validto=1775774610",
        },
      }),
      window: { location: { href: "https://www.pornhub.com/view_video.php?viewkey=69b276bb07791" } },
    });

    expect(extracted).toMatchObject({
      coverUrl:
        "https://pix-cdn77.phncdn.com/c6371/videos/202603/12/41812025/original_41812025.mov/plain/ex:1:no/bg:0:0:0/rs:fit:640:360/vts:1550?hash=test&validto=1775774610",
      playbackState: "playing",
    });
  });

  it("does not use page urls as cover when they are the only candidates", () => {
    const extracted = webMediaModule.extract({
      document: makeDocument({
        trackAnchor: null,
        mediaList: [{ paused: false, ended: false, poster: "https://example.test/watch?v=123" }],
        meta: {
          'meta[property="og:title"]': "Artist Name - Song Name",
          'meta[property="og:image"]': "https://example.test/watch?v=123",
          'meta[name="twitter:image"]': "https://example.test/view_video.php?viewkey=abc",
        },
      }),
      window: { location: { href: "https://example.test/watch?v=123" } },
    });

    expect(extracted).toMatchObject({
      title: "Artist Name",
      artist: "Song Name",
      playbackState: "playing",
    });
    expect(extracted.coverUrl || "").toBe("");
  });

  it("keeps best meta cover even when title candidate wins", () => {
    const extracted = webMediaModule.extract({
      document: makeDocument({
        title: "\"mistake Fuck my StepSister while my Wife in Shower\": Step Sister and her Stupid Jokes. BTS - Pornhub.com",
        trackAnchor: null,
        mediaList: [{ paused: false, ended: false }],
        meta: {
          'meta[property="og:title"]':
            "\"Mistake Fuck My StepSister While My Wife In Shower\": Step Sister And Her Stupid Jokes. BTS",
          'meta[property="og:image"]':
            "https://pix-cdn77.phncdn.com/c6371/videos/202603/12/41812025/original_41812025.mov/plain/ex:1:no/bg:0:0:0/rs:fit:640:360/vts:1550?hash=test&validto=1775775272",
          'meta[property="og:url"]': "https://www.pornhub.com/view_video.php?viewkey=69b276bb07791",
        },
      }),
      window: { location: { href: "https://www.pornhub.com/view_video.php?viewkey=69b276bb07791" } },
    });

    expect(extracted).toMatchObject({
      title: "\"mistake Fuck my StepSister while my Wife in Shower\": Step Sister and her Stupid Jokes. BTS",
      artist: "Pornhub.com",
      coverUrl:
        "https://pix-cdn77.phncdn.com/c6371/videos/202603/12/41812025/original_41812025.mov/plain/ex:1:no/bg:0:0:0/rs:fit:640:360/vts:1550?hash=test&validto=1775775272",
      playbackState: "playing",
    });
  });

  it("prefers signed cover urls with validfrom+validto over validto-only", () => {
    const extracted = webMediaModule.extract({
      document: makeDocument({
        trackAnchor: null,
        mediaList: [{ paused: false, ended: false }],
        meta: {
          'meta[property="og:title"]': "Artist Name - Song Name",
          'meta[property="og:image"]':
            "https://cdn.example/video-thumb.mov/plain/rs:fit:640:360/vts:1000?hash=aaa&validto=1775775272",
          'meta[name="twitter:image"]':
            "https://cdn.example/video-thumb.mov/plain/rs:fit:350:196/vts:1000?hash=bbb&validfrom=1751342400&validto=4891363200",
        },
      }),
      window: { location: { href: "https://example.test/watch?v=1" } },
    });

    expect(extracted).toMatchObject({
      coverUrl:
        "https://cdn.example/video-thumb.mov/plain/rs:fit:350:196/vts:1000?hash=bbb&validfrom=1751342400&validto=4891363200",
      playbackState: "playing",
    });
  });

  it("uses primary video frame cover for origin-locked signed cover urls", () => {
    const drawImage = vi.fn();
    const doc = makeDocument({
      trackAnchor: null,
      mediaList: [
        {
          tagName: "VIDEO",
          paused: false,
          ended: false,
          videoWidth: 1280,
          videoHeight: 720,
          currentSrc: "blob:https://www.redtube.com/video-source",
          src: "blob:https://www.redtube.com/video-source",
        },
      ],
      meta: {
        'meta[property="og:title"]': "Artist Name - Song Name",
        'meta[property="og:image"]':
          "https://pix-cdn77.rdtcdn.com/c6251/videos/202604/05/44436635/240P_1000K_44436635.mp4/plain/rs:fit:1280:720/vts:663?hash=locked&validto=1775693977",
      },
    });
    doc.createElement = (tagName) => {
      if (tagName !== "canvas") return null;
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage,
          };
        },
        toDataURL() {
          return "data:image/jpeg;base64,frame-cover";
        },
      };
    };
    const context = {
      document: doc,
      window: {
        location: { href: "https://www.redtube.com/222727741" },
      },
    };

    const first = webMediaModule.extract(context);
    const second = webMediaModule.extract(context);

    expect(first).toMatchObject({
      coverUrl: "data:image/jpeg;base64,frame-cover",
      playbackState: "playing",
    });
    expect(second).toMatchObject({
      coverUrl: "data:image/jpeg;base64,frame-cover",
      playbackState: "playing",
    });
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it("adapter readSnapshot keeps extracted metadata after playback start and pause", () => {
    const adapter = createDomMediaAdapter(webMediaModule);
    const media = { paused: false, ended: false, duration: NaN, currentTime: 3, volume: 1, muted: false };
    const context = {
      document: makeDocument({
        trackAnchor: makeTrackAnchor({
          href: "/track/77",
          title: "Fallback Track",
          artist: "Fallback Artist",
        }),
        mediaList: [media],
      }),
      window: { navigator: {}, location: { href: "https://example.test/" } },
    };

    const first = adapter.readSnapshot(context);
    expect(first).toMatchObject({
      sourceId: "web-media",
      title: "Fallback Track",
      artist: "Fallback Artist",
      trackUrl: "https://example.test/track/77",
      playbackState: "playing",
    });

    media.paused = true;
    media.currentTime = 4;

    const second = adapter.readSnapshot(context);
    expect(second).toMatchObject({
      sourceId: "web-media",
      title: "Fallback Track",
      artist: "Fallback Artist",
      trackUrl: "https://example.test/track/77",
      playbackState: "paused",
    });
  });

  it("adapter readSnapshot suppresses identity-only fallback before first playback start", () => {
    const adapter = createDomMediaAdapter(webMediaModule);
    const context = {
      document: makeDocument({
        trackAnchor: makeTrackAnchor({
          href: "/track/77",
          title: "Fallback Track",
          artist: "Fallback Artist",
        }),
        mediaList: [{ paused: true, ended: false, duration: NaN, currentTime: 0, volume: 1, muted: false }],
      }),
      window: { navigator: {}, location: { href: "https://example.test/" } },
    };

    expect(adapter.readSnapshot(context)).toBeNull();
  });

  it("suppresses anonymous feed playback with many top-level videos", () => {
    const adapter = createDomMediaAdapter(webMediaModule);
    const playingFeedVideo = {
      tagName: "VIDEO",
      paused: false,
      ended: false,
      duration: NaN,
      currentTime: 0,
      volume: 0.2,
      muted: true,
      getBoundingClientRect() {
        return { width: 960, height: 540 };
      },
    };
    const filler = () => ({
      tagName: "VIDEO",
      paused: true,
      ended: false,
      duration: NaN,
      currentTime: 0,
      volume: 0.5,
      muted: true,
      getBoundingClientRect() {
        return { width: 320, height: 180 };
      },
    });
    const context = {
      sourceMinDurationSec: 40,
      document: makeDocument({
        trackAnchor: null,
        mediaList: [playingFeedVideo, filler(), filler(), filler(), filler(), filler()],
      }),
      window: { navigator: {}, location: { href: "https://example.test/model/page" } },
    };

    expect(adapter.readSnapshot(context)).toBeNull();
  });

  it("suppresses anonymous short video playback by configured threshold", () => {
    const adapter = createDomMediaAdapter(webMediaModule);
    const context = {
      sourceMinDurationSec: 40,
      document: makeDocument({
        trackAnchor: null,
        mediaList: [
          {
            tagName: "VIDEO",
            paused: false,
            ended: false,
            duration: 20,
            currentTime: 0,
            volume: 0.4,
            muted: false,
            getBoundingClientRect() {
              return { width: 960, height: 540 };
            },
          },
        ],
      }),
      window: { navigator: {}, location: { href: "https://example.test/model/page" } },
    };

    expect(adapter.readSnapshot(context)).toBeNull();
  });

  it("adapter readSnapshot keeps playback-only snapshot for media-session-first fallback", () => {
    const adapter = createDomMediaAdapter(webMediaModule);
    const context = {
      document: makeDocument({
        trackAnchor: null,
        mediaList: [
          { paused: false, ended: false, duration: NaN, currentTime: 12, volume: 0.4, muted: false },
        ],
      }),
      window: { navigator: {}, location: { href: "https://www.radiorecord.ru/" } },
    };

    const snapshot = adapter.readSnapshot(context);
    expect(snapshot).toMatchObject({
      sourceId: "web-media",
      playbackState: "playing",
      positionSec: 12,
      volume: 0.4,
    });
  });

  it("suppresses anonymous tiny embedded-frame playback", () => {
    const adapter = createDomMediaAdapter(webMediaModule);
    const context = {
      isTopWindow: false,
      sourceMinDurationSec: 40,
      document: makeDocument({
        trackAnchor: null,
        mediaList: [
          {
            tagName: "VIDEO",
            paused: false,
            ended: false,
            duration: 20,
            currentTime: 0,
            volume: 0.7,
            muted: false,
            getBoundingClientRect() {
              return { width: 220, height: 124 };
            },
          },
        ],
      }),
      window: { navigator: {}, location: { href: "https://embed.example/player?id=1" } },
    };

    expect(adapter.readSnapshot(context)).toBeNull();
  });

  it("keeps anonymous embedded-frame playback for video-like geometry", () => {
    const adapter = createDomMediaAdapter(webMediaModule);
    const context = {
      isTopWindow: false,
      sourceMinDurationSec: 15,
      document: makeDocument({
        trackAnchor: null,
        mediaList: [
          {
            tagName: "VIDEO",
            paused: false,
            ended: false,
            duration: 20,
            currentTime: 0,
            volume: 0.7,
            muted: false,
            getBoundingClientRect() {
              return { width: 960, height: 540 };
            },
          },
        ],
      }),
      window: { navigator: {}, location: { href: "https://embed.example/player?id=1" } },
    };

    const snapshot = adapter.readSnapshot(context);
    expect(snapshot).toMatchObject({
      sourceId: "web-media",
      playbackState: "playing",
      durationSec: 20,
    });
  });

  it("adapter readSnapshot returns null when there is no playback and no identity", () => {
    const adapter = createDomMediaAdapter(webMediaModule);
    const context = {
      document: makeDocument({
        trackAnchor: null,
        mediaList: [],
      }),
      window: { navigator: {}, location: { href: "https://example.test/" } },
    };

    expect(adapter.readSnapshot(context)).toBeNull();
  });

  it("uses the biggest video element as primary media for web-media source", () => {
    const adapter = createDomMediaAdapter(webMediaModule);
    const context = {
      document: makeDocument({
        trackAnchor: null,
        mediaList: [
          {
            tagName: "VIDEO",
            paused: false,
            ended: false,
            duration: 300,
            currentTime: 150,
            volume: 0.2,
            muted: false,
            getBoundingClientRect() {
              return { width: 240, height: 135 };
            },
          },
          {
            tagName: "VIDEO",
            paused: true,
            ended: false,
            duration: 600,
            currentTime: 30,
            volume: 0.8,
            muted: false,
            getBoundingClientRect() {
              return { width: 1280, height: 720 };
            },
          },
        ],
      }),
      window: { navigator: {}, location: { href: "https://example.test/" } },
    };

    const snapshot = adapter.readSnapshot(context);
    expect(snapshot).toMatchObject({
      sourceId: "web-media",
      playbackState: "paused",
      durationSec: 600,
      positionSec: 30,
      volume: 0.8,
    });
  });

  it("keeps sticky primary video on pause when bigger banner video appears", () => {
    const adapter = createDomMediaAdapter(webMediaModule);
    const mainVideo = {
      tagName: "VIDEO",
      paused: false,
      ended: false,
      duration: 500,
      currentTime: 120,
      volume: 0.7,
      muted: false,
      getBoundingClientRect() {
        return { width: 960, height: 540 };
      },
    };
    const bannerVideo = {
      tagName: "VIDEO",
      paused: false,
      ended: false,
      duration: 30,
      currentTime: 3,
      volume: 0,
      muted: true,
      getBoundingClientRect() {
        return { width: 1920, height: 1080 };
      },
    };
    const mediaList = [mainVideo];
    const context = {
      document: makeDocument({
        trackAnchor: null,
        mediaList,
      }),
      window: { navigator: {}, location: { href: "https://example.test/" } },
    };

    const firstSnapshot = adapter.readSnapshot(context);
    expect(firstSnapshot).toMatchObject({
      sourceId: "web-media",
      playbackState: "playing",
      durationSec: 500,
      positionSec: 120,
    });

    mainVideo.paused = true;
    mainVideo.currentTime = 121;
    mediaList.unshift(bannerVideo);

    const secondSnapshot = adapter.readSnapshot(context);
    expect(secondSnapshot).toMatchObject({
      sourceId: "web-media",
      playbackState: "paused",
      durationSec: 500,
      positionSec: 121,
    });
  });
});
