import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SpotlightCard } from './SpotlightCard';

describe('SpotlightCard', () => {
  it('tracks the pointer position without changing its children', () => {
    render(<SpotlightCard spotlightColor="rgba(10, 132, 255, 0.2)"><span>摘要内容</span></SpotlightCard>);
    const card = screen.getByText('摘要内容').parentElement;
    expect(card).not.toBeNull();
    Object.defineProperty(card, 'getBoundingClientRect', { value: () => ({ left: 10, top: 20 }) });

    fireEvent.pointerMove(card!, { clientX: 42, clientY: 68 });

    expect(card).toHaveStyle({ '--mouse-x': '32px', '--mouse-y': '48px', '--spotlight-color': 'rgba(10, 132, 255, 0.2)' });
    expect(screen.getByText('摘要内容')).toBeVisible();
  });

  it('passes semantic attributes and caller pointer handlers through', () => {
    const onPointerMove = vi.fn();
    render(<SpotlightCard aria-label="聚光卡片" data-testid="spotlight-card" onPointerMove={onPointerMove}><span>内容</span></SpotlightCard>);

    const card = screen.getByTestId('spotlight-card');
    fireEvent.pointerMove(card, { clientX: 40, clientY: 50 });

    expect(card).toHaveAttribute('aria-label', '聚光卡片');
    expect(onPointerMove).toHaveBeenCalledTimes(1);
  });
});
