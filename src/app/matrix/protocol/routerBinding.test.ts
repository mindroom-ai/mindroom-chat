import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { trustedRoomAccountIds, trustedRouterUserId } from './routerBinding';

const ROUTER = '@mindroom_router:example.org';
const AGENT = '@mindroom_helper:example.org';
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

  it('names the router that created the room, which outranks every level without one', () => {
    // Room version 12 on: the creator is in no `users` entry, as in the rooms the router creates.
    const levels = { users_default: 0, state_default: 50 };
    expect(trustedRouterUserId(binding({ user_id: ROUTER }), levels, new Set([ROUTER]))).toBe(
      ROUTER
    );
    expect(trustedRouterUserId(binding({ user_id: ROUTER }), levels)).toBeUndefined();
  });

  it('names none for a creator binding that anyone may write', () => {
    expect(
      trustedRouterUserId(
        binding({ user_id: ROUTER }),
        { users_default: 0, state_default: 0 },
        new Set([ROUTER])
      )
    ).toBeUndefined();
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

describe('trustedRoomAccountIds', () => {
  const roster = (sender = ROUTER, stateKey = ROUTER, accounts: unknown = [AGENT]) =>
    new MatrixEvent({
      type: 'io.mindroom.accounts',
      state_key: stateKey,
      sender,
      content: { accounts },
    });
  const trusted = (
    event?: MatrixEvent,
    { joined = new Set([AGENT]), ignored = new Set<string>() } = {}
  ) => trustedRoomAccountIds(ROUTER, event, joined, ignored);

  it('trusts the legacy binding without a roster', () => {
    expect(trusted()).toEqual(new Set([ROUTER]));
  });

  it('trusts joined Matrix IDs in the bound roster and ignores non-string entries', () => {
    expect(trusted(roster(ROUTER, ROUTER, [AGENT, 7, { user_id: AGENT }]))).toEqual(
      new Set([ROUTER, AGENT])
    );
  });

  it.each([
    ["another account's own roster", roster(AGENT, AGENT)],
    ['a roster at the bound key written by someone else', roster(AGENT, ROUTER)],
    ['a roster that is not an array', roster(ROUTER, ROUTER, AGENT)],
  ])('ignores %s', (_case, event) => {
    expect(trusted(event)).toEqual(new Set([ROUTER]));
  });

  it('does not trust a listed user who is not joined', () => {
    expect(trusted(roster(), { joined: new Set() })).toEqual(new Set([ROUTER]));
  });

  it.each([undefined, binding({ user_id: ROUTER })])(
    'trusts no one without a binding that ordinary members cannot write',
    (event) => {
      const bound = trustedRouterUserId(event, { state_default: 0, users_default: 0 });
      expect(trustedRoomAccountIds(bound, roster(), new Set([AGENT]), new Set())).toEqual(
        new Set()
      );
    }
  );

  it('trusts no one when the viewer ignores the bound account', () => {
    expect(trusted(roster(), { ignored: new Set([ROUTER]) })).toEqual(new Set());
  });

  it('does not trust listed senders the viewer ignores', () => {
    expect(trusted(roster(), { ignored: new Set([AGENT]) })).toEqual(new Set([ROUTER]));
  });
});

describe('trustedRouterUserId with levels the parser drops', () => {
  it.each([
    ["the binding's level", { events: { 'io.mindroom.router': '100' } }],
    ['state_default', { state_default: '100' }],
    ['users_default', { users_default: '0' }],
    ["the router's level", { users: { [ROUTER]: '100' } }],
  ])('names none when %s is not a number', (_case, raw) => {
    expect(
      trustedRouterUserId(binding({ user_id: ROUTER }), ROUTER_AT_50, new Set(), {
        users: { [ROUTER]: 50 },
        ...raw,
      })
    ).toBeUndefined();
  });

  it('names the router when every level it reads is a number', () => {
    expect(
      trustedRouterUserId(binding({ user_id: ROUTER }), ROUTER_AT_50, new Set(), {
        users_default: 0,
        users: { [ROUTER]: 50, '@sam:example.org': 'odd' },
      })
    ).toBe(ROUTER);
  });
});
