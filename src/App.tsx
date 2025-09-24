import React, { useEffect, useRef, useState } from "react";

/**
 * DeepFry Studio — Mobile-smooth + Stronger Burn + Bloom
 * - RAF render queue for smooth sliders on mobile
 * - Half-res while scrubbing, full-res on release
 * - Brightness up to 400% (extra pixel gain beyond 200%)
 * - Exposure (EV) -2..+2
 * - Burn (0..100): warms highlights, adds edge burn, subtle bloom
 */

type PresetType = "none" | "film" | "lofi" | "vhs" | "ultra";

export default function DeepFryStudio() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imageBitmap, setImageBitmap] = useState<ImageBitmap | null>(null);

  // Adjustments
  const [brightness, setBrightness] = useState<number>(120); // 50..400 %
  const [contrast, setContrast] = useState<number>(120); // %
  const [saturation, setSaturation] = useState<number>(140); // %
  const [hue, setHue] = useState<number>(0); // deg
  const [exposureEV, setExposureEV] = useState<number>(0); // -2..+2 (stops)
  const [burn, setBurn] = useState<number>(35); // 0..100 (%)
  const [noise, setNoise] = useState<number>(0.08); // 0..1
  const [posterize, setPosterize] = useState<number>(0); // 0..8
  const [preset, setPreset] = useState<PresetType>("none");

  // Output sizing
  const [outW, setOutW] = useState<number>(0);
  const [outH, setOutH] = useState<number>(0);

  // Perf state
  const isScrubbingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const wantFullRef = useRef(false);

  // Size image on load
  useEffect(() => {
    if (!imageBitmap) return;
    const max = 1600;
    const scale = Math.min(1, max / Math.max(imageBitmap.width, imageBitmap.height));
    setOutW(Math.round(imageBitmap.width * scale));
    setOutH(Math.round(imageBitmap.height * scale));
    queueRender(true);
  }, [imageBitmap]);

  // Queue a render on next RAF
  function queueRender(requestFull: boolean) {
    if (requestFull) wantFullRef.current = true;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const runFull = wantFullRef.current && !isScrubbingRef.current;
      wantFullRef.current = false;
      renderFrame(runFull);
    });
  }

  // When inputs change, schedule render
  useEffect(() => {
    queueRender(false);
  }, [brightness, contrast, saturation, hue, exposureEV, burn, preset]);
  useEffect(() => {
    // heavy-only controls
    queueRender(!isScrubbingRef.current);
  }, [noise, posterize]);
  useEffect(() => {
    queueRender(true);
  }, [outW, outH]);

  function renderFrame(runHeavyPasses: boolean) {
    if (!imageBitmap) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx =
      (canvas.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D) ||
      canvas.getContext("2d");
    if (!ctx) return;

    // visible canvas target size
    const CW = outW || imageBitmap.width;
    const CH = outH || imageBitmap.height;
    canvas.width = CW;
    canvas.height = CH;

    // while scrubbing use lower-res working buffer to stay smooth on mobile
    const previewScale = isScrubbingRef.current ? 0.35 : 1; // 35% while dragging
    const W = Math.max(1, Math.floor(CW * previewScale));
    const H = Math.max(1, Math.floor(CH * previewScale));

    const work = document.createElement("canvas");
    work.width = W;
    work.height = H;
    const wctx = work.getContext("2d")! as any;

    // 1) CSS filter pass (cheap on GPU) — cap brightness at 200%
    const cssB = Math.min(brightness, 200);
    wctx.filter = `brightness(${cssB}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hue}deg)`;
    wctx.imageSmoothingEnabled = true;
    wctx.drawImage(imageBitmap, 0, 0, W, H);
    wctx.filter = "none";

    // 2) Pixel pass (skip heaviest work while scrubbing)
    const allowHeavy = runHeavyPasses || !isScrubbingRef.current;
    if (allowHeavy || exposureEV !== 0 || brightness > 200 || burn > 0) {
      const img = wctx.getImageData(0, 0, W, H);
      const d = img.data;

      const exposureGain = Math.pow(2, exposureEV);
      const extraGain = Math.max(1, brightness / 200); // > 200% boosted here

      const doPosterize = posterize > 1 && allowHeavy;
      const step = doPosterize ? 255 / (posterize - 1) : 0;

      const doNoise = noise > 0 && allowHeavy;
      const noiseAmp = doNoise ? noise * 255 : 0;

      // Burn controls
      const burnAmt = Math.max(0, Math.min(1, burn / 100)); // 0..1
      const warmBoost = 0.45 * burnAmt; // stronger warmth
      const hlPush = 1.15 * burnAmt; // stronger highlight push
      const blueCut = 0.28 * burnAmt; // reduce blue more

      for (let i = 0; i < d.length; i += 4) {
        let r = d[i] * exposureGain * extraGain;
        let g = d[i + 1] * exposureGain * extraGain;
        let b = d[i + 2] * exposureGain * extraGain;

        if (burnAmt > 0) {
          const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const t = Math.min(1, Math.max(0, (L - 110) / 145)); // start warming earlier
          const push = 1 + hlPush * t;
          r = r * push + 255 * warmBoost * t * 0.6;
          g = g * (1 + (hlPush * 0.65) * t) + 255 * warmBoost * t * 0.3;
          b = b * (1 + (hlPush * 0.35) * t) - 255 * blueCut * t * 0.2;
        }

        if (doPosterize) {
          r = Math.round(r / step) * step;
          g = Math.round(g / step) * step;
          b = Math.round(b / step) * step;
        }

        if (doNoise) {
          const n = (Math.random() - 0.5) * 2 * noiseAmp;
          r += n;
          g += n;
          b += n;
        }

        d[i] = clamp(r);
        d[i + 1] = clamp(g);
        d[i + 2] = clamp(b);
      }

      wctx.putImageData(img, 0, 0);

      // 2b) Heat bloom (cheap blur via downscale-upscale) — gives stronger burn "glow"
      if (burnAmt > 0 && allowHeavy) {
        const bloomScale = 0.25; // small downsample
        const bw = Math.max(1, (W * bloomScale) | 0);
        const bh = Math.max(1, (H * bloomScale) | 0);
        const bcnv = document.createElement("canvas");
        bcnv.width = bw;
        bcnv.height = bh;
        const bx = bcnv.getContext("2d")!;
        bx.imageSmoothingEnabled = true;
        bx.drawImage(work, 0, 0, bw, bh);
        wctx.save();
        wctx.globalCompositeOperation = "screen";
        wctx.globalAlpha = 0.35 * burnAmt;
        wctx.drawImage(bcnv, 0, 0, W, H);
        wctx.restore();
      }
    }

    // 3) Blit working buffer to visible canvas
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, CW, CH);
    ctx.drawImage(work, 0, 0, CW, CH);

    // 4) Overlays (cheap) — include extra burn vignette if burn>0
    if (preset === "film") {
      drawVignette(ctx, CW, CH, 0.5);
      drawFilmBurn(ctx, CW, CH, 0.8);
    }
    if (preset === "lofi") {
      drawVignette(ctx, CW, CH, 0.7);
    }
    if (preset === "vhs") {
      drawScanlines(ctx, CW, CH, 0.18);
      drawChromAb(ctx, CW, CH);
    }
    if (preset === "ultra") {
      drawVignette(ctx, CW, CH, 0.85);
      drawFilmBurn(ctx, CW, CH, 1.0);
      drawScanlines(ctx, CW, CH, 0.25);
      drawChromAb(ctx, CW, CH);
    }

    if (burn > 0) {
      drawVignette(ctx, CW, CH, 0.28 * (burn / 100)); // stronger edge darken
      drawWarmEdgeBurn(ctx, CW, CH, 0.5 * (burn / 100)); // warm edge glow
    }
  }

  // Helpers
  function clamp(v: number) {
    return Math.max(0, Math.min(255, v | 0));
  }

  function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function drawFilmBurn(ctx: CanvasRenderingContext2D, w: number, h: number, energy = 0.8) {
    const g = ctx.createRadialGradient(w * 0.95, h * 0.05, 10, w * 0.7, h * 0.1, Math.max(w, h) * 0.85);
    g.addColorStop(0, `rgba(255,200,100,${0.7 * energy})`);
    g.addColorStop(0.35, `rgba(255,120,0,${0.35 * energy})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function drawWarmEdgeBurn(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number) {
    // warm radial from edges inward
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.max(w, h) * 0.55, w / 2, h / 2, Math.max(w, h) * 0.95);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(255,120,0,${Math.min(0.5, strength)})`);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function drawScanlines(ctx: CanvasRenderingContext2D, w: number, h: number, opacity: number) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = "#000";
    for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 1);
    ctx.restore();
  }

  function drawChromAb(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const x = tmp.getContext("2d")!;
    x.drawImage(ctx.canvas, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.35;
    ctx.drawImage(tmp, 1, 0);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(tmp, -1, 0);
    ctx.restore();
  }

  // File handling
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    (window as any).createImageBitmap(f).then((bmp: ImageBitmap) => setImageBitmap(bmp));
  }
  function loadDemo() {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 800;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 640, 800);
    g.addColorStop(0, "#ff8a00");
    g.addColorStop(1, "#6a00ff");
    x.fillStyle = g;
    x.fillRect(0, 0, 640, 800);
    x.fillStyle = "rgba(255,255,255,0.9)";
    x.font = "48px system-ui";
    x.fillText("Demo Image", 200, 400);
    (window as any).createImageBitmap(c).then((bmp: ImageBitmap) => setImageBitmap(bmp));
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = (e as any).dataTransfer?.files?.[0] as File | undefined;
    if (f) (window as any).createImageBitmap(f).then((bmp: ImageBitmap) => setImageBitmap(bmp));
  }

  // Actions
  function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width === 0 || canvas.height === 0) {
      alert("Nothing to download yet.");
      return;
    }
    const link = document.createElement("a");
    link.download = "deepfry.jpg";
    link.href = canvas.toDataURL("image/jpeg", 0.9);
    document.body.appendChild(link);
    link.click();
    setTimeout(() => link.remove(), 0);
  }
  function handleReset() {
    setBrightness(120);
    setContrast(120);
    setSaturation(140);
    setHue(0);
    setExposureEV(0);
    setBurn(35);
    setNoise(0.08);
    setPosterize(0);
    setPreset("none");
    queueRender(true);
  }
  function handleMakeAnother() {
    handleReset();
    setImageBitmap(null);
    setTimeout(() => fileInputRef.current?.click(), 0);
  }

  function applyPreset(p: PresetType) {
    setPreset(p);
    if (p === "film") {
      setBrightness(115);
      setContrast(130);
      setSaturation(150);
      setHue(10);
      setExposureEV(0.2);
      setBurn(50);
      setNoise(0.12);
      setPosterize(0);
    } else if (p === "lofi") {
      setBrightness(110);
      setContrast(95);
      setSaturation(70);
      setHue(8);
      setExposureEV(-0.1);
      setBurn(20);
      setNoise(0.06);
      setPosterize(0);
    } else if (p === "vhs") {
      setBrightness(115);
      setContrast(130);
      setSaturation(120);
      setHue(0);
      setExposureEV(0);
      setBurn(30);
      setNoise(0.08);
      setPosterize(0);
    } else if (p === "ultra") {
      setBrightness(200);
      setContrast(200);
      setSaturation(220);
      setHue(20);
      setExposureEV(0.8);
      setBurn(75);
      setNoise(0.2);
      setPosterize(6);
    } else if (p === "none") {
      handleReset();
    }
    queueRender(true);
  }

  // slider UX helpers
  const startScrub = () => {
    isScrubbingRef.current = true;
    queueRender(false);
  };
  const endScrub = () => {
    isScrubbingRef.current = false;
    queueRender(true);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100" onDragOver={onDragOver} onDrop={onDrop}>
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
                <div className="flex justify-center gap-2">
                  <button onClick={() => fileInputRef.current?.click()} className="px-3 sm:px-4 py-2 rounded-xl bg-white text-black text-sm font-semibold hover:bg-neutral-200 transition shadow">Upload</button>
                  <button onClick={loadDemo} className="px-3 sm:px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm hover:bg-white/20">Load Demo</button>
                </div>
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
              <button onClick={() => applyPreset('film')} className={`px-3 py-1.5 rounded-lg border ${preset === 'film' ? 'bg-white text-black' : 'bg-white/10 border-white/10'}`}>90s Film</button>
              <button onClick={() => applyPreset('lofi')} className={`px-3 py-1.5 rounded-lg border ${preset === 'lofi' ? 'bg-white text-black' : 'bg-white/10 border-white/10'}`}>Lo-Fi</button>
              <button onClick={() => applyPreset('vhs')} className={`px-3 py-1.5 rounded-lg border ${preset === 'vhs' ? 'bg-white text-black' : 'bg-white/10 border-white/10'}`}>VHS</button>
              <button onClick={() => applyPreset('ultra')} className={`px-3 py-1.5 rounded-lg border ${preset === 'ultra' ? 'bg-white text-black' : 'bg-white/10 border-white/10'}`}>Ultra</button>
              <button onClick={() => applyPreset('none')} className={`px-3 py-1.5 rounded-lg border ${preset === 'none' ? 'bg-white text-black' : 'bg-white/10 border-white/10'}`}>None</button>
            </div>
          </details>

          {/* Mobile adjustments */}
          <details className="sm:hidden mt-2 rounded-xl border border-white/10 bg-white/5" open>
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold">Adjustments</summary>
            <div className="px-4 pb-4">
              {[
                { label: `Brightness: ${brightness}%`, min: 50, max: 400, step: 1, val: brightness, set: setBrightness },
                { label: `Contrast: ${contrast}%`, min: 50, max: 250, step: 1, val: contrast, set: setContrast },
                { label: `Saturation: ${saturation}%`, min: 0, max: 300, step: 1, val: saturation, set: setSaturation },
                { label: `Hue: ${hue}°`, min: -180, max: 180, step: 1, val: hue, set: setHue },
                { label: `Exposure: ${exposureEV >= 0 ? '+' : ''}${exposureEV.toFixed(1)} EV`, min: -2, max: 2, step: 0.1, val: exposureEV, set: setExposureEV },
                { label: `Burn: ${burn}%`, min: 0, max: 100, step: 1, val: burn, set: setBurn },
                { label: `Noise: ${(noise * 100).toFixed(0)}%`, min: 0, max: 1, step: 0.01, val: noise, set: setNoise },
                { label: `Posterize: ${posterize || 'off'}`, min: 0, max: 8, step: 1, val: posterize, set: setPosterize },
              ].map((s, i) => (
                <label key={i} className="block mb-4 text-xs">
                  <div className="mb-1 text-neutral-300">{s.label}</div>
                  <input
                    type="range"
                    min={s.min as number}
                    max={s.max as number}
                    step={s.step as number}
                    value={s.val as number}
                    onPointerDown={startScrub}
                    onPointerUp={endScrub}
                    onPointerCancel={endScrub}
                    onInput={(e: any) => s.set(parseFloat(e.target.value))}
                    className="w-full h-4 accent-white"
                  />
                </label>
              ))}
            </div>
          </details>
        </section>

        {/* Desktop sidebar */}
        <aside className="hidden sm:block lg:col-span-4 space-y-4">
          <div className="rounded-2xl border border-white/10 p-4 bg-white/5">
            <h2 className="text-sm font-semibold mb-3">Presets</h2>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => applyPreset('film')} className={`px-3 py-1.5 rounded-xl border ${preset === 'film' ? 'bg-white text-black' : 'bg-white/10 border-white/10 hover:bg-white/20'}`}>90s Film Burn</button>
              <button onClick={() => applyPreset('lofi')} className={`px-3 py-1.5 rounded-xl border ${preset === 'lofi' ? 'bg-white text-black' : 'bg-white/10 border-white/10 hover:bg-white/20'}`}>Lo-Fi</button>
              <button onClick={() => applyPreset('vhs')} className={`px-3 py-1.5 rounded-xl border ${preset === 'vhs' ? 'bg-white text-black' : 'bg-white/10 border-white/10 hover:bg-white/20'}`}>VHS</button>
              <button onClick={() => applyPreset('ultra')} className={`px-3 py-1.5 rounded-xl border ${preset === 'ultra' ? 'bg-white text-black' : 'bg-white/10 border-white/10 hover:bg-white/20'}`}>Ultra Deep Fried</button>
              <button onClick={() => applyPreset('none')} className={`px-3 py-1.5 rounded-xl border ${preset === 'none' ? 'bg-white text-black' : 'bg-white/10 border-white/10 hover:bg-white/20'}`}>None</button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 p-4 bg-white/5">
            <h2 className="text-sm font-semibold mb-3">Adjustments</h2>
            {[
              { label: `Brightness: ${brightness}%`, min: 50, max: 400, step: 1, val: brightness, set: setBrightness },
              { label: `Contrast: ${contrast}%`, min: 50, max: 250, step: 1, val: contrast, set: setContrast },
              { label: `Saturation: ${saturation}%`, min: 0, max: 300, step: 1, val: saturation, set: setSaturation },
              { label: `Hue: ${hue}°`, min: -180, max: 180, step: 1, val: hue, set: setHue },
              { label: `Exposure: ${exposureEV >= 0 ? '+' : ''}${exposureEV.toFixed(1)} EV`, min: -2, max: 2, step: 0.1, val: exposureEV, set: setExposureEV },
              { label: `Burn: ${burn}%`, min: 0, max: 100, step: 1, val: burn, set: setBurn },
              { label: `Noise: ${(noise * 100).toFixed(0)}%`, min: 0, max: 1, step: 0.01, val: noise, set: setNoise },
              { label: `Posterize levels: ${posterize || 'off'}`, min: 0, max: 8, step: 1, val: posterize, set: setPosterize },
            ].map((s, i) => (
              <label key={i} className="block mb-3 text-xs">
                <div className="mb-1 text-neutral-300">{s.label}</div>
                <input
                  type="range"
                  min={s.min as number}
                  max={s.max as number}
                  step={s.step as number}
                  value={s.val as number}
                  onPointerDown={startScrub}
                  onPointerUp={endScrub}
                  onPointerCancel={endScrub}
                  onInput={(e: any) => s.set(parseFloat(e.target.value))}
                  className="w-full accent-white"
                />
              </label>
            ))}
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
    </div>
  );
}
