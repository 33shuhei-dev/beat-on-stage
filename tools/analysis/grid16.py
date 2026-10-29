import sys, numpy as np, json
low,mid,hi,full=np.load(sys.argv[1]); fr=22050/64
beats=np.array(json.load(open(sys.argv[2]))["beats"])
# 16th slot times by interpolating between beats
slots=[]
for i in range(len(beats)-1):
    for k in range(4): slots.append(beats[i]+(beats[i+1]-beats[i])*k/4)
slots=np.array(slots)
def at(e,t,w=0.022):
    a=max(0,int((t-w)*fr)); c=int((t+w)*fr); return e[a:c].max()
out={}
for name,e in (("L",low),("M",mid),("H",hi),("F",full)):
    v=np.array([at(e,t) for t in slots]); out[name]=v
nb=len(slots)//16
def row(v,b): 
    s=v[b*16:(b+1)*16]; return "".join(str(min(9,int(x*14))) if x>0.12 else "." for x in s)
print("bar  time   | LOW(kick)        | MID(voice/synth) | FULL")
for b in range(nb):
    print(f"{b:2d} {slots[b*16]:6.2f} | {row(out['L'],b)} | {row(out['M'],b)} | {row(out['F'],b)}")
json.dump({k:v.tolist() for k,v in out.items()}|{"slots":slots.tolist()},open(sys.argv[3],"w"))
