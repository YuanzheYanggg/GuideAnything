import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentRunTimeline } from './AgentRunTimeline';
import { createAgentRunState } from './useAgentRunStream';

describe('AgentRunTimeline', () => {
  it('shows a short-answer generation message for a DIRECT route without tasks', () => {
    render(<AgentRunTimeline state={{
      ...createAgentRunState(),
      planVersion: 1,
      route: 'DIRECT',
      status: 'RUNNING',
    }} />);

    expect(screen.getByText('正在生成简短回答…')).toBeVisible();
    expect(screen.queryByText('正在判断问题范围与最小检索路径…')).not.toBeInTheDocument();
  });

  it('keeps the routing message while no route or task has been selected', () => {
    render(<AgentRunTimeline state={{
      ...createAgentRunState(),
      planVersion: 1,
      status: 'ROUTING',
    }} />);

    expect(screen.getByText('正在判断问题范围与最小检索路径…')).toBeVisible();
  });
});
