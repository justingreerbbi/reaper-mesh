# Field Survey plugin

A declarative plugin for the web agent (`agents/web/`). It adds:

- A **Survey observation** map point type.
- A **Condition** select field that is included when the item is shared (`"shared": true`).
- A **Private local reference** text field that stays in this browser (`"shared": false`).
- A **Show map labels** plugin setting.

## Try it

1. Run the web agent (`npm run dev:web`) and open it.
2. Open Settings → Plugins → Install / update JSON and choose `field-survey.json`.
3. Review the definition and confirm.
4. On the map, add a point and choose the Survey observation type.

No source edit or rebuild is needed. The plugin runs no code. See
[Web agent plugins](../../../../../docs/guides/plugins.md) for the manifest format and limits.
