import { useEffect } from 'react';

const VARIABLE_NAME = '--vh';

const calculateVH = () =>
  // window check for server-side rendering
  typeof window !== 'undefined' ? window.innerHeight * 0.01 : 0;

const isVHSet = () =>
  getComputedStyle(document.documentElement).getPropertyValue(VARIABLE_NAME) !==
  '';

const setVH = () => {
  document.documentElement.style.setProperty(
    VARIABLE_NAME,
    `${calculateVH()}px`,
  );
};

const removeVH = () => {
  document.documentElement.style.removeProperty(VARIABLE_NAME);
};

const useVH = (): number => {
  useEffect(() => {
    if (isVHSet()) return () => undefined;

    setVH();

    window.addEventListener('resize', setVH);

    return () => {
      window.removeEventListener('resize', setVH);

      removeVH();
    };
  }, []);

  return calculateVH();
};

export default useVH;
