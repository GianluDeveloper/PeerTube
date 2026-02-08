import crypto from 'crypto';
import {
  buildSigningString,
  parseSignatureHeader,
  verifyRsaSha256,
} from '@pt/shared';

describe('activitypub signature verification', () => {
  it('parses header and verifies rsa-sha256 signature', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });

    const signingString = buildSigningString(
      'POST',
      '/activitypub/inbox',
      {
        host: 'example.com',
        date: 'Mon, 01 Jan 2024 00:00:00 GMT',
      },
      ['(request-target)', 'host', 'date'],
    );

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingString);
    signer.end();
    const signature = signer.sign(privateKey.export({ type: 'pkcs1', format: 'pem' }), 'base64');

    const header = `keyId=\"https://remote.example/actor#main-key\",algorithm=\"rsa-sha256\",headers=\"(request-target) host date\",signature=\"${signature}\"`;
    const parsed = parseSignatureHeader(header);

    const verified = verifyRsaSha256(
      signingString,
      parsed.signature,
      publicKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    );

    expect(verified).toBe(true);
    expect(parsed.keyId).toContain('#main-key');
  });
});
