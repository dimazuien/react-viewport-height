import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutdatedEntry, Row } from './resolve-update-targets.ts';
import {
  buildRow,
  bumpKind,
  extractJson,
  main,
  mapWithConcurrency,
  matchesExclude,
  mergeEntries,
  packageNameOf,
  parseArgs,
  parseVersion,
  readWorkspacePolicy,
  resolveNewestMature,
  resolveSameMajor,
  toMarkdown,
} from './resolve-update-targets.ts';

type ExecFileCallback = (
  error: Error | null,
  result?: { stdout: string; stderr: string },
) => void;

const mocks = vi.hoisted(() => ({
  execFile:
    vi.fn<
      (
        file: string,
        args: string[],
        options: object,
        callback: ExecFileCallback,
      ) => void
    >(),
  existsSync: vi.fn<(path: string) => boolean>(),
  readFileSync: vi.fn<(path: string, encoding: string) => string>(),
}));

vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));

const OLD = '2026-01-01T00:00:00.000Z';
const YOUNG = '2026-11-03T00:00:00.000Z';
const CUTOFF = new Date('2026-11-01T00:00:00.000Z');
const POLICY = { minAgeMinutes: 1440, excludes: [] };

// Answers `pnpm view <name> time --json` from the given registry: publish
// dates as an object, raw output as a string, or an error the command fails
// with. A package the registry doesn't list gets no publish dates.
const fakeRegistry = (
  registry: Record<string, Record<string, string> | string | Error>,
) => {
  mocks.execFile.mockImplementation((_file, args, _options, callback) => {
    const answer = registry[args[1]] ?? '';
    if (answer instanceof Error) {
      callback(answer);
      return;
    }
    const stdout = typeof answer === 'string' ? answer : JSON.stringify(answer);
    callback(null, { stdout, stderr: '' });
  });
};

const fakeWorkspace = (yaml: string | null) => {
  mocks.existsSync.mockReturnValue(yaml !== null);
  mocks.readFileSync.mockReturnValue(yaml ?? '');
};

const entry = (overrides: Partial<OutdatedEntry> = {}): OutdatedEntry => ({
  current: '1.0.0',
  latest: '1.0.1',
  wanted: '1.0.0',
  isDeprecated: false,
  dependencyType: 'dependencies',
  dependentPackages: [{ name: 'portal-app', location: '/repo' }],
  ...overrides,
});

beforeEach(() => {
  mocks.execFile.mockReset();
  mocks.existsSync.mockReset();
  mocks.readFileSync.mockReset();
});

describe('parseArgs', () => {
  it('defaults to Markdown output and the workspace release age', () => {
    expect(parseArgs([])).toEqual({ json: false, minAge: undefined });
  });

  it('reads --json and --min-age', () => {
    expect(parseArgs(['--min-age', '60', '--json'])).toEqual({
      json: true,
      minAge: 60,
    });
  });

  it('rejects an unknown argument', () => {
    expect(() => parseArgs(['--latest'])).toThrow('Unknown argument: --latest');
  });
});

describe('extractJson', () => {
  it('ignores the text around the JSON object', () => {
    expect(
      extractJson('WARN something\n{ "a": { "b": 1 } }\nDone in 1s'),
    ).toEqual({ a: { b: 1 } });
  });

  it('returns null when the text holds no object', () => {
    expect(extractJson('')).toBeNull();
  });
});

describe('readWorkspacePolicy', () => {
  it('defaults to one day and no exclusions without pnpm-workspace.yaml', () => {
    fakeWorkspace(null);

    expect(readWorkspacePolicy()).toEqual({
      minAgeMinutes: 1440,
      excludes: [],
    });
  });

  it('reads the release age and the exclusion list', () => {
    fakeWorkspace(
      [
        'packages:',
        "  - 'packages/*'",
        'minimumReleaseAge: 10080',
        '# Permanent: our own packages.',
        'minimumReleaseAgeExclude:',
        "  - '@framework/*'",
        '  - "eslint"',
        '  - typescript # until 7.0.3',
        'allowBuilds:',
        '  - esbuild',
      ].join('\n'),
    );

    expect(readWorkspacePolicy()).toEqual({
      minAgeMinutes: 10080,
      excludes: ['@framework/*', 'eslint', 'typescript'],
    });
  });
});

describe('matchesExclude', () => {
  const patterns = ['@framework/*', 'eslint', 'follow-redirects@1.16.2'];

  it.each([
    ['eslint', true],
    ['@framework/ui', true],
    ['@frameworks/ui', false],
    ['eslint-plugin-react', false],
    ['follow-redirects', false],
  ])('%s → %s', (name, expected) => {
    expect(matchesExclude(name, patterns)).toBe(expected);
  });
});

describe('packageNameOf', () => {
  it.each([
    ['react', 'react'],
    ['@types/node', '@types/node'],
    ['react@19.2.0', 'react'],
    ['type-fest@5.9.0 (dev)', 'type-fest'],
    ['@types/node@26.6.5 (optional)', '@types/node'],
  ])('%s → %s', (key, expected) => {
    expect(packageNameOf(key)).toBe(expected);
  });
});

describe('mergeEntries', () => {
  it('merges the dependency types of one version into one row', () => {
    const production = entry({
      dependentPackages: [{ name: 'app', location: '/repo/app' }],
    });
    const development = entry({
      dependencyType: 'devDependencies',
      dependentPackages: [{ name: 'docs', location: '/repo/docs' }],
    });

    expect(
      mergeEntries({
        'type-fest@1.0.0': production,
        'type-fest@1.0.0 (dev)': development,
      }),
    ).toEqual([
      [
        'type-fest',
        entry({
          dependencyType: 'dependencies, devDependencies',
          dependentPackages: [
            { name: 'app', location: '/repo/app' },
            { name: 'docs', location: '/repo/docs' },
          ],
        }),
      ],
    ]);
    expect(production.dependencyType).toBe('dependencies');
  });

  it('keeps one row per declared version', () => {
    const merged = mergeEntries({
      'zod@3.25.0': entry({ current: '3.25.0' }),
      'zod@4.1.0': entry({ current: '4.1.0' }),
    });

    expect(merged.map(([name, info]) => `${name}@${info.current}`)).toEqual([
      'zod@3.25.0',
      'zod@4.1.0',
    ]);
  });
});

describe('parseVersion', () => {
  it('parses a plain release', () => {
    expect(parseVersion('10.2.3')).toEqual([10, 2, 3]);
  });

  it.each(['1.0.0-beta.1', '^1.0.0', 'link:../framework'])(
    'rejects %s',
    (version) => {
      expect(parseVersion(version)).toBeNull();
    },
  );
});

describe('bumpKind', () => {
  it.each([
    ['1.2.3', '1.2.4', 'patch'],
    ['1.2.3', '1.3.0', 'minor'],
    ['1.2.3', '2.0.0', 'major'],
    ['1.2.3', '2.0.0-rc.1', 'unknown'],
    ['link:../framework', '1.0.0', 'unknown'],
  ])('%s → %s is %s', (current, latest, expected) => {
    expect(bumpKind(parseVersion(current), parseVersion(latest))).toBe(
      expected,
    );
  });
});

describe('resolveSameMajor', () => {
  const times: [string, string][] = [
    ['1.9.0', OLD],
    ['1.10.0', OLD],
    ['1.11.0-beta.0', OLD],
    ['1.12.0', YOUNG],
    ['2.0.0', OLD],
  ];

  it('picks the newest mature release in the current major', () => {
    expect(resolveSameMajor('1.2.0', times, CUTOFF)).toBe('1.10.0');
  });

  it('takes young releases when there is no cutoff', () => {
    expect(resolveSameMajor('1.2.0', times, null)).toBe('1.12.0');
  });

  it('returns null when nothing newer is mature', () => {
    expect(resolveSameMajor('1.10.0', times, CUTOFF)).toBeNull();
  });

  it('returns null without a plain current version or publish dates', () => {
    expect(resolveSameMajor('1.2.0-beta.1', times, CUTOFF)).toBeNull();
    expect(resolveSameMajor('1.2.0', null, CUTOFF)).toBeNull();
  });
});

describe('resolveNewestMature', () => {
  const times: [string, string][] = [
    ['1.0.0', OLD],
    ['2.0.0', OLD],
    ['2.1.0', YOUNG],
    ['3.0.0-rc.1', OLD],
  ];

  it('picks the newest mature release above the current one in any major', () => {
    expect(resolveNewestMature('1.0.0', times, CUTOFF)).toBe('2.0.0');
  });

  it('returns null when nothing newer is mature', () => {
    expect(resolveNewestMature('2.0.0', times, CUTOFF)).toBeNull();
  });
});

describe('mapWithConcurrency', () => {
  it('keeps the input order and runs at most `limit` workers at once', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency(
      [30, 10, 20, 0, 5],
      2,
      async (delay) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, delay));
        active -= 1;
        return delay * 2;
      },
    );

    expect(results).toEqual([60, 20, 40, 0, 10]);
    expect(peak).toBe(2);
  });

  it('returns an empty list for no items', async () => {
    await expect(
      mapWithConcurrency([], 8, () => Promise.resolve(1)),
    ).resolves.toEqual([]);
  });
});

describe('toMarkdown', () => {
  it('renders one table row per package with placeholders for empty cells', () => {
    const rows: Row[] = [
      {
        name: 'eslint',
        current: '9.39.5',
        sameMajor: null,
        latest: '10.14.0',
        kind: 'major',
        dependencyType: 'devDependencies',
        declaredBy: [],
        notes: ['deprecated: propose a replacement', 'exempt'],
      },
      {
        name: 'zod',
        current: '4.1.0',
        sameMajor: '4.2.0',
        latest: '4.2.0',
        kind: 'minor',
        dependencyType: 'dependencies',
        declaredBy: ['app', 'docs'],
        notes: [],
      },
    ];

    expect(toMarkdown(rows)).toBe(
      [
        '| Package | Current | Same major | Latest | Kind | Declared by | Notes |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| `eslint` | 9.39.5 | — | 10.14.0 | major | — | deprecated: propose a replacement; exempt |',
        '| `zod` | 4.1.0 | 4.2.0 | 4.2.0 | minor | app, docs |  |',
      ].join('\n'),
    );
  });
});

describe('buildRow', () => {
  it('targets `latest` within the current major', async () => {
    fakeRegistry({ zod: { '4.1.0': OLD, '4.2.0': OLD } });

    await expect(
      buildRow(
        'zod',
        entry({ current: '4.1.0', latest: '4.2.0' }),
        POLICY,
        CUTOFF,
      ),
    ).resolves.toEqual({
      name: 'zod',
      current: '4.1.0',
      sameMajor: '4.2.0',
      latest: '4.2.0',
      kind: 'minor',
      dependencyType: 'dependencies',
      declaredBy: ['portal-app'],
      notes: [],
    });
  });

  it('adds the newest mature release in the current major to a major bump', async () => {
    fakeRegistry({
      eslint: {
        created: OLD,
        modified: YOUNG,
        '9.39.5': OLD,
        '9.40.0': OLD,
        '9.41.0': YOUNG,
        '10.14.0': OLD,
      },
    });

    const row = await buildRow(
      'eslint',
      entry({ current: '9.39.5', latest: '10.14.0' }),
      POLICY,
      CUTOFF,
    );

    expect(row).toMatchObject({
      sameMajor: '9.40.0',
      latest: '10.14.0',
      kind: 'major',
      notes: [],
    });
  });

  it('notes a major bump with no newer release in the current major', async () => {
    fakeRegistry({ eslint: { '9.39.5': OLD, '10.14.0': OLD } });

    const row = await buildRow(
      'eslint',
      entry({ current: '9.39.5', latest: '10.14.0' }),
      POLICY,
      CUTOFF,
    );

    expect(row).toMatchObject({
      sameMajor: null,
      notes: ['already at the same-major ceiling'],
    });
  });

  it('reads publish dates after a warning that precedes the JSON', async () => {
    fakeRegistry({
      eslint: `WARN registry slow\n${JSON.stringify({ '9.40.0': OLD })}`,
    });

    const row = await buildRow(
      'eslint',
      entry({ current: '9.39.5', latest: '10.14.0' }),
      POLICY,
      CUTOFF,
    );

    expect(row.sameMajor).toBe('9.40.0');
  });

  it('asks for a replacement for a deprecated package', async () => {
    fakeRegistry({ request: { '2.88.2': OLD } });

    const row = await buildRow(
      'request',
      entry({ current: '2.88.0', latest: '2.88.2', isDeprecated: true }),
      POLICY,
      CUTOFF,
    );

    expect(row.notes).toEqual(['deprecated: propose a replacement']);
  });

  it('lists no declaring package when pnpm reports none', async () => {
    fakeRegistry({ zod: { '4.2.0': OLD } });

    const row = await buildRow(
      'zod',
      entry({
        current: '4.1.0',
        latest: '4.2.0',
        dependentPackages: undefined,
      }),
      POLICY,
      CUTOFF,
    );

    expect(row.declaredBy).toEqual([]);
  });

  describe('for a package exempt from minimumReleaseAge', () => {
    const policy = { minAgeMinutes: 1440, excludes: ['@framework/*'] };

    it('targets the newest mature release instead of a young `latest`', async () => {
      fakeRegistry({
        '@framework/ui': { '3.0.0': OLD, '3.1.0': OLD, '4.0.0': YOUNG },
      });

      const row = await buildRow(
        '@framework/ui',
        entry({ current: '3.0.0', latest: '4.0.0' }),
        policy,
        CUTOFF,
      );

      expect(row).toMatchObject({
        sameMajor: '3.1.0',
        latest: '3.1.0',
        kind: 'minor',
        notes: [
          '4.0.0 is inside the quarantine window and installable only because the package is exempt; target 3.1.0 unless the young release fixes an advisory',
          'exempt from minimumReleaseAge',
        ],
      });
    });

    it('stays on the current version when no newer release is mature', async () => {
      fakeRegistry({ '@framework/ui': { '3.0.0': OLD, '3.0.1': YOUNG } });

      const row = await buildRow(
        '@framework/ui',
        entry({ current: '3.0.0', latest: '3.0.1' }),
        policy,
        CUTOFF,
      );

      expect(row).toMatchObject({
        sameMajor: '3.0.0',
        latest: '3.0.0',
        kind: 'patch',
        notes: [
          '3.0.1 is inside the quarantine window and installable only because the package is exempt; target nothing unless the young release fixes an advisory',
          'exempt from minimumReleaseAge',
        ],
      });
    });

    it('keeps a mature `latest`', async () => {
      fakeRegistry({ '@framework/ui': { '3.0.1': OLD } });

      const row = await buildRow(
        '@framework/ui',
        entry({ current: '3.0.0', latest: '3.0.1' }),
        policy,
        CUTOFF,
      );

      expect(row).toMatchObject({
        latest: '3.0.1',
        notes: ['exempt from minimumReleaseAge'],
      });
    });

    it('keeps a young `latest` when there is no cutoff', async () => {
      fakeRegistry({ '@framework/ui': { '3.0.1': YOUNG } });

      const row = await buildRow(
        '@framework/ui',
        entry({ current: '3.0.0', latest: '3.0.1' }),
        policy,
        null,
      );

      expect(row).toMatchObject({
        latest: '3.0.1',
        notes: ['exempt from minimumReleaseAge'],
      });
    });
  });

  describe('without publish dates', () => {
    it('reports a failed lookup by its first line', async () => {
      fakeRegistry({
        eslint: new Error('Command failed: pnpm view eslint\nERR 404'),
      });

      const row = await buildRow(
        'eslint',
        entry({ current: '9.39.5', latest: '10.14.0' }),
        POLICY,
        CUTOFF,
      );

      expect(row).toMatchObject({
        sameMajor: null,
        latest: '10.14.0',
        notes: [
          'lookup failed: Command failed: pnpm view eslint',
          'no publish dates from the registry; same-major target unverified',
          'already at the same-major ceiling',
        ],
      });
    });

    it.each([
      ['no JSON', ''],
      [
        'only the creation dates',
        JSON.stringify({ created: OLD, modified: OLD }),
      ],
    ])(
      'keeps `latest` unverified when the registry returns %s',
      async (_case, stdout) => {
        fakeRegistry({ zod: stdout });

        const row = await buildRow(
          'zod',
          entry({ current: '4.1.0', latest: '4.2.0' }),
          POLICY,
          CUTOFF,
        );

        expect(row).toMatchObject({
          sameMajor: '4.2.0',
          notes: [
            'no publish dates from the registry; same-major target unverified',
          ],
        });
      },
    );
  });
});

describe('main', () => {
  const originalArgv = process.argv;

  const run = async (args: string[], input: string): Promise<string> => {
    process.argv = ['node', 'resolve-update-targets.ts', ...args];
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(
      Readable.from([input]) as unknown as typeof process.stdin,
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await main();
    return log.mock.calls.map((call) => call.join(' ')).join('\n');
  };

  const outdated = JSON.stringify({
    'major-pkg': entry({ current: '1.0.0', latest: '2.0.0' }),
    'minor-pkg': entry({ current: '1.0.0', latest: '1.1.0' }),
    'dup@1.10.0': entry({ current: '1.10.0', latest: '1.10.1' }),
    'dup@1.9.0 (dev)': entry({
      current: '1.9.0',
      latest: '1.9.1',
      dependencyType: 'devDependencies',
    }),
    'beta-pkg': entry({ current: '1.0.0-beta.1', latest: '1.0.0' }),
    'patch-pkg': entry({ current: '1.0.0', latest: '1.0.1' }),
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T12:00:00.000Z'));
    fakeWorkspace('minimumReleaseAge: 1440\n');
    fakeRegistry({ 'major-pkg': { '1.0.0': OLD, '1.0.5': OLD } });
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('says so when the input holds no outdated packages', async () => {
    await expect(run([], '')).resolves.toBe('No outdated packages reported.');
  });

  it('prints the cutoff and the rows by bump kind, name, and version', async () => {
    const output = await run([], outdated);
    const unverified =
      'no publish dates from the registry; same-major target unverified';

    expect(output).toBe(
      [
        'minimumReleaseAge: 1440 minutes (cutoff 2026-11-05T12:00:00.000Z)',
        '',
        '| Package | Current | Same major | Latest | Kind | Declared by | Notes |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        `| \`dup\` | 1.9.0 | 1.9.1 | 1.9.1 | patch | portal-app | ${unverified} |`,
        `| \`dup\` | 1.10.0 | 1.10.1 | 1.10.1 | patch | portal-app | ${unverified} |`,
        `| \`patch-pkg\` | 1.0.0 | 1.0.1 | 1.0.1 | patch | portal-app | ${unverified} |`,
        `| \`minor-pkg\` | 1.0.0 | 1.1.0 | 1.1.0 | minor | portal-app | ${unverified} |`,
        '| `major-pkg` | 1.0.0 | 1.0.5 | 2.0.0 | major | portal-app |  |',
        `| \`beta-pkg\` | 1.0.0-beta.1 | 1.0.0 | 1.0.0 | unknown | portal-app | ${unverified} |`,
      ].join('\n'),
    );
  });

  it('prints JSON with --json, and --min-age overrides the workspace', async () => {
    const output = await run(['--json', '--min-age', '0'], outdated);
    const parsed = JSON.parse(output) as {
      minimumReleaseAgeMinutes: number;
      packages: Row[];
    };

    expect(parsed.minimumReleaseAgeMinutes).toBe(0);
    expect(parsed.packages.map((row) => `${row.name}@${row.current}`)).toEqual([
      'dup@1.9.0',
      'dup@1.10.0',
      'patch-pkg@1.0.0',
      'minor-pkg@1.0.0',
      'major-pkg@1.0.0',
      'beta-pkg@1.0.0-beta.1',
    ]);
  });

  it('prints no cutoff when the release age is zero', async () => {
    const output = await run(['--min-age', '0'], outdated);

    expect(output.split('\n')[0]).toBe(
      'minimumReleaseAge: 0 minutes (cutoff none)',
    );
  });

  it('rejects an unknown argument', async () => {
    await expect(run(['--latest'], outdated)).rejects.toThrow(
      'Unknown argument: --latest',
    );
  });
});
