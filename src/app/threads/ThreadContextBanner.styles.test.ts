import type { StyleRule } from '@vanilla-extract/css';
import { expect, it, vi } from 'vitest';
import { PhoneRoomButton, PhoneStatus, PhoneTitle, SummaryText } from './ThreadContextBanner.css';

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

it("gives the room's name, which leads back, a finger's 44 px", () => {
  const [, , target] = rules.get(PhoneRoomButton) as StyleRule[];
  expect(JSON.stringify(target)).toContain('44px');
});
