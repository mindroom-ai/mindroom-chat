import type { Locator, Page } from '@playwright/test';

/**
 * The room header's Compact and Threads switch. `aria-pressed` is true while the room shows
 * the Compact view; a click moves to Compact from any other mode, and from Compact to Threads.
 * Direct chats between people have no switch.
 */
export const roomViewSwitch = (page: Page): Locator => page.locator('[data-room-view-switch]');
