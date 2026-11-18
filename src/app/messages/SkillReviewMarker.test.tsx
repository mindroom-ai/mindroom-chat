// @vitest-environment jsdom
/* eslint-disable react/prop-types */
import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SkillReviewNotice } from '../matrix/protocol/skillReview';
import { SkillReviewMarker } from './SkillReviewMarker';

vi.mock('folds', () => ({
  Text: ({ as: Tag = 'span', children, size, priority, ...props }: any) =>
    React.createElement(Tag, props, children),
  Tooltip: ({ children, ...props }: any) =>
    React.createElement('div', { ...props, 'data-tooltip': true }, children),
  PopOut: ({ anchor, content, position, align, offset, ...props }: any) =>
    anchor ? React.createElement('div', { ...props, 'data-popout': true }, content) : null,
}));

vi.mock('@tabler/icons-react', () => ({
  IconNotebook: () => React.createElement('svg'),
}));

vi.mock('../rich-text/code/CodeBlockIcons', () => ({
  WrapTextIcon: () => React.createElement('svg'),
}));

vi.mock('../rich-text/CustomHtml.css', () => ({ CodeBlockAction: 'CodeBlockAction' }));

vi.mock('./SkillReviewMarker.css', () => ({
  Marker: 'Marker',
  MarkerTrigger: 'MarkerTrigger',
  Name: 'Name',
  Label: 'Label',
  Details: 'Details',
  Added: 'Added',
  Removed: 'Removed',
  Panel: 'Panel',
  FileHeader: 'FileHeader',
  FileName: 'FileName',
  Diff: 'Diff',
  DiffLine: 'DiffLine',
  DiffAdded: 'DiffAdded',
  DiffRemoved: 'DiffRemoved',
  DiffMeta: 'DiffMeta',
}));

const text = (value: ReactTestInstance | string): string =>
  typeof value === 'string' ? value : value.children.map(text).join('');

const updated: SkillReviewNotice = {
  changes: [{ skill: 'developing-mindroom-chat', action: 'updated' }],
  files: [
    {
      path: 'developing-mindroom-chat/SKILL.md',
      action: 'updated',
      added: 12,
      removed: 3,
      diff: '@@ -10,2 +10,2 @@\n context\n-old\n+new\n+\n',
      diffTruncated: false,
    },
  ],
};
const oldNotice: SkillReviewNotice = {
  changes: [
    { skill: 'a', action: 'created' },
    { skill: 'b', action: 'updated' },
  ],
  files: [],
};

const renderers: ReactTestRenderer[] = [];
const render = (review: SkillReviewNotice) => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<SkillReviewMarker review={review} />, {
      createNodeMock: () => ({
        getBoundingClientRect: () => ({ x: 10, y: 20, width: 100, height: 16 }),
        contains: () => false,
      }),
    });
  });
  renderers.push(renderer);
  return renderer;
};
const trigger = (renderer: ReactTestRenderer) =>
  renderer.root.findByProps({ className: 'MarkerTrigger' });
const tooltip = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.props['data-popout'] === true);
const panel = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.props['data-skill-review-diff'] === 'true');

afterEach(() => {
  act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
});

describe('SkillReviewMarker', () => {
  it('names the one skill a review updated or created', () => {
    const one = render(updated);
    expect(text(trigger(one))).toBe('Updated skill developing-mindroom-chat');
    expect(text(trigger(one).findByType('code'))).toBe('developing-mindroom-chat');

    const created = render({ changes: [{ skill: 'x', action: 'created' }], files: [] });
    expect(text(trigger(created))).toBe('Created skill x');
  });

  it('counts the skills when a review changed several', () => {
    expect(text(trigger(render(oldNotice)))).toBe('Updated 2 skills');
    const allCreated = oldNotice.changes.map((change) => ({
      ...change,
      action: 'created' as const,
    }));
    expect(text(trigger(render({ changes: allCreated, files: [] })))).toBe('Created 2 skills');
  });

  it('lists each file with its action and counts while a mouse hovers', async () => {
    const renderer = render(updated);
    expect(tooltip(renderer)).toHaveLength(0);

    await act(() => trigger(renderer).props.onPointerEnter({ pointerType: 'mouse' }));
    expect(text(tooltip(renderer)[0]!)).toBe('developing-mindroom-chat/SKILL.md updated +12 −3');

    await act(() => trigger(renderer).props.onPointerLeave({ pointerType: 'mouse' }));
    expect(tooltip(renderer)).toHaveLength(0);
  });

  it('lists the skills and their actions for a notice without files', async () => {
    const renderer = render(oldNotice);
    await act(() => trigger(renderer).props.onPointerEnter({ pointerType: 'mouse' }));
    expect(text(tooltip(renderer)[0]!)).toBe('a createdb updated');
  });

  it('toggles the diffs below the marker on a click, with tinted lines', async () => {
    const renderer = render(updated);
    expect(panel(renderer)).toHaveLength(0);
    expect(trigger(renderer).props['aria-expanded']).toBe(false);

    await act(() => trigger(renderer).props.onClick());
    const [diffs] = panel(renderer);
    expect(text(diffs!)).toContain('developing-mindroom-chat/SKILL.md');
    expect(text(diffs!)).toContain('+12 −3');
    const lineClasses = diffs!.findByProps({ className: 'Diff' }).children.map((line) => {
      const node = line as ReactTestInstance;
      return [node.props.className, text(node)];
    });
    expect(lineClasses).toEqual([
      ['DiffMeta', '@@ -10,2 +10,2 @@'],
      ['DiffLine', ' context'],
      ['DiffRemoved', '-old'],
      ['DiffAdded', '+new'],
      ['DiffAdded', '+'],
    ]);
    expect(trigger(renderer).props['aria-expanded']).toBe(true);
    expect(trigger(renderer).props['aria-controls']).toBe(diffs!.props.id);
    expect(text(diffs!)).not.toContain('Diff truncated');
    // Keyboard users can reach and scroll a long diff, which Safari does not allow by itself.
    const diff = diffs!.findByProps({ className: 'Diff' });
    expect(diff.props.tabIndex).toBe(0);
    expect(diff.props.role).toBe('region');
    expect(diff.props['aria-label']).toBe('Diff of developing-mindroom-chat/SKILL.md');

    await act(() => trigger(renderer).props.onClick());
    expect(panel(renderer)).toHaveLength(0);
  });

  it('wraps long diff lines until the reader turns wrapping off', async () => {
    const renderer = render(updated);
    await act(() => trigger(renderer).props.onClick());
    const [diffs] = panel(renderer);
    const diff = () => diffs!.findByProps({ className: 'Diff' });
    const wrap = diffs!.findByProps({ 'aria-label': 'Wrap lines' });
    expect(diff().props['data-wrap']).toBe(true);
    expect(wrap.props['aria-pressed']).toBe(true);

    await act(() => wrap.props.onClick());
    expect(diff().props['data-wrap']).toBe(false);
    expect(wrap.props['aria-pressed']).toBe(false);
  });

  it('says when a diff was truncated or left out', async () => {
    const { diff: _diff, ...noDiff } = updated.files[0]!;
    const renderer = render({ ...updated, files: [{ ...noDiff, diffTruncated: true }] });

    await act(() => trigger(renderer).props.onClick());
    const [diffs] = panel(renderer);
    expect(text(diffs!)).toContain('Diff truncated');
    expect(diffs!.findAllByProps({ className: 'Diff' })).toHaveLength(0);
  });

  it('shows the list instead of expanding on a tap when the notice has no files', async () => {
    const renderer = render(oldNotice);
    expect(trigger(renderer).props['aria-controls']).toBeUndefined();

    await act(() => trigger(renderer).props.onClick());
    expect(panel(renderer)).toHaveLength(0);
    expect(tooltip(renderer)).toHaveLength(1);
    expect(trigger(renderer).props['aria-expanded']).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(tooltip(renderer)).toHaveLength(0);
  });

  it('lets the pointer through its tooltip layer', async () => {
    const renderer = render(updated);
    await act(() => trigger(renderer).props.onPointerEnter({ pointerType: 'mouse' }));

    const [layer] = tooltip(renderer);
    expect(layer!.props.style).toEqual({ pointerEvents: 'none' });
    expect(layer!.findByProps({ 'data-tooltip': true }).props.role).toBe('tooltip');
  });

  it('describes the changes for screen readers', () => {
    const renderer = render(updated);
    const describedBy = trigger(renderer).props['aria-describedby'];
    const description = renderer.root.find((node) => node.props.id === describedBy);
    expect(text(description)).toBe('developing-mindroom-chat/SKILL.md updated +12 −3');
  });
});
