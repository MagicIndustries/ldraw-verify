import type { LibraryIndex } from "../library/index.js";
import type { Vec3 } from "../parse/ast.js";
import type { ResolvedModel } from "../resolve/ir.js";

export type Tier = "HARD" | "DISCOURAGED" | "STYLE" | "LEGAL";
export type Status = "pass" | "fail" | "unknown" | "unimplemented" | "informational";
export type Need = "placements" | "graph" | "library" | "document";

export interface Location {
  file: string;
  line: number;
  partId?: string;
  world?: Vec3;
}

export interface Finding {
  ruleId: string;
  tier: Tier;
  status: Status;
  message: string;
  locations: Location[];
  evidence?: Record<string, unknown>;
}

export interface RuleMeta {
  id: string;
  name: string;
  tier: Tier;
  statement: string;
  check?: string;
}

export interface RuleContext {
  model: ResolvedModel;
  library: LibraryIndex;
  meta: RuleMeta;
}

export interface Rule {
  id: string;
  needs: Need[];
  run(ctx: RuleContext): Finding[];
}

export interface VerifyResult {
  findings: Finding[];
  coverage: number;
  exitCode: 0 | 1 | 2 | 3;
}
