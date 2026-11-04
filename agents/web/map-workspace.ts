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
import { bearingDegrees, distanceMeters, formatBearing, pathLength, type LngLat } from './geo.ts';
import { confirmSheet, downloadBlob, icon } from './ui.ts';
type Context = {
  channels: readonly { id: number; name: string }[];
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
  /** Where something can be shared: the conversations on show. */
  shareTargets(): readonly {
    key: string;
    destination: string;
    channel: number;
    name: string;
    kind: 'channel' | 'direct';
  }[];
  range(at: LngLat): string | undefined;
  coordinate(at: LngLat): string;
  distance(meters: number): string;
  notify(message: string | undefined): void;
  selectedItem(): void;
};
/** The same swatches as the mobile app. A plugin's own default color is added beside them. */
export const ITEM_COLORS = ['#b2dda3', '#ebbb5f', '#ff7a6b', '#7fb7ff', '#f4f5f1'];
const toWire = (lat: number, lng: number) => [
  Math.round((Math.max(-90, Math.min(90, lat)) + 90) * 1e7),
  Math.round(((((lng + 180) % 360) + 360) % 360) * 1e7),
];
/** A map item's middle, in [longitude, latitude]. */
function itemCenter(item: MapItem): LngLat {
  const c = item.coordinates;
  return item.geometry === 'point'
    ? [c[1] / 1e7 - 180, c[0] / 1e7 - 90]
    : [(c[1] + c[3]) / 2e7 - 180, (c[0] + c[2]) / 2e7 - 90];
}
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
  downloadBlob(name, new Blob([text], { type: 'application/json' }));
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
  #tool?: 'measure' | 'area';
  #points: LngLat[] = [];
  #selected?: { item: MapItem; key?: string; payload?: SharedPayload };
  /** The row whose panel is showing over the map. */
  #panelKey?: string;
  #sharing?: MapItem;
  #manifest?: Plugin;
  private map: FieldMap;
  private host: Host;
  constructor(
    map: FieldMap,
    host: Host,
    storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  ) {
    this.map = map;
    this.host = host;
    try {
      this.#store = new MapStore(storage, () => host.writable());
    } catch (e) {
      this.#error = `Map storage unavailable: ${String(e)}. Saved data was not changed.`;
    }
    this.map.onLocation = (lat, lng, context) => this.#location(lat, lng, context);
    this.map.onAnnotation = (key, context) => {
      const selected = this.#displayItems().find(x => x.key === key);
      if (!selected) return;
      if (context) this.#detail(selected.item, selected.sharedKey, selected.payload);
      else this.#selectRow(key);
    };
    this.map.onRectangle = (start, end) => {
      if (this.#tool !== 'area') return;
      this.#points = [
        [start.lng, start.lat],
        [end.lng, end.lat],
      ];
      this.#renderTool();
    };
    $('map-drop').onclick = () => {
      const [lng, lat] = this.map.center();
      this.#setTool();
      this.#edit(undefined, 'point', toWire(lat, lng));
    };
    $('map-measure').onclick = () =>
      this.#setTool(this.#tool === 'measure' ? undefined : 'measure');
    $('map-area').onclick = () => this.#setTool(this.#tool === 'area' ? undefined : 'area');
    $('measure-close').onclick = $('area-close').onclick = () => this.#setTool();
    $('measure-crosshair').onclick = $('area-crosshair').onclick = () =>
      this.#addPoint(this.map.center());
    $('measure-undo').onclick = () => {
      this.#points = this.#points.slice(0, -1);
      this.#renderTool();
    };
    $('area-save').onclick = () => {
      const [a, b] = this.#points;
      const [north, west] = toWire(Math.max(a[1], b[1]), Math.min(a[0], b[0]));
      const [south, east] = toWire(Math.min(a[1], b[1]), Math.max(a[0], b[0]));
      this.#setTool();
      this.#edit(undefined, 'rectangle', [north, west, south, east]);
    };
    $('item-close').onclick = () => this.clearSelection();
    $('item-share').onclick = () => {
      const row = this.#panelRow();
      if (row) this.#share(row.item);
    };
    $('item-edit').onclick = () => {
      const row = this.#panelRow();
      if (row) this.#edit(row.item);
    };
    $('item-details').onclick = () => {
      const row = this.#panelRow();
      if (row) this.#detail(row.item, row.sharedKey, row.payload);
    };
    $('item-hide').onclick = () => {
      const row = this.#panelRow();
      if (row?.sharedKey) void this.#hide(row.sharedKey);
    };
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
    $('map-location-cancel').onclick = () => $<HTMLDialogElement>('map-location').close();
    $('map-detail-close').onclick = () => $<HTMLDialogElement>('map-detail').close();
    $('map-share-close').onclick = () => $<HTMLDialogElement>('map-share').close();
    $('plugin-preview-close').onclick = () => $<HTMLDialogElement>('plugin-preview').close();
    $('plugin-settings-close').onclick = () =>
      $<HTMLDialogElement>('plugin-settings-dialog').close();
    $('map-editor-delete').onclick = () => void this.#deleteDraft();
    $('map-type').onchange = () => {
      const t = this.#types().find(t => t.id === $<HTMLSelectElement>('map-type').value);
      if (t) {
        if (!t.id.startsWith('core/')) this.#setColor(t.defaultColor);
        inputs($('map-custom-fields'), t.fields, {});
      }
    };
    $('map-item-form').onsubmit = event => {
      event.preventDefault();
      this.#save();
    };
    $('map-share-operation').onchange = () => this.#budget();
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
      // With a dialog open, Escape belongs to the dialog.
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) this.#setTool();
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
  get toolActive() {
    return !!this.#tool;
  }
  #setTool(tool?: 'measure' | 'area') {
    this.#tool = tool;
    this.#points = [];
    if (tool) this.clearSelection();
    this.map.setDrawing(tool === 'area');
    this.map.map.getContainer().classList.toggle('is-placing', !!tool);
    $('map-measure').classList.toggle('is-active', tool === 'measure');
    $('map-area').classList.toggle('is-active', tool === 'area');
    this.#renderTool();
  }
  #addPoint(point: LngLat) {
    // A third corner replaces the older of the two, so an area can be adjusted before saving.
    this.#points =
      this.#tool === 'area' && this.#points.length >= 2
        ? [this.#points[1], point]
        : [...this.#points, point];
    this.#renderTool();
  }
  #renderTool() {
    const tool = this.#tool,
      points = this.#points;
    $('map-measure-panel').hidden = tool !== 'measure';
    $('map-area-panel').hidden = tool !== 'area';
    this.map.setTool(points, tool === 'measure' ? 'line' : tool === 'area' ? 'area' : 'none');
    if (tool === 'measure') {
      const last = points.at(-1),
        prior = points.at(-2);
      $('measure-total').textContent =
        points.length > 1 ? this.host.distance(pathLength(points)) : 'Click points to measure';
      $('measure-leg').textContent =
        last && prior
          ? `Last leg ${this.host.distance(distanceMeters(prior, last))} · ${formatBearing(
              bearingDegrees(prior, last),
            )}`
          : '';
      $<HTMLButtonElement>('measure-undo').disabled = !points.length;
    }
    if (tool === 'area') {
      $('area-state').textContent =
        points.length < 2 ? `Set corner ${points.length + 1} of 2, or drag` : 'Area ready';
      $<HTMLButtonElement>('area-save').disabled = points.length < 2;
    }
  }
  #location(lat: number, lng: number, context = false) {
    if (this.#tool && !context) {
      this.#addPoint([lng, lat]);
      return;
    }
    if (!context) {
      this.clearSelection();
      return;
    }
    if (!this.#store || this.host.stopped() || document.querySelector('dialog[open]')) return;
    const point = toWire(lat, lng);
    $('map-location-coordinates').textContent = this.host.coordinate([lng, lat]);
    $('map-location-point').onclick = () => {
      $<HTMLDialogElement>('map-location').close();
      this.#setTool();
      this.#edit(undefined, 'point', point);
    };
    $('map-location-area').onclick = () => {
      $<HTMLDialogElement>('map-location').close();
      this.#setTool('area');
      this.#addPoint([lng, lat]);
    };
    $<HTMLDialogElement>('map-location').showModal();
  }
  clearSelection() {
    this.#panelKey = undefined;
    this.map.selectAnnotation(undefined);
    $('selected-item').hidden = true;
  }
  #panelRow() {
    return this.#displayItems().find(row => row.key === this.#panelKey);
  }
  #selectRow(key: string) {
    this.#panelKey = key;
    this.map.selectAnnotation(key);
    this.host.selectedItem();
    this.#renderPanel();
  }
  #renderPanel() {
    const row = this.#panelRow();
    const panel = $('selected-item');
    panel.hidden = !row;
    if (!row) return;
    const center = itemCenter(row.item);
    $('item-name').textContent = row.item.name;
    $('item-detail').textContent = [
      row.sharedKey ? 'Shared' : '',
      row.item.note,
      this.host.range(center) ?? this.host.coordinate(center),
    ]
      .filter(Boolean)
      .join(' · ');
    $('item-share').hidden = !!row.sharedKey;
    $('item-edit').hidden = !!row.sharedKey;
    $('item-hide').hidden = !row.sharedKey;
  }
  async #hide(key: string) {
    const yes = await confirmSheet({
      title: 'Remove from this map?',
      body: "The original sender keeps it. An older copy can't bring it back.",
      confirm: 'Remove',
      danger: true,
    });
    if (!yes) return;
    this.#run(() => {
      this.#store!.hide(key);
      this.clearSelection();
      const detail = $<HTMLDialogElement>('map-detail');
      if (detail.open) detail.close();
    });
  }
  async #deleteDraft() {
    const draft = this.#draft;
    if (!draft) return;
    const yes = await confirmSheet({
      title: 'Delete this map item?',
      body: 'Shared copies on other devices remain.',
      confirm: 'Delete',
      danger: true,
    });
    if (!yes) return;
    this.#run(() => {
      this.#store!.remove(draft.id);
      this.clearSelection();
      const editor = $<HTMLDialogElement>('map-editor');
      if (editor.open) editor.close();
    });
  }
  #setColor(color: string) {
    $<HTMLInputElement>('map-color').value = color;
    const options = ITEM_COLORS.includes(color.toLowerCase())
      ? ITEM_COLORS
      : [...ITEM_COLORS, color];
    $('map-colors').replaceChildren(
      ...options.map(option => {
        const swatch = document.createElement('button');
        const selected = option.toLowerCase() === color.toLowerCase();
        swatch.type = 'button';
        swatch.style.backgroundColor = option;
        swatch.classList.toggle('is-active', selected);
        swatch.setAttribute('role', 'radio');
        swatch.setAttribute('aria-checked', String(selected));
        swatch.setAttribute('aria-label', `Color ${option}`);
        if (selected) swatch.append(icon('check'));
        swatch.onclick = () => this.#setColor(option);
        return swatch;
      }),
    );
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
          color: geometry === 'rectangle' ? ITEM_COLORS[1] : ITEM_COLORS[0],
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
    this.#setColor(d.color);
    $('map-editor-delete').hidden = !item;
    $('map-type-field').hidden = select.options.length < 2;
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
        ? 'New point'
        : 'New area';
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
      this.#selectRow('local:' + item.id);
    } catch (e) {
      $('map-editor-error').textContent = e instanceof Error ? e.message : String(e);
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
  #detail(item: MapItem, key?: string, payload?: SharedPayload) {
    this.#selected = { item, key, payload };
    $('map-detail-title').textContent = item.name;
    const body = $('map-detail-body');
    body.replaceChildren(
      paragraph(
        `${item.geometry} · ${this.#types().find(t => t.id === item.type)?.name ?? item.type + ' (plugin unavailable)'}`,
      ),
      paragraph(item.note),
      paragraph(this.host.coordinate(itemCenter(item))),
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
          'Delete',
          () => {
            $<HTMLDialogElement>('map-detail').close();
            this.#draft = item;
            void this.#deleteDraft();
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
        button('Remove from my map', () => void this.#hide(key)),
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
  /** Sharing always asks where to send: there is no preselected channel. */
  #share(item: MapItem) {
    this.#sharing = item;
    $('map-share-title').textContent = `Share ${item.name}`;
    $<HTMLSelectElement>('map-share-operation').value = 'put';
    $('map-share-error').textContent = '';
    const context = this.host.context();
    const blocked = !context.ready || !!context.block;
    const list = $('map-share-list');
    list.replaceChildren(
      ...this.host.shareTargets().map(row => {
        const target = document.createElement('button');
        target.type = 'button';
        target.disabled = blocked;
        target.setAttribute('aria-label', `Share to ${row.name}`);
        target.append(icon(row.kind === 'channel' ? 'hash' : 'user'), row.name);
        target.onclick = () => this.#send(row);
        return target;
      }),
    );
    this.#budget();
    $<HTMLDialogElement>('map-share').showModal();
  }
  #outgoing(): MapOperation {
    const item = structuredClone(this.#sharing!),
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
      const wire = encodeMap(this.#outgoing()),
        context = this.host.context();
      $('map-share-budget').textContent = `${new TextEncoder().encode(wire).length} bytes. ${
        context.block ??
        (context.ready
          ? "A device's acknowledgment doesn't mean the recipient added it to their map."
          : 'Connect a device to share.')
      }`;
    } catch (e) {
      $('map-share-budget').textContent = e instanceof Error ? e.message : String(e);
    }
  }
  #send(row: { destination: string; channel: number; name: string }) {
    try {
      const op = this.#outgoing();
      const wire = encodeMap(op, this.host.budget(row.channel));
      const local = { ...this.#sharing!, revision: op.item.revision };
      this.#store!.save(local);
      this.host.send(wire, row.destination, row.channel);
      $<HTMLDialogElement>('map-share').close();
      this.host.notify(`Sent to ${row.name}. Delivery shows in Comms.`);
      this.#signature = '';
      this.update();
    } catch (e) {
      $('map-share-error').textContent = e instanceof Error ? e.message : String(e);
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
  get hasItems() {
    return this.#displayItems().length > 0;
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
    title.textContent = op.operation === 'withdraw' ? `Removed: ${op.item.name}` : op.item.name;
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
      paragraph(op.item.note),
      paragraph(
        `${op.item.geometry === 'point' ? 'Point' : 'Area'} · ${this.host.coordinate(itemCenter(op.item))}`,
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
      const actions = document.createElement('div');
      actions.className = 'map-message-actions';
      const feedback = paragraph('');
      feedback.setAttribute('role', 'status');
      const decide = (accept: boolean) => {
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
          this.#store.decide(key, op!.item.revision, accept, op!);
          this.#signature = '';
          this.update();
          document.dispatchEvent(new Event('map-message-change'));
        } catch (error) {
          feedback.textContent = error instanceof Error ? error.message : String(error);
        }
      };
      if (state.actionable) {
        const writable = !!this.#store && this.host.writable();
        const add = button(state.label, () => decide(true), 'accent compact');
        add.disabled = !writable;
        const dismiss = button('Dismiss', () => decide(false), 'compact');
        dismiss.disabled = !writable;
        actions.append(add, dismiss);
        if (!writable) feedback.textContent = 'This browser tab cannot save map changes.';
      } else {
        const status = document.createElement('small');
        status.textContent = state.label;
        actions.append(status);
        if (acceptedRevision === op.item.revision && op.operation === 'put')
          actions.append(
            button(
              'View on map',
              () => {
                this.host.openMap?.();
                this.map.map.invalidateSize();
                this.map.focusAnnotation(op!.item);
              },
              'compact',
            ),
          );
      }
      card.append(actions, feedback);
    } else card.append(paragraph('Shared by you. Whether they add it is not reported.'));
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
    this.#renderPanel();
    const state = this.#store?.state,
      rows = this.#displayItems(),
      filter = $<HTMLInputElement>('map-item-search').value.toLowerCase();
    const signature = JSON.stringify([state, rows, filter, this.#error, this.host.writable()]);
    if (signature === this.#signature) return;
    this.#signature = signature;
    $('map-workspace-error').textContent = this.#error;
    $('map-workspace-error').hidden = !this.#error;
    this.map.setAnnotations(
      rows.map(row => ({
        key: row.key,
        item: row.item,
        icon: this.#types().find(t => t.id === row.item.type)?.icon ?? 'pin',
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
        button(
          `${row.item.name}${row.sharedKey ? ' · shared' : ''}`,
          () => {
            this.map.focusAnnotation(row.item);
            this.#selectRow(row.key);
            $('map-items-panel').hidden = true;
            $('map-items').classList.remove('is-active');
          },
          'compact',
        ),
      );
      list.append(wrap);
    }
    if (!list.childElementCount)
      list.append(
        paragraph(
          filter ? 'No matching map items.' : 'No saved items. Drop a point or draw an area.',
        ),
      );
    const plugins = $('plugin-list');
    plugins.replaceChildren();
    for (const p of state?.plugins ?? []) {
      const card = document.createElement('article');
      card.className = 'card plugin-card';
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
        button('Uninstall', async () => {
          const yes = await confirmSheet({
            title: `Uninstall ${p.manifest.name}?`,
            body: 'Existing map items are preserved.',
            confirm: 'Uninstall',
            danger: true,
          });
          if (yes) this.#run(() => this.#store!.plugin(p.manifest.id, 'remove'));
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
