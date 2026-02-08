#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { resolveStageConfig } from '../lib/config';
import { PeerTubeServerlessStack } from '../lib/peertube-serverless-stack';

const app = new cdk.App();
const stage = app.node.tryGetContext('stage') as string | undefined;
const region = app.node.tryGetContext('region') as string | undefined;
const config = resolveStageConfig(stage, region);

new PeerTubeServerlessStack(app, `PeerTubeServerless-${config.stage}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: config.region,
  },
  config,
  description: `PeerTube-like serverless backend (${config.stage})`,
});
