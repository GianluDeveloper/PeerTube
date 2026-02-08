import {
  ApiError,
  createCommentSchema,
  listCommentsQuerySchema,
  noContent,
  ok,
  parseBody,
  parseQuery,
  requireRole,
} from '@pt/shared';
import type { RequestContext } from '../domain/context';

function readVideoId(ctx: RequestContext): string {
  const videoId = ctx.params.videoId;
  if (!videoId) {
    throw new ApiError(400, 'INVALID_PATH', 'videoId is required');
  }

  return videoId;
}

export async function createCommentRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  requireRole(ctx.identity, 'user', 'mod', 'admin');
  const payload = parseBody(createCommentSchema, ctx.event.body ?? undefined);
  const videoId = readVideoId(ctx);
  const created = await ctx.repo.addComment(ctx.identity, videoId, payload.body);
  return ok(created, 201);
}

export async function listCommentsRoute(ctx: RequestContext) {
  const videoId = readVideoId(ctx);
  const query = parseQuery(
    listCommentsQuerySchema,
    (ctx.event.queryStringParameters ?? {}) as Record<string, string | undefined>,
  );

  const comments = await ctx.repo.listComments(videoId, query.limit, query.cursor);
  return ok(comments);
}

export async function deleteCommentRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const videoId = readVideoId(ctx);
  const commentId = ctx.params.commentId;
  if (!commentId) {
    throw new ApiError(400, 'INVALID_PATH', 'commentId is required');
  }

  await ctx.repo.deleteComment(ctx.identity, videoId, commentId);
  return noContent();
}
