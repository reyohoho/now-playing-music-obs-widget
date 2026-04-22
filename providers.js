const OBS_PROVIDERS = [
  {
    id: "ym",
    name: "Яндекс Музыка",
    icon: "🎵",
    hosts: [
      "music.yandex.ru",
      "music.yandex.com",
      "music.yandex.by",
      "music.yandex.kz",
    ],
  },
  {
    id: "yt",
    name: "YouTube / YT Music",
    icon: "📺",
    hosts: [
      "www.youtube.com",
      "youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "www.youtube-nocookie.com",
      "youtu.be",
    ],
  },
  {
    id: "sptf",
    name: "Spotify",
    icon: "🎧",
    hosts: ["open.spotify.com"],
  },
  {
    id: "vk",
    name: "VK Музыка",
    icon: "💬",
    hosts: ["vk.com", "www.vk.com", "m.vk.com"],
  },
  {
    id: "sc",
    name: "SoundCloud",
    icon: "🧡",
    hosts: ["soundcloud.com", "www.soundcloud.com"],
  },
  {
    id: "rr",
    name: "Radio Record",
    icon: "📻",
    hosts: ["radiorecord.ru", "www.radiorecord.ru"],
  },
  {
    id: "mb",
    name: "moo.bot",
    icon: "🐮",
    hosts: ["moo.bot"],
  },
  {
    id: "hobot",
    name: "Hobot",
    icon: "🤖",
    hosts: ["hobot.alwaysdata.net"],
  },
  {
    id: "se",
    name: "StreamElements",
    icon: "✨",
    hosts: ["streamelements.com"],
  },
  {
    id: "da",
    name: "Donation Alerts",
    icon: "💖",
    hosts: ["www.donationalerts.com", "donationalerts.com"],
  },
];

const OBS_PROVIDER_BY_HOST = (() => {
  const map = Object.create(null);
  for (const p of OBS_PROVIDERS) {
    for (const h of p.hosts) map[h] = p.id;
  }
  return map;
})();

function obsProviderIdFromUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return OBS_PROVIDER_BY_HOST[u.hostname] || "";
  } catch (_) {
    return "";
  }
}

if (typeof self !== "undefined") {
  self.OBS_PROVIDERS = OBS_PROVIDERS;
  self.OBS_PROVIDER_BY_HOST = OBS_PROVIDER_BY_HOST;
  self.obsProviderIdFromUrl = obsProviderIdFromUrl;
}
