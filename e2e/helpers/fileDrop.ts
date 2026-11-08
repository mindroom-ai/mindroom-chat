import type { Locator } from '@playwright/test';

/** Drags a file named `name` over `target` and drops it there, as the system's file manager would. */
export const dropFile = (target: Locator, name: string): Promise<void> =>
  target.evaluate((element, fileName) => {
    const data = new DataTransfer();
    data.items.add(new File(['dropped'], fileName, { type: 'text/plain' }));
    for (const type of ['dragenter', 'dragover', 'drop']) {
      element.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true })
      );
    }
  }, name);
