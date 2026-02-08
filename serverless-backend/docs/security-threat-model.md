# Security Posture and Threat Model

## Security controls implemented
- Cognito User Pool auth with JWT authorizer for protected API routes.
- RBAC via Cognito groups (`admin`, `mod`, `user`) enforced in application logic.
- S3 encryption with KMS CMK; DynamoDB encryption with KMS CMK.
- Secrets in Secrets Manager (admin bootstrap token, signing material placeholders).
- API WAF (AWS managed rule set + IP rate limiting).
- CORS restricted to environment-specific origins.
- Upload constraints: content type + size validated asynchronously before processing.
- Private playback support via signed URLs (CloudFront preferred; S3 signed fallback).
- ActivityPub HTTP signature verification + replay window checks + dedupe TTL keys.

## OWASP-focused controls
- Input validation through Zod on request bodies and query parameters.
- Consistent error envelopes avoid leaking stack traces.
- Idempotency keys on critical write paths (upload completion).
- Least privilege IAM grants scoped by resource where possible.
- Lambda tracing and structured logs for forensic auditability.

## Threat highlights

### 1) Upload abuse (oversized/non-video payloads)
- Mitigation:
  - Presigned multipart constraints + post-upload validation (`HeadObject`).
  - Reject unsupported MIME and excessive size.
  - Optional parity add-on: ClamAV scan in async branch.

### 2) Private content leakage
- Mitigation:
  - Buckets are private; access through CloudFront OAC.
  - Private manifest retrieval uses signed URL.
  - Recommendation: enforce CloudFront trusted key groups on private path behaviors.

### 3) Federation spoof/replay
- Mitigation:
  - Verify RSA signatures against registered `keyId` public keys.
  - Date skew window (5 minutes).
  - Dedupe/replay record with TTL in DynamoDB.

### 4) API abuse and brute force
- Mitigation:
  - WAF rate limits.
  - Cognito account protections.
  - Application-level throttling/idempotency for expensive actions.

## Residual risks
- WebSocket connect currently trusts `userId` query parameter for MVP presence.
  - Production hardening: add Lambda authorizer or JWT token verification on `$connect`.
- CloudFront signed URL enforcement requires key-group behavior setup for strict private path gating.
