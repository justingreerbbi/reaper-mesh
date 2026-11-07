# Web portal plugins

Plugins add new kinds of map items to the web portal, such as a survey observation or a hazard,
with their own fields and settings. Today's plugins are **declarative JSON**: they describe
data and never run code, load remote content or send messages.

## Install a plugin

1. Open **Device → Plugins**.
2. Under **Install or update from JSON**, choose a plugin file.
3. Review its name, version, item types and settings, then confirm.

The manager can enable, disable, configure, export and uninstall plugins. Items you created stay
on the map after a plugin is disabled or removed, shown with a generic icon. Plugins live in
this browser only; they are not installed on the board or sent over the radio, and receiving an
item of an unknown type never installs anything.

Try the [Field Survey example](../../examples/agents/web/plugins/field-survey/): install
`field-survey.json` through the manager. No rebuild is needed.

## Write a plugin (manifest version 1)

```json
{
  "manifestVersion": 1,
  "id": "org.example.hazards",
  "name": "Hazards",
  "version": "1.0.0",
  "types": [
    {
      "id": "hazard",
      "name": "Hazard",
      "geometry": "point",
      "icon": "hazard",
      "defaultColor": "#E5484D",
      "fields": [
        {
          "id": "severity",
          "label": "Severity",
          "type": "select",
          "options": ["low", "medium", "high"],
          "default": "medium",
          "shared": true
        }
      ]
    }
  ],
  "settings": []
}
```

| Part | Rules |
| --- | --- |
| **File** | At most 64 KiB, 24 types, and 12 fields per type or settings list. Unknown top-level keys are rejected |
| **`id`** | 3–63 lower-case letters, digits, dots and hyphens; namespaced, for example `org.example.hazards`. Core IDs cannot be replaced |
| **`name`** | Up to 64 UTF-8 bytes |
| **`version`** | `major.minor.patch` |
| **Type** | `id`, `name`, `geometry` (`point` or `rectangle`), `icon` (`pin`, `flag`, `camp`, `hazard`, `medical`, `observation`, `search`), `defaultColor` (`#RRGGBB`) and optional `fields` |
| **Field or setting** | `id` (starts with a letter; lower-case letters, digits, `_`, `-`; up to 32 characters), `label`, `type` (`text`, `number`, `boolean`, `select`), optional `default`, `shared` (default `false`), and 1–16 `options` for `select` |
| **Values** | Text up to 96 UTF-8 bytes; numbers must be finite. Defaults are validated at install |

Only fields marked `shared` are sent when an item is shared, and they must fit the map message
size limit.

**Updating** replaces a plugin with the same `id` after review. Compatible setting values are
kept; an update that would invalidate a saved value is blocked rather than resetting it. Keep
type and field IDs stable between versions.

## How it fits together

Parsing and type registration are in `agents/web/plugins.ts`, storage and lifecycle in
`map-store.ts`, and the interface in `map-workspace.ts`. Version 1 contributes map types and
settings only.

**Code plugins** (for integrations such as weather radar, ADS-B or an APRS bridge) are planned.
They will run in a sandboxed iframe on a separate origin, with permissions declared in the
manifest and approved by the user, and will never receive channel keys (decision D40). They
wait on an approved design for the plugin message API.
