import { PureComponent, type RefObject } from 'react';
import { browserAnchorsScroll } from './useHeldThreadOrder';

type Inputs = ReadonlyMap<string, string>;
type Props = { scope: string; order: string[]; inputs: Inputs; viewRef: RefObject<HTMLElement> };
type Edge = { id: string; after: string; bottom?: true };

export const chooseLandmark = (visible: string[], before: Props, after: Props): Edge[] => {
  const previous = new Set(before.order);
  const next = new Set(after.order);
  const survivors = visible.filter((id) => next.has(id));
  const lead = visible[0];
  if (lead && next.has(lead)) {
    const oldSlots = before.order.filter((id) => next.has(id));
    const newSlots = after.order.filter((id) => previous.has(id));
    const slot = oldSlots.indexOf(lead);
    const second = oldSlots[slot + 1];
    if (second && newSlots[slot] === second && newSlots[slot + 1] === lead)
      return [{ id: second, after: lead, bottom: true }];
  }
  const unchanged = survivors.find(
    (id) =>
      id.startsWith('section:') ||
      (before.inputs.has(id) && before.inputs.get(id) === after.inputs.get(id))
  );
  return (unchanged ? [unchanged] : survivors).map((id) => ({ id, after: id }));
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
type Snapshot = { after: string; bottom?: true; y: number }[];

export class CompactRowKeeper extends PureComponent<Props> {
  override getSnapshotBeforeUpdate(before: Props): Snapshot | null {
    const view = this.props.viewRef.current;
    const { order, scope } = this.props;
    if (
      !view ||
      view.scrollTop <= 0 ||
      !browserAnchorsScroll() ||
      scope !== before.scope ||
      (order.length === before.order.length && order.every((id, i) => id === before.order[i]))
    )
      return null;
    const top = innerTop(view);
    const style = getComputedStyle(view);
    const start = top + (parseFloat(style.scrollPaddingTop) || 0);
    const end = top + view.clientHeight - (parseFloat(style.scrollPaddingBottom) || 0);
    const rows = rowsOf(view);
    const visible = before.order.filter((id) => {
      const rect = rows.get(id)?.getBoundingClientRect();
      return rect && rect.bottom > start && rect.top < end;
    });
    return chooseLandmark(visible, before, this.props).flatMap(({ id, after, bottom }) => {
      const rect = rows.get(id)?.getBoundingClientRect();
      return rect ? [{ after, bottom, y: (bottom ? rect.bottom : rect.top) - top }] : [];
    });
  }

  override componentDidUpdate(_before: Props, _state: unknown, snapshot: Snapshot | null): void {
    const view = this.props.viewRef.current;
    if (!view || !snapshot?.length) return;
    const top = innerTop(view);
    const rows = rowsOf(view);
    const residual = medianResidual(
      snapshot.flatMap(({ after, bottom, y }) => {
        const rect = rows.get(after)?.getBoundingClientRect();
        return rect ? [(bottom ? rect.bottom : rect.top) - top - y] : [];
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
