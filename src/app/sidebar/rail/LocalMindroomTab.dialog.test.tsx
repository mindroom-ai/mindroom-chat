import React, { type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MindroomTab } from './LocalMindroomTab';

vi.mock('./LocalMindroomTab.css', () => ({ LinkIndicator: 'link-indicator' }));

// Stand-ins that show what the tab hands the rail components: the tooltip text, and the
// button's element and outline.
vi.mock('../../ui/sidebar/SidebarItem', () => ({
  SidebarItem: ({ children }: { children: ReactNode }) =>
    React.createElement('div', { 'data-rail-entry': true }, children),
  SidebarItemBadge: ({ children }: { children: ReactNode }) =>
    React.createElement('div', { 'data-badge': true }, children),
  SidebarItemTooltip: ({
    tooltip,
    children,
  }: {
    tooltip?: ReactNode;
    children: (triggerRef: () => void) => ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-tooltip': tooltip },
      children(() => undefined)
    ),
  SidebarAvatar: React.forwardRef<
    HTMLElement,
    { as?: 'button' | 'div'; outlined?: boolean; children?: ReactNode }
  >(({ as = 'div', outlined, children, ...props }, ref) =>
    React.createElement(as, { ...props, ref, 'data-outlined': outlined }, children)
  ),
}));

vi.mock('../../ui/Modal500', () => ({
  Modal500: ({ requestClose, children }: { requestClose: () => void; children: ReactNode }) =>
    React.createElement('div', { 'data-modal': true, onClick: requestClose }, children),
}));

vi.mock('../../settings/Settings', () => ({
  Settings: ({ initialPage, requestClose }: { initialPage?: string; requestClose: () => void }) =>
    React.createElement('button', {
      type: 'button',
      'data-settings': initialPage,
      onClick: requestClose,
    }),
}));

const render = () => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<MindroomTab />);
  });
  if (!renderer) throw new Error('MindroomTab did not render');
  return renderer;
};

const tabButton = (renderer: ReactTestRenderer) =>
  renderer.root.find((node) => node.type === 'button' && node.props['data-outlined'] === true);

const press = (node: ReactTestInstance) => {
  act(() => {
    (node.props.onClick as () => void)();
  });
};

const dialogs = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'div' && node.props['data-modal'] === true);

const settings = (renderer: ReactTestRenderer) =>
  renderer.root.find((node) => node.type === 'button' && 'data-settings' in node.props);

describe('MindroomTab', () => {
  it('opens Settings at the Local MindRoom page in a dialog when pressed', () => {
    const renderer = render();
    expect(dialogs(renderer)).toHaveLength(0);

    press(tabButton(renderer));

    expect(dialogs(renderer)).toHaveLength(1);
    expect(settings(renderer).props['data-settings']).toBe('mindroom.local-mindroom');
  });

  it('closes when the dialog or Settings asks, and opens anew on the next press', () => {
    const renderer = render();

    press(tabButton(renderer));
    const [dialog] = dialogs(renderer);
    if (!dialog) throw new Error('No dialog');
    press(dialog);
    expect(dialogs(renderer)).toHaveLength(0);

    press(tabButton(renderer));
    expect(dialogs(renderer)).toHaveLength(1);
    press(settings(renderer));
    expect(dialogs(renderer)).toHaveLength(0);

    press(tabButton(renderer));
    expect(settings(renderer).props['data-settings']).toBe('mindroom.local-mindroom');
  });

  it('names the button Local MindRoom in its tooltip', () => {
    const renderer = render();

    const tooltip = renderer.root.find(
      (node) => node.type === 'div' && node.props['data-tooltip'] !== undefined
    );

    expect(tooltip.props['data-tooltip']).toBe('Local MindRoom');
  });

  it('is an outlined rail button named by the logo, without a label of its own', () => {
    const renderer = render();

    const button = tabButton(renderer);
    const logo = button.find((node) => node.type === 'img');

    expect(button.props['aria-label']).toBeUndefined();
    expect(logo.props.alt).toBe('MindRoom');
  });
});
