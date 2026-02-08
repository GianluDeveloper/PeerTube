import crypto from 'crypto';

function toUrlSafeBase64(value: string): string {
  return value.replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');
}

export function signCloudFrontUrl(input: {
  resourceUrl: string;
  keyPairId: string;
  privateKeyPem: string;
  expiresEpochSeconds: number;
}): string {
  const policy = JSON.stringify({
    Statement: [
      {
        Resource: input.resourceUrl,
        Condition: {
          DateLessThan: {
            'AWS:EpochTime': input.expiresEpochSeconds,
          },
        },
      },
    ],
  });

  const signer = crypto.createSign('RSA-SHA1');
  signer.update(policy);
  const signature = signer.sign(input.privateKeyPem, 'base64');
  const url = new URL(input.resourceUrl);

  url.searchParams.set('Policy', toUrlSafeBase64(Buffer.from(policy).toString('base64')));
  url.searchParams.set('Signature', toUrlSafeBase64(signature));
  url.searchParams.set('Key-Pair-Id', input.keyPairId);

  return url.toString();
}
