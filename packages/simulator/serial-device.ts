import { ConfigDevice } from './config-device.ts';
import { FrameDecoder, encodeFrame } from '../protocol/framing.ts';
import { decodeMessage, encodeMessage, type Message } from '../protocol/messages.ts';
import type { SerialPortLike } from '../agent-core/serial.ts';
import {
  DEFAULT_CHANNEL_IDS,
  DEFAULT_CHANNELS,
  validChannels,
  type RadioConfig,
} from '../protocol/radio-config.ts';

/** In-memory browser/host demo. Radio settings are stored only; no radio or flash is simulated. */
export class SimulatedDevice {
  readonly config = new ConfigDevice();
  nextFault: 'none' | 'lose-result' | 'disconnect' = 'none';
  readOnly = false;
  radio: RadioConfig = {
    mode: 'off',
    power: 0,
    relay: false,
    channels: DEFAULT_CHANNELS,
    channelIds: DEFAULT_CHANNEL_IDS,
    preset: 'US915_LAB1',
  };
  #lostId: string | undefined;
  #disconnect: (() => void) | undefined;

  reboot() {
    this.config.reboot();
    this.#lostId = undefined;
    this.#disconnect?.();
  }

  createPort(): SerialPortLike {
    let input!: ReadableStreamDefaultController<Uint8Array>;
    let live = false;
    let link: string | undefined;
    let owner: string | undefined;
    let admitted = false;
    const decoder = new FrameDecoder();
    const disconnect = () => {
      if (live) {
        live = false;
        input.error(new Error('simulated disconnect'));
      }
    };
    const reply = (message: Message) => {
      if (live) input.enqueue(encodeFrame(encodeMessage(message)));
    };
    return {
      readable: new ReadableStream({
        start(controller) {
          input = controller;
        },
        cancel() {
          live = false;
        },
      }),
      writable: new WritableStream({
        write: bytes => {
          if (!live) throw new Error('simulated port closed');
          decoder.feed(bytes, payload => {
            const message = decodeMessage(payload);
            const boot = this.config.boot;
            if (message.type === 'hello') {
              link = message.link;
              owner = message.owner;
              admitted = !!owner && this.config.admit(owner);
              reply({
                type: 'welcome',
                link,
                device: 'demo-heltec-v3',
                boot,
                minVersion: 1,
                maxVersion: 1,
                configSchema: 1,
                features: this.readOnly ? 2 : 7 | 16 | 1024,
                radioSchema: 1,
                maxChannels: 8,
                channelIdVersion: 1,
                maxPayload: 2048,
                receiptCapacity: this.config.capacity,
                ownerCapacity: this.config.ownerCapacity,
                ownerAdmitted: admitted ? 1 : 0,
                regions: 3,
                maxLabelBytes: 64,
                firmware: 'simulator-0',
                radioVersion: 0,
              });
              return;
            }
            if (!link || message.link !== link) return;
            if (message.type === 'ping')
              reply({ type: 'pong', link, boot, request: message.request });
            if ('boot' in message && message.boot !== boot) return;
            if (message.type === 'sync')
              reply({
                type: 'snapshot',
                link,
                boot,
                request: message.request,
                sequence: this.config.revision,
                revision: this.config.revision,
                region: this.config.config.region,
                label: this.config.config.label,
                radioMode: this.radio.mode,
                txPower: this.radio.power,
                relay: this.radio.relay ? 1 : 0,
                channels: this.radio.channels,
                channelIds: this.radio.channelIds,
                preset: this.radio.preset,
              } as Message);
            if (message.type === 'query') {
              const result = this.config.query(message.id);
              reply({
                type: 'result',
                link,
                ...result,
                revision: result.revision ?? this.config.revision,
              });
            }
            if (message.type === 'configure') {
              if (this.readOnly || !admitted || !message.id.startsWith(`${owner}:`)) {
                reply({
                  type: 'result',
                  link,
                  boot,
                  id: message.id,
                  outcome: 'rejected',
                  revision: this.config.revision,
                });
                return;
              }
              const radio = message.channels !== undefined;
              if (
                radio &&
                (message.channelIds === undefined ||
                  !validChannels(message.channels!, message.channelIds))
              ) {
                reply({
                  type: 'result',
                  link,
                  boot,
                  id: message.id,
                  outcome: 'rejected',
                  revision: this.config.revision,
                });
                return;
              }
              const fault = this.nextFault;
              this.nextFault = 'none';
              if (fault === 'lose-result') this.#lostId = message.id;
              const result = this.config.apply({
                id: message.id,
                boot,
                expectedRevision: message.expectedRevision,
                config: { region: message.region, label: message.label },
              });
              if (radio && result.outcome === 'committed')
                this.radio = {
                  ...this.radio,
                  mode: message.radioMode!,
                  power: message.txPower!,
                  relay: message.relay === 1,
                  channels: message.channels!,
                  channelIds: message.channelIds!,
                };
              if (fault === 'disconnect') {
                disconnect();
                return;
              }
              if (this.#lostId !== message.id)
                reply({
                  type: 'result',
                  link,
                  ...result,
                  revision: result.revision ?? this.config.revision,
                });
            }
          });
        },
      }),
      open: async () => {
        if (this.#disconnect) throw new Error('simulated device already connected');
        live = true;
        this.#disconnect = disconnect;
      },
      close: async () => {
        live = false;
        if (this.#disconnect === disconnect) this.#disconnect = undefined;
      },
    };
  }
}
