import { globalStyle, style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

// The field draws its own Clear button, so the browser's search cancel mark stays hidden.
export const SearchField = style({});
globalStyle(`${SearchField} input::-webkit-search-cancel-button`, { display: 'none' });

/** The order chip keeps to the far end of the filter chips. */
export const FilterEnd = style({ marginInlineStart: 'auto' });

/** A room filter chip keeps long room names to one line. */
export const RoomChipName = style({ maxWidth: toRem(180) });

export const RoomPicker = style({
  display: 'flex',
  flexDirection: 'column',
  width: toRem(300),
  maxWidth: 'calc(100vw - 32px)',
});

export const RoomPickerHead = style({ padding: `${config.space.S300} ${config.space.S300} 0` });

export const RoomPickerList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  maxHeight: toRem(288),
  overflowY: 'auto',
  padding: config.space.S200,
});

export const RoomPickerNote = style({
  display: 'block',
  padding: `${config.space.S100} ${config.space.S200}`,
});

export const RoomPickerName = style({ flexGrow: 1, minWidth: 0, textAlign: 'start' });

/** A room's results start with its avatar and name. */
export const GroupTitle = style({ paddingTop: config.space.S400, minWidth: 0 });

export const Result = style({ paddingTop: config.space.S200 });

/** "Scroll to top" floats just under the page title. */
export const ScrollTop = style({ top: config.space.S300 });
