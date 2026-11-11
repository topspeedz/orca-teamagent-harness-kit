'use strict';
// probe-fps.cjs — 이 OS·플래그 조합에서 headless Chromium 이 실제로 GPU 를 쓰는지 1분 안에 측정한다.
// 출력(JSON): renderer 문자열(SwiftShader 면 소프트웨어 렌더), fps, 사용한 플래그, Playwright/Chromium 버전.
// GPU_PROFILES 의 status 를 'measured' 로 올리는 근거는 이 출력이다.
//
//   node .claude/scripts/browser/probe-fps.cjs              # GPU 플래그 사용
//   node .claude/scripts/browser/probe-fps.cjs --no-gpu     # 비교군(소프트웨어 렌더)
//   PW_CHANNEL=chromium node .claude/scripts/browser/probe-fps.cjs   # 새 headless 모드 비교(Playwright ≥1.49)
//   node .claude/scripts/browser/probe-fps.cjs --seconds=5 --layers=48

const { launchWithMeta, log } = require('./launch.cjs');

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const NO_GPU = argv.includes('--no-gpu');
const SECONDS = Number(flag('seconds', 3));
const LAYERS = Number(flag('layers', 8)); // 프레임당 풀스크린 패스 수. 기준값 8: SwiftShader(Linux, Chromium 153) 에서 1.2fps 실측, GPU 는 60fps(vsync 상한) 기대.

const PAGE = `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="1280" height="720"></canvas>
<script>
window.__probe = async (seconds, layers) => {
  const canvas = document.getElementById('c');
  const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' })
          || canvas.getContext('webgl', { antialias: false, powerPreference: 'high-performance' });
  if (!gl) return { error: 'no webgl context' };
  const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);

  const vs = isGL2
    ? '#version 300 es\\nin vec2 p; out vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.0,1.0); }'
    : 'attribute vec2 p; varying vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.0,1.0); }';
  const fsBody = 'float a = 0.0; for (int i = 0; i < 64; i++) { a += sin(uv.x*float(i)*t) * cos(uv.y*float(i)+t); }';
  const fs = isGL2
    ? '#version 300 es\\nprecision highp float; in vec2 uv; uniform float t; out vec4 o; void main(){ ' + fsBody + ' o = vec4(fract(a), uv, 0.02); }'
    : 'precision highp float; varying vec2 uv; uniform float t; void main(){ ' + fsBody + ' gl_FragColor = vec4(fract(a), uv, 0.02); }';
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tLoc = gl.getUniformLocation(prog, 't');
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  // 워밍업 0.5s 후 측정
  const draw = (t) => { gl.uniform1f(tLoc, t); for (let i = 0; i < layers; i++) gl.drawArrays(gl.TRIANGLES, 0, 6); gl.finish(); };
  await new Promise((res) => { const t0 = performance.now(); const loop = (now) => { draw(now/1000); (now - t0 < 500) ? requestAnimationFrame(loop) : res(); }; requestAnimationFrame(loop); });
  let frames = 0;
  const t0 = performance.now();
  await new Promise((res) => { const loop = (now) => { draw(now/1000); frames++; (now - t0 < seconds*1000) ? requestAnimationFrame(loop) : res(); }; requestAnimationFrame(loop); });
  const elapsed = (performance.now() - t0) / 1000;
  return { webgl: isGL2 ? 2 : 1, renderer, vendor, frames, seconds: Number(elapsed.toFixed(2)), fps: Number((frames/elapsed).toFixed(1)), layersPerFrame: layers };
};
</script></body></html>`;

(async () => {
  const { browser, meta } = await launchWithMeta({ gpu: !NO_GPU });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent(PAGE);
    const result = await page.evaluate(({ s, l }) => window.__probe(s, l), { s: SECONDS, l: LAYERS });
    const software = /swiftshader|llvmpipe|softpipe|software/i.test(String(result.renderer || ''));
    const out = {
      ...meta,
      ...result,
      softwareRenderer: software,
      verdict: result.error ? 'error' : software ? 'SOFTWARE (GPU 미사용)' : 'HARDWARE (GPU 사용)',
      hint: '이 JSON 을 GPU_PROFILES[platform].measuredOn 에 요약해 적고 status 를 measured 로 올린다. --no-gpu 와 비교해 fps 차가 없으면 플래그가 안 먹은 것.',
    };
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => { log('probe 실패:', e && e.message ? e.message : String(e)); process.exit(1); });
