import { LAYERS, MOODS, SCENES } from "./data.js";
import { createStage } from "./scenes.js";
import { Engine } from "./audio.js";
import { Sfx } from "./sfx.js";

const STORAGE_KEY = "sound-kitchen-cafe-v1";

const state = {
  levels: Object.fromEntries(LAYERS.map((layer) => [layer.id, 0])),
  master: 70,
  tone: 100,
  scene: "ember",
  mood: null,
  playing: false,
  clicksOn: true,
  timerMinutes: 25,
  timerRemaining: 25 * 60,
  timerRunning: false,
  timerDone: false,
  timerEndsAt: 0,
  panelHidden: false,
};

let engine = null;
let sfx = null;
let timerId = null;
const knobs = new Map();
let toneArc = null;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
document.documentElement.classList.toggle("reduce", reduceMotion.matches);
const stage = createStage(document.getElementById("scene-a"), document.getElementById("scene-b"));
stage.setMotion(!reduceMotion.matches);
reduceMotion.addEventListener("change", () => {
  document.documentElement.classList.toggle("reduce", reduceMotion.matches);
  stage.setMotion(!reduceMotion.matches);
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function groupTitle(group) {
  switch (group) {
    case "noise":
      return "Noise";
    case "weather":
      return "Weather";
    case "place":
      return "Place";
    case "tone":
      return "Tone";
    default: {
      const exhaustive = group;
      throw new Error(`Unknown layer group: ${exhaustive}`);
    }
  }
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) {
      state.levels.brown = 60;
      return;
    }
    for (const layer of LAYERS) {
      const value = Number(saved.levels?.[layer.id]);
      state.levels[layer.id] = Number.isFinite(value) ? clamp(Math.round(value), 0, 100) : 0;
    }
    state.master = clamp(Math.round(Number(saved.master ?? 70)), 0, 100);
    state.tone = clamp(Math.round(Number(saved.tone ?? 100)), 0, 100);
    if (SCENES.some((scene) => scene.id === saved.scene)) state.scene = saved.scene;
    if (MOODS.some((mood) => mood.id === saved.mood)) state.mood = saved.mood;
    state.clicksOn = saved.clicksOn !== false;
    state.panelHidden = saved.panelHidden === true;
    const minutes = clamp(Math.round(Number(saved.timerMinutes ?? 25)), 1, 180);
    state.timerMinutes = minutes;
    state.timerRemaining = minutes * 60;
  } catch {
    state.levels.brown = 60;
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    levels: state.levels,
    master: state.master,
    tone: state.tone,
    scene: state.scene,
    mood: state.mood,
    clicksOn: state.clicksOn,
    timerMinutes: state.timerMinutes,
    panelHidden: state.panelHidden,
  }));
}

function ensureEngine() {
  if (!engine) {
    const ctx = new AudioContext();
    engine = new Engine(ctx);
    sfx = new Sfx(ctx, engine.sfxBus);
    sfx.setMuted(!state.clicksOn);
    engine.setMaster(state.master);
    engine.setTone(state.tone);
    for (const layer of LAYERS) {
      if (state.levels[layer.id] > 0) engine.setLevel(layer.id, state.levels[layer.id], 0.02);
    }
    engine.start();
  }
  if (engine.ctx.state === "suspended") void engine.ctx.resume();
  return engine;
}

function tap(kind) {
  ensureEngine();
  sfx[kind]();
}

function paintPower() {
  const button = document.getElementById("power");
  button.setAttribute("aria-pressed", String(state.playing));
  button.querySelector(".transport-label").textContent = state.playing ? "Pause" : "Play";
}

function paintClicks() {
  const button = document.getElementById("clicks");
  button.setAttribute("aria-checked", String(state.clicksOn));
  document.getElementById("clicks-state").textContent = state.clicksOn ? "On" : "Muted";
}

function paintMoods() {
  document.querySelectorAll("[data-mood]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mood === state.mood));
  });
}

function paintScenes() {
  document.querySelectorAll("[data-scene]").forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.scene === state.scene));
  });
}

function updateLive() {
  const names = LAYERS.filter((layer) => state.levels[layer.id] > 2).map((layer) => layer.label);
  const live = document.getElementById("live");
  if (!state.playing) {
    live.textContent = names.length ? `Ready · ${names.join(", ")}` : "Deck idle";
    return;
  }
  live.textContent = names.length ? names.join(" · ") : "Playing silence";
}

async function setPlaying(next) {
  const eng = ensureEngine();
  if (eng.ctx.state === "suspended") await eng.ctx.resume();
  state.playing = next;
  eng.setPlaying(next);
  paintPower();
  updateLive();
}

function setScene(id) {
  if (!SCENES.some((scene) => scene.id === id)) return;
  state.scene = id;
  paintScenes();
  // Let the click finish rendering before a scene upload stalls the audio thread.
  window.setTimeout(() => {
    if (state.scene === id) void stage.set(id);
  }, 70);
  save();
}

function applyMood(id) {
  const mood = MOODS.find((item) => item.id === id);
  state.mood = id;
  for (const layer of LAYERS) {
    state.levels[layer.id] = mood.levels[layer.id] ?? 0;
    knobs.get(layer.id).set(state.levels[layer.id]);
    if (engine) engine.setLevel(layer.id, state.levels[layer.id], 0.15);
  }
  paintMoods();
  setScene(mood.scene);
  updateLive();
  save();
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function renderTimer() {
  document.getElementById("clock").textContent = formatTime(state.timerRemaining);
  document.getElementById("timer").classList.toggle("done", state.timerDone);
  document.getElementById("timer-note").hidden = !state.timerDone;
  const toggle = document.getElementById("timer-toggle");
  toggle.setAttribute("aria-checked", String(state.timerRunning));
  document.getElementById("timer-state").textContent = state.timerRunning ? "Pause" : "Start";
  document.querySelectorAll("[data-minutes]").forEach((button) => {
    const selected = Number(button.dataset.minutes) === state.timerMinutes;
    button.setAttribute("aria-pressed", String(selected));
  });
}

function stopTimerClock() {
  clearInterval(timerId);
  timerId = null;
  state.timerRunning = false;
}

function startTimer() {
  if (state.timerDone || state.timerRemaining <= 0) {
    state.timerRemaining = state.timerMinutes * 60;
    state.timerDone = false;
  }
  state.timerEndsAt = Date.now() + state.timerRemaining * 1000;
  state.timerRunning = true;
  clearInterval(timerId);
  timerId = setInterval(tickTimer, 200);
  renderTimer();
}

function setTimerLength(minutes, { start = false } = {}) {
  state.timerMinutes = clamp(Math.round(minutes) || 25, 1, 180);
  state.timerRemaining = state.timerMinutes * 60;
  state.timerDone = false;
  stopTimerClock();
  document.getElementById("custom-minutes").value = String(state.timerMinutes);
  if (start) startTimer();
  else renderTimer();
  save();
}

function tickTimer() {
  if (!state.timerRunning) return;
  const left = Math.max(0, Math.round((state.timerEndsAt - Date.now()) / 1000));
  if (left === state.timerRemaining && left > 0) return;
  state.timerRemaining = left;
  if (left <= 0) {
    state.timerDone = true;
    stopTimerClock();
  }
  renderTimer();
}

function toggleTimer() {
  if (state.timerRunning) {
    state.timerRemaining = Math.max(0, Math.round((state.timerEndsAt - Date.now()) / 1000));
    stopTimerClock();
    renderTimer();
    return;
  }
  startTimer();
}

function applyPanel() {
  document.body.classList.toggle("panel-hidden", state.panelHidden);
  document.getElementById("panel-hide").setAttribute("aria-expanded", String(!state.panelHidden));
  const show = document.getElementById("panel-show");
  show.hidden = !state.panelHidden;
  show.setAttribute("aria-expanded", String(!state.panelHidden));
}

function setPanelHidden(hidden) {
  state.panelHidden = hidden;
  applyPanel();
  save();
  document.getElementById(hidden ? "panel-show" : "panel-hide").focus();
}

function mountKnob(host, { id, label, value, large, onInput }) {
  const dial = document.createElement("div");
  dial.className = large ? "dial lg" : "dial";
  const knob = document.createElement("div");
  knob.className = "knob";
  knob.dataset.dial = id;
  knob.tabIndex = 0;
  knob.role = "slider";
  knob.setAttribute("aria-label", label);
  knob.setAttribute("aria-valuemin", "0");
  knob.setAttribute("aria-valuemax", "100");
  const ticks = document.createElement("span");
  ticks.className = "knob-ticks";
  for (let i = 0; i <= 10; i += 1) {
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.style.transform = `rotate(${-135 + i * 27}deg)`;
    tick.append(document.createElement("i"));
    ticks.append(tick);
  }
  const rotor = document.createElement("span");
  rotor.className = "knob-rotor";
  rotor.append(Object.assign(document.createElement("i"), { className: "knob-needle" }));
  knob.append(ticks, rotor);
  const readout = document.createElement("span");
  readout.className = "readout";
  const name = document.createElement("span");
  name.className = "knob-name";
  name.textContent = label;
  dial.append(knob, readout, name);
  host.append(dial);

  let current = clamp(Math.round(value), 0, 100);
  let lastSound = current;
  const paint = () => {
    knob.style.setProperty("--p", String(current / 100));
    knob.setAttribute("aria-valuenow", String(current));
    knob.setAttribute("aria-valuetext", String(current));
    readout.textContent = String(current);
  };
  const commit = (next, sound) => {
    const resolved = clamp(Math.round(next), 0, 100);
    if (resolved === current) return;
    current = resolved;
    paint();
    onInput(resolved);
    if (sound && Math.floor(resolved / 2) !== Math.floor(lastSound / 2)) {
      lastSound = resolved;
      ensureEngine();
      sfx.detent();
    } else {
      lastSound = resolved;
    }
  };
  paint();

  let drag = null;
  knob.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    knob.focus({ preventScroll: true });
    knob.setPointerCapture(event.pointerId);
    knob.classList.add("dragging");
    const rect = knob.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      x: event.clientX,
      y: event.clientY,
      angle: Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2)),
      value: current,
      mode: null,
    };
  });
  knob.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.mode) {
      if (Math.hypot(dx, dy) < 3) return;
      drag.mode = Math.abs(dy) > Math.abs(dx) ? "v" : "a";
    }
    if (drag.mode === "v") {
      const scale = event.shiftKey ? 6 : 1.5;
      commit(drag.value + (drag.y - event.clientY) / scale, true);
      return;
    }
    const angle = Math.atan2(event.clientY - drag.cy, event.clientX - drag.cx);
    let delta = (angle - drag.angle) * 180 / Math.PI;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    commit(drag.value + (delta / 270) * 100, true);
  });
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    knob.classList.remove("dragging");
    save();
  };
  knob.addEventListener("pointerup", endDrag);
  knob.addEventListener("pointercancel", endDrag);
  knob.addEventListener("wheel", (event) => {
    event.preventDefault();
    commit(current - Math.sign(event.deltaY) * (event.shiftKey ? 1 : 3), true);
    save();
  }, { passive: false });
  knob.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 10 : 2;
    let next = null;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") next = current + step;
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next = current - step;
    else if (event.key === "PageUp") next = current + 10;
    else if (event.key === "PageDown") next = current - 10;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 100;
    else return;
    event.preventDefault();
    commit(next, true);
    save();
  });

  return {
    set(value) {
      current = clamp(Math.round(value), 0, 100);
      lastSound = current;
      paint();
    },
  };
}

const ARC_A0 = 160 * Math.PI / 180;
const ARC_SWEEP = -140 * Math.PI / 180;

function arcPoint(t) {
  const angle = ARC_A0 + ARC_SWEEP * t;
  return [60 + 54 * Math.cos(angle), 70 - 54 * Math.sin(angle)];
}

function arcPath(to) {
  const steps = Math.max(2, Math.round(28 * to));
  const parts = [];
  for (let i = 0; i <= steps; i += 1) {
    const [x, y] = arcPoint(to * (i / steps));
    parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return parts.join(" ");
}

function mountArc(host, { value, onInput }) {
  const el = document.createElement("div");
  el.className = "arc";
  el.dataset.arc = "tone";
  el.tabIndex = 0;
  el.role = "slider";
  el.setAttribute("aria-label", "Tone");
  el.setAttribute("aria-valuemin", "0");
  el.setAttribute("aria-valuemax", "100");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 78");
  svg.classList.add("arc-svg");
  const track = document.createElementNS("http://www.w3.org/2000/svg", "path");
  track.setAttribute("class", "arc-track");
  track.setAttribute("d", arcPath(1));
  const fill = document.createElementNS("http://www.w3.org/2000/svg", "path");
  fill.setAttribute("class", "arc-fill");
  const ticks = document.createElementNS("http://www.w3.org/2000/svg", "g");
  for (let i = 0; i <= 4; i += 1) {
    const t = i / 4;
    const angle = ARC_A0 + ARC_SWEEP * t;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "arc-tick");
    line.setAttribute("x1", String(60 + 46 * Math.cos(angle)));
    line.setAttribute("y1", String(70 - 46 * Math.sin(angle)));
    line.setAttribute("x2", String(60 + 62 * Math.cos(angle)));
    line.setAttribute("y2", String(70 - 62 * Math.sin(angle)));
    ticks.append(line);
  }
  const thumb = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  thumb.setAttribute("class", "arc-thumb");
  thumb.setAttribute("r", "7");
  svg.append(track, fill, ticks, thumb);
  const meta = document.createElement("span");
  meta.className = "arc-meta";
  const caption = document.createElement("span");
  caption.textContent = "Tone";
  const readout = document.createElement("span");
  readout.className = "readout";
  meta.append(caption, readout);
  el.append(svg, meta);
  host.append(el);

  let current = clamp(Math.round(value), 0, 100);
  let lastSound = current;
  const paint = () => {
    const [x, y] = arcPoint(current / 100);
    thumb.setAttribute("cx", x.toFixed(2));
    thumb.setAttribute("cy", y.toFixed(2));
    fill.setAttribute("d", arcPath(Math.max(0.001, current / 100)));
    el.setAttribute("aria-valuenow", String(current));
    el.setAttribute("aria-valuetext", String(current));
    readout.textContent = String(current);
  };
  const commit = (next, sound) => {
    const resolved = clamp(Math.round(next), 0, 100);
    if (resolved === current) return;
    current = resolved;
    paint();
    onInput(resolved);
    if (sound && Math.floor(resolved / 2) !== Math.floor(lastSound / 2)) {
      lastSound = resolved;
      ensureEngine();
      sfx.detent();
    } else {
      lastSound = resolved;
    }
  };
  paint();

  const nearest = (clientX, clientY) => {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 120;
    const y = ((clientY - rect.top) / rect.height) * 78;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i <= 60; i += 1) {
      const t = i / 60;
      const [px, py] = arcPoint(t);
      const dist = (px - x) ** 2 + (py - y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }
    return { t: best, dist: Math.sqrt(bestDist) };
  };

  let drag = null;
  el.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    el.focus({ preventScroll: true });
    el.setPointerCapture(event.pointerId);
    el.classList.add("dragging");
    const hit = nearest(event.clientX, event.clientY);
    drag = { id: event.pointerId, y: event.clientY, value: current, close: hit.dist < 28 };
    if (drag.close) commit(hit.t * 100, true);
  });
  el.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.close) {
      commit(nearest(event.clientX, event.clientY).t * 100, true);
      return;
    }
    commit(drag.value + (drag.y - event.clientY) / 1.6, true);
  });
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    el.classList.remove("dragging");
    save();
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
  el.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 10 : 2;
    let next = null;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") next = current + step;
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next = current - step;
    else if (event.key === "PageUp") next = current + 10;
    else if (event.key === "PageDown") next = current - 10;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 100;
    else return;
    event.preventDefault();
    commit(next, true);
    save();
  });
  return {
    set(next) {
      current = clamp(Math.round(next), 0, 100);
      lastSound = current;
      paint();
    },
  };
}

function drawMeter(levels) {
  const canvas = document.getElementById("meter");
  const view = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  view.clearRect(0, 0, width, height);
  levels.forEach((rms, index) => {
    const x = index === 0 ? 2 : 16;
    const lit = Math.round(Math.min(1, Math.sqrt(rms) * 4.2) * 12);
    for (let seg = 0; seg < 12; seg += 1) {
      view.fillStyle = seg >= lit ? "#2a2218" : seg > 9 ? "#ff5a3c" : seg > 7 ? "#ffb25b" : "#9dffe0";
      view.fillRect(x, height - 6 - seg * 6.4, 10, 4);
    }
  });
}

function meterFrame() {
  if (engine) drawMeter(engine.meter());
  requestAnimationFrame(meterFrame);
}

function buildMixer() {
  const bay = document.getElementById("bay");
  const row = document.createElement("div");
  row.className = "bay-row";
  const masterHost = document.createElement("div");
  row.append(masterHost);
  const meter = document.createElement("canvas");
  meter.id = "meter";
  meter.className = "meter";
  meter.width = 28;
  meter.height = 84;
  meter.setAttribute("aria-hidden", "true");
  row.append(meter);
  bay.append(row);
  knobs.set("master", mountKnob(masterHost, {
    id: "master",
    label: "Master",
    value: state.master,
    large: true,
    onInput(value) {
      state.master = value;
      ensureEngine().setMaster(value);
      save();
    },
  }));
  toneArc = mountArc(bay, {
    value: state.tone,
    onInput(value) {
      state.tone = value;
      ensureEngine().setTone(value);
      save();
    },
  });

  const layers = document.getElementById("layers");
  const groups = ["noise", "weather", "place", "tone"];
  for (const group of groups) {
    const block = document.createElement("div");
    block.className = "group";
    const title = document.createElement("h2");
    title.textContent = groupTitle(group);
    const dials = document.createElement("div");
    dials.className = "dials";
    block.append(title, dials);
    for (const layer of LAYERS.filter((item) => item.group === group)) {
      knobs.set(layer.id, mountKnob(dials, {
        id: layer.id,
        label: layer.label,
        value: state.levels[layer.id],
        onInput(value) {
          state.levels[layer.id] = value;
          state.mood = null;
          paintMoods();
          ensureEngine().setLevel(layer.id, value, 0.05);
          updateLive();
          save();
        },
      }));
    }
    layers.append(block);
  }
}

function buildKeys() {
  const moods = document.getElementById("moods");
  for (const mood of MOODS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "keycap";
    button.dataset.mood = mood.id;
    button.textContent = mood.label;
    button.addEventListener("click", () => {
      tap("click");
      applyMood(mood.id);
    });
    moods.append(button);
  }
  const scenes = document.getElementById("scenes");
  for (const scene of SCENES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "keycap scene-key";
    button.dataset.scene = scene.id;
    button.role = "radio";
    const swatch = document.createElement("i");
    swatch.className = "swatch";
    swatch.style.background = `linear-gradient(135deg, ${scene.swatch[0]}, ${scene.swatch[1]})`;
    button.append(swatch, document.createTextNode(scene.label));
    button.addEventListener("click", () => {
      tap("click");
      setScene(scene.id);
    });
    scenes.append(button);
  }
}

function bindTransport() {
  document.getElementById("power").addEventListener("click", () => {
    tap("clunk");
    void setPlaying(!state.playing);
  });
  document.getElementById("clicks").addEventListener("click", () => {
    ensureEngine();
    if (state.clicksOn) {
      sfx.flip();
      state.clicksOn = false;
      sfx.setMuted(true);
    } else {
      state.clicksOn = true;
      sfx.setMuted(false);
      sfx.flip();
    }
    paintClicks();
    save();
  });
  document.querySelectorAll("[data-minutes]").forEach((button) => {
    button.addEventListener("click", () => {
      tap("click");
      setTimerLength(Number(button.dataset.minutes), { start: true });
    });
  });
  document.getElementById("custom-minutes").addEventListener("change", (event) => {
    setTimerLength(Number(event.target.value) || 25, { start: true });
  });
  document.getElementById("timer-toggle").addEventListener("click", () => {
    tap("flip");
    toggleTimer();
  });
  document.getElementById("timer-reset").addEventListener("click", () => {
    tap("click");
    setTimerLength(state.timerMinutes);
  });
  const togglePanel = () => {
    tap("click");
    setPanelHidden(!state.panelHidden);
  };
  document.getElementById("panel-hide").addEventListener("click", togglePanel);
  document.getElementById("panel-show").addEventListener("click", togglePanel);
  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest("input, textarea, select")) return;
    if (event.key === "h" || event.key === "H") {
      event.preventDefault();
      togglePanel();
      return;
    }
    if (event.code !== "Space") return;
    if (event.target.closest("button, [role=slider]")) return;
    event.preventDefault();
    tap("clunk");
    void setPlaying(!state.playing);
  });
}

load();
buildMixer();
buildKeys();
bindTransport();
paintPower();
paintClicks();
paintMoods();
paintScenes();
applyPanel();
renderTimer();
updateLive();
void stage.set(state.scene, { instant: true });
requestAnimationFrame(meterFrame);
document.getElementById("custom-minutes").value = String(state.timerMinutes);

window.still = {
  state,
  stage,
  get engine() { return engine; },
  get sfx() { return sfx; },
  knobs,
  get toneArc() { return toneArc; },
};
