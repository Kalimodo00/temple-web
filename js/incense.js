// 香的規格與燃燒計算。一律由點香時間推算，關掉網頁再回來也會是正確長度。
export const SIZES = {
  s: { label: '細香', minutes: 15, width: 1.8, length: 0.44, smoke: 0.6 },
  m: { label: '標準香', minutes: 30, width: 2.6, length: 0.5, smoke: 1 },
  l: { label: '粗香', minutes: 60, width: 4.4, length: 0.56, smoke: 1.5 },
};

export const MINUTE_CHOICES = [5, 15, 30, 60];
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 240;
export const MAX_OFFERINGS = 6;

export function clampMinutes(value) {
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes)) return SIZES.m.minutes;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes));
}

export function burntFraction(offering, now) {
  const elapsed = now - offering.ts;
  return Math.min(1, Math.max(0, elapsed / (offering.minutes * 60000)));
}

export function remainingMs(offering, now) {
  return Math.max(0, offering.ts + offering.minutes * 60000 - now);
}

export function formatRemaining(ms) {
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours} 小時 ${minutes} 分`;
  return minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}
