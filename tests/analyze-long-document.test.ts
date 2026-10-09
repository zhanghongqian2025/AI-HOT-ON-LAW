import { pointModels, stub, tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { analyzeArticle } from '@aihot/backend/editorial/analyze';
import { stopBoss } from '@aihot/backend/jobs/queue';

const T=tag(), SOURCE=`long-analysis-${T}`;
const tail='尾部规则明确许可合同备案与质押登记程序。';
const full='登记及复审规则。'.repeat(9000)+tail;
const prompts:string[]=[];
let changeRevision:(()=>Promise<void>)|null=null;
const provider=await stub(async (_hit,request)=>{
  const body=JSON.parse(request.body), system=String(body.messages[0].content), user=String(body.messages.at(-1).content);
  let data:unknown;
  if(system.includes('blockIds')) {
    const chunk=JSON.parse(user);
    if(changeRevision) {const change=changeRevision; changeRevision=null; await change();}
    const blocks=chunk.blocks.filter((b:{text:string})=>b.text.trim());
    data={blockIds:[blocks[0].id,blocks.at(-1).id]};
  } else {
    prompts.push(user);
    data=system.includes('相关性预筛')?{label:'PASS',reason:'规则材料'}
      :system.includes('精选评分器')?{attentionScore:80}
      :system.includes('资料结构化助手')?{scope:'single',category:'intellectual-property',tags:['知识产权'],subjects:[],fact:{title:'修订指南',evidence:tail,conditions:[]}}
      :{itemType:'regulatory_action',authorRole:'principal',tags:['知识产权'],editorialJudgment:'原文规则供人工核验。',titleZh:'监管机构公布审查指南',summaryZh:'监管机构公布审查指南，材料含登记、复审及许可、质押程序。相关要求仍需结合原文核验。'};
  }
  return {choices:[{message:{content:JSON.stringify(data)}}]};
});
pointModels(provider.url);
before(async()=>{await sql`INSERT INTO sources(id,name,kind,tier) VALUES (${SOURCE},'Long-document test','rss','T1')`;});
after(async()=>{await provider.close();await stopBoss();await closeDb();});
const material=(name:string)=>({sourceId:SOURCE,url:`https://example.com/${T}/${name}`,title:`审查指南${name}`,bodyText:full,bodyStatus:'ok' as const,via:'fetch' as const,publishedAt:new Date('2026-09-30T12:09:00Z')});

test('a long analysis commits every chunk receipt with the judgement and keeps its original body and dates',async()=>{
  prompts.length=0;
  const input=material('complete'),{articleId}=await upsertMaterial(input);
  const result=await analyzeArticle(articleId);
  const [row]=await sql`SELECT receipt_ids,output,input_revision FROM analyses WHERE id=${result!.analysisId}`;
  const coverage=row!.output.coverage;
  assert.equal(coverage.complete,true);
  assert.equal(coverage.bodyChars,full.length);
  assert.equal(coverage.segments[0].start,0);
  assert.equal(coverage.segments.at(-1).end,full.length);
  assert.equal(row!.receipt_ids.length,coverage.receiptIds.length+5);
  const receipts=await sql`SELECT status FROM receipts WHERE id=ANY(${row!.receipt_ids})`;
  assert.ok(receipts.every(r=>r.status==='completed'));
  assert.equal(prompts.length,5);
  for(const prompt of prompts) {assert.ok(prompt.includes(tail));assert.ok(prompt.includes('证据摘录'));assert.ok(!prompt.includes('完整正文'));}
  const [article]=await sql`SELECT body_text,published_at,revision FROM articles WHERE id=${articleId}`;
  assert.equal(article!.body_text,full);
  assert.equal(article!.published_at.toISOString(),input.publishedAt.toISOString());
  assert.equal(article!.revision,row!.input_revision);
  assert.equal(row!.output.fact.evidence,tail,'late evidence remains grounded in both pack and original');
});

test('a body revision during chunk scanning leaves the old covered judgement stale',async()=>{
  const input=material('stale'),{articleId}=await upsertMaterial(input);
  changeRevision=async()=>{await upsertMaterial({...input,title:'已纠正指南',bodyText:'此修订已替换原文。'});};
  const result=await analyzeArticle(articleId);
  assert.equal(result!.stale,true);
  const [row]=await sql`SELECT body_text,revision,processing_state FROM articles WHERE id=${articleId}`;
  assert.equal(row!.body_text,'此修订已替换原文。');
  assert.equal(row!.processing_state,'new');
  const [analysis]=await sql`SELECT input_revision,output FROM analyses WHERE id=${result!.analysisId}`;
  assert.ok(analysis!.input_revision<row!.revision);
  assert.equal(analysis!.output.coverage.bodyChars,full.length);
});
