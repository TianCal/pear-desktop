import { z } from '@hono/zod-openapi';

export const LibraryPlaylistsQuerySchema = z.object({
  continuation: z.string().optional(),
});

export const PlaylistParamsSchema = z.object({
  playlistId: z.string(),
});
