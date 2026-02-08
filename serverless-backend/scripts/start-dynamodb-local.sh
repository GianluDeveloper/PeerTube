#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
docker compose -f docker-compose.local.yml up -d

echo "DynamoDB Local started on http://127.0.0.1:8000"
