import { LibraryIndex } from "/Users/tobytremayne/work/ldraw-verify/dist/src/library/index.js";
import { openShadowLibrary } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/shadow.js";
import { collectSnapMetas } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/closure.js";
import { metasToHotspots } from "/Users/tobytremayne/work/ldraw-verify/dist/src/connect/hotspots.js";
const lib=await LibraryIndex.fromDirectory("/Users/tobytremayne/work/ldraw-verify/.cache/ldraw");
const sh=openShadowLibrary(process.env.LDCAD_SHADOW_DIR);
for(const p of process.argv.slice(2)){
  const {metas}=await collectSnapMetas(p,lib,sh);
  console.log(`== ${p}`);
  for(const h of metasToHotspots(metas)) console.log(`   ${h.gender.padEnd(6)} ${h.kind??"?"} pos=[${h.pos.map(v=>+v.toFixed(1))}] ax=[${h.axis.map(v=>+v.toFixed(1))}] r=${h.radius} caps=${h.caps} slide=${h.slide}`);
}
