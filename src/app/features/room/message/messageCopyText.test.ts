import { describe, expect, it } from 'vitest';

import { getMessageCopyTextBody, isCopyTextMessageContent } from './messageCopyText';

describe('getMessageCopyTextBody', () => {
  it('prefers the edited wrapper body when present', () => {
    expect(
      getMessageCopyTextBody(
        {
          body: 'edited plain text',
          'm.new_content': {
            formatted_body: '<strong>edited</strong>',
          },
        },
        { body: 'original text' }
      )
    ).toBe('edited plain text');
  });

  it('falls back to m.new_content.body when wrapper body is absent', () => {
    expect(
      getMessageCopyTextBody(
        {
          'm.new_content': {
            body: 'edited plain text',
          },
        },
        { body: 'original text' }
      )
    ).toBe('edited plain text');
  });

  it('falls back to the original event body when edited content has no plain text body', () => {
    expect(
      getMessageCopyTextBody(
        {
          'm.new_content': {
            formatted_body: '<strong>edited</strong>',
          },
        },
        { body: 'original text' }
      )
    ).toBe('original text');
  });
});

describe('isCopyTextMessageContent', () => {
  it('allows text-like msgtypes', () => {
    expect(isCopyTextMessageContent({ msgtype: 'm.text' })).toBe(true);
    expect(isCopyTextMessageContent({ msgtype: 'm.notice' })).toBe(true);
    expect(isCopyTextMessageContent({ msgtype: 'm.emote' })).toBe(true);
  });

  it('rejects non-text msgtypes', () => {
    expect(isCopyTextMessageContent({ msgtype: 'm.image' })).toBe(false);
    expect(isCopyTextMessageContent({ msgtype: 'm.file' })).toBe(false);
    expect(isCopyTextMessageContent({})).toBe(false);
  });
});
