import base64,json,os,glob
OUT="/tmp/lego-viz/out"
MODELS=[
 dict(s="7276-1",n="Mango",a="Merlijn Wissink",p=6,band="tiny",cls=["Pure System"],note="No <code>0 FILE</code> block at all — exercises the single-block fallback path."),
 dict(s="7274-1",n="Orange",a="Merlijn Wissink",p=7,band="tiny",cls=["Pure System"],note="Same fallback path; a second sample to prove the first wasn't a fluke."),
 dict(s="7278-1",n="Melon",a="Merlijn Wissink",p=8,band="tiny",cls=["Pure System"],note="Smallest useful three-way check on the no-<code>FILE</code> branch."),
 dict(s="1210-2",n="Small house",a="N. W. Perry",p=135,band="small",cls=["Pure System"],note="Baseline for the grid rules with no Technic or SNOT confounders."),
 dict(s="850-1",n="Fork-Lift Truck",a="Merlijn Wissink",p=216,band="small",cls=["Technic","Vintage"],note="Expert Builder era. Predates most rules the tool enforces — the anchor for the period-mixing problem."),
 dict(s="41588-1",n="The Joker",a="Damien Roux",p=241,band="small",cls=["Minifigure","Clip &amp; bar"],note="Clip and bar connections — the known <code>SNAP_CLP</code> gap, where clips carry no gender data."),
 dict(s="7903-1",n="Rescue Helicopter",a="Marc Giraudet",p=270,band="small",cls=["Hinged","Mixed"],note="Carries the four genuine <code>B-05</code> violations: <code>3040b</code>×2 and <code>6091</code>×2."),
 dict(s="10001-1",n="Metroliner",a="Zoltán Kéri",p=872,band="medium",cls=["SNOT","Nested"],note="Contains the non-orthonormal subpart transform that forced <code>E-01</code>'s tolerance work."),
 dict(s="8880-1",n="Super Car",a="Orion Pobursky",p=1366,band="medium",cls=["Technic"],note="Technic maturity — pins, axles and pinholes at density."),
 dict(s="8448-1",n="Super Street Sensation",a="Orion Pobursky",p=1331,band="medium",cls=["Hinged","Flex-path"],note="1,331 parts across 183,705 lines. Generated flex geometry dominates the file."),
 dict(s="10182-1",n="Café Corner",a="Max Martin Richter",p=2183,band="large",cls=["SNOT","Modular"],note="Modular SNOT construction — the grid rules under real load."),
 dict(s="10179-1",n="Millennium Falcon (UCS)",a="Roland Dahl",p=4545,band="large",cls=["Curved","Sloped"],note="Curved and sloped surfaces — elliptical slopes and near-miss angles."),
 dict(s="42055-1",n="Bucket Wheel Excavator",a="Philippe Hurbain",p=4385,band="large",cls=["Technic","Flex-path"],note="Large Technic with flex elements — both stress classes at once."),
 dict(s="10276-1",n="Colosseum",a="Orion Pobursky",p=5433,band="huge",cls=["Pure System","Repetitive"],note="Performance ceiling. 5,433 parts of highly repetitive construction."),
 dict(s="8466-1",n="4×4 Off-Roader",a="—",p=1327,band="medium",cls=["Flex-path"],note="The extreme case: 1,327 parts, 311,435 lines — 235 lines per part against a corpus median of 3.3."),
]
BANDS=[("tiny","Tiny","under 50 parts","Single-block files with no <code>0 FILE</code> meta — the fallback path nothing else exercises."),
       ("small","Small","50–300 parts","Hand-verifiable end to end. The workhorse of the verified core."),
       ("medium","Medium","300–1,500 parts","Submodel nesting becomes real, and so does transform composition depth."),
       ("large","Large","1,500–5,000 parts","Component logic and performance under genuine load."),
       ("huge","Huge","over 5,000 parts","Performance ceiling only — too large to hand-verify meaningfully.")]
def b64(p):
    return base64.b64encode(open(p,'rb').read()).decode() if os.path.exists(p) else None
data=[]
for m in MODELS:
    png=b64(f"{OUT}/{m['s']}.png")
    mesh=None
    mp=f"{OUT}/{m['s']}.mesh.json"
    if os.path.exists(mp): mesh=json.load(open(mp))
    m2=dict(m); m2["png"]=png; m2["mesh"]=mesh
    data.append(m2)
json.dump(data,open("/tmp/lego-viz/pagedata.json","w"))
have=sum(1 for d in data if d["png"]); h3=sum(1 for d in data if d["mesh"])
print(f"models={len(data)} renders={have} meshes={h3}")
print(f"payload={os.path.getsize('/tmp/lego-viz/pagedata.json')/1024/1024:.2f}MB")
