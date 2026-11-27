const config = {
  '*': ['cspell lint --no-progress --no-must-find-files'],
  '*.{js,jsx,ts,tsx,cjs,mjs,cts,mts}': [
    'eslint --max-warnings=0 --fix',
    'prettier --write',
    'vitest related --run',
  ],
  '*.{css,json,jsonc,yml,yaml,md,mdx}': ['prettier --write'],
};

export default config;
