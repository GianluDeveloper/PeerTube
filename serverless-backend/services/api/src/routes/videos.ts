import crypto from 'crypto';
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  accepted,
  ApiError,
  completeUploadSchema,
  createVideoDraftSchema,
  enforceIdempotency,
  initiateUploadSchema,
  listVideosQuerySchema,
  ok,
  parseBody,
  parseQuery,
  publishVideoSchema,
  requireRole,
} from '@pt/shared';
import type { RequestContext } from '../domain/context';
import { eventBridgeClient, s3Client } from '../domain/clients';
import { signCloudFrontUrl } from '../domain/cloudfront';

function viewerFingerprint(ctx: RequestContext): string {
  const ip = ctx.event.requestContext.http.sourceIp;
  const ua = ctx.event.headers['user-agent'] ?? '';
  const key = `${ip}|${ua}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

function parseVideoId(ctx: RequestContext): string {
  const videoId = ctx.params.videoId;
  if (!videoId) {
    throw new ApiError(400, 'INVALID_PATH', 'videoId is required');
  }

  return videoId;
}

export async function createVideoDraftRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  requireRole(ctx.identity, 'user', 'mod', 'admin');
  const payload = parseBody(createVideoDraftSchema, ctx.event.body ?? undefined);
  const created = await ctx.repo.createVideoDraft(ctx.identity, payload);
  return ok(created, 201);
}

export async function initiateVideoUploadRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const videoId = parseVideoId(ctx);
  const payload = parseBody(initiateUploadSchema, ctx.event.body ?? undefined);
  const video = await ctx.repo.getVideo(videoId);

  if (video.ownerUserId !== ctx.identity.userId && !ctx.identity.roles.includes('admin') && !ctx.identity.roles.includes('mod')) {
    throw new ApiError(403, 'FORBIDDEN', 'Not video owner');
  }

  const sourceKey = `videos/${videoId}/original/${Date.now()}-${payload.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const createUploadResult = await s3Client.send(
    new CreateMultipartUploadCommand({
      Bucket: ctx.config.uploadsBucket,
      Key: sourceKey,
      ContentType: payload.contentType,
      Metadata: {
        videoId,
        ownerUserId: video.ownerUserId,
      },
      ServerSideEncryption: 'aws:kms',
    }),
  );

  const uploadId = createUploadResult.UploadId;
  if (!uploadId) {
    throw new ApiError(500, 'UPLOAD_INIT_FAILED', 'Cannot create multipart upload');
  }

  const partUrls = await Promise.all(
    Array.from({ length: payload.parts }, (_, idx) => idx + 1).map(async (partNumber) => {
      const url = await getSignedUrl(
        s3Client,
        new UploadPartCommand({
          Bucket: ctx.config.uploadsBucket,
          Key: sourceKey,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: 900 },
      );

      return { partNumber, url };
    }),
  );

  await ctx.repo.setVideoUploadSession(videoId, sourceKey, uploadId, payload.sizeBytes, payload.contentType);

  return ok({
    videoId,
    sourceKey,
    uploadId,
    partUrls,
    expiresInSeconds: 900,
  });
}

export async function completeVideoUploadRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const videoId = parseVideoId(ctx);
  const payload = parseBody(
    completeUploadSchema,
    ctx.event.body ?? undefined,
  );

  const video = await ctx.repo.getVideo(videoId);
  if (video.ownerUserId !== ctx.identity.userId && !ctx.identity.roles.includes('admin') && !ctx.identity.roles.includes('mod')) {
    throw new ApiError(403, 'FORBIDDEN', 'Not video owner');
  }
  if (!video.sourceKey) {
    throw new ApiError(409, 'UPLOAD_NOT_INITIALIZED', 'Upload session was not initiated');
  }

  const headerKey = ctx.event.headers['idempotency-key'];
  const requestId = typeof headerKey === 'string' ? headerKey : ctx.event.requestContext.requestId;
  await enforceIdempotency(
    ctx.config.tableName,
    `complete-upload#${videoId}`,
    requestId,
    Math.floor(Date.now() / 1000) + 60 * 30,
  );

  await s3Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: ctx.config.uploadsBucket,
      Key: video.sourceKey,
      UploadId: payload.uploadId,
      MultipartUpload: {
        Parts: payload.parts,
      },
    }),
  );

  await ctx.repo.markUploadCompleted(videoId);

  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'peertube.serverless',
          DetailType: 'VideoUploaded',
          EventBusName: ctx.config.eventBusName,
          Detail: JSON.stringify({
            videoId,
            channelId: video.channelId,
            ownerUserId: video.ownerUserId,
            sourceBucket: ctx.config.uploadsBucket,
            sourceKey: video.sourceKey,
            requestId,
          }),
        },
      ],
    }),
  );

  return accepted({
    videoId,
    status: 'UPLOADED',
    message: 'Upload completed and processing started',
  });
}

export async function publishVideoRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const videoId = parseVideoId(ctx);
  const payload = parseBody(publishVideoSchema, ctx.event.body ?? '{}');
  const video = await ctx.repo.getVideo(videoId);

  if (video.ownerUserId !== ctx.identity.userId && !ctx.identity.roles.includes('admin') && !ctx.identity.roles.includes('mod')) {
    throw new ApiError(403, 'FORBIDDEN', 'Not video owner');
  }

  await ctx.repo.publishVideo(videoId, payload.visibility);
  return ok({ videoId, state: 'PUBLISHED' });
}

export async function unpublishVideoRoute(ctx: RequestContext) {
  if (!ctx.identity) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const videoId = parseVideoId(ctx);
  const video = await ctx.repo.getVideo(videoId);

  if (video.ownerUserId !== ctx.identity.userId && !ctx.identity.roles.includes('admin') && !ctx.identity.roles.includes('mod')) {
    throw new ApiError(403, 'FORBIDDEN', 'Not video owner');
  }

  await ctx.repo.unpublishVideo(videoId);
  return ok({ videoId, state: 'UPLOADED' });
}

export async function listVideosRoute(ctx: RequestContext) {
  const query = parseQuery(
    listVideosQuerySchema,
    (ctx.event.queryStringParameters ?? {}) as Record<string, string | undefined>,
  );

  const listed = await ctx.repo.listVideos(query);
  return ok(listed);
}

export async function getVideoRoute(ctx: RequestContext) {
  const videoId = parseVideoId(ctx);
  const video = await ctx.repo.getVideo(videoId);
  const views = await ctx.repo.readViewCount(videoId);

  return ok({
    ...video,
    viewCount: views,
  });
}

export async function playbackRoute(ctx: RequestContext) {
  const videoId = parseVideoId(ctx);
  const video = await ctx.repo.getVideo(videoId);
  if (video.state !== 'PUBLISHED') {
    throw new ApiError(404, 'VIDEO_NOT_PLAYABLE', 'Video is not published');
  }

  if (!video.hlsManifestKey) {
    throw new ApiError(404, 'MANIFEST_NOT_FOUND', 'HLS manifest not generated yet');
  }

  const rawManifestUrl = `https://${ctx.config.cloudFrontDomain}/${video.hlsManifestKey}`;

  let manifestUrl = rawManifestUrl;
  if (video.visibility === 'PRIVATE') {
    if (!ctx.identity) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required for private playback');
    }

    if (ctx.config.cfKeyPairId && ctx.config.cfPrivateKeyPem) {
      manifestUrl = signCloudFrontUrl({
        resourceUrl: rawManifestUrl,
        keyPairId: ctx.config.cfKeyPairId,
        privateKeyPem: ctx.config.cfPrivateKeyPem,
        expiresEpochSeconds: Math.floor(Date.now() / 1000) + 60 * 10,
      });
    } else {
      manifestUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: ctx.config.deliveryBucket,
          Key: video.hlsManifestKey,
        }),
        { expiresIn: 600 },
      );
    }
  }

  return ok({
    videoId,
    manifestUrl,
    thumbnailUrl: video.thumbnailKey ? `https://${ctx.config.cloudFrontDomain}/${video.thumbnailKey}` : undefined,
  });
}

export async function registerViewRoute(ctx: RequestContext) {
  const videoId = parseVideoId(ctx);
  const viewerHash = viewerFingerprint(ctx);
  const counted = await ctx.repo.registerView(videoId, viewerHash);
  const viewCount = await ctx.repo.readViewCount(videoId);

  return accepted({ videoId, counted, viewCount });
}
