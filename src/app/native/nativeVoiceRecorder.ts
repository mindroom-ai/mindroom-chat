import { Capacitor, registerPlugin } from '@capacitor/core';

/** Plugin `MindRoomVoiceRecorder` (Mac Catalyst, whose WebKit has no media capture): start()
 *  resolving { id }; level, pause, resume, stop and cancel({ id }) act on that recording only;
 *  level resolves { level } from 0 to 1, stop { path } of its `.m4a`; rejections carry `code`. */
type MindRoomVoiceRecorderPlugin = {
  start(): Promise<{ id: string }>;
  level(options: { id: string }): Promise<{ level: number }>;
  pause(options: { id: string }): Promise<void>;
  resume(options: { id: string }): Promise<void>;
  stop(options: { id: string }): Promise<{ path: string }>;
  cancel(options: { id: string }): Promise<void>;
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

/** The part of `MediaRecorder` the voice capture session drives, over the native recorder. */
export class NativeVoiceRecorder extends EventTarget {
  state: 'inactive' | 'recording' | 'paused' = 'recording';

  readonly mimeType = 'audio/mp4';

  private newestLevel = 0;

  constructor(private readonly id: string) {
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

  /** Raises `dataavailable` (an Event with `data: Blob`) when there is audio, then `stop`. */
  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.deliver()
      .catch(() => undefined)
      .finally(() => this.end());
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
      this.state = 'inactive';
      this.end();
    });
  }

  private async deliver(): Promise<void> {
    const { path } = await getVoiceRecorderPlugin().stop({ id: this.id });
    const response = await fetch(Capacitor.convertFileSrc(path), {
      signal: AbortSignal.timeout(5_000),
    });
    // Capacitor answers a local media file without an HTTP status, which WebKit reports as 0.
    if (!response.ok && response.status !== 0) return;
    const data = await response.blob();
    if (data.size > 0) this.dispatchEvent(Object.assign(new Event('dataavailable'), { data }));
  }

  /** Every way out, once (`state` is `inactive` by then): the native side deletes the file. */
  private end(): void {
    getVoiceRecorderPlugin()
      .cancel({ id: this.id })
      .catch(() => undefined);
    this.dispatchEvent(new Event('stop'));
  }
}

/** Asks for the microphone and starts recording. Rejects with an Error named as getUserMedia
 *  names it. */
export const startNativeVoiceRecorder = async (): Promise<NativeVoiceRecorder> => {
  try {
    const { id } = await getVoiceRecorderPlugin().start();
    return new NativeVoiceRecorder(id);
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    throw Object.assign(new Error(message), {
      name: START_ERROR_NAMES[code ?? ''] ?? 'NotReadableError',
    });
  }
};
