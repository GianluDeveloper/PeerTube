import { ApiError } from '@pt/shared';

export interface ApiConfig {
  tableName: string;
  uploadsBucket: string;
  deliveryBucket: string;
  eventBusName: string;
  region: string;
  cloudFrontDomain: string;
  instanceBaseUrl: string;
  wsEndpoint: string;
  federationQueueUrl?: string;
  cognitoUserPoolId: string;
  adminBootstrapSecretName: string;
  cfKeyPairId?: string;
  cfPrivateKeyPem?: string;
  allowedOrigins: string[];
}

export function readConfig(): ApiConfig {
  const tableName = process.env.TABLE_NAME;
  const uploadsBucket = process.env.UPLOADS_BUCKET;
  const deliveryBucket = process.env.DELIVERY_BUCKET;
  const eventBusName = process.env.EVENT_BUS_NAME;
  const region = process.env.AWS_REGION ?? 'eu-central-1';
  const cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN;
  const instanceBaseUrl = process.env.INSTANCE_BASE_URL;
  const wsEndpoint = process.env.WS_ENDPOINT;
  const federationQueueUrl = process.env.FEDERATION_QUEUE_URL;
  const cognitoUserPoolId = process.env.COGNITO_USER_POOL_ID;
  const adminBootstrapSecretName = process.env.ADMIN_BOOTSTRAP_SECRET_NAME;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);

  if (!tableName || !uploadsBucket || !deliveryBucket || !eventBusName || !cloudFrontDomain || !instanceBaseUrl || !wsEndpoint || !cognitoUserPoolId || !adminBootstrapSecretName) {
    throw new ApiError(500, 'CONFIG_ERROR', 'Missing required environment configuration');
  }

  return {
    tableName,
    uploadsBucket,
    deliveryBucket,
    eventBusName,
    region,
    cloudFrontDomain,
    instanceBaseUrl,
    wsEndpoint,
    federationQueueUrl,
    cognitoUserPoolId,
    adminBootstrapSecretName,
    cfKeyPairId: process.env.CF_KEY_PAIR_ID,
    cfPrivateKeyPem: process.env.CF_PRIVATE_KEY_PEM,
    allowedOrigins,
  };
}
