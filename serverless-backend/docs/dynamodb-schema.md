# DynamoDB Data Model

Primary table: `CoreTable` (single table)
- PK: `pk` (string)
- SK: `sk` (string)
- GSIs:
  - `gsi1(gsi1pk, gsi1sk)`
  - `gsi2(gsi2pk, gsi2sk)`
- TTL attribute: `ttl`

## Entity patterns

### Users
- User profile:
  - `PK=USER#{userId}`, `SK=PROFILE`
- Ban metadata stored on profile item.

### Channels
- Channel profile:
  - `PK=CHANNEL#{channelId}`, `SK=PROFILE`
  - `gsi1pk=HANDLE#{handle}`, `gsi1sk=CHANNEL#{channelId}`
  - `gsi2pk=CHANNELS`, `gsi2sk={createdAt}#{channelId}`
- Owner mapping:
  - `PK=USER#{userId}`, `SK=CHANNEL#{channelId}`
- Handle uniqueness lock:
  - `PK=HANDLE#{handle}`, `SK=CHANNEL`

### Videos
- Video metadata:
  - `PK=VIDEO#{videoId}`, `SK=METADATA`
  - `gsi1pk=VIDEOS_BY_STATE#{state}`, `gsi1sk={updatedAt}#{videoId}`
- Channel listing item:
  - `PK=CHANNEL#{channelId}`, `SK=VIDEO#{createdAt}#{videoId}`
- Search token entries (basic search):
  - `PK=SEARCH#{token}`, `SK=VIDEO#{videoId}`

### Comments
- `PK=VIDEO#{videoId}`, `SK=COMMENT#{createdAt}#{commentId}`
- Optional author index:
  - `gsi2pk=COMMENT_AUTHOR#{userId}`, `gsi2sk={createdAt}#{commentId}`

### Views (dedupe + counter shards)
- Dedupe key (TTL ~24h):
  - `PK=VIDEO#{videoId}`, `SK=VIEWDEDUP#{viewerHash}#{hourBucket}`, `ttl`
- Counter shards:
  - `PK=VIDEO#{videoId}`, `SK=VIEWCOUNT#{shard}` with `ADD viewCount :inc`

### WebSocket connection registry
- Connection item (TTL ~24h):
  - `PK=WS#{connectionId}`, `SK=CONNECTION`, `ttl`
  - `gsi1pk=WSUSER#{userId}`, `gsi1sk=CONN#{connectedAt}`

### Federation
- Remote actor profile:
  - `PK=FED#ACTOR#{actorId}`, `SK=PROFILE`
- KeyId pointer:
  - `PK=FED#KEY#{keyId}`, `SK=ACTOR`
- Follow relation:
  - `PK=FED#FOLLOW#{localActor}`, `SK=REMOTE#{remoteActor}`
  - reverse lookup: `gsi1pk=FED_FOLLOWERS#{remoteActor}`, `gsi1sk=LOCAL#{localActor}`
- Inbox dedupe:
  - `PK=FED#DEDUPE#{dedupeHash}`, `SK=ACTIVITY`, `ttl`
- Delivery attempt log:
  - `PK=FED#DELIVERY#{deliveryId}`, `SK=ATTEMPT#{n}`
  - `gsi2pk=FED_DELIVERY_PENDING|FAILED|SUCCEEDED`, `gsi2sk={nextAttemptAt}#{deliveryId}`

## Conditional writes and invariants
- Channel handle uniqueness: `TransactWrite` with `attribute_not_exists` on handle lock.
- Upload finalize idempotency: idempotency item (`IDEMPOTENCY#scope`, request id) with conditional put.
- State transitions:
  - `UPLOADED -> TRANSCODING` conditional update in validate step.
  - `TRANSCODING -> PUBLISHED` in finalize step.
- Federation dedupe: conditional put on `FED#DEDUPE#...`.
- View dedupe: conditional put on `VIEWDEDUP` item before shard increment.

## Hot partition mitigation
- View counters use fixed shard fan-out (`VIEWCOUNT#0..19`).
- Search token writes are bounded (`<=12` tokens/video).
- Time-ordered keys (`{timestamp}#{id}`) spread reads for timeline-like queries.
- For very high ingest, partition large feeds by date bucket (parity path).
