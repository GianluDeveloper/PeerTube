import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { fail, logger, ok } from '@pt/shared';
import { readConfig } from '../config';
import { Repository } from '../domain/repository';

export async function handler(event: APIGatewayProxyWebsocketEventV2) {
  try {
    const config = readConfig();
    const repo = new Repository(config.tableName);
    const connectionId = event.requestContext.connectionId;

    if (connectionId) {
      await repo.deleteWsConnection(connectionId);
      logger.info('WebSocket disconnected', { connectionId });
    }

    return ok({ disconnected: true });
  } catch (error) {
    return fail(error);
  }
}
