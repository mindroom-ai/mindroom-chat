// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { Icons } from 'folds';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu } from './glass/GlassPrimitives';
import { MenuEntry, MenuGroup, MenuSwitchEntry } from './MenuEntry';
import * as css from './MenuEntry.css';

vi.unmock('./glass/GlassPrimitives');

afterEach(cleanup);

describe('MenuGroup', () => {
  it('omits group role and heading when label is unset', () => {
    render(
      <Menu>
        <MenuGroup>
          <MenuEntry label="Action" icon={Icons.Check} onSelect={vi.fn()} />
        </MenuGroup>
      </Menu>
    );
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('renders an overline heading linked by aria-labelledby when label is set', () => {
    render(
      <Menu>
        <MenuGroup label="Preferences">
          <MenuEntry label="Notifications" icon={Icons.Bell} onSelect={vi.fn()} />
        </MenuGroup>
      </Menu>
    );
    const group = screen.getByRole('group', { name: 'Preferences' });
    const headingId = group.getAttribute('aria-labelledby');
    expect(headingId).toBeTruthy();
    expect(document.getElementById(headingId!)?.textContent).toBe('Preferences');
  });
});

describe('MenuSwitchEntry', () => {
  it('renders a menuitemcheckbox with a disabled aria-hidden switch and toggles on click, Enter and Space', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <Menu>
        <MenuGroup>
          <MenuSwitchEntry
            label="Show Tool Calls"
            checked={false}
            onToggle={onToggle}
            data-tool-calls-toggle=""
          />
        </MenuGroup>
      </Menu>
    );

    const item = screen.getByRole('menuitemcheckbox', { name: 'Show Tool Calls' });
    expect(item.tagName).toBe('DIV');
    expect(item.getAttribute('aria-checked')).toBe('false');
    expect(item.getAttribute('tabindex')).toBe('0');
    expect(item.hasAttribute('data-tool-calls-toggle')).toBe(true);

    const innerSwitch = item.querySelector<HTMLButtonElement>('button[role="switch"]');
    expect(innerSwitch).not.toBeNull();
    expect(innerSwitch?.disabled).toBe(true);
    expect(innerSwitch?.getAttribute('aria-hidden')).toBe('true');
    expect(innerSwitch?.getAttribute('tabindex')).toBe('-1');
    expect(innerSwitch?.classList.contains(css.DecorativeSwitch)).toBe(true);

    innerSwitch?.focus();
    expect(document.activeElement).not.toBe(innerSwitch);

    fireEvent.click(item);
    expect(onToggle).toHaveBeenCalledTimes(1);

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    item.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(2);

    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    item.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(3);

    const repeat = new KeyboardEvent('keydown', {
      key: ' ',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    item.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(3);

    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    item.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    expect(onToggle).toHaveBeenCalledTimes(3);

    rerender(
      <Menu>
        <MenuGroup>
          <MenuSwitchEntry label="Show Tool Calls" checked onToggle={onToggle} />
        </MenuGroup>
      </Menu>
    );
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Show Tool Calls' }).getAttribute('aria-checked')
    ).toBe('true');
  });

  it('has zero axe nested-interactive violations when rendered inside a Menu', async () => {
    const { container } = render(
      <Menu>
        <MenuGroup>
          <MenuSwitchEntry label="Show Tool Calls" checked={false} onToggle={vi.fn()} />
          <MenuSwitchEntry label="Compact Mode" checked onToggle={vi.fn()} />
        </MenuGroup>
      </Menu>
    );

    const results = await axe.run(container, { runOnly: ['nested-interactive'] });
    expect(results.violations).toEqual([]);
  });
});
