import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { ApiError, fail, logger, ok } from '@pt/shared';
import { readConfig } from '../config';
import { Repository } from '../domain/repository';

export async function handler(event: APIGatewayProxyWebsocketEventV2) {
  try {
    const config = readConfig();
    const repo = new Repository(config.tableName);

    const connectionId = event.requestContext.connectionId;
    if (!connectionId) {
      throw new ApiError(400, 'INVALID_CONNECTION', 'Missing connection id');
    }

    const userId = event.queryStringParameters?.userId;
    if (!userId) {
      throw new ApiError(401, 'UNAUTHORIZED', 'userId query parameter is required for WS connect');
    }

    await repo.putWsConnection(connectionId, userId);
    logger.info('WebSocket connected', { connectionId, userId });

    return ok({ connected: true });
  } catch (error) {
    return fail(error);
  }
}
