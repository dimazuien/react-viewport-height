// eslint-disable-next-line import/no-unresolved
import { Meta, Story } from '@storybook/react/types-6-0';
import React from 'react';
import DemoComponent from './Demo';

export default {
  title: 'Demo',
  component: DemoComponent,
  parameters: {
    docs: {
      page: null,
    },
  },
} as Meta;

const Template: Story = () => <DemoComponent />;

export const Demo = Template.bind({});
Demo.storyName = 'Demo';
