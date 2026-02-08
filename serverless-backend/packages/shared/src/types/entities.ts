export type Role = 'admin' | 'mod' | 'user';

export type VideoState = 'DRAFT' | 'UPLOADING' | 'UPLOADED' | 'TRANSCODING' | 'PUBLISHED' | 'FAILED' | 'HIDDEN' | 'TAKEDOWN';

export interface UserProfile {
  userId: string;
  email: string;
  roles: Role[];
  createdAt: string;
  bannedAt?: string;
}

export interface Channel {
  channelId: string;
  ownerUserId: string;
  handle: string;
  displayName: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Video {
  videoId: string;
  channelId: string;
  ownerUserId: string;
  title: string;
  description?: string;
  tags: string[];
  visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  state: VideoState;
  createdAt: string;
  updatedAt: string;
  sourceKey?: string;
  hlsManifestKey?: string;
  thumbnailKey?: string;
  durationSeconds?: number;
  moderationStatus?: 'OK' | 'REPORTED' | 'HIDDEN' | 'TAKEDOWN';
}

export interface Comment {
  commentId: string;
  videoId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  deletedAt?: string;
}

export interface FederationActor {
  actorId: string;
  inboxUrl: string;
  outboxUrl: string;
  publicKeyPem: string;
  fetchedAt: string;
}
