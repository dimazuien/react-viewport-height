#!/usr/bin/env node
/**
 * Turns `pnpm outdated --format json` into an update plan input.
 *
 * For every outdated package, it reports the current version and the newest
 * installable version within the current major ("same major"). It also reports
 * the newest installable version overall ("latest", as pnpm reported it), the
 * bump kind, and the workspace packages that declare the dependency. A package
 * that the workspace packages declare at different versions gets one row per
 * version.
 *
 * "Installable" honors the repository's `minimumReleaseAge`. The script skips a
 * version younger than that window unless the package matches an entry in
 * `minimumReleaseAgeExclude`. Publish dates come from `pnpm view <pkg> time`.
 *
 * Usage:
 *   pnpm outdated [-r] --format json | node resolve-update-targets.ts [--json] [--min-age <minutes>]
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';

export type OutdatedEntry = {
  current: string;
  latest: string;
  wanted: string;
  isDeprecated: boolean;
  dependencyType: string;
  dependentPackages?: { name: string; location: string }[];
};

type BumpKind = 'patch' | 'minor' | 'major' | 'unknown';

export type Row = {
  name: string;
  current: string;
  sameMajor: string | null;
  latest: string;
  kind: BumpKind;
  dependencyType: string;
  declaredBy: string[];
  notes: string[];
};

type Options = { json: boolean; minAge: number | undefined };

type ParsedVersion = [number, number, number];

type PublishTimes = [version: string, publishedAt: string][];

const execFileAsync = promisify(execFile);
const CONCURRENCY = 8;
const DEFAULT_MIN_AGE_MINUTES = 1440;
const KIND_ORDER: Record<BumpKind, number> = {
  patch: 0,
  minor: 1,
  major: 2,
  unknown: 3,
};

export const parseArgs = (argv: string[]): Options => {
  const options: Options = { json: false, minAge: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--min-age') {
      options.minAge = Number(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
};

const readStdin = async (): Promise<string> => {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
};

export const extractJson = <T>(text: string): T | null => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    return null;
  }
  return JSON.parse(text.slice(start, end + 1)) as T;
};

export const readWorkspacePolicy = () => {
  const policy = {
    minAgeMinutes: DEFAULT_MIN_AGE_MINUTES,
    excludes: [] as string[],
  };
  if (!existsSync('pnpm-workspace.yaml')) {
    return policy;
  }
  const lines = readFileSync('pnpm-workspace.yaml', 'utf8').split('\n');
  let inExcludes = false;
  for (const line of lines) {
    const ageMatch = /^minimumReleaseAge:\s*(\d+)/.exec(line);
    if (ageMatch) {
      policy.minAgeMinutes = Number(ageMatch[1]);
      inExcludes = false;
      continue;
    }
    if (line.startsWith('minimumReleaseAgeExclude:')) {
      inExcludes = true;
      continue;
    }
    if (inExcludes) {
      const item = /^\s+-\s*['"]?([^'"#\s]+)['"]?/.exec(line);
      if (item) {
        policy.excludes.push(item[1]);
      } else if (/^\S/.test(line)) {
        inExcludes = false;
      }
    }
  }
  return policy;
};

export const matchesExclude = (name: string, patterns: string[]): boolean =>
  patterns.some((pattern) => {
    if (pattern === name) {
      return true;
    }
    if (pattern.endsWith('/*')) {
      return name.startsWith(pattern.slice(0, -1));
    }
    return false;
  });

// pnpm 12.7 and later key a package as `<name>@<current>` when the workspace
// packages declare different versions or dependency types of it. They append
// ` (dev)` or ` (optional)` for the non-production types: `type-fest@5.9.0 (dev)`.
export const packageNameOf = (key: string): string => {
  const withoutType = key.replace(/ \([^)]*\)$/, '');
  const versionAt = withoutType.lastIndexOf('@');
  return versionAt > 0 ? withoutType.slice(0, versionAt) : withoutType;
};

// Entries that differ only in dependency type share their targets, so they
// become one row naming every workspace package that declares the version.
export const mergeEntries = (
  outdated: Record<string, OutdatedEntry>,
): [string, OutdatedEntry][] => {
  const merged = new Map<string, [string, OutdatedEntry]>();
  for (const [key, info] of Object.entries(outdated)) {
    const name = packageNameOf(key);
    const id = `${name}@${info.current}`;
    const existing = merged.get(id)?.[1];
    if (existing) {
      existing.dependencyType = `${existing.dependencyType}, ${info.dependencyType}`;
      existing.dependentPackages = [
        ...(existing.dependentPackages ?? []),
        ...(info.dependentPackages ?? []),
      ];
    } else {
      merged.set(id, [name, { ...info }]);
    }
  }
  return [...merged.values()];
};

export const parseVersion = (version: string): ParsedVersion | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareVersions = (left: ParsedVersion, right: ParsedVersion): number => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
};

export const bumpKind = (
  current: ParsedVersion | null,
  latest: ParsedVersion | null,
): BumpKind => {
  if (!current || !latest) {
    return 'unknown';
  }
  if (latest[0] !== current[0]) {
    return 'major';
  }
  if (latest[1] !== current[1]) {
    return 'minor';
  }
  return 'patch';
};

const fetchPublishTimes = async (
  name: string,
): Promise<PublishTimes | null> => {
  const { stdout } = await execFileAsync(
    'pnpm',
    ['view', name, 'time', '--json'],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const times = extractJson<Record<string, string>>(stdout);
  if (!times) {
    return null;
  }
  const entries = Object.entries(times).filter(
    ([key]) => key !== 'created' && key !== 'modified',
  );
  return entries.length > 0 ? entries : null;
};

export const resolveSameMajor = (
  current: string,
  publishTimes: PublishTimes | null,
  cutoff: Date | null,
): string | null => {
  const parsedCurrent = parseVersion(current);
  if (!parsedCurrent || !publishTimes) {
    return null;
  }
  let best: { version: string; parsed: ParsedVersion } | null = null;
  for (const [version, publishedAt] of publishTimes) {
    const parsed = parseVersion(version);
    if (!parsed) {
      continue;
    }
    const isNewerInSameMajor =
      parsed[0] === parsedCurrent[0] &&
      compareVersions(parsed, parsedCurrent) > 0;
    const isMature = !cutoff || new Date(publishedAt) <= cutoff;
    if (!isNewerInSameMajor || !isMature) {
      continue;
    }
    if (!best || compareVersions(parsed, best.parsed) > 0) {
      best = { version, parsed };
    }
  }
  return best ? best.version : null;
};

export const resolveNewestMature = (
  current: string,
  publishTimes: PublishTimes,
  cutoff: Date,
): string | null => {
  const parsedCurrent = parseVersion(current);
  let best: { version: string; parsed: ParsedVersion } | null = null;
  for (const [version, publishedAt] of publishTimes) {
    const parsed = parseVersion(version);
    if (!parsed || new Date(publishedAt) > cutoff) {
      continue;
    }
    if (parsedCurrent && compareVersions(parsed, parsedCurrent) <= 0) {
      continue;
    }
    if (!best || compareVersions(parsed, best.parsed) > 0) {
      best = { version, parsed };
    }
  }
  return best ? best.version : null;
};

const publishedAtOf = (publishTimes: PublishTimes, version: string) =>
  publishTimes.find(([candidate]) => candidate === version)?.[1];

export const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
};

export const toMarkdown = (rows: Row[]): string => {
  const header =
    '| Package | Current | Same major | Latest | Kind | Declared by | Notes |';
  const divider = '| --- | --- | --- | --- | --- | --- | --- |';
  const lines = rows.map((row) =>
    [
      `\`${row.name}\``,
      row.current,
      row.sameMajor ?? '—',
      row.latest,
      row.kind,
      row.declaredBy.join(', ') || '—',
      row.notes.join('; '),
    ].join(' | '),
  );
  return [header, divider, ...lines.map((line) => `| ${line} |`)].join('\n');
};

export const buildRow = async (
  name: string,
  info: OutdatedEntry,
  policy: ReturnType<typeof readWorkspacePolicy>,
  cutoff: Date | null,
): Promise<Row> => {
  const notes: string[] = [];
  const excluded = matchesExclude(name, policy.excludes);
  let publishTimes: PublishTimes | null = null;
  try {
    publishTimes = await fetchPublishTimes(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(`lookup failed: ${message.split('\n')[0]}`);
  }
  if (!publishTimes) {
    notes.push(
      'no publish dates from the registry; same-major target unverified',
    );
  }
  // An exempt package still targets mature versions. pnpm reports its young
  // `latest` as installable here. But a consumer that resolves this package's
  // dependencies under its own policy rejects the young version.
  let latest = info.latest;
  if (excluded && cutoff && publishTimes) {
    const latestPublishedAt = publishedAtOf(publishTimes, latest);
    if (latestPublishedAt && new Date(latestPublishedAt) > cutoff) {
      const mature = resolveNewestMature(info.current, publishTimes, cutoff);
      notes.push(
        `${latest} is inside the quarantine window and installable only because the package is exempt; target ${mature ?? 'nothing'} unless the young release fixes an advisory`,
      );
      latest = mature ?? info.current;
    }
  }
  const kind = bumpKind(parseVersion(info.current), parseVersion(latest));
  const sameMajor =
    kind === 'major'
      ? resolveSameMajor(info.current, publishTimes, cutoff)
      : latest;
  if (info.isDeprecated) {
    notes.push('deprecated: propose a replacement');
  }
  if (excluded) {
    notes.push('exempt from minimumReleaseAge');
  }
  if (kind === 'major' && !sameMajor) {
    notes.push('already at the same-major ceiling');
  }
  return {
    name,
    current: info.current,
    sameMajor,
    latest,
    kind,
    dependencyType: info.dependencyType,
    declaredBy: (info.dependentPackages ?? []).map(
      (dependent) => dependent.name,
    ),
    notes,
  };
};

export const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const outdated = extractJson<Record<string, OutdatedEntry>>(
    await readStdin(),
  );
  if (!outdated) {
    console.log('No outdated packages reported.');
    return;
  }
  const policy = readWorkspacePolicy();
  const minAgeMinutes = options.minAge ?? policy.minAgeMinutes;
  const cutoff =
    minAgeMinutes > 0 ? new Date(Date.now() - minAgeMinutes * 60_000) : null;

  const rows = await mapWithConcurrency(
    mergeEntries(outdated),
    CONCURRENCY,
    ([name, info]) => buildRow(name, info, policy, cutoff),
  );
  rows.sort(
    (left, right) =>
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      left.name.localeCompare(right.name) ||
      left.current.localeCompare(right.current, undefined, { numeric: true }),
  );

  if (options.json) {
    console.log(
      JSON.stringify(
        { minimumReleaseAgeMinutes: minAgeMinutes, packages: rows },
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    `minimumReleaseAge: ${minAgeMinutes} minutes (cutoff ${cutoff ? cutoff.toISOString() : 'none'})`,
  );
  console.log('');
  console.log(toMarkdown(rows));
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
