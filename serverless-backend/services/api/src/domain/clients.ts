import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SQSClient } from '@aws-sdk/client-sqs';

export const s3Client = new S3Client({});
export const eventBridgeClient = new EventBridgeClient({});
export const cognitoClient = new CognitoIdentityProviderClient({});
export const secretsClient = new SecretsManagerClient({});
export const sqsClient = new SQSClient({});
