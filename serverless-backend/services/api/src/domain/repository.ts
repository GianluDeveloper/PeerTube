import crypto from 'crypto';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ApiError,
  decodeCursor,
  encodeCursor,
  getDocClient,
  logger,
  type RequestIdentity,
  type Video,
  type VideoState,
} from '@pt/shared';

const SEARCH_TOKEN_LIMIT = 12;
const VIEW_SHARD_COUNT = 20;

function tokenizeSearch(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .slice(0, SEARCH_TOKEN_LIMIT);
}

function nowIso(): string {
  return new Date().toISOString();
}

export class Repository {
  private readonly client = getDocClient();

  public constructor(private readonly tableName: string) {}

  public async ensureUserProfile(identity: RequestIdentity): Promise<void> {
    const userKey = { pk: `USER#${identity.userId}`, sk: 'PROFILE' };
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...userKey,
          entityType: 'USER',
          userId: identity.userId,
          email: identity.email,
          roles: identity.roles,
          createdAt: nowIso(),
          gsi1pk: `USER#${identity.userId}`,
          gsi1sk: 'PROFILE',
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    ).catch((error) => {
      logger.info('User profile already exists or cannot be created', {
        userId: identity.userId,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    });
  }

  public async createChannel(identity: RequestIdentity, input: { handle: string; displayName: string; description?: string }) {
    const channelId = crypto.randomUUID();
    const createdAt = nowIso();

    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                pk: `CHANNEL#${channelId}`,
                sk: 'PROFILE',
                entityType: 'CHANNEL',
                channelId,
                ownerUserId: identity.userId,
                handle: input.handle,
                displayName: input.displayName,
                description: input.description,
                createdAt,
                updatedAt: createdAt,
                gsi1pk: `HANDLE#${input.handle}`,
                gsi1sk: `CHANNEL#${channelId}`,
                gsi2pk: 'CHANNELS',
                gsi2sk: `${createdAt}#${channelId}`,
              },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                pk: `USER#${identity.userId}`,
                sk: `CHANNEL#${channelId}`,
                entityType: 'USER_CHANNEL',
                channelId,
                handle: input.handle,
                displayName: input.displayName,
                createdAt,
              },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                pk: `HANDLE#${input.handle}`,
                sk: 'CHANNEL',
                entityType: 'HANDLE_POINTER',
                channelId,
                createdAt,
              },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
        ],
      }),
    ).catch(() => {
      throw new ApiError(409, 'CHANNEL_HANDLE_EXISTS', 'Channel handle already exists');
    });

    return {
      channelId,
      ownerUserId: identity.userId,
      handle: input.handle,
      displayName: input.displayName,
      description: input.description,
      createdAt,
      updatedAt: createdAt,
    };
  }

  public async updateChannel(
    identity: RequestIdentity,
    channelId: string,
    input: { displayName?: string; description?: string },
  ) {
    const current = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `CHANNEL#${channelId}`, sk: 'PROFILE' },
      }),
    );

    if (!current.Item) {
      throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
    }

    if (current.Item.ownerUserId !== identity.userId && !identity.roles.includes('admin')) {
      throw new ApiError(403, 'FORBIDDEN', 'Not channel owner');
    }

    const updatedAt = nowIso();
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `CHANNEL#${channelId}`, sk: 'PROFILE' },
        UpdateExpression: 'SET #displayName = :displayName, #description = :description, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#displayName': 'displayName',
          '#description': 'description',
        },
        ExpressionAttributeValues: {
          ':displayName': input.displayName ?? current.Item.displayName,
          ':description': input.description ?? current.Item.description,
          ':updatedAt': updatedAt,
        },
      }),
    );

    return {
      ...current.Item,
      displayName: input.displayName ?? current.Item.displayName,
      description: input.description ?? current.Item.description,
      updatedAt,
    };
  }

  public async listChannels(limit: number, cursor?: string) {
    const out = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi2',
        KeyConditionExpression: 'gsi2pk = :pk',
        ExpressionAttributeValues: {
          ':pk': 'CHANNELS',
        },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      }),
    );

    return {
      items: (out.Items ?? []).map((item) => ({
        channelId: item.channelId,
        ownerUserId: item.ownerUserId,
        handle: item.handle,
        displayName: item.displayName,
        description: item.description,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      cursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : undefined,
    };
  }

  public async createVideoDraft(
    identity: RequestIdentity,
    input: { channelId: string; title: string; description?: string; tags: string[]; visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE' },
  ) {
    const channel = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `CHANNEL#${input.channelId}`, sk: 'PROFILE' },
      }),
    );

    if (!channel.Item) {
      throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
    }

    if (channel.Item.ownerUserId !== identity.userId && !identity.roles.includes('admin') && !identity.roles.includes('mod')) {
      throw new ApiError(403, 'FORBIDDEN', 'Not permitted to create video draft in this channel');
    }

    const videoId = crypto.randomUUID();
    const createdAt = nowIso();
    const normalizedTags = [...new Set(input.tags.map((tag) => tag.toLowerCase()))].slice(0, 20);

    const videoItem = {
      pk: `VIDEO#${videoId}`,
      sk: 'METADATA',
      entityType: 'VIDEO',
      videoId,
      channelId: input.channelId,
      ownerUserId: identity.userId,
      title: input.title,
      normalizedTitle: input.title.toLowerCase(),
      description: input.description,
      tags: normalizedTags,
      visibility: input.visibility,
      state: 'DRAFT' satisfies VideoState,
      moderationStatus: 'OK',
      createdAt,
      updatedAt: createdAt,
      gsi1pk: 'VIDEOS_BY_STATE#DRAFT',
      gsi1sk: `${createdAt}#${videoId}`,
    };

    const transactItems = [
      {
        Put: {
          TableName: this.tableName,
          Item: videoItem,
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: {
            pk: `CHANNEL#${input.channelId}`,
            sk: `VIDEO#${createdAt}#${videoId}`,
            entityType: 'CHANNEL_VIDEO',
            channelId: input.channelId,
            videoId,
            title: input.title,
            visibility: input.visibility,
            state: 'DRAFT',
            createdAt,
          },
        },
      },
    ];

    const searchTokens = [...new Set([...tokenizeSearch(input.title), ...normalizedTags])].slice(0, SEARCH_TOKEN_LIMIT);

    for (const token of searchTokens) {
      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: {
            pk: `SEARCH#${token}`,
            sk: `VIDEO#${videoId}`,
            entityType: 'VIDEO_SEARCH',
            token,
            videoId,
            channelId: input.channelId,
            title: input.title,
            createdAt,
          },
        },
      });
    }

    await this.client.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      }),
    );

    return {
      ...videoItem,
      tags: normalizedTags,
    };
  }

  public async getVideo(videoId: string): Promise<Video & Record<string, unknown>> {
    const out = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `VIDEO#${videoId}`, sk: 'METADATA' },
      }),
    );

    if (!out.Item) {
      throw new ApiError(404, 'VIDEO_NOT_FOUND', 'Video not found');
    }

    return out.Item as Video & Record<string, unknown>;
  }

  public async listVideos(input: { channelId?: string; q?: string; limit: number; cursor?: string }) {
    if (input.channelId) {
      const out = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk and begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': `CHANNEL#${input.channelId}`,
            ':sk': 'VIDEO#',
          },
          ScanIndexForward: false,
          Limit: input.limit,
          ExclusiveStartKey: decodeCursor(input.cursor),
        }),
      );

      return {
        items: out.Items ?? [],
        cursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : undefined,
      };
    }

    if (input.q) {
      const token = tokenizeSearch(input.q)[0];
      if (!token) {
        return { items: [], cursor: undefined };
      }

      const out = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk and begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': `SEARCH#${token}`,
            ':sk': 'VIDEO#',
          },
          Limit: input.limit,
          ExclusiveStartKey: decodeCursor(input.cursor),
        }),
      );

      return {
        items: out.Items ?? [],
        cursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : undefined,
      };
    }

    const out = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': 'VIDEOS_BY_STATE#PUBLISHED',
        },
        ScanIndexForward: false,
        Limit: input.limit,
        ExclusiveStartKey: decodeCursor(input.cursor),
      }),
    );

    return {
      items: out.Items ?? [],
      cursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : undefined,
    };
  }

  public async setVideoUploadSession(videoId: string, sourceKey: string, uploadId: string, sizeBytes: number, contentType: string) {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `VIDEO#${videoId}`,
          sk: 'METADATA',
        },
        ConditionExpression: 'attribute_exists(pk)',
        UpdateExpression:
          'SET #state = :state, sourceKey = :sourceKey, uploadId = :uploadId, sourceSizeBytes = :sizeBytes, sourceContentType = :contentType, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk',
        ExpressionAttributeNames: {
          '#state': 'state',
        },
        ExpressionAttributeValues: {
          ':state': 'UPLOADING',
          ':sourceKey': sourceKey,
          ':uploadId': uploadId,
          ':sizeBytes': sizeBytes,
          ':contentType': contentType,
          ':updatedAt': nowIso(),
          ':gsi1pk': 'VIDEOS_BY_STATE#UPLOADING',
          ':gsi1sk': `${nowIso()}#${videoId}`,
        },
      }),
    );
  }

  public async markUploadCompleted(videoId: string) {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `VIDEO#${videoId}`,
          sk: 'METADATA',
        },
        ConditionExpression: 'attribute_exists(pk) AND #state = :up',
        UpdateExpression:
          'SET #state = :state, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk REMOVE uploadId',
        ExpressionAttributeNames: {
          '#state': 'state',
        },
        ExpressionAttributeValues: {
          ':up': 'UPLOADING',
          ':state': 'UPLOADED',
          ':updatedAt': nowIso(),
          ':gsi1pk': 'VIDEOS_BY_STATE#UPLOADED',
          ':gsi1sk': `${nowIso()}#${videoId}`,
        },
      }),
    );
  }

  public async updateVideoState(videoId: string, from: VideoState, to: VideoState, attrs?: Record<string, unknown>) {
    const updatedAt = nowIso();
    let updateExpression = 'SET #state = :to, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk';
    const expressionValues: Record<string, unknown> = {
      ':from': from,
      ':to': to,
      ':updatedAt': updatedAt,
      ':gsi1pk': `VIDEOS_BY_STATE#${to}`,
      ':gsi1sk': `${updatedAt}#${videoId}`,
    };

    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        const sanitized = key.replace(/[^a-zA-Z0-9]/g, '');
        updateExpression += `, ${sanitized} = :${sanitized}`;
        expressionValues[`:${sanitized}`] = value;
      }
    }

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `VIDEO#${videoId}`, sk: 'METADATA' },
        ConditionExpression: 'attribute_exists(pk) AND #state = :from',
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          '#state': 'state',
        },
        ExpressionAttributeValues: expressionValues,
      }),
    );
  }

  public async publishVideo(videoId: string, visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE') {
    const now = nowIso();
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `VIDEO#${videoId}`, sk: 'METADATA' },
        ConditionExpression: 'attribute_exists(pk) AND (hlsManifestKey <> :empty AND #state IN (:uploaded, :transcoding, :published))',
        UpdateExpression:
          'SET #state = :published, visibility = if_not_exists(visibility, :defaultVisibility), updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk',
        ExpressionAttributeNames: {
          '#state': 'state',
        },
        ExpressionAttributeValues: {
          ':empty': '',
          ':uploaded': 'UPLOADED',
          ':transcoding': 'TRANSCODING',
          ':published': 'PUBLISHED',
          ':defaultVisibility': visibility ?? 'PUBLIC',
          ':updatedAt': now,
          ':gsi1pk': 'VIDEOS_BY_STATE#PUBLISHED',
          ':gsi1sk': `${now}#${videoId}`,
        },
      }),
    );
  }

  public async unpublishVideo(videoId: string) {
    const now = nowIso();
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `VIDEO#${videoId}`, sk: 'METADATA' },
        ConditionExpression: 'attribute_exists(pk)',
        UpdateExpression:
          'SET #state = :uploaded, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk',
        ExpressionAttributeNames: {
          '#state': 'state',
        },
        ExpressionAttributeValues: {
          ':uploaded': 'UPLOADED',
          ':updatedAt': now,
          ':gsi1pk': 'VIDEOS_BY_STATE#UPLOADED',
          ':gsi1sk': `${now}#${videoId}`,
        },
      }),
    );
  }

  public async addComment(identity: RequestIdentity, videoId: string, body: string) {
    const commentId = crypto.randomUUID();
    const createdAt = nowIso();

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `VIDEO#${videoId}`,
          sk: `COMMENT#${createdAt}#${commentId}`,
          entityType: 'COMMENT',
          commentId,
          videoId,
          authorUserId: identity.userId,
          body,
          createdAt,
          gsi2pk: `COMMENT_AUTHOR#${identity.userId}`,
          gsi2sk: `${createdAt}#${commentId}`,
        },
      }),
    );

    return {
      commentId,
      videoId,
      authorUserId: identity.userId,
      body,
      createdAt,
    };
  }

  public async listComments(videoId: string, limit: number, cursor?: string) {
    const out = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `VIDEO#${videoId}`,
          ':prefix': 'COMMENT#',
        },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      }),
    );

    return {
      items: out.Items ?? [],
      cursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : undefined,
    };
  }

  public async deleteComment(identity: RequestIdentity, videoId: string, commentId: string) {
    const comments = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `VIDEO#${videoId}`,
          ':prefix': `COMMENT#`,
        },
      }),
    );

    const target = (comments.Items ?? []).find((item) => item.commentId === commentId);

    if (!target) {
      throw new ApiError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
    }

    if (target.authorUserId !== identity.userId && !identity.roles.includes('admin') && !identity.roles.includes('mod')) {
      throw new ApiError(403, 'FORBIDDEN', 'Not authorized to delete comment');
    }

    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          pk: target.pk,
          sk: target.sk,
        },
      }),
    );
  }

  public async reportVideo(identity: RequestIdentity, videoId: string, reason: string) {
    const reportId = crypto.randomUUID();
    const createdAt = nowIso();
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `VIDEO#${videoId}`,
          sk: `REPORT#${createdAt}#${reportId}`,
          entityType: 'REPORT',
          reportId,
          reportedBy: identity.userId,
          reason,
          createdAt,
          status: 'OPEN',
          gsi2pk: 'REPORTS#OPEN',
          gsi2sk: `${createdAt}#${reportId}`,
        },
      }),
    );

    return { reportId, createdAt, status: 'OPEN' };
  }

  public async moderateVideo(videoId: string, targetState: 'HIDDEN' | 'TAKEDOWN') {
    const now = nowIso();

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `VIDEO#${videoId}`, sk: 'METADATA' },
        ConditionExpression: 'attribute_exists(pk)',
        UpdateExpression:
          'SET #state = :targetState, moderationStatus = :targetState, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk',
        ExpressionAttributeNames: {
          '#state': 'state',
        },
        ExpressionAttributeValues: {
          ':targetState': targetState,
          ':updatedAt': now,
          ':gsi1pk': `VIDEOS_BY_STATE#${targetState}`,
          ':gsi1sk': `${now}#${videoId}`,
        },
      }),
    );
  }

  public async banUser(userId: string, reason: string, bannedUntil?: string) {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `USER#${userId}`, sk: 'PROFILE' },
        UpdateExpression: 'SET bannedAt = :bannedAt, banReason = :reason, bannedUntil = :bannedUntil',
        ExpressionAttributeValues: {
          ':bannedAt': nowIso(),
          ':reason': reason,
          ':bannedUntil': bannedUntil,
        },
      }),
    );
  }

  public async registerView(videoId: string, viewerHash: string): Promise<boolean> {
    const hourBucket = new Date().toISOString().slice(0, 13);
    const ttl = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: `VIDEO#${videoId}`,
            sk: `VIEWDEDUP#${viewerHash}#${hourBucket}`,
            entityType: 'VIEW_DEDUP',
            ttl,
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    } catch {
      return false;
    }

    const shard = Math.floor(Math.random() * VIEW_SHARD_COUNT);
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `VIDEO#${videoId}`, sk: `VIEWCOUNT#${shard}` },
        UpdateExpression: 'ADD viewCount :inc SET updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':inc': 1,
          ':updatedAt': nowIso(),
        },
      }),
    );

    return true;
  }

  public async readViewCount(videoId: string): Promise<number> {
    const out = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `VIDEO#${videoId}`,
          ':prefix': 'VIEWCOUNT#',
        },
      }),
    );

    return (out.Items ?? []).reduce((sum, item) => sum + (item.viewCount ?? 0), 0);
  }

  public async putWsConnection(connectionId: string, userId: string) {
    const connectedAt = nowIso();
    const ttl = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `WS#${connectionId}`,
          sk: 'CONNECTION',
          entityType: 'WS_CONNECTION',
          connectionId,
          userId,
          connectedAt,
          gsi1pk: `WSUSER#${userId}`,
          gsi1sk: `CONN#${connectedAt}`,
          ttl,
        },
      }),
    );
  }

  public async deleteWsConnection(connectionId: string) {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          pk: `WS#${connectionId}`,
          sk: 'CONNECTION',
        },
      }),
    );
  }

  public async listWsConnectionsByUser(userId: string): Promise<string[]> {
    const out = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `WSUSER#${userId}`,
        },
      }),
    );

    return (out.Items ?? []).map((item) => item.connectionId as string);
  }

  public async getWsConnection(connectionId: string) {
    const out = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `WS#${connectionId}`, sk: 'CONNECTION' },
      }),
    );

    return out.Item;
  }

  public async registerFederationActor(input: {
    actorId: string;
    inboxUrl: string;
    outboxUrl: string;
    publicKeyPem: string;
    keyId?: string;
  }) {
    const fetchedAt = nowIso();

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `FED#ACTOR#${input.actorId}`,
          sk: 'PROFILE',
          entityType: 'FED_ACTOR',
          actorId: input.actorId,
          inboxUrl: input.inboxUrl,
          outboxUrl: input.outboxUrl,
          publicKeyPem: input.publicKeyPem,
          fetchedAt,
          gsi2pk: 'FED_ACTORS',
          gsi2sk: `${fetchedAt}#${input.actorId}`,
        },
      }),
    );

    if (input.keyId) {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: `FED#KEY#${input.keyId}`,
            sk: 'ACTOR',
            entityType: 'FED_KEY_POINTER',
            actorId: input.actorId,
            publicKeyPem: input.publicKeyPem,
            fetchedAt,
          },
        }),
      );
    }
  }

  public async getFederationPublicKeyByKeyId(keyId: string): Promise<string | undefined> {
    const out = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `FED#KEY#${keyId}`,
          sk: 'ACTOR',
        },
      }),
    );

    return out.Item?.publicKeyPem as string | undefined;
  }

  public async reserveFederationDedup(dedupeKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: `FED#DEDUPE#${dedupeKey}`,
            sk: 'ACTIVITY',
            entityType: 'FED_DEDUPE',
            createdAt: nowIso(),
            ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  public async storeInboundActivity(activityId: string, actorId: string, payload: Record<string, unknown>) {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `FED#INBOX#${actorId}`,
          sk: `ACTIVITY#${activityId}`,
          entityType: 'FED_INBOUND_ACTIVITY',
          activityId,
          actorId,
          payload,
          receivedAt: nowIso(),
          ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
        },
      }),
    );
  }

  public async createFollow(localActor: string, remoteActor: string) {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `FED#FOLLOW#${localActor}`,
          sk: `REMOTE#${remoteActor}`,
          entityType: 'FED_FOLLOW',
          localActor,
          remoteActor,
          createdAt: nowIso(),
          gsi1pk: `FED_FOLLOWERS#${remoteActor}`,
          gsi1sk: `LOCAL#${localActor}`,
        },
      }),
    );
  }

  public async removeFollow(localActor: string, remoteActor: string) {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          pk: `FED#FOLLOW#${localActor}`,
          sk: `REMOTE#${remoteActor}`,
        },
      }),
    );
  }

  public async listFollowers(localActor: string): Promise<string[]> {
    const out = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `FED#FOLLOW#${localActor}`,
          ':prefix': 'REMOTE#',
        },
      }),
    );

    return (out.Items ?? []).map((item) => item.remoteActor as string);
  }

  public async storeOutboxActivity(localActor: string, activityId: string, payload: Record<string, unknown>) {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `FED#OUTBOX#${localActor}`,
          sk: `ACTIVITY#${activityId}`,
          entityType: 'FED_OUTBOX_ACTIVITY',
          activityId,
          localActor,
          payload,
          createdAt: nowIso(),
        },
      }),
    );
  }
}
