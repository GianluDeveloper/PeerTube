import { PutEventsCommand, EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ApiError, logger } from '@pt/shared';
import { readConfig } from '../config';
import { WorkerRepository } from '../repository';
import type { PollTranscodeOutput } from './poll-transcode';

const eventBridge = new EventBridgeClient({});
const sqs = new SQSClient({});

export async function handler(event: PollTranscodeOutput) {
  if (event.pollStatus !== 'COMPLETE' || !event.manifestKey || !event.thumbnailKey) {
    throw new ApiError(400, 'INVALID_PIPELINE_STATE', 'Cannot finalize video when transcode is incomplete');
  }

  const config = readConfig();
  const repo = new WorkerRepository(config.tableName);

  await repo.setVideoState(event.videoId, 'PUBLISHED', {
    hlsManifestKey: event.manifestKey,
    thumbnailKey: event.thumbnailKey,
    durationSeconds: event.durationSeconds ?? 0,
    publishedAt: new Date().toISOString(),
  });

  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'peertube.serverless',
          DetailType: 'TranscodeCompleted',
          EventBusName: config.eventBusName,
          Detail: JSON.stringify({
            videoId: event.videoId,
            manifestKey: event.manifestKey,
            thumbnailKey: event.thumbnailKey,
            durationSeconds: event.durationSeconds ?? 0,
          }),
        },
      ],
    }),
  );

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: config.notificationQueueUrl,
      MessageBody: JSON.stringify({
        userId: event.ownerUserId,
        type: 'video.published',
        payload: {
          videoId: event.videoId,
          manifestKey: event.manifestKey,
          thumbnailKey: event.thumbnailKey,
        },
      }),
    }),
  );

  logger.info('Video published', { videoId: event.videoId });

  return {
    videoId: event.videoId,
    state: 'PUBLISHED',
    manifestKey: event.manifestKey,
  };
}
