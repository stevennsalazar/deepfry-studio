import React, { useEffect, useRef, useState } from "react";

type PresetType = 'none'|'film'|'lofi'|'vhs'|'ultra';

export default function DeepFryStudio() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imageBitmap, setImageBitmap] = useState<ImageBitmap | null>(null);

  // FREE adjustments
  const [brightness, setBrightness] = useState<number>(120);
  const [contrast, setContrast] = useState<number>(120);
  const [saturation, setSaturation] = useState<number>(140);
  const [hue, setHue] = useState<number>(0);
  const [sharp, setSharp] = useState<number>(1);
  const [noise, setNoise] = useState<number>(0.08);
  const [posterize, setPosterize] = useState<number>(0);
  const [preset, setPreset] = useState<PresetType>('none');

  const [outW, setOutW] = useState<number>(0);
  const [outH, setOutH] = useState<number>(0);

  // Pro modal visibility
  const [showPro, setShowPro] = useState(false);

  // Size image for canvas
  useEffect(() => {
    if (!imageBitmap) return;
    const max = 1600;
    const scale = Math.min(1, max / Math.max(imageBitmap.width, imageBitmap.height));
    setOutW(Math.round(imageBitmap.width * scale));
    setOutH(Math.round(imageBitmap.height * scale));
  }, [imageBitmap]);

  // Render pipeline
  useEffect(() => {
    if (!imageBitmap) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = (canvas.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D) || canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = outW || imageBitmap.width;
    canvas.height = outH || imageBitmap.height;

    // 1) Base CSS-like filters in an offscreen canvas
    const work = document.createElement('canvas');
    work.width = canvas.width; work.height = canvas.height;
    const wctx = work.getContext('2d')! as any;
    wctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hue}deg)`;
    wctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
    wctx.filter = 'none';

    // 2) Draw to visible canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(work, 0, 0);

    // 3) Posterize
    if (posterize > 1) {
      const img = ctx.getImageData(0,0,canvas.width,canvas.height);
      const d = img.data; const step = 255/(posterize-1);
      for (let i=0;i<d.length;i+=4){
        d[i]   = roundStep(d[i], step);
        d[i+1] = roundStep(d[i+1], step);
        d[i+2] = roundStep(d[i+2], step);
      }
      ctx.putImageData(img,0,0);
    }

    // 4) Noise
    if (noise > 0) {
      const img = ctx.getImageData(0,0,canvas.width,canvas.height);
      const d = img.data; const s = noise * 255;
      for (let i=0;i<d.length;i+=4){
        const n = (Math.random()-0.5)*2*s;
        d[i]   = clamp(d[i]   + n);
        d[i+1] = clamp(d[i+1] + n);
        d[i+2] = clamp(d[i+2] + n);
      }
      ctx.putImageData(img,0,0);
    }

    // 5) Preset overlays
    if (preset==='film') { drawVignette(ctx,canvas.width,canvas.height,0.5); drawFilmBurn(ctx,canvas.width,canvas.height); }
    if (preset==='lofi') { drawVignette(ctx,canvas.width,canvas.height,0.7); }
    if (preset==='vhs')  { drawScanlines(ctx,canvas.width,canvas.height,0.18); drawChromAb(ctx,canvas.width,canvas.height); }
    if (preset==='ultra'){
      drawVignette(ctx,canvas.width,canvas.height,0.8);
      drawFilmBurn(ctx,canvas.width,canvas.height);
      drawScanlines(ctx,canvas.width,canvas.height,0.25);
      drawChromAb(ctx,canvas.width,canvas.height);
    }
  }, [imageBitmap, outW, outH, brightness, contrast, saturation, hue, sharp, noise, posterize, preset]);

  // ---------- Helpers ----------
  function clamp(v: number){ return Math.max(0, Math.min(255, v)); }
  function roundStep(v: number, step: number){ return Math.round(v/step)*step; }
  function drawVignette(ctx: CanvasRenderingContext2D, w:number, h:number, s:number){
    const g=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*0.2, w/2,h/2,Math.max(w,h)*0.7);
    g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,`rgba(0,0,0,${s})`);
    ctx.save(); ctx.globalCompositeOperation='multiply'; ctx.fillStyle=g; ctx.fillRect(0,0,w,h); ctx.restore();
  }
  function drawFilmBurn(ctx: CanvasRenderingContext2D, w:number, h:number){
    const g=ctx.createRadialGradient(w*0.95,h*0.05,10, w*0.7,h*0.1, Math.max(w,h)*0.8);
    g.addColorStop(0,'rgba(255,200,100,0.75)'); g.addColorStop(0.3,'rgba(255,120,0,0.35)'); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.save(); ctx.globalCompositeOperation='screen'; ctx.fillStyle=g; ctx.fillRect(0,0,w,h); ctx.restore();
  }
  function drawScanlines(ctx: CanvasRenderingContext2D, w:number, h:number, o:number){
    ctx.save(); ctx.globalAlpha=o; ctx.fillStyle='#000'; for(let y=0;y<h;y+=2) ctx.fillRect(0,y,w,1); ctx.restore();
  }
  function drawChromAb(ctx: CanvasRenderingContext2D, w:number, h:number){
    const tmp=document.createElement('canvas'); tmp.width=w; tmp.height=h;
    const x=tmp.getContext('2d')!; x.drawImage(ctx.canvas,0,0);
    ctx.save(); ctx.globalCompositeOperation='screen';
    ctx.globalAlpha=0.35; ctx.drawImage(tmp,1,0);
    ctx.globalAlpha=0.35; ctx.drawImage(tmp,-1,0);
    ctx.restore();
  }

  // ---------- File handling ----------
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    ;(window as any).createImageBitmap(f).then((bmp: ImageBitmap) => setImageBitmap(bmp));
  }

  // ---------- Actions ----------
  function handleDownload() {
    const canvas = canvasRef.current; if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'deepfry.jpg';
    link.href = canvas.toDataURL('image/jpeg', 0.9);
    document.body.appendChild(link); link.click(); setTimeout(()=>link.remove(),0);
  }

  function handleReset() {
    setBrightness(120); setContrast(120); setSaturation(140); setHue(0); setSharp(1); setNoise(0.08); setPosterize(0); setPreset('none');
  }

  function handleMakeAnother() {
    handleReset(); setImageBitmap(null); setTimeout(() => fileInputRef.current?.click(), 0);
  }

  function applyPreset(p: PresetType){
    setPreset(p);
    if (p==='film')  { setBrightness(115); setContrast(130); setSaturation(150); setHue(10); setSharp(1); setNoise(0.12); setPosterize(0); }
    else if (p==='lofi'){ setBrightness(110); setContrast(95);  setSaturation(70);  setHue(8);  setSharp(0); setNoise(0.06); setPosterize(0); }
    else if (p==='vhs')  { setBrightness(115); setContrast(130); setSaturation(120); setHue(0);  setSharp(1); setNoise(0.08); setPosterize(0); }
    else if (p==='ultra'){ setBrightness(160); setContrast(200); setSaturation(220); setHue(20); setSharp(3); setNoise(0.2);  setPosterize(6); }
    else if (p==='none'){ handleReset(); }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-30 backdrop-blur border-b border-white/10 bg-neutral-950/70">
        <div className="max-w-6xl mx-auto px-2 sm:px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-indigo-500 shadow" />
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight">DeepFry Studio</h1>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <button onClick={handleDownload} disabled={!imageBitmap} className="px-3 py-2 rounded-xl bg-white text-black text-sm font-semibold hover:bg-neutral-200 transition shadow disabled:opacity-40">Download JPG</button>
            <button onClick={handleMakeAnother} className="px-3 py-2 rounded-xl bg-amber-400 text-black text-sm font-semibold hover:bg-amber-300 transition">Make Another</button>
            <button onClick={handleReset} disabled={!imageBitmap} className="px-3 py-2 rounded-xl bg-white/10 text-sm hover:bg-white/20 border border-white/10">Reset</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-2 sm:px-4 py-4 sm:py-6 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Preview column */}
        <section className="lg:col-span-8">
          <div className="relative aspect-[4/5] sm:aspect-[16/12] w-full rounded-xl sm:rounded-2xl border border-white/10 overflow-hidden bg-neutral-900 flex items-center justify-center">
            {!imageBitmap ? (
              <div className="text-center p-6 sm:p-8">
                <p className="text-base sm:text-lg font-medium mb-1 sm:mb-2">Drop an image here</p>
                <p className="text-xs sm:text-sm text-neutral-300 mb-3 sm:mb-4">or choose a file</p>
                <button onClick={()=>fileInputRef.current?.click()} className="px-3 sm:px-4 py-2 rounded-xl bg-white text-black text-sm font-semibold hover:bg-neutral-200 transition shadow">Upload</button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
              </div>
            ) : (
              <canvas ref={canvasRef} className="w-full h-full object-contain touch-none" />
            )}
          </div>

          {/* Mobile actions */}
          <div className="sm:hidden mt-3 grid grid-cols-3 gap-2">
            <button onClick={handleDownload} disabled={!imageBitmap} className="px-3 py-2 rounded-lg bg-white text-black text-xs font-semibold shadow disabled:opacity-40">Download</button>
            <button onClick={handleMakeAnother} className="px-3 py-2 rounded-lg bg-amber-400 text-black text-xs font-semibold shadow">Another</button>
            <button onClick={handleReset} disabled={!imageBitmap} className="px-3 py-2 rounded-lg bg-white/10 text-xs font-medium border border-white/10 disabled:opacity-40">Reset</button>
          </div>

          {/* Mobile presets */}
          <details className="sm:hidden mt-3 rounded-xl border border-white/10 bg-white/5" open>
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold">Presets</summary>
            <div className="px-4 pb-4 flex flex-wrap gap-2">
              <button onClick={()=>applyPreset('film')}  className={`px-3 py-1.5 rounded-lg border ${preset==='film'  ? 'bg-white text-black' : 'bg-white/10 border-white/10'}`}>90s Film</button>
              <button onClick={()=>applyPreset('lofi')}  className={`px-3 py-1.5 rounded-lg border ${preset==='lofi'  ? 'bg-white text-black' : 'bg-white/10 border-white/10'}`}>Lo-Fi</button>
              <button onClick={()=>applyPreset('vhs')}   className={`px-3 py-1.5 rounded-lg border ${preset==='vhs'   ? 'bg-white text-black' : 'bg-white/10 border-white/10'}`}>VHS</button>
              <button onClick={()=>applyPreset('ultra')} className={`px-3 py-1.5 rounded-lg border ${preset==='ultra' ? 'bg-white text-black' : 'bg-white/10 border-white/10'}`}>Ultra</button>
              <button onClick={()=>applyPreset('none')}  className={`px-3 py-1.5 rounded-lg border ${preset==='none'  ? 'bg-white text-black' : 'bg-white/10 border-white/10'}`}>None</button>
            </div>
          </details>
        </section>

        {/* Sidebar */}
        <aside className="hidden sm:block lg:col-span-4 space-y-4">
          <div className="rounded-2xl border border-white/10 p-4 bg-white/5">
            <h2 className="text-sm font-semibold mb-3">Presets</h2>
            <div className="flex flex-wrap gap-2">
              <button onClick={()=>applyPreset('film')}  className={`px-3 py-1.5 rounded-xl border ${preset==='film'  ? 'bg-white text-black' : 'bg-white/10 border-white/10 hover:bg-white/20'}`}>90s Film Burn</button>
              <button onClick={()=>applyPreset('lofi')}  className={`px-3 py-1.5 rounded-xl border ${preset==='lofi'  ? 'bg-white text-black' : 'bg-white/10 border-white/10 hover:bg-white/20'}`}>Lo-Fi</button>
              <button onClick={()=>applyPreset('vhs')}   className={`px-3 py-1.5 rounded-xl border ${preset==='vhs'   ? 'bg-white text-black' : 'bg-white/10 border-white/10 hover:bg-white/20'}`}>VHS</button>
              <button onClick={()=>applyPreset('ultra')} className={`px-3 py-1.5 rounded-xl border ${preset==='ultra' ? 'bg-white text-black' : 'bg-white/10 border-white/10 hover:bg-white/20'}`}>Ultra Deep Fried</button>
              <button onClick={()=>applyPreset('none')}  className={`px-3 py-1.5 rounded-xl border ${preset==='none'  ? 'bg-white text-black' : 'bg-white/10 border-white/10 hover:bg-white/20'}`}>None</button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 p-4 bg-white/5">
            <h2 className="text-sm font-semibold mb-3">Download</h2>
            <div className="grid gap-2">
              <button onClick={handleDownload} disabled={!imageBitmap} className="px-3 py-2 rounded-xl bg-white text-black text-sm font-semibold hover:bg-neutral-200 transition shadow disabled:opacity-40">Download JPG</button>
              <button onClick={handleMakeAnother} className="px-3 py-2 rounded-xl bg-amber-400 text-black text-sm font-semibold hover:bg-amber-300 transition">Make Another</button>
            </div>
          </div>
        </aside>
      </main>

      <footer className="max-w-6xl mx-auto px-2 sm:px-4 pb-10 text-xs text-neutral-400">
        <div className="border-t border-white/10 pt-4 flex items-center justify-between">
          <p>Made with ❤️ for memes</p>
          <p>Drag, tweak, fry, download.</p>
        </div>
      </footer>

      {/* Floating Pro teaser button */}
      <button
        onClick={() => setShowPro(true)}
        className="fixed bottom-4 right-4 z-40 px-4 py-2 rounded-2xl shadow-lg bg-amber-400 text-black text-sm font-semibold hover:bg-amber-300 active:scale-95 transition"
        aria-label="Upgrade to Pro"
      >
        ⭐ Pro Features
      </button>

      {/* Pro modal */}
      {showPro && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-neutral-900 rounded-2xl p-6 max-w-md w-full border border-white/10">
            <h2 className="text-lg font-semibold mb-4">DeepFry Studio Pro</h2>
            <ul className="text-sm text-neutral-300 mb-4 list-disc pl-5 space-y-1">
              <li>Export PNG/WebP/AVIF with quality controls</li>
              <li>Resize & batch conversion</li>
              <li>Extra presets & VHS overlays</li>
              <li>No ads</li>
            </ul>
            <div className="flex gap-3">
              <button
                onClick={()=>setShowPro(false)}
                className="flex-1 px-3 py-2 rounded-xl bg-white/10 text-sm font-medium hover:bg-white/20"
              >
                Maybe later
              </button>
              <button
                onClick={()=>{/* Hook up checkout later */}}
                className="flex-1 px-3 py-2 rounded-xl bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400"
              >
                Upgrade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
