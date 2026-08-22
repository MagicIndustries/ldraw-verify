import numpy as np, re, os, math
from PIL import Image
LDCFG="/Users/tobytremayne/work/ldraw-verify/.cache/ldraw/LDConfig.ldr"

def colours():
    m={}
    for L in open(LDCFG,encoding="utf-8",errors="replace"):
        if "!COLOUR" not in L: continue
        c=re.search(r'CODE\s+(\d+)',L); v=re.search(r'VALUE\s+#([0-9A-Fa-f]{6})',L)
        a=re.search(r'ALPHA\s+(\d+)',L)
        if c and v:
            h=v.group(1); m[int(c.group(1))]=(int(h[0:2],16),int(h[2:4],16),int(h[4:6],16),
                                              int(a.group(1)) if a else 255)
    return m
CMAP=colours()

def render(tris_by_colour, size=512, yaw=35.0, pitch=22.0, bg=(0,0,0,0), scale_pad=1.10):
    V=[];C=[]
    for c,tl in tris_by_colour.items():
        rgb=CMAP.get(c,(160,160,160,255))
        if rgb[3]<255: continue                       # skip transparent for clarity
        arr=np.asarray(tl,dtype=np.float32).reshape(-1,3,3)
        V.append(arr); C.append(np.repeat(np.array([rgb[:3]],np.float32),len(arr),0))
    if not V: return None
    V=np.concatenate(V); C=np.concatenate(C)
    V=V*np.array([1,-1,1],np.float32)                 # LDraw -Y up -> +Y up
    ry,rx=math.radians(yaw),math.radians(pitch)
    Ry=np.array([[math.cos(ry),0,math.sin(ry)],[0,1,0],[-math.sin(ry),0,math.cos(ry)]],np.float32)
    Rx=np.array([[1,0,0],[0,math.cos(rx),-math.sin(rx)],[0,math.sin(rx),math.cos(rx)]],np.float32)
    R=Rx@Ry
    P=V.reshape(-1,3)@R.T
    lo,hi=P.min(0),P.max(0); ctr=(lo+hi)/2
    P=P-ctr
    span=max((hi-lo)[:2].max(),1e-6)*scale_pad
    s=size/span
    P[:,:2]*=s; P[:,0]+=size/2; P[:,1]=size/2-P[:,1]
    P=P.reshape(-1,3,3)
    n=np.cross(P[:,1]-P[:,0],P[:,2]-P[:,0])
    ln=np.linalg.norm(n,axis=1,keepdims=True); ln[ln==0]=1; n=n/ln
    L=np.array([0.35,0.55,0.76],np.float32)
    lam=np.clip(n@L,0,1)[:,None]
    shade=(0.45+0.55*lam)
    col=np.clip(C*shade,0,255)
    order=np.argsort(-P[:,:,2].mean(1))               # painter, far first
    img=np.zeros((size,size,4),np.float32); img[...,:3]=bg[:3]; img[...,3]=bg[3]
    zbuf=np.full((size,size),-1e9,np.float32)
    xs=np.arange(size,dtype=np.float32)
    for i in order:
        t=P[i]; c=col[i]
        x0=max(int(t[:,0].min()),0); x1=min(int(t[:,0].max())+1,size)
        y0=max(int(t[:,1].min()),0); y1=min(int(t[:,1].max())+1,size)
        if x1<=x0 or y1<=y0: continue
        if (x1-x0)*(y1-y0)<=1: 
            if 0<=int(t[0,1])<size and 0<=int(t[0,0])<size:
                if t[:,2].mean()>zbuf[int(t[0,1]),int(t[0,0])]:
                    zbuf[int(t[0,1]),int(t[0,0])]=t[:,2].mean()
                    img[int(t[0,1]),int(t[0,0]),0:3]=c; img[int(t[0,1]),int(t[0,0]),3]=255
            continue
        X,Y=np.meshgrid(xs[x0:x1],xs[y0:y1])
        d=((t[1,1]-t[2,1])*(t[0,0]-t[2,0])+(t[2,0]-t[1,0])*(t[0,1]-t[2,1]))
        if abs(d)<1e-9: continue
        w0=((t[1,1]-t[2,1])*(X-t[2,0])+(t[2,0]-t[1,0])*(Y-t[2,1]))/d
        w1=((t[2,1]-t[0,1])*(X-t[2,0])+(t[0,0]-t[2,0])*(Y-t[2,1]))/d
        w2=1-w0-w1
        m=(w0>=-1e-4)&(w1>=-1e-4)&(w2>=-1e-4)
        if not m.any(): continue
        z=w0*t[0,2]+w1*t[1,2]+w2*t[2,2]
        sub=zbuf[y0:y1,x0:x1]
        upd=m&(z>sub)
        if not upd.any(): continue
        sub[upd]=z[upd]
        tile=img[y0:y1,x0:x1]; tile[upd,0:3]=c; tile[upd,3]=255
    return Image.fromarray(img.astype(np.uint8),"RGBA")
