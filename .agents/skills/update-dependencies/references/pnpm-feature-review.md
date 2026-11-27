# pnpm feature review

Reference for step 2 of `update-dependencies`. Whenever batch 0 moves the pnpm pin, review every release between the old pin and the new one. You then propose a feature worth adopting with the bump that brings it, instead of discovering it in a retroactive audit. The range is always (old pin, new pin]. The repository adopted pnpm at 12.20.0 with the settings in `pnpm-workspace.yaml`, so the first review starts after 12.20.0. _Standing verdicts_ records the outcomes.

## Sources

- Every minor has a release post at `https://pnpm.io/blog/releases/<major>.<minor>` (some posts cover a span such as `11.11-11.14`). A major also has a "what's different" post linked from its release post. Keep the entries under **Major Changes** and **Minor Changes**. Patch releases only fix things. But read the GitHub release notes of every patch tag in the range (`https://github.com/pnpm/pnpm/releases/tag/v<version>`). Look for a changed default or a fix the repository was waiting for.
- The settings pages under `https://pnpm.io/settings/` carry an "Added in" version per setting and the current spelling. pnpm renames settings (`auditConfig.ignoreGhsas` became `audit.ignore`, `cleanupUnusedCatalogs` became `catalogPrune`), and the docs describe the newest major.
- The docs are not proof. pnpm 12's Rust port does not implement everything its docs describe (`failIfNoMatch` as a setting before 12.10.0, the root project's `engines` check before 12.6.0). So every "adopt" verdict rests on a probe (see _Verifying a candidate_).

## Surfaces a feature can land on

| Feature class | Where it lands here |
| --- | --- |
| Install settings and supply-chain policy | `pnpm-workspace.yaml`, the comment convention in `references/workspace-exceptions.md` |
| Commands that belong in a gate | the `dependency-audit` job in `.github/workflows/ci.yml`, a script in `package.json`, the check suite in step 7 |
| Install and cache behavior in CI | `.github/actions/setup/action.yml` (`pnpm/action-setup` and its cache), `.gitignore` |
| Version management of pnpm and Node.js | `packageManager`, `.nvmrc`, `references/toolchain.md`, the prerequisites in `CONTRIBUTING.md` |
| Manifest protocols | `package.json`, `overrides` |
| Publishing and release management | the semantic-release flow and npm trusted publishing; usually a "keep" unless a blocker is lifted |
| Anything that renames a setting or command this skill names | `SKILL.md` and the references, mirrored to the sibling repositories |

## Verdicts

Give every entry in the range exactly one verdict, and put the table in the batch 0 hand-off:

- **adopt** — only after the probe below passed on the pinned pnpm. Name the concrete change per surface.
- **already in effect** — a default since some version, or a setting the repository set earlier. Name which.
- **superseded** — replaced by something the repository already uses or adopts in the same review. Name it.
- **not applicable** — say why in a few words: single-package repository, no workspace packages, no remote build-cache server, no git-hosted dependencies, and so on.
- **blocked** — worth it but a repository constraint forbids it. Name the constraint from _Standing verdicts_ and what would lift it.
- **later** — worth it once a prerequisite lands. Name the prerequisite and the release or date that reopens it.

The user chooses from the table. Right after you stage batch 0, the accepted features become the `pnpm features` batch. It holds the settings, CI, `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, and skill changes together. Verify them with the check suite and the probes, and mirror them as `SKILL.md` → _Batching guidance_ says. Record every declined, blocked, or deferred verdict under _Standing verdicts_ so the next review does not re-propose it.

## Verifying a candidate

- Probe on a scratch copy of the manifests, never on the repository. Copy `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`. Delete the `prepare` script in the copy, and add the setting. Then run `pnpm install --frozen-lockfile --lockfile-only` and `pnpm config get <setting>`. When the pin matches the running pnpm, an unrecognized setting fails with `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`. pnpm does not implement a setting that installs cleanly but reads back `undefined` and changes nothing, whatever the docs say. It does implement one that reads back `undefined` yet changes the behavior (`autoDedupe` in 12.7.0). So judge by the behavior.
- Exercise the behavior, not just the parse. A rewrite-time feature needs a real lockfile write. `pnpm add <pkg>@<version> --lockfile-only` forces one, while a plain `pnpm install --lockfile-only` takes the up-to-date shortcut and re-resolves nothing. A filter feature needs a selector that matches nothing, and a policy feature needs an entry that should be rejected or pruned.
- When the docs and the probe disagree, compare with the previous pnpm. Once `pnpm_config_pm_on_fail=ignore` disables the pin switch, `npx -y pnpm@<previous> <command>` runs the older version in the scratch copy. A behavior that the previous version had and the new one lacks is a regression to report upstream, not a feature to rely on.
- Watch for the writer: pnpm rewrites `pnpm-workspace.yaml` without any comment inside a YAML list. So a feature that triggers rewrites (prune settings, `pnpm audit --fix`) must keep the comment convention of `references/workspace-exceptions.md`.

## Standing verdicts

Outcomes that later reviews inherit. Unless its condition changes, do not revisit one.

- `autoDedupe` and `lockfile.includeResolutionSettings` — already in effect: `pnpm-workspace.yaml` sets both. Every lockfile write deduplicates, and a frozen install rejects a lockfile resolved with other settings. The `pnpm dedupe --check` gate stays.
- `blockExoticSubdeps` — already in effect: pnpm 12 defaults to it, and `pnpm-workspace.yaml` sets it explicitly in case the default changes.
- `minimumReleaseAgeExcludePrune`, `trustPolicyExcludePrune`, and `audit.ignorePrune` — already in effect: `pnpm-workspace.yaml` sets all three.
- `catalog:`, `catalogMode`, `catalogPrune`, workspace package filters and `failIfNoMatch`, `injectWorkspacePackages`, `projectScopedOptionalPeers`, and `pnpm deploy` — not applicable: the repository is a single package with no workspace packages.
