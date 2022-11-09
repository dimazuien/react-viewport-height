import { useCallback, useLayoutEffect, useState } from 'react';

const VARIABLE_NAME = '--vh';

const getActualVh = () => Number((window.innerHeight * 0.01).toFixed(2));

let count = 0;

const useVH = (): number => {
  const [vh, setVh] = useState(0);
  const updateVh = useCallback(() => {
    const newVh = getActualVh();

    document.documentElement.style.setProperty(VARIABLE_NAME, `${newVh}px`);
    setVh(newVh);
  }, [setVh]);

  useLayoutEffect(() => {
    if (typeof window !== 'undefined') {
      count += 1;

      updateVh();

      window.addEventListener('resize', updateVh);
    }
    return () => {
      window.removeEventListener('resize', updateVh);

      count -= 1;

      if (count === 0) {
        document.documentElement.style.removeProperty(VARIABLE_NAME);
      }
    };
  }, [updateVh]);

  return vh;
};

export default useVH;
