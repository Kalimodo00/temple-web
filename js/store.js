// 所有資料只存在這支手機的瀏覽器裡，不會上傳。
import { SIZES, clampMinutes, MAX_OFFERINGS } from './incense.js';

const KEY = 'yizhuxiang-v1';
const MAX_RECORDS = 200;

const defaults = () => ({
  settings: { size: 'm', minutes: SIZES.m.minutes, count: 3, sound: false, keepAwake: false },
  offerings: [],
  records: [],
  saved: [],
  ancestors: [],
});

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw) return defaults();
    const base = defaults();
    const settings = { ...base.settings, ...raw.settings };
    if (!SIZES[settings.size]) settings.size = 'm';
    settings.minutes = clampMinutes(settings.minutes);
    return { ...base, ...raw, settings };
  } catch {
    return defaults(); // 無痕模式或資料損毀時，至少這次還能用
  }
}

export const data = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 寫不進去時只影響下次開啟，不打斷參拜
  }
}

export function addOffering(offering) {
  data.offerings.push(offering);
  data.offerings = data.offerings.slice(-MAX_OFFERINGS);
  save();
}

export function addRecord(record) {
  data.records.unshift({ t: Date.now(), ...record });
  data.records = data.records.slice(0, MAX_RECORDS);
  save();
}
