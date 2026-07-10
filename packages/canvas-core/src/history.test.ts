import { describe, expect, it } from 'vitest';

import { HistoryStack } from './history';

describe('HistoryStack', () => {
  it('supports bounded undo and redo without mutating snapshots', () => {
    const history = new HistoryStack({ value: 1 }, 2);
    history.push({ value: 2 });
    const lastInput = { value: 3 };
    history.push(lastInput);
    lastInput.value = 99;

    expect(history.undo()).toEqual({ value: 2 });
    expect(history.undo()).toEqual({ value: 1 });
    expect(history.undo()).toEqual({ value: 1 });
    expect(history.redo()).toEqual({ value: 2 });
    expect(history.redo()).toEqual({ value: 3 });
  });

  it('clears the redo branch after a new change', () => {
    const history = new HistoryStack('a');
    history.push('b');
    history.undo();
    history.push('c');

    expect(history.redo()).toBe('c');
  });
});
