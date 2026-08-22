import numpy as np, base64, json, zlib
import render as R

def export(tris_by_colour, max_tris=120000):
    groups=[]; allv=[]
    for c,tl in tris_by_colour.items():
        rgb=R.CMAP.get(c,(160,160,160,255))
        if rgb[3]<255: continue
        a=np.asarray(tl,dtype=np.float32).reshape(-1,9)
        groups.append([c,rgb,a]); allv.append(a.reshape(-1,3))
    if not allv: return None
    P=np.concatenate(allv)
    lo,hi=P.min(0),P.max(0); ctr=(lo+hi)/2; span=float((hi-lo).max())
    total=sum(len(g[2]) for g in groups)
    keep=1.0 if total<=max_tris else max_tris/total
    out={"span":span,"groups":[]}
    for c,rgb,a in groups:
        if keep<1.0:
            k=max(1,int(len(a)*keep))
            idx=np.linspace(0,len(a)-1,k).astype(int); a=a[idx]
        q=((a.reshape(-1,3)-ctr)/span*32000).clip(-32767,32767).astype(np.int16)
        raw=zlib.compress(q.tobytes(),9)
        out["groups"].append({"c":int(c),
            "hex":"#%02X%02X%02X"%rgb[:3],
            "n":int(len(a)),
            "d":base64.b64encode(raw).decode()})
    out["tris"]=sum(g["n"] for g in out["groups"])
    return out
