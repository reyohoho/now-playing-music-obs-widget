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

if(location.hostname === "music.yandex.ru") {
    setTimeout(getNowPlayingYM, 1500);
} else if (location.hostname === "moo.bot" ) {
    setTimeout(getNowPlayingMB, 1500);
} else if (location.hostname === "www.donationalerts.com" ) {
    setTimeout(getNowPlayingDA, 1500);
} else if (location.hostname === "hobot.alwaysdata.net" ) {
    setTimeout(getNowPlayingHOOBOT, 1500);
} else if (location.hostname === "streamelements.com" ) {
    setTimeout(getNowPlayingSE, 1500);
} else if (location.hostname === "open.spotify.com" ) {
    setTimeout(getNowPlayingSpotify, 1500);
}



function sendToOBS_WS(sender, song) {
    if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({sender: sender, song: song}, () => void chrome.runtime.lastError);
    }
}