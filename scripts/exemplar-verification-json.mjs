import { LibraryIndex } from "/Users/tobytremayne/work/ldraw-verify/dist/src/library/index.js";
import { parseDocument } from "/Users/tobytremayne/work/ldraw-verify/dist/src/parse/document.js";
import { resolveModel } from "/Users/tobytremayne/work/ldraw-verify/dist/src/resolve/resolve.js";
import { buildGraph } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/graph.js";
import { openShadowLibrary } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/shadow.js";
import { verifyFile } from "/Users/tobytremayne/work/ldraw-verify/dist/src/verify.js";
import { readFile, readdir, writeFile } from "node:fs/promises";
const DIR="/Users/tobytremayne/work/ldraw-verify/test/fixtures/canon";
const lib=await LibraryIndex.fromDirectory("/Users/tobytremayne/work/ldraw-verify/.cache/ldraw");
const sh=openShadowLibrary(process.env.LDCAD_SHADOW_DIR);
const out={};
for(const f of (await readdir(DIR)).filter(f=>f.endsWith(".ldr")).sort()){
  const [id,kind]=f.split(".");
  const doc=parseDocument(await readFile(`${DIR}/${f}`,"utf8"),f);
  const m=resolveModel(doc,lib); const g=await buildGraph(m,lib,sh);
  const res=await verifyFile(`${DIR}/${f}`,{libraryRoot:"/Users/tobytremayne/work/ldraw-verify/.cache/ldraw",shadowDir:process.env.LDCAD_SHADOW_DIR});
  const fails=[...new Set(res.findings.filter(x=>x.status==="fail").map(x=>x.ruleId))];
  (out[id] ??= {})[kind]={parts:m.placements.length,edges:g.edges.length,comps:g.components,fails,own:fails.includes(id)};
}
await writeFile("/tmp/lego-viz/verification.json",JSON.stringify(out,null,1));
console.log("wrote",Object.keys(out).length,"rules");
