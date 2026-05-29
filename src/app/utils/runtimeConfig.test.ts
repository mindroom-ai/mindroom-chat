import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isServiceWorkerEnabled } from './runtimeConfig';

const repoRoot = path.resolve(__dirname, '../../..');

describe('isServiceWorkerEnabled', () => {
  it('defaults to false when not configured', () => {
    const originalValue = (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown })
      .__ENABLE_SERVICE_WORKER__;

    try {
      delete (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__;
      expect(isServiceWorkerEnabled()).toBe(false);
    } finally {
      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ =
        originalValue;
    }
  });

  it('accepts boolean or string values', () => {
    const originalValue = (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown })
      .__ENABLE_SERVICE_WORKER__;

    try {
      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ = true;
      expect(isServiceWorkerEnabled()).toBe(true);

      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ = 'true';
      expect(isServiceWorkerEnabled()).toBe(true);

      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ = 'false';
      expect(isServiceWorkerEnabled()).toBe(false);
    } finally {
      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ =
        originalValue;
    }
  });
});

describe('MindRoom runtime client config defaults', () => {
  it('keeps MindRoom defaults in a fork-owned config copied to the runtime config path', () => {
    const mindroomConfigPath = path.join(repoRoot, 'config.mindroom.json');
    expect(fs.existsSync(mindroomConfigPath)).toBe(true);

    const mindroomConfig = JSON.parse(fs.readFileSync(mindroomConfigPath, 'utf8'));

    expect(mindroomConfig).toMatchObject({
      defaultHomeserver: 0,
      homeserverList: ['mindroom.chat'],
      allowCustomHomeservers: true,
      featuredCommunities: {
        openAsDefault: false,
        spaces: [],
        rooms: [],
        servers: ['https://mindroom.chat'],
      },
      hashRouter: {
        enabled: false,
        basename: '/',
      },
      sidebar: {
        showThreads: true,
        showExploreCommunity: false,
        showAddSpace: false,
        showMindRoom: true,
        mindRoomUrl: 'https://docs.mindroom.chat/',
      },
      auth: {
        hideServerPickerWhenSingle: false,
        allowRegistration: true,
        requireAppleProvider: true,
        supportUrl: 'https://docs.mindroom.chat/support',
        privacyPolicyUrl: 'https://docs.mindroom.chat/privacy',
        termsUrl: 'https://docs.mindroom.chat/terms',
      },
      welcome: {
        title: 'Welcome to MindRoom',
        subtitle: 'Your AI is trapped in apps. We set it free.',
        sourceUrl: 'https://github.com/mindroom-ai/mindroom',
        docsUrl: 'https://docs.mindroom.chat/',
      },
    });
    expect(mindroomConfig.splash.loadingMessages).toContain('Loading MindRoom');
    expect(mindroomConfig.mindroom.thinkingPlaceholderMessages).toContain('Thinking');
    expect(mindroomConfig.push.ios).toMatchObject({
      enabled: false,
      appId: 'com.mindroom-ai.app.ios',
      appDisplayName: 'MindRoom iOS',
    });

    const viteConfigSource = fs.readFileSync(path.join(repoRoot, 'vite.config.js'), 'utf8');

    expect(viteConfigSource).toContain("src: 'config.mindroom.json'");
    expect(viteConfigSource).toContain("rename: 'config.json'");
  });
});
