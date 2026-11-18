import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Plugin `MindRoomVoiceRecorder` (Mac Catalyst, whose WebKit has no media capture): start()
 *  resolving { id }; pause, resume, stop and cancel({ id }) act on that recording only; stop
 *  resolves { path } of its `.m4a`; event `level` with { level } from 0 to 1; rejections carry
 *  `code`. */
type MindRoomVoiceRecorderPlugin = {
  start(): Promise<{ id: string }>;
  pause(options: { id: string }): Promise<void>;
  resume(options: { id: string }): Promise<void>;
  stop(options: { id: string }): Promise<{ path: string }>;
  cancel(options: { id: string }): Promise<void>;
  addListener(
    event: 'level',
    listener: (data: { level: number }) => void
  ): Promise<PluginListenerHandle>;
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

  constructor(
    private readonly id: string,
    /** The newest level event, 0 before the first. */
    readonly level: () => number,
    private readonly levels: PluginListenerHandle
  ) {
    super();
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
    if (!response.ok) return;
    const data = await response.blob();
    if (data.size > 0) this.dispatchEvent(Object.assign(new Event('dataavailable'), { data }));
  }

  /** Every way out, once (`state` is `inactive` by then): the native side deletes the file. */
  private end(): void {
    this.levels.remove().catch(() => undefined);
    getVoiceRecorderPlugin()
      .cancel({ id: this.id })
      .catch(() => undefined);
    this.dispatchEvent(new Event('stop'));
  }
}

/** Asks for the microphone and starts recording. Rejects with an Error named as getUserMedia
 *  names it. */
export const startNativeVoiceRecorder = async (): Promise<NativeVoiceRecorder> => {
  const plugin = getVoiceRecorderPlugin();
  let level = 0;
  const levels = await plugin.addListener('level', (data) => {
    level = data.level;
  });
  try {
    const { id } = await plugin.start();
    return new NativeVoiceRecorder(id, () => level, levels);
  } catch (error) {
    levels.remove().catch(() => undefined);
    const { code, message } = error as { code?: string; message?: string };
    throw Object.assign(new Error(message), {
      name: START_ERROR_NAMES[code ?? ''] ?? 'NotReadableError',
    });
  }
};
