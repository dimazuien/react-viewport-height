# react-viewport-height

[![npm Version](https://img.shields.io/npm/v/react-viewport-height.svg?style=flat-square)](https://www.npmjs.com/package/react-viewport-height)

A utility for React to set 100vh equal to the actual browser inner window height.

Since `vh` has troubles on mobile browsers (primarily because of the address bar), there are several tricks to fix it. This package implements the one from [this article](https://css-tricks.com/the-trick-to-viewport-units-on-mobile/).

## Installation

```shell
npm install react-viewport-height
```

## Usage

Use the hook somewhere in the app.

```jsx
import useVH from "react-viewport-height";

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
