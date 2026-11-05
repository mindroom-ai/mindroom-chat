import { useCallback } from 'react';
import { selectFile } from '../dom';

/**
 * A function that opens the system file picker and hands the chosen file (or files, with
 * `multiple`) to `onSelect`. Nothing happens when the picker is dismissed.
 */
export function useFilePicker(
  onSelect: (file: File) => void,
  multiple?: false,
  accept?: string
): () => void;
export function useFilePicker(
  onSelect: (files: File[]) => void,
  multiple: true,
  accept?: string
): () => void;
export function useFilePicker(
  onSelect: ((file: File) => void) | ((files: File[]) => void),
  multiple = false,
  accept = '*'
): () => void {
  return useCallback(() => {
    if (multiple) {
      void selectFile(accept, true).then((files) => {
        if (files.length > 0) (onSelect as (files: File[]) => void)(files);
      });
      return;
    }
    void selectFile(accept).then((file) => {
      if (file) (onSelect as (file: File) => void)(file);
    });
  }, [onSelect, multiple, accept]);
}
