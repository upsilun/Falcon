/* Falcon IR — local, dependency-free WebGL terrain and thermal camera renderer. */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const fract = n => n - Math.floor(n);
  function hash(x, y) {
    const mod = n => ((n % 289) + 289) % 289;
    x = mod(x); y = mod(y);
    const a = mod((x * 34 + 1) * x), b = mod(a + y);
    return mod((b * 34 + 1) * b) / 289;
  }
  function noise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = fract(x), fy = fract(y);
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function terrainHeight(x, z) {
    const n = noise(x * 0.00032, z * 0.00032);
    const ridge = 1 - Math.abs(noise(x * 0.00075 + 20, z * 0.00075 + 20) * 2 - 1);
    const hills = noise(x * 0.0017 - 10, z * 0.0017 - 10);
    const river = Math.abs(Math.sin(z * 0.00033 + Math.sin(x * 0.00038) * 2.2 + x * 0.00012));
    const valley = clamp((river - 0.04) / 0.30, 0, 1);
    const smoothValley = valley * valley * (3 - 2 * valley);
    return 58 + (n * 330 + ridge * ridge * ridge * 240 + hills * 44) * (0.16 + 0.84 * smoothValley);
  }

  const NOISE = `
    float hash(vec2 p) {
      p=mod(p,289.0);
      float a=mod((p.x*34.0+1.0)*p.x,289.0),b=mod(a+p.y,289.0);
      return mod((b*34.0+1.0)*b,289.0)/289.0;
    }
    float noise(vec2 p) {
      vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
      float a=hash(i),b=hash(i+vec2(1.0,0.0)),c=hash(i+vec2(0.0,1.0)),d=hash(i+vec2(1.0));
      return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
    }
    float fbm(vec2 p) {
      return noise(p)*0.54+noise(p*2.03+17.2)*0.27+noise(p*4.11-13.7)*0.13+noise(p*8.21+7.2)*0.06;
    }
    float heightAt(vec2 p) {
      float n=noise(p*0.00032);
      float ridge=1.0-abs(noise(p*0.00075+20.0)*2.0-1.0);
      float hills=noise(p*0.0017-10.0);
      float river=abs(sin(p.y*0.00033+sin(p.x*0.00038)*2.2+p.x*0.00012));
      float valley=smoothstep(0.04,0.34,river);
      return 58.0+(n*330.0+ridge*ridge*ridge*240.0+hills*44.0)*(0.16+0.84*valley);
    }
  `;

  const TERRAIN_VS = `
    precision highp float;
    attribute vec2 aPosition;
    uniform mat4 uVP;
    uniform vec2 uCenter;
    varying vec3 vWorld;
    varying vec3 vNormal;
    ${NOISE}
    void main() {
      vec2 p=aPosition+uCenter;
      float h=heightAt(p);
      vWorld=vec3(p.x,h,p.y);
      vNormal=normalize(vec3(heightAt(p-vec2(16.0,0.0))-heightAt(p+vec2(16.0,0.0)),32.0,
        heightAt(p-vec2(0.0,16.0))-heightAt(p+vec2(0.0,16.0))));
      gl_Position=uVP*vec4(vWorld,1.0);
    }
  `;
  const TERRAIN_FS = `
    precision highp float;
    uniform vec3 uCamera;
    uniform float uTV;
    varying vec3 vWorld;
    varying vec3 vNormal;
    ${NOISE}
    void main() {
      vec3 normal=normalize(vNormal);
      float light=dot(normal,normalize(vec3(-0.45,0.63,-0.34)));
      float rocky=fbm(vWorld.xz*0.024+vec2(vWorld.y*0.019,0.0));
      float detail=noise(vWorld.xz*0.13)*0.5+noise(vWorld.xz*0.29)*0.5;
      float strata=sin(vWorld.y*0.105+noise(vWorld.xz*0.004)*8.0)*0.016;
      float heat=0.25+light*0.22+rocky*0.18+(detail-0.5)*0.06+strata;
      float lowland=1.0-smoothstep(75.0,160.0,vWorld.y);
      heat+=lowland*0.035;
      vec3 gray=vec3(heat);
      vec3 sand=vec3(0.40,0.34,0.26)*(0.69+light*0.48+rocky*0.40)+vec3(detail*0.025);
      float range=length(vWorld-uCamera);
      float fog=1.0-exp(-pow(range/18500.0,1.22));
      vec3 haze=mix(vec3(0.485),vec3(0.54,0.55,0.53),uTV);
      vec3 color=mix(mix(gray,sand,uTV),haze,clamp(fog,0.0,0.91));
      gl_FragColor=vec4(color,1.0);
    }
  `;
  const QUAD_VS = `
    attribute vec2 aPosition;
    varying vec2 vUV;
    void main(){vUV=aPosition*0.5+0.5;gl_Position=vec4(aPosition,0.0,1.0);}
  `;
  const SKY_FS = `
    precision highp float;
    varying vec2 vUV;
    uniform float uFov,uAspect,uTV;
    uniform vec3 uForward,uRight,uUp;
    ${NOISE}
    void main(){
      vec2 sensor=(vUV-0.5)*2.0*tan(uFov*0.5);
      vec3 ray=normalize(uForward+uRight*sensor.x*uAspect+uUp*sensor.y);
      float elevation=asin(clamp(ray.y,-1.0,1.0));
      vec2 sky=vec2(atan(ray.x,-ray.z),elevation);
      float cloud=fbm(sky*vec2(3.0,8.0)+14.0);
      float t=smoothstep(-0.12,0.90,elevation);
      vec3 gray=vec3(mix(0.49,0.34,t)+(cloud-0.5)*0.055*smoothstep(0.02,0.3,elevation));
      vec3 rgb=mix(vec3(0.56,0.57,0.55),vec3(0.30,0.36,0.39),t)+(cloud-0.5)*0.06;
      gl_FragColor=vec4(mix(gray,rgb,uTV),1.0);
    }
  `;
  const OBJECT_VS = `
    attribute vec3 aPosition,aNormal;
    attribute float aHeat;
    uniform mat4 uVP,uModel;
    varying vec3 vWorld,vNormal;
    varying float vHeat;
    void main(){
      vec4 world=uModel*vec4(aPosition,1.0);
      vWorld=world.xyz;vNormal=mat3(uModel)*aNormal;vHeat=aHeat;
      gl_Position=uVP*world;
    }
  `;
  const OBJECT_FS = `
    precision highp float;
    varying vec3 vWorld,vNormal;
    varying float vHeat;
    uniform vec3 uCamera;
    uniform float uTV;
    void main(){
      float light=0.78+0.22*max(dot(normalize(vNormal),normalize(vec3(-0.4,0.7,-0.3))),0.0);
      vec3 hot=vec3(vHeat*light);
      vec3 color=mix(hot,vec3(vHeat*0.67)*light,uTV);
      float fog=clamp(length(vWorld-uCamera)/85000.0,0.0,0.40);
      gl_FragColor=vec4(mix(color,mix(vec3(0.49),vec3(0.54,0.55,0.53),uTV),fog),1.0);
    }
  `;
  const PARTICLE_VS = `
    attribute vec3 aPosition;
    attribute float aSize,aHeat,aAlpha;
    uniform mat4 uVP;
    uniform float uPixelScale;
    varying float vHeat,vAlpha;
    void main(){
      vec4 clip=uVP*vec4(aPosition,1.0);
      gl_Position=clip;
      gl_PointSize=clamp(aSize*uPixelScale/max(clip.w,1.0),1.0,220.0);
      vHeat=aHeat;vAlpha=aAlpha*step(0.1,clip.w);
    }
  `;
  const PARTICLE_FS = `
    precision mediump float;
    varying float vHeat,vAlpha;
    uniform float uTV;
    void main(){
      float r=length(gl_PointCoord-0.5)*2.0;
      if(r>1.0)discard;
      float alpha=pow(1.0-r*r,1.6)*vAlpha;
      vec3 thermal=vec3(vHeat);
      vec3 visible=mix(vec3(vHeat*0.70),vec3(1.0,0.56,0.14),smoothstep(0.68,1.0,vHeat));
      gl_FragColor=vec4(mix(thermal,visible,uTV),alpha);
    }
  `;
  const POST_FS = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D uScene;
    uniform vec2 uTexel;
    uniform float uTime,uBlack,uTV;
    float random(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    void main(){
      vec2 uv=vUV;
      uv.x+=(random(vec2(floor(uv.y/uTexel.y),floor(uTime*12.0)))-0.5)*uTexel.x*0.48*(1.0-uTV);
      vec3 c=texture2D(uScene,uv).rgb*0.78;
      c+=texture2D(uScene,uv+vec2(uTexel.x,0.0)).rgb*0.11;
      c+=texture2D(uScene,uv-vec2(uTexel.x,0.0)).rgb*0.11;
      c=mix(c,vec3(1.0)-c,uBlack*(1.0-uTV));
      float grain=(random(uv/uTexel+vec2(fract(uTime)*191.0,uTime*53.0))-0.5);
      c+=grain*mix(0.043,0.018,uTV);
      c+=sin(vUV.y/uTexel.y*3.14159265)*0.006*(1.0-uTV);
      vec2 d=(vUV-0.5)*vec2(1.0,0.8);
      float vignette=1.0-dot(d,d)*0.31;
      c*=vignette;
      gl_FragColor=vec4(c,1.0);
    }
  `;

  function makeProgram(gl, vs, fs) {
    function shader(type, source) {
      const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(s); gl.deleteShader(s);
        throw new Error('Thermal renderer shader: ' + error);
      }
      return s;
    }
    const vertex = shader(gl.VERTEX_SHADER, vs), fragment = shader(gl.FRAGMENT_SHADER, fs);
    const p = gl.createProgram(); gl.attachShader(p, vertex); gl.attachShader(p, fragment); gl.linkProgram(p);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Thermal renderer: ' + gl.getProgramInfoLog(p));
    const uniforms = {}, attrs = {};
    const result = { p,
      u(name) { return name in uniforms ? uniforms[name] : (uniforms[name] = gl.getUniformLocation(p, name)); },
      a(name) { return name in attrs ? attrs[name] : (attrs[name] = gl.getAttribLocation(p, name)); }
    };
    return result;
  }
  function createMesh(gl, data, indices) {
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const mesh = { buffer, count: data.length / 7 };
    if (indices) {
      mesh.index = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
      mesh.count = indices.length;
    }
    return mesh;
  }
  function missileMesh(gl, includeFlame = true) {
    const vertices = [];
    const tri = (a, b, c, heat) => {
      const u = b.map((v, i) => v - a[i]), v = c.map((q, i) => q - a[i]);
      let normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(...normal) || 1; normal = normal.map(q => q / len);
      for (const p of [a, b, c]) vertices.push(...p, ...normal, heat);
    };
    const quad = (a, b, c, d, heat) => { tri(a, b, c, heat); tri(a, c, d, heat); };
    const sections = [[-34, 0.3], [-24, 4.3], [20, 4.3], [28, 3.2]];
    for (let j = 0; j < sections.length - 1; j++) {
      for (let i = 0; i < 12; i++) {
        const t0 = i * TAU / 12, t1 = (i + 1) * TAU / 12;
        const [z0, r0] = sections[j], [z1, r1] = sections[j + 1];
        quad([Math.cos(t0) * r0, Math.sin(t0) * r0, z0], [Math.cos(t1) * r0, Math.sin(t1) * r0, z0],
          [Math.cos(t1) * r1, Math.sin(t1) * r1, z1], [Math.cos(t0) * r1, Math.sin(t0) * r1, z1], 0.85);
      }
    }
    for (const side of [-1, 1]) {
      quad([side * 3, 0, -9], [side * 26, 0, 8], [side * 26, 0, 12], [side * 3, 0, 8], 0.78);
      quad([side * 3, 0, 16], [side * 12, 0, 27], [side * 12, 0, 29], [side * 3, 0, 26], 0.82);
    }
    tri([0, 3, 15], [0, 13, 28], [0, 3, 28], 0.76);
    tri([0, -3, 17], [0, -10, 29], [0, -3, 28], 0.76);
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8, b = (i + 1) * TAU / 8;
      if (includeFlame) {
        tri([Math.cos(a) * 3.3, Math.sin(a) * 3.3, 27], [Math.cos(b) * 3.3, Math.sin(b) * 3.3, 27], [0, 0, 46], 1.0);
      } else {
        // A dark, closed nozzle is visible during the unpowered release.
        tri([Math.cos(a) * 3.2, Math.sin(a) * 3.2, 28], [Math.cos(b) * 3.2, Math.sin(b) * 3.2, 28], [0, 0, 28], 0.31);
      }
    }
    return createMesh(gl, vertices);
  }

  class IRWorld {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: true, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL is unavailable. Enable hardware acceleration in your browser, then reload.');
      this.gl = gl;
      this.enabledAttributes = new Set();
      this.programs = {
        terrain: makeProgram(gl, TERRAIN_VS, TERRAIN_FS), sky: makeProgram(gl, QUAD_VS, SKY_FS),
        object: makeProgram(gl, OBJECT_VS, OBJECT_FS), particle: makeProgram(gl, PARTICLE_VS, PARTICLE_FS),
        post: makeProgram(gl, QUAD_VS, POST_FS)
      };
      this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const grid = [], indices = [], resolution = 200;
      for (let iz = 0; iz <= resolution; iz++) for (let ix = 0; ix <= resolution; ix++) {
        const x = ix / resolution * 2 - 1, z = iz / resolution * 2 - 1;
        grid.push(Math.sign(x) * Math.pow(Math.abs(x), 1.55) * 33000,
          Math.sign(z) * Math.pow(Math.abs(z), 1.55) * 33000);
      }
      for (let iz = 0; iz < resolution; iz++) for (let ix = 0; ix < resolution; ix++) {
        const a = iz * (resolution + 1) + ix, b = a + resolution + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
      this.terrain = createMesh(gl, grid, indices);
      this.missile = missileMesh(gl);
      this.interceptor = missileMesh(gl, false);
      this.particles = gl.createBuffer();
      this.framebuffer = gl.createFramebuffer();
      this.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.depth = gl.createRenderbuffer();
      this.width = 0; this.height = 0; this.state = null;
      this.resize();
    }
    terrainHeight(x, z) { return terrainHeight(x, z); }
    resize(quality) {
      const gl = this.gl;
      const width = Math.max(1, this.canvas.clientWidth || window.innerWidth || 1280);
      const height = Math.max(1, this.canvas.clientHeight || window.innerHeight || 720);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(2200000 / (width * height)));
      const scale = quality === 'low' ? 0.66 : 1;
      const rw = Math.max(1, Math.round(width * ratio * scale)), rh = Math.max(1, Math.round(height * ratio * scale));
      this.cssWidth = width; this.cssHeight = height;
      if (this.width === rw && this.height === rh) return;
      this.width = rw; this.height = rh;
      this.canvas.width = rw; this.canvas.height = rh;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, rw, rh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Unable to create thermal camera framebuffer.');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    _attribute(program, name, size, stride, offset) {
      const location = program.a(name);
      if (location < 0) return;
      this.gl.enableVertexAttribArray(location);
      this.enabledAttributes.add(location);
      this.gl.vertexAttribPointer(location, size, this.gl.FLOAT, false, stride, offset);
    }
    _use(program) {
      for (const location of this.enabledAttributes) this.gl.disableVertexAttribArray(location);
      this.enabledAttributes.clear();
      this.gl.useProgram(program.p);
    }
    _quad(program) {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quad); this._attribute(program, 'aPosition', 2, 0, 0);
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }
    _camera(camera, fov) {
      const yaw = camera.yaw || 0, pitch = camera.pitch || 0, roll = camera.roll || 0;
      const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
      const sr = Math.sin(roll), cr = Math.cos(roll);
      this.forward = [-sy * cp, sp, -cy * cp];
      // Positive roll lowers the right wing. Rotate the sensor basis around
      // its forward axis; the pointing direction itself remains unchanged.
      this.right = [cy * cr - sy * sp * sr, -cp * sr, -sy * cr - cy * sp * sr];
      this.up = [cy * sr + sy * sp * cr, cp * cr, -sy * sr + cy * sp * cr];
      this.camera = camera;
      this.f = 1 / Math.tan(clamp(fov || 45, 4, 100) * Math.PI / 360);
      const f = this.f, fx = f / (this.cssWidth / this.cssHeight), r = this.right, u = this.up, q = this.forward;
      const near = 2, far = 70000, a = (far + near) / (far - near), b = -2 * far * near / (far - near);
      const rd = r[0] * camera.x + r[1] * camera.y + r[2] * camera.z;
      const ud = u[0] * camera.x + u[1] * camera.y + u[2] * camera.z;
      const qd = q[0] * camera.x + q[1] * camera.y + q[2] * camera.z;
      this.vp = new Float32Array([r[0] * fx, u[0] * f, q[0] * a, q[0],
        r[1] * fx, u[1] * f, q[1] * a, q[1], r[2] * fx, u[2] * f, q[2] * a, q[2],
        -rd * fx, -ud * f, -qd * a + b, -qd]);
    }
    project(x, y, z) {
      if (!this.camera) return { x: 0, y: 0, visible: false, depth: 0, size: 0 };
      const dx = x - this.camera.x, dy = y - this.camera.y, dz = z - this.camera.z;
      const depth = dx * this.forward[0] + dy * this.forward[1] + dz * this.forward[2];
      const safeDepth = Math.max(0.01, depth), scale = this.cssHeight * this.f * 0.5 / safeDepth;
      const sx = this.cssWidth * 0.5 + (dx * this.right[0] + dy * this.right[1] + dz * this.right[2]) * scale;
      const sy = this.cssHeight * 0.5 - (dx * this.up[0] + dy * this.up[1] + dz * this.up[2]) * scale;
      return { x: sx, y: sy, visible: depth > 2 && sx >= -40 && sx <= this.cssWidth + 40 && sy >= -40 && sy <= this.cssHeight + 40,
        depth, size: 64 * scale, scale };
    }
    render(state) {
      const gl = this.gl;
      if (gl.isContextLost()) return null;
      this.state = state; this.resize(state.quality); this._camera(state.camera, state.fov);
      const camera = state.camera, tv = state.mode === 'tv' ? 1 : 0, time = state.time || 0;
      const programs = this.programs;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.viewport(0, 0, this.width, this.height);
      gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
      gl.clearColor(0.49, 0.49, 0.49, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      let p = programs.sky; this._use(p);
      gl.uniform3fv(p.u('uForward'), this.forward); gl.uniform3fv(p.u('uRight'), this.right);
      gl.uniform3fv(p.u('uUp'), this.up);
      gl.uniform1f(p.u('uFov'), (state.fov || 45) * Math.PI / 180);
      gl.uniform1f(p.u('uAspect'), this.cssWidth / this.cssHeight); gl.uniform1f(p.u('uTV'), tv); this._quad(p);

      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      p = programs.terrain; this._use(p);
      gl.uniformMatrix4fv(p.u('uVP'), false, this.vp);
      gl.uniform2f(p.u('uCenter'), Math.round(camera.x / 180) * 180, Math.round(camera.z / 180) * 180);
      gl.uniform3f(p.u('uCamera'), camera.x, camera.y, camera.z); gl.uniform1f(p.u('uTV'), tv);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.terrain.buffer); this._attribute(p, 'aPosition', 2, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.terrain.index);
      gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_SHORT, 0);

      p = programs.object; this._use(p); gl.uniformMatrix4fv(p.u('uVP'), false, this.vp);
      gl.uniform3f(p.u('uCamera'), camera.x, camera.y, camera.z); gl.uniform1f(p.u('uTV'), tv);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.missile.buffer);
      this._attribute(p, 'aPosition', 3, 28, 0); this._attribute(p, 'aNormal', 3, 28, 12); this._attribute(p, 'aHeat', 1, 28, 24);
      const particles = [], contactResults = [];
      const addParticle = (x, y, z, size, heat, alpha) => particles.push(x, y, z, size, heat, alpha);
      for (const contact of state.contacts || []) {
        if (contact.alive === false) continue;
        const yaw = contact.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw);
        const model = new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, contact.x, contact.y, contact.z, 1]);
        gl.uniformMatrix4fv(p.u('uModel'), false, model); gl.drawArrays(gl.TRIANGLES, 0, this.missile.count);
        contactResults.push({ id: contact.id, ...this.project(contact.x, contact.y, contact.z) });
        for (let i = 0; i < 13; i++) {
          const behind = 34 + i * 13, wobble = Math.sin(time * 13 + i * 1.9) * (1 + i * 0.45);
          addParticle(contact.x + s * behind + c * wobble, contact.y + Math.sin(i * 2 + time * 9) * i * 0.3,
            contact.z + c * behind - s * wobble, 13 + i * 2.2, 1 - i * 0.019, (1 - i / 14) * 0.24);
        }
      }
      if (state.interceptors?.length) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.interceptor.buffer);
        this._attribute(p, 'aPosition', 3, 28, 0); this._attribute(p, 'aNormal', 3, 28, 12); this._attribute(p, 'aHeat', 1, 28, 24);
      }
      for (const interceptor of state.interceptors || []) {
        const yaw = interceptor.yaw || 0, pitch = interceptor.pitch || 0;
        const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
        const scale = Math.max(0.01, interceptor.scale ?? 0.18);
        const model = new Float32Array([
          cy * scale, 0, -sy * scale, 0,
          sy * sp * scale, cp * scale, cy * sp * scale, 0,
          sy * cp * scale, -sp * scale, cy * cp * scale, 0,
          interceptor.x, interceptor.y, interceptor.z, 1
        ]);
        gl.uniformMatrix4fv(p.u('uModel'), false, model);
        gl.drawArrays(gl.TRIANGLES, 0, this.interceptor.count);

        const ignited = interceptor.ignited ?? (interceptor.age > 0.45);
        if (!ignited) continue;
        // The glow begins at the nozzle and stretches rearward, never replacing
        // the missile body with a luminous ball. No particles exist before ignition.
        for (let i = 0; i < 9; i++) {
          const behind = (29 + i * 7) * scale;
          const shimmer = Math.sin(time * 70 + i * 2.7) * scale * i * 0.13;
          addParticle(interceptor.x + sy * cp * behind + cy * shimmer,
            interceptor.y - sp * behind,
            interceptor.z + cy * cp * behind - sy * shimmer,
            (6.5 + i * 0.75) * scale, 1 - i * 0.015, (1 - i / 10) * 0.86);
        }
        // Trail points are ordered oldest to newest. Optional age is seconds
        // since emission; otherwise an approximate 30 Hz sample spacing is used.
        const trail = interceptor.trail || [], step = Math.max(1, Math.ceil(trail.length / 64));
        for (let i = 0; i < trail.length; i += step) {
          const point = trail[i];
          const age = Math.max(0, point.age ?? ((trail.length - 1 - i) / 30));
          if (age > 3.5) continue;
          const fade = Math.max(0, 1 - age / 3.5);
          addParticle(point.x, point.y + age * 0.8, point.z,
            (10 + age * 24) * scale, 0.24 + Math.exp(-age * 2.8) * 0.70,
            fade * (0.26 + Math.min(age, 1) * 0.13));
        }
      }
      for (const explosion of state.explosions || []) {
        const age = explosion.age || 0;
        if (age < 0 || age > 5) continue;
        const power = Math.max(0, 1 - age / 2.6), radius = 15 + Math.pow(age, 0.65) * 118;
        if (age < 0.7) {
          addParticle(explosion.x, explosion.y, explosion.z, 100 + age * 350, 1, (1 - age / 0.7) * 0.95);
          addParticle(explosion.x, explosion.y, explosion.z, 330 + age * 200, 1, (1 - age / 0.7) * 0.26);
        }
        for (let i = 0; i < 34; i++) {
          const phi = i * 2.399963, sy = 1 - i / 17, sr = Math.sqrt(Math.max(0, 1 - sy * sy));
          const scatter = 0.3 + hash(i, 7) * 0.7;
          const x = explosion.x + Math.cos(phi) * sr * radius * scatter;
          const y = explosion.y + sy * radius * scatter - age * age * 9 + age * 11;
          const z = explosion.z + Math.sin(phi) * sr * radius * scatter;
          const flame = i % 3 === 0 && age < 1.7;
          addParticle(x, y, z, (flame ? 27 : 38) + age * 28, flame ? 0.72 + power * 0.28 : 0.19 + power * 0.39,
            Math.max(0, 1 - age / (flame ? 1.7 : 4.2)) * (flame ? 0.82 : 0.37));
        }
      }
      if (particles.length) {
        p = programs.particle; this._use(p);
        gl.uniformMatrix4fv(p.u('uVP'), false, this.vp); gl.uniform1f(p.u('uPixelScale'), this.height * this.f * 0.5);
        gl.uniform1f(p.u('uTV'), tv); gl.bindBuffer(gl.ARRAY_BUFFER, this.particles);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(particles), gl.DYNAMIC_DRAW);
        this._attribute(p, 'aPosition', 3, 24, 0); this._attribute(p, 'aSize', 1, 24, 12);
        this._attribute(p, 'aHeat', 1, 24, 16); this._attribute(p, 'aAlpha', 1, 24, 20);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        gl.drawArrays(gl.POINTS, 0, particles.length / 6); gl.depthMask(true); gl.disable(gl.BLEND);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.disable(gl.DEPTH_TEST);
      p = programs.post; this._use(p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(p.u('uScene'), 0); gl.uniform2f(p.u('uTexel'), 1 / this.width, 1 / this.height);
      gl.uniform1f(p.u('uTime'), time); gl.uniform1f(p.u('uBlack'), state.polarity === 'black' ? 1 : 0);
      gl.uniform1f(p.u('uTV'), tv); this._quad(p);
      const horizonUp = Math.abs(this.up[1]) > 0.000001 ? this.up[1] : (this.up[1] < 0 ? -0.000001 : 0.000001);
      return { contacts: contactResults, project: this.project.bind(this),
        horizon: this.cssHeight * 0.5 + this.forward[1] / horizonUp * this.cssHeight * this.f * 0.5,
        horizonSlope: this.right[1] / horizonUp };
    }
    dispose() {
      const gl = this.gl;
      for (const program of Object.values(this.programs)) gl.deleteProgram(program.p);
      for (const buffer of [this.quad, this.terrain.buffer, this.terrain.index, this.missile.buffer, this.interceptor.buffer, this.particles]) gl.deleteBuffer(buffer);
      gl.deleteFramebuffer(this.framebuffer); gl.deleteTexture(this.texture); gl.deleteRenderbuffer(this.depth);
    }
  }
  window.IRWorld = IRWorld;
})();
