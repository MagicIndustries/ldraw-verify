import json,re,html
import os as _os
EXT = _os.environ.get("EXTERNAL_ASSETS")=="1"
D=json.load(open("/tmp/lego-viz/pagedata.json"))
INV=json.load(open("/tmp/lego-viz/inventory.json"))
RD=json.load(open("/tmp/lego-viz/ruledetail.json"))
VER=json.load(open("/tmp/lego-viz/verification.json"))

THREE=open("three.iife.js").read()

BANDS=[("tiny","Tiny","under 50 parts","Single-block files with no <code>0 FILE</code> meta — the fallback path nothing else exercises."),
       ("small","Small","50–300 parts","Hand-verifiable end to end. The workhorse of the verified core."),
       ("medium","Medium","300–1,500 parts","Submodel nesting becomes real, and so does transform-composition depth."),
       ("large","Large","1,500–5,000 parts","Component logic and performance under genuine load."),
       ("huge","Huge","over 5,000 parts","Performance ceiling only — too large to hand-verify meaningfully.")]



def rulecard(r):
    st={"HARD":"hard","DISCOURAGED":"disc","LEGAL":"legal","STYLE":"legal"}.get(r["tier"],"legal")
    src={"P1":"first-party","P2":"designer quote","S":"derived","F":"folklore"}.get(r["src"],r["src"])
    ex=""
    if r["imgs"]:
        cells=""
        for kind in ("illegal","legal"):
            if kind in r["imgs"]:
                lbl="Illegal" if kind=="illegal" else "Legal"
                src=(f"assets/exemplars/{r['id']}.{kind}.png" if EXT else "data:image/png;base64,"+r["imgs"][kind])
                v=VER.get(r["id"],{}).get(kind)
                vt=""
                if v:
                    conn = "1 assembly" if v["comps"]==1 else f'{v["comps"]} loose pieces'
                    if kind=="illegal":
                        if v["own"]:
                            fires, cls = f'fires {r["id"]} as intended', "vok"
                        elif not r["impl"]:
                            other = ", ".join(x for x in v["fails"] if x!=r["id"])
                            fires = f'no predicate yet — caught by {other}' if other else "no predicate yet"
                            cls = "vna"
                        else:
                            fires, cls = "does NOT fire its rule", "vwarn"
                    else:
                        if not v["fails"]:
                            fires, cls = "clean — no rule fires", "vok"
                        else:
                            fires = "false positive: "+", ".join(v["fails"])
                            cls = "vwarn"
                    vt=f'<span class="vchip {cls}">{v["edges"]} conn · {conn} · {fires}</span>'
                cells+=f'<figure class="ex {kind}"><img src="{src}" alt="{lbl} exemplar for {r["id"]}" loading="lazy"><figcaption>{lbl}{vt}</figcaption></figure>'
        ex=f'<div class="exrow">{cells}</div>'
    elif r["nopic"]:
        ex=f'<p class="nopic">No exemplar image: {html.escape(r["nopic"])}.</p>'
    else:
        ex='<p class="nopic">Exemplar not yet authored.</p>'
    bits=""
    if r["pred"]: bits+=f'<div class="kv"><span class="kk">Predicate</span><code>{html.escape(r["pred"])}</code></div>'
    if r.get("partlinks"): bits+='<div class="kv"><span class="kk">Parts</span><span class="plinks">'+" ".join(f'<a href="{p["u"]}" target="_blank" rel="noopener">{html.escape(p["p"])}</a>' for p in r["partlinks"])+'</span></div>'
    if r["check"]: bits+=f'<div class="kv"><span class="kk">Check kind</span><code>{html.escape(r["check"])}</code></div>'
    if r.get("pairnote"): ex+=f'<p class="nopic">{html.escape(r["pairnote"])}</p>'
    srcs=""
    if r.get("sources"):
        srcs='<div class="srcbox"><span class="kk">Sources</span><ul>'+"".join(
            f'<li><a href="{x["u"]}" target="_blank" rel="noopener">{html.escape(x["t"])}</a></li>' for x in r["sources"])+'</ul></div>'
    note=f'<p class="rnote">{html.escape(r["explain"])}</p>' if r.get("explain") else ""
    status='<span class="pill done">implemented</span>' if r["impl"] else ""
    return f"""<article class="rule" id="rule-{r['id']}">
  <div class="rhead"><code class="rid">{r['id']}</code><h3>{html.escape(r['name'])}</h3>
    <span class="pill {st}">{r['tier'].lower()}</span>{status}
    <span class="srcs">{html.escape(src)}</span></div>
  <p class="rstmt">{html.escape(r['stmt'])}</p>
  {note}
  {bits}
  {ex}
  {srcs}
</article>"""

_by=lambda pred:"".join(rulecard(r) for r in RD if pred(r))
RULES_IMPL=_by(lambda r:r["impl"])
RULES_READY=_by(lambda r:not r["impl"] and r["tier"] in ("HARD","DISCOURAGED") and not r["nopic"])
RULES_BLOCK=_by(lambda r:not r["impl"] and r["tier"] in ("HARD","DISCOURAGED") and r["nopic"])
RULES_LEGAL=_by(lambda r:r["tier"] in ("LEGAL","STYLE"))
NIMPL=sum(1 for r in RD if r["impl"])
NREADY=sum(1 for r in RD if not r["impl"] and r["tier"] in ("HARD","DISCOURAGED") and not r["nopic"])
NBLOCK=sum(1 for r in RD if not r["impl"] and r["tier"] in ("HARD","DISCOURAGED") and r["nopic"])
NLEGAL=sum(1 for r in RD if r["tier"] in ("LEGAL","STYLE"))
NIMG=sum(1 for r in RD if r["imgs"])

def rrow(r,extra=""):
    st={"HARD":"hard","DISCOURAGED":"disc","LEGAL":"legal"}[r["tier"]]
    return f'<tr><td><code>{r["id"]}</code></td><td>{html.escape(r["name"])}</td><td><span class="pill {st}">{r["tier"].lower()}</span></td><td>{extra}</td></tr>'

CANON_READY="".join(rrow(r) for r in INV["rules"]["ready"])
CANON_BLOCK="".join(rrow(r,html.escape(r["blocked"])) for r in INV["rules"]["blocked"])
CANON_IMPL="".join(rrow(r,"fixture exists") for r in INV["rules"]["impl"])
CANON_LEGAL="".join(rrow(r,"near-twin") for r in INV["rules"]["legal"])
BANDROWS="".join(
  f'<tr><td>{b[0]}</td><td>{b[1]:,}</td><td class="neg">{b[2]:,}</td><td>{b[3]:,}</td><td class="tgt">{b[4]}</td></tr>'
  for b in INV["bands"])
INJROWS="".join(f'<tr><td><code>{i[0]}</code></td><td>{html.escape(i[1])}</td><td class="tgt">{i[2]}</td></tr>' for i in INV["inj"])
def scarce_rows(k):
    return "".join(f'<tr><td><code>{html.escape(d["set"])}</code></td><td>{d["parts"]:,}</td><td>{html.escape(d["name"])}</td></tr>' for d in INV["scarce"][k])
LARGE_ROWS=scarce_rows("large"); HUGE_ROWS=scarce_rows("huge")
T=INV["totals"]

def plate(m):
    has3=m["mesh"] is not None
    img=(f'<img src="{("assets/renders/"+m["s"]+".png") if EXT else ("data:image/png;base64,"+m["png"])}" alt="Rendered view of {html.escape(m["n"])}" loading="lazy">'
         if m["png"] else '<div class="norender">not rendered</div>')
    btn=(f'<button class="shot live" data-set="{m["s"]}" aria-label="Open rotatable 3D view of {html.escape(m["n"])}">{img}<span class="spin">rotate ↻</span></button>'
         if has3 else f'<div class="shot">{img}</div>')
    cls="".join(f'<span class="tag">{html.escape(c)}</span>' for c in m["cls"])
    tri=f'{m["mesh"]["tris"]:,}' if has3 else "—"
    return f"""<article class="plate">
  {btn}
  <div class="meta">
    <div class="idline"><code class="set">{m['s']}</code><h3>{html.escape(m['n'])}</h3></div>
    <p class="repro">Reproduced by {html.escape(m['a'])}</p>
    <dl class="facts">
      <div><dt>Parts</dt><dd>{m['p']:,}</dd></div>
      <div><dt>Triangles</dt><dd>{tri}</dd></div>
    </dl>
    <div class="tags">{cls}</div>
    <p class="note">{m['note']}</p>
  </div>
</article>"""

sections=""
for key,label,range_,why in BANDS:
    ms=[m for m in D if m["band"]==key]
    if not ms: continue
    sections+=f"""<section class="band">
  <header class="bandhead">
    <h2>{label}</h2><span class="range">{range_}</span>
  </header>
  <p class="why">{why}</p>
  <div class="plates">{''.join(plate(m) for m in ms)}</div>
</section>"""

meshjson=json.dumps({m["s"]:m["mesh"] for m in D if m["mesh"]})
THREE_TAG = '<script src="assets/three.iife.js"></script>' if EXT else ("<script>"+THREE+"</script>")
MESH_INIT = "{}" if EXT else meshjson

HTML=f"""<title>Corpus Specimen Plates</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root{{
  --ground:#EDF0F4; --surface:#FFFFFF; --sunk:#E2E7ED;
  --ink:#0E1319; --ink-2:#4B5766; --muted:#6F7C8C; --rule:#D2D9E2;
  --accent:#B4541E; --accent-soft:#F3E2D6;
  --gold:#8A6D1F; --gold-soft:#F4EBD2;
  --excl:#9B3340; --excl-soft:#F7DEE1;
  --slate:#5A6472; --ok:#3F9D63;
  --shadow:0 1px 2px rgba(14,19,25,.06),0 8px 24px rgba(14,19,25,.06);
}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{
  --ground:#111519; --surface:#191E25; --sunk:#0C1014;
  --ink:#E4E9F0; --ink-2:#98A5B4; --muted:#7A8797; --rule:#28303A;
  --accent:#E07B41; --accent-soft:#3A2317;
  --gold:#D6B45C; --gold-soft:#332A12;
  --excl:#E2707E; --excl-soft:#3A1B20;
  --slate:#8B96A6; --ok:#5FBE85;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 28px rgba(0,0,0,.35);
}}}}
:root[data-theme="dark"]{{
  --ground:#111519; --surface:#191E25; --sunk:#0C1014;
  --ink:#E4E9F0; --ink-2:#98A5B4; --muted:#7A8797; --rule:#28303A;
  --accent:#E07B41; --accent-soft:#3A2317;
  --gold:#D6B45C; --gold-soft:#332A12;
  --excl:#E2707E; --excl-soft:#3A1B20;
  --slate:#8B96A6; --ok:#5FBE85;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 28px rgba(0,0,0,.35);
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--ground);color:var(--ink);
  font-family:"Source Serif 4",Georgia,serif;font-size:17px;line-height:1.6;
  -webkit-font-smoothing:antialiased}}
.wrap{{max-width:1120px;margin:0 auto;padding:56px 24px 110px}}
h1,h2,h3,.eyebrow,.set,.range,dt,.tag,.spin,button{{font-family:Archivo,"Helvetica Neue",sans-serif}}
code,.set,.facts dd,.range{{font-family:"IBM Plex Mono",ui-monospace,monospace}}
h1{{font-size:clamp(2.1rem,5vw,3.3rem);font-weight:800;line-height:1.03;letter-spacing:-.025em;
  text-wrap:balance;margin:0 0 18px}}
.eyebrow{{font-size:.73rem;font-weight:600;letter-spacing:.13em;text-transform:uppercase;
  color:var(--accent);margin:0 0 16px}}
.stand{{max-width:62ch;font-size:1.14rem;color:var(--ink-2);margin:0 0 10px}}
.stand strong{{color:var(--ink);font-weight:600}}
.corpora{{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:44px 0 8px}}
.corp{{background:var(--surface);border:1px solid var(--rule);border-radius:4px;padding:16px 18px;
  border-top:3px solid var(--slate)}}
.corp.gold{{border-top-color:var(--gold)}} .corp.canon{{border-top-color:var(--accent)}}
.corp.inj{{border-top-color:var(--accent)}} .corp.wild{{border-top-color:var(--excl)}}
.corp h3{{margin:0 0 6px;font-size:.8rem;letter-spacing:.11em;text-transform:uppercase;color:var(--muted)}}
.corp .job{{font-size:.97rem;color:var(--ink-2);margin:0}}
.corp .n{{font-family:"IBM Plex Mono",monospace;font-size:1.5rem;font-weight:600;color:var(--ink);
  display:block;margin-bottom:2px;font-variant-numeric:tabular-nums}}
.band{{margin-top:64px;border-top:1px solid var(--rule);padding-top:26px}}
.bandhead{{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}}
.bandhead h2{{font-size:1.45rem;font-weight:700;letter-spacing:-.012em;margin:0}}
.range{{font-size:.82rem;color:var(--muted);letter-spacing:.02em}}
.why{{max-width:60ch;color:var(--ink-2);margin:8px 0 26px;font-size:1rem}}
.plates{{display:flex;flex-direction:column;gap:18px}}
.plate{{display:grid;grid-template-columns:236px 1fr;gap:24px;background:var(--surface);
  border:1px solid var(--rule);border-radius:5px;padding:18px;box-shadow:var(--shadow)}}
.shot{{background:var(--sunk);border-radius:4px;display:grid;place-items:center;padding:8px;
  position:relative;border:0;width:100%;aspect-ratio:1}}
button.shot{{cursor:pointer;transition:box-shadow .16s ease}}
button.shot:hover,button.shot:focus-visible{{box-shadow:0 0 0 2px var(--accent)}}
button.shot:focus-visible{{outline:none}}
.shot img{{width:100%;height:auto;display:block}}
.norender{{color:var(--muted);font-size:.85rem;font-family:Archivo,sans-serif}}
.spin{{position:absolute;bottom:8px;right:8px;background:var(--accent);color:#fff;
  font-size:.66rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  padding:3px 8px;border-radius:3px}}
.idline{{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}}
.set{{font-size:.86rem;color:var(--accent);font-weight:600;background:var(--accent-soft);
  padding:2px 7px;border-radius:3px}}
.plate h3{{margin:0;font-size:1.22rem;font-weight:700;letter-spacing:-.012em}}
.repro{{margin:6px 0 0;font-size:.9rem;color:var(--muted);font-style:italic}}
.facts{{display:flex;gap:30px;margin:14px 0 12px;padding:12px 0;
  border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}}
.facts div{{display:flex;flex-direction:column;gap:1px}}
dt{{font-size:.66rem;letter-spacing:.11em;text-transform:uppercase;color:var(--muted);font-weight:600}}
dd{{margin:0;font-size:1.06rem;font-variant-numeric:tabular-nums}}
.tags{{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}}
.tag{{font-size:.68rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  background:var(--sunk);color:var(--ink-2);padding:3px 8px;border-radius:3px}}
.note{{margin:0;font-size:.97rem;color:var(--ink-2);max-width:62ch}}
.note code,.why code,.stand code{{background:var(--sunk);padding:1px 5px;border-radius:3px;font-size:.86em}}
.flex{{margin-top:70px;border-top:3px solid var(--excl);padding-top:26px}}
.flex h2{{font-size:1.45rem;margin:0 0 6px}}
.big{{font-family:"IBM Plex Mono",monospace;font-size:clamp(2.6rem,7vw,4.2rem);font-weight:600;
  color:var(--excl);line-height:1;font-variant-numeric:tabular-nums;margin:18px 0 4px}}
.bigl{{font-size:.85rem;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;
  font-family:Archivo,sans-serif;font-weight:600}}
.method{{margin-top:64px;padding-top:22px;border-top:1px solid var(--rule);
  font-size:.93rem;color:var(--muted);max-width:64ch}}
dialog{{border:0;padding:0;background:transparent;max-width:none;max-height:none;width:100%;height:100%}}
dialog::backdrop{{background:rgba(10,13,17,.82);backdrop-filter:blur(3px)}}
.viewer{{width:min(92vw,860px);height:min(88vh,860px);margin:auto;background:var(--surface);
  border-radius:6px;overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow)}}
.vhead{{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--rule)}}
.vhead h3{{margin:0;font-size:1rem;font-weight:700}}
.vhead .hint{{margin-left:auto;font-size:.76rem;color:var(--muted);font-family:Archivo,sans-serif}}
.vclose{{background:var(--sunk);border:0;color:var(--ink);border-radius:4px;padding:6px 12px;
  cursor:pointer;font-size:.8rem;font-weight:600}}
.vclose:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
#cv{{flex:1;display:block;width:100%;cursor:grab;background:var(--sunk)}}
#cv:active{{cursor:grabbing}}

.tally{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;
  background:var(--rule);border:1px solid var(--rule);border-radius:5px;overflow:hidden;margin:14px 0 6px}}
.tally div{{background:var(--surface);padding:15px 16px}}
.tally .k{{font-family:Archivo,sans-serif;font-size:.66rem;letter-spacing:.11em;text-transform:uppercase;
  color:var(--muted);font-weight:600;margin-bottom:5px}}
.tally .v{{font-family:"IBM Plex Mono",monospace;font-size:1.85rem;font-weight:600;line-height:1;
  font-variant-numeric:tabular-nums}}
.tally .u{{font-size:.8rem;color:var(--muted);margin-top:3px}}
.tally .v.acc{{color:var(--accent)}} .tally .v.gld{{color:var(--gold)}} .tally .v.exc{{color:var(--excl)}}
.tw{{overflow-x:auto;margin:16px 0 6px;border:1px solid var(--rule);border-radius:5px;background:var(--surface)}}
table{{border-collapse:collapse;width:100%;font-size:.92rem}}
th,td{{text-align:left;padding:9px 14px;border-bottom:1px solid var(--rule);vertical-align:top}}
th{{font-family:Archivo,sans-serif;font-size:.66rem;letter-spacing:.11em;text-transform:uppercase;
  color:var(--muted);font-weight:600;background:var(--sunk);position:sticky;top:0}}
tr:last-child td{{border-bottom:0}}
td code{{font-family:"IBM Plex Mono",monospace;font-size:.84rem;color:var(--accent)}}
td{{font-variant-numeric:tabular-nums}}
.neg{{color:var(--excl)}} .tgt{{color:var(--gold);font-weight:600}}
.pill{{font-family:Archivo,sans-serif;font-size:.63rem;font-weight:600;letter-spacing:.07em;
  text-transform:uppercase;padding:2px 7px;border-radius:3px}}
.pill.hard{{background:var(--excl-soft);color:var(--excl)}}
.pill.disc{{background:var(--gold-soft);color:var(--gold)}}
.pill.legal{{background:var(--sunk);color:var(--ink-2)}}
.sub{{font-size:1.05rem;font-weight:700;font-family:Archivo,sans-serif;margin:26px 0 2px}}
.cap{{max-width:62ch;color:var(--ink-2);margin:4px 0 0;font-size:.97rem}}
.scroller{{max-height:340px;overflow-y:auto}}

.rule{{background:var(--surface);border:1px solid var(--rule);border-radius:5px;padding:16px 18px;margin-bottom:14px}}
.rhead{{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}}
.rid{{font-family:"IBM Plex Mono",monospace;font-size:.84rem;font-weight:600;color:var(--accent);
  background:var(--accent-soft);padding:2px 7px;border-radius:3px}}
.rule h3{{margin:0;font-size:1.06rem;font-weight:700;letter-spacing:-.01em}}
.srcs{{margin-left:auto;font-family:Archivo,sans-serif;font-size:.68rem;letter-spacing:.08em;
  text-transform:uppercase;color:var(--muted);font-weight:600}}
.pill.done{{background:var(--sunk);color:var(--ink-2)}}
.rstmt{{margin:0 0 8px;font-size:1.02rem;max-width:66ch}}
.rnote{{margin:0 0 10px;font-size:.93rem;color:var(--ink-2);max-width:70ch;
  border-left:2px solid var(--rule);padding-left:12px}}
.kv{{display:flex;gap:10px;align-items:baseline;margin:3px 0;flex-wrap:wrap}}
.kk{{font-family:Archivo,sans-serif;font-size:.63rem;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted);font-weight:600;min-width:82px}}
.kv code{{font-family:"IBM Plex Mono",monospace;font-size:.8rem;color:var(--ink-2);
  background:var(--sunk);padding:2px 7px;border-radius:3px;overflow-wrap:anywhere}}
.exrow{{display:flex;gap:12px;margin-top:12px;flex-wrap:wrap}}
.ex{{margin:0;width:190px;background:var(--sunk);border-radius:4px;padding:6px;
  border-top:3px solid var(--rule)}}
.ex.illegal{{border-top-color:var(--excl)}} .ex.legal{{border-top-color:var(--ok,#3f9d63)}}
.ex img{{width:100%;height:auto;display:block}}
.ex figcaption{{font-family:Archivo,sans-serif;font-size:.66rem;letter-spacing:.09em;
  text-transform:uppercase;color:var(--muted);font-weight:600;margin-top:5px;text-align:center}}
.vchip{{display:block;margin-top:4px;font-family:'IBM Plex Mono',ui-monospace,monospace;
  font-size:.6rem;letter-spacing:.01em;text-transform:none;font-weight:500;line-height:1.4;
  padding:3px 5px;border-radius:3px;background:var(--chipbg,rgba(127,127,127,.1));color:var(--muted)}}
.vchip.vok{{color:var(--ok,#3f9d63)}} .vchip.vwarn{{color:var(--excl)}}
.vchip.vna{{opacity:.72;font-style:italic}}
.nopic{{margin:10px 0 0;font-size:.88rem;color:var(--muted);font-style:italic}}

.srcbox{{margin-top:12px;padding-top:10px;border-top:1px dashed var(--rule)}}
.srcbox ul{{margin:5px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px}}
.srcbox li{{font-size:.86rem}}
.srcbox a{{color:var(--accent-ink,var(--accent));text-decoration:none;border-bottom:1px solid transparent}}
.srcbox a:hover,.srcbox a:focus-visible{{border-bottom-color:currentColor}}
.plinks{{display:flex;flex-wrap:wrap;gap:5px}}
.plinks a{{font-family:"IBM Plex Mono",monospace;font-size:.78rem;background:var(--sunk);
  color:var(--ink-2);padding:2px 7px;border-radius:3px;text-decoration:none}}
.plinks a:hover,.plinks a:focus-visible{{color:var(--accent);outline:none;box-shadow:0 0 0 1px var(--accent)}}
@media (max-width:720px){{
  .plate{{grid-template-columns:1fr}}
  .wrap{{padding:36px 16px 80px}}
}}
@media (prefers-reduced-motion:reduce){{*{{animation:none!important;transition:none!important}}}}
</style>
<div class="wrap">
<p class="eyebrow">ldraw-verify · corpus assembly</p>
<h1>Which models we test against, and what each one is for</h1>
<p class="stand">Fifteen candidate models from the 1,464-model Official Model Repository pull, chosen to span the properties the rules actually exercise — not for variety. Every render below is generated from the model's own geometry by the verifier's resolver. <strong>Seven are rotatable</strong>: click any plate marked <em>rotate</em>.</p>
<p class="stand">Each plate credits the person who <em>reproduced</em> the set. That attribution is the point: these are fan reproductions, not LEGO's own CAD data, which is exactly why a clean result against them is evidence rather than proof.</p>

<div class="corpora">
  <div class="corp canon"><h3>Canon</h3><span class="n">~16</span><p class="job">Berard-deck reproductions. Authoritative illegal exemplars. Proves a rule fires at all.</p></div>
  <div class="corp inj"><h3>Injected</h3><span class="n">~300</span><p class="job">One recorded mutation into a verified host. Proves detection survives real noise.</p></div>
  <div class="corp gold"><h3>Gold</h3><span class="n">40–80</span><p class="job">Verified reproductions. A HARD hit here is a genuine false positive.</p></div>
  <div class="corp wild"><h3>Wild</h3><span class="n">1,464</span><p class="job">The full pull. Regression and performance only — never an oracle.</p></div>
</div>


<section class="band" id="need">
  <header class="bandhead"><h2>What we need to assemble</h2><span class="range">complete requirement</span></header>
  <p class="why">Counts, not samples. Every figure below is computed from the 1,464-model corpus and the 46-rule build-rules file, not estimated.</p>
  <div class="tally">
    <div><div class="k">Canon pairs</div><div class="v acc">{T['canon_pairs']}</div><div class="u">{T['canon_files']} files to author</div></div>
    <div><div class="k">Already fixtured</div><div class="v">{T['impl']}</div><div class="u">rules with a pair today</div></div>
    <div><div class="k">Gold models</div><div class="v gld">{T['gold']}</div><div class="u">of {T['eligible']:,} eligible</div></div>
    <div><div class="k">Hand-verified</div><div class="v gld">{T['handverify']}</div><div class="u">≈12–15 hours</div></div>
    <div><div class="k">Injected</div><div class="v acc">{T['inj']}</div><div class="u">generated, not stored</div></div>
    <div><div class="k">Excluded</div><div class="v exc">{T['flex']}</div><div class="u">flex-path, 13.7%</div></div>
  </div>
</section>

<section class="band">
  <header class="bandhead"><h2>Canon — the bottleneck</h2><span class="range">{T['canon_pairs']} to build · {T['impl']} done</span></header>
  <p class="why">One illegal model and one legal near-twin per rule. A rule without a pair cannot be written test-first, which is why {T['canon_pairs']} of the corpus's 47 rules have no predicate today. {NIMG} pairs are rendered in the catalogue below; the rest are still to author.</p>
  <div class="tally">
    <div><div class="k">Ready to build</div><div class="v acc">{NREADY}</div><div class="u">unblocks its rule at once</div></div>
    <div><div class="k">Blocked</div><div class="v exc">{NBLOCK}</div><div class="u">missing a dependency</div></div>
    <div><div class="k">Legal twins</div><div class="v">{NLEGAL}</div><div class="u">the sharpest tests</div></div>
    <div><div class="k">Exemplars drawn</div><div class="v gld">{NIMG}</div><div class="u">rendered below</div></div>
  </div>
</section>


<section class="band" id="rules">
  <header class="bandhead"><h2>Every rule, described</h2><span class="range">47 rules · {NIMG} with exemplars</span></header>
  <p class="why">The full build-rules corpus, with each rule's statement, the reasoning recorded against it, its predicate where one exists, and the parts it concerns. Where a rule is geometric, a minimal exemplar pair is rendered — illegal beside its legal near-twin. Where it isn't, the reason is stated rather than an image invented.</p>

  <p class="sub">Implemented — a predicate exists and runs today <span class="range">{NIMPL}</span></p>
  {RULES_IMPL}

  <p class="sub">Ready to build — needs only an exemplar pair <span class="range">{NREADY}</span></p>
  {RULES_READY}

  <p class="sub">Blocked, or not geometric <span class="range">{NBLOCK}</span></p>
  <p class="cap">Each of these is missing something the LDraw format or library cannot supply. The line under each says what.</p>
  {RULES_BLOCK}

  <p class="sub">Legal and informational <span class="range">{NLEGAL}</span></p>
  <p class="cap">Rules recorded so the tool knows what is <em>permitted</em> — the near-twins that stop a checker from pattern-matching on shape.</p>
  {RULES_LEGAL}
</section>

<section class="band">
  <header class="bandhead"><h2>Gold — pool, and how thin it gets</h2><span class="range">{T['gold']} of {T['eligible']:,}</span></header>
  <p class="why">The flex-path exclusion is not evenly spread. It removes over half the large models and nearly all the huge ones, which is the real constraint on this corpus — not how many we want, but how many exist.</p>
  <div class="tw"><table><thead><tr><th>Band</th><th>In corpus</th><th>Flex-excluded</th><th>Eligible</th><th>Target</th></tr></thead><tbody>{BANDROWS}</tbody></table></div>
  <p class="cap">At the large band we can choose 10 from 41. At huge, both eligible models are taken because only two exist.</p>

  <p class="sub">Every eligible large model <span class="range">41</span></p>
  <p class="cap">Listed in full because this is the band where choice is genuinely constrained.</p>
  <div class="tw scroller"><table><thead><tr><th>Set</th><th>Parts</th><th>Model</th></tr></thead><tbody>{LARGE_ROWS}</tbody></table></div>

  <p class="sub">Every eligible huge model <span class="range">2</span></p>
  <div class="tw"><table><thead><tr><th>Set</th><th>Parts</th><th>Model</th></tr></thead><tbody>{HUGE_ROWS}</tbody></table></div>
</section>

<section class="band">
  <header class="bandhead"><h2>Injected — one operator per rule</h2><span class="range">{T['inj']} total</span></header>
  <p class="why">A Gold host plus exactly one recorded mutation. The label is certain because we made it; the context is real because the host is. Only rules with a working predicate can be injected against — an undetected injection is a recall gap, reported rather than removed.</p>
  <div class="tw"><table><thead><tr><th>Rule</th><th>Mutation operator</th><th>Count</th></tr></thead><tbody>{INJROWS}</tbody></table></div>
  <p class="cap">Never injected into Wild models: a &ldquo;missed&rdquo; injection there may be a model that was already violating.</p>
</section>

<section class="band">
  <header class="bandhead"><h2>Specimens</h2><span class="range">15 illustrative</span></header>
  <p class="why">Rendered from their own geometry through the verifier's resolver, to show what each band and technique class actually looks like. Seven are rotatable.</p>
</section>

{sections}

<section class="flex">
  <h2>The class excluded from Gold</h2>
  <div class="big">200</div>
  <div class="bigl">models · 13.7% of the corpus</div>
  <p class="note" style="margin-top:16px;max-width:64ch">Models carrying <code>0 !LDCAD GENERATED</code> geometry — 887 <code>PATH</code> configurations (hoses, cables, chains) and 108 <code>SPRING</code>, totalling 680,623 inline polygons. LDCad writes this as <em>fallback</em> content and regenerates it whenever endpoints move, so it is a snapshot rather than the model. It carries no part identity, is invisible to every rule the tool has, and breaks the inventory cross-check because a hose modelled this way contributes no part references. Excluded from Gold, kept in Wild as a deliberate stress class.</p>
</section>

<p class="method">Renders produced by baking each model to world-space triangles through the verifier's own resolver, then rasterising with a z-buffer at lo-res primitive detail. Generated flex geometry is skipped during baking, which is why the flex-heavy models render at all. Colours resolve through <code>LDConfig.ldr</code>. Part counts are type-1 reference counts; triangle counts are post-decimation for the rotatable models.</p>
</div>

<dialog id="dlg">
  <div class="viewer">
    <div class="vhead">
      <h3 id="vt">Model</h3>
      <span class="hint">drag to rotate · scroll to zoom</span>
      <button class="vclose" id="vc">Close</button>
    </div>
    <canvas id="cv"></canvas>
  </div>
</dialog>

{THREE_TAG}
<script>
(function(){{
const MESH={MESH_INIT};
const dlg=document.getElementById('dlg'),cv=document.getElementById('cv'),vt=document.getElementById('vt');
let renderer,scene,camera,root,raf=0,yaw=.6,pitch=.35,dist=2.4,drag=null;
function init(){{
  renderer=new THREE.WebGLRenderer({{canvas:cv,antialias:true,alpha:true}});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(38,1,.01,100);
  scene.add(new THREE.HemisphereLight(0xffffff,0x4b5766,2.1));
  const d=new THREE.DirectionalLight(0xffffff,1.5); d.position.set(.5,1,.8); scene.add(d);
}}
async function inflate(b64){{
  const bin=atob(b64),u=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
  const ds=new DecompressionStream('deflate');
  const buf=await new Response(new Blob([u]).stream().pipeThrough(ds)).arrayBuffer();
  return new Int16Array(buf);
}}
const MC={{}};
function loadMesh(id){{
  if(MESH[id])return Promise.resolve(MESH[id]);
  if(MC[id])return MC[id];
  MC[id]=new Promise((res,rej)=>{{
    const t=document.createElement('script');
    t.src='assets/meshes/'+id+'.js';
    t.onload=()=>{{const m=(window.__M||{{}})[id]; m?res(m):rej(new Error('mesh missing: '+id));}};
    t.onerror=()=>rej(new Error('could not load mesh for '+id));
    document.head.appendChild(t);
  }});
  return MC[id];
}}
async function load(id){{
  if(!renderer)init();
  if(root)scene.remove(root);
  root=new THREE.Group();
  const m=await loadMesh(id);
  for(const g of m.groups){{
    const q=await inflate(g.d);
    const pos=new Float32Array(q.length);
    for(let i=0;i<q.length;i++)pos[i]=q[i]/32000;
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    geo.computeVertexNormals();
    root.add(new THREE.Mesh(geo,new THREE.MeshLambertMaterial({{color:g.hex,side:THREE.DoubleSide}})));
  }}
  root.scale.set(1,-1,1);
  scene.add(root); yaw=.6; pitch=.35; dist=2.4; resize();
}}
function resize(){{
  const r=cv.getBoundingClientRect();
  renderer.setSize(r.width,r.height,false);
  camera.aspect=r.width/Math.max(r.height,1); camera.updateProjectionMatrix();
}}
function tick(){{
  raf=requestAnimationFrame(tick);
  camera.position.set(Math.sin(yaw)*Math.cos(pitch)*dist,Math.sin(pitch)*dist,Math.cos(yaw)*Math.cos(pitch)*dist);
  camera.lookAt(0,0,0); renderer.render(scene,camera);
}}
cv.addEventListener('pointerdown',e=>{{drag={{x:e.clientX,y:e.clientY}};cv.setPointerCapture(e.pointerId)}});
cv.addEventListener('pointermove',e=>{{if(!drag)return;
  yaw-=(e.clientX-drag.x)*.008; pitch=Math.max(-1.4,Math.min(1.4,pitch+(e.clientY-drag.y)*.008));
  drag={{x:e.clientX,y:e.clientY}}}});
addEventListener('pointerup',()=>drag=null);
cv.addEventListener('wheel',e=>{{e.preventDefault();dist=Math.max(.9,Math.min(7,dist*(1+Math.sign(e.deltaY)*.12)))}},{{passive:false}});
addEventListener('resize',()=>{{if(renderer&&dlg.open)resize()}});
for(const b of document.querySelectorAll('button.shot.live')){{
  b.addEventListener('click',async()=>{{
    const id=b.dataset.set;
    vt.textContent=id+' · '+b.closest('.plate').querySelector('h3').textContent;
    dlg.showModal(); await load(id); if(!raf)tick();
  }});
}}
document.getElementById('vc').addEventListener('click',()=>dlg.close());
dlg.addEventListener('close',()=>{{cancelAnimationFrame(raf);raf=0}});
}})();
</script>"""
open("/tmp/lego-viz/corpus.html","w").write(HTML)
import os
print(f"written {os.path.getsize('/tmp/lego-viz/corpus.html')/1024/1024:.2f} MB")
