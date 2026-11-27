# react-viewport-height

[![npm Version](https://img.shields.io/npm/v/react-viewport-height.svg)](https://www.npmjs.com/package/react-viewport-height)
![npm downloads per week](https://img.shields.io/npm/dw/react-viewport-height)
![Minified size](https://img.shields.io/bundlephobia/min/react-viewport-height)
[![Open issues](https://img.shields.io/github/issues-raw/dimazuien/react-viewport-height)](https://github.com/dimazuien/react-viewport-height/issues)
[![Open pull requests](https://img.shields.io/github/issues-pr-raw/dimazuien/react-viewport-height)](https://github.com/dimazuien/react-viewport-height/pulls)
[![GitHub Stars](https://img.shields.io/github/stars/dimazuien/react-viewport-height)](https://github.com/dimazuien/react-viewport-height/stargazers)
![CI status](https://img.shields.io/github/actions/workflow/status/dimazuien/react-viewport-height/ci.yml?branch=main&label=ci)
![Code scanning](https://img.shields.io/github/actions/workflow/status/dimazuien/react-viewport-height/codeql-analysis.yml?branch=main)

A React hook that returns the size of one `vh` unit, 1% of the browser's inner window height, and keeps it up to date when the window resizes.

The package is maintained, but for new code, prefer the standard alternatives:

- **To size elements**, use the CSS `dvh`, `svh`, and `lvh` units. They follow the actual viewport height on mobile browsers and are [widely supported](https://caniuse.com/viewport-unit-variants). [Read more about the new units.](https://web.dev/viewport-units/)
- **To use the height in JavaScript**, use `useWindowSize` from [usehooks-ts](https://usehooks-ts.com/react-hook/use-window-size) or [react-use](https://github.com/streamich/react-use/blob/master/docs/useWindowSize.md). Both return the window's inner width and height, so `useWindowSize().height / 100` is the value that `useVH` returns.

## Usage

```shell
npm install react-viewport-height
```

```jsx
import useVH from 'react-viewport-height';

const ROW_HEIGHT = 40;

const Rows = ({ items }) => {
  const vh = useVH();
  const rowsThatFit = Math.floor((100 * vh) / ROW_HEIGHT);

  return (
    <ul>
      {items.slice(0, rowsThatFit).map((item) => (
        <li key={item} style={{ height: ROW_HEIGHT }}>
          {item}
        </li>
      ))}
    </ul>
  );
};
```

Read [the documentation](https://github.com/dimazuien/react-viewport-height/blob/main/docs/index.md) for more details. You can also play with a [demo](https://codesandbox.io/s/react-viewport-height-90o4j).
