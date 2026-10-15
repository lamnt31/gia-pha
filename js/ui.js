// Thành phần giao diện dùng chung – chuyển từ app Quản lý thẻ (theme, toast, hộp thoại, popup vuốt 2 lần, khóa cuộn)
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

export function store(k, v) {
  try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; }
}

// ---------- Giao diện sáng / tối (chọn tay, không theo trình duyệt)
export function applyTheme(t) {
  document.documentElement.dataset.theme = t; store('theme', t);
  const b = $('themeBtn');
  if (b) { b.innerHTML = `<i class="fa-solid ${t === 'dark' ? 'fa-sun' : 'fa-moon'}"></i>`; b.title = t === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'; }
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#0b0f19' : '#0070f4';
}
export const toggleTheme = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

// ---------- Thông báo nhỏ
export function toast(msg, ms) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms || 1800);
}
export function busy(msg) { $('busy').hidden = !msg; if (msg) $('busyTxt').textContent = msg; }

// ---------- Hộp thoại: ask({title, msg, fields:[{id, type, ph, value}], ok, danger})
export function ask({ title, msg, fields = [], ok = 'OK', danger, validate }) {
  return new Promise((resolve) => {
    $('modal').innerHTML = `<form class="mbox" id="mform"><h3>${esc(title)}</h3>${msg ? `<p>${msg}</p>` : ''}
      ${fields.map((f) => f.type === 'select'
        ? `<div class="fld"><select id="m_${f.id}">${f.options.map((o) => `<option value="${esc(o[0])}" ${o[0] === f.value ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`
        : `<div class="fld"><input id="m_${f.id}" type="${f.type || 'text'}" placeholder="${esc(f.ph || '')}" value="${esc(f.value || '')}" autocomplete="off"></div>`).join('')}
      <div class="merr" id="merr"></div>
      <div class="macts"><button type="button" class="abtn" id="mcancel">Hủy</button><button class="abtn ${danger ? 'red' : 'blue'}">${esc(ok)}</button></div></form>`;
    $('modal').hidden = false;
    const done = (v) => { $('modal').hidden = true; $('modal').innerHTML = ''; resolve(v); };
    $('mcancel').onclick = () => done(null);
    $('mform').onsubmit = (e) => {
      e.preventDefault();
      const v = {}; fields.forEach((f) => (v[f.id] = $('m_' + f.id).value.trim()));
      const err = validate && validate(v);
      if (err) { $('merr').textContent = err; return; }
      done(fields.length ? v : true);
    };
    setTimeout(() => { const f = $('modal').querySelector('input,select'); if (f) f.focus(); }, 50);
  });
}

// ---------- Khóa cuộn trang phía sau khi mở popup (iOS cần position:fixed)
let SCROLL_Y = 0;
function lockScroll() {
  if (document.body.classList.contains('locked')) return;
  SCROLL_Y = window.scrollY; document.body.style.top = -SCROLL_Y + 'px'; document.body.classList.add('locked');
}
function unlockScroll() {
  if (!document.body.classList.contains('locked')) return;
  document.body.classList.remove('locked'); document.body.style.top = ''; window.scrollTo(0, SCROLL_Y);
}

// ---------- Popup (bottom sheet trên điện thoại, khung bên phải trên máy tính)
// Vuốt xuống lần 1 thu thấp, lần 2 đóng; không vuốt tiếp -> tự bung lại sau 1,5 giây
let beforeClose = null;     // hàm trả về false để chặn đóng (vd form chưa lưu)
export function openSheet(html, opts = {}) {
  beforeClose = opts.beforeClose || null;
  sheetReset();
  $('sheet').innerHTML = `<div class="grab"></div>${html}`;
  $('sheet').scrollTop = 0; $('sheet').classList.add('open'); $('sheetBg').classList.add('open'); lockScroll();
}
export function closeSheet(force) {
  if (!force && beforeClose && beforeClose() === false) { sheetFull(); return false; }
  beforeClose = null; sheetReset(true);
  $('sheet').classList.remove('open'); $('sheetBg').classList.remove('open'); unlockScroll();
  return true;
}
export const sheetOpen = () => $('sheet').classList.contains('open');

const SW = { y0: 0, dy: 0, base: 0, drag: false, half: false, t: 0, top0: true };
const isSidePanel = () => matchMedia('(min-width: 900px)').matches;
const halfOffset = () => Math.round($('sheet').offsetHeight * 0.48);
function sheetMove(px, animate) {
  const sh = $('sheet'), bg = $('sheetBg');
  sh.style.transition = animate ? 'transform .25s cubic-bezier(.2,.8,.2,1)' : 'none';
  sh.style.transform = px > 0 ? `translateY(${px}px)` : '';
  bg.style.transition = animate ? 'opacity .25s' : 'none';
  bg.style.opacity = String(Math.max(0.15, 1 - (px / Math.max(sh.offsetHeight, 1)) * 0.9));
}
function sheetReset(keep) { clearTimeout(SW.t); SW.half = false; SW.drag = false; const sh = $('sheet'), bg = $('sheetBg'); if (!keep) sh.style.transition = ''; sh.style.transform = ''; bg.style.opacity = ''; bg.style.transition = ''; }
function sheetFull() { clearTimeout(SW.t); SW.half = false; sheetMove(0, true); }
function sheetHalf() { SW.half = true; sheetMove(halfOffset(), true); clearTimeout(SW.t); SW.t = setTimeout(sheetFull, 1500); }
function sheetSwipeClose() {
  if (beforeClose && beforeClose() === false) { sheetFull(); return; }
  clearTimeout(SW.t); sheetMove($('sheet').offsetHeight + 40, true);
  setTimeout(() => { closeSheet(true); sheetReset(); }, 230);
}
export function initSheet() {
  const sh = $('sheet');
  const onStart = (e) => {
    if (isSidePanel() || !sh.classList.contains('open') || e.touches.length !== 1) return;
    SW.y0 = e.touches[0].clientY; SW.dy = 0; SW.drag = false; SW.base = SW.half ? halfOffset() : 0;
    SW.top0 = sh.scrollTop <= 0 || e.currentTarget !== sh;
  };
  const onMove = (e) => {
    if (isSidePanel() || !sh.classList.contains('open')) return;
    const dy = e.touches[0].clientY - SW.y0;
    if (!SW.drag) {
      if ((dy > 8 && SW.top0 && sh.scrollTop <= 0) || (SW.half && Math.abs(dy) > 8)) { SW.drag = true; clearTimeout(SW.t); SW.y0 = e.touches[0].clientY; }
      else return;
    }
    e.preventDefault(); SW.dy = e.touches[0].clientY - SW.y0; sheetMove(Math.max(0, SW.base + SW.dy), false);
  };
  const onEnd = () => {
    if (!SW.drag) { if (SW.half) { clearTimeout(SW.t); SW.t = setTimeout(sheetFull, 1500); } return; }
    SW.drag = false;
    const H = sh.offsetHeight, dy = SW.dy;
    if (!SW.half) { if (dy > H * 0.6) sheetSwipeClose(); else if (dy > 70) sheetHalf(); else sheetFull(); }
    else { if (dy > 50) sheetSwipeClose(); else if (dy < -40) sheetFull(); else sheetHalf(); }
  };
  for (const el of [sh, $('sheetBg')]) {
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', () => { if (SW.drag) { SW.drag = false; SW.half ? sheetHalf() : sheetFull(); } });
  }
  $('sheetBg').onclick = () => closeSheet();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modal').hidden && sheetOpen()) closeSheet(); });
}

// ---------- Ảnh chân dung: cắt vuông + nén nhỏ (giống cách nén ảnh thẻ)
export async function fileToAvatar(file, size = 240) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  const s = Math.min(img.width, img.height), cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const x = cv.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  for (const q of [0.8, 0.7, 0.6, 0.5]) { const u = cv.toDataURL('image/jpeg', q); if (u.length < 40000) return u; }
  return cv.toDataURL('image/jpeg', 0.4);
}
