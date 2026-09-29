'use strict';

// 주차장 탈출: 규칙만 모아 둔 파일 (그리기·입력 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// 판은 n×n 칸. 차는 { x, y, len, dir } — (x, y) 는 앞범퍼가 있는 칸, dir 은 차가 보는 쪽.
// 차를 누르면 앞으로만 달린다. 앞길(앞 칸 ~ 판 끝)이 비어 있으면 빠져나가고, 막혀 있으면 부딪힌다.
// 차가 모두 빠져나가면 끝. 빠져나가기만 하니 한 번 풀 수 있는 판은 어떤 순서로 빼도 막히지 않는다.
const DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const MAX_N = 8;

// 차가 차지한 칸들 (앞 → 뒤)
function cellsOf(car) {
  const [dx, dy] = DIRS[car.dir];
  const out = [];
  for (let k = 0; k < car.len; k++) out.push([car.x - dx * k, car.y - dy * k]);
  return out;
}

// 앞 칸부터 판 끝까지
function pathOf(car, n) {
  const [dx, dy] = DIRS[car.dir];
  const out = [];
  for (let x = car.x + dx, y = car.y + dy; x >= 0 && y >= 0 && x < n && y < n; x += dx, y += dy) out.push([x, y]);
  return out;
}

// 칸 → 차 번호 (-1 빈칸, -2 고깔). 빠져나간 차는 없는 셈
function occupancy(board) {
  const { n } = board;
  const occ = new Array(n * n).fill(-1);
  for (const [x, y] of board.cones) occ[y * n + x] = -2;
  board.cars.forEach((c, i) => { if (!c.out) for (const [x, y] of cellsOf(c)) occ[y * n + x] = i; });
  return occ;
}

// 앞길을 처음 막는 것 { i, dist } (i: 차 번호, -2 고깔 / dist: 부딪히기 전까지 갈 수 있는 칸 수). 비었으면 null
function firstBlock(board, i, occ = occupancy(board)) {
  const path = pathOf(board.cars[i], board.n);
  for (let k = 0; k < path.length; k++) {
    const v = occ[path[k][1] * board.n + path[k][0]];
    if (v !== -1) return { i: v, dist: k };
  }
  return null;
}
const canExit = (board, i, occ) => !board.cars[i].out && firstBlock(board, i, occ) === null;
const freeCars = (board) => {
  const occ = occupancy(board);
  return board.cars.map((_, i) => i).filter((i) => canExit(board, i, occ));
};
const remaining = (board) => board.cars.filter((c) => !c.out).length;
const solved = (board) => remaining(board) === 0;

// 가장 긴 "이 차가 빠지려면 저 차가 먼저" 사슬 = 판이 얼마나 얽혔는지. 못 푸는 판이면 Infinity
function depthOf(board) {
  const occ = occupancy(board), n = board.n;
  const memo = new Map(), visiting = new Set();
  const d = (i) => {
    if (memo.has(i)) return memo.get(i);
    if (visiting.has(i)) return Infinity;              // 서로 막고 있다
    visiting.add(i);
    let m = 0;
    for (const [x, y] of pathOf(board.cars[i], n)) {
      const v = occ[y * n + x];
      if (v === -2) m = Infinity;                      // 고깔은 안 비켜 준다
      else if (v >= 0) m = Math.max(m, d(v));
    }
    visiting.delete(i);
    memo.set(i, m + 1);
    return m + 1;
  };
  let best = 0;
  board.cars.forEach((c, i) => { if (!c.out) best = Math.max(best, d(i)); });
  return best;
}

// ---------- 레벨 ----------
// 4레벨마다 한 칸씩 넓어지고(5×5 → 8×8), 3레벨부터 트럭(3칸), 6레벨부터 고깔이 나온다
function levelSpec(n) {
  const size = Math.min(MAX_N, 5 + Math.floor((n - 1) / 4));
  return {
    size,
    trucks: n >= 3 ? Math.min(0.3, 0.1 + n * 0.01) : 0,
    cones: n >= 6 ? Math.min(3, 1 + Math.floor((n - 6) / 6)) : 0,
    depth: Math.min(3 + Math.floor((n - 1) / 3), size + 3),   // 노리는 사슬 길이
    free: Math.max(0.25, 0.6 - n * 0.02),                     // 처음부터 바로 빠질 수 있는 차 비율 목표 (이하)
  };
}

const DIR_KEYS = Object.keys(DIRS);
const inside = (n, x, y) => x >= 0 && y >= 0 && x < n && y < n;

// 서로 막고 있는 차들(순환)을 하나 찾는다. 앞길에 고깔이 있는 차는 그 차 하나만으로 순환 취급. 없으면 null
function findCycle(board) {
  const occ = occupancy(board), n = board.n;
  const color = new Map(), stack = [];
  const visit = (i) => {
    color.set(i, 1); stack.push(i);
    for (const [x, y] of pathOf(board.cars[i], n)) {
      const v = occ[y * n + x];
      if (v === -2) return [i];
      if (v < 0) continue;
      if (color.get(v) === 1) return stack.slice(stack.indexOf(v));
      if (!color.has(v)) { const c = visit(v); if (c) return c; }
    }
    color.set(i, 2); stack.pop();
    return null;
  };
  for (let i = 0; i < board.cars.length; i++) {
    if (board.cars[i].out || color.has(i)) continue;
    const c = visit(i);
    if (c) return c;
  }
  return null;
}

// 반대쪽을 보게 돌린다 (차지한 칸은 그대로, 앞범퍼 칸만 반대 끝으로)
const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
function flip(car) {
  const [dx, dy] = DIRS[car.dir];
  car.x -= dx * (car.len - 1); car.y -= dy * (car.len - 1);
  car.dir = OPP[car.dir];
}

// 1) 주차장을 차·트럭으로 빽빽하게 채우고 방향은 아무렇게나 정한다
// 2) 서로 막는 순환이 남아 있으면 그 안의 차 하나를 돌리거나(대부분) 빼서 끊는다
// 순환이 없으면 "앞길이 빈 차부터 빼기"를 되풀이해 반드시 다 뺄 수 있다
function tryBoard(spec, rng) {
  const n = spec.size;
  const board = { n, cars: [], cones: [] };
  const occ = new Array(n * n).fill(-1);
  while (board.cones.length < spec.cones) {
    const x = 1 + Math.floor(rng() * (n - 2)), y = 1 + Math.floor(rng() * (n - 2));
    if (occ[y * n + x] !== -1) continue;
    occ[y * n + x] = -2;
    board.cones.push([x, y]);
  }
  const order = [];
  for (let k = 0; k < n * n; k++) order.push(k);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const k of order) {
    if (occ[k] !== -1) continue;
    const x = k % n, y = Math.floor(k / n);
    const lens = rng() < spec.trucks ? [3, 2] : [2];
    const axes = rng() < 0.5 ? ['E', 'S'] : ['S', 'E'];
    placed: for (const len of lens) {
      for (const dir of axes) {
        // 이 칸이 차의 어느 부분이 될지도 섞어서 시도 (늘 뒤꽁무니만 되면 한쪽으로 쏠린다)
        const shifts = [...Array(len).keys()].sort(() => rng() - 0.5);
        for (const sh of shifts) {
          const [dx, dy] = DIRS[dir];
          const car = { x: x + dx * sh, y: y + dy * sh, len, dir };
          const cells = cellsOf(car);
          if (cells.some(([cx, cy]) => !inside(n, cx, cy) || occ[cy * n + cx] !== -1)) continue;
          if (rng() < 0.5) flip(car);
          for (const [cx, cy] of cells) occ[cy * n + cx] = board.cars.length;
          board.cars.push(car);
          break placed;
        }
      }
    }
  }
  for (let guard = 0; guard < 400; guard++) {
    const cyc = findCycle(board);
    if (!cyc) break;
    const i = cyc[Math.floor(rng() * cyc.length)];
    if (rng() < 0.85) flip(board.cars[i]);
    else board.cars[i].out = true;
  }
  if (findCycle(board)) return null;
  board.cars = board.cars.filter((c) => !c.out);
  return board;
}

// 여러 판을 만들어 보고, 빽빽하고 · 노리는 얽힘에 가깝고 · 처음부터 풀려 있는 차가 적은 판을 고른다
function generate(level, rng = Math.random, colors = 8) {
  const spec = levelSpec(level);
  let best = null, bestScore = -Infinity;
  for (let t = 0; t < 60; t++) {
    const b = tryBoard(spec, rng);
    if (!b) continue;
    const fill = b.cars.reduce((s, c) => s + c.len, 0) / (spec.size * spec.size);
    const free = freeCars(b).length / b.cars.length;
    const score = fill * 6 - Math.abs(depthOf(b) - spec.depth) * 2 - Math.max(0, free - spec.free) * 12;
    if (score > bestScore) { bestScore = score; best = b; }
  }
  // 색을 입힌다: 맞닿은 차끼리는 다른 색, 그중 지금까지 덜 쓴 색 (같은 색이 뭉치거나 한 색만 많아지지 않게)
  const occ = occupancy(best), n = best.n, used = new Array(colors).fill(0);
  best.cars.forEach((c, i) => {
    const near = new Set();
    for (const [x, y] of cellsOf(c)) {
      for (const [dx, dy] of Object.values(DIRS)) {
        const v = inside(n, x + dx, y + dy) ? occ[(y + dy) * n + x + dx] : -1;
        if (v >= 0 && v !== i && best.cars[v].color !== undefined) near.add(best.cars[v].color);
      }
    }
    const all = [...Array(colors).keys()];
    let pool = all.filter((k) => !near.has(k));
    if (!pool.length) pool = all;                      // 색이 적어 이웃과 다 겹치면 그냥 덜 쓴 색
    const low = Math.min(...pool.map((k) => used[k]));
    const pick = pool.filter((k) => used[k] === low);
    c.color = pick[Math.floor(rng() * pick.length)];
    used[c.color]++;
  });
  return best;
}

const cloneBoard = (b) => ({ n: b.n, cones: b.cones.map((c) => c.slice()), cars: b.cars.map((c) => ({ ...c })) });

const LOGIC = { DIRS, MAX_N, cellsOf, pathOf, occupancy, firstBlock, canExit, freeCars, remaining, solved, depthOf, levelSpec, generate, cloneBoard };
if (typeof module !== 'undefined') module.exports = LOGIC;
