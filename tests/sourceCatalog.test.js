import { describe, expect, it } from "vitest";
import {
  SOURCE_MODULES,
  defaultEnabledMap as catalogDefaultEnabledMap,
  defaultSourceOrder as catalogDefaultSourceOrder,
  getSourceModuleByHost,
  getSourceModuleById,
  listSourceMetas,
} from "../src/sources";
import {
  PROVIDERS,
  defaultEnabledMap,
  defaultSourceOrder,
  getProviderByHost,
  getProviderById,
} from "../src/shared/providers";

describe("source catalog", () => {
  it("has unique source ids and host mapping", () => {
    const ids = SOURCE_MODULES.map((module) => module.meta.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const module of SOURCE_MODULES) {
      expect(getSourceModuleById(module.meta.id)?.meta.id).toBe(module.meta.id);
      for (const host of module.meta.hosts || []) {
        expect(getSourceModuleByHost(host)?.meta.id).toBe(module.meta.id);
      }
    }
  });

  it("builds stable defaults from modules", () => {
    const ids = SOURCE_MODULES.map((module) => module.meta.id);
    expect(catalogDefaultSourceOrder()).toEqual(ids);
    expect(catalogDefaultEnabledMap()).toEqual(Object.fromEntries(ids.map((id) => [id, true])));
  });
});

describe("providers facade", () => {
  it("matches source catalog contract", () => {
    const metas = listSourceMetas();
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(metas.map((meta) => meta.id));
    expect(defaultSourceOrder()).toEqual(catalogDefaultSourceOrder());
    expect(defaultEnabledMap()).toEqual(catalogDefaultEnabledMap());

    for (const meta of metas) {
      expect(getProviderById(meta.id)?.id).toBe(meta.id);
      for (const host of meta.hosts || []) {
        expect(getProviderByHost(host)?.id).toBe(meta.id);
      }
    }
  });
});
