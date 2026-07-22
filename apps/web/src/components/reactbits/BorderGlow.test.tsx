import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BorderGlow } from './BorderGlow';

describe('BorderGlow', () => {
  it('marks an active accent surface without changing its child interaction', () => {
    render(<BorderGlow active tone="accent"><button type="button">保存</button></BorderGlow>);

    expect(screen.getByRole('button', { name: '保存' }).parentElement).toHaveClass('border-glow', 'is-active', 'border-glow-accent');
  });

  it('keeps a quiet surface inactive by default', () => {
    render(<BorderGlow><span>内容</span></BorderGlow>);

    expect(screen.getByText('内容').parentElement).toHaveClass('border-glow');
    expect(screen.getByText('内容').parentElement).not.toHaveClass('is-active');
  });
});
