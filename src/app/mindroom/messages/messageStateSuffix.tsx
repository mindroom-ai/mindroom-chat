import React, { type ReactNode } from 'react';
import { MessageEditedContent } from '../../components/message/content/FallbackContent';
import { renderPendingSendIndicator } from './pendingSendIndicator';

export type MindroomMessageStateSuffixOptions = {
  edited?: boolean;
  pendingSend?: boolean;
  renderStateSuffix?: () => ReactNode;
};

export const getMindroomMessageStateSuffixRenderer = ({
  edited,
  pendingSend,
  renderStateSuffix,
}: MindroomMessageStateSuffixOptions): (() => ReactNode) | undefined => {
  if (!renderStateSuffix && !pendingSend) {
    return undefined;
  }

  return () => (
    <>
      {renderStateSuffix?.()}
      {edited && <MessageEditedContent />}
      {pendingSend && renderPendingSendIndicator()}
    </>
  );
};
