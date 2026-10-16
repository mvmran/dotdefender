import { generateMap, MAP_SIZES } from './map.js';
import { Game, CONFIG, RULES, SPECIALS, PERKS, resolveRules, isDefaultRules } from './game.js';
import { AIController, DIFFICULTY, perkTimesFor } from './ai.js';
import { iconSvg, ICON_COLORS } from './icons.js';
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
const toasts = $('#toasts');
const clock = $('#clock');
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
    syncHelp();
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
document.querySelectorAll('[data-icon]').forEach((el) => (el.innerHTML = iconSvg(el.dataset.icon, 16)));
// Help text reads bonuses and perk timings from the game so it can't drift.
document.querySelectorAll('[data-bonus]').forEach((el) => {
  const spec = SPECIALS[el.dataset.bonus];
  el.textContent = `+${Math.round(spec.bonus * 100)}% ${spec.effect}`;
});
// Perk timings depend on the chosen difficulty.
function syncHelp() {
  const times = perkTimesFor(settings.difficulty);
  const level = $(`[data-setting="difficulty"] [data-value="${settings.difficulty}"]`)?.textContent ?? 'Normal';
  const recharge = Object.entries(PERKS).map(([perk, spec]) => `${spec.name.toLowerCase()} ${times[perk].recharge}\u00a0s`);
  $('[data-perk-recharge]').textContent = `on ${level}: ${recharge.join(', ')}`;
  document.querySelectorAll('[data-perk-duration]').forEach((el) => (el.textContent = `${times[el.dataset.perkDuration].duration}\u00a0seconds`));
}
syncHelp();
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
  input.reset();
  startAttract();
  hud.hidden = true;
  hint.hidden = true;
  layout({ fresh: true });
  show('menu');
}

function setPaused(p) {
  if (!game || game.status !== 'playing') return;
  paused = p;
  input.enabled = !p;
  if (p) {
    input.cancelGesture();
    input.stopTargeting();
  }
  show(p ? 'pause' : null);
}

// ----- Game lifecycle -----
function start(seed = randomSeed()) {
  lastSeed = seed;
  const opponents = Number(settings.opponents);
  const map = generateMap({ regionCount: MAP_SIZES[settings.size], seed });
  const specialDensity = DIFFICULTY[settings.difficulty].specialDensity;
  const perkTimes = perkTimesFor(settings.difficulty);
  game = new Game({ map, players: opponents + 1, humanId: HUMAN, seed, rules: settings.rules, specialDensity, perkTimes });
  perkWasReady = {};
  lastBonusKey = '';
  lastPowerKey = '';
  toasts.replaceChildren();
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
  setAimHint(false);
  buildPowerBar();
  layout({ fresh: true });
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

// Chips in the top bar for the bonuses the human currently holds.
let lastBonusKey = '';
function updateBonuses() {
  const bonus = game.bonusFor(HUMAN);
  const key = Object.keys(SPECIALS).map((t) => bonus[t]).join();
  if (key === lastBonusKey) return;
  lastBonusKey = key;
  $('#bonuses').innerHTML = Object.entries(SPECIALS)
    .filter(([t]) => bonus[t] > 1)
    .map(([t, spec]) => {
      const pct = Math.round((bonus[t] - 1) * 100);
      return `<span class="bonus" title="${spec.name}: +${pct}% ${spec.effect}">${iconSvg(t, 14)}+${pct}%</span>`;
    })
    .join('');
}

// Messages stack rather than replace each other: one frame can raise several
// (capturing the last biology lab also unlocks super regeneration).
const TOAST_LIMIT = 3;
function toast(html) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  toasts.append(el);
  while (toasts.children.length > TOAST_LIMIT) toasts.firstElementChild.remove();
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100); // once faded out
}

// The HUD redraws every frame. Writing only what changed keeps the browser
// from restyling it 60 times a second.
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

// Tells the human when they win or lose a special base. Runs before the
// renderer consumes this frame's events.
function announceSpecials() {
  for (const e of game.events) {
    if (e.type !== 'capture' || !e.special || (e.to !== HUMAN && e.from !== HUMAN)) continue;
    const spec = SPECIALS[e.special];
    const pct = Math.round(spec.bonus * 100);
    const text =
      e.to === HUMAN
        ? `<b>${spec.name} captured!</b> +${pct}% ${spec.effect}`
        : `<b>${spec.name} lost</b> to ${PALETTE[e.to].name}: −${pct}% ${spec.effect}`;
    toast(`${iconSvg(e.special, 18)}<span>${text}</span>`);
  }
}

// ----- Super perks -----
let perkWasReady = {};
const perkButtons = Object.fromEntries(Object.keys(PERKS).map((perk) => [perk, $(`#${perk}-btn`)]));
for (const [perk, btn] of Object.entries(perkButtons)) {
  btn.style.setProperty('--perk-color', ICON_COLORS[perk]); // matches the icon and the map effects
  btn.querySelector('.perk-name').textContent = PERKS[perk].label;
  btn.addEventListener('click', () => usePerk(perk));
}

// While the laser is being aimed, the hint pill says what to do. The button
// itself keeps its text, so its width (and the HUD's wrapping) doesn't change.
const HINT_HTML = hint.innerHTML;
let hintAiming = false;
function setAimHint(on) {
  if (on === hintAiming) return;
  hintAiming = on;
  hint.innerHTML = on ? 'Pick a base to wipe out · press the laser again to cancel' : HINT_HTML;
  hint.classList.toggle('aim', on);
}

function usePerk(perk) {
  if (!game || game.humanId !== HUMAN || paused || game.status !== 'playing') return;
  if (perk === 'laser') {
    if (input.targeting) input.stopTargeting(); // pressing again cancels aiming
    else if (game.perkStatus(HUMAN, perk).ready) input.startTargeting((id) => game.fireLaser(HUMAN, id));
  } else if (perk === 'regen') {
    game.activateRegen(HUMAN);
  }
}

function updatePerks() {
  // Stop aiming once the laser can't fire: its bases were lost or the game ended.
  if (input.targeting && (game.status !== 'playing' || !game.perkStatus(HUMAN, 'laser').ready)) input.stopTargeting();
  setAimHint(Boolean(input.targeting));
  for (const [perk, spec] of Object.entries(PERKS)) {
    const st = game.perkStatus(HUMAN, perk);
    const btn = perkButtons[perk];
    if (btn.hidden === st.unlocked) btn.hidden = !st.unlocked;
    if (!st.unlocked) continue;
    const aiming = perk === 'laser' && Boolean(input.targeting);
    btn.classList.toggle('ready', st.ready && !aiming);
    btn.classList.toggle('active', st.active > 0);
    btn.classList.toggle('aiming', aiming);
    // In whole percent steps, so the bar isn't restyled every frame.
    const charge = st.ready || st.active ? 0 : Math.round((1 - st.charge / game.perkTimes[perk].recharge) * 100) / 100;
    if (btn.style.getPropertyValue('--charge') !== String(charge)) btn.style.setProperty('--charge', String(charge));
    let time = '';
    if (st.active > 0) time = `${Math.ceil(st.active)}s`;
    else if (!st.ready) time = `${Math.ceil(st.charge)}s`;
    setText(btn.querySelector('.perk-time'), time);
    if (st.ready && !perkWasReady[perk]) {
      toast(`${iconSvg(perk, 18)}<span><b>${spec.name} ready!</b> Tap the button or press ${spec.key}.</span>`);
    }
    perkWasReady[perk] = st.ready;
  }
}

function announcePerks() {
  for (const e of game.events) {
    if (e.type === 'perk') {
      const name = PERKS[e.perk].name;
      if (e.owner === HUMAN) {
        toast(
          e.gained
            ? `${iconSvg(e.perk, 18)}<span><b>${name} unlocked!</b> Charging up…</span>`
            : `${iconSvg(e.perk, 18)}<span><b>${name} lost.</b> You no longer hold every ${SPECIALS[PERKS[e.perk].special].name.toLowerCase()}.</span>`,
        );
      } else if (e.gained) {
        toast(`${iconSvg(e.perk, 18)}<span><b>${PALETTE[e.owner].name} unlocked the ${name.toLowerCase()}!</b></span>`);
      }
    } else if (e.type === 'laser' && e.owner !== HUMAN && e.from === HUMAN) {
      toast(`${iconSvg('laser', 18)}<span><b>${PALETTE[e.owner].name} lasered one of your bases!</b></span>`);
    } else if (e.type === 'regen' && e.owner !== HUMAN) {
      toast(`${iconSvg('regen', 18)}<span><b>${PALETTE[e.owner].name} activated super regeneration!</b></span>`);
    }
  }
}

// Territory only changes when a region changes hands (a capture or a laser
// shot), so the bar is only rewritten when the counts change.
let lastPowerKey = '';
function updatePower() {
  const counts = Array.from({ length: game.playerCount }, (_, id) => game.territory(id));
  const key = counts.join();
  if (key === lastPowerKey) return;
  lastPowerKey = key;
  const segs = $('#power').children;
  const share = (id) => `${(counts[id] / game.regions.length) * 100}%`;
  for (let id = 1; id < game.playerCount; id++) segs[id - 1].style.width = share(id);
  segs[segs.length - 1].style.width = share(0);
}

function updateHud() {
  updatePerks();
  updateBonuses();
  updatePower();
  const s = Math.floor(game.time);
  setText(clock, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
}

function showEnd() {
  endShown = true;
  input.enabled = false;
  input.reset();
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
  // Keys only apply to a human game that is running or paused (not one that
  // just ended, while the end card is on its way).
  const active = game && game.humanId === HUMAN && game.status === 'playing' && (overlay.hidden || !cards.pause.hidden);
  if (!active || e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'p') e.preventDefault();
  // A held key repeats. That mustn't flip pause or laser aiming on and off.
  if (e.repeat) return;
  const perk = Object.keys(PERKS).find((p) => PERKS[p].key.toLowerCase() === k);
  if (k === ' ' || k === 'p') {
    setPaused(!paused);
  } else if (k === 'escape') {
    if (input.targeting) input.stopTargeting();
    else if (input.selection.size) input.selection.clear();
    else setPaused(!paused);
  } else if (!paused && perk) {
    usePerk(perk);
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
// The HUD wraps taller on smaller screens when bonus chips or perk buttons
// appear, and the map moves down to stay clear of it. During a game it never
// moves back up, so a bar that wraps and unwraps can't make the map jump back
// and forth under the player's finger. A new game, the menu or a window resize
// lays out afresh.
let hudBottom = 0;
function layout({ fresh = false } = {}) {
  const h = hud.hidden ? 0 : hud.getBoundingClientRect().bottom;
  hudBottom = fresh ? h : Math.max(hudBottom, h);
  renderer.insets.top = Math.max(16, hudBottom + 4);
  toasts.style.top = `${Math.max(16, h + 10)}px`; // just below the HUD
  renderer.resize();
}
window.addEventListener('resize', () => layout({ fresh: true }));
new ResizeObserver(() => layout()).observe(hud);

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
    if (game.humanId === HUMAN) {
      announceSpecials();
      announcePerks();
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
  game = new Game({ map, players: 3, humanId: null, seed, specialDensity: DIFFICULTY.normal.specialDensity, perkTimes: perkTimesFor('normal') });
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
