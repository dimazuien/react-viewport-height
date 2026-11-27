import { useEffect, useSyncExternalStore } from 'react';

const VARIABLE_NAME = '--vh';

const getVh = () => Number((window.innerHeight * 0.01).toFixed(2));

// The server has no window, so server rendering and hydration see 0.
const getServerVh = () => 0;

const subscribe = (onResize: () => void) => {
  window.addEventListener('resize', onResize);

  return () => {
    window.removeEventListener('resize', onResize);
  };
};

let count = 0;

const useVH = (): number => {
  const vh = useSyncExternalStore(subscribe, getVh, getServerVh);

  useEffect(() => {
    document.documentElement.style.setProperty(VARIABLE_NAME, `${vh}px`);
  }, [vh]);

  useEffect(() => {
    count += 1;

    return () => {
      count -= 1;

      if (count === 0) {
        document.documentElement.style.removeProperty(VARIABLE_NAME);
      }
    };
  }, []);

  return vh;
};

export default useVH;
