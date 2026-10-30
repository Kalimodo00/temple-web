import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBowDetector, createFlickDetector, createShakeMeter } from '../js/sensors.js';

test('三次前傾再回正算三拜', () => {
  let bows = 0;
  const d = createBowDetector({ onBow: () => bows++ });
  let t = 0;
  for (let n = 0; n < 3; n++) {
    for (const beta of [60, 45, 30, 25, 40, 55, 60]) d.feed(beta, (t += 150));
  }
  assert.equal(bows, 3);
});

test('手抖不算鞠躬', () => {
  let bows = 0;
  const d = createBowDetector({ onBow: () => bows++ });
  for (let i = 0; i < 200; i++) d.feed(60 + Math.sin(i) * 8, i * 16);
  assert.equal(bows, 0);
});

test('一次甩動只觸發一次擲筊，冷卻後才能再觸發', () => {
  let flicks = 0;
  const d = createFlickDetector({ onFlick: () => flicks++ });
  [9.8, 30, 32, 28, 9.8].forEach((m, i) => d.feed(m, i * 20));
  assert.equal(flicks, 1);
  d.feed(30, 3000);
  assert.equal(flicks, 2);
});

test('靜止握著不會累積搖籤進度', () => {
  let done = false;
  const s = createShakeMeter({ onDone: () => { done = true; } });
  for (let i = 0; i < 600; i++) s.feed(0.05 * Math.sin(i), 0, 9.8, i * 16);
  assert.equal(done, false);
});

test('持續用力搖約 2.2 秒會跳籤，且與取樣頻率無關', () => {
  for (const hz of [30, 60, 100]) {
    const stepMs = 1000 / hz;
    let doneAt = null;
    const s = createShakeMeter({ onDone: () => { doneAt = doneAt ?? 0; } });
    let t = 0;
    while (doneAt === null && t < 5000) {
      t += stepMs;
      s.feed(15 * Math.sin((t / 1000) * 2 * Math.PI * 4), 0, 9.8, t);
      if (doneAt === 0) doneAt = t;
    }
    assert.ok(doneAt > 1800 && doneAt < 3200, `${hz}Hz 花了 ${doneAt}ms`);
  }
});
