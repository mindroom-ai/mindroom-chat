import { RelationType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getComposerPlaceholderKind } from './composerPlaceholder';
import type { IReplyDraft } from './roomInputDrafts';

const reply = (relation?: IReplyDraft['relation']): IReplyDraft => ({
  userId: '@alice:example.org',
  eventId: '$message',
  body: 'Weekly planning',
  relation,
});

describe('getComposerPlaceholderKind', () => {
  it('replies in the open thread', () => {
    expect(getComposerPlaceholderKind({ threadId: '$root', threadingEnabled: true })).toBe(
      'reply-in-thread'
    );
  });

  it('replies in the thread a reply draft from the timeline joins', () => {
    const replyDraft = reply({ rel_type: RelationType.Thread, event_id: '$root' });
    expect(getComposerPlaceholderKind({ replyDraft, threadingEnabled: true })).toBe(
      'reply-in-thread'
    );
  });

  it('starts a new thread from the main timeline of a room whose agents answer in threads', () => {
    expect(getComposerPlaceholderKind({ threadingEnabled: true })).toBe('new-thread');
    expect(getComposerPlaceholderKind({ threadingEnabled: true, roomThreadMode: 'thread' })).toBe(
      'new-thread'
    );
    expect(getComposerPlaceholderKind({ threadingEnabled: true, roomThreadMode: 'mixed' })).toBe(
      'new-thread'
    );
  });

  it('sends a message where the timeline gets no thread', () => {
    // The classic timeline sends without thread relations, even with a thread reply drafted.
    const threadReply = reply({ rel_type: RelationType.Thread, event_id: '$root' });
    expect(getComposerPlaceholderKind({ threadingEnabled: false, replyDraft: threadReply })).toBe(
      'message'
    );
    // Agents that answer in the main timeline keep one conversation there.
    expect(getComposerPlaceholderKind({ threadingEnabled: true, roomThreadMode: 'room' })).toBe(
      'message'
    );
    // A reply to a message outside any thread stays in the timeline.
    expect(getComposerPlaceholderKind({ threadingEnabled: true, replyDraft: reply() })).toBe(
      'message'
    );
  });
});
