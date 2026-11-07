// @vitest-environment jsdom
import { Provider, createStore } from 'jotai';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, type NavigateFunction, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MembersOverlayFollowsNavigation, phoneDrawerOpenAtom } from './useMembersDrawer';

let navigate: NavigateFunction | undefined;

function Navigator() {
  navigate = useNavigate();
  return null;
}

const mount = (open: Record<string, boolean>) => {
  const store = createStore();
  store.set(phoneDrawerOpenAtom, open);
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/home/!garden:example.org/']}>
        <Navigator />
        <MembersOverlayFollowsNavigation />
      </MemoryRouter>
    </Provider>
  );
  return store;
};

afterEach(cleanup);

describe('MembersOverlayFollowsNavigation', () => {
  it('puts the members over the page away on a navigation, also to a page of its own', () => {
    const store = mount({ '@alice:example.org': true });
    expect(store.get(phoneDrawerOpenAtom)).toEqual({ '@alice:example.org': true });
    act(() => {
      void navigate?.('/!space:example.org/');
    });
    expect(store.get(phoneDrawerOpenAtom)).toEqual({});
  });

  it('leaves the state alone when no members are out', () => {
    const closed = { '@alice:example.org': false };
    const store = mount(closed);
    act(() => {
      void navigate?.('/home/!harbor:example.org/');
    });
    expect(store.get(phoneDrawerOpenAtom)).toBe(closed);
  });

  it('keeps them out through a replace, as an address clean-up makes', () => {
    const store = mount({ '@alice:example.org': true });
    act(() => {
      void navigate?.('/home/!garden:example.org/?threadId=%24root', { replace: true });
    });
    expect(store.get(phoneDrawerOpenAtom)).toEqual({ '@alice:example.org': true });
  });
});
