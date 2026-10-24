import { z } from '@hono/zod-openapi';

export const LibraryPlaylistsQuerySchema = z.object({
  continuation: z.string().optional(),
});

export const PlaylistParamsSchema = z.object({
  playlistId: z.string(),
});

export const BrowseParamsSchema = z.object({
  // Browse ids are base64url, e.g. an artist's "UC…" channel id
  browseId: z.string().regex(/^[\w-]+$/),
});
