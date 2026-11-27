import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderToString } from 'react-dom/server';

import useVH from '.';

const getDocumentVh = () =>
  document.documentElement.style.getPropertyValue('--vh');

const Child = () => {
  useVH();

  return null;
};

describe('useVH', () => {
  const user = userEvent.setup();

  it('should return 0 when rendering on the server', () => {
    const App = () => String(useVH());

    expect(renderToString(<App />)).toBe('0');
  });

  it('should set custom CSS property "--vh" that equals to one hundredth of the inner window height', () => {
    const vh = window.innerHeight / 100;

    renderHook(useVH);

    expect(getDocumentVh()).toBe(`${vh}px`);
  });

  it('should return "vh" value', () => {
    const vh = window.innerHeight / 100;

    const { result } = renderHook(useVH);

    expect(result.current).toBe(vh);
  });

  it('should update "vh" value if a window is resized', () => {
    const newHeight = 500;
    const newVh = newHeight / 100;

    const { result } = renderHook(useVH);

    act(() => {
      window.innerHeight = newHeight;
    });

    fireEvent(window, new Event('resize'));

    expect(getDocumentVh()).toBe(`${newVh}px`);
    expect(result.current).toBe(newVh);
  });

  it('should work with multiple instances', () => {
    const newHeight = 500;
    const newVh = String(newHeight / 100);
    const App = () => {
      const vh1 = useVH();
      const vh2 = useVH();
      const vh3 = useVH();

      return `${vh1} ${vh2} ${vh3}`;
    };

    render(<App />);

    act(() => {
      window.innerHeight = newHeight;
    });

    fireEvent(window, new Event('resize'));

    expect(getDocumentVh()).toBe(`${newVh}px`);
    expect(document.body).toHaveTextContent(`${newVh} ${newVh} ${newVh}`);
  });

  it('should not remove custom CSS property "--vh" if the component with the hook gets unmounted but there are others mounted', async () => {
    const vh = window.innerHeight / 100;
    const App = () => {
      const [child1Shown, setChild1Shown] = useState(true);

      return (
        <>
          <button
            type='button'
            onClick={() => {
              setChild1Shown(false);
            }}
          >
            Hide child 1
          </button>
          {child1Shown && <Child />}
          <Child />
        </>
      );
    };

    render(<App />);

    await user.click(screen.getByRole('button'));

    expect(getDocumentVh()).toBe(`${vh}px`);
  });

  it('should remove custom CSS property "--vh" if all components with the hook get unmounted', async () => {
    const App = () => {
      const [child1Shown, setChild1Shown] = useState(true);
      const [child2Shown, setChild2Shown] = useState(true);

      return (
        <>
          <button
            type='button'
            onClick={() => {
              setChild1Shown(false);
            }}
          >
            Hide child 1
          </button>
          <button
            type='button'
            onClick={() => {
              setChild2Shown(false);
            }}
          >
            Hide child 2
          </button>
          {child1Shown && <Child />}
          {child2Shown && <Child />}
        </>
      );
    };

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Hide child 1' }));
    await user.click(screen.getByRole('button', { name: 'Hide child 2' }));

    expect(getDocumentVh()).toBe('');
  });
});
