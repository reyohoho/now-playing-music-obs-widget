function getNowPlayingYM() {
    try {
        const title = document.querySelector('[class*="PlayerBarDesktop"]').querySelector('[class*="Meta_title__"]').innerText
        const artists = document.querySelector('[class*="PlayerBarDesktop"]').querySelector('[class*="Meta_artists__"]').innerText
        sendToOBS_WS("YM", `${artists} - ${title}`);
        console.log("IDDQD", "tick getNowPlayingYM", `${artists} - ${title}`);
        setTimeout(getNowPlayingYM, 1500);
    } catch (e) {
        console.log("iddqd", e);
        setTimeout(getNowPlayingYM, 1500);
    }
}

function getNowPlayingRadioRecord() {
    try {
        const title = document.querySelector("#playerInfo > a > div > div:nth-child(1)").innerText
        const artists = document.querySelector("#playerInfo > a > div > div.nAlcjXw7n-gCNvOuXJ3NGw\\=\\=").innerText
        sendToOBS_WS("RR", `${artists} - ${title}`);
        console.log("IDDQD", "tick getNowPlayingRadioRecord", `${artists} - ${title}`);
        setTimeout(getNowPlayingRadioRecord, 1500);
    } catch (e) {
        console.log("iddqd", e);
        setTimeout(getNowPlayingRadioRecord, 1500);
    }
}

function getNowPlayingMB() {
    try {
        const song = document.querySelector('iframe').getAttribute('title');
        sendToOBS_WS("MB", song);
        console.log("IDDQD", "tick getNowPlayingMB", song);
        setTimeout(getNowPlayingMB, 1500);
    } catch (e) {
        console.log("iddqd", e);
        setTimeout(getNowPlayingMB, 1500);
    }
}


function getNowPlayingHOOBOT() {
    try {
        const song = document.querySelector('iframe').getAttribute('title');
        sendToOBS_WS("MB", song);
        console.log("IDDQD", "tick getNowPlayingHOOBOT", song);
        setTimeout(getNowPlayingHOOBOT, 1500);
    } catch (e) {
        console.log("iddqd", e);
        setTimeout(getNowPlayingHOOBOT, 1500);
    }
}

function getNowPlayingSE() {
    try {
        const song = document.querySelectorAll(".songrequest-player-info-title")[0].innerText;
        sendToOBS_WS("MB", song);
        console.log("IDDQD", "tick getNowPlayingSE", song);
        setTimeout(getNowPlayingSE, 1500);
    } catch (e) {
        console.log("iddqd", e);
        setTimeout(getNowPlayingSE, 1500);
    }
}

function ytNowPlayingTitleElement() {
    return (
        document.querySelector("#title > h1 > yt-formatted-string") ||
        document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
        document.querySelector("ytmusic-player-bar yt-formatted-string.title") ||
        document.querySelector(".slim-video-metadata-header .slim-video-information-title")
    );
}

function ytmusicNowPlayingLine() {
    const bar = document.querySelector("ytmusic-player-bar");
    if (!bar) return null;
    const titleEl = bar.querySelector("yt-formatted-string.title");
    const bylineEl = bar.querySelector("yt-formatted-string.byline");
    const title = titleEl?.innerText?.trim() ?? "";
    let artist = "";
    if (bylineEl) {
        const tooltip = bylineEl.getAttribute("title")?.trim();
        if (tooltip) artist = tooltip.split(/\s*•\s*/)[0]?.trim() ?? "";
        if (!artist) {
            const first = bylineEl.querySelector("a");
            if (first) artist = first.innerText.trim();
        }
    }
    if (artist && title) return `${artist} - ${title}`;
    if (title) return title;
    if (artist) return artist;
    return null;
}

function getNowPlayingYT() {
    try {
        const ytmLine = ytmusicNowPlayingLine();
        if (ytmLine) {
            sendToOBS_WS("YT", ytmLine);
            console.log("IDDQD", "tick getNowPlayingYT", ytmLine);
            setTimeout(getNowPlayingYT, 1500);
            return;
        }
        const el = ytNowPlayingTitleElement();
        if (!el) throw new Error("no yt title node");
        const song = el.innerText;
        sendToOBS_WS("YT", song.replace(/^[^:]+:\s*/, ''));
        console.log("IDDQD", "tick getNowPlayingYT", song);
        setTimeout(getNowPlayingYT, 1500);
    } catch (e) {
        console.log("iddqd", e);
        setTimeout(getNowPlayingYT, 1500);
    }
}

function getNowPlayingSpotify() {
    try {
        const song = document.querySelector('[data-testid="now-playing-widget"]').getAttribute('aria-label');;
        sendToOBS_WS("SPTF", song.replace(/^[^:]+:\s*/, ''));
        console.log("IDDQD", "tick getNowPlayingSpotify", song);
        setTimeout(getNowPlayingSpotify, 1500);
    } catch (e) {
        console.log("iddqd", e);
        setTimeout(getNowPlayingSpotify, 1500);
    }
}

function getNowPlayingDA() {
    try {
        const song = document.querySelector('iframe').getAttribute('title');
        sendToOBS_WS("DA", song);
        console.log("IDDQD", "tick getNowPlayingDA", song);
        setTimeout(getNowPlayingDA, 1500);
    } catch (e) {
        console.log("iddqd", e);
        setTimeout(getNowPlayingDA, 1500);
        
    }
}

function vkCollapseText(s) {
    return s
        .replace(/[\u00A0\u202F\u2007]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/** En dash, em dash, minus sign, small/fullwidth hyphen (VK may use any). */
const VK_DASH_SPLIT = /\s*[\u2013\u2014\u2212\uFE63\uFF0D]\s*/u;

function vkNormalizeLine(full, artist) {
    const norm = vkCollapseText(full);
    if (!norm) return null;
    const a = vkCollapseText(artist || "");

    let chunks = norm.split(VK_DASH_SPLIT);
    if (chunks.length < 2) chunks = norm.split(/\s+-\s+/);
    if (chunks.length >= 2) {
        let head = chunks[0].trim();
        const tail = chunks.slice(1).join(" - ").trim();
        if (!head && a) head = a;
        if (tail) return head ? `${head} - ${tail}` : tail;
    }

    if (a && norm.startsWith(a)) {
        const rest = norm
            .slice(a.length)
            .trim()
            .replace(/^(?:[\u2013\u2014\u2212\uFE63\uFF0D·]|\s+-\s+)\s*/u, "")
            .trim();
        if (rest) return `${a} - ${rest}`;
    }

    return norm;
}

function vkFindPlayerRow() {
    const selectors = [
        '[class*="TopNavigation__player"] [class*="vkitTextClamp__root"]',
        "#page_header [class*='vkitTextClamp__root']",
        '[class*="vkitTextClamp__root"]',
    ];
    for (const sel of selectors) {
        const roots = document.querySelectorAll(sel);
        let best = null;
        let bestLen = 0;
        for (const row of roots) {
            if (!row.querySelector('[class*="vkitAudioArtists__artist"]')) continue;
            const raw = row.innerText || row.textContent || "";
            const t = vkCollapseText(raw);
            if (!t) continue;
            const hasSep = VK_DASH_SPLIT.test(t) || /\s-\s/.test(t);
            if (!hasSep) continue;
            if (t.length > bestLen) {
                bestLen = t.length;
                best = row;
            }
        }
        if (best) return best;
    }
    return document.querySelector('[class*="vkitTextClamp__root"]:has([class*="vkitAudioArtists__artist"])');
}

function getNowPlayingVK() {
    try {
        const row = vkFindPlayerRow();
        if (!row) throw new Error("no vk player line");
        const artistEl = row.querySelector('[class*="vkitAudioArtists__artist"]');
        if (!artistEl) throw new Error("no vk artist node");
        const artist = vkCollapseText(artistEl.innerText || artistEl.textContent || "");
        const full = vkCollapseText(row.innerText || row.textContent || "");
        if (!full) throw new Error("empty vk line");
        const line = vkNormalizeLine(full, artist) || full;
        sendToOBS_WS("VK", line);
        console.log("IDDQD", "tick getNowPlayingVK", line);
        setTimeout(getNowPlayingVK, 1500);
    } catch (e) {
        console.log("iddqd", e);
        setTimeout(getNowPlayingVK, 1500);
    }
}

function getNowPlayingSC() {
    try {
        const ctx = document.querySelector(".playbackSoundBadge__titleContextContainer");
        if (!ctx) throw new Error("no soundcloud badge");
        const artistEl = ctx.querySelector("a.playbackSoundBadge__lightLink");
        const trackEl = ctx.querySelector("a.playbackSoundBadge__titleLink");
        const artist = (artistEl?.getAttribute("title") || artistEl?.innerText || "").trim();
        let track = (trackEl?.getAttribute("title") || "").trim();
        if (!track) {
            const vis = trackEl?.querySelector("span[aria-hidden='true']");
            track = (vis?.innerText || trackEl?.innerText || "").trim();
        }
        const line = artist && track ? `${artist} - ${track}` : (track || artist);
        if (!line) throw new Error("empty soundcloud line");
        sendToOBS_WS("SC", line);
        console.log("IDDQD", "tick getNowPlayingSC", line);
        setTimeout(getNowPlayingSC, 1500);
    } catch (e) {
        console.log("iddqd", e);
        setTimeout(getNowPlayingSC, 1500);
    }
}

/** Hostnames from manifest.json content_scripts.matches (keep in sync when adding sites). */
const NOW_PLAYING_BY_HOST = {
    "music.yandex.ru": getNowPlayingYM,
    "music.yandex.com": getNowPlayingYM,
    "music.yandex.by": getNowPlayingYM,
    "music.yandex.kz": getNowPlayingYM,
    "moo.bot": getNowPlayingMB,
    "www.donationalerts.com": getNowPlayingDA,
    "donationalerts.com": getNowPlayingDA,
    "hobot.alwaysdata.net": getNowPlayingHOOBOT,
    "streamelements.com": getNowPlayingSE,
    "open.spotify.com": getNowPlayingSpotify,
    "www.youtube.com": getNowPlayingYT,
    "youtube.com": getNowPlayingYT,
    "m.youtube.com": getNowPlayingYT,
    "music.youtube.com": getNowPlayingYT,
    "www.youtube-nocookie.com": getNowPlayingYT,
    "youtu.be": getNowPlayingYT,
    "soundcloud.com": getNowPlayingSC,
    "www.soundcloud.com": getNowPlayingSC,
    "vk.com": getNowPlayingVK,
    "www.vk.com": getNowPlayingVK,
    "m.vk.com": getNowPlayingVK,
    "www.radiorecord.ru": getNowPlayingRadioRecord,
    "radiorecord.ru": getNowPlayingRadioRecord,
};

const startNowPlaying = NOW_PLAYING_BY_HOST[location.hostname];
if (startNowPlaying) {
    setTimeout(startNowPlaying, 1500);
}



function sendToOBS_WS(sender, song) {
    if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({sender: sender, song: song}, () => void chrome.runtime.lastError);
    }
}