// @vitest-environment jsdom
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { PhoneNavDrawer } from './PhoneNavDrawer';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./PhoneNavDrawer.css', () => ({ Scrim: 'scrim', Panel: 'panel', Slot: 'slot' }));

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
});
