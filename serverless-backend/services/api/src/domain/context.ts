import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { RequestIdentity } from '@pt/shared';
import { Repository } from './repository';
import type { ApiConfig } from '../config';

export interface RequestContext {
  event: APIGatewayProxyEventV2WithJWTAuthorizer;
  params: Record<string, string>;
  identity?: RequestIdentity;
  repo: Repository;
  config: ApiConfig;
}
