import { LibraryIndex } from "/Users/tobytremayne/work/ldraw-verify/dist/src/library/index.js";
import { parseDocument } from "/Users/tobytremayne/work/ldraw-verify/dist/src/parse/document.js";
import { resolveModel } from "/Users/tobytremayne/work/ldraw-verify/dist/src/resolve/resolve.js";
import { buildGraph } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/graph.js";
import { openShadowLibrary } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/shadow.js";
import { collectSnapMetas } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/closure.js";
import { metasToHotspots } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/hotspots.js";
import { applyPoint, applyDir } from "/Users/tobytremayne/work/ldraw-verify/dist/src/resolve/matrix.js";
import { readFile, readdir } from "node:fs/promises";
const DIR="/Users/tobytremayne/work/ldraw-verify/test/fixtures/canon";
const lib=await LibraryIndex.fromDirectory("/Users/tobytremayne/work/ldraw-verify/.cache/ldraw");
const sh=openShadowLibrary(process.env.LDCAD_SHADOW_DIR);
const files=process.argv.slice(2).length?process.argv.slice(2):(await readdir(DIR)).filter(f=>f.endsWith(".ldr")).sort();
const d=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const cache=new Map();
async function hot(part){ if(!cache.has(part)){const{metas}=await collectSnapMetas(part,lib,sh);cache.set(part,metasToHotspots(metas));} return cache.get(part); }
for(const f of files){
  const doc=parseDocument(await readFile(`${DIR}/${f}`,"utf8"),f);
  const m=resolveModel(doc,lib);
  const g=await buildGraph(m,lib,sh);
  const all=[];
  for(let i=0;i<m.placements.length;i++){
    const p=m.placements[i];
    for(const h of await hot(p.partId)) all.push({i,part:p.partId,gender:h.gender,pos:applyPoint(p.world,h.pos),axis:applyDir(p.world,h.axis)});
  }
  const linked=new Set(); for(const e of g.edges){linked.add(e.a);linked.add(e.b);}
  const out=[];
  for(let i=1;i<m.placements.length;i++){
    if(linked.has(i)){out.push(`p${i} PAIRED`);continue;}
    let best=null;
    for(const h of all.filter(x=>x.i===i)) for(const o of all){
      if(o.i>=i||o.gender===h.gender) continue;
      const gap=d(h.pos,o.pos); if(!best||gap<best.gap) best={gap,h,o};
    }
    out.push(best?`p${i} ${m.placements[i].partId.replace(".dat","")} ${best.gap.toFixed(1)}LDU adrift`:`p${i} no candidate`);
  }
  console.log(`${f.replace(".ldr","").padEnd(15)} e=${String(g.edges.length).padEnd(3)} ${out.join(" | ")}`);
}
