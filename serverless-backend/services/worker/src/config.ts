import { ApiError } from '@pt/shared';

export interface WorkerConfig {
  tableName: string;
  uploadsBucket: string;
  deliveryBucket: string;
  eventBusName: string;
  mediaConvertRoleArn: string;
  mediaConvertEndpoint?: string;
  mediaConvertQueueArn?: string;
  mediaConvertJobTemplate?: string;
  federationQueueUrl: string;
  notificationQueueUrl: string;
  wsEndpoint: string;
  instanceBaseUrl: string;
  activityPubPrivateKeyPem?: string;
  activityPubKeyId?: string;
}

export function readConfig(): WorkerConfig {
  const tableName = process.env.TABLE_NAME;
  const uploadsBucket = process.env.UPLOADS_BUCKET;
  const deliveryBucket = process.env.DELIVERY_BUCKET;
  const eventBusName = process.env.EVENT_BUS_NAME;
  const mediaConvertRoleArn = process.env.MEDIACONVERT_ROLE_ARN;
  const federationQueueUrl = process.env.FEDERATION_QUEUE_URL;
  const notificationQueueUrl = process.env.NOTIFICATION_QUEUE_URL;
  const wsEndpoint = process.env.WS_ENDPOINT;
  const instanceBaseUrl = process.env.INSTANCE_BASE_URL;

  if (!tableName || !uploadsBucket || !deliveryBucket || !eventBusName || !mediaConvertRoleArn || !federationQueueUrl || !notificationQueueUrl || !wsEndpoint || !instanceBaseUrl) {
    throw new ApiError(500, 'CONFIG_ERROR', 'Missing required worker configuration');
  }

  return {
    tableName,
    uploadsBucket,
    deliveryBucket,
    eventBusName,
    mediaConvertRoleArn,
    mediaConvertEndpoint: process.env.MEDIACONVERT_ENDPOINT,
    mediaConvertQueueArn: process.env.MEDIACONVERT_QUEUE_ARN,
    mediaConvertJobTemplate: process.env.MEDIACONVERT_JOB_TEMPLATE,
    federationQueueUrl,
    notificationQueueUrl,
    wsEndpoint,
    instanceBaseUrl,
    activityPubPrivateKeyPem: process.env.ACTIVITYPUB_PRIVATE_KEY_PEM,
    activityPubKeyId: process.env.ACTIVITYPUB_KEY_ID,
  };
}
