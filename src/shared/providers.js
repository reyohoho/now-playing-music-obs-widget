import {
  defaultEnabledMap as catalogDefaultEnabledMap,
  defaultSourceOrder as catalogDefaultSourceOrder,
  getSourceModuleByHost,
  getSourceModuleById,
  listSourceMetas,
} from "@/sources/index";

export const PROVIDERS = listSourceMetas();

export function getProviderByHost(hostname) {
  return getSourceModuleByHost(hostname)?.meta ?? null;
}

export function getProviderById(id) {
  return getSourceModuleById(id)?.meta ?? null;
}

export function defaultSourceOrder() {
  return catalogDefaultSourceOrder();
}

export function defaultEnabledMap() {
  return catalogDefaultEnabledMap();
}
