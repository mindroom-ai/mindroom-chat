import { describe, expect, it } from 'vitest';
import { resolveAuthServer } from './authRouteUtils';

describe('resolveAuthServer', () => {
  const list = ['mindroom.chat', 'Example.org'];

  it('uses the default without a server in the URL', () => {
    expect(resolveAuthServer(undefined, 'mindroom.chat', true, list)).toBe('mindroom.chat');
    expect(resolveAuthServer('  ', 'mindroom.chat', false, list)).toBe('mindroom.chat');
  });

  it('accepts any server when custom homeservers are allowed', () => {
    expect(resolveAuthServer('evil.test', 'mindroom.chat', false, list)).toBe('evil.test');
  });

  it('accepts only listed servers on a locked deployment', () => {
    expect(resolveAuthServer('example.org', 'mindroom.chat', true, list)).toBe('Example.org');
    expect(resolveAuthServer('evil.test', 'mindroom.chat', true, list)).toBe('mindroom.chat');
    expect(resolveAuthServer('evil.test', 'mindroom.chat', true, undefined)).toBe('mindroom.chat');
  });
});
