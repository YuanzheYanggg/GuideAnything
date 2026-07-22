import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type RefObject } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChatCircleDots,
  FileText,
  FlowArrow,
  GlobeHemisphereWest,
  PaperPlaneTilt,
  Paperclip,
  Plus,
  SlidersHorizontal,
  Stop,
} from '@phosphor-icons/react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';

import { appendSafeReturnTo, safeInternalPath } from '../../lib/navigation';
import { ArtifactViewer } from '../artifacts/ArtifactViewer';
import { SanitizedMarkdown } from '../markdown/SanitizedMarkdown';
import { AgentRunTimeline } from './AgentRunTimeline';
import type { AgentApi, ConversationDetailV1, ConversationSummaryV1, SourceOptionsV1 } from './types';
import { useAgentRunStream } from './useAgentRunStream';

type ConversationScope = { kind: 'GLOBAL' } | { kind: 'WORKSPACE'; workspaceId: string };

const globalSources: SourceOptionsV1 = {
  workspaceFlows: false,
  workspaceDocuments: false,
  sessionAttachments: false,
  santexwell: true,
};
const workspaceDefaultSources: SourceOptionsV1 = {
  workspaceFlows: true,
  workspaceDocuments: true,
  sessionAttachments: false,
  santexwell: true,
};

export function AgentConversationPanel({
  api,
  scope,
}: {
  api: AgentApi;
  scope: ConversationScope;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [conversations, setConversations] = useState<ConversationSummaryV1[]>([]);
  const [detail, setDetail] = useState<ConversationDetailV1 | null>(null);
  const [text, setText] = useState('');
  const [sources, setSources] = useState<SourceOptionsV1>(scope.kind === 'GLOBAL' ? globalSources : workspaceDefaultSources);
  const [eventsPath, setEventsPath] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [steering, setSteering] = useState(false);
  const [steerPending, setSteerPending] = useState(false);
  const [steerText, setSteerText] = useState('');
  const [uploading, setUploading] = useState(false);
  const conversationParam = searchParams.get('conversation');
  const conversationId = conversationParam && conversationParam !== 'new' ? conversationParam : null;
  const targetMessageRequested = searchParams.has('message');
  const targetMessageId = readLocatorParam(searchParams.get('message'));
  const returnTo = safeInternalPath(searchParams.get('returnTo'));
  const currentPath = `${location.pathname}${location.search}`;
  const workspaceId = scope.kind === 'WORKSPACE' ? scope.workspaceId : null;
  const conversationContextKey = conversationId ? createConversationContextKey(scope, conversationId) : null;
  const activeConversationContextRef = useRef<string | null>(conversationContextKey);
  const attachmentContextKey = workspaceId && conversationId
    ? createAttachmentContextKey(workspaceId, conversationId)
    : null;
  const activeAttachmentContextRef = useRef<string | null>(attachmentContextKey);
  const targetMessageRef = useRef<HTMLElement>(null);
  const focusedMessageKeyRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(!targetMessageId);
  const [attachmentSelection, setAttachmentSelection] = useState<{ contextKey: string | null; ids: string[] }>({
    contextKey: attachmentContextKey,
    ids: [],
  });
  const selectedAttachmentIds = attachmentSelection.contextKey === attachmentContextKey
    ? attachmentSelection.ids
    : [];
  const effectiveSources: SourceOptionsV1 = {
    ...sources,
    sessionAttachments: selectedAttachmentIds.length > 0,
  };
  const streamRun = useCallback((path: string, options: { afterSequence?: number; signal: AbortSignal }) => api.streamRun(path, options), [api]);
  const runState = useAgentRunStream(eventsPath, streamRun);

  const list = useCallback(() => scope.kind === 'GLOBAL'
    ? api.listGlobal()
    : api.listWorkspace(scope.workspaceId), [api, scope.kind, workspaceId]);
  const read = useCallback((id: string) => scope.kind === 'GLOBAL'
    ? api.getGlobal(id)
    : api.getWorkspace(scope.workspaceId, id), [api, scope.kind, workspaceId]);

  useEffect(() => {
    let active = true;
    list().then((items) => { if (active) setConversations(items); }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '会话列表载入失败');
    });
    return () => { active = false; };
  }, [list]);

  useEffect(() => {
    activeConversationContextRef.current = conversationContextKey;
    return () => {
      if (activeConversationContextRef.current === conversationContextKey) {
        activeConversationContextRef.current = null;
      }
    };
  }, [conversationContextKey]);

  useEffect(() => {
    activeAttachmentContextRef.current = attachmentContextKey;
    setAttachmentSelection((current) => current.contextKey === attachmentContextKey
      ? current
      : { contextKey: attachmentContextKey, ids: [] });
    setSources((current) => ({ ...current, sessionAttachments: false }));
    return () => {
      if (activeAttachmentContextRef.current === attachmentContextKey) {
        activeAttachmentContextRef.current = null;
      }
    };
  }, [attachmentContextKey]);

  useEffect(() => {
    setText('');
    if (!conversationId) {
      setDetail(null);
      setEventsPath(null);
      return;
    }
    let active = true;
    setError('');
    setDetail(null);
    setEventsPath(null);
    read(conversationId).then((next) => {
      if (!active) return;
      setDetail((current) => current?.conversation.id === next.conversation.id
        ? {
            ...next,
            messages: mergeConversationMessages(next.messages, current.messages),
            attachments: mergeAttachments(next.attachments, current.attachments),
          }
        : next);
      const latest = next.latestRun;
      if (latest && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(latest.status)) {
        setEventsPath(`/agent-runs/${encodeURIComponent(latest.id)}/events`);
      } else {
        setEventsPath(null);
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '会话载入失败');
    });
    return () => { active = false; };
  }, [conversationId, read]);

  const activeRunId = detail?.latestRun?.id ?? null;
  const runActive = eventsPath !== null && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(runState.status);
  const messages = detail?.messages ?? [];
  const targetMessageFound = Boolean(targetMessageId && messages.some((message) => message.id === targetMessageId));
  const targetMessageKey = conversationId && targetMessageId ? `${conversationId}:${targetMessageId}` : null;

  useEffect(() => {
    if (
      runState.status !== 'COMPLETED'
      || !runState.runId
      || !runState.answer
      || !runState.committedMessageId
      || !runState.committedAt
    ) return;
    setDetail((current) => {
      if (
        !current
        || current.latestRun?.id !== runState.runId
        || current.messages.some((message) => message.role === 'ASSISTANT' && message.runId === runState.runId)
      ) return current;
      return {
        ...current,
        messages: [...current.messages, {
          id: runState.committedMessageId!,
          role: 'ASSISTANT',
          runId: runState.runId!,
          answer: runState.answer!,
          createdAt: runState.committedAt!,
        }],
      };
    });
  }, [runState.answer, runState.committedAt, runState.committedMessageId, runState.runId, runState.status]);

  useLayoutEffect(() => {
    followOutputRef.current = !targetMessageKey;
  }, [targetMessageKey]);

  useLayoutEffect(() => {
    const viewport = messageListRef.current;
    if (!viewport || !followOutputRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages.length, runState.lastSequence]);

  useEffect(() => {
    if (!targetMessageKey || !targetMessageFound || focusedMessageKeyRef.current === targetMessageKey) return;
    const target = targetMessageRef.current;
    if (!target) return;
    focusedMessageKeyRef.current = targetMessageKey;
    followOutputRef.current = false;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'center' });
  }, [targetMessageFound, targetMessageKey]);

  const selectConversation = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('conversation', id);
    else next.set('conversation', 'new');
    next.delete('message');
    const nextContextKey = workspaceId && id ? createAttachmentContextKey(workspaceId, id) : null;
    activeConversationContextRef.current = id ? createConversationContextKey(scope, id) : null;
    activeAttachmentContextRef.current = nextContextKey;
    setAttachmentSelection({ contextKey: nextContextKey, ids: [] });
    setSources((current) => ({ ...current, sessionAttachments: false }));
    setSearchParams(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = text.trim();
    if (!prompt || sending || uploading || runActive) return;
    followOutputRef.current = true;
    setSending(true);
    setError('');
    let sendContextKey = conversationContextKey;
    try {
      let targetId = conversationId;
      let targetConversation = detail?.conversation ?? conversations.find((conversation) => conversation.id === targetId) ?? null;
      if (!targetId) {
        const title = prompt.length > 36 ? `${prompt.slice(0, 36)}…` : prompt;
        const created = scope.kind === 'GLOBAL'
          ? await api.createGlobal(title)
          : await api.createWorkspace(scope.workspaceId, title);
        if (activeConversationContextRef.current !== sendContextKey) return;
        targetId = created.id;
        targetConversation = created;
        setConversations((items) => [created, ...items.filter((item) => item.id !== created.id)]);
        selectConversation(created.id);
      }
      sendContextKey = createConversationContextKey(scope, targetId);
      const accepted = scope.kind === 'GLOBAL'
        ? await api.sendGlobal(targetId, {
          clientMessageId: createClientId(), text: prompt, attachmentIds: [],
          sources: { workspaceFlows: false, workspaceDocuments: false, sessionAttachments: false, santexwell: true },
        })
        : await api.sendWorkspace(scope.workspaceId, targetId, {
          clientMessageId: createClientId(), text: prompt, attachmentIds: selectedAttachmentIds, sources: effectiveSources,
        });
      if (activeConversationContextRef.current !== sendContextKey) return;
      setDetail((current) => current?.conversation.id === targetId
        ? { ...current, messages: [...current.messages, accepted.message], latestRun: accepted.run }
        : !current && targetConversation
          ? { conversation: targetConversation, messages: [accepted.message], latestRun: accepted.run, attachments: [] }
          : current);
      setEventsPath(accepted.eventsPath);
      setText('');
      setAttachmentSelection({
        contextKey: scope.kind === 'WORKSPACE' ? createAttachmentContextKey(scope.workspaceId, targetId) : null,
        ids: [],
      });
      setSources((current) => ({ ...current, sessionAttachments: false }));
    } catch (reason: unknown) {
      if (activeConversationContextRef.current === sendContextKey) {
        setError(reason instanceof Error ? reason.message : '消息发送失败');
      }
    } finally {
      setSending(false);
    }
  };

  const uploadAttachment = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || scope.kind !== 'WORKSPACE' || sending || uploading || runActive) return;
    setUploading(true);
    setError('');
    let uploadContextKey = attachmentContextKey;
    try {
      let targetId = conversationId;
      let targetConversation = detail?.conversation ?? conversations.find((conversation) => conversation.id === targetId) ?? null;
      if (!targetId) {
        const created = await api.createWorkspace(scope.workspaceId, '新对话');
        if (activeAttachmentContextRef.current !== uploadContextKey) return;
        targetId = created.id;
        targetConversation = created;
        setConversations((items) => [created, ...items.filter((item) => item.id !== created.id)]);
        setDetail({ conversation: created, messages: [], latestRun: null, attachments: [] });
        selectConversation(created.id);
      }
      uploadContextKey = createAttachmentContextKey(scope.workspaceId, targetId);
      const attachment = await api.uploadAttachment(scope.workspaceId, targetId, file);
      if (activeAttachmentContextRef.current !== uploadContextKey) return;
      setDetail((current) => current?.conversation.id === targetId
        ? { ...current, attachments: mergeAttachments(current.attachments, [attachment]) }
        : !current && targetConversation
          ? { conversation: targetConversation, messages: [], latestRun: null, attachments: [attachment] }
          : current);
      if (attachment.status === 'READY') {
        setAttachmentSelection((current) => ({
          contextKey: uploadContextKey,
          ids: [...new Set([...(current.contextKey === uploadContextKey ? current.ids : []), attachment.id])],
        }));
      }
    } catch (reason: unknown) {
      if (activeAttachmentContextRef.current === uploadContextKey) {
        setError(reason instanceof Error ? reason.message : '会话附件上传失败');
      }
    } finally {
      setUploading(false);
    }
  };

  const toggleAttachment = (attachmentId: string, checked: boolean) => {
    if (!attachmentContextKey) return;
    const next = checked
      ? [...new Set([...selectedAttachmentIds, attachmentId])]
      : selectedAttachmentIds.filter((id) => id !== attachmentId);
    setAttachmentSelection({ contextKey: attachmentContextKey, ids: next });
  };

  const cancel = async () => {
    if (!activeRunId) return;
    try {
      await api.cancelRun(activeRunId, '用户在网页中取消');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '取消失败');
    }
  };

  const steer = async (event: FormEvent) => {
    event.preventDefault();
    const instruction = steerText.trim();
    if (!activeRunId || !instruction || steerPending) return;
    setSteerPending(true);
    try {
      await api.steerRun(activeRunId, { clientSteerId: createClientId(), instruction });
      setSteerText('');
      setSteering(false);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '调整方向失败');
    } finally {
      setSteerPending(false);
    }
  };

  const showStreamAnswer = Boolean(runState.answer && runState.runId === activeRunId);
  const visibleMessages = showStreamAnswer
    ? messages.filter((message) => message.role !== 'ASSISTANT' || message.runId !== runState.runId)
    : messages;

  return <section className="agent-conversation-shell">
    <aside className="agent-conversation-list" aria-label="会话列表">
      <header><span className="page-kicker">CONVERSATIONS</span><button type="button" aria-label="新建会话" disabled={sending || uploading} onClick={() => selectConversation(null)}><Plus size={17} /></button></header>
      <nav>
        {conversations.map((conversation) => <button
          type="button"
          key={conversation.id}
          className={conversation.id === conversationId ? 'is-selected' : undefined}
          disabled={sending || uploading}
          onClick={() => selectConversation(conversation.id)}
        ><ChatCircleDots size={17} /><span><strong>{conversation.title}</strong><small>{conversation.lastMessagePreview ?? '尚未提问'}</small></span></button>)}
      </nav>
      {conversations.length === 0 ? <p>你的私有问答会保存在这里。</p> : null}
    </aside>

    <div className="agent-conversation-main">
      <header className="agent-conversation-heading">
        <div><span className="page-kicker">SANTEXWELL QA AGENT</span><h2>{detail?.conversation.title ?? '新的知识问答'}</h2></div>
        <div className="agent-conversation-heading-actions">{returnTo ? <Link to={returnTo}><ArrowLeft size={15} />返回引用来源</Link> : null}<span>只读</span></div>
      </header>

      <div
        ref={messageListRef}
        className="agent-message-list"
        aria-label="会话消息"
        onScroll={(event) => { followOutputRef.current = isNearScrollBottom(event.currentTarget); }}
      >
        {visibleMessages.length === 0 && !runState.draft && !runState.answer ? <AgentWelcome global={scope.kind === 'GLOBAL'} /> : visibleMessages.map((message) => message.role === 'USER'
          ? <article
              ref={message.id === targetMessageId ? targetMessageRef : undefined}
              className={`agent-message is-user${message.id === targetMessageId ? ' is-target' : ''}`}
              tabIndex={message.id === targetMessageId ? -1 : undefined}
              key={message.id}
            ><span>你</span><p>{message.content}</p></article>
          : <AgentAnswer
              key={message.runId}
              answer={message.answer}
              returnTo={currentPath}
              {...(scope.kind === 'WORKSPACE' ? { regressionApi: api } : {})}
              targeted={message.id === targetMessageId}
              targetRef={message.id === targetMessageId ? targetMessageRef : undefined}
            />)}
        {detail && targetMessageRequested && !targetMessageFound ? <p className="agent-reference-missing" role="alert">引用消息不存在或当前不可访问</p> : null}
        <AgentRunTimeline state={runState} />
        {showStreamAnswer ? <AgentAnswer key={runState.runId ?? 'live-answer'} answer={runState.answer!} returnTo={currentPath} {...(scope.kind === 'WORKSPACE' ? { regressionApi: api } : {})} live /> : null}
      </div>

      {error ? <p className="agent-panel-error" role="alert">{error}</p> : null}

      {steering && runActive ? <form className="agent-steer-form" onSubmit={steer}>
        <label htmlFor="agent-steer">告诉调度器接下来要调整什么</label>
        <div><input id="agent-steer" value={steerText} disabled={steerPending} onChange={(event) => setSteerText(event.target.value)} placeholder="例如：只比较工作区流程，不再扩展案例" /><button type="submit" disabled={!steerText.trim() || steerPending}>{steerPending ? '应用中…' : '应用'}</button></div>
      </form> : null}

      <form className="agent-composer" onSubmit={submit}>
        {scope.kind === 'WORKSPACE' ? <>
          <SourceSwitches value={effectiveSources} disabled={sending || runActive || uploading} attachmentSelected={selectedAttachmentIds.length > 0} onChange={(next) => {
            if (!next.sessionAttachments) setAttachmentSelection({ contextKey: attachmentContextKey, ids: [] });
            setSources(next);
          }} />
          <div className="agent-attachment-bar">
            <label className={sending || uploading || runActive ? 'is-disabled' : undefined}>
              <Paperclip size={15} />{uploading ? '正在解析…' : '添加附件'}
              <input
                type="file"
                aria-label="添加会话附件"
                accept=".md,.txt,.pdf,.docx,text/markdown,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                disabled={sending || uploading || runActive}
                onChange={(event) => { void uploadAttachment(event); }}
              />
            </label>
            {detail?.attachments.map((attachment) => <label className={`agent-attachment-chip is-${attachment.status.toLowerCase()}`} key={attachment.id}>
              <input
                type="checkbox"
                aria-label={`本轮使用附件 ${attachment.originalName}`}
                disabled={sending || runActive || uploading || attachment.status !== 'READY'}
                checked={selectedAttachmentIds.includes(attachment.id)}
                onChange={(event) => toggleAttachment(attachment.id, event.target.checked)}
              />
              <span>{attachment.originalName}</span><small>{attachment.status === 'READY' ? '已就绪' : attachment.status === 'FAILED' ? '解析失败' : '解析中'}</small>
            </label>)}
          </div>
        </> : <div className="agent-global-source"><GlobeHemisphereWest size={16} />本轮仅访问 Santexwell Vault</div>}
        <div className="agent-composer-input">
          <textarea
            aria-label="向 Agent 提问"
            rows={3}
            value={text}
            disabled={sending || uploading || runActive}
            placeholder={uploading ? '附件正在处理，完成后即可发送。' : runActive ? '当前回答进行中；可以取消或调整方向。' : '描述你要确认的概念、流程节点或质量问题…'}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" aria-label="发送问题" disabled={!text.trim() || sending || uploading || runActive}><PaperPlaneTilt size={19} weight="fill" /></button>
        </div>
        <div className="agent-composer-footer"><span>Enter 发送 · Shift + Enter 换行</span>{runActive ? <div><button type="button" onClick={() => setSteering((open) => !open)}><SlidersHorizontal size={15} />调整方向</button><button type="button" onClick={() => { void cancel(); }}><Stop size={15} />取消</button></div> : null}</div>
      </form>
    </div>
  </section>;
}

function SourceSwitches({ value, disabled, attachmentSelected, onChange }: { value: SourceOptionsV1; disabled: boolean; attachmentSelected: boolean; onChange: (next: SourceOptionsV1) => void }) {
  const options = [
    { key: 'workspaceFlows' as const, label: '流程', icon: FlowArrow },
    { key: 'workspaceDocuments' as const, label: '文档', icon: FileText },
    { key: 'sessionAttachments' as const, label: '附件', icon: Plus },
    { key: 'santexwell' as const, label: 'Santexwell', icon: GlobeHemisphereWest },
  ];
  return <fieldset className="agent-source-switches" disabled={disabled}><legend>本轮来源</legend>{options.map(({ key, label, icon: Icon }) => <label key={key} className={value[key] ? 'is-selected' : undefined}>
    <input type="checkbox" disabled={key === 'sessionAttachments' && !attachmentSelected} checked={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} /><Icon size={15} />{label}
  </label>)}</fieldset>;
}

function AgentWelcome({ global }: { global: boolean }) {
  return <div className="agent-welcome"><span><ChatCircleDots size={26} /></span><h3>{global ? '从知识图谱里找到可验证的答案' : '把工作区流程与知识库放在同一个问题里'}</h3><p>{global ? '小问题会直接定位到聚焦页面；开放问题才会拆分成有限的并行任务。' : '默认先看工作区流程和文档，再按需补充 Santexwell；你可以逐轮调整来源。'}</p></div>;
}

function AgentAnswer({
  answer,
  returnTo,
  regressionApi,
  live = false,
  targeted = false,
  targetRef,
}: {
  answer: NonNullable<ReturnType<typeof useAgentRunStream>['answer']>;
  returnTo: string;
  regressionApi?: Pick<AgentApi, 'getFlowRegressionReferenceEligibility' | 'createFlowRegressionCase'>;
  live?: boolean;
  targeted?: boolean;
  targetRef?: RefObject<HTMLElement | null> | undefined;
}) {
  return <article
    ref={targetRef}
    className={`agent-message agent-answer-committed${live ? ' is-live' : ''}${targeted ? ' is-target' : ''}`}
    tabIndex={targeted ? -1 : undefined}
    aria-live={live ? 'polite' : undefined}
  >
    <span>Agent</span>
    <div className="agent-answer-body">
      <p className="agent-answer-conclusion">{answer.conclusion}</p>
      {answer.sections.map((section) => <section key={section.id}><h3>{section.title}</h3><SanitizedMarkdown>{section.markdown}</SanitizedMarkdown></section>)}
      {answer.citations.length > 0 ? <div className="agent-citations"><strong>引用依据</strong>{answer.citations.map((citation) => citation.href ? <div className="agent-citation" key={citation.referenceId}>
        <Link to={appendSafeReturnTo(citation.href, returnTo)}><span>{citation.title}</span><small>{citation.excerpt}</small><ArrowRight size={15} /></Link>
        {regressionApi ? <EligibilityPinAction api={regressionApi} referenceId={citation.referenceId} /> : null}
      </div> : <div className="is-invalid" key={citation.referenceId}><span>{citation.title}</span><small>{citation.invalidReason}</small></div>)}</div> : null}
      {answer.flowFeedback.length > 0 ? <div className="agent-flow-feedback"><strong>流程反馈</strong>{answer.flowFeedback.map((feedback) => feedback.href
        ? <Link key={`${feedback.kind}:${feedback.referenceId}`} to={appendSafeReturnTo(feedback.href, returnTo)}><span>{feedback.message}</span><ArrowRight size={15} /></Link>
        : <div className="is-invalid" key={`${feedback.kind}:${feedback.referenceId}`}><span>{feedback.message}</span><small>{feedback.invalidReason}</small></div>)}</div> : null}
      {answer.artifacts.length > 0 ? <div className="agent-artifact-list">{answer.artifacts.map((artifact) => <details key={artifact.id}>
        <summary>{artifactLabel(artifact.kind)} · {artifact.title}</summary>
        <ArtifactViewer artifact={artifact} />
      </details>)}</div> : null}
    </div>
  </article>;
}

function EligibilityPinAction({
  api,
  referenceId,
}: {
  api: Pick<AgentApi, 'getFlowRegressionReferenceEligibility' | 'createFlowRegressionCase'>;
  referenceId: string;
}) {
  const [eligible, setEligible] = useState(false);
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setEligible(false);
    setChecking(true);
    setPending(false);
    setPinned(false);
    setError('');
    api.getFlowRegressionReferenceEligibility(referenceId).then((result) => {
      if (!active) return;
      setEligible(result.eligible);
    }).catch(() => {
      if (active) setEligible(false);
    }).finally(() => {
      if (active) setChecking(false);
    });
    return () => { active = false; };
  }, [api, referenceId]);

  if (checking || !eligible) return null;

  const pin = async () => {
    if (pending || pinned) return;
    setPending(true);
    setError('');
    try {
      await api.createFlowRegressionCase(referenceId);
      setPinned(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '固定回归题失败');
    } finally {
      setPending(false);
    }
  };

  return <span className="agent-citation-action">
    <button type="button" onClick={() => { void pin(); }} disabled={pending || pinned}>
      {pending ? '固定中…' : pinned ? '已固定' : '固定为回归题'}
    </button>
    {pinned ? <small role="status">已固定为回归题</small> : null}
    {error ? <small role="alert">{error}</small> : null}
  </span>;
}

function artifactLabel(kind: string) {
  return { REPORT: '报告', DIAGRAM: '结构图', FLOW_PROPOSAL: '流程建议', REFERENCE_COLLECTION: '引用集' }[kind] ?? kind;
}

function createClientId() {
  return globalThis.crypto?.randomUUID?.() ?? `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createAttachmentContextKey(workspaceId: string, conversationId: string): string {
  return JSON.stringify([workspaceId, conversationId]);
}

function createConversationContextKey(scope: ConversationScope, conversationId: string): string {
  return JSON.stringify([scope.kind, scope.kind === 'WORKSPACE' ? scope.workspaceId : null, conversationId]);
}

function mergeAttachments<T extends { id: string }>(left: readonly T[], right: readonly T[]): T[] {
  return [...new Map([...left, ...right].map((attachment) => [attachment.id, attachment])).values()];
}

function mergeConversationMessages(
  server: ConversationDetailV1['messages'],
  optimistic: ConversationDetailV1['messages'],
): ConversationDetailV1['messages'] {
  const serverIds = new Set(server.map((message) => message.id));
  return [...server, ...optimistic.filter((message) => !serverIds.has(message.id))];
}

function readLocatorParam(value: string | null): string | null {
  return value && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value) ? value : null;
}

export function isNearScrollBottom(element: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 96;
}
