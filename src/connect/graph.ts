import type { Vec3 } from "../parse/ast.js";

export interface Edge {
  a: number;
  b: number;
  kind: string;
  at: Vec3;
}

export interface ConnectionGraph {
  edges: Edge[];
  coverage: { withData: number; total: number; ratio: number };
  unknownPlacements: number[];
  components: number;
}
