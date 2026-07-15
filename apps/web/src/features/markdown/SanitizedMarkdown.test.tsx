import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SanitizedMarkdown } from './SanitizedMarkdown';

describe('SanitizedMarkdown', () => {
  it('never renders remote or protocol-relative images', () => {
    const { container } = render(<SanitizedMarkdown>{[
      '![remote](https://tracker.example/pixel)',
      '![protocol relative](//tracker.example/pixel)',
      '![internal](/media/diagram.png)',
    ].join('\n\n')}</SanitizedMarkdown>);

    expect(screen.queryByRole('img', { name: 'remote' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'protocol relative' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'internal' })).toHaveAttribute('src', '/media/diagram.png');
    expect(container.innerHTML).not.toContain('tracker.example');
  });
});
