import i18next from 'i18next';
import { setTheme } from 'mdui/functions/setTheme.js';
import 'mdui/mdui.css';
import 'mdui';

import { loadI18n, setLanguage, t as i18t } from '@/i18n';
import {
  defaultTrustedTypePolicy,
  registerWindowDefaultTrustedTypePolicy,
} from '@/utils/trusted-types';

import {
  createContext,
  forceLoadRendererPlugin,
  forceUnloadRendererPlugin,
  getAllLoadedRendererPlugins,
  getLoadedRendererPlugin,
  loadAllRendererPlugins,
} from './loader/renderer';
import { startingPages } from './providers/extracted-data';
import { setupSongInfo } from './providers/song-info-front';

import type {
  SlimQueueItem,
  SlimQueueResponse,
} from '@/providers/song-controls';
import type { QueueItem } from '@/types/datahost-get-state';
import type { MusicPlayer } from '@/types/music-player';
import type { MusicPlayerAppElement } from '@/types/music-player-app-element';
import type { QueueResponse } from '@/types/music-player-desktop-internal';
import type { PluginConfig } from '@/types/plugins';
import type { QueueElement } from '@/types/queue';
import type { SearchBoxElement } from '@/types/search-box-element';

setTheme('dark');

let api: (Element & MusicPlayer) | null = null;
let isPluginLoaded = false;
let isApiLoaded = false;
let firstDataLoaded = false;

registerWindowDefaultTrustedTypePolicy();

async function listenForApiLoad() {
  if (!isApiLoaded) {
    api = document.querySelector('#movie_player');
    if (api) {
      await onApiLoaded();

      return;
    }
  }
}

/** Queue items come either bare or wrapped; unwrap to the video renderer. */
const queueRenderer = (item?: QueueItem) =>
  item?.playlistPanelVideoRenderer ??
  item?.playlistPanelVideoWrapperRenderer?.primaryRenderer
    .playlistPanelVideoRenderer;

/** Resolves true once `check` passes, or false after `timeout` ms. */
const waitFor = async (check: () => boolean, timeout: number) => {
  const until = performance.now() + timeout;
  while (performance.now() < until) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return check();
};

/** A playlist's tracks in order, as queue items; empty if it has none. */
const fetchPlaylist = async (
  app: MusicPlayerAppElement,
  playlistId: string,
) => {
  const result = await app.networkManager
    .fetch<unknown, { playlistId: string }>('/music/get_queue', { playlistId })
    .catch(() => null);
  if (
    !result ||
    typeof result !== 'object' ||
    !('queueDatas' in result) ||
    !Array.isArray(result.queueDatas)
  ) {
    return [];
  }
  return result.queueDatas
    .map((it) =>
      typeof it === 'object' && it && 'content' in it
        ? (it.content as QueueItem)
        : null,
    )
    .filter((it): it is QueueItem => it !== null);
};

/**
 * Turning shuffle off rebuilds the queue as a window around the playing
 * track: 50 tracks before it and the rest after. On a longer playlist the
 * opening tracks are simply gone, so the queue no longer starts where the
 * playlist does. Put them back in front, which leaves the playing track and
 * playback untouched.
 */
/** Tracks YouTube Music keeps before the playing one when it unshuffles. */
const UNSHUFFLE_WINDOW_BEFORE = 50;

const restorePlaylistHead = async () => {
  const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
  const queue = document.querySelector<QueueElement>('#queue');
  if (!app || !queue) return;
  const store = queue.queue.store.store;
  const firstId = () => queueRenderer(store.getState().queue.items[0])?.videoId;

  const shuffledFirst = firstId();
  const rebuilt = await waitFor(() => {
    const state = store.getState().queue;
    return !state.shuffleEnabled && firstId() !== shuffledFirst;
  }, 5000);
  if (!rebuilt) return;

  const items = store.getState().queue.items.map(queueRenderer);
  const playingAt = items.findIndex((it) => it?.selected);
  // The window keeps this many tracks before the playing one, so with fewer
  // in front of it the queue already starts at the top: nothing to fetch.
  if (playingAt < UNSHUFFLE_WINDOW_BEFORE) return;
  const playlistId =
    items[playingAt]?.navigationEndpoint?.watchEndpoint?.playlistId;
  // Radios and mixes are generated as they go and have no first track.
  if (!playlistId || playlistId.startsWith('RD')) return;

  // When YouTube caps a very long playlist below the window, the window's
  // first track is not in it and nothing is restored.
  const playlist = await fetchPlaylist(app, playlistId);
  const ids = playlist.map((it) => queueRenderer(it)?.videoId);
  // Only where the queue really is this playlist from `start` on — what runs
  // past its end is autoplay. A song can appear twice in a playlist, so try
  // each place the window's first track occurs.
  const start = ids.findIndex(
    (id, at) =>
      at > 0 &&
      id === items[0]?.videoId &&
      items
        .slice(0, ids.length - at)
        .every((it, index) => it?.videoId === ids[at + index]),
  );
  // The queue may have moved on while the playlist was being fetched.
  if (start <= 0 || firstId() !== items[0]?.videoId) return;

  queue.dispatch({
    type: 'ADD_ITEMS',
    payload: {
      nextQueueItemId: store.getState().queue.nextQueueItemId,
      index: 0,
      items: playlist.slice(0, start),
      shuffleEnabled: false,
      shouldAssignIds: true,
    },
  });
};

async function onApiLoaded() {
  // Workaround for macOS traffic lights
  {
    let osType = 'Unknown';
    if (window.electronIs.osx()) {
      osType = 'Macintosh';
    } else if (window.electronIs.windows()) {
      osType = 'Windows';
    } else if (window.electronIs.linux()) {
      osType = 'Linux';
    }
    document.documentElement.setAttribute('data-os', osType);
  }

  // Workaround for #2459
  document
    .querySelector('button.video-button.ytmusic-av-toggle')
    ?.addEventListener('click', () =>
      window.dispatchEvent(new Event('resize')),
    );

  window.ipcRenderer.on('peard:previous-video', () => {
    document
      .querySelector<HTMLElement>('.previous-button.ytmusic-player-bar')
      ?.click();
  });
  window.ipcRenderer.on('peard:next-video', () => {
    document
      .querySelector<HTMLElement>('.next-button.ytmusic-player-bar')
      ?.click();
  });
  window.ipcRenderer.on('peard:play', (_) => {
    api?.playVideo();
  });
  window.ipcRenderer.on('peard:pause', (_) => {
    api?.pauseVideo();
  });
  window.ipcRenderer.on('peard:toggle-play', (_) => {
    if (api?.getPlayerState() === 2) api?.playVideo();
    else api?.pauseVideo();
  });
  window.ipcRenderer.on('peard:seek-to', (_, t: number) => api!.seekTo(t));
  window.ipcRenderer.on('peard:seek-by', (_, t: number) => api!.seekBy(t));
  window.ipcRenderer.on('peard:shuffle', () => {
    const wasShuffled = isShuffled();
    document
      .querySelector<HTMLElement & { queue: { shuffle: () => void } }>(
        'ytmusic-player-bar',
      )
      ?.queue.shuffle();
    if (wasShuffled) restorePlaylistHead().catch(console.error);
  });

  const isShuffled = () => {
    const isShuffled =
      document
        .querySelector<HTMLElement>('ytmusic-player-bar')
        ?.attributes.getNamedItem('shuffle-on') ?? null;

    return isShuffled !== null;
  };

  // Request handlers below take an optional request id as their last argument
  // and echo it back so the main process can match the reply to its request.
  window.ipcRenderer.on('peard:get-shuffle', (_, requestId?: string) => {
    window.ipcRenderer.send(
      'peard:get-shuffle-response',
      isShuffled(),
      requestId,
    );
  });

  window.ipcRenderer.on(
    'peard:update-like',
    (_, status: 'LIKE' | 'DISLIKE' = 'LIKE') => {
      document
        .querySelector<
          HTMLElement & { updateLikeStatus: (status: string) => void }
        >('#like-button-renderer')
        ?.updateLikeStatus(status);
    },
  );
  window.ipcRenderer.on('peard:switch-repeat', (_, repeat = 1) => {
    for (let i = 0; i < repeat; i++) {
      document
        .querySelector<HTMLElement & { onRepeatButtonClick: () => void }>(
          'ytmusic-player-bar',
        )
        ?.onRepeatButtonClick();
    }
  });
  window.ipcRenderer.on('peard:update-volume', (_, volume: number) => {
    document
      .querySelector<HTMLElement & { updateVolume: (volume: number) => void }>(
        'ytmusic-player-bar',
      )
      ?.updateVolume(volume);
  });

  const isFullscreen = () => {
    const isFullscreen =
      document
        .querySelector<HTMLElement>('ytmusic-player-bar')
        ?.attributes.getNamedItem('player-fullscreened') ?? null;

    return isFullscreen !== null;
  };

  const clickFullscreenButton = (isFullscreenValue: boolean) => {
    const fullscreen = isFullscreen();
    if (isFullscreenValue === fullscreen) {
      return;
    }

    if (fullscreen) {
      document.querySelector<HTMLElement>('.exit-fullscreen-button')?.click();
    } else {
      document.querySelector<HTMLElement>('.fullscreen-button')?.click();
    }
  };

  window.ipcRenderer.on('peard:get-fullscreen', (_, requestId?: string) => {
    window.ipcRenderer.send('peard:set-fullscreen', isFullscreen(), requestId);
  });

  window.ipcRenderer.on(
    'peard:click-fullscreen-button',
    (_, fullscreen: boolean | undefined) => {
      clickFullscreenButton(fullscreen ?? false);
    },
  );

  window.ipcRenderer.on('peard:toggle-mute', (_) => {
    document
      .querySelector<HTMLElement & { onVolumeClick: () => void }>(
        'ytmusic-player-bar',
      )
      ?.onVolumeClick();
  });

  window.ipcRenderer.on('peard:get-queue', (_, requestId?: string) => {
    const queue = document.querySelector<QueueElement>('#queue');
    window.ipcRenderer.send(
      'peard:get-queue-response',
      {
        items: queue?.queue.getItems(),
        autoPlaying: queue?.queue.autoPlaying,
        continuation: queue?.queue.continuation,
      } satisfies QueueResponse,
      requestId,
    );
  });

  window.ipcRenderer.on('peard:get-queue-slim', (_, requestId?: string) => {
    const runsText = (value?: { runs?: { text?: string }[] }) =>
      value?.runs?.map((run) => run.text ?? '').join('') ?? '';

    let response: SlimQueueResponse | undefined;
    try {
      const queue = document.querySelector<QueueElement>('#queue');
      const rawItems = queue?.queue.getItems() ?? [];
      const items: SlimQueueItem[] = [];
      let selectedIndex = -1;

      rawItems.forEach((item, index) => {
        const renderer =
          item?.playlistPanelVideoRenderer ??
          item?.playlistPanelVideoWrapperRenderer?.primaryRenderer
            ?.playlistPanelVideoRenderer;
        if (!renderer?.videoId) return;

        const selected = renderer.selected === true;
        if (selected) selectedIndex = index;

        items.push({
          index,
          videoId: renderer.videoId,
          title: runsText(renderer.title).trim(),
          // The byline is "Artist • Album • Year"; keep only the artist.
          artist: runsText(renderer.longBylineText ?? renderer.shortBylineText)
            .split('•')[0]
            .trim(),
          thumbnail: renderer.thumbnail?.thumbnails?.at(-1)?.url ?? null,
          duration: runsText(renderer.lengthText).trim(),
          selected,
        });
      });

      response = {
        items,
        total: rawItems.length,
        selectedIndex,
        autoPlaying: queue?.queue.autoPlaying,
      };
    } catch (err) {
      console.error(err);
    }

    window.ipcRenderer.send(
      'peard:get-queue-slim-response',
      response,
      requestId,
    );
  });

  window.ipcRenderer.on(
    'peard:add-to-queue',
    (_, videoId: string, queueInsertPosition: string) => {
      const queue = document.querySelector<QueueElement>('#queue');
      const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
      if (!app) return;

      const store = queue?.queue.store.store;
      if (!store) return;

      app.networkManager
        .fetch('/music/get_queue', {
          queueContextParams: store.getState().queue.queueContextParams,
          queueInsertPosition,
          videoIds: [videoId],
        })
        .then((result) => {
          if (
            result &&
            typeof result === 'object' &&
            'queueDatas' in result &&
            Array.isArray(result.queueDatas)
          ) {
            const queueItems = store.getState().queue.items;
            const queueItemsLength = queueItems.length ?? 0;
            queue?.dispatch({
              type: 'ADD_ITEMS',
              payload: {
                nextQueueItemId: store.getState().queue.nextQueueItemId,
                index:
                  queueInsertPosition === 'INSERT_AFTER_CURRENT_VIDEO'
                    ? queueItems.findIndex(
                        (it) =>
                          (
                            it.playlistPanelVideoRenderer ||
                            it.playlistPanelVideoWrapperRenderer
                              ?.primaryRenderer.playlistPanelVideoRenderer
                          )?.selected,
                      ) + 1 || queueItemsLength
                    : queueItemsLength,
                items: result.queueDatas
                  .map((it) =>
                    typeof it === 'object' && it && 'content' in it
                      ? it.content
                      : null,
                  )
                  .filter(Boolean),
                shuffleEnabled: false,
                shouldAssignIds: true,
              },
            });
          }
        });
    },
  );
  window.ipcRenderer.on(
    'peard:move-in-queue',
    (_, fromIndex: number, toIndex: number) => {
      const queue = document.querySelector<QueueElement>('#queue');
      queue?.dispatch({
        type: 'MOVE_ITEM',
        payload: {
          fromIndex,
          toIndex,
        },
      });
    },
  );
  window.ipcRenderer.on('peard:remove-from-queue', (_, index: number) => {
    const queue = document.querySelector<QueueElement>('#queue');
    queue?.dispatch({
      type: 'REMOVE_ITEM',
      payload: index,
    });
  });
  window.ipcRenderer.on('peard:set-queue-index', (_, index: number) => {
    const queue = document.querySelector<QueueElement>('#queue');
    queue?.dispatch({
      type: 'SET_INDEX',
      payload: index,
    });
  });
  window.ipcRenderer.on('peard:clear-queue', () => {
    const queue = document.querySelector<QueueElement>('#queue');
    queue?.queue.store.store.dispatch({
      type: 'SET_PLAYER_PAGE_INFO',
      payload: { open: false },
    });
    queue?.dispatch({
      type: 'CLEAR',
    });
  });

  window.ipcRenderer.on(
    'peard:search',
    async (
      _,
      query: string,
      params?: string,
      continuation?: string,
      requestId?: string,
    ) => {
      // Always reply (null on failure) so the requester never hangs.
      let result: unknown = null;
      try {
        const app =
          document.querySelector<MusicPlayerAppElement>('ytmusic-app');
        const searchBox =
          document.querySelector<SearchBoxElement>('ytmusic-search-box');

        if (app && searchBox) {
          result = await app.networkManager.fetch<
            unknown,
            {
              query: string;
              params?: string;
              continuation?: string;
              suggestStats?: unknown;
            }
          >('/search', {
            query,
            params,
            continuation,
            suggestStats: searchBox.getSearchboxStats(),
          });
        }
      } catch (err) {
        console.error(err);
        result = null;
      }

      window.ipcRenderer.send(
        'peard:search-results',
        result ?? null,
        requestId,
      );
    },
  );

  window.ipcRenderer.on(
    'peard:get-library-playlists',
    async (_, continuation?: string, requestId?: string) => {
      // Always reply (null on failure) so the requester never hangs.
      const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
      // FEmusic_liked_playlists is the browse page behind Library > Playlists
      const result = app
        ? await app.networkManager
            .fetch<unknown, { browseId?: string; continuation?: string }>(
              '/browse',
              continuation
                ? { continuation }
                : { browseId: 'FEmusic_liked_playlists' },
            )
            .catch(() => null)
        : null;

      window.ipcRenderer.send(
        'peard:library-playlists-response',
        result ?? null,
        requestId,
      );
    },
  );

  window.ipcRenderer.on(
    'peard:play-playlist',
    async (_, playlistId: string, requestId?: string) => {
      const reply = (ok: boolean) =>
        window.ipcRenderer.send('peard:play-playlist-response', ok, requestId);

      const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
      const queue = document.querySelector<QueueElement>('#queue');
      if (!app || !queue) return reply(false);

      // Library browse ids are the playlist id prefixed with "VL"
      const id = playlistId.startsWith('VL') ? playlistId.slice(2) : playlistId;

      // Navigating to an id YouTube Music cannot play clears the queue and
      // stops what was playing, so only go once it is known to have tracks.
      // (A whole-playlist fetch, but `/next` measured no faster.)
      if ((await fetchPlaylist(app, id)).length === 0) return reply(false);

      // The queue is replaced on arrival, which is how replaying the playlist
      // already playing is told apart from not having navigated yet.
      const store = queue.queue.store.store;
      const before = store.getState().queue.items;

      // Navigate the way YouTube Music's own play buttons do. Swapping the
      // queue's items instead leaves its context and shuffle endpoints on the
      // previous playlist, so shuffling would rebuild the queue from that one.
      app.dispatchEvent(
        new CustomEvent('yt-navigate', {
          bubbles: true,
          composed: true,
          detail: { endpoint: { watchEndpoint: { playlistId: id } } },
        }),
      );

      // Done once the new queue is in and its selected track is from the
      // playlist.
      const ok = await waitFor(() => {
        const { items } = store.getState().queue;
        if (items === before) return false;
        const playing = items.map(queueRenderer).find((it) => it?.selected);
        return playing?.navigationEndpoint?.watchEndpoint?.playlistId === id;
      }, 8000);
      reply(ok);
    },
  );

  const video = document.querySelector('video')!;
  const audioContext = new AudioContext();
  const audioSource = audioContext.createMediaElementSource(video);
  audioSource.connect(audioContext.destination);

  // A running AudioContext renders silence nonstop, which kept a paused,
  // hidden window at ~2% CPU and ~120 wakeups/s. Suspend it once playback
  // has stayed paused for a while (quick toggles and track changes never
  // touch it) and resume on 'play', which fires before playback starts.
  // Always resume: a suspend still in flight reports 'running'.
  const AUDIO_IDLE_MS = 15_000;
  let audioIdleTimer: ReturnType<typeof setTimeout> | undefined;
  const wakeAudio = () => {
    clearTimeout(audioIdleTimer);
    audioIdleTimer = undefined;
    audioContext.resume().catch(console.error);
  };
  const idleAudio = () => {
    clearTimeout(audioIdleTimer);
    audioIdleTimer = setTimeout(() => {
      audioIdleTimer = undefined;
      if (video.paused) audioContext.suspend().catch(console.error);
    }, AUDIO_IDLE_MS);
  };
  video.addEventListener('play', wakeAudio, { passive: true });
  video.addEventListener('pause', idleAudio, { passive: true });
  video.addEventListener('ended', idleAudio, { passive: true });
  if (video.paused) idleAudio();

  for (const [id, plugin] of Object.entries(getAllLoadedRendererPlugins())) {
    if (typeof plugin.renderer !== 'function') {
      await plugin.renderer?.onPlayerApiReady?.call(
        plugin.renderer,
        api!,
        createContext(id),
      );
    }
  }

  if (firstDataLoaded) {
    document.dispatchEvent(
      new CustomEvent('videodatachange', { detail: { name: 'dataloaded' } }),
    );
  }

  const audioCanPlayEventDispatcher = () => {
    document.dispatchEvent(
      new CustomEvent('peard:audio-can-play', {
        detail: {
          audioContext,
          audioSource,
        },
      }),
    );
  };

  const loadstartListener = () => {
    // Emit "audioCanPlay" for each video
    video.addEventListener('canplaythrough', audioCanPlayEventDispatcher, {
      once: true,
    });
  };

  if (video.readyState === 4 /* HAVE_ENOUGH_DATA (loaded) */) {
    audioCanPlayEventDispatcher();
  }

  video.addEventListener('loadstart', loadstartListener, { passive: true });

  window.ipcRenderer.send('peard:player-api-loaded');

  // Navigate to "Starting page"
  const startingPage: string = window.mainConfig.get('options.startingPage');
  if (startingPage && startingPages[startingPage]) {
    document
      .querySelector<MusicPlayerAppElement>('ytmusic-app')
      ?.navigate(startingPages[startingPage]);
  }

  // Remove upgrade button
  if (window.mainConfig.get('options.removeUpgradeButton')) {
    const itemsSelector = 'ytmusic-guide-section-renderer #items';
    let selector = 'ytmusic-guide-entry-renderer:last-child';

    const upgradeBtnIcon = document.querySelector<SVGGElement>(
      'iron-iconset-svg[name="yt-sys-icons"] #\u0079\u006f\u0075\u0074\u0075\u0062\u0065_music_monochrome',
    );
    if (upgradeBtnIcon) {
      const path = upgradeBtnIcon.firstChild as SVGPathElement;
      const data = path.getAttribute('d')!.substring(0, 15);
      selector = `ytmusic-guide-entry-renderer:has(> tp-yt-paper-item > yt-icon path[d^="${data}"])`;
    }

    const styles = document.createElement('style');
    styles.textContent = `${itemsSelector} ${selector} { display: none; }`;

    document.head.appendChild(styles);
  }

  // Hide / Force show like buttons
  const likeButtonsOptions: string = window.mainConfig.get(
    'options.likeButtons',
  );
  if (likeButtonsOptions) {
    const style = document.createElement('style');
    style.textContent = `
      ytmusic-player-bar[is-mweb-player-bar-modernization-enabled] .middle-controls-buttons.ytmusic-player-bar, #like-button-renderer {
        display: ${
          likeButtonsOptions === 'hide' ? 'none' : 'inherit'
        } !important;
      }
      ytmusic-player-bar[is-mweb-player-bar-modernization-enabled] .middle-controls.ytmusic-player-bar {
        justify-content: ${
          likeButtonsOptions === 'hide' ? 'flex-start' : 'space-between'
        } !important;
      }`;

    document.head.appendChild(style);
  }

  // Swap like button order
  if (window.mainConfig.get('options.swapLikeButtonsOrder')) {
    const style = document.createElement('style');
    style.textContent = `
      #like-button-renderer {
        display: inline-flex;
        flex-direction: row-reverse;
      }`;

    document.head.appendChild(style);
  }
}

const definePearTransElements = () => {
  customElements.define(
    'pear-trans',
    class extends HTMLElement {
      connectedCallback() {
        const key = this.getAttribute('key');
        if (key) {
          const targetHtml = i18t(key);
          (this.innerHTML as string | TrustedHTML) = defaultTrustedTypePolicy
            ? defaultTrustedTypePolicy.createHTML(targetHtml)
            : targetHtml;
        }
      }
    },
  );
};

const preload = async () => {
  await loadI18n();
  await setLanguage(window.mainConfig.get('options.language') ?? 'en');
  window.i18n = {
    t: i18t.bind(i18next),
  };
  definePearTransElements();
  if (document.body?.dataset?.os) {
    document.body.dataset.os = navigator.userAgent;
  }
};

const main = async () => {
  await loadAllRendererPlugins();
  isPluginLoaded = true;

  window.ipcRenderer.on('plugin:unload', async (_event, id: string) => {
    await forceUnloadRendererPlugin(id);
  });
  window.ipcRenderer.on('plugin:enable', async (_event, id: string) => {
    await forceLoadRendererPlugin(id);
    if (api) {
      const plugin = getLoadedRendererPlugin(id);
      if (plugin && typeof plugin.renderer !== 'function') {
        await plugin.renderer?.onPlayerApiReady?.call(
          plugin.renderer,
          api,
          createContext(id),
        );
      }
    }
  });

  window.ipcRenderer.on(
    'config-changed',
    (_event, id: string, newConfig: PluginConfig) => {
      const plugin = getAllLoadedRendererPlugins()[id];
      if (plugin && typeof plugin.renderer !== 'function') {
        plugin.renderer?.onConfigChange?.call(plugin.renderer, newConfig);
      }
    },
  );

  // Wait for complete load of the api
  await listenForApiLoad();

  // Blocks the "Are You Still There?" popup by setting the last active time to Date.now every 15min
  setInterval(() => (window._lact = Date.now()), 900_000);

  // Setup back to front logger
  if (window.electronIs.dev()) {
    window.ipcRenderer.on('log', (_event, log: string) => {
      console.log(JSON.parse(log));
    });
  }
};

const initObserver = async () => {
  // check document.documentElement is ready
  await new Promise<void>((resolve) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => resolve(), {
        once: true,
      });
    } else {
      resolve();
    }
  });

  const observer = new MutationObserver(() => {
    const playerApi = document.querySelector<Element & MusicPlayer>(
      '#movie_player',
    );
    if (playerApi) {
      observer.disconnect();

      // Inject song-info provider
      setupSongInfo(playerApi);
      const dataLoadedListener = (name: string) => {
        if (!firstDataLoaded && name === 'dataloaded') {
          firstDataLoaded = true;
          playerApi.removeEventListener('videodatachange', dataLoadedListener);
        }
      };
      playerApi.addEventListener('videodatachange', dataLoadedListener);

      if (isPluginLoaded && !isApiLoaded) {
        api = playerApi;
        isApiLoaded = true;

        onApiLoaded();
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
};

initObserver().then(preload).then(main);
