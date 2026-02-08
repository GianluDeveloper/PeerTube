import crypto from 'crypto';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  accepted,
  ApiError,
  buildSigningString,
  ok,
  parseSignatureHeader,
  sha256,
  verifyRsaSha256,
} from '@pt/shared';
import { z } from 'zod';
import type { RequestContext } from '../domain/context';
import { sqsClient } from '../domain/clients';

const inboxPayloadSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  actor: z.string().min(1),
  object: z.unknown().optional(),
  to: z.union([z.string(), z.array(z.string())]).optional(),
});

const outboxPayloadSchema = z.object({
  actorId: z.string().min(1),
  type: z.enum(['Follow', 'Undo', 'Create', 'Announce']),
  object: z.record(z.string(), z.unknown()),
  to: z.array(z.string()).min(1),
});

function rawPathWithQuery(ctx: RequestContext): string {
  const query = ctx.event.rawQueryString;
  return query ? `${ctx.event.rawPath}?${query}` : ctx.event.rawPath;
}

function parseJsonBody(ctx: RequestContext) {
  if (!ctx.event.body) {
    throw new ApiError(400, 'INVALID_BODY', 'Request body is required');
  }

  try {
    return JSON.parse(ctx.event.body) as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_BODY', 'Request body must be valid JSON');
  }
}

function assertRecentDate(dateHeader: string | undefined): void {
  if (!dateHeader) {
    throw new ApiError(401, 'SIGNATURE_DATE_MISSING', 'Missing Date header');
  }

  const requestDate = new Date(dateHeader).getTime();
  if (Number.isNaN(requestDate)) {
    throw new ApiError(401, 'SIGNATURE_DATE_INVALID', 'Invalid Date header');
  }

  const skewMs = Math.abs(Date.now() - requestDate);
  if (skewMs > 5 * 60 * 1000) {
    throw new ApiError(401, 'SIGNATURE_REPLAY', 'Date outside accepted replay window');
  }
}

export async function actorRoute(ctx: RequestContext) {
  const actorId = ctx.params.actorId;
  if (!actorId) {
    throw new ApiError(400, 'INVALID_PATH', 'actorId is required');
  }

  const actorUrl = `${ctx.config.instanceBaseUrl}/activitypub/actor/${actorId}`;

  return ok({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: actorUrl,
    type: 'Person',
    preferredUsername: actorId,
    inbox: `${ctx.config.instanceBaseUrl}/activitypub/inbox`,
    outbox: `${ctx.config.instanceBaseUrl}/activitypub/outbox`,
    publicKey: {
      id: `${actorUrl}#main-key`,
      owner: actorUrl,
      publicKeyPem: process.env.ACTIVITYPUB_PUBLIC_KEY_PEM ?? '',
    },
  });
}

export async function inboxRoute(ctx: RequestContext) {
  const payload = inboxPayloadSchema.safeParse(parseJsonBody(ctx));
  if (!payload.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', payload.error.issues.map((i) => i.message).join('; '));
  }

  const dateHeader = ctx.event.headers.date;
  assertRecentDate(dateHeader);

  const signature = parseSignatureHeader(ctx.event.headers.signature);
  const publicKeyPem = await ctx.repo.getFederationPublicKeyByKeyId(signature.keyId);
  if (!publicKeyPem) {
    throw new ApiError(401, 'ACTOR_KEY_UNKNOWN', 'Unknown federation actor keyId');
  }

  const signingString = buildSigningString(
    ctx.event.requestContext.http.method,
    rawPathWithQuery(ctx),
    {
      date: dateHeader,
      host: ctx.event.headers.host,
      digest: ctx.event.headers.digest,
      'content-type': ctx.event.headers['content-type'],
    },
    signature.headers,
  );

  const valid = verifyRsaSha256(signingString, signature.signature, publicKeyPem);
  if (!valid) {
    throw new ApiError(401, 'SIGNATURE_INVALID', 'Activity signature validation failed');
  }

  const dedupeKey = sha256(payload.data.id);
  const acceptedForProcessing = await ctx.repo.reserveFederationDedup(dedupeKey);
  if (!acceptedForProcessing) {
    return accepted({ status: 'duplicate_ignored', activityId: payload.data.id });
  }

  await ctx.repo.storeInboundActivity(payload.data.id, payload.data.actor, payload.data as unknown as Record<string, unknown>);

  if (payload.data.type === 'Follow') {
    const localActor = typeof payload.data.object === 'string' ? payload.data.object : `${ctx.config.instanceBaseUrl}/activitypub/actor/system`;
    await ctx.repo.createFollow(localActor, payload.data.actor);
  }

  if (payload.data.type === 'Undo') {
    const undo = payload.data.object as { type?: string; actor?: string; object?: string } | undefined;
    if (undo?.type === 'Follow' && undo.actor && typeof undo.object === 'string') {
      await ctx.repo.removeFollow(undo.object, undo.actor);
    }
  }

  return accepted({ status: 'accepted', activityId: payload.data.id });
}

export async function outboxRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const payload = outboxPayloadSchema.safeParse(parseJsonBody(ctx));
  if (!payload.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', payload.error.issues.map((i) => i.message).join('; '));
  }

  const activityId = `${ctx.config.instanceBaseUrl}/activities/${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();

  const activity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activityId,
    type: payload.data.type,
    actor: payload.data.actorId,
    object: payload.data.object,
    to: payload.data.to,
    published: createdAt,
  };

  await ctx.repo.storeOutboxActivity(payload.data.actorId, activityId, activity);

  if (!ctx.config.federationQueueUrl) {
    throw new ApiError(500, 'FEDERATION_QUEUE_MISSING', 'federation queue URL is not configured');
  }

  for (const inboxUrl of payload.data.to) {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: ctx.config.federationQueueUrl,
        MessageBody: JSON.stringify({
          activityId,
          actorId: payload.data.actorId,
          recipientInbox: inboxUrl,
          payload: activity,
          attempt: 0,
          nextAttemptAt: createdAt,
        }),
      }),
    );
  }

  return accepted({ activityId, status: 'queued', recipients: payload.data.to.length });
}

export async function registerRemoteActorRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const roles = ctx.identity.roles;
  if (!roles.includes('admin') && !roles.includes('mod')) {
    throw new ApiError(403, 'FORBIDDEN', 'Admin or mod role required');
  }

  const schema = z.object({
    actorId: z.string().url(),
    inboxUrl: z.string().url(),
    outboxUrl: z.string().url(),
    publicKeyPem: z.string().min(100),
    keyId: z.string().min(1).optional(),
  });

  const payload = schema.safeParse(parseJsonBody(ctx));
  if (!payload.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', payload.error.issues.map((i) => i.message).join('; '));
  }

  await ctx.repo.registerFederationActor(payload.data);
  return ok({ status: 'stored', actorId: payload.data.actorId }, 201);
}
