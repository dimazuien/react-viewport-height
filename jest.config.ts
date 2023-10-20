const config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.{ts,tsx,js,jsx}'],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  coveragePathIgnorePatterns: ['src/index.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  reporters: ['default', 'jest-junit'],
};

export default config;
