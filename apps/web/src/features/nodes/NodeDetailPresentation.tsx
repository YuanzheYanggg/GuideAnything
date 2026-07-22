import { createContext, useContext, type ReactNode } from 'react';

export interface NodeDetailPresentationValue {
  enabled?: boolean;
  expandedNodeIds: ReadonlySet<string>;
  onOpenEditor: (nodeId: string, trigger: HTMLElement) => void;
  onToggleExpanded: (nodeId: string) => void;
}

const readOnlyPresentation: NodeDetailPresentationValue = {
  expandedNodeIds: new Set(),
  onOpenEditor: () => undefined,
  onToggleExpanded: () => undefined,
};

const NodeDetailPresentationContext = createContext<NodeDetailPresentationValue>(readOnlyPresentation);

export function NodeDetailPresentationProvider({ value, children }: { value: NodeDetailPresentationValue; children: ReactNode }) {
  return <NodeDetailPresentationContext.Provider value={value}>{children}</NodeDetailPresentationContext.Provider>;
}

export function useNodeDetailPresentation(): NodeDetailPresentationValue {
  return useContext(NodeDetailPresentationContext);
}
