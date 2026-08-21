import type { Vec3 } from "../parse/ast.js";

export interface GridExpansion {
  offsets: Vec3[];
  /**
   * True when `attrs.grid` was present but did not parse as the two-axis
   * form this function implements, so `offsets` is the single `[0,0,0]`
   * fallback rather than a real expansion — most commonly the undocumented
   * three-axis extension (see below). False whenever there's nothing to
   * report: no `grid=` attribute at all, or a `grid=` that parsed cleanly.
   */
  degraded: boolean;
}

/**
 * Expand an LDCad `grid=` attribute into one local-frame X/Z offset per grid
 * cell, reporting whether the expansion is complete.
 *
 * Token forms handled: the two-axis form `[C]<nx> [C]<nz> <dx> <dz>` (4, 5,
 * or 6 space-separated tokens depending on how many axes carry a `C`
 * prefix). Confirmed against the real shadow library: 84 of 91 `grid=`
 * values on real `SNAP_INCL` lines use this form. Each of `nx`/`nz` may
 * carry a `C` prefix marking that axis as centred. A centred axis's
 * instances run symmetrically about the origin (e.g. `nx=2` centred with
 * `dx=20` yields offsets `-10, 10`); an uncentred axis runs from 0 upward in
 * steps of the delta (`nx=2` uncentred with `dx=20` yields `0, 20`).
 *
 * Token forms NOT handled: a three-axis extension (an extra Y count/delta
 * pair, `[C]<nx> [C]<ny> [C]<nz> <dx> <dy> <dz>`, 6-8 tokens depending on
 * `C` usage) accounts for the remaining 7 of 91 real `grid=` values. Its
 * geometry — in particular how the Y axis is meant to compose with the
 * X/Z cells produced here — is unverifiable: no authoritative `grid=`
 * specification exists in the shadow library or anywhere else available,
 * so implementing it would mean guessing. This tool's central design
 * principle is that nothing detected may be silently discarded, so rather
 * than guess, this (and anything else that doesn't cleanly parse as the
 * two-axis form) falls back to the single `[0,0,0]` no-op offset with
 * `degraded: true` — the returned `GridExpansion` lets a caller detect and
 * surface the drop (see `PlacedMeta.gridDegraded` and
 * `ClosureResult.degradedGridCount` in `closure.ts`) instead of the caller
 * silently losing cells.
 */
export function expandGridWithStatus(attrs: Record<string, string>): GridExpansion {
  const raw = attrs.grid;
  if (raw === undefined) return { offsets: [[0, 0, 0]], degraded: false };

  const tokens = raw.trim().split(/\s+/);
  let i = 0;

  function readAxis(): { count: number; centered: boolean } | undefined {
    let centered = false;
    if (tokens[i] === "C") {
      centered = true;
      i++;
    }
    const tok = tokens[i];
    if (tok === undefined) return undefined;
    const count = Number(tok);
    if (!Number.isFinite(count)) return undefined;
    i++;
    return { count, centered };
  }

  const nx = readAxis();
  const nz = readAxis();
  const dxTok = tokens[i];
  const dzTok = tokens[i + 1];
  if (nx === undefined || nz === undefined || dxTok === undefined || dzTok === undefined) {
    return { offsets: [[0, 0, 0]], degraded: true };
  }
  const dx = Number(dxTok);
  const dz = Number(dzTok);
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return { offsets: [[0, 0, 0]], degraded: true };

  // Require the two-axis form to consume every token; anything left over
  // (the three-axis extension, or garbage) isn't handled here.
  if (i + 2 !== tokens.length) return { offsets: [[0, 0, 0]], degraded: true };

  const xOffsets = axisOffsets(nx.count, nx.centered, dx);
  const zOffsets = axisOffsets(nz.count, nz.centered, dz);

  const out: Vec3[] = [];
  for (const z of zOffsets) {
    for (const x of xOffsets) {
      out.push([x, 0, z]);
    }
  }
  return { offsets: out, degraded: false };
}

/**
 * Convenience wrapper over `expandGridWithStatus` for callers that only
 * need the offsets, not degraded-expansion status. Kept as its own export
 * (rather than folded away) so existing and future callers that don't need
 * to track degradation keep a plain `Vec3[]` signature.
 */
export function expandGrid(attrs: Record<string, string>): Vec3[] {
  return expandGridWithStatus(attrs).offsets;
}

function axisOffsets(count: number, centered: boolean, step: number): number[] {
  const n = Math.max(1, Math.round(count));
  const offsets: number[] = [];
  if (centered) {
    const start = -((n - 1) / 2) * step;
    for (let k = 0; k < n; k++) offsets.push(start + k * step);
  } else {
    for (let k = 0; k < n; k++) offsets.push(k * step);
  }
  return offsets;
}
