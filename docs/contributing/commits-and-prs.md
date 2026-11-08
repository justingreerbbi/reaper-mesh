# Commits, branches and pull requests

Reaper Mesh uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). A
consistent format keeps the history readable, makes it possible to find when a protocol or
firmware behavior changed, and lets release notes be built from commit subjects.

## Commit format

```text
type(scope): summary

Optional body explaining what changed and why.

Optional footers
```

- **Summary**: imperative mood ("add", not "added"), lower case after the colon, no trailing
  period, at most 72 characters including the prefix.
- **Body**: wrap at 72 characters. Explain why the change was needed and anything a reviewer
  cannot see from the diff. Use a short bullet list for changes across several files.
- **One logical change per commit.** Do not mix a refactor, a feature and a docs fix in one
  commit. Never use placeholder messages such as `asd` or `update`.

### Types

| Type | Use for |
| --- | --- |
| `feat` | A new capability for users or other components |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `test` | Adding or correcting tests only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance or resource-use improvement (RAM, flash, airtime) |
| `build` | Build scripts, toolchain, dependencies, firmware packaging |
| `ci` | GitHub Actions workflows |
| `chore` | Maintenance that fits none of the above (for example `.gitignore`) |
| `revert` | Reverting an earlier commit; the body names the reverted commit |

### Scopes

Use the part of the repository the change affects. Omit the scope only when a change truly
spans the whole project.

| Scope | Path |
| --- | --- |
| `protocol` | `packages/protocol/` (schema, generated bindings, fixtures) |
| `agent-core` | `packages/agent-core/` |
| `simulator` | `packages/simulator/` |
| `web` | `agents/web/` |
| `flasher` | `agents/flasher/` (the browser firmware installer) |
| `firmware` | `firmware/components/` and changes shared by both boards |
| `heltec` | `firmware/heltec-v3/` only |
| `stick` | `firmware/heltec-stick-v3/` only |
| `tbeam` | `firmware/tbeam-v12/` only |
| `radio` | Radio drivers and the radio/mesh protocol |
| `tools` | `tools/` (build, update, package, hardware smoke tests) |
| `tests` | `tests/` |
| `examples` | `examples/` |
| `ci` | `.github/` (usually with type `ci`) |
| `docs` | `docs/`, `AI.md`, READMEs (usually with type `docs`) |
| `deps` | `package.json`, `package-lock.json`, vendored code (usually with type `build`) |

### Breaking changes

Reaper Mesh promises compatibility between agent and firmware releases, so breaking changes
must stand out in the history. Mark one with `!` before the colon and a `BREAKING CHANGE:`
footer that says what breaks and how to migrate. This applies to any change that older agents or
firmware cannot handle: wire formats, USB or radio protocol versions, config storage records,
browser storage keys and frozen fixtures.

### Footers

- `Refs: #12` or `Fixes: #12` to link an issue.
- `Co-Authored-By: Name <email>` for co-authors, including AI assistants.

### Examples

These illustrate the format; they do not describe real commits.

```text
feat(web): add rectangle sharing to the map workspace
```

```text
fix(tbeam): retry node snapshot reads after a serial timeout

A long test timed out reading a node snapshot. Retry the bounded read
once before reporting the session as recovering.
```

```text
feat(radio)!: raise fragment payload to 200 bytes

Cuts a 1,024-byte message from 7 fragments to 6.

BREAKING CHANGE: radio protocol version is now 2. Nodes running radio
protocol 1 cannot reassemble the larger fragments; update both boards.
```

```text
docs(examples): organize examples by the component they target
```

## Signed commits

Every commit MUST be signed and show **Verified** on GitHub. Signing proves who made a change,
which matters for a project whose firmware and encryption others will trust.

SSH signing is the simplest setup if you already use an SSH key:

```sh
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519_signing.pub
git config --global commit.gpgsign true
```

Then add the same public key on GitHub under **Settings → SSH and GPG keys → New SSH key** with
key type **Signing Key**. A key registered only for authentication does not verify signatures.
GPG keys work too; register them under **GPG keys**. The commit email must be a verified email
on your GitHub account.

To check signatures locally, list trusted keys in an allowed-signers file and point Git at it:

```sh
git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers
git log --show-signature -1
```

`git log --format='%h %G? %s'` shows `G` for a good signature and `N` for none. Merge commits
made by GitHub are signed with GitHub's key and show `E` locally (key not known) but Verified on
GitHub.

If a commit is unsigned, re-sign it before pushing: `git commit --amend -S --no-edit` for the
last commit, or `git rebase --exec 'git commit --amend -S --no-edit' <base>` for several. Never
disable signing or use `--no-gpg-sign` to get a commit through.

## Branches

Name branches `type/short-description` using the same types, for example
`feat/map-point-sharing`, `fix/tbeam-snapshot-timeout` or `docs/commit-guidelines`. Do not commit
directly to `main`; open a pull request.

## Pull requests

- **Title**: the same format as a commit summary, `type(scope): summary`.
- **Merge with "Create a merge commit".** It keeps each signed commit and the commit hashes listed
  in `.git-blame-ignore-revs`. "Rebase and merge" is not used: GitHub cannot sign rebased commits,
  so it is blocked while `main` requires signed commits. "Squash and merge" is not used either,
  because it replaces the individual commits and their hashes.
- **Description**: include these sections:
  - **What and why**: the change and the reason for it.
  - **Verification**: what ran (`npm run check`, CTest, firmware builds) and the result.
  - **Hardware**: which boards and firmware were tested, or "Not tested on hardware". Never imply
    RF, relay or range results that were not observed.
  - **Compatibility**: protocol, storage or fixture impact, or "None".
  - **Docs**: which documents were updated (status, changelog, decisions, references).
- Keep a pull request to one topic. Split unrelated changes into separate pull requests.
- All CI checks must pass before merging. Update the documentation affected by the change in the
  same pull request (see [AI.md](../../AI.md#where-things-go)).
