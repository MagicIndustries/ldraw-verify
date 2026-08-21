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
