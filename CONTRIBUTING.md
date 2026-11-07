# Contributing to Reaper Mesh

Thanks for your interest in Reaper Mesh. Contributions of every size are welcome: a typo fix, a
bug report from a field test, a new board, or a feature in the web portal.

This page gets you from zero to a merged pull request. The detailed rules live in the
[contributing docs](docs/README.md#contributing-change-the-project); you only need them when you
reach that step.

## Ways to help

| You can… | How |
| --- | --- |
| **Report a bug** | Open an issue with what you did, what you expected, what happened, and your board, firmware version and browser |
| **Test on hardware** | Run the [field qualification](docs/contributing/field-qualification.md) tests, especially if you have three or more boards, and share the results |
| **Improve the docs** | If something confused you, it will confuse the next person. Fix it in place |
| **Write a plugin** | Add a map item type with a [JSON plugin](docs/guides/plugins.md) and share it in `examples/` |
| **Fix or build** | Pick something from the [roadmap](docs/overview/roadmap.md) or an open issue. For anything large, open an issue first so we can agree on the approach |

## Before you write code: the one principle

Reaper Mesh keeps its **firmware and protocols small and stable**, and builds new features in
the apps and plugins instead (decision [D41](docs/contributing/decisions.md#d41-stable-core-extensible-edges)).
Boards should rarely need a firmware update.

So if your idea touches the firmware or the radio protocol, explain in the issue why an app or
plugin cannot do it. Board-only features such as screen layout must never change the radio
protocol. Until core v1, breaking protocol changes are possible but need the maintainer's
approval ([D42](docs/contributing/decisions.md#d42-no-compatibility-promise-before-core-v1)).

## 1. Set up

You need Node.js 24 or 25, Python 3.9+, a C++17 compiler and Git.

```sh
git clone https://github.com/justingreerbbi/reaper-mesh.git
cd reaper-mesh
npm ci --ignore-scripts
npm run check
```

`npm run check` should pass before you change anything. To see the app, run `npm run dev:web`
and connect the simulated device ([Getting started](docs/guides/getting-started.md)). Firmware
work also needs ESP-IDF ([Flashing firmware](docs/guides/flashing-firmware.md)).

## 2. Make your change

1. **Branch** from `main` as `type/short-description`, for example `fix/tbeam-snapshot-timeout`.
2. **Find your way around** with the [repository layout](docs/contributing/plan.md#repository-layout).
   Protocol and recovery logic belong in `packages/agent-core/`, not in UI code. Board pins and
   radio details stay out of the mesh core.
3. **Add tests.** Anything touching communication or storage needs deterministic tests for
   lost, duplicated, delayed and out-of-order cases. Tests that rely on `sleep` do not count as
   evidence.
4. **Update the docs** your change affects, in the same pull request. Each fact has one home;
   see [where information lives](docs/README.md#where-information-lives).
5. **Run `npm run check`** and, if you changed formatting-sensitive files, `npm run format`.

A few hard rules:

- Never hand-edit generated files (`packages/protocol/messages.generated.ts`,
  `firmware/components/reaper_protocol/include/reaper/schema.generated.hpp`). Edit
  `packages/protocol/schema.json` and run `npm run generate:protocol`.
- Never change the frozen fixtures in `packages/protocol/fixtures/` to make a test pass. A
  protocol change appends new fixtures, or changes old ones only with the maintainer's approval.
- Only claim what you tested. Host tests do not prove radio behavior; say which boards and
  firmware you used, or "not tested on hardware".
- Do not copy code from Meshtastic or any project with an incompatible license.

## 3. Commit

Commits use [Conventional Commits](https://www.conventionalcommits.org/) and **must be signed**:

```text
fix(tbeam): retry the node snapshot after a timeout
```

Types include `feat`, `fix`, `docs`, `test`, `refactor` and `build`; scopes name the area, such
as `web`, `firmware`, `protocol` or `radio`. Setting up SSH signing takes three commands; see
[Commits and pull requests](docs/contributing/commits-and-prs.md).

## 4. Open a pull request

Use the same `type(scope): summary` format for the title, and include:

- **What and why:** the change and the reason for it.
- **Verification:** what ran and the result.
- **Hardware:** which boards and firmware were tested, or "Not tested on hardware".
- **Compatibility:** protocol, storage or fixture impact, or "None".
- **Docs:** which documents you updated.

CI must pass. Pull requests are merged with **Create a merge commit**, so your signed commits are
kept.

## Safety with real radios

If you test on hardware: attach the antenna before transmitting, use the band your board was
made for, and follow your local radio rules. Reaper Mesh only supports US 915 MHz today. Never
run whole-chip erases or eFuse changes on a board you are testing with.

## License

Reaper Mesh is licensed under the [Apache License 2.0](LICENSE). By contributing, you agree that
your contributions are licensed under the same terms (section 5 of the license).
