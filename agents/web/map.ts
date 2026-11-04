import type { MapItem } from '../../packages/protocol/map-item.ts';
import L from 'leaflet';

export type MapPoint = Readonly<{
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  kind: 'self' | 'peer';
  detail: string;
}>;

/** Leaflet map for shared/fixed positions. Missing coordinates are never plotted. */
export class FieldMap {
  readonly map: L.Map;
  readonly #layer: L.LayerGroup;
  #markers = new Map<string, L.Marker>();
  #annotations: L.LayerGroup;
  #annotationSignature = '';
  #annotationBounds: L.LatLng[] = [];
  #drawing = false;
  #dragStart?: L.LatLng;
  #preview?: L.Rectangle;
  #suppressClick = false;
  onRectangle?: (start: L.LatLng, end: L.LatLng) => void;
  setDrawing(active: boolean) {
    this.#drawing = active;
    this.#clearDrag();
    if (active) this.map.dragging.disable();
    else this.map.dragging.enable();
  }
  #clearDrag() {
    this.#dragStart = undefined;
    this.#preview?.remove();
    this.#preview = undefined;
  }
  onLocation?: (latitude: number, longitude: number, context: boolean) => void;
  onAnnotation?: (id: string, context: boolean) => void;
  #selected?: string;
  #signature = '';
  onSelect?: (id: string | undefined) => void;

  constructor(container: HTMLElement) {
    this.map = L.map(container, {
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
    }).setView([39.8283, -98.5795], 4);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    const tiles = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
        maxZoom: 16,
      },
    ).addTo(this.map);
    tiles.on('tileerror', () => {
      const status = document.getElementById('tile-status');
      if (status) status.hidden = false;
    });
    this.#layer = L.layerGroup().addTo(this.map);
    this.#annotations = L.layerGroup().addTo(this.map);
    this.map.on('mousedown', (event: L.LeafletMouseEvent) => {
      if (!this.#drawing || event.originalEvent.button !== 0) return;
      this.#dragStart = event.latlng;
      // Leaflet's own drag handling, off while drawing, is what normally stops text selection.
      event.originalEvent.preventDefault();
      // A release outside the map never reaches the map's own mouseup.
      document.addEventListener('mouseup', () => this.#clearDrag(), { once: true });
    });
    this.map.on('mousemove', (event: L.LeafletMouseEvent) => {
      if (!this.#dragStart) return;
      const bounds = L.latLngBounds(this.#dragStart, event.latlng);
      if (this.#preview) this.#preview.setBounds(bounds);
      else
        this.#preview = L.rectangle(bounds, {
          color: '#71c99a',
          weight: 2,
          interactive: false,
        }).addTo(this.map);
    });
    this.map.on('mouseup', (event: L.LeafletMouseEvent) => {
      const start = this.#dragStart;
      this.#clearDrag();
      if (
        !start ||
        this.map
          .latLngToContainerPoint(start)
          .distanceTo(this.map.latLngToContainerPoint(event.latlng)) < 5
      )
        return;
      this.#suppressClick = true;
      setTimeout(() => {
        this.#suppressClick = false;
      }, 0);
      this.onRectangle?.(start, event.latlng);
    });
    this.map.on('contextmenu', (event: L.LeafletMouseEvent) => {
      this.onLocation?.(event.latlng.lat, event.latlng.lng, true);
    });
    this.map.on('click', (event: L.LeafletMouseEvent) => {
      if (this.#suppressClick) return;
      this.onLocation?.(event.latlng.lat, event.latlng.lng, false);
      this.select(undefined);
      this.onSelect?.(undefined);
    });
  }

  invalidate() {
    requestAnimationFrame(() => this.map.invalidateSize());
  }

  select(id: string | undefined) {
    this.#selected = id;
    for (const [key, marker] of this.#markers) {
      const el = marker.getElement();
      if (el) el.classList.toggle('is-selected', key === id);
    }
  }

  focus(id: string) {
    const marker = this.#markers.get(id);
    if (!marker) return;
    this.select(id);
    this.map.panTo(marker.getLatLng(), { animate: true });
  }

  setPoints(points: readonly MapPoint[]) {
    const signature = points
      .map(
        point =>
          `${point.id}:${point.latitude}:${point.longitude}:${point.name}:${point.kind}:${point.detail}:${this.#selected}`,
      )
      .join('|');
    if (signature === this.#signature) return;
    const previous = this.#signature;
    this.#signature = signature;
    const keep = new Set(points.map(point => point.id));
    for (const [id, marker] of this.#markers) {
      if (!keep.has(id)) {
        this.#layer.removeLayer(marker);
        this.#markers.delete(id);
      }
    }
    for (const point of points) {
      const latLng: L.LatLngExpression = [point.latitude, point.longitude];
      let marker = this.#markers.get(point.id);
      if (!marker) {
        marker = L.marker(latLng, {
          icon: L.divIcon({
            className: `node-marker node-marker--${point.kind}`,
            html: `<button type="button" class="node-pin" aria-label="${escapeAttr(point.name)}"><span>${escapeAttr(initials(point.name))}</span></button>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          }),
          keyboard: true,
          title: point.name,
          alt: point.name,
        });
        marker.on('click', event => {
          L.DomEvent.stopPropagation(event);
          this.select(point.id);
          this.onSelect?.(point.id);
        });
        marker.bindTooltip(tooltip(point), { direction: 'top', offset: [0, -14], opacity: 0.95 });
        marker.addTo(this.#layer);
        this.#markers.set(point.id, marker);
      } else {
        marker.setLatLng(latLng);
        if (marker.options.title !== point.name) {
          marker.options.title = point.name;
          marker.setIcon(
            L.divIcon({
              className: `node-marker node-marker--${point.kind}`,
              html: `<button type="button" class="node-pin" aria-label="${escapeAttr(point.name)}"><span>${escapeAttr(initials(point.name))}</span></button>`,
              iconSize: [36, 36],
              iconAnchor: [18, 18],
            }),
          );
        }
        marker.setTooltipContent(tooltip(point));
      }
    }
    this.select(this.#selected);
    if (!previous && points.length)
      this.fit(points.map(point => L.latLng(point.latitude, point.longitude)));
    else if (points.length === 1 && !previous)
      this.map.setView([points[0].latitude, points[0].longitude], 12);
  }

  setAnnotations(
    items: { key: string; item: MapItem; label: string; icon: string; showLabel?: boolean }[],
    showItems: boolean,
    showDevices: boolean,
  ) {
    if (showDevices) this.#layer.addTo(this.map);
    else this.map.removeLayer(this.#layer);
    if (showItems) this.#annotations.addTo(this.map);
    else this.map.removeLayer(this.#annotations);
    const signature = JSON.stringify(items);
    if (signature === this.#annotationSignature) return;
    this.#annotationSignature = signature;
    this.#annotations.clearLayers();
    this.#annotationBounds = [];
    for (const { key, item, label, icon, showLabel } of items) {
      const c = item.coordinates,
        nw = L.latLng(c[0] / 1e7 - 90, c[1] / 1e7 - 180);
      this.#annotationBounds.push(nw);
      const style = { color: item.color, fillColor: item.color, fillOpacity: 0.18, weight: 2 };
      let layer: L.Path | L.Marker;
      if (item.geometry === 'rectangle') {
        const se = L.latLng(c[2] / 1e7 - 90, c[3] / 1e7 - 180);
        this.#annotationBounds.push(se);
        layer = L.rectangle(L.latLngBounds(nw, se), style);
      } else {
        layer = L.marker(nw, {
          keyboard: true,
          title: item.name,
          alt: item.name,
          icon: L.divIcon({
            className: 'annotation-pin',
            html: `<span style="color:${item.color}">${mapSymbol(icon)}</span>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
        });
      }
      const tip = document.createElement('span');
      tip.textContent = `${item.name} · ${label}`;
      layer.bindTooltip(tip, { permanent: showLabel });
      layer.on('click', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event);
        this.onAnnotation?.(key, false);
      });
      layer.on('contextmenu', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event);
        this.onAnnotation?.(key, true);
      });
      layer.addTo(this.#annotations);
    }
  }

  focusAnnotation(item: MapItem) {
    const c = item.coordinates,
      nw: L.LatLngExpression = [c[0] / 1e7 - 90, c[1] / 1e7 - 180];
    if (item.geometry === 'rectangle')
      this.map.fitBounds(L.latLngBounds(nw, [c[2] / 1e7 - 90, c[3] / 1e7 - 180]), {
        padding: [36, 36],
        maxZoom: 16,
      });
    else this.map.setView(nw, Math.max(12, this.map.getZoom()));
  }

  fit(points?: L.LatLngExpression[]) {
    const targets =
      points ??
      (this.map.hasLayer(this.#layer)
        ? [...this.#markers.values()].map(marker => marker.getLatLng())
        : []
      ).concat(this.map.hasLayer(this.#annotations) ? this.#annotationBounds : []);
    if (!targets.length) return;
    if (targets.length === 1) {
      this.map.setView(targets[0], Math.max(this.map.getZoom(), 12));
      return;
    }
    this.map.fitBounds(L.latLngBounds(targets), { padding: [48, 48], maxZoom: 14 });
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function escapeAttr(value: string) {
  return value.replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

function tooltip(point: MapPoint) {
  const node = document.createElement('span');
  node.textContent = `${point.name} · ${point.detail}`;
  return node;
}

function mapSymbol(icon: string) {
  const paths: Record<string, string> = {
    pin: '<circle cx="12" cy="10" r="3"/><path d="M12 22s8-7 8-12a8 8 0 0 0-16 0c0 5 8 12 8 12Z"/>',
    flag: '<path d="M5 22V3h14l-3 5 3 5H5"/>',
    camp: '<path d="m2 21 10-18 10 18H2Zm6 0 4-8 4 8M9 3l3 5 3-5"/>',
    hazard: '<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v1"/>',
    medical: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z"/>',
    observation:
      '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[icon] ?? paths.pin}</svg>`;
}
