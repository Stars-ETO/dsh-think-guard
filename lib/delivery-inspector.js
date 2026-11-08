// Read-only, bounded inspection of user-selected deliverables. Never executes
// document macros, shell commands or embedded scripts, and never writes output.
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, extname, basename } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { Worker } from 'node:worker_threads'

const MAX_FILE = 16 * 1024 * 1024
const MAX_XML = 4 * 1024 * 1024
const MAX_TOTAL = 12 * 1024 * 1024
const MAX_TEXT = 24000
const DOCUMENT_EXTENSIONS = new Set(['.txt','.md','.csv','.tsv','.json','.yml','.yaml','.xml','.html','.htm','.js','.ts','.py','.c','.h','.cpp','.log','.pdf','.docx','.pptx','.xlsx'])
export const IMAGE_EXTENSIONS = new Set(['.png','.jpg','.jpeg','.webp','.gif'])
export const SUPPORTED_EXTENSIONS = new Set([...DOCUMENT_EXTENSIONS, ...IMAGE_EXTENSIONS, '.doc','.ppt','.xls'])

export function pathsInText(text) {
  const out=[]; const source=String(text || '')
  // Paths are explicitly named in the user request; no directory crawling.
  const extensions='(?:png|jpe?g|webp|gif|txt|md|csv|tsv|json|ya?ml|xml|html?|js|ts|py|c|h|cpp|log|pdf|docx?|pptx?|xlsx?)'
  const patterns=[new RegExp('["“‘`]'+'([^"”’`\\r\\n]+\\.'+extensions+')'+'["”’`]','gi'),new RegExp('(?:[A-Za-z]:[\\\\/]|/)[^\\r\\n"“”‘’`<>|?*]*?\\.'+extensions+'(?=$|[\\s，。；、,;:：)）])','gi'),new RegExp('(?:^|[\\s：:])((?:\\.{1,2}[\\\\/])?[\\w.\\-\\u4e00-\\u9fff]+(?:[\\\\/][\\w.\\-\\u4e00-\\u9fff]+)*\\.'+extensions+')(?=$|[\\s，。；、,;:：)）])','gi')]
  for(const pattern of patterns) for(const m of source.matchAll(pattern)) { const candidate=(m[1] || m[0]).trim(); if(candidate && !out.includes(candidate))out.push(candidate);if(out.length>=5)return out }
  // Absolute matches must win over a relative suffix of that same path.
  return out.filter((p,i)=>!out.some((other,j)=>i!==j && other.length>p.length && other.toLowerCase().endsWith(p.toLowerCase())))
}

export async function readScopedFile(cwd, target) {
  if(typeof target!=='string'||!target.trim()||target.includes('\0')) throw new Error('文件路径无效')
  const root=await realpath(cwd), lexical=resolve(cwd,target), inside=relative(root,lexical)
  if(inside==='..'||inside.startsWith('..'+sep)||isAbsolute(inside)) throw new Error('文件位于工作区外；当前检查只读取工作区内文件')
  const path=await realpath(lexical), rel=relative(root,path)
  if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)) throw new Error('文件链接指向工作区外，已拒绝读取')
  const info=await stat(path)
  if(!info.isFile())throw new Error('目标不是普通文件')
  if(info.size>MAX_FILE)throw new Error('文件超过 16 MB 的只读检查上限')
  const bytes=await readFile(path)
  if(bytes.length>MAX_FILE)throw new Error('文件超过 16 MB 的只读检查上限')
  return {path,bytes,ext:extname(path).toLowerCase(),display:rel||target}
}

function xmlText(xml) {
  return String(xml).replace(/<w:tab\b[^>]*\/?\s*>/g,'\t').replace(/<(?:w:br|a:br)\b[^>]*\/?\s*>/g,'\n').replace(/<\/(?:w:p|a:p|row)>/g,'\n').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
    const named={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}; if(named[entity])return named[entity]
    const n=entity[2]?.toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10)
    return Number.isInteger(n)&&n>0&&n<=0x10ffff?String.fromCodePoint(n):'�'
  }).replace(/\n{3,}/g,'\n\n').trim()
}

function zipEntries(data) {
  let end=-1; for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50){end=i;break}
  if(end<0)throw new Error('Office 文档不是有效的 ZIP 容器')
  const count=data.readUInt16LE(end+10), size=data.readUInt32LE(end+12), start=data.readUInt32LE(end+16)
  if(count===65535||count>5000||start+size>end)throw new Error('Office 容器过大或使用不支持的 ZIP64 格式')
  let cursor=start,total=0; const entries=[]
  for(let i=0;i<count;i++){
    if(cursor+46>data.length||data.readUInt32LE(cursor)!==0x02014b50)throw new Error('Office 容器目录损坏')
    const flags=data.readUInt16LE(cursor+8),method=data.readUInt16LE(cursor+10),compressed=data.readUInt32LE(cursor+20),uncompressed=data.readUInt32LE(cursor+24),nl=data.readUInt16LE(cursor+28),el=data.readUInt16LE(cursor+30),cl=data.readUInt16LE(cursor+32),offset=data.readUInt32LE(cursor+42)
    if(cursor+46+nl+el+cl>data.length)throw new Error('Office 容器目录损坏')
    const name=data.subarray(cursor+46,cursor+46+nl).toString('utf8');cursor+=46+nl+el+cl
    entries.push({name,flags,method,compressed,uncompressed,offset})
  }
  function readBytes(entry){
    if(entry.flags&1)throw new Error('不支持加密的 Office 文档')
    if(entry.uncompressed>MAX_XML||(total+=entry.uncompressed)>MAX_TOTAL)throw new Error('文档解压内容超过安全上限')
    if(entry.offset+30>data.length||data.readUInt32LE(entry.offset)!==0x04034b50)throw new Error('Office 容器数据损坏')
    const pos=entry.offset+30+data.readUInt16LE(entry.offset+26)+data.readUInt16LE(entry.offset+28)
    if(pos+entry.compressed>data.length)throw new Error('Office 容器数据不完整')
    const bytes=data.subarray(pos,pos+entry.compressed)
    const result=entry.method===0?bytes:entry.method===8?inflateRawSync(bytes,{maxOutputLength:MAX_XML}):null
    if(!result||result.length!==entry.uncompressed)throw new Error('Office 容器压缩格式不支持或内容损坏')
    return result
  }
  return {entries,read:entry=>readBytes(entry).toString('utf8'),readBytes}
}

function officeText(file) {
  const zip=zipEntries(file.bytes), entries=zip.entries, warnings=[];let text=''
  if(file.ext==='.docx'){
    const parts=entries.filter(e=>/^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(e.name)).sort((a,b)=>a.name==='word/document.xml'?-1:b.name==='word/document.xml'?1:a.name.localeCompare(b.name))
    if(!parts.some(e=>e.name==='word/document.xml'))throw new Error('找不到 Word 正文')
    text=parts.map(e=>`【${e.name}】\n${xmlText(zip.read(e))}`).join('\n\n')
    warnings.push('仅提取正文及页眉页脚文字；不代表检查了页面排版、图表或图片')
  } else if(file.ext==='.pptx'){
    const parts=entries.filter(e=>/^ppt\/slides\/slide\d+\.xml$/i.test(e.name)).sort((a,b)=>Number(a.name.match(/slide(\d+)/i)[1])-Number(b.name.match(/slide(\d+)/i)[1]))
    if(!parts.length)throw new Error('找不到 PPT 幻灯片文字')
    text=parts.slice(0,80).map(e=>`【第 ${e.name.match(/slide(\d+)/i)[1]} 页】\n${xmlText(zip.read(e))}`).join('\n\n')
    warnings.push('仅提取幻灯片文本；未检查视觉布局、图表或图片'+(parts.length>80?'，只读取前 80 页':''))
  } else {
    const shared=entries.find(e=>e.name==='xl/sharedStrings.xml'), strings=shared?Array.from(zip.read(shared).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g),m=>xmlText(m[1])):[]
    const sheets=entries.filter(e=>/^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}))
    if(!sheets.length)throw new Error('找不到 Excel 工作表')
    text=sheets.slice(0,20).map(e=>{
      const xml=zip.read(e), cells=[]
      for(const m of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){
        const ref=/\br="([^"]+)"/.exec(m[1])?.[1]||'?',type=/\bt="([^"]+)"/.exec(m[1])?.[1]||'',value=/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(m[2])?.[1],formula=/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(m[2])?.[1]
        const v=type==='s'?strings[Number(value)]??'':type==='inlineStr'?xmlText(m[2]):xmlText(value??'')
        if(v||formula)cells.push(`${ref}: ${v}${formula?' [公式: '+xmlText(formula)+']':''}`)
        if(cells.length>=1500)break
      }
      return `【${e.name}，最多 1500 个单元格】\n${cells.join('\n')}`
    }).join('\n\n')
    warnings.push('单元格按内部工作表编号列出；公式值可能是缓存值，未检查图表、样式及隐藏内容'+(sheets.length>20?'，只读取前 20 表':''))
  }
  if(entries.some(e=>/^(?:word|ppt|xl)\/media\//i.test(e.name)))warnings.push('文档包含嵌入媒体，文字提取未检查这些图片')
  return {text,warnings}
}

async function pdfText(file, signal, maxImages, detailed) {
  signal?.throwIfAborted?.()
  const worker=new Worker(new URL('./pdf-text-worker.js',import.meta.url),{workerData:{bytes:file.bytes,maxImages,maxText:detailed?120000:24000},stderr:true,resourceLimits:{maxOldGenerationSizeMb:256,stackSizeMb:4}})
  worker.stderr?.resume()
  let onAbort
  try {
    return await new Promise((resolve,reject)=>{
      let settled=false
      const timeout=setTimeout(()=>finish(reject,new Error('PDF 文字提取超过 20 秒，已停止')),20000)
      const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timeout);signal?.removeEventListener?.('abort',onAbort);fn(value)}
      onAbort=()=>finish(reject,new Error('PDF 检查已取消'))
      if(signal?.aborted){onAbort();return}
      signal?.addEventListener?.('abort',onAbort,{once:true})
      worker.once('message',result=>result?.ok?finish(resolve,result):finish(reject,new Error(result?.error||'PDF 文字提取失败')))
      worker.once('error',()=>finish(reject,new Error('PDF 解析组件不可用')))
      worker.once('exit',()=>finish(reject,new Error('PDF 解析组件未返回结果')))
    })
  } finally {await worker.terminate()}
}

export async function inspectDocument(file, signal, options = {}) {
  signal?.throwIfAborted?.()
  if(!DOCUMENT_EXTENSIONS.has(file.ext))throw new Error('暂不支持此文档格式；请提供可读取的文本、PDF、DOCX、PPTX 或 XLSX')
  let result
  if(file.ext==='.pdf'){
    result=await pdfText(file,signal,Math.max(0,Math.min(3,Number(options.maxImages)||0)),options.detailed)
    result.images=(result.images||[]).map(image=>({path:`${file.path}#${image.name}`,display:`${file.display} 第 ${image.page} 页图片`,ext:'.png',bytes:Buffer.from(image.bytes)}))
  }
  else if(['.docx','.pptx','.xlsx'].includes(file.ext))result=officeText(file)
  else { if(file.bytes.includes(0))throw new Error('文件包含二进制数据，不能当作纯文本检查');result={text:new TextDecoder('utf-8',{fatal:true}).decode(file.bytes),warnings:[]} }
  const textLimit = options.detailed ? 120000 : MAX_TEXT
  if(result.text.length>textLimit){result.text=result.text.slice(0,textLimit)+'…';result.warnings.push(`文本超过 ${textLimit} 字符，已截断`)}
  if(!result.text.trim())result.warnings.push('未提取到可读文字，不能据此声称检查完毕')
  return result
}

export function extractOfficeImages(file, limit=3) {
  if(!['.docx','.pptx','.xlsx'].includes(file.ext))return {images:[],total:0,unsupported:0}
  const zip=zipEntries(file.bytes)
  const entries=zip.entries.filter(e=>/^(?:word|ppt|xl)\/media\//i.test(e.name) && !e.name.endsWith('/'))
  const supported=entries.filter(e=>IMAGE_EXTENSIONS.has(extname(e.name).toLowerCase()))
  const images=[]
  for(const entry of supported.slice(0,limit))images.push({path:`${file.path}#${basename(entry.name)}`,display:`${file.display} 内的 ${basename(entry.name)}`,ext:extname(entry.name).toLowerCase(),bytes:zip.readBytes(entry)})
  return {images,total:entries.length,unsupported:entries.length-supported.length}
}

async function assertImageRoute(llm, attachments, provider, model, signal) {
  if(!llm?.resolveModelInfo)throw new Error('当前 DSH 无法确认监察模型是否支持识图；未发送图片')
  let info
  try{info=await llm.resolveModelInfo(provider,model,signal)}catch{throw new Error('无法确认监察模型的图片输入能力；未发送图片')}
  if(!Array.isArray(info?.inputModalities)||!info.inputModalities.includes('image'))throw new Error('当前监察模型未声明支持识图；未发送图片，请切换支持图片输入的模型')
  if(!attachments)throw new Error('DSH 图片附件服务不可用；未发送图片')
}

export async function prepareExistingImage(ref, llm, attachments, provider, model, signal) {
  await assertImageRoute(llm, attachments, provider, model, signal)
  if(!ref?.attachmentId || !ref?.mediaType || !Number.isFinite(ref.width) || !Number.isFinite(ref.height))throw new Error('图片附件引用不完整；未发送图片')
  return {type:'image',attachment:ref}
}

export async function prepareImage(file, llm, attachments, provider, model, signal) {
  if(!IMAGE_EXTENSIONS.has(file.ext))throw new Error('不支持此图片格式；支持 PNG、JPEG、WebP 和 GIF')
  await assertImageRoute(llm, attachments, provider, model, signal)
  if(!attachments?.saveImage)throw new Error('DSH 图片附件服务不可用；未发送图片')
  const b=file.bytes
  const media=b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':b.length>=6&&/^GIF8[79]a$/.test(b.subarray(0,6).toString('ascii'))?'image/gif':b.length>=12&&b.subarray(0,4).toString('ascii')==='RIFF'&&b.subarray(8,12).toString('ascii')==='WEBP'?'image/webp':''
  const expected={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}[file.ext]
  if(!media||media!==expected)throw new Error('图片格式与文件内容不一致或文件损坏；未发送图片')
  signal?.throwIfAborted?.()
  // DSH normalizes and stores an attachment copy; the original file is never changed.
  const ref=await attachments.saveImage({data:b,mediaType:media,name:basename(file.path)})
  signal?.throwIfAborted?.()
  if(!ref?.attachmentId||!ref.mediaType)throw new Error('DSH 未能创建图片附件；未发送图片')
  return {type:'image',attachment:ref}
}
