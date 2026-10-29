import sys, numpy as np, librosa, json
y,sr=librosa.load(sys.argv[1],sr=22050,mono=True)
hop=64; fr=sr/hop
low,mid,hi,full=np.load(sys.argv[2])
_,beats=librosa.beat.beat_track(onset_envelope=full,sr=sr,hop_length=hop,units='time',start_bpm=130,tightness=1000)
b=np.array(beats)
# refine to local onset peaks
def pk(t,e,w=0.025):
    a=int((t-w)*fr); c=int((t+w)*fr); seg=e[a:c]; return (a+np.argmax(seg))/fr, seg.max()
rb=[]; 
for t in b:
    tp,v=pk(t,full); rb.append(tp if v>0.12 else np.nan)
rb=np.array(rb); n=np.arange(len(b))
# local linear smoothing
sm=np.zeros(len(b))
for i in range(len(b)):
    m=(abs(n-i)<=6)&~np.isnan(rb)
    p=np.polyfit(n[m],rb[m],1 if m.sum()<8 else 2); sm[i]=np.polyval(p,i)
r=rb-sm; print("smooth resid rms ms",np.nanstd(r)*1000)
# extend backwards with local period
per0=np.median(np.diff(sm[:8])); pre=[]; t=sm[0]-per0
while t>0.05: pre.insert(0,t); t-=per0
allb=np.concatenate([pre,sm]); 
perE=np.median(np.diff(sm[-8:])); 
print("prebeats",np.round(pre,3), "count total",len(allb))
# kick energy per beat
def at(e,t,w=0.03):
    a=max(0,int((t-w)*fr)); c=int((t+w)*fr); return e[a:c].max()
K=np.array([at(low,t) for t in allb]); H=np.array([at(hi,t) for t in allb]); M=np.array([at(mid,t) for t in allb])
for ph in range(4):
    print("phase",ph,"kick",K[ph::4].mean().round(3),"mid",M[ph::4].mean().round(3),"hi",H[ph::4].mean().round(3))
# chroma change per beat
C=librosa.feature.chroma_cqt(y=y,sr=sr,hop_length=512)
ct=librosa.times_like(C,sr=sr,hop_length=512)
bc=[]
for i in range(len(allb)-1):
    m=(ct>=allb[i])&(ct<allb[i+1]); bc.append(C[:,m].mean(1) if m.any() else np.zeros(12))
bc=np.array(bc); nov=np.r_[0,np.linalg.norm(np.diff(bc,axis=0),axis=1)]
for ph in range(4): print("phase",ph,"chroma novelty",nov[ph::4].mean().round(3))
json.dump({"beats":allb.tolist()},open(sys.argv[3],"w"))
# print per-beat summary
for i,t in enumerate(allb):
    print(f"{i:3d} {t:7.3f} K{K[i]:.2f} M{M[i]:.2f} H{H[i]:.2f} N{nov[i] if i<len(nov) else 0:.2f}")
