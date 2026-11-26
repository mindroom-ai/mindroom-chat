import { useLayoutEffect, useMemo, useState } from 'react';
import { tabbablesOf } from '../../lib/overlayFocus';
import { compactCardNavigation, findCompactCard, focusCompactCard } from './compactCardKeys';
import { useCompactBlocks } from './useCompactBlocks';

export function useVirtualCompactList({
  keyScope,
  ...options
}: Parameters<typeof useCompactBlocks>[0] & { keyScope?: string }) {
  const { groups, scrollRef, contentRef, memory, roomId, target, getRowId } = options;
  const scope = keyScope ?? roomId;
  const ids = useMemo(() => Object.values(groups).flat(), [groups]);
  const idOf = useMemo(
    () =>
      getRowId
        ? (card: HTMLElement) =>
            getRowId(card.closest('[data-scroll-anchor]') ?? card) ?? card.dataset.threadRootId
        : undefined,
    [getRowId]
  );
  const [intent, setIntent] = useState<{
    id: string;
    scope: string;
    from: Element | null;
    last?: boolean;
    at: readonly [number, number];
  }>();
  const pending = intent?.scope === scope && ids.includes(intent.id) ? intent : undefined;
  const blocks = useCompactBlocks({ ...options, target: target ?? pending?.id });

  useLayoutEffect(() => {
    const view = scrollRef.current;
    if (!view || typeof document === 'undefined') return undefined;
    const card = (id: string, last?: boolean) => {
      const button = findCompactCard(view, id);
      const shell = last && button?.closest('[data-scroll-anchor]');
      return (shell && tabbablesOf(shell).at(-1)) || button;
    };
    const at = () => [view.scrollTop, blocks.progress.input] as const;
    const focus = (id: string | undefined, last?: boolean) => {
      if (!id) return false;
      if (focusCompactCard(card(id, last))) setIntent(undefined);
      else {
        if (!document.activeElement || document.activeElement === document.body)
          view.focus({ preventScroll: true });
        setIntent({ id, scope, from: document.activeElement, last, at: at() });
      }
      return true;
    };
    compactCardNavigation.set(view, { ids, idOf, focus });
    const active = document.activeElement;
    const left = pending && at().every((now, i) => now !== pending.at[i]);
    if (intent && (!pending || left || (active !== pending.from && active !== document.body)))
      setIntent(undefined);
    else if (pending && !target && blocks.targetReady) {
      focusCompactCard(card(pending.id, pending.last));
      blocks.progress.onWrite?.();
      setIntent(undefined);
    }
    return () => void compactCardNavigation.delete(view);
  }, [blocks.progress, blocks.targetReady, idOf, ids, intent, pending, scope, scrollRef, target]);

  const scrollAnchorProps = {
    memory,
    memoryKey: roomId,
    scrollRef,
    contentRef,
    progress: blocks.progress,
    getRowId,
  };
  return { ids, scrollAnchorProps, ...blocks };
}
