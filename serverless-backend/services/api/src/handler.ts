import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ApiError, fail, logger, readIdentity } from '@pt/shared';
import { readConfig } from './config';
import type { RequestContext } from './domain/context';
import { Repository } from './domain/repository';
import { adminBootstrapRoute } from './routes/admin';
import {
  actorRoute,
  inboxRoute,
  outboxRoute,
  registerRemoteActorRoute,
} from './routes/activitypub';
import { createChannelRoute, listChannelsRoute, updateChannelRoute } from './routes/channels';
import { createCommentRoute, deleteCommentRoute, listCommentsRoute } from './routes/comments';
import { healthRoute } from './routes/health';
import { banUserRoute, hideVideoRoute, reportContentRoute, takedownVideoRoute } from './routes/moderation';
import {
  completeVideoUploadRoute,
  createVideoDraftRoute,
  getVideoRoute,
  initiateVideoUploadRoute,
  listVideosRoute,
  playbackRoute,
  publishVideoRoute,
  registerViewRoute,
  unpublishVideoRoute,
} from './routes/videos';

type RouteAuth = 'public' | 'jwt' | 'optional-jwt';

type RouteHandler = (ctx: RequestContext) => Promise<APIGatewayProxyResultV2>;

interface Route {
  method: string;
  pattern: RegExp;
  auth: RouteAuth;
  handler: RouteHandler;
}

const routes: Route[] = [
  { method: 'GET', pattern: /^\/healthz$/, auth: 'public', handler: async () => healthRoute() },
  { method: 'POST', pattern: /^\/admin\/bootstrap$/, auth: 'public', handler: adminBootstrapRoute },
  { method: 'POST', pattern: /^\/auth\/bootstrap-admin$/, auth: 'public', handler: adminBootstrapRoute },

  { method: 'POST', pattern: /^\/channels$/, auth: 'jwt', handler: createChannelRoute },
  { method: 'PATCH', pattern: /^\/channels\/(?<channelId>[^/]+)$/, auth: 'jwt', handler: updateChannelRoute },
  { method: 'GET', pattern: /^\/channels$/, auth: 'public', handler: listChannelsRoute },

  { method: 'POST', pattern: /^\/videos\/drafts$/, auth: 'jwt', handler: createVideoDraftRoute },
  { method: 'POST', pattern: /^\/videos\/(?<videoId>[^/]+)\/upload\/initiate$/, auth: 'jwt', handler: initiateVideoUploadRoute },
  { method: 'POST', pattern: /^\/videos\/(?<videoId>[^/]+)\/upload\/complete$/, auth: 'jwt', handler: completeVideoUploadRoute },
  { method: 'POST', pattern: /^\/videos\/(?<videoId>[^/]+)\/publish$/, auth: 'jwt', handler: publishVideoRoute },
  { method: 'POST', pattern: /^\/videos\/(?<videoId>[^/]+)\/unpublish$/, auth: 'jwt', handler: unpublishVideoRoute },
  { method: 'GET', pattern: /^\/videos$/, auth: 'public', handler: listVideosRoute },
  { method: 'GET', pattern: /^\/videos\/(?<videoId>[^/]+)$/, auth: 'public', handler: getVideoRoute },
  { method: 'GET', pattern: /^\/videos\/(?<videoId>[^/]+)\/playback$/, auth: 'optional-jwt', handler: playbackRoute },
  { method: 'POST', pattern: /^\/videos\/(?<videoId>[^/]+)\/views$/, auth: 'public', handler: registerViewRoute },

  { method: 'POST', pattern: /^\/videos\/(?<videoId>[^/]+)\/comments$/, auth: 'jwt', handler: createCommentRoute },
  { method: 'GET', pattern: /^\/videos\/(?<videoId>[^/]+)\/comments$/, auth: 'public', handler: listCommentsRoute },
  { method: 'DELETE', pattern: /^\/videos\/(?<videoId>[^/]+)\/comments\/(?<commentId>[^/]+)$/, auth: 'jwt', handler: deleteCommentRoute },

  { method: 'POST', pattern: /^\/moderation\/reports$/, auth: 'jwt', handler: reportContentRoute },
  { method: 'POST', pattern: /^\/moderation\/videos\/(?<videoId>[^/]+)\/takedown$/, auth: 'jwt', handler: takedownVideoRoute },
  { method: 'POST', pattern: /^\/moderation\/videos\/(?<videoId>[^/]+)\/hide$/, auth: 'jwt', handler: hideVideoRoute },
  { method: 'POST', pattern: /^\/moderation\/users\/(?<userId>[^/]+)\/ban$/, auth: 'jwt', handler: banUserRoute },

  { method: 'GET', pattern: /^\/activitypub\/actor\/(?<actorId>[^/]+)$/, auth: 'public', handler: actorRoute },
  { method: 'POST', pattern: /^\/activitypub\/inbox$/, auth: 'public', handler: inboxRoute },
  { method: 'POST', pattern: /^\/activitypub\/outbox$/, auth: 'jwt', handler: outboxRoute },
  { method: 'POST', pattern: /^\/activitypub\/actors\/register$/, auth: 'jwt', handler: registerRemoteActorRoute },
];

function corsHeaders(event: APIGatewayProxyEventV2WithJWTAuthorizer, allowedOrigins: string[]): Record<string, string> {
  const origin = event.headers.origin;
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? '*';

  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,idempotency-key,signature,date,digest',
    'access-control-allow-credentials': 'true',
  };
}

function withCors(result: APIGatewayProxyResultV2, headers: Record<string, string>): APIGatewayProxyResultV2 {
  return {
    ...result,
    headers: {
      ...(result.headers ?? {}),
      ...headers,
    },
  };
}

function stripTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }

  return path;
}

function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | undefined {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }

    const match = route.pattern.exec(path);
    if (!match) {
      continue;
    }

    return {
      route,
      params: (match.groups ?? {}) as Record<string, string>,
    };
  }

  return undefined;
}

function tryReadIdentity(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  if (!event.requestContext.authorizer?.jwt?.claims?.sub) {
    return undefined;
  }

  try {
    return readIdentity(event);
  } catch {
    return undefined;
  }
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const config = readConfig();
  const cors = corsHeaders(event, config.allowedOrigins);

  if (event.requestContext.http.method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: cors,
    };
  }

  try {
    const path = stripTrailingSlash(event.rawPath);
    const method = event.requestContext.http.method;
    const matched = matchRoute(method, path);

    if (!matched) {
      throw new ApiError(404, 'NOT_FOUND', `No route for ${method} ${path}`);
    }

    const identity = tryReadIdentity(event);
    if (matched.route.auth === 'jwt' && !identity) {
      throw new ApiError(401, 'UNAUTHORIZED', 'JWT authentication required');
    }

    const ctx: RequestContext = {
      event,
      params: matched.params,
      identity,
      repo: new Repository(config.tableName),
      config,
    };

    const response = await matched.route.handler(ctx);
    return withCors(response, cors);
  } catch (error) {
    logger.error('API request failed', {
      requestId: event.requestContext.requestId,
      path: event.rawPath,
      method: event.requestContext.http.method,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return withCors(fail(error), cors);
  }
}
