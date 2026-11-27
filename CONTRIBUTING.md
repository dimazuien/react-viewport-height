# Contributing

Thanks for contributing. This guide covers how to set up the project, the conventions the code follows, and how a change gets released.

**Working on your first pull request?** You can learn how from the [First Contributions guide](https://github.com/firstcontributions/first-contributions).

## Project Setup

You need Node.js 26 and pnpm 12. `.nvmrc` names the Node.js version, and with direnv, `.envrc` switches to it through nvm. Install pnpm with its standalone script or with `npm install --global pnpm`. Node.js no longer ships Corepack.

1. Fork and clone the repository.
1. Run `pnpm ci` to install the dependencies.
1. Create a branch for your pull request with `git checkout -b pr/your-branch-name`.

> Tip: Keep your `main` branch pointing at the original repository, and make pull requests from branches on your fork. To set this up, run:
>
> ```sh
> git remote add upstream https://github.com/dimazuien/react-viewport-height.git
> git fetch upstream
> git branch --set-upstream-to=upstream/main main
> ```
>
> The first command adds the original repository as a remote called `upstream`. The second fetches it, and the third makes `git pull` on your `main` branch pull from `upstream/main`. Base your pull request branches on that `main` branch.

### Repository Map

```text
src/
├── index.ts               # Public exports
└── useVH/
    ├── index.ts           # The hook
    └── index.test.tsx     # Its tests
docs/index.md              # The user documentation
.agents/skills/            # The agent skills, which AGENTS.md lists
```

### Common Commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Builds `dist/` with tsdown and checks the package with publint and arethetypeswrong. |
| `pnpm build:watch` | Rebuilds on every change. |
| `pnpm typecheck` | Type-checks the repository. |
| `pnpm typecheck:watch` | Type-checks on every change. |
| `pnpm lint` | Runs ESLint and fixes what it can. |
| `pnpm lint:markdown` | Lints the Markdown files. |
| `pnpm lint:spelling` | Checks spelling with cspell. |
| `pnpm format` | Formats the repository with Prettier. |
| `pnpm test` | Runs the tests once. |
| `pnpm test:coverage` | Runs the tests with coverage. |
| `pnpm test:watch` | Reruns the tests on every change. |
| `pnpm reset` | Deletes `node_modules` and the generated output. |

In VS Code, each command is also a task. With the recommended `actboy168.tasks` extension, the tasks of the development flow show as status bar buttons, and `pnpm: all` runs every watch task in split panes.

## Coding Conventions

### General

- Write documentation, comments, and identifiers in American English. `pnpm lint:spelling` checks spelling against the en-US dictionaries. Fix real typos, and add legitimate terms to `cspell.json`.
- Keep each module in a folder with an `index` file, and keep its tests next to it. Export a new module from `src/index.ts`.
- A change to the public API updates `README.md` and `docs/index.md` in the same pull request.
- When you add, rename, or remove a `package.json` script, update `.vscode/tasks.json` in the same change. It holds a `pnpm: <script>` task for each script a developer runs by hand, and none for `prepare` or `release`. Only the tasks of the development flow show in the status bar. Every other task sets `options.statusbar.hide`. A watch-mode script gets a second task, `pnpm: <script> (split)`, which runs it in the shared `main` terminal group, shows in the status bar in place of the plain task, and joins `pnpm: all`.

### Dependencies

- `package.json` pins exact versions, through `savePrefix: ''` in `pnpm-workspace.yaml`.
- `pnpm-workspace.yaml` holds the supply-chain policy. pnpm installs a version only after it has been published for three days, and rejects a version with weaker trust evidence than an earlier release. Every exception there carries a reason and an exit condition, in the block comment above its list.
- The peer dependency ranges are the package's public contract. Widening one is a `feat`, and narrowing one is a breaking change.
- Toolchain and batch dependency updates follow the `update-dependencies` agent skill. Dependabot opens a pull request for each security update.

### TRACK Comments

Reserve a `TRACK:` comment for a necessary change that something outside the repository blocks, such as an upstream bug or an unreleased fix.

- Place the comment directly beside the workaround or pin it explains.
- State the action to take and the condition that makes it possible. Link the upstream issue or pull request where one exists.
- Once the condition is met and the fix is installed, remove the comment together with the workaround.

```ts
// TRACK: Remove this workaround when https://github.com/owner/project/issues/123
// is fixed and the fixing release is installed.
```

### TypeScript

- Unless extending an external contract makes an interface clearer, prefer `type` over `interface`.
- Avoid `any`. Use narrowing, generics, or precise types.
- `strict` is on. Resolve a type error by narrowing or by making the type say what is true. Unless the assertion genuinely holds, don't reach for `!` or `as`, and when you do, leave a comment saying why.

### React

- Write components as arrow functions, and type their props explicitly.
- Follow the rules of hooks. ESLint's `react-hooks` rules check them.

## Testing

- Use Vitest and Testing Library, and keep each test file next to the code it tests.
- Prefer `userEvent` and role-based queries.
- Test observable behavior rather than implementation details.
- When asserting one exact mock call, prefer `toHaveBeenCalledExactlyOnceWith(...)`.
- Coverage must stay at 100%. `pnpm test:coverage` fails below it.

## Commits and Pull Requests

### Commit Format

The repository uses [Conventional Commits](https://conventionalcommits.org). commitlint validates the messages, and the `prepare-commit-msg` hook opens a Commitizen prompt in interactive shells.

```text
feat: add an option to name the custom property
fix: keep --vh while another component uses the hook
docs: point to the dvh unit
test: cover window resizing
```

### Versioning and Publishing

[semantic-release](https://github.com/semantic-release/semantic-release) publishes a release from every push to `main` that contains a `feat`, a `fix`, or a breaking change. A `feat` makes a minor release, a `fix` a patch, and a breaking change a major one. The package goes to npm through trusted publishing, with a provenance attestation, and the notes go to `CHANGELOG.md` and the GitHub release.

Don't edit `CHANGELOG.md` or the `version` in `package.json` by hand.

### Pre-commit Hooks

`lint-staged` runs these checks on staged files, and fixes what it can:

- cspell on every file
- ESLint with `--fix`, Prettier, and `vitest related --run` on JavaScript and TypeScript files
- Prettier on CSS, JSON, YAML, and Markdown files

### Pull Request Checklist

Before opening or updating a pull request:

- run the relevant local checks: typecheck, lint, Markdown, spelling, tests, and build
- update the documentation for changed behavior
- describe the testing you did

GitHub Actions runs the same checks on every push: `typecheck`, `lint`, `lint-markdown`, `lint-spelling`, `lint-commits`, `unit-tests`, `dependency-audit` (`pnpm audit`, `pnpm audit signatures`, and `pnpm dedupe --check`), and `build`. CodeQL scans the code as well.

## AI-assisted Development

- `AGENTS.md` holds the instructions for AI coding tools. AI tools should read this guide for the workflow and the conventions before making non-trivial changes.
- When you update `AGENTS.md`, keep this guide the source of truth for contributor-facing conventions, and keep `AGENTS.md` focused on what only agents need.
- `.agents/skills/` holds the repository's agent skills, `review-spelling-words`, `review-track-comments`, and `update-dependencies`, and `.claude/skills` is a symlink to it.

## Security

If you discover a vulnerability, follow the process in [SECURITY.md](./SECURITY.md).

## Other Ways to Help

Have a look at the [open issues](https://github.com/dimazuien/react-viewport-height/issues), and respond to questions, bug reports, and feature requests.
