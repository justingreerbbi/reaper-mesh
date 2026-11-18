// One release version for everything a release ships: the firmware for every board, the desktop
// app and the package. See docs/contributing/releases.md.
//
//   node tools/release-version.ts set 0.12.0     write 0.12.0 everywhere, and date the changelog's
//                                                Unreleased section as v0.12.0 under a new empty one
//   node tools/release-version.ts check v0.12.0  fail unless every file says 0.12.0 and the
//                                                changelog has a v0.12.0 section (CI, on a tag)
//   node tools/release-version.ts notes v0.12.0  print that changelog section (the release notes)
import { readFileSync, writeFileSync } from 'node:fs';

const VERSION_HPP = 'firmware/components/reaper_device/include/reaper/version.hpp';
const TAURI_CONF = 'agents/desktop/src-tauri/tauri.conf.json';
const CARGO_TOML = 'agents/desktop/src-tauri/Cargo.toml';
const CARGO_LOCK = 'agents/desktop/src-tauri/Cargo.lock';
const PACKAGE_JSON = 'package.json';
const CHANGELOG = 'docs/overview/changelog.md';
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Every place the version is written, with how to read and replace it. */
const places: { file: string; pattern: RegExp; format: (v: string) => string }[] = [
  {
    file: VERSION_HPP,
    pattern: /(-reaper-mesh-v|kDisplayVersion\[\] = "v)(\d+\.\d+\.\d+)/g,
    format: v => v,
  },
  { file: TAURI_CONF, pattern: /^(  "version": ")(\d+\.\d+\.\d+)/gm, format: v => v },
  { file: CARGO_TOML, pattern: /^(version = ")(\d+\.\d+\.\d+)/gm, format: v => v },
  {
    file: CARGO_LOCK,
    pattern: /(name = "reaper-mesh-desktop"\nversion = ")(\d+\.\d+\.\d+)/g,
    format: v => v,
  },
  { file: PACKAGE_JSON, pattern: /^(  "version": ")(\d+\.\d+\.\d+)/gm, format: v => v },
];

function found(file: string, pattern: RegExp): string[] {
  return [...readFileSync(file, 'utf8').matchAll(pattern)].map(match => match[2]);
}

function section(version: string): string | undefined {
  const text = readFileSync(CHANGELOG, 'utf8');
  const start = text.search(new RegExp(`^## v${version.replaceAll('.', '\\.')}\\b`, 'm'));
  if (start < 0) return undefined;
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end).trim();
}

const [command, raw] = process.argv.slice(2);
const version = raw?.replace(/^v/, '') ?? '';
if (!['set', 'check', 'notes'].includes(command ?? '') || !SEMVER.test(version)) {
  throw new Error('usage: node tools/release-version.ts set|check|notes <version, such as 0.12.0>');
}

if (command === 'set') {
  for (const place of places) {
    const text = readFileSync(place.file, 'utf8');
    if (!found(place.file, place.pattern).length)
      throw new Error(`no version found in ${place.file}`);
    writeFileSync(
      place.file,
      text.replace(place.pattern, (_, prefix) => prefix + place.format(version)),
    );
  }
  if (!section(version)) {
    const text = readFileSync(CHANGELOG, 'utf8');
    if (!text.includes('\n## Unreleased\n'))
      throw new Error('the changelog has no Unreleased section');
    const date = new Date().toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });
    writeFileSync(
      CHANGELOG,
      text.replace('\n## Unreleased\n', `\n## Unreleased\n\n## v${version} — ${date}\n`),
    );
  }
  console.log(`Version ${version} written. Review the diff, commit it, then tag v${version}.`);
} else if (command === 'check') {
  const problems: string[] = [];
  for (const place of places) {
    const versions = found(place.file, place.pattern);
    if (!versions.length || versions.some(v => v !== version))
      problems.push(`${place.file} says ${[...new Set(versions)].join(', ') || 'nothing'}`);
  }
  if (!section(version)) problems.push(`${CHANGELOG} has no "## v${version}" section`);
  if (problems.length)
    throw new Error(`Release v${version} does not match:\n- ${problems.join('\n- ')}`);
  console.log(`Every file is at ${version}.`);
} else {
  const notes = section(version);
  if (!notes) throw new Error(`${CHANGELOG} has no "## v${version}" section`);
  // The heading becomes the release title; the body is the notes. Links relative to the changelog
  // would break on the release page, so they point at the tagged docs on GitHub instead.
  const base = `https://github.com/justingreerbbi/reaper-mesh/blob/v${version}/docs/overview/`;
  const body = notes
    .split('\n')
    .slice(1)
    .join('\n')
    .replace(
      /\]\((?!https?:|mailto:|#)([^)\s]+)\)/g,
      (_, link: string) => `](${new URL(link, base)})`,
    );
  console.log(body.trim());
}
