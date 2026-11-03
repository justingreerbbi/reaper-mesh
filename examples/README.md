# Examples

Examples mirror the path of the component they work with, so it is always clear which part
of the project an example targets:

```text
examples/
  agents/
    web/                    Examples for the browser agent in agents/web/
      plugins/
        field-survey/       One folder per example plugin
          field-survey.json   The file you install
          README.md           What it shows and how to try it
```

An example for another agent goes under `examples/agents/<agent>/`, and a firmware example
goes under `examples/firmware/<board>/`, matching `agents/<agent>/` and `firmware/<board>/`.
Give each example its own folder with a README, even when it is a single file.

Examples are working files, not test fixtures. Host tests may load them to make sure they keep
working (`tests/simulator/map-sharing.test.ts` parses Field Survey), but frozen compatibility
fixtures belong in `packages/protocol/fixtures/`.

| Example | Component | What it shows |
| --- | --- | --- |
| [Field Survey](agents/web/plugins/field-survey/) | Web agent plugin | A custom map item type with shared and local-only fields, and a plugin setting |
