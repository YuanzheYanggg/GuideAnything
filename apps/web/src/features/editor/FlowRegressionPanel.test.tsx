import type {
  AgentRunSnapshotV1,
  WorkspaceFlowRegressionCaseV1,
} from '@guideanything/contracts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FlowRegressionPanel, type FlowRegressionEditorApi } from './FlowRegressionPanel';

describe('FlowRegressionPanel', () => {
  it('keeps a guide-scoped regression list compact while exposing only replay, real trial, and archive', async () => {
    const user = userEvent.setup();
    const api = regressionApi();
    render(<FlowRegressionPanel
      guideId="guide-1"
      api={api}
      annotationTitle={(item) => item.annotationId === 'version-type' ? '版类型' : item.annotationId}
    />);

    const summary = await screen.findByText('回归题（1）');
    await user.click(summary);
    expect(summary.closest('details')?.querySelector('.border-glow')).not.toBeNull();

    expect(screen.getByText('版类型')).toBeVisible();
    expect(screen.getByText('打样流程里版类型应该怎么设置？')).toBeVisible();
    expect(screen.getByRole('button', { name: '确定性复跑' })).toBeVisible();
    expect(screen.getByRole('button', { name: '真实试跑' })).toBeVisible();
    expect(screen.getByRole('button', { name: '归档' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: '确定性复跑' }));
    expect(api.replayFlowRegressionCase).toHaveBeenCalledWith('guide-1', 'case-version-type');
    expect(await screen.findByText('确定性：通过')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '真实试跑' }));
    expect(api.createFlowRegressionRealRun).toHaveBeenCalledWith('guide-1', 'case-version-type');
    expect(await screen.findByText('已提交真实试跑')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '归档' }));
    expect(api.archiveFlowRegressionCase).toHaveBeenCalledWith('guide-1', 'case-version-type');
    expect(await screen.findByText('已归档')).toBeVisible();
  });

  it('renders health issues as a compact warning without creating a separate QA page', async () => {
    const api = regressionApi({
      getFlowAnnotationHealth: vi.fn().mockResolvedValue({
        snapshotId: 'snapshot-1',
        issues: [{ resourceNodeId: 'image-1', annotationId: 'version-type', code: 'ANNOTATION_NOT_RANKED' }],
      }),
    });
    render(<FlowRegressionPanel guideId="guide-1" api={api} annotationTitle={() => '版类型'} />);

    await userEvent.setup().click(await screen.findByText('回归题（1）'));

    expect(await screen.findByText('标注健康检查异常')).toBeVisible();
    expect(screen.getByText('版类型 · ANNOTATION_NOT_RANKED')).toBeVisible();
  });
});

type RegressionApiMock = FlowRegressionEditorApi & {
  listFlowRegressionCases: ReturnType<typeof vi.fn>;
  replayFlowRegressionCase: ReturnType<typeof vi.fn>;
  archiveFlowRegressionCase: ReturnType<typeof vi.fn>;
  createFlowRegressionRealRun: ReturnType<typeof vi.fn>;
  getFlowAnnotationHealth: ReturnType<typeof vi.fn>;
};

function regressionApi(overrides: Partial<RegressionApiMock> = {}): RegressionApiMock {
  const item = regressionCase();
  return {
    listFlowRegressionCases: vi.fn().mockResolvedValue([item]),
    replayFlowRegressionCase: vi.fn().mockResolvedValue({ ...item, lastRetrievalVerification: 'PASS', lastVerifiedSnapshotId: 'snapshot-1' }),
    archiveFlowRegressionCase: vi.fn().mockResolvedValue({ ...item, status: 'ARCHIVED' }),
    createFlowRegressionRealRun: vi.fn().mockResolvedValue(agentRun()),
    getFlowAnnotationHealth: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-1', issues: [] }),
    ...overrides,
  } as RegressionApiMock;
}

function regressionCase(): WorkspaceFlowRegressionCaseV1 {
  return {
    id: 'case-version-type',
    guideId: 'guide-1',
    resourceNodeId: 'image-1',
    annotationId: 'version-type',
    question: '打样流程里版类型应该怎么设置？',
    expectedAgentStatus: 'SUPPORTED',
    status: 'ACTIVE',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    lastVerifiedSnapshotId: null,
    lastRetrievalVerification: null,
    lastAgentVerification: null,
  };
}

function agentRun(): AgentRunSnapshotV1 {
  return {
    id: 'run-real-trial',
    conversationId: 'conversation-real-trial',
    initiatingMessageId: 'message-real-trial',
    runSequence: 1,
    planVersion: 1,
    route: null,
    status: 'QUEUED',
    sources: { workspaceFlows: true, workspaceDocuments: false, sessionAttachments: false, santexwell: false },
    lastEventSequence: 0,
    createdAt: '2026-07-21T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    updatedAt: '2026-07-21T00:00:00.000Z',
    error: null,
  };
}
