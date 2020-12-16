# react-viewport-height

[![npm Version](https://img.shields.io/npm/v/react-viewport-height.svg)](https://www.npmjs.com/package/react-viewport-height)
![npm downloads per week](https://img.shields.io/npm/dw/react-viewport-height)
![Minified size](https://img.shields.io/bundlephobia/min/react-viewport-height)
[![Open issues](https://img.shields.io/github/issues-raw/dimazuien/react-viewport-height)](https://github.com/dimazuien/react-viewport-height/issues)
[![Open pull requests](https://img.shields.io/github/issues-pr-raw/dimazuien/react-viewport-height)](https://github.com/dimazuien/react-viewport-height/pulls)
[![GitHub Stars](https://img.shields.io/github/stars/dimazuien/react-viewport-height)](https://github.com/dimazuien/react-viewport-height/stargazers)
![CircleCI status](https://img.shields.io/circleci/build/github/dimazuien/react-viewport-height/main?label=circleci)
![Code scanning](https://img.shields.io/github/workflow/status/dimazuien/react-viewport-height/CodeQL?label=code%20scanning)

A utility for React to set 100vh equal to the actual browser inner window height.

Since `vh` has troubles on mobile browsers (primarily because of the address bar), there are several tricks to fix it. This package implements the one from [this article](https://css-tricks.com/the-trick-to-viewport-units-on-mobile/).

## Installation

```shell
npm install react-viewport-height
```

## Usage

Use the hook somewhere in the app.

```jsx
import useVH from 'react-viewport-height';

const App = () => {
  useVH();

  return <App />;
};
```

And then you can use `--vh` variable in your css.

```css
/* fallback for browsers that don't support CSS custom properties */
.app {
  min-height: 100vh;
  min-height: calc(var(--vh, 1vh) * 100);
}
```

This package works only in versions of React that support hooks.

## Support

If you like this package and want to support it, you can fund us on [Patreon](https://www.patreon.com/dimazuien)
