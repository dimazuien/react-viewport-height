# Toolchain checks

Reference for step 2 of `update-dependencies`. The toolchain moves before any package batch because package resolution, the lockfile format, and the type definitions depend on it.

## What to compare

| Pin | Lives in | Target | Cadence |
| --- | --- | --- | --- |
| pnpm | `packageManager` in `package.json` (exact version; the Corepack hash suffix is optional and `pnpm self-update` writes none). The setup action's `pnpm/action-setup` installs the same version in CI | The newest release older than the repository's `minimumReleaseAge`, from the publish dates in `pnpm view pnpm time --json` (`latest` is often younger). pnpm installs its own pin under that policy, so a younger pin blocks every command with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` | Every run |
| Node.js major | `.nvmrc` (`v<major>`) and every place listed under _Where a Node major is pinned_ | The highest major whose `lts` field in `https://endoflife.date/api/nodejs.json` is a date in the past | Majors only, about once a year |

Report everything as batch 0 of the plan, even when nothing moves, so the user sees what you checked.

## Where a Node major is pinned

Find the full set with `git log -1 --stat -- .nvmrc` (the previous bump touched every relevant file) and a search for the current major such as `rg -n '\bv26\b|Node\.js 26|"@types/node": "26\.'`. Typical places:

- `.nvmrc`, which `actions/setup-node` in `.github/actions/setup/action.yml` reads through `node-version-file`, so CI follows it
- `@types/node` in `package.json`, which moves to the newest installable version of the new major. Between Node majors, it takes minor and patch updates of the current major only
- the Node.js prerequisite sentence in `CONTRIBUTING.md`

## GitHub Actions

`.github/workflows/*.yml` and the composite setup action in `.github/actions/setup/action.yml` reference each action by its major tag, such as `actions/checkout@v7`. A major tag moves with every release in that major, so only a new major needs a change. List the references with `rg -n 'uses: [^.]' .github`.

- For each action, list its recent releases with `gh release list --repo <owner>/<repo> --exclude-pre-releases --limit 10`. Target the newest major whose first release is older than the repository's `minimumReleaseAge`, the same quarantine npm packages get.
- Read the release notes of the new major. A major usually changes the action's runtime, such as a newer Node.js, or its inputs and defaults.
- Change every reference to an action in the same batch, across the workflows and the setup action. Actions from one repository move together, such as `github/codeql-action/init` and `github/codeql-action/analyze`.
- Report the candidates as a separate CI batch, never folded into batch 0. A local run can't exercise a workflow, so the batch's check is the next pushed run.

## TRACK-held pins

A `TRACK` comment beside the code that depends on the hold keeps each of these packages back. On every run, check the condition against the upstream issue the comment links. When the condition holds, the package's major step joins the plan, and its batch removes the comment and the row together. When a batch holds a new package back, add its row here with its `TRACK` comment.

| Package | Held at | Until | `TRACK` comment |
| --- | --- | --- | --- |
| `typescript` | 6 | typescript-eslint supports TypeScript 7 | `eslint.config.ts`, above the `typescript-eslint` import |
| `eslint` | 9 | eslint-plugin-react and eslint-plugin-jsx-a11y support ESLint 10 | `eslint.config.ts`, above the `eslint-plugin-jsx-a11y` import |
| `conventional-changelog-conventionalcommits` | 9.3.1 | `@semantic-release/release-notes-generator` ships conventional-changelog-writer 9 | `release.config.ts`, at the top |
| `semantic-release` | 25 | `@semantic-release/commit-analyzer` 14, `@semantic-release/release-notes-generator` 15, and `@semantic-release/npm` 14 ship stable releases | `release.config.ts`, below the changelog preset |
