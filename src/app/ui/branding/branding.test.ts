import { describe, expect, it } from 'vitest';
import {
  MINDROOM_APP_NAME,
  MINDROOM_CHAT_SOURCE_URL,
  MINDROOM_DEFAULT_POWERED_BY,
  MINDROOM_DEVICE_DISPLAY_NAMES,
  MINDROOM_DOCS_URL,
  MINDROOM_FAVICON_SRC,
  MINDROOM_NOTIFICATION_BRAND,
  MINDROOM_SITE_URL,
  MINDROOM_SOURCE_URL,
} from './branding';

describe('MindRoom branding', () => {
  it('keeps shared product labels and URLs centralized', () => {
    expect(MINDROOM_APP_NAME).toBe('MindRoom Chat');
    expect(MINDROOM_DEVICE_DISPLAY_NAMES).toEqual({
      web: 'MindRoom Chat Web',
      ios: 'MindRoom Chat iOS',
      android: 'MindRoom Chat Android',
      macos: 'MindRoom Chat macOS',
    });
    expect(MINDROOM_NOTIFICATION_BRAND).toBe(MINDROOM_APP_NAME);
    expect(MINDROOM_SOURCE_URL).toBe('https://github.com/mindroom-ai/mindroom');
    expect(MINDROOM_CHAT_SOURCE_URL).toBe('https://github.com/mindroom-ai/mindroom-chat');
    expect(MINDROOM_DOCS_URL).toBe('https://docs.mindroom.chat/');
  });

  it('credits only MindRoom and Matrix by default', () => {
    expect(MINDROOM_SITE_URL).toBe('https://mindroom.chat');
    expect(MINDROOM_DEFAULT_POWERED_BY).toEqual([
      { label: 'MindRoom', url: 'https://mindroom.chat' },
      { label: 'Matrix', url: 'https://matrix.org' },
    ]);
  });

  it('exports MindRoom-owned image assets from the branding boundary', () => {
    expect(MINDROOM_FAVICON_SRC).toContain('mindroom-favicon');
  });
});
