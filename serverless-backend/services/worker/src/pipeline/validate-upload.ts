import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ApiError, logger } from '@pt/shared';
import { readConfig } from '../config';
import { WorkerRepository } from '../repository';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;

export interface ValidateUploadInput {
  videoId: string;
  sourceBucket: string;
  sourceKey: string;
  ownerUserId: string;
  channelId: string;
  requestId: string;
}

export interface ValidateUploadOutput extends ValidateUploadInput {
  contentLength: number;
  contentType: string;
}

const s3 = new S3Client({});

export async function handler(event: ValidateUploadInput): Promise<ValidateUploadOutput> {
  const config = readConfig();
  const repo = new WorkerRepository(config.tableName);

  logger.info('Validating uploaded object', { videoId: event.videoId, sourceKey: event.sourceKey });

  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: event.sourceBucket,
      Key: event.sourceKey,
    }),
  );

  const contentLength = head.ContentLength ?? 0;
  const contentType = head.ContentType ?? 'application/octet-stream';

  if (!contentType.startsWith('video/')) {
    throw new ApiError(400, 'INVALID_UPLOAD_TYPE', `Unsupported upload type: ${contentType}`);
  }

  if (contentLength <= 0 || contentLength > MAX_UPLOAD_BYTES) {
    throw new ApiError(400, 'INVALID_UPLOAD_SIZE', 'Upload size is invalid or exceeds maximum');
  }

  await repo.transitionVideoState(event.videoId, 'UPLOADED', 'TRANSCODING', {
    transcodeStartedAt: new Date().toISOString(),
  });

  return {
    ...event,
    contentLength,
    contentType,
  };
}
