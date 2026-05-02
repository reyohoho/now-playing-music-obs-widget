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

function getMooBotProgressPercent() {
    try {
        const circle = document.querySelector(
            "#input-element-widget-song-requests-progress > svg > circle.input-type-progress-circle-progress"
        );
        if (!circle) return null;
        const [total] = (circle.getAttribute("stroke-dasharray") || "").trim().split(/\s+/);
        const offset = parseFloat(circle.getAttribute("stroke-dashoffset") || "");
        const dash = parseFloat(total || "");
        if (!isFinite(dash) || dash <= 0 || !isFinite(offset)) return null;
        const pct = Math.round(((dash - offset) / dash) * 100);
        if (pct < 0 || pct > 100) return null;
        return pct;
    } catch (_) {
        return null;
    }
}

function getMooBotRequesterNick() {
    try {
        const el = document.querySelector(
            "#widget-song-requests > div > div.widget-body.list-shown.playing > ul.widget-song-requests-list > li.playing > div.widget-song-requests-list-text > small"
        );
        if (!el) return null;
        const raw = (el.innerText || el.textContent || "").trim();
        if (!raw) return null;
        const nick = raw.replace(/^by\s+/i, "").trim();
        return nick || null;
    } catch (_) {
        return null;
    }
}

// When a moo.bot track changes, iframe.title updates immediately but the
// progress circle and requester nick render a tick or two later. Without
// a grace window OBS would briefly show "song" and then "song (N%) by nick",
// producing a visible flicker. We delay sending a new track until both
// pct and requester are available (or the grace window elapses), and keep
// heartbeating the previous "ready" line so the OBS watcher doesn't clear
// the text while we wait.
const MB_INITIAL_GRACE_MS = 4000;
let mbLastTrack = "";
let mbTrackSince = 0;
let mbTrackReady = false;
let mbLastSentLine = "";

function mbOnTrackTick(song) {
    if (song !== mbLastTrack) {
        mbLastTrack = song;
        mbTrackSince = Date.now();
        mbTrackReady = false;
    }
}

function buildMooBotLine(song) {
    const pct = getMooBotProgressPercent();
    // const requester = getMooBotRequesterNick();
    let body = song;
    if (pct != null) body += ` (${pct}%)`;
    // if (requester) body += ` by ${requester}`;
    const label = typeof getMooBotVoteLabel === "function" ? getMooBotVoteLabel() : "";
    return {
        line: label ? `${body}\n${label}` : body,
        pct,
        // requester,
    };
}

function sendMooBotToObs(song) {
    if (!song) return;
    const { line, pct, requester } = buildMooBotLine(song);
    if (!mbTrackReady) {
        const haveMeta = pct != null && !!requester;
        const graceElapsed = Date.now() - mbTrackSince >= MB_INITIAL_GRACE_MS;
        if (haveMeta || graceElapsed) {
            mbTrackReady = true;
        } else {
            if (mbLastSentLine) {
                sendToOBS_WS("MB", mbLastSentLine);
            }
            return;
        }
    }
    mbLastSentLine = line;
    sendToOBS_WS("MB", line);
    console.log("IDDQD", "tick getNowPlayingMB", line.replace(/\n/g, " | "));
}

function getNowPlayingMB() {
    try {
        const iframe = document.querySelector('iframe.moobot-songrequest-player') || document.querySelector('iframe#widget2') || document.querySelector('iframe');
        const song = iframe?.getAttribute('title');
        if (song) {
            if (typeof onMooBotTrackTick === "function") onMooBotTrackTick(song);
            mbOnTrackTick(song);
            sendMooBotToObs(song);
        }
    } catch (e) {
        console.log("iddqd", e);
    } finally {
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

// --- Twitch anonymous chat (moo.bot only) ---

var onMooBotTrackTick = null;
var getMooBotVoteLabel = null;

if (location.hostname === "moo.bot") {
    const TWITCH_IRC_URL = "wss://irc-ws.chat.twitch.tv:443";
    const TWITCH_NICK = "justinfan" + Math.floor(1000 + Math.random() * 89000);
    let twitchWs = null;
    let twitchReconnectTimer = null;
    let twitchChannel = "";

    let voteSkipKeyword = "skip";
    let voteSaveKeyword = "ClippyJAM";
    let voteSkipThreshold = 3;
    let voteSkipByPercent = false;
    let voteSkipPercent = 10;
    let twitchViewersCount = 0;

    function getEffectiveThreshold() {
        if (voteSkipByPercent && twitchViewersCount > 0) {
            return Math.max(1, Math.ceil(twitchViewersCount * voteSkipPercent / 100));
        }
        return voteSkipThreshold;
    }

    const voteState = {
        currentTrack: "",
        votes: new Map(),
        triggeredForTrack: "",
    };

    function clickSkipButton() {
        const btn = document.querySelector("#song-requests-action-skip > i");
        if (!btn) {
            console.log("IDDQD", "vote: skip button not found (#song-requests-action-skip > i)");
            return false;
        }
        btn.click();
        console.log("IDDQD", "vote: SKIP triggered");
        return true;
    }

    function countVotes() {
        let skip = 0;
        let save = 0;
        for (const v of voteState.votes.values()) {
            if (v === "skip") skip++;
            else if (v === "save") save++;
        }
        return { skip, save, net: skip - save };
    }

    function castVote(login, display, vote) {
        if (!voteState.currentTrack) return;
        const prev = voteState.votes.get(login);
        if (prev === vote) return;
        voteState.votes.set(login, vote);
        const c = countVotes();
        const action = prev ? `${prev}→${vote}` : vote;
        const eff = getEffectiveThreshold();
        console.log(
            "IDDQD",
            `vote: ${display} ${action} [skip=${c.skip} save=${c.save} net=${c.net}/${eff}] track="${voteState.currentTrack}"`
        );
        pushMooBotLineToObs();
        if (
            c.net >= eff &&
            voteState.triggeredForTrack !== voteState.currentTrack
        ) {
            if (clickSkipButton()) {
                voteState.triggeredForTrack = voteState.currentTrack;
            }
        }
    }

    function buildVoteLabel() {
        const c = countVotes();
        return `skip(${voteSkipKeyword})/save(${voteSaveKeyword}): ${c.net}/${getEffectiveThreshold()}`;
    }

    function pushMooBotLineToObs() {
        const song = voteState.currentTrack;
        if (!song) return;
        mbOnTrackTick(song);
        sendMooBotToObs(song);
    }

    getMooBotVoteLabel = buildVoteLabel;

    function processChatForVote(login, display, text) {
        const words = text.split(/\s+/).filter(Boolean);
        let vote = null;
        if (voteSkipKeyword && words.includes(voteSkipKeyword)) vote = "skip";
        else if (voteSaveKeyword && words.includes(voteSaveKeyword)) vote = "save";
        if (vote) castVote(login, display, vote);
    }

    onMooBotTrackTick = function (track) {
        if (!track) return;
        if (track !== voteState.currentTrack) {
            voteState.currentTrack = track;
            voteState.votes.clear();
            voteState.triggeredForTrack = "";
            console.log("IDDQD", `vote: track changed -> "${track}" (votes reset)`);
        } else {
            voteState.currentTrack = track;
        }
    };

    function parseTwitchMessage(raw) {
        let line = raw;
        let tagsPart = "";
        if (line.startsWith("@")) {
            const sp = line.indexOf(" ");
            if (sp === -1) return null;
            tagsPart = line.slice(1, sp);
            line = line.slice(sp + 1);
        }
        const match = line.match(
            /^:(\S+?)!\S+@\S+\s+PRIVMSG\s+#(\S+)\s+:([\s\S]*)$/
        );
        if (!match) return null;

        const login = match[1].toLowerCase();
        let displayName = match[1];
        if (tagsPart) {
            for (const kv of tagsPart.split(";")) {
                const eq = kv.indexOf("=");
                if (eq === -1) continue;
                if (kv.slice(0, eq) === "display-name") {
                    const v = kv.slice(eq + 1);
                    if (v) displayName = v;
                    break;
                }
            }
        }
        return { login, user: displayName, channel: match[2], text: match[3].trimEnd() };
    }

    function connectTwitchChat(channel) {
        if (twitchWs) {
            twitchWs.onclose = null;
            twitchWs.close();
            twitchWs = null;
        }
        if (!channel) return;

        console.log("IDDQD", "twitch: connecting to", channel);
        twitchWs = new WebSocket(TWITCH_IRC_URL);

        twitchWs.onopen = () => {
            twitchWs.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
            twitchWs.send("PASS SCHMOOPIIE");
            twitchWs.send("NICK " + TWITCH_NICK);
            twitchWs.send("JOIN #" + channel);
            console.log("IDDQD", "twitch: joined #" + channel);
        };

        twitchWs.onmessage = (ev) => {
            const lines = ev.data.split("\r\n").filter(Boolean);
            for (const line of lines) {
                if (line.startsWith("PING")) {
                    const trailing = line.slice(4).trim() || ":tmi.twitch.tv";
                    twitchWs.send("PONG " + trailing);
                    continue;
                }
                const msg = parseTwitchMessage(line);
                if (msg) {
                    console.log("IDDQD", `twitch [#${msg.channel}] ${msg.user}: ${msg.text}`);
                    processChatForVote(msg.login, msg.user, msg.text);
                } else if (line.includes(" PRIVMSG ")) {
                    console.log("IDDQD", "twitch raw (unparsed PRIVMSG):", line);
                }
            }
        };

        twitchWs.onclose = () => {
            console.log("IDDQD", "twitch: disconnected, reconnecting in 5s");
            twitchWs = null;
            clearTimeout(twitchReconnectTimer);
            twitchReconnectTimer = setTimeout(() => connectTwitchChat(twitchChannel), 5000);
        };

        twitchWs.onerror = (e) => {
            console.log("IDDQD", "twitch: ws error", e);
        };
    }

    chrome.storage.local.get({ twitchViewersCount: 0 }, (loc) => {
        twitchViewersCount = Number(loc.twitchViewersCount) || 0;
    });

    chrome.storage.sync.get(
        {
            twitchChannel: "",
            voteSkipKeyword: "skip",
            voteSaveKeyword: "ClippyJAM",
            voteSkipThreshold: 3,
            voteSkipByPercent: false,
            voteSkipPercent: 10,
        },
        (cfg) => {
            twitchChannel = (cfg.twitchChannel || "").trim().toLowerCase();
            voteSkipKeyword = String(cfg.voteSkipKeyword || "skip");
            voteSaveKeyword = String(cfg.voteSaveKeyword || "ClippyJAM");
            voteSkipThreshold = Math.max(1, Number(cfg.voteSkipThreshold) || 3);
            voteSkipByPercent = cfg.voteSkipByPercent === true;
            voteSkipPercent = Math.max(1, Math.min(100, Number(cfg.voteSkipPercent) || 10));
            console.log(
                "IDDQD",
                `vote: config loaded skip="${voteSkipKeyword}" save="${voteSaveKeyword}" threshold=${voteSkipThreshold} byPercent=${voteSkipByPercent} percent=${voteSkipPercent}% viewers=${twitchViewersCount} effective=${getEffectiveThreshold()}`
            );
            if (twitchChannel) connectTwitchChat(twitchChannel);
        }
    );

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local") {
            if (changes.twitchViewersCount) {
                twitchViewersCount = Number(changes.twitchViewersCount.newValue) || 0;
                console.log("IDDQD", `vote: viewersCount -> ${twitchViewersCount}, effective threshold -> ${getEffectiveThreshold()}`);
            }
            return;
        }
        if (area !== "sync") return;

        if (changes.twitchChannel) {
            const next = (changes.twitchChannel.newValue || "").trim().toLowerCase();
            if (next !== twitchChannel) {
                twitchChannel = next;
                clearTimeout(twitchReconnectTimer);
                connectTwitchChat(twitchChannel);
            }
        }
        if (changes.voteSkipKeyword) {
            voteSkipKeyword = String(changes.voteSkipKeyword.newValue || "skip");
            console.log("IDDQD", `vote: skip keyword -> "${voteSkipKeyword}"`);
        }
        if (changes.voteSaveKeyword) {
            voteSaveKeyword = String(changes.voteSaveKeyword.newValue || "ClippyJAM");
            console.log("IDDQD", `vote: save keyword -> "${voteSaveKeyword}"`);
        }
        if (changes.voteSkipThreshold) {
            voteSkipThreshold = Math.max(1, Number(changes.voteSkipThreshold.newValue) || 3);
            console.log("IDDQD", `vote: threshold -> ${voteSkipThreshold}`);
        }
        if (changes.voteSkipByPercent) {
            voteSkipByPercent = changes.voteSkipByPercent.newValue === true;
            console.log("IDDQD", `vote: byPercent -> ${voteSkipByPercent}, effective threshold -> ${getEffectiveThreshold()}`);
        }
        if (changes.voteSkipPercent) {
            voteSkipPercent = Math.max(1, Math.min(100, Number(changes.voteSkipPercent.newValue) || 10));
            console.log("IDDQD", `vote: skipPercent -> ${voteSkipPercent}%, effective threshold -> ${getEffectiveThreshold()}`);
        }
    });
}



function sendToOBS_WS(sender, song) {
    if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({sender: sender, song: song}, () => void chrome.runtime.lastError);
    }
}