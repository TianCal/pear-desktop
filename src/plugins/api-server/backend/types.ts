import { type serve } from '@hono/node-server';
import { type OpenAPIHono as Hono } from '@hono/zod-openapi';

import type { APIServerConfig } from '../config';
import type { SongInfo } from '@/providers/song-info';
import type { BackendContext } from '@/types/contexts';
import type { RepeatMode, VolumeState } from '@/types/datahost-get-state';
import type { MiddlewareHandler } from 'hono';
import type { WebSocketServer } from 'ws';

export type HonoApp = Hono;
export type BackendType = {
  app?: HonoApp;
  server?: ReturnType<typeof serve>;
  wss?: WebSocketServer;
  heartbeat?: ReturnType<typeof setInterval>;
  oldConfig?: APIServerConfig;
  /** Cached config, refreshed in onConfigChange. */
  config?: APIServerConfig;
  authorizedClients?: Set<string>;
  jwtMiddleware?: { secret: string; handler: MiddlewareHandler };
  /** Undo functions for listeners registered in start()/init(). */
  cleanups: (() => void)[];
  songInfo?: SongInfo;
  currentRepeatMode?: RepeatMode;
  volumeState?: VolumeState;

  init: (ctx: BackendContext<APIServerConfig>) => void;
  run: (config: APIServerConfig) => void;
  end: () => void;
  setCachedConfig: (config: APIServerConfig) => void;
  getJwtMiddleware: (secret: string) => MiddlewareHandler;
  closeSockets: (code: number, reason: string) => void;
};
