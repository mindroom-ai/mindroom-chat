// @vitest-environment jsdom
import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useMenuBehaviour } from './menuBehaviour';

// A press on the button of an open menu closes the menu (its focus trap closes it as the press
// starts), and the click that ends that press must not open it again. A surface that appears later
// for another reason, as a message's hover toolbar does, was not opened by that button.

function Surface({ label }: { label: string }) {
  const menu = useMenuBehaviour<HTMLDivElement>('menu', undefined, undefined);
  return <div ref={menu.ref} role="menu" aria-label={label} />;
}

type Controls = {
  setMenu: (open: boolean) => void;
  setToolbar: (shown: boolean) => void;
  clicks: number;
};

const controls: Controls = { setMenu: () => {}, setToolbar: () => {}, clicks: 0 };

function Page() {
  const [menu, setMenu] = useState(false);
  const [toolbar, setToolbar] = useState(false);
  controls.setMenu = setMenu;
  controls.setToolbar = setToolbar;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          controls.clicks += 1;
          setMenu(true);
        }}
      >
        Options
      </button>
      {menu && <Surface label="Options" />}
      {toolbar && <Surface label="Toolbar" />}
    </>
  );
}

describe('a press on the button of a menu', () => {
  let container: HTMLDivElement;
  let root: Root;
  const button = () => container.querySelector('button') as HTMLButtonElement;
  const menuShown = () => !!container.querySelector('[aria-label="Options"]');
  const fire = (type: string) =>
    act(() => {
      button().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    });

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    controls.clicks = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Page />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('that closes its menu as it starts does not open it again', () => {
    fire('pointerdown');
    fire('click');
    expect(menuShown()).toBe(true);

    fire('pointerdown');
    act(() => controls.setMenu(false));
    fire('click');
    expect(controls.clicks).toBe(1);
    expect(menuShown()).toBe(false);
  });

  it('reaches the button when another surface closes during it', () => {
    fire('pointerdown');
    fire('click');
    act(() => controls.setMenu(false));
    // The pointer moves on and a hover toolbar shows, within a second of that press.
    act(() => controls.setToolbar(true));

    // The next press on the button moves focus out of the toolbar, which closes it.
    fire('pointerdown');
    act(() => controls.setToolbar(false));
    fire('click');
    expect(controls.clicks).toBe(2);
    expect(menuShown()).toBe(true);
  });
});
