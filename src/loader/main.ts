import { deepmerge } from 'deepmerge-ts';
import { type BrowserWindow, ipcMain } from 'electron';
import { allPlugins, mainPlugin } from 'virtual:plugins';

import * as config from '@/config';
import { t } from '@/i18n';
import { LoggerPrefix, startPlugin, stopPlugin } from '@/utils';

import type { BackendContext } from '@/types/contexts';
import type { PluginConfig, PluginDef } from '@/types/plugins';

const loadedPluginMap: Record<
  string,
  PluginDef<unknown, unknown, unknown>
> = {};

type IpcMainListener = (
  event: Electron.IpcMainEvent,
  ...args: unknown[]
) => void;

interface PluginIpcRegistrations {
  listeners: Set<{ event: string; listener: IpcMainListener }>;
  // event name -> token of the handler registered through the plugin context
  handlers: Map<string, object>;
}

// Keyed by plugin id, because a new context is created for every start/stop call
const ipcRegistrations: Record<string, PluginIpcRegistrations> = {};

const getIpcRegistrations = (id: string) =>
  (ipcRegistrations[id] ??= { listeners: new Set(), handlers: new Map() });

/**
 * Removes every IPC listener and handler that the plugin registered through
 * its backend context (`ctx.ipc.on` / `ctx.ipc.handle`).
 */
const removePluginIpcRegistrations = (id: string) => {
  const registrations = ipcRegistrations[id];
  if (!registrations) return;

  for (const entry of registrations.listeners) {
    ipcMain.removeListener(entry.event, entry.listener);
  }
  for (const event of registrations.handlers.keys()) {
    ipcMain.removeHandler(event);
  }

  delete ipcRegistrations[id];
};

const createContext = (
  id: string,
  win: BrowserWindow,
): BackendContext<PluginConfig> => ({
  getConfig: async () =>
    deepmerge(
      (await allPlugins())[id].config ?? { enabled: false },
      config.get(`plugins.${id}`) ?? {},
    ) as PluginConfig,
  setConfig: async (newConfig) => {
    config.setPartial(
      `plugins.${id}`,
      newConfig,
      (await allPlugins())[id].config,
    );
  },

  ipc: {
    send: (event: string, ...args: unknown[]) => {
      win.webContents.send(event, ...args);
    },
    handle: (event: string, listener: CallableFunction) => {
      // oxlint-disable-next-line typescript/no-unsafe-return,typescript/no-unsafe-call
      ipcMain.handle(event, (_, ...args: unknown[]) => listener(...args));

      const token = {};
      getIpcRegistrations(id).handlers.set(event, token);

      return () => {
        const registrations = ipcRegistrations[id];
        // Only remove the handler if it is still the one registered here
        if (registrations?.handlers.get(event) !== token) return;
        ipcMain.removeHandler(event);
        registrations.handlers.delete(event);
      };
    },
    on: (event: string, listener: CallableFunction) => {
      const wrapped: IpcMainListener = (_, ...args) => {
        // oxlint-disable-next-line typescript/no-unsafe-call
        listener(...args);
      };
      ipcMain.on(event, wrapped);

      const entry = { event, listener: wrapped };
      getIpcRegistrations(id).listeners.add(entry);

      return () => {
        ipcMain.removeListener(event, wrapped);
        ipcRegistrations[id]?.listeners.delete(entry);
      };
    },
    removeHandler: (event: string) => {
      ipcMain.removeHandler(event);
      ipcRegistrations[id]?.handlers.delete(event);
    },
  },

  window: win,
});

export const forceUnloadMainPlugin = async (
  id: string,
  win: BrowserWindow,
): Promise<void> => {
  const plugin = loadedPluginMap[id];
  if (!plugin) return;

  try {
    const hasStopped = await stopPlugin(id, plugin, {
      ctx: 'backend',
      context: createContext(id, win),
    });
    if (
      hasStopped ||
      (hasStopped === null &&
        typeof plugin.backend !== 'function' &&
        plugin.backend)
    ) {
      delete loadedPluginMap[id];
      removePluginIpcRegistrations(id);
      console.log(
        LoggerPrefix,
        t('common.console.plugins.unloaded', { pluginName: id }),
      );
      return;
    } else {
      // Function-style backends can't be stopped and keep running until
      // restart, so their IPC registrations must stay alive too
      const message = t('common.console.plugins.unload-failed', {
        pluginName: id,
      });
      console.log(LoggerPrefix, message);
      return Promise.reject(new Error(message));
    }
  } catch (err) {
    console.error(
      LoggerPrefix,
      t('common.console.plugins.unload-failed', { pluginName: id }),
    );
    console.trace(err);
    return Promise.reject(err as Error);
  }
};

export const forceLoadMainPlugin = async (
  id: string,
  win: BrowserWindow,
): Promise<void> => {
  // Only imports this plugin's backend (not every plugin's)
  const plugin = await mainPlugin(id);
  if (!plugin) return;

  try {
    const hasStarted = await startPlugin(id, plugin, {
      ctx: 'backend',
      context: createContext(id, win),
    });
    if (
      hasStarted ||
      (hasStarted === null &&
        typeof plugin.backend !== 'function' &&
        plugin.backend)
    ) {
      loadedPluginMap[id] = plugin;
    } else {
      // Don't leak listeners registered before the failure, unless an earlier
      // run of this plugin is still alive and owns them
      if (!(id in loadedPluginMap)) removePluginIpcRegistrations(id);
      const message = t('common.console.plugins.load-failed', {
        pluginName: id,
      });
      console.log(LoggerPrefix, message);
      return Promise.reject(new Error(message));
    }
  } catch (err) {
    if (!(id in loadedPluginMap)) removePluginIpcRegistrations(id);
    console.error(
      LoggerPrefix,
      t('common.console.plugins.initialize-failed', { pluginName: id }),
    );
    console.trace(err);
    return Promise.reject(err as Error);
  }
};

export const loadAllMainPlugins = async (win: BrowserWindow) => {
  console.log(LoggerPrefix, t('common.console.plugins.load-all'));
  const pluginConfigs = config.plugins.getPlugins();
  const queue: Promise<void>[] = [];

  // Iterate the stubs (metadata only), so disabled plugins' backends are
  // never imported. forceLoadMainPlugin skips plugins without a backend.
  for (const [plugin, pluginDef] of Object.entries(await allPlugins())) {
    const config = deepmerge(
      pluginDef.config ?? { enabled: false },
      pluginConfigs[plugin] ?? {},
    );
    if (config.enabled) {
      queue.push(forceLoadMainPlugin(plugin, win));
    } else if (loadedPluginMap[plugin]) {
      queue.push(forceUnloadMainPlugin(plugin, win));
    }
  }

  await Promise.allSettled(queue);
};

export const unloadAllMainPlugins = async (win: BrowserWindow) => {
  for (const id of Object.keys(loadedPluginMap)) {
    await forceUnloadMainPlugin(id, win);
  }
};

export const getLoadedMainPlugin = (
  id: string,
): PluginDef<unknown, unknown, unknown> | undefined => {
  return loadedPluginMap[id];
};

export const getAllLoadedMainPlugins = () => {
  return loadedPluginMap;
};
