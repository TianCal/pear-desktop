import { createRoute, z } from '@hono/zod-openapi';

import {
  getSongControls,
  RendererRequestError,
  type SlimQueueResponse,
} from '@/providers/song-controls';
import {
  LikeType,
  type RepeatMode,
  type VolumeState,
} from '@/types/datahost-get-state';

import { API_VERSION } from '../api-version';
import {
  AddSongToQueueSchema,
  BrowseParamsSchema,
  GoBackSchema,
  GoForwardScheme,
  LibraryPlaylistsQuerySchema,
  MoveSongInQueueSchema,
  PlaylistParamsSchema,
  PlaySongSchema,
  QueueParamsSchema,
  SearchSchema,
  SeekSchema,
  SetFullscreenSchema,
  SetQueueIndexSchema,
  SetVolumeSchema,
  SongInfoSchema,
  SwitchRepeatSchema,
  type ResponseSongInfo,
} from '../scheme';

import type { APIServerConfig } from '../../config';
import type { HonoApp } from '../types';
import type { SongInfo } from '@/providers/song-info';
import type { BackendContext } from '@/types/contexts';
import type { QueueResponse } from '@/types/music-player-desktop-internal';
import type { Context } from 'hono';

const routes = {
  previous: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/previous`,
    summary: 'play previous song',
    description: 'Plays the previous song in the queue',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  next: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/next`,
    summary: 'play next song',
    description: 'Plays the next song in the queue',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  play: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/play`,
    summary: 'Play',
    description: 'Change the state of the player to play',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  pause: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/pause`,
    summary: 'Pause',
    description: 'Change the state of the player to pause',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  togglePlay: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/toggle-play`,
    summary: 'Toggle play/pause',
    description:
      'Change the state of the player to play if paused, or pause if playing',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  getLikeState: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/like-state`,
    summary: 'get like state',
    description: 'Get the current like state',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              state: z.enum(LikeType).nullable(),
            }),
          },
        },
      },
    },
  }),
  like: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/like`,
    summary: 'like song',
    description: 'Set the current song as liked',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  dislike: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/dislike`,
    summary: 'dislike song',
    description: 'Set the current song as disliked',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  seekTo: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/seek-to`,
    summary: 'seek',
    description: 'Seek to a specific time in the current song',
    request: {
      body: {
        description: 'seconds to seek to',
        content: {
          'application/json': {
            schema: SeekSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  goBack: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/go-back`,
    summary: 'go back',
    description: 'Move the current song back by a number of seconds',
    request: {
      body: {
        description: 'seconds to go back',
        content: {
          'application/json': {
            schema: GoBackSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),

  goForward: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/go-forward`,
    summary: 'go forward',
    description: 'Move the current song forward by a number of seconds',
    request: {
      body: {
        description: 'seconds to go forward',
        content: {
          'application/json': {
            schema: GoForwardScheme,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  getShuffleState: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/shuffle`,
    summary: 'get shuffle state',
    description: 'Get the current shuffle state',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              state: z.boolean().nullable(),
            }),
          },
        },
      },
      503: {
        description: 'Player window is not available',
      },
      504: {
        description: 'Player did not respond in time',
      },
    },
  }),
  shuffle: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/shuffle`,
    summary: 'shuffle',
    description: 'Shuffle the queue',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  repeatMode: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/repeat-mode`,
    summary: 'get current repeat mode',
    description: 'Get the current repeat mode (NONE, ALL, ONE)',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              mode: z.enum(['ONE', 'NONE', 'ALL']).nullable(),
            }),
          },
        },
      },
    },
  }),
  switchRepeat: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/switch-repeat`,
    summary: 'switch repeat',
    description: 'Switch the repeat mode',
    request: {
      body: {
        description: 'number of times to click the repeat button',
        content: {
          'application/json': {
            schema: SwitchRepeatSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  setVolume: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/volume`,
    summary: 'set volume',
    description: 'Set the volume of the player',
    request: {
      body: {
        description: 'volume to set',
        content: {
          'application/json': {
            schema: SetVolumeSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  getVolumeState: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/volume`,
    summary: 'get volume state',
    description: 'Get the current volume state of the player',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              state: z.number(),
              isMuted: z.boolean(),
            }),
          },
        },
      },
    },
  }),
  setFullscreen: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/fullscreen`,
    summary: 'set fullscreen',
    description: 'Set the fullscreen state of the player',
    request: {
      body: {
        description: 'fullscreen state',
        content: {
          'application/json': {
            schema: SetFullscreenSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  toggleMute: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/toggle-mute`,
    summary: 'toggle mute',
    description: 'Toggle the mute state of the player',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),

  getFullscreenState: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/fullscreen`,
    summary: 'get fullscreen state',
    description: 'Get the current fullscreen state',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              state: z.boolean(),
            }),
          },
        },
      },
      503: {
        description: 'Player window is not available',
      },
      504: {
        description: 'Player did not respond in time',
      },
    },
  }),
  oldQueueInfo: createRoute({
    deprecated: true,
    method: 'get',
    path: `/api/${API_VERSION}/queue-info`,
    summary: 'get current queue info',
    description: 'Get the current queue info',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({}),
          },
        },
      },
      204: {
        description: 'No queue info',
      },
      503: {
        description: 'Player window is not available',
      },
      504: {
        description: 'Player did not respond in time',
      },
    },
  }),
  oldSongInfo: createRoute({
    deprecated: true,
    method: 'get',
    path: `/api/${API_VERSION}/song-info`,
    summary: 'get current song info',
    description: 'Get the current song info',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: SongInfoSchema,
          },
        },
      },
      204: {
        description: 'No song info',
      },
    },
  }),
  songInfo: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/song`,
    summary: 'get current song info',
    description: 'Get the current song info',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: SongInfoSchema,
          },
        },
      },
      204: {
        description: 'No song info',
      },
    },
  }),
  nextSongInfo: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/queue/next`,
    summary: 'get next song info',
    description:
      'Get information about the next song in the queue (relative index +1)',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: SongInfoSchema,
          },
        },
      },
      204: {
        description: 'No next song in queue',
      },
      503: {
        description: 'Player window is not available',
      },
      504: {
        description: 'Player did not respond in time',
      },
    },
  }),
  queueInfo: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/queue`,
    summary: 'get current queue info',
    description:
      'Get the current queue info. Pass `?slim=true` for a lightweight list of `{ index, videoId, title, artist, thumbnail, duration, selected }` items instead of the raw player renderers.',
    request: {
      query: z.object({
        slim: z.string().optional().openapi({
          description:
            '`true` or `1` returns a lightweight queue (`{ items, total, selectedIndex, autoPlaying }`).',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({}),
          },
        },
      },
      204: {
        description: 'No queue info',
      },
      503: {
        description: 'Player window is not available',
      },
      504: {
        description: 'Player did not respond in time',
      },
    },
  }),
  addSongToQueue: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/queue`,
    summary: 'add song to queue',
    description: 'Add a song to the queue',
    request: {
      body: {
        description: 'video id of the song to add',
        content: {
          'application/json': {
            schema: AddSongToQueueSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  playSong: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/queue/play`,
    summary: 'play a song now',
    description:
      'Insert a song after the playing track and start playing it, in one step. Replies with its queue slot and the video id in it, which YouTube Music may have resolved to another.',
    request: {
      body: {
        description: 'video id of the song to play',
        content: {
          'application/json': {
            schema: PlaySongSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({ index: z.number(), videoId: z.string() }),
          },
        },
      },
      400: {
        description: 'Not a video id',
      },
      422: {
        description: 'YouTube Music gave nothing to queue for that video',
      },
      503: {
        description:
          'Player window is not available, or YouTube Music could not be asked',
      },
      504: {
        description: 'Player did not respond in time',
      },
    },
  }),
  moveSongInQueue: createRoute({
    method: 'patch',
    path: `/api/${API_VERSION}/queue/{index}`,
    summary: 'move song in queue',
    description: 'Move a song in the queue',
    request: {
      params: QueueParamsSchema,
      body: {
        description: 'index to move the song to',
        content: {
          'application/json': {
            schema: MoveSongInQueueSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  removeSongFromQueue: createRoute({
    method: 'delete',
    path: `/api/${API_VERSION}/queue/{index}`,
    summary: 'remove song from queue',
    description: 'Remove a song from the queue',
    request: {
      params: QueueParamsSchema,
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  setQueueIndex: createRoute({
    method: 'patch',
    path: `/api/${API_VERSION}/queue`,
    summary: 'set queue index',
    description: 'Set the current index of the queue',
    request: {
      body: {
        description: 'index to move the song to',
        content: {
          'application/json': {
            schema: SetQueueIndexSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  clearQueue: createRoute({
    method: 'delete',
    path: `/api/${API_VERSION}/queue`,
    summary: 'clear queue',
    description: 'Clear the queue',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  search: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/search`,
    summary: 'search for a song',
    description: 'search for a song',
    request: {
      body: {
        description: 'search query',
        content: {
          'application/json': {
            schema: SearchSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({}),
          },
        },
      },
      503: {
        description: 'Player window is not available or search failed',
        content: {
          'application/json': {
            schema: z.object({ error: z.string() }),
          },
        },
      },
      504: {
        description: 'Player did not respond in time',
        content: {
          'application/json': {
            schema: z.object({ error: z.string() }),
          },
        },
      },
    },
  }),
  libraryPlaylists: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/library/playlists`,
    summary: 'get library playlists',
    description:
      "Get the playlists in the signed-in account's library (raw YouTube Music browse response). Pass the continuation token from a previous response to get the next page.",
    request: {
      query: LibraryPlaylistsQuerySchema,
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({}),
          },
        },
      },
      204: {
        description: 'YouTube Music could not fetch the library page',
      },
      503: {
        description: 'Player window is not available',
      },
      504: {
        description: 'Player did not respond in time',
      },
    },
  }),
  browse: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/browse/{browseId}`,
    summary: 'get a browse page',
    description:
      "Get a YouTube Music page such as an artist's (raw YouTube Music browse response) without navigating the window. Artist pages take the artist's channel id.",
    request: {
      params: BrowseParamsSchema,
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({}),
          },
        },
      },
      204: {
        description: 'YouTube Music could not fetch the page',
      },
      400: {
        description: 'Not a browse id',
      },
      503: {
        description: 'Player window is not available',
      },
      504: {
        description: 'Player did not respond in time',
      },
    },
  }),
  playPlaylist: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/library/playlists/{playlistId}/play`,
    summary: 'play a playlist',
    description:
      'Replace the queue with a playlist and start playing it from the first song. Accepts a playlist id or its "VL"-prefixed browse id.',
    request: {
      params: PlaylistParamsSchema,
    },
    responses: {
      204: {
        description: 'Success',
      },
      404: {
        description: 'Playlist could not be loaded or is empty',
      },
      503: {
        description: 'Player window is not available',
      },
      504: {
        description: 'Player did not respond in time',
      },
    },
  }),
};

type PromiseOrValue<T> = T | Promise<T>;

/** Map a failed renderer request to 503 (unavailable) / 504 (timeout). */
const rendererError = (ctx: Context, err: unknown) => {
  if (err instanceof RendererRequestError) {
    ctx.status(err.reason === 'timeout' ? 504 : 503);
    return ctx.body(null);
  }
  throw err;
};

/**
 * Share one in-flight promise between concurrent callers. `reset` makes the
 * next caller start a fresh request, for use after the data has changed.
 */
const coalesce = <T>(fn: () => Promise<T>) => {
  let inflight: Promise<T> | undefined;
  const get = () =>
    (inflight ??= fn().finally(() => {
      inflight = undefined;
    }));
  return Object.assign(get, {
    reset: () => {
      inflight = undefined;
    },
  });
};

export const register = (
  app: HonoApp,
  { window }: BackendContext<APIServerConfig>,
  songInfoGetter: () => PromiseOrValue<SongInfo | undefined>,
  repeatModeGetter: () => PromiseOrValue<RepeatMode | undefined>,
  likeTypeGetter: () => PromiseOrValue<LikeType | undefined>,
  volumeStateGetter: () => PromiseOrValue<VolumeState | undefined>,
) => {
  const controller = getSongControls(window);

  app.openapi(routes.previous, (ctx) => {
    controller.previous();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.next, (ctx) => {
    controller.next();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.play, (ctx) => {
    controller.play();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.pause, (ctx) => {
    controller.pause();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.togglePlay, (ctx) => {
    controller.playPause();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.getLikeState, async (ctx) => {
    ctx.status(200);
    return ctx.json({ state: (await likeTypeGetter()) ?? null });
  });
  app.openapi(routes.like, (ctx) => {
    controller.like();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.dislike, (ctx) => {
    controller.dislike();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.seekTo, (ctx) => {
    const { seconds } = ctx.req.valid('json');
    controller.seekTo(seconds);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.goBack, (ctx) => {
    const { seconds } = ctx.req.valid('json');
    controller.goBack(seconds);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.goForward, (ctx) => {
    const { seconds } = ctx.req.valid('json');
    controller.goForward(seconds);

    ctx.status(204);
    return ctx.body(null);
  });

  app.openapi(routes.getShuffleState, async (ctx) => {
    let isShuffled: boolean;
    try {
      isShuffled = !!(await controller.getShuffleState());
    } catch (err) {
      return rendererError(ctx, err);
    }

    ctx.status(200);
    return ctx.json({ state: isShuffled });
  });

  app.openapi(routes.shuffle, (ctx) => {
    controller.shuffle();

    ctx.status(204);
    return ctx.body(null);
  });

  app.openapi(routes.repeatMode, async (ctx) => {
    ctx.status(200);
    return ctx.json({ mode: (await repeatModeGetter()) ?? null });
  });
  app.openapi(routes.switchRepeat, (ctx) => {
    const { iteration } = ctx.req.valid('json');
    controller.switchRepeat(iteration);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.setVolume, (ctx) => {
    const { volume } = ctx.req.valid('json');
    controller.setVolume(volume);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.getVolumeState, async (ctx) => {
    ctx.status(200);
    return ctx.json(
      (await volumeStateGetter()) ?? { state: 0, isMuted: false },
    );
  });
  app.openapi(routes.setFullscreen, (ctx) => {
    const { state } = ctx.req.valid('json');
    controller.setFullscreen(state);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.toggleMute, (ctx) => {
    controller.muteUnmute();

    ctx.status(204);
    return ctx.body(null);
  });

  app.openapi(routes.getFullscreenState, async (ctx) => {
    let fullscreen: boolean;
    try {
      fullscreen = !!(await controller.getFullscreenState());
    } catch (err) {
      return rendererError(ctx, err);
    }

    ctx.status(200);
    return ctx.json({ state: fullscreen });
  });

  const songInfo = async (ctx: Context) => {
    const info = await songInfoGetter();

    if (!info) {
      ctx.status(204);
      return ctx.body(null);
    }

    const body = { ...info };
    delete body.image;

    ctx.status(200);
    return ctx.json(body satisfies ResponseSongInfo);
  };
  app.openapi(routes.oldSongInfo, songInfo);
  app.openapi(routes.songInfo, songInfo);

  // Queue
  // Concurrent queue requests share one renderer round trip.
  const getQueue = coalesce(() => controller.getQueue());
  const getSlimQueue = coalesce(() => controller.getSlimQueue());
  // A request already in flight was sent before a write, so it would return
  // the queue as it was; later readers must not join it.
  const invalidateQueue = () => {
    getQueue.reset();
    getSlimQueue.reset();
  };

  const queueInfo = async (ctx: Context) => {
    const slim = ctx.req.query('slim');
    let info: QueueResponse | SlimQueueResponse | undefined;
    try {
      info =
        slim === 'true' || slim === '1'
          ? await getSlimQueue()
          : await getQueue();
    } catch (err) {
      return rendererError(ctx, err);
    }

    if (!info) {
      ctx.status(204);
      return ctx.body(null);
    }

    ctx.status(200);
    return ctx.json(info);
  };
  app.openapi(routes.oldQueueInfo, queueInfo);
  app.openapi(routes.queueInfo, queueInfo);

  app.openapi(routes.nextSongInfo, async (ctx) => {
    let queue: QueueResponse | undefined;
    try {
      queue = await getQueue();
    } catch (err) {
      return rendererError(ctx, err);
    }

    if (!queue?.items || queue.items.length === 0) {
      ctx.status(204);
      return ctx.body(null);
    }

    // Find the currently selected song
    const currentIndex = queue.items.findIndex((item) => {
      const renderer =
        item.playlistPanelVideoRenderer ||
        item.playlistPanelVideoWrapperRenderer?.primaryRenderer
          ?.playlistPanelVideoRenderer;
      return renderer?.selected === true;
    });

    // Get the next song (currentIndex + 1)
    const nextIndex = currentIndex + 1;
    if (nextIndex >= queue.items.length) {
      // No next song available
      ctx.status(204);
      return ctx.body(null);
    }

    const nextItem = queue.items[nextIndex];
    const nextRenderer =
      nextItem.playlistPanelVideoRenderer ||
      nextItem.playlistPanelVideoWrapperRenderer?.primaryRenderer
        ?.playlistPanelVideoRenderer;

    if (!nextRenderer) {
      ctx.status(204);
      return ctx.body(null);
    }

    // Extract relevant information similar to SongInfo format
    const nextSongInfo = {
      title: nextRenderer.title?.runs?.[0]?.text,
      videoId: nextRenderer.videoId,
      thumbnail: nextRenderer.thumbnail,
      lengthText: nextRenderer.lengthText,
      shortBylineText: nextRenderer.shortBylineText,
    };

    ctx.status(200);
    return ctx.json(nextSongInfo);
  });

  app.openapi(routes.addSongToQueue, (ctx) => {
    const { videoId, insertPosition } = ctx.req.valid('json');
    controller.addSongToQueue(videoId, insertPosition);
    invalidateQueue();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.playSong, async (ctx) => {
    const { videoId } = ctx.req.valid('json');
    let played: { index: number; videoId?: string };
    try {
      played = await controller.playSong(videoId);
    } catch (err) {
      // A late renderer may still have changed the queue.
      invalidateQueue();
      return rendererError(ctx, err);
    }
    invalidateQueue();

    if (played.index < 0) {
      ctx.status(played.index === -1 ? 422 : 503);
      return ctx.body(null);
    }
    ctx.status(200);
    return ctx.json({
      index: played.index,
      videoId: played.videoId ?? videoId,
    });
  });
  app.openapi(routes.moveSongInQueue, (ctx) => {
    const index = Number(ctx.req.param('index'));
    const { toIndex } = ctx.req.valid('json');
    controller.moveSongInQueue(index, toIndex);
    invalidateQueue();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.removeSongFromQueue, (ctx) => {
    const index = Number(ctx.req.param('index'));
    controller.removeSongFromQueue(index);
    invalidateQueue();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.setQueueIndex, (ctx) => {
    const { index } = ctx.req.valid('json');
    controller.setQueueIndex(index);
    invalidateQueue();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.clearQueue, (ctx) => {
    controller.clearQueue();
    invalidateQueue();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.search, async (ctx) => {
    const { query, params, continuation } = ctx.req.valid('json');
    let response: unknown;
    try {
      response = await controller.search(query, params, continuation);
    } catch (err) {
      if (err instanceof RendererRequestError) {
        return err.reason === 'timeout'
          ? ctx.json({ error: err.message }, 504)
          : ctx.json({ error: err.message }, 503);
      }
      throw err;
    }

    if (response === null || response === undefined) {
      // The renderer could not run the search (player not ready / fetch failed)
      return ctx.json({ error: 'Search failed' }, 503);
    }

    ctx.status(200);
    return ctx.json(response as object);
  });

  // Library
  app.openapi(routes.libraryPlaylists, async (ctx) => {
    const { continuation } = ctx.req.valid('query');
    let response: unknown;
    try {
      response = await controller.getLibraryPlaylists(continuation);
    } catch (err) {
      return rendererError(ctx, err);
    }

    if (!response) {
      ctx.status(204);
      return ctx.body(null);
    }

    ctx.status(200);
    return ctx.json(response as object);
  });
  app.openapi(routes.browse, async (ctx) => {
    const { browseId } = ctx.req.valid('param');
    let response: unknown;
    try {
      response = await controller.browse(browseId);
    } catch (err) {
      return rendererError(ctx, err);
    }

    if (!response) {
      ctx.status(204);
      return ctx.body(null);
    }

    ctx.status(200);
    return ctx.json(response as object);
  });
  app.openapi(routes.playPlaylist, async (ctx) => {
    const { playlistId } = ctx.req.valid('param');
    let ok: boolean;
    try {
      ok = await controller.playPlaylist(playlistId);
    } catch (err) {
      return rendererError(ctx, err);
    }

    ctx.status(ok ? 204 : 404);
    return ctx.body(null);
  });
};
