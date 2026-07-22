import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnimatedList } from './AnimatedList';

describe('AnimatedList', () => {
  it('keeps menu semantics while assigning stable animation indexes', () => {
    render(<AnimatedList role="menu" ariaLabel="动作"><button role="menuitem" type="button">第一项</button><button role="menuitem" type="button">第二项</button></AnimatedList>);

    expect(screen.getByRole('menu', { name: '动作' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')[0]?.parentElement).toHaveClass('animated-list-item');
    expect(screen.getAllByRole('menuitem')[1]?.parentElement).toHaveStyle({ '--animated-list-index': '1' });
  });
});
