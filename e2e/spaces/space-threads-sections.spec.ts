import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1100, height: 680 } });

const measureList = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-space-threads-list="true"]')!;
    const round = (n: number) => Math.round(n * 100) / 100;
    const rectOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: round(r.top), bottom: round(r.bottom), height: round(r.height) };
    };
    const elements = [
      ...scroller.querySelectorAll('[data-compact-section], [data-thread-root-id]'),
    ];
    const items = elements.map((el) => ({
      id: el.getAttribute('data-compact-section') ?? el.getAttribute('data-thread-root-id') ?? '',
      isCard: el.hasAttribute('data-thread-root-id'),
      ...rectOf(el),
    }));
    const rowParents = new Set(
      elements.map((el) =>
        el.hasAttribute('data-compact-section')
          ? el.parentElement
          : el.closest('[data-scroll-anchor]')?.parentElement
      )
    );
    const overlapCount = items.reduce(
      (count, item, i) => count + (i > 0 && items[i - 1]!.bottom > item.top + 1 ? 1 : 0),
      0
    );
    const adjacentCardGaps: number[] = [];
    for (let i = 1; i < items.length; i += 1) {
      const prev = items[i - 1]!;
      const curr = items[i]!;
      if (prev.isCard && curr.isCard) {
        adjacentCardGaps.push(round(curr.top - prev.bottom));
      }
    }
    const sections: Array<{
      id: string;
      header: { top: number; bottom: number; height: number };
      cardsSpan: { top: number; bottom: number; height: number } | null;
    }> = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!;
      if (item.isCard) continue;
      const sectionCards: Array<{ top: number; bottom: number; height: number }> = [];
      for (let j = i + 1; j < items.length && items[j]!.isCard; j += 1) {
        const card = items[j]!;
        sectionCards.push({ top: card.top, bottom: card.bottom, height: card.height });
      }
      const first = sectionCards[0];
      const last = sectionCards[sectionCards.length - 1];
      sections.push({
        id: item.id,
        header: { top: item.top, bottom: item.bottom, height: item.height },
        cardsSpan:
          first && last
            ? { top: first.top, bottom: last.bottom, height: round(last.bottom - first.top) }
            : null,
      });
    }
    const cards = items
      .filter((item) => item.isCard)
      .map(({ id, top, bottom, height }) => ({ id, top, bottom, height }));
    return {
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      scrollTop: scroller.scrollTop,
      scrollerRect: rectOf(scroller),
      uniqueParentCount: rowParents.size,
      overlapCount,
      adjacentCardGaps,
      sections,
      firstSixCards: cards.slice(0, 6),
      workingCards: cards.filter((c) => c.id.startsWith('$working-')),
      lastNeedsYouCard: cards.filter((c) => c.id.startsWith('$needs-')).at(-1) ?? null,
    };
  });

const scrollToBottom = (page: Page) =>
  page.locator('[data-space-threads-list="true"]').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

test('grouped sections stack flat with 4px card gap, zero overlap, and interactive card actions', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/space-threads-sections.html');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  const topMetrics = await measureList(page);

  const shotsDir = process.env.SPACE_THREADS_SECTIONS_SHOTS;
  if (shotsDir) {
    mkdirSync(shotsDir, { recursive: true });
    const tag = process.env.SHOTS_TAG ?? 'shot';
    await page.screenshot({ path: path.join(shotsDir, `${tag}-dark.png`) });
    writeFileSync(
      path.join(shotsDir, `${tag}-metrics.json`),
      JSON.stringify(
        {
          scrollHeight: topMetrics.scrollHeight,
          clientHeight: topMetrics.clientHeight,
          overlapCount: topMetrics.overlapCount,
          adjacentCardGaps: topMetrics.adjacentCardGaps,
          sections: topMetrics.sections,
          firstSixCards: topMetrics.firstSixCards,
        },
        null,
        2
      )
    );
    console.log(`[space-threads-sections:${tag}] overlapCount=${topMetrics.overlapCount}`);
  }

  expect(topMetrics.overlapCount).toBe(0);
  expect(topMetrics.uniqueParentCount).toBe(1);
  expect(topMetrics.adjacentCardGaps.length).toBeGreaterThan(0);
  for (const gap of topMetrics.adjacentCardGaps) {
    expect(gap).toBeCloseTo(4, 1);
  }
  expect(topMetrics.scrollHeight).toBeGreaterThan(topMetrics.clientHeight);
  const workingHeader = topMetrics.sections.find((s) => s.id === 'working')!.header;
  expect(topMetrics.lastNeedsYouCard!.bottom).toBeLessThanOrEqual(workingHeader.top + 1);

  const firstShell = page.locator('[data-scroll-anchor="$needs-1"]');
  await expect(firstShell.locator('[data-compact-thread-resolve="true"]')).toHaveCount(1);
  await expect(firstShell.locator('[data-compact-thread-pin="true"]')).toHaveCount(1);
  await expect(firstShell.locator('[data-compact-thread-more="true"]')).toHaveCount(1);

  await scrollToBottom(page);
  const bottomMetrics = await measureList(page);
  expect(bottomMetrics.overlapCount).toBe(0);
  expect(bottomMetrics.scrollTop).toBeGreaterThan(0);
  const quietHeader = bottomMetrics.sections.find((s) => s.id === 'quiet')!.header;
  for (const rect of [...bottomMetrics.workingCards, quietHeader]) {
    expect(rect.top).toBeGreaterThanOrEqual(bottomMetrics.scrollerRect.top - 1);
    expect(rect.bottom).toBeLessThanOrEqual(bottomMetrics.scrollerRect.bottom + 1);
  }
});

test('ungrouped flat mode uses 4px card gap and scrolls with zero overlapping cards', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/space-threads-sections.html?flat=1');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.locator('[data-compact-section]')).toHaveCount(0);
  await expect(page.locator('[data-thread-root-id]')).toHaveCount(32);

  const topMetrics = await measureList(page);
  expect(topMetrics.overlapCount).toBe(0);
  expect(topMetrics.uniqueParentCount).toBe(1);
  expect(topMetrics.adjacentCardGaps).toHaveLength(31);
  for (const gap of topMetrics.adjacentCardGaps) {
    expect(gap).toBeCloseTo(4, 1);
  }
  expect(topMetrics.scrollHeight).toBeGreaterThan(topMetrics.clientHeight);

  await scrollToBottom(page);
  const bottomMetrics = await measureList(page);
  expect(bottomMetrics.overlapCount).toBe(0);
  expect(bottomMetrics.scrollTop).toBeGreaterThan(0);
});
