import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['**/*.test.{js,jsx,ts,tsx,cjs,mjs,cts,mts}'],
    // .claude/skills links to .agents/skills, whose tests already run.
    exclude: [...configDefaults.exclude, '.claude/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    reporters: ['default', 'junit'],
    outputFile: { junit: 'junit.xml' },
    coverage: {
      provider: 'istanbul',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', 'src/index.ts'],
      thresholds: { 100: true },
    },
  },
});
