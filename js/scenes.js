import { SCENES } from "./data.js";
import { fragmentSource, VERTEX_SOURCE } from "./shaders.js";

const MAX_PIXELS = 2.4e6;
const TEX_W = 2048;
const TEX_H = 1024;
const images = new Map();

export function sceneById(id) {
  return SCENES.find((scene) => scene.id === id) ?? SCENES[0];
}

function artUrl(scene) {
  return `assets/scenes/${scene.id}.webp`;
}

function loadImage(scene) {
  if (!images.has(scene.id)) {
    images.set(scene.id, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${artUrl(scene)}`));
      img.src = artUrl(scene);
    }));
  }
  return images.get(scene.id);
}

function cssFallback(scene) {
  const [a, b] = scene.swatch;
  return scene.kind === "art"
    ? `center / cover no-repeat url("${artUrl(scene)}")`
    : `linear-gradient(180deg, ${a}, ${b})`;
}

class View {
  constructor(el) {
    this.el = el;
    this.canvas = el.querySelector("canvas");
    this.gl = this.canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
    this.programs = new Map();
    this.texture = null;
    this.textureScene = null;
    this.scene = null;
    this.active = null;
    this.scale = 1;
    this.lost = false;
    if (!this.gl) return;
    this.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.programs.clear();
      this.texture = null;
      this.textureScene = null;
      this.initBuffer();
      if (this.scene) this.prepare(this.scene);
    });
    this.initBuffer();
  }

  initBuffer() {
    const { gl } = this;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }

  compile(scene) {
    const { gl } = this;
    if (this.programs.has(scene.id)) return this.programs.get(scene.id);
    const make = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`shader ${scene.id}: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, make(gl.VERTEX_SHADER, VERTEX_SOURCE));
    gl.attachShader(program, make(gl.FRAGMENT_SHADER, fragmentSource(scene.id)));
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program ${scene.id}: ${gl.getProgramInfoLog(program)}`);
    }
    const entry = {
      program,
      uRes: gl.getUniformLocation(program, "uRes"),
      uTime: gl.getUniformLocation(program, "uTime"),
      uTex: gl.getUniformLocation(program, "uTex"),
      uFocus: gl.getUniformLocation(program, "uFocus"),
    };
    this.programs.set(scene.id, entry);
    return entry;
  }

  async upload(scene) {
    if (this.textureScene === scene.id) return;
    const img = await loadImage(scene);
    const { gl } = this;
    const scratch = document.createElement("canvas");
    scratch.width = TEX_W;
    scratch.height = TEX_H;
    scratch.getContext("2d").drawImage(img, 0, 0, TEX_W, TEX_H);
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, scratch);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textureScene = scene.id;
  }

  async prepare(scene) {
    this.scene = scene;
    this.active = null;
    if (!this.gl || this.lost) {
      this.showFallback(scene);
      return;
    }
    try {
      const entry = this.compile(scene);
      if (scene.kind === "art") await this.upload(scene);
      if (this.scene !== scene) return;
      this.active = entry;
      this.canvas.style.visibility = "visible";
      this.el.style.background = "none";
    } catch (error) {
      console.warn(error.message);
      this.showFallback(scene);
    }
  }

  showFallback(scene) {
    this.canvas.style.visibility = "hidden";
    this.el.style.background = cssFallback(scene);
  }

  resize() {
    if (!this.gl) return;
    const cssW = Math.max(1, this.el.clientWidth);
    const cssH = Math.max(1, this.el.clientHeight);
    let ratio = Math.min(window.devicePixelRatio || 1, 2) * this.scale;
    const pixels = cssW * cssH * ratio * ratio;
    if (pixels > MAX_PIXELS) ratio *= Math.sqrt(MAX_PIXELS / pixels);
    const w = Math.max(2, Math.round(cssW * ratio));
    const h = Math.max(2, Math.round(cssH * ratio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(time) {
    if (!this.active || this.lost) return;
    const { gl, active, scene } = this;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(active.program);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(active.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(active.uTime, time);
    gl.uniform1f(active.uFocus, scene.focus ?? 0.5);
    if (scene.kind === "art") {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(active.uTex, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

export function createStage(elA, elB, { fadeMs = 1600 } = {}) {
  const views = [new View(elA), new View(elB)];
  let front = 0;
  let fading = null;
  let token = 0;
  let motion = true;
  let clock = 40 + Math.random() * 200;
  let last = 0;
  let dirty = true;
  let slow = 0;
  let scaleLocked = false;
  let fade = fadeMs;

  views[0].el.style.opacity = "1";
  views[1].el.style.opacity = "0";

  function finishFade() {
    if (!fading) return;
    clearTimeout(fading.timer);
    const old = views[fading.from];
    old.el.style.transition = "none";
    old.el.style.opacity = "0";
    old.el.style.zIndex = "0";
    views[fading.to].el.style.zIndex = "1";
    front = fading.to;
    fading = null;
    dirty = true;
  }

  async function set(id, { instant = false } = {}) {
    const scene = sceneById(id);
    token += 1;
    const mine = token;
    finishFade();
    if (views[front].scene === scene) return;
    if (instant || !views[front].scene) {
      await views[front].prepare(scene);
      dirty = true;
      return;
    }
    const to = 1 - front;
    const incoming = views[to];
    await incoming.prepare(scene);
    if (mine !== token) return;
    incoming.scale = views[front].scale;
    incoming.draw(clock);
    incoming.el.style.transition = "none";
    incoming.el.style.opacity = "0";
    incoming.el.style.zIndex = "2";
    void incoming.el.offsetWidth;
    incoming.el.style.transition = `opacity ${fade}ms ease-in-out`;
    incoming.el.style.opacity = "1";
    fading = { from: front, to, timer: setTimeout(finishFade, fade + 60) };
    dirty = true;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (motion) {
      clock += dt;
      if (!scaleLocked && dt > 0) {
        slow = dt > 0.034 ? slow + 1 : Math.max(0, slow - 2);
        if (slow > 45) {
          slow = 0;
          for (const view of views) view.scale = Math.max(0.4, view.scale * 0.82);
        }
      }
    } else if (!dirty && !fading) {
      return;
    }
    dirty = false;
    views[front].draw(clock);
    if (fading) views[fading.to].draw(clock);
  }
  requestAnimationFrame(frame);
  window.addEventListener("resize", () => { dirty = true; });

  return {
    set,
    get current() { return (fading ? views[fading.to].scene : views[front].scene)?.id ?? null; },
    get webgl() { return Boolean(views[0].gl && views[1].gl); },
    get fading() { return Boolean(fading); },
    get renderScale() { return views[front].scale; },
    setMotion(on) {
      motion = on;
      fade = on ? fadeMs : 0;
      dirty = true;
    },
    lockScale(scale) {
      scaleLocked = true;
      for (const view of views) view.scale = scale;
      dirty = true;
    },
    redraw() { dirty = true; },
  };
}
