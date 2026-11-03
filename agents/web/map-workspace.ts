import { mapMessageAction } from './map-message.ts';
import { canonicalNode } from './conversations.ts';
import {
  MAP_PREFIX,
  decodeMap,
  encodeMap,
  validateMapItem,
  type MapItem,
  type MapOperation,
} from '../../packages/protocol/map-item.ts';
import {
  availableTypes,
  parsePlugin,
  validateFieldValue,
  type Plugin,
  type PluginField,
} from './plugins.ts';
import { MapStore, type SharedPayload } from './map-store.ts';
import type { FieldMap } from './map.ts';
import type { ReceivedMessage } from '../../packages/agent-core/inbox.ts';
type Context = {
  channels: string[];
  ready: boolean;
  device?: string;
  source: string;
  messages: readonly ReceivedMessage[];
  sent: readonly { id: string; state: string; reason?: string; text: string }[];
  block?: string;
};
type Host = {
  openMap?(): void;
  writable(): boolean;
  stopped(): boolean;
  context(): Context;
  decode(payload: SharedPayload, identity?: string): string | undefined;
  budget(channel: number): number;
  send(text: string, destination: string, channel: number): string;
};
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function button(label: string, action: () => void, className = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = className;
  b.onclick = action;
  return b;
}
function paragraph(text: string) {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function inputs(container: HTMLElement, fields: PluginField[], values: Record<string, unknown>) {
  container.replaceChildren();
  for (const field of fields) {
    const wrap = document.createElement('label');
    wrap.textContent = field.label;
    const input =
      field.type === 'select' ? document.createElement('select') : document.createElement('input');
    input.dataset.field = field.id;
    if (input instanceof HTMLSelectElement)
      for (const option of field.options!) input.add(new Option(option, option));
    else
      input.type =
        field.type === 'boolean' ? 'checkbox' : field.type === 'number' ? 'number' : 'text';
    if (input instanceof HTMLInputElement && input.type === 'number') input.step = 'any';
    const value =
      values[field.id] ??
      field.default ??
      (field.type === 'boolean' ? false : field.type === 'number' ? 0 : (field.options?.[0] ?? ''));
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
      input.checked = !!value;
      wrap.className = 'check';
    } else input.value = String(value);
    wrap.append(input);
    container.append(wrap);
  }
}
function values(container: HTMLElement, fields: PluginField[]) {
  const result: MapItem['metadata'] = Object.create(null);
  for (const field of fields) {
    const input = container.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[data-field="${field.id}"]`,
    )!;
    const value =
      field.type === 'boolean'
        ? (input as HTMLInputElement).checked
        : field.type === 'number'
          ? Number(input.value)
          : input.value;
    validateFieldValue(field, value);
    result[field.id] = value;
  }
  return result;
}
export class MapWorkspace {
  #store?: MapStore;
  #error = '';
  #signature = '';
  #seen = new Set<string>();
  #draft?: MapItem;
  #editRevision = 0;
  #tool?: 'point' | 'rectangle';
  #corner?: number[];
  #selected?: { item: MapItem; key?: string; payload?: SharedPayload };
  #manifest?: Plugin;
  #lastSend?: { id: string; source: string };
  private map: FieldMap;
  private host: Host;
  constructor(
    map: FieldMap,
    host: Host,
    storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  ) {
    this.map = map;
    this.host = host;
    const tools = document.createElement('section');
    tools.id = 'map-workspace';
    tools.setAttribute('aria-label', 'Map tools');
    tools.innerHTML = `<div class="map-toolbar"><button id="map-add-point" type="button">Add point</button><button id="map-add-area" type="button">Draw area</button><button id="map-cancel-tool" type="button" hidden>Cancel drawing</button></div>
      <p id="map-tool-hint" role="status">Click the map to add a point, or use the tools above.</p>
      <div class="map-layers"><label class="check"><input id="map-show-items" type="checkbox" checked>Map items</label><label class="check"><input id="map-show-devices" type="checkbox" checked>Devices</label></div>
      <p id="map-workspace-error" class="warning" role="alert" hidden></p><p id="map-share-state" role="status"></p>
      <details open><summary>Saved map items</summary><label class="sr-only" for="map-item-search">Search map items</label><input id="map-item-search" type="search" placeholder="Search map items"><div id="map-item-list"></div></details>
      <button id="map-export" type="button">Export map workspace</button><p class="small muted">Local items are saved in this browser in plaintext. Encrypted received items retain ciphertext. Sharing requires a connected device.</p>`;
    const tracker = document.querySelector('.tracker-pane')!;
    const sidebar = document.createElement('div');
    sidebar.id = 'map-side-panel';
    const devices = document.createElement('details');
    devices.id = 'map-devices';
    devices.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Nearby devices';
    summary.append(document.createTextNode(' '), $('node-count'));
    devices.append(summary);
    for (const child of [...tracker.children])
      if (!child.classList.contains('tracker-heading') && !child.classList.contains('map-pane'))
        devices.append(child);
    sidebar.append(tools, devices);
    tracker.append(sidebar);
    const dialogs = document.createElement('div');
    dialogs.innerHTML = `
      <dialog id="map-location" class="manage map-dialog" aria-labelledby="map-location-title"><form method="dialog" class="manage-head"><h2 id="map-location-title">Add to map</h2><button>Cancel</button></form><div class="manage-body"><p id="map-location-coordinates"></p><div class="actions"><button id="map-location-point">Add point here</button><button id="map-location-area">Draw area from here</button></div></div></dialog>
      <dialog id="map-editor" class="manage map-dialog" aria-labelledby="map-editor-title"><div class="manage-head"><h2 id="map-editor-title">Map item</h2><button id="map-editor-cancel" type="button">Cancel</button></div><form id="map-item-form" class="manage-body">
      <label for="map-type">Type</label><select id="map-type"></select><div class="columns"><div><label for="map-name">Name</label><input id="map-name" required maxlength="48"></div><div><label for="map-color">Color</label><input id="map-color" type="color" value="#78c5ab"></div></div>
      <div class="coordinate-fields"><div><label for="map-lat">Latitude / north</label><input id="map-lat" type="number" step="0.0000001" min="-90" max="90" required></div><div><label for="map-lng">Longitude / west</label><input id="map-lng" type="number" step="0.0000001" min="-180" max="180" required></div><div class="area-coordinate"><label for="map-south">South latitude</label><input id="map-south" type="number" step="0.0000001" min="-90" max="90"></div><div class="area-coordinate"><label for="map-east">East longitude</label><input id="map-east" type="number" step="0.0000001" min="-180" max="180"></div></div>
      <label for="map-note">Short note</label><input id="map-note" maxlength="160"><div id="map-custom-fields"></div><p id="map-editor-error" class="warning" role="alert"></p><p class="small muted">Save locally first. Nothing is sent until you choose Share.</p><div class="actions"><button type="submit" class="primary">Save map item</button></div></form></dialog>
      <dialog id="map-detail" class="manage map-dialog" aria-labelledby="map-detail-title"><form method="dialog" class="manage-head"><h2 id="map-detail-title">Map item</h2><button>Close</button></form><div class="manage-body"><div id="map-detail-body"></div><div id="map-detail-actions" class="actions"></div></div></dialog>
      <dialog id="map-share" class="manage map-dialog" aria-labelledby="map-share-title"><form method="dialog" class="manage-head"><h2 id="map-share-title">Share map item</h2><button>Cancel</button></form><form id="map-share-form" class="manage-body"><p id="map-share-summary"></p><label for="map-share-channel">Channel</label><select id="map-share-channel"></select><label for="map-share-destination">Recipient</label><input id="map-share-destination" value="broadcast" required placeholder="broadcast or node ID"><p class="small muted">Use broadcast for everyone on the channel, or enter a node ID for direct sharing. Recipients can add it to their map from its message card.</p><label for="map-share-operation">Action</label><select id="map-share-operation"><option value="put">Share item / update</option><option value="withdraw">Request removal of my shared item</option></select><p id="map-share-budget" role="status"></p><p id="map-share-error" class="warning" role="alert"></p><div class="actions"><button id="map-share-send" class="primary" type="submit">Share</button></div></form></dialog>
      <dialog id="plugin-preview" class="manage map-dialog" aria-labelledby="plugin-preview-title"><form method="dialog" class="manage-head"><h2 id="plugin-preview-title">Review plugin</h2><button>Cancel</button></form><div class="manage-body"><div id="plugin-preview-body"></div><button id="plugin-install-confirm" class="primary">Install / update plugin</button><p id="plugin-install-error" role="alert"></p></div></dialog>
      <dialog id="plugin-settings-dialog" class="manage map-dialog" aria-labelledby="plugin-settings-title"><form method="dialog" class="manage-head"><h2 id="plugin-settings-title">Plugin settings</h2><button>Cancel</button></form><form id="plugin-settings-form" class="manage-body"><div id="plugin-settings-fields"></div><p id="plugin-settings-error" role="alert"></p><button class="primary">Save settings</button></form></dialog>`;
    document.body.append(dialogs);
    const nav = document.querySelector('.manage-tabs')!;
    const pluginTab = button(
      'Plugins',
      () => {
        document.querySelectorAll<HTMLElement>('[data-manage-panel]').forEach(p => {
          p.hidden = p.dataset.managePanel !== 'plugins';
          p.classList.toggle('is-active', !p.hidden);
        });
        document.querySelectorAll<HTMLElement>('.manage-tab').forEach(t => {
          t.classList.toggle('is-active', t === pluginTab);
          if (t === pluginTab) t.setAttribute('aria-current', 'page');
          else t.removeAttribute('aria-current');
        });
        $('advanced-settings').removeAttribute('open');
        document.querySelector('.manage-body')!.scrollTop = 0;
      },
      'manage-tab',
    );
    pluginTab.dataset.manage = 'plugins';
    nav.insertBefore(pluginTab, $('advanced-settings'));
    const panel = document.createElement('section');
    panel.className = 'manage-panel';
    panel.dataset.managePanel = 'plugins';
    panel.hidden = true;
    panel.innerHTML = `<div class="section-toolbar"><h2>Plugins</h2><label class="plugin-import">Install / update JSON<input id="plugin-file" type="file" accept="application/json,.json"></label></div><p class="small muted">Plugins add map types, fields and settings without changing the app. JSON definitions cannot execute code or send messages. Settings apply to this browser. Removing a plugin preserves map items.</p><div id="plugin-list"></div>`;
    document.querySelector('#manage > .manage-body')!.append(panel);
    try {
      this.#store = new MapStore(storage, () => host.writable());
    } catch (e) {
      this.#error = `Map storage unavailable: ${String(e)}. Saved data was not changed.`;
    }
    this.map.onLocation = (lat, lng) => this.#location(lat, lng);
    this.map.onAnnotation = (key, context) => {
      const selected = this.#displayItems().find(x => x.key === key);
      if (selected) this.#detail(selected.item, selected.sharedKey, selected.payload, context);
    };
    $('map-add-point').onclick = () => this.#setTool('point');
    $('map-add-area').onclick = () => this.#setTool('rectangle');
    $('map-cancel-tool').onclick = () => this.#setTool();
    $('map-show-items').onchange = $('map-show-devices').onchange = () => {
      this.#signature = '';
      this.update();
    };
    $('map-item-search').oninput = () => {
      this.#signature = '';
      this.update();
    };
    $('map-export').onclick = () => {
      if (this.#store) download('reaper-map-workspace.json', this.#store.export());
    };
    $('map-editor-cancel').onclick = () => $<HTMLDialogElement>('map-editor').close();
    $('map-type').onchange = () => {
      const t = this.#types().find(t => t.id === $<HTMLSelectElement>('map-type').value);
      if (t) {
        $<HTMLInputElement>('map-color').value = t.defaultColor;
        inputs($('map-custom-fields'), t.fields, {});
      }
    };
    $('map-item-form').onsubmit = event => {
      event.preventDefault();
      this.#save();
    };
    $('map-share-form').onsubmit = event => {
      event.preventDefault();
      this.#send();
    };
    $('map-share-channel').onchange = $('map-share-operation').onchange = () => this.#budget();
    $('plugin-file').onchange = () => void this.#import();
    $('plugin-install-confirm').onclick = () => {
      try {
        if (!this.#manifest) return;
        this.#store!.install(this.#manifest);
        this.#signature = '';
        $<HTMLDialogElement>('plugin-preview').close();
        this.update();
      } catch (e) {
        $('plugin-install-error').textContent = String(e);
      }
    };
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.#setTool();
    });
  }
  #run(action: () => void) {
    try {
      action();
      this.#error = '';
      this.#signature = '';
      this.update();
    } catch (e) {
      this.#error = String(e);
      this.#signature = '';
      this.update();
    }
  }
  #types() {
    return availableTypes(this.#store?.state.plugins ?? []);
  }
  #setTool(tool?: 'point' | 'rectangle') {
    this.#tool = tool;
    this.#corner = undefined;
    this.map.map.getContainer().style.cursor = tool ? 'crosshair' : '';
    $('map-cancel-tool').hidden = !tool;
    $('map-tool-hint').textContent =
      tool === 'rectangle'
        ? 'Click two opposite corners to draw a rectangle. Escape cancels.'
        : tool
          ? 'Click the map to place your point. Escape cancels.'
          : 'Click the map to add a point, or use the tools above.';
  }
  #location(lat: number, lng: number) {
    if (!this.#store || this.host.stopped() || document.querySelector('dialog[open]')) return;
    const point = [
      Math.round((Math.max(-90, Math.min(90, lat)) + 90) * 1e7),
      Math.round(((((lng + 180) % 360) + 360) % 360) * 1e7),
    ];
    if (this.#tool === 'point') {
      this.#setTool();
      this.#edit(undefined, 'point', point);
    } else if (this.#tool === 'rectangle') {
      if (!this.#corner) {
        this.#corner = point;
        $('map-tool-hint').textContent = 'Now click the opposite corner.';
      } else {
        const a = this.#corner;
        this.#setTool();
        this.#edit(undefined, 'rectangle', [
          Math.max(a[0], point[0]),
          Math.min(a[1], point[1]),
          Math.min(a[0], point[0]),
          Math.max(a[1], point[1]),
        ]);
      }
    } else {
      $('map-location-coordinates').textContent =
        `${(point[0] / 1e7 - 90).toFixed(7)}, ${(point[1] / 1e7 - 180).toFixed(7)}`;
      $('map-location-point').onclick = () => {
        $<HTMLDialogElement>('map-location').close();
        this.#edit(undefined, 'point', point);
      };
      $('map-location-area').onclick = () => {
        $<HTMLDialogElement>('map-location').close();
        this.#setTool('rectangle');
        this.#corner = point;
        $('map-tool-hint').textContent = 'Now click the opposite corner.';
      };
      $<HTMLDialogElement>('map-location').showModal();
    }
  }
  #edit(item?: MapItem, geometry: MapItem['geometry'] = 'point', coordinates: number[] = []) {
    const types = this.#types().filter(t => t.geometry === (item?.geometry ?? geometry));
    this.#draft = item
      ? structuredClone(item)
      : {
          id: crypto.randomUUID(),
          revision: 1,
          geometry,
          type: types[0].id,
          name: '',
          color: types[0].defaultColor,
          note: '',
          coordinates,
          metadata: {},
        };
    this.#editRevision = item?.revision ?? 0;
    const d = this.#draft;
    const select = $<HTMLSelectElement>('map-type');
    select.replaceChildren();
    for (const t of types) select.add(new Option(t.name, t.id));
    if (!types.some(t => t.id === d.type))
      select.add(new Option(`Unavailable type · ${d.type}`, d.type));
    select.value = d.type;
    $<HTMLInputElement>('map-name').value = d.name;
    $<HTMLInputElement>('map-color').value = d.color;
    $<HTMLInputElement>('map-note').value = d.note;
    for (const [i, id] of ['map-lat', 'map-lng', 'map-south', 'map-east'].entries())
      $<HTMLInputElement>(id).value = (
        (d.coordinates[i] ?? (i % 2 ? 180e7 : 90e7)) / 1e7 -
        (i % 2 ? 180 : 90)
      ).toFixed(7);
    document.querySelectorAll<HTMLElement>('.area-coordinate').forEach(x => {
      x.hidden = d.geometry !== 'rectangle';
    });
    inputs($('map-custom-fields'), types.find(t => t.id === d.type)?.fields ?? [], d.metadata);
    $('map-editor-error').textContent = '';
    $('map-editor-title').textContent = item
      ? 'Edit map item'
      : geometry === 'point'
        ? 'Add point'
        : 'Add rectangle';
    $<HTMLDialogElement>('map-editor').showModal();
  }
  #save() {
    try {
      const draft = this.#draft!,
        fields =
          this.#types().find(t => t.id === $<HTMLSelectElement>('map-type').value)?.fields ?? [];
      const coordinates = [
        'map-lat',
        'map-lng',
        ...(draft.geometry === 'rectangle' ? ['map-south', 'map-east'] : []),
      ].map((id, i) =>
        Math.round((Number($<HTMLInputElement>(id).value) + (i % 2 ? 180 : 90)) * 1e7),
      );
      const item = validateMapItem({
        ...draft,
        revision: this.#editRevision + 1,
        type: $<HTMLSelectElement>('map-type').value,
        name: $<HTMLInputElement>('map-name').value,
        note: $<HTMLInputElement>('map-note').value,
        color: $<HTMLInputElement>('map-color').value,
        coordinates,
        metadata: { ...draft.metadata, ...values($('map-custom-fields'), fields) },
      });
      this.#store!.save(item);
      $<HTMLDialogElement>('map-editor').close();
      this.#signature = '';
      this.update();
    } catch (e) {
      $('map-editor-error').textContent = String(e);
    }
  }
  #decoded(payload: SharedPayload): MapOperation | undefined {
    try {
      const text = this.host.decode(payload);
      return text ? decodeMap(text) : undefined;
    } catch {
      return;
    }
  }
  #displayItems() {
    const state = this.#store?.state;
    if (!state) return [];
    const rows: { key: string; item: MapItem; sharedKey?: string; payload?: SharedPayload }[] =
      state.local.map(item => ({ key: 'local:' + item.id, item }));
    for (const row of state.shared)
      if (row.accepted) {
        const op = this.#decoded(row.accepted);
        if (op?.operation === 'put')
          rows.push({ key: row.key, sharedKey: row.key, item: op.item, payload: row.accepted });
      }
    return rows;
  }
  #detail(item: MapItem, key?: string, payload?: SharedPayload, context = false) {
    $('map-detail').classList.toggle('context-actions', context);
    $('map-detail-body').hidden = context;
    this.#selected = { item, key, payload };
    $('map-detail-title').textContent = item.name;
    const body = $('map-detail-body');
    body.replaceChildren(
      paragraph(
        `${item.geometry} · ${this.#types().find(t => t.id === item.type)?.name ?? item.type + ' (plugin unavailable)'}`,
      ),
      paragraph(item.note),
      paragraph(
        item.coordinates.map((v, i) => (v / 1e7 - (i % 2 ? 180 : 90)).toFixed(7)).join(', '),
      ),
    );
    if (payload?.ciphertext)
      body.append(
        paragraph(
          'Making your own copy saves its decrypted contents as a plaintext local map item.',
        ),
      );
    if (payload)
      body.append(
        paragraph(
          `Reported source: ${payload.origin} · channel ${payload.channel}. Node identity is not authenticated.`,
        ),
      );
    for (const [field, value] of Object.entries(item.metadata))
      body.append(paragraph(`${field}: ${String(value)}`));
    const actions = $('map-detail-actions');
    actions.replaceChildren();
    if (!key) {
      actions.append(
        button('Edit', () => {
          $<HTMLDialogElement>('map-detail').close();
          this.#edit(item);
        }),
        button(
          'Share…',
          () => {
            $<HTMLDialogElement>('map-detail').close();
            this.#share(item);
          },
          'primary',
        ),
        button(
          'Delete locally',
          () => {
            if (confirm('Delete this local map item? Shared copies on other agents remain.'))
              this.#run(() => {
                this.#store!.remove(item.id);
                $<HTMLDialogElement>('map-detail').close();
              });
          },
          'danger',
        ),
      );
    } else {
      actions.append(
        button('Make my own copy', () =>
          this.#run(() => {
            const copy = { ...item, id: crypto.randomUUID(), revision: 1 };
            this.#store!.save(copy);
            $<HTMLDialogElement>('map-detail').close();
            this.#edit(copy);
          }),
        ),
        button('Remove from my map', () => {
          if (confirm('Remove this accepted item from your map? The original sender keeps it.'))
            this.#run(() => {
              this.#store!.hide(key);
              $<HTMLDialogElement>('map-detail').close();
            });
        }),
      );
    }
    actions.append(
      button('Locate', () => {
        $<HTMLDialogElement>('map-detail').close();
        this.map.focusAnnotation(item);
      }),
    );
    $<HTMLDialogElement>('map-detail').showModal();
  }
  #share(item: MapItem) {
    this.#selected = { item };
    const context = this.host.context(),
      select = $<HTMLSelectElement>('map-share-channel');
    select.replaceChildren();
    context.channels.forEach((name, slot) => {
      if (name) select.add(new Option(`${slot} · ${name}`, String(slot)));
    });
    $<HTMLInputElement>('map-share-destination').value = 'broadcast';
    $<HTMLSelectElement>('map-share-operation').value = 'put';
    $('map-share-summary').textContent = item.name;
    $('map-share-error').textContent = '';
    this.#budget();
    $<HTMLDialogElement>('map-share').showModal();
  }
  #outgoing(): MapOperation {
    const item = structuredClone(this.#selected!.item),
      type = this.#types().find(t => t.id === item.type);
    // Only explicitly shared plugin fields leave this agent. Unknown metadata is preserved for fallback copies.
    item.metadata = type
      ? Object.fromEntries(
          Object.entries(item.metadata).filter(([key]) =>
            type.fields.some(f => f.id === key && f.shared),
          ),
        )
      : {};
    item.revision++; // Every explicit share intent advances beyond prior updates/withdrawals.
    return {
      operation: $<HTMLSelectElement>('map-share-operation').value as 'put' | 'withdraw',
      item,
    };
  }
  #budget() {
    try {
      const channel = Number($<HTMLSelectElement>('map-share-channel').value),
        wire = encodeMap(this.#outgoing(), this.host.budget(channel)),
        context = this.host.context();
      $('map-share-budget').textContent =
        `${new TextEncoder().encode(wire).length} / ${this.host.budget(channel)} bytes · ${context.block ?? (context.ready ? 'Device ACK does not mean the recipient accepted the map item.' : 'Connect a device to share.')}`;
      $<HTMLButtonElement>('map-share-send').disabled = !context.ready || !!context.block;
    } catch (e) {
      $('map-share-budget').textContent = String(e);
      $<HTMLButtonElement>('map-share-send').disabled = true;
    }
  }
  #send() {
    try {
      const op = this.#outgoing(),
        channel = Number($<HTMLSelectElement>('map-share-channel').value),
        destination = $<HTMLInputElement>('map-share-destination').value.trim();
      if (!/^(broadcast|node-[0-9a-f]{16})$/.test(destination))
        throw Error('Use broadcast or a canonical node-016hex ID.');
      const wire = encodeMap(op, this.host.budget(channel));
      const local = { ...this.#selected!.item, revision: op.item.revision };
      this.#store!.save(local);
      this.#selected = { item: local }; // Never strip local-only fields from saved data.
      const id = this.host.send(wire, destination, channel);
      this.#lastSend = { id, source: this.host.context().source };
      $<HTMLDialogElement>('map-share').close();
      this.#signature = '';
      this.update();
    } catch (e) {
      $('map-share-error').textContent = String(e);
    }
  }
  async #import() {
    const input = $<HTMLInputElement>('plugin-file'),
      file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 65536) throw Error('Plugin exceeds 64 KiB');
      this.#manifest = parsePlugin(await file.text());
      if (this.host.stopped()) return;
      const p = this.#manifest,
        prior = this.#store?.state.plugins.find(x => x.manifest.id === p.id);
      $('plugin-preview-body').replaceChildren(
        paragraph(`${p.name} · ${p.version} · ${p.id}`),
        paragraph(
          `${p.types.length} map types; ${p.settings.length} settings. No scripts, networking or key access.`,
        ),
        paragraph(
          prior
            ? `Replaces ${prior.manifest.version}. Compatible settings are retained; incompatible settings block the update. Existing item metadata is preserved.`
            : 'Installs into this browser only.',
        ),
        ...p.types.map(t => paragraph(`${t.name} · ${t.geometry} · ${t.fields.length} fields`)),
      );
      $('plugin-install-error').textContent = '';
      $<HTMLDialogElement>('plugin-preview').showModal();
    } catch (e) {
      this.#error = String(e);
      this.#signature = '';
      this.update();
    } finally {
      input.value = '';
    }
  }
  #pluginSettings(id: string) {
    const plugin = this.#store!.state.plugins.find(p => p.manifest.id === id)!;
    $('plugin-settings-title').textContent = plugin.manifest.name;
    inputs($('plugin-settings-fields'), plugin.manifest.settings, plugin.settings);
    $('plugin-settings-error').textContent = '';
    $('plugin-settings-form').onsubmit = e => {
      e.preventDefault();
      try {
        this.#store!.plugin(
          id,
          'settings',
          values($('plugin-settings-fields'), plugin.manifest.settings),
        );
        $<HTMLDialogElement>('plugin-settings-dialog').close();
        this.#signature = '';
        this.update();
      } catch (error) {
        $('plugin-settings-error').textContent = String(error);
      }
    };
    $<HTMLDialogElement>('plugin-settings-dialog').showModal();
  }
  get messageVersion() {
    return JSON.stringify(this.#store?.state.shared ?? []) + this.host.writable();
  }
  messageCard(wire: string, payload?: SharedPayload): HTMLElement | undefined {
    let op: MapOperation | undefined;
    try {
      op = decodeMap(wire);
    } catch {
      const error = paragraph('Shared map item · invalid or unsupported data');
      error.className = 'warning';
      return error;
    }
    if (!op) return;
    const card = document.createElement('article');
    card.className = 'map-message-card';
    const title = document.createElement('strong');
    title.textContent = op.item.name;
    const type = this.#types().find(t => t.id === op!.item.type);
    const swatch = document.createElement('span');
    swatch.className = 'map-message-swatch';
    swatch.style.backgroundColor = op.item.color;
    swatch.setAttribute('aria-hidden', 'true');
    const heading = document.createElement('div');
    heading.className = 'map-message-heading';
    heading.append(swatch, title);
    card.append(
      heading,
      paragraph(
        `${op.operation === 'withdraw' ? 'Removal request · ' : ''}${op.item.geometry === 'point' ? 'Point' : 'Rectangle'} · ${type?.name ?? op.item.type}`,
      ),
      paragraph(op.item.note),
      paragraph(
        op.item.coordinates.map((v, i) => (v / 1e7 - (i % 2 ? 180 : 90)).toFixed(7)).join(', '),
      ),
    );
    for (const [key, value] of Object.entries(op.item.metadata))
      card.append(
        paragraph(`${type?.fields.find(f => f.id === key)?.label ?? key}: ${String(value)}`),
      );
    if (payload) {
      const key = `${payload.channel}:${canonicalNode(payload.origin)}:${op.item.id}`;
      const record = this.#store?.state.shared.find(row => row.key === key);
      const acceptedRevision = record?.accepted
        ? this.#decoded(record.accepted)?.item.revision
        : undefined;
      const state = mapMessageAction(op, record, acceptedRevision);
      const action = button(
        state.label,
        () => {
          try {
            if (!this.#store)
              throw Error('Map storage is unavailable. Your saved data was preserved.');
            this.#store.receive(op!, payload);
            const current = this.#store.state.shared.find(row => row.key === key);
            if (!current?.pending || current.highest !== op!.item.revision)
              throw Error('This item has changed. Review its latest message.');
            const pending = this.#decoded(current.pending);
            if (!pending || encodeMap(pending) !== encodeMap(op!))
              throw Error('Conflicting map revision; nothing was applied.');
            this.#store.decide(key, op!.item.revision, true, op!);
            this.#signature = '';
            this.update();
            document.dispatchEvent(new Event('map-message-change'));
          } catch (error) {
            feedback.textContent = String(error);
          }
        },
        'primary',
      );
      action.disabled = !state.actionable || !this.#store || !this.host.writable();
      const feedback = paragraph('');
      feedback.setAttribute('role', 'status');
      card.append(action, feedback);
      if (acceptedRevision === op.item.revision && op.operation === 'put')
        card.append(
          button('View on map', () => {
            this.host.openMap?.();
            this.map.focusAnnotation(op!.item);
          }),
        );
      if (state.actionable && !this.host.writable())
        feedback.textContent = 'This browser tab cannot save map changes.';
    } else card.append(paragraph('Shared by you · recipient acceptance is not reported.'));
    return card;
  }
  update() {
    if (this.host.stopped()) {
      this.#signature = '';
      this.#selected = this.#draft = undefined;
      for (const id of ['map-item-list', 'map-detail-body']) $(id).replaceChildren();
      this.map.setAnnotations([], false, false);
      return;
    }
    const context = this.host.context();
    if (this.#store && this.host.writable())
      for (const message of context.messages) {
        const identity = `${context.source}:${message.device}:${canonicalNode(message.origin)}:${message.messageId}`;
        if (this.#seen.has(identity)) continue;
        const payload: SharedPayload = {
          origin: canonicalNode(message.origin),
          destination: message.destination ?? 'broadcast',
          channel: message.channel,
          ...(message.payloadHex ? { ciphertext: message.payloadHex } : { text: message.text }),
        };
        try {
          const text = this.host.decode(payload, identity);
          if (text === undefined) continue;
          const op = decodeMap(text);
          if (op) this.#store.receive(op, payload);
          this.#seen.add(identity);
          while (this.#seen.size > 1024) this.#seen.delete(this.#seen.values().next().value!);
        } catch (e) {
          this.#error = `Shared map item not imported: ${String(e)}`;
        }
      }
    if ($<HTMLDialogElement>('map-share').open) this.#budget();
    if (this.#lastSend) {
      const sent =
        context.source === this.#lastSend.source
          ? context.sent.find(x => x.id === this.#lastSend!.id)
          : undefined;
      $('map-share-state').textContent = sent
        ? `Last share: ${sent.state}${sent.reason ? ' · ' + sent.reason : ''} · recipient acceptance is not reported`
        : 'Last share belongs to another connection source or has left recovery history.';
    }
    const state = this.#store?.state,
      rows = this.#displayItems(),
      filter = $<HTMLInputElement>('map-item-search').value.toLowerCase();
    if (rows.length) {
      $('map-empty').hidden = true;
      $('map-caption').textContent =
        `${rows.length} map ${rows.length === 1 ? 'item' : 'items'} · device positions shown separately`;
    }
    const signature = JSON.stringify([state, rows, filter, this.#error, this.host.writable()]);
    if (signature === this.#signature) return;
    this.#signature = signature;
    $('map-workspace-error').textContent = this.#error;
    $('map-workspace-error').hidden = !this.#error;
    this.map.setAnnotations(
      rows.map(row => ({
        ...row,
        label: row.sharedKey ? 'Accepted shared item' : 'Local item',
        icon: this.#types().find(t => t.id === row.item.type)?.icon ?? 'pin',
        showLabel:
          this.#store?.state.plugins.find(p => row.item.type.startsWith(p.manifest.id + '/'))
            ?.settings['show-labels'] === true,
      })),
      $<HTMLInputElement>('map-show-items').checked,
      $<HTMLInputElement>('map-show-devices').checked,
    );
    const list = $('map-item-list');
    list.replaceChildren();
    for (const row of rows.filter(row =>
      `${row.item.name} ${row.item.note}`.toLowerCase().includes(filter),
    )) {
      const wrap = document.createElement('div');
      wrap.className = 'map-list-row';
      wrap.append(
        button(`${row.item.name} · ${row.sharedKey ? 'shared' : 'local'}`, () =>
          this.#detail(row.item, row.sharedKey, row.payload),
        ),
        button('Locate', () => this.map.focusAnnotation(row.item)),
      );
      list.append(wrap);
    }
    if (!list.childElementCount)
      list.append(
        paragraph(
          filter
            ? 'No matching map items.'
            : 'No saved items. Add a point or draw an area on the map.',
        ),
      );
    const plugins = $('plugin-list');
    plugins.replaceChildren();
    for (const p of state?.plugins ?? []) {
      const card = document.createElement('article');
      card.className = 'shared-map-card';
      card.append(
        paragraph(
          `${p.manifest.name} · ${p.manifest.version} · ${p.enabled ? 'Enabled' : 'Disabled'}`,
        ),
        paragraph(p.manifest.id),
        button(p.enabled ? 'Disable' : 'Enable', () =>
          this.#run(() => this.#store!.plugin(p.manifest.id, 'toggle')),
        ),
        button('Configure', () => this.#pluginSettings(p.manifest.id)),
        button('Export', () =>
          download(p.manifest.id + '.json', JSON.stringify(p.manifest, null, 2)),
        ),
        button('Uninstall', () => {
          if (confirm(`Uninstall ${p.manifest.name}? Existing map items are preserved.`))
            this.#run(() => this.#store!.plugin(p.manifest.id, 'remove'));
        }),
      );
      plugins.append(card);
    }
    if (!plugins.childElementCount)
      plugins.append(
        paragraph('No plugins installed. Choose a plugin JSON file to review and install it.'),
      );
  }
}
