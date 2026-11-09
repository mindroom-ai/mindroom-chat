// @vitest-environment jsdom
import { isDeepStrictEqual } from 'node:util';
import { setFileScope } from '@vanilla-extract/css/fileScope';
import type { createStore as CreateStore } from 'jotai';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ActiveCall } from '../calls/callStore';

// Every atom the app makes while its modules load, with the stack that made it. Atoms made later
// (families, per-account factories) are keyed by what they are made for and not followed here.
const made = vi.hoisted(() => [] as { atom: object; stack: string }[]);

vi.mock('jotai', async (importOriginal) => {
  const jotai = await importOriginal<typeof import('jotai')>();
  const recordingAtom = (...args: unknown[]): object => {
    const created = (jotai.atom as (...params: unknown[]) => object)(...args);
    made.push({ atom: created, stack: new Error().stack ?? '' });
    return created;
  };
  return { ...jotai, atom: recordingAtom };
});

/**
 * Modules whose atoms all outlive an account (device-wide settings, a count the mounted pages
 * keep), and why. A module that holds anything else lists its kept atoms one by one in `keptAtoms`
 * below. Lane C makes its module-level atoms with jotai's `atom` alone (the lint rule bans the
 * factories this recording would miss); atoms made later by families and per-account factories
 * are keyed and not followed.
 */
const KEPT_MODULES: Record<string, string> = {
  'src/app/preferences/settings.ts': "this device's app settings, saved in localStorage",
  'src/app/emoji/emojiSkinTone.ts': "this device's emoji skin tone, saved in localStorage",
  'src/app/event-store/engine/prefetchSettings.ts':
    "this device's MindRoom settings, saved in localStorage",
  'src/app/preferences/voiceMessageSettings.ts':
    "this device's voice message speed and volume, saved in localStorage",
  'src/app/computer/computerServiceSettings.ts':
    'the computer service chosen on this device, saved in localStorage',
  'src/app/theme/useTheme.ts': "the deployment's default theme, from its config.json",
  // Not reset by the forget: it runs before the cleanups of the pages below the account's root,
  // whose own -1s would then take the count below 0.
  'src/app/navigation/useEdgeSwipeBack.ts':
    'counts the back swipes of the pages shown, each taken back as its page goes',
};

// The importer of the app: every module under src/app/, keyed by its path from the root.
const APP_MODULES = import.meta.glob([
  '/src/app/**/*.{ts,tsx}',
  '!/src/app/**/*.test.*',
  '!/src/app/**/__tests__/**',
  '!/src/app/**/test-utils/**',
  '!/src/app/**/*.css.ts',
  '!/src/app/**/*.d.ts',
]);

type AtomWrite = (get: unknown, set: (atom: unknown, value: unknown) => void) => unknown;
type PrimitiveAtom = { init: unknown; write: AtomWrite; toString(): string };

const isPrimitive = (atom: object): atom is PrimitiveAtom => 'init' in atom;

/** The module whose top-level code made the atom: the first stack frame outside any function. */
const madeBy = (stack: string): string | undefined => {
  for (const line of stack.split('\n')) {
    const frame = /^\s*at (\S*\/src\/app\/\S+?\.tsx?):\d+:\d+$/.exec(line);
    if (frame?.[1]) return frame[1].slice(frame[1].indexOf('src/app/'));
  }
  return undefined;
};

type Loaded = {
  primitives: { atom: PrimitiveAtom; module: string }[];
  createStore: typeof CreateStore;
  state: typeof import('./accountState');
  drafts: typeof import('../composer/roomInputDrafts');
  typing: typeof import('../matrix/state/typingMembers');
  calls: typeof import('../calls/callStore');
  agentCaller: typeof import('../calls/agent/agentCaller');
  settings: typeof import('../preferences/settings');
  membersDrawer: typeof import('../members/useMembersDrawer');
  spaceTabs: typeof import('../sidebar/rail/SpaceTabs');
};

let loaded: Loaded;

// Loads every app module one at a time: about a minute on a busy machine, and over two at a load
// of 700, so the hook gets ten.
beforeAll(async () => {
  // Style modules register their classes under a file scope, which the build plugin sets.
  setFileScope('src/app/shell/accountState.test.ts', 'mindroom-client');
  const failed: string[] = [];
  // One at a time: loading modules of an import cycle side by side can read a binding of the
  // cycle before it is set.
  for (const [path, load] of Object.entries(APP_MODULES)) {
    // eslint-disable-next-line no-await-in-loop
    await load().catch((error: unknown) => {
      failed.push(`${path}: ${String(error)}`);
    });
  }
  // A module that cannot load here could make atoms nobody checks.
  expect(failed).toEqual([]);
  const primitives = made.flatMap(({ atom, stack }) => {
    const module = madeBy(stack);
    return isPrimitive(atom) && module ? [{ atom, module }] : [];
  });
  loaded = {
    primitives,
    createStore: (await import('jotai')).createStore,
    state: await import('./accountState'),
    drafts: await import('../composer/roomInputDrafts'),
    typing: await import('../matrix/state/typingMembers'),
    calls: await import('../calls/callStore'),
    agentCaller: await import('../calls/agent/agentCaller'),
    settings: await import('../preferences/settings'),
    membersDrawer: await import('../members/useMembersDrawer'),
    spaceTabs: await import('../sidebar/rail/SpaceTabs'),
  };
}, 600_000);

/**
 * Atoms of a module that holds account state too, kept on purpose one by one, and why; any other
 * atom of the module is checked.
 */
const keptAtoms = (): Map<object, string> =>
  new Map<object, string>([
    [
      loaded.drafts.pendingVoiceSendDraftAtom,
      'names the account that recorded it: no other account sends it, its own can retry',
    ],
    [loaded.membersDrawer.phoneDrawerOpenAtom, "keyed by user ID: each account's own drawer"],
    [
      loaded.spaceTabs.openFoldersAtom,
      "keyed by folder ID, random for each folder of one account's rail",
    ],
  ]);

const isKept = ({ atom, module }: { atom: object; module: string }) =>
  module in KEPT_MODULES || keptAtoms().has(atom);

const describeAtom = ({ atom, module }: { atom: PrimitiveAtom; module: string }) =>
  `${module} (${atom.toString()})`;

/**
 * A value of the same kind as `init` with something of the last account in it: an entry more in
 * a list, set, map or object, the other boolean, a marker in place of nothing.
 */
const leftBehind = (init: unknown, module: string): unknown => {
  const marker = `left by ${module}`;
  if (Array.isArray(init)) return [...(init as unknown[]), marker];
  if (init instanceof Set) return new Set([...init, marker]);
  if (init instanceof Map) return new Map([...init, [marker, marker]]);
  if (typeof init === 'boolean') return !init;
  if (typeof init === 'number') return init + 1;
  if (typeof init === 'string') return `${init}${marker}`;
  if (init && typeof init === 'object') return { ...init, [marker]: marker };
  return { leftBy: module };
};

/** Puts a value straight into a primitive atom, past the reducer its own write may be. */
const putValue = (store: ReturnType<typeof CreateStore>, atom: PrimitiveAtom, value: unknown) => {
  const { write } = atom;
  // The store writes an atom's own value when its write sets the atom itself.
  atom.write = (_get, set) => set(atom, value);
  try {
    store.set(atom as never, undefined as never);
  } finally {
    atom.write = write;
  }
};

const runningCall = () => {
  const leave = vi.fn(async () => undefined);
  const onEnded = vi.fn(async () => undefined);
  const active = {
    kind: 'room',
    call: { room: { roomId: '!call:example.org' }, leave },
    onEnded,
  } as unknown as ActiveCall;
  return { active, leave, onEnded };
};

describe('forgetAccountState', () => {
  it('finds the atoms the app makes at module level', () => {
    // A recording that broke (another jotai entry point, a changed stack format) finds nothing.
    const modules = new Set(loaded.primitives.map(({ module }) => module));
    expect(modules).toContain('src/app/calls/agent/agentCaller.ts');
    expect(modules).toContain('src/app/matrix/state/roomList.ts');
    expect(modules).toContain('src/app/sidebar/rail/SpaceTabs.tsx');
  });

  it('puts every module-level atom an account leaves behind back to where it started', () => {
    const { primitives, createStore, state, typing, calls } = loaded;
    const store = createStore();
    const forgotten = primitives.filter((entry) => !isKept(entry));
    // Each atom first holds something of the last account, so a forget that writes back what it
    // finds, or a reset that keeps old entries, leaves it there. The two whose forget reads them
    // hold a value of the shape it reads; every other one gets an entry of its own.
    store.set(typing.roomIdToTypingMembersAtom, {
      type: 'PUT',
      roomId: '!room:example.org',
      userId: '@agent:example.org',
      ts: Date.now(),
      isTyping: () => true,
    });
    store.set(calls.activeCallAtom, runningCall().active);
    forgotten.forEach(({ atom, module }) => {
      if (isDeepStrictEqual(store.get(atom as never), atom.init)) {
        putValue(store, atom, leftBehind(atom.init, module));
      }
    });
    const left = (entry: (typeof forgotten)[number]) =>
      !isDeepStrictEqual(store.get(entry.atom as never), entry.atom.init);
    // Every atom must hold something else now, or the check below proves nothing for it.
    expect(forgotten.filter((entry) => !left(entry)).map(describeAtom)).toEqual([]);

    state.forgetAccountState(store);

    // Each one is account state that the next account would see: list it in accountState.ts,
    // or add its module to KEPT_MODULES above with the reason it may outlive the account.
    expect(forgotten.filter(left).map(describeAtom)).toEqual([]);
  });

  it('leaves the call and runs what follows its end', () => {
    const { createStore, state, calls } = loaded;
    const store = createStore();
    const { active, leave, onEnded } = runningCall();
    store.set(calls.activeCallAtom, active);
    store.set(calls.callPanelRoomAtom, '!shared:example.org');

    state.forgetAccountState(store);

    expect(leave).toHaveBeenCalledTimes(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(store.get(calls.activeCallAtom)).toBeUndefined();
    expect(store.get(calls.callPanelRoomAtom)).toBeUndefined();
  });

  it("drops the account's reply targets and staged files, which are keyed by room alone", () => {
    const { createStore, state, drafts } = loaded;
    const store = createStore();
    const roomId = '!shared:example.org';
    store.set(drafts.roomIdToReplyDraftAtomFamily(roomId), {
      userId: '@agent:example.org',
      eventId: '$question',
      body: 'Question',
    });

    state.forgetAccountState(store);

    expect(store.get(drafts.roomIdToReplyDraftAtomFamily(roomId))).toBeUndefined();
  });

  it("hides the last account's agent call notice and keeps this device's settings", () => {
    const { createStore, state, settings, agentCaller } = loaded;
    const store = createStore();
    const before = store.get(settings.settingsAtom);
    store.set(settings.settingsAtom, { ...before, isPeopleDrawer: !before.isPeopleDrawer });
    store.set(agentCaller.agentCallFailureAtom, { error: 'homeserver', id: 1 });

    state.forgetAccountState(store);

    expect(store.get(agentCaller.agentCallFailureAtom)).toBeUndefined();
    expect(store.get(settings.settingsAtom).isPeopleDrawer).toBe(!before.isPeopleDrawer);
  });

  it('keeps no module on purpose that makes no atom any more', () => {
    const modules = new Set(loaded.primitives.map(({ module }) => module));
    expect(Object.keys(KEPT_MODULES).filter((module) => !modules.has(module))).toEqual([]);
  });
});
