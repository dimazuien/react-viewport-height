import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Addition,
  Change,
  Config,
  Decision,
  Directive,
  Disable,
  Group,
  Json,
  Plan,
  Proposal,
  Repo,
  WordList,
} from './review-words.ts';
import {
  absoluteGlobRoot,
  apply,
  applyLineEdits,
  applyListEdits,
  blank,
  configLists,
  countedIssues,
  coveredLines,
  describeChange,
  directiveTokens,
  editedFiles,
  editedLine,
  editList,
  findRootConfig,
  globMatcher,
  globRootOf,
  listedWords,
  loadConfig,
  matchesGlob,
  memberRemovals,
  needsWord,
  norm,
  parseArguments,
  parseIssue,
  parseJsonc,
  promotions,
  prunedVariant,
  reasonFor,
  removalReason,
  report,
  restoreFragments,
  reviewedDictionaries,
  reviewRepo,
  reviewSharedWords,
  scanLine,
  sharedGroups,
  sortLike,
  toChanges,
  traceRows,
  uniqueLabel,
  variantLists,
  wordLists,
} from './review-words.ts';

// The fixtures build each directive keyword from these constants, so that neither cspell nor the
// review reads this file's own text as a directive.
const CSPELL = 'cspell';
const SPELLCHECKER = 'spellchecker';

const fakeRepo = (dir: string, fields: Partial<Repo> = {}): Repo => ({
  dir,
  label: path.basename(dir),
  cspell: ['cspell'],
  configs: [],
  committable: null,
  wordLists: new Set(),
  directives: [],
  disables: [],
  packages: new Map(),
  needs: new Map(),
  notes: [],
  ...fields,
});

const fakeConfig = (
  file: string,
  data: Json = {},
  fields: Partial<Config> = {},
): Config => ({
  file,
  data,
  hasComments: false,
  owned: true,
  imports: [],
  ...fields,
});

const fakeList = (repo: Repo, fields: Partial<WordList> = {}): WordList => ({
  repo,
  file: 'cspell.json',
  list: 'words',
  words: [],
  ...fields,
});

const fakeDirective = (file: string, words: string[]): Directive => ({
  file,
  line: 1,
  start: 0,
  end: 0,
  ignore: false,
  tokens: words.map((word) => ({ word, start: 0, end: 0 })),
});

const fakeDisable = (kind: string, fields: Partial<Disable> = {}): Disable => ({
  file: 'a.md',
  line: 4,
  start: 0,
  end: 0,
  kind,
  ...fields,
});

const needs = (entries: Record<string, string[]>): Map<string, Set<string>> =>
  new Map(
    Object.entries(entries).map(([word, files]) => [word, new Set(files)]),
  );

const removal = (
  list: WordList,
  word: string,
  fields: Partial<Proposal> = {},
): Proposal => ({ list, word, reason: '', ...fields });

const brief = (removals: Proposal[]) =>
  removals.map((item) => [
    item.list.repo.label,
    item.list.list,
    item.word,
    item.reason,
    item.afterRelease ?? false,
  ]);

// An upstream repository that publishes packages/words/cspell.json, and two that import it.
function sharedSetup() {
  const source = fakeConfig(
    '/up/packages/words/cspell.json',
    { words: ['shared'] },
    { publishedAs: '@acme/words' },
  );
  const upRoot = fakeConfig('/up/cspell.json', {}, { imports: [source] });
  const up = fakeRepo('/up', {
    configs: [upRoot, source],
    packages: new Map([['@acme/words', '/up/packages/words']]),
  });
  const member = (dir: string, words: string[]) => {
    const installed = fakeConfig(
      `${dir}/node_modules/@acme/words/cspell.json`,
      { words },
      { owned: false },
    );
    const root = fakeConfig(`${dir}/cspell.json`, {}, { imports: [installed] });
    return fakeRepo(dir, { configs: [root, installed] });
  };
  const a = member('/a', ['shared']);
  const b = member('/b', []);
  const group: Group = {
    source,
    owner: up,
    members: [up, a, b],
    installed: new Map([
      [a, new Set(['shared'])],
      [b, new Set()],
    ]),
  };
  return { source, up, a, b, group };
}

describe('norm', () => {
  it('folds case, accents, and a possessive ending', () => {
    expect(norm('README')).toBe('readme');
    expect(norm("Café's")).toBe('cafe');
    expect(norm('Zoë’s')).toBe('zoe');
  });
});

describe('parseJsonc', () => {
  it('drops comments and trailing commas, and reports the comments', () => {
    const text = [
      '{',
      '  // a comment',
      '  "words": ["alpha", "beta",],',
      '  /* block */ "url": "https://example.com/*kept*/",',
      '}',
    ].join('\n');
    expect(parseJsonc(text)).toEqual({
      data: { words: ['alpha', 'beta'], url: 'https://example.com/*kept*/' },
      hasComments: true,
    });
  });

  it('keeps comment markers inside strings', () => {
    expect(parseJsonc('{"path": "//server/share"}')).toEqual({
      data: { path: '//server/share' },
      hasComments: false,
    });
  });

  it('rejects a config that is not an object', () => {
    expect(() => parseJsonc('["alpha"]')).toThrow(/must hold a JSON object/);
    expect(() => parseJsonc('null')).toThrow(/must hold a JSON object/);
  });
});

describe('directiveTokens', () => {
  it('reads words up to the end of an HTML comment, with their positions', () => {
    const line = `<!-- ${CSPELL}:words alpha, beta -->`;
    expect(directiveTokens(line, 17)).toEqual([
      { word: 'alpha', start: 18, end: 23 },
      { word: 'beta', start: 25, end: 29 },
    ]);
  });

  it('stops at the end of a block comment, or else at the end of the line', () => {
    const words = (line: string, from: number) =>
      directiveTokens(line, from).map((token) => token.word);
    expect(words(`/* ${CSPELL}:ignore gamma */ const x = 1;`, 16)).toEqual([
      'gamma',
    ]);
    expect(words(`# ${CSPELL}:words delta epsilon`, 14)).toEqual([
      'delta',
      'epsilon',
    ]);
  });
});

describe('scanLine', () => {
  it('records words and ignore directives with their spans', () => {
    const repo = fakeRepo('/repo');
    scanLine(repo, 'a.md', `<!-- ${CSPELL}:words alpha, beta -->`, 3, []);
    scanLine(repo, 'b.ts', `// ${SPELLCHECKER}: ignoreWords gamma`, 7, []);
    expect(repo.directives).toEqual([
      {
        file: 'a.md',
        line: 3,
        ignore: false,
        tokens: [
          { word: 'alpha', start: 18, end: 23 },
          { word: 'beta', start: 25, end: 29 },
        ],
        start: 5,
        end: 29,
      },
      {
        file: 'b.ts',
        line: 7,
        ignore: true,
        tokens: [{ word: 'gamma', start: 29, end: 34 }],
        start: 3,
        end: 34,
      },
    ]);
  });

  it('closes a disable block at its enable line', () => {
    const repo = fakeRepo('/repo');
    const open: Disable[] = [];
    scanLine(repo, 'a.md', `<!-- ${CSPELL}:disable -->`, 2, open);
    scanLine(repo, 'a.md', `<!-- ${CSPELL}:enable -->`, 5, open);
    expect(repo.disables).toEqual([
      { file: 'a.md', line: 2, kind: 'disable', start: 5, end: 19, endLine: 5 },
    ]);
    expect(open).toEqual([]);
  });

  it('records line directives without an end, in lower case', () => {
    const repo = fakeRepo('/repo');
    const open: Disable[] = [];
    scanLine(repo, 'a.ts', `// ${CSPELL}:Disable-Next-Line`, 1, open);
    scanLine(repo, 'a.ts', `x = 1; // ${CSPELL}:disable-line`, 4, open);
    expect(repo.disables.map((item) => [item.kind, item.line])).toEqual([
      ['disable-next-line', 1],
      ['disable-line', 4],
    ]);
    expect(open).toEqual([]);
  });
});

describe('matchesGlob', () => {
  it('matches the file, a folder that holds it, or a slash-free name anywhere', () => {
    expect(matchesGlob('docs/guide.md', 'docs/*.md')).toBe(true);
    expect(matchesGlob('docs/deep/guide.md', 'docs')).toBe(true);
    expect(matchesGlob('src/deep/notes.md', '*.md')).toBe(true);
    expect(matchesGlob('src/notes.md', 'docs/*.md')).toBe(false);
    expect(matchesGlob('src/notes.txt', '*.md')).toBe(false);
  });
});

describe('globMatcher', () => {
  it('matches repository files against patterns from the glob root', () => {
    const scope = globMatcher('/repo/packages/app', '/repo', ['src/**']);
    expect(scope('packages/app/src/index.ts')).toBe(true);
    expect(scope('src/index.ts')).toBe(false);
  });
});

describe('globRootOf and absoluteGlobRoot', () => {
  it('resolve a glob root from the config folder', () => {
    const at = (globRoot?: unknown) =>
      fakeConfig('/repo/configs/cspell.json', { globRoot });
    expect(globRootOf(at())).toBe('/repo/configs');
    expect(globRootOf(at('..'))).toBe('/repo');
    expect(absoluteGlobRoot(at())).toBe('/repo/configs');
    expect(absoluteGlobRoot(at('..'))).toBe('/repo');
  });

  it('differ on a glob root that holds a variable', () => {
    const config = fakeConfig('/repo/configs/cspell.json', {
      globRoot: '${cwd}/src',
    });
    expect(globRootOf(config)).toBe('/repo/configs');
    expect(absoluteGlobRoot(config)).toBe('${cwd}/src');
  });
});

describe('configLists', () => {
  it('lists words, ignore words, and override lists with their scopes', () => {
    const repo = fakeRepo('/repo');
    const config = fakeConfig('/repo/cspell.json', {
      words: ['alpha'],
      ignoreWords: ['beta'],
      overrides: [
        { filename: '**/*.md', words: ['gamma'] },
        { filename: ['docs/**'], ignoreWords: ['delta'] },
      ],
    });
    const lists = configLists(repo, config);
    expect(lists.map((list) => [list.file, list.list, list.words])).toEqual([
      ['cspell.json', 'words', ['alpha']],
      ['cspell.json', 'ignoreWords', ['beta']],
      ['cspell.json', 'overrides[0].words', ['gamma']],
      ['cspell.json', 'overrides[0].ignoreWords', []],
      ['cspell.json', 'overrides[1].words', []],
      ['cspell.json', 'overrides[1].ignoreWords', ['delta']],
    ]);
    expect(lists[0].scope).toBeUndefined();
    expect(lists[2].scope?.('notes/a.md')).toBe(true);
    expect(lists[2].scope?.('a.ts')).toBe(false);
    expect(lists[5].scope?.('docs/a.txt')).toBe(true);
  });
});

describe('wordLists', () => {
  it('keeps owned configs and directives that list words', () => {
    const owned = fakeConfig('/repo/cspell.json', { words: ['alpha'] });
    const installed = fakeConfig(
      '/repo/node_modules/@acme/words/cspell.json',
      { words: ['zeta'] },
      { owned: false },
    );
    const repo = fakeRepo('/repo', {
      configs: [owned, installed],
      directives: [fakeDirective('a.md', ['beta']), fakeDirective('b.md', [])],
    });
    expect(
      wordLists(repo).map((list) => [list.file, list.list, list.words]),
    ).toEqual([
      ['cspell.json', 'words', ['alpha']],
      ['a.md', 'directive', ['beta']],
    ]);
  });
});

describe('listedWords', () => {
  it('collects normalized words from a config and the configs it imports', () => {
    const base = fakeConfig('/repo/base.json', { words: ['delta'] });
    const shared = fakeConfig(
      '/repo/shared.json',
      { words: ["Gamma's"] },
      { imports: [base] },
    );
    const root = fakeConfig(
      '/repo/cspell.json',
      { words: ['Alpha'], ignoreWords: ['beta'] },
      { imports: [shared] },
    );
    expect(listedWords(root, true)).toEqual(
      new Set(['alpha', 'beta', 'gamma', 'delta']),
    );
    expect(listedWords(root, false)).toEqual(new Set(['gamma', 'delta']));
  });
});

describe('parseIssue', () => {
  const repo = fakeRepo('/repo');

  it('reads the file, line, and word, with or without a fix', () => {
    expect(
      parseIssue(repo, '/repo/docs/guide.md:12:5 - Unknown word (Alpha)'),
    ).toEqual({ file: 'docs/guide.md', line: 12, word: 'Alpha' });
    expect(
      parseIssue(repo, 'docs/guide.md:3:1 - Unknown word (teh) fix: (the)'),
    ).toEqual({ file: 'docs/guide.md', line: 3, word: 'teh' });
  });

  it('keeps a colon in the file name', () => {
    expect(parseIssue(repo, 'notes/a:b.md:3:1 - Unknown word (beta)')).toEqual({
      file: 'notes/a:b.md',
      line: 3,
      word: 'beta',
    });
  });

  it('ignores other lines', () => {
    expect(
      parseIssue(repo, 'docs/a.md:1:1 - Forbidden word (alpha)'),
    ).toBeNull();
    expect(parseIssue(repo, 'a.md:1:1 - Unknown word ()')).toBeNull();
    expect(parseIssue(repo, ' - Unknown word (alpha)')).toBeNull();
  });
});

describe('countedIssues', () => {
  const stdout = [
    'docs/a.md:1:1 - Unknown word (alpha)',
    'cspell.json:2:3 - Unknown word (beta)',
    'temp/b.md:1:1 - Unknown word (gamma)',
    'docs/a.md:2:1 - Forbidden word (delta)',
  ].join('\n');

  it('counts committed files outside the word lists', () => {
    const repo = fakeRepo('/repo', {
      committable: new Set(['docs/a.md', 'cspell.json']),
      wordLists: new Set(['cspell.json']),
    });
    expect(countedIssues(repo, stdout)).toEqual([
      { file: 'docs/a.md', line: 1, word: 'alpha' },
    ]);
  });

  it('counts every file outside a git checkout', () => {
    const repo = fakeRepo('/repo', { wordLists: new Set(['cspell.json']) });
    expect(countedIssues(repo, stdout).map((issue) => issue.word)).toEqual([
      'alpha',
      'gamma',
    ]);
  });
});

describe('blank', () => {
  it('replaces each span with spaces and keeps every position', () => {
    const spans = [
      { line: 1, start: 4, end: 7 },
      { line: 2, start: 0, end: 4 },
    ];
    expect(blank('one two three\nfour five', spans)).toBe(
      'one     three\n     five',
    );
  });
});

describe('needsWord', () => {
  const repo = fakeRepo('/repo', {
    needs: needs({ alpha: ['docs/a.md'], beta: ['src/b.ts'] }),
  });

  it('checks any file for a list that applies everywhere', () => {
    const list = fakeList(repo);
    expect(needsWord(list, 'Alpha')).toBe(true);
    expect(needsWord(list, 'gamma')).toBe(false);
  });

  it('checks only the files an override covers', () => {
    const list = fakeList(repo, {
      list: 'overrides[0].words',
      scope: (file) => file.startsWith('src/'),
    });
    expect(needsWord(list, 'alpha')).toBe(false);
    expect(needsWord(list, 'beta')).toBe(true);
  });

  it("checks only a directive's own file", () => {
    const list = fakeList(repo, {
      file: 'docs/a.md',
      list: 'directive',
      directive: fakeDirective('docs/a.md', ['alpha', 'beta']),
    });
    expect(needsWord(list, 'alpha')).toBe(true);
    expect(needsWord(list, 'beta')).toBe(false);
  });
});

describe('traceRows', () => {
  it('keeps the words that a dictionary enabled for the language holds', () => {
    const stdout = [
      'Word       F Dictionary',
      'shellcheck * software-terms*',
      'README     * [words]*',
      'Type•Script * typescript*',
      'github     * companies',
      '',
    ].join('\n');
    expect(traceRows(stdout)).toEqual([
      ['shellcheck', 'software-terms'],
      ['typescript', 'typescript'],
    ]);
  });
});

describe('reasonFor', () => {
  it('names the bundled dictionaries that know the word, sorted', () => {
    const dictionaries = new Map([['alpha', new Set(['typescript', 'en_us'])]]);
    expect(reasonFor(fakeRepo('/repo'), 'Alpha', dictionaries)).toBe(
      'a bundled dictionary knows it (en_us, typescript)',
    );
  });

  it('says no checked file needs a word outside a git checkout', () => {
    expect(reasonFor(fakeRepo('/repo'), 'beta', new Map())).toBe(
      'no checked file needs it',
    );
  });
});

describe('sharedGroups', () => {
  it('groups the repositories in the run that import a published config', () => {
    const { source, up, a } = sharedSetup();
    const other = fakeRepo('/other', {
      configs: [fakeConfig('/other/cspell.json')],
    });
    const groups = sharedGroups([up, a, other]);
    expect(groups).toHaveLength(1);
    expect(groups[0].source).toBe(source);
    expect(groups[0].owner).toBe(up);
    expect(groups[0].members.map((repo) => repo.label)).toEqual(['up', 'a']);
    expect(groups[0].installed.get(a)).toEqual(new Set(['shared']));
  });

  it('skips a published config that no other repository in the run imports', () => {
    const { up } = sharedSetup();
    const other = fakeRepo('/other', {
      configs: [fakeConfig('/other/cspell.json')],
    });
    expect(sharedGroups([up, other])).toEqual([]);
  });
});

describe('removalReason', () => {
  const base = fakeConfig('/repo/base.json', { words: ['beta'] });
  const root = fakeConfig(
    '/repo/cspell.json',
    { words: ['alpha'] },
    { imports: [base] },
  );
  const repo = fakeRepo('/repo', {
    configs: [root, base],
    needs: needs({ gamma: ['a.md'] }),
  });
  const words = fakeList(repo, { config: root });

  it('drops a directive word that the cspell config lists', () => {
    const list = fakeList(repo, {
      file: 'a.md',
      list: 'directive',
      directive: fakeDirective('a.md', ['Alpha']),
    });
    expect(removalReason(repo, list, 'Alpha')).toBe(
      'the cspell config already lists it',
    );
  });

  it('drops an override word that the same config lists for every file', () => {
    const list = fakeList(repo, { config: root, list: 'overrides[0].words' });
    expect(removalReason(repo, list, 'alpha')).toBe(
      'the same config lists it for every file',
    );
  });

  it('drops a word that an imported config lists', () => {
    expect(removalReason(repo, words, 'beta')).toBe(
      'an imported config already lists it',
    );
  });

  it('keeps a word that a file needs', () => {
    expect(removalReason(repo, words, 'gamma')).toBeNull();
  });

  it("leaves an unneeded word's reason for later, or keeps it in a published config", () => {
    expect(removalReason(repo, words, 'delta')).toBe('');
    const published = fakeConfig(
      '/repo/packages/words/cspell.json',
      {},
      { publishedAs: '@acme/words' },
    );
    const list = fakeList(repo, { config: published });
    expect(removalReason(repo, list, 'delta')).toBeNull();
  });
});

describe('reviewRepo', () => {
  it('proposes removals outside shared configs and notes published configs', () => {
    const root = fakeConfig('/repo/cspell.json', {});
    const published = fakeConfig(
      '/repo/packages/words/cspell.json',
      {},
      { publishedAs: '@acme/words' },
    );
    const shared = fakeConfig(
      '/repo/packages/shared/cspell.json',
      {},
      { publishedAs: '@acme/shared' },
    );
    const repo = fakeRepo('/repo', {
      configs: [root, published, shared],
      needs: needs({ gamma: ['a.md'] }),
    });
    const lists = [
      fakeList(repo, { config: root, words: ['alpha', 'gamma'] }),
      fakeList(repo, { config: shared, words: ['zeta'] }),
    ];
    const removals: Proposal[] = [];
    reviewRepo(repo, lists, new Set([shared]), removals);
    expect(brief(removals)).toEqual([['repo', 'words', 'alpha', '', false]]);
    expect(repo.notes).toEqual([
      "packages/words/cspell.json ships in @acme/words. Its words aren't reviewed without the repositories that import it.",
    ]);
  });
});

describe('reviewSharedWords', () => {
  const emptyPlan = (): Plan => ({
    created: '',
    repos: [],
    changes: [],
    decisions: [],
    kept: [],
  });
  const sourceList = (up: Repo, group: Group, words: string[]): WordList =>
    fakeList(up, {
      file: 'packages/words/cspell.json',
      config: group.source,
      words,
    });
  const move = (word: string, user: string, file: string): Change[] => [
    {
      repo: `/${user}`,
      file,
      action: 'add',
      list: 'words',
      words: [
        { word, reason: 'it moves out of packages/words/cspell.json in up' },
      ],
    },
    {
      repo: '/up',
      file: 'packages/words/cspell.json',
      action: 'remove',
      list: 'words',
      words: [{ word, reason: `only ${user} needs it` }],
    },
  ];

  it('removes shared words no repository needs, and asks about words only one needs', () => {
    const { up, a, b, group } = sharedSetup();
    a.needs = needs({ alpha: ['a.md'], beta: ['a.md'] });
    b.needs = needs({ alpha: ['b.md'] });
    const source = sourceList(up, group, ['alpha', 'beta', 'zeta']);
    const removals: Proposal[] = [];
    const plan = emptyPlan();
    reviewSharedWords(group, source, removals, plan);
    expect(brief(removals)).toEqual([['up', 'words', 'zeta', '', false]]);
    expect(plan.decisions).toEqual([
      {
        repo: '/up',
        file: 'packages/words/cspell.json',
        word: 'beta',
        question: "Only a needs it. Move it into that repository's own config?",
        accept: false,
        changes: move('beta', 'a', 'cspell.json'),
      },
    ]);
  });

  it("moves a word only the publisher needs into the publisher's root config", () => {
    const { up, group } = sharedSetup();
    up.needs = needs({ gamma: ['README.md'] });
    const plan = emptyPlan();
    reviewSharedWords(group, sourceList(up, group, ['gamma']), [], plan);
    expect(plan.decisions.map((decision) => decision.changes)).toEqual([
      move('gamma', 'up', 'cspell.json'),
    ]);
  });

  it("doesn't ask when the publisher's root config is the shared config", () => {
    const { up, group } = sharedSetup();
    up.configs = [group.source];
    up.needs = needs({ gamma: ['README.md'] });
    const plan = emptyPlan();
    reviewSharedWords(group, sourceList(up, group, ['gamma']), [], plan);
    expect(plan.decisions).toEqual([]);
  });
});

describe('promotions and memberRemovals', () => {
  function promotionSetup() {
    const { up, a, b, group } = sharedSetup();
    a.needs = needs({ alpha: ['a.md'], beta: ['a.md'], shared: ['a.md'] });
    b.needs = needs({ alpha: ['b.md'], beta: ['b.md'], gamma: ['b.md'] });
    const aRoot = a.configs[0];
    const bRoot = b.configs[0];
    const aWords = fakeList(a, { config: aRoot, words: ['Alpha', 'shared'] });
    const lists = new Map<Repo, WordList[]>([
      [
        up,
        [
          fakeList(up, {
            file: 'packages/words/cspell.json',
            config: group.source,
            words: ['shared'],
          }),
          fakeList(up, { config: up.configs[0], words: ['shared'] }),
        ],
      ],
      [
        a,
        [
          aWords,
          fakeList(a, { config: aRoot, list: 'ignoreWords', words: ['beta'] }),
        ],
      ],
      [
        b,
        [
          fakeList(b, { config: bRoot, words: ['alpha'] }),
          fakeList(b, {
            file: 'b.md',
            list: 'directive',
            words: ['gamma'],
            directive: fakeDirective('b.md', ['gamma']),
          }),
        ],
      ],
    ]);
    return { aWords, group, lists };
  }

  it('promote a word two members need that the shared config lacks', () => {
    const { group, lists } = promotionSetup();
    const additions: Addition[] = [];
    expect(promotions(group, lists, additions)).toEqual(new Set(['alpha']));
    expect(additions.map((item) => [item.word, item.reason])).toEqual([
      ['Alpha', 'a, b need it'],
    ]);
    expect(additions[0].group).toBe(group);
  });

  it('remove member words the shared config lists or gains, after its release where needed', () => {
    const { group, lists } = promotionSetup();
    const removals: Proposal[] = [];
    memberRemovals(group, lists, new Set(['alpha']), removals);
    const moves = 'it moves to packages/words/cspell.json in up';
    const listed = 'packages/words/cspell.json in up lists it';
    expect(brief(removals)).toEqual([
      ['up', 'words', 'shared', listed, false],
      ['a', 'words', 'Alpha', moves, true],
      ['a', 'words', 'shared', listed, false],
      ['b', 'words', 'alpha', moves, true],
    ]);
  });

  it('skip a member word that already has a proposal', () => {
    const { aWords, group, lists } = promotionSetup();
    const removals = [removal(aWords, 'shared')];
    memberRemovals(group, lists, new Set(), removals);
    expect(brief(removals)).toEqual([
      ['a', 'words', 'shared', '', false],
      [
        'up',
        'words',
        'shared',
        'packages/words/cspell.json in up lists it',
        false,
      ],
    ]);
  });
});

describe('restoreFragments', () => {
  const plan = (): Plan => ({
    created: '',
    repos: [],
    changes: [],
    decisions: [],
    kept: [],
  });

  it('keeps a removed word whose fragment fails', () => {
    const repo = fakeRepo('/r');
    const words = fakeList(repo);
    const removals = [removal(words, 'Workspaces'), removal(words, 'zeta')];
    const result = plan();
    restoreFragments(
      [{ repo, issue: { file: 'a.md', line: 2, word: 'space' } }],
      [],
      removals,
      result,
    );
    expect(removals.map((item) => item.word)).toEqual(['zeta']);
    expect(result.kept).toEqual([
      {
        repo: '/r',
        file: 'cspell.json',
        word: 'Workspaces',
        reason: 'without it, cspell reports the fragment space in a.md',
      },
    ]);
  });

  it('reaches a removal from the shared config of a member', () => {
    const { up, a, group } = sharedSetup();
    const source = fakeList(up, {
      file: 'packages/words/cspell.json',
      config: group.source,
    });
    const removals = [removal(source, 'kubectl')];
    const result = plan();
    restoreFragments(
      [{ repo: a, issue: { file: 'a.md', line: 1, word: 'ctl' } }],
      [group],
      removals,
      result,
    );
    expect(removals).toEqual([]);
    expect(result.kept.map((item) => item.word)).toEqual(['kubectl']);
  });

  it('fails on a fragment that no removed word explains', () => {
    const repo = fakeRepo('/r');
    const other = fakeRepo('/other');
    const removals = [
      removal(fakeList(repo), 'abc'),
      removal(fakeList(other), 'xyz'),
    ];
    const fresh = [
      { repo, issue: { file: 'a.md', line: 2, word: 'ab' } },
      { repo, issue: { file: 'a.md', line: 3, word: 'xyz' } },
    ];
    expect(() => restoreFragments(fresh, [], removals, plan())).toThrow(
      'The proposed end state adds failures that no removed word explains:\nr: a.md:2 ab\nr: a.md:3 xyz',
    );
  });
});

describe('prunedVariant', () => {
  it("drops the proposed words and adds promoted words to the shared config's list", () => {
    const { source, up, a, b, group } = sharedSetup();
    const root = a.configs[0];
    const removals = [
      removal(fakeList(a, { config: root }), 'Alpha'),
      removal(
        fakeList(a, { config: root, list: 'overrides[0].words' }),
        'beta',
      ),
    ];
    const state = {
      repos: [up, a, b],
      out: '/out',
      groups: [group],
      removals,
      additions: [{ group, word: 'zeta', reason: '' }],
    };
    const variant = prunedVariant(a, state, new Map());
    expect(variant.name).toBe('pruned');
    expect(variant.words(root, 'words', [' alpha ', 'beta', 'gamma'])).toEqual([
      'beta',
      'gamma',
    ]);
    expect(
      variant.words(root, 'overrides[0].words', ['beta', 'gamma']),
    ).toEqual(['gamma']);
    expect(variant.words(source, 'words', ['shared'])).toEqual([
      'shared',
      'zeta',
    ]);
    expect(variant.words(source, 'ignoreWords', ['shared'])).toEqual([
      'shared',
    ]);
  });

  it("points a member's import of the shared config at its pruned copy", () => {
    const { source, up, a, group } = sharedSetup();
    const state = {
      repos: [up, a],
      out: '/out',
      groups: [group],
      removals: [],
      additions: [],
    };
    const shared = new Map([[source, '/out/up/pruned/1-cspell.json']]);
    const installed = a.configs[1];
    expect(prunedVariant(a, state, shared).replaceImport?.(installed)).toBe(
      '/out/up/pruned/1-cspell.json',
    );
    expect(
      prunedVariant(up, state, shared).replaceImport?.(installed),
    ).toBeUndefined();
    expect(
      prunedVariant(a, state, shared).replaceImport?.(fakeConfig('/a/x.json')),
    ).toBeUndefined();
  });
});

describe('variantLists', () => {
  it('passes top-level and override lists through the variant', () => {
    const config = fakeConfig('/repo/cspell.json');
    const data: Json = {
      words: ['alpha', 'beta'],
      ignoreWords: 'not a list',
      overrides: [{ filename: '*.md', words: ['gamma'] }, { filename: '*.ts' }],
    };
    variantLists(config, data, {
      name: 'test',
      words: (_config, list, words) => words.map((word) => `${list}:${word}`),
    });
    expect(data).toEqual({
      words: ['words:alpha', 'words:beta'],
      ignoreWords: 'not a list',
      overrides: [
        { filename: '*.md', words: ['overrides[0].words:gamma'] },
        { filename: '*.ts' },
      ],
    });
  });
});

describe('coveredLines', () => {
  it('covers the next line, the same line, or the block up to its enable', () => {
    expect(coveredLines(fakeDisable('disable-next-line'))).toEqual([5, 5]);
    expect(coveredLines(fakeDisable('disable-line'))).toEqual([4, 4]);
    expect(coveredLines(fakeDisable('disable', { endLine: 9 }))).toEqual([
      4, 9,
    ]);
    expect(coveredLines(fakeDisable('disable'))).toEqual([
      4,
      Number.MAX_SAFE_INTEGER,
    ]);
  });
});

describe('toChanges', () => {
  it('groups removals by list and release, and additions by shared config', () => {
    const { up, a, group } = sharedSetup();
    const words = fakeList(a);
    const removals = [
      removal(words, 'alpha'),
      removal(words, 'beta', { reason: 'why' }),
      removal(words, 'gamma', { reason: 'later', afterRelease: true }),
    ];
    const additions = [{ group, word: 'delta', reason: 'a, b need it' }];
    expect(toChanges(removals, additions)).toEqual([
      {
        repo: '/a',
        file: 'cspell.json',
        action: 'remove',
        list: 'words',
        words: [
          { word: 'alpha', reason: '' },
          { word: 'beta', reason: 'why' },
        ],
      },
      {
        repo: '/a',
        file: 'cspell.json',
        action: 'remove',
        list: 'words',
        words: [{ word: 'gamma', reason: 'later' }],
        afterRelease: true,
      },
      {
        repo: up.dir,
        file: 'packages/words/cspell.json',
        action: 'add',
        list: 'words',
        words: [{ word: 'delta', reason: 'a, b need it' }],
      },
    ]);
  });
});

describe('describeChange', () => {
  const change = (fields: Partial<Change>): Change => ({
    repo: '/repo',
    file: 'cspell.json',
    action: 'remove',
    list: 'words',
    words: [],
    ...fields,
  });

  it('groups the words of a removal by reason', () => {
    const words = [
      { word: 'alpha', reason: 'first' },
      { word: 'beta', reason: 'second' },
      { word: 'gamma', reason: 'first' },
    ];
    expect(describeChange(change({ words }))).toEqual([
      '- Remove from cspell.json → words (3):',
      '  - first: alpha, gamma',
      '  - second: beta',
    ]);
  });

  it('names the line of a directive and a change left for after the release', () => {
    const words = [{ word: 'alpha', reason: 'why' }];
    const fields = { file: 'a.md', line: 3, list: 'directive', words };
    expect(describeChange(change({ ...fields, afterRelease: true }))).toEqual([
      '- Remove from a.md:3 (once this repository installs the release that adds them) (1):',
      '  - why: alpha',
    ]);
  });

  it('describes an addition and a removed disable directive', () => {
    const words = [{ word: 'delta', reason: 'a, b need it' }];
    expect(describeChange(change({ action: 'add', words }))).toEqual([
      '- Add to cspell.json → words (1):',
      '  - a, b need it: delta',
    ]);
    const disable = change({
      action: 'remove-disable',
      file: 'a.md',
      line: 7,
      list: 'disable-next-line',
    });
    expect(describeChange(disable)).toEqual([
      '- Remove the disable-next-line directive at a.md:7: nothing it covers fails without it.',
    ]);
  });
});

describe('report', () => {
  it('lists each repository with its notes and findings, then the plan file', () => {
    const plan: Plan = {
      created: '',
      repos: [
        { dir: '/r', label: 'r', notes: ['a note'] },
        { dir: '/s', label: 's', notes: [] },
      ],
      changes: [
        {
          repo: '/r',
          file: 'cspell.json',
          action: 'remove',
          list: 'words',
          words: [{ word: 'alpha', reason: 'gone' }],
        },
      ],
      kept: [{ repo: '/r', file: 'cspell.json', word: 'beta', reason: 'why' }],
      decisions: [
        {
          repo: '/r',
          file: 'shared.json',
          word: 'gamma',
          question: 'Move?',
          accept: false,
          changes: [],
        },
      ],
    };
    expect(report(plan, '/out/plan.json').split('\n')).toEqual([
      '## r (/r)',
      '',
      '- Note: a note',
      '- Remove from cspell.json → words (1):',
      '  - gone: alpha',
      '- Keep beta in cspell.json: why.',
      '- Decide: gamma in shared.json. Move?',
      '',
      '## s (/s)',
      '',
      '- Nothing to change.',
      '',
      'Verified: the end state adds no failure in a committed file of any repository in the run.',
      'Plan: /out/plan.json',
    ]);
  });
});

describe('sortLike', () => {
  it('keeps a list sorted by code point', () => {
    expect(sortLike(['Beta', 'alpha'], ['gamma', 'Zeta'])).toEqual([
      'Beta',
      'Zeta',
      'alpha',
      'gamma',
    ]);
  });

  it('keeps a list sorted without regard to case', () => {
    expect(sortLike(['alpha', 'Beta'], ['Gamma', 'delta'])).toEqual([
      'alpha',
      'Beta',
      'delta',
      'Gamma',
    ]);
  });

  it('appends to an unsorted list', () => {
    expect(sortLike(['zeta', 'alpha'], ['beta'])).toEqual([
      'zeta',
      'alpha',
      'beta',
    ]);
  });
});

describe('editList', () => {
  it('edits a top-level list or an override list', () => {
    const data: Json = {
      words: ['alpha'],
      overrides: [{ filename: '*.md', words: ['beta'] }],
    };
    editList(data, 'words', (words) => [...words, 'gamma']);
    editList(data, 'overrides[0].words', () => []);
    editList(data, 'ignoreWords', (words) => [...words, 'delta']);
    expect(data).toEqual({
      words: ['alpha', 'gamma'],
      overrides: [{ filename: '*.md', words: [] }],
      ignoreWords: ['delta'],
    });
  });

  it('fails on an override that does not exist', () => {
    expect(() => editList({}, 'overrides[3].words', (words) => words)).toThrow(
      'no overrides[3].words to edit',
    );
  });
});

describe('editedLine', () => {
  const change = (action: Change['action'], words: string[]): Change => ({
    repo: '/repo',
    file: 'a.md',
    action,
    list: action === 'remove' ? 'directive' : 'disable',
    words: words.map((word) => ({ word, reason: '' })),
  });

  it('removes the words from a directive and keeps the rest of the line', () => {
    expect(
      editedLine(
        `<!-- ${CSPELL}:words alpha beta gamma -->`,
        change('remove', ['Beta']),
      ),
    ).toBe(`<!-- ${CSPELL}:words alpha gamma -->`);
    expect(
      editedLine(`// ${CSPELL}:ignore alpha, beta`, change('remove', ['beta'])),
    ).toBe(`// ${CSPELL}:ignore alpha`);
  });

  it('returns null when only comment syntax would remain', () => {
    expect(
      editedLine(`<!-- ${CSPELL}:words beta -->`, change('remove', ['beta'])),
    ).toBeNull();
    expect(
      editedLine(
        `/* ${CSPELL}:disable-next-line */`,
        change('remove-disable', []),
      ),
    ).toBeNull();
  });
});

describe('parseArguments', () => {
  it('collects repositories, the output folder, and a plan to apply', () => {
    expect(
      parseArguments(['--repo', 'a', '--repo', '/abs/b', '--out', 'out']),
    ).toEqual({
      repos: [path.resolve('a'), '/abs/b'],
      out: path.resolve('out'),
      apply: '',
    });
    expect(parseArguments(['--apply', 'plan.json'])).toEqual({
      repos: [],
      out: '',
      apply: path.resolve('plan.json'),
    });
  });

  it('rejects an unknown argument', () => {
    expect(() => parseArguments(['--verbose'])).toThrow(
      'unknown argument --verbose',
    );
  });
});

describe('uniqueLabel', () => {
  it('numbers a folder name that another repository in the run already uses', () => {
    const labels = new Set<string>();
    expect(uniqueLabel('/one/app', labels)).toBe('app');
    expect(uniqueLabel('/two/app', labels)).toBe('app-2');
    expect(uniqueLabel('/three/app', labels)).toBe('app-3');
    expect(labels).toEqual(new Set(['app', 'app-2', 'app-3']));
  });
});

describe('with files on disk', () => {
  let dir = '';

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'review-words-')));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (file: string, text: string): string => {
    const full = path.join(dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
    return full;
  };

  describe('findRootConfig', () => {
    it('finds the first JSON config name in order', () => {
      write('cspell.config.json', '{}');
      write('.cspell.jsonc', '{}');
      expect(findRootConfig(dir)).toBe(path.join(dir, '.cspell.jsonc'));
    });

    it('rejects a config in another format', () => {
      write('cspell.config.yaml', '');
      expect(() => findRootConfig(dir)).toThrow(
        "cspell.config.yaml isn't a JSON config",
      );
    });

    it('fails without a config', () => {
      expect(() => findRootConfig(dir)).toThrow(
        'has no cspell JSON config at its root',
      );
    });
  });

  describe('loadConfig', () => {
    it('loads each import once and marks the configs a public package ships', () => {
      const rootFile = write(
        'cspell.json',
        '{\n  // the root\n  "import": ["./packages/words/cspell.json", "./packages/private/cspell.json", "@acme/installed/cspell.json"]\n}\n',
      );
      write('packages/words/package.json', '{"name": "@acme/words"}');
      write('packages/words/cspell.json', '{"import": "../../cspell.json"}');
      write(
        'packages/private/package.json',
        '{"name": "@acme/private", "private": true}',
      );
      write('packages/private/cspell.json', '{}');
      write(
        'node_modules/@acme/installed/package.json',
        '{"name": "@acme/installed"}',
      );
      write('node_modules/@acme/installed/cspell.json', '{"words": ["zeta"]}');
      const seen = new Map<string, Config>();
      const root = loadConfig(dir, rootFile, seen);
      const [words, hidden, installed] = root.imports;
      expect(seen.size).toBe(4);
      expect(root.hasComments).toBe(true);
      expect(root.publishedAs).toBeUndefined();
      expect(words.publishedAs).toBe('@acme/words');
      expect(words.imports[0]).toBe(root);
      expect(hidden.publishedAs).toBeUndefined();
      expect(installed.owned).toBe(false);
      expect(installed.data).toEqual({ words: ['zeta'] });
    });

    it("fails on an import that doesn't resolve", () => {
      const rootFile = write('cspell.json', '{"import": "@acme/missing"}');
      expect(() => loadConfig(dir, rootFile, new Map())).toThrow(
        "cspell.json imports @acme/missing, which doesn't resolve. Install the repository's dependencies first.",
      );
    });
  });

  describe('reviewedDictionaries and configLists', () => {
    it('review the local plain-text dictionaries a config enables or adds words to', () => {
      write('words.txt', 'alpha\n\n# a comment\n  beta  \n');
      write('added.txt', 'gamma\n');
      write('off.txt', 'delta\n');
      write('packed.trie', '');
      const config = fakeConfig(path.join(dir, 'cspell.json'), {
        dictionaries: ['project'],
        dictionaryDefinitions: [
          { name: 'project', path: './words.txt' },
          { name: 'added', path: './added.txt', addWords: true },
          { name: 'off', path: './off.txt' },
          { name: 'packed', path: './packed.trie', addWords: true },
          { name: 'gone', path: './gone.txt', addWords: true },
          { name: 'remote' },
        ],
      });
      expect(reviewedDictionaries(config)).toEqual([
        { name: 'project', file: path.join(dir, 'words.txt') },
        { name: 'added', file: path.join(dir, 'added.txt') },
      ]);
      const lists = configLists(fakeRepo(dir), config).filter(
        (list) => list.list === 'dictionary',
      );
      expect(lists.map((list) => [list.file, list.words])).toEqual([
        ['words.txt', ['alpha', 'beta']],
        ['added.txt', ['gamma']],
      ]);
    });
  });

  describe('editedFiles and toChanges', () => {
    it('blank and name the directive words proposed for removal', () => {
      write('a.md', `<!-- ${CSPELL}:words alpha beta -->\ntext\n`);
      const repo = fakeRepo(dir);
      scanLine(repo, 'a.md', `<!-- ${CSPELL}:words alpha beta -->`, 1, []);
      const [directive] = repo.directives;
      const list = fakeList(repo, {
        file: 'a.md',
        list: 'directive',
        words: ['alpha', 'beta'],
        directive,
      });
      const elsewhere = fakeList(fakeRepo('/other'), {
        file: 'a.md',
        list: 'directive',
        directive,
      });
      const removals = [
        removal(list, 'Beta', { reason: 'why' }),
        removal(elsewhere, 'alpha'),
      ];
      expect(editedFiles(repo, removals)).toEqual(
        new Map([['a.md', `<!-- ${CSPELL}:words alpha      -->\ntext\n`]]),
      );
      expect(toChanges(removals.slice(0, 1), [])).toEqual([
        {
          repo: dir,
          file: 'a.md',
          action: 'remove',
          list: 'directive',
          words: [{ word: 'Beta', reason: 'why' }],
          line: 1,
          lineText: `<!-- ${CSPELL}:words alpha beta -->`,
        },
      ]);
    });
  });

  describe('applyLineEdits', () => {
    const lines = [
      '# Title',
      `<!-- ${CSPELL}:words alpha beta -->`,
      'Text',
      `<!-- ${CSPELL}:disable -->`,
      'skipped',
      `<!-- ${CSPELL}:enable -->`,
      '',
    ];
    const changes: Change[] = [
      {
        repo: '',
        file: 'a.md',
        action: 'remove',
        list: 'directive',
        words: [{ word: 'beta', reason: '' }],
        line: 2,
        lineText: `<!-- ${CSPELL}:words alpha beta -->`,
      },
      {
        repo: '',
        file: 'a.md',
        action: 'remove-disable',
        list: 'disable',
        words: [],
        line: 4,
        lineText: `<!-- ${CSPELL}:disable -->`,
        endLine: 6,
        endText: `<!-- ${CSPELL}:enable -->`,
      },
    ];

    it('edits directive lines and deletes the lines left with only comment syntax', () => {
      const file = write('a.md', lines.join('\n'));
      const failures: string[] = [];
      applyLineEdits(file, changes, failures);
      expect(readFileSync(file, 'utf8')).toBe(
        `# Title\n<!-- ${CSPELL}:words alpha -->\nText\nskipped\n`,
      );
      expect(failures).toEqual([]);
    });

    it('leaves a line that changed since the review', () => {
      const edited = lines.with(1, `<!-- ${CSPELL}:words alpha beta gamma -->`);
      const file = write('a.md', edited.join('\n'));
      const failures: string[] = [];
      applyLineEdits(file, changes.slice(0, 1), failures);
      expect(readFileSync(file, 'utf8')).toBe(edited.join('\n'));
      expect(failures).toEqual([
        `${file}:2 changed since the review. Edit it by hand.`,
      ]);
    });
  });

  describe('applyListEdits', () => {
    const change = (
      list: string,
      action: Change['action'],
      words: string[],
    ): Change => ({
      repo: '',
      file: '',
      action,
      list,
      words: words.map((word) => ({ word, reason: '' })),
    });

    it('removes and adds words in a JSON config', () => {
      const file = write(
        'cspell.json',
        '{"words": ["alpha", "beta"], "overrides": [{"filename": "*.md", "words": ["gamma"]}]}',
      );
      const changes = [
        change('words', 'remove', ['Beta']),
        change('words', 'add', ['delta']),
        change('overrides[0].words', 'remove', ['gamma']),
      ];
      const failures: string[] = [];
      expect(applyListEdits(file, changes, failures)).toBe(true);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
        words: ['alpha', 'delta'],
        overrides: [{ filename: '*.md', words: [] }],
      });
      expect(failures).toEqual([]);
    });

    it('removes lines from a dictionary file without regard to case', () => {
      const file = write('words.txt', 'Alpha\nbeta\n  gamma  \n');
      const changes = [change('dictionary', 'remove', ['alpha', 'GAMMA'])];
      expect(applyListEdits(file, changes, [])).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe('beta\n');
    });

    it('leaves a config with comments', () => {
      const text = '{\n  // keep\n  "words": ["alpha"]\n}\n';
      const file = write('cspell.json', text);
      const failures: string[] = [];
      expect(
        applyListEdits(file, [change('words', 'remove', ['alpha'])], failures),
      ).toBe(false);
      expect(readFileSync(file, 'utf8')).toBe(text);
      expect(failures).toEqual([
        `${file} has comments, which a rewrite would drop. Edit it by hand.`,
      ]);
    });
  });

  describe('apply', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const writePlan = (changes: Change[], decisions: Decision[] = []): string =>
      write(
        'plan.json',
        JSON.stringify({
          created: '',
          repos: [],
          changes,
          decisions,
          kept: [],
        }),
      );

    it('makes the moves of the accepted questions only', () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const shared = write('shared.json', '{"words": ["beta", "gamma"]}');
      const own = write('cspell.json', '{"words": ["alpha", "delta"]}');
      const decision = (word: string, accept: boolean): Decision => ({
        repo: dir,
        file: 'shared.json',
        word,
        question: '',
        accept,
        changes: [
          {
            repo: dir,
            file: 'cspell.json',
            action: 'add',
            list: 'words',
            words: [{ word, reason: '' }],
          },
          {
            repo: dir,
            file: 'shared.json',
            action: 'remove',
            list: 'words',
            words: [{ word, reason: '' }],
          },
        ],
      });
      apply(writePlan([], [decision('beta', true), decision('gamma', false)]));
      expect(JSON.parse(readFileSync(shared, 'utf8'))).toEqual({
        words: ['gamma'],
      });
      expect(JSON.parse(readFileSync(own, 'utf8'))).toEqual({
        words: ['alpha', 'beta', 'delta'],
      });
    });

    it('applies the changes due now and counts the ones left for after the release', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const config = write('cspell.json', '{"words": ["alpha", "beta"]}');
      const remove = (word: string): Change => ({
        repo: dir,
        file: 'cspell.json',
        action: 'remove',
        list: 'words',
        words: [{ word, reason: '' }],
      });
      apply(
        writePlan([remove('beta'), { ...remove('alpha'), afterRelease: true }]),
      );
      expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({
        words: ['alpha'],
      });
      expect(log.mock.calls).toEqual([
        [`Changed:\n- ${config}`],
        [
          'Left for after the release: 1 changes. Run the review again once each repository installs it.',
        ],
      ]);
    });

    it('says when there is nothing to change', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      apply(writePlan([]));
      expect(log).toHaveBeenCalledExactlyOnceWith('Nothing to change.');
    });
  });
});
