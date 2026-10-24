import { createRoute, z } from '@hono/zod-openapi';
import { app as electronApp, ipcMain } from 'electron';
import { verify } from 'hono/jwt';

import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { LoggerPrefix } from '@/utils';

import { AuthStrategy, type APIServerConfig } from '../../config';
import { API_VERSION } from '../api-version';
import { JWTPayloadSchema } from '../scheme';

import type { HonoApp } from '../types';
import type { BackendContext } from '@/types/contexts';
import type { RepeatMode, VolumeState } from '@/types/datahost-get-state';
import type { WebSocketLike, upgradeWebSocket } from '@hono/node-server';
import type { Context, Next } from 'hono';
import type { WSContext } from 'hono/ws';

enum DataTypes {
  PlayerInfo = 'PLAYER_INFO',
  VideoChanged = 'VIDEO_CHANGED',
  PlayerStateChanged = 'PLAYER_STATE_CHANGED',
  PositionChanged = 'POSITION_CHANGED',
  VolumeChanged = 'VOLUME_CHANGED',
  RepeatChanged = 'REPEAT_CHANGED',
  ShuffleChanged = 'SHUFFLE_CHANGED',
}

type PlayerState = {
  song?: SongInfo;
  isPlaying: boolean;
  muted: boolean;
  position: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
};

export const register = (
  app: HonoApp,
  { getConfig }: BackendContext<APIServerConfig>,
  uws: typeof upgradeWebSocket,
) => {
  let volumeState: VolumeState | undefined = undefined;
  let repeat: RepeatMode = 'NONE';
  let shuffle = false;
  let lastSongInfo: SongInfo | undefined = undefined;

  const sockets = new Set<WSContext<WebSocketLike>>();
  const cleanups: (() => void)[] = [];
  let lastSentPosition: number | undefined = undefined;

  const send = (type: DataTypes, state: Partial<PlayerState>) => {
    if (type === DataTypes.PositionChanged) {
      // Skip ticks that do not move the position
      if (state.position === lastSentPosition) return;
    }
    if (state.position !== undefined) lastSentPosition = state.position;

    if (sockets.size === 0) return;

    // Serialize once per broadcast, not once per socket
    const message = JSON.stringify({ type, ...state });
    sockets.forEach((socket) => {
      try {
        socket.send(message);
      } catch (err) {
        console.error(LoggerPrefix, 'WebSocket send failed:', err);
      }
    });
  };

  const createPlayerState = ({
    songInfo,
    volumeState,
    repeat,
    shuffle,
  }: {
    songInfo?: SongInfo;
    volumeState?: VolumeState;
    repeat: RepeatMode;
    shuffle: boolean;
  }): PlayerState => ({
    song: songInfo,
    isPlaying: songInfo ? !songInfo.isPaused : false,
    muted: volumeState?.isMuted ?? false,
    position: songInfo?.elapsedSeconds ?? 0,
    volume: volumeState?.state ?? 100,
    repeat,
    shuffle,
  });

  const onBeforeQuit = () => {
    send(DataTypes.PlayerStateChanged, {
      isPlaying: false,
      position: lastSongInfo?.elapsedSeconds ?? 0,
    });
  };
  electronApp.once('before-quit', onBeforeQuit);
  cleanups.push(() => electronApp.removeListener('before-quit', onBeforeQuit));

  const on = <A extends unknown[]>(
    channel: string,
    listener: (...args: A) => void,
  ) => {
    const wrapped = (_: Electron.IpcMainEvent, ...args: unknown[]) =>
      listener(...(args as A));
    ipcMain.on(channel, wrapped);
    cleanups.push(() => ipcMain.removeListener(channel, wrapped));
  };

  const unregisterSongInfo = registerCallback((songInfo, event) => {
    if (event === SongInfoEvent.VideoSrcChanged) {
      send(DataTypes.VideoChanged, { song: songInfo, position: 0 });
    }

    if (event === SongInfoEvent.PlayOrPaused) {
      send(DataTypes.PlayerStateChanged, {
        isPlaying: !(songInfo?.isPaused ?? true),
        position: songInfo.elapsedSeconds,
      });
    }

    if (event === SongInfoEvent.TimeChanged) {
      send(DataTypes.PositionChanged, { position: songInfo.elapsedSeconds });
    }

    lastSongInfo = { ...songInfo };
  });
  cleanups.push(unregisterSongInfo);

  on('peard:volume-changed', (newVolumeState: VolumeState) => {
    volumeState = newVolumeState;
    send(DataTypes.VolumeChanged, {
      volume: volumeState.state,
      muted: volumeState.isMuted,
    });
  });

  on('peard:repeat-changed', (mode: RepeatMode) => {
    repeat = mode;
    send(DataTypes.RepeatChanged, { repeat });
  });

  on('peard:seeked', (t: number) => {
    send(DataTypes.PositionChanged, { position: t });
  });

  on('peard:shuffle-changed', (newShuffle: boolean) => {
    shuffle = newShuffle;
    send(DataTypes.ShuffleChanged, { shuffle });
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: `/api/${API_VERSION}/ws`,
      summary: 'websocket endpoint',
      description: 'WebSocket endpoint for real-time updates',
      request: {
        query: z.object({
          token: z
            .string()
            .openapi({
              description:
                'Authentication token. Required when the API server authStrategy is not NONE; optional otherwise.',
            })
            .optional(),
        }),
      },
      responses: {
        101: {
          description: 'Switching Protocols',
        },
      },
    }),
    uws((ctx) => ({
      async onOpen(_, ws) {
        const config = await getConfig();

        if (config.authStrategy !== AuthStrategy.NONE) {
          const token = ctx.req.query('token');

          if (!token) {
            ws.close(1008, 'Unauthorized');
            return;
          }

          try {
            const payload = await verify(token, config.secret, 'HS256');
            const parsedPayload =
              await JWTPayloadSchema.safeParseAsync(payload);

            if (
              !parsedPayload.success ||
              !config.authorizedClients.includes(parsedPayload.data.id)
            ) {
              ws.close(1008, 'Unauthorized');
              return;
            }
          } catch (err) {
            console.error(
              LoggerPrefix,
              'WebSocket authentication failed:',
              err,
            );
            ws.close(1008, 'Unauthorized');
            return;
          }
        }

        sockets.add(ws);

        ws.send(
          JSON.stringify({
            type: DataTypes.PlayerInfo,
            ...createPlayerState({
              songInfo: lastSongInfo,
              volumeState,
              repeat,
              shuffle,
            }),
          }),
        );
      },

      onClose(_, ws) {
        sockets.delete(ws);
      },
    })) as (ctx: Context, next: Next) => Promise<Response>,
  );

  return () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    sockets.clear();
  };
};
