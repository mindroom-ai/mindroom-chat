// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Icons } from 'folds';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu } from './glass/GlassPrimitives';
import { MenuEntry, MenuGroup, MenuSwitchEntry } from './MenuEntry';

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
  it('renders a menuitemcheckbox with an aria-hidden switch and toggles on click, Enter and Space', () => {
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
    expect(item.querySelector('[aria-hidden="true"][tabindex="-1"]')).not.toBeNull();

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
});
