import React, {
  PropsWithChildren,
  ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
} from 'react';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { Header, Menu } from '../../ui/glass/GlassPrimitives';
import { MenuRoleProvider } from '../../ui/glass/menuBehaviour';
import { PageScroll } from '../../ui/page/PageScroll';
import { useAlive } from '../../lib/hooks/useAlive';
import { preventScrollWithArrowKey, stopPropagation } from '../../lib/keyboard';
import * as css from './AutocompleteMenu.css';

type AutocompleteMenuProps = PropsWithChildren<{
  /** Closes the menu: Escape, a click outside, or after an item was picked. */
  requestClose: () => void;
  headerContent: ReactNode;
}>;

const keepTextBoxFocus = (event: React.MouseEvent) => event.preventDefault();

type TrapOptions = NonNullable<React.ComponentProps<typeof FocusTrap>['focusTrapOptions']>;

// Arrow keys step through the items like Tab does; the trap wraps at both ends.
const isArrowDown = (evt: KeyboardEvent) => isHotkey('arrowdown', evt);
const isArrowUp = (evt: KeyboardEvent) => isHotkey('arrowup', evt);

/** The index of the option that holds `node` in `listbox`, or undefined. */
const optionIndex = (listbox: HTMLElement, node: EventTarget | null): number | undefined => {
  if (!(node instanceof Node)) return undefined;
  const index = Array.from(listbox.querySelectorAll('[role="option"]')).findIndex((option) =>
    option.contains(node)
  );
  return index < 0 ? undefined : index;
};

/**
 * Floating list of suggestions above the composer. Arrow keys move between the items (wrapping
 * at the ends), Escape or a click outside closes it.
 *
 * It is a listbox: its rows are options, and the row Enter or Tab would pick is selected and
 * shows so. While the caret stays in the composer that is the first row, which the composer
 * names as its active descendant; once a row has focus, it is that row.
 */
export function AutocompleteMenu({ requestClose, headerContent, children }: AutocompleteMenuProps) {
  const alive = useAlive();
  const headingId = useId();
  const listboxId = useId();
  const listboxRef = useRef<HTMLDivElement>(null);
  const [focusedRow, setFocusedRow] = useState<number>();

  // After every render, as the rows change with each letter typed.
  useLayoutEffect(() => {
    const listbox = listboxRef.current;
    if (!listbox) return undefined;
    const options = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
    const active = focusedRow !== undefined && focusedRow < options.length ? focusedRow : 0;
    options.forEach((option, index) => {
      if (!option.id) option.id = `${listboxId}-${index}`;
      option.setAttribute('aria-selected', String(index === active));
    });
    const composer = document.activeElement;
    if (!(composer instanceof HTMLElement) || !composer.isContentEditable) return undefined;
    if (listbox.contains(composer)) return undefined;
    composer.setAttribute('aria-controls', listboxId);
    composer.setAttribute('aria-activedescendant', options[active]?.id ?? '');
    return () => {
      composer.removeAttribute('aria-controls');
      composer.removeAttribute('aria-activedescendant');
    };
  });
  const trackFocus = (event: FocusEvent<HTMLDivElement>) =>
    setFocusedRow(optionIndex(event.currentTarget, event.target));
  const untrackFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (optionIndex(event.currentTarget, event.relatedTarget) === undefined) {
      setFocusedRow(undefined);
    }
  };
  const closeIfMounted = useCallback(() => {
    if (alive()) requestClose();
  }, [alive, requestClose]);

  const trapOptions: TrapOptions = {
    // A click in the composer closes the menu without stealing the caret from the text box.
    clickOutsideDeactivates: true,
    escapeDeactivates: stopPropagation,
    returnFocusOnDeactivate: false,
    initialFocus: false,
    isKeyForward: isArrowDown,
    isKeyBackward: isArrowUp,
    onPostDeactivate: closeIfMounted,
  };
  const heading = (
    <Header id={headingId} size="400" className={css.AutocompleteMenuHeader}>
      {headerContent}
    </Header>
  );
  const menu = (
    <FocusTrap focusTrapOptions={trapOptions}>
      <Menu role="none" className={css.AutocompleteMenu}>
        <PageScroll header={heading} onKeyDown={preventScrollWithArrowKey} scrollbarTabIndex={-1}>
          <MenuRoleProvider value="listbox">
            <div
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-labelledby={headingId}
              className={css.AutocompleteMenuItems}
              onFocus={trackFocus}
              onBlur={untrackFocus}
            >
              {children}
            </div>
          </MenuRoleProvider>
        </PageScroll>
      </Menu>
    </FocusTrap>
  );

  return (
    // A press on a suggestion leaves the focus, and with it the caret, in the text box: a tap would
    // otherwise move the focus to the suggestion, and the caret could come back at the start.
    <div className={css.AutocompleteMenuBase} onMouseDown={keepTextBoxFocus}>
      <div className={css.AutocompleteMenuContainer}>{menu}</div>
    </div>
  );
}
