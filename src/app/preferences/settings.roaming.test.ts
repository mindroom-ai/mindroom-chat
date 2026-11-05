// @vitest-environment jsdom
import { createStore } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings, getSettings, settingsAtom } from './settings';
import {
  loadPendingRoamingSettings,
  pendingRoamingSettingsAtom,
  pendingRoamingSettingsKey,
  roamingAccountContentAtom,
} from './roamingSettings';

const ALICE = pendingRoamingSettingsKey('@alice:example.org', 'ALICEPHONE');
const BOB = pendingRoamingSettingsKey('@bob:example.org', 'BOBPHONE');

const storeDevice = (changes: Partial<Settings>) =>
  localStorage.setItem('settings', JSON.stringify({ ...DEFAULT_SETTINGS, ...changes }));

/** A store signed in as the login of `storageKey`, with that account's content. */
const signedIn = (storageKey: string, content?: Record<string, unknown>) => {
  const store = createStore();
  store.set(roamingAccountContentAtom, content);
  store.set(pendingRoamingSettingsAtom, { storageKey, values: {} });
  return store;
};

/** What `useSetting` does: one field over everything the atom shows. */
const change = <K extends keyof Settings>(
  store: ReturnType<typeof createStore>,
  key: K,
  value: Settings[K]
) => store.set(settingsAtom, { ...store.get(settingsAtom), [key]: value });

afterEach(() => localStorage.clear());

describe('settingsAtom with roaming settings', () => {
  it('shows the pending edit, then the account value, then this device value', () => {
    storeDevice({ hour24Clock: false, isMarkdown: false, dateFormatString: 'DD/MM/YYYY' });
    const store = signedIn(ALICE, { version: 1, hour24Clock: false, isMarkdown: true });
    store.set(pendingRoamingSettingsAtom, { storageKey: ALICE, values: { hour24Clock: true } });

    const shown = store.get(settingsAtom);
    expect(shown.hour24Clock).toBe(true);
    expect(shown.isMarkdown).toBe(true);
    expect(shown.dateFormatString).toBe('DD/MM/YYYY');
  });

  it('follows the account content sync delivers, with no edit of its own', () => {
    const store = signedIn(ALICE);
    expect(store.get(settingsAtom).hour24Clock).toBe(false);
    store.set(roamingAccountContentAtom, { version: 1, hour24Clock: true });
    expect(store.get(settingsAtom).hour24Clock).toBe(true);
  });

  it('keeps device settings on the device, whatever the account content holds', () => {
    storeDevice({ pageZoom: 90, encUrlPreview: false });
    const store = signedIn(ALICE, { version: 1, pageZoom: 150, encUrlPreview: true });
    expect(store.get(settingsAtom).pageZoom).toBe(90);
    expect(store.get(settingsAtom).encUrlPreview).toBe(false);
  });

  it("puts a roaming change in the login's pending edits and leaves this device's value", () => {
    storeDevice({ hour24Clock: false });
    const store = signedIn(ALICE, { version: 1 });

    change(store, 'hour24Clock', true);

    expect(store.get(settingsAtom).hour24Clock).toBe(true);
    expect(store.get(pendingRoamingSettingsAtom)).toEqual({
      storageKey: ALICE,
      values: { hour24Clock: true },
    });
    expect(loadPendingRoamingSettings(ALICE)).toEqual({ hour24Clock: true });
    expect(getSettings().hour24Clock).toBe(false);
  });

  it('writes device settings to this device only, and never adds them to the pending edits', () => {
    const store = signedIn(ALICE, { version: 1, hour24Clock: true });

    change(store, 'pageZoom', 120);
    change(store, 'useSystemTheme', false);

    expect(getSettings().pageZoom).toBe(120);
    expect(getSettings().useSystemTheme).toBe(false);
    expect(store.get(pendingRoamingSettingsAtom).values).toEqual({});
    // The account's value never lands in the device entry either.
    expect(getSettings().hour24Clock).toBe(false);
  });

  it('stores a roaming change on the device while no account is signed in', () => {
    const store = createStore();
    change(store, 'isMarkdown', false);
    expect(getSettings().isMarkdown).toBe(false);
    expect(store.get(pendingRoamingSettingsAtom).values).toEqual({});
  });

  it("never shows one account's choices to another account on the same device", () => {
    storeDevice({ hideActivity: false });
    const alice = signedIn(ALICE, { version: 1, hour24Clock: true });
    change(alice, 'hideActivity', true);

    // Bob signs in on the same device: his own account content and pending edits, the same
    // device entry, which Alice's choices never reached.
    const bob = signedIn(BOB, { version: 1 });
    expect(bob.get(settingsAtom).hour24Clock).toBe(false);
    expect(bob.get(settingsAtom).hideActivity).toBe(false);
    expect(loadPendingRoamingSettings(BOB)).toEqual({});
    expect(loadPendingRoamingSettings(ALICE)).toEqual({ hideActivity: true });
  });
});
