# Web agent plugins

Open Settings → Plugins → Install / update JSON, select a definition and review its identity, version, types and settings. Confirm to install. The manager supports enable/disable, settings, export and uninstall. Existing items survive disable/uninstall and render with a generic fallback. Definitions/settings persist in this browser; they are not installed on firmware or automatically distributed by radio.

Try the [Field Survey example](../../examples/agents/web/plugins/field-survey/) (`field-survey.json`), which adds a survey observation type, a shared condition field, a local-only reference and a show-labels setting. Install the file through the manager; no source edit or rebuild is needed. `show-labels` is the current presentation setting interpreted by the map host. Other plugin settings are validated/stored configuration exposed through the registry; JSON does not supply new executable behavior.

## Manifest version 1

Required fields: `manifestVersion: 1`, stable namespaced `id` (3–63 lower-case letters/digits/dots/hyphens), human-readable `name` (64 UTF-8 bytes), semantic `version` (`major.minor.patch`), `types` and optional `settings` arrays. Maximum file size is 64 KiB, with 24 types per definition and 12 fields per type/settings collection. Core IDs cannot be replaced. Unknown top-level contributions fail explicitly.

Each type defines `id`, `name`, `geometry` (`point`/`rectangle`), `icon`, `defaultColor` and optional `fields`. Supported icons: pin, flag, camp, hazard, medical, observation, search. Colors use `#RRGGBB`. No HTML, URLs, remote assets, network requests or scripts are executed.

Fields/settings define `id`, `label`, `type` (`text`, `number`, `boolean`, `select`), optional `default`, optional `shared` (default false), and `options` for select fields. IDs are lower-case letters/digits/underscore/hyphen, start with a letter and are at most 32 characters. Text values are bounded to 96 UTF-8 bytes, numbers must be finite and select values must belong to 1–16 declared options. Defaults are validated before installation. Shared metadata must still fit the map message budget.

Updates replace the same plugin ID only after review. Compatible setting values are retained; incompatible retained values block the update rather than silently reset settings. Existing item metadata is preserved, without automatic destructive migrations. Keep type/field IDs stable. Received types never auto-install plugins; unknown types retain core geometry/name/note/color and safe metadata for inspection.

The architecture separates parsing/type registration (`plugins.ts`), persistence/lifecycle (`map-store.ts`), and host UI/actions (`map-workspace.ts`). Version 1 contributes map types and settings. Future panel/action/data-source contributions require an explicit manifest and host implementation; unsupported contributions are not silently accepted. Executable integrations require a separate isolation/permission design. Plugins never receive crypto keys or plaintext callbacks.
