import { Capacitor, registerPlugin } from '@capacitor/core';
import { randomUuid } from '../lib/randomUuid';

/** Plugin `MindRoomVoiceRecorder` (Mac Catalyst, whose WebKit has no media capture):
 *  start({ nonce, userId }) resolving { id }; level, pause, resume, stop and cancel({ id }) act on that
 *  recording only; level resolves { level } from 0 to 1, stop { path } of its `.m4a`; rejections
 *  carry `code`. listLeftovers lists finished files, with timestamps and durations in ms. */
type NativeVoiceLeftover = {
  id: string;
  path: string;
  startedAt: number;
  duration: number;
  userId: string;
};
type MindRoomVoiceRecorderPlugin = {
  start(options: { nonce: string; userId: string }): Promise<{ id: string }>;
  level(options: { id: string }): Promise<{ level: number }>;
  pause(options: { id: string }): Promise<void>;
  resume(options: { id: string }): Promise<void>;
  stop(options: { id: string }): Promise<{ path: string }>;
  cancel(options: { id: string }): Promise<void>;
  clear(options: { userId: string }): Promise<void>;
  listLeftovers(): Promise<{ recordings: NativeVoiceLeftover[] }>;
};

const START_ERROR_NAMES: Record<string, string> = {
  PERMISSION_DENIED: 'NotAllowedError',
  NO_MICROPHONE: 'NotFoundError',
};

let voiceRecorderPlugin: MindRoomVoiceRecorderPlugin | undefined;

const getVoiceRecorderPlugin = (): MindRoomVoiceRecorderPlugin => {
  if (!voiceRecorderPlugin) {
    voiceRecorderPlugin = registerPlugin<MindRoomVoiceRecorderPlugin>('MindRoomVoiceRecorder');
  }
  return voiceRecorderPlugin;
};

export const isNativeVoiceRecorderAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('MindRoomVoiceRecorder');

export const clearNativeVoiceRecordings = async (userId: string): Promise<void> => {
  if (isNativeVoiceRecorderAvailable())
    await getVoiceRecorderPlugin()
      .clear({ userId })
      .catch(() => undefined);
};

export const listNativeVoiceLeftovers = () => getVoiceRecorderPlugin().listLeftovers();
export const cancelNativeVoiceRecording = (id: string) => getVoiceRecorderPlugin().cancel({ id });

export const readNativeVoiceFile = async (path: string): Promise<Blob | undefined> => {
  const response = await fetch(Capacitor.convertFileSrc(path), {
    signal: AbortSignal.timeout(5_000),
  });
  // Capacitor answers a local media file without an HTTP status, which WebKit reports as 0.
  if (!response.ok && response.status !== 0) return undefined;
  const data = await response.blob();
  return data.size > 0 ? data : undefined;
};

/** The part of `MediaRecorder` the voice capture session drives, over the native recorder. */
export class NativeVoiceRecorder extends EventTarget {
  state: 'inactive' | 'recording' | 'paused' = 'recording';

  readonly mimeType = 'audio/mp4';

  private newestLevel = 0;

  constructor(readonly id: string) {
    super();
  }

  /** The level the native recorder answered last, 0 before the first; asks it for the next. */
  level(): number {
    if (this.state === 'recording') {
      getVoiceRecorderPlugin()
        .level({ id: this.id })
        .then(
          ({ level }) => {
            this.newestLevel = level;
          },
          () => undefined
        );
    }
    return this.newestLevel;
  }

  pause(): void {
    this.transition('paused', (plugin) => plugin.pause({ id: this.id }));
  }

  resume(): void {
    this.transition('recording', (plugin) => plugin.resume({ id: this.id }));
  }

  /** Offers audio only after the caller commits its copy and native deletion succeeds. */
  stop(persist?: (data: Blob) => Promise<boolean>, ready?: Promise<boolean>): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.deliver(persist, ready)
      .catch(() => undefined)
      .finally(() => this.dispatchEvent(new Event('stop')));
  }

  discard(): void {
    this.state = 'inactive';
    cancelNativeVoiceRecording(this.id)
      .catch(() => undefined)
      .finally(() => this.dispatchEvent(new Event('stop')));
  }

  private transition(
    state: 'recording' | 'paused',
    call: (plugin: MindRoomVoiceRecorderPlugin) => Promise<void>
  ): void {
    if (this.state === 'inactive') return;
    this.state = state;
    // A transition the native recorder refuses would leave a wrong duration: end the recording.
    call(getVoiceRecorderPlugin()).catch(() => {
      if (this.state === 'inactive') return;
      this.discard();
    });
  }

  private async deliver(
    persist?: (data: Blob) => Promise<boolean>,
    ready?: Promise<boolean>
  ): Promise<void> {
    await ready;
    const { path } = await getVoiceRecorderPlugin().stop({ id: this.id });
    const data = await readNativeVoiceFile(path);
    if (!data) return;
    if (persist) {
      if (!(await persist(data))) return;
      await cancelNativeVoiceRecording(this.id);
    }
    this.dispatchEvent(Object.assign(new Event('dataavailable'), { data }));
  }
}

/** Asks for the microphone and starts recording. Rejects with an Error named as getUserMedia
 *  names it. */
export const startNativeVoiceRecorder = async (userId: string): Promise<NativeVoiceRecorder> => {
  // The plugin reads this name back from the page after the microphone prompt, and records only
  // for the newest start of the page that is still loaded.
  const nonce = randomUuid();
  Object.assign(globalThis, { mindroomVoiceStart: nonce });
  try {
    const { id } = await getVoiceRecorderPlugin().start({ nonce, userId });
    return new NativeVoiceRecorder(id);
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    throw Object.assign(new Error(message), {
      name: START_ERROR_NAMES[code ?? ''] ?? 'NotReadableError',
    });
  }
};
