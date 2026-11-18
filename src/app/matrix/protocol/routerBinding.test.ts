import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { trustedRouterUserId } from './routerBinding';

const ROUTER = '@mindroom_router:example.org';
const ROUTER_AT_50 = { users_default: 0, users: { [ROUTER]: 50 } };

const binding = (content: Record<string, unknown>, sender = ROUTER) =>
  new MatrixEvent({ type: 'io.mindroom.router', state_key: '', sender, content });

describe('trustedRouterUserId', () => {
  it('names the router that bound itself, when ordinary members cannot write the binding', () => {
    expect(trustedRouterUserId(binding({ user_id: ROUTER }), ROUTER_AT_50)).toBe(ROUTER);
    expect(
      trustedRouterUserId(binding({ user_id: ROUTER }), {
        users_default: 0,
        state_default: 0,
        users: { [ROUTER]: 100 },
        events: { 'io.mindroom.router': 100 },
      })
    ).toBe(ROUTER);
  });

  it('names none without a binding', () => {
    expect(trustedRouterUserId(undefined, ROUTER_AT_50)).toBeUndefined();
  });

  it('names none for a binding someone else wrote about the router', () => {
    const levels = { ...ROUTER_AT_50, users: { ...ROUTER_AT_50.users, '@admin:example.org': 100 } };
    expect(
      trustedRouterUserId(binding({ user_id: ROUTER }, '@admin:example.org'), levels)
    ).toBeUndefined();
  });

  it('names none once its writer is below the level the binding now takes', () => {
    // Written while anyone could; the room tightened the level afterwards.
    const attacker = '@mindroom_router:elsewhere.org';
    expect(
      trustedRouterUserId(binding({ user_id: attacker }, attacker), {
        users_default: 0,
        events: { 'io.mindroom.router': 50 },
      })
    ).toBeUndefined();
  });

  it.each([
    ['state_default is no higher than users_default', { users_default: 50, state_default: 50 }],
    ['state_default is 0', { users_default: 0, state_default: 0 }],
    [
      'the event level is no higher than users_default',
      { users_default: 0, events: { 'io.mindroom.router': 0 } },
    ],
  ])('names none when ordinary members can write it: %s', (_case, levels) => {
    expect(
      trustedRouterUserId(binding({ user_id: ROUTER }), { ...levels, users: { [ROUTER]: 100 } })
    ).toBeUndefined();
  });

  it.each([
    ['no user_id', {}],
    ['a user_id that is not a string', { user_id: 7 }],
    ['an empty user_id', { user_id: '' }],
  ])('names none for a binding with %s', (_case, content) => {
    expect(trustedRouterUserId(binding(content), ROUTER_AT_50)).toBeUndefined();
  });
});
