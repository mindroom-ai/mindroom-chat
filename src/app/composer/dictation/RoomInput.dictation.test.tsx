// @vitest-environment jsdom
import React, { createRef } from 'react';
import { Provider, createStore } from 'jotai';
import { cleanup, render, screen } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { createEditor } from 'slate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import type { ComposerExtraVoiceAction } from '../ComposerActionsMenu';
import { RoomInput } from '../RoomInput';

const layoutState = vi.hoisted(
  (): {
    dictationAvailable: boolean;
    dictationBlocksSubmit: boolean;
    voiceButtonMode: 'dictate' | 'voiceMessage';
    voiceDistinctIcon: boolean;
    actionsMenuVoiceAction: ComposerExtraVoiceAction | undefined;
    sendDisabled: boolean;
    sendOnClick: ReturnType<typeof vi.fn>;
    startSendSession: ReturnType<typeof vi.fn>;
  } => ({
    dictationAvailable: true,
    dictationBlocksSubmit: false,
    voiceButtonMode: 'dictate',
    voiceDistinctIcon: false,
    actionsMenuVoiceAction: undefined,
    sendDisabled: false,
    sendOnClick: vi.fn(),
    startSendSession: vi.fn(async () => undefined),
  })
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../dictation/useRoomInputDictation', () => ({
  useRoomInputDictation: () => ({
    available: layoutState.dictationAvailable,
    blocksSubmit: layoutState.dictationBlocksSubmit,
    active: layoutState.dictationBlocksSubmit,
    disabled: false,
    label: 'Dictate',
    button: layoutState.dictationAvailable ? (
      <button type="button" aria-label="Dictate" data-testid="dictate-btn" />
    ) : null,
    capsule: layoutState.dictationBlocksSubmit ? <div data-testid="dictation-capsule" /> : null,
    start: () => true,
  }),
}));

vi.mock('../useRoomInputVoice', () => ({
  useRoomInputVoice: ({ distinctIcon }: { distinctIcon?: boolean }) => {
    layoutState.voiceDistinctIcon = Boolean(distinctIcon);
    return {
      blocksSubmit: () => false,
      sendAtPress: () => undefined,
      renderRecorder: () => null,
      microphone: (
        <button
          type="button"
          aria-label="Record voice"
          data-testid="voice-btn"
          data-distinct={String(Boolean(distinctIcon))}
        />
      ),
      microphoneLabel: 'Record voice',
      microphoneDisabled: false,
      startRecording: () => true,
      voiceKey: {
        active: () => false,
        offersFailed: () => false,
        phase: () => 'none',
        start: () => false,
      },
    };
  },
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
  ComposerSendButton: ({ disabled, onSend }: { disabled?: boolean; onSend: () => unknown }) => {
    layoutState.sendDisabled = Boolean(disabled);
    layoutState.sendOnClick = vi.fn(() => onSend());
    return (
      <button
        type="button"
        aria-label="Send"
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
  CustomEditor: ({ before, after }: { before?: React.ReactNode; after?: React.ReactNode }) => (
    <div>
      <div data-testid="slot-before">{before}</div>
      <div data-testid="slot-after">{after}</div>
    </div>
  ),
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
  useSetting: (_atom: unknown, key: string) => [
    key === 'voiceButtonMode'
      ? layoutState.voiceButtonMode
      : key === 'midTurnSend'
      ? 'auto'
      : false,
  ],
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
    board: null,
    dropZoneVisible: false,
    onEditorChange: vi.fn(),
    onPaste: vi.fn(),
    pickFiles: vi.fn(),
    attachAppLogs: vi.fn(),
    lostPastes: false,
    dismissLostPastes: vi.fn(),
    settlePastes: () => true,
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
    forkFrom?: { threadId: string; eventId: string };
    ask?: React.ComponentProps<typeof RoomInput>['ask'];
  } = {}
) => {
  const editor = createEditor();
  editor.children = [{ type: 'paragraph', children: [{ text: '' }] }] as never;
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
  layoutState.voiceButtonMode = 'dictate';
  layoutState.voiceDistinctIcon = false;
  layoutState.actionsMenuVoiceAction = undefined;
  layoutState.sendDisabled = false;
  layoutState.startSendSession.mockClear();
});

afterEach(() => cleanup());

describe('RoomInput dictation layout and submit guard', () => {
  it('makes zero UI change when dictation is unavailable', () => {
    layoutState.dictationAvailable = false;
    renderInput({ screenSize: ScreenSize.Desktop });

    expect(screen.queryByTestId('dictate-btn')).toBeNull();
    expect(screen.getByTestId('voice-btn').getAttribute('data-distinct')).toBe('false');
  });

  it('places Dictate in after beside Send and uses distinct voice icon in before on desktop', () => {
    renderInput({ screenSize: ScreenSize.Desktop });

    const before = screen.getByTestId('slot-before');
    const after = screen.getByTestId('slot-after');
    expect(before.querySelector('[data-testid="voice-btn"]')).not.toBeNull();
    expect(screen.getByTestId('voice-btn').getAttribute('data-distinct')).toBe('true');
    expect(after.querySelector('[data-testid="dictate-btn"]')).not.toBeNull();
    expect(after.querySelector('[data-testid="send-btn"]')).not.toBeNull();
  });

  it('enables Dictate in forkFrom drafts even while Matrix voice messages are hidden', () => {
    renderInput({
      screenSize: ScreenSize.Desktop,
      forkFrom: { threadId: '$root', eventId: '$point' },
    });

    expect(screen.queryByTestId('voice-btn')).toBeNull();
    expect(screen.getByTestId('dictate-btn')).toBeTruthy();
  });

  it('uses voiceButtonMode on phones and places the alternate action in ComposerActionsMenu', () => {
    layoutState.voiceButtonMode = 'dictate';
    const { unmount } = renderInput({ screenSize: ScreenSize.Mobile });
    expect(
      screen.getByTestId('slot-before').querySelector('[data-testid="dictate-btn"]')
    ).not.toBeNull();
    expect(screen.getByTestId('slot-before').querySelector('[data-testid="voice-btn"]')).toBeNull();
    expect(
      screen.getByTestId('slot-after').querySelector('[data-testid="dictate-btn"]')
    ).toBeNull();
    expect(layoutState.actionsMenuVoiceAction?.label).toBe('Record voice');
    unmount();

    layoutState.voiceButtonMode = 'voiceMessage';
    renderInput({ screenSize: ScreenSize.Mobile });
    expect(
      screen.getByTestId('slot-before').querySelector('[data-testid="voice-btn"]')
    ).not.toBeNull();
    expect(
      screen.getByTestId('slot-before').querySelector('[data-testid="dictate-btn"]')
    ).toBeNull();
    expect(layoutState.actionsMenuVoiceAction?.label).toBe('Dictate');
  });

  it('keeps Dictate available in after on phones when ask.pickers replaces the before slot', () => {
    renderInput({
      screenSize: ScreenSize.Mobile,
      ask: {
        agentUserId: '@mindroom_assistant:example.org',
        placeholder: 'Ask',
        pickers: <div data-testid="ask-pickers" />,
        canSend: () => true,
      },
    });

    expect(
      screen.getByTestId('slot-before').querySelector('[data-testid="ask-pickers"]')
    ).not.toBeNull();
    expect(
      screen.getByTestId('slot-after').querySelector('[data-testid="dictate-btn"]')
    ).not.toBeNull();
  });

  it('disables Send and guards submission while dictating', () => {
    layoutState.dictationBlocksSubmit = true;
    renderInput({ screenSize: ScreenSize.Desktop });

    expect(screen.getByTestId('dictation-capsule')).toBeTruthy();
    expect(layoutState.sendDisabled).toBe(true);
    expect(screen.getByTestId<HTMLButtonElement>('send-btn').disabled).toBe(true);
  });
});
