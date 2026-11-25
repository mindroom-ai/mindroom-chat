// @vitest-environment jsdom
import React, { createRef } from 'react';
import { Provider, createStore } from 'jotai';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { createEditor } from 'slate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import type { MatrixClient } from 'matrix-js-sdk';
import type { ComposerExtraVoiceAction } from '../ComposerActionsMenu';
import { RoomInput } from '../RoomInput';
import { VoiceMessageIcon } from '../voice/VoiceMessageIcon';

const layoutState = vi.hoisted(
  (): {
    dictationAvailable: boolean;
    dictationBlocksSubmit: boolean;
    dictationCanSend: boolean;
    hasVoice: boolean;
    hasSendableFiles: boolean;
    actionsMenuVoiceAction: ComposerExtraVoiceAction | undefined;
    sendLabel: string | undefined;
    sendEmpty: boolean | undefined;
    sendHasContent: (() => boolean) | undefined;
    sendDisabled: boolean;
    sendAlone: boolean | undefined;
    sendOnClick: ReturnType<typeof vi.fn>;
    sendWithMode: ((mode?: 'steer' | 'queue' | 'auto') => unknown) | undefined;
    editorKeyDown: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
    startSendSession: ReturnType<typeof vi.fn>;
    handoffMock: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
    detachForSend: ReturnType<
      typeof vi.fn<() => { session: { finish: ReturnType<typeof vi.fn> }; savedSelection: null }>
    >;
  } => ({
    dictationAvailable: true,
    dictationBlocksSubmit: false,
    dictationCanSend: false,
    hasVoice: false,
    hasSendableFiles: false,
    actionsMenuVoiceAction: undefined,
    sendLabel: undefined,
    sendEmpty: undefined,
    sendHasContent: undefined,
    sendDisabled: false,
    sendAlone: undefined,
    sendOnClick: vi.fn(),
    sendWithMode: undefined,
    editorKeyDown: undefined,
    startSendSession: vi.fn(async () => undefined),
    handoffMock: vi.fn(),
    detachForSend: vi.fn(() => ({ session: { finish: vi.fn() }, savedSelection: null })),
  })
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../dictation/dictationSendHandoff', () => ({
  handoffComposerDictationSend: (...args: unknown[]) => layoutState.handoffMock(...args),
}));

vi.mock('../dictation/useRoomInputDictation', () => ({
  useRoomInputDictation: () => ({
    available: layoutState.dictationAvailable,
    blocksSubmit: layoutState.dictationBlocksSubmit,
    canSend: layoutState.dictationCanSend,
    active: layoutState.dictationBlocksSubmit || layoutState.dictationCanSend,
    disabled: false,
    label: 'Dictate',
    button: layoutState.dictationAvailable ? (
      <button type="button" aria-label="Dictate" data-testid="dictate-btn" />
    ) : null,
    capsule:
      layoutState.dictationBlocksSubmit || layoutState.dictationCanSend ? (
        <div data-testid="dictation-capsule" />
      ) : null,
    start: () => true,
    getLiveStatus: () =>
      layoutState.dictationBlocksSubmit
        ? 'blocked'
        : layoutState.dictationCanSend
          ? 'sendable'
          : 'idle',
    detachForSend: () => (layoutState.dictationCanSend ? layoutState.detachForSend() : undefined),
  }),
}));

vi.mock('../useRoomInputVoice', () => ({
  useRoomInputVoice: () => ({
    blocksSubmit: () => false,
    hasVoice: layoutState.hasVoice,
    sendAtPress: () => undefined,
    renderRecorder: () => null,
    microphone: <button type="button" aria-label="Record voice" data-testid="voice-btn" />,
    microphoneLabel: 'Record voice',
    microphoneDisabled: false,
    startRecording: () => true,
    voiceKey: {
      active: () => false,
      offersFailed: () => false,
      phase: () => 'none',
      start: () => false,
    },
  }),
}));

vi.mock('../ComposerActionsMenu', () => ({
  ComposerActionsMenu: ({ voiceAction }: { voiceAction?: ComposerExtraVoiceAction }) => {
    layoutState.actionsMenuVoiceAction = voiceAction;
    return <button type="button" aria-label="More actions" data-testid="more-actions" />;
  },
}));

vi.mock('../ComposerAttachButton', () => ({
  ComposerAttachButton: () => <button type="button" aria-label="Attach" />,
}));

vi.mock('../ComposerSendButton', () => ({
  ComposerSendButton: ({
    label,
    alone,
    empty,
    hasContent,
    disabled,
    onSend,
  }: {
    label: string;
    alone?: boolean;
    empty: boolean;
    hasContent: () => boolean;
    disabled?: boolean;
    onSend: (mode?: 'steer' | 'queue' | 'auto') => unknown;
  }) => {
    layoutState.sendLabel = label;
    layoutState.sendAlone = alone;
    layoutState.sendEmpty = empty;
    layoutState.sendHasContent = hasContent;
    layoutState.sendDisabled = Boolean(disabled);
    layoutState.sendWithMode = onSend;
    layoutState.sendOnClick = vi.fn(() => onSend());
    return (
      <button
        type="button"
        aria-label={label}
        data-testid="send-btn"
        disabled={disabled}
        onClick={() => {
          void onSend();
        }}
      />
    );
  },
}));

vi.mock('../../editor/Editor', () => ({
  CustomEditor: ({
    before,
    after,
    onKeyDown,
  }: {
    before?: React.ReactNode;
    after?: React.ReactNode;
    onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  }) => {
    layoutState.editorKeyDown = onKeyDown;
    return (
      <div>
        <div data-testid="slot-before">{before}</div>
        <div data-testid="slot-after">{after}</div>
      </div>
    );
  },
}));

vi.mock('../../emoji/board/LazyEmojiBoard', () => ({ EmojiBoard: () => null }));
vi.mock('../../editor/autocomplete/UserMentionAutocomplete', () => ({
  UserMentionAutocomplete: () => null,
}));
vi.mock('../../editor/autocomplete/EmoticonAutocomplete', () => ({
  EmoticonAutocomplete: () => null,
}));
vi.mock('../commands/CommandAutocomplete', () => ({ CommandAutocomplete: () => null }));
vi.mock('../commands/useCommands', () => ({ useCommands: () => ({}) }));
vi.mock('../../emoji/useImagePackRooms', () => ({ useImagePackRooms: () => [] }));
vi.mock('../../matrix/hooks/useRoomMeta', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/useRoomMeta')>()),
  useRoomName: (room: Room) => room.name,
}));
vi.mock('../../matrix/hooks/useRoomThreadMode', () => ({ useRoomThreadMode: () => undefined }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@alice:example.org', getRoom: () => null }),
}));
vi.mock('../useTypingStatusUpdater', () => ({ useTypingStatusUpdater: () => vi.fn() }));
vi.mock('../../preferences/useSetting', () => ({
  useSetting: (_atom: unknown, key: string) => [key === 'midTurnSend' ? 'auto' : false],
}));
vi.mock('../../event-store/threads/useThreadStreamingState', () => ({
  useThreadStreamingState: () => false,
}));
vi.mock('../../models/ModelPicker', () => ({ ThreadModelPicker: () => null }));
vi.mock('../useRoomInputSendSessionController', () => ({
  useRoomInputSendSessionController: () => ({
    startSendSession: layoutState.startSendSession,
    restoreText: vi.fn(),
  }),
}));
vi.mock('../useRoomInputAttachments', () => ({
  useRoomInputAttachments: () => ({
    access: { snapshot: () => ({ staged: [] }) },
    hasSendableFiles: layoutState.hasSendableFiles,
    board: null,
    dropZoneVisible: false,
    onEditorChange: vi.fn(),
    onPaste: vi.fn(),
    pickFiles: vi.fn(),
    attachAppLogs: vi.fn(),
    lostPastes: false,
    dismissLostPastes: vi.fn(),
    settlePastes: () => true,
    hasPendingStaging: () => false,
    waitForPendingStaging: async () => undefined,
    prepareForSend: vi.fn(async (_room: unknown, items: unknown[] = []) => items),
  }),
}));
vi.mock('../useRoomInputDraft', () => ({ useRoomInputDraft: () => vi.fn() }));
vi.mock('../useRoomInputUploadTransport', () => ({
  getVoiceMessageContentOptions: () => ({}),
  useRoomInputUploadTransport: () => ({}),
}));
vi.mock('../../ui/IconTooltip', () => ({
  IconTooltip: ({ children }: { children: (ref: () => void) => React.ReactNode }) =>
    children(() => undefined),
}));

const room = {
  roomId: '!room:example.org',
  name: 'General',
  hasEncryptionStateEvent: () => false,
} as unknown as Room;

const renderInput = (
  opts: {
    screenSize?: ScreenSize;
    text?: string;
    forkFrom?: { threadId: string; eventId: string };
    ask?: React.ComponentProps<typeof RoomInput>['ask'];
  } = {}
) => {
  const editor = createEditor();
  editor.children = [{ type: 'paragraph', children: [{ text: opts.text ?? '' }] }] as never;
  const store = createStore();
  return render(
    <Provider store={store}>
      <ScreenSizeProvider value={opts.screenSize ?? ScreenSize.Desktop}>
        <RoomInput
          editor={editor}
          fileDropContainerRef={createRef<HTMLElement>()}
          roomId={room.roomId}
          room={room}
          forkFrom={opts.forkFrom}
          ask={opts.ask}
        />
      </ScreenSizeProvider>
    </Provider>
  );
};

beforeEach(() => {
  layoutState.dictationAvailable = true;
  layoutState.dictationBlocksSubmit = false;
  layoutState.dictationCanSend = false;
  layoutState.hasVoice = false;
  layoutState.hasSendableFiles = false;
  layoutState.actionsMenuVoiceAction = undefined;
  layoutState.sendLabel = undefined;
  layoutState.sendEmpty = undefined;
  layoutState.sendHasContent = undefined;
  layoutState.sendDisabled = false;
  layoutState.sendAlone = undefined;
  layoutState.sendWithMode = undefined;
  layoutState.editorKeyDown = undefined;
  layoutState.startSendSession.mockClear();
  layoutState.handoffMock.mockClear();
  layoutState.detachForSend.mockClear();
});

afterEach(() => cleanup());

const inSlot = (slot: 'before' | 'after', id: string) =>
  screen.getByTestId(`slot-${slot}`).querySelector(`[data-testid="${id}"]`);

describe('RoomInput dictation layout and submit guard', () => {
  it('renders fixed waveform voice icon and keeps desktop layout across dictation states', async () => {
    const { useRoomInputVoice: actualUseRoomInputVoice } =
      await vi.importActual<typeof import('../useRoomInputVoice')>('../useRoomInputVoice');
    function RealVoiceButton() {
      const voice = actualUseRoomInputVoice({
        mx: {
          getUserId: () => '@alice:example.org',
          getRoom: () => room,
        } as unknown as MatrixClient,
        composer: {
          getContext: () => ({
            roomId: room.roomId,
            room,
            threadId: undefined,
            replyDraft: undefined,
            threadingEnabled: true,
          }),
          snapshotText: () => [],
          resetText: vi.fn(),
          restoreText: vi.fn(),
          clearConsumedReply: vi.fn(),
        },
        attachments: {} as never,
        transport: {} as never,
        sessions: {} as never,
        recover: false,
      });
      return <>{voice.microphone}</>;
    }
    const voiceRender = render(
      <Provider store={createStore()}>
        <RealVoiceButton />
      </Provider>
    );
    expect(
      voiceRender.container.querySelector('path[d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"]')
    ).not.toBeNull();
    voiceRender.unmount();

    layoutState.dictationAvailable = false;
    const unavailable = renderInput({ screenSize: ScreenSize.Desktop });
    expect(screen.queryByTestId('dictate-btn')).toBeNull();
    expect(inSlot('before', 'voice-btn')).not.toBeNull();
    unavailable.unmount();

    layoutState.dictationAvailable = true;
    renderInput({ screenSize: ScreenSize.Desktop });
    expect(inSlot('before', 'voice-btn')).not.toBeNull();
    expect(inSlot('after', 'dictate-btn')).not.toBeNull();
    expect(inSlot('after', 'send-btn')).not.toBeNull();
    expect(layoutState.sendAlone).toBe(false);
  });

  it('enables Dictate with Send in forkFrom drafts on desktop and phone while hiding voice messages', () => {
    const forkFrom = { threadId: '$root', eventId: '$point' };
    const desktop = renderInput({ screenSize: ScreenSize.Desktop, forkFrom });
    expect(screen.queryByTestId('voice-btn')).toBeNull();
    expect(inSlot('after', 'dictate-btn')).not.toBeNull();
    expect(inSlot('after', 'send-btn')).not.toBeNull();
    desktop.unmount();

    renderInput({ screenSize: ScreenSize.Mobile, forkFrom });
    expect(screen.queryByTestId('voice-btn')).toBeNull();
    expect(layoutState.actionsMenuVoiceAction).toBeUndefined();
    expect(inSlot('after', 'dictate-btn')).not.toBeNull();
    expect(inSlot('after', 'send-btn')).not.toBeNull();
    expect(layoutState.sendAlone).toBe(false);
  });

  it('swaps Send for Voice message in after when phone composer is empty and restores Send with text, files, or voice', () => {
    const emptyPhone = renderInput({ screenSize: ScreenSize.Mobile });
    expect(inSlot('before', 'voice-btn')).toBeNull();
    expect(inSlot('before', 'dictate-btn')).toBeNull();
    expect(layoutState.actionsMenuVoiceAction).toBeUndefined();
    expect(inSlot('after', 'dictate-btn')).not.toBeNull();
    expect(inSlot('after', 'voice-btn')).not.toBeNull();
    expect(screen.queryByTestId('send-btn')).toBeNull();
    emptyPhone.unmount();

    const typedPhone = renderInput({ screenSize: ScreenSize.Mobile, text: 'hello' });
    expect(inSlot('after', 'dictate-btn')).not.toBeNull();
    expect(inSlot('after', 'send-btn')).not.toBeNull();
    expect(screen.queryByTestId('voice-btn')).toBeNull();
    expect(layoutState.sendAlone).toBe(false);
    expect(layoutState.actionsMenuVoiceAction).toMatchObject({
      label: 'Record voice',
      icon: VoiceMessageIcon,
    });
    typedPhone.unmount();

    layoutState.hasSendableFiles = true;
    const filesPhone = renderInput({ screenSize: ScreenSize.Mobile });
    expect(inSlot('after', 'dictate-btn')).not.toBeNull();
    expect(inSlot('after', 'send-btn')).not.toBeNull();
    expect(layoutState.actionsMenuVoiceAction?.label).toBe('Record voice');
    filesPhone.unmount();

    layoutState.hasSendableFiles = false;
    layoutState.hasVoice = true;
    renderInput({ screenSize: ScreenSize.Mobile });
    expect(inSlot('after', 'dictate-btn')).not.toBeNull();
    expect(inSlot('after', 'send-btn')).not.toBeNull();
    expect(screen.queryByTestId('voice-btn')).toBeNull();
  });

  it('keeps Voice message in before and Send alone in after on phones when dictation is unavailable', () => {
    layoutState.dictationAvailable = false;
    renderInput({ screenSize: ScreenSize.Mobile });

    expect(inSlot('before', 'voice-btn')).not.toBeNull();
    expect(layoutState.actionsMenuVoiceAction).toBeUndefined();
    expect(inSlot('after', 'dictate-btn')).toBeNull();
    expect(inSlot('after', 'send-btn')).not.toBeNull();
    expect(layoutState.sendAlone).toBe(true);
  });

  it('keeps Dictate beside Send in after on phones when ask.pickers replaces the before slot', () => {
    renderInput({
      screenSize: ScreenSize.Mobile,
      ask: {
        agentUserId: '@mindroom_assistant:example.org',
        placeholder: 'Ask',
        pickers: <div data-testid="ask-pickers" />,
        canSend: () => true,
      },
    });

    expect(inSlot('before', 'ask-pickers')).not.toBeNull();
    expect(inSlot('after', 'dictate-btn')).not.toBeNull();
    expect(inSlot('after', 'send-btn')).not.toBeNull();
    expect(screen.queryByTestId('voice-btn')).toBeNull();
    expect(layoutState.sendAlone).toBe(false);
  });

  it('enables Finish & Send on desktop and phone with mid-turn mode, Enter, ask, and forkFrom while blocking non-sendable phases', () => {
    layoutState.dictationCanSend = true;
    const desktop = renderInput({ screenSize: ScreenSize.Desktop });
    expect(screen.getByTestId('dictation-capsule')).toBeTruthy();
    expect(layoutState.sendDisabled).toBe(false);
    expect(layoutState.sendLabel).toBe('composer.dictation.finishAndSend');
    expect(layoutState.sendEmpty).toBe(false);
    expect(layoutState.sendHasContent?.()).toBe(true);

    layoutState.sendWithMode?.('steer');
    expect(layoutState.handoffMock).toHaveBeenCalledWith(
      expect.objectContaining({ midTurnMode: 'steer', explicitMidTurnMode: true })
    );
    layoutState.handoffMock.mockClear();
    layoutState.editorKeyDown?.({
      key: 'Enter',
      nativeEvent: new KeyboardEvent('keydown', { key: 'Enter' }),
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLDivElement>);
    expect(layoutState.handoffMock).toHaveBeenCalledWith(
      expect.objectContaining({ midTurnMode: 'auto', explicitMidTurnMode: false })
    );
    desktop.unmount();

    const mobile = renderInput({ screenSize: ScreenSize.Mobile });
    expect(inSlot('after', 'dictate-btn')).not.toBeNull();
    expect(screen.getByTestId<HTMLButtonElement>('send-btn').disabled).toBe(false);
    expect(screen.queryByTestId('voice-btn')).toBeNull();
    expect(layoutState.actionsMenuVoiceAction?.label).toBe('Record voice');
    mobile.unmount();

    // Home ask respects askBlocked and passes ask callbacks through on Finish & Send.
    let canSendAsk = false;
    const blockedAsk = renderInput({
      ask: {
        agentUserId: '@mindroom_assistant:example.org',
        placeholder: 'Ask',
        pickers: <div />,
        canSend: () => canSendAsk,
      },
    });
    expect(screen.getByTestId<HTMLButtonElement>('send-btn').disabled).toBe(true);
    blockedAsk.unmount();
    canSendAsk = true;
    const allowedAsk = renderInput({
      forkFrom: undefined,
      ask: {
        agentUserId: '@mindroom_assistant:example.org',
        placeholder: 'Ask',
        pickers: <div />,
        canSend: () => canSendAsk,
      },
    });
    layoutState.handoffMock.mockClear();
    fireEvent.click(screen.getByTestId('send-btn'));
    expect(layoutState.handoffMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ask: expect.objectContaining({ agentUserId: '@mindroom_assistant:example.org' }),
      })
    );
    allowedAsk.unmount();

    // forkFrom supports Finish & Send.
    const forkFrom = { threadId: '$root', eventId: '$point' };
    const forked = renderInput({ forkFrom });
    layoutState.handoffMock.mockClear();
    fireEvent.click(screen.getByTestId('send-btn'));
    expect(layoutState.handoffMock).toHaveBeenCalledWith(expect.objectContaining({ forkFrom }));
    forked.unmount();

    // Non-sendable dictation phases (requesting/finishing/failed/local-echo thread) disable Send.
    layoutState.dictationCanSend = false;
    layoutState.dictationBlocksSubmit = true;
    renderInput({ screenSize: ScreenSize.Desktop });
    expect(screen.getByTestId<HTMLButtonElement>('send-btn').disabled).toBe(true);
    expect(layoutState.sendLabel).toBe('composer.sendMessage');
  });
});
