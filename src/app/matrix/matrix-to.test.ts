// @vitest-environment jsdom

import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getMatrixToRoom,
  getMatrixToRoomEvent,
  parseMatrixToRoom,
  parseMatrixToRoomEvent,
} from './matrix-to';

describe('matrix-to link helpers', () => {
  const originalBasePath = globalThis.__APP_BASE_PATH__;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.__APP_BASE_PATH__ = originalBasePath;
    window.history.pushState({}, '', '/');
  });

  it('copies room links on the current app origin', () => {
    window.history.pushState({}, '', '/home/');

    expect(getMatrixToRoom('!room:mindroom.chat', ['mindroom.chat'])).toBe(
      `${window.location.origin}/!room:mindroom.chat?via=mindroom.chat`
    );
  });

  it('copies event links on the current app origin', () => {
    window.history.pushState({}, '', '/home/');

    expect(getMatrixToRoomEvent('!room:mindroom.chat', '$event', ['mindroom.chat'])).toBe(
      `${window.location.origin}/!room:mindroom.chat/$event?via=mindroom.chat`
    );
  });

  it('preserves deployments hosted under a base path', () => {
    globalThis.__APP_BASE_PATH__ = '/mindroom/';
    window.history.pushState({}, '', '/mindroom/home/');

    expect(getMatrixToRoomEvent('!room:example.com', '$event', ['example.com'])).toBe(
      `${window.location.origin}/mindroom/!room:example.com/$event?via=example.com`
    );
  });

  it('falls back to matrix.to when location uses a non-web protocol such as capacitor://localhost', () => {
    vi.stubGlobal('location', {
      protocol: 'capacitor:',
      origin: 'capacitor://localhost',
      href: 'capacitor://localhost/home/',
    });

    expect(getMatrixToRoom('!harbor:example.org', ['example.org', 'relay.example.org'])).toBe(
      'https://matrix.to/#/!harbor:example.org?via=example.org&via=relay.example.org'
    );
    expect(getMatrixToRoom('#field-notes:remote.example.org')).toBe(
      'https://matrix.to/#/%23field-notes:remote.example.org'
    );
    expect(getMatrixToRoomEvent('!harbor:example.org', '$entry-1', ['example.org'])).toBe(
      'https://matrix.to/#/!harbor:example.org/$entry-1?via=example.org'
    );
  });

  it('falls back to matrix.to on native Capacitor platforms even under https://localhost (Android)', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.stubGlobal('location', {
      protocol: 'https:',
      origin: 'https://localhost',
      href: 'https://localhost/home/',
    });

    expect(getMatrixToRoom('!harbor:example.org', ['example.org'])).toBe(
      'https://matrix.to/#/!harbor:example.org?via=example.org'
    );
    expect(getMatrixToRoomEvent('!harbor:example.org', '$entry-1', ['example.org'])).toBe(
      'https://matrix.to/#/!harbor:example.org/$entry-1?via=example.org'
    );
  });

  it('falls back to matrix.to for file:// and opaque null origins', () => {
    vi.stubGlobal('location', {
      protocol: 'file:',
      origin: 'null',
      href: 'file:///app/index.html',
    });

    expect(getMatrixToRoom('!harbor:example.org', ['example.org'])).toBe(
      'https://matrix.to/#/!harbor:example.org?via=example.org'
    );
    expect(getMatrixToRoomEvent('!harbor:example.org', '$entry-2', ['example.org'])).toBe(
      'https://matrix.to/#/!harbor:example.org/$entry-2?via=example.org'
    );
  });

  it('round-trips native fallback room and event links with escaped IDs and multiple via servers', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);

    const alias = '#field/notes?north:remote.example.org';
    const roomId = '!harbor/desk:remote.example.org';
    const eventId = '$entry/1?rev#2';
    const viaServers = ['remote.example.org', 'relay.example.org'];

    const roomHref = getMatrixToRoom(alias, viaServers);
    expect(roomHref.startsWith('https://matrix.to/#/')).toBe(true);
    expect(parseMatrixToRoom(roomHref)).toEqual({
      roomIdOrAlias: alias,
      viaServers,
    });

    const eventHref = getMatrixToRoomEvent(roomId, eventId, viaServers);
    expect(eventHref.startsWith('https://matrix.to/#/')).toBe(true);
    expect(parseMatrixToRoomEvent(eventHref)).toEqual({
      roomIdOrAlias: roomId,
      eventId,
      viaServers,
    });
  });
});
