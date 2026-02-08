#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export DYNAMODB_ENDPOINT="${DYNAMODB_ENDPOINT:-http://127.0.0.1:8000}"
export AWS_REGION="${AWS_REGION:-eu-central-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-local}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-local}"

npm --workspace tests run test:integration
