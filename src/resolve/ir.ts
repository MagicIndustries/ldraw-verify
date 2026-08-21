import type { LDrawDocument } from "../parse/ast.js";
import type { ConnectionGraph } from "../connect/graph.js";
import type { Mat4 } from "./matrix.js";

export interface Placement {
  index: number;
  partId: string;
  colour: number;
  world: Mat4;
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
