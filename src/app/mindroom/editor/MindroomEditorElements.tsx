import React from 'react';
import { RenderElementProps, useFocused, useSelected } from 'slate-react';

import type { PasteMarkerElement } from '../../components/editor/slate';
import * as css from '../../styles/CustomHtml.css';

export function RenderMindroomEditorPasteMarkerElement({
  attributes,
  element,
  children,
}: { element: PasteMarkerElement } & RenderElementProps) {
  const selected = useSelected();
  const focused = useFocused();
  const charLabel = `${element.chars.toLocaleString('en-US')} chars`;

  return (
    <span
      {...attributes}
      className={css.PasteMarker({
        focus: selected && focused,
      })}
      contentEditable={false}
      data-mindroom-paste-composer-badge
      title={element.marker}
    >
      <span>Pasted text</span>
      <span className={css.PasteMarkerMeta}>{element.id}</span>
      <span className={css.PasteMarkerMeta}>{charLabel}</span>
      <span className={css.PasteMarkerMeta}>{element.fileName}</span>
      {children}
    </span>
  );
}
