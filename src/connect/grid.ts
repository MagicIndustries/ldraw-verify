import type { Vec3 } from "../parse/ast.js";

/**
 * Expand an LDCad `grid=` attribute into one local-frame X/Z offset per grid
 * cell.
 *
 * Syntax (confirmed against the real shadow library): `[C]<nx> [C]<nz> <dx>
 * <dz>`, where each of `nx`/`nz` may carry a `C` prefix marking that axis as
 * centred. A centred axis's instances run symmetrically about the origin
 * (e.g. `nx=2` centred with `dx=20` yields offsets `-10, 10`); an uncentred
 * axis runs from 0 upward in steps of the delta (`nx=2` uncentred with
 * `dx=20` yields `0, 20`).
 *
 * A small minority of real `grid=` values (~8% of the ones with `grid=`)
 * carry a third count/delta pair for a Y axis — a distinct, undocumented
 * extension outside this function's scope. Those (and anything else that
 * doesn't cleanly parse as the two-axis form) fall back to the single
 * `[0,0,0]` no-op offset rather than guessing, so a caller never silently
 * gets a wrong or partial expansion.
 */
export function expandGrid(attrs: Record<string, string>): Vec3[] {
  const raw = attrs.grid;
  if (raw === undefined) return [[0, 0, 0]];

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
    return [[0, 0, 0]];
  }
  const dx = Number(dxTok);
  const dz = Number(dzTok);
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return [[0, 0, 0]];

  // Require the two-axis form to consume every token; anything left over
  // (the rare three-axis extension) isn't handled here.
  if (i + 2 !== tokens.length) return [[0, 0, 0]];

  const xOffsets = axisOffsets(nx.count, nx.centered, dx);
  const zOffsets = axisOffsets(nz.count, nz.centered, dz);

  const out: Vec3[] = [];
  for (const z of zOffsets) {
    for (const x of xOffsets) {
      out.push([x, 0, z]);
    }
  }
  return out;
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
