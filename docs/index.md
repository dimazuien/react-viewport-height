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

- pnpm:

```shell
pnpm add react-viewport-height
```

It needs React 18 or 19.

## Usage

`useVH` returns 1% of `window.innerHeight` in pixels, the size of one `vh` unit. When the window resizes, the hook updates the value and re-renders the component. During server rendering and hydration, it returns `0`, because the server has no window.

Use the value in calculations that need the viewport height in JavaScript, for example to work out how many rows fit on the screen:

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

## Alternatives

The package is maintained, but for new code, prefer the standard alternatives:

- [`useWindowSize` from usehooks-ts](https://usehooks-ts.com/react-hook/use-window-size)
- [`useWindowSize` from react-use](https://github.com/streamich/react-use/blob/master/docs/useWindowSize.md)

Both return the window's inner width and height in pixels. To switch, replace `useVH()` with `useWindowSize().height / 100`, or use the height directly.

## Styling with CSS

To size an element to the viewport, use CSS instead of the hook. The `dvh` unit follows the actual viewport height as mobile browsers show and hide their address bar:

```css
.app {
  min-height: 100dvh;
}
```

The `svh` and `lvh` units use the smallest and the largest viewport height. [Read more about the new units.](https://web.dev/viewport-units/)

## The `--vh` custom property

The hook also sets a `--vh` CSS custom property to the same value, for browsers without the new units:

```jsx
import useVH from 'react-viewport-height';
import './index.css';

const App = () => {
  useVH();

  return <div className='app' />;
};
```

```css
/* index.css */
.app {
  min-height: calc(var(--vh, 1vh) * 100);
}
```

When the last component that uses the hook unmounts, the hook removes `--vh`.
