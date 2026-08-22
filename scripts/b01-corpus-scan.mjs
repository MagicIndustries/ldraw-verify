import { LibraryIndex } from "/Users/tobytremayne/work/ldraw-verify/dist/src/library/index.js";
import { parseDocument } from "/Users/tobytremayne/work/ldraw-verify/dist/src/parse/document.js";
import { resolveModel } from "/Users/tobytremayne/work/ldraw-verify/dist/src/resolve/resolve.js";
import { buildGraph } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/graph.js";
import { openShadowLibrary } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/shadow.js";
import { Registry } from "/Users/tobytremayne/work/ldraw-verify/dist/src/rules/registry.js";
import { ALL_RULES } from "/Users/tobytremayne/work/ldraw-verify/dist/src/verify.js";
import { readFile, readdir, writeFile } from "node:fs/promises";
const OMR="/Users/tobytremayne/work/ldraw-verify/.cache/omr";
const lib=await LibraryIndex.fromDirectory("/Users/tobytremayne/work/ldraw-verify/.cache/ldraw");
const sh=openShadowLibrary(process.env.LDCAD_SHADOW_DIR);
const reg=await Registry.create("/Users/tobytremayne/work/ldraw-verify/rules/lego-build-rules.yaml");
for(const r of ALL_RULES) reg.register(r);
const files=(await readdir(OMR)).filter(f=>/\.(mpd|ldr)$/i.test(f)).sort();
const hits=[]; let n=0,err=0;
for(const f of files){
  try{
    const m=resolveModel(parseDocument(await readFile(`${OMR}/${f}`,"utf8"),f),lib);
    m.graph=await buildGraph(m,lib,sh);
    const b=reg.run(m,lib).filter(x=>x.status==="fail"&&x.ruleId==="B-01");
    n++;
    if(b.length){
      const pairs=b.map(x=>x.message??"").map(s=>s.replace(/\s+/g," ").slice(0,110));
      hits.push({file:f,count:b.length,parts:m.placements.length,sample:pairs.slice(0,3)});
    }
  }catch(e){err++;}
  if(n%250===0) console.log(`  ...${n}/${files.length}  ${hits.length} models with B-01`);
}
await writeFile("/tmp/b01-hits.json",JSON.stringify({scanned:n,errors:err,total:files.length,hits},null,1));
console.log(`DONE scanned=${n} errors=${err} models_with_B01=${hits.length} firings=${hits.reduce((s,h)=>s+h.count,0)}`);
