#!/usr/bin/env node
/**
 * Reviews the cspell word lists of one or more repositories and writes a
 * verified plan.
 *
 * A word list is any place that allows words: `words` and `ignoreWords` in the
 * repository's cspell config and in the configs it imports from inside the
 * repository, their `overrides`, the plain-text dictionaries they define with
 * `addWords`, and in-file `words` and `ignore` directives. The script empties
 * every list and lints the committed files with the repository's own cspell.
 * It keeps a word only where a committed file still fails without it. It tests
 * each in-file `disable` directive by removing it. It then lints the proposed
 * end state, restores every word whose removal makes cspell report a fragment
 * of it, and writes the plan.
 *
 * With several repositories, it also compares each shared config that one of
 * them publishes with the repositories in the run that import it. It proposes
 * removing shared words that no repository in the run needs, adding words that
 * two or more of them need, and removing repository words that the shared
 * config already lists. It asks about each shared word that only one of them
 * needs. The plan holds the edits that move such a word into the repository
 * that needs it.
 *
 * Usage:
 *   node review-words.ts [--repo <path>]... [--out <dir>]
 *   node review-words.ts --apply <plan.json>
 *
 * Without --repo, it reviews the current directory. List an upstream
 * repository before the repositories that import its shared config. --apply
 * makes the plan's changes, and the moves whose question has `accept: true`.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type Json = Record<string, unknown>;

export type Config = {
  file: string;
  data: Json;
  hasComments: boolean;
  owned: boolean;
  imports: Config[];
  publishedAs?: string;
};

type Token = { word: string; start: number; end: number };

type Span = { line: number; start: number; end: number };

export type Directive = Span & {
  file: string;
  ignore: boolean;
  tokens: Token[];
};

export type Disable = Span & { file: string; kind: string; endLine?: number };

export type Issue = { file: string; line: number; word: string };

export type Repo = {
  dir: string;
  label: string;
  cspell: string[];
  configs: Config[];
  committable: Set<string> | null;
  wordLists: Set<string>;
  directives: Directive[];
  disables: Disable[];
  packages: Map<string, string>;
  needs: Map<string, Set<string>>;
  notes: string[];
};

export type WordList = {
  repo: Repo;
  config?: Config;
  file: string;
  list: string;
  words: string[];
  scope?: (file: string) => boolean;
  directive?: Directive;
};

export type Proposal = {
  list: WordList;
  word: string;
  reason: string;
  afterRelease?: boolean;
};

export type Group = {
  source: Config;
  owner: Repo;
  members: Repo[];
  installed: Map<Repo, Set<string>>;
};

export type Addition = { group: Group; word: string; reason: string };

export type Change = {
  repo: string;
  file: string;
  action: 'remove' | 'add' | 'remove-disable';
  list: string;
  words: { word: string; reason: string }[];
  line?: number;
  lineText?: string;
  endLine?: number;
  endText?: string;
  afterRelease?: boolean;
};

export type Decision = {
  repo: string;
  file: string;
  word: string;
  question: string;
  accept: boolean;
  changes: Change[];
};

export type Plan = {
  created: string;
  repos: { dir: string; label: string; notes: string[] }[];
  changes: Change[];
  decisions: Decision[];
  kept: { repo: string; file: string; word: string; reason: string }[];
};

const CONFIG_NAMES = [
  'cspell.json',
  '.cspell.json',
  'cspell.jsonc',
  '.cspell.jsonc',
  'cspell.config.json',
  'cSpell.json',
];
const UNSUPPORTED_CONFIG = /^\.?cspell(\.config)?\.(ya?ml|[cm]?js|ts)$/i;
const CONFIG_FILE = /(^|\/)\.?cspell(\.config)?\.jsonc?$/i;
const WORD_KEYWORD =
  /(?:cspell|spell-?checker)\s*:\s*(words|ignore|ignoreWords)\b/gi;
const DISABLE_KEYWORD =
  /(?:cspell|spell-?checker)\s*:\s*(disable(?:-next)?(?:-line)?|enable)\b/gi;
const JSONC_TOKEN = /"(?:[^"\\]|\\.)*"|\/\/.*|\/\*[\s\S]*?\*\//g;
const COMMENT_ONLY = new Set(['', '<!---->', '//', '#', '/**/', '--', ';']);
const LANGUAGES = [
  'markdown',
  'typescript',
  'javascript',
  'json',
  'yaml',
  'shellscript',
  'plaintext',
];

export const norm = (word: string): string =>
  word
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]s$/, '');

const isInside = (dir: string, file: string): boolean => {
  const relative = path.relative(dir, file);
  return (
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  );
};

const toPosix = (file: string): string => file.split(path.sep).join('/');

const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  map.set(key, [...(map.get(key) ?? []), value]);
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const asObjects = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Json => typeof item === 'object' && item !== null,
      )
    : [];

// git and the cspell fallback come through PATH on purpose. The script runs in each
// developer's checkout, where the repository's own tools resolve them the same way.
function run(command: string[], cwd: string, input?: string) {
  const [cmd = '', ...args] = command;
  const options = {
    cwd,
    input,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  } as const;
  const result = spawnSync(cmd, args, options); // NOSONAR typescript:S4036
  if (result.error) throw result.error;
  return result;
}

// ---------------------------------------------------------------- configs

export function parseJsonc(text: string): { data: Json; hasComments: boolean } {
  let hasComments = false;
  const json = text.replaceAll(JSONC_TOKEN, (token) => {
    if (token.startsWith('"')) return token;
    hasComments = true;
    return token.startsWith('//') ? '' : ' ';
  });
  const data: unknown = JSON.parse(json.replaceAll(/,(\s*[}\]])/g, '$1'));
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('a cspell config must hold a JSON object');
  }
  return { data: data as Json, hasComments };
}

function publishedPackage(repoDir: string, file: string): string | undefined {
  for (
    let dir = path.dirname(file);
    isInside(repoDir, dir);
    dir = path.dirname(dir)
  ) {
    const manifest = path.join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const data = JSON.parse(readFileSync(manifest, 'utf8')) as {
      name?: string;
      private?: boolean;
    };
    return data.name && data.private !== true ? data.name : undefined;
  }
  return undefined;
}

function resolveImport(repoDir: string, file: string, spec: string): string {
  if (spec.startsWith('.') || path.isAbsolute(spec))
    return path.resolve(path.dirname(file), spec);
  try {
    return createRequire(file).resolve(spec);
  } catch {
    throw new Error(
      `${path.relative(repoDir, file)} imports ${spec}, which doesn't resolve. Install the repository's dependencies first.`,
    );
  }
}

export function loadConfig(
  repoDir: string,
  file: string,
  seen: Map<string, Config>,
): Config {
  const known = seen.get(file);
  if (known) return known;
  const { data, hasComments } = parseJsonc(readFileSync(file, 'utf8'));
  const owned =
    isInside(repoDir, file) && !file.split(path.sep).includes('node_modules');
  const config: Config = { file, data, hasComments, owned, imports: [] };
  if (owned) config.publishedAs = publishedPackage(repoDir, file);
  seen.set(file, config);
  const specs =
    typeof data.import === 'string' ? [data.import] : stringList(data.import);
  for (const spec of specs) {
    config.imports.push(
      loadConfig(repoDir, resolveImport(repoDir, file, spec), seen),
    );
  }
  return config;
}

export function findRootConfig(dir: string): string {
  const unsupported = readdirSync(dir).find((name) =>
    UNSUPPORTED_CONFIG.test(name),
  );
  if (unsupported) {
    throw new Error(
      `${dir}: ${unsupported} isn't a JSON config, which this script reviews. Review it by hand.`,
    );
  }
  const name = CONFIG_NAMES.find((candidate) =>
    existsSync(path.join(dir, candidate)),
  );
  if (!name) throw new Error(`${dir} has no cspell JSON config at its root.`);
  return path.join(dir, name);
}

// Local plain-text dictionaries a config defines and enables: the word lists under review.
export function reviewedDictionaries(
  config: Config,
): { name: string; file: string }[] {
  const enabled = new Set(stringList(config.data.dictionaries));
  return asObjects(config.data.dictionaryDefinitions).flatMap((definition) => {
    const name = typeof definition.name === 'string' ? definition.name : '';
    if (typeof definition.path !== 'string') return [];
    const file = path.resolve(path.dirname(config.file), definition.path);
    const local = existsSync(file) && !/\.(gz|trie)$/.test(file);
    return local && (definition.addWords === true || enabled.has(name))
      ? [{ name, file }]
      : [];
  });
}

// ---------------------------------------------------------------- files

function committableFiles(dir: string): Set<string> | null {
  const list = (args: string[]): string[] | null => {
    const result = run(['git', 'ls-files', '-z', ...args], dir);
    return result.status === 0
      ? result.stdout.split('\0').filter(Boolean)
      : null;
  };
  const tracked = list([]);
  if (!tracked) return null;
  return new Set([
    ...tracked,
    ...(list(['--others', '--exclude-standard']) ?? []),
  ]);
}

function walk(dir: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(dir, prefix), {
    withFileTypes: true,
  })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isFile()) files.push(relative);
    else if (
      entry.isDirectory() &&
      entry.name !== '.git' &&
      entry.name !== 'node_modules'
    ) {
      files.push(...walk(dir, relative));
    }
  }
  return files;
}

const repoFiles = (repo: Repo): Iterable<string> =>
  repo.committable ?? walk(repo.dir);

// A linked file is checked under its own path, so only regular files count.
function readText(file: string): string | null {
  if (!existsSync(file)) return null;
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.size > 5 * 1024 * 1024) return null;
  const text = readFileSync(file, 'utf8');
  return text.slice(0, 8000).includes('\0') ? null : text;
}

const readRepoFile = (repo: Repo, file: string): string =>
  readFileSync(path.join(repo.dir, file), 'utf8');

// The words a directive lists run from its keyword to the end of the line or comment.
export function directiveTokens(line: string, from: number): Token[] {
  const rest = line.slice(from);
  const stops = [rest.indexOf('-->'), rest.indexOf('*/')].filter(
    (index) => index >= 0,
  );
  const span = rest.slice(
    0,
    stops.length > 0 ? Math.min(...stops) : rest.length,
  );
  return [...span.matchAll(/[^\s,]+/g)].map((match) => ({
    word: match[0],
    start: from + match.index,
    end: from + match.index + match[0].length,
  }));
}

export function scanLine(
  repo: Repo,
  file: string,
  line: string,
  number: number,
  open: Disable[],
): void {
  for (const match of line.matchAll(WORD_KEYWORD)) {
    const keywordEnd = match.index + match[0].length;
    const tokens = directiveTokens(line, keywordEnd);
    const end = tokens.at(-1)?.end ?? keywordEnd;
    const ignore = /ignore/i.test(match[1] ?? '');
    repo.directives.push({
      file,
      line: number,
      ignore,
      tokens,
      start: match.index,
      end,
    });
  }
  for (const match of line.matchAll(DISABLE_KEYWORD)) {
    const kind = (match[1] ?? '').toLowerCase();
    if (kind === 'enable') {
      const block = open.pop();
      if (block) block.endLine = number;
      continue;
    }
    const end = match.index + match[0].length;
    const disable: Disable = {
      file,
      line: number,
      kind,
      start: match.index,
      end,
    };
    repo.disables.push(disable);
    if (kind === 'disable') open.push(disable);
  }
}

function scanDirectives(repo: Repo): void {
  for (const file of repoFiles(repo)) {
    if (repo.wordLists.has(file)) continue;
    const text = readText(path.join(repo.dir, file));
    if (!text || !/spell-?checker|cspell/i.test(text)) continue;
    const open: Disable[] = [];
    text
      .split('\n')
      .forEach((line, index) => scanLine(repo, file, line, index + 1, open));
  }
}

// ---------------------------------------------------------------- repositories

function cspellCommand(dir: string): string[] {
  for (
    let current = dir;
    path.dirname(current) !== current;
    current = path.dirname(current)
  ) {
    const bin = path.join(current, 'node_modules', '.bin', 'cspell');
    if (existsSync(bin)) return [bin];
  }
  return ['npx', '--yes', 'cspell'];
}

function workspacePackages(repo: Repo): Map<string, string> {
  const packages = new Map<string, string>();
  for (const file of repoFiles(repo)) {
    const nested =
      path.posix.basename(file) === 'package.json' && file !== 'package.json';
    if (!nested || file.split('/').includes('node_modules')) continue;
    const data = JSON.parse(readRepoFile(repo, file)) as { name?: string };
    if (data.name)
      packages.set(data.name, path.join(repo.dir, path.posix.dirname(file)));
  }
  return packages;
}

export function uniqueLabel(dir: string, labels: Set<string>): string {
  let label = path.basename(dir);
  let suffix = 2;
  while (labels.has(label)) {
    label = `${path.basename(dir)}-${suffix}`;
    suffix++;
  }
  labels.add(label);
  return label;
}

function loadRepo(dir: string, labels: Set<string>): Repo {
  const seen = new Map<string, Config>();
  const root = loadConfig(dir, findRootConfig(dir), seen);
  const repo: Repo = {
    dir,
    label: uniqueLabel(dir, labels),
    cspell: cspellCommand(dir),
    configs: [root, ...[...seen.values()].filter((config) => config !== root)],
    committable: committableFiles(dir),
    wordLists: new Set(),
    directives: [],
    disables: [],
    packages: new Map(),
    needs: new Map(),
    notes: [],
  };
  if (!repo.committable)
    repo.notes.push('Not a git checkout: every file counts as committed.');
  for (const config of repo.configs.filter((item) => item.owned)) {
    repo.wordLists.add(toPosix(path.relative(dir, config.file)));
    for (const dictionary of reviewedDictionaries(config)) {
      repo.wordLists.add(toPosix(path.relative(dir, dictionary.file)));
    }
  }
  for (const file of repoFiles(repo)) {
    if (!CONFIG_FILE.test(file) || repo.wordLists.has(file)) continue;
    repo.wordLists.add(file);
    repo.notes.push(
      `${file} is a cspell config the root config doesn't import. Review its folder on its own, with --repo.`,
    );
  }
  repo.packages = workspacePackages(repo);
  scanDirectives(repo);
  return repo;
}

// ---------------------------------------------------------------- word lists

// An override glob matches the file, a folder that holds it, or, without a slash, its name.
export const matchesGlob = (relative: string, pattern: string): boolean =>
  path.posix.matchesGlob(relative, pattern) ||
  path.posix.matchesGlob(relative, `${pattern}/**`) ||
  (!pattern.includes('/') &&
    path.posix.matchesGlob(path.posix.basename(relative), pattern));

export function globMatcher(
  globRoot: string,
  repoDir: string,
  patterns: string[],
): (file: string) => boolean {
  return (file) => {
    const relative = toPosix(path.relative(globRoot, path.join(repoDir, file)));
    return patterns.some((pattern) => matchesGlob(relative, pattern));
  };
}

export function globRootOf(config: Config): string {
  const value = config.data.globRoot;
  if (typeof value !== 'string' || value.includes('${'))
    return path.dirname(config.file);
  return path.resolve(path.dirname(config.file), value);
}

export function configLists(repo: Repo, config: Config): WordList[] {
  const file = toPosix(path.relative(repo.dir, config.file));
  const lists: WordList[] = ['words', 'ignoreWords'].map((key) => ({
    repo,
    config,
    file,
    list: key,
    words: stringList(config.data[key]),
  }));
  asObjects(config.data.overrides).forEach((override, index) => {
    const patterns =
      typeof override.filename === 'string'
        ? [override.filename]
        : stringList(override.filename);
    const scope = globMatcher(globRootOf(config), repo.dir, patterns);
    for (const key of ['words', 'ignoreWords']) {
      const words = stringList(override[key]);
      lists.push({
        repo,
        config,
        file,
        list: `overrides[${index}].${key}`,
        words,
        scope,
      });
    }
  });
  for (const dictionary of reviewedDictionaries(config)) {
    const words = readFileSync(dictionary.file, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    const dictionaryFile = toPosix(path.relative(repo.dir, dictionary.file));
    lists.push({
      repo,
      config,
      file: dictionaryFile,
      list: 'dictionary',
      words,
    });
  }
  return lists;
}

export function wordLists(repo: Repo): WordList[] {
  const lists = repo.configs
    .filter((config) => config.owned)
    .flatMap((config) => configLists(repo, config));
  for (const directive of repo.directives) {
    const words = directive.tokens.map((token) => token.word);
    lists.push({
      repo,
      file: directive.file,
      list: 'directive',
      words,
      directive,
    });
  }
  return lists.filter((list) => list.words.length > 0);
}

// Every word a config and the configs it imports list, by normalized form.
export function listedWords(config: Config, includeSelf: boolean): Set<string> {
  const words = new Set<string>();
  const visit = (current: Config, self: boolean): void => {
    if (self) {
      const own = [
        ...stringList(current.data.words),
        ...stringList(current.data.ignoreWords),
      ];
      for (const word of own) words.add(norm(word));
    }
    for (const imported of current.imports) visit(imported, true);
  };
  visit(config, includeSelf);
  return words;
}

// ---------------------------------------------------------------- cspell runs

type Variant = {
  name: string;
  words: (config: Config, list: string, words: string[]) => string[];
  dropDictionaries?: boolean;
  replaceImport?: (config: Config) => string | undefined;
};

const copyPath = (
  out: string,
  repo: Repo,
  variant: string,
  index: number,
  file: string,
): string =>
  path.join(out, repo.label, variant, `${index}-${path.basename(file)}`);

const rootCopy = (out: string, repo: Repo, variant: string): string =>
  copyPath(out, repo, variant, 0, repo.configs[0]?.file ?? '');

export function absoluteGlobRoot(config: Config): string {
  const value = config.data.globRoot;
  if (typeof value !== 'string') return path.dirname(config.file);
  return value.includes('${')
    ? value
    : path.resolve(path.dirname(config.file), value);
}

export function variantLists(
  config: Config,
  data: Json,
  variant: Variant,
): void {
  for (const key of ['words', 'ignoreWords']) {
    if (Array.isArray(data[key]))
      data[key] = variant.words(config, key, stringList(data[key]));
  }
  data.overrides = asObjects(data.overrides).map((override, index) => {
    const copy: Json = { ...override };
    for (const key of ['words', 'ignoreWords']) {
      if (!Array.isArray(copy[key])) continue;
      copy[key] = variant.words(
        config,
        `overrides[${index}].${key}`,
        stringList(copy[key]),
      );
    }
    return copy;
  });
}

function variantDictionaries(
  config: Config,
  data: Json,
  variant: Variant,
  target: (file: string) => string,
): void {
  const reviewed = config.owned ? reviewedDictionaries(config) : [];
  data.dictionaryDefinitions = asObjects(data.dictionaryDefinitions).flatMap(
    (definition) => {
      if (typeof definition.path !== 'string') return [definition];
      const file = path.resolve(path.dirname(config.file), definition.path);
      const underReview = reviewed.some((item) => item.file === file);
      if (!underReview) return [{ ...definition, path: file }];
      if (variant.dropDictionaries) return [];
      const words = variant.words(
        config,
        'dictionary',
        readFileSync(file, 'utf8').split('\n'),
      );
      writeFileSync(target(file), words.join('\n'));
      return [{ ...definition, path: target(file) }];
    },
  );
  if (variant.dropDictionaries) {
    const dropped = new Set(reviewed.map((item) => item.name));
    data.dictionaries = stringList(data.dictionaries).filter(
      (name) => !dropped.has(name),
    );
  }
}

// Writes a copy of every config in the import tree, so globs keep resolving from the originals.
function writeVariant(repo: Repo, out: string, variant: Variant): string {
  mkdirSync(path.join(out, repo.label, variant.name), { recursive: true });
  const target = (config: Config): string =>
    copyPath(
      out,
      repo,
      variant.name,
      repo.configs.indexOf(config),
      config.file,
    );
  for (const [index, config] of repo.configs.entries()) {
    const data: Json = structuredClone(config.data);
    data.globRoot = absoluteGlobRoot(config);
    variantLists(config, data, variant);
    const dictionaryCopy = (file: string): string =>
      copyPath(out, repo, variant.name, index, file);
    variantDictionaries(config, data, variant, dictionaryCopy);
    if (config.imports.length > 0) {
      data.import = config.imports.map(
        (imported) => variant.replaceImport?.(imported) ?? target(imported),
      );
    }
    writeFileSync(target(config), `${JSON.stringify(data, null, 2)}\n`);
  }
  return rootCopy(out, repo, variant.name);
}

function lint(
  repo: Repo,
  config: string,
  stdin?: { file: string; text: string },
): Issue[] {
  const targets = stdin
    ? [`stdin://${stdin.file}`]
    : ['**', '--exclude', '.git/**'];
  const flags = [
    'lint',
    '--no-progress',
    '--no-color',
    '--no-cache',
    '--no-config-search',
  ];
  const result = run(
    [...repo.cspell, ...flags, '--config', config, ...targets],
    repo.dir,
    stdin?.text,
  );
  if (!/Files checked: \d+|No files found/.test(result.stderr)) {
    throw new Error(
      `cspell failed in ${repo.dir}:\n${result.stderr.slice(0, 2000)}`,
    );
  }
  return countedIssues(repo, result.stdout);
}

// The issues cspell reports in committed files outside the word lists.
export function countedIssues(repo: Repo, stdout: string): Issue[] {
  const issues: Issue[] = [];
  for (const line of stdout.split('\n')) {
    const issue = parseIssue(repo, line);
    const counted =
      issue !== null &&
      !repo.wordLists.has(issue.file) &&
      (!repo.committable || repo.committable.has(issue.file));
    if (counted) issues.push(issue);
  }
  return issues;
}

// A cspell line reads `<file>:<line>:<column> - Unknown word (<word>)`, maybe with a fix after it.
export function parseIssue(repo: Repo, line: string): Issue | null {
  const marker = ' - Unknown word (';
  const at = line.indexOf(marker);
  if (at < 0) return null;
  const wordStart = at + marker.length;
  const word = line.slice(wordStart, line.indexOf(')', wordStart));
  const location = line.slice(0, at);
  const columnColon = location.lastIndexOf(':');
  const lineColon = location.lastIndexOf(':', columnColon - 1);
  if (lineColon < 0 || word === '') return null;
  const file = toPosix(
    path.relative(
      repo.dir,
      path.resolve(repo.dir, location.slice(0, lineColon)),
    ),
  );
  return {
    file,
    line: Number(location.slice(lineColon + 1, columnColon)),
    word,
  };
}

export function blank(text: string, spans: Span[]): string {
  const lines = text.split('\n');
  for (const { line, start, end } of spans) {
    const current = lines[line - 1] ?? '';
    lines[line - 1] =
      current.slice(0, start) + ' '.repeat(end - start) + current.slice(end);
  }
  return lines.join('\n');
}

// What every file needs once every list is empty, by normalized word.
function measureNeeds(repo: Repo, emptied: string): void {
  const byFile = new Map<string, Issue[]>();
  for (const issue of lint(repo, emptied)) push(byFile, issue.file, issue);
  for (const file of new Set(
    repo.directives.map((directive) => directive.file),
  )) {
    const spans = repo.directives.filter(
      (directive) => directive.file === file,
    );
    byFile.set(
      file,
      lint(repo, emptied, {
        file,
        text: blank(readRepoFile(repo, file), spans),
      }),
    );
  }
  for (const issue of [...byFile.values()].flat()) {
    const key = norm(issue.word);
    repo.needs.set(key, (repo.needs.get(key) ?? new Set()).add(issue.file));
  }
}

export function needsWord(list: WordList, word: string): boolean {
  const files = [...(list.repo.needs.get(norm(word)) ?? [])];
  if (list.directive) return files.includes(list.directive.file);
  return list.scope ? files.some(list.scope) : files.length > 0;
}

// ---------------------------------------------------------------- reasons

// Rows of `cspell trace` whose word a dictionary enabled for the language holds.
export function traceRows(stdout: string): string[][] {
  return stdout.split('\n').flatMap((line) => {
    const [word = '', found = '', dictionary = ''] = line.trim().split(/\s+/);
    const enabled =
      found === '*' && dictionary.endsWith('*') && !dictionary.startsWith('[');
    return enabled
      ? [[norm(word.replaceAll('•', '')), dictionary.slice(0, -1)]]
      : [];
  });
}

function traceLanguage(
  repo: Repo,
  config: string,
  language: string,
  words: string[],
  out: string,
): string[][] {
  const flags = [
    'trace',
    '--no-color',
    '--only-found',
    '--dictionary-path',
    'hide',
  ];
  const command = [
    ...repo.cspell,
    ...flags,
    '--language-id',
    language,
    '--config',
    config,
    ...words,
  ];
  return traceRows(run(command, out).stdout);
}

function dictionaryWords(
  repo: Repo,
  config: string,
  words: string[],
  out: string,
): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (let start = 0; start < words.length; start += 200) {
    const batch = words.slice(start, start + 200);
    for (const language of LANGUAGES) {
      for (const [word = '', dictionary = ''] of traceLanguage(
        repo,
        config,
        language,
        batch,
        out,
      )) {
        found.set(word, (found.get(word) ?? new Set()).add(dictionary));
      }
    }
  }
  return found;
}

export function reasonFor(
  repo: Repo,
  word: string,
  dictionaries: Map<string, Set<string>>,
): string {
  const known = dictionaries.get(norm(word));
  if (known) {
    const names = [...known].sort((a, b) => a.localeCompare(b));
    return `a bundled dictionary knows it (${names.join(', ')})`;
  }
  if (!repo.committable) return 'no checked file needs it';
  const exclusions = [...repo.wordLists].map(
    (file) => `:(exclude,literal)${file}`,
  );
  const grep = [
    'git',
    'grep',
    '-I',
    '-i',
    '-l',
    '-F',
    '-e',
    word,
    '--',
    '.',
    ...exclusions,
  ];
  return run(grep, repo.dir).stdout.trim() === ''
    ? 'no committed file contains it'
    : "it appears only where cspell doesn't check it: a URL, an ignored path, or inside a longer known word";
}

function explain(repos: Repo[], out: string, removals: Proposal[]): void {
  for (const repo of repos) {
    const unexplained = removals.filter(
      (item) => item.list.repo === repo && item.reason === '',
    );
    if (unexplained.length === 0) continue;
    const words = [...new Set(unexplained.map((item) => item.word))];
    const dictionaries = dictionaryWords(
      repo,
      rootCopy(out, repo, 'emptied'),
      words,
      out,
    );
    for (const item of unexplained)
      item.reason = reasonFor(repo, item.word, dictionaries);
  }
}

// ---------------------------------------------------------------- review

const packageCopy = (config: Config, name: string): boolean =>
  !config.owned &&
  config.file.includes(
    `${path.sep}node_modules${path.sep}${name.split('/').join(path.sep)}${path.sep}`,
  );

// The repositories in the run that import a config the owner publishes.
function groupFor(owner: Repo, source: Config, repos: Repo[]): Group {
  const name = source.publishedAs ?? '';
  const group: Group = {
    source,
    owner,
    members: [owner],
    installed: new Map(),
  };
  for (const consumer of repos.filter((repo) => repo !== owner)) {
    const imported = consumer.configs.find((config) =>
      packageCopy(config, name),
    );
    if (!imported) continue;
    group.members.push(consumer);
    group.installed.set(consumer, listedWords(imported, true));
  }
  return group;
}

export function sharedGroups(repos: Repo[]): Group[] {
  return repos.flatMap((owner) =>
    owner.configs
      .filter(
        (config) =>
          config.owned && owner.packages.has(config.publishedAs ?? ''),
      )
      .map((source) => groupFor(owner, source, repos))
      .filter((group) => group.members.length > 1),
  );
}

// Why a word in a repository's own list can go: '' to explain later, null to keep it.
export function removalReason(
  repo: Repo,
  list: WordList,
  word: string,
): string | null {
  const key = norm(word);
  const root = repo.configs[0];
  if (list.directive && root && listedWords(root, true).has(key)) {
    return 'the cspell config already lists it';
  }
  const override = list.list.startsWith('overrides');
  if (override && list.config && listedWords(list.config, true).has(key)) {
    return 'the same config lists it for every file';
  }
  const global = list.list === 'words' || list.list === 'ignoreWords';
  if (global && list.config && listedWords(list.config, false).has(key)) {
    return 'an imported config already lists it';
  }
  if (needsWord(list, word)) return null;
  return list.config?.publishedAs ? null : '';
}

export function reviewRepo(
  repo: Repo,
  lists: WordList[],
  shared: Set<Config>,
  removals: Proposal[],
): void {
  for (const list of lists) {
    if (list.config && shared.has(list.config)) continue;
    for (const word of list.words) {
      const reason = removalReason(repo, list, word);
      if (reason !== null) removals.push({ list, word, reason });
    }
  }
  const published = repo.configs.filter(
    (item) => item.owned && item.publishedAs && !shared.has(item),
  );
  for (const config of published) {
    const file = toPosix(path.relative(repo.dir, config.file));
    repo.notes.push(
      `${file} ships in ${config.publishedAs}. Its words aren't reviewed without the repositories that import it.`,
    );
  }
}

const labels = (repos: Repo[]): string =>
  repos.map((repo) => repo.label).join(', ');

// Only lists that allow a word everywhere move up: not overrides, dictionaries, or ignore lists.
const movable = (list: WordList, group: Group): boolean =>
  list.config !== group.source &&
  (list.directive ? !list.directive.ignore : list.list === 'words');

// A yes to the question moves the word into the root config of the one repository that needs it.
export function reviewSharedWords(
  group: Group,
  source: WordList | undefined,
  removals: Proposal[],
  plan: Plan,
): void {
  const file = toPosix(path.relative(group.owner.dir, group.source.file));
  for (const word of source?.words ?? []) {
    const users = group.members.filter((repo) => repo.needs.has(norm(word)));
    if (users.length === 0 && source)
      removals.push({ list: source, word, reason: '' });
    const [user] = users;
    const own = user?.configs[0];
    if (users.length !== 1 || !user || !own || own === group.source) continue;
    const question = `Only ${user.label} needs it. Move it into that repository's own config?`;
    const changes: Change[] = [
      {
        repo: user.dir,
        file: toPosix(path.relative(user.dir, own.file)),
        action: 'add',
        list: 'words',
        words: [
          { word, reason: `it moves out of ${file} in ${group.owner.label}` },
        ],
      },
      {
        repo: group.owner.dir,
        file,
        action: 'remove',
        list: 'words',
        words: [{ word, reason: `only ${user.label} needs it` }],
      },
    ];
    plan.decisions.push({
      repo: group.owner.dir,
      file,
      word,
      question,
      accept: false,
      changes,
    });
  }
}

export function promotions(
  group: Group,
  lists: Map<Repo, WordList[]>,
  additions: Addition[],
): Set<string> {
  const sourceWords = listedWords(group.source, true);
  const candidates = new Map<string, string>();
  for (const list of group.members.flatMap((repo) => lists.get(repo) ?? [])) {
    if (!movable(list, group)) continue;
    for (const word of list.words) {
      if (!candidates.has(norm(word))) candidates.set(norm(word), word);
    }
  }
  const promoted = new Set<string>();
  for (const [key, word] of candidates) {
    const users = group.members.filter((repo) => repo.needs.has(key));
    if (users.length < 2 || sourceWords.has(key)) continue;
    additions.push({ group, word, reason: `${labels(users)} need it` });
    promoted.add(key);
  }
  return promoted;
}

export function memberRemovals(
  group: Group,
  lists: Map<Repo, WordList[]>,
  promoted: Set<string>,
  removals: Proposal[],
): void {
  const file = toPosix(path.relative(group.owner.dir, group.source.file));
  const sourceWords = listedWords(group.source, true);
  const moves = `it moves to ${file} in ${group.owner.label}`;
  const listed = `${file} in ${group.owner.label} lists it`;
  const entries = group.members.flatMap((repo) =>
    (lists.get(repo) ?? [])
      .filter((list) => movable(list, group))
      .flatMap((list) => list.words.map((word) => ({ repo, list, word }))),
  );
  for (const { repo, list, word } of entries) {
    const key = norm(word);
    const already = removals.some(
      (item) => item.list === list && norm(item.word) === key,
    );
    if (already || (!promoted.has(key) && !sourceWords.has(key))) continue;
    const afterRelease =
      repo !== group.owner && !(group.installed.get(repo)?.has(key) ?? false);
    removals.push({
      list,
      word,
      reason: promoted.has(key) ? moves : listed,
      afterRelease,
    });
  }
}

function review(repos: Repo[], out: string): Plan {
  const plan: Plan = {
    created: new Date().toISOString(),
    repos: [],
    changes: [],
    decisions: [],
    kept: [],
  };
  const groups = sharedGroups(repos);
  const shared = new Set(groups.map((group) => group.source));
  const lists = new Map(repos.map((repo) => [repo, wordLists(repo)]));
  const removals: Proposal[] = [];
  const additions: Addition[] = [];
  for (const repo of repos)
    reviewRepo(repo, lists.get(repo) ?? [], shared, removals);
  for (const group of groups) {
    const source = (lists.get(group.owner) ?? []).find(
      (list) => list.config === group.source && list.list === 'words',
    );
    reviewSharedWords(group, source, removals, plan);
    memberRemovals(group, lists, promotions(group, lists, additions), removals);
  }
  verify(repos, out, groups, removals, additions, plan);
  explain(repos, out, removals);
  plan.repos = repos.map((repo) => ({
    dir: repo.dir,
    label: repo.label,
    notes: repo.notes,
  }));
  plan.changes = toChanges(removals, additions);
  return plan;
}

// ---------------------------------------------------------------- verification

const issueKey = (issue: Issue): string =>
  `${issue.file}:${issue.line}:${issue.word}`;

type RunState = {
  repos: Repo[];
  out: string;
  groups: Group[];
  removals: Proposal[];
  additions: Addition[];
};

function verify(
  repos: Repo[],
  out: string,
  groups: Group[],
  removals: Proposal[],
  additions: Addition[],
  plan: Plan,
): void {
  const baseline = new Map<Repo, Set<string>>();
  for (const repo of repos) {
    const original = writeVariant(repo, out, {
      name: 'original',
      words: (_config, _list, words) => words,
    });
    const issues = new Set(lint(repo, original).map(issueKey));
    baseline.set(repo, issues);
    if (issues.size > 0)
      repo.notes.push(
        `${issues.size} issues fail before any change. The plan adds none.`,
      );
  }
  const state: RunState = { repos, out, groups, removals, additions };
  for (let round = 0; round < 10; round++) {
    const fresh = endStateIssues(state, baseline);
    if (fresh.length === 0) return;
    restoreFragments(fresh, groups, removals, plan);
  }
  throw new Error(
    'The end state still fails after 10 rounds of restoring words.',
  );
}

// Puts back every removed word that a new failure reports a fragment of.
export function restoreFragments(
  fresh: { repo: Repo; issue: Issue }[],
  groups: Group[],
  removals: Proposal[],
  plan: Plan,
): void {
  let restored = false;
  for (const { repo, issue } of fresh) {
    const fragment = norm(issue.word);
    const reaches = (item: Proposal): boolean =>
      item.list.repo === repo ||
      groups.some(
        (group) =>
          group.source === item.list.config && group.members.includes(repo),
      );
    const culprits = removals.filter(
      (item) =>
        reaches(item) &&
        fragment.length >= 3 &&
        norm(item.word).includes(fragment),
    );
    for (const culprit of culprits) {
      removals.splice(removals.indexOf(culprit), 1);
      const reason = `without it, cspell reports the fragment ${issue.word} in ${issue.file}`;
      plan.kept.push({
        repo: culprit.list.repo.dir,
        file: culprit.list.file,
        word: culprit.word,
        reason,
      });
      restored = true;
    }
  }
  if (restored) return;
  const list = fresh.map(
    ({ repo, issue }) =>
      `${repo.label}: ${issue.file}:${issue.line} ${issue.word}`,
  );
  throw new Error(
    `The proposed end state adds failures that no removed word explains:\n${list.join('\n')}`,
  );
}

export function prunedVariant(
  repo: Repo,
  state: RunState,
  shared: Map<Config, string>,
): Variant {
  return {
    name: 'pruned',
    words: (config, list, words) => {
      const gone = new Set(
        state.removals
          .filter(
            (item) => item.list.config === config && item.list.list === list,
          )
          .map((item) => norm(item.word)),
      );
      const added =
        list === 'words'
          ? state.additions
              .filter((item) => item.group.source === config)
              .map((item) => item.word)
          : [];
      return [
        ...words.filter((word) => !gone.has(norm(word.trim()))),
        ...added,
      ];
    },
    replaceImport: (config) => {
      const group = state.groups.find(
        (item) =>
          item.owner !== repo &&
          item.members.includes(repo) &&
          packageCopy(config, item.source.publishedAs ?? ''),
      );
      return group ? shared.get(group.source) : undefined;
    },
  };
}

function endStateIssues(
  state: RunState,
  baseline: Map<Repo, Set<string>>,
): { repo: Repo; issue: Issue }[] {
  const shared = new Map<Config, string>();
  for (const group of state.groups) {
    writeVariant(
      group.owner,
      state.out,
      prunedVariant(group.owner, state, shared),
    );
    const index = group.owner.configs.indexOf(group.source);
    shared.set(
      group.source,
      copyPath(state.out, group.owner, 'pruned', index, group.source.file),
    );
  }
  const fresh: { repo: Repo; issue: Issue }[] = [];
  for (const repo of state.repos) {
    const config = writeVariant(
      repo,
      state.out,
      prunedVariant(repo, state, shared),
    );
    const edited = editedFiles(repo, state.removals);
    const issues = lint(repo, config).filter(
      (issue) => !edited.has(issue.file),
    );
    for (const [file, text] of edited)
      issues.push(...lint(repo, config, { file, text }));
    for (const issue of issues) {
      if (!baseline.get(repo)?.has(issueKey(issue)))
        fresh.push({ repo, issue });
    }
  }
  return fresh;
}

// File contents with the proposed directive edits, positions kept.
export function editedFiles(
  repo: Repo,
  removals: Proposal[],
): Map<string, string> {
  const spans = new Map<string, Span[]>();
  for (const item of removals) {
    const directive = item.list.repo === repo ? item.list.directive : undefined;
    const token = directive?.tokens.find(
      (candidate) => norm(candidate.word) === norm(item.word),
    );
    if (directive && token)
      push(spans, directive.file, {
        line: directive.line,
        start: token.start,
        end: token.end,
      });
  }
  return new Map(
    [...spans].map(([file, fileSpans]) => [
      file,
      blank(readRepoFile(repo, file), fileSpans),
    ]),
  );
}

// ---------------------------------------------------------------- disables

export function coveredLines(disable: Disable): [number, number] {
  const first =
    disable.kind === 'disable-next-line' ? disable.line + 1 : disable.line;
  const last =
    disable.kind === 'disable'
      ? (disable.endLine ?? Number.MAX_SAFE_INTEGER)
      : first;
  return [first, last];
}

function reviewDisables(repo: Repo, endState: string, plan: Plan): void {
  for (const disable of repo.disables) {
    const text = readRepoFile(repo, disable.file);
    const [first, last] = coveredLines(disable);
    const issues = lint(repo, endState, {
      file: disable.file,
      text: blank(text, [disable]),
    });
    if (issues.some((issue) => issue.line >= first && issue.line <= last))
      continue;
    const lines = text.split('\n');
    plan.changes.push({
      repo: repo.dir,
      file: disable.file,
      action: 'remove-disable',
      list: disable.kind,
      words: [],
      line: disable.line,
      lineText: lines[disable.line - 1],
      endLine: disable.endLine,
      endText: disable.endLine ? lines[disable.endLine - 1] : undefined,
    });
  }
}

// ---------------------------------------------------------------- output

export function toChanges(
  removals: Proposal[],
  additions: Addition[],
): Change[] {
  const changes = new Map<string, Change>();
  for (const { list, word, reason, afterRelease } of removals) {
    const line = list.directive?.line;
    const key = [
      list.repo.dir,
      list.file,
      list.list,
      line ?? '',
      afterRelease === true,
    ].join('|');
    const lineText = line
      ? readRepoFile(list.repo, list.file).split('\n')[line - 1]
      : undefined;
    const change: Change = changes.get(key) ?? {
      repo: list.repo.dir,
      file: list.file,
      action: 'remove',
      list: list.list,
      words: [],
      ...(line ? { line, lineText } : {}),
      ...(afterRelease ? { afterRelease } : {}),
    };
    change.words.push({ word, reason });
    changes.set(key, change);
  }
  for (const { group, word, reason } of additions) {
    const file = toPosix(path.relative(group.owner.dir, group.source.file));
    const key = `${group.owner.dir}|${file}|add`;
    const change: Change = changes.get(key) ?? {
      repo: group.owner.dir,
      file,
      action: 'add',
      list: 'words',
      words: [],
    };
    change.words.push({ word, reason });
    changes.set(key, change);
  }
  return [...changes.values()];
}

export function describeChange(change: Change): string[] {
  const where = change.line
    ? `${change.file}:${change.line}`
    : `${change.file} → ${change.list}`;
  if (change.action === 'remove-disable') {
    return [
      `- Remove the ${change.list} directive at ${where}: nothing it covers fails without it.`,
    ];
  }
  const when = change.afterRelease
    ? ' (once this repository installs the release that adds them)'
    : '';
  const verb = change.action === 'add' ? 'Add to' : 'Remove from';
  const byReason = new Map<string, string[]>();
  for (const { word, reason } of change.words) push(byReason, reason, word);
  const lines = [`- ${verb} ${where}${when} (${change.words.length}):`];
  for (const [reason, words] of byReason)
    lines.push(`  - ${reason}: ${words.join(', ')}`);
  return lines;
}

function describeRepo(plan: Plan, repo: Plan['repos'][number]): string[] {
  const findings = [
    ...plan.changes
      .filter((item) => item.repo === repo.dir)
      .flatMap(describeChange),
    ...plan.kept
      .filter((item) => item.repo === repo.dir)
      .map((item) => `- Keep ${item.word} in ${item.file}: ${item.reason}.`),
    ...plan.decisions
      .filter((item) => item.repo === repo.dir)
      .map(
        (item) => `- Decide: ${item.word} in ${item.file}. ${item.question}`,
      ),
  ];
  const notes = repo.notes.map((note) => `- Note: ${note}`);
  const body = findings.length > 0 ? findings : ['- Nothing to change.'];
  return [`## ${repo.label} (${repo.dir})`, '', ...notes, ...body, ''];
}

export function report(plan: Plan, planFile: string): string {
  return [
    ...plan.repos.flatMap((repo) => describeRepo(plan, repo)),
    'Verified: the end state adds no failure in a committed file of any repository in the run.',
    `Plan: ${planFile}`,
  ].join('\n');
}

// ---------------------------------------------------------------- apply

const codePoint = (a: string, b: string): number => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

const folded = (a: string, b: string): number =>
  codePoint(a.toLowerCase(), b.toLowerCase()) || codePoint(a, b);

// Inserts the words the way the list is sorted already, or appends them to an unsorted list.
export function sortLike(existing: string[], added: string[]): string[] {
  const sortedBy = (compare: (a: string, b: string) => number): boolean =>
    existing.every(
      (word, index) =>
        index === 0 || compare(existing[index - 1] ?? '', word) <= 0,
    );
  const merged = [...existing, ...added];
  if (sortedBy(codePoint)) return merged.sort(codePoint);
  return sortedBy(folded) ? merged.sort(folded) : merged;
}

export function editList(
  data: Json,
  list: string,
  edit: (words: string[]) => string[],
): void {
  const match = /^overrides\[(\d+)\]\.(\w+)$/.exec(list);
  const owner = match ? asObjects(data.overrides)[Number(match[1])] : data;
  const key = match ? (match[2] ?? '') : list;
  if (!owner) throw new Error(`no ${list} to edit`);
  owner[key] = edit(stringList(owner[key]));
}

const commentOnly = (line: string): boolean =>
  COMMENT_ONLY.has(line.replaceAll(/\s/g, ''));

// The line with its directive edited, or null when nothing but comment syntax would remain.
export function editedLine(line: string, change: Change): string | null {
  let text: string;
  if (change.action === 'remove-disable')
    text = line.replaceAll(DISABLE_KEYWORD, '');
  else {
    const gone = new Set(change.words.map((item) => norm(item.word)));
    const match = [...line.matchAll(WORD_KEYWORD)][0];
    const start = match?.index ?? 0;
    const tokens = match ? directiveTokens(line, start + match[0].length) : [];
    const kept = tokens
      .filter((token) => !gone.has(norm(token.word)))
      .map((token) => token.word);
    const directive =
      match && kept.length > 0 ? `${match[0]} ${kept.join(' ')}` : '';
    text =
      line.slice(0, start) +
      directive +
      line.slice(tokens.at(-1)?.end ?? start);
  }
  return commentOnly(text) ? null : text;
}

export function applyLineEdits(
  file: string,
  changes: Change[],
  failures: string[],
): void {
  const lines = readFileSync(file, 'utf8').split('\n');
  const deletions = new Set<number>();
  for (const change of changes) {
    const targets = [
      change.line ?? 0,
      ...(change.endLine ? [change.endLine] : []),
    ];
    const expected = [change.lineText, change.endText];
    if (
      targets.some((target, index) => lines[target - 1] !== expected[index])
    ) {
      failures.push(
        `${file}:${change.line ?? 0} changed since the review. Edit it by hand.`,
      );
      continue;
    }
    for (const target of targets) {
      const text = editedLine(lines[target - 1] ?? '', change);
      if (text === null) deletions.add(target);
      else lines[target - 1] = text;
    }
  }
  writeFileSync(
    file,
    lines.filter((_line, index) => !deletions.has(index + 1)).join('\n'),
  );
}

export function applyListEdits(
  file: string,
  changes: Change[],
  failures: string[],
): boolean {
  if (changes.every((change) => change.list === 'dictionary')) {
    const gone = new Set(
      changes.flatMap((change) =>
        change.words.map((item) => item.word.toLowerCase()),
      ),
    );
    const lines = readFileSync(file, 'utf8').split('\n');
    writeFileSync(
      file,
      lines.filter((line) => !gone.has(line.trim().toLowerCase())).join('\n'),
    );
    return true;
  }
  const { data, hasComments } = parseJsonc(readFileSync(file, 'utf8'));
  if (hasComments) {
    failures.push(
      `${file} has comments, which a rewrite would drop. Edit it by hand.`,
    );
    return false;
  }
  for (const change of changes) {
    const words = change.words.map((item) => item.word);
    const gone = new Set(words.map(norm));
    editList(data, change.list, (existing) =>
      change.action === 'add'
        ? sortLike(existing, words)
        : existing.filter((word) => !gone.has(norm(word))),
    );
  }
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return true;
}

export function apply(planFile: string): void {
  const plan = JSON.parse(readFileSync(planFile, 'utf8')) as Plan;
  const accepted = plan.decisions
    .filter((decision) => decision.accept)
    .flatMap((decision) => decision.changes);
  const all = [...plan.changes, ...accepted];
  const now = all.filter((change) => !change.afterRelease);
  const failures: string[] = [];
  const changed: string[] = [];
  const byFile = new Map<string, Change[]>();
  for (const change of now)
    push(byFile, path.join(change.repo, change.file), change);
  for (const [file, changes] of byFile) {
    const byLine = (change: Change): boolean =>
      change.list === 'directive' || change.action === 'remove-disable';
    const lineChanges = changes.filter(byLine);
    const listChanges = changes.filter((change) => !byLine(change));
    if (lineChanges.length > 0) applyLineEdits(file, lineChanges, failures);
    const listed =
      listChanges.length > 0 && applyListEdits(file, listChanges, failures);
    if (lineChanges.length > 0 || listed) changed.push(file);
  }
  const files = changed.map((file) => `- ${file}`).join('\n');
  console.log(changed.length > 0 ? `Changed:\n${files}` : 'Nothing to change.');
  const later = all.length - now.length;
  if (later > 0) {
    console.log(
      `Left for after the release: ${later} changes. Run the review again once each repository installs it.`,
    );
  }
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- main

export function parseArguments(argv: string[]): {
  repos: string[];
  out: string;
  apply: string;
} {
  const options = { repos: [] as string[], out: '', apply: '' };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = path.resolve(argv[index + 1] ?? '');
    if (flag === '--repo') options.repos.push(value);
    else if (flag === '--out') options.out = value;
    else if (flag === '--apply') options.apply = value;
    else throw new Error(`unknown argument ${flag ?? ''}`);
  }
  return options;
}

function main(argv: string[]): void {
  const options = parseArguments(argv);
  if (options.apply) {
    apply(options.apply);
    return;
  }
  const out =
    options.out || mkdtempSync(path.join(tmpdir(), 'review-spelling-words-'));
  mkdirSync(out, { recursive: true });
  const seen = new Set<string>();
  const dirs = options.repos.length > 0 ? options.repos : [process.cwd()];
  const repos = dirs.map((dir) => loadRepo(dir, seen));
  for (const repo of repos) {
    const emptied = writeVariant(repo, out, {
      name: 'emptied',
      words: () => [],
      dropDictionaries: true,
    });
    measureNeeds(repo, emptied);
  }
  const plan = review(repos, out);
  for (const repo of repos)
    reviewDisables(repo, rootCopy(out, repo, 'pruned'), plan);
  const planFile = path.join(out, 'plan.json');
  writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(report(plan, planFile));
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
