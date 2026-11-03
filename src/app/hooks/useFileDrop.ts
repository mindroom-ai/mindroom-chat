import { RefObject, useEffect, useState } from 'react';
import { getDataTransferFiles } from '../utils/dom';

const hasFiles = (event: DragEvent): boolean =>
  !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');

/**
 * Makes the element a drop zone for files: `onDrop` receives the dropped files. Returns
 * whether files are being dragged over it, for a drop overlay.
 */
export const useFileDropZone = (
  zoneRef: RefObject<HTMLElement>,
  onDrop: (files: File[]) => void
): boolean => {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return undefined;
    let depth = 0;
    const handleEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setActive(true);
    };
    const handleOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const handleLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const handleDrop = (event: DragEvent) => {
      depth = 0;
      setActive(false);
      if (!event.dataTransfer || !hasFiles(event)) return;
      event.preventDefault();
      const files = getDataTransferFiles(event.dataTransfer);
      if (files && files.length > 0) onDrop(files);
    };
    zone.addEventListener('dragenter', handleEnter);
    zone.addEventListener('dragover', handleOver);
    zone.addEventListener('dragleave', handleLeave);
    zone.addEventListener('drop', handleDrop);
    return () => {
      zone.removeEventListener('dragenter', handleEnter);
      zone.removeEventListener('dragover', handleOver);
      zone.removeEventListener('dragleave', handleLeave);
      zone.removeEventListener('drop', handleDrop);
    };
  }, [zoneRef, onDrop]);

  return active;
};
