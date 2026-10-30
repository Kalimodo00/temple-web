// 忌日提醒。
import { LUNAR_MONTHS } from './lunar-table.js';

const DAY_MS = 86400000;
const taiwanDate = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Taipei',
});

function dayNumber(date) {
  const p = Object.fromEntries(taiwanDate.formatToParts(date).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day) / DAY_MS;
}

function lunarOf(day) {
  let found = null;
  for (const m of LUNAR_MONTHS) {
    if (m.day > day) break;
    found = m;
  }
  return found && { month: found.month, day: day - found.day + 1 };
}

function solarOf(day) {
  const d = new Date(day * DAY_MS);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function findWithin(calendar, month, day, today) {
  const convert = calendar === 'lunar' ? lunarOf : solarOf;
  for (let i = 0; i <= 400; i++) {
    const d = convert(today + i);
    if (d && d.month === month && d.day === day) return i; // 閏月的月份是負數，不會比對到
  }
  return null;
}

// 回傳距離下一次該日期還有幾天，今天就是 0。
export function daysUntil({ calendar, month, day }, from = new Date()) {
  const today = dayNumber(from);
  // 農曆三十或國曆 2/29 當年可能不存在，退一天
  return findWithin(calendar, month, day, today) ?? findWithin(calendar, month, day - 1, today);
}

export function formatDate({ calendar, month, day }) {
  return `${calendar === 'lunar' ? '農曆' : '國曆'} ${month} 月 ${day} 日`;
}
