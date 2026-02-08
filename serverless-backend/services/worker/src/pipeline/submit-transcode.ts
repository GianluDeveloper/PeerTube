import { CreateJobCommand, MediaConvertClient } from '@aws-sdk/client-mediaconvert';
import { ApiError, logger } from '@pt/shared';
import { readConfig } from '../config';
import { WorkerRepository } from '../repository';
import type { ValidateUploadOutput } from './validate-upload';

export interface SubmitTranscodeOutput extends ValidateUploadOutput {
  mediaConvertJobId: string;
  outputPrefix: string;
}

function buildMediaConvertClient(endpoint?: string): MediaConvertClient {
  if (endpoint) {
    return new MediaConvertClient({ endpoint });
  }

  return new MediaConvertClient({});
}

export async function handler(event: ValidateUploadOutput): Promise<SubmitTranscodeOutput> {
  const config = readConfig();
  const repo = new WorkerRepository(config.tableName);
  const mediaConvert = buildMediaConvertClient(config.mediaConvertEndpoint);

  const outputPrefix = `hls/${event.videoId}/`;
  const destination = `s3://${config.deliveryBucket}/${outputPrefix}`;

  logger.info('Submitting MediaConvert job', {
    videoId: event.videoId,
    sourceKey: event.sourceKey,
    destination,
  });

  const command = new CreateJobCommand({
    Role: config.mediaConvertRoleArn,
    Queue: config.mediaConvertQueueArn,
    JobTemplate: config.mediaConvertJobTemplate,
    UserMetadata: {
      videoId: event.videoId,
      ownerUserId: event.ownerUserId,
      channelId: event.channelId,
    },
    Settings: {
      Inputs: [
        {
          FileInput: `s3://${event.sourceBucket}/${event.sourceKey}`,
        },
      ],
      OutputGroups: [
        {
          Name: 'HLS',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS',
            HlsGroupSettings: {
              Destination: destination,
              SegmentLength: 6,
              MinSegmentLength: 1,
            },
          },
          Outputs: [
            {
              NameModifier: '_720p',
              ContainerSettings: { Container: 'M3U8' },
              VideoDescription: {
                Width: 1280,
                Height: 720,
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    RateControlMode: 'QVBR',
                  },
                },
              },
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: 'AAC',
                    AacSettings: {
                      Bitrate: 128000,
                      CodingMode: 'CODING_MODE_2_0',
                      SampleRate: 48000,
                    },
                  },
                },
              ],
            },
          ],
        },
        {
          Name: 'Thumbnails',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_SETTINGS',
            FileGroupSettings: {
              Destination: `s3://${config.deliveryBucket}/thumbs/${event.videoId}/`,
            },
          },
          Outputs: [
            {
              NameModifier: 'poster',
              ContainerSettings: {
                Container: 'RAW',
              },
              VideoDescription: {
                CodecSettings: {
                  Codec: 'FRAME_CAPTURE',
                  FrameCaptureSettings: {
                    FramerateNumerator: 1,
                    FramerateDenominator: 1,
                    MaxCaptures: 1,
                    Quality: 80,
                  },
                },
              },
            },
          ],
        },
      ],
    },
  });

  const result = await mediaConvert.send(command);
  const mediaConvertJobId = result.Job?.Id;
  if (!mediaConvertJobId) {
    throw new ApiError(500, 'MEDIACONVERT_CREATE_FAILED', 'MediaConvert job id missing from response');
  }

  await repo.setVideoState(event.videoId, 'TRANSCODING', {
    mediaConvertJobId,
    outputPrefix,
  });

  return {
    ...event,
    mediaConvertJobId,
    outputPrefix,
  };
}
