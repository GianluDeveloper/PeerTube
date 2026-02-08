import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ApiError } from '../utils/http';
import type { Role } from '../types/entities';

export interface RequestIdentity {
  userId: string;
  email?: string;
  roles: Role[];
}

export function readIdentity(event: APIGatewayProxyEventV2WithJWTAuthorizer): RequestIdentity {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = claims.sub;
  if (!sub || typeof sub !== 'string') {
    throw new ApiError(401, 'UNAUTHORIZED', 'Missing JWT subject claim');
  }

  const groupsRaw = claims['cognito:groups'];
  const groups = typeof groupsRaw === 'string' ? groupsRaw.split(',') : [];
  const roles: Role[] = groups.filter((g): g is Role => g === 'admin' || g === 'mod' || g === 'user');

  if (roles.length === 0) {
    roles.push('user');
  }

  return {
    userId: sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    roles,
  };
}

export function requireRole(identity: RequestIdentity, ...allowed: Role[]): void {
  if (allowed.some((role) => identity.roles.includes(role))) {
    return;
  }

  throw new ApiError(403, 'FORBIDDEN', `Required role: ${allowed.join('|')}`);
}
