import { describe, expect, it } from 'vitest';
import { parseInviteFragment } from './inviteLink';

describe('parseInviteFragment', () => {
  it('parses a complete fragment', () => {
    expect(parseInviteFragment('#r=%40router%3Aexample.org&c=ab-c_d')).toEqual({
      routerId: '@router:example.org',
      code: 'ab-c_d',
    });
  });

  it.each([
    '',
    '#c=x',
    '#r=%40router%3Aexample.org',
    '#r=router&c=x',
    '#r=%40a%3Ab&c=',
    `#r=%40router%3Aexample.org&c=${'a'.repeat(129)}`,
    // A right-to-left override would show the router's server name reversed.
    '#r=%40router%3A%E2%80%AEgro.elpmaxe&c=x',
  ])('rejects incomplete or malformed fragments: %s', (hash) => {
    expect(parseInviteFragment(hash)).toBeUndefined();
  });
});
