const config = {
  gitignore: true,
  ignores: [
    // .claude/skills links to .agents/skills, which is linted already.
    '.claude/skills/**',
    '**/CHANGELOG.md',
    // A pull request template starts with its first section, not a title.
    '.github/pull_request_template.md',
  ],
  config: {
    default: true,
    MD013: false,
    MD024: { siblings_only: false },
    MD033: { allowed_elements: ['br'] },
  },
};

export default config;
