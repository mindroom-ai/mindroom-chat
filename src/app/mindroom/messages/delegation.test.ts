import { describe, expect, it } from 'vitest';
import {
  buildMindroomDelegateMessageContent,
  getMindroomDelegateAgents,
  getMindroomDelegateOriginalBody,
  shouldShowMindroomDelegateAction,
} from './delegation';

describe('mindroom delegation helpers', () => {
  it('detects unassigned router messages inside threads', () => {
    expect(
      shouldShowMindroomDelegateAction({
        senderId: '@mindroom_router:mindroom.chat',
        content: { msgtype: 'm.text', body: 'Who owns this?' },
        eventId: '$router',
        threadRootId: '$thread',
        agents: ['@mindroom_worker:mindroom.chat'],
      })
    ).toBe(true);
  });

  it('hides delegation when the router message already mentions someone', () => {
    expect(
      shouldShowMindroomDelegateAction({
        senderId: '@mindroom_router:mindroom.chat',
        content: {
          msgtype: 'm.text',
          body: '@mindroom_worker:mindroom.chat already tagged',
          'm.mentions': { user_ids: ['@mindroom_worker:mindroom.chat'] },
        },
        eventId: '$router',
        threadRootId: '$thread',
        agents: ['@mindroom_worker:mindroom.chat'],
      })
    ).toBe(false);
  });

  it('does not treat empty mention ids as assigned agents', () => {
    expect(
      shouldShowMindroomDelegateAction({
        senderId: '@mindroom_router:mindroom.chat',
        content: {
          msgtype: 'm.text',
          body: 'Who owns this?',
          'm.mentions': { user_ids: [''] },
        },
        eventId: '$router',
        threadRootId: '$thread',
        agents: ['@mindroom_worker:mindroom.chat'],
      })
    ).toBe(true);
  });

  it('hides delegation for non-text router messages', () => {
    expect(
      shouldShowMindroomDelegateAction({
        senderId: '@mindroom_router:mindroom.chat',
        content: { msgtype: 'm.file', body: 'question.txt' },
        eventId: '$router',
        threadRootId: '$thread',
        agents: ['@mindroom_worker:mindroom.chat'],
      })
    ).toBe(false);
  });

  it('hides delegation when the router message is outside a thread', () => {
    expect(
      shouldShowMindroomDelegateAction({
        senderId: '@mindroom_router:mindroom.chat',
        content: { msgtype: 'm.text', body: 'Who owns this?' },
        eventId: '$router',
        threadRootId: undefined,
        agents: ['@mindroom_worker:mindroom.chat'],
      })
    ).toBe(false);
  });

  it('filters joined MindRoom agents and excludes the router', () => {
    expect(
      getMindroomDelegateAgents([
        { userId: '@mindroom_router:mindroom.chat', membership: 'join' },
        { userId: '@mindroom_worker:mindroom.chat', membership: 'join' },
        { userId: '@mindroom_invited:mindroom.chat', membership: 'invite' },
        { userId: '@alice:mindroom.chat', membership: 'join' },
      ])
    ).toEqual(['@mindroom_worker:mindroom.chat']);
  });

  it('prefers edited message body for delegation text', () => {
    expect(
      getMindroomDelegateOriginalBody({
        body: 'old',
        'm.new_content': {
          body: 'edited',
        },
      })
    ).toBe('edited');
  });

  it('builds same-thread reply content with clickable mention metadata', () => {
    expect(
      buildMindroomDelegateMessageContent({
        originalBody: 'Who owns <this>?',
        selectedAgentId: '@mindroom_worker:mindroom.chat',
        routerEventId: '$router',
        threadRootId: '$thread',
      })
    ).toEqual({
      msgtype: 'm.text',
      body: 'Who owns <this>?\n\n@mindroom_worker:mindroom.chat, can you address this question?',
      format: 'org.matrix.custom.html',
      formatted_body:
        'Who owns &lt;this&gt;?<br><br><a href="https://matrix.to/#/%40mindroom_worker%3Amindroom.chat">@mindroom_worker:mindroom.chat</a>, can you address this question?',
      'm.mentions': { user_ids: ['@mindroom_worker:mindroom.chat'] },
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$thread',
        is_falling_back: false,
        'm.in_reply_to': { event_id: '$router' },
      },
    });
  });

  it('formats CRLF line breaks without preserving carriage returns in HTML', () => {
    const content = buildMindroomDelegateMessageContent({
      originalBody: 'Line one\r\nLine two',
      selectedAgentId: '@mindroom_worker:mindroom.chat',
      routerEventId: '$router',
      threadRootId: '$thread',
    });

    expect(content.formatted_body).toContain('Line one<br>Line two');
    expect(content.formatted_body).not.toContain('\r');
  });
});
