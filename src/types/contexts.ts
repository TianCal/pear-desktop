import type { PluginConfig } from '@/types/plugins';
import type {
  IpcMain,
  IpcRenderer,
  WebContents,
  BrowserWindow,
} from 'electron';

export interface BaseContext<Config extends PluginConfig> {
  getConfig: () => Promise<Config> | Config;
  setConfig: (conf: Partial<Omit<Config, 'enabled'>>) => Promise<void> | void;
}

export interface BackendContext<
  Config extends PluginConfig,
> extends BaseContext<Config> {
  ipc: {
    send: WebContents['send'];
    /**
     * Registers an `ipcMain.handle` handler. It is removed automatically when
     * the plugin is unloaded. Returns a disposer that removes it early.
     */
    handle: (event: string, listener: CallableFunction) => () => void;
    /**
     * Registers an `ipcMain.on` listener. It is removed automatically when
     * the plugin is unloaded. Returns a disposer that removes it early.
     */
    on: (event: string, listener: CallableFunction) => () => void;
    removeHandler: IpcMain['removeHandler'];
  };

  window: BrowserWindow;
}

export interface MenuContext<
  Config extends PluginConfig,
> extends BaseContext<Config> {
  window: BrowserWindow;
  refresh: () => Promise<void> | void;
}

/* oxlint-disable typescript/no-empty-object-type */
export interface PreloadContext<
  Config extends PluginConfig,
> extends BaseContext<Config> {}
/* oxlint-enable typescript/no-empty-object-type */

export interface RendererContext<
  Config extends PluginConfig,
> extends BaseContext<Config> {
  ipc: {
    send: IpcRenderer['send'];
    invoke: IpcRenderer['invoke'];
    /**
     * Registers an IPC listener. It stops firing automatically when the
     * plugin is unloaded. Returns a disposer that stops it early.
     */
    on: (event: string, listener: CallableFunction) => () => void;
    removeAllListeners: (event: string) => void;
  };
}
