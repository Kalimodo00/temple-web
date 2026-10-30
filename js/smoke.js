// 香煙：WebGL2 即時流體模擬（Navier-Stokes）。煙是算出來的，會被手指搧動、隨手機傾斜飄移。
// 裝置不支援時退回 2D 粒子版。

const VERT = `#version 300 es
in vec2 p; out vec2 vUv;
void main(){ vUv = p*.5+.5; gl_Position = vec4(p,0,1); }`;

const HEAD = `#version 300 es
precision highp float; precision highp sampler2D;
in vec2 vUv; out vec4 o; uniform vec2 texel;
`;

const FRAG = {
  advect: HEAD + `uniform sampler2D vel, src; uniform float dt, keep;
    void main(){ vec2 c = vUv - dt*texture(vel,vUv).xy*texel; o = keep*texture(src,c); }`,
  divergence: HEAD + `uniform sampler2D vel;
    void main(){
      float l=texture(vel,vUv-vec2(texel.x,0)).x, r=texture(vel,vUv+vec2(texel.x,0)).x;
      float b=texture(vel,vUv-vec2(0,texel.y)).y, t=texture(vel,vUv+vec2(0,texel.y)).y;
      o = vec4(.5*(r-l+t-b),0,0,1); }`,
  curl: HEAD + `uniform sampler2D vel;
    void main(){
      float l=texture(vel,vUv-vec2(texel.x,0)).y, r=texture(vel,vUv+vec2(texel.x,0)).y;
      float b=texture(vel,vUv-vec2(0,texel.y)).x, t=texture(vel,vUv+vec2(0,texel.y)).x;
      o = vec4(.5*(r-l-t+b),0,0,1); }`,
  vorticity: HEAD + `uniform sampler2D vel, curl; uniform float strength, dt;
    void main(){
      float l=texture(curl,vUv-vec2(texel.x,0)).x, r=texture(curl,vUv+vec2(texel.x,0)).x;
      float b=texture(curl,vUv-vec2(0,texel.y)).x, t=texture(curl,vUv+vec2(0,texel.y)).x;
      float c=texture(curl,vUv).x;
      vec2 f = .5*vec2(abs(t)-abs(b), abs(r)-abs(l));
      f = f/(length(f)+1e-4)*strength*c; f.y*=-1.;
      o = vec4(texture(vel,vUv).xy+f*dt,0,1); }`,
  pressure: HEAD + `uniform sampler2D prs, div;
    void main(){
      float l=texture(prs,vUv-vec2(texel.x,0)).x, r=texture(prs,vUv+vec2(texel.x,0)).x;
      float b=texture(prs,vUv-vec2(0,texel.y)).x, t=texture(prs,vUv+vec2(0,texel.y)).x;
      o = vec4((l+r+b+t-texture(div,vUv).x)*.25,0,0,1); }`,
  gradient: HEAD + `uniform sampler2D prs, vel;
    void main(){
      float l=texture(prs,vUv-vec2(texel.x,0)).x, r=texture(prs,vUv+vec2(texel.x,0)).x;
      float b=texture(prs,vUv-vec2(0,texel.y)).x, t=texture(prs,vUv+vec2(0,texel.y)).x;
      o = vec4(texture(vel,vUv).xy-.5*vec2(r-l,t-b),0,1); }`,
  buoyancy: HEAD + `uniform sampler2D vel, dye; uniform float lift, wind, dt;
    void main(){
      float d=texture(dye,vUv).x;
      o = vec4(texture(vel,vUv).xy+dt*d*vec2(wind,lift),0,1); }`,
  splat: HEAD + `uniform sampler2D base; uniform vec2 point; uniform vec3 color; uniform float radius, aspect;
    void main(){
      vec2 d=vUv-point; d.x*=aspect;
      o = vec4(texture(base,vUv).xyz+color*exp(-dot(d,d)/radius),1); }`,
  display: HEAD + `uniform sampler2D dye;
    void main(){
      float d=texture(dye,vUv).x;
      float a=1.-exp(-d*3.2);
      vec3 c=mix(vec3(.5,.53,.6),vec3(.98,.97,.95),a);
      o = vec4(c*a,a); }`,
};

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function createProgram(gl, vert, frag) {
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(program, 0, 'p');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const { name } = gl.getActiveUniform(program, i);
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

function createTarget(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo, w, h };
}

function createDouble(gl, w, h) {
  let a = createTarget(gl, w, h);
  let b = createTarget(gl, w, h);
  return {
    get read() { return a; },
    get write() { return b; },
    swap() { [a, b] = [b, a]; },
  };
}

function createFluidSmoke(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
  if (!gl) return null;
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return null;

  const vert = compile(gl, gl.VERTEX_SHADER, VERT);
  const programs = Object.fromEntries(Object.entries(FRAG).map(([k, f]) => [k, createProgram(gl, vert, f)]));

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);

  let vel, dye, prs, div, curl, simW, simH, aspect;
  let emitters = [];
  let pushes = [];
  let wind = 0;
  let time = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    aspect = canvas.width / canvas.height;
    simH = 160;
    simW = Math.max(16, Math.round(simH * aspect));
    const dyeH = Math.min(720, canvas.height);
    const dyeW = Math.max(32, Math.round(dyeH * aspect));
    vel = createDouble(gl, simW, simH);
    prs = createDouble(gl, simW, simH);
    div = createTarget(gl, simW, simH);
    curl = createTarget(gl, simW, simH);
    dye = createDouble(gl, dyeW, dyeH);
  }

  function use(name, target, uniforms = {}) {
    const { program, uniforms: loc } = programs[name];
    gl.useProgram(program);
    let unit = 0;
    for (const [key, value] of Object.entries(uniforms)) {
      if (loc[key] === undefined) continue;
      if (value && value.tex) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, value.tex);
        gl.uniform1i(loc[key], unit++);
      } else if (Array.isArray(value)) {
        (value.length === 2 ? gl.uniform2fv : gl.uniform3fv).call(gl, loc[key], value);
      } else {
        gl.uniform1f(loc[key], value);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : canvas.width, target ? target.h : canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function splat(field, point, color, radius) {
    use('splat', field.write, { base: field.read, point, color, radius, aspect });
    field.swap();
  }

  function step(dt) {
    time += dt;
    const simTexel = [1 / simW, 1 / simH];
    const toUv = (e) => [e.x / canvas.clientWidth, 1 - e.y / canvas.clientHeight];

    for (const e of emitters) {
      const wobble = Math.sin(time * 2.1 + e.x) + 0.6 * Math.sin(time * 5.3 + e.x * 2.7);
      splat(vel, toUv(e), [wobble * 7 + (Math.random() - 0.5) * 16, 26, 0], 0.00016);
      splat(dye, toUv(e), [0.55 * (e.amount ?? 1), 0, 0], 0.00002 * (e.amount ?? 1));
    }
    for (const p of pushes) {
      splat(vel, toUv(p), [p.dx * 9, -p.dy * 9, 0], 0.006);
    }
    pushes = [];

    use('curl', curl, { texel: simTexel, vel: vel.read });
    use('vorticity', vel.write, { texel: simTexel, vel: vel.read, curl, strength: 14, dt });
    vel.swap();
    use('buoyancy', vel.write, { vel: vel.read, dye: dye.read, lift: 40, wind: wind * 24, dt });
    vel.swap();

    use('divergence', div, { texel: simTexel, vel: vel.read });
    for (let i = 0; i < 16; i++) {
      use('pressure', prs.write, { texel: simTexel, prs: prs.read, div });
      prs.swap();
    }
    use('gradient', vel.write, { texel: simTexel, prs: prs.read, vel: vel.read });
    vel.swap();

    use('advect', vel.write, { texel: simTexel, vel: vel.read, src: vel.read, dt, keep: 0.995 });
    vel.swap();
    use('advect', dye.write, { texel: simTexel, vel: vel.read, src: dye.read, dt, keep: 0.994 });
    dye.swap();

    use('display', null, { dye: dye.read });
  }

  resize();
  return {
    kind: 'fluid',
    resize,
    step,
    setEmitters(list) { emitters = list; },
    push(x, y, dx, dy) { pushes.push({ x, y, dx, dy }); },
    setWind(v) { wind = v; },
  };
}

// 2D 退路：不支援 WebGL2 浮點貼圖的舊裝置
function createParticleSmoke(canvas) {
  const ctx = canvas.getContext('2d');
  let particles = [];
  let emitters = [];
  let wind = 0;
  let time = 0;
  const resize = () => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  };
  resize();
  return {
    kind: 'particles',
    resize,
    step(dt) {
      time += dt;
      for (const e of emitters) {
        particles.push({ x: e.x, y: e.y, vx: 0, vy: -38, life: 0, seed: Math.random() * 9 });
      }
      particles = particles.slice(-600);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round';
      for (const p of particles) {
        p.life += dt;
        p.vx += (Math.sin(p.y * 0.02 + time + p.seed) * 26 + wind * 30) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const alpha = Math.max(0, 0.16 * (1 - p.life / 9));
        ctx.fillStyle = `rgba(225,226,230,${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 + p.life * 3, 0, 7);
        ctx.fill();
      }
      particles = particles.filter((p) => p.life < 9);
    },
    setEmitters(list) { emitters = list; },
    push(x, y, dx) {
      for (const p of particles) {
        if (Math.hypot(p.x - x, p.y - y) < 80) p.vx += dx * 2;
      }
    },
    setWind(v) { wind = v; },
  };
}

export function createSmoke(canvas) {
  try {
    const fluid = createFluidSmoke(canvas);
    if (fluid) return { smoke: fluid, canvas };
  } catch (err) {
    console.warn('流體香煙無法啟用，改用粒子版', err);
  }
  // 拿過 webgl context 的 canvas 不能再要 2d，要換一個新的
  const fresh = canvas.cloneNode();
  canvas.replaceWith(fresh);
  return { smoke: createParticleSmoke(fresh), canvas: fresh };
}
