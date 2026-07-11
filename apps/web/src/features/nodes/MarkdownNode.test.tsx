import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownNodeView } from './MarkdownNode';

describe('MarkdownNodeView', () => {
  it('renders common Markdown and removes unsafe HTML and URL protocols', () => {
    const { container } = render(<MarkdownNodeView data={{ markdown: '# 字段规则\n- 必填\n<script>alert(1)</script>\n[危险](javascript:alert(1))' }} />);

    expect(screen.getByRole('heading', { name: '字段规则' })).toBeVisible();
    expect(screen.getByText('必填')).toBeVisible();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('危险').closest('a')).not.toHaveAttribute('href');
  });
});
