import type { Page } from '@playwright/test';

/** What a finger can tap: the controls the scan measures, and the ones that end another's area. */
const CONTROLS = [
  'button',
  'a[href]',
  'summary',
  'select',
  'textarea',
  'input:not([type="hidden"])',
  '[contenteditable="true"]',
  ...[
    'button',
    'link',
    'tab',
    'switch',
    'checkbox',
    'radio',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'slider',
    'combobox',
  ].map((role) => `[role="${role}"]`),
].join(', ');

/** The smallest hit area a finger gets, as the platform guidelines put it. */
const TARGET = 44;

/** A control whose hit area is too short along one axis. */
export type HitAreaMiss = {
  control: string;
  axis: 'vertical' | 'horizontal';
  /** How far a tap still lands on the control along the line through its centre, in pixels. */
  span: number;
  /** How far it should reach: 43 (a 44 px area), or less where a neighbour or an edge is closer. */
  needed: number;
  /** How far each side reaches from the centre, and what ends it. */
  sides: string;
  /** The control's box: left, top, width, height. */
  box: number[];
};

/**
 * Measures the hit area of every visible control on the page, as a tap hit-tests it
 * (`elementFromPoint`), along the lines through each control's centre. Along each axis the area
 * must reach 22 px from the centre on both sides (a 44 px area, checked 1 px inside its ends,
 * because hit testing rounds), or, where another control stands closer, the middle of the gap to
 * it, on both sides alike, as `touchTarget` lays it out. The screen edge, a list's end (where its
 * content scrolls away) and chrome drawn over a list (a glass header, the composer) bound a side
 * the same way. Each side must also cover the control's own box, so no neighbour's area takes a
 * point the control shows. Controls of 44 by 44 px or more, disabled controls, links inside text
 * (WCAG's inline exception) and the opener of a card that opens on a tap anywhere on it are left
 * out.
 */
export const measureHitAreas = (page: Page): Promise<{ checked: number; misses: HitAreaMiss[] }> =>
  page.evaluate(
    ({ controls, target }) => {
      type Stop = { kind: 'self' | 'other' | 'edge' | 'none'; what: string };
      type Scroller = { node: Element; x: boolean; y: boolean; rect: DOMRect };
      const inner = target / 2 - 1;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const ownerOf = (node: Element | null) => node?.closest(controls) ?? null;
      const describe = (element: Element) => {
        const text =
          element.getAttribute('aria-label') ??
          element.getAttribute('title') ??
          element.textContent ??
          '';
        const role = element.getAttribute('role') ?? element.tagName.toLowerCase();
        return `${role} "${text.trim().replace(/\s+/g, ' ').slice(0, 48)}"`;
      };
      /** The nearest ancestor whose content scrolls, and along which axes. */
      const scrollerOf = (element: Element): Scroller | null => {
        for (
          let node = element.parentElement;
          node && node !== document.body && node !== document.documentElement;
          node = node.parentElement
        ) {
          const style = getComputedStyle(node);
          const y =
            /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
          const x = /auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
          if (x || y) return { node, x, y, rect: node.getBoundingClientRect() };
        }
        return null;
      };
      const classify = (
        control: Element,
        scroller: Scroller | null,
        x: number,
        y: number
      ): Stop => {
        if (x < 0 || y < 0 || x >= width || y >= height)
          return { kind: 'edge', what: 'the screen edge' };
        const top = document.elementFromPoint(x, y);
        const owner = ownerOf(top);
        if (owner === control) return { kind: 'self', what: '' };
        if (scroller && top && !scroller.node.contains(top)) {
          const { rect } = scroller;
          const outsideY = y < rect.top || y >= rect.bottom;
          const outsideX = x < rect.left || x >= rect.right;
          // Chrome drawn over the list, such as a glass header or the composer.
          if (!outsideY && !outsideX)
            return { kind: 'edge', what: `${describe(top)} over its list` };
          // The end of the list, where its content scrolls away.
          if ((outsideY && scroller.y) || (outsideX && scroller.x))
            return { kind: 'edge', what: 'the end of its list' };
        }
        // A control around this one (a clickable card) is content its area may cover.
        if (owner && !owner.contains(control)) return { kind: 'other', what: describe(owner) };
        return { kind: 'none', what: '' };
      };

      const misses: HitAreaMiss[] = [];
      let checked = 0;
      document.querySelectorAll(controls).forEach((control) => {
        if (control.closest('[aria-hidden="true"], [inert]')) return;
        if (control.matches(':disabled, [aria-disabled="true"]')) return;
        // A card that opens on a tap anywhere is its opener's target (the lobby on a phone).
        if (control.matches('[data-opens-by-card] [data-card-opener]')) return;
        const style = getComputedStyle(control);
        if (style.display === 'inline' || style.visibility !== 'visible') return;
        const rect = control.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) return;
        // Covered by something else, or not hit-testable at all.
        if (ownerOf(document.elementFromPoint(cx, cy)) !== control) return;
        checked += 1;
        if (rect.width >= target && rect.height >= target) return;
        const scroller = scrollerOf(control);
        /** How far one side reaches, and how far it may: to a neighbour's middle or an edge. */
        const side = (dx: number, dy: number, own: number) => {
          const at = (distance: number) =>
            classify(control, scroller, cx + dx * distance, cy + dy * distance);
          let reach = 0;
          while (reach < target && at(reach + 1).kind === 'self') reach += 1;
          let limit = target;
          let ends = `${reach}`;
          for (let distance = reach + 1; distance <= target; distance += 1) {
            const found = at(distance);
            if (found.kind === 'other' || found.kind === 'edge') {
              limit = found.kind === 'edge' ? distance - 1 : Math.ceil((own + distance) / 2) - 1;
              ends = `${reach} (${found.what} at ${distance})`;
              break;
            }
          }
          return { reach, limit, ends, covers: reach >= Math.min(limit, Math.floor(own) - 1) };
        };
        const axes = [
          ['vertical', side(0, -1, rect.height / 2), side(0, 1, rect.height / 2)],
          ['horizontal', side(-1, 0, rect.width / 2), side(1, 0, rect.width / 2)],
        ] as const;
        axes.forEach(([axis, start, end]) => {
          const needed = Math.min(inner, start.limit, end.limit);
          // 1 px of slack: a box's far edge is exclusive, so a centred area can come out 1 px short.
          const enough = (reach: number) => reach + 1 >= needed;
          if (enough(start.reach) && enough(end.reach) && start.covers && end.covers) return;
          misses.push({
            control: describe(control),
            axis,
            span: start.reach + end.reach + 1,
            needed: 2 * needed + 1,
            sides: `${axis === 'vertical' ? 'top' : 'left'} ${start.ends}, ${
              axis === 'vertical' ? 'bottom' : 'right'
            } ${end.ends}`,
            box: [rect.left, rect.top, rect.width, rect.height].map(Math.round),
          });
        });
      });
      return { checked, misses };
    },
    { controls: CONTROLS, target: TARGET }
  );
