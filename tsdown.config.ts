import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2020',
  // CommonJS keeps `exports.default`, so `require('react-viewport-height').default` works as in 1.x.
  cjsDefault: false,
  dts: true,
  publint: true,
  attw: { profile: 'strict' },
});
