import sys, numpy as np, librosa
y,sr=librosa.load(sys.argv[1],sr=22050,mono=True)
hop=64; fr=sr/hop
S=np.abs(librosa.stft(y,n_fft=1024,hop_length=hop))
f=librosa.fft_frequencies(sr=sr,n_fft=1024)
def env(lo,hi):
    m=(f>=lo)&(f<hi); e=np.log1p(100*S[m]).sum(0); d=np.maximum(0,np.diff(e,prepend=e[0])); return d/ d.max()
low=env(30,150); mid=env(150,2000); hi=env(5000,11000); full=env(30,11000)
np.save(sys.argv[2],np.vstack([low,mid,hi,full]))
# local tempo via autocorrelation over 8s windows, fine resolution
for w0 in range(0,68,4):
    a=int(w0*fr); b=int((w0+8)*fr); x=full[a:b]-full[a:b].mean()
    ac=np.correlate(x,x,'full')[len(x)-1:]
    # search lag for 120-140bpm
    lags=np.arange(int(fr*60/140),int(fr*60/120)+1)
    L=lags[np.argmax(ac[lags])]
    # parabolic refine
    y0,y1,y2=ac[L-1],ac[L],ac[L+1]; d=0.5*(y0-y2)/(y0-2*y1+y2)
    # also use 4-beat lag for precision
    lags4=np.arange(int(4*fr*60/140),int(4*fr*60/120)+1); L4=lags4[np.argmax(ac[lags4])]
    z0,z1,z2=ac[L4-1],ac[L4],ac[L4+1]; d4=0.5*(z0-z2)/(z0-2*z1+z2)
    print(f"{w0:2d}-{w0+8}s bpm1 {60*fr/(L+d):.2f}  bpm4 {4*60*fr/(L4+d4):.2f}")
