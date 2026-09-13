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

  describe('overflow long-text resolution', () => {
    it('prefers the resolved long-text body over the wrapper placeholder', () => {
      expect(
        getMessageCopyTextBody(
          {
            msgtype: 'm.file',
            body: 'Long text overflow...',
            url: 'mxc://mindroom/overflow',
            'io.mindroom.long_text': {
              version: 2,
              encoding: 'matrix_event_content_json',
            },
          },
          { body: 'original placeholder' },
          {
            msgtype: 'm.text',
            body: 'Actual long response',
          }
        )
      ).toBe('Actual long response');
    });

    it('falls back to resolved m.new_content.body when the resolved wrapper body is absent', () => {
      expect(
        getMessageCopyTextBody(
          {
            msgtype: 'm.file',
            body: 'Long text overflow...',
          },
          { body: 'original placeholder' },
          {
            msgtype: 'm.text',
            'm.new_content': {
              msgtype: 'm.text',
              body: 'Edited resolved body',
            },
          }
        )
      ).toBe('Edited resolved body');
    });

    it('falls back to the existing envelope chain when no resolved long-text content is provided', () => {
      expect(
        getMessageCopyTextBody(
          {
            msgtype: 'm.file',
            body: 'Long text overflow...',
          },
          { body: 'original placeholder' }
        )
      ).toBe('Long text overflow...');
    });

    it('falls through when neither the resolved content nor the envelope has a plain body', () => {
      expect(
        getMessageCopyTextBody(
          {
            msgtype: 'm.file',
            'm.new_content': {
              formatted_body: '<p>formatted only</p>',
            },
          },
          {
            formatted_body: '<p>still formatted only</p>',
          },
          {
            msgtype: 'm.text',
            body: '',
            'm.new_content': {
              msgtype: 'm.text',
              body: '',
            },
          }
        )
      ).toBeUndefined();
    });
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
