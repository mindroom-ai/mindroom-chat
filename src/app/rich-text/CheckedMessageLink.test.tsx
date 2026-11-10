// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckedMessageLink } from './CheckedMessageLink';
import { MessageLinkCardContext } from './messageLinkCards';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

afterEach(cleanup);

const renderLink = (
  show: ((link: HTMLAnchorElement, href: string) => boolean) | undefined,
  text = 'A link',
  href = 'https://good.example/pull/1',
  onParentClick?: () => void
) => {
  const parent = (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div onClick={onParentClick}>
      <CheckedMessageLink href={href}>{text}</CheckedMessageLink>
    </div>
  );
  render(<MessageLinkCardContext.Provider value={show}>{parent}</MessageLinkCardContext.Provider>);
  return screen.getByRole('link');
};

describe('CheckedMessageLink with a link card', () => {
  it('shows the card on a plain click and does not follow the link', () => {
    const show = vi.fn(() => true);
    const link = renderLink(show);
    expect(fireEvent.click(link)).toBe(false);
    expect(show).toHaveBeenCalledWith(link, 'https://good.example/pull/1');
  });

  it.each(['ctrlKey', 'metaKey', 'shiftKey', 'altKey'])('follows the link with %s', (modifier) => {
    const show = vi.fn(() => true);
    const link = renderLink(show);
    expect(fireEvent.click(link, { [modifier]: true })).toBe(true);
    expect(show).not.toHaveBeenCalled();
  });

  it('follows the link when no card takes it', () => {
    const show = vi.fn(() => false);
    const link = renderLink(show);
    expect(fireEvent.click(link)).toBe(true);
    expect(show).toHaveBeenCalledOnce();
  });

  it('asks first for a misleading link and opens it without a card', () => {
    const show = vi.fn(() => true);
    const link = renderLink(show, 'https://good.example', 'https://evil.example/');
    expect(fireEvent.click(link)).toBe(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(show).not.toHaveBeenCalled();
    const clicks: boolean[] = [];
    link.addEventListener('click', (evt) => clicks.push(evt.defaultPrevented));
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(clicks).toEqual([false]);
    expect(show).not.toHaveBeenCalled();
  });

  it('changes nothing without a provider', () => {
    const link = renderLink(undefined);
    expect(fireEvent.click(link)).toBe(true);
  });

  it('stops the click from reaching the thread card', () => {
    const parent = vi.fn();
    const link = renderLink(() => true, 'A link', 'https://good.example/pull/1', parent);
    fireEvent.click(link);
    expect(parent).not.toHaveBeenCalled();
  });
});
