import crypto from 'crypto';
import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';
import { GetJobCommand, MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { Repository } from '../../services/api/src/domain/repository';
import { finalizeVideoRouteContext } from '../utils/test-context';
import { handler as validateUploadHandler } from '../../services/worker/src/pipeline/validate-upload';
import { handler as submitTranscodeHandler } from '../../services/worker/src/pipeline/submit-transcode';
import { handler as pollTranscodeHandler } from '../../services/worker/src/pipeline/poll-transcode';
import { handler as finalizeVideoHandler } from '../../services/worker/src/pipeline/finalize-video';
import { playbackRoute } from '../../services/api/src/routes/videos';
import { inboxRoute } from '../../services/api/src/routes/activitypub';

const tableName = 'pt-serverless-integration';

const s3Mock = mockClient(S3Client);
const mediaConvertMock = mockClient(MediaConvertClient);
const eventBridgeMock = mockClient(EventBridgeClient);
const sqsMock = mockClient(SQSClient);

async function ensureTable(): Promise<void> {
  const dynamo = new DynamoDBClient({
    endpoint: process.env.DYNAMODB_ENDPOINT,
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: 'local',
      secretAccessKey: 'local',
    },
  });

  try {
    await dynamo.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
          { AttributeName: 'gsi1pk', AttributeType: 'S' },
          { AttributeName: 'gsi1sk', AttributeType: 'S' },
          { AttributeName: 'gsi2pk', AttributeType: 'S' },
          { AttributeName: 'gsi2sk', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'gsi1',
            KeySchema: [
              { AttributeName: 'gsi1pk', KeyType: 'HASH' },
              { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'gsi2',
            KeySchema: [
              { AttributeName: 'gsi2pk', KeyType: 'HASH' },
              { AttributeName: 'gsi2sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      }),
    );
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) {
      throw error;
    }
  }
}

describe('MVP integration flow', () => {
  const repo = new Repository(tableName);

  beforeAll(async () => {
    process.env.AWS_REGION = process.env.AWS_REGION ?? 'eu-central-1';
    process.env.DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000';

    process.env.TABLE_NAME = tableName;
    process.env.UPLOADS_BUCKET = 'uploads-bucket';
    process.env.DELIVERY_BUCKET = 'delivery-bucket';
    process.env.EVENT_BUS_NAME = 'peertube-events';
    process.env.MEDIACONVERT_ROLE_ARN = 'arn:aws:iam::123456789012:role/fake-mediaconvert-role';
    process.env.FEDERATION_QUEUE_URL = 'https://sqs.eu-central-1.amazonaws.com/123456789012/federation';
    process.env.NOTIFICATION_QUEUE_URL = 'https://sqs.eu-central-1.amazonaws.com/123456789012/notification';
    process.env.WS_ENDPOINT = 'https://example.execute-api.eu-central-1.amazonaws.com/dev';
    process.env.INSTANCE_BASE_URL = 'https://example.peertube-serverless.test';
    process.env.ALLOWED_ORIGINS = 'https://frontend.example';
    process.env.COGNITO_USER_POOL_ID = 'eu-central-1_TEST';
    process.env.ADMIN_BOOTSTRAP_SECRET_NAME = 'bootstrap-secret';

    await ensureTable();
  });

  beforeEach(() => {
    s3Mock.reset();
    mediaConvertMock.reset();
    eventBridgeMock.reset();
    sqsMock.reset();
  });

  it('creates channel + video, processes upload to published, serves playback and comments', async () => {
    const identity = {
      userId: 'user-1',
      roles: ['user'],
      email: 'user@example.com',
    };

    await repo.ensureUserProfile(identity);

    const channel = await repo.createChannel(identity, {
      handle: 'creator_channel',
      displayName: 'Creator Channel',
      description: 'demo channel',
    });

    const draft = await repo.createVideoDraft(identity, {
      channelId: channel.channelId,
      title: 'Integration Test Video',
      description: 'A test description',
      tags: ['integration', 'test'],
      visibility: 'PUBLIC',
    });

    await repo.setVideoUploadSession(
      draft.videoId,
      `videos/${draft.videoId}/original/source.mp4`,
      'upload-1',
      1024,
      'video/mp4',
    );
    await repo.markUploadCompleted(draft.videoId);

    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 1024,
      ContentType: 'video/mp4',
    });

    mediaConvertMock.on(CreateJobCommand).resolves({
      Job: {
        Id: 'mediaconvert-job-1',
      },
    });

    mediaConvertMock.on(GetJobCommand).resolves({
      Job: {
        Id: 'mediaconvert-job-1',
        Status: 'COMPLETE',
      },
    });

    eventBridgeMock.on(PutEventsCommand).resolves({
      FailedEntryCount: 0,
      Entries: [],
    });

    sqsMock.on(SendMessageCommand).resolves({
      MessageId: 'msg-1',
    });

    const validated = await validateUploadHandler({
      videoId: draft.videoId,
      sourceBucket: process.env.UPLOADS_BUCKET!,
      sourceKey: `videos/${draft.videoId}/original/source.mp4`,
      ownerUserId: identity.userId,
      channelId: channel.channelId,
      requestId: 'req-1',
    });

    const submitted = await submitTranscodeHandler(validated);
    const polled = await pollTranscodeHandler(submitted);

    expect(polled.pollStatus).toBe('COMPLETE');

    await finalizeVideoHandler(polled);

    const video = await repo.getVideo(draft.videoId);
    expect(video.state).toBe('PUBLISHED');
    expect(video.hlsManifestKey).toBeDefined();

    const playback = await playbackRoute(
      finalizeVideoRouteContext({
        repo,
        videoId: draft.videoId,
        cloudFrontDomain: 'd123.cloudfront.net',
      }),
    );
    const body = JSON.parse(playback.body as string);

    expect(playback.statusCode).toBe(200);
    expect(body.data.manifestUrl).toContain('index.m3u8');

    const comment = await repo.addComment(identity, draft.videoId, 'Looks good');
    expect(comment.commentId).toBeDefined();

    const commentList = await repo.listComments(draft.videoId, 10);
    expect(commentList.items.length).toBeGreaterThan(0);
  });

  it('verifies and deduplicates federation inbox activities', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyId = 'https://remote.example/users/alice#main-key';

    await repo.registerFederationActor({
      actorId: 'https://remote.example/users/alice',
      inboxUrl: 'https://remote.example/inbox',
      outboxUrl: 'https://remote.example/outbox',
      publicKeyPem: publicKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
      keyId,
    });

    const activity = {
      id: 'https://remote.example/activities/1',
      type: 'Follow',
      actor: 'https://remote.example/users/alice',
      object: 'https://example.peertube-serverless.test/activitypub/actor/system',
    };

    const date = new Date().toUTCString();
    const signingString = [
      '(request-target): post /activitypub/inbox',
      'date: ' + date,
      'host: example.peertube-serverless.test',
    ].join('\n');

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingString);
    signer.end();
    const signature = signer.sign(privateKey.export({ type: 'pkcs1', format: 'pem' }), 'base64');

    const signatureHeader = `keyId=\"${keyId}\",algorithm=\"rsa-sha256\",headers=\"(request-target) date host\",signature=\"${signature}\"`;

    const context = finalizeVideoRouteContext({
      repo,
      eventOverrides: {
        rawPath: '/activitypub/inbox',
        requestContext: {
          http: {
            method: 'POST',
            sourceIp: '127.0.0.1',
          },
        },
        headers: {
          signature: signatureHeader,
          date,
          host: 'example.peertube-serverless.test',
          'content-type': 'application/activity+json',
        },
        body: JSON.stringify(activity),
      },
    });

    const first = await inboxRoute(context);
    const second = await inboxRoute(context);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);

    const secondBody = JSON.parse(second.body as string);
    expect(secondBody.data.status).toBe('duplicate_ignored');
  });
});
