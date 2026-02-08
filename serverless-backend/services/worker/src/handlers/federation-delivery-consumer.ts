import crypto from 'crypto';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { SQSEvent } from 'aws-lambda';
import { logger } from '@pt/shared';
import { readConfig } from '../config';
import { WorkerRepository } from '../repository';

const sqs = new SQSClient({});
const MAX_ATTEMPTS = 8;

interface DeliveryMessage {
  activityId: string;
  actorId: string;
  recipientInbox: string;
  payload: Record<string, unknown>;
  attempt: number;
  nextAttemptAt: string;
  deliveryId?: string;
}

function calculateBackoffSeconds(attempt: number): number {
  const base = 2 ** attempt;
  return Math.min(base * 15, 900);
}

function buildSigningString(targetPath: string, host: string, date: string, digest: string): string {
  return [`(request-target): post ${targetPath}`, `host: ${host}`, `date: ${date}`, `digest: ${digest}`].join('\n');
}

function signRequest(input: { payloadString: string; inboxUrl: string; privateKeyPem: string; keyId: string }) {
  const url = new URL(input.inboxUrl);
  const date = new Date().toUTCString();
  const digest = `SHA-256=${crypto.createHash('sha256').update(input.payloadString).digest('base64')}`;
  const signingString = buildSigningString(url.pathname + url.search, url.host, date, digest);

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingString);
  signer.end();
  const signature = signer.sign(input.privateKeyPem, 'base64');

  const signatureHeader = `keyId=\"${input.keyId}\",algorithm=\"rsa-sha256\",headers=\"(request-target) host date digest\",signature=\"${signature}\"`;

  return {
    date,
    digest,
    signatureHeader,
  };
}

export async function handler(event: SQSEvent) {
  const config = readConfig();
  const repo = new WorkerRepository(config.tableName);

  for (const record of event.Records) {
    const message = JSON.parse(record.body) as DeliveryMessage;
    const deliveryId = message.deliveryId ?? crypto.randomUUID();
    const payloadString = JSON.stringify(message.payload);

    if (!config.activityPubPrivateKeyPem || !config.activityPubKeyId) {
      throw new Error('ActivityPub signing configuration is missing');
    }

    const signedHeaders = signRequest({
      payloadString,
      inboxUrl: message.recipientInbox,
      privateKeyPem: config.activityPubPrivateKeyPem,
      keyId: config.activityPubKeyId,
    });

    try {
      const response = await fetch(message.recipientInbox, {
        method: 'POST',
        headers: {
          'content-type': 'application/activity+json',
          date: signedHeaders.date,
          digest: signedHeaders.digest,
          signature: signedHeaders.signatureHeader,
        },
        body: payloadString,
      });

      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }

      await repo.putFederationDeliveryAttempt({
        deliveryId,
        attempt: message.attempt,
        activityId: message.activityId,
        recipientInbox: message.recipientInbox,
        status: 'SUCCEEDED',
      });
    } catch (error) {
      const nextAttempt = message.attempt + 1;
      const errorMessage = error instanceof Error ? error.message : 'unknown error';
      const nextDelay = calculateBackoffSeconds(nextAttempt);
      const nextAttemptAt = new Date(Date.now() + nextDelay * 1000).toISOString();

      await repo.putFederationDeliveryAttempt({
        deliveryId,
        attempt: message.attempt,
        activityId: message.activityId,
        recipientInbox: message.recipientInbox,
        status: 'FAILED',
        lastError: errorMessage,
        nextAttemptAt,
      });

      if (nextAttempt <= MAX_ATTEMPTS) {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: config.federationQueueUrl,
            DelaySeconds: nextDelay,
            MessageBody: JSON.stringify({
              ...message,
              attempt: nextAttempt,
              nextAttemptAt,
              deliveryId,
            }),
          }),
        );
      }

      logger.warn('Federation delivery attempt failed', {
        deliveryId,
        activityId: message.activityId,
        recipientInbox: message.recipientInbox,
        attempt: message.attempt,
        errorMessage,
      });
    }
  }
}
