import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppearanceProvider, AppearanceToggle } from './AppearanceToggle';
import '../../styles.css';

describe('AppearanceToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('switches between light and dark appearances and persists the choice', async () => {
    const user = userEvent.setup();

    render(
      <AppearanceProvider initialAppearance="light">
        <AppearanceToggle />
      </AppearanceProvider>,
    );

    expect(screen.getByRole('group', { name: '外观' })).toHaveTextContent('浅色');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');

    await user.click(screen.getByRole('button', { name: '切换到深色' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('guideanything-appearance')).toBe('dark');
    expect(screen.getByRole('group', { name: '外观' })).toHaveTextContent('深色');
  });

  it('does not render a decorative control without an accessible name', () => {
    render(
      <AppearanceProvider initialAppearance="dark">
        <AppearanceToggle />
      </AppearanceProvider>,
    );

    expect(screen.getByRole('button', { name: '切换到浅色' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '外观' })).toBeInTheDocument();
  });

  it('updates editor shell colors when the appearance changes', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AppearanceProvider initialAppearance="light">
        <AppearanceToggle />
        <header className="editor-header">编辑器</header>
      </AppearanceProvider>,
    );

    const editorHeader = container.querySelector('.editor-header');
    expect(editorHeader).not.toBeNull();
    const editorHeaderRules = Array.from(document.styleSheets)
      .flatMap((styleSheet) => Array.from(styleSheet.cssRules))
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === '.editor-header');

    expect(editorHeaderRules).toHaveLength(1);
    expect(editorHeaderRules[0]!.style.getPropertyValue('background')).toBe('var(--ga-surface)');

    await user.click(screen.getByRole('button', { name: '切换到深色' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('keeps the hierarchy sidebar on a theme-aware surface', () => {
    const hierarchyRules = Array.from(document.styleSheets)
      .flatMap((styleSheet) => Array.from(styleSheet.cssRules))
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ':root[data-theme="dark"] .hierarchy-panel');

    expect(hierarchyRules).toHaveLength(1);
    expect(hierarchyRules[0]!.style.getPropertyValue('background')).toBe('var(--ga-surface-solid)');
  });
});
