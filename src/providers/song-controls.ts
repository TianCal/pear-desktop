// This is used for to control the songs
import { type BrowserWindow, ipcMain } from 'electron';

import { LikeType } from '@/types/datahost-get-state';

import type { QueueResponse } from '@/types/music-player-desktop-internal';

// see protocol-handler.ts
type ArgsType<T> = T | string[] | undefined;

const parseNumberFromArgsType = (args: ArgsType<number>) => {
  if (typeof args === 'number') {
    return args;
  } else if (Array.isArray(args)) {
    return Number(args[0]);
  } else {
    return null;
  }
};

const parseBooleanFromArgsType = (args: ArgsType<boolean>) => {
  if (typeof args === 'boolean') {
    return args;
  } else if (Array.isArray(args)) {
    return args[0] === 'true';
  } else {
    return null;
  }
};

const parseStringFromArgsType = (args: ArgsType<string>) => {
  if (typeof args === 'string') {
    return args;
  } else if (Array.isArray(args)) {
    return args[0];
  } else {
    return null;
  }
};

/** Default time to wait for the renderer to answer a request. */
export const RENDERER_REQUEST_TIMEOUT_MS = 3000;
/** Search goes over the network from the renderer, so it gets more time. */
export const RENDERER_SEARCH_TIMEOUT_MS = 10000;
/** Starting a playlist: a check, a navigation, then waiting for it to land. */
export const RENDERER_PLAY_TIMEOUT_MS = 12000;

/** One queue slot in the lightweight queue representation. */
export interface SlimQueueItem {
  /** Index of the raw queue slot (what `PATCH /queue` takes). */
  index: number;
  videoId: string;
  title: string;
  artist: string;
  /** Largest thumbnail URL offered, if any. */
  thumbnail: string | null;
  /** Formatted duration, e.g. `3:21`; empty when absent. */
  duration: string;
  selected: boolean;
}

export interface SlimQueueResponse {
  items: SlimQueueItem[];
  /** Number of raw queue slots (including ones that name no video). */
  total: number;
  /** Raw index of the selected slot, or -1. */
  selectedIndex: number;
  autoPlaying?: boolean;
}

export class RendererRequestError extends Error {
  constructor(
    public readonly reason: 'timeout' | 'unavailable',
    channel: string,
  ) {
    super(
      reason === 'timeout'
        ? `Renderer did not answer '${channel}' in time`
        : `Renderer is not available for '${channel}'`,
    );
    this.name = 'RendererRequestError';
  }
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingRequests = new Map<string, PendingRequest>();
const replyChannels = new Set<string>();
let requestCounter = 0;

// One listener per reply channel, shared by every request. Replies carry the
// request id as their last argument; replies without a known id (e.g. ones
// requested by other plugins without an id) are ignored here.
const ensureReplyListener = (channel: string) => {
  if (replyChannels.has(channel)) return;
  replyChannels.add(channel);
  ipcMain.on(channel, (_, payload: unknown, requestId?: unknown) => {
    if (typeof requestId !== 'string') return;
    const pending = pendingRequests.get(requestId);
    if (!pending) return;

    pendingRequests.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(payload);
  });
};

/**
 * Send `requestChannel` to the renderer with a unique request id appended to
 * `args`, and resolve with the payload of the matching reply on `replyChannel`.
 * Rejects with a {@link RendererRequestError} on timeout or if the window is gone.
 */
const requestFromRenderer = <T>(
  win: BrowserWindow,
  requestChannel: string,
  replyChannel: string,
  args: unknown[] = [],
  timeoutMs = RENDERER_REQUEST_TIMEOUT_MS,
) =>
  new Promise<T>((resolve, reject) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      reject(new RendererRequestError('unavailable', requestChannel));
      return;
    }

    ensureReplyListener(replyChannel);

    requestCounter = (requestCounter + 1) % Number.MAX_SAFE_INTEGER;
    const requestId = `${requestChannel}#${requestCounter}`;
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new RendererRequestError('timeout', requestChannel));
    }, timeoutMs);

    pendingRequests.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      timer,
    });
    win.webContents.send(requestChannel, ...args, requestId);
  });

export const getSongControls = (win: BrowserWindow) => {
  return {
    // Playback
    previous: () => win.webContents.send('peard:previous-video'),
    next: () => win.webContents.send('peard:next-video'),
    play: () => win.webContents.send('peard:play'),
    pause: () => win.webContents.send('peard:pause'),
    playPause: () => win.webContents.send('peard:toggle-play'),
    like: () => win.webContents.send('peard:update-like', LikeType.Like),
    dislike: () => win.webContents.send('peard:update-like', LikeType.Dislike),
    seekTo: (seconds: ArgsType<number>) => {
      const secondsNumber = parseNumberFromArgsType(seconds);
      if (secondsNumber !== null) {
        win.webContents.send('peard:seek-to', seconds);
      }
    },
    goBack: (seconds: ArgsType<number>) => {
      const secondsNumber = parseNumberFromArgsType(seconds);
      if (secondsNumber !== null) {
        win.webContents.send('peard:seek-by', -secondsNumber);
      }
    },
    goForward: (seconds: ArgsType<number>) => {
      const secondsNumber = parseNumberFromArgsType(seconds);
      if (secondsNumber !== null) {
        win.webContents.send('peard:seek-by', seconds);
      }
    },
    requestShuffleInformation: () => {
      win.webContents.send('peard:get-shuffle');
    },
    /** Correlated request/reply variant of `requestShuffleInformation`. */
    getShuffleState: () =>
      requestFromRenderer<boolean | undefined>(
        win,
        'peard:get-shuffle',
        'peard:get-shuffle-response',
      ),
    shuffle: () => win.webContents.send('peard:shuffle'),
    switchRepeat: (n: ArgsType<number> = 1) => {
      const repeat = parseNumberFromArgsType(n);
      if (repeat !== null) {
        win.webContents.send('peard:switch-repeat', n);
      }
    },
    // General
    setVolume: (volume: ArgsType<number>) => {
      const volumeNumber = parseNumberFromArgsType(volume);
      if (volumeNumber !== null) {
        win.webContents.send('peard:update-volume', volume);
      }
    },
    setFullscreen: (isFullscreen: ArgsType<boolean>) => {
      const isFullscreenValue = parseBooleanFromArgsType(isFullscreen);
      if (isFullscreenValue !== null) {
        win.setFullScreen(isFullscreenValue);
        win.webContents.send(
          'peard:click-fullscreen-button',
          isFullscreenValue,
        );
      }
    },
    requestFullscreenInformation: () => {
      win.webContents.send('peard:get-fullscreen');
    },
    /** Correlated request/reply variant of `requestFullscreenInformation`. */
    getFullscreenState: () =>
      requestFromRenderer<boolean | undefined>(
        win,
        'peard:get-fullscreen',
        'peard:set-fullscreen',
      ),
    requestQueueInformation: () => {
      win.webContents.send('peard:get-queue');
    },
    /** Correlated request/reply variant of `requestQueueInformation`. */
    getQueue: () =>
      requestFromRenderer<QueueResponse | undefined>(
        win,
        'peard:get-queue',
        'peard:get-queue-response',
      ),
    /** Lightweight queue: only the fields a remote client needs per item. */
    getSlimQueue: () =>
      requestFromRenderer<SlimQueueResponse | undefined>(
        win,
        'peard:get-queue-slim',
        'peard:get-queue-slim-response',
      ),
    muteUnmute: () => win.webContents.send('peard:toggle-mute'),
    openSearchBox: () => {
      win.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: '/',
      });
    },
    // Queue
    addSongToQueue: (videoId: string, queueInsertPosition: string) => {
      const videoIdValue = parseStringFromArgsType(videoId);
      if (videoIdValue === null) return;

      win.webContents.send(
        'peard:add-to-queue',
        videoIdValue,
        queueInsertPosition,
      );
    },
    moveSongInQueue: (
      fromIndex: ArgsType<number>,
      toIndex: ArgsType<number>,
    ) => {
      const fromIndexValue = parseNumberFromArgsType(fromIndex);
      const toIndexValue = parseNumberFromArgsType(toIndex);
      if (fromIndexValue === null || toIndexValue === null) return;

      win.webContents.send('peard:move-in-queue', fromIndexValue, toIndexValue);
    },
    removeSongFromQueue: (index: ArgsType<number>) => {
      const indexValue = parseNumberFromArgsType(index);
      if (indexValue === null) return;

      win.webContents.send('peard:remove-from-queue', indexValue);
    },
    setQueueIndex: (index: ArgsType<number>) => {
      const indexValue = parseNumberFromArgsType(index);
      if (indexValue === null) return;

      win.webContents.send('peard:set-queue-index', indexValue);
    },
    clearQueue: () => win.webContents.send('peard:clear-queue'),

    /**
     * Resolves with the raw search response, or `null` if the renderer could
     * not run the search. Rejects with a {@link RendererRequestError} on timeout.
     */
    search: (query: string, params?: string, continuation?: string) =>
      requestFromRenderer<unknown>(
        win,
        'peard:search',
        'peard:search-results',
        [query, params, continuation],
        RENDERER_SEARCH_TIMEOUT_MS,
      ),

    // Library
    /**
     * Resolves with the raw Library > Playlists browse response, or `null` if
     * the renderer could not fetch it. Rejects with a
     * {@link RendererRequestError} on timeout.
     */
    getLibraryPlaylists: (continuation?: string) =>
      requestFromRenderer<unknown>(
        win,
        'peard:get-library-playlists',
        'peard:library-playlists-response',
        [continuation],
        RENDERER_SEARCH_TIMEOUT_MS,
      ),
    /**
     * Resolves with the raw browse response for a page such as an artist's
     * (`UC…`), or `null` if the renderer could not fetch it. Rejects with a
     * {@link RendererRequestError} on timeout.
     */
    browse: (browseId: string) =>
      requestFromRenderer<unknown>(
        win,
        'peard:browse',
        'peard:browse-response',
        [browseId],
        RENDERER_SEARCH_TIMEOUT_MS,
      ),
    /**
     * Resolves true once the playlist is playing, false if it cannot be
     * played. Rejects with a {@link RendererRequestError} on timeout.
     */
    playPlaylist: (playlistId: string) =>
      requestFromRenderer<boolean>(
        win,
        'peard:play-playlist',
        'peard:play-playlist-response',
        [playlistId],
        RENDERER_PLAY_TIMEOUT_MS,
      ),
  };
};
