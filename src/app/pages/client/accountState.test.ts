// @vitest-environment jsdom
import { isDeepStrictEqual } from 'node:util';
import { setFileScope } from '@vanilla-extract/css/fileScope';
import type { createStore as CreateStore } from 'jotai';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ActiveCall } from '../../features/calls/callStore';

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
 * Module-level atoms that outlive an account on purpose, by the module that makes them, and why.
 * A module listed here keeps every atom it makes.
 */
const KEPT_MODULES: Record<string, string> = {
  'src/app/state/settings.ts': "this device's app settings, saved in localStorage",
  'src/app/state/emojiSkinTone.ts': "this device's emoji skin tone, saved in localStorage",
  'src/app/mindroom/settings/mindroomSettings.ts':
    "this device's MindRoom settings, saved in localStorage",
  'src/app/mindroom/settings/voiceMessageSettings.ts':
    "this device's voice message speed and volume, saved in localStorage",
  'src/app/mindroom/computer/computerServiceSettings.ts':
    'the computer service chosen on this device, saved in localStorage',
  'src/app/mindroom/sidebar/useMembersDrawer.ts': "keyed by user ID: each account's own drawer",
  'src/app/pages/client/sidebar/SpaceTabs.tsx':
    "keyed by folder ID, random for each folder of one account's rail",
};

// The importer of the app: the glob runs from this file, so its keys start at `src/app/`.
const APP_MODULES = import.meta.glob([
  '../../**/*.{ts,tsx}',
  '!../../**/*.test.*',
  '!../../**/__tests__/**',
  '!../../**/test-utils/**',
  '!../../**/*.css.ts',
  '!../../**/*.d.ts',
]);

type PrimitiveAtom = { init: unknown; write: (...args: unknown[]) => unknown; toString(): string };

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
  drafts: typeof import('../../state/room/roomInputDrafts');
  typing: typeof import('../../state/typingMembers');
  calls: typeof import('../../features/calls/callStore');
  agentCaller: typeof import('../../mindroom/calls/agentCaller');
  settings: typeof import('../../state/settings');
};

let loaded: Loaded;

beforeAll(async () => {
  // Style modules register their classes under a file scope, which the build plugin sets.
  setFileScope('src/app/pages/client/accountState.test.ts', 'mindroom-client');
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
    drafts: await import('../../state/room/roomInputDrafts'),
    typing: await import('../../state/typingMembers'),
    calls: await import('../../features/calls/callStore'),
    agentCaller: await import('../../mindroom/calls/agentCaller'),
    settings: await import('../../state/settings'),
  };
}, 120_000);

/** Atoms of a module that also holds account state, kept on purpose, and why. */
const keptAtoms = (): Map<object, string> =>
  new Map([
    [
      loaded.drafts.pendingVoiceSendDraftAtom,
      'names the account that recorded it: no other account sends it, its own can retry',
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
  atom.write = (_get: unknown, set: (target: unknown, next: unknown) => void) => set(atom, value);
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
    expect(modules).toContain('src/app/mindroom/calls/agentCaller.ts');
    expect(modules).toContain('src/app/state/room-list/roomList.ts');
    expect(modules).toContain('src/app/pages/client/sidebar/SpaceTabs.tsx');
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
