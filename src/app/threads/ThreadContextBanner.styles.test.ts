import type { StyleRule } from '@vanilla-extract/css';
import { expect, it, vi } from 'vitest';
import {
  PhoneMore,
  PhoneRoomButton,
  PhoneRow,
  PhoneStatus,
  PhoneTitle,
  PhoneTitleRow,
  SummaryText,
} from './ThreadContextBanner.css';

const rules = vi.hoisted(() => new Map<string, unknown>());
// Capture the declarations given to the CSS compiler.
vi.mock('@vanilla-extract/css', () => ({
  style: (rule: StyleRule | StyleRule[]) => {
    const name = `style-${rules.size}`;
    rules.set(name, rule);
    return name;
  },
  keyframes: () => 'keyframes',
}));
vi.mock('../ui/styles/Glass.css', () => ({
  glassSurface: () => 'glass',
  glassFloating: 'floating',
  glassDenseOverBackdrop: 'dense',
}));
vi.mock('../messages/styles.css', () => ({ toolbarButtonRestFill: '--rest-fill' }));
vi.mock('../ui/styles/roomArea.css', () => ({ roomArea: 'area', shortRoomArea: 'area (short)' }));

it("wraps a phone header's title onto as many lines as it needs, cutting none", () => {
  const title = rules.get(PhoneTitle) as Record<string, unknown>;
  expect(title).toMatchObject({ whiteSpace: 'normal', overflowWrap: 'anywhere', minWidth: 0 });
  // No ellipsis, no clipped overflow and no line clamp, which the card's one line has.
  ['overflow', 'textOverflow', 'maxHeight', 'WebkitLineClamp', 'lineClamp'].forEach((cut) =>
    expect(title).not.toHaveProperty(cut)
  );
  expect(rules.get(SummaryText)).toMatchObject({ whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
});

it("takes no room for a phone header's status row while nothing is set on the thread", () => {
  expect(rules.get(PhoneStatus)).toMatchObject({
    selectors: { '&:empty': { display: 'none' } },
  });
});

it("gives the room's name, which leads back, a finger's 44 px and all of its cell", () => {
  const [, button, target] = rules.get(PhoneRoomButton) as StyleRule[];
  expect(JSON.stringify(target)).toContain('44px');
  expect(button).toMatchObject({ flex: '1 1 0', minWidth: 0 });
  expect(button).not.toHaveProperty('maxWidth');
});

it("bounds a phone header's title block, which scrolls in itself, and keeps one line under a keyboard", () => {
  const block = rules.get(PhoneTitleRow) as Record<string, unknown>;
  expect(block).toMatchObject({
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    flexShrink: 0,
    '@container': { 'area (short)': { maxBlockSize: expect.any(String) } },
  });
  // At least three lines, else 38% of the room area's height.
  expect(block.maxBlockSize).toMatch(/^max\(calc\(3 \* .+\), 38cqh\)$/);
  // What is set on the thread gives its row away there too.
  expect(rules.get(PhoneStatus)).toMatchObject({
    '@container': { 'area (short)': { display: 'none' } },
  });
});

it('makes More 40 px, and closes the gaps of a row in a room area as narrow as 150% zoom leaves', () => {
  expect(rules.get(PhoneMore)).toEqual({
    selectors: { '&&&': { inlineSize: '2.5rem', blockSize: '2.5rem' } },
  });
  expect(rules.get(PhoneRow)).toMatchObject({
    '@container': {
      'area (short)': { height: '2.75rem' },
      'area (max-width: 280px)': { gap: 0, paddingInline: 0 },
    },
  });
});
