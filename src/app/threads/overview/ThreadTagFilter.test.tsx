// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TriState } from '../../event-store/threads/roomThreadOverviewModel';
import { ThreadTagFilter } from './ThreadTagFilter';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

afterEach(cleanup);

const TAGS = ['backend', 'bug', 'docs', 'frontend', 'urgent'];
const COUNTS = { backend: 2, bug: 5, frontend: 2, urgent: 9 };

const setup = (selected: Array<[string, TriState]> = []) => {
  const handlers = { onAdd: vi.fn(), onRemove: vi.fn(), onClear: vi.fn() };
  const view = (chosen: Array<[string, TriState]>) => (
    <ThreadTagFilter tags={TAGS} counts={COUNTS} selected={new Map(chosen)} {...handlers} />
  );
  const { container, rerender } = render(view(selected));
  const trigger = () => container.querySelector<HTMLButtonElement>('[data-tag-filter-button]')!;
  const panel = () => container.querySelector<HTMLElement>('[data-tag-filter-panel]');
  const search = () => container.querySelector<HTMLInputElement>('[data-tag-filter-search]')!;
  const option = (tag: string) =>
    container.querySelector<HTMLElement>(`[data-tag-option="${tag}"]`)!;
  const box = (tag: string) => within(option(tag)).getByRole<HTMLInputElement>('checkbox');
  const listed = () =>
    [...container.querySelectorAll<HTMLElement>('[data-tag-option]')].map(
      (row) => row.dataset.tagOption
    );
  return {
    ...handlers,
    trigger,
    panel,
    search,
    option,
    box,
    listed,
    open: () => fireEvent.click(trigger()),
    choose: (chosen: Array<[string, TriState]>) => rerender(view(chosen)),
  };
};

describe('the Tags dropdown', () => {
  it('opens to its search over every tag, most used first, with thread counts', () => {
    const tags = setup();
    expect(tags.trigger()).toHaveProperty('textContent', 'Tags');
    expect(tags.trigger().getAttribute('aria-label')).toBe('Filter threads by tags');
    expect(tags.trigger().getAttribute('aria-expanded')).toBe('false');
    expect(tags.panel()).toBeNull();

    tags.open();
    expect(tags.trigger().getAttribute('aria-expanded')).toBe('true');
    expect(tags.panel()?.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(tags.search());
    expect(tags.listed()).toEqual(['urgent', 'bug', 'backend', 'frontend', 'docs']);
    expect(tags.option('urgent').textContent).toBe('urgent9');
    // A tag no thread carries shows no count.
    expect(tags.option('docs').textContent).toBe('docs');
    expect(tags.box('docs').checked).toBe(false);
  });

  it('narrows the list as the search is typed, and says when nothing matches', () => {
    const tags = setup();
    tags.open();
    fireEvent.change(tags.search(), { target: { value: 'END' } });
    expect(tags.listed()).toEqual(['backend', 'frontend']);
    fireEvent.change(tags.search(), { target: { value: 'nothing' } });
    expect(tags.listed()).toEqual([]);
    expect(tags.panel()?.textContent).toContain('No tags match');
  });

  it('checks and unchecks tags, staying open for more choices', () => {
    const tags = setup([['bug', 'include']]);
    tags.open();
    expect(tags.box('bug').checked).toBe(true);
    fireEvent.click(tags.box('urgent'));
    expect(tags.onAdd).toHaveBeenCalledWith('urgent');
    fireEvent.click(tags.box('bug'));
    expect(tags.onRemove).toHaveBeenCalledWith('bug');
    expect(tags.panel()).not.toBeNull();
  });

  it('shows a tag the filter hides as checked and excluded; unchecking drops that filter', () => {
    const tags = setup([['docs', 'exclude']]);
    tags.open();
    expect(tags.box('docs').checked).toBe(true);
    expect(tags.option('docs').textContent).toContain('Excluded');
    expect(tags.option('bug').textContent).not.toContain('Excluded');
    fireEvent.click(tags.box('docs'));
    expect(tags.onRemove).toHaveBeenCalledWith('docs');
    expect(tags.onAdd).not.toHaveBeenCalled();
  });

  it('names the one chosen tag on its button, and counts two or more', () => {
    const tags = setup([['bug', 'include']]);
    expect(tags.trigger().textContent).toBe('bug');
    expect(tags.trigger().getAttribute('aria-label')).toBe('Filter threads by tags (1 selected)');
    expect(tags.trigger().dataset.tagFilterCount).toBe('1');

    tags.choose([
      ['bug', 'include'],
      ['urgent', 'include'],
    ]);
    expect(tags.trigger().textContent).toBe('Tags2');
    expect(tags.trigger().getAttribute('aria-label')).toBe('Filter threads by tags (2 selected)');

    // A lone excluded tag is counted rather than named, so the button never reads as keeping it.
    tags.choose([['bug', 'exclude']]);
    expect(tags.trigger().textContent).toBe('Tags1');
  });

  it('clears every chosen tag and keeps the search focused', () => {
    const tags = setup();
    tags.open();
    expect(tags.panel()?.querySelector('[data-tag-filter-clear]')).toBeNull();

    tags.choose([
      ['bug', 'include'],
      ['docs', 'exclude'],
    ]);
    // Clear also covers the chosen tags the search hides.
    fireEvent.change(tags.search(), { target: { value: 'front' } });
    const clear = tags.panel()?.querySelector<HTMLButtonElement>('[data-tag-filter-clear]');
    expect(clear?.textContent).toBe('Clear');
    clear?.focus();
    fireEvent.click(clear!);
    expect(tags.onClear).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(tags.search());
  });

  it('moves through the search and the tags with the arrow keys and toggles with Enter', () => {
    const tags = setup();
    tags.open();
    fireEvent.keyDown(tags.search(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tags.box('urgent'));
    fireEvent.keyDown(tags.box('urgent'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tags.box('bug'));
    fireEvent.keyDown(tags.box('bug'), { key: 'Enter' });
    expect(tags.onAdd).toHaveBeenCalledWith('bug');
    fireEvent.keyDown(tags.box('bug'), { key: 'ArrowUp' });
    fireEvent.keyDown(tags.box('urgent'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(tags.search());
    // Up from the search wraps to the last tag.
    fireEvent.keyDown(tags.search(), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(tags.box('docs'));
  });

  it('closes with Escape after clearing the search first, and hands the focus back', () => {
    const tags = setup();
    tags.open();
    fireEvent.change(tags.search(), { target: { value: 'bug' } });
    fireEvent.keyDown(tags.search(), { key: 'Escape' });
    expect(tags.search().value).toBe('');
    expect(tags.panel()).not.toBeNull();

    fireEvent.keyDown(tags.search(), { key: 'ArrowDown' });
    fireEvent.keyDown(tags.box('urgent'), { key: 'Escape' });
    expect(tags.panel()).toBeNull();
    expect(document.activeElement).toBe(tags.trigger());
  });

  it('closes when the focus leaves it, but not when a tag is pressed', () => {
    const tags = setup();
    tags.open();
    const list = tags.panel()!.querySelector<HTMLElement>('[data-tag-filter-list]')!;
    // A press on a tag keeps the focus where it is.
    expect(fireEvent.mouseDown(list)).toBe(false);
    fireEvent.blur(tags.search(), { relatedTarget: tags.box('bug') });
    expect(tags.panel()).not.toBeNull();
    fireEvent.blur(tags.search(), { relatedTarget: document.body });
    expect(tags.panel()).toBeNull();
  });

  it('has its own accessible name in the panel and on each tag', () => {
    const tags = setup();
    tags.open();
    expect(screen.getByRole('dialog', { name: 'Filter threads by tags' })).toBe(tags.panel());
    expect(screen.getByRole('searchbox', { name: 'Search tags' })).toBe(tags.search());
    expect(screen.getByRole('checkbox', { name: 'urgent' })).toBe(tags.box('urgent'));
  });
});
