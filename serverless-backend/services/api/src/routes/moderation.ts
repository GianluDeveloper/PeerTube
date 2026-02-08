import { AdminDisableUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
  ApiError,
  banUserSchema,
  ok,
  parseBody,
  reportContentSchema,
  requireRole,
} from '@pt/shared';
import type { RequestContext } from '../domain/context';
import { cognitoClient } from '../domain/clients';

function readVideoId(ctx: RequestContext): string {
  const value = ctx.params.videoId;
  if (!value) {
    throw new ApiError(400, 'INVALID_PATH', 'videoId is required');
  }

  return value;
}

export async function reportContentRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const payload = parseBody(reportContentSchema, ctx.event.body ?? undefined);
  const report = await ctx.repo.reportVideo(ctx.identity, payload.videoId, payload.reason);
  return ok(report, 201);
}

export async function takedownVideoRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  requireRole(ctx.identity, 'admin', 'mod');
  await ctx.repo.moderateVideo(readVideoId(ctx), 'TAKEDOWN');
  return ok({ status: 'TAKEDOWN' });
}

export async function hideVideoRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  requireRole(ctx.identity, 'admin', 'mod');
  await ctx.repo.moderateVideo(readVideoId(ctx), 'HIDDEN');
  return ok({ status: 'HIDDEN' });
}

export async function banUserRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  requireRole(ctx.identity, 'admin', 'mod');

  const targetUserId = ctx.params.userId;
  if (!targetUserId) {
    throw new ApiError(400, 'INVALID_PATH', 'userId is required');
  }

  const payload = parseBody(banUserSchema, ctx.event.body ?? undefined);
  const bannedUntil = payload.days ? new Date(Date.now() + payload.days * 24 * 60 * 60 * 1000).toISOString() : undefined;

  await ctx.repo.banUser(targetUserId, payload.reason, bannedUntil);

  await cognitoClient.send(
    new AdminDisableUserCommand({
      UserPoolId: ctx.config.cognitoUserPoolId,
      Username: targetUserId,
    }),
  );

  return ok({ userId: targetUserId, status: 'BANNED', bannedUntil });
}
