import { useVirtualizer } from '@tanstack/react-virtual';

export function useRoomFolderNavVirtualizer(count: number, scrollElement: HTMLDivElement | null) {
  return useVirtualizer({
    count,
    getScrollElement: () => scrollElement,
    estimateSize: () => 38,
    overscan: 10,
    enabled: scrollElement !== null,
  });
}
