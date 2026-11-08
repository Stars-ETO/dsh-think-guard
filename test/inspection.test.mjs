import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readScopedFile, inspectDocument, prepareImage } from '../lib/delivery-inspector.js'
import { apply } from '../lib/index.js'

test('read-only scope and model image capability', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'thinkguard-public-test-'))
  try {
    await writeFile(join(cwd, 'sample.txt'), 'Synthetic sample text')
    const file = await readScopedFile(cwd, 'sample.txt')
    assert.match((await inspectDocument(file)).text, /Synthetic sample/)
    await assert.rejects(() => readScopedFile(cwd, resolve(cwd, '..', 'outside.txt')), /工作区外/)
    let saves = 0
    const image = {ext:'.png', path:'test.png', bytes:Buffer.from([137,80,78,71,13,10,26,10,0])}
    const attachments = {saveImage:async()=>{saves++;return {attachmentId:'test',mediaType:'image/png',width:1,height:1}}}
    await assert.rejects(() => prepareImage(image,{resolveModelInfo:async()=>({inputModalities:['text']})},attachments,'p','m'), /未声明支持识图/)
    assert.equal(saves,0)
  } finally { await rm(cwd,{recursive:true,force:true}) }
})

test('detailed review segments content; failed image request retries text only', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'thinkguard-public-test-'))
  try {
    await writeFile(join(cwd,'long.txt'),'begin\n'+'A'.repeat(13000)+'\nend-marker')
    const cfg={enabled:true,mode:'observe',judge:{provider:'p',model:'m',maxTokens:3000,maxToolCalls:0,timeoutMs:45000},triggers:{heuristics:false,turnBoundary:false,everySteps:0,cooldownMs:0,maxReviewsPerTurn:3,boundaryTimeoutMs:12000},intervention:{severityThreshold:3,maxInterventionsPerTurn:1,maxChars:320,atTurnBoundary:false},scope:{toolResults:false,reasoningChars:900,maxAgeEvents:400,allowFileReads:true}}
    let rpc, requests=[], saves=0, injections=0
    const agent={id:'s',status:'running',options:{provider:'p',model:'m'},session:{header:{cwd}},inject(){injections++}}
    const llm={async resolveModelInfo(){return {inputModalities:['text','image']}},async *stream(req){requests.push(req);if(req.messages[0].content.some(x=>x.type==='image'))throw Error('synthetic vision failure');yield {type:'text-delta',text:req.system.includes('分段只读')?'segment inspected':'text review'};yield {type:'finish',reason:{kind:'stop'}}}}
    const attachments={async saveImage({mediaType}){saves++;return {attachmentId:'test',mediaType,bytes:9,width:1,height:1}}}
    const ctx={get:k=>({llm,attachments,agents:{list:()=>[agent]}}[k]),on:()=>()=>{},effect:f=>f(),inject:(_d,f)=>f({connection:{rpc:{handle:(_c,fn)=>{rpc=fn;return ()=>{}}}},webServer:{register:()=>()=>{}}})}
    apply(ctx,cfg)
    const call=async(name,p={})=>{const r=await rpc(name,{sessionId:'s',...p});assert.equal(r.ok,true);return r.value}
    assert.equal((await call('set',{inspectionDepth:'detailed'})).inspectionDepth,'detailed')
    await call('chat',{text:'请检查 long.txt'})
    const segments=requests.filter(r=>r.system.includes('分段只读'))
    assert.equal(segments.length,2);assert.match(segments[1].messages[0].content[0].text,/end-marker/)
    assert.equal(requests.at(-1).maxTokens,4096)
    const view=await call('chat',{text:'请检查图片',images:[{name:'test.png',data:'data:image/png;base64,iVBORw0KGgoA'}]})
    assert.equal(saves,1);assert.equal(requests.at(-1).messages[0].content.filter(x=>x.type==='image').length,0)
    assert.match(requests.at(-1).messages[0].content[0].text,/图片请求失败/)
    assert.match(view.chat.map(x=>x.text).join('\n'),/图片未检查/);assert.equal(injections,0)
  } finally { await rm(cwd,{recursive:true,force:true}) }
})
