import { listSourceModules } from "@/sources/index";
import { createDomMediaAdapter } from "@/content/adapters/domMediaAdapter";

const ADAPTERS = listSourceModules().map((sourceModule) => createDomMediaAdapter(sourceModule));
const GENERIC_ADAPTER_ID = "web-media";
const GENERIC_ADAPTER = ADAPTERS.find((adapter) => adapter.id === GENERIC_ADAPTER_ID) ?? null;

const HOST_TO_ADAPTER = new Map();
for (const adapter of ADAPTERS) {
  for (const host of adapter.hosts || []) {
    HOST_TO_ADAPTER.set(String(host || "").trim().toLowerCase(), adapter);
  }
}

export function getAdapterByHost(hostname) {
  const normalizedHost = String(hostname || "").trim().toLowerCase();
  return HOST_TO_ADAPTER.get(normalizedHost) ?? GENERIC_ADAPTER;
}

export function getAdapterById(sourceId) {
  return ADAPTERS.find((adapter) => adapter.id === sourceId) ?? null;
}

export function listAdapters() {
  return [...ADAPTERS];
}
