// @vitest-environment jsdom

import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NATIVE_APP_WEB_ORIGIN,
  getMatrixToRoom,
  getMatrixToRoomEvent,
  parseMatrixToRoom,
  parseMatrixToRoomEvent,
  testMatrixTo,
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

    expect(getMatrixToRoom('!harbor:example.org', ['example.org'])).toBe(
      `${window.location.origin}/!harbor:example.org?via=example.org`
    );
  });

  it('copies event links on the current app origin', () => {
    window.history.pushState({}, '', '/home/');

    expect(getMatrixToRoomEvent('!harbor:example.org', '$entry-1', ['example.org'])).toBe(
      `${window.location.origin}/!harbor:example.org/$entry-1?via=example.org`
    );
  });

  it('preserves deployments hosted under a base path', () => {
    globalThis.__APP_BASE_PATH__ = '/mindroom/';
    window.history.pushState({}, '', '/mindroom/home/');

    expect(getMatrixToRoomEvent('!harbor:example.org', '$entry-1', ['example.org'])).toBe(
      `${window.location.origin}/mindroom/!harbor:example.org/$entry-1?via=example.org`
    );
  });

  it('emits canonical Universal Links on native Capacitor iOS (capacitor://localhost)', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.stubGlobal('location', {
      protocol: 'capacitor:',
      origin: 'capacitor://localhost',
      href: 'capacitor://localhost/home/',
    });

    expect(getMatrixToRoom('!harbor:example.org', ['example.org', 'relay.example.org'])).toBe(
      `${NATIVE_APP_WEB_ORIGIN}/!harbor:example.org?via=example.org&via=relay.example.org`
    );
    expect(getMatrixToRoom('#field-notes:remote.example.org')).toBe(
      `${NATIVE_APP_WEB_ORIGIN}/%23field-notes:remote.example.org`
    );
    expect(getMatrixToRoomEvent('!harbor:example.org', '$entry-1', ['example.org'])).toBe(
      `${NATIVE_APP_WEB_ORIGIN}/!harbor:example.org/$entry-1?via=example.org`
    );
  });

  it('emits canonical Universal Links on native Capacitor Android (https://localhost)', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.stubGlobal('location', {
      protocol: 'https:',
      origin: 'https://localhost',
      href: 'https://localhost/home/',
    });

    expect(getMatrixToRoom('!harbor:example.org', ['example.org'])).toBe(
      `${NATIVE_APP_WEB_ORIGIN}/!harbor:example.org?via=example.org`
    );
    expect(getMatrixToRoomEvent('!harbor:example.org', '$entry-1', ['example.org'])).toBe(
      `${NATIVE_APP_WEB_ORIGIN}/!harbor:example.org/$entry-1?via=example.org`
    );
  });

  it('falls back to matrix.to when non-native location uses capacitor://localhost', () => {
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

  it('round-trips native Universal Links with escaped IDs and multiple via servers', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);

    const alias = '#field/notes?north:remote.example.org';
    const roomId = '!harbor/desk:remote.example.org';
    const eventId = '$entry/1?rev#2';
    const viaServers = ['remote.example.org', 'relay.example.org'];

    const roomHref = getMatrixToRoom(alias, viaServers);
    expect(roomHref.startsWith(`${NATIVE_APP_WEB_ORIGIN}/`)).toBe(true);
    expect(testMatrixTo(roomHref)).toBe(true);
    expect(parseMatrixToRoom(roomHref)).toEqual({
      roomIdOrAlias: alias,
      viaServers,
    });

    const eventHref = getMatrixToRoomEvent(roomId, eventId, viaServers);
    expect(eventHref.startsWith(`${NATIVE_APP_WEB_ORIGIN}/`)).toBe(true);
    expect(testMatrixTo(eventHref)).toBe(true);
    expect(parseMatrixToRoomEvent(eventHref)).toEqual({
      roomIdOrAlias: roomId,
      eventId,
      viaServers,
    });
  });

  it('parses canonical native Universal Links on native shells and other web origins', () => {
    const roomHref = `${NATIVE_APP_WEB_ORIGIN}/!harbor:example.org?via=example.org&via=relay.example.org`;
    const aliasHref = `${NATIVE_APP_WEB_ORIGIN}/%23field-notes:remote.example.org`;
    const eventHref = `${NATIVE_APP_WEB_ORIGIN}/!harbor:example.org/$entry-1?via=example.org`;

    // On a different web origin (jsdom defaults to http://localhost:3000)
    expect(window.location.origin).not.toBe(NATIVE_APP_WEB_ORIGIN);
    expect(testMatrixTo(roomHref)).toBe(true);
    expect(parseMatrixToRoom(roomHref)).toEqual({
      roomIdOrAlias: '!harbor:example.org',
      viaServers: ['example.org', 'relay.example.org'],
    });
    expect(parseMatrixToRoom(aliasHref)).toEqual({
      roomIdOrAlias: '#field-notes:remote.example.org',
      viaServers: [],
    });
    expect(parseMatrixToRoomEvent(eventHref)).toEqual({
      roomIdOrAlias: '!harbor:example.org',
      eventId: '$entry-1',
      viaServers: ['example.org'],
    });

    // On a native Capacitor shell origin
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.stubGlobal('location', {
      protocol: 'capacitor:',
      origin: 'capacitor://localhost',
      href: 'capacitor://localhost/home/',
    });
    expect(testMatrixTo(eventHref)).toBe(true);
    expect(parseMatrixToRoomEvent(eventHref)).toEqual({
      roomIdOrAlias: '!harbor:example.org',
      eventId: '$entry-1',
      viaServers: ['example.org'],
    });
  });

  it.each([
    'http://chat.mindroom.chat/!harbor:example.org',
    'http://chat.mindroom.chat/!harbor:example.org/$entry-1',
    'https://user:pass@chat.mindroom.chat/!harbor:example.org',
    'https://user@chat.mindroom.chat/!harbor:example.org/$entry-1',
    `${window.location.origin.replace('http://', 'http://user:pass@')}/!harbor:example.org`,
    `${NATIVE_APP_WEB_ORIGIN}/connect?code=ABCD-EFGH`,
    `${NATIVE_APP_WEB_ORIGIN}/home/!harbor:example.org`,
    `${NATIVE_APP_WEB_ORIGIN}/home/!harbor:example.org/$entry-1`,
    `${NATIVE_APP_WEB_ORIGIN}/!space:example.org/lobby`,
    `${NATIVE_APP_WEB_ORIGIN}/!space:example.org/!harbor:example.org`,
    `${window.location.origin}/!space:example.org/lobby`,
    `${window.location.origin}/!space:example.org/!harbor:example.org`,
  ])('rejects unsupported or non-permalink URLs: %s', (href) => {
    expect(testMatrixTo(href)).toBe(false);
    expect(parseMatrixToRoom(href)).toBeUndefined();
    expect(parseMatrixToRoomEvent(href)).toBeUndefined();
  });
});
