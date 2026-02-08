import { tableKeys } from '@pt/shared';

describe('table key helpers', () => {
  it('builds channel and video keys deterministically', () => {
    const channel = tableKeys.channelById('c-1');
    const video = tableKeys.videoById('v-1');

    expect(channel).toEqual({ pk: 'CHANNEL#c-1', sk: 'PROFILE' });
    expect(video).toEqual({ pk: 'VIDEO#v-1', sk: 'METADATA' });
  });

  it('builds federation dedupe keys', () => {
    expect(tableKeys.federationDedup('abc123')).toEqual({
      pk: 'FED#DEDUPE#abc123',
      sk: 'ACTIVITY',
    });
  });
});
