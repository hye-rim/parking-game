'use strict';

// 주차장 탈출: 화면·입력·흐름. 판 규칙은 logic.js (LOGIC) 에 있다.
(() => {
const L = LOGIC;

// ---------- 모양 ----------
const W = 400, H = 600;
const BTN_Y = H - 66, BTN_H = 52;
const LOT_W = 392, LOT_X = (W - LOT_W) / 2, LOT_Y = 104;
const ROAD = 24;                                   // 주차장을 두른 도로 폭
const GRID = LOT_W - ROAD * 2, GX = LOT_X + ROAD, GY = LOT_Y + ROAD;
const INK = '#2b1d52';
const FONT = '"Jua", "Apple SD Gothic Neo", sans-serif';

const EXIT_V0 = 5, EXIT_ACC = 42;                  // 빠져나갈 때 처음 속도·가속 (칸/초)
const BUMP_GO = 0.13, BUMP_BACK = 0.22;            // 부딪힐 때 나갔다 돌아오는 시간
const CAR_MX = 0.2, CAR_MY = 0.14;                 // 칸 안에서 차 옆·앞뒤로 남기는 여백 (칸 크기 비율)
const HINTS = 3;
const SAVE_KEY = 'parkingLevel', BEST_KEY = 'parkingBest';

// 차 색: 채도를 낮춘 5가지만 (색이 많고 쨍하면 판이 정신없다)
const CAR_COLORS = ['#e8736f', '#f0c35a', '#72c2a0', '#74a9dc', '#f3f0e8'];
const ANG = { N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 };
const shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16), cl = (v) => Math.max(0, Math.min(255, v));
  return `rgb(${cl((n >> 16) + amt)},${cl(((n >> 8) & 255) + amt)},${cl((n & 255) + amt)})`;
};

const BTN = [{ id: 'restart', x: 40, w: 150 }, { id: 'hint', x: 210, w: 150 }];

// ---------- 캔버스 ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const hudH = 62;
  const scale = Math.min((innerWidth - 24) / W, (innerHeight - 28 - hudH) / H);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = Math.max(cssW, Math.min(innerWidth - 20, 340)) + 'px';
  $('wrap').style.width = cssW + 'px';
  $('wrap').style.margin = '0 auto';
}
addEventListener('resize', fit);

function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------- 저장·소리 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let muted = store.get('parkingMuted') === '1';
let audio = null;
function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const sfx = {
  go: () => tone(140, 0.35, 'sawtooth', 0.05, 420),
  crash: () => { tone(110, 0.16, 'square', 0.1, -40); setTimeout(() => { tone(440, 0.12, 'square', 0.05); tone(554, 0.12, 'square', 0.05); }, 90); },
  wait: () => tone(200, 0.05, 'triangle', 0.05),
  hint: () => [660, 880].forEach((f, i) => setTimeout(() => tone(f, 0.1, 'sine', 0.09), i * 70)),
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'triangle', 0.1), i * 100)),
};

// ---------- 상태 ----------
let state = 'menu';           // menu | play | paused | won
let level = Math.max(1, Number(store.get(SAVE_KEY)) || 1);
let best = Number(store.get(BEST_KEY)) || 0;
let start = null, board = null;
let cell = GRID / 5;
let crashes = 0, hintsLeft = HINTS;
let hint = null;                              // { i, t } 잠깐 반짝이는 힌트 차
let moving = new Map();                       // 차 번호 → { kind:'exit'|'bump', t, off, ... }
let shakes = new Map();                       // 차 번호 → 남은 흔들림 시간
let particles = [], floaters = [], banner = null;
let winTimer = null;
let clock = 0;

function newLevel(n, same = false) {
  level = n; store.set(SAVE_KEY, String(n));
  if (!same) start = L.generate(n, Math.random, CAR_COLORS.length);
  board = L.cloneBoard(start);
  cell = GRID / board.n;
  crashes = 0; hintsLeft = HINTS; hint = null;
  moving.clear(); shakes.clear(); particles = []; floaters = [];
  clearTimeout(winTimer);
  banner = { text: `레벨 ${n}`, t: 0 };
  state = 'play';
  hideOverlay();
  updateHud();
}

const starsFor = (c) => (c === 0 ? 3 : c === 1 ? 2 : 1);

// ---------- 흐름 ----------
// 빠져나가는 중인 차가 아직 지나가고 있는 칸 (그 칸을 지나야 하는 차는 잠깐 기다린다)
function busyCells() {
  const set = new Set();
  for (const [i, m] of moving) {
    if (m.kind !== 'exit') continue;
    const car = board.cars[i], [dx, dy] = L.DIRS[car.dir];
    for (const s of [Math.floor(m.off), Math.ceil(m.off)]) {
      for (const [x, y] of L.cellsOf(car)) {
        const cx = x + dx * s, cy = y + dy * s;
        if (cx >= 0 && cy >= 0 && cx < board.n && cy < board.n) set.add(cy * board.n + cx);
      }
    }
  }
  return set;
}

function tapCar(i) {
  if (state !== 'play' || moving.has(i)) return;
  const car = board.cars[i];
  const block = L.firstBlock(board, i);
  if (block === null) {
    const busy = busyCells();
    if (L.pathOf(car, board.n).some(([x, y]) => busy.has(y * board.n + x))) { sfx.wait(); return; }
    car.out = true;                                          // 판에서는 바로 빠진 걸로 친다
    moving.set(i, { kind: 'exit', t: 0, off: 0, pathLen: L.pathOf(car, board.n).length });
    if (hint && hint.i === i) hint = null;
    sfx.go();
    updateHud();
    if (L.solved(board)) winTimer = setTimeout(win, 650);
    return;
  }
  // 막혀 있으면 앞차 범퍼에 닿을 때까지(빈칸 수 + 두 차의 앞뒤 여백) 갔다가 쾅 하고 돌아온다
  moving.set(i, { kind: 'bump', t: 0, off: 0, dist: block.dist + CAR_MY * 2 - 0.02, block: block.i, hit: false });
}

function bumpHit(i, m) {
  m.hit = true;
  crashes++;
  if (m.block >= 0) shakes.set(m.block, 0.3);
  shakes.set(i, 0.2);
  const car = board.cars[i], [dx, dy] = L.DIRS[car.dir];
  const k = m.dist + 0.5 - CAR_MY;                         // 부딪힌 순간 앞범퍼 위치
  const x = GX + (car.x + 0.5 + dx * k) * cell, y = GY + (car.y + 0.5 + dy * k) * cell;
  burst(x, y);
  floaters.push({ x, y: y - 10, text: '쾅!', t: 0 });
  sfx.crash();
  updateHud();
}

function useHint() {
  if (state !== 'play' || hintsLeft <= 0) return;
  // 지금 빠질 수 있는 차 중에서 다른 차 앞길을 가장 많이 막고 있는 차
  const free = L.freeCars(board).filter((i) => !moving.has(i));
  if (!free.length) return;
  const occ = L.occupancy(board);
  const blocking = new Map(free.map((i) => [i, 0]));
  board.cars.forEach((c, j) => {
    if (c.out) return;
    const seen = new Set();
    for (const [x, y] of L.pathOf(c, board.n)) {
      const v = occ[y * board.n + x];
      if (blocking.has(v) && !seen.has(v)) { seen.add(v); blocking.set(v, blocking.get(v) + 1); }
    }
  });
  const pick = free.reduce((a, b) => (blocking.get(b) > blocking.get(a) ? b : a));
  hintsLeft--;
  hint = { i: pick, t: 0 };
  sfx.hint();
}

function burst(x, y) {
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 140;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.5, col: i % 2 ? '#ffd23f' : '#fff' });
  }
}

function win() {
  if (state !== 'play') return;
  state = 'won';
  if (level > best) { best = level; store.set(BEST_KEY, String(best)); }
  store.set(SAVE_KEY, String(level + 1));
  sfx.win();
  updateHud();
  const stars = starsFor(crashes);
  const next = L.levelSpec(level + 1).size;
  setTimeout(() => showOverlay(`
    <h2 class="inked">레벨 ${level} 클리어!</h2>
    <div class="stars">${[0, 1, 2].map((k) => `<span class="${k < stars ? '' : 'off'}">⭐</span>`).join('')}</div>
    <span class="tag">${crashes ? `${crashes}번 쾅!` : '한 번도 안 부딪혔어요!'}</span>
    <div class="card"><dl class="stats">
      <dt>다음 레벨</dt><dd>${level + 1}</dd>
      <dt>주차장</dt><dd>${next}×${next}</dd>
      <dt>최고 레벨</dt><dd>${best}</dd>
    </dl></div>
    <button data-act="next">다음 레벨</button>
    <button class="sub" data-act="menu">← 처음으로</button>`), 300);
}

function update(dt) {
  clock += dt;
  for (const [i, m] of moving) {
    m.t += dt;
    if (m.kind === 'exit') {
      m.off = EXIT_V0 * m.t + 0.5 * EXIT_ACC * m.t * m.t;
      if (exitAlpha(board.cars[i], m) <= 0) moving.delete(i);
    } else {
      if (m.t < BUMP_GO) { const k = m.t / BUMP_GO; m.off = m.dist * k * k; }
      else {
        if (!m.hit) bumpHit(i, m);
        const k = Math.min(1, (m.t - BUMP_GO) / BUMP_BACK);
        m.off = m.dist * (1 - k) * (1 - k);
        if (k >= 1) moving.delete(i);
      }
    }
  }
  for (const [i, t] of shakes) { if (t - dt <= 0) shakes.delete(i); else shakes.set(i, t - dt); }
  for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt; }
  particles = particles.filter((p) => p.life > 0);
  for (const f of floaters) { f.t += dt; f.y -= 40 * dt; }
  floaters = floaters.filter((f) => f.t < 0.8);
  if (banner) { banner.t += dt; if (banner.t > 1.3) banner = null; }
  if (hint) { hint.t += dt; if (hint.t > 3) hint = null; }
}

// 판을 벗어나 도로를 지나가면 흐려지며 사라진다
function exitAlpha(car, m) {
  const fadeFrom = m.pathLen + car.len * 0.5 + ROAD / cell * 0.5;
  return Math.max(0, Math.min(1, 1 - (m.off - fadeFrom) / 1.2));
}

// ---------- 그리기 ----------
function label(text, x, y, size, fill = '#fff', align = 'center') {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.2); ctx.strokeStyle = INK; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
function panel(x, y, w, h, r, fill, lift = 4) {
  ctx.fillStyle = INK; roundRect(ctx, x, y + lift, w, h, r); ctx.fill();
  ctx.fillStyle = fill; roundRect(ctx, x, y, w, h, r); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = INK; roundRect(ctx, x, y, w, h, r); ctx.stroke();
}

// 주차장 바닥의 자잘한 아스팔트 알갱이: 한 번만 만들어 두고 무늬로 깐다
let asphalt = null;
function asphaltPattern() {
  if (asphalt) return asphalt;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#5b6079'; g.fillRect(0, 0, 96, 96);
  for (let k = 0; k < 260; k++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.06)' : 'rgba(20,16,50,.10)';
    g.fillRect(Math.random() * 96, Math.random() * 96, 1.5, 1.5);
  }
  asphalt = ctx.createPattern(c, 'repeat');
  return asphalt;
}

function drawLot() {
  // 도로 (바깥 테두리 + 흰 점선 차선)
  panel(LOT_X, LOT_Y, LOT_W, LOT_W, 30, '#3d4157', 6);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2.5; ctx.setLineDash([10, 9]);
  roundRect(ctx, LOT_X + ROAD / 2 + 1, LOT_Y + ROAD / 2 + 1, LOT_W - ROAD - 2, LOT_W - ROAD - 2, 20); ctx.stroke();
  ctx.restore();
  // 연석 + 주차장 바닥
  ctx.fillStyle = '#d9dbe8'; roundRect(ctx, GX - 4, GY - 4, GRID + 8, GRID + 8, 11); ctx.fill();
  ctx.fillStyle = asphaltPattern(); roundRect(ctx, GX, GY, GRID, GRID, 8); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = INK; roundRect(ctx, GX - 4, GY - 4, GRID + 8, GRID + 8, 11); ctx.stroke();
}

function drawCone(x, y) {
  const cx = GX + (x + 0.5) * cell, cy = GY + (y + 0.5) * cell, s = cell * 0.34;
  ctx.fillStyle = 'rgba(43,29,82,.35)'; ctx.beginPath(); ctx.ellipse(cx, cy + s + 3, s * 0.9, s * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff7a2f'; ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  roundRect(ctx, cx - s, cy + s * 0.55, s * 2, s * 0.45, 3); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s * 0.62, cy + s * 0.6); ctx.lineTo(cx - s * 0.62, cy + s * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillRect(cx - s * 0.36, cy - s * 0.05, s * 0.72, s * 0.22);
}

function carCenter(car, off) {
  const [dx, dy] = L.DIRS[car.dir];
  const k = (car.len - 1) / 2 - off;
  return { x: GX + (car.x + 0.5 - dx * k) * cell, y: GY + (car.y + 0.5 - dy * k) * cell };
}

// 차 몸통: 앞(위쪽) 모서리는 둥글게, 뒤는 조금 덜 둥글게
function bodyPath(x0, y0, w, h, rf, rr) {
  ctx.beginPath();
  ctx.moveTo(x0 + rf, y0);
  ctx.lineTo(x0 + w - rf, y0);
  ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + rf);
  ctx.lineTo(x0 + w, y0 + h - rr);
  ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - rr, y0 + h);
  ctx.lineTo(x0 + rr, y0 + h);
  ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - rr);
  ctx.lineTo(x0, y0 + rf);
  ctx.quadraticCurveTo(x0, y0, x0 + rf, y0);
  ctx.closePath();
}
// 앞뒤 너비가 다른 유리창 (사다리꼴)
function glass(yTop, yBot, wTop, wBot) {
  const g = ctx.createLinearGradient(0, yTop, 0, yBot);
  g.addColorStop(0, '#8fc4f0'); g.addColorStop(1, '#3d5f9e');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-wTop / 2, yTop); ctx.lineTo(wTop / 2, yTop); ctx.lineTo(wBot / 2, yBot); ctx.lineTo(-wBot / 2, yBot);
  ctx.closePath(); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
  // 반사광 한 줄
  ctx.save(); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(-wBot * 0.25, yBot + 2); ctx.lineTo(-wTop * 0.05, yTop - 2); ctx.stroke();
  ctx.restore();
}
function wheels(w, ys, tw, tl) {
  ctx.fillStyle = '#23193f';
  for (const y of ys) for (const sx of [-1, 1]) { roundRect(ctx, sx * (w / 2 + 1.5) - tw / 2, y - tl / 2, tw, tl, 2.5); ctx.fill(); }
}
// 지붕에 같은 계열 색으로 옅게 그린 진행 방향 표시
function roofArrow(y, s, col) {
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(2.5, s * 0.5); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-s, y + s * 0.45); ctx.lineTo(0, y - s * 0.45); ctx.lineTo(s, y + s * 0.45); ctx.stroke();
  ctx.lineCap = 'butt';
}
function paint(col, w) {
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, shade(col, 38)); g.addColorStop(0.45, col); g.addColorStop(1, shade(col, -30));
  return g;
}

// 차를 위에서 본 모습. 제자리에서 위(북쪽)를 보게 그리고 방향만큼 돌린다
function drawCar(i) {
  const car = board.cars[i], m = moving.get(i);
  if (car.out && !m) return;
  const off = m ? m.off : 0;
  const alpha = m && m.kind === 'exit' ? exitAlpha(car, m) : 1;
  const c = carCenter(car, off);
  const sh = shakes.get(i) || 0;
  const jx = sh ? Math.sin(clock * 90) * sh * 8 : 0, jy = sh ? Math.cos(clock * 70) * sh * 5 : 0;
  const mx = cell * CAR_MX, my = cell * CAR_MY;
  const w = cell - mx * 2, h = car.len * cell - my * 2;
  const col = CAR_COLORS[car.color], top = -h / 2, bot = h / 2;
  const rf = w * 0.4, rr = w * 0.28;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(c.x + jx, c.y + jy);
  // 그림자는 화면 기준 아래로
  ctx.save(); ctx.translate(0, 4); ctx.rotate(ANG[car.dir]);
  ctx.fillStyle = 'rgba(30,20,60,.45)'; bodyPath(-w / 2 - 1, top, w + 2, h, rf, rr); ctx.fill();
  ctx.restore();
  ctx.rotate(ANG[car.dir]);

  if (hint && hint.i === i && Math.sin(hint.t * 9) > -0.3) {
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 5;
    bodyPath(-w / 2 - 6, top - 6, w + 12, h + 12, rf + 6, rr + 6); ctx.stroke();
  }

  const tw = Math.max(3, w * 0.13), tl = Math.max(7, cell * 0.24);
  if (car.len >= 3) {
    // 트럭: 앞은 운전석, 뒤는 골이 진 짐칸
    const cabH = cell * 0.9;
    wheels(w, [top + cabH * 0.42, bot - cell * 0.95, bot - cell * 0.4], tw, tl);
    const bx = -w / 2, by = top + cabH + 1.5, bh = bot - by;
    ctx.fillStyle = shade(col, -28); roundRect(ctx, bx, by, w, bh, 5); ctx.fill();
    ctx.fillStyle = shade(col, 22); roundRect(ctx, bx + 3, by + 3, w - 6, bh - 6, 3); ctx.fill();
    ctx.strokeStyle = shade(col, -12); ctx.lineWidth = 1.5; ctx.beginPath();
    for (let y = by + 9; y < by + bh - 6; y += 7) { ctx.moveTo(bx + 5, y); ctx.lineTo(bx + w - 5, y); }
    ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = INK; roundRect(ctx, bx, by, w, bh, 5); ctx.stroke();
    ctx.fillStyle = paint(col, w); bodyPath(-w / 2, top, w, cabH, rf, 5); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
    glass(top + cabH * 0.36, top + cabH * 0.62, w * 0.62, w * 0.8);
    ctx.fillStyle = shade(col, 45); roundRect(ctx, -w * 0.38, top + cabH * 0.66, w * 0.76, cabH * 0.26, 3); ctx.fill();
    roofArrow(by + bh / 2, w * 0.15, shade(col, -40));
  } else {
    wheels(w, [top + h * 0.22, bot - h * 0.2], tw, tl);
    ctx.fillStyle = paint(col, w); bodyPath(-w / 2, top, w, h, rf, rr); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
    // 보닛 가운데 주름
    ctx.strokeStyle = shade(col, -22); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, top + 5); ctx.lineTo(0, top + h * 0.22); ctx.stroke();
    // 사이드미러
    ctx.fillStyle = col; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx * (w / 2 + 1), top + h * 0.3, 3, 2.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    const wsT = top + h * 0.28, wsB = top + h * 0.39, rwT = bot - h * 0.27, rwB = bot - h * 0.19;
    ctx.fillStyle = shade(col, 30); roundRect(ctx, -w * 0.39, wsB, w * 0.78, rwT - wsB, 4); ctx.fill();
    glass(wsT, wsB, w * 0.56, w * 0.74);
    glass(rwT, rwB, w * 0.72, w * 0.56);
    roofArrow((wsB + rwT) / 2, w * 0.15, shade(col, -30));
  }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (!board) return;
  label(`레벨 ${level}`, 14, 30, 28, '#ffd23f', 'left');
  label(`남은 차 ${L.remaining(board)}`, W - 14, 30, 20, '#fff', 'right');
  // 지금 이대로 끝내면 받을 별 + 부딪힌 횟수
  panel(W / 2 - 92, 58, 184, 34, 17, '#fff', 4);
  const st = starsFor(crashes);
  for (let k = 0; k < 3; k++) label('★', W / 2 - 62 + k * 28, 76, 26, k < st ? '#ffd23f' : '#d9d3ea');
  ctx.font = `15px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = crashes ? '#ff5fa2' : '#6b5c95';
  ctx.fillText(crashes ? `쾅 ${crashes}번` : '무사고', W / 2 + 50, 76);

  drawLot();
  for (const [x, y] of board.cones) drawCone(x, y);
  // 가만히 있는 차 → 부딪히는 차 → 빠져나가는 차 순서로 (움직이는 차가 위에 보이게)
  board.cars.forEach((c, i) => { if (!moving.has(i)) drawCar(i); });
  for (const [i, m] of moving) if (m.kind === 'bump') drawCar(i);
  for (const [i, m] of moving) if (m.kind === 'exit') drawCar(i);

  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 3);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(p.x, p.y + 1, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const f of floaters) {
    ctx.globalAlpha = Math.min(1, (0.8 - f.t) * 4);
    label(f.text, f.x, f.y, 24 + Math.max(0, 0.15 - f.t) * 60, '#ff5fa2');
  }
  ctx.globalAlpha = 1;

  // 아래 버튼 줄
  const labels = { restart: '🔄 다시', hint: `💡 힌트 ${hintsLeft}` };
  const enabled = { restart: true, hint: hintsLeft > 0 };
  for (const b of BTN) {
    const on = enabled[b.id] && state === 'play';
    panel(b.x, BTN_Y, b.w, BTN_H, 26, on ? '#ffd23f' : '#d9d3ea', 5);
    ctx.globalAlpha = on ? 1 : 0.55;
    label(labels[b.id], b.x + b.w / 2, BTN_Y + BTN_H / 2 + 1, 22, on ? '#fff' : '#b5acd0');
    ctx.globalAlpha = 1;
  }

  if (banner && state === 'play') {
    const s = 1 + Math.max(0, 0.25 - banner.t) * 1.6;
    ctx.save(); ctx.globalAlpha = Math.min(1, (1.3 - banner.t) * 3);
    ctx.translate(W / 2, LOT_Y + LOT_W / 2); ctx.scale(s, s);
    label(banner.text, 0, 0, 44, '#ffd23f');
    ctx.restore();
  }
}

function updateHud() {
  $('level').textContent = String(level);
  $('best').textContent = String(best);
}

// ---------- 루프 ----------
let last = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  if (state !== 'paused') update(dt);
  draw();
  requestAnimationFrame(frame);
}

// ---------- 오버레이 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

function showMenu() {
  state = 'menu';
  showOverlay(`
    <h1>주차장 <span class="p">탈출</span></h1>
    <p>차를 누르면 <b>앞으로</b> 달려 나가요<br>순서를 잘 생각해서 차를 모두 빼내요!</p>
    <button data-act="play">${level > 1 ? `레벨 ${level} 이어서` : '시작하기'}</button>
    ${level > 1 ? '<button class="sub" data-act="reset">처음부터</button>' : ''}
    <div class="card">
      👆 차를 누르면 출발! 앞유리·화살표 쪽이 앞이에요<br>
      💥 앞이 막혀 있으면 쾅! 안 부딪히면 ⭐ 3개<br>
      🚚 트럭은 3칸, 🚧 고깔은 장애물<br>
      💡 어떤 차부터 뺄지 모르겠으면 힌트! 한 판에 ${HINTS}번
    </div>`);
}

$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'play') newLevel(level);
  else if (act === 'reset') { level = 1; store.set(SAVE_KEY, '1'); newLevel(1); }
  else if (act === 'next') newLevel(level + 1);
  else if (act === 'menu') { level = Math.max(1, Number(store.get(SAVE_KEY)) || 1); showMenu(); }
  else if (act === 'continue') resume();
});
function pause() {
  if (state !== 'play') return;
  state = 'paused';
  showOverlay(`<h2 class="inked">일시정지</h2><button data-act="continue">계속하기</button>
    <button class="sub" data-act="menu">← 그만하기</button>`);
}
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); }

// ---------- 입력 ----------
// 누르는 순간 바로 반응한다 (떼기를 기다리지 않아서 아이폰에서 탭이 씹히지 않는다)
function toLogical(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
}
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  const p = toLogical(e);
  if (p.y >= BTN_Y - 4) {
    const b = BTN.find((x) => p.x >= x.x - 4 && p.x <= x.x + x.w + 4);
    if (!b) return;
    if (b.id === 'restart') newLevel(level, true);
    else useHint();
    return;
  }
  const cx = Math.floor((p.x - GX) / cell), cy = Math.floor((p.y - GY) / cell);
  if (cx < 0 || cy < 0 || cx >= board.n || cy >= board.n) return;
  const v = L.occupancy(board)[cy * board.n + cx];
  if (v >= 0) tapCar(v);
});
canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { state === 'paused' ? resume() : pause(); return; }
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  if (state !== 'play') return;
  if (e.key === 'h' || e.key === 'H') useHint();
  else if (e.key === 'r' || e.key === 'R') newLevel(level, true);
});
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('parkingMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// 첫 화면 뒤에 흐릿하게 보일 주차장
start = L.generate(level, Math.random, CAR_COLORS.length); board = L.cloneBoard(start); cell = GRID / board.n;
updateHud();
showMenu();
fit();
requestAnimationFrame(frame);

// 테스트용
window.__pk = { get state() { return state; }, get board() { return board; }, get level() { return level; }, get crashes() { return crashes; },
  get hint() { return hint; }, get hintsLeft() { return hintsLeft; }, get moving() { return moving; },
  tapCar, useHint, newLevel, showMenu, GX, GY, get cell() { return cell; } };
})();
