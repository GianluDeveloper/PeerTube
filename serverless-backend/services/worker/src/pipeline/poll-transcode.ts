import { GetJobCommand, MediaConvertClient } from '@aws-sdk/client-mediaconvert';
import { logger } from '@pt/shared';
import { readConfig } from '../config';
import type { SubmitTranscodeOutput } from './submit-transcode';

function buildMediaConvertClient(endpoint?: string): MediaConvertClient {
  if (endpoint) {
    return new MediaConvertClient({ endpoint });
  }

  return new MediaConvertClient({});
}

export interface PollTranscodeOutput extends SubmitTranscodeOutput {
  pollStatus: 'IN_PROGRESS' | 'COMPLETE' | 'ERROR';
  manifestKey?: string;
  thumbnailKey?: string;
  durationSeconds?: number;
  errorMessage?: string;
}

export async function handler(event: SubmitTranscodeOutput): Promise<PollTranscodeOutput> {
  const config = readConfig();
  const mediaConvert = buildMediaConvertClient(config.mediaConvertEndpoint);

  const job = await mediaConvert.send(
    new GetJobCommand({
      Id: event.mediaConvertJobId,
    }),
  );

  const status = job.Job?.Status;

  logger.info('Polled MediaConvert status', {
    videoId: event.videoId,
    mediaConvertJobId: event.mediaConvertJobId,
    status,
  });

  if (status === 'COMPLETE') {
    return {
      ...event,
      pollStatus: 'COMPLETE',
      manifestKey: `${event.outputPrefix}index.m3u8`,
      thumbnailKey: `thumbs/${event.videoId}/poster.0000000.jpg`,
      durationSeconds: 0,
    };
  }

  if (status === 'ERROR' || status === 'CANCELED') {
    return {
      ...event,
      pollStatus: 'ERROR',
      errorMessage: job.Job?.ErrorMessage ?? `MediaConvert ended in status ${status}`,
    };
  }

  return {
    ...event,
    pollStatus: 'IN_PROGRESS',
  };
}
