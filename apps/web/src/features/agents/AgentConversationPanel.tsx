import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ChatCircleDots,
  FileText,
  FlowArrow,
  GlobeHemisphereWest,
  PaperPlaneTilt,
  Plus,
  SlidersHorizontal,
  Stop,
} from '@phosphor-icons/react';
import { Link, useSearchParams } from 'react-router-dom';

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
  const [conversations, setConversations] = useState<ConversationSummaryV1[]>([]);
  const [detail, setDetail] = useState<ConversationDetailV1 | null>(null);
  const [text, setText] = useState('');
  const [sources, setSources] = useState<SourceOptionsV1>(scope.kind === 'GLOBAL' ? globalSources : workspaceDefaultSources);
  const [eventsPath, setEventsPath] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [steering, setSteering] = useState(false);
  const [steerText, setSteerText] = useState('');
  const conversationParam = searchParams.get('conversation');
  const conversationId = conversationParam && conversationParam !== 'new' ? conversationParam : null;
  const workspaceId = scope.kind === 'WORKSPACE' ? scope.workspaceId : null;
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
    if (!conversationId) {
      setDetail(null);
      setEventsPath(null);
      return;
    }
    let active = true;
    setError('');
    read(conversationId).then((next) => {
      if (!active) return;
      setDetail(next);
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

  const selectConversation = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('conversation', id);
    else next.set('conversation', 'new');
    setSearchParams(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = text.trim();
    if (!prompt || sending || runActive) return;
    setSending(true);
    setError('');
    try {
      let targetId = conversationId;
      let targetConversation = detail?.conversation ?? conversations.find((conversation) => conversation.id === targetId) ?? null;
      if (!targetId) {
        const title = prompt.length > 36 ? `${prompt.slice(0, 36)}…` : prompt;
        const created = scope.kind === 'GLOBAL'
          ? await api.createGlobal(title)
          : await api.createWorkspace(scope.workspaceId, title);
        targetId = created.id;
        targetConversation = created;
        setConversations((items) => [created, ...items.filter((item) => item.id !== created.id)]);
        selectConversation(created.id);
      }
      const accepted = scope.kind === 'GLOBAL'
        ? await api.sendGlobal(targetId, {
          clientMessageId: createClientId(), text: prompt, attachmentIds: [],
          sources: { workspaceFlows: false, workspaceDocuments: false, sessionAttachments: false, santexwell: true },
        })
        : await api.sendWorkspace(scope.workspaceId, targetId, {
          clientMessageId: createClientId(), text: prompt, attachmentIds: [], sources,
        });
      setDetail((current) => current ? {
        ...current, messages: [...current.messages, accepted.message], latestRun: accepted.run,
      } : targetConversation ? {
        conversation: targetConversation, messages: [accepted.message], latestRun: accepted.run, attachments: [],
      } : current);
      setEventsPath(accepted.eventsPath);
      setText('');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '消息发送失败');
    } finally {
      setSending(false);
    }
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
    if (!activeRunId || !instruction) return;
    try {
      await api.steerRun(activeRunId, { clientSteerId: createClientId(), instruction });
      setSteerText('');
      setSteering(false);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '调整方向失败');
    }
  };

  const messages = detail?.messages ?? [];
  const committedRunIds = useMemo(() => new Set(messages.filter((message) => message.role === 'ASSISTANT').map((message) => message.runId)), [messages]);
  const showStreamAnswer = runState.answer && !committedRunIds.has(activeRunId ?? '');

  return <section className="agent-conversation-shell">
    <aside className="agent-conversation-list" aria-label="会话列表">
      <header><span className="page-kicker">CONVERSATIONS</span><button type="button" aria-label="新建会话" onClick={() => selectConversation(null)}><Plus size={17} /></button></header>
      <nav>
        {conversations.map((conversation) => <button
          type="button"
          key={conversation.id}
          className={conversation.id === conversationId ? 'is-selected' : undefined}
          onClick={() => selectConversation(conversation.id)}
        ><ChatCircleDots size={17} /><span><strong>{conversation.title}</strong><small>{conversation.lastMessagePreview ?? '尚未提问'}</small></span></button>)}
      </nav>
      {conversations.length === 0 ? <p>你的私有问答会保存在这里。</p> : null}
    </aside>

    <div className="agent-conversation-main">
      <header className="agent-conversation-heading">
        <div><span className="page-kicker">SANTEXWELL QA AGENT</span><h2>{detail?.conversation.title ?? '新的知识问答'}</h2></div>
        <span>只读</span>
      </header>

      <div className="agent-message-list" aria-label="会话消息">
        {messages.length === 0 && !runState.draft && !runState.answer ? <AgentWelcome global={scope.kind === 'GLOBAL'} /> : messages.map((message) => message.role === 'USER'
          ? <article className="agent-message is-user" key={message.id}><span>你</span><p>{message.content}</p></article>
          : <AgentAnswer key={message.id} answer={message.answer} />)}
        <AgentRunTimeline state={runState} />
        {showStreamAnswer ? <AgentAnswer answer={runState.answer!} live /> : null}
      </div>

      {error ? <p className="agent-panel-error" role="alert">{error}</p> : null}

      {steering && runActive ? <form className="agent-steer-form" onSubmit={steer}>
        <label htmlFor="agent-steer">告诉调度器接下来要调整什么</label>
        <div><input id="agent-steer" value={steerText} onChange={(event) => setSteerText(event.target.value)} placeholder="例如：只比较工作区流程，不再扩展案例" /><button type="submit" disabled={!steerText.trim()}>应用</button></div>
      </form> : null}

      <form className="agent-composer" onSubmit={submit}>
        {scope.kind === 'WORKSPACE' ? <SourceSwitches value={sources} disabled={runActive} onChange={setSources} /> : <div className="agent-global-source"><GlobeHemisphereWest size={16} />本轮仅访问 Santexwell Vault</div>}
        <div className="agent-composer-input">
          <textarea
            aria-label="向 Agent 提问"
            rows={3}
            value={text}
            disabled={sending || runActive}
            placeholder={runActive ? '当前回答进行中；可以取消或调整方向。' : '描述你要确认的概念、流程节点或质量问题…'}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" aria-label="发送问题" disabled={!text.trim() || sending || runActive}><PaperPlaneTilt size={19} weight="fill" /></button>
        </div>
        <div className="agent-composer-footer"><span>Enter 发送 · Shift + Enter 换行</span>{runActive ? <div><button type="button" onClick={() => setSteering((open) => !open)}><SlidersHorizontal size={15} />调整方向</button><button type="button" onClick={() => { void cancel(); }}><Stop size={15} />取消</button></div> : null}</div>
      </form>
    </div>
  </section>;
}

function SourceSwitches({ value, disabled, onChange }: { value: SourceOptionsV1; disabled: boolean; onChange: (next: SourceOptionsV1) => void }) {
  const options = [
    { key: 'workspaceFlows' as const, label: '流程', icon: FlowArrow },
    { key: 'workspaceDocuments' as const, label: '文档', icon: FileText },
    { key: 'sessionAttachments' as const, label: '附件', icon: Plus },
    { key: 'santexwell' as const, label: 'Santexwell', icon: GlobeHemisphereWest },
  ];
  return <fieldset className="agent-source-switches" disabled={disabled}><legend>本轮来源</legend>{options.map(({ key, label, icon: Icon }) => <label key={key} className={value[key] ? 'is-selected' : undefined}>
    <input type="checkbox" checked={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} /><Icon size={15} />{label}
  </label>)}</fieldset>;
}

function AgentWelcome({ global }: { global: boolean }) {
  return <div className="agent-welcome"><span><ChatCircleDots size={26} /></span><h3>{global ? '从知识图谱里找到可验证的答案' : '把工作区流程与知识库放在同一个问题里'}</h3><p>{global ? '小问题会直接定位到聚焦页面；开放问题才会拆分成有限的并行任务。' : '默认先看工作区流程和文档，再按需补充 Santexwell；你可以逐轮调整来源。'}</p></div>;
}

function AgentAnswer({ answer, live = false }: { answer: NonNullable<ReturnType<typeof useAgentRunStream>['answer']>; live?: boolean }) {
  return <article className={`agent-message agent-answer-committed${live ? ' is-live' : ''}`} aria-live={live ? 'polite' : undefined}>
    <span>Agent</span>
    <div className="agent-answer-body">
      <p className="agent-answer-conclusion">{answer.conclusion}</p>
      {answer.sections.map((section) => <section key={section.id}><h3>{section.title}</h3><SanitizedMarkdown>{section.markdown}</SanitizedMarkdown></section>)}
      {answer.citations.length > 0 ? <div className="agent-citations"><strong>引用依据</strong>{answer.citations.map((citation) => citation.href ? <Link key={citation.referenceId} to={citation.href}><span>{citation.title}</span><small>{citation.excerpt}</small><ArrowRight size={15} /></Link> : <div className="is-invalid" key={citation.referenceId}><span>{citation.title}</span><small>{citation.invalidReason}</small></div>)}</div> : null}
      {answer.flowFeedback.length > 0 ? <div className="agent-flow-feedback"><strong>流程反馈</strong>{answer.flowFeedback.map((feedback) => <p key={`${feedback.kind}:${feedback.referenceId}`}>{feedback.message}</p>)}</div> : null}
      {answer.artifacts.length > 0 ? <div className="agent-artifact-chips">{answer.artifacts.map((artifact) => <span key={artifact.id}>{artifactLabel(artifact.kind)} · {artifact.title}</span>)}</div> : null}
    </div>
  </article>;
}

function artifactLabel(kind: string) {
  return { REPORT: '报告', DIAGRAM: '结构图', FLOW_PROPOSAL: '流程建议', REFERENCE_COLLECTION: '引用集' }[kind] ?? kind;
}

function createClientId() {
  return globalThis.crypto?.randomUUID?.() ?? `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
