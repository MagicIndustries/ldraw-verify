import bake,render,json,base64,io,os
RD=json.load(open("ruledetail.json"))
n=0
for r in RD:
    if not r["imgs"]: continue
    for kind in list(r["imgs"].keys()):
        p=f"canon/{r['id']}.{kind}.ldr"
        if not os.path.exists(p): print("MISSING",p); continue
        txt,b=bake.load_model(p)
        out=bake.bake(txt,b)
        im=render.render(out,size=300,yaw=35,pitch=22)
        buf=io.BytesIO(); im.save(buf,"PNG")
        r["imgs"][kind]=base64.b64encode(buf.getvalue()).decode()
        os.makedirs("out/ex",exist_ok=True); im.save(f"out/ex/{r['id']}.{kind}.png")
        n+=1
json.dump(RD,open("ruledetail.json","w"))
print("re-rendered",n,"exemplar images")
