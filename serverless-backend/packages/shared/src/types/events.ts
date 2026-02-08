export interface VideoUploadedEvent {
  source: 'peertube.serverless';
  'detail-type': 'VideoUploaded';
  detail: {
    videoId: string;
    channelId: string;
    ownerUserId: string;
    sourceBucket: string;
    sourceKey: string;
    requestId: string;
  };
}

export interface TranscodeCompletedEvent {
  source: 'peertube.serverless';
  'detail-type': 'TranscodeCompleted';
  detail: {
    videoId: string;
    manifestKey: string;
    thumbnailKey: string;
    durationSeconds: number;
  };
}

export interface FederationOutboundEvent {
  source: 'peertube.serverless';
  'detail-type': 'FederationOutbound';
  detail: {
    activityId: string;
    actorId: string;
    recipientInbox: string;
    payload: Record<string, unknown>;
  };
}
