# PeerTube Serverless Backend (AWS)

Production-grade, serverless backend designed to replicate PeerTube server-side responsibilities using AWS managed services.

## What this repo includes
- `infra/` AWS CDK v2 (TypeScript) infrastructure
- `services/api/` HTTP API + ActivityPub + WebSocket connect/disconnect handlers
- `services/worker/` async processing workers (transcoding pipeline, federation delivery, notifications)
- `packages/shared/` common types, schemas, auth/context helpers, DynamoDB utilities
- `tests/` unit + integration tests
- `docs/` architecture, OpenAPI, DynamoDB schema, runbook, security and cost notes

## WebSocket/tracker realism choice
Implemented default: **API Gateway WebSocket + Lambda + DynamoDB registry**.
- This is the production-focused serverless choice for real-time notifications and presence.
- Full WebTorrent tracker parity is documented as a parity path via **ECS Fargate** dedicated tracker service.

## Repository tree

```text
serverless-backend/
├── infra/
│   ├── bin/app.ts
│   ├── lib/config.ts
│   ├── lib/peertube-serverless-stack.ts
│   ├── cdk.json
│   └── package.json
├── services/
│   ├── api/
│   │   └── src/
│   │       ├── handler.ts
│   │       ├── config.ts
│   │       ├── domain/
│   │       ├── routes/
│   │       └── ws/
│   └── worker/
│       └── src/
│           ├── handlers/
│           ├── pipeline/
│           ├── config.ts
│           └── repository.ts
├── packages/
│   └── shared/
│       └── src/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── utils/
├── docs/
│   ├── architecture.md
│   ├── openapi.yaml
│   ├── dynamodb-schema.md
│   ├── security-threat-model.md
│   ├── runbook.md
│   └── cost-scaling.md
├── scripts/
│   ├── start-dynamodb-local.sh
│   └── run-integration-local.sh
├── docker-compose.local.yml
└── package.json
```

## Quick start
1. `cd serverless-backend`
2. `npm install`
3. `npm run lint`
4. `npm run test`
5. `npm run synth`

Deploy per environment:
- `npm run deploy:dev`
- `npm run deploy:stage`
- `npm run deploy:prod`

## Local development/testing
Uses **DynamoDB Local**.

1. `./scripts/start-dynamodb-local.sh`
2. `./scripts/run-integration-local.sh`

## API contract
OpenAPI spec: `docs/openapi.yaml`

## Operational docs
- Runbook: `docs/runbook.md`
- Security and threat model: `docs/security-threat-model.md`
- Cost/scaling: `docs/cost-scaling.md`
- DynamoDB schema details: `docs/dynamodb-schema.md`
