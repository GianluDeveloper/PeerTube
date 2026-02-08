import { z } from 'zod';
import {
  ApiError,
  createChannelSchema,
  ok,
  parseBody,
  parseQuery,
  requireRole,
  updateChannelSchema,
} from '@pt/shared';
import type { RequestContext } from '../domain/context';

const listChannelsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export async function createChannelRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  requireRole(ctx.identity, 'user', 'admin', 'mod');
  const payload = parseBody(createChannelSchema, ctx.event.body ?? undefined);
  await ctx.repo.ensureUserProfile(ctx.identity);
  const channel = await ctx.repo.createChannel(ctx.identity, payload);
  return ok(channel, 201);
}

export async function updateChannelRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const channelId = ctx.params.channelId;
  if (!channelId) {
    throw new ApiError(400, 'INVALID_PATH', 'channelId is required');
  }

  const payload = parseBody(updateChannelSchema, ctx.event.body ?? undefined);
  const channel = await ctx.repo.updateChannel(ctx.identity, channelId, payload);
  return ok(channel);
}

export async function listChannelsRoute(ctx: RequestContext) {
  const query = parseQuery(listChannelsSchema, (ctx.event.queryStringParameters ?? {}) as Record<string, string | undefined>);
  const channels = await ctx.repo.listChannels(query.limit, query.cursor);
  return ok(channels);
}
