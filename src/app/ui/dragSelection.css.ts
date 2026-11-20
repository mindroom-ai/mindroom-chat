import { globalStyle } from '@vanilla-extract/css';

// On the root while a drag runs: nothing selects, `.selectable` messages included.
export const DRAG_NO_SELECT = 'data-drag-no-select';
globalStyle(`:root[${DRAG_NO_SELECT}] *`, { userSelect: 'none', WebkitUserSelect: 'none' });
