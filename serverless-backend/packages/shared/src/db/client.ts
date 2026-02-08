import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

let cached: DynamoDBDocumentClient | undefined;

export function getDocClient(): DynamoDBDocumentClient {
  if (!cached) {
    const endpoint = process.env.DYNAMODB_ENDPOINT;
    const client = new DynamoDBClient(
      endpoint
        ? {
            endpoint,
            region: process.env.AWS_REGION ?? 'eu-central-1',
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
            },
          }
        : {},
    );
    cached = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }

  return cached;
}
