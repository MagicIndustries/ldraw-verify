import bake,render,os,time
SETS=["8880-1","10182-1","41588-1","10179-1","42055-1","8448-1","8466-1","10276-1"]
OMR="/Users/tobytremayne/work/ldraw-verify/.cache/omr"
for s in SETS:
    if os.path.exists(f"/tmp/lego-viz/out/{s}.png"): print("skip",s,flush=True); continue
    t=time.time()
    try:
        txt,b=bake.load_model(f"{OMR}/{s}.mpd")
        out=bake.bake(txt,b); n=sum(len(v) for v in out.values())
        im=render.render(out,size=440,yaw=35,pitch=22)
        if im: im.save(f"/tmp/lego-viz/out/{s}.png")
        print(f"{s:10} tris={n:9,} {time.time()-t:6.1f}s",flush=True)
    except Exception as e: print(s,"FAILED",e,flush=True)
print("DONE2",flush=True)
