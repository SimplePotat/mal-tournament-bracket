(function (global) {
  'use strict';

  const BracketApp = (global.BracketApp = global.BracketApp || {});

  const VERT_SRC = `
    attribute vec2 a_pos;
    void main() {
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const FRAG_SRC = `
    precision highp float;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_hover;
    uniform float u_burst;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float amp = 0.5;
      mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
      for (int i = 0; i < 5; i++) {
        v += amp * noise(p);
        p = rot * p * 2.04 + vec2(17.3, 9.1);
        amp *= 0.5;
      }
      return v;
    }

    vec3 firePalette(float t) {
      t = clamp(t, 0.0, 1.0);
      vec3 c0 = vec3(0.08, 0.00, 0.00);
      vec3 c1 = vec3(0.78, 0.07, 0.01);
      vec3 c2 = vec3(1.00, 0.36, 0.02);
      vec3 c3 = vec3(1.00, 0.78, 0.16);
      vec3 c4 = vec3(1.00, 0.98, 0.90);

      vec3 col = mix(c0, c1, smoothstep(0.00, 0.25, t));
      col = mix(col, c2, smoothstep(0.22, 0.54, t));
      col = mix(col, c3, smoothstep(0.50, 0.80, t));
      col = mix(col, c4, smoothstep(0.78, 1.00, t));
      return col;
    }

    float emberLayer(vec2 p, float scale, float speed, float seed) {
      vec2 q = p * scale;
      q.y -= u_time * speed;
      q.x += sin(q.y * 1.15 + u_time * 1.4 + seed) * 0.42;

      vec2 cell = floor(q);
      vec2 f = fract(q) - 0.5;

      float h1 = hash(cell + seed);
      float h2 = hash(cell + seed + 37.1);
      float h3 = hash(cell + seed + 91.7);

      // Keep sparks concentrated near the center seam
      float spawnMask = step(0.68, h1);
      vec2 offset = (vec2(h2, h3) - 0.5) * 0.68;
      float d = length(f - offset);
      float radius = mix(0.04, 0.11, h2);
      float spark = smoothstep(radius, 0.0, d) * spawnMask;
      float flicker = 0.55 + 0.45 * sin(u_time * (5.0 + h3 * 7.0) + h1 * 40.0);
      return spark * flicker;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      float aspect = u_resolution.x / max(u_resolution.y, 1.0);

      // Aspect-corrected coordinates centered at (0, 0)
      vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

      float t = u_time;

      // Subtle lean toward hovered side near the middle & top
      float lean = u_hover * 0.032 * (0.35 + uv.y * 0.85);
      float px = p.x - lean;
      float absX = abs(px);

      // Two-stage domain-warped turbulence rising upward
      vec2 flow1 = vec2(px * 4.8, p.y * 2.6 - t * 2.15);
      float warpX = fbm(flow1) - 0.5;
      float warpY = fbm(flow1 + vec2(5.2, -t * 0.6)) - 0.5;

      vec2 flow2 = vec2(px * 8.5 + warpX * 1.65, p.y * 4.2 - t * 3.1 + warpY * 1.2);
      float turb = fbm(flow2);
      float fine = fbm(vec2(px * 15.0 - warpX * 1.9, p.y * 8.0 - t * 4.8));

      // --- 1. Blazing vertical dividing line ---
      float lineWobble = warpX * 0.018 + (fine - 0.5) * 0.007;
      float distLine = abs(px + lineWobble * smoothstep(0.0, 0.12, absX + 0.02));

      // Crisp incandescent center line core
      float sharpLine = exp(-abs(p.x) * 210.0) * (0.92 + 0.12 * sin(p.y * 24.0 - t * 14.0));
      float hotCore = exp(-distLine * 58.0) * (0.72 + 0.35 * turb);

      // Licking flame envelope rising along both sides of the seam
      // Slightly wider near bottom and center VS zone
      float centerBulge = exp(-p.y * p.y * 12.0) * 0.068;
      float bottomSurge = pow(1.0 - uv.y, 2.2) * 0.055;
      float envelopeWidth = 0.055 + centerBulge + bottomSurge + u_burst * 0.11;

      float flameShape = 1.0 - smoothstep(0.0, envelopeWidth, absX + (warpX * 0.045));
      float tongues = smoothstep(0.24, 0.86, turb * 0.78 + fine * 0.36) * flameShape;

      // --- 2. Radial fire corona bursting around the central VS emblem ---
      vec2 vp = vec2(px, p.y);
      float vDist = length(vp);
      float angle = atan(vp.y, vp.x);
      float radialNoise = fbm(vec2(cos(angle) * 3.0 + warpX * 1.6, sin(angle) * 3.0 - t * 2.8));
      float vsRadius = 0.175 + u_burst * 0.14;
      float vsHalo = smoothstep(vsRadius + radialNoise * 0.11, 0.04, vDist);
      float vsRing = exp(-abs(vDist - 0.118) * 24.0) * (0.55 + 0.65 * radialNoise);
      // Slight dip directly behind the VS glyphs so white-gold VS stays razor legible
      float vsCenterCalm = mix(0.62, 1.0, smoothstep(0.03, 0.125, vDist));

      // --- 3. Combine heat field ---
      float heat = 0.0;
      heat += tongues * 1.15;
      heat += hotCore * 0.92;
      heat += sharpLine * 1.25 * vsCenterCalm;
      heat += vsHalo * (0.38 + 0.62 * turb) * vsCenterCalm;
      heat += vsRing * 0.78;
      heat *= (1.0 + u_burst * 0.85);

      // Soft warm glow halo spreading gently off the seam
      float ambientGlow = exp(-absX * 9.5) * (0.20 + 0.14 * turb)
                        + exp(-vDist * 4.5) * (0.24 + 0.12 * radialNoise);
      ambientGlow *= (1.0 + u_burst * 0.65);

      // --- 4. Procedural rising embers / sparks ---
      float emberMask = exp(-absX * 4.2) + exp(-vDist * 3.0) * 0.7;
      float e1 = emberLayer(vec2(px, p.y), 11.0, 1.35, 1.7);
      float e2 = emberLayer(vec2(px, p.y), 18.0, 2.05, 8.3);
      float e3 = emberLayer(vec2(px, p.y), 26.0, 2.75, 19.1);
      float embers = (e1 + e2 * 0.85 + e3 * 0.7) * emberMask * (1.0 + u_burst * 1.4);

      // --- 5. Colorize & composite (premultiplied alpha) ---
      vec3 flameColor = firePalette(heat * 0.88);
      vec3 glowColor = vec3(1.0, 0.28, 0.03) * ambientGlow;
      vec3 emberColor = vec3(1.0, 0.76, 0.28) * embers * 1.6;

      float flameAlpha = clamp(smoothstep(0.06, 0.68, heat) * 0.94, 0.0, 0.98);
      float totalAlpha = clamp(flameAlpha + ambientGlow * 0.55 + embers * 0.9 + sharpLine * 0.85, 0.0, 1.0);

      vec3 finalRGB = flameColor * flameAlpha + glowColor + emberColor;
      // Extra white-hot core highlight right on the dividing line
      finalRGB += vec3(1.0, 0.95, 0.85) * sharpLine * 0.75;

      // Subtle dark-edge vignette ONLY right at outer corners when burst occurs
      gl_FragColor = vec4(clamp(finalRGB, 0.0, 1.0), totalAlpha);
    }
  `;

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile failed: ${info}`);
    }
    return shader;
  }

  class FlameRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.running = false;
      this.rafId = null;
      this.startTime = 0;
      this.hoverTarget = 0;
      this.hoverCurrent = 0;
      this.burstValue = 0;
      this.mode = 'none'; // 'webgl' | '2d'
      this.gl = null;
      this.ctx2d = null;
      this.uniforms = {};
      this.particles = [];

      this._boundFrame = this._frame.bind(this);
      this._boundResize = this.resize.bind(this);

      this._init();
    }

    _init() {
      try {
        const gl =
          this.canvas.getContext('webgl', {
            alpha: true,
            premultipliedAlpha: true,
            antialias: false,
            powerPreference: 'high-performance',
          }) ||
          this.canvas.getContext('experimental-webgl', {
            alpha: true,
            premultipliedAlpha: true,
          });

        if (gl) {
          const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
          const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
          const prog = gl.createProgram();
          gl.attachShader(prog, vs);
          gl.attachShader(prog, fs);
          gl.linkProgram(prog);

          if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(prog));
          }

          const buf = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
            gl.STATIC_DRAW
          );

          const posLoc = gl.getAttribLocation(prog, 'a_pos');
          gl.enableVertexAttribArray(posLoc);
          gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

          gl.useProgram(prog);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

          this.gl = gl;
          this.uniforms = {
            resolution: gl.getUniformLocation(prog, 'u_resolution'),
            time: gl.getUniformLocation(prog, 'u_time'),
            hover: gl.getUniformLocation(prog, 'u_hover'),
            burst: gl.getUniformLocation(prog, 'u_burst'),
          };
          this.mode = 'webgl';
          return;
        }
      } catch (err) {
        console.warn('WebGL flame shader unavailable, falling back to 2D canvas:', err);
      }

      // Automatic Canvas 2D fallback for locked-down GPUs / software environments
      const ctx = this.canvas.getContext('2d');
      if (ctx) {
        this.ctx2d = ctx;
        this.mode = '2d';
        this._initParticles2D();
      }
    }

    _initParticles2D() {
      this.particles = [];
      for (let i = 0; i < 65; i++) {
        this.particles.push(this._spawnParticle2D(true));
      }
    }

    _spawnParticle2D(randomY) {
      return {
        xOffset: (Math.random() - 0.5) * 44,
        y: randomY ? Math.random() : 1.05,
        vy: 0.22 + Math.random() * 0.45,
        vx: (Math.random() - 0.5) * 18,
        size: 10 + Math.random() * 28,
        life: Math.random(),
        isSpark: Math.random() > 0.62,
      };
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const w = Math.max(1, Math.floor(window.innerWidth * dpr));
      const h = Math.max(1, Math.floor(window.innerHeight * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      if (this.mode === 'webgl' && this.gl) {
        this.gl.viewport(0, 0, w, h);
      }
    }

    setHover(direction) {
      // -1 = left, 0 = neutral, +1 = right
      this.hoverTarget = direction;
    }

    triggerBurst() {
      this.burstValue = 1.0;
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.hoverTarget = 0;
      this.hoverCurrent = 0;
      this.burstValue = 0.25; // Subtle entrance flare
      this.startTime = performance.now();
      this.resize();
      window.addEventListener('resize', this._boundResize);
      this.rafId = requestAnimationFrame(this._boundFrame);
    }

    stop() {
      this.running = false;
      window.removeEventListener('resize', this._boundResize);
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    _frame(now) {
      if (!this.running) return;
      const elapsed = (now - this.startTime) * 0.001;

      this.hoverCurrent += (this.hoverTarget - this.hoverCurrent) * 0.09;
      this.burstValue = Math.max(0, this.burstValue * 0.92);

      if (this.mode === 'webgl') {
        this._renderWebGL(elapsed);
      } else if (this.mode === '2d') {
        this._render2D(elapsed);
      }

      this.rafId = requestAnimationFrame(this._boundFrame);
    }

    _renderWebGL(elapsed) {
      const gl = this.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.uniforms.time, elapsed);
      gl.uniform1f(this.uniforms.hover, this.hoverCurrent);
      gl.uniform1f(this.uniforms.burst, this.burstValue);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    _render2D(elapsed) {
      const ctx = this.ctx2d;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const cx = w * 0.5;
      const cy = h * 0.5;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      // Center flame glow column
      const colGrad = ctx.createLinearGradient(cx - 75, 0, cx + 75, 0);
      colGrad.addColorStop(0, 'rgba(255, 60, 0, 0)');
      colGrad.addColorStop(0.35, 'rgba(255, 90, 10, 0.35)');
      colGrad.addColorStop(0.5, 'rgba(255, 245, 200, 0.92)');
      colGrad.addColorStop(0.65, 'rgba(255, 90, 10, 0.35)');
      colGrad.addColorStop(1, 'rgba(255, 60, 0, 0)');
      ctx.fillStyle = colGrad;
      ctx.fillRect(cx - 75, 0, 150, h);

      // Central VS radial fire glow
      const haloR = Math.min(w, h) * (0.19 + this.burstValue * 0.08);
      const rad = ctx.createRadialGradient(cx, cy, 4, cx, cy, haloR);
      rad.addColorStop(0, 'rgba(255, 245, 200, 0.85)');
      rad.addColorStop(0.35, 'rgba(255, 130, 15, 0.55)');
      rad.addColorStop(0.7, 'rgba(210, 30, 5, 0.2)');
      rad.addColorStop(1, 'rgba(180, 10, 0, 0)');
      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Animated rising flames & sparks
      for (let i = 0; i < this.particles.length; i++) {
        const pt = this.particles[i];
        pt.y -= pt.vy * 0.014;
        pt.xOffset += Math.sin(elapsed * 4 + i) * 0.6 + this.hoverCurrent * 0.9;
        if (pt.y < -0.08) {
          this.particles[i] = this._spawnParticle2D(false);
          continue;
        }
        const px = cx + pt.xOffset * (1 + (1 - pt.y) * 0.5);
        const py = pt.y * h;
        const r = pt.isSpark ? 3.5 : pt.size * (0.65 + pt.y * 0.55);
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        if (pt.isSpark) {
          g.addColorStop(0, 'rgba(255, 245, 190, 0.95)');
          g.addColorStop(1, 'rgba(255, 110, 10, 0)');
        } else {
          g.addColorStop(0, 'rgba(255, 200, 60, 0.45)');
          g.addColorStop(0.5, 'rgba(255, 80, 10, 0.22)');
          g.addColorStop(1, 'rgba(180, 15, 0, 0)');
        }
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Razor-sharp center dividing line
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(255, 250, 235, 0.95)';
      ctx.fillRect(cx - 1.5, 0, 3, h);
    }
  }

  BracketApp.FlameRenderer = FlameRenderer;
})(window);
