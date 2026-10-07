import { generateMap, MAP_SIZES } from './map.js';
import { Game, CONFIG, RULES, resolveRules, isDefaultRules } from './game.js';
import { AIController } from './ai.js';
import { Renderer } from './render.js';
import { InputController } from './input.js';
import { PALETTE } from './palette.js';
import { randomSeed } from './rng.js';

const STEP = 1 / 60;
const HUMAN = 1;
const SETTINGS_KEY = 'dotdefender.settings';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#game');
const hud = $('#hud');
const hint = $('#hint');
const overlay = $('#overlay');
const cards = { menu: $('#menu'), cheats: $('#cheat-card'), pause: $('#pause-card'), end: $('#end-card') };

const settings = loadSettings();
let ratio = settings.ratio;
let game = null;
let ais = [];
let paused = false;
let endShown = false;
let lastSeed = null;

const renderer = new Renderer(canvas);
const input = new InputController(canvas, renderer, {
  getGame: () => game,
  onSend: (sources, target) => {
    game.send(HUMAN, sources, target, ratio);
    hint.classList.add('fade');
  },
});

function loadSettings() {
  const defaults = { difficulty: 'normal', opponents: '1', size: 'medium', ratio: 1 };
  try {
    const saved = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    return { ...saved, rules: resolveRules(saved.rules) };
  } catch {
    return { ...defaults, rules: resolveRules() };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, ratio }));
  } catch {
    // Storage can be unavailable (private mode); settings just won't persist.
  }
}

// ----- Menu wiring -----
document.querySelectorAll('.segmented').forEach((group) => {
  const key = group.dataset.setting;
  const sync = () => group.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === settings[key]));
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings[key] = b.dataset.value;
    saveSettings();
    sync();
  });
  sync();
});

function setRatio(r) {
  ratio = r;
  document.querySelectorAll('.ratio button').forEach((b) => b.classList.toggle('active', Number(b.dataset.ratio) === r));
  saveSettings();
}
document.querySelector('.ratio').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setRatio(Number(b.dataset.ratio));
});
setRatio(ratio);

// ----- Cheat menu -----
const RULE_TEXT = {
  regenSpeed: {
    format: (v) => `${v}×`,
    hint: (v) => `Bases grow about ${(CONFIG.growthBase * v).toFixed(2)} troops per second.`,
  },
  moveSpeed: {
    format: (v) => `${v}×`,
    hint: (v) => `Dots travel ${Math.round(CONFIG.dotSpeed * v)} units per second.`,
  },
  populationLimit: {
    format: (v) => `${v}`,
    hint: () => 'Most troops an average base grows to. Bigger regions hold a bit more.',
  },
};

function buildCheatMenu() {
  const box = $('#cheat-fields');
  for (const [key, spec] of Object.entries(RULES)) {
    const field = document.createElement('div');
    field.className = 'cheat-field';
    field.innerHTML = `<label for="rule-${key}">${spec.label}</label><output id="out-${key}"></output>
      <input type="range" id="rule-${key}" min="${spec.min}" max="${spec.max}" step="${spec.step}" />
      <small id="hint-${key}"></small>`;
    field.querySelector('input').addEventListener('input', (e) => {
      settings.rules = resolveRules({ ...settings.rules, [key]: e.target.value });
      saveSettings();
      syncCheats();
    });
    box.appendChild(field);
  }
}

function syncCheats() {
  for (const key of Object.keys(RULES)) {
    const v = settings.rules[key];
    $(`#rule-${key}`).value = v;
    $(`#out-${key}`).textContent = RULE_TEXT[key].format(v);
    $(`#hint-${key}`).textContent = RULE_TEXT[key].hint(v);
  }
  $('#cheat-badge').hidden = isDefaultRules(settings.rules);
}

buildCheatMenu();
syncCheats();
$('#cheats-btn').addEventListener('click', () => show('cheats'));
$('#cheat-back').addEventListener('click', () => show('menu'));
$('#cheat-reset').addEventListener('click', () => {
  settings.rules = resolveRules();
  saveSettings();
  syncCheats();
});

function show(name) {
  overlay.hidden = !name;
  for (const [k, el] of Object.entries(cards)) el.hidden = k !== name;
}

$('#play-btn').addEventListener('click', () => start());
$('#again-btn').addEventListener('click', () => start());
$('#restart-btn').addEventListener('click', () => start(lastSeed));
$('#resume-btn').addEventListener('click', () => setPaused(false));
$('#pause-btn').addEventListener('click', () => setPaused(true));
$('#quit-btn').addEventListener('click', toMenu);
$('#menu-btn').addEventListener('click', toMenu);

function toMenu() {
  input.enabled = false;
  startAttract();
  hud.hidden = true;
  hint.hidden = true;
  layout();
  show('menu');
}

function setPaused(p) {
  if (!game || game.status !== 'playing') return;
  paused = p;
  input.enabled = !p;
  if (p) input.cancelGesture();
  show(p ? 'pause' : null);
}

// ----- Game lifecycle -----
function start(seed = randomSeed()) {
  lastSeed = seed;
  const opponents = Number(settings.opponents);
  const map = generateMap({ regionCount: MAP_SIZES[settings.size], seed });
  game = new Game({ map, players: opponents + 1, humanId: HUMAN, seed, rules: settings.rules });
  $('#cheat-tag').hidden = isDefaultRules(game.rules);
  ais = [];
  for (let i = 0; i < opponents; i++) ais.push(new AIController(game, HUMAN + 1 + i, settings.difficulty, seed));
  renderer.setGame(game);
  input.reset();
  input.enabled = true;
  paused = false;
  endShown = false;
  hud.hidden = false;
  hint.hidden = false;
  hint.classList.remove('fade');
  buildPowerBar();
  layout();
  show(null);
}

function buildPowerBar() {
  const bar = $('#power');
  bar.innerHTML = '';
  for (let id = 1; id < game.playerCount; id++) {
    const seg = document.createElement('div');
    seg.style.background = PALETTE[id].base;
    seg.title = PALETTE[id].name;
    bar.appendChild(seg);
  }
  const neutral = document.createElement('div');
  neutral.style.background = 'rgba(255,255,255,0.25)';
  neutral.title = 'Neutral';
  bar.appendChild(neutral);
}

function updateHud() {
  const total = game.regions.length;
  const segs = $('#power').children;
  for (let id = 1; id < game.playerCount; id++) {
    segs[id - 1].style.width = `${(game.territory(id) / total) * 100}%`;
  }
  segs[segs.length - 1].style.width = `${(game.territory(0) / total) * 100}%`;
  const s = Math.floor(game.time);
  $('#clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function showEnd() {
  endShown = true;
  input.enabled = false;
  const won = game.winner === HUMAN;
  const st = game.stats[HUMAN];
  $('#end-title').textContent = won ? 'Victory!' : 'Defeat';
  $('#end-sub').textContent = won
    ? 'The whole map bows to blue.'
    : `${game.winner ? PALETTE[game.winner].name : 'The enemy'} overran your last base.`;
  const s = Math.floor(game.time);
  const rows = [
    ['Time', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`],
    ['Regions captured', st.captured],
    ['Regions lost', st.lost],
    ['Largest empire', `${st.peak} / ${game.regions.length}`],
    ['Dots sent', st.sent],
  ];
  $('#end-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  setTimeout(() => show('end'), 700);
}

// ----- Keyboard -----
window.addEventListener('keydown', (e) => {
  // Keys only apply to a human game that is running or paused.
  const active = game && game.humanId === HUMAN && (overlay.hidden || !cards.pause.hidden);
  if (!active) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'p') {
    e.preventDefault();
    if (game.status === 'playing') setPaused(!paused);
  } else if (k === 'escape') {
    if (input.selection.size) input.selection.clear();
    else setPaused(!paused);
  } else if (!paused && ['1', '2', '3', '4'].includes(k)) {
    setRatio(Number(k) * 0.25);
  } else if (!paused && k === 'a') {
    input.selectAll();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && game.humanId === HUMAN && game.status === 'playing' && !paused && overlay.hidden) setPaused(true);
});

// ----- Layout and main loop -----
function layout() {
  const h = hud.hidden ? 0 : hud.getBoundingClientRect().bottom;
  renderer.insets.top = Math.max(16, h + 4);
  renderer.resize();
}
window.addEventListener('resize', layout);

let last = performance.now();
let acc = 0;
let animTime = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (game) {
    if (!paused) {
      animTime += dt;
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps++ < 8) {
        game.step(STEP);
        for (const ai of ais) ai.update(STEP);
        acc -= STEP;
      }
      if (steps >= 8) acc = 0;
    }
    renderer.render(input.ui, animTime);
    if (game.humanId === HUMAN) updateHud();
    if (game.status === 'over' && !endShown) showEnd();
    if (game.humanId == null && game.status === 'over' && overlay.hidden === false) startAttract();
  }
  requestAnimationFrame(frame);
}

// Show a live AI-vs-AI match behind the start menu.
function startAttract() {
  const seed = randomSeed();
  const map = generateMap({ regionCount: MAP_SIZES.medium, seed });
  game = new Game({ map, players: 3, humanId: null, seed });
  ais = [1, 2, 3].map((id) => new AIController(game, id, 'normal', seed));
  renderer.setGame(game);
  paused = false;
  endShown = true;
}

// Handy for tinkering from the browser console (and used by smoke tests).
window.dotdefender = {
  get game() {
    return game;
  },
  renderer,
  input,
};

startAttract();
layout();
show('menu');
requestAnimationFrame(frame);
