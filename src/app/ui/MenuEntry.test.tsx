// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Icons } from 'folds';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuEntry } from './MenuEntry';

afterEach(cleanup);

describe('MenuEntry', () => {
  it('is a button without `href`', () => {
    render(<MenuEntry label="Sort" icon={Icons.Sort} onSelect={vi.fn()} />);
    expect(screen.getByText('Sort').closest('button')).not.toBeNull();
    expect(document.querySelector('a')).toBeNull();
  });

  it('is a link that opens in a new tab with `href`, and still runs onSelect', () => {
    const onSelect = vi.fn();
    render(
      <MenuEntry
        label="Download"
        icon={Icons.Download}
        href="https://example.org/MindRoom.dmg"
        onSelect={onSelect}
      />
    );
    const link = screen.getByText('Download').closest('a');
    expect(link?.getAttribute('href')).toBe('https://example.org/MindRoom.dmg');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(document.querySelector('button')).toBeNull();

    fireEvent.click(link as HTMLAnchorElement);

    expect(onSelect).toHaveBeenCalledOnce();
  });
});
