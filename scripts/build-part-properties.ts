/**
 * Derive a part-property table from the LDraw library and the LDCad shadow
 * library, and write it to data/part-properties.json.
 *
 * Six rules are blocked on knowing things about parts that the model file does
 * not say: L-10 and G-01 need tile-versus-plate, L-05 needs bore sizes, L-06
 * needs travel stops, L-08 needs materials, L-01 needs part classes. This
 * table supplies what is genuinely derivable and says plainly what is not --
 * see the `notDerivable` block it writes.
 *
 * The important choice here is deriving tile-versus-plate from CONNECTIVITY
 * rather than from the part's name. A tile is a part with no top studs; that
 * is what the rule is about, and the shadow data states it directly. Matching
 * on a description beginning "Tile" would instead trust a naming convention
 * that T-01 already records as unreliable, and would miss every part that
 * behaves like a tile without being called one.
 *
 * Run: npm run build && node dist/scripts/build-part-properties.js
 */
import { writeFile } from "node:fs/promises";
import { collectSnapMetas } from "../src/connect/closure.js";
import { metasToHotspots } from "../src/connect/hotspots.js";
import { openShadowLibrary } from "../src/connect/shadow.js";
import { LibraryIndex } from "../src/library/index.js";

const STUD_RADIUS = 6;
const RADIUS_TOL = 0.5;
/** A System stud is 4 LDU tall; the section depth separates it from a boss. */
const STUD_HEIGHT = 4;
const HEIGHT_TOL = 0.5;

interface PartProperties {
  desc: string;
  category: string;
  /** Male System studs on the part. 0 with a studded underside means a tile. */
  topStuds: number;
  /** Distinct female bore radii (LDU), ascending. L-05 reads these. */
  bores: number[];
  /** True when some bore is open at both ends -- a through-hole, not a socket. */
  throughBore: boolean;
}

async function main(): Promise<void> {
  const libraryRoot = process.env.LDRAW_DIR ?? ".cache/ldraw";
  const shadowDir = process.env.LDCAD_SHADOW_DIR;
  if (!shadowDir) throw new Error("LDCAD_SHADOW_DIR must be set: the shadow library is CC BY-SA and is never vendored");

  const lib = await LibraryIndex.fromDirectory(libraryRoot);
  const shadow = openShadowLibrary(shadowDir);

  const placeable = [...lib.all()].filter((p) => !p.isPrimitive && !p.isAlias && !p.isHidden);
  console.log(`indexed ${lib.size} files, ${placeable.length} placeable parts`);

  const parts: Record<string, PartProperties> = {};
  let done = 0;
  let withConnectivity = 0;
  for (const p of placeable) {
    let topStuds = 0;
    const bores = new Set<number>();
    let throughBore = false;
    try {
      const { metas } = await collectSnapMetas(p.id, lib, shadow);
      const hotspots = metasToHotspots(metas);
      if (hotspots.length > 0) withConnectivity++;
      for (const h of hotspots) {
        if (h.radius === undefined) continue;
        if (h.gender === "male") {
          if (
            Math.abs(h.radius - STUD_RADIUS) <= RADIUS_TOL &&
            h.sectionDepth !== undefined &&
            Math.abs(h.sectionDepth - STUD_HEIGHT) <= HEIGHT_TOL &&
            !h.slide
          ) {
            topStuds++;
          }
        } else {
          bores.add(Math.round(h.radius * 10) / 10);
          if (h.caps === "none") throughBore = true;
        }
      }
    } catch {
      // A part whose closure will not resolve gets name-derived fields only.
    }
    // Only parts the shadow library says something about. A part with no
    // studs and no bores carries no fact this table exists to record, and its
    // description is already on LibraryIndex at runtime -- emitting 6,200 such
    // entries would triple the file to restate what the caller already holds.
    if (topStuds > 0 || bores.size > 0) {
      parts[p.id] = {
        desc: p.description,
        category: p.description.trim().split(/\s+/)[0] ?? "",
        topStuds,
        bores: [...bores].sort((a, b) => a - b),
        throughBore,
      };
    }
    if (++done % 2000 === 0) console.log(`  ...${done}/${placeable.length}`);
  }

  const out = {
    source: { libraryFiles: lib.size, placeableParts: placeable.length, partsWithConnectivity: withConnectivity },
    notDerivable: {
      material:
        "L-08 (polycarbonate against polycarbonate) needs a material per part and colour. LDraw carries no material data at all -- this needs a BrickLink or Rebrickable join and cannot come from this library.",
      travelStop:
        "L-06 (press-fitting an element with no travel stop) needs to know whether a bore bottoms out. The shadow library records a bore's radius and whether it is capped, not how deep the shank may travel before it stops.",
      slopeAngle:
        "T-01 already records that slope part NAMES are systematically wrong. Measuring a real slope angle needs the part's mesh, not its header or its connection points.",
    },
    parts,
  };
  await writeFile("data/part-properties.json", JSON.stringify(out, null, 1));
  console.log(`wrote data/part-properties.json: ${Object.keys(parts).length} parts, ${withConnectivity} with connectivity`);
}

await main();
