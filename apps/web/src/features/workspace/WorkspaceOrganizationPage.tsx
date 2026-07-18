import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';

import type { WorkspaceFolder, WorkspaceItemSummary, WorkspaceResourceMount, WorkspaceSummary } from './types';
import type { WorkspaceOutletContext } from './WorkspaceShell';

interface OrganizationData {
  workspace: WorkspaceSummary;
  folders: WorkspaceFolder[];
  items: WorkspaceItemSummary[];
  mounts: WorkspaceResourceMount[];
}

export function WorkspaceOrganizationPage() {
  const { workspaceId } = useParams();
  const { workspaceApi, workspaces } = useOutletContext<WorkspaceOutletContext>();
  const [data, setData] = useState<OrganizationData | null>(null);
  const [folderName, setFolderName] = useState('');
  const [parentId, setParentId] = useState('');
  const [providerWorkspaceId, setProviderWorkspaceId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!workspaceId) return;
    setError('');
    const [detail, folders, items, mounts] = await Promise.all([
      workspaceApi.get(workspaceId),
      workspaceApi.listFolders(workspaceId),
      workspaceApi.listItems(workspaceId),
      workspaceApi.listResourceMounts(workspaceId),
    ]);
    setData({ workspace: detail.workspace, folders, items, mounts });
  }, [workspaceApi, workspaceId]);

  useEffect(() => {
    void reload().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '工作区整理页载入失败'));
  }, [reload]);

  const foldersById = useMemo(() => new Map(data?.folders.map((folder) => [folder.id, folder]) ?? []), [data?.folders]);
  const editable = data?.workspace.permission !== 'VIEW';
  const owner = data?.workspace.permission === 'OWNER';
  const isBusinessTeam = data?.workspace.kind === undefined || data.workspace.kind === 'BUSINESS_TEAM';
  const availableProviders = workspaces.filter((workspace) => (
    workspace.id !== workspaceId
    && workspace.kind !== undefined
    && workspace.kind !== 'BUSINESS_TEAM'
    && workspace.permission !== 'VIEW'
    && !data?.mounts.some((mount) => mount.providerWorkspaceId === workspace.id)
  ));

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <section className="workspace-organization page-stack"><p className="workspace-error" role="alert">{error}</p></section>;
  if (!data) return <div className="workspace-loading" role="status"><span className="spinner" /><span>正在载入工作区结构…</span></div>;

  return <section className="workspace-organization page-stack">
    <header className="page-heading">
      <div><span className="page-kicker">WORKSPACE ORGANIZATION</span><h1>整理工作区</h1><p>用文件夹归类本团队的指南和资料；共享资源只在明确挂载后进入本团队的引用与 Agent 检索范围。</p></div>
      <Link className="secondary-button" to={`/workspaces/${data.workspace.id}`}>返回概览</Link>
    </header>
    {error ? <p className="workspace-error" role="alert">{error}</p> : null}

    <section className="organization-section" aria-labelledby="folder-heading">
      <div className="section-title"><div><span className="page-kicker">FOLDERS</span><h2 id="folder-heading">分类文件夹</h2></div><span className="page-count">{data.folders.length}</span></div>
      {editable ? <form className="organization-create-row" onSubmit={(event) => {
        event.preventDefault();
        const name = folderName.trim();
        if (!name) return;
        void run(async () => {
          await workspaceApi.createFolder(data.workspace.id, { name, parentId: parentId || null });
          setFolderName('');
          setParentId('');
        });
      }}>
        <input aria-label="新文件夹名称" value={folderName} maxLength={120} placeholder="例如：打样工序" onChange={(event) => setFolderName(event.target.value)} />
        <select aria-label="父文件夹" value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">顶层文件夹</option>{data.folders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder, foldersById)}</option>)}</select>
        <button className="primary-button" type="submit" disabled={busy}>新建文件夹</button>
      </form> : <p className="organization-hint">当前权限只能查看分类，不能调整文件夹或资源归属。</p>}
      {data.folders.length === 0 ? <div className="workspace-empty compact"><strong>还没有分类文件夹</strong><span>可先建立“打样工序”，再在其下建立“新客户”等场景。</span></div> : <ul className="folder-list">{data.folders.map((folder) => <FolderRow key={folder.id} folder={folder} foldersById={foldersById} editable={Boolean(editable)} busy={busy} onRename={(name) => run(async () => { await workspaceApi.renameFolder(data.workspace.id, folder.id, name); })} onDelete={() => run(() => workspaceApi.deleteFolder(data.workspace.id, folder.id))} />)}</ul>}
    </section>

    <section className="organization-section" aria-labelledby="item-heading">
      <div className="section-title"><div><span className="page-kicker">CONTENT</span><h2 id="item-heading">指南与资料归类</h2></div><span className="page-count">{data.items.length}</span></div>
      {data.items.length === 0 ? <div className="workspace-empty compact"><strong>还没有可整理的资源</strong><span>创建指南或上传资料后，可在这里移动到对应文件夹。</span></div> : <div className="organization-item-list">{data.items.map((item) => <div className="organization-item" key={item.id}><div><strong>{item.title}</strong><span>{item.kind === 'GUIDE' ? '指南' : item.kind === 'SOURCE' ? '资料' : item.kind}</span></div>{editable ? <select aria-label={`移动 ${item.title} 到文件夹`} value={item.folderId ?? ''} disabled={busy} onChange={(event) => void run(async () => { await workspaceApi.moveItemToFolder(data.workspace.id, item.id, event.target.value || null); })}><option value="">未归类</option>{data.folders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder, foldersById)}</option>)}</select> : <span className="organization-folder-label">{item.folderId ? folderPath(foldersById.get(item.folderId), foldersById) : '未归类'}</span>}</div>)}</div>}
    </section>

    <section className="organization-section" aria-labelledby="mount-heading">
      <div className="section-title"><div><span className="page-kicker">SHARED RESOURCES</span><h2 id="mount-heading">共享资源中心</h2></div><span className="page-count">{data.mounts.length}</span></div>
      {isBusinessTeam ? <><p className="organization-hint">Agent 会同时检索本团队资料和以下已挂载资源中心；只读取资源中心的已发布流程，不会自动覆盖客户流程中的固定引用。业务团队所有者需同时拥有资源中心的编辑或所有者权限，才能新增挂载。</p>{owner ? <form className="organization-create-row" onSubmit={(event) => {
        event.preventDefault();
        if (!providerWorkspaceId) return;
        void run(async () => {
          await workspaceApi.createResourceMount(data.workspace.id, providerWorkspaceId);
          setProviderWorkspaceId('');
        });
      }}><select aria-label="选择资源中心" value={providerWorkspaceId} onChange={(event) => setProviderWorkspaceId(event.target.value)}><option value="">选择可挂载的资源中心</option>{availableProviders.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}（{workspaceKindLabel(workspace.kind)}）</option>)}</select><button className="primary-button" type="submit" disabled={busy || !providerWorkspaceId}>挂载资源中心</button></form> : <p className="organization-hint">只有业务团队所有者可以管理资源中心挂载。</p>}{data.mounts.length === 0 ? <div className="workspace-empty compact"><strong>尚未挂载资源中心</strong><span>按需添加财务、工艺、跟单或生产资源，避免跨团队的默认全量检索。</span></div> : <ul className="mount-list">{data.mounts.map((mount) => <li key={mount.id}><div><strong>{mount.providerName}</strong><span>{workspaceKindLabel(mount.providerKind)} · 已明确挂载</span></div>{owner ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void run(() => workspaceApi.deleteResourceMount(data.workspace.id, mount.id))}>移除</button> : null}</li>)}</ul>}</> : <p className="organization-hint">这是一个资源中心。将它挂载到业务团队后，团队才能引用其已发布指南并让 Agent 检索对应资料。</p>}
    </section>
  </section>;
}

function FolderRow({ folder, foldersById, editable, busy, onRename, onDelete }: { folder: WorkspaceFolder; foldersById: Map<string, WorkspaceFolder>; editable: boolean; busy: boolean; onRename: (name: string) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(folder.name);
  useEffect(() => setDraft(folder.name), [folder.name]);
  return <li><div><strong>{folderPath(folder, foldersById)}</strong><span>文件夹</span></div>{editable ? <div className="folder-row-actions"><input aria-label={`重命名 ${folder.name}`} value={draft} maxLength={120} disabled={busy} onChange={(event) => setDraft(event.target.value)} onBlur={() => { const name = draft.trim(); if (name && name !== folder.name) onRename(name); }} /><button className="secondary-button" type="button" disabled={busy} onClick={onDelete}>删除</button></div> : null}</li>;
}

function folderPath(folder: WorkspaceFolder | undefined, foldersById: Map<string, WorkspaceFolder>): string {
  if (!folder) return '未归类';
  const names = [folder.name];
  const visited = new Set([folder.id]);
  let parentId = folder.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = foldersById.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(' / ');
}

function workspaceKindLabel(kind: WorkspaceSummary['kind']): string {
  return {
    BUSINESS_TEAM: '业务团队', FINANCE: '财务', TECHNICAL: '工艺', FOLLOW_UP: '跟单', PRODUCTION: '生产',
  }[kind ?? 'BUSINESS_TEAM'];
}
