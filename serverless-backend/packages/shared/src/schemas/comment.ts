import { z } from 'zod';

export const createCommentSchema = z.object({
  body: z.string().min(1).max(5000),
});

export const listCommentsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
