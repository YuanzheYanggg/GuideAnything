import { useEffect, useState, type RefObject } from 'react';
import { ArrowUpRight, CaretDown, CaretUp, Check, Eye, FileText, PencilSimple, Sparkle, Tag } from '@phosphor-icons/react';

import { ShinyText } from '../../components/reactbits/ShinyText';
import { SpotlightCard } from '../../components/reactbits/SpotlightCard';

export interface GuideDetailsHeaderProps {
  tags: string[];
  disabled: boolean;
  summaryTriggerRef: RefObject<HTMLButtonElement | null>;
  digestTriggerRef: RefObject<HTMLButtonElement | null>;
  onTagsChange: (tags: string[]) => void;
  onOpenSummary: () => void;
  onOpenDigest: () => void;
}

function parseTags(value: string): string[] {
  return value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean);
}

export function GuideDetailsHeader({ tags, disabled, summaryTriggerRef, digestTriggerRef, onTagsChange, onOpenSummary, onOpenDigest }: GuideDetailsHeaderProps) {
  const [tagsEditing, setTagsEditing] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const visibleTags = showAllTags ? tags : tags.slice(0, 3);
  const extraTagCount = Math.max(tags.length - 3, 0);

  useEffect(() => {
    if (!disabled) return;
    setTagsEditing(false);
    setShowAllTags(false);
  }, [disabled]);

  return <>
    <SpotlightCard className="guide-details-card" spotlightColor="rgba(10, 132, 255, 0.22)">
      <ShinyText className="eyebrow">GUIDE DETAILS</ShinyText>
      <div className="guide-details-content">
        <div className="guide-summary-panel guide-summary-panel--compact">
          <div className="guide-detail-heading">
            <span><FileText size={15} aria-hidden="true" />摘要</span>
          </div>
          <button ref={summaryTriggerRef} className="guide-summary-view" type="button" onClick={onOpenSummary} disabled={disabled} aria-label="查看摘要">
            <Eye size={15} aria-hidden="true" />查看摘要
          </button>
        </div>
        <div className={`guide-tags-panel${tagsEditing ? ' is-editing' : ''}`}>
          {tagsEditing ? <div className="guide-details-editor">
            <label htmlFor="guide-tags-editor"><span><Tag size={15} aria-hidden="true" />标签</span><input id="guide-tags-editor" aria-label="标签" value={tags.join('，')} disabled={disabled} onChange={(event) => onTagsChange(parseTags(event.target.value))} /></label>
            <button className="guide-detail-done" type="button" onClick={() => setTagsEditing(false)} disabled={disabled} aria-label="完成标签"><Check size={15} aria-hidden="true" />完成</button>
          </div> : <>
            <div className="guide-detail-heading">
              <span><Tag size={15} aria-hidden="true" />标签</span>
              <button className="guide-detail-edit" type="button" onClick={() => setTagsEditing(true)} disabled={disabled} aria-label="编辑标签"><PencilSimple size={14} aria-hidden="true" />编辑</button>
            </div>
            <div className="guide-tag-list" aria-label="指南标签">
              {visibleTags.length > 0 ? visibleTags.map((tag) => <span className="guide-tag-chip" key={tag}>{tag}</span>) : <span className="guide-detail-hint is-empty">暂无标签</span>}
              {extraTagCount > 0 ? <button className="guide-tags-more" type="button" onClick={() => setShowAllTags((current) => !current)} disabled={disabled} aria-expanded={showAllTags} aria-label={showAllTags ? '收起标签' : `更多标签，共 ${extraTagCount} 个`}>
                {showAllTags ? <CaretUp size={13} aria-hidden="true" /> : <CaretDown size={13} aria-hidden="true" />}
                {showAllTags ? '收起' : `+${extraTagCount} 更多`}
              </button> : null}
            </div>
          </>}
        </div>
        <button ref={digestTriggerRef} className="guide-digest-command guide-digest-open" type="button" onClick={onOpenDigest} disabled={disabled} aria-label="生成指南总览">
          <span className="guide-digest-command-icon"><Sparkle size={19} weight="fill" aria-hidden="true" /></span>
          <span className="guide-digest-command-copy"><strong>生成指南总览</strong><small>提炼流程重点与标签建议</small></span>
          <ArrowUpRight className="guide-digest-command-arrow" size={17} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </SpotlightCard>
  </>;
}
