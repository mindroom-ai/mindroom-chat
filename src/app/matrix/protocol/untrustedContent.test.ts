import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  installEventContentGuard,
  isTrustedAgentSender,
  sanitizeContent,
  sanitizeRelation,
  trustAgentsOfViewer,
} from './untrustedContent';

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';
const FOREIGN_AGENT = '@mindroom_helper:elsewhere.example';
const PERSON = '@person:example.org';

const event = (sender: string, content: unknown, id = '$event'): MatrixEvent =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: '!room:example.org',
    event_id: id,
    sender,
    origin_server_ts: 1,
    content,
  } as Partial<IEvent>);

const RUN = { version: 1, model: { display_name: 'Survey Model' } };

beforeAll(() => {
  installEventContentGuard();
  trustAgentsOfViewer(VIEWER);
});

describe('sanitizeRelation', () => {
  it('keeps a well-formed relation as the same object', () => {
    const relation = {
      rel_type: 'm.thread',
      event_id: '$root',
      'm.in_reply_to': { event_id: '$root' },
    };
    expect(sanitizeRelation(relation)).toBe(relation);
  });

  it.each([
    ['a string', 'm.thread'],
    ['an array', ['m.thread']],
    ['a type that is an object', { rel_type: { a: 1 }, event_id: '$root' }],
    ['a target that is an object', { rel_type: 'm.thread', event_id: { a: 1 } }],
    ['a target that is a number', { rel_type: 'm.replace', event_id: 7 }],
    ['a reaction key that is an object', { rel_type: 'm.annotation', event_id: '$a', key: {} }],
  ])('drops a relation that is %s', (_name, relation) => {
    expect(sanitizeRelation(relation)).toBeUndefined();
  });

  it('drops only a reply target of the wrong shape', () => {
    expect(
      sanitizeRelation({ rel_type: 'm.thread', event_id: '$root', 'm.in_reply_to': '$root' })
    ).toEqual({ rel_type: 'm.thread', event_id: '$root' });
    expect(sanitizeRelation({ 'm.in_reply_to': { event_id: 4 } })).toEqual({});
  });
});

describe('sanitizeContent', () => {
  it('answers an empty object for content that is not an object', () => {
    expect(sanitizeContent('text', true)).toEqual({});
    expect(sanitizeContent(null, true)).toEqual({});
    expect(sanitizeContent([1, 2], true)).toEqual({});
  });

  it('drops an m.new_content that is not an object', () => {
    expect(sanitizeContent({ body: '* x', 'm.new_content': 'text' }, true)).toEqual({
      body: '* x',
    });
    expect(sanitizeContent({ body: '* x', 'm.new_content': null }, true)).toEqual({ body: '* x' });
  });

  it('strips agent keys from a person, also inside m.new_content, and keeps them from an agent', () => {
    const content = {
      body: 'hello',
      'io.mindroom.ai_run': RUN,
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.long_text': { version: 2 },
      'm.new_content': { body: 'hello', 'io.mindroom.tool_trace': { version: 2 } },
    };
    expect(sanitizeContent(content, false)).toEqual({
      body: 'hello',
      'io.mindroom.long_text': { version: 2 },
      'm.new_content': { body: 'hello' },
    });
    expect(sanitizeContent(content, true)).toBe(content);
  });
});

describe('isTrustedAgentSender', () => {
  it('trusts only mindroom_ accounts on a viewer’s homeserver', () => {
    expect(isTrustedAgentSender(AGENT)).toBe(true);
    expect(isTrustedAgentSender(FOREIGN_AGENT)).toBe(false);
    expect(isTrustedAgentSender(PERSON)).toBe(false);
    expect(isTrustedAgentSender(undefined)).toBe(false);
  });
});

describe('installEventContentGuard', () => {
  it('ignores an edit whose m.new_content is not an object', () => {
    for (const newContent of ['not an object', 42, ['a'], null, true]) {
      const target = event(PERSON, { msgtype: 'm.text', body: 'original' }, '$target');
      const edit = event(
        PERSON,
        {
          msgtype: 'm.text',
          body: '* edit',
          'm.new_content': newContent,
          'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
        },
        '$edit'
      );
      target.makeReplaced(edit);
      expect(target.getContent()).toEqual({ msgtype: 'm.text', body: 'original' });
      expect(edit.getContent()['m.new_content']).toBeUndefined();
      // Nothing shows the message as edited.
      expect(target.replacingEvent()).toBeNull();
    }
  });

  it('keeps an encrypted edit that has not decrypted yet', () => {
    const target = event(PERSON, { msgtype: 'm.text', body: 'original' }, '$target');
    const edit = new MatrixEvent({
      type: 'm.room.encrypted',
      room_id: '!room:example.org',
      event_id: '$encrypted-edit',
      sender: PERSON,
      origin_server_ts: 2,
      content: {
        algorithm: 'm.megolm.v1.aes-sha2',
        ciphertext: 'opaque',
        'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
      },
    });
    target.makeReplaced(edit);
    expect(target.replacingEvent()).toBe(edit);
  });

  it('applies a well-formed edit, without the agent keys a person wrote into it', () => {
    const target = event(PERSON, { msgtype: 'm.text', body: 'original' }, '$target');
    const edit = event(
      PERSON,
      {
        msgtype: 'm.text',
        body: '* changed',
        'm.new_content': {
          msgtype: 'm.text',
          body: 'changed',
          'io.mindroom.stream_status': 'streaming',
        },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
      },
      '$edit'
    );
    target.makeReplaced(edit);
    expect(target.getContent()).toEqual({ msgtype: 'm.text', body: 'changed' });
  });

  it('keeps the agent keys of an agent reply and its edits', () => {
    const reply = event(AGENT, {
      msgtype: 'm.text',
      body: 'answer',
      'io.mindroom.ai_run': RUN,
      'io.mindroom.stream_status': 'completed',
    });
    expect(reply.getContent()['io.mindroom.ai_run']).toBe(RUN);
    expect(reply.getContent()['io.mindroom.stream_status']).toBe('completed');
  });

  it("strips the agent keys from a person's message and from a foreign mindroom_ account", () => {
    for (const sender of [PERSON, FOREIGN_AGENT]) {
      const message = event(sender, {
        msgtype: 'm.text',
        body: 'imitation',
        'io.mindroom.ai_run': RUN,
        'io.mindroom.stream_status': 'streaming',
        'io.mindroom.tool_trace': { version: 2, events: [] },
        'io.mindroom.reasoning': { text: 'imitated' },
      });
      expect(message.getContent()).toEqual({ msgtype: 'm.text', body: 'imitation' });
      expect(message.getOriginalContent()).toBe(message.getContent());
    }
  });

  it('gives relations of the wrong shape no thread, reply or relation', () => {
    const reply = event(PERSON, {
      msgtype: 'm.text',
      body: 'reply',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: { nested: true },
        'm.in_reply_to': { event_id: { nested: true } },
      },
    });
    expect(reply.threadRootId).toBeUndefined();
    expect(reply.replyEventId).toBeUndefined();
    expect(reply.getRelation()).toBeNull();
    expect(reply.isRelation()).toBe(false);
    expect(reply.getContent()['m.relates_to']).toBeUndefined();
  });

  it('returns the same object on every read', () => {
    const message = event(PERSON, {
      msgtype: 'm.text',
      body: 'imitation',
      'io.mindroom.ai_run': RUN,
      'm.relates_to': 'not a relation',
    });
    expect(message.getContent()).toBe(message.getContent());
    expect(message.getWireContent()).toBe(message.getWireContent());
  });
});
