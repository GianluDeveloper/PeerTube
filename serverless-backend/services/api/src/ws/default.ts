import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { fail, ok } from '@pt/shared';

export async function handler(event: APIGatewayProxyWebsocketEventV2) {
  try {
    return ok({
      routeKey: event.requestContext.routeKey,
      message: 'Message received',
    });
  } catch (error) {
    return fail(error);
  }
}
