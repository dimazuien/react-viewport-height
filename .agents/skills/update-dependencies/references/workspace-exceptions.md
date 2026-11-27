# Supply-chain exceptions in `pnpm-workspace.yaml`

Reference for step 9 of `update-dependencies`. Setting names and error codes are those of pnpm 12. Confirm them against the pnpm version pinned in `packageManager` before relying on one.

## Comment convention

Every package-scoped entry gets a YAML comment. It states what the entry protects against or enables, and the evidence (advisory ID, upstream issue, or introducing commit). It also states the exit condition — `Remove when …` — or `Permanent:` plus why. When the reason had to be inferred from history rather than documented, say so in the comment. Where the comment goes depends on the YAML shape. In a mapping (`overrides`, `allowBuilds`), it sits directly above the entry or at the end of its line. In a list (`minimumReleaseAgeExclude`, `trustPolicyExclude`, `audit.ignore`), every reason goes into the block comment above the list, one line per entry. pnpm rewrites these lists without any comment placed inside them. With `minimumReleaseAgeExcludePrune`, `trustPolicyExcludePrune`, and `audit.ignorePrune` enabled, pnpm removes a version-pinned entry itself once the lockfile or the audit report no longer contains it. Delete its reason line from the block comment by hand.

```yaml
overrides:
  # GHSA-xxxx-xxxx-xxxx: fast-uri < 3.1.4 in ajv's range. Remove when `pnpm why fast-uri`
  # shows every parent requesting a patched range without this pin.
  fast-uri: 3.1.4

# - nx@21.6.5: GHSA-xxxx-xxxx-xxxx fix published 2026-01-02; leaves the release-age window on
#   2026-01-09, pnpm drops the entry once the lockfile no longer resolves it.
minimumReleaseAgeExclude:
  - nx@21.6.5
```

## Probing safely

- Run rejected-policy and override-removal probes in an isolated directory. Give it the repository's `package.json`, and the index's workspace settings and lockfile (`git show :pnpm-workspace.yaml` and `git show :pnpm-lock.yaml`). The index includes earlier reviewed batches. Change one setting per probe and inspect its install output and resolved package versions. Do not back up and restore the working lockfile: after a `pnpm update`, it would no longer match the installed graph (`SKILL.md` → _Ground rules_). The isolated probe must never replace the working repository's lockfile or modules.
- Remove expired `minimumReleaseAgeExclude` entries before probing overrides. While an entry is present, a probe's re-resolution prefers the newest version, young ones included. Once the entry is gone, that lockfile fails verification with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`. Re-create the isolated probe from the index and re-resolve without the expired entry.
- `pnpm install --lockfile-only` re-verifies the existing lockfile against the policies without re-resolving anything. A removed `trustPolicyExclude` entry surfaces immediately. A removed `minimumReleaseAgeExclude` entry does not, because the age check runs at resolution time. A removed override keeps its old resolution until something forces a re-resolution.
- Lockfile entries look like `<pkg>@<version>:` indented by two spaces under `packages:` and `snapshots:`. `grep -n -E "^  <pkg>@" pnpm-lock.yaml` lists every resolved version, and `pnpm why <pkg>` shows which parents request it.

## Verification per setting

### `overrides`

- Security pin of a transitive dependency: run `pnpm why <pkg>` to see the parents, and delete the override line. Run `pnpm update <pkg>`, which re-resolves within the ranges the parents request, and grep the lockfile for what resolved. When every resolved version is inside the advisory's patched range, keep the removal. Otherwise, restore the line, and name in its comment the parent that still requests a vulnerable range.
- Convergence pin: one version of a package forced onto the whole graph, such as a single `@types/react`. Describe in the comment which duplicate it prevents. When the probe above shows a single resolved version without the pin, it can go.

### `minimumReleaseAgeExclude`

- A temporary entry lets a fresh fix — usually a security patch — install before it is `minimumReleaseAge` old. Find the resolved versions in the lockfile, and read their publish dates with `pnpm view <pkg> time --json`. When every resolved version is older than the window, remove the entry. The fresh resolution in step 10 is the real test.

### `trustPolicyExclude`

- Entries are `name@version` pairs that pnpm rejected with `ERR_PNPM_TRUST_DOWNGRADE`. If the version is no longer in the lockfile, remove the entry. If it is, delete the entry and run `pnpm install --lockfile-only`. A supply-chain check failure naming the entry means it is still needed, so restore it. Then check whether a later version of that package restored provenance, and whether a parent bump moves past it. That is the exit condition.
- Never add a new entry without checking the package's registry page and upstream for an incident. A lost provenance attestation is exactly the signal the policy exists for.

### `allowBuilds`

- `true` entries name packages whose install scripts are required (native binaries, platform downloads). `false` entries block scripts on purpose (telemetry, analytics). Remove entries for packages that are no longer in the lockfile. Also remove a `true` entry whose installed version ships no install script any more: check the `scripts` of its manifest. pnpm never consults such an entry, and leaving it would pre-approve a script a later release adds. Keep the `false` ones with their reason.
- New requests arrive as `ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: <pkg>@<version>`. Inspect the `scripts` of `node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>/package.json` before allowing, and write the entry by hand (`pnpm approve-builds` is interactive and adds no comment).

### `audit.ignore`

- Remove the entry, and run `pnpm audit` (its severity comes from `audit.level`). Unless the advisory still matches and no fix is resolvable, do not put it back. Check whether upstream corrected the advisory's ranges or a parent now requests a patched version, and record that as the exit condition.

### New advisories

- `pnpm audit` must pass because CI runs it. Prefer bumping the direct dependency that pulls the vulnerable range. Otherwise, add an `overrides` entry pinned to the patched version. When several majors are in the graph, use `<pkg>@<major>` selectors in that entry. When the patched version is younger than the window, also add a temporary `minimumReleaseAgeExclude` entry. `pnpm audit --fix` proposes overrides. Treat its output as a draft and write the entries with comments yourself.
- A Dependabot security pull request for the same advisory proposes a fix too. Compare it with the entry you write, and name the pull request in the hand-over.

## Error signatures (pnpm 12)

- `ERR_PNPM_NO_MATURE_MATCHING_VERSION` — the requested version is younger than `minimumReleaseAge`. The message includes the cutoff timestamp.
- `ERR_PNPM_TRUST_DOWNGRADE` — the version's trust evidence is weaker than an earlier-published version's. Every install verifies the whole lockfile against the policy, so a stale exclusion surfaces on the next install.
- `ERR_PNPM_IGNORED_BUILDS` — a dependency with install scripts is not listed in `allowBuilds`.
