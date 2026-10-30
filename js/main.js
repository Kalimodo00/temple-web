import { createSmoke } from './smoke.js';
import { FORTUNES } from './fortunes.js';
import { SCENES, TOSS } from './content.js';
import { data, save, addOffering, addRecord } from './store.js';
import {
  SIZES, MINUTE_CHOICES, clampMinutes, burntFraction, remainingMs, formatRemaining,
} from './incense.js';
import { daysUntil, formatDate } from './lunar.js';
import { setSound, playBell, playClack, playRattle, buzz } from './audio.js';
import {
  createBowDetector, createFlickDetector, createShakeMeter, requestMotionPermission, listenMotion,
} from './sensors.js';

const $ = (id) => document.getElementById(id);
const BOWS_REQUIRED = 3;
const MAX_EMITTERS = 12;

let scene = 'temple';
let mode = 'incense';
let step = 'idle'; // 目前儀式進行到哪一步，動作偵測只在對應步驟生效
let bowCount = 0;
let manualShake = 0;
let pendingLot = null;
let shownFortune = null;
let forWhom = '';
let smoke;
let sensorsStarted = false;

// ---------- 畫香 ----------
const sticks = $('sticks').getContext('2d');

function drawStick(x0, y0, x1, y1, width, now, seed, emberSize) {
  sticks.strokeStyle = '#9c3a26';
  sticks.lineWidth = width;
  sticks.lineCap = 'round';
  sticks.beginPath();
  sticks.moveTo(x0, y0);
  sticks.lineTo(x1, y1);
  sticks.stroke();

  const pulse = 0.7 + 0.3 * Math.sin(now / 340 + seed);
  const glow = sticks.createRadialGradient(x1, y1, 0, x1, y1, emberSize);
  glow.addColorStop(0, `rgba(255,190,90,${pulse})`);
  glow.addColorStop(0.35, `rgba(255,90,30,${pulse * 0.6})`);
  glow.addColorStop(1, 'rgba(255,60,20,0)');
  sticks.fillStyle = glow;
  sticks.beginPath();
  sticks.arc(x1, y1, emberSize, 0, 7);
  sticks.fill();
}

function prepareCanvas() {
  const canvas = $('sticks');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  sticks.setTransform(dpr, 0, 0, dpr, 0, 0);
  sticks.clearRect(0, 0, w, h);
  return w;
}

// 手機就是香：香從面板一路伸到畫面上方
function drawHeld(w, now, emitters) {
  const { size, count } = data.settings;
  const spec = SIZES[size];
  const baseY = $('panel').getBoundingClientRect().top;
  const tipY = Math.max(110, baseY * 0.2);
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * 34;
    const x0 = w / 2 + offset * 0.8;
    const x1 = w / 2 + offset;
    drawStick(x0, baseY, x1, tipY, spec.width * 3, now, i, 11 + spec.width * 2.4);
    emitters.push({ x: x1, y: tipY - 3, amount: spec.smoke });
  }
}

function drawOfferings(now, emitters) {
  const rect = $('censer').getBoundingClientRect();
  const mouthY = rect.top + rect.height * 0.2;
  const total = data.offerings.length;
  data.offerings.forEach((offering, index) => {
    const spec = SIZES[offering.size] ?? SIZES.m;
    const cx = rect.left + rect.width * (0.5 + (index - (total - 1) / 2) * 0.13);
    // 燒到最後留一小段香腳，跟真的一樣
    const length = rect.width * spec.length * (1 - 0.86 * burntFraction(offering, now));
    for (let i = 0; i < offering.count; i++) {
      const offset = i - (offering.count - 1) / 2;
      const x0 = cx + offset * 7;
      const lean = offset * 0.08;
      const x1 = x0 + Math.sin(lean) * length;
      const y1 = mouthY - Math.cos(lean) * length;
      drawStick(x0, mouthY, x1, y1, spec.width, now, index * 3 + i, 8);
      if (emitters.length < MAX_EMITTERS) emitters.push({ x: x1, y: y1 - 2, amount: spec.smoke });
    }
  });
}

let lastFrame = performance.now();
function frame(t) {
  const dt = Math.min((t - lastFrame) / 1000, 1 / 30);
  lastFrame = t;
  const now = Date.now();
  const w = prepareCanvas();
  const emitters = [];
  if (document.body.dataset.view === 'altar') {
    if (document.body.dataset.step === 'hold') drawHeld(w, now, emitters);
    else drawOfferings(now, emitters);
  }
  smoke.setEmitters(emitters);
  smoke.step(dt);
  requestAnimationFrame(frame);
}

function setupFan() {
  const fan = $('fan');
  let last = null;
  fan.addEventListener('pointerdown', (e) => { last = e; });
  fan.addEventListener('pointerup', () => { last = null; });
  fan.addEventListener('pointercancel', () => { last = null; });
  fan.addEventListener('pointermove', (e) => {
    if (!last) return;
    smoke.push(e.clientX, e.clientY, e.clientX - last.clientX, e.clientY - last.clientY);
    last = e;
  });
}

// ---------- 燃燒狀態 ----------
function toast(text) {
  const line = document.createElement('li');
  line.textContent = text;
  $('toast').prepend(line);
  while ($('toast').children.length > 2) $('toast').lastChild.remove();
  setTimeout(() => line.remove(), 7000);
}

function sweepOfferings() {
  const now = Date.now();
  const before = data.offerings.length;
  data.offerings = data.offerings.filter((o) => remainingMs(o, now) > 0);
  if (data.offerings.length < before) {
    save();
    toast('香已燒完');
    buzz([60, 80, 60]);
    updateWakeLock();
  }
  showBurnStatus();
}

function showBurnStatus() {
  const el = $('burn-status');
  const now = Date.now();
  const longest = Math.max(0, ...data.offerings.map((o) => remainingMs(o, now)));
  el.hidden = !longest || document.body.dataset.step === 'hold' || mode !== 'incense';
  if (longest) el.textContent = `爐中 ${data.offerings.length} 束香，還有 ${formatRemaining(longest)}`;
}

// 螢幕常亮：只在使用者開啟且真的有香在燒時才佔用
let wakeLock = null;
async function updateWakeLock() {
  const wanted = data.settings.keepAwake && data.offerings.length > 0 && document.visibilityState === 'visible';
  if (wanted && !wakeLock && navigator.wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {
      // 省電模式下可能被拒絕，香照樣計時
    }
  } else if (!wanted && wakeLock) {
    wakeLock.release();
  }
}

// ---------- 儀式 ----------
function hint(title, detail = '') {
  $('hint-title').textContent = title;
  $('hint-detail').textContent = detail;
}

function setAction(label) {
  $('action').textContent = label;
  $('action').hidden = !label;
}

function summaryText() {
  const { size, count, minutes } = data.settings;
  return `${SIZES[size].label}・${count} 炷・${minutes} 分鐘　調整`;
}

function setMode(next) {
  mode = next;
  document.querySelectorAll('nav [data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === next));
  document.body.dataset.mode = next;
  document.body.dataset.step = '';
  pendingLot = null;
  shake.reset();
  manualShake = 0;
  $('progress').hidden = true;
  $('lot-stick').hidden = true;
  $('cancel').hidden = true;
  $('summary').hidden = next !== 'incense';
  $('blocks').hidden = next !== 'toss';
  $('canister').hidden = next !== 'fortune';
  if (next === 'incense') readyIncense();
  if (next === 'toss') readyToss();
  if (next === 'fortune') readyFortune();
  showBurnStatus();
}

function readyIncense(title = '請點香', detail = SCENES[scene].prayer) {
  step = 'idle';
  document.body.dataset.step = '';
  $('cancel').hidden = true;
  $('summary').hidden = false;
  $('summary').textContent = summaryText();
  hint(title, detail);
  setAction('點香');
  showBurnStatus();
}

function startHold() {
  step = 'bowing';
  bowCount = 0;
  bowDetector = newBowDetector();
  document.body.dataset.step = 'hold';
  $('summary').hidden = true;
  $('cancel').hidden = false;
  hint(`雙手持手機，鞠躬 0 / ${BOWS_REQUIRED}`, '手機前傾再回正算一拜。');
  setAction('鞠躬一拜');
  showBurnStatus();
  playBell();
}

function bow() {
  if (step !== 'bowing') return;
  bowCount += 1;
  buzz(30);
  playBell();
  hint(`雙手持手機，鞠躬 ${bowCount} / ${BOWS_REQUIRED}`, '手機前傾再回正算一拜。');
  if (bowCount >= BOWS_REQUIRED) {
    step = 'insert';
    hint('請將香插入香爐', '插好後就可以收起手機，香會繼續燒。');
    setAction('插入香爐');
  }
}

function insertIncense() {
  const { size, count, minutes } = data.settings;
  const who = scene === 'ancestor' ? forWhom : '';
  addOffering({ ts: Date.now(), size, count, minutes });
  addRecord({ type: 'incense', scene, detail: `${who ? `為${who}` : ''}上${SIZES[size].label} ${count} 炷` });
  buzz(50);
  updateWakeLock();
  readyIncense('香已入爐', '手指在畫面上滑動，可以搧動香煙。');
  setAction('再上一炷');
}

function readyToss() {
  step = 'toss-ready';
  hint('擲筊', SCENES[scene].tossHint);
  setAction('擲筊');
}

function tossResult([a, b]) {
  if (a !== b) return 'sheng';
  return a ? 'xiao' : 'yin';
}

async function runToss() {
  step = 'tossing';
  setAction('');
  $('tabs').inert = true; // 筊還在空中時不能切換
  buzz(40);
  const fell = [Math.random() < 0.5, Math.random() < 0.5]; // true = 平面朝上
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const blocks = [...document.querySelectorAll('.block')];
  $('blocks').hidden = false;
  await Promise.all(blocks.map((el, i) => {
    el.classList.toggle('flat', fell[i]);
    const spins = 4 + i;
    return el.animate([
      { transform: 'translateY(0) rotateX(0) rotateZ(0)' },
      { transform: `translateY(-36vh) rotateX(${spins * 180}deg) rotateZ(${i ? 50 : -40}deg)`, offset: 0.5 },
      { transform: `translateY(0) rotateX(${spins * 360}deg) rotateZ(${i ? 14 : -10}deg)` },
    ], { duration: reduced ? 1 : 1100 + i * 90, easing: 'cubic-bezier(.3,.1,.5,1)', fill: 'forwards' }).finished;
  }));
  playClack();
  buzz([20, 40, 20]);
  $('tabs').inert = false;
  return tossResult(fell);
}

async function toss() {
  if (step === 'toss-ready') {
    const result = await runToss();
    addRecord({ type: 'toss', scene, detail: `擲得${TOSS[result].label}` });
    hint(TOSS[result].label, TOSS[result].meaning);
    step = 'toss-ready';
    setAction('再擲一次');
  } else if (step === 'confirm-lot') {
    const lot = pendingLot;
    const result = await runToss();
    $('blocks').hidden = true;
    if (result === 'sheng') {
      addRecord({ type: 'lot', scene, detail: `求得第 ${lot + 1} 籤（${FORTUNES[lot].grade}）` });
      showFortune(lot, true);
      readyFortune();
    } else {
      readyFortune(TOSS[result].label);
    }
  }
}

function readyFortune(retryReason) {
  step = 'shaking';
  shake.reset();
  manualShake = 0;
  $('canister').classList.remove('shaking');
  $('canister').hidden = false;
  $('lot-stick').hidden = true;
  $('progress').hidden = false;
  $('progress-bar').style.width = '0%';
  hint(
    retryReason ? `擲得${retryReason}，這支不是你的籤` : '搖動手機求籤',
    retryReason ? '請再搖一次。' : '先在心中稟明要問的事，再持續搖動手機。',
  );
  setAction('搖一下');
}

function onShakeProgress(value) {
  $('progress-bar').style.width = `${value * 100}%`;
  $('canister').classList.add('shaking');
  clearTimeout(onShakeProgress.timer);
  onShakeProgress.timer = setTimeout(() => $('canister').classList.remove('shaking'), 220);
  if (Math.random() < 0.25) playRattle();
}

function lotDrawn() {
  step = 'confirm-lot';
  pendingLot = Math.floor(Math.random() * FORTUNES.length);
  $('canister').classList.remove('shaking');
  $('lot-number').textContent = `第 ${pendingLot + 1} 籤`;
  $('lot-stick').hidden = false;
  $('progress').hidden = true;
  buzz(120);
  playClack();
  hint(`跳出第 ${pendingLot + 1} 籤`, '請擲筊請示：得到聖筊，這支才是你的籤。');
  setAction('擲筊確認');
}

function showFortune(index, canSave) {
  const f = FORTUNES[index];
  shownFortune = index;
  $('fortune-grade').textContent = f.grade;
  $('fortune-number').textContent = `第 ${index + 1} 籤`;
  $('fortune-poem').replaceChildren(...f.poem.map((line) => {
    const p = document.createElement('p');
    p.textContent = line;
    return p;
  }));
  $('fortune-meaning').textContent = f.meaning;
  $('fortune-save').hidden = !canSave;
  $('fortune').showModal();
  playBell();
}

function onAction() {
  if (mode === 'incense') {
    if (step === 'idle') startHold();
    else if (step === 'bowing') bow();
    else if (step === 'insert') insertIncense();
  } else if (mode === 'toss' || step === 'confirm-lot') {
    toss();
  } else if (step === 'shaking') {
    // 不能搖的裝置：連按按鈕累積進度
    manualShake += 0.22;
    onShakeProgress(Math.min(manualShake, 1));
    if (manualShake >= 1) lotDrawn();
  }
}

// ---------- 感測器 ----------
const newBowDetector = () => createBowDetector({ onBow: bow });
let bowDetector = newBowDetector();
// 廟裡人多，動作門檻比大力甩動低，輕輕一抬就算
const flick = createFlickDetector({ threshold: 7, onFlick: toss });
const shake = createShakeMeter({
  jerkThreshold: 40,
  onProgress: (v) => { if (step === 'shaking') onShakeProgress(v); },
  onDone: () => { if (step === 'shaking') lotDrawn(); },
});

function startSensors() {
  if (sensorsStarted) return;
  sensorsStarted = true;
  listenMotion({
    onOrientation(beta, gamma, t) {
      smoke.setWind(Math.max(-1, Math.min(1, gamma / 45)));
      if (step === 'bowing') bowDetector.feed(beta, t);
    },
    onMotion(x, y, z, t) {
      if (step === 'shaking') shake.feed(x, y, z, t);
      if (step === 'toss-ready' || step === 'confirm-lot') flick.feed(Math.hypot(x, y, z), t);
    },
  });
}

// ---------- 香的設定 ----------
function renderChips(host, options, current, onPick) {
  host.replaceChildren(...options.map(({ value, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', value === current);
    button.addEventListener('click', () => onPick(value));
    return button;
  }));
}

function renderSetup() {
  const s = data.settings;
  renderChips($('size-chips'), Object.entries(SIZES).map(([value, v]) => ({ value, label: v.label })), s.size, (size) => {
    s.size = size;
    s.minutes = SIZES[size].minutes; // 粗香燒得久，選大小時帶入對應時間
    commitSetup();
  });
  renderChips($('minute-chips'), MINUTE_CHOICES.map((m) => ({ value: m, label: `${m} 分` })), s.minutes, (minutes) => {
    s.minutes = minutes;
    commitSetup();
  });
  renderChips($('count-chips'), [1, 3].map((c) => ({ value: c, label: `${c} 炷` })), s.count, (count) => {
    s.count = count;
    commitSetup();
  });
  $('custom-minutes').value = s.minutes;
  $('keep-awake').checked = s.keepAwake;
  $('sound').checked = s.sound;

  const showWho = scene === 'ancestor' && data.ancestors.length > 0;
  $('for-whom-group').hidden = !showWho;
  if (showWho) {
    $('for-whom').replaceChildren(new Option('歷代祖先', ''), ...data.ancestors.map((a) => new Option(a.name, a.name)));
    $('for-whom').value = forWhom;
  }
}

function commitSetup() {
  save();
  renderSetup();
  if (mode === 'incense' && step === 'idle') $('summary').textContent = summaryText();
}

// ---------- 紀錄 ----------
function emptyRow(text) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  return li;
}

function row(text, buttonLabel, onClick) {
  const li = document.createElement('li');
  const span = document.createElement('span');
  span.textContent = text;
  li.append(span);
  if (buttonLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = buttonLabel;
    button.addEventListener('click', onClick);
    li.append(button);
  }
  return li;
}

function dateText(t) {
  return new Date(t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function renderRecords() {
  const ancestors = data.ancestors.map((a, i) => {
    const days = daysUntil(a);
    const when = days === 0 ? '（今天）' : days === null ? '' : `（再 ${days} 天）`;
    return row(`${a.name}・${formatDate(a)}${when}`, '刪除', () => {
      if (!confirm(`要刪除「${a.name}」嗎？`)) return;
      data.ancestors.splice(i, 1);
      save();
      renderRecords();
    });
  });
  $('ancestor-list').replaceChildren(...(ancestors.length ? ancestors : [emptyRow('還沒有資料')]));

  const saved = data.saved.map((s) => row(`第 ${s.index + 1} 籤（${FORTUNES[s.index].grade}）`, '查看', () => {
    $('records').close();
    showFortune(s.index, false);
  }));
  $('saved-list').replaceChildren(...(saved.length ? saved : [emptyRow('還沒有收藏')]));

  const records = data.records.slice(0, 30).map((r) => row(`${dateText(r.t)}　${SCENES[r.scene]?.label ?? ''}　${r.detail}`));
  $('record-list').replaceChildren(...(records.length ? records : [emptyRow('還沒有紀錄')]));
}

function renderReminders() {
  const items = data.ancestors
    .map((a) => ({ a, days: daysUntil(a) }))
    .filter(({ days }) => days !== null && days <= 7)
    .sort((x, y) => x.days - y.days)
    .map(({ a, days }) => {
      const li = document.createElement('li');
      li.textContent = `${a.name}的忌日${days === 0 ? '就是今天' : `還有 ${days} 天`}（${formatDate(a)}）`;
      return li;
    });
  $('reminders').replaceChildren(...items);
}

function fillDayOptions() {
  const max = $('ancestor-calendar').value === 'lunar' ? 30 : 31;
  const keep = Math.min(Number($('ancestor-day').value) || 1, max);
  $('ancestor-day').replaceChildren(...Array.from({ length: max }, (_, i) => new Option(`${i + 1} 日`, i + 1)));
  $('ancestor-day').value = keep;
}

// ---------- 啟動 ----------
function enterScene(id) {
  scene = id;
  forWhom = '';
  document.body.dataset.scene = id;
  document.body.dataset.view = 'altar';
  $('plaque').textContent = SCENES[id].plaque;
  $('scene-name').textContent = SCENES[id].label;
  $('guide-list').replaceChildren(...SCENES[id].guide.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  setMode('incense');
}

function goHome() {
  document.body.dataset.view = 'home';
  renderReminders();
}

function init() {
  for (const [id, s] of Object.entries(SCENES)) {
    const button = document.createElement('button');
    button.className = 'scene-choice';
    button.dataset.scene = id;
    const title = document.createElement('strong');
    title.textContent = s.label;
    const note = document.createElement('span');
    note.textContent = s.note;
    button.append(title, note);
    $('scene-list').append(button);
  }

  smoke = createSmoke($('smoke')).smoke;
  addEventListener('resize', () => smoke.resize());
  setupFan();
  requestAnimationFrame(frame);

  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty('--panel-h', `${Math.ceil(entry.borderBoxSize[0].blockSize)}px`);
  }).observe($('panel'));

  $('scene-list').addEventListener('click', (e) => {
    const choice = e.target.closest('[data-scene]');
    if (!choice) return;
    if (data.settings.sound) setSound(true);
    // 必須在點擊當下發出請求；不等結果，權限視窗不會擋住畫面
    requestMotionPermission().then((granted) => { $('motion-note').hidden = granted; });
    startSensors();
    enterScene(choice.dataset.scene);
  });

  $('action').addEventListener('click', onAction);
  $('cancel').addEventListener('click', () => setMode('incense'));
  $('back').addEventListener('click', goHome);
  $('summary').addEventListener('click', () => { renderSetup(); $('setup').showModal(); });
  $('open-guide').addEventListener('click', () => $('guide').showModal());
  $('open-records').addEventListener('click', () => { renderRecords(); $('records').showModal(); });
  document.querySelectorAll('nav [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  $('custom-minutes').addEventListener('change', (e) => {
    data.settings.minutes = clampMinutes(e.target.value);
    commitSetup();
  });
  $('for-whom').addEventListener('change', (e) => { forWhom = e.target.value; });
  $('keep-awake').addEventListener('change', (e) => {
    data.settings.keepAwake = e.target.checked;
    save();
    updateWakeLock();
  });
  $('sound').addEventListener('change', (e) => {
    data.settings.sound = e.target.checked;
    save();
    setSound(e.target.checked);
    playBell();
  });

  $('fortune-save').addEventListener('click', () => {
    if (!data.saved.some((s) => s.index === shownFortune)) {
      data.saved.unshift({ index: shownFortune, t: Date.now() });
      save();
    }
    $('fortune').close();
    toast('已收藏，可在「紀錄」查看');
  });

  $('ancestor-month').replaceChildren(...Array.from({ length: 12 }, (_, i) => new Option(`${i + 1} 月`, i + 1)));
  fillDayOptions();
  $('ancestor-calendar').addEventListener('change', fillDayOptions);
  $('ancestor-form').addEventListener('submit', (e) => {
    e.preventDefault();
    data.ancestors.push({
      name: $('ancestor-name').value.trim().slice(0, 12),
      calendar: $('ancestor-calendar').value,
      month: Number($('ancestor-month').value),
      day: Number($('ancestor-day').value),
    });
    save();
    e.target.reset();
    fillDayOptions();
    renderRecords();
  });

  document.addEventListener('visibilitychange', () => {
    updateWakeLock();
    if (document.visibilityState === 'visible') sweepOfferings();
  });
  setInterval(sweepOfferings, 1000);

  renderReminders();
  updateWakeLock();
}

init();
