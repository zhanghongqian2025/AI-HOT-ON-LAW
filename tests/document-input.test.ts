import './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closeDb } from '@aihot/backend/db';
import { buildScoreInput } from '@aihot/backend/editorial/analyze';
import { buildMaterial, type AnalyzeInputArticle } from '@aihot/backend/editorial/input';
import { buildArticlePrompt, MAX_BODY_CHARS, prefilterUser, renderContext, translateInputOf, understandUser } from '@aihot/backend/editorial/writing';

after(closeDb);
const article = (bodyText: string): AnalyzeInputArticle => ({
  id: 'document-input', revision: 3, title: '政策指南', url: 'https://example.com/guide', author: null,
  publishedAt: new Date('2026-09-30T12:09:00Z'), bodyText, excerpt: null, bodyStatus: 'ok',
  media: [], xPost: null, source: { name: '官方来源', kind: 'web_list', tier: 'T1', firstParty: true, fetchesBody: true },
});

test('every analysis input consumes the same evidence pack, including its tail beyond the old summary cap', () => {
  const tail = '许可备案与质押登记的尾部原文证据。';
  const text = '全段扫描后的证据摘录，非全文；未摘录内容不得推断。\n' + '前部原文证据。'.repeat(1200) + tail;
  const a = { ...article('原文'.repeat(40_000)), documentEvidence: { text, characters: 80_000, segments: 4 } };
  const views = [renderContext(a), JSON.parse(prefilterUser(a)), understandUser(a), buildScoreInput(a), buildMaterial(a), buildArticlePrompt(translateInputOf(a))];
  for (const view of views) {
    assert.ok(view.includes(tail), 'tail evidence reaches every downstream prompt');
    assert.ok(view.includes('证据摘录') && view.includes('非全文'));
    assert.doesNotMatch(view, /完整正文/);
  }
  assert.equal(a.bodyText!.length, 80_000, 'preparation never replaces the stored original');
});

test('unprepared oversized inputs explicitly mark their missing tail instead of claiming completeness', () => {
  const a = article('前'.repeat(MAX_BODY_CHARS) + '未传递尾部');
  for (const view of [renderContext(a), buildScoreInput(a), buildMaterial(a)]) {
    assert.ok(view.includes('后文未提供'));
    assert.doesNotMatch(view, /完整正文/);
    assert.ok(!view.includes('未传递尾部'));
  }
});

test('ordinary bodies at the existing limit still reach the normal input unchanged', () => {
  const text = '原'.repeat(MAX_BODY_CHARS - 4) + '边界尾部';
  const a = article(text);
  assert.equal(text.length, MAX_BODY_CHARS);
  assert.ok(renderContext(a).includes(text));
  assert.ok(buildScoreInput(a).includes(text));
  assert.ok(buildMaterial(a).includes(text));
});
