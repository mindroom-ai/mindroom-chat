import React, { ReactNode, useCallback } from 'react';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { Header, Menu } from '../../glass/GlassPrimitives';
import { PageScroll } from '../../page';
import { useAlive } from '../../../hooks/useAlive';
import { preventScrollWithArrowKey, stopPropagation } from '../../../utils/keyboard';
import * as css from './AutocompleteMenu.css';




  children: ReactNode;
};

/**
 * Floating list of suggestions above the composer. Arrow keys move between the items (wrapping
 * at the ends), Escape or a click outside closes it.
 */
export function AutocompleteMenu({ requestClose, headerContent, children }: AutocompleteMenuProps) {
  const alive = useAlive();

  const handleDeactivate = useCallback(() => {
    if (alive()) requestClose();

























              scrollbarTabIndex={-1}
            >
              <div className={css.AutocompleteMenuItems}>{children}</div>
            </PageScroll>
          </Menu>
        </FocusTrap>
      </div>
    </div>
  );
}
