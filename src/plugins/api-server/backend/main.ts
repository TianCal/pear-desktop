import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import { serve, upgradeWebSocket } from '@hono/node-server';
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono as Hono } from '@hono/zod-openapi';
import { ipcMain } from 'electron';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import { type WebSocket, WebSocketServer } from 'ws';

import { APPLICATION_NAME } from '@/i18n';
import { registerCallback } from '@/providers/song-info';
import { createBackend } from '@/utils';

import { API_VERSION } from './api-version';
import { registerAuth, registerControl, registerWebsocket } from './routes';
import { JWTPayloadSchema } from './scheme';

import { type APIServerConfig, AuthStrategy } from '../config';

import type { BackendType } from './types';
import type {
  LikeType,
  RepeatMode,
  VolumeState,
} from '@/types/datahost-get-state';
import type { MiddlewareHandler } from 'hono';

const HEARTBEAT_INTERVAL_MS = 30_000;

const needsRestart = (old: APIServerConfig, config: APIServerConfig) =>
  old.hostname !== config.hostname ||
  old.port !== config.port ||
  old.useHttps !== config.useHttps ||
  old.certPath !== config.certPath ||
  old.keyPath !== config.keyPath;

// Live WS clients were authenticated against the old auth settings.
const authChanged = (old: APIServerConfig, config: APIServerConfig) =>
  old.authStrategy !== config.authStrategy ||
  old.secret !== config.secret ||
  old.authorizedClients.some((id) => !config.authorizedClients.includes(id));

export const backend = createBackend<BackendType, APIServerConfig>({
  async start(ctx) {
    const config = await ctx.getConfig();
    this.setCachedConfig(config);
    this.oldConfig = config;
    this.cleanups = [];

    this.init(ctx);
    this.cleanups.push(
      registerCallback((songInfo) => {
        this.songInfo = songInfo;
      }),
    );

    const on = <A extends unknown[]>(
      channel: string,
      listener: (...args: A) => void,
    ) => {
      const wrapped = (_: Electron.IpcMainEvent, ...args: unknown[]) =>
        listener(...(args as A));
      ipcMain.on(channel, wrapped);
      this.cleanups.push(() => ipcMain.removeListener(channel, wrapped));
    };

    on('peard:player-api-loaded', () => {
      ctx.ipc.send('peard:setup-seeked-listener');
      ctx.ipc.send('peard:setup-time-changed-listener');
      ctx.ipc.send('peard:setup-repeat-changed-listener');
      ctx.ipc.send('peard:setup-like-changed-listener');
      ctx.ipc.send('peard:setup-volume-changed-listener');
      ctx.ipc.send('peard:setup-shuffle-changed-listener');
    });

    on('peard:repeat-changed', (mode: RepeatMode) => {
      this.currentRepeatMode = mode;
    });

    on('peard:volume-changed', (newVolumeState: VolumeState) => {
      this.volumeState = newVolumeState;
    });

    this.run(config);
  },
  stop() {
    for (const cleanup of this.cleanups.splice(0)) {
      try {
        cleanup();
      } catch (err) {
        console.error(err);
      }
    }
    this.end();
  },
  onConfigChange(config) {
    const old = this.oldConfig;
    this.setCachedConfig(config);
    this.oldConfig = config;

    if (old && !needsRestart(old, config)) {
      if (authChanged(old, config)) this.closeSockets(1008, 'Auth changed');
      return;
    }

    this.end();
    this.run(config);
  },

  // Custom
  cleanups: [],
  setCachedConfig(config) {
    this.config = config;
    this.authorizedClients = new Set(config.authorizedClients);
  },
  getJwtMiddleware(secret) {
    if (this.jwtMiddleware?.secret !== secret) {
      this.jwtMiddleware = {
        secret,
        handler: jwt({ secret, alg: 'HS256' }),
      };
    }
    return this.jwtMiddleware.handler;
  },
  closeSockets(code, reason) {
    this.wss?.clients.forEach((socket) => {
      try {
        socket.close(code, reason);
      } catch {
        socket.terminate();
      }
    });
  },
  // Custom
  init(backendCtx) {
    this.app = new Hono();

    this.app.use('*', cors());

    // for web remote control
    this.app.use('*', async (ctx, next) => {
      ctx.header('Access-Control-Allow-Private-Network', 'true');
      await next();
    });

    // middlewares
    // Config is cached (kept fresh by onConfigChange) instead of being read
    // from the store on every request.
    const getCachedConfig = async () => {
      if (!this.config) this.setCachedConfig(await backendCtx.getConfig());
      return this.config!;
    };

    const jwtGuard: MiddlewareHandler = async (ctx, next) => {
      if (ctx.req.path.endsWith(`${API_VERSION}/ws`)) {
        return await next();
      }

      const config = await getCachedConfig();

      if (config.authStrategy !== AuthStrategy.NONE) {
        return await this.getJwtMiddleware(config.secret)(ctx, next);
      }
      return await next();
    };
    this.app.use('/api/*', jwtGuard);
    this.app.use('/api/*', async (ctx, next) => {
      if (ctx.req.path.endsWith(`${API_VERSION}/ws`)) {
        return await next();
      }

      const config = await getCachedConfig();
      if (config.authStrategy === AuthStrategy.NONE) {
        return await next();
      }

      const result = await JWTPayloadSchema.spa(await ctx.get('jwtPayload'));

      let isAuthorized =
        result.success && !!this.authorizedClients?.has(result.data.id);
      if (result.success && !isAuthorized) {
        // A client may have just been authorized via /auth; re-read the
        // store in case the change has not reached onConfigChange yet.
        this.setCachedConfig(await backendCtx.getConfig());
        isAuthorized =
          this.config?.authStrategy === AuthStrategy.NONE ||
          !!this.authorizedClients?.has(result.data.id);
      }
      if (!isAuthorized) {
        ctx.status(401);
        return ctx.body('Unauthorized');
      }

      return await next();
    });

    // routes
    registerControl(
      this.app,
      backendCtx,
      () => this.songInfo,
      () => this.currentRepeatMode,
      () =>
        backendCtx.window.webContents.executeJavaScript(
          'document.querySelector("#like-button-renderer")?.likeStatus',
        ) as Promise<LikeType>,
      () => this.volumeState,
    );
    registerAuth(this.app, backendCtx);
    this.cleanups.push(
      registerWebsocket(this.app, backendCtx, upgradeWebSocket),
    );

    // swagger
    this.app.openAPIRegistry.registerComponent(
      'securitySchemes',
      'bearerAuth',
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    );
    this.app.doc('/doc', {
      openapi: '3.1.0',
      info: {
        version: '1.0.0',
        title: `${APPLICATION_NAME} API Server`,
        description:
          'Note: You need to get an access token using the `/auth/{id}` endpoint first to call any API endpoints under `/api`.',
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    });

    this.app.get('/swagger', swaggerUI({ url: '/doc' }));
  },
  run(config) {
    if (!this.app) return;

    try {
      const wss = new WebSocketServer({ noServer: true });
      const serveOptions =
        config.useHttps && config.certPath && config.keyPath
          ? {
              fetch: this.app.fetch.bind(this.app),
              port: config.port,
              hostname: config.hostname,
              createServer: createHttpsServer,
              serverOptions: {
                key: readFileSync(config.keyPath),
                cert: readFileSync(config.certPath),
              },
              websocket: { server: wss },
            }
          : {
              fetch: this.app.fetch.bind(this.app),
              port: config.port,
              hostname: config.hostname,
              createServer: createHttpServer,
              websocket: { server: wss },
            };

      this.server = serve(serveOptions);
      this.wss = wss;

      // Heartbeat: drop sockets that did not answer the previous ping.
      const alive = new WeakSet<WebSocket>();
      wss.on('connection', (socket) => {
        alive.add(socket);
        socket.on('pong', () => alive.add(socket));
      });
      this.heartbeat = setInterval(() => {
        wss.clients.forEach((socket) => {
          if (!alive.has(socket)) {
            socket.terminate();
            return;
          }
          alive.delete(socket);
          try {
            socket.ping();
          } catch {
            socket.terminate();
          }
        });
      }, HEARTBEAT_INTERVAL_MS);
    } catch (err) {
      console.error(err);
    }
  },
  end() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;

    this.closeSockets(1001, 'Server shutting down');
    this.wss = undefined;

    const server = this.server;
    this.server = undefined;
    server?.close();
    if (server && 'closeAllConnections' in server) {
      server.closeAllConnections();
    }
  },
});
