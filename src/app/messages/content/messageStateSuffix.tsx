import { type ReactNode } from 'react';
import { MessageEditedContent } from './FallbackContent';
import { renderFailedSendIndicator, renderPendingSendIndicator } from '../../ui/PendingSendIndicator';

export type MessageStateSuffixOptions = {
  edited?: boolean;
  pendingSend?: boolean;
  failedSend?: boolean;
  renderStateSuffix?: () => ReactNode;
};

export const getMessageStateSuffixRenderer = ({
  edited,
  pendingSend,
  failedSend,
  renderStateSuffix,
}: MessageStateSuffixOptions): (() => ReactNode) | undefined => {
  if (!renderStateSuffix && !pendingSend && !failedSend) {
    return undefined;
  }

  return () => (
    <>
      {renderStateSuffix?.()}
      {edited && <MessageEditedContent />}
      {failedSend ? renderFailedSendIndicator() : pendingSend && renderPendingSendIndicator()}
    </>
  );
};
