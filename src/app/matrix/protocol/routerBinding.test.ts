import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { trustedRouterUserId } from './routerBinding';

const ROUTER = '@mindroom_router:example.org';

const binding = (content: Record<string, unknown>) =>
  new MatrixEvent({
    type: 'io.mindroom.router',
    state_key: '',
    sender: '@admin:example.org',
    content,
  });

describe('trustedRouterUserId', () => {
  it('names the router the room binds, when ordinary members cannot write the binding', () => {
    expect(trustedRouterUserId(binding({ user_id: ROUTER }), { users_default: 0 })).toBe(ROUTER);
    expect(
      trustedRouterUserId(binding({ user_id: ROUTER }), {
        users_default: 0,
        state_default: 0,
        events: { 'io.mindroom.router': 100 },
      })
    ).toBe(ROUTER);
  });

  it('names none without a binding', () => {
    expect(trustedRouterUserId(undefined, { users_default: 0 })).toBeUndefined();
  });

  it.each([
    ['state_default is no higher than users_default', { users_default: 50, state_default: 50 }],
    ['state_default is 0', { users_default: 0, state_default: 0 }],
    [
      'the event level is no higher than users_default',
      { users_default: 0, events: { 'io.mindroom.router': 0 } },
    ],
  ])('names none when ordinary members can write it: %s', (_case, levels) => {
    expect(trustedRouterUserId(binding({ user_id: ROUTER }), levels)).toBeUndefined();
  });

  it.each([
    ['no user_id', {}],
    ['a user_id that is not a string', { user_id: 7 }],
    ['an empty user_id', { user_id: '' }],
  ])('names none for a binding with %s', (_case, content) => {
    expect(trustedRouterUserId(binding(content), { users_default: 0 })).toBeUndefined();
  });
});
