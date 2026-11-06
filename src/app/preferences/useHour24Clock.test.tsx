// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettings } from './settings';
import { pendingRoamingSettingsAtom, roamingAccountContentAtom } from './roamingSettings';
import { useHour24Clock } from './useHour24Clock';

const language = vi.hoisted(() => ({ value: 'en' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: language.value } }),
}));

/** The clock a signed-in account's screens show, and its setter. */
const clockOf = (content?: Record<string, unknown>) => {
  const store = createStore();
  store.set(roamingAccountContentAtom, content);
  store.set(pendingRoamingSettingsAtom, { storageKey: 'pending:@a:x:DEVICE', values: {} });
  let latest: ReturnType<typeof useHour24Clock> | undefined;
  function Probe() {
    latest = useHour24Clock();
    return null;
  }
  act(() => {
    create(React.createElement(Provider, { store }, React.createElement(Probe)));
  });
  return () => latest!;
};

afterEach(() => {
  localStorage.clear();
  language.value = 'en';
});

describe('useHour24Clock', () => {
  it("follows the app language's clock until the user picks one", () => {
    language.value = 'de';
    expect(clockOf()()[0]).toBe(true);
    language.value = 'en';
    expect(clockOf()()[0]).toBe(false);
  });

  it("keeps the account's choice in every language", () => {
    language.value = 'de';
    expect(clockOf({ version: 1, hour24Clock: false })()[0]).toBe(false);
    language.value = 'en';
    expect(clockOf({ version: 1, hour24Clock: true })()[0]).toBe(true);
  });

  it('records a choice the switch makes', () => {
    language.value = 'de';
    const clock = clockOf();
    act(() => clock()[1](false));
    expect(clock()[0]).toBe(false);
  });

  it("reads a device's stored false, every device's old default, as no choice", () => {
    localStorage.setItem('settings', JSON.stringify({ hour24Clock: false }));
    expect(getSettings().hour24Clock).toBeUndefined();
    language.value = 'fr';
    expect(clockOf()()[0]).toBe(true);
    localStorage.setItem('settings', JSON.stringify({ hour24Clock: true }));
    expect(getSettings().hour24Clock).toBe(true);
  });
});
