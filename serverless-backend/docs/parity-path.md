# Parity Path Roadmap

## 1) Full WebTorrent tracker compatibility
- Current default is API Gateway WebSocket-based real-time notifications.
- For strict WebTorrent tracker protocol parity:
  - Deploy tracker service on ECS Fargate (WebSocket/UDP-compatible implementation).
  - Front with NLB/ALB and autoscaling.
  - Persist peer/session metadata in Redis (ElastiCache) with short TTL.
  - Keep API/federation/transcoding planes serverless.

## 2) Remote video redundancy/mirroring
- Add async mirror workflow:
  - Trigger from federation announce/create events.
  - Queue mirror jobs in SQS.
  - Fetch remote media to S3 cache bucket with integrity checks.
  - Maintain cache eviction policies by popularity and age.

## 3) Remote channel import/sync
- Add scheduled EventBridge jobs per followed remote actor.
- Pull outbox deltas with idempotent activity checkpointing.
- Store import cursors in DynamoDB and retry failures with exponential backoff.

## 4) Search at scale
- Current MVP uses DynamoDB token index items.
- Move to OpenSearch Serverless when:
  - catalog > ~1M videos,
  - fuzzy matching/ranking required,
  - multi-field relevance and stemming are needed.
