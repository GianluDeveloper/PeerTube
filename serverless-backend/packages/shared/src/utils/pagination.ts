export function encodeCursor(lastEvaluatedKey: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url');
}

export function decodeCursor(cursor?: string): Record<string, unknown> | undefined {
  if (!cursor) {
    return undefined;
  }

  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
}
