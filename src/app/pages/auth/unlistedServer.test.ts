import { describe, expect, it } from 'vitest';
import { deploymentDefaultServer, isDeploymentServer, signInHost } from './unlistedServer';

const shipped = { homeserverList: ['mindroom.chat', 'matrix.org'], defaultHomeserver: 0 };

describe('isDeploymentServer', () => {
  it('offers the listed servers in any letter case, with surrounding spaces ignored', () => {
    for (const server of ['mindroom.chat', 'matrix.org', 'MindRoom.Chat', ' matrix.org ']) {
      expect(isDeploymentServer(shipped, server), server).toBe(true);
    }
  });

  it('treats every other spelling as another server', () => {
    for (const server of [
      'evil.example',
      'mindroom.chat.evil.example',
      'mindroom.chat.',
      'https://mindroom.chat',
      'mindroom.chat:443',
      'matrix-client.matrix.org',
    ]) {
      expect(isDeploymentServer(shipped, server), server).toBe(false);
    }
  });

  it('offers the default server, also when the deployment lists none', () => {
    expect(isDeploymentServer({}, 'mindroom.chat')).toBe(true);
    expect(isDeploymentServer({}, 'matrix.org')).toBe(false);
    expect(isDeploymentServer({ homeserverList: [] }, 'mindroom.chat')).toBe(true);
  });
});

describe('deploymentDefaultServer', () => {
  it('is the configured entry, the first listed one, or mindroom.chat', () => {
    expect(deploymentDefaultServer({ ...shipped, defaultHomeserver: 1 })).toBe('matrix.org');
    expect(deploymentDefaultServer({ ...shipped, defaultHomeserver: 5 })).toBe('mindroom.chat');
    expect(deploymentDefaultServer({ homeserverList: ['example.org'] })).toBe('example.org');
    expect(deploymentDefaultServer({})).toBe('mindroom.chat');
  });
});

describe('signInHost', () => {
  it('names the host a sign-in goes to, with its port and in its xn-- form', () => {
    expect(signInHost('https://evil-hs.example')).toBe('evil-hs.example');
    expect(signInHost('http://127.0.0.1:28140/')).toBe('127.0.0.1:28140');
    // Cyrillic o twice: a look-alike of mindroom.chat shows as what it is.
    expect(signInHost('https://mindr\u043e\u043em.chat')).toBe('xn--mindrm-0qfa.chat');
    expect(signInHost('not a url')).toBe('not a url');
  });
});
