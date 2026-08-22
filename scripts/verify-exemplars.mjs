import { LibraryIndex } from "/Users/tobytremayne/work/ldraw-verify/dist/src/library/index.js";
import { parseDocument } from "/Users/tobytremayne/work/ldraw-verify/dist/src/parse/document.js";
import { resolveModel } from "/Users/tobytremayne/work/ldraw-verify/dist/src/resolve/resolve.js";
import { buildGraph } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/graph.js";
import { openShadowLibrary } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/shadow.js";
import { verifyFile } from "/Users/tobytremayne/work/ldraw-verify/dist/src/verify.js";
import { readFile, readdir } from "node:fs/promises";
const DIR="/Users/tobytremayne/work/ldraw-verify/test/fixtures/canon";
const lib=await LibraryIndex.fromDirectory("/Users/tobytremayne/work/ldraw-verify/.cache/ldraw");
const sh=openShadowLibrary(process.env.LDCAD_SHADOW_DIR);
const files=(await readdir(DIR)).filter(f=>f.endsWith(".ldr")).sort();
const rows=[];
for (const f of files){
  const id=f.split(".")[0], kind=f.split(".")[1];
  const doc=parseDocument(await readFile(`${DIR}/${f}`,"utf8"), f);
  const m=resolveModel(doc,lib);
  m.graph=await buildGraph(m,lib,sh);
  const res=await verifyFile(`${DIR}/${f}`,{libraryRoot:"/Users/tobytremayne/work/ldraw-verify/.cache/ldraw",shadowDir:process.env.LDCAD_SHADOW_DIR});
  const fails=res.findings.filter(x=>x.status==="fail").map(x=>x.ruleId);
  rows.push({file:f,id,kind,parts:m.placements.length,edges:m.graph.edges.length,
    comps:m.graph.components,cov:+(m.graph.coverage.ratio.toFixed(2)),fails,
    own:fails.includes(id), exit:res.exitCode});
}
const pad=(s,n)=>String(s).padEnd(n);
console.log(pad("exemplar",24)+pad("parts",6)+pad("edges",6)+pad("comp",5)+pad("cov",6)+pad("own?",6)+"fires");
for(const r of rows){
  const ok = r.kind==="illegal" ? (r.own?"YES":"--") : (r.own?"LEAK":"ok");
  console.log(pad(r.file.replace(".ldr",""),24)+pad(r.parts,6)+pad(r.edges,6)+pad(r.comps,5)+pad(r.cov,6)+pad(ok,6)+(r.fails.join(",")||"none"));
}
const ill=rows.filter(r=>r.kind==="illegal");
console.log(`\nillegal exemplars: ${ill.length} | firing own rule: ${ill.filter(r=>r.own).length}`);
const leaks=rows.filter(r=>r.kind==="legal"&&r.own);
console.log(`legal twins wrongly firing own rule: ${leaks.length}`);
