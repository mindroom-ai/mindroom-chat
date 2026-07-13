import { createStore } from 'jotai';
import { enableMapSet } from 'immer';
import { describe, expect, it } from 'vitest';
import { roomToParentsAtom } from './roomToParents';

enableMapSet();

describe('roomToParentsAtom', () => {
  it('removes only the invalidated Space parent from a multi-parent room', () => {
    const store = createStore();
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([
        ['!room:example.org', new Set(['!space-a:example.org', '!space-b:example.org'])],
      ]),
    });

    store.set(roomToParentsAtom, {
      type: 'REMOVE_PARENT',
      parent: '!space-a:example.org',
      child: '!room:example.org',
    });

    expect(store.get(roomToParentsAtom).get('!room:example.org')).toEqual(
      new Set(['!space-b:example.org'])
    );
  });

  it('removes the child entry after its final parent is invalidated', () => {
    const store = createStore();
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([['!room:example.org', new Set(['!space:example.org'])]]),
    });

    store.set(roomToParentsAtom, {
      type: 'REMOVE_PARENT',
      parent: '!space:example.org',
      child: '!room:example.org',
    });

    expect(store.get(roomToParentsAtom).has('!room:example.org')).toBe(false);
  });
});
