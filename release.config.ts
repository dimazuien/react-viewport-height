// TRACK: Move conventional-changelog-conventionalcommits from 9.3.1 to 10 when the release-notes
// generator ships conventional-changelog-writer 9:
// https://github.com/semantic-release/release-notes-generator/issues/1027
const changelogPreset = { preset: 'conventionalcommits' };

// TRACK: Move semantic-release from 25 to 26 when its plugins leave prerelease: 26 loads beta
// versions of @semantic-release/commit-analyzer 14, release-notes-generator 15, and npm 14.

const config = {
  branches: ['main'],
  plugins: [
    ['@semantic-release/commit-analyzer', changelogPreset],
    ['@semantic-release/release-notes-generator', changelogPreset],
    '@semantic-release/changelog',
    '@semantic-release/npm',
    [
      '@semantic-release/exec',
      { prepareCmd: 'pnpm exec prettier CHANGELOG.md package.json --write' },
    ],
    [
      '@semantic-release/git',
      {
        // `[skip ci]` keeps the release commit from starting another workflow run.
        message:
          'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    '@semantic-release/github',
  ],
};

export default config;
