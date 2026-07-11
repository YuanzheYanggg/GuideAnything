import type { CanvasNode } from '@guideanything/contracts';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { NodeChrome } from './NodeChrome';

export function MarkdownNodeView({ data }: { data: CanvasNode<'markdown'>['data'] }) {
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{data.markdown}</ReactMarkdown></div>;
}

export const MarkdownNode = memo(function MarkdownNode({ data, selected, width, height }: NodeProps) {
  return <NodeChrome selected={selected} tone="markdown" width={width} height={height}><span className="node-kicker">MARKDOWN</span><MarkdownNodeView data={data as CanvasNode<'markdown'>['data']} /></NodeChrome>;
});
