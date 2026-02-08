import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { RequestContext } from '../../services/api/src/domain/context';
import type { Repository } from '../../services/api/src/domain/repository';

interface ContextOptions {
  repo: Repository;
  videoId?: string;
  cloudFrontDomain?: string;
  eventOverrides?: Partial<APIGatewayProxyEventV2WithJWTAuthorizer>;
}

export function finalizeVideoRouteContext(options: ContextOptions): RequestContext {
  const event = {
    version: '2.0',
    routeKey: 'GET /videos/{videoId}/playback',
    rawPath: `/videos/${options.videoId ?? 'video-id'}/playback`,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'example.execute-api.eu-central-1.amazonaws.com',
      domainPrefix: 'example',
      http: {
        method: 'GET',
        path: `/videos/${options.videoId ?? 'video-id'}/playback`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'jest',
      },
      requestId: 'request-id',
      routeKey: 'GET /videos/{videoId}/playback',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

  const mergedEvent = {
    ...event,
    ...options.eventOverrides,
    headers: {
      ...(event.headers ?? {}),
      ...(options.eventOverrides?.headers ?? {}),
    },
    requestContext: {
      ...event.requestContext,
      ...(options.eventOverrides?.requestContext ?? {}),
      http: {
        ...(event.requestContext.http ?? {}),
        ...((options.eventOverrides?.requestContext as any)?.http ?? {}),
      },
    },
  } as APIGatewayProxyEventV2WithJWTAuthorizer;

  return {
    event: mergedEvent,
    params: {
      videoId: options.videoId ?? 'video-id',
    },
    repo: options.repo,
    config: {
      tableName: process.env.TABLE_NAME!,
      uploadsBucket: process.env.UPLOADS_BUCKET!,
      deliveryBucket: process.env.DELIVERY_BUCKET!,
      eventBusName: process.env.EVENT_BUS_NAME!,
      region: process.env.AWS_REGION ?? 'eu-central-1',
      cloudFrontDomain: options.cloudFrontDomain ?? 'd111.cloudfront.net',
      instanceBaseUrl: process.env.INSTANCE_BASE_URL ?? 'https://example.peertube-serverless.test',
      wsEndpoint: process.env.WS_ENDPOINT ?? 'https://example.execute-api.eu-central-1.amazonaws.com/dev',
      federationQueueUrl: process.env.FEDERATION_QUEUE_URL,
      cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID ?? 'eu-central-1_TEST',
      adminBootstrapSecretName: process.env.ADMIN_BOOTSTRAP_SECRET_NAME ?? 'bootstrap-secret',
      allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
      cfKeyPairId: process.env.CF_KEY_PAIR_ID,
      cfPrivateKeyPem: process.env.CF_PRIVATE_KEY_PEM,
    },
    identity: {
      userId: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
    },
  };
}
