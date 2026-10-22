'use strict';
// 주차장 탈출 규칙 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

function rng(seed) {                                   // mulberry32 (시험용 고정 난수)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 빠질 수 있는 차를 아무거나 골라 빼기를 되풀이한다. 다 빠지면 true
function clearAll(board, rand) {
  const b = L.cloneBoard(board);
  for (let guard = 0; guard < 200 && !L.solved(b); guard++) {
    const free = L.freeCars(b);
    if (!free.length) return false;
    b.cars[free[Math.floor(rand() * free.length)]].out = true;
  }
  return L.solved(b);
}

test('car cells and the road ahead', () => {
  const car = { x: 3, y: 2, len: 2, dir: 'E' };          // 앞범퍼 (3,2), 뒤 (2,2)
  assert.deepStrictEqual(L.cellsOf(car), [[3, 2], [2, 2]]);
  assert.deepStrictEqual(L.pathOf(car, 5), [[4, 2]]);
  const truck = { x: 1, y: 0, len: 3, dir: 'N' };        // 맨 위 줄에서 위를 본다: 바로 빠진다
  assert.deepStrictEqual(L.cellsOf(truck), [[1, 0], [1, 1], [1, 2]]);
  assert.deepStrictEqual(L.pathOf(truck, 5), []);
});

test('a blocked car reports what blocks it and how far it can roll', () => {
  const board = { n: 5, cones: [[4, 0]], cars: [
    { x: 1, y: 0, len: 2, dir: 'E' },                    // 오른쪽으로 2칸 가면 고깔
    { x: 2, y: 4, len: 2, dir: 'N' },                    // 위로: (2,3) 는 비었고 (2,2) 에 차
    { x: 2, y: 2, len: 2, dir: 'W' },                    // (2,2),(3,2) 왼쪽 보기
  ] };
  assert.deepStrictEqual(L.firstBlock(board, 0), { i: -2, dist: 2 });
  assert.deepStrictEqual(L.firstBlock(board, 1), { i: 2, dist: 1 });
  assert.strictEqual(L.firstBlock(board, 2), null);
  assert.deepStrictEqual(L.freeCars(board), [2]);
  assert.strictEqual(L.depthOf(board), Infinity, 'a car facing a cone can never leave');
  board.cones = [];
  assert.strictEqual(L.depthOf(board), 2);
});

test('every generated level fits the board, has no overlaps and can be fully cleared in any order', () => {
  for (let level = 1; level <= 40; level += 3) {
    const spec = L.levelSpec(level);
    for (let s = 1; s <= 4; s++) {
      const b = L.generate(level, rng(level * 100 + s));
      assert.strictEqual(b.n, spec.size);
      assert.strictEqual(b.cones.length, spec.cones);
      const seen = new Set();
      for (const [x, y] of b.cones) seen.add(`${x},${y}`);
      for (const c of b.cars) {
        assert.ok(!c.out);
        assert.ok(c.len === 2 || c.len === 3);
        if (level < 3) assert.strictEqual(c.len, 2, 'no trucks before level 3');
        for (const [x, y] of L.cellsOf(c)) {
          assert.ok(x >= 0 && y >= 0 && x < b.n && y < b.n, 'inside the lot');
          assert.ok(!seen.has(`${x},${y}`), 'no overlap');
          seen.add(`${x},${y}`);
        }
        assert.ok(Number.isInteger(c.color) && c.color >= 0 && c.color < 8);
      }
      assert.ok(Number.isFinite(L.depthOf(b)), `level ${level} seed ${s} is solvable`);
      // 빠지기만 하니 어떤 순서로 빼도 막히지 않는다
      for (let k = 0; k < 3; k++) assert.ok(clearAll(b, rng(k + 1)), `level ${level} seed ${s} order ${k}`);
      assert.ok(b.cars.reduce((t, c) => t + c.len, 0) >= b.n * b.n * 0.6, 'the lot is mostly full');
    }
  }
});

test('later levels are bigger and more tangled', () => {
  const depth = (level) => { let d = 0; for (let s = 1; s <= 6; s++) d += L.depthOf(L.generate(level, rng(s))); return d / 6; };
  assert.ok(depth(20) > depth(1), `${depth(20)} > ${depth(1)}`);
  assert.strictEqual(L.levelSpec(1).size, 5);
  assert.strictEqual(L.levelSpec(100).size, L.MAX_N);
});

test('neighbouring cars get different colours when there are enough colours', () => {
  let pairs = 0, same = 0;
  for (let s = 1; s <= 10; s++) {
    const b = L.generate(10, rng(s));
    const occ = L.occupancy(b);
    for (let i = 0; i < b.cars.length; i++) for (const [x, y] of L.cellsOf(b.cars[i])) {
      for (const [dx, dy] of Object.values(L.DIRS)) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= b.n || ny >= b.n) continue;
        const j = occ[ny * b.n + nx];
        if (j > i) { pairs++; if (b.cars[j].color === b.cars[i].color) same++; }
      }
    }
  }
  assert.ok(pairs > 100);
  assert.strictEqual(same, 0);
});
