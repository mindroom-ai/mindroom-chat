// @vitest-environment jsdom
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { beforeEach, describe, expect, it } from 'vitest';
import { putSession } from '../../matrix/session/sessions';
import {
  aggregateThreadTagEvents,
  buildPerTagStateKey,
  MINDROOM_THREAD_TAGS_EVENT,
  RESOLVED_TAG,
} from './threadTags';

// A tag names who set it in `set_by`, which anyone who may write thread tags fills in. A thread
// shows that person as its resolver only when the tag's sender is that person, or a MindRoom agent
// on the active account's homeserver, which tags for the person it acts for; otherwise the sender.
const VIEWER = '@viewer:example.org';
const ALICE = '@alice:example.org';
const MALLORY = '@mallory:example.org';
const AGENT = '@mindroom_helper:example.org';
const FOREIGN_AGENT = '@mindroom_helper:elsewhere.example';
const SET_AT = '2026-04-07T00:00:01.000Z';
const RESOLVED = { set_by: ALICE, set_at: SET_AT };

const FORMATS = [
  {
    format: 'canonical',
    stateKey: buildPerTagStateKey('$root', RESOLVED_TAG),
    content: RESOLVED,
  },
  { format: 'legacy', stateKey: '$root', content: { tags: { [RESOLVED_TAG]: RESOLVED } } },
];

beforeEach(() => {
  localStorage.clear();
  putSession(
    { baseUrl: 'https://matrix.example.org', userId: VIEWER, deviceId: 'DEVICE', accessToken: 't' },
    { setActive: true }
  );
});

describe.each(FORMATS)('the resolver of a $format resolved tag', ({ stateKey, content }) => {
  const tagsOf = (sender: string | undefined) =>
    aggregateThreadTagEvents([
      new MatrixEvent({
        type: MINDROOM_THREAD_TAGS_EVENT,
        state_key: stateKey,
        content,
        sender,
        event_id: '$tag',
        room_id: '!room:example.org',
        origin_server_ts: 1,
      }),
    ]).get('$root')?.tags;
  const resolverOf = (sender: string) => tagsOf(sender)?.[RESOLVED_TAG]?.set_by;

  it.each([
    ['the person who sent it, naming themselves', ALICE, ALICE],
    ["the person an agent of the active account's homeserver resolved it for", AGENT, ALICE],
    ['the member who sent it, not the person it names', MALLORY, MALLORY],
    ['the agent of another homeserver that sent it', FOREIGN_AGENT, FOREIGN_AGENT],
  ])('is %s', (_, sender, resolver) => {
    expect(resolverOf(sender)).toBe(resolver);
  });

  it('is the agent that sent it while no account is active', () => {
    localStorage.clear();
    expect(resolverOf(AGENT)).toBe(AGENT);
  });

  it('is nobody without a sender, which leaves the thread unresolved', () => {
    expect(tagsOf(undefined)).toBeUndefined();
  });
});
