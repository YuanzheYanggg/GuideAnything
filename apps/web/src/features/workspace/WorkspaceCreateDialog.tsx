import { useState } from 'react';

import type { CreateWorkspaceInput } from './types';

interface WorkspaceCreateDialogProps {
  onClose: () => void;
  onSubmit: (input: CreateWorkspaceInput) => Promise<void>;
}

const initialInput: CreateWorkspaceInput = {
  name: '',
  slug: '',
  description: '',
  iconKey: 'SquaresFour',
  colorKey: 'general',
  kind: 'BUSINESS_TEAM',
};

const iconOptions = [
  ['SquaresFour', '方格'],
  ['FileText', '文档'],
  ['ChartLineUp', '图表'],
  ['UsersThree', '人员'],
] as const;

const colorOptions = [
  ['general', '通用'],
  ['finance', '财务'],
  ['materials', '物料'],
  ['sales', '销售'],
  ['production', '生产'],
  ['people', '人力'],
] as const;

const kindOptions = [
  ['BUSINESS_TEAM', '业务团队'],
  ['FINANCE', '财务资源中心'],
  ['TECHNICAL', '工艺资源中心'],
  ['FOLLOW_UP', '跟单资源中心'],
  ['PRODUCTION', '生产资源中心'],
] as const;

export function WorkspaceCreateDialog({ onClose, onSubmit }: WorkspaceCreateDialogProps) {
  const [input, setInput] = useState(initialInput);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof CreateWorkspaceInput>(key: K, value: CreateWorkspaceInput[K]) => {
    setInput((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onSubmit(input);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '工作区创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="modal-backdrop">
    <section className="reference-modal workspace-create-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-create-title">
      <button className="modal-close" type="button" aria-label="关闭" onClick={onClose} disabled={submitting}>×</button>
      <span className="page-kicker">NEW KNOWLEDGE DOMAIN</span>
      <h2 id="workspace-create-title">新建工作区</h2>
      <p>为一组有明确业务边界的知识和流程建立独立空间。</p>
      <form className="workspace-create-form" onSubmit={submit}>
        <label>名称<input autoFocus required maxLength={100} value={input.name} onChange={(event) => update('name', event.target.value)} /></label>
        <label>Slug<input aria-label="Slug" required maxLength={100} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={input.slug} onChange={(event) => update('slug', event.target.value)} /><small>仅使用小写字母、数字和连字符。</small></label>
        <label className="workspace-create-wide">工作区类型<select aria-label="工作区类型" value={input.kind} onChange={(event) => update('kind', event.target.value as CreateWorkspaceInput['kind'])}>{kindOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>业务团队可按需挂载资源中心；资源中心的已发布指南可被团队引用。</small></label>
        <label className="workspace-create-wide">描述<textarea maxLength={2_000} rows={3} value={input.description} onChange={(event) => update('description', event.target.value)} /></label>
        <label>图标<select value={input.iconKey} onChange={(event) => update('iconKey', event.target.value)}>{iconOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>颜色<select value={input.colorKey} onChange={(event) => update('colorKey', event.target.value)}>{colorOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {error ? <p className="workspace-create-error" role="alert">{error}</p> : null}
        <div className="workspace-create-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>取消</button>
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? '创建中…' : '创建工作区'}</button>
        </div>
      </form>
    </section>
  </div>;
}
