// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingScopeLabel } from './SettingScopeLabel';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const labelOf = (id: string) => {
  act(() => root.render(<SettingScopeLabel id={id} />));
  const label = container.querySelector('[data-setting-scope]');
  return { scope: label?.getAttribute('data-setting-scope'), text: label?.textContent };
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SettingScopeLabel', () => {
  it.each([
    // Stored in this browser's `settings` entry.
    ['hour24Clock', 'device', 'This device'],
    // Stored in the `io.mindroom.settings` account data.
    ['sidebarThreads', 'account', 'Your account (all devices)'],
    // Stored in each room's own account data.
    ['archivedRooms', 'room-personal', 'This room, for you'],
    // Image packs in the server emoji room's state.
    ['serverEmoji', 'room-shared', 'Everyone in the room'],
  ])('labels %s with where it is stored', (id, scope, text) => {
    expect(labelOf(id)).toEqual({ scope, text });
  });

  it('shows nothing for an id the registry does not know', () => {
    expect(labelOf('noSuchSetting')).toEqual({ scope: undefined, text: undefined });
  });
});
