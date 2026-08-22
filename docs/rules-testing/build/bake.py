"""Bake an LDraw model to merged per-colour triangle soup, in world space."""
import os,sys,re,functools
LIB=os.path.expanduser("/Users/tobytremayne/work/ldraw-verify/.cache/ldraw")
SUB=["parts","p","parts/s","p/48","p/8","models"]
LORES=os.environ.get("LDRAW_LORES")=="1"

@functools.lru_cache(maxsize=None)
def find(name):
    n=name.replace("\\","/").split("/")[-1].lower()
    if LORES:
        p8=os.path.join(LIB,"p","8",n)
        if os.path.exists(p8): return p8
    for d in SUB:
        p=os.path.join(LIB,d,n)
        if os.path.exists(p): return p
    return None

@functools.lru_cache(maxsize=None)
def readfile(path):
    with open(path,encoding="utf-8",errors="replace") as f: return f.read()

def mat(v):  # 12 numbers -> 4x4 row-major flat (rot rows a,b,c / d,e,f / g,h,i ; trans x,y,z)
    x,y,z,a,b,c,d,e,f,g,h,i=v
    return (a,b,c,x, d,e,f,y, g,h,i,z)

def mul(A,B):
    a=A; b=B
    out=[0]*12
    for r in range(3):
        for col in range(3):
            out[r*4+col]=a[r*4]*b[col]+a[r*4+1]*b[4+col]+a[r*4+2]*b[8+col]
        out[r*4+3]=a[r*4]*b[3]+a[r*4+1]*b[7]+a[r*4+2]*b[11]+a[r*4+3]
    return tuple(out)

def apply(M,p):
    x,y,z=p
    return (M[0]*x+M[1]*y+M[2]*z+M[3], M[4]*x+M[5]*y+M[6]*z+M[7], M[8]*x+M[9]*y+M[10]*z+M[11])

IDENT=(1,0,0,0, 0,1,0,0, 0,0,1,0)

def bake(text, blocks=None, M=IDENT, colour=16, out=None, depth=0, seen=None):
    """blocks: dict of MPD subfile name -> text. out: dict colour -> list of 9-float tris."""
    if out is None: out={}
    if seen is None: seen=set()
    if depth>24: return out
    ingen=False
    for line in text.split("\n"):
        s=line.strip()
        if not s: continue
        if s.startswith("0 "):
            u=s.upper()
            if "!LDCAD GENERATED" in u: ingen=True
            continue
        if ingen and s[0] in "345": continue     # skip flex fallback polys
        t=s.split()
        try: lt=int(t[0])
        except: continue
        if lt==1 and len(t)>=15:
            try: c=int(t[1]); nums=[float(x) for x in t[2:14]]
            except: continue
            nm=" ".join(t[14:])
            cc=colour if c==16 else c
            child=mul(M,mat(nums))
            key=nm.replace("\\","/").split("/")[-1].lower()
            if blocks and key in blocks:
                if key in seen: continue
                bake(blocks[key],blocks,child,cc,out,depth+1,seen|{key})
            else:
                p=find(nm)
                if p: bake(readfile(p),blocks,child,cc,out,depth+1,seen)
        elif lt in (3,4) and not ingen:
            try: c=int(t[1]); v=[float(x) for x in t[2:2+(9 if lt==3 else 12)]]
            except: continue
            cc=colour if c==16 else c
            pts=[apply(M,(v[i],v[i+1],v[i+2])) for i in range(0,len(v),3)]
            tris=out.setdefault(cc,[])
            tris.append(pts[0]+pts[1]+pts[2])
            if lt==4: tris.append(pts[0]+pts[2]+pts[3])
    return out

def load_model(path):
    txt=open(path,encoding="utf-8",errors="replace").read()
    parts=re.split(r'(?im)^0\s+FILE\s+(.+?)\s*$',txt)
    if len(parts)>1:
        blocks={}; names=[]
        for i in range(1,len(parts),2):
            k=parts[i].replace("\\","/").split("/")[-1].lower(); blocks[k]=parts[i+1]; names.append(k)
        return blocks[names[0]],blocks
    return txt,None
