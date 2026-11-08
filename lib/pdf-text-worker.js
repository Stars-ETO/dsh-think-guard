// Dedicated worker keeps PDF.js compatibility globals away from the DSH host.
// Extract text and bounded embedded raster images; no page rendering or scripts.
import { parentPort, workerData } from 'node:worker_threads'
import { deflateSync } from 'node:zlib'
globalThis.DOMMatrix ||= class DOMMatrix { constructor() {} }

// Convert only decoded pixel buffers from PDF.js into PNG in memory. Unsupported
// masks / large images are skipped rather than invoking a renderer or shell.
function crc32(bytes) { let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^(0xedb88320&-(crc&1))}return (crc^0xffffffff)>>>0 }
function pngChunk(type,data){const name=Buffer.from(type),out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);return out}
function encodePng(image,kinds){
  const {width,height,kind,data}=image||{}
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<32||height<32||width*height>4194304||!data)return null
  const components=kind===kinds.RGB_24BPP?3:kind===kinds.RGBA_32BPP?4:0
  if(!components||data.length!==width*height*components)return null
  const row=width*components,scan=Buffer.alloc((row+1)*height)
  for(let y=0;y<height;y++)Buffer.from(data.buffer,data.byteOffset+y*row,row).copy(scan,y*(row+1)+1)
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=components===3?2:6
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(scan,{level:6})),pngChunk('IEND',Buffer.alloc(0))])
  return png.length<=4*1024*1024?png:null
}
try {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href
  const task = pdfjs.getDocument({ data:new Uint8Array(workerData.bytes), disableFontFace:true, useSystemFonts:false, isEvalSupported:false, stopAtErrors:true, standardFontDataUrl:new URL('../vendor/pdfjs/standard_fonts/',import.meta.url).href, cMapUrl:new URL('../vendor/pdfjs/cmaps/',import.meta.url).href, cMapPacked:true })
  let doc
  try {
    doc=await task.promise; const pages=[],images=[];let empty=0,readPages=0,totalChars=0,skippedImages=0
    for(let i=1;i<=Math.min(doc.numPages,20);i++){
      const page=await doc.getPage(i), content=await page.getTextContent()
      const text=content.items.map(x=>typeof x.str==='string'?x.str:'').join(' ').trim()
      if(!text)empty++;readPages++;totalChars+=text.length
      if(workerData.maxImages>images.length){
        try {
          const ops=await page.getOperatorList()
          for(let j=0;j<ops.fnArray.length;j++){
            if(![pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject].includes(ops.fnArray[j]))continue
            if(images.length>=workerData.maxImages){skippedImages++;continue}
            try { const arg=ops.argsArray[j]?.[0], image=typeof arg==='string'?page.objs.get(arg):arg, png=encodePng(image,pdfjs.ImageKind);if(png)images.push({name:`page-${i}-image-${images.length+1}.png`,page:i,bytes:png});else skippedImages++ } catch {skippedImages++}
          }
        } catch { skippedImages++ }
      }
      pages.push(`【第 ${i} 页】\n${text||'（无可提取文字，可能为扫描页或图片）'}`);page.cleanup()
      if(totalChars >= (workerData.maxText || 24000)) break
    }
    parentPort.postMessage({ok:true,text:pages.join('\n\n'),images,warnings:[`PDF 共 ${doc.numPages} 页，本次提取 ${readPages} 页的可选文字；只尝试提取部分嵌入图片，未检查其余图片、页面整体排版和矢量图`,...(empty?[`${empty} 页无可提取文字，可能需要识图或 OCR`]:[]),...(skippedImages?['部分嵌入图片无法提取或超过上限，未检查']:[])]})
  } finally {if(doc)await doc.destroy();else await task.destroy()}
} catch(error) { parentPort.postMessage({ok:false,error:error?.name==='PasswordException'?'PDF 已加密或需要密码，无法读取':'PDF 文字提取失败，可能损坏或不受支持'}) }
