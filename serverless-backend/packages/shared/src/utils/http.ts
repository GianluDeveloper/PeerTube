import type { APIGatewayProxyResultV2 } from 'aws-lambda';

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function ok<T>(data: T, statusCode = 200): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ data }),
  };
}

export function accepted<T>(data: T): APIGatewayProxyResultV2 {
  return ok(data, 202);
}

export function noContent(): APIGatewayProxyResultV2 {
  return {
    statusCode: 204,
    headers: {},
  };
}

export function fail(error: unknown): APIGatewayProxyResultV2 {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
        },
      }),
    };
  }

  return {
    statusCode: 500,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected internal error',
      },
    }),
  };
}
