# Docs

## Installing

- npm:

```shell
npm install react-viewport-height
```

- yarn:

```shell
yarn add react-viewport-height
```

This package works only in versions of React that support hooks.

## Usage

`useVH`, a hook that you import from a package, adds a CSS custom property `--vh` with the value of 1% of `window.innerHeight` and returns it from the hook. If the window is resized, the hook updates `--vh` and `vh`.

There are 2 ways of setting an element's height. You can set it in css:

```jsx
// index.js
import useVH from 'react-viewport-height';
import './index.css';

const App = () => {
  useVH();

  return <div className="app" />;
};
```

```css
/* index.css */
.app {
  min-height: calc(var(--vh, 1vh) * 100);
}
```

Otherwise, you can set height in a component directly:

```jsx
import useVH from 'react-viewport-height';

const App = () => {
  const vh = useVH();

  return <div style={{ height: `${100 * vh}px` }} />;
};
```

An important note: If you decide to stick to the first way, you should know that if a component with the hook gets unmounted, `--vh` gets removed.
