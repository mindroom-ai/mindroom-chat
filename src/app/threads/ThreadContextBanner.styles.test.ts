import type { StyleRule } from '@vanilla-extract/css';
import { expect, it, vi } from 'vitest';
import {
  PhoneActions,
  PhoneButton,
  PhoneHeader,
  PhoneRoom,
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

// The phone header's two thresholds on the room area: under a keyboard, and at 150% Page Zoom.
const SHORT = 'area (max-height: 15rem)';
const NARROW = 'area (max-width: 17.5rem)';

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
    // The bound counts the lines alone; the room for the rename field's ring is beside it.
    boxSizing: 'content-box',
    '@container': { [SHORT]: { maxBlockSize: expect.any(String) } },
  });
  // At least three lines, else 38% of the room area's height.
  expect(block.maxBlockSize).toMatch(/^max\(calc\(3 \* .+\), 38cqh\)$/);
  // What is set on the thread gives its row away there too.
  expect(rules.get(PhoneStatus)).toMatchObject({
    '@container': { [SHORT]: { display: 'none' } },
  });
});

it('makes Resolve and More 40 px, and 32 px in a narrow room area, whose row closes its gaps', () => {
  const square = (size: string) => ({
    selectors: { '&&&': { inlineSize: size, blockSize: size } },
  });
  expect(rules.get(PhoneButton)).toEqual({
    ...square('2.5rem'),
    '@container': { [NARROW]: square('2rem') },
  });
  // The name gives all its width away there, and shows no cut letter.
  expect(rules.get(PhoneRoom)).toMatchObject({ minWidth: 0, overflowX: 'clip' });
  expect(rules.get(PhoneRow)).toMatchObject({
    '@container': { [SHORT]: { height: '2.75rem' }, [NARROW]: { gap: 0 } },
  });
  expect(rules.get(PhoneActions)).toEqual({
    '@container': { [NARROW]: { selectors: { '&&': { gap: 0 } } } },
  });
});

it("asks the room area in rem, which Page Zoom scales with the header's buttons, never in px", () => {
  const queries = [PhoneHeader, PhoneRow, PhoneActions, PhoneButton, PhoneTitleRow, PhoneStatus]
    .flatMap((name) => Object.keys((rules.get(name) as StyleRule)['@container'] ?? {}))
    .filter((query, index, all) => all.indexOf(query) === index);
  expect(queries.sort()).toEqual([SHORT, NARROW].sort());
  queries.forEach((query) => expect(query).not.toMatch(/\dpx/));
});
