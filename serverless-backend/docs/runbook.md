# Operations Runbook

## Prerequisites
- AWS credentials with permissions for CDK deploy.
- Node.js 20+.
- Bootstrap target account/region for CDK.

## Deploy
1. `cd serverless-backend`
2. `npm install`
3. `npm run synth`
4. `npm run deploy:dev` (or `deploy:stage`, `deploy:prod`)

## Post-deploy bootstrap
1. Sign up first user in Cognito.
2. Retrieve bootstrap token from Secrets Manager output secret.
3. Call `POST /auth/bootstrap-admin` with `{ email, bootstrapToken }`.
4. Rotate bootstrap secret after first admin promotion.

## Standard checks
- API health: `GET /healthz`
- Confirm pipeline processing by uploading a small test video.
- Verify CloudWatch dashboard `pt-{stage}-ops`.
- Confirm SQS DLQs remain empty.

## Incident playbooks

### A) Video stuck in TRANSCODING
- Check Step Functions execution history.
- Check MediaConvert job status and IAM pass-role errors.
- Re-drive from state machine input with same `videoId` if safe.
- If job failed, inspect `transcodeError` on video item.

### B) Federation queue growth / DLQ messages
- Inspect federation consumer logs for signature/host errors.
- Verify outbound signing key validity and rotation status.
- Re-drive DLQ after root-cause fix with capped batch sizes.

### C) Notification delivery failures
- Check `GoneException` rates (stale connections expected).
- Confirm WebSocket callback URL configuration.
- Verify connection registry TTL and GSI query behavior.

### D) Elevated API errors / throttles
- Inspect WAF blocked requests and Lambda error logs.
- Verify upstream client behavior and auth failures.
- Increase Lambda concurrency and/or optimize hot code paths.

## Backups and recovery
- DynamoDB PITR enabled.
- S3 versioning enabled on uploads/delivery buckets.
- Recovery path:
  - restore DynamoDB table to point in time,
  - restore required S3 object versions,
  - replay incomplete pipeline events from EventBridge archive (parity add-on).
