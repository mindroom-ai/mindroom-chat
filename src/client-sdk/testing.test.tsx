// @vitest-environment jsdom
// `renderPluginComponent`'s stand-in client, side panel frame, screen size and theme kind,
// `registerPluginStrings` and `PanelPlace`, as a plugin's test meets them: through the SDK only.
import { act, fireEvent, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { usePanelFrame, usePluginTranslation } from '@mindroom/client-sdk/core';
import { mxcUrlToHttp, useMatrixClient, useMediaAuthentication } from '@mindroom/client-sdk/matrix';
import {
  PanelPlace,
  registerPluginStrings,
  renderPluginComponent,
} from '@mindroom/client-sdk/testing';
import { usePanelPresence, useScreenSize, useThemeKind } from '@mindroom/client-sdk/ui';

/** An avatar as a plugin draws one: authenticated as the app asks, unless the test says. */
function Avatar({ authenticated }: { authenticated?: boolean }) {
  const client = useMatrixClient();
  const appAuthenticated = useMediaAuthentication();
  const src = mxcUrlToHttp(
    client,
    'mxc://example.org/avatar',
    authenticated ?? appAuthenticated,
    32,
    32,
    'crop'
  );
  return <img alt="Avatar" src={src ?? undefined} />;
}

/** A panel that draws its own frame, as a plugin draws one: a button that fills it. */
function Card() {
  const frame = usePanelFrame();
  if (!frame) return <p>No frame</p>;
  return (
    <button type="button" onClick={() => frame.setLayout('filled')}>
      {`Fill ${frame.label}, ${frame.layout}`}
    </button>
  );
}

/** What a surface a plugin draws itself reads of the app's layout. */
function Layout() {
  return <p>{`${useScreenSize()}, ${useThemeKind()}`}</p>;
}

describe('renderPluginComponent', () => {
  it("builds media URLs with the stand-in client, as the app's answer on authentication asks", async () => {
    // A test knows neither the homeserver's versions nor a service worker, so its media is the
    // unauthenticated kind.
    const view = await renderPluginComponent(<Avatar />, { id: 'media', plugin: {} });
    expect(view.getByRole('img', { name: 'Avatar' })).toHaveProperty(
      'src',
      'https://example.org/_matrix/media/v3/thumbnail/example.org/avatar?width=32&height=32&method=crop'
    );
  });

  it('builds authenticated media URLs with the stand-in client', async () => {
    const view = await renderPluginComponent(<Avatar authenticated />, {
      id: 'media',
      plugin: {},
    });
    expect(view.getByRole('img', { name: 'Avatar' })).toHaveProperty(
      'src',
      'https://example.org/_matrix/client/v1/media/thumbnail/example.org/avatar?width=32&height=32&method=crop&allow_redirect=true'
    );
  });

  it('gives a component the side panel frame the test gives, as the app gives a panel that draws its own', async () => {
    const setLayout = vi.fn();
    const view = await renderPluginComponent(<Card />, {
      id: 'card',
      plugin: {},
      frame: { label: 'Card', layout: 'beside', setLayout },
    });
    fireEvent.click(view.getByRole('button', { name: 'Fill Card, beside' }));
    expect(setLayout).toHaveBeenCalledWith('filled');
  });

  it('gives a component no side panel frame unless the test gives one', async () => {
    const view = await renderPluginComponent(<Card />, { id: 'card', plugin: {} });
    expect(view.container.textContent).toBe('No frame');
  });

  it('gives a component the screen size and theme kind the test gives', async () => {
    const phone = await renderPluginComponent(<Layout />, {
      id: 'layout',
      plugin: {},
      screenSize: 'Mobile',
      themeKind: 'dark',
    });
    expect(phone.container.textContent).toBe('Mobile, dark');
    const tablet = await renderPluginComponent(<Layout />, {
      id: 'layout',
      plugin: {},
      screenSize: 'Tablet',
      themeKind: 'dark',
    });
    expect(tablet.container.textContent).toBe('Tablet, dark');
  });

  // After the test above, whose theme kinds must not outlive it.
  it('gives a component Desktop and light unless the test gives others', async () => {
    const view = await renderPluginComponent(<Layout />, { id: 'layout', plugin: {} });
    expect(view.container.textContent).toBe('Desktop, light');
  });

  describe('in a document marked dark', () => {
    beforeAll(() => {
      document.documentElement.dataset.themeKind = 'dark';
    });
    afterAll(() => {
      delete document.documentElement.dataset.themeKind;
    });

    it('gives a component the theme kind the test gives', async () => {
      const view = await renderPluginComponent(<Layout />, {
        id: 'layout',
        plugin: {},
        themeKind: 'light',
      });
      expect(view.container.textContent).toBe('Desktop, light');
    });

    // Also after the test above, whose light theme kind must not outlive it.
    it("gives a component the document's theme kind unless the test gives one", async () => {
      const view = await renderPluginComponent(<Layout />, { id: 'layout', plugin: {} });
      expect(view.container.textContent).toBe('Desktop, dark');
    });
  });
});

describe('registerPluginStrings', () => {
  it("gives a plugin's strings to a hook rendered without renderPluginComponent", () => {
    registerPluginStrings('strings', { translations: { en: { greeting: 'Hello, {{name}}' } } });
    const { result } = renderHook(() => usePluginTranslation('strings'));
    expect(result.current('greeting', { name: 'Ada' })).toBe('Hello, Ada');
  });
});

describe('PanelPlace', () => {
  /** The registration of the last moving panel that registered. */
  let registration: (() => void) & { done: () => void };

  /** A panel that draws its own frame and moves, as a plugin's does: it registers with its place. */
  function MovingCard({ name }: { name: string }) {
    const presence = usePanelPresence();
    const register = presence?.register;
    useLayoutEffect(() => {
      if (!register) return undefined;
      registration = register();
      return registration;
    }, [register]);
    return <p>{`${name}, ${presence?.phase ?? 'no place'}`}</p>;
  }

  /** The place holding the card `open`, or none, rendered with the test's panel frame. */
  const place = (open?: string) => (
    <PanelPlace>{open ? <MovingCard key={open} name={open} /> : null}</PanelPlace>
  );

  const renderPlace = async () => {
    const frame = { label: 'Card', layout: 'beside' as const, setLayout: () => undefined };
    const view = await renderPluginComponent(place(), { id: 'card', plugin: {}, frame });
    return { ...view, setOpen: (open?: string) => view.rerender(place(open)) };
  };

  it('keeps a panel that registered while it moves out, until its done', async () => {
    const { container, setOpen } = await renderPlace();
    expect(container.textContent).toBe('');
    setOpen('First');
    expect(container.textContent).toBe('First, enter');
    setOpen();
    expect(container.textContent).toBe('First, exit');
    act(() => registration.done());
    expect(container.textContent).toBe('');
  });

  it('leaves the place to the panel that took it while the first moved out, whose late done ends nothing', async () => {
    const { container, setOpen } = await renderPlace();
    setOpen('First');
    setOpen();
    const firstDone = registration.done;
    setOpen('Second');
    expect(container.textContent).toBe('Second, swap');
    setOpen();
    // The first panel's motion ends only now, after the second started to move out.
    act(() => firstDone());
    expect(container.textContent).toBe('Second, exit');
    act(() => registration.done());
    expect(container.textContent).toBe('');
  });
});
