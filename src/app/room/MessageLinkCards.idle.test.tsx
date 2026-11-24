// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegisteredPlugin } from '../plugins/registry';
import { CheckedMessageLink } from '../rich-text/CheckedMessageLink';
import { MessageLinkCards } from './MessageLinkCards';

vi.mock('react-i18next', async (importOriginal) => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { ...(await importOriginal<object>()), useTranslation: () => ({ t: translateFromEn }) };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const Card = () => null;
const pluginWith = (hoverCard?: () => null) =>
  ({
    id: 'p',
    tag: 'p@1.0.0',
    sidePanels: [],
    messageLinks: [{ match: () => true, Component: Card, hoverCard }],
  }) as unknown as RegisteredPlugin;

// With folds' real PopOut, which listens for the window's resize while it is mounted.
const listened = (plugin: RegisteredPlugin) => {
  const onWindow = vi.spyOn(window, 'addEventListener');
  const onDocument = vi.spyOn(document, 'addEventListener');
  render(
    <MessageLinkCards roomId="!a:x" plugins={[plugin]}>
      <CheckedMessageLink href="https://example.org/1">One</CheckedMessageLink>
    </MessageLinkCards>
  );
  return {
    window: onWindow.mock.calls.map(([type]) => type),
    // React listens for selectionchange; these are the hover cards'.
    document: onDocument.mock.calls
      .map(([type]) => type)
      .filter((type) => type !== 'selectionchange'),
    link: document.querySelector('a')?.getAttribute('data-message-link'),
  };
};

describe('MessageLinkCards at rest', () => {
  it('mounts no hover card surface and listens for no pointer without a hover card', () => {
    const idle = listened(pluginWith());
    expect(idle.window.filter((type) => type === 'resize')).toHaveLength(1);
    expect(idle.document).toEqual([]);
    expect(idle.link).toBeNull();
  });

  it('with a hover card, listens on its messages only, and mounts its surface only to show it', () => {
    const armed = listened(pluginWith(() => null));
    expect(armed.window.filter((type) => type === 'resize')).toHaveLength(1);
    expect(armed.document).toEqual(['pointermove', 'pointerout', 'focusin', 'focusout']);
    expect(armed.link).toBeTruthy();
  });
});
