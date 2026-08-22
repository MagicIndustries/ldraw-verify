import { LibraryIndex } from "/Users/tobytremayne/work/ldraw-verify/dist/src/library/index.js";
import { parseDocument } from "/Users/tobytremayne/work/ldraw-verify/dist/src/parse/document.js";
import { resolveModel } from "/Users/tobytremayne/work/ldraw-verify/dist/src/resolve/resolve.js";
import { buildGraph } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/graph.js";
import { openShadowLibrary } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/shadow.js";
import { collectSnapMetas } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/closure.js";
import { metasToHotspots } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/hotspots.js";
import { applyPoint } from "/Users/tobytremayne/work/ldraw-verify/dist/src/resolve/matrix.js";
const TECHNIC_HOLE_PARTS=new Set(JSON.parse(await (await import("node:fs/promises")).readFile("/Users/tobytremayne/work/ldraw-verify/data/part-classes.json","utf8")).technicHole.map(x=>x.toLowerCase()));
import { readFile } from "node:fs/promises";
const lib=await LibraryIndex.fromDirectory("/Users/tobytremayne/work/ldraw-verify/.cache/ldraw");
const sh=openShadowLibrary(process.env.LDCAD_SHADOW_DIR);
const hits=JSON.parse(await readFile("/tmp/b01-hits.json","utf8")).hits;
const cache=new Map();
async function hot(p){if(!cache.has(p)){const{metas}=await collectSnapMetas(p,lib,sh);cache.set(p,metasToHotspots(metas));}return cache.get(p);}
// warm the part-class list the same way the rule does
const {} = {};
let genuine=0, misattributed=0; const ex=[];
for(const h of hits){
  const m=resolveModel(parseDocument(await readFile(`/Users/tobytremayne/work/ldraw-verify/.cache/omr/${h.file}`,"utf8"),h.file),lib);
  const g=await buildGraph(m,lib,sh);
  const seen=new Set();
  for(const e of g.edges){
    if(e.radius===undefined||Math.abs(e.radius-6)>0.5) continue;
    if(e.femaleCaps!=="none"||e.maleSlide) continue;
    const pa=m.placements[e.a], pb=m.placements[e.b];
    if(!pa||!pb) continue;
    const target=[pa,pb].find(p=>TECHNIC_HOLE_PARTS.has(p.partId.toLowerCase()));
    if(!target) continue;
    const key=`${e.a}|${e.b}|${e.at.map(v=>Math.round(v)).join(",")}`;
    if(seen.has(key)) continue; seen.add(key);
    // which placement owns a caps=none r~6 female hotspot AT this point?
    let owner=null;
    for(const p of [pa,pb]) for(const hs of await hot(p.partId)){
      if(hs.gender!=="female"||hs.caps!=="none") continue;
      if(hs.radius===undefined||Math.abs(hs.radius-6)>0.5) continue;
      const w=applyPoint(p.world,hs.pos);
      if(Math.hypot(w[0]-e.at[0],w[1]-e.at[1],w[2]-e.at[2])<1.2){owner=p;break;}
    }
    if(owner && owner.partId===target.partId){genuine++; console.log(`GENUINE: ${h.file}  ${pa.partId} <-> ${pb.partId}  hole on ${target.partId} at [${e.at.map(v=>Math.round(v))}]`);}
    else {misattributed++; if(ex.length<5) ex.push(`${h.file}: blamed ${target.partId}, but the caps=none bore belongs to ${owner?owner.partId:"(unresolved)"}`);}
  }
}
console.log(ex.join("\n"));
console.log(`\nhole genuinely on the Technic part: ${genuine}`);
console.log(`bore belongs to the OTHER part (misattributed): ${misattributed}`);
