import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __closeExistingMessagePorts?: () => number;
    __loseNetworkingProcess?: () => { ports: number; connections: number };
    __schedulerWakeupReplacements?: number;
  }
}

/**
 * WebKit hosts IndexedDB and brokers MessagePorts in its networking process.
 * When that process exits, every existing port stops delivering without an
 * event and every IndexedDB connection receives `error` then `close`, while
 * ports and connections created afterwards work. Record native channels and
 * connections from page load so a test can reproduce that loss.
 */
const installNetworkingProcessLoss = () => {
  const NativeMessageChannel = window.MessageChannel;
  const channels: MessageChannel[] = [];
  function RecordedMessageChannel() {
    const channel = new NativeMessageChannel();
    channels.push(channel);
    return channel;
  }
  RecordedMessageChannel.prototype = NativeMessageChannel.prototype;
  window.MessageChannel = RecordedMessageChannel as unknown as typeof MessageChannel;

  const nativeOpen = IDBFactory.prototype.open;
  const connections: IDBDatabase[] = [];
  IDBFactory.prototype.open = function open(this: IDBFactory, ...args) {
    const request = nativeOpen.apply(this, args);
    request.addEventListener('success', () => connections.push(request.result));
    return request;
  } as IDBFactory['open'];

  window.__schedulerWakeupReplacements = 0;
  window.addEventListener('mindroom:scheduler-wakeup-replaced', () => {
    window.__schedulerWakeupReplacements = (window.__schedulerWakeupReplacements ?? 0) + 1;
  });
  window.__closeExistingMessagePorts = () => {
    const closed = channels.splice(0);
    closed.forEach((channel) => {
      channel.port1.close();
      channel.port2.close();
    });
    return closed.length;
  };
  window.__loseNetworkingProcess = () => {
    const ports = window.__closeExistingMessagePorts?.() ?? 0;
    const lost = connections.splice(0);
    lost.forEach((connection) => {
      connection.close();
      connection.dispatchEvent(new Event('error'));
      connection.dispatchEvent(new Event('close'));
    });
    return { ports, connections: lost.length };
  };
};

export const recordNetworkingProcessResources = (page: Page) =>
  page.addInitScript(installNetworkingProcessLoss);

/** Hides the page the way leaving the app does, without navigating away. */
export const hidePage = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
