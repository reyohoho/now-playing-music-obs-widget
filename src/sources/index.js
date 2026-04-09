import yandexMusic from "@/sources/providers/yandex-music/module";
import youtube from "@/sources/providers/youtube/module";
import youtubeMusic from "@/sources/providers/youtube-music/module";
import spotify from "@/sources/providers/spotify/module";
import soundcloud from "@/sources/providers/soundcloud/module";
import vk from "@/sources/providers/vk/module";
import zvuk from "@/sources/providers/zvuk/module";
import webMedia from "@/sources/providers/web-media/module";

export const SOURCE_MODULES = [
  yandexMusic,
  youtube,
  youtubeMusic,
  spotify,
  soundcloud,
  vk,
  zvuk,
  webMedia,
];

const sourceById = new Map();
const sourceByHost = new Map();

for (const module of SOURCE_MODULES) {
  const id = module?.meta?.id;
  if (!id) continue;

  if (sourceById.has(id)) {
    throw new Error(`Duplicate source module id: ${id}`);
  }

  sourceById.set(id, module);

  for (const host of module.meta.hosts || []) {
    if (!sourceByHost.has(host)) {
      sourceByHost.set(host, module);
    }
  }
}

export function listSourceModules() {
  return [...SOURCE_MODULES];
}

export function getSourceModuleById(id) {
  return sourceById.get(id) ?? null;
}

export function getSourceModuleByHost(hostname) {
  return sourceByHost.get(hostname) ?? null;
}

export function listSourceMetas() {
  return SOURCE_MODULES.map((module) => module.meta);
}

export function defaultSourceOrder() {
  return SOURCE_MODULES.map((module) => module.meta.id);
}

export function defaultEnabledMap() {
  return Object.fromEntries(SOURCE_MODULES.map((module) => [module.meta.id, true]));
}
