// Small shared pieces of the interface: icons, pill selectors, notices and confirmation sheets.
import {
  Activity,
  AppWindow,
  ArrowDownUp,
  Bluetooth,
  Camera,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  Copy,
  Cpu,
  Crosshair,
  Database,
  EllipsisVertical,
  FlaskConical,
  Fullscreen,
  Hash,
  Image,
  Info,
  KeyRound,
  Layers,
  List,
  LocateFixed,
  Lock,
  LockOpen,
  MapPin,
  MapPinOff,
  MapPinned,
  MemoryStick,
  MessageSquare,
  Minimize,
  Minus,
  Monitor,
  Pencil,
  Plus,
  Puzzle,
  QrCode,
  Radar,
  Radio,
  RadioTower,
  RefreshCw,
  Ruler,
  Scan,
  ScanLine,
  Send,
  Settings2,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Tag,
  Trash2,
  Undo2,
  Unplug,
  Usb,
  User,
  Users,
  Waves,
  X,
  createElement,
  type IconNode,
} from 'lucide';
import { element } from './dom.ts';

const ICONS: Record<string, IconNode> = {
  activity: Activity,
  'app-window': AppWindow,
  'arrow-down-up': ArrowDownUp,
  bluetooth: Bluetooth,
  camera: Camera,
  check: Check,
  'check-check': CheckCheck,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'circle-alert': CircleAlert,
  'circle-check': CircleCheck,
  'circle-dashed': CircleDashed,
  'circle-help': CircleHelp,
  copy: Copy,
  cpu: Cpu,
  crosshair: Crosshair,
  database: Database,
  'ellipsis-vertical': EllipsisVertical,
  'flask-conical': FlaskConical,
  fullscreen: Fullscreen,
  hash: Hash,
  image: Image,
  info: Info,
  'key-round': KeyRound,
  layers: Layers,
  list: List,
  'locate-fixed': LocateFixed,
  lock: Lock,
  'lock-open': LockOpen,
  'map-pin': MapPin,
  'map-pin-off': MapPinOff,
  'map-pinned': MapPinned,
  'memory-stick': MemoryStick,
  'message-square': MessageSquare,
  minimize: Minimize,
  minus: Minus,
  monitor: Monitor,
  pencil: Pencil,
  plus: Plus,
  puzzle: Puzzle,
  'qr-code': QrCode,
  radar: Radar,
  radio: Radio,
  'radio-tower': RadioTower,
  'refresh-cw': RefreshCw,
  ruler: Ruler,
  scan: Scan,
  'scan-line': ScanLine,
  send: Send,
  'settings-2': Settings2,
  'share-2': Share2,
  'shield-check': ShieldCheck,
  'sliders-horizontal': SlidersHorizontal,
  square: Square,
  tag: Tag,
  'trash-2': Trash2,
  'undo-2': Undo2,
  unplug: Unplug,
  usb: Usb,
  user: User,
  users: Users,
  waves: Waves,
  x: X,
};

/** An icon from the same set as the mobile app. A label makes it readable; otherwise it's decor. */
export function icon(name: string, options: { label?: string; className?: string } = {}) {
  const svg = createElement(ICONS[name]) as unknown as SVGElement;
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('class', `ui-icon ${options.className ?? ''}`.trim());
  if (options.label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', options.label);
  } else svg.setAttribute('aria-hidden', 'true');
  return svg;
}

/** Replaces each <i data-icon="name"> in the page's markup with its icon. */
export function hydrateIcons(root: ParentNode = document) {
  for (const holder of root.querySelectorAll<HTMLElement>('i[data-icon]')) {
    const svg = icon(holder.dataset.icon!, {
      className: holder.className,
      label: holder.getAttribute('aria-label') ?? undefined,
    });
    if (holder.id) svg.id = holder.id;
    if (holder.hidden) svg.setAttribute('hidden', '');
    holder.replaceWith(svg);
  }
}

export function setIcon(button: HTMLElement, name: string) {
  button.querySelector('svg')?.replaceWith(icon(name));
}

/** A notice's text; an empty one hides it. */
export function setNotice(id: string, message: string | undefined, tone?: 'good' | 'warn' | 'bad') {
  const node = element(id);
  node.hidden = !message;
  if (node.textContent !== (message ?? '')) node.textContent = message ?? '';
  if (tone) node.dataset.tone = tone;
}

/**
 * Pill selectors over ordinary <select data-segmented> elements. The select stays the source of
 * truth, so forms read and write it as usual; the pills follow it on every render pass.
 */
export function syncSegmented() {
  for (const select of document.querySelectorAll<HTMLSelectElement>('select[data-segmented]')) {
    let group = select.nextElementSibling as HTMLElement | null;
    if (!group?.classList.contains('segmented')) {
      group = document.createElement('div');
      group.className = 'segmented';
      group.setAttribute('role', 'radiogroup');
      group.setAttribute(
        'aria-label',
        document.querySelector(`label[for="${select.id}"]`)?.textContent ?? select.id,
      );
      select.after(group);
      select.hidden = true;
    }
    // A device's option can be turned off (by capability) or added (a value set elsewhere).
    const options = [...select.options].filter(option => !option.disabled);
    const signature = options.map(option => `${option.value}=${option.text}`).join('|');
    if (group.dataset.signature !== signature) {
      group.dataset.signature = signature;
      group.replaceChildren(
        ...options.map(option => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = option.text;
          button.dataset.value = option.value;
          button.setAttribute('role', 'radio');
          button.addEventListener('click', () => {
            if (select.value === option.value) return;
            select.value = option.value;
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
          });
          return button;
        }),
      );
    }
    group.setAttribute('aria-disabled', String(select.disabled));
    for (const button of group.querySelectorAll<HTMLButtonElement>('button')) {
      const selected = button.dataset.value === select.value;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-checked', String(selected));
      button.disabled = select.disabled;
    }
  }
}

/** The app's own confirmation, in place of the browser's. Resolves true on confirm. */
export function confirmSheet(options: {
  title: string;
  body: string;
  confirm: string;
  cancel?: string;
  danger?: boolean;
}) {
  const sheet = element<HTMLDialogElement>('confirm-sheet');
  element('confirm-title').textContent = options.title;
  element('confirm-body').textContent = options.body;
  const ok = element<HTMLButtonElement>('confirm-ok');
  const cancel = element<HTMLButtonElement>('confirm-cancel');
  ok.textContent = options.confirm;
  ok.classList.toggle('danger', !!options.danger);
  ok.classList.toggle('primary', !options.danger);
  cancel.textContent = options.cancel ?? 'Keep';
  sheet.showModal();
  return new Promise<boolean>(resolve => {
    const finish = (answer: boolean) => {
      ok.onclick = cancel.onclick = null;
      sheet.onclose = null;
      if (sheet.open) sheet.close();
      resolve(answer);
    };
    ok.onclick = () => finish(true);
    cancel.onclick = () => finish(false);
    sheet.onclose = () => finish(false);
  });
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
