import { z } from 'zod';
import { ApiError } from './http';

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: string | undefined): z.infer<T> {
  if (!body) {
    throw new ApiError(400, 'INVALID_BODY', 'Request body is required');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new ApiError(400, 'INVALID_BODY', 'Request body must be valid JSON');
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
  }

  return parsed.data;
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, query: Record<string, string | undefined>): z.infer<T> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
  }

  return parsed.data;
}
