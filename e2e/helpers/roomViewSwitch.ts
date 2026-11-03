import type { Locator, Page } from '@playwright/test';

/**
 * The room header's Compact and Full switch. `aria-pressed` is true while the room shows
 * the Compact view; a click moves to Compact from any other mode, and from Compact to Classic.
 * Direct chats between people have no switch.
 */
export const roomViewSwitch = (page: Page): Locator => page.locator('[data-room-view-switch]');
