import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burntFraction, remainingMs, clampMinutes, formatRemaining } from '../js/incense.js';
import { daysUntil } from '../js/lunar.js';

const offering = { ts: 0, minutes: 30 };

test('香依真實時間變短，燒完就停在 1', () => {
  assert.equal(burntFraction(offering, 0), 0);
  assert.equal(burntFraction(offering, 15 * 60000), 0.5);
  assert.equal(burntFraction(offering, 99 * 60000), 1);
  assert.equal(remainingMs(offering, 99 * 60000), 0);
});

test('手機時間被調早時不會出現負數', () => {
  assert.equal(burntFraction({ ts: 5000, minutes: 1 }, 0), 0);
});

test('自訂分鐘數會限制在合理範圍', () => {
  assert.equal(clampMinutes('0'), 1);
  assert.equal(clampMinutes('9999'), 240);
  assert.equal(clampMinutes('45'), 45);
  assert.equal(clampMinutes('abc'), 30);
});

test('剩餘時間的顯示', () => {
  assert.equal(formatRemaining(90000), '1 分 30 秒');
  assert.equal(formatRemaining(5000), '5 秒');
  assert.equal(formatRemaining(3720000), '1 小時 2 分');
});

test('農曆正月初一對到 2027 年春節（2 月 6 日）', () => {
  const from = new Date('2027-02-01T04:00:00Z');
  assert.equal(daysUntil({ calendar: 'lunar', month: 1, day: 1 }, from), 5);
});

test('國曆忌日當天是 0 天', () => {
  const from = new Date('2026-11-03T04:00:00Z');
  assert.equal(daysUntil({ calendar: 'solar', month: 11, day: 3 }, from), 0);
});

test('今年不存在的日期會退一天，不會找不到', () => {
  const from = new Date('2026-03-01T04:00:00Z');
  assert.notEqual(daysUntil({ calendar: 'lunar', month: 2, day: 30 }, from), null);
  assert.notEqual(daysUntil({ calendar: 'solar', month: 2, day: 29 }, from), null);
});

test('農曆對照已知節日：春節、端午、中秋', () => {
  const at = (s) => new Date(`${s}T04:00:00Z`);
  assert.equal(daysUntil({ calendar: 'lunar', month: 1, day: 1 }, at('2026-02-17')), 0);
  assert.equal(daysUntil({ calendar: 'lunar', month: 1, day: 1 }, at('2028-01-26')), 0);
  assert.equal(daysUntil({ calendar: 'lunar', month: 5, day: 5 }, at('2026-06-19')), 0);
  assert.equal(daysUntil({ calendar: 'lunar', month: 8, day: 15 }, at('2026-09-25')), 0);
});
