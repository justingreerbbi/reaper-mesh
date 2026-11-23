/**
 * Builds the signals reference pack (D61): who makes a device, from its address prefix or Bluetooth
 * company ID, and the names of Bluetooth services. The portal serves the file from its own origin
 * and keeps the newest copy it has fetched, so identification works offline and sends nothing.
 *
 *   node tools/build-signals-reference.ts          # fetch the sources and write the pack
 *   node tools/build-signals-reference.ts --check  # check the committed pack is well formed
 *
 * Sources: the IEEE registration authority's public MA-L, MA-M and MA-S listings, and Nordic
 * Semiconductor's bluetooth-numbers-database (BSD-3-Clause; its notice travels in the pack).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  checkReferencePack,
  REFERENCE_PACK_VERSION,
  type ReferencePack,
} from '../packages/agent-core/signals-identify.ts';

const OUTPUT = 'agents/web/public/signals-reference.v1.json';
const IEEE = {
  mal: 'https://standards-oui.ieee.org/oui/oui.csv',
  mam: 'https://standards-oui.ieee.org/oui28/mam.csv',
  mas: 'https://standards-oui.ieee.org/oui36/oui36.csv',
} as const;
const NORDIC =
  'https://raw.githubusercontent.com/NordicSemiconductor/bluetooth-numbers-database/master';

/** One CSV line into fields, with quoted fields that may hold commas and doubled quotes. */
function csvFields(line: string) {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      fields.push(field);
      field = '';
    } else field += c;
  }
  fields.push(field);
  return fields;
}

async function text(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': 'reaper-mesh-reference-builder' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

const tidy = (name: string) => name.replace(/\s+/g, ' ').trim();

async function build(): Promise<ReferencePack> {
  const makers: string[] = [];
  const index = new Map<string, number>();
  const maker = (name: string) => {
    const clean = tidy(name);
    let at = index.get(clean);
    if (at === undefined) {
      at = makers.push(clean) - 1;
      index.set(clean, at);
    }
    return at;
  };
  const registries = { mal: '', mam: '', mas: '' };
  for (const [registry, url] of Object.entries(IEEE) as [keyof typeof IEEE, string][]) {
    const width = registry === 'mal' ? 6 : registry === 'mam' ? 7 : 9;
    const rows: [string, number][] = [];
    for (const line of (await text(url)).split(/\r?\n/).slice(1)) {
      if (!line.trim()) continue;
      const [, assignment, organisation] = csvFields(line);
      if (!assignment || !organisation || !new RegExp(`^[0-9A-F]{${width}}$`).test(assignment))
        continue;
      if (/^private$/i.test(organisation.trim())) continue;
      rows.push([assignment, maker(organisation)]);
    }
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    registries[registry] = rows.map(([prefix, at]) => `${prefix}${at.toString(36)}`).join(' ');
  }
  const companies = JSON.parse(await text(`${NORDIC}/v1/company_ids.json`)) as {
    code: number;
    name: string;
  }[];
  const services = JSON.parse(await text(`${NORDIC}/v1/service_uuids.json`)) as {
    name: string;
    uuid: string;
  }[];
  const license = await text(`${NORDIC}/LICENSE`);
  return {
    version: REFERENCE_PACK_VERSION,
    built: new Date().toISOString().slice(0, 10),
    notice:
      'Address prefixes: IEEE Registration Authority public listings (MA-L, MA-M, MA-S). ' +
      'Bluetooth company identifiers and service names: Nordic Semiconductor ' +
      `bluetooth-numbers-database. ${tidy(license)}`,
    makers,
    oui: registries,
    bluetoothCompanies: companies
      .filter(c => Number.isInteger(c.code) && c.name)
      .map(c => [c.code, tidy(c.name)] as [number, string]),
    bluetoothServices: services
      .filter(s => /^[0-9A-F]{4}$/i.test(s.uuid) && s.name)
      .map(s => [s.uuid.toUpperCase(), tidy(s.name)] as [string, string]),
  };
}

if (process.argv.includes('--check')) {
  const problem = checkReferencePack(JSON.parse(readFileSync(OUTPUT, 'utf8')));
  if (problem) throw new Error(`${OUTPUT}: ${problem}`);
  console.log(`${OUTPUT} is well formed`);
} else {
  const pack = await build();
  const problem = checkReferencePack(pack);
  if (problem) throw new Error(problem);
  writeFileSync(OUTPUT, JSON.stringify(pack) + '\n');
  console.log(
    `Wrote ${OUTPUT}: ${pack.makers.length} makers, ${pack.bluetoothCompanies.length} Bluetooth companies`,
  );
}
