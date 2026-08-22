# Rules testing — the corpus and rule catalogue

A self-contained page documenting every rule in the build-rules corpus and the test
corpora needed to verify them. Open `index.html` in a browser; it needs no server and
no network.

Published copy: <https://claude.ai/code/artifact/6084b149-7550-4a2d-bf43-88487d818a84>

## What is here

| Path | Contents |
|---|---|
| `index.html` | The page. 104 KB — assets load from `assets/`, not inlined. |
| `assets/renders/` | Rendered views of the 15 candidate corpus models |
| `assets/exemplars/` | Rendered illegal/legal pairs for 19 rules |
| `assets/meshes/` | Quantised geometry for the 7 rotatable models, one file each |
| `assets/three.iife.js` | The three.js bundle |
| `build/` | The scripts that generate all of the above |

### Why it works without a server

Nothing uses `fetch` or `XMLHttpRequest` — those are what browsers block on `file://`.
Images and the three.js bundle load through `src` attributes, and a model's geometry
is pulled in on demand by injecting a `<script>` tag, so opening `index.html` directly
from disk works. Verified over HTTP; the `file://` path follows from using no
network APIs, but has not been exercised directly.

A **self-contained single-file build** is also available — set `EXTERNAL_ASSETS=0`
(or leave it unset) when running `build/mkhtml.py`. That version inlines everything
as data URIs and comes out around 4.6 MB. It is what gets published as an artifact,
where a strict CSP blocks every external request.

The exemplar **source models** are not here — they live with the tests, at
`test/fixtures/canon/`, because they are run against the verifier as fixtures.

## What the page contains

- The complete assembly requirement: how many Canon pairs, Gold models, injections
  and hand-verified models are needed, computed from the corpus rather than estimated.
- All 47 rules, each with its statement, an explanation of what it means and why,
  its predicate, links to the parts it concerns, and links to its sources.
- Rendered illegal/legal exemplar pairs for the 19 rules where the rule is geometric.
  For the rest, the page says why no image exists rather than inventing one.
- 15 candidate models rendered from their own geometry, 7 of them rotatable in 3D.

## Regenerating

Requires the LDraw parts library and, for the model renders, the LDCad shadow library.
**Neither is vendored** — the parts library is CC BY 4.0 and fetched to `.cache/`, and
the shadow library is CC BY-SA 4.0, where ShareAlike would propagate into anything
derived from it, so it is supplied by path only.

```
LDRAW_LORES=1 python3 build/batch.py         # render the corpus models
LDRAW_LORES=1 python3 build/batch2.py        # render the large ones
python3 build/build.py                       # assemble page data
EXTERNAL_ASSETS=1 python3 build/mkhtml.py    # emit the 104 KB index.html
python3 build/mkhtml.py                      # or omit the flag for the 4.6 MB single file
```

`build/mkhtml.py` expects a `three.iife.js` bundle beside it. Regenerate with:

```
echo "export * from 'three';" > entry.js
npx esbuild entry.js --bundle --format=iife --global-name=THREE --minify --outfile=three.iife.js
```

It is bundled rather than used directly because `three.module.min.js` imports from
`three.core.min.js`, so inlining it alone leaves a fetch the artifact CSP blocks.

## Where the content comes from

- `build/explain.py` — the written explanation for each rule. These describe the rule
  itself; the decision history behind each rule lives in the corpus `note` fields.
- `build/sources.py` — the source links per rule.
- `rules/lego-build-rules.yaml` — the corpus itself, which supplies statements,
  predicates, tiers and part lists.

## On images

The canonical illustrations of these techniques are the renders in Jamie Berard's
2006 presentation, which are LEGO Group copyright. They are **linked** from each rule
rather than reproduced. Every image in this directory is generated from LDraw part
geometry, which is CC BY 4.0 and safe to redistribute — and has the side benefit of
using the same part vocabulary the verifier reasons about.
