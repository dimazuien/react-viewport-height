---
name: update-dependencies
description: Update a pnpm package repository's toolchain, npm dependencies, and GitHub Actions in reviewable batches. Check pnpm, the Node.js major with `@types/node`, and the packages that `TRACK` comments hold back first, inventory what is outdated, and group packages by tooling scope. Order batches from least to most risky, with a same-major step before any major jump. Apply one batch at a time with the full check suite while the user reviews and stages each. Then justify, prune, and comment every supply-chain exception in `pnpm-workspace.yaml`, and finish with a lockfile resolved fresh from the manifests. Use when the user asks to update, upgrade, or bump dependencies, packages, pnpm, Node.js, or GitHub Actions, or check what is outdated. Also use when they ask whether a held package can move, or to review `pnpm-workspace.yaml` overrides, `allowBuilds`, trust-policy, release-age, or audit exclusions. Also use when they ask to run the same update across sibling repositories. Also use when they ask to review what the pnpm releases since the current pin added, and whether the repository should adopt it. Not for adding a new dependency or bumping one package as part of feature work.
---

# Update Dependencies

## Purpose

Move the repository's npm dependencies, its toolchain, and its CI actions forward without losing control. Every change lands in a batch the user can review, stage, or discard on its own. Every supply-chain exception in `pnpm-workspace.yaml` carries a reason and an exit condition. The run ends with a lockfile resolved fresh from the manifests. The repository is the unit of work. A multi-repository run, such as the same update in a sibling package, is an explicit opt-in. It repeats the same flow in each repository (see `references/multi-repository-runs.md`).

## Ground rules

- Review comes before staging, and staging happens only on the user's go-ahead. After a batch, hand over and wait. When the user says to proceed, stage everything the batch changed. Only then continue, so the unstaged area is clean at the start of every batch. Never stage before that go-ahead, and never run `git reset`, `git stash`, or `git commit`. Never stage or touch changes recorded in the step 1 baseline that the user made outside this run. Steps 9 and 10 follow the same review and staging cycle: passing checks does not authorize staging a batch the user has not reviewed.
- A rollback is `git restore --worktree -- <files this batch touched>` followed by `pnpm install`: it returns the working tree to the last staged state and re-syncs `node_modules`. Unless the user says to discard, or a major step fails and the same-major version is the agreed fallback, don't roll back.
- Every hand-off leaves the repository runnable, so the tests, the build, and the other scripts work for manual verification. At each hand-off, `node_modules` matches the manifests and lockfile: a probe, a rollback, or a lockfile-only step always ends with `pnpm install`.
- pnpm 11 and later run `verifyDepsBeforeRun: install` by default: every `pnpm run` and `pnpm exec` compares `node_modules` with the lockfile and runs a full install when they differ. The lockfile on disk must therefore always be the one `node_modules` was installed from.
- Every resolving command (`pnpm outdated`, `pnpm update`, `pnpm add`, `pnpm install`) honors the repository's `minimumReleaseAge`. So `latest` in `pnpm outdated` is the newest **installable** version, not the newest published one. `pnpm view` shows the raw registry, quarantined versions included. Do not fight the quarantine: unless a version that is too young fixes an advisory, it is a next-run candidate, not a `minimumReleaseAgeExclude` entry. An existing exclusion makes young versions installable, not preferable.
- Manifests pin exact versions (`savePrefix: ''`), so `pnpm update <pkg>@<version>` writes the version verbatim. pnpm intersects a range form such as `<pkg>@^1` with the exact pin, so it changes nothing. Always pass an explicit version, or `--latest` for the newest installable one. Treat `pnpm update` as an install — in a workspace it modifies `node_modules` even with `--lockfile-only`. Only `pnpm install --lockfile-only` reliably leaves `node_modules` alone.
- Read pnpm settings against the version pinned in `packageManager` (`pnpm --version`). The docs site describes the newest major, and a setting renamed in a newer major is not a fix.
- The toolchain is batch 0. On every run, pnpm moves to its newest release older than `minimumReleaseAge`. Node.js moves only to a new major once it is Active LTS, and `@types/node` follows it. The batch goes through review and staging like any other.
- A package that a `TRACK` comment holds back stays at its held version until the comment's condition holds. `references/toolchain.md` → _TRACK-held pins_ lists the holds. Check each condition on every run.
- The peer dependency ranges are the package's public contract (`CONTRIBUTING.md` → _Dependencies_). A batch moves the development copy of a peer, such as `react`, only within the peer range, and never changes a `peerDependencies` range. A range change is a change of its own: propose it to the user.

## Steps

1. **Read the repository instructions and CI list.**
   - Read `AGENTS.md`, `README.md`, and `CONTRIBUTING.md`.
   - Then map every job in `.github/workflows/ci.yml` to its local script. Those scripts are the check suite for every batch.
   - Record `git status --short` so you know which changes predate the run.
   - List the open Dependabot security pull requests with `gh pr list --author 'app/dependabot' --state open`, so the plan covers their packages.

2. **Check the toolchain and independent tool pins.**
   - Compare the pnpm and Node.js pins with their current releases, as described in `references/toolchain.md`. Present the result as batch 0 of the plan, even when nothing moves.
   - Check each hold in `references/toolchain.md` → _TRACK-held pins_ against its upstream issue. Report each hold as kept or lifted. A lifted hold's major step joins the plan.
   - Inspect the GitHub Actions versions, as `references/toolchain.md` → _GitHub Actions_ describes. Report them separately, as a batch of their own, and do not fold their updates into batch 0.
   - When something does move, batch 0 runs first, through the same apply, check, hand-over, and staging cycle as every other batch. Its changes are `pnpm self-update <version>` plus a lockfile migration for pnpm, and every pin the reference lists for a Node major.
   - When pnpm moves, also review every release between the old and the new pin, as described in `references/pnpm-feature-review.md`. Present the verdict table with batch 0. Right after you stage batch 0, apply the features the user accepts as the `pnpm features` batch.

3. **Inventory.**
   - Run `pnpm outdated --format json`, and pipe it through `node .agents/skills/update-dependencies/scripts/resolve-update-targets.ts` from the repository root. The script adds the newest installable version within the current major, the bump kind, and deprecation and quarantine notes.
   - Move a `pnpm` row to batch 0. It is the `packageManager` pin, which `pnpm outdated` lists once a newer pnpm leaves the quarantine. Never put it in a package batch.
   - Mark the rows that a hold in `references/toolchain.md` → _TRACK-held pins_ covers. A held package takes only its same-major step.
   - Add the `overrides` entries in `pnpm-workspace.yaml` that pin a direct dependency: they win over the manifest, so they must move in the same batch.

4. **Batch and order.**
   - Group packages by tooling or purpose so each batch has one verification story (see _Batching guidance_), then order batches from least to most risky.
   - A package whose newest installable version is a different major gets two steps. `<batch> (same major)` takes the newest installable version in the current major, and sits with the safe batches. `<batch> (major)` takes the newest version, and sits with the risky ones. When the major step fails, its fallback is the same-major version, never the original.
   - Present the plan as a numbered list of batches. Give each its package → version pairs, bump kind, why the batch sits where it does, and the manual verification it will need.
   - Stop and wait for the user to name the batch to run.

5. **Apply the requested batch.**
   - Run `pnpm update <pkg>@<version> ...` for every package in the batch.
   - In the same edit, move the matching `overrides` pins.
   - Resolve install-time policy errors before continuing.
     - For `ERR_PNPM_NO_MATURE_MATCHING_VERSION`, use the newest installable version the script reported.
     - For `ERR_PNPM_IGNORED_BUILDS`, read the package's install script, then add the `allowBuilds` entry with a comment per `references/workspace-exceptions.md`.
     - For `ERR_PNPM_TRUST_DOWNGRADE`, stop and investigate upstream before considering an exclusion, because lost provenance can mean a takeover.
     - For a new peer issue, compare `pnpm peers check` with its output before the batch, because held majors keep the install warning on permanently. Align any new row: an auto-installed peer that the lockfile keeps at an older version collapses with `pnpm update <peer>`. When no release of a peer accepts the new major, run the tool anyway to confirm, since a plugin can crash on a removed API. Then treat the major step as failed, and take its same-major fallback. Leave a `TRACK` comment with the upstream issue beside the config that loads the blocking plugin, and add the hold to `references/toolchain.md` → _TRACK-held pins_.
   - Then run `pnpm dedupe --check`. Another dependency can also pull a package transitively or as an auto-installed peer (an ESLint plugin behind a preset, for example). Such a package can end up twice in the lockfile, and ESLint fails with "Cannot redefine plugin" when two instances of a plugin meet. `autoDedupe` in `pnpm-workspace.yaml` collapses such a duplicate while the update writes the lockfile, so the check normally passes.
   - When the check fails, collapse what remains. When the package is only transitive, use `pnpm update <pkg>`. When it is also a direct dependency, use `pnpm dedupe`, since `pnpm update <pkg>` then leaves the transitive copy alone.
   - A passing check does not prove a single version. An optional peer that the lockfile still resolves to the old version (an ESLint plugin's `@typescript-eslint/parser` peer, for example) survives `autoDedupe` and `pnpm dedupe`. So list each updated package family with `grep -E "^  '?<pkg>@" pnpm-lock.yaml`. Collapse a leftover with `pnpm update <peer>`, naming the stale package.
   - Sometimes you cannot collapse a duplicate or a held-back version, because another package pins the old version, and a later batch updates that package. In that case, push the affected package to that later batch. Never pull the later package forward: it sits later for a reason. Check for this at planning time too: the dependency ranges of packages in later batches (`pnpm view <pkg>@<version> dependencies`) show which earlier-batch packages they pin.

6. **Absorb the change.**
   - For minor and major bumps, read the release notes of every package in the batch before running checks. When a release page carries only automated dependency bumps, read the package's `CHANGELOG.md` instead. Count 0.x minors as majors.
   - Apply the required code, config, or migration changes.
   - Remember that the tests can pass while the published package breaks. The build checks the package's exports and type declarations with publint and arethetypeswrong. So a batch that touches TypeScript, the bundler, or type definitions also runs `pnpm build`.
   - When a workaround must stay because of an upstream blocker, add a `TRACK:` comment per `CONTRIBUTING.md`.
   - Also remove what the update lifts. Search the repository for `TRACK` comments, lint suppressions, mocks, shims, and config aliases that name a package in the batch. Also search for new defaults that make manual setup redundant, such as a test runner clearing mocks itself. Re-test each one without the workaround, and drop the ones that pass. When a hold lifts, remove its row from `references/toolchain.md` → _TRACK-held pins_ together with its `TRACK` comment. Silently kept workarounds are the other way an update stays half-done.
   - Prefer holding a package over a hacky workaround. A failed major step falls back to the same-major version, and a failed minor or patch step to the newest mature version that passes. Record the reason in the plan.
   - When code depends on the hold, add a `TRACK:` comment beside that code, naming the condition that lifts it.

7. **Run the check suite.** Every script the CI jobs map to: `pnpm typecheck`, `pnpm lint`, `pnpm lint:markdown`, `pnpm lint:spelling`, `pnpm test:coverage`, and `pnpm build`.
   - Then run the `dependency-audit` job's commands, which CI runs on every push: `pnpm audit`, whose severity comes from `audit.level`, `pnpm audit signatures`, and `pnpm dedupe --check`.
   - Fix failures the batch caused. Report pre-existing failures instead of fixing them silently.
   - A GitHub Actions batch runs only in CI. Say in the hand-over that the next pushed run of the workflows is its check.

8. **Hand the batch to the user.**
   - Report the versions applied, the code and config changes, the checks that passed, anything held back with its reason, and the manual verification the batch needs. For build and language tooling, that's a look at the files `pnpm build` writes to `dist/`, the type declarations included. For lint and format tooling, it's a look at autofix diffs.
   - Make sure the repository is runnable as described in _Ground rules_, then stop.
   - When the user says to proceed, stage the batch. Then offer the next one by name, listing the packages and versions it contains.
   - When they ask you to look into something, fix it, re-run the checks, and report again.
   - When they discard the batch, roll it back as described in _Ground rules_, and note the held-back versions in the plan.

9. **Review the supply-chain exceptions.** After the last batch, or when the user asks, walk every package-scoped entry in `pnpm-workspace.yaml`, following `references/workspace-exceptions.md`. That covers `minimumReleaseAgeExclude`, `trustPolicyExclude`, `overrides`, `allowBuilds`, `audit.ignore`, and any other package-scoped setting.
   - Verify whether each entry is still needed, and remove the ones that are not. pnpm already drops a version-pinned exclusion or an ignored advisory once it leaves the lockfile or the audit report. So what remains to judge is whether a present entry is still justified.
   - Add the ones that `pnpm audit` and the install output demand.
   - Give every remaining entry a comment with its reason and exit condition, or the reason it is permanent. On the first run, this includes backfilling comments for existing entries. Derive reasons from `git log -S<entry> -- pnpm-workspace.yaml`, advisory pages, and `pnpm why`. When a reason is inferred rather than documented, say so.
   - Global policies (`minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`, `audit.level`) stay as they are. The one edit allowed is dropping a global setting that merely restates the default of the pinned pnpm version. Check the default against that version's settings reference.
   - Finish with `pnpm install`, `pnpm audit`, `pnpm peers check`, and the check suite.
   - Then hand the changes to the user, and wait for their go-ahead before staging. In the handoff, explicitly separate newly added audit ignores, removed ignores, dependency updates, and comment-only changes. A newly accepted advisory needs to be visible for review.

10. **Resolve fresh.**
    - Delete `node_modules` and `pnpm-lock.yaml` in the same step. The repository's `reset` script removes `node_modules` along with build output. With `node_modules` intact, `pnpm install` restores the lockfile from `node_modules/.pnpm/lock.yaml` in milliseconds instead of resolving.
    - Then run `pnpm install` followed by `pnpm dedupe`. `autoDedupe` collapses a package only when one version satisfies every range in the graph. So a fresh resolution can still leave an edge that `pnpm dedupe --check` flags.
    - Review the lockfile diff for transitive packages that jumped a major or resolved to a version an advisory covers. The lockfile holds a second YAML document for pnpm's own pin, so a script comparing versions must read every `packages:` section.
    - Run the check suite, `pnpm audit`, and `pnpm peers check`.
    - Fix what the re-resolution surfaced: a new `allowBuilds` request, an override that is now needed, a transitive breakage.
    - Hand the result to the user, and wait for their go-ahead before staging.
    - When the reset removed build output, run `pnpm build` before handing over.

11. **Close out.** Summarize per repository: batches applied, packages held back and why, exceptions removed or added, and follow-ups. The follow-ups cover:
    - packages to retry once they leave the quarantine window, and holds whose upstream condition is close;
    - pnpm features deferred with the condition that reopens them;
    - `TRACK` comments whose fixing release is now installed (`review-track-comments` covers that audit);
    - each open Dependabot pull request that the run's updates supersede, for the user to close.

## Batching guidance

- One batch, one verification story. Typical scopes: type definitions (`@types/*`); test tooling (Vitest, its coverage provider, jsdom, Testing Library); lint, format, and spelling tooling (ESLint core and plugins, typescript-eslint, Prettier, cspell, markdownlint-cli2); build and language tooling (TypeScript, tsdown, publint, arethetypeswrong, Vite and its React plugin); the peers under test (React, React DOM, and the other packages the peer ranges name, with their `@types/*` packages); release and commit tooling (semantic-release and its plugins, the changelog preset, commitlint, Commitizen, Husky, lint-staged); and GitHub Actions as a batch of their own.
- Keep in one batch what is versioned together (one monorepo or publisher, a package and its `@types/*` package, a plugin and the tool it extends). Do the same for what a peer range ties together (a raised peer floor and the packages that must satisfy it).
- Risk signals that push a batch later: a major bump, a deprecation, a changed peer range, a package named in a `TRACK` comment, a package that shapes the published output (TypeScript, the bundler), and release notes that mention migration scripts or removed APIs. Patch-only tooling batches go first, the peers under test next, majors last.
- A deprecated package gets a replacement proposal in the plan, not a silent bump.
- `pnpm features` is the batch that follows a pnpm bump. It holds the settings, CI, documentation, and skill changes for the features the user accepted from the review. Verify them with the check suite and the probes the reference describes. Mirror them to the sibling repositories where the same surface exists. Outside an opted-in multi-repository run, ask for each sibling repository's go-ahead before mirroring there.

## Multi-repository runs

When the user asks for a multi-repository run, read `references/multi-repository-runs.md`.

## Output

Per batch, a handoff naming the versions applied, the code and config changes, the checks that ran, and the manual verification left to the user. Per run, staged exception cleanup and fresh resolution, plus a close-out summary of what moved, what was held back and why, and the follow-ups.

## Don't

- Don't stage before the user's go-ahead, never unstage, stash, commit, or discard on the user's behalf, and don't touch changes that predate the run.
- Don't run several batches at once or merge batches to save time.
- Don't add or keep a `pnpm-workspace.yaml` exception without a comment, and don't relax the global policies.
- Don't move a held package past its hold, or change a `peerDependencies` range in a batch.
- Don't rename or restructure pnpm settings to match documentation for a newer pnpm major than the pinned one.
- Don't paper over a failing major update. Hold the same-major version and record why.
- Don't bump Node.js to a major that is not yet Active LTS, or to a minor or patch release; majors only.
