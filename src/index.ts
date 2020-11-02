import { useCallback, useEffect } from 'react';

const useVH = (): void => {
  const setVH = useCallback(() => {
    const vh = window.innerHeight * 0.01;

    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }, []);

  useEffect(() => {
    window.addEventListener('resize', setVH);

    return (): void => {
      window.removeEventListener('resize', setVH);
    };
  }, [setVH]);

  useEffect(setVH, [setVH]);
};

export default useVH;
