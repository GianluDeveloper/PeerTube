import { z } from 'zod';

export const createChannelSchema = z.object({
  handle: z.string().min(3).max(64).regex(/^[a-z0-9_]+$/),
  displayName: z.string().min(1).max(120),
  description: z.string().max(1024).optional(),
});

export const updateChannelSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  description: z.string().max(1024).optional(),
});
