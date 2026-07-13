import type { DatabaseSync } from 'node:sqlite';

interface SearchRow {
  version_id: string;
  guide_id: string;
  title: string;
  summary: string;
  tags_json: string;
  version: number;
  author_name: string;
  published_at: string;
  rank: number;
}

export interface SearchResult {
  versionId: string;
  guideId: string;
  title: string;
  summary: string;
  tags: string[];
  version: number;
  authorName: string;
  publishedAt: string;
}

export interface SearchPage {
  items: SearchResult[];
  nextOffset: number | null;
}

export function searchPublishedGuides(database: DatabaseSync, query: string, limit = 20, offset = 0): SearchPage {
  const matchQuery = query
    .split(/\s+/u)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"*`)
    .join(' AND ');
  const rows = (matchQuery
    ? database.prepare(
      `SELECT gs.version_id, gs.guide_id, gs.title, gs.summary, v.tags_json,
              v.version, u.display_name AS author_name, v.published_at AS published_at, bm25(guide_search) AS rank
       FROM guide_search gs
       JOIN guide_versions v ON v.id = gs.version_id
       JOIN guides g ON g.id = gs.guide_id
       JOIN users u ON u.id = g.owner_id
       WHERE guide_search MATCH ?
       ORDER BY rank, v.published_at DESC
       LIMIT ? OFFSET ?`,
    ).all(matchQuery, limit + 1, offset)
    : database.prepare(
      `SELECT gs.version_id, gs.guide_id, gs.title, gs.summary, v.tags_json,
              v.version, u.display_name AS author_name, v.published_at AS published_at, 0 AS rank
       FROM guide_search gs
       JOIN guide_versions v ON v.id = gs.version_id
       JOIN guides g ON g.id = gs.guide_id
       JOIN users u ON u.id = g.owner_id
       ORDER BY v.published_at DESC, v.version DESC
       LIMIT ? OFFSET ?`,
    ).all(limit + 1, offset)) as unknown as SearchRow[];
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((row) => ({
      versionId: row.version_id,
      guideId: row.guide_id,
      title: row.title,
      summary: row.summary,
      tags: JSON.parse(row.tags_json) as string[],
      version: row.version,
      authorName: row.author_name,
      publishedAt: row.published_at,
    })),
    nextOffset: hasMore ? offset + limit : null,
  };
}
