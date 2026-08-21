import type { LDrawDocument } from "../parse/ast.js";
import type { ConnectionGraph } from "../connect/graph.js";
import type { Mat4 } from "./matrix.js";

export interface Placement {
  index: number;
  partId: string;
  colour: number;
  world: Mat4;
  /**
   * This placement's OWN line matrix -- `fromLdraw(pos, mat)` from the
   * type-1 line, i.e. where the part sits relative to the block that
   * contains it, with no ancestor submodel transform composed in.
   *
   * `world` answers "where is this part in the finished model"; `local`
   * answers "what did the author write on this line". A rule whose claim
   * is about the part's relationship to the assembly it belongs to -- B-05
   * ("is this part square to its neighbours") -- must read `local`:
   * composing through a tilted ancestor (an angled roof section, a bogie
   * on curved track, a rotated decorative sub-assembly, all routine in
   * real released sets) turns that claim into the much stronger "is this
   * part square to the WORLD", which every part of every tilted
   * sub-assembly legitimately violates. A rule whose claim genuinely is
   * about world space -- E-02/E-04's grid alignment -- keeps reading
   * `world`, and reports `unknown` when the ancestor frame makes the
   * question undecidable.
   */
  local: Mat4;
  submodelPath: string[];
  file: string;
  line: number;
  /**
   * True when this placement's line sits inside a block LDCad marked with
   * `0 !LDCAD GENERATED [generator=...]` -- the auto-generated fallback
   * geometry for a `!LDCAD CONTENT [type=path]` flexible element (cables,
   * hoses, Technic chains/treads: see `0 !KEYWORDS flexible, chain` on the
   * corpus's own real files). LDCad's path system approximates a curve by
   * chaining many small rigid segments, each individually sheared/scaled to
   * follow the curve -- e.g. a real `technicChainTread38Closed` block in
   * the OMR corpus, whose own header reads "Do not edit, any changes will
   * be lost upon regeneration". That is a deliberate, tool-documented
   * distortion of an element that is physically flexible, not a
   * transposed/sheared-by-mistake matrix, so a matrix well-formedness check
   * (E-01) cannot treat non-orthonormality here as evidence of anything --
   * see `src/rules/l2-matrix.ts`.
   */
  generatedFlexPath?: boolean;
}

export interface UnresolvedRef {
  name: string;
  file: string;
  line: number;
}

export interface ResolvedModel {
  document: LDrawDocument;
  placements: Placement[];
  unresolved: UnresolvedRef[];
  cycles: string[][];
  graph?: ConnectionGraph;
}
