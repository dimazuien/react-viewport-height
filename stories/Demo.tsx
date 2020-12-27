import React, { FC } from 'react';
import useVH from '../src/useVH';
import './Demo.css';

const Demo: FC = () => {
  useVH();

  return (
    <div className="container">
      <div className="vh">vh</div>
      <div className="--vh">
        --vh
        <br />* to see the difference watch this demo on a mobile browser in a
        full screen mode
      </div>
    </div>
  );
};

export default Demo;
