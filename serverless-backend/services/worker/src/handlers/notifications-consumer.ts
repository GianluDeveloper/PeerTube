import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import type { SQSEvent } from 'aws-lambda';
import { logger } from '@pt/shared';
import { readConfig } from '../config';
import { WorkerRepository } from '../repository';

interface NotificationMessage {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
}

export async function handler(event: SQSEvent) {
  const config = readConfig();
  const repo = new WorkerRepository(config.tableName);
  const api = new ApiGatewayManagementApiClient({ endpoint: config.wsEndpoint });

  for (const record of event.Records) {
    const message = JSON.parse(record.body) as NotificationMessage;
    const connections = await repo.listWsConnectionsForUser(message.userId);

    for (const connectionId of connections) {
      try {
        await api.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(
              JSON.stringify({
                type: message.type,
                payload: message.payload,
                sentAt: new Date().toISOString(),
              }),
            ),
          }),
        );
      } catch (error) {
        if (error instanceof GoneException) {
          await repo.deleteWsConnection(connectionId);
          continue;
        }

        logger.error('Failed to send websocket notification', {
          connectionId,
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
  }
}
