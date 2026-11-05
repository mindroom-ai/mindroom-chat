// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdvancedFold } from './AdvancedFold';
import { SettingsTargetContext, type SettingsTarget } from './settingsTarget';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = (target: SettingsTarget | undefined) =>
  act(() =>
    root.render(
      <SettingsTargetContext.Provider value={target}>
        <AdvancedFold>
          <p>Message spacing</p>
        </AdvancedFold>
      </SettingsTargetContext.Provider>
    )
  );

const toggle = () => container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
const shown = () => container.textContent?.includes('Message spacing') ?? false;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AdvancedFold', () => {
  it('starts closed and opens with its button', () => {
    render(undefined);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(shown()).toBe(false);
    act(() => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(shown()).toBe(true);
  });

  it('opens for a search hit inside it, also on a page that is already open', () => {
    render({ id: 'messageSpacing', seq: 1 });
    expect(shown()).toBe(true);

    render(undefined);
    act(() => toggle().click());
    expect(shown()).toBe(false);
    render({ id: 'messageSpacing', seq: 2 });
    expect(shown()).toBe(true);
  });

  it('stays closed for a search hit outside it', () => {
    render({ id: 'pageZoom', seq: 1 });
    expect(shown()).toBe(false);
  });
});
