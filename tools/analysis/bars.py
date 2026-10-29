import sys, numpy as np, librosa, json
y,sr=librosa.load(sys.argv[1],sr=22050,mono=True)
beats=np.array(json.load(open(sys.argv[2]))["beats"])
bars=beats[::4]
C=librosa.feature.chroma_cqt(y=y,sr=sr,hop_length=512); ct=librosa.times_like(C,sr=sr,hop_length=512)
rms=librosa.feature.rms(y=y,hop_length=512)[0]
# vocal-ish: harmonic mid band energy via spectral; use spectral centroid
cen=librosa.feature.spectral_centroid(y=y,sr=sr,hop_length=512)[0]
Sx=np.abs(librosa.stft(y,n_fft=2048,hop_length=512)); f=librosa.fft_frequencies(sr=sr,n_fft=2048)
def band(lo,hi): return Sx[(f>=lo)&(f<hi)].sum(0)
bl=band(30,150); bm=band(300,3000); bh=band(6000,11000)
feat=[]
for i in range(len(bars)-1):
    m=(ct>=bars[i])&(ct<bars[i+1])
    c=C[:,m].mean(1); feat.append(c/np.linalg.norm(c))
    print(f"bar{i:2d} {bars[i]:6.2f}s rms{20*np.log10(rms[m].mean()):6.1f} low{20*np.log10(bl[m].mean()):5.1f} mid{20*np.log10(bm[m].mean()):5.1f} hi{20*np.log10(bh[m].mean()+1e-9):5.1f} cen{cen[m].mean():5.0f} key{np.argmax(c)}")
F=np.array(feat); SS=F@F.T
# similarity of 4-bar blocks
nb=len(F)
print("4-bar block similarity (start bars)")
starts=list(range(0,nb-3))
for i in range(0,nb-3,2):
    best=sorted([(SS[i:i+4,j:j+4].diagonal().mean(),j) for j in range(0,nb-3) if abs(j-i)>=4],reverse=True)[:3]
    print(i, [(round(s,3),j) for s,j in best])
