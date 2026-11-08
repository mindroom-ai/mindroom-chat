import { describe, expect, it, vi } from 'vitest';
import { Dialog, Header, IconButton, Menu } from '../app/ui/glass/GlassPrimitives';
import { PopOut } from '../app/ui/directional';
import { IconTooltip } from '../app/ui/IconTooltip';
import { MenuEntry, MenuGroup } from '../app/ui/MenuEntry';
import { NavButton, NavItem, NavItemContent } from '../app/ui/nav/NavItem';
import * as ui from './ui';

// The test setup stands folds' plain components in for the glass ones; compare the real modules.
vi.unmock('../app/ui/glass/GlassPrimitives');

describe('@mindroom/client-sdk/ui', () => {
  it("is the app's own components, not copies, so a plugin's menus, dialogs and rows look like the app's", () => {
    const app = {
      Dialog,
      Header,
      IconButton,
      IconTooltip,
      Menu,
      MenuEntry,
      MenuGroup,
      NavButton,
      NavItem,
      NavItemContent,
      PopOut,
    };
    // The SDK only grows: a name a plugin imports never goes.
    expect(Object.keys(ui).sort()).toEqual(Object.keys(app).sort());
    Object.entries(app).forEach(([name, component]) => {
      expect(ui[name as keyof typeof ui], name).toBe(component);
    });
  });
});
