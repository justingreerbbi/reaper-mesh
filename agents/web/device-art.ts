// The device as the hero of its screen: a generic LoRa handheld, not a picture of a specific board.
// Only real values are drawn on its screen. Colors follow the theme.
let serial = 0;

export function drawDeviceArt(host: HTMLElement, label: string, line: string, active: boolean) {
  const signature = `${label}|${line}|${active}`;
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  const body = `art-body-${++serial}`;
  const metal = `art-metal-${serial}`;
  const screen = active ? '#B2DDA3' : '#616161';
  const title = label.slice(0, 12);
  host.innerHTML = `<svg viewBox="0 0 340 170" role="img" aria-label="Illustration of a Reaper radio device">
    <defs>
      <linearGradient id="${body}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--art-body-top)" />
        <stop offset="1" style="stop-color:var(--art-body-bottom)" />
      </linearGradient>
      <linearGradient id="${metal}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--art-metal-top)" />
        <stop offset="1" style="stop-color:var(--art-metal-bottom)" />
      </linearGradient>
    </defs>
    <ellipse cx="150" cy="150" rx="128" ry="9" style="fill:var(--art-shadow)" opacity="0.55" />
    <rect x="238" y="70" width="18" height="16" rx="2" fill="url(#${metal})" />
    <rect x="254" y="74" width="74" height="8" rx="4" fill="url(#${metal})" />
    <circle cx="328" cy="78" r="5" style="fill:var(--art-metal-bottom)" />
    <rect x="26" y="34" width="214" height="110" rx="20" fill="url(#${body})" style="stroke:var(--art-edge)" stroke-width="1.2" />
    <rect x="36" y="44" width="194" height="90" rx="13" style="fill:var(--art-bezel)" />
    <rect x="46" y="54" width="124" height="70" rx="6" fill="#050505" stroke="#2B2C28" />
    <text data-art="label" x="56" y="80" fill="${screen}" font-size="${title.length > 9 ? 13 : 17}" font-weight="600"></text>
    <text data-art="line" x="56" y="102" fill="${screen}" font-size="12" opacity="0.75"></text>
    <rect x="56" y="110" width="104" height="3" rx="1.5" fill="${screen}" opacity="0.35" />
    <circle cx="199" cy="72" r="13" fill="url(#${metal})" />
    <circle cx="199" cy="72" r="9" style="fill:var(--art-knob)" />
    <circle cx="199" cy="107" r="9" fill="url(#${metal})" />
    <circle cx="199" cy="107" r="6" style="fill:var(--art-knob)" />
    <circle cx="222" cy="56" r="3" fill="${screen}" />
  </svg>`;
  // Device names come from the radio, so they're set as text and never parsed as markup.
  host.querySelector('[data-art="label"]')!.textContent = title;
  host.querySelector('[data-art="line"]')!.textContent = line.slice(0, 18);
}
