import crypto from 'crypto';
import { ApiError } from './http';

export interface ParsedSignatureHeader {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
}

export function parseSignatureHeader(headerValue: string | undefined): ParsedSignatureHeader {
  if (!headerValue) {
    throw new ApiError(401, 'SIGNATURE_MISSING', 'Missing Signature header');
  }

  const parts = headerValue
    .split(',')
    .map((part) => part.trim())
    .map((part) => {
      const [key, rawValue] = part.split('=');
      return [key, rawValue?.replace(/^"|"$/g, '')] as const;
    });

  const values = Object.fromEntries(parts);
  const keyId = values.keyId;
  const algorithm = values.algorithm;
  const signature = values.signature;
  const headers = values.headers?.split(' ') ?? ['(request-target)', 'date'];

  if (!keyId || !algorithm || !signature) {
    throw new ApiError(401, 'SIGNATURE_INVALID', 'Invalid Signature header format');
  }

  return { keyId, algorithm, headers, signature };
}

export function buildSigningString(
  method: string,
  pathWithQuery: string,
  headers: Record<string, string | undefined>,
  coveredHeaders: string[],
): string {
  return coveredHeaders
    .map((header) => {
      if (header === '(request-target)') {
        return `(request-target): ${method.toLowerCase()} ${pathWithQuery}`;
      }

      const value = headers[header.toLowerCase()];
      if (!value) {
        throw new ApiError(401, 'SIGNATURE_INVALID', `Missing signed header: ${header}`);
      }

      return `${header.toLowerCase()}: ${value}`;
    })
    .join('\n');
}

export function verifyRsaSha256(signingString: string, signatureB64: string, publicKeyPem: string): boolean {
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signingString);
  verifier.end();

  return verifier.verify(publicKeyPem, Buffer.from(signatureB64, 'base64'));
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
