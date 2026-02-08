import {
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ApiError, ok } from '@pt/shared';
import { z } from 'zod';
import type { RequestContext } from '../domain/context';
import { cognitoClient, secretsClient } from '../domain/clients';

const bootstrapSchema = z.object({
  email: z.string().email(),
  bootstrapToken: z.string().min(20),
});

export async function adminBootstrapRoute(ctx: RequestContext) {
  let body: unknown = {};
  try {
    body = JSON.parse(ctx.event.body ?? '{}');
  } catch {
    throw new ApiError(400, 'INVALID_BODY', 'Request body must be valid JSON');
  }

  const payload = bootstrapSchema.safeParse(body);
  if (!payload.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', payload.error.issues.map((i) => i.message).join('; '));
  }

  const secret = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: ctx.config.adminBootstrapSecretName,
    }),
  );

  const parsedSecret = secret.SecretString ? JSON.parse(secret.SecretString) : {};
  const expectedToken = parsedSecret.bootstrapToken as string | undefined;
  if (!expectedToken || payload.data.bootstrapToken !== expectedToken) {
    throw new ApiError(403, 'BOOTSTRAP_DENIED', 'Invalid bootstrap token');
  }

  const user = await cognitoClient.send(
    new AdminGetUserCommand({
      UserPoolId: ctx.config.cognitoUserPoolId,
      Username: payload.data.email,
    }),
  );

  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: ctx.config.cognitoUserPoolId,
      Username: user.Username ?? payload.data.email,
      GroupName: 'admin',
    }),
  );

  return ok({ email: payload.data.email, role: 'admin', bootstrapped: true });
}
