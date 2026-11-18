import { KnownMembership } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { hasActiveMindroomAgent, isMindroomRouterUserId } from './agentIdentity';

describe('hasActiveMindroomAgent', () => {
  it('recognizes joined and invited MindRoom agents', () => {
    expect(
      hasActiveMindroomAgent([
        { membership: KnownMembership.Join, userId: '@alice:example.org' },
        { membership: KnownMembership.Invite, userId: '@mindroom_helper:example.org' },
      ])
    ).toBe(true);

    expect(
      hasActiveMindroomAgent([
        { membership: KnownMembership.Join, userId: '@mindroom_helper:example.org' },
      ])
    ).toBe(true);
  });

  it('ignores departed agents and active human members', () => {
    expect(
      hasActiveMindroomAgent([
        { membership: KnownMembership.Leave, userId: '@mindroom_helper:example.org' },
        { membership: KnownMembership.Join, userId: '@alice:example.org' },
      ])
    ).toBe(false);
  });
});

describe('isMindroomRouterUserId', () => {
  it.each([
    ['@mindroom_router:example.org', true],
    ['@mindroom_router_lab1:example.org', true],
    ['@mindroom_helper:example.org', false],
    ['@mindroom_router_x:example.org', false],
    ['@router:example.org', false],
  ])('%s is named as the router: %s', (userId, expected) => {
    expect(isMindroomRouterUserId(userId)).toBe(expected);
  });
});
