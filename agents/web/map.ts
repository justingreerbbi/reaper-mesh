import type { MapItem } from '../../packages/protocol/map-item.ts';
import L from 'leaflet';
import type { LngLat } from './geo.ts';

export type MapPoint = Readonly<{
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  kind: 'self' | 'peer';
  stale?: boolean;
  detail: string;
}>;

const esri = (name: string) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/${name}/MapServer/tile/{z}/{y}/{x}`;

/** The same Esri services as the mobile app. Tiles may fail offline; nothing else depends on them. */
export const BASEMAPS = [
  {
    id: 'dark',
    label: 'Dark',
    tiles: esri('Canvas/World_Dark_Gray_Base'),
    maxZoom: 16,
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
  },
  {
    id: 'topo',
    label: 'Topo',
    tiles: esri('World_Topo_Map'),
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri',
  },
  {
    id: 'imagery',
    label: 'Satellite',
    tiles: esri('World_Imagery'),
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
  },
] as const;

function tag(kind: string, shape: string, label: string, size: number) {
  return L.divIcon({
    className: kind,
    html: `<div class="map-tag">${shape}<div class="map-tag-label">${escapeHtml(label)}</div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
/** This computer's recorded track: orange, so it stands apart from nodes, areas and measuring. */
export const TRACK_COLOR = '#ff7a45';

export type TrailStep = Readonly<{ from: LngLat; to: LngLat; fade: number }>;
/** A drone heard by the signals add-on (D60), and its operator when Remote ID gives one. */
export type DroneMark = Readonly<{
  id: string;
  label: string;
  at: LngLat;
  operator?: LngLat;
  /** Where it has been, oldest first. */
  track?: readonly LngLat[];
  stale: boolean;
}>;

/** A point from a monitoring log, shown on the map until the user leaves it (D61). */
export type LogMark = Readonly<{
  at: LngLat;
  color: string;
  /** Drawn larger: a known device family such as a Flock camera. */
  known: boolean;
  /** 0 (faint) to 1 (strong): how solid the point is drawn. */
  strength: number;
  /** Lines shown when the point is tapped. */
  lines: readonly string[];
}>;

/** A tooltip from untrusted text: a text node, never HTML. */
function plainTooltip(value: string) {
  const span = document.createElement('span');
  span.textContent = value;
  return span;
}

const nodeIcon = (point: MapPoint) =>
  tag(
    `node-marker node-marker--${point.kind}${point.stale ? ' node-marker--stale' : ''}`,
    '<div class="node-dot"></div>',
    point.kind === 'self' ? 'This device' : point.name,
    22,
  );

/** Leaflet map for positions and items. Missing coordinates are never plotted. */
export class FieldMap {
  readonly map: L.Map;
  readonly #layer: L.LayerGroup;
  #markers = new Map<string, { marker: L.Marker; look: string }>();
  #annotations: L.LayerGroup;
  #annotationMarkers = new Map<string, L.Marker>();
  #annotationSignature = '';
  #annotationBounds: L.LatLng[] = [];
  #tiles: L.TileLayer | undefined;
  #basemap = '';
  #tool: L.LayerGroup;
  #me: L.Marker | undefined;
  #trails: L.LayerGroup;
  #trailSignature = '';
  #drones: L.LayerGroup;
  #log: L.LayerGroup;
  /** Many log points draw far faster on one canvas than as page elements. */
  #logRenderer = L.canvas({ padding: 0.5 });
  /** Moving the map to follow this computer, which the user's own drag ends. */
  #following = false;
  #drawing = false;
  #dragStart?: L.LatLng;
  #preview?: L.Rectangle;
  #suppressClick = false;
  #framed = 0;
  /** The user has moved the map themselves, so it stops framing things on its own. */
  #userMoved = false;
  #selected?: string;
  #selectedItem?: string;
  #signature = '';
  onRectangle?: (start: L.LatLng, end: L.LatLng) => void;
  onLocation?: (latitude: number, longitude: number, context: boolean) => void;
  onAnnotation?: (id: string, context: boolean) => void;
  onSelect?: (id: string | undefined) => void;
  onMove?: () => void;
  /** The user dragged the map, which ends following. */
  onUserDrag?: () => void;

  constructor(container: HTMLElement) {
    this.map = L.map(container, {
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
    }).setView([39.8283, -98.5795], 4);
    L.control.scale({ position: 'bottomleft' }).addTo(this.map);
    this.setBasemap('dark');
    this.#trails = L.layerGroup().addTo(this.map);
    this.#layer = L.layerGroup().addTo(this.map);
    this.#drones = L.layerGroup().addTo(this.map);
    this.#log = L.layerGroup().addTo(this.map);
    this.#annotations = L.layerGroup().addTo(this.map);
    this.#tool = L.layerGroup().addTo(this.map);
    this.map.on('move', () => this.onMove?.());
    this.map.on('dragstart', () => {
      this.#userMoved = true;
      if (this.#following) this.onUserDrag?.();
    });
    container.addEventListener('wheel', () => (this.#userMoved = true), { passive: true });
    container.addEventListener('touchstart', () => (this.#userMoved = true), { passive: true });
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
          color: '#ebbb5f',
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

  setBasemap(id: string) {
    if (id === this.#basemap) return;
    this.#basemap = id;
    const basemap = BASEMAPS.find(row => row.id === id) ?? BASEMAPS[0];
    this.#tiles?.remove();
    this.map.setMaxZoom(basemap.maxZoom + 3);
    this.#tiles = L.tileLayer(basemap.tiles, {
      attribution: basemap.attribution,
      maxNativeZoom: basemap.maxZoom,
      maxZoom: basemap.maxZoom + 3,
    }).addTo(this.map);
    this.#tiles.on('tileerror', () => {
      const status = document.getElementById('tile-status');
      if (status) status.hidden = false;
    });
    this.#tiles.on('tileload', () => {
      const status = document.getElementById('tile-status');
      if (status) status.hidden = true;
    });
  }

  /** Dragging draws while placing with a mouse. A finger still needs to be able to pan. */
  setDrawing(active: boolean) {
    this.#drawing = active && matchMedia('(pointer: fine)').matches;
    this.#clearDrag();
    if (this.#drawing) this.map.dragging.disable();
    else this.map.dragging.enable();
  }
  #clearDrag() {
    this.#dragStart = undefined;
    this.#preview?.remove();
    this.#preview = undefined;
  }

  center(): [number, number] {
    const center = this.map.getCenter();
    return [center.wrap().lng, center.lat];
  }
  zoom(delta: number) {
    this.map.setZoom(this.map.getZoom() + delta);
  }
  flyTo(longitude: number, latitude: number, zoom = 14) {
    this.#userMoved = true;
    this.map.setView([latitude, longitude], Math.max(this.map.getZoom(), zoom));
  }

  invalidate() {
    requestAnimationFrame(() => this.map.invalidateSize());
  }

  select(id: string | undefined) {
    this.#selected = id;
    for (const [key, { marker }] of this.#markers)
      marker.getElement()?.classList.toggle('is-selected', key === id);
  }
  selectAnnotation(key: string | undefined) {
    this.#selectedItem = key;
    for (const [id, marker] of this.#annotationMarkers)
      marker.getElement()?.classList.toggle('is-selected', id === key);
  }

  /** Redraws the drones the signals add-on reports, each with a line to its operator. */
  setDrones(drones: readonly DroneMark[]) {
    this.#drones.clearLayers();
    for (const drone of drones) {
      const at = L.latLng(drone.at[1], drone.at[0]);
      if (drone.track && drone.track.length > 1)
        L.polyline(
          drone.track.map(([lng, lat]) => L.latLng(lat, lng)),
          { color: '#e5484d', weight: 2, opacity: 0.7, interactive: false },
        ).addTo(this.#drones);
      L.marker(at, {
        keyboard: false,
        icon: L.divIcon({
          className: 'drone-marker',
          html: `<div class="drone-dot${drone.stale ? ' is-stale' : ''}"></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      })
        .bindTooltip(plainTooltip(drone.label))
        .addTo(this.#drones);
      if (!drone.operator) continue;
      const operator = L.latLng(drone.operator[1], drone.operator[0]);
      L.circleMarker(operator, { radius: 6, color: '#ebbb5f', weight: 2, fillOpacity: 0.5 })
        .bindTooltip(plainTooltip(`Operator of ${drone.label}`))
        .addTo(this.#drones);
      L.polyline([at, operator], {
        color: '#ebbb5f',
        weight: 1.5,
        dashArray: '4 4',
        interactive: false,
      }).addTo(this.#drones);
    }
  }

  get hasLog() {
    return this.#log.getLayers().length > 0;
  }

  /** Shows a monitoring log's points, framed; none clears them. */
  setLog(marks: readonly LogMark[]) {
    this.#log.clearLayers();
    if (!marks.length) return;
    for (const mark of marks) {
      const popup = document.createElement('div');
      popup.className = 'log-popup';
      for (const [i, value] of mark.lines.entries())
        popup.append(
          Object.assign(document.createElement(i ? 'div' : 'strong'), { textContent: value }),
        );
      L.circleMarker(L.latLng(mark.at[1], mark.at[0]), {
        renderer: this.#logRenderer,
        radius: mark.known ? 8 : 5,
        color: mark.known ? '#fff' : mark.color,
        weight: mark.known ? 2 : 1,
        fillColor: mark.color,
        fillOpacity: 0.3 + 0.65 * Math.min(1, Math.max(0, mark.strength)),
        // A tap shows the point; it must not also count as a tap on the map.
        bubblingMouseEvents: false,
      })
        .bindPopup(popup, { closeButton: false, autoPanPadding: [24, 24] })
        .addTo(this.#log);
    }
    this.#userMoved = true;
    // The map may have just been shown: its size must be right before framing.
    this.map.invalidateSize({ animate: false });
    const bounds = L.latLngBounds(marks.map(mark => L.latLng(mark.at[1], mark.at[0])));
    if (marks.length === 1) this.map.setView(bounds.getCenter(), Math.max(this.map.getZoom(), 16));
    // Room at the top for the buttons, and at the bottom for the log's own panel.
    else
      this.map.fitBounds(bounds, {
        paddingTopLeft: [56, 80],
        paddingBottomRight: [56, 150],
        maxZoom: 17,
      });
  }

  /** Centres the map on a point, for "Show on map" from another view. */
  showPoint([lng, lat]: LngLat) {
    this.#userMoved = true;
    this.map.setView([lat, lng], Math.max(this.map.getZoom(), 15));
  }

  focus(id: string) {
    const entry = this.#markers.get(id);
    if (!entry) return;
    this.select(id);
    this.#userMoved = true;
    this.map.setView(entry.marker.getLatLng(), Math.max(this.map.getZoom(), 14));
  }

  /** Draws the measure line or area preview, in [longitude, latitude]. */
  setTool(points: readonly (readonly [number, number])[], shape: 'none' | 'line' | 'area') {
    this.#tool.clearLayers();
    const latLngs = points.map(([lng, lat]) => L.latLng(lat, lng));
    for (const latLng of latLngs)
      L.marker(latLng, {
        interactive: false,
        icon: L.divIcon({
          className: 'tool-marker',
          html: '<div class="tool-point"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      }).addTo(this.#tool);
    if (shape === 'line' && latLngs.length > 1)
      L.polyline(latLngs, {
        color: '#ebbb5f',
        weight: 3,
        dashArray: '6 5',
        interactive: false,
      }).addTo(this.#tool);
    if (shape === 'area' && latLngs.length === 2)
      L.rectangle(L.latLngBounds(latLngs[0], latLngs[1]), {
        color: '#ebbb5f',
        fillColor: '#ebbb5f',
        fillOpacity: 0.18,
        weight: 2,
        interactive: false,
      }).addTo(this.#tool);
  }

  /** This computer's position, with an arrow for the way it faces or travels when that's known. */
  setMe(position: LngLat | undefined, heading?: number) {
    if (!position) {
      this.#me?.remove();
      this.#me = undefined;
      return;
    }
    const latLng = L.latLng(position[1], position[0]);
    if (this.#me) this.#me.setLatLng(latLng);
    else
      this.#me = L.marker(latLng, {
        interactive: false,
        zIndexOffset: 1000,
        icon: tag(
          'node-marker node-marker--me',
          '<div class="me-heading" hidden></div><div class="node-dot"></div>',
          'You',
          22,
        ),
      }).addTo(this.map);
    const arrow = this.#me.getElement()?.querySelector<HTMLElement>('.me-heading');
    if (arrow) {
      arrow.hidden = heading === undefined;
      if (heading !== undefined) arrow.style.transform = `rotate(${heading}deg)`;
    }
  }

  /** Starts or stops keeping the map centred on this computer. */
  setFollowing(on: boolean) {
    this.#following = on;
  }
  get following() {
    return this.#following;
  }
  /** Centres on this computer while following, zooming in the first time. */
  followTo(position: LngLat, zoomIn: boolean) {
    this.#userMoved = true;
    const latLng = L.latLng(position[1], position[0]);
    if (zoomIn) this.map.setView(latLng, Math.max(this.map.getZoom(), 15));
    else this.map.panTo(latLng, { animate: true, duration: 0.5 });
  }

  /** Node trails, fading with age, and this computer's recorded track. */
  setTrails(steps: readonly TrailStep[], track: readonly (readonly LngLat[])[], accent: string) {
    const signature = JSON.stringify([steps, track, accent]);
    if (signature === this.#trailSignature) return;
    this.#trailSignature = signature;
    this.#trails.clearLayers();
    const latLngs = (line: readonly LngLat[]) => line.map(([lng, lat]) => L.latLng(lat, lng));
    for (const step of steps)
      L.polyline(latLngs([step.from, step.to]), {
        color: accent,
        weight: 2.5,
        opacity: step.fade * 0.8,
        lineCap: 'round',
        interactive: false,
      }).addTo(this.#trails);
    if (track.length) {
      const lines = track.map(latLngs);
      L.polyline(lines, {
        color: '#050505',
        weight: 7,
        opacity: 0.45,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(this.#trails);
      L.polyline(lines, {
        color: TRACK_COLOR,
        weight: 4,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(this.#trails);
    }
  }

  setPoints(points: readonly MapPoint[]) {
    const signature = points
      .map(
        point =>
          `${point.id}:${point.latitude}:${point.longitude}:${point.name}:${point.kind}:${point.stale}:${point.detail}`,
      )
      .join('|');
    if (signature === this.#signature) return;
    this.#signature = signature;
    const keep = new Set(points.map(point => point.id));
    for (const [id, { marker }] of this.#markers) {
      if (!keep.has(id)) {
        this.#layer.removeLayer(marker);
        this.#markers.delete(id);
      }
    }
    for (const point of points) {
      const latLng: L.LatLngExpression = [point.latitude, point.longitude];
      const look = `${point.kind}:${point.stale}:${point.name}`;
      const entry = this.#markers.get(point.id);
      if (!entry) {
        const marker = L.marker(latLng, {
          icon: nodeIcon(point),
          keyboard: true,
          title: point.name,
          alt: point.name,
        });
        marker.on('click', event => {
          L.DomEvent.stopPropagation(event);
          this.select(point.id);
          this.onSelect?.(point.id);
        });
        marker.addTo(this.#layer);
        this.#markers.set(point.id, { marker, look });
      } else {
        entry.marker.setLatLng(latLng);
        if (entry.look !== look) {
          entry.look = look;
          entry.marker.options.title = point.name;
          entry.marker.setIcon(nodeIcon(point));
        }
      }
    }
    this.select(this.#selected);
  }

  setAnnotations(
    items: { key: string; item: MapItem; icon: string }[],
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
    this.#annotationMarkers.clear();
    this.#annotationBounds = [];
    for (const { key, item, icon } of items) {
      const c = item.coordinates,
        nw = L.latLng(c[0] / 1e7 - 90, c[1] / 1e7 - 180);
      this.#annotationBounds.push(nw);
      let at = nw;
      if (item.geometry === 'rectangle') {
        const se = L.latLng(c[2] / 1e7 - 90, c[3] / 1e7 - 180);
        this.#annotationBounds.push(se);
        const bounds = L.latLngBounds(nw, se);
        at = bounds.getCenter();
        L.rectangle(bounds, {
          color: item.color,
          fillColor: item.color,
          fillOpacity: 0.18,
          weight: 2,
          interactive: false,
        }).addTo(this.#annotations);
      }
      const shape =
        icon === 'pin' || icon === 'search'
          ? `<div class="item-diamond" style="background:${item.color}"></div>`
          : `<div class="item-symbol" style="color:${item.color}">${mapSymbol(icon)}</div>`;
      const marker = L.marker(at, {
        keyboard: true,
        title: item.name,
        alt: item.name,
        icon: tag('annotation-pin', shape, item.name, 22),
      });
      marker.on('click', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event);
        this.onAnnotation?.(key, false);
      });
      marker.on('contextmenu', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event);
        this.onAnnotation?.(key, true);
      });
      marker.addTo(this.#annotations);
      this.#annotationMarkers.set(key, marker);
    }
    this.selectAnnotation(this.#selectedItem);
  }

  focusAnnotation(item: MapItem) {
    const c = item.coordinates,
      nw: L.LatLngExpression = [c[0] / 1e7 - 90, c[1] / 1e7 - 180];
    this.#userMoved = true;
    if (item.geometry === 'rectangle')
      this.map.fitBounds(L.latLngBounds(nw, [c[2] / 1e7 - 90, c[3] / 1e7 - 180]), {
        padding: [36, 36],
        maxZoom: 16,
      });
    else this.map.setView(nw, Math.max(12, this.map.getZoom()));
  }

  #targets() {
    return (
      this.map.hasLayer(this.#layer)
        ? [...this.#markers.values()].map(({ marker }) => marker.getLatLng())
        : []
    )
      .concat(this.map.hasLayer(this.#annotations) ? this.#annotationBounds : [])
      .concat(this.#me ? [this.#me.getLatLng()] : []);
  }

  /** Frames the team as it appears, until the user moves the map themselves. */
  frame() {
    if (this.#userMoved) return;
    const targets = this.#targets();
    if (targets.length <= this.#framed) return;
    this.#framed = targets.length;
    this.#fitTo(targets);
  }

  /** Returns false when there's nothing to show. */
  fit() {
    const targets = this.#targets();
    if (!targets.length) return false;
    this.#fitTo(targets);
    return true;
  }

  #fitTo(targets: L.LatLng[]) {
    if (targets.length === 1) {
      this.map.setView(targets[0], Math.max(this.map.getZoom(), 13));
      return;
    }
    this.map.fitBounds(L.latLngBounds(targets), { padding: [80, 80], maxZoom: 14 });
  }
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
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
