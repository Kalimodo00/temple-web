// 手機動作偵測。偵測器都是純函式，方便用錄好的數值測試（tests/sensors.test.js）。

// 鞠躬：手機前傾超過 down 度，再回到 up 度以內，算一拜。
export function createBowDetector({ down = 25, up = 10, minMs = 450, onBow }) {
  let base = null;
  let bowing = false;
  let startedAt = 0;
  return {
    feed(beta, t) {
      if (base === null) base = beta;
      const delta = Math.abs(beta - base);
      if (!bowing) {
        if (delta > down) {
          bowing = true;
          startedAt = t;
        } else {
          base += (beta - base) * 0.01; // 手勢慢慢改變時跟著校正
        }
      } else if (delta < up) {
        bowing = false;
        if (t - startedAt >= minMs) onBow();
      }
    },
  };
}

// 擲筊：手機往上一拋的單次加速度尖峰。
export function createFlickDetector({ threshold = 13, cooldownMs = 1500, onFlick }) {
  let lastAt = -Infinity;
  return {
    feed(magnitude, t) {
      if (Math.abs(magnitude - 9.81) > threshold && t - lastAt > cooldownMs) {
        lastAt = t;
        onFlick();
      }
    },
  };
}

// 搖籤：持續搖動才會累積進度，停手會慢慢退回。用變化率計算，與感測器取樣頻率無關。
export function createShakeMeter({ jerkThreshold = 60, fillPerSec = 0.45, decayPerSec = 0.15, onProgress, onDone }) {
  let last = null;
  let lastT = 0;
  let value = 0;
  let done = false;
  return {
    feed(x, y, z, t) {
      if (done) return;
      if (last) {
        const dt = (t - lastT) / 1000;
        if (dt <= 0) return;
        const jerk = Math.hypot(x - last[0], y - last[1], z - last[2]) / dt;
        value += (jerk > jerkThreshold ? fillPerSec : -decayPerSec) * dt;
        value = Math.max(0, value);
        if (value >= 1) {
          done = true;
          value = 1;
          onProgress?.(1);
          onDone();
          return;
        }
        onProgress?.(value);
      }
      last = [x, y, z];
      lastT = t;
    },
    reset() {
      last = null;
      value = 0;
      done = false;
    },
  };
}

// iOS 必須在使用者點擊時要求授權；Android 只要 HTTPS。
export async function requestMotionPermission() {
  const requests = [window.DeviceMotionEvent, window.DeviceOrientationEvent]
    .filter((api) => typeof api?.requestPermission === 'function')
    .map((api) => api.requestPermission().catch(() => 'denied'));
  const results = await Promise.all(requests);
  return results.every((r) => r === 'granted');
}

export function listenMotion({ onOrientation, onMotion }) {
  window.addEventListener('deviceorientation', (e) => {
    if (e.beta !== null) onOrientation(e.beta, e.gamma ?? 0, e.timeStamp);
  });
  window.addEventListener('devicemotion', (e) => {
    const a = e.accelerationIncludingGravity;
    if (a && a.x !== null) onMotion(a.x, a.y, a.z, e.timeStamp);
  });
}
