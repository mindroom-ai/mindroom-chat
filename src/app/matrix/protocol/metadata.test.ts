import { describe, expect, it } from 'vitest';
import { isMessageMetadataKey } from './metadata';

describe('isMessageMetadataKey', () => {
  it('recognizes MindRoom message metadata namespaces', () => {
    expect(isMessageMetadataKey('io.mindroom.ai_run')).toBe(true);
    expect(isMessageMetadataKey('io.mindroom.stream_status')).toBe(true);
    expect(isMessageMetadataKey('com.mindroom.skip_mentions')).toBe(true);
  });

  it('ignores Matrix and unrelated application metadata', () => {
    expect(isMessageMetadataKey('m.mentions')).toBe(false);
    expect(isMessageMetadataKey('io.example.key')).toBe(false);
    expect(isMessageMetadataKey('com.example.key')).toBe(false);
  });
});

