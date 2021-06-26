import '@testing-library/jest-dom/extend-expect';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { FC, useState } from 'react';
import useVH from '../src/useVH';

describe('useVH', () => {
  it('should set custom CSS property "--vh" that equals to one hundredth of inner height', () => {
    const vh = String(window.innerHeight / 100);
    const App: FC = () => {
      useVH();

      return <div>Hello, world</div>;
    };

    render(<App />);

    expect(document.documentElement.style.getPropertyValue('--vh')).toEqual(
      `${vh}px`,
    );
  });

  it('should return "vh" value', () => {
    const vh = String(window.innerHeight / 100);
    const App: FC = () => {
      const appVh = useVH();

      return <div>{appVh}</div>;
    };

    const { baseElement } = render(<App />);

    expect(baseElement).toHaveTextContent(vh);
  });

  it('should update "vh" value if a window is resized', () => {
    const newHeight = 500;
    const newVh = String(newHeight / 100);
    const App: FC = () => {
      const vh = useVH();

      return <div data-testid="container">{vh}</div>;
    };

    render(<App />);

    act(() => {
      Object.assign(window, { innerHeight: newHeight });

      fireEvent(window, new Event('resize'));
    });

    expect(document.documentElement.style.getPropertyValue('--vh')).toEqual(
      `${newVh}px`,
    );
    expect(screen.getByTestId('container')).toHaveTextContent(newVh);
  });

  it('should work with multiple instances', () => {
    const newHeight = 500;
    const newVh = String(newHeight / 100);
    const App: FC = () => {
      const vh1 = useVH();
      const vh2 = useVH();
      const vh3 = useVH();

      return (
        <>
          <div data-testid="container1">{vh1}</div>
          <div data-testid="container2">{vh2}</div>
          <div data-testid="container3">{vh3}</div>
        </>
      );
    };

    render(<App />);

    act(() => {
      Object.assign(window, { innerHeight: newHeight });

      fireEvent(window, new Event('resize'));
    });

    expect(document.documentElement.style.getPropertyValue('--vh')).toEqual(
      `${newVh}px`,
    );
    expect(screen.getByTestId('container1')).toHaveTextContent(newVh);
    expect(screen.getByTestId('container2')).toHaveTextContent(newVh);
    expect(screen.getByTestId('container3')).toHaveTextContent(newVh);
  });

  it('should remove custom CSS property "--vh" if all components with the hook get unmounted', async () => {
    const vh = String(window.innerHeight / 100);
    const Child1: FC = () => {
      useVH();

      return <div>Hello, world 1!</div>;
    };
    const Child2: FC = () => {
      useVH();

      return <div>Hello, world 3!</div>;
    };
    const App: FC = () => {
      const [child1Shown, setChild1Shown] = useState(true);
      const [child2Shown, setChild2Shown] = useState(true);

      return (
        <>
          <button type="button" onClick={() => setChild1Shown(false)}>
            Hide child 1
          </button>
          <button type="button" onClick={() => setChild2Shown(false)}>
            Hide child 2
          </button>
          {child1Shown && <Child1 />}
          {child2Shown && <Child2 />}
        </>
      );
    };

    render(<App />);

    expect(document.documentElement.style.getPropertyValue('--vh')).toEqual(
      `${vh}px`,
    );

    userEvent.click(screen.getByRole('button', { name: 'Hide child 1' }));

    expect(document.documentElement.style.getPropertyValue('--vh')).toEqual(
      `${vh}px`,
    );

    userEvent.click(screen.getByRole('button', { name: 'Hide child 2' }));

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--vh')).toEqual(
        '',
      ),
    );
  });
});
