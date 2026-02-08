import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import type { StageConfig } from './config';

interface PeerTubeServerlessStackProps extends cdk.StackProps {
  config: StageConfig;
}

export class PeerTubeServerlessStack extends cdk.Stack {
  public constructor(scope: Construct, id: string, props: PeerTubeServerlessStackProps) {
    super(scope, id, props);

    const { config } = props;
    const isProd = config.stage === 'prod';
    const rootDir = path.resolve(__dirname, '..', '..');
    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const dataKey = new kms.Key(this, 'DataKey', {
      alias: `alias/peertube-serverless-${config.stage}-data`,
      enableKeyRotation: true,
      removalPolicy,
    });

    const table = new dynamodb.Table(this, 'CoreTable', {
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
      removalPolicy,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: {
        name: 'gsi1pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi1sk',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'gsi2',
      partitionKey: {
        name: 'gsi2pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi2sk',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      versioned: true,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      eventBridgeEnabled: true,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(7),
          noncurrentVersionExpiration: Duration.days(30),
        },
      ],
      removalPolicy,
      autoDeleteObjects: !isProd,
    });

    const deliveryBucket = new s3.Bucket(this, 'DeliveryBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      versioned: true,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(30),
        },
      ],
      removalPolicy,
      autoDeleteObjects: !isProd,
    });

    const eventBus = new events.EventBus(this, 'DomainEventBus', {
      eventBusName: `peertube-serverless-${config.stage}`,
    });

    const federationDlq = new sqs.Queue(this, 'FederationDlq', {
      queueName: `pt-${config.stage}-federation-dlq`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      retentionPeriod: Duration.days(14),
    });

    const federationQueue = new sqs.Queue(this, 'FederationQueue', {
      queueName: `pt-${config.stage}-federation`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.minutes(5),
      deadLetterQueue: {
        queue: federationDlq,
        maxReceiveCount: 8,
      },
    });

    const notificationDlq = new sqs.Queue(this, 'NotificationDlq', {
      queueName: `pt-${config.stage}-notification-dlq`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      retentionPeriod: Duration.days(14),
    });

    const notificationQueue = new sqs.Queue(this, 'NotificationQueue', {
      queueName: `pt-${config.stage}-notification`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.minutes(2),
      deadLetterQueue: {
        queue: notificationDlq,
        maxReceiveCount: 5,
      },
    });

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `peertube-serverless-${config.stage}`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
      },
      removalPolicy,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
      generateSecret: false,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [`${config.instanceBaseUrl}/auth/callback`],
      },
    });

    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      groupName: 'admin',
      userPoolId: userPool.userPoolId,
      precedence: 1,
    });

    new cognito.CfnUserPoolGroup(this, 'ModGroup', {
      groupName: 'mod',
      userPoolId: userPool.userPoolId,
      precedence: 2,
    });

    new cognito.CfnUserPoolGroup(this, 'UserGroup', {
      groupName: 'user',
      userPoolId: userPool.userPoolId,
      precedence: 3,
    });

    const adminBootstrapSecret = new secretsmanager.Secret(this, 'AdminBootstrapSecret', {
      secretName: `peertube-serverless/${config.stage}/admin-bootstrap`,
      description: 'Bootstrap token used once to promote first admin',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'bootstrapToken',
        passwordLength: 48,
      },
    });

    const activityPubSigningSecret = new secretsmanager.Secret(this, 'ActivityPubSigningSecret', {
      secretName: `peertube-serverless/${config.stage}/activitypub-signing`,
      description: 'Replace with RSA private key for ActivityPub HTTP signatures',
      secretObjectValue: {
        keyId: cdk.SecretValue.unsafePlainText(`${config.instanceBaseUrl}/activitypub/actor/system#main-key`),
        privateKeyPem: cdk.SecretValue.unsafePlainText('REPLACE_WITH_RSA_PRIVATE_KEY_PEM'),
      },
    });

    const cloudFrontSigningSecret = new secretsmanager.Secret(this, 'CloudFrontSigningSecret', {
      secretName: `peertube-serverless/${config.stage}/cloudfront-signing`,
      description: 'Replace with CloudFront key pair material for private playback signed URLs',
      secretObjectValue: {
        keyPairId: cdk.SecretValue.unsafePlainText('REPLACE_WITH_CLOUDFRONT_KEY_PAIR_ID'),
        privateKeyPem: cdk.SecretValue.unsafePlainText('REPLACE_WITH_CLOUDFRONT_PRIVATE_KEY_PEM'),
      },
    });

    const mediaConvertRole = new iam.Role(this, 'MediaConvertRole', {
      assumedBy: new iam.ServicePrincipal('mediaconvert.amazonaws.com'),
      description: 'Role assumed by MediaConvert jobs for PeerTube serverless transcoding',
    });

    uploadsBucket.grantRead(mediaConvertRole);
    deliveryBucket.grantReadWrite(mediaConvertRole);
    dataKey.grantEncryptDecrypt(mediaConvertRole);

    const commonNodeProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
      },
      environment: {
        SERVICE_NAME: 'placeholder',
        TABLE_NAME: table.tableName,
        UPLOADS_BUCKET: uploadsBucket.bucketName,
        DELIVERY_BUCKET: deliveryBucket.bucketName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        INSTANCE_BASE_URL: config.instanceBaseUrl,
        ALLOWED_ORIGINS: config.allowedOrigins.join(','),
      },
    };

    const wsConnectFn = new NodejsFunction(this, 'WsConnectFn', {
      ...commonNodeProps,
      entry: path.join(rootDir, 'services/api/src/ws/connect.ts'),
      handler: 'handler',
      functionName: `pt-${config.stage}-ws-connect`,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        ...commonNodeProps.environment,
        SERVICE_NAME: 'ws-connect',
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        ADMIN_BOOTSTRAP_SECRET_NAME: adminBootstrapSecret.secretName,
        CLOUDFRONT_DOMAIN: 'pending',
        WS_ENDPOINT: 'pending',
      },
    });

    const wsDisconnectFn = new NodejsFunction(this, 'WsDisconnectFn', {
      ...commonNodeProps,
      entry: path.join(rootDir, 'services/api/src/ws/disconnect.ts'),
      handler: 'handler',
      functionName: `pt-${config.stage}-ws-disconnect`,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        ...commonNodeProps.environment,
        SERVICE_NAME: 'ws-disconnect',
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        ADMIN_BOOTSTRAP_SECRET_NAME: adminBootstrapSecret.secretName,
        CLOUDFRONT_DOMAIN: 'pending',
        WS_ENDPOINT: 'pending',
      },
    });

    const wsDefaultFn = new NodejsFunction(this, 'WsDefaultFn', {
      ...commonNodeProps,
      entry: path.join(rootDir, 'services/api/src/ws/default.ts'),
      handler: 'handler',
      functionName: `pt-${config.stage}-ws-default`,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        ...commonNodeProps.environment,
        SERVICE_NAME: 'ws-default',
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        ADMIN_BOOTSTRAP_SECRET_NAME: adminBootstrapSecret.secretName,
        CLOUDFRONT_DOMAIN: 'pending',
        WS_ENDPOINT: 'pending',
      },
    });

    const wsApi = new apigwv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: `pt-${config.stage}-ws`,
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('WsConnectIntegration', wsConnectFn),
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('WsDisconnectIntegration', wsDisconnectFn),
      },
      defaultRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('WsDefaultIntegration', wsDefaultFn),
      },
    });

    const wsStage = new apigwv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: wsApi,
      stageName: config.stage,
      autoDeploy: true,
    });

    const originAccessControl = new cloudfront.CfnOriginAccessControl(this, 'MediaOac', {
      originAccessControlConfig: {
        name: `pt-${config.stage}-oac`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    const distribution = new cloudfront.CfnDistribution(this, 'MediaDistribution', {
      distributionConfig: {
        enabled: true,
        comment: `PeerTube serverless media distribution (${config.stage})`,
        priceClass: 'PriceClass_100',
        httpVersion: 'http2and3',
        defaultCacheBehavior: {
          targetOriginId: 'delivery-origin',
          viewerProtocolPolicy: 'redirect-to-https',
          allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
          compress: true,
          cachePolicyId: cloudfront.CachePolicy.CACHING_OPTIMIZED.cachePolicyId,
          originRequestPolicyId: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN.originRequestPolicyId,
        },
        origins: [
          {
            id: 'delivery-origin',
            domainName: deliveryBucket.bucketRegionalDomainName,
            s3OriginConfig: {
              originAccessIdentity: '',
            },
            originAccessControlId: originAccessControl.attrId,
          },
        ],
      },
    });

    deliveryBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontServicePrincipalReadOnly',
        actions: ['s3:GetObject'],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        resources: [deliveryBucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.ref}`,
          },
        },
      }),
    );

    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      ...commonNodeProps,
      entry: path.join(rootDir, 'services/api/src/handler.ts'),
      handler: 'handler',
      functionName: `pt-${config.stage}-api`,
      memorySize: 1024,
      timeout: Duration.seconds(29),
      environment: {
        ...commonNodeProps.environment,
        SERVICE_NAME: 'api',
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        ADMIN_BOOTSTRAP_SECRET_NAME: adminBootstrapSecret.secretName,
        WS_ENDPOINT: wsStage.callbackUrl,
        FEDERATION_QUEUE_URL: federationQueue.queueUrl,
        CLOUDFRONT_DOMAIN: distribution.attrDomainName,
        CF_KEY_PAIR_ID: cloudFrontSigningSecret.secretValueFromJson('keyPairId').toString(),
        CF_PRIVATE_KEY_PEM: cloudFrontSigningSecret.secretValueFromJson('privateKeyPem').toString(),
      },
    });

    const validateUploadFn = new NodejsFunction(this, 'ValidateUploadFn', {
      ...commonNodeProps,
      entry: path.join(rootDir, 'services/worker/src/pipeline/validate-upload.ts'),
      handler: 'handler',
      functionName: `pt-${config.stage}-validate-upload`,
      memorySize: 512,
      timeout: Duration.seconds(60),
      environment: {
        ...commonNodeProps.environment,
        SERVICE_NAME: 'worker-validate-upload',
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
        WS_ENDPOINT: wsStage.callbackUrl,
        FEDERATION_QUEUE_URL: federationQueue.queueUrl,
        NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
      },
    });

    const submitTranscodeFn = new NodejsFunction(this, 'SubmitTranscodeFn', {
      ...commonNodeProps,
      entry: path.join(rootDir, 'services/worker/src/pipeline/submit-transcode.ts'),
      handler: 'handler',
      functionName: `pt-${config.stage}-submit-transcode`,
      memorySize: 1024,
      timeout: Duration.minutes(1),
      environment: {
        ...commonNodeProps.environment,
        SERVICE_NAME: 'worker-submit-transcode',
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
        WS_ENDPOINT: wsStage.callbackUrl,
        FEDERATION_QUEUE_URL: federationQueue.queueUrl,
        NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
      },
    });

    const pollTranscodeFn = new NodejsFunction(this, 'PollTranscodeFn', {
      ...commonNodeProps,
      entry: path.join(rootDir, 'services/worker/src/pipeline/poll-transcode.ts'),
      handler: 'handler',
      functionName: `pt-${config.stage}-poll-transcode`,
      memorySize: 512,
      timeout: Duration.seconds(60),
      environment: {
        ...commonNodeProps.environment,
        SERVICE_NAME: 'worker-poll-transcode',
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
        WS_ENDPOINT: wsStage.callbackUrl,
        FEDERATION_QUEUE_URL: federationQueue.queueUrl,
        NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
      },
    });

    const finalizeVideoFn = new NodejsFunction(this, 'FinalizeVideoFn', {
      ...commonNodeProps,
      entry: path.join(rootDir, 'services/worker/src/pipeline/finalize-video.ts'),
      handler: 'handler',
      functionName: `pt-${config.stage}-finalize-video`,
      memorySize: 512,
      timeout: Duration.seconds(60),
      environment: {
        ...commonNodeProps.environment,
        SERVICE_NAME: 'worker-finalize-video',
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
        WS_ENDPOINT: wsStage.callbackUrl,
        FEDERATION_QUEUE_URL: federationQueue.queueUrl,
        NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
      },
    });

    const markVideoFailedFn = new NodejsFunction(this, 'MarkVideoFailedFn', {
      ...commonNodeProps,
      entry: path.join(rootDir, 'services/worker/src/pipeline/mark-video-failed.ts'),
      handler: 'handler',
      functionName: `pt-${config.stage}-mark-video-failed`,
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        ...commonNodeProps.environment,
        SERVICE_NAME: 'worker-mark-video-failed',
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
        WS_ENDPOINT: wsStage.callbackUrl,
        FEDERATION_QUEUE_URL: federationQueue.queueUrl,
        NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
      },
    });

    const federationConsumerFn = new NodejsFunction(this, 'FederationConsumerFn', {
      ...commonNodeProps,
      entry: path.join(rootDir, 'services/worker/src/handlers/federation-delivery-consumer.ts'),
      handler: 'handler',
      functionName: `pt-${config.stage}-federation-consumer`,
      memorySize: 512,
      timeout: Duration.minutes(2),
      environment: {
        ...commonNodeProps.environment,
        SERVICE_NAME: 'worker-federation-consumer',
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
        WS_ENDPOINT: wsStage.callbackUrl,
        FEDERATION_QUEUE_URL: federationQueue.queueUrl,
        NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
        ACTIVITYPUB_KEY_ID: activityPubSigningSecret.secretValueFromJson('keyId').toString(),
        ACTIVITYPUB_PRIVATE_KEY_PEM: activityPubSigningSecret.secretValueFromJson('privateKeyPem').toString(),
      },
    });

    const notificationConsumerFn = new NodejsFunction(this, 'NotificationConsumerFn', {
      ...commonNodeProps,
      entry: path.join(rootDir, 'services/worker/src/handlers/notifications-consumer.ts'),
      handler: 'handler',
      functionName: `pt-${config.stage}-notification-consumer`,
      memorySize: 512,
      timeout: Duration.minutes(1),
      environment: {
        ...commonNodeProps.environment,
        SERVICE_NAME: 'worker-notification-consumer',
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
        WS_ENDPOINT: wsStage.callbackUrl,
        FEDERATION_QUEUE_URL: federationQueue.queueUrl,
        NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
      },
    });

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `pt-${config.stage}-http`,
      corsPreflight: {
        allowHeaders: [
          'authorization',
          'content-type',
          'idempotency-key',
          'signature',
          'date',
          'digest',
        ],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: config.allowedOrigins,
        allowCredentials: true,
      },
    });

    const httpIntegration = new integrations.HttpLambdaIntegration('HttpIntegration', apiFunction);
    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
      'JwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: [userPoolClient.userPoolClientId],
      },
    );

    const publicRoutes: Array<{ method: apigwv2.HttpMethod; path: string }> = [
      { method: apigwv2.HttpMethod.GET, path: '/healthz' },
      { method: apigwv2.HttpMethod.POST, path: '/admin/bootstrap' },
      { method: apigwv2.HttpMethod.POST, path: '/auth/bootstrap-admin' },
      { method: apigwv2.HttpMethod.GET, path: '/channels' },
      { method: apigwv2.HttpMethod.GET, path: '/videos' },
      { method: apigwv2.HttpMethod.GET, path: '/videos/{videoId}' },
      { method: apigwv2.HttpMethod.GET, path: '/videos/{videoId}/playback' },
      { method: apigwv2.HttpMethod.POST, path: '/videos/{videoId}/views' },
      { method: apigwv2.HttpMethod.GET, path: '/videos/{videoId}/comments' },
      { method: apigwv2.HttpMethod.GET, path: '/activitypub/actor/{actorId}' },
      { method: apigwv2.HttpMethod.POST, path: '/activitypub/inbox' },
    ];

    const jwtRoutes: Array<{ method: apigwv2.HttpMethod; path: string }> = [
      { method: apigwv2.HttpMethod.POST, path: '/channels' },
      { method: apigwv2.HttpMethod.PATCH, path: '/channels/{channelId}' },
      { method: apigwv2.HttpMethod.POST, path: '/videos/drafts' },
      { method: apigwv2.HttpMethod.POST, path: '/videos/{videoId}/upload/initiate' },
      { method: apigwv2.HttpMethod.POST, path: '/videos/{videoId}/upload/complete' },
      { method: apigwv2.HttpMethod.POST, path: '/videos/{videoId}/publish' },
      { method: apigwv2.HttpMethod.POST, path: '/videos/{videoId}/unpublish' },
      { method: apigwv2.HttpMethod.POST, path: '/videos/{videoId}/comments' },
      { method: apigwv2.HttpMethod.DELETE, path: '/videos/{videoId}/comments/{commentId}' },
      { method: apigwv2.HttpMethod.POST, path: '/moderation/reports' },
      { method: apigwv2.HttpMethod.POST, path: '/moderation/videos/{videoId}/takedown' },
      { method: apigwv2.HttpMethod.POST, path: '/moderation/videos/{videoId}/hide' },
      { method: apigwv2.HttpMethod.POST, path: '/moderation/users/{userId}/ban' },
      { method: apigwv2.HttpMethod.POST, path: '/activitypub/outbox' },
      { method: apigwv2.HttpMethod.POST, path: '/activitypub/actors/register' },
    ];

    for (const route of publicRoutes) {
      httpApi.addRoutes({
        path: route.path,
        methods: [route.method],
        integration: httpIntegration,
      });
    }

    for (const route of jwtRoutes) {
      httpApi.addRoutes({
        path: route.path,
        methods: [route.method],
        integration: httpIntegration,
        authorizer: jwtAuthorizer,
      });
    }

    const apiWebAcl = new wafv2.CfnWebACL(this, 'ApiWebAcl', {
      name: `pt-${config.stage}-api-waf`,
      scope: 'REGIONAL',
      defaultAction: {
        allow: {},
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `pt-${config.stage}-api-waf`,
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'RateLimit',
          priority: 0,
          action: {
            block: {},
          },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: 'IP',
              limit: 2000,
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `pt-${config.stage}-waf-rate-limit`,
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWSManagedCommon',
          priority: 1,
          overrideAction: {
            none: {},
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `pt-${config.stage}-waf-common`,
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    new wafv2.CfnWebACLAssociation(this, 'ApiWebAclAssociation', {
      resourceArn: `arn:aws:apigateway:${this.region}::/apis/${httpApi.apiId}/stages/$default`,
      webAclArn: apiWebAcl.attrArn,
    });

    const validateTask = new sfnTasks.LambdaInvoke(this, 'ValidateUploadTask', {
      lambdaFunction: validateUploadFn,
      payloadResponseOnly: true,
      resultPath: '$',
    });

    const submitTask = new sfnTasks.LambdaInvoke(this, 'SubmitTranscodeTask', {
      lambdaFunction: submitTranscodeFn,
      payloadResponseOnly: true,
      resultPath: '$',
    });

    const waitTask = new sfn.Wait(this, 'WaitForTranscode', {
      time: sfn.WaitTime.duration(Duration.seconds(30)),
    });

    const pollTask = new sfnTasks.LambdaInvoke(this, 'PollTranscodeTask', {
      lambdaFunction: pollTranscodeFn,
      payloadResponseOnly: true,
      resultPath: '$',
    });

    const finalizeTask = new sfnTasks.LambdaInvoke(this, 'FinalizeVideoTask', {
      lambdaFunction: finalizeVideoFn,
      payloadResponseOnly: true,
      resultPath: '$',
    });

    const markFailedTask = new sfnTasks.LambdaInvoke(this, 'MarkFailedTask', {
      lambdaFunction: markVideoFailedFn,
      payloadResponseOnly: true,
      resultPath: '$',
    });

    const pollLoopChoice = new sfn.Choice(this, 'CheckTranscodeStatus')
      .when(sfn.Condition.stringEquals('$.pollStatus', 'COMPLETE'), finalizeTask)
      .when(sfn.Condition.stringEquals('$.pollStatus', 'ERROR'), markFailedTask);

    waitTask.next(pollTask).next(pollLoopChoice);
    pollLoopChoice.otherwise(waitTask);

    const stateMachine = new sfn.StateMachine(this, 'VideoPipelineStateMachine', {
      stateMachineName: `pt-${config.stage}-video-pipeline`,
      timeout: Duration.hours(4),
      tracingEnabled: true,
      definitionBody: sfn.DefinitionBody.fromChainable(validateTask.next(submitTask).next(waitTask)),
      logs: {
        destination: new logs.LogGroup(this, 'VideoPipelineLogs', {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy,
        }),
        level: sfn.LogLevel.ALL,
      },
    });

    new events.Rule(this, 'VideoUploadedRule', {
      eventBus,
      eventPattern: {
        source: ['peertube.serverless'],
        detailType: ['VideoUploaded'],
      },
      targets: [
        new targets.SfnStateMachine(stateMachine, {
          input: events.RuleTargetInput.fromEventPath('$.detail'),
        }),
      ],
    });

    federationConsumerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(federationQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    notificationConsumerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(notificationQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    table.grantReadWriteData(apiFunction);
    table.grantReadWriteData(wsConnectFn);
    table.grantReadWriteData(wsDisconnectFn);
    table.grantReadWriteData(validateUploadFn);
    table.grantReadWriteData(submitTranscodeFn);
    table.grantReadWriteData(pollTranscodeFn);
    table.grantReadWriteData(finalizeVideoFn);
    table.grantReadWriteData(markVideoFailedFn);
    table.grantReadWriteData(federationConsumerFn);
    table.grantReadWriteData(notificationConsumerFn);

    uploadsBucket.grantReadWrite(apiFunction);
    uploadsBucket.grantRead(validateUploadFn);
    deliveryBucket.grantReadWrite(finalizeVideoFn);
    deliveryBucket.grantRead(apiFunction);

    federationQueue.grantSendMessages(apiFunction);
    federationQueue.grantConsumeMessages(federationConsumerFn);

    notificationQueue.grantSendMessages(finalizeVideoFn);
    notificationQueue.grantConsumeMessages(notificationConsumerFn);

    eventBus.grantPutEventsTo(apiFunction);
    eventBus.grantPutEventsTo(finalizeVideoFn);

    submitTranscodeFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [mediaConvertRole.roleArn],
      }),
    );

    submitTranscodeFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['mediaconvert:CreateJob', 'mediaconvert:GetJob', 'mediaconvert:DescribeEndpoints'],
        resources: ['*'],
      }),
    );

    pollTranscodeFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['mediaconvert:GetJob', 'mediaconvert:DescribeEndpoints'],
        resources: ['*'],
      }),
    );

    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminGetUser', 'cognito-idp:AdminDisableUser', 'cognito-idp:AdminAddUserToGroup'],
        resources: [userPool.userPoolArn],
      }),
    );

    adminBootstrapSecret.grantRead(apiFunction);
    activityPubSigningSecret.grantRead(federationConsumerFn);
    cloudFrontSigningSecret.grantRead(apiFunction);

    const apiErrorAlarm = new cloudwatch.Alarm(this, 'ApiErrorsAlarm', {
      metric: apiFunction.metricErrors({
        period: Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'API Lambda elevated errors',
    });

    const federationDlqAlarm = new cloudwatch.Alarm(this, 'FederationDlqAlarm', {
      metric: federationDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Federation DLQ has messages',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const dashboard = new cloudwatch.Dashboard(this, 'OpsDashboard', {
      dashboardName: `pt-${config.stage}-ops`,
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'HTTP API Lambda',
        left: [apiFunction.metricInvocations(), apiFunction.metricErrors()],
        right: [apiFunction.metricDuration()],
      }),
      new cloudwatch.GraphWidget({
        title: 'Queue Backlog',
        left: [
          federationQueue.metricApproximateNumberOfMessagesVisible(),
          notificationQueue.metricApproximateNumberOfMessagesVisible(),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'State Machine Executions',
        left: [stateMachine.metricSucceeded(), stateMachine.metricFailed(), stateMachine.metricTimedOut()],
      }),
    );

    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: httpApi.apiEndpoint,
    });

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: wsStage.url,
    });

    new cdk.CfnOutput(this, 'WebSocketCallbackUrl', {
      value: wsStage.callbackUrl,
    });

    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.attrDomainName,
    });

    new cdk.CfnOutput(this, 'CoreTableName', {
      value: table.tableName,
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
    });

    new cdk.CfnOutput(this, 'AdminBootstrapSecretName', {
      value: adminBootstrapSecret.secretName,
    });

    new cdk.CfnOutput(this, 'FederationQueueUrl', {
      value: federationQueue.queueUrl,
    });

    new cdk.CfnOutput(this, 'NotificationQueueUrl', {
      value: notificationQueue.queueUrl,
    });

    new cdk.CfnOutput(this, 'ApiErrorsAlarmArn', {
      value: apiErrorAlarm.alarmArn,
    });

    new cdk.CfnOutput(this, 'FederationDlqAlarmArn', {
      value: federationDlqAlarm.alarmArn,
    });
  }
}
