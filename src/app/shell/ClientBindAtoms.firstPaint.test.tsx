// @vitest-environment jsdom
import React, { useEffect, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { atom, createStore, Provider, useAtomValue, useSetAtom } from 'jotai';
import { afterEach, expect, it, vi } from 'vitest';
import { ClientBindAtoms } from './ClientBindAtoms';
import { useBindAtoms } from './useBindAtoms';

const client = { accountValue: 'account-b' };

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('./useBindAtoms', () => ({ useBindAtoms: vi.fn() }));

const accountValueAtom = atom('account-a');

/** A binding seeds its atom in a passive effect, as the real ones do. */
const useSeedAccount = (current: typeof client) => {
  const setAccountValue = useSetAtom(accountValueAtom);
  useEffect(() => {
    setAccountValue(current.accountValue);
  }, [current, setAccountValue]);
};

function Page() {
  return <p>{useAtomValue(accountValueAtom)}</p>;
}

/** Reads the page once the task that committed the first render is over: the browser paints then. */
function FirstFrame({ container, seen }: { container: HTMLElement; seen: string[] }) {
  useLayoutEffect(() => {
    queueMicrotask(() => seen.push(container.textContent ?? ''));
  }, [container, seen]);
  return null;
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = undefined;
});

it('shows the seeded pages in the first frame, never an empty one', async () => {
  vi.mocked(useBindAtoms).mockImplementation(useSeedAccount as never);
  const container = document.createElement('div');
  const seen: string[] = [];
  root = createRoot(container);

  // A start renders from a resolved promise, not inside act or a discrete event.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  root.render(
    <Provider store={createStore()}>
      <FirstFrame container={container} seen={seen} />
      <ClientBindAtoms>
        <Page />
      </ClientBindAtoms>
    </Provider>
  );
  await vi.waitFor(() => expect(seen).toHaveLength(1));

  expect(seen).toEqual(['account-b']);
});
