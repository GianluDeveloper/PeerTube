import { logger } from '@pt/shared';
import { readConfig } from '../config';
import { WorkerRepository } from '../repository';
import type { PollTranscodeOutput } from './poll-transcode';

export async function handler(event: PollTranscodeOutput) {
  const config = readConfig();
  const repo = new WorkerRepository(config.tableName);

  await repo.setVideoState(event.videoId, 'FAILED', {
    transcodeError: event.errorMessage ?? 'unknown error',
    failedAt: new Date().toISOString(),
  });

  logger.error('Video transcoding failed', {
    videoId: event.videoId,
    errorMessage: event.errorMessage,
  });

  return {
    videoId: event.videoId,
    state: 'FAILED',
    error: event.errorMessage,
  };
}
