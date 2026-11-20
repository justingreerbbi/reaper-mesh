/**
 * Web Serial for the desktop app (D58). System webviews have no `navigator.serial`, so the app
 * injects this before the page's own scripts. It provides the same API on top of the app's Rust
 * serial commands (`src-tauri/src/serial.rs`), so the web portal, the agent core and the firmware
 * installer run unchanged. Port choice uses a small picker drawn by this script instead of the
 * browser's chooser.
 */
interface PortInfo {
  path: string;
  vendorId: number;
  productId: number;
  serialNumber?: string | null;
  manufacturer?: string | null;
  product?: string | null;
}
interface TauriChannel {
  onmessage: (message: ArrayBuffer) => void;
}
interface TauriCore {
  invoke<T>(
    command: string,
    args?: unknown,
    options?: { headers: Record<string, string> },
  ): Promise<T>;
  Channel: new () => TauriChannel;
}
type Filter = { usbVendorId?: number; usbProductId?: number };
/** Not part of Web Serial: the portal passes 'gps' when choosing a USB GPS receiver. */
type Purpose = 'board' | 'gps';

(() => {
  const core = (window as unknown as { __TAURI__?: { core: TauriCore } }).__TAURI__?.core;
  if (!core || 'serial' in navigator) return;

  const lost = () => new DOMException('The device has been lost.', 'NetworkError');

  class DesktopSerialPort extends EventTarget {
    onconnect: ((event: Event) => void) | null = null;
    ondisconnect: ((event: Event) => void) | null = null;
    connected = true;
    #id: number | undefined;
    #readable: ReadableStream<Uint8Array> | null = null;
    #writable: WritableStream<Uint8Array> | null = null;
    #input: ReadableStreamDefaultController<Uint8Array> | undefined;

    constructor(readonly info: PortInfo) {
      super();
    }
    get readable() {
      return this.#readable;
    }
    get writable() {
      return this.#writable;
    }
    getInfo() {
      return { usbVendorId: this.info.vendorId, usbProductId: this.info.productId };
    }
    async open(options: { baudRate: number }) {
      if (this.#id !== undefined)
        throw new DOMException('The port is already open.', 'InvalidStateError');
      if (!Number.isInteger(options?.baudRate) || options.baudRate < 1)
        throw new TypeError('A valid baudRate is required.');
      const channel = new core!.Channel();
      this.#readable = new ReadableStream<Uint8Array>({
        start: controller => {
          this.#input = controller;
        },
      });
      channel.onmessage = message => {
        const bytes = new Uint8Array(message);
        if (!bytes.length) {
          this.#fail();
          return;
        }
        try {
          this.#input?.enqueue(bytes);
        } catch {
          // Closed while the bytes were on their way.
        }
      };
      const id = await core!.invoke<number>('serial_open', {
        path: this.info.path,
        baudRate: options.baudRate,
        onData: channel,
      });
      this.#id = id;
      this.#writable = new WritableStream<Uint8Array>({
        write: chunk =>
          core!.invoke('serial_write', new Uint8Array(chunk), {
            headers: { 'port-id': String(id) },
          }),
      });
    }
    async setSignals(signals: {
      dataTerminalReady?: boolean;
      requestToSend?: boolean;
      break?: boolean;
    }) {
      if (this.#id === undefined)
        throw new DOMException('The port is not open.', 'InvalidStateError');
      await core!.invoke('serial_set_signals', {
        id: this.#id,
        dtr: signals.dataTerminalReady ?? null,
        rts: signals.requestToSend ?? null,
        brk: signals.break ?? null,
      });
    }
    async getSignals() {
      return {
        dataCarrierDetect: false,
        clearToSend: false,
        ringIndicator: false,
        dataSetReady: false,
      };
    }
    async close() {
      const id = this.#id;
      if (id === undefined) throw new DOMException('The port is not open.', 'InvalidStateError');
      this.#end();
      await core!.invoke('serial_close', { id });
    }
    async forget() {}
    /** Unplugged, or reset into a bootloader: end the streams and tell listeners. */
    gone() {
      this.connected = false;
      this.#fail();
      const event = new Event('disconnect', { bubbles: true });
      this.dispatchEvent(event);
      this.ondisconnect?.(event);
    }
    #fail() {
      const id = this.#id;
      if (id === undefined) return;
      try {
        this.#input?.error(lost());
      } catch {
        // Already ended.
      }
      this.#end(false);
      void core!.invoke('serial_close', { id }).catch(() => {});
    }
    #end(close = true) {
      if (close) {
        try {
          this.#input?.close();
        } catch {
          // Already ended.
        }
      }
      this.#id = undefined;
      this.#input = undefined;
      this.#readable = null;
      this.#writable = null;
    }
  }

  // One object per device: a board that comes back as a different USB device (a bootloader, for
  // example) on the same path is a new port, as it is in a browser.
  const ports = new Map<string, DesktopSerialPort>();
  const key = (info: PortInfo) => `${info.path}|${info.vendorId}|${info.productId}`;

  class DesktopSerial extends EventTarget {
    onconnect: ((event: Event) => void) | null = null;
    ondisconnect: ((event: Event) => void) | null = null;
    async getPorts() {
      await refresh();
      return [...ports.values()];
    }
    async requestPort(options: { filters?: Filter[]; reaperPurpose?: Purpose } = {}) {
      await refresh();
      const filters = options.filters ?? [];
      const matches = [...ports.values()].filter(
        port =>
          !filters.length ||
          filters.some(
            filter =>
              (filter.usbVendorId === undefined || filter.usbVendorId === port.info.vendorId) &&
              (filter.usbProductId === undefined || filter.usbProductId === port.info.productId),
          ),
      );
      const chosen = await choose(matches, options.reaperPurpose ?? 'board');
      if (!chosen) throw new DOMException('No port selected by the user.', 'NotFoundError');
      return chosen;
    }
  }
  const serial = new DesktopSerial();
  Object.defineProperty(navigator, 'serial', { value: serial, configurable: true });

  let refreshing: Promise<void> | undefined;
  function refresh() {
    refreshing ??= core!
      .invoke<PortInfo[]>('serial_list')
      .then(list => {
        const seen = new Set<string>();
        for (const info of list) {
          const id = key(info);
          seen.add(id);
          if (ports.has(id)) continue;
          const port = new DesktopSerialPort(info);
          ports.set(id, port);
          const event = new Event('connect');
          serial.dispatchEvent(event);
          serial.onconnect?.(event);
        }
        for (const [id, port] of ports) {
          if (seen.has(id)) continue;
          ports.delete(id);
          port.gone();
          const event = new Event('disconnect');
          serial.dispatchEvent(event);
          serial.ondisconnect?.(event);
        }
      })
      .catch(() => {})
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  }
  setInterval(() => void refresh(), 1000);

  /** The port picker, in its own shadow root so the page's styles never reach it. */
  function choose(
    candidates: DesktopSerialPort[],
    purpose: Purpose,
  ): Promise<DesktopSerialPort | undefined> {
    const thing = purpose === 'gps' ? 'GPS receiver' : 'board';
    return new Promise(resolve => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>
        :host { all: initial; }
        .scrim { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center;
          background: rgb(0 0 0 / 55%); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
        .sheet { width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 64px); overflow: auto;
          border-radius: 14px; padding: 20px; background: #16181a; color: #eceee9; border: 1px solid #2c3030;
          box-shadow: 0 24px 60px rgb(0 0 0 / 50%); }
        h2 { margin: 0 0 4px; font-size: 17px; }
        p { margin: 0 0 14px; color: #9ba29b; }
        ul { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 8px; }
        button { font: inherit; cursor: pointer; }
        .port { width: 100%; text-align: left; padding: 10px 12px; border-radius: 10px;
          border: 1px solid #2c3030; background: #1d2022; color: inherit; }
        .port:hover, .port:focus-visible { border-color: #9fd18b; outline: none; }
        .port small { display: block; color: #9ba29b; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
        .actions { display: flex; justify-content: flex-end; }
        .cancel { padding: 8px 14px; border-radius: 999px; border: 1px solid #2c3030; background: transparent; color: inherit; }
        @media (prefers-color-scheme: light) {
          .sheet { background: #fbfbf8; color: #1b1e1c; border-color: #dfe2dc; }
          .port { background: #fff; border-color: #dfe2dc; }
          p, .port small { color: #5d645e; }
          .cancel { border-color: #dfe2dc; }
          .port:hover, .port:focus-visible { border-color: #3f7f2c; }
        }
      </style>
      <div class="scrim" role="dialog" aria-modal="true" aria-labelledby="title">
        <div class="sheet">
          <h2 id="title">Choose your ${thing}'s USB port</h2>
          <p></p>
          <ul></ul>
          <div class="actions"><button class="cancel" type="button">Cancel</button></div>
        </div>
      </div>`;
      const list = root.querySelector('ul')!;
      root.querySelector('p')!.textContent = candidates.length
        ? `Plug in your ${thing} with a USB data cable if it is not listed.`
        : `No matching USB device is connected. Plug in your ${thing} with a USB data cable, then try again.`;
      const finish = (port?: DesktopSerialPort) => {
        document.removeEventListener('keydown', onKey, true);
        host.remove();
        resolve(port);
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') finish();
      };
      for (const port of candidates) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.className = 'port';
        button.type = 'button';
        const name = [port.info.product, port.info.manufacturer].filter(Boolean).join(' · ');
        button.textContent = name || 'USB serial device';
        const detail = document.createElement('small');
        detail.textContent = `${port.info.path} · ${port.info.vendorId.toString(16).padStart(4, '0')}:${port.info.productId.toString(16).padStart(4, '0')}`;
        button.append(detail);
        button.addEventListener('click', () => finish(port));
        item.append(button);
        list.append(item);
      }
      root.querySelector('.cancel')!.addEventListener('click', () => finish());
      document.addEventListener('keydown', onKey, true);
      document.documentElement.append(host);
      root.querySelector<HTMLButtonElement>('.port, .cancel')?.focus();
    });
  }
})();
