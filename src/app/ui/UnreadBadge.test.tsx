// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { Badge } from 'folds';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { standInForListMotion } from './__tests__/listMotionStandIn';
import { UnreadBadge } from './UnreadBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

let motion: ReturnType<typeof standInForListMotion>;

beforeEach(() => {
  motion = standInForListMotion();
});

afterEach(() => {
  cleanup();
  motion.restore();
});

describe('UnreadBadge', () => {
  it('pops when its count grows while it shows', () => {
    const { rerender } = render(<UnreadBadge count={2} />);
    expect(motion.plays).toEqual([]);

    rerender(<UnreadBadge count={3} />);

    expect(motion.plays.map(({ element }) => element.textContent)).toEqual(['3']);
    expect(motion.plays[0]?.keyframes).toEqual([{ scale: 1 }, { scale: 1.25 }, { scale: 1 }]);
  });

  it('pops when a dot for unread activity gets its first count', () => {
    const { rerender } = render(<UnreadBadge count={0} />);
    rerender(<UnreadBadge count={1} />);

    expect(motion.plays).toHaveLength(1);
  });

  it('stays still when its count shrinks or stays', () => {
    const { rerender } = render(<UnreadBadge count={3} />);
    rerender(<UnreadBadge count={3} highlight />);
    rerender(<UnreadBadge count={1} />);

    expect(motion.plays).toEqual([]);
  });

  it('marks plain unread in the accent, quieter than a mention', () => {
    const reference = (fill: 'Soft' | 'Solid', outlined: boolean) =>
      render(<Badge variant="Primary" fill={fill} outlined={outlined} radii="Pill" size="400" />)
        .container.firstElementChild?.className;
    const paleAccent = reference('Soft', true);
    const solidAccent = reference('Solid', false);
    const plain = render(<UnreadBadge count={2} />).container.firstElementChild;
    const mention = render(<UnreadBadge count={2} highlight />).container.firstElementChild;

    expect(plain?.className).toBe(paleAccent);
    expect(mention?.className).toBe(solidAccent);
  });

  it('draws a mention dot larger than a plain unread dot', () => {
    const plain = render(<UnreadBadge count={0} />).container.firstElementChild as HTMLElement;
    const mention = render(<UnreadBadge count={0} highlight />).container
      .firstElementChild as HTMLElement;

    expect(plain.className).toBe(mention.className);
    expect(parseFloat(plain.style.height)).toBeLessThan(parseFloat(mention.style.height));
  });
});
