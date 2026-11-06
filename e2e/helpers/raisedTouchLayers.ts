import type { Page } from '@playwright/test';

/** Raised message targets must also avoid controls in the chrome above the timeline. */
export const raisedTouchConflicts = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a[href], summary, input, select, textarea, [role="button"], [contenteditable="true"]'
      )
    ).filter((element) => {
      if (element.closest('[aria-hidden="true"], [inert]')) return false;
      const box = element.getBoundingClientRect();
      return (
        box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight &&
        getComputedStyle(element).visibility === 'visible'
      );
    });
    const describe = (element: HTMLElement) =>
      element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 70);
    const conflicts: string[] = [];
    controls.forEach((control) => {
      if (!(Number(getComputedStyle(control).zIndex) >= 1)) return;
      for (const pseudo of ['::before', '::after']) {
        const css = getComputedStyle(control, pseudo);
        if (css.content !== '""' || css.position !== 'absolute' || css.pointerEvents === 'none') continue;
        const box = control.getBoundingClientRect();
        const left = box.left + control.clientLeft + parseFloat(css.left);
        const top = box.top + control.clientTop + parseFloat(css.top);
        const right = left + parseFloat(css.width);
        const bottom = top + parseFloat(css.height);
        controls.forEach((other) => {
          if (other === control || other.contains(control) || control.contains(other)) return;
          const neighbor = other.getBoundingClientRect();
          if (
            Math.min(right, neighbor.right) - Math.max(left, neighbor.left) > 0.5 &&
            Math.min(bottom, neighbor.bottom) - Math.max(top, neighbor.top) > 0.5
          ) conflicts.push(`${describe(control)} overlaps ${describe(other)}`);
        });
      }
    });
    return conflicts;
  });
