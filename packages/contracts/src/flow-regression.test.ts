import { describe, expect, it } from 'vitest';

import {
  AgentRetrievalDiagnosticV1Schema,
  FlowAnnotationHealthV1Schema,
  FlowAnnotationHealthIssueV1Schema,
  FlowRegressionReferenceEligibilityV1Schema,
  FlowRegressionCaseListV1Schema,
  UpdateFlowRegressionCaseStatusRequestV1Schema,
  WorkspaceFlowRegressionCaseV1Schema,
} from './flow-regression';

describe('flow regression contracts', () => {
  it('keeps a regression case bound to a stable annotation target instead of an index fragment', () => {
    const value = WorkspaceFlowRegressionCaseV1Schema.parse({
      id: 'case-1',
      guideId: 'guide-1',
      resourceNodeId: 'image-resource-1',
      annotationId: 'version-type',
      question: '打样流程中版类型应该怎么设置？',
      expectedAgentStatus: 'SUPPORTED',
      status: 'ACTIVE',
      createdAt: '2026-07-21T12:00:00.000Z',
      updatedAt: '2026-07-21T12:00:00.000Z',
      lastVerifiedSnapshotId: null,
      lastRetrievalVerification: null,
      lastAgentVerification: null,
    });

    expect(value).not.toHaveProperty('fragmentId');
    expect(value).toMatchObject({ resourceNodeId: 'image-resource-1', annotationId: 'version-type' });
  });

  it('bounds health and diagnostic records to deterministic metadata', () => {
    expect(FlowAnnotationHealthIssueV1Schema.parse({
      resourceNodeId: 'image-resource-1',
      annotationId: 'version-type',
      code: 'ANNOTATION_NOT_RANKED',
    })).toEqual({
      resourceNodeId: 'image-resource-1',
      annotationId: 'version-type',
      code: 'ANNOTATION_NOT_RANKED',
    });
    expect(AgentRetrievalDiagnosticV1Schema.parse({
      id: 'diagnostic-1',
      runId: 'run-1',
      guideId: 'guide-1',
      queryFingerprint: 'a'.repeat(64),
      reasonCode: 'TARGET_NOT_RANKED',
      candidates: [{ fragmentId: 'fragment-1', projection: 'IMAGE_ANNOTATION', rank: 1, selected: true }],
      closure: [{ id: 'image-resource-1', kind: 'RESOURCE' }],
      createdAt: '2026-07-21T12:00:00.000Z',
      expiresAt: '2026-08-20T12:00:00.000Z',
    })).not.toHaveProperty('question');
  });

  it('exposes compact editor-facing eligibility, health, and archive contracts', () => {
    expect(FlowRegressionReferenceEligibilityV1Schema.parse({
      eligible: true,
      guideId: 'guide-1',
      resourceNodeId: 'image-resource-1',
      annotationId: 'version-type',
      expectedAgentStatus: 'SUPPORTED',
    })).toMatchObject({ eligible: true, expectedAgentStatus: 'SUPPORTED' });
    expect(FlowAnnotationHealthV1Schema.parse({
      snapshotId: 'snapshot-1',
      issues: [{
        resourceNodeId: 'image-resource-1', annotationId: 'version-type', code: 'ANNOTATION_NOT_RANKED',
      }],
    }).issues).toHaveLength(1);
    expect(UpdateFlowRegressionCaseStatusRequestV1Schema.parse({ status: 'ARCHIVED' }))
      .toEqual({ status: 'ARCHIVED' });
    expect(FlowRegressionCaseListV1Schema.parse({ items: [] })).toEqual({ items: [] });
  });
});
