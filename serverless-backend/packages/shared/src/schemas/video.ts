import { z } from 'zod';

export const createVideoDraftSchema = z.object({
  channelId: z.string().uuid(),
  title: z.string().min(1).max(180),
  description: z.string().max(10000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).default('PUBLIC'),
});

export const publishVideoSchema = z.object({
  visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).optional(),
});

export const initiateUploadSchema = z.object({
  fileName: z.string().min(1).max(512),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024 * 1024),
  parts: z.number().int().min(1).max(10000),
});

export const completeUploadSchema = z.object({
  uploadId: z.string().min(1),
  parts: z.array(
    z.object({
      ETag: z.string().min(1),
      PartNumber: z.number().int().min(1),
    }),
  ),
});

export const listVideosQuerySchema = z.object({
  channelId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(120).optional(),
});
