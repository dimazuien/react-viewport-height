import { useCallback, useEffect, useState } from 'react';

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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      count += 1;

      // The first render returns 0 to match server rendering, so the window is read after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
