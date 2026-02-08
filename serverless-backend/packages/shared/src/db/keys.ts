export const tableKeys = {
  userProfile: (userId: string) => ({ pk: `USER#${userId}`, sk: 'PROFILE' }),
  userChannel: (userId: string, channelId: string) => ({ pk: `USER#${userId}`, sk: `CHANNEL#${channelId}` }),
  channelById: (channelId: string) => ({ pk: `CHANNEL#${channelId}`, sk: 'PROFILE' }),
  channelVideo: (channelId: string, videoId: string) => ({ pk: `CHANNEL#${channelId}`, sk: `VIDEO#${videoId}` }),
  videoById: (videoId: string) => ({ pk: `VIDEO#${videoId}`, sk: 'METADATA' }),
  videoComment: (videoId: string, commentId: string) => ({ pk: `VIDEO#${videoId}`, sk: `COMMENT#${commentId}` }),
  videoViewsShard: (videoId: string, shard: number) => ({ pk: `VIDEO#${videoId}`, sk: `VIEWCOUNT#${shard}` }),
  viewDedup: (videoId: string, viewerHash: string, bucket: string) => ({
    pk: `VIDEO#${videoId}`,
    sk: `VIEWDEDUP#${viewerHash}#${bucket}`,
  }),
  websocketConnection: (connectionId: string) => ({ pk: `WS#${connectionId}`, sk: 'CONNECTION' }),
  federationActor: (actorId: string) => ({ pk: `FED#ACTOR#${actorId}`, sk: 'PROFILE' }),
  federationFollow: (localActor: string, remoteActor: string) => ({
    pk: `FED#FOLLOW#${localActor}`,
    sk: `REMOTE#${remoteActor}`,
  }),
  federationDedup: (dedupeKey: string) => ({ pk: `FED#DEDUPE#${dedupeKey}`, sk: 'ACTIVITY' }),
  federationDelivery: (deliveryId: string, attempt: number) => ({
    pk: `FED#DELIVERY#${deliveryId}`,
    sk: `ATTEMPT#${attempt}`,
  }),
  idempotency: (scope: string, requestId: string) => ({ pk: `IDEMPOTENCY#${scope}`, sk: requestId }),
};
