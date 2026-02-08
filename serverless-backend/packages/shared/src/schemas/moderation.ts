import { z } from 'zod';

export const reportContentSchema = z.object({
  videoId: z.string().uuid(),
  reason: z.string().min(3).max(1000),
});

export const banUserSchema = z.object({
  reason: z.string().min(3).max(1000),
  days: z.number().int().min(1).max(3650).optional(),
});
