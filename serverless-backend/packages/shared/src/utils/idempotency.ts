import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient } from '../db/client';
import { tableKeys } from '../db/keys';
import { ApiError } from './http';

export async function enforceIdempotency(tableName: string, scope: string, requestId: string, ttlEpoch: number): Promise<void> {
  const client = getDocClient();
  const keys = tableKeys.idempotency(scope, requestId);

  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...keys,
          entityType: 'IDEMPOTENCY',
          ttl: ttlEpoch,
          createdAt: new Date().toISOString(),
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  } catch (error) {
    throw new ApiError(409, 'DUPLICATE_REQUEST', 'Request already processed');
  }
}
