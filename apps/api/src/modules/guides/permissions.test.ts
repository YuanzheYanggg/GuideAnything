import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authorization, createTestContext, sampleDocument, type TestContext } from '../../test/test-app';

describe('guide permissions', () => {
  let context: TestContext;

  beforeEach(async () => { context = await createTestContext(); });
  afterEach(async () => context.close());

  it('allows an invited editor to save while reserving publication for the owner', async () => {
    const learnerCreate = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.learner), payload: { title: '越权创建' },
    });
    expect(learnerCreate.statusCode).toBe(403);

    const created = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author), payload: { title: '协作指南' },
    });
    const guideId = created.json().guide.id as string;

    expect((await context.app.inject({
      method: 'GET', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.editor),
    })).statusCode).toBe(403);
    expect((await context.app.inject({
      method: 'GET', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.learner),
    })).statusCode).toBe(403);
    expect((await context.app.inject({
      method: 'PATCH', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.otherAuthor),
      payload: { revision: 0, document: sampleDocument() },
    })).statusCode).toBe(403);

    const invited = await context.app.inject({
      method: 'POST',
      url: `/api/guides/${guideId}/collaborators`,
      headers: authorization(context.tokens.author),
      payload: { userId: context.userIds.editor },
    });
    expect(invited.statusCode).toBe(201);

    const edited = await context.app.inject({
      method: 'PATCH', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.editor),
      payload: { revision: 0, document: sampleDocument('# 编辑者完成的内容') },
    });
    expect(edited.statusCode).toBe(200);

    const publish = await context.app.inject({
      method: 'POST', url: `/api/guides/${guideId}/publish`, headers: authorization(context.tokens.editor),
    });
    expect(publish.statusCode).toBe(403);
  });
});

