import bake,render,os,json,time
SETS=["7276-1","7274-1","7278-1","1210-2","850-1","41588-1","7903-1",
      "10001-1","8880-1","8448-1","10182-1","10179-1","42055-1","10276-1","8466-1"]
OMR="/Users/tobytremayne/work/ldraw-verify/.cache/omr"
os.makedirs("/tmp/lego-viz/out",exist_ok=True)
meta={}
for s in SETS:
    p=f"{OMR}/{s}.mpd"
    if not os.path.exists(p): print("MISSING",s); continue
    t=time.time()
    txt,b=bake.load_model(p)
    out=bake.bake(txt,b)
    n=sum(len(v) for v in out.values())
    im=render.render(out,size=440,yaw=35,pitch=22)
    if im: im.save(f"/tmp/lego-viz/out/{s}.png")
    meta[s]={"tris":n,"colours":len(out),"secs":round(time.time()-t,1)}
    print(f"{s:10} tris={n:9,} {meta[s]['secs']:6.1f}s",flush=True)
json.dump(meta,open("/tmp/lego-viz/out/meta.json","w"),indent=1)
print("DONE")
