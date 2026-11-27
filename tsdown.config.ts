import browserslist from 'browserslist';
import { defineConfig } from 'tsdown';

// The tsdown name for each browser that Baseline covers.
const TARGET_NAMES: Record<string, string> = {
  and_chr: 'chrome',
  and_ff: 'firefox',
  chrome: 'chrome',
  edge: 'edge',
  firefox: 'firefox',
  ios_saf: 'ios',
  safari: 'safari',
};

// The oldest version of each browser that Baseline lists as widely available, such as `chrome125`,
// so the syntax floor matches the features ESLint allows and moves forward with Baseline.
const getBaselineTargets = () => {
  const oldest = new Map<string, number>();

  for (const entry of browserslist('baseline widely available')) {
    const [browser, versions] = entry.split(' ');
    const name = TARGET_NAMES[browser];
    const version = Number.parseFloat(versions);
    const current = oldest.get(name);

    if (name && (current === undefined || version < current)) {
      oldest.set(name, version);
    }
  }

  return [...oldest].map(([name, version]) => `${name}${version}`);
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: getBaselineTargets(),
  // CommonJS keeps `exports.default`, so `require('react-viewport-height').default` works as in 1.x.
  cjsDefault: false,
  dts: true,
  publint: true,
  attw: { profile: 'strict' },
});
