# GitHub Copilot Instructions

## Project Overview

This is a React hook library that provides a utility to set `100vh` equal to the actual browser inner window height, solving viewport height issues on mobile browsers.

## Tech Stack

- **Package manager**: npm
- **Language**: TypeScript
- **Framework**: React (hooks-based)
- **Build**: Webpack + npm-dts for type definitions
- **Testing**: Jest with React Testing Library
- **Linting**: ESLint with Airbnb config + TypeScript rules
- **Formatting**: Prettier
- **CI/CD**: Semantic Release with conventional commits, CircleCI for the main flow, GitHub Actions for code scanning and security

## Project Structure

```
src/
├── index.ts             # Main export file
├── useVH/
│   ├── index.ts         # Main hook implementation
│   └── index.test.tsx   # Comprehensive tests
└── setupTests.ts        # Jest setup
```

## Coding Conventions

- Use modern ES6+ syntax
- Use functional components with hooks
- Prefer arrow functions for components
- Use folder-based modules with index files for clean imports
- Keep main implementation and tests in the same folder
- Update documentation in the `docs` directory and `README.md` if necessary
- Use destructuring for props and imports
- Follow React hooks rules, best practices, and common conventions
