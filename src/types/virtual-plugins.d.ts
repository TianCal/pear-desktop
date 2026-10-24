// Main-process-only exports of `virtual:plugins` (see vite-plugins/plugin-importer.mts).
// Merged with the declaration in src/virtual-module.d.ts.
declare module 'virtual:plugins' {
  import type { PluginConfig, PluginDef } from '@/types/plugins';

  type LazyPlugin = PluginDef<unknown, unknown, unknown, PluginConfig>;

  /**
   * Imports a single plugin's full definition (including backend and menu).
   * Resolves to `undefined` for unknown or unsupported plugins.
   * Main process only.
   */
  export const fullPlugin: (id: string) => Promise<LazyPlugin | undefined>;

  /**
   * Like `fullPlugin`, but resolves to `undefined` if the plugin has no backend.
   * Unlike `mainPlugins()`, only imports this one plugin's backend.
   * Main process only.
   */
  export const mainPlugin: (id: string) => Promise<LazyPlugin | undefined>;

  /**
   * Ids of the plugins that have a backend, without importing any backend.
   * Main process only.
   */
  export const mainPluginNames: () => Promise<string[]>;
}
