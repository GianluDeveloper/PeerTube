# Architecture Overview

## Assumptions
- Single-tenant instance per environment (`dev`, `stage`, `prod`) with isolated AWS resources.
- Region default is `eu-central-1` and can be overridden in CDK context.
- Client applications authenticate with Cognito and call API Gateway HTTP API directly.
- Video bytes never pass through Lambda; clients upload directly to S3 multipart presigned URLs.
- Federation remote public keys are pre-registered (MVP) through an admin endpoint.

## Service Map

```text
[Web/App Client]
   | JWT (Cognito)
   v
[API Gateway HTTP API] ----> [Lambda API Router]
                                 |-- DynamoDB (metadata, comments, moderation, federation state)
                                 |-- S3 presigned multipart (uploads bucket)
                                 |-- EventBridge (VideoUploaded)
                                 |-- SQS (federation outbound queue)
                                 |-- Cognito Admin APIs (bootstrap/ban)

[Client] --multipart PUT--> [S3 Uploads Bucket]

[EventBridge VideoUploaded Rule] --> [Step Functions Video Pipeline]
                                          |-> Validate Upload Lambda (S3 HEAD + state transition)
                                          |-> Submit MediaConvert Lambda (CreateJob)
                                          |-> Poll MediaConvert Lambda (GetJob loop)
                                          |-> Finalize Lambda (mark published + notify)
                                          |-> Fail Lambda (mark failed)

[MediaConvert] -> [S3 Delivery Bucket (HLS + thumbnails)]

[CloudFront + OAC] -> [S3 Delivery Bucket]
   |-- serves HLS manifests/segments/thumbnails

[API Gateway WebSocket API] <-> [WS connect/disconnect/default Lambdas]
                                 |-- DynamoDB connection registry (TTL)

[SQS Notification Queue] -> [Notification Consumer Lambda] -> [API Gateway WS callback]
[SQS Federation Queue] -> [Federation Delivery Lambda with retries/backoff]

[WAF] protects HTTP API (managed rules + rate limit)
[CloudWatch/X-Ray] logs, metrics, traces, alarms, dashboard
[Secrets Manager + KMS] bootstrap token and signing material
```

## AWS Service Mapping
- API: API Gateway HTTP API + Lambda (`services/api`)
- Auth: Cognito User Pool + JWT authorizer
- Uploads: S3 presigned multipart direct upload (no media bytes through Lambda)
- Processing: EventBridge + Step Functions + MediaConvert + Lambda workers
- Storage: DynamoDB (system of record), S3 (originals and delivery artifacts)
- CDN: CloudFront + S3 origin access control
- Realtime: API Gateway WebSocket + Lambda + DynamoDB connection registry
- Queues: SQS for federation deliveries and notifications
- Secrets: Secrets Manager + KMS CMK
- Email: SES integration point reserved (Cognito email templates/verification path)
- Security edge: AWS WAF (API managed rules + rate limiting)
- Observability: CloudWatch logs/metrics/alarms dashboard + X-Ray tracing

## WebTorrent/Tracker Realism Choice

### Implemented default: Option A (API Gateway WebSocket + Lambda + DynamoDB registry)
- Pros:
  - Fully managed and serverless; no always-on containers.
  - Fits real-time notification requirements and user presence updates.
  - Straightforward to scale and integrate with auth + DynamoDB.
- Cons:
  - Not protocol-compatible with a full BitTorrent tracker implementation.
  - API Gateway WS is optimized for app messaging, not high-churn tracker announce semantics.

### Parity path: Option B (ECS Fargate tracker service)
- For full WebTorrent tracker parity, deploy a dedicated tracker container on Fargate behind NLB/ALB.
- Keep current serverless control-plane (metadata/auth/moderation/transcoding/federation) unchanged.
- This isolates tracker protocol complexity while preserving mostly serverless operations.

## Why this default is production-realistic
- PeerTube-style backend responsibilities are mostly event-driven CRUD + async media processing, which map well to Lambda/SQS/Step Functions/MediaConvert.
- API Gateway WebSocket is operationally simpler than self-managed tracker infra for MVP and supports real-time product behavior.
- The design explicitly documents Fargate tracker as the parity step when strict tracker semantics are required.
