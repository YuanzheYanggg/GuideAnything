import {
  AgentCommittedAnswerV1Schema,
  AgentInternalAnswerV1Schema,
  ArtifactV1Schema,
  CitationV1Schema,
  PublicFlowFeedbackV1Schema,
  PublicReferenceV1Schema,
  type AgentCommittedAnswerV1,
  type AgentInternalAnswerV1,
  type ArtifactV1,
  type PublicReferenceV1,
} from '@guideanything/contracts';

export interface CommitValidatedAnswerOptions {
  runId: string;
  createdAt: string;
  evidenceReferences: ReadonlyMap<string, PublicReferenceV1>;
  flowFeedbackReferences: readonly PublicReferenceV1[];
  createId: () => string;
}

export function commitValidatedAnswer(
  untrustedAnswer: AgentInternalAnswerV1,
  options: CommitValidatedAnswerOptions,
): AgentCommittedAnswerV1 {
  const answer = AgentInternalAnswerV1Schema.parse(untrustedAnswer);
  const evidenceById = new Map(answer.evidence.map((evidence) => [evidence.id, evidence]));
  for (const evidence of answer.evidence) {
    if (!options.evidenceReferences.has(evidence.id)) {
      throw new Error(`证据 ${evidence.id} 缺少后端验证结果`);
    }
  }
  if (options.evidenceReferences.size !== answer.evidence.length) {
    throw new Error('证据验证结果与当前答案不匹配');
  }
  if (options.flowFeedbackReferences.length !== answer.flowFeedback.length) {
    throw new Error('流程反馈验证结果与当前答案不匹配');
  }

  const citations = answer.evidence.map((evidence) => {
    const reference = PublicReferenceV1Schema.parse(options.evidenceReferences.get(evidence.id));
    return CitationV1Schema.parse({
      ...reference,
      source: evidence.source,
      title: evidence.title,
      excerpt: evidence.excerpt,
    });
  });
  const flowFeedback = answer.flowFeedback.map((feedback, index) => {
    const reference = PublicReferenceV1Schema.parse(options.flowFeedbackReferences[index]);
    return PublicFlowFeedbackV1Schema.parse({
      kind: feedback.kind,
      message: feedback.message,
      ...reference,
    });
  });

  const artifactIds = new Set<string>();
  const artifacts = answer.artifacts.map((artifact) => {
    const id = options.createId();
    if (artifactIds.has(id)) throw new Error('后端生成了重复的产物 ID');
    artifactIds.add(id);
    const base = {
      id,
      runId: options.runId,
      title: artifact.title,
      createdAt: options.createdAt,
    };
    let projected: ArtifactV1;
    if (artifact.kind === 'REFERENCE_COLLECTION') {
      projected = ArtifactV1Schema.parse({
        ...base,
        kind: artifact.kind,
        references: artifact.evidenceIds.map((evidenceId) => {
          const evidence = evidenceById.get(evidenceId);
          const reference = options.evidenceReferences.get(evidenceId);
          if (!evidence || !reference) throw new Error(`参考资料证据 ${evidenceId} 未通过验证`);
          return {
            ...PublicReferenceV1Schema.parse(reference),
            title: evidence.title,
            summary: evidence.excerpt,
          };
        }),
      });
    } else {
      projected = ArtifactV1Schema.parse({ ...base, ...artifact });
    }
    return projected;
  });

  const navigableEvidence = citations.filter((citation) => citation.href !== null).length;
  const evidenceStatus = navigableEvidence === 0
    && (answer.evidenceStatus === 'SUPPORTED' || answer.evidenceStatus === 'PARTIAL')
    ? 'INSUFFICIENT' as const
    : answer.evidenceStatus;
  return AgentCommittedAnswerV1Schema.parse({
    mode: answer.mode,
    conclusion: answer.conclusion,
    sections: answer.sections,
    evidenceStatus,
    citations,
    flowFeedback,
    artifacts,
    suggestedQuestions: answer.suggestedQuestions,
  });
}
