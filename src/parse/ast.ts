export type Vec3 = readonly [number, number, number];
/** Row-major 3x3: (a,b,c) is the FIRST ROW. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export interface SubfileRef {
  kind: "subfile";
  colour: number;
  pos: Vec3;
  mat: Mat3;
  name: string;
  line: number;
}

export interface MetaLine {
  kind: "meta";
  text: string;
  line: number;
}

export interface GeomLine {
  kind: "geom";
  lineType: 2 | 3 | 4 | 5;
  colour: number;
  coords: number[];
  line: number;
}

export type LDrawLine = SubfileRef | MetaLine | GeomLine;

export interface ParseError {
  kind: "error";
  line: number;
  code: string;
  message: string;
}

export interface Block {
  name: string;
  lines: LDrawLine[];
  startLine: number;
}

export interface LDrawDocument {
  path: string;
  blocks: Block[];
  errors: ParseError[];
}

/** Number of numeric coordinates required after the colour, per line type. */
export const GEOM_COORD_COUNT: Record<2 | 3 | 4 | 5, number> = { 2: 6, 3: 9, 4: 12, 5: 12 };
