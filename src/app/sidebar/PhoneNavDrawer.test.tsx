// @vitest-environment jsdom
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { phoneNavDrawerOpenAtom, phoneNavSectionRootAtom } from '../navigation/phoneNavDrawer';
import { PhoneNavDrawer } from './PhoneNavDrawer';
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./PhoneNavDrawer.css', () => ({ Scrim: 'scrim', Panel: 'panel', Slot: 'slot' }));

// The data router builds a Request per navigation; under jsdom its signal needs this.
followRouterSignalsInNode();

describe('PhoneNavDrawer', () => {
  it('puts the drawer away when it unmounts, as a phone turned sideways does', () => {
    const store = createStore();
    const router = createMemoryRouter([{ path: '*', element: <PhoneNavDrawer nav={null} /> }], {
      initialEntries: ['/home/!room:example.org/'],
    });
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      );
    });
    act(() => store.set(phoneNavDrawerOpenAtom, true));
    act(() => renderer?.unmount());
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
  });

  it('opens on a shown section page and goes away when that page gives way on the spot', async () => {
    const store = createStore();
    const router = createMemoryRouter([{ path: '*', element: <PhoneNavDrawer nav={null} /> }], {
      initialEntries: ['/!space:example.org/!room:example.org/'],
    });
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      );
    });
    // A room's back chevron replaces the room with its space's own page.
    await act(async () => {
      await router.navigate('/!space:example.org/', { replace: true });
    });
    expect(router.state.historyAction).toBe('REPLACE');
    act(() => store.set(phoneNavSectionRootAtom, router.state.location.key));
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
    // The space was left: its join page takes the place of its own page, with no navigation.
    act(() => store.set(phoneNavSectionRootAtom, null));
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    act(() => renderer?.unmount());
  });

  it('closes on Escape though a popover stays in the inert page below', () => {
    const store = createStore();
    const router = createMemoryRouter([{ path: '*', element: <PhoneNavDrawer nav={null} /> }], {
      initialEntries: ['/home/!room:example.org/'],
    });
    const page = document.createElement('div');
    page.setAttribute('inert', '');
    page.innerHTML = '<div role="dialog">Thread statistics</div>';
    document.body.append(page);
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      );
    });
    act(() => store.set(phoneNavDrawerOpenAtom, true));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    act(() => renderer?.unmount());
    page.remove();
  });
});
