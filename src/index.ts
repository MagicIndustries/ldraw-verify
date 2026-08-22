/**
 * The library surface. `src/cli.ts` is the command-line entry point; this is
 * what another package gets when it imports `ldraw-verify`.
 *
 * Deliberately narrow. It exposes the pipeline (parse, resolve, connect,
 * verify) and the types needed to read a result, and nothing about how
 * individual rules are written -- a consumer that needs to reach past this is
 * a signal the surface is wrong, not that it should import from `dist/src/...`
 * directly.
 */
export { parseDocument } from "./parse/document.js";
export { resolveModel } from "./resolve/resolve.js";
export { LibraryIndex } from "./library/index.js";
export { buildGraph } from "./connect/graph.js";
export { openShadowLibrary } from "./connect/shadow.js";
export { collectSnapMetas } from "./connect/closure.js";
export { metasToHotspots } from "./connect/hotspots.js";
export { Verifier, verifyFile, exitCodeFor, ALL_RULES } from "./verify.js";
export * from "./resolve/matrix.js";

export type { Placement, ResolvedModel } from "./resolve/ir.js";
export type { ConnectionGraph, Edge, StudFootprint } from "./connect/graph.js";
export type { Hotspot } from "./connect/hotspots.js";
export type { ShadowLibrary } from "./connect/shadow.js";
export type { LibraryPart } from "./library/index.js";
export type { Finding, Rule, RuleMeta, RuleKind, RuleDomain, Tier, VerifyResult } from "./rules/types.js";
export type { VerifyOptions } from "./verify.js";
