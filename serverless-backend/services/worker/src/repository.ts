import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ApiError, getDocClient } from '@pt/shared';

function nowIso(): string {
  return new Date().toISOString();
}

export class WorkerRepository {
  private readonly client = getDocClient();

  public constructor(private readonly tableName: string) {}

  public async getVideo(videoId: string) {
    const out = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `VIDEO#${videoId}`,
          sk: 'METADATA',
        },
      }),
    );

    if (!out.Item) {
      throw new ApiError(404, 'VIDEO_NOT_FOUND', 'Video not found');
    }

    return out.Item;
  }

  public async transitionVideoState(videoId: string, expectedState: string, nextState: string, attrs?: Record<string, unknown>) {
    let updateExpression = 'SET #state = :nextState, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk';
    const values: Record<string, unknown> = {
      ':expectedState': expectedState,
      ':nextState': nextState,
      ':updatedAt': nowIso(),
      ':gsi1pk': `VIDEOS_BY_STATE#${nextState}`,
      ':gsi1sk': `${nowIso()}#${videoId}`,
    };

    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        const attrName = key.replace(/[^a-zA-Z0-9]/g, '');
        updateExpression += `, ${attrName} = :${attrName}`;
        values[`:${attrName}`] = value;
      }
    }

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `VIDEO#${videoId}`,
          sk: 'METADATA',
        },
        ConditionExpression: 'attribute_exists(pk) AND #state = :expectedState',
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          '#state': 'state',
        },
        ExpressionAttributeValues: values,
      }),
    );
  }

  public async setVideoState(videoId: string, nextState: string, attrs?: Record<string, unknown>) {
    let updateExpression = 'SET #state = :nextState, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk';
    const values: Record<string, unknown> = {
      ':nextState': nextState,
      ':updatedAt': nowIso(),
      ':gsi1pk': `VIDEOS_BY_STATE#${nextState}`,
      ':gsi1sk': `${nowIso()}#${videoId}`,
    };

    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        const attrName = key.replace(/[^a-zA-Z0-9]/g, '');
        updateExpression += `, ${attrName} = :${attrName}`;
        values[`:${attrName}`] = value;
      }
    }

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `VIDEO#${videoId}`,
          sk: 'METADATA',
        },
        ConditionExpression: 'attribute_exists(pk)',
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          '#state': 'state',
        },
        ExpressionAttributeValues: values,
      }),
    );
  }

  public async putFederationDeliveryAttempt(input: {
    deliveryId: string;
    attempt: number;
    activityId: string;
    recipientInbox: string;
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
    lastError?: string;
    nextAttemptAt?: string;
  }) {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `FED#DELIVERY#${input.deliveryId}`,
          sk: `ATTEMPT#${input.attempt}`,
          entityType: 'FED_DELIVERY_ATTEMPT',
          ...input,
          createdAt: nowIso(),
          gsi2pk: input.status === 'PENDING' ? 'FED_DELIVERY_PENDING' : `FED_DELIVERY_${input.status}`,
          gsi2sk: `${input.nextAttemptAt ?? nowIso()}#${input.deliveryId}`,
          ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
        },
      }),
    );
  }

  public async listWsConnectionsForUser(userId: string): Promise<string[]> {
    const out = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `WSUSER#${userId}`,
        },
      }),
    );

    return (out.Items ?? []).map((item) => item.connectionId as string);
  }

  public async deleteWsConnection(connectionId: string) {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          pk: `WS#${connectionId}`,
          sk: 'CONNECTION',
        },
      }),
    );
  }
}
