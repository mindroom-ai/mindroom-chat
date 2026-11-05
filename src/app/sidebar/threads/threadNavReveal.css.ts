import { globalStyle } from '@vanilla-extract/css';
import { rowControlsHidden, rowControlsShown } from '../../ui/nav/NavItem.css';
import { Entry, EntryActions } from './threadNav.css';

// A thread row's pin and resolve buttons come and go like a room row's options: they fade in while
// sliding in from the row's end, and leave the same way instead of vanishing at once.
const actions = `${EntryActions}${EntryActions}`;
globalStyle(actions, rowControlsHidden);
globalStyle(`${Entry}:hover ${actions}, ${Entry}:focus-within ${actions}`, rowControlsShown);
