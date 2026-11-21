import { PureComponent, type RefObject } from 'react';
import { browserAnchorsScroll } from './useHeldThreadOrder';

type Props = { order: readonly string[]; viewRef: RefObject<HTMLElement> };

// The insertion position in the smallest possible tails gives the LIS length ending here.
const lisEndingAt = (indices: number[]): number[] => {
  const tails: number[] = [];
  return indices.map((index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (tails[mid]! < index) low = mid + 1;
      else high = mid;
    }
    tails[low] = index;
    return low + 1;
  });
};

/** Surviving rows in every longest subsequence that preserves old order. Row IDs are unique. */
export const rowsThatKeptPlace = (before: readonly string[], after: readonly string[]) => {
  const oldIndex = new Map(before.map((id, i) => [id, i]));
  const survivors = after.filter((id) => oldIndex.has(id));
  const indices = survivors.map((id) => oldIndex.get(id)!);
  const left = lisEndingAt(indices);
  // Reverse and negate the indices to get the LIS length starting at each row.
  const right = lisEndingAt(indices.map((index) => -index).reverse()).reverse();
  const longest = left.reduce((max, rank) => Math.max(max, rank), 0);
  const byRank = new Map<number, string | null>();
  // A row can be on a longest subsequence if its prefix and suffix reach that length.
  // Every longest subsequence takes one row per rank, so only a sole candidate is forced.
  survivors.forEach((id, i) => {
    const rank = left[i]!;
    if (rank + right[i]! - 1 === longest) byRank.set(rank, byRank.has(rank) ? null : id);
  });
  return new Set([...byRank.values()].filter((id) => id !== null));
};

export const medianResidual = (values: number[]): number => {
  values.sort((a, b) => a - b);
  const lower = values[Math.floor((values.length - 1) / 2)] ?? 0;
  const upper = values[Math.floor(values.length / 2)] ?? 0;
  return Math.max(lower, Math.min(0, upper));
};

const rowsOf = (view: HTMLElement) =>
  new Map(
    [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor], [data-row-landmark]')]
      .filter((row) => !row.closest('[inert]'))
      .map((row) => [row.dataset.scrollAnchor ?? row.dataset.rowLandmark ?? '', row] as const)
  );
const innerTop = (view: HTMLElement) => view.getBoundingClientRect().top + view.clientTop;
type Snapshot = { id: string; y: number }[];

export class CompactRowKeeper extends PureComponent<Props> {
  override getSnapshotBeforeUpdate(before: Props): Snapshot | null {
    const view = this.props.viewRef.current;
    const { order } = this.props;
    if (
      !view ||
      view.scrollTop <= 0 ||
      !browserAnchorsScroll() ||
      (order.length === before.order.length && order.every((id, i) => id === before.order[i]))
    )
      return null;
    const top = innerTop(view);
    const style = getComputedStyle(view);
    const start = top + (parseFloat(style.scrollPaddingTop) || 0);
    const end = top + view.clientHeight - (parseFloat(style.scrollPaddingBottom) || 0);
    const rows = rowsOf(view);
    const kept = rowsThatKeptPlace(before.order, order);
    const next = new Set(order);
    const visible: Snapshot = [];
    for (const id of before.order) {
      if (!next.has(id)) continue;
      const rect = rows.get(id)?.getBoundingClientRect();
      if (!rect || rect.bottom <= start || rect.top >= end) continue;
      const row = { id, y: rect.top - top };
      if (kept.has(id)) return [row];
      visible.push(row);
    }
    return visible;
  }

  override componentDidUpdate(_before: Props, _state: unknown, snapshot: Snapshot | null): void {
    const view = this.props.viewRef.current;
    if (!view || !snapshot?.length) return;
    const top = innerTop(view);
    const rows = rowsOf(view);
    const residual = medianResidual(
      snapshot.flatMap(({ id, y }) => {
        const rect = rows.get(id)?.getBoundingClientRect();
        return rect ? [rect.top - top - y] : [];
      })
    );
    const current = view.scrollTop;
    const target = Math.max(0, Math.min(view.scrollHeight - view.clientHeight, current + residual));
    if (Math.abs(residual) >= 0.5 && target !== current) view.scrollTop = target;
  }

  override render(): null {
    return null;
  }
}
