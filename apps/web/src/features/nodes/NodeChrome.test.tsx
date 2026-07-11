import { describe, expect, it } from 'vitest';

import { nodeChromeStyle } from './NodeChrome';

describe('nodeChromeStyle', () => {
  it('fills a React Flow node that has explicit resized dimensions', () => {
    expect(nodeChromeStyle(1060, 748)).toEqual({ width: '100%', height: '100%' });
  });

  it('leaves an unmeasured node at its default CSS dimensions', () => {
    expect(nodeChromeStyle(undefined, undefined)).toEqual({});
  });
});
