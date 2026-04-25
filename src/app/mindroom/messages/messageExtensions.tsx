import React, { ReactNode } from 'react';

import {
  MindroomAiRunControls,
  MindroomAiRunControlsRenderProps,
  MindroomAiRunInfoButton,
  MindroomAiRunMenuItem,
  MindroomDownloadOriginalMenuItem,
  useMindroomMessageControls,
} from './MindroomMessageControls';

export type MindroomMessageExtensionControls = MindroomAiRunControlsRenderProps;

export type MindroomMessageExtensionState = ReturnType<typeof useMindroomMessageControls>;

export type MindroomMessageCopyTextState = {
  loading: boolean;
  resolvedContent?: Record<string, unknown>;
  visible: boolean;
};

export function useMindroomMessageExtensionState(
  content: Record<string, unknown>,
  menuOpen: boolean
): MindroomMessageExtensionState {
  return useMindroomMessageControls(content, menuOpen);
}

export function getMindroomMessageCopyTextState(
  state: MindroomMessageExtensionState
): MindroomMessageCopyTextState {
  return {
    loading: state.longTextLoading,
    resolvedContent: state.resolvedLongTextContent,
    visible: state.longTextSource !== undefined,
  };
}

export function MindroomMessageExtensionShell({
  state,
  forwardedRef,
  children,
}: {
  state: MindroomMessageExtensionState;
  forwardedRef: React.Ref<HTMLDivElement> | undefined;
  children: (controls?: MindroomMessageExtensionControls) => ReactNode;
}) {
  if (!state.aiRunInfo) return <>{children()}</>;

  return (
    <MindroomAiRunControls info={state.aiRunInfo} forwardedRef={forwardedRef}>
      {children}
    </MindroomAiRunControls>
  );
}

export function MindroomMessageHeaderExtensions({
  controls,
  onOpenAiRun,
}: {
  controls?: MindroomMessageExtensionControls;
  onOpenAiRun: () => void;
}) {
  if (!controls) return null;

  return <MindroomAiRunInfoButton open={controls.open} onOpen={onOpenAiRun} />;
}

export function MindroomMessageMenuExtensions({
  controls,
  state,
  onClose,
  onOpenAiRun,
}: {
  controls?: MindroomMessageExtensionControls;
  state: MindroomMessageExtensionState;
  onClose?: () => void;
  onOpenAiRun: () => void;
}) {
  return (
    <>
      {controls && <MindroomAiRunMenuItem onOpen={onOpenAiRun} />}
      {state.longTextSource && (
        <MindroomDownloadOriginalMenuItem source={state.longTextSource} onClose={onClose} />
      )}
    </>
  );
}
