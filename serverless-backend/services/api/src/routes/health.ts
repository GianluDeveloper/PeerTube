import { ok } from '@pt/shared';

export async function healthRoute() {
  return ok({ status: 'ok', timestamp: new Date().toISOString() });
}
