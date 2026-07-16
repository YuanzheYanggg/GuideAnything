import { describe, expect, it } from 'vitest';

import { StructuredAnswerPreviewDecoder } from './structured-answer-preview';

describe('StructuredAnswerPreviewDecoder', () => {
  it('streams only the top-level conclusion string across arbitrary JSON chunks', () => {
    const decoder = new StructuredAnswerPreviewDecoder();
    const chunks = [
      '{"mode":"ANSWER","concl',
      'usion":"先核对',
      '\\n流程，再查看 \\u82b1',
      '\\u5f0f纱证据。","sections":[]}',
    ];

    const deltas = chunks.map((chunk) => decoder.push(chunk)).filter(Boolean);

    expect(deltas.join('')).toBe('先核对\n流程，再查看 花式纱证据。');
    expect(decoder.finalize('先核对\n流程，再查看 花式纱证据。')).toBe('');
  });

  it('does not mistake a nested string for the top-level conclusion property', () => {
    const decoder = new StructuredAnswerPreviewDecoder();

    expect(decoder.push('{"sections":[{"markdown":"\\\"conclusion\\\":\\\"private\\\""}],'))
      .toBe('');
    expect(decoder.push('"mode":"ANSWER","conclusion":"公开结论","evidence":[]}'))
      .toBe('公开结论');
  });

  it('emits the unobserved suffix only after the validated final answer arrives', () => {
    const decoder = new StructuredAnswerPreviewDecoder();

    expect(decoder.push('{"mode":"ANSWER","conclusion":"已经看到的')).toBe('已经看到的');
    expect(decoder.finalize('已经看到的完整结论')).toBe('完整结论');
  });

  it('fails closed when the preview diverges from the validated answer or exceeds bounds', () => {
    const decoder = new StructuredAnswerPreviewDecoder();
    decoder.push('{"mode":"ANSWER","conclusion":"草稿');
    expect(() => decoder.finalize('不同答案')).toThrow(/不一致/u);

    const oversized = new StructuredAnswerPreviewDecoder(4);
    expect(() => oversized.push('{"conclusion":"12345')).toThrow(/长度/u);
  });
});
