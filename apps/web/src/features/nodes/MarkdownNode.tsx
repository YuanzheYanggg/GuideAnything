import type { CanvasNode } from '@guideanything/contracts';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { NodeChrome } from './NodeChrome';
import { InlineNodeTextEditor } from './InlineNodeTextEditor';

export function MarkdownNodeView({ data }: { data: CanvasNode<'markdown'>['data'] }) {
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{data.markdown}</ReactMarkdown></div>;
}

export const MarkdownNode = memo(function MarkdownNode({ id, data, selected, width, height }: NodeProps) {
  const value = data as CanvasNode<'markdown'>['data'];
  return <NodeChrome nodeId={id} selected={selected} tone="markdown" width={width} height={height}><span className="node-kicker">MARKDOWN</span><InlineNodeTextEditor nodeId={id} field="markdown" value={value.markdown} label="Markdown 内容" multiline><MarkdownNodeView data={value} /></InlineNodeTextEditor></NodeChrome>;
});
