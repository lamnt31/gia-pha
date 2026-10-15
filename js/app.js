// Màn hình: đăng nhập / đăng ký dòng họ → menu (Tổng quan, Cây, Danh sách, Ngày giỗ, Nhiều hơn) → quản lý người dùng (root)
import { $, esc, fold, store, applyTheme, toggleTheme, toast, busy, ask, openSheet, closeSheet, sheetOpen, initSheet, initPickers, pick, fileToAvatar } from './ui.js?v=1792055952378';
import * as D from './data.js?v=1792055952378';
import { analyze, layout, renderTree, panZoom, wouldCycle } from './tree.js?v=1792055952378';
import { solarToLunar, nextDeathAnniversary, formatLunar, yearCanChi, lunarToSolar } from './lunar.js?v=1792055952378';

const APP_VER = '15/10 16:19';   // tools/deploy.mjs thay bằng ngày giờ đưa lên
const ROLE = { owner: 'Quản trị', editor: 'Biên tập', member: 'Thành viên', viewer: 'Chỉ xem' };
const COLORS = [['#4f46e5', '#7c3aed'], ['#b45309', '#dc2626'], ['#047857', '#0e7490'], ['#be185d', '#7c3aed'], ['#1d4ed8', '#0891b2'], ['#9a3412', '#a16207']];
const S = { tree: null, role: null, persons: [], A: null, tab: store('tab') || 'home', q: '', filter: 'all', gen: '', collapsed: new Set(), sel: null, pz: null, propCount: 0 };
const canEdit = () => S.role === 'owner' || S.role === 'editor';
const isOwner = () => S.role === 'owner';
const byId = (id) => S.A && S.A.byId.get(id);

// ======================= Ngày tháng =======================
/** "12/3/1950" | "3/1950" | "1950" → [d, m, y] (0 = không rõ) */
function parseDate(s) {
  const p = String(s || '').trim().split(/[\/\-.\s]+/).filter(Boolean).map(Number);
  if (!p.length || p.some(isNaN)) return null;
  if (p.length === 1) return [0, 0, p[0]];
  if (p.length === 2) return p[1] > 31 ? [0, p[0], p[1]] : [p[0], p[1], 0];
  return [p[0], p[1], p[2]];
}
const validDate = (s, needYear) => {
  if (!String(s || '').trim()) return true;
  const d = parseDate(s); if (!d) return false;
  const [dd, mm, yy] = d;
  if (needYear && !yy) return false;
  return (!dd || (dd >= 1 && dd <= 31)) && (!mm || (mm >= 1 && mm <= 12)) && (!yy || (yy >= 100 && yy <= 2200));
};
const fullDate = (s) => { const d = parseDate(s); return d && d[0] && d[1] && d[2] ? d : null; };
const yearOf = (s) => { const d = parseDate(s); return d && d[2] ? d[2] : 0; };
/** Ngày âm của một ngày dương đầy đủ */
const lunarOf = (s) => { const d = fullDate(s); return d ? solarToLunar(...d) : null; };
/** Ngày giỗ (âm) của người đã mất: [ngày, tháng] – ưu tiên ngày mất âm lịch, không có thì đổi từ ngày mất dương */
function gioOf(p) {
  const l = parseDate(p.deathLunar);
  if (l && l[0] && l[1]) return [l[0], l[1]];
  const x = lunarOf(p.deathSolar);
  return x ? [x[0], x[1]] : null;     // mất vào tháng nhuận → giỗ theo tháng thường
}
/**
 * Mặt nạ ô ngày: chỉ giữ số, tự chèn "/" thành dd/mm/yyyy.
 * kind 'solar': gõ tối đa 4 số thì giữ nguyên (= chỉ nhớ năm), từ số thứ 5 mới tách dd/mm/yyyy.
 * kind 'dm' (ngày âm để tính giỗ): tách ngay dd/mm, có thể thêm /yyyy.
 * Dán "5-3-1950" → "05/03/1950".
 */
let AUTO_FILL = false;
function maskDate(el, e) {
  const raw = el.value, kind = el.dataset.mask;
  let out;
  const parts = raw.split(/[^0-9]+/).filter(Boolean);
  if (e && e.inputType === 'insertFromPaste' && parts.length >= 2) {
    out = parts.slice(0, 3).map((p, i) => (i < 2 ? p.padStart(2, '0').slice(-2) : p.slice(0, 4))).join('/');
  } else {
    const d = raw.replace(/[^0-9]/g, '').slice(0, 8);
    out = kind === 'solar' && d.length <= 4 ? d
      : d.slice(0, 2) + (d.length > 2 ? '/' + d.slice(2, 4) : '') + (d.length > 4 ? '/' + d.slice(4) : '');
  }
  if (out !== raw) el.value = out;
}
/**
 * Sinh nhật tới của người còn sống: theo ngày sinh dương; nếu chỉ có ngày sinh âm thì theo âm lịch.
 * 29/2 năm không nhuận → 28/2. Trả về { solar:[d,m,y], daysLeft, age, lunar, tho } | null
 */
function nextBirthday(p, today = new Date()) {
  if (isDead(p)) return null;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const s = fullDate(p.birthSolar);
  if (s) {
    for (const y of [t0.getFullYear(), t0.getFullYear() + 1]) {
      const d = s[0] === 29 && s[1] === 2 && new Date(y, 1, 29).getMonth() !== 1 ? 28 : s[0];
      const dt = new Date(y, s[1] - 1, d);
      if (dt >= t0) { const age = y - s[2]; return { solar: [d, s[1], y], daysLeft: Math.round((dt - t0) / 864e5), age, lunar: false, tho: age >= 60 && age % 10 === 0 }; }
    }
  }
  const l = fullDate(p.birthLunar);
  if (l) {
    const n = nextDeathAnniversary(l[0], l[1], today);   // cùng quy tắc đổi ngày âm năm nay ra dương
    if (n) { const age = n.lunarYear - l[2]; return { solar: n.solar, daysLeft: n.daysLeft, age, lunar: true, tho: age >= 60 && age % 10 === 0 }; }
  }
  return null;
}
const isDead = (p) => p.alive === false || !!(p.deathSolar || p.deathLunar);
const fmtD = (a) => `${String(a[0]).padStart(2, '0')}/${String(a[1]).padStart(2, '0')}/${a[2]}`;
function lifeText(p) {
  const b = yearOf(p.birthSolar) || yearOf(p.birthLunar), d = yearOf(p.deathSolar) || yearOf(p.deathLunar);
  if (isDead(p)) return `${b || '?'} – ${d || '?'}`;
  return b ? `Sinh ${b}` : '';
}
const ago = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts), s = (Date.now() - d) / 1000;
  if (s < 60) return 'vừa xong'; if (s < 3600) return `${Math.floor(s / 60)} phút trước`; if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return d.toLocaleDateString('vi-VN');
};
const initials = (n) => { const w = String(n || '?').trim().split(/\s+/); return (w.at(-1) || '?')[0].toUpperCase(); };
const avatar = (p, cls = 'ic') => `<div class="${cls} ${p.gender === 'f' ? 'f' : 'm'}">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials(p.name))}</div>`;
const pname = (p) => (p && p.name) || 'Chưa rõ tên';

// ======================= Khởi động =======================
{ const u = new URL(location.href), c = u.searchParams.get('link'), sh = u.searchParams.get('share');
  if (c) { store('pendingLink', c); u.searchParams.delete('link'); }
  if (sh) { store('pendingShare', sh); u.searchParams.delete('share'); }
  if (c || sh) history.replaceState(null, '', u); }
applyTheme(store('theme') === 'dark' ? 'dark' : 'light');
initSheet();
initPickers();   // mọi ô chọn (select) mở danh sách dạng popup trượt lên

D.onUser(async (u, err) => {
  if (!u) {
    D.stopPersons(); S.tree = null; $('app').hidden = true; $('gate').hidden = false; closeSheet(true);
    renderLogin(err ? D.errMsg(err) : '');
    return;
  }
  $('gate').hidden = true; $('app').hidden = false;
  { const ps = store('pendingShare'); if (ps) { store('pendingShare', null); setTimeout(() => receiveShare(ps), 900); } }
  rememberAcc({ code: D.clan.code, user: D.account.username, name: D.account.name || '', clan: D.clan.name || '' });
  const trees = D.myTrees(), last = store('lastTree'), oal = store('openAfterLogin');
  if (oal && oal.clan === D.clan.code) { store('openAfterLogin', null); if (trees.some((t) => t.id === oal.tree)) { S.jumpAfterLoad = oal.person; return openTree(oal.tree, true); } }
  const first = trees.find((t) => t.id === last) || trees[0];
  if (first) openTree(first.id, true); else { S.tree = null; S.tab = 'home'; shell(); }
});

// ======================= Cài ứng dụng (PWA) – giống app Thẻ =======================
const INST = { deferred: null };
const standalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(navigator.userAgent);
// Nút luôn hiện khi chưa cài. Trình duyệt đã sẵn sàng (beforeinstallprompt) → hộp cài đặt; chưa → hướng dẫn đúng loại máy
const canInstall = () => !standalone();
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); INST.deferred = e; document.querySelectorAll('[data-install]').forEach((b) => (b.hidden = false)); });
addEventListener('appinstalled', () => { INST.deferred = null; document.querySelectorAll('[data-install]').forEach((b) => (b.hidden = true)); toast('Đã cài ứng dụng'); });
function bindInstall(root) { root.querySelectorAll('[data-install]').forEach((b) => (b.onclick = doInstall)); }
async function doInstall() {
  if (INST.deferred) {   // Android / Chrome / Edge: hiện hộp cài đặt của trình duyệt
    INST.deferred.prompt();
    const c = await INST.deferred.userChoice; INST.deferred = null;
    if (c.outcome === 'accepted') document.querySelectorAll('[data-install]').forEach((b) => (b.hidden = true));
    return;
  }
  // Trình duyệt chưa sẵn sàng hiện hộp cài (Chrome/Edge máy tính cần bấm vào trang và xem ~30 giây) → hướng dẫn theo loại máy
  const msg = isIOS
    ? '1. Mở trang này bằng <b>Safari</b><br>2. Bấm nút <b>Chia sẻ</b> <i class="fa-solid fa-arrow-up-from-bracket"></i> ở thanh dưới<br>3. Chọn <b>Thêm vào MH chính</b> → <b>Thêm</b>'
    : isAndroid
      ? '1. Bấm nút menu <b>⋮</b> góc trên bên phải của Chrome<br>2. Chọn <b>Cài đặt ứng dụng</b> (hoặc <b>Thêm vào màn hình chính</b>)<br>3. Bấm <b>Cài đặt</b>'
      : '<b>Cách 1:</b> bấm biểu tượng <b>Cài đặt ứng dụng</b> <i class="fa-solid fa-display"></i> ở cuối thanh địa chỉ (bên phải ô nhập link).<br><br>'
        + '<b>Cách 2:</b><br>• <b>Edge:</b> menu <b>⋯</b> → <b>Ứng dụng</b> → <b>Cài đặt trang web này dưới dạng ứng dụng</b><br>'
        + '• <b>Chrome:</b> menu <b>⋮</b> → <b>Truyền, lưu và chia sẻ</b> → <b>Cài đặt trang dưới dạng ứng dụng</b>';
  await ask({ title: 'Cài "Gia phả" lên máy', msg, ok: 'Đã hiểu' });
}

// ======================= Đăng nhập (giống ech-client: mã dòng họ + tên đăng nhập + mật khẩu) =======================
// Tài khoản đã đăng nhập trên máy này (như app ngân hàng): lần sau chỉ cần nhập mật khẩu. Tối đa 5.
const accKey = (a) => `${a.code}_${a.user}`;
const savedAccs = () => { const l = store('accounts') || []; const r = store('remember'); if (!l.length && r && r.code) l.push({ code: r.code, user: r.user, name: '', clan: '' }); return l; };
function rememberAcc(a) {
  const l = savedAccs().filter((x) => accKey(x) !== accKey(a));
  l.unshift({ ...a, at: Date.now() });
  store('accounts', l.slice(0, 5)); store('remember', null);
}
function forgetAcc(a) { store('accounts', savedAccs().filter((x) => accKey(x) !== accKey(a))); }
const greet = () => { const h = new Date().getHours(); return h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'; };

/** Màn đăng nhập. Có tài khoản đã lưu → chỉ hỏi mật khẩu; other = true → nhập đủ mã dòng họ + tên đăng nhập */
function renderLogin(err = '', other = false) {
  const accs = savedAccs(), acc = !other && accs[0];
  $('gate').innerHTML = `<form class="gbox" id="lf" autocomplete="on">
    ${acc ? `<div class="lock"><i class="fa-solid fa-sitemap"></i></div>
      <div class="gt">Gia phả</div>
      <p class="gclan"><i class="fa-solid fa-landmark"></i> ${esc(acc.clan || acc.code)}</p>
      <div class="ghi">${greet()}, <b>${esc(acc.name || acc.user)}</b></div>
      <p class="gs"><i class="fa-solid fa-user"></i> ${esc(acc.user)}</p>
      <input type="text" autocomplete="username" value="${esc(acc.code + '/' + acc.user)}" hidden>`
    : `<div class="lock"><i class="fa-solid fa-sitemap"></i></div>
      <div class="gt">Gia phả</div>
      <p class="gs">Đăng nhập để xem gia phả dòng họ</p>
      <div class="gfld"><i class="fa-solid fa-landmark"></i><input id="lCode" placeholder="Mã dòng họ" autocomplete="organization" autocapitalize="none" required></div>
      <div class="gfld"><i class="fa-solid fa-user"></i><input id="lUser" placeholder="Tên đăng nhập" autocomplete="username" autocapitalize="none" required></div>`}
    <div class="gfld"><i class="fa-solid fa-lock"></i><input id="lPw" type="password" placeholder="Mật khẩu" autocomplete="current-password" required><button type="button" class="eye" id="lEye" aria-label="Hiện mật khẩu"><i class="fa-regular fa-eye"></i></button></div>
    <div class="grow">${acc || accs.length ? `<button type="button" class="linkbtn" id="lSwitch"><i class="fa-solid fa-right-left"></i> ${acc ? 'Chuyển tài khoản' : 'Tài khoản đã lưu'}</button>` : '<span></span>'}<button type="button" class="linkbtn" id="lForgot">Quên mật khẩu?</button></div>
    <button class="go" id="lGo"><span>Đăng nhập</span><i class="fa-solid fa-arrow-right"></i></button>
    <div class="err" id="gErr">${esc(err)}</div>
    <p class="note">Chưa có tài khoản? <button type="button" class="linkbtn" id="lReg">Đăng ký dòng họ mới</button></p>
    ${D.isEmu ? '<p class="note"><i class="fa-solid fa-flask"></i> Đang chạy emulator (dữ liệu thử)</p>' : ''}
    <p class="note" style="margin-top:4px">Phiên bản ${APP_VER}</p>
    <button type="button" class="instbtn" data-install ${canInstall() ? '' : 'hidden'}><i class="fa-solid fa-download"></i>Cài ứng dụng lên máy</button>
  </form>`;
  bindInstall($('gate'));
  if (acc) setTimeout(() => $('lPw') && $('lPw').focus(), 100);
  const codeUser = () => (acc ? [acc.code, acc.user] : [$('lCode').value.trim().toLowerCase(), $('lUser').value.trim().toLowerCase()]);
  $('lEye').onclick = () => { const i = $('lPw'); i.type = i.type === 'password' ? 'text' : 'password'; $('lEye').innerHTML = `<i class="fa-regular fa-eye${i.type === 'text' ? '-slash' : ''}"></i>`; };
  $('lReg').onclick = renderRegister;
  if ($('lSwitch')) $('lSwitch').onclick = async () => {
    const opts = accs.map((a) => [accKey(a), `${a.name || a.user} · ${a.clan || a.code} (@${a.user})`]);
    opts.push(['__other', '+ Đăng nhập tài khoản khác']);
    if (acc) opts.push(['__forget', `Xóa "${acc.name || acc.user}" khỏi máy này`]);
    const v = await pick({ title: 'Chọn tài khoản', options: opts, value: acc ? accKey(acc) : '' });
    if (!v) return;
    if (v === '__other') return renderLogin('', true);
    if (v === '__forget') { forgetAcc(acc); toast('Đã xóa tài khoản khỏi máy này'); return renderLogin(); }
    const a = accs.find((x) => accKey(x) === v);
    store('accounts', [a, ...accs.filter((x) => x !== a)]);
    renderLogin();
  };
  $('lForgot').onclick = async () => {
    const [c0, u0] = codeUser();
    const v = await ask({ title: 'Quên mật khẩu', msg: 'Nếu tài khoản có email, link đặt lại mật khẩu sẽ được gửi về email đó.',
      fields: [{ id: 'c', ph: 'Mã dòng họ', value: c0 }, { id: 'u', ph: 'Tên đăng nhập', value: u0 }], ok: 'Gửi',
      validate: (v) => (!v.c || !v.u ? 'Nhập đủ mã dòng họ và tên đăng nhập' : '') });
    if (!v) return;
    busy('Đang gửi…');
    try { const m = await D.forgotPassword(v.c, v.u); busy(); await ask({ title: 'Đã gửi email', msg: `Mở hộp thư <b>${esc(m)}</b> và bấm vào link để đặt mật khẩu mới.`, ok: 'Đóng' }); }
    catch (e) { busy(); toast(D.errMsg(e), 5000); }
  };
  $('lf').onsubmit = async (e) => {
    e.preventDefault(); $('gErr').textContent = '';
    const [code, user] = codeUser();
    $('lGo').disabled = true; busy('Đang đăng nhập…');
    try { await D.login(code, user, $('lPw').value); }
    catch (er) { $('gErr').textContent = D.errMsg(er); }
    finally { busy(); if ($('lGo')) $('lGo').disabled = false; }
  };
}

function renderRegister() {
  $('gate').innerHTML = `<form class="gbox wide" id="rf">
    <div class="gt" style="margin-top:0">Đăng ký dòng họ</div>
    <p class="gs">Tạo tài khoản quản trị cho dòng họ của bạn. Sau đó bạn tự tạo tài khoản cho người trong họ.</p>
    <div class="fgrid" style="text-align:left">
      <div class="fld full"><label>Tên dòng họ *</label><input id="rName" placeholder="Vd: Họ Nguyễn – Đông Ngạc" maxlength="120" required></div>
      <div class="fld full"><label>Mã dòng họ * <small>(dùng khi đăng nhập)</small></label><input id="rCode" placeholder="vd: nguyen-dongngac" autocapitalize="none" maxlength="30" required><div class="hint" id="rCodeH">Chữ thường không dấu, số, gạch ngang</div></div>
      <div class="fld"><label>Người quản trị *</label><input id="rPerson" placeholder="Họ và tên" required></div>
      <div class="fld"><label>Số điện thoại *</label><input id="rPhone" type="tel" inputmode="tel" required></div>
      <div class="fld full"><label>Email * <small>(để lấy lại mật khẩu)</small></label><input id="rEmail" type="email" autocomplete="email" required></div>
      <div class="fld"><label>Tên đăng nhập *</label><input id="rUser" value="admin" autocapitalize="none" maxlength="30" required></div>
      <div class="fld"><label>Mật khẩu *</label><input id="rPw" type="password" autocomplete="new-password" minlength="6" required></div>
    </div>
    <label class="ck" style="text-align:left;margin-top:8px"><input type="checkbox" id="rAgree" required>Tôi đồng ý để ứng dụng lưu thông tin gia phả do dòng họ nhập và chịu trách nhiệm về dữ liệu người còn sống</label>
    <button class="go" id="rGo" style="margin-top:10px"><i class="fa-solid fa-user-plus"></i><span>Đăng ký</span></button>
    <div class="err" id="gErr"></div>
    <p class="note">Đã có tài khoản? <button type="button" class="linkbtn" id="rBack">Đăng nhập</button></p>
  </form>`;
  $('rBack').onclick = () => renderLogin();
  // gợi ý mã dòng họ từ tên
  let codeTouched = false;
  $('rCode').addEventListener('input', () => { codeTouched = true; checkCode(); });
  $('rName').addEventListener('input', () => { if (!codeTouched) { $('rCode').value = fold($('rName').value).replace(/^h[oọ]\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30); checkCode(); } });
  const checkCode = () => { const ok = D.CODE_RE.test($('rCode').value); $('rCodeH').className = 'hint ' + (ok ? 'ok' : 'bad'); $('rCodeH').textContent = ok ? 'Đăng nhập bằng mã: ' + $('rCode').value : 'Chữ thường không dấu, số, gạch ngang; 3–30 ký tự'; };
  $('rf').onsubmit = async (e) => {
    e.preventDefault(); $('gErr').textContent = '';
    const f = { clanName: $('rName').value, code: $('rCode').value, name: $('rPerson').value, phone: $('rPhone').value, email: $('rEmail').value, username: $('rUser').value, password: $('rPw').value };
    $('rGo').disabled = true; busy('Đang tạo dòng họ…');
    try { await D.register(f); toast('Đăng ký thành công'); }
    catch (er) { $('gErr').textContent = D.errMsg(er); }
    finally { busy(); if ($('rGo')) $('rGo').disabled = false; }
  };
}

// ======================= Menu (giống ech-client: thanh tab dưới trên điện thoại, cột trái trên máy tính) =======================
const NAV = [
  { k: 'home', ic: 'fa-chart-pie', n: 'Tổng quan', ok: () => true },
  { k: 'tree', ic: 'fa-sitemap', n: 'Cây', ok: () => !!S.tree },
  { k: 'list', ic: 'fa-list', n: 'Danh sách', ok: () => !!S.tree },
  { k: 'gio', ic: 'fa-calendar-days', n: 'Lịch', ok: () => !!S.tree },
  { k: 'props', ic: 'fa-inbox', n: 'Đề xuất', ok: () => !!S.tree && canEdit(), g: 'Gia phả' },
  { k: 'log', ic: 'fa-clock-rotate-left', n: 'Nhật ký', ok: () => !!S.tree && S.role !== 'viewer', g: 'Gia phả' },
  { k: 'users', ic: 'fa-users-gear', n: 'Người dùng', ok: () => D.isRoot(), g: 'Quản trị' },
  { k: 'trees', ic: 'fa-book', n: 'Gia phả', ok: () => D.isRoot(), g: 'Quản trị' },
];
const navOk = () => NAV.filter((x) => x.ok());
function shell() {
  const ok = navOk(), mobile = [ok[0], ...ok.slice(1, 4)], tr = D.myTrees();
  if (S.tab !== 'more' && !ok.some((x) => x.k === S.tab)) S.tab = 'home';
  const tab = (x, cls) => `<button class="${cls} ${S.tab === x.k ? 'on' : ''}" data-tab="${x.k}"><i class="fa-solid ${x.ic}"></i><span>${x.n}</span>${x.k === 'props' ? `<b class="badge" data-badge ${S.propCount ? '' : 'hidden'}>${S.propCount}</b>` : ''}</button>`;
  $('app').innerHTML = `
    <div class="top">
      <button class="tsw" id="treeSw" ${tr.length > 1 ? '' : 'disabled'}><b>${esc(S.tree ? S.tree.name : D.clan.name || 'Gia phả')}</b>
        <small id="tsub">${esc(S.tree ? `${ROLE[S.role]} · ${S.persons.length} người` : D.clan.name || '')}</small>${tr.length > 1 ? '<i class="fa-solid fa-chevron-down"></i>' : ''}</button>
      <button class="ibtn" id="scanBtn" title="Quét mã QR (nhận chia sẻ / liên kết)"><i class="fa-solid fa-qrcode"></i></button>
      <button class="ibtn" id="themeBtn"></button>
    </div>
    <nav class="nav mob">${mobile.map((x) => tab(x, 'ntab')).join('')}${tab({ k: 'more', ic: 'fa-bars', n: 'Nhiều hơn' }, 'ntab')}</nav>
    <nav class="nav desk"><div class="rlogo"><i class="fa-solid fa-sitemap"></i></div>${ok.map((x) => tab(x, 'ntab')).join('')}${tab({ k: 'more', ic: 'fa-bars', n: 'Nhiều hơn' }, 'ntab')}</nav>
    <main id="main"></main>`;
  applyTheme(document.documentElement.dataset.theme);
  $('themeBtn').onclick = toggleTheme;
  $('treeSw').onclick = switchTree;
  $('scanBtn').onclick = () => scanAndHandle();
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  renderTab();
}
function go(k) {
  S.tab = k; store('tab', k);
  document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === k));
  // tab nằm trong "Nhiều hơn" trên điện thoại → tô sáng nút Nhiều hơn
  const inBar = [...document.querySelectorAll('.nav.mob [data-tab]')].some((x) => x.dataset.tab === k);
  if (!inBar) document.querySelector('.nav.mob [data-tab=more]').classList.add('on');
  window.scrollTo(0, 0);
  renderTab();
}
function setBadge() { document.querySelectorAll('[data-badge]').forEach((b) => { b.textContent = S.propCount; b.hidden = !S.propCount; }); }

async function switchTree() {
  const tr = D.myTrees();
  const opts = tr.map((t) => [t.id, t.shared ? `${t.name} · ${t.clanName} (được chia sẻ)` : `${t.name} · ${ROLE[t.role]}`]);
  if (D.isRoot() && (D.clan.treeCount || 0) < D.LIMIT_TREES) opts.push(['__new', '+ Tạo gia phả mới']);
  opts.push(['__scan', '+ Nhận gia phả được chia sẻ (quét QR)']);
  const v = await ask({ title: 'Chọn gia phả', fields: [{ id: 't', type: 'select', value: S.tree ? S.tree.id : '', options: opts }], ok: 'Mở' });
  if (!v) return;
  if (v.t === '__new') return newTree();
  if (v.t === '__scan') return scanAndHandle();
  if (!S.tree || v.t !== S.tree.id) openTree(v.t);
}

async function newTree() {
  const v = await ask({ title: 'Tạo gia phả mới', msg: `Mỗi dòng họ có 1 gia phả. Họ ngoại, họ vợ… tự đăng ký dòng họ riêng rồi liên kết hồ sơ.`,
    fields: [{ id: 'name', ph: 'Tên gia phả' }, { id: 'origin', ph: 'Quê gốc (không bắt buộc)' }], ok: 'Tạo',
    validate: (v) => (!v.name ? 'Chưa nhập tên' : v.name.length > 120 ? 'Tên quá dài' : '') });
  if (!v) return;
  busy('Đang tạo…');
  try { const id = await D.createTree(v); busy(); toast('Đã tạo gia phả'); openTree(id); }
  catch (e) { busy(); toast(D.errMsg(e), 4000); }
}

// ======================= Mở gia phả =======================
async function openTree(id, first) {
  busy('Đang mở gia phả…');
  try { const r = await D.openTree(id); S.tree = r.tree; S.role = r.role; }
  catch (e) { busy(); toast(D.errMsg(e), 4000); S.tree = null; S.tab = 'home'; return shell(); }
  busy();
  store('lastTree', id);
  S.persons = []; S.A = null; S.sel = null; S.q = ''; S.pz = null; S.firstFit = true; S.propCount = 0;
  S.collapsed = new Set(store('col_' + id) || []); S.links = new Map();
  if (first) S.tab = store('tab') || 'home';
  document.title = S.tree.name + ' – Gia phả';
  shell();
  D.watchPersons(id, (list, err) => {
    if (err) { toast(D.errMsg(err), 4000); return; }
    try {
      S.persons = list; S.A = analyze(list, S.tree.anchorId);
      renderTab(true);
      if (S.jumpAfterLoad && S.A.byId.has(S.jumpAfterLoad)) { const j = S.jumpAfterLoad; S.jumpAfterLoad = null; go('tree'); setTimeout(() => jumpTo(j), 150); }
      if (store('pendingLink') && list.length && !S.linkBusy) {
        const c = store('pendingLink'); store('pendingLink', null); S.linkBusy = true;
        if (!canEdit()) toast('Cần quyền biên tập gia phả để liên kết hồ sơ.', 5000);
        else setTimeout(() => linkWithCode(null, c).finally(() => (S.linkBusy = false)), 300);
      }
    } catch (e) { console.error(e); toast('Lỗi hiển thị: ' + e.message, 4000); }
    if (sheetOpen() && S.sel && S.openPerson === S.sel && !S.formOpen) showPerson(S.sel, true);
  });
  loadLinks();
  if (canEdit()) D.listProposals(id).then((l) => { S.propCount = l.length; setBadge(); if (S.tab === 'home') renderTab(); }).catch(() => {});
}

function renderTab(fromData) {
  const sub = $('tsub'); if (sub && S.tree) sub.textContent = `${ROLE[S.role]} · ${S.persons.length} người`;
  const m = $('main'); if (!m) return;
  if (S.tab === 'tree') return S.tree ? renderTreeTab(fromData) : renderHome(m);
  if (fromData && ['props', 'log', 'users', 'trees', 'more'].includes(S.tab)) return;   // không phụ thuộc danh sách người
  S.pz = null;
  if (S.tab === 'home') return renderHome(m);
  if (S.tab === 'more') return renderMore(m);
  if (S.tab === 'users') return renderUsers(m);
  if (S.tab === 'trees') return renderTrees(m);
  if (!S.tree) return renderHome(m);
  if (S.tab === 'list') return renderList(m);
  if (S.tab === 'gio') return renderGio(m);
  if (S.tab === 'props') return renderProps(m);
  if (S.tab === 'log') return renderLog(m);
}

// ======================= Tổng quan =======================
function renderHome(m) {
  if (!S.tree) {
    m.innerHTML = `<div class="page"><div class="empty"><i class="fa-solid fa-book-open"></i>${D.isRoot()
      ? `Dòng họ chưa có gia phả nào.<br><br><button class="abtn blue" id="hNew"><i class="fa-solid fa-plus"></i>Tạo gia phả</button>`
      : 'Bạn chưa được cấp quyền xem gia phả nào.<br>Hãy liên hệ quản trị dòng họ.'}</div></div>`;
    if ($('hNew')) $('hNew').onclick = newTree;
    m.querySelector('.page').insertAdjacentHTML('afterbegin', shareBanners()); bindShareBanners(m);
    return;
  }
  const P = S.persons, ready = !!S.A;
  const gens = ready ? new Set(P.map((p) => S.A.shown(p.id)).filter((g) => g !== null && g >= 1)).size : 0;
  const U = ready ? upcoming() : { gio: [], sn: [] };
  const gio = [...U.gio, ...U.sn].filter((x) => x.n.daysLeft <= 30).sort((a, b) => a.n.daysLeft - b.n.daysLeft);
  const today = new Date(), tl = solarToLunar(today.getDate(), today.getMonth() + 1, today.getFullYear());
  m.innerHTML = `<div class="page">
    ${shareBanners()}
    <div class="hello"><div><small>Hôm nay ${fmtD([today.getDate(), today.getMonth() + 1, today.getFullYear()])}</small><b>Âm lịch ${formatLunar(tl)}</b></div><i class="fa-solid fa-moon"></i></div>
    <div class="stats">
      <div class="stat"><div class="k"><i class="fa-solid fa-users"></i> Tổng số</div><div class="v">${P.length}</div></div>
      <div class="stat"><div class="k"><i class="fa-solid fa-layer-group"></i> Số đời</div><div class="v">${gens}</div></div>
      <div class="stat"><div class="k"><i class="fa-solid fa-heart-pulse"></i> Còn sống</div><div class="v">${P.filter((p) => !isDead(p)).length}</div></div>
      <div class="stat"><div class="k"><i class="fa-solid fa-dove"></i> Đã mất</div><div class="v">${P.filter(isDead).length}</div></div>
    </div>
    ${S.propCount && canEdit() ? `<div class="panel" style="margin-top:14px"><div class="item" data-go="props"><div class="ic warn"><i class="fa-solid fa-inbox"></i></div><div class="t"><b>${S.propCount} đề xuất chờ xử lý</b><span>Thành viên gửi thông tin cần sửa</span></div><i class="fa-solid fa-chevron-right" style="color:var(--muted)"></i></div></div>` : ''}
    <div class="sec"><i class="fa-solid fa-bell"></i> Giỗ, sinh nhật 30 ngày tới <span class="n">${gio.length}</span></div>
    <div class="panel">${gio.length ? gio.slice(0, 10).map(eventItem).join('')
      : `<div class="empty" style="padding:20px">${ready ? 'Không có ngày giỗ, sinh nhật nào trong 30 ngày tới' : '<i class="fa-solid fa-circle-notch fa-spin"></i>Đang tải…'}</div>`}</div>
    <div class="sec"><i class="fa-solid fa-bolt"></i> Truy cập nhanh</div>
    <div class="qgrid">
      <button data-go="tree"><i class="fa-solid fa-sitemap"></i>Xem cây</button>
      <button data-go="list"><i class="fa-solid fa-magnifying-glass"></i>Tìm người</button>
      ${canEdit() ? '<button data-act="add"><i class="fa-solid fa-user-plus"></i>Thêm người</button>' : ''}
      <button data-act="csv"><i class="fa-solid fa-file-excel"></i>Xuất Excel</button>
    </div>
  </div>`;
  m.querySelectorAll('[data-p]').forEach((el) => (el.onclick = () => showPerson(el.dataset.p)));
  m.querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => go(el.dataset.go)));
  m.querySelectorAll('[data-act]').forEach((el) => (el.onclick = () => (el.dataset.act === 'add' ? personForm(null, { mode: 'first' }) : exportCsv())));
  bindShareBanners(m);
}

// ======================= Tab Cây =======================
function renderTreeTab(fromData) {
  const m = $('main');
  if (!S.persons.length) {
    S.pz = null;
    m.innerHTML = `<div class="page"><div class="empty"><i class="fa-solid fa-seedling"></i>Gia phả chưa có ai.<br>${canEdit()
      ? 'Bắt đầu từ người bạn biết rõ nhất (ông tổ, ông nội hoặc chính bạn). Có thể thêm ngược lên trên hoặc xuống dưới sau.<br><br><button class="abtn blue" id="first"><i class="fa-solid fa-user-plus"></i>Thêm người đầu tiên</button>'
      : 'Chủ gia phả chưa nhập dữ liệu.'}</div></div>`;
    if ($('first')) $('first').onclick = () => personForm(null, { mode: 'first' });
    return;
  }
  if (!S.pz || !$('tbox')) {
    m.innerHTML = `<div class="tbox" id="tbox"><svg id="tsvg" xmlns="http://www.w3.org/2000/svg"></svg>
      <div class="tsearch"><div class="search"><i class="fa-solid fa-magnifying-glass"></i><input id="tq" placeholder="Tìm người trên cây…" autocomplete="off"><button class="clr" id="tqx" hidden><i class="fa-solid fa-xmark"></i></button></div><div class="panel sres" id="tres" hidden></div></div>
      <div class="tools"><button class="ibtn" id="zin" title="Phóng to"><i class="fa-solid fa-plus"></i></button><button class="ibtn" id="zout" title="Thu nhỏ"><i class="fa-solid fa-minus"></i></button>
      <button class="ibtn" id="zfit" title="Xem toàn bộ"><i class="fa-solid fa-expand"></i></button>${canEdit() ? '<button class="ibtn" id="zadd" title="Thêm người (chưa nối)"><i class="fa-solid fa-user-plus"></i></button>' : ''}</div></div>`;
    S.pz = panZoom($('tbox'), $('tsvg'), {
      onTap: (id) => { S.sel = id; drawTree(); showPerson(id); },
      onToggle: (id) => { S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id); store('col_' + S.tree.id, [...S.collapsed]); drawTree(); },
    });
    $('zin').onclick = () => S.pz.zoom(1.25); $('zout').onclick = () => S.pz.zoom(0.8); $('zfit').onclick = () => S.pz.fit();
    if ($('zadd')) $('zadd').onclick = () => personForm(null, { mode: 'first' });
    const q = $('tq'), res = $('tres');
    q.oninput = () => {
      const t = fold(q.value.trim()); $('tqx').hidden = !t;
      if (!t) { res.hidden = true; return; }
      const hit = S.persons.filter((p) => fold(pname(p) + ' ' + (p.nick || '')).includes(t)).slice(0, 30);
      res.hidden = false;
      res.innerHTML = hit.length ? hit.map((p) => `<div class="item" data-go="${esc(p.id)}">${avatar(p)}<div class="t"><b>${esc(pname(p))}</b><span>${esc([S.A.label(p.id), lifeText(p)].filter(Boolean).join(' · '))}</span></div></div>`).join('') : '<div class="empty" style="padding:16px">Không tìm thấy</div>';
      res.querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => { res.hidden = true; q.value = ''; $('tqx').hidden = true; jumpTo(el.dataset.go); }));
    };
    $('tqx').onclick = () => { q.value = ''; q.oninput(); q.focus(); };
  }
  drawTree();
  if (S.firstFit) { S.firstFit = false; requestAnimationFrame(() => S.pz.fit()); }
}
let LAYOUT = null;
function drawTree() {
  if (!S.A || !$('tsvg')) return;
  LAYOUT = layout(S.A, S.collapsed);
  renderTree($('tsvg'), LAYOUT, S.A, S.sel, new Set(S.links ? S.links.keys() : []));
}
// tên trên cây được đo theo font Be Vietnam Pro → vẽ lại khi font tải xong
if (document.fonts) document.fonts.ready.then(() => { if (S.tab === 'tree') drawTree(); });
function jumpTo(id, open = true) {
  // mở các nhánh đang thu gọn chứa người này
  let p = byId(id), changed = false;
  const up = (x) => (x && (S.A.has(x.fatherId) ? byId(x.fatherId) : S.A.has(x.motherId) ? byId(x.motherId) : null));
  let cur = S.A.spouseIn.has(id) ? byId((p.spouseIds || []).find((s) => S.A.has(s))) : p;
  for (let a = up(cur); a; a = up(a)) if (S.collapsed.delete(a.id)) changed = true;
  if (changed) store('col_' + S.tree.id, [...S.collapsed]);
  S.sel = id; drawTree();
  const n = LAYOUT.nodes.find((x) => x.p.id === id);
  if (n) S.pz.center(n.x, n.y);
  if (open) showPerson(id);
}

// ======================= Hồ sơ một người =======================
function showPerson(id, refresh) {
  const p = byId(id); if (!p) { if (refresh) closeSheet(true); return; }
  S.openPerson = id; S.formOpen = false;
  const A = S.A, f = byId(p.fatherId), mo = byId(p.motherId);
  const spouses = (p.spouseIds || []).map(byId).filter(Boolean);
  const kids = S.persons.filter((k) => k.fatherId === id || k.motherId === id).sort((a, b) => (a.order || 99) - (b.order || 99) || yearOf(a.birthSolar) - yearOf(b.birthSolar));
  const relBtns = (arr) => arr.map((x) => `<button class="${x.gender === 'f' ? 'f' : 'm'}" data-p="${esc(x.id)}">${esc(pname(x))}</button>`).join('');
  const bl = lunarOf(p.birthSolar), dl = lunarOf(p.deathSolar), gio = isDead(p) && gioOf(p), next = gio && nextDeathAnniversary(gio[0], gio[1]);
  const row = (ic, k, v) => (v ? `<div class="r"><i class="fa-solid ${ic}"></i><span>${k}</span><b>${v}</b></div>` : '');
  const html = `
    <div class="phead">${avatar(p, 'ph')}<div style="min-width:0"><h2>${esc(pname(p))}</h2>
      <div class="pg">${esc(A.label(id))}${A.spouseIn.has(id) ? (p.gender === 'f' ? ' · con dâu' : ' · con rể') : ''}${S.tree.anchorId === id ? ' · <i class="fa-solid fa-flag"></i> mốc đời 1' : ''}</div>
      <div>${p.nick ? `<span class="tag">Thường gọi: ${esc(p.nick)}</span>` : ''}${p.alias ? `<span class="tag">Tên húy: ${esc(p.alias)}</span>` : ''}${p.branch ? `<span class="tag">${esc(p.branch)}</span>` : ''}${p.adopted ? '<span class="tag">Con nuôi</span>' : ''}</div></div></div>
    <div class="rows">
      ${row('fa-venus-mars', 'Giới tính', p.gender === 'f' ? 'Nữ' : 'Nam')}
      ${row('fa-cake-candles', 'Sinh', p.birthSolar || p.birthLunar ? `${esc(p.birthSolar || '')}${bl ? `<small>Âm lịch: ${formatLunar(bl)}</small>` : p.birthLunar ? `<small>Âm lịch: ${esc(p.birthLunar)}</small>` : ''}` : '')}
      ${isDead(p) ? row('fa-dove', 'Mất', `${esc(p.deathSolar || '') || (p.deathLunar ? '' : 'Đã mất')}${dl ? `<small>Âm lịch: ${formatLunar(dl)}</small>` : p.deathLunar ? `<small>Âm lịch: ${esc(p.deathLunar)}</small>` : ''}`) : ''}
      ${(() => { const b = nextBirthday(p); return b ? row('fa-gift', 'Sinh nhật', `${fmtD(b.solar)}${b.lunar ? ' (âm lịch)' : ''}<small>${b.daysLeft ? 'còn ' + b.daysLeft + ' ngày' : 'hôm nay'} · tròn ${b.age} tuổi${b.tho ? ' · mừng thọ' : ''}</small>`) : ''; })()}
      ${next ? row('fa-fire-flame-curved', 'Giỗ', `${gio[0]}/${gio[1]} âm lịch<small>Năm nay: ${fmtD(next.solar)} · ${next.daysLeft ? `còn ${next.daysLeft} ngày` : 'hôm nay'}</small>`) : ''}
      ${row('fa-location-dot', 'Nơi sinh', esc(p.birthPlace))}
      ${row('fa-house', 'Nơi ở', esc(p.address))}
      ${row('fa-monument', 'An táng', esc(p.burial))}
      ${row('fa-briefcase', 'Nghề nghiệp', esc(p.job))}
    </div>
    ${p.note ? `<div class="fsec"><i class="fa-regular fa-note-sticky"></i>Ghi chú</div><div style="white-space:pre-wrap;font-size:var(--fs-md);margin-top:6px">${esc(p.note)}</div>` : ''}
    <div class="fsec"><i class="fa-solid fa-people-roof"></i>Quan hệ</div>
    <div class="rows">
      <div class="r"><span>Cha</span><b class="rel">${f ? relBtns([f]) : '—'}</b></div>
      <div class="r"><span>Mẹ</span><b class="rel">${mo ? relBtns([mo]) : '—'}</b></div>
      <div class="r"><span>${p.gender === 'f' ? 'Chồng' : 'Vợ'}</span><b class="rel">${spouses.length ? relBtns(spouses) : '—'}</b></div>
      <div class="r"><span>Con (${kids.length})</span><b class="rel">${kids.length ? relBtns(kids) : '—'}</b></div>
    </div>
    ${canEdit() ? `<div class="sacts">
      <button class="abtn blue full" data-a="edit"><i class="fa-solid fa-pen"></i>Sửa thông tin</button>
      <button class="abtn" data-a="child"><i class="fa-solid fa-child"></i>Thêm con</button>
      <button class="abtn" data-a="spouse"><i class="fa-solid fa-ring"></i>Thêm ${p.gender === 'f' ? 'chồng' : 'vợ'}</button>
      <button class="abtn" data-a="parent" ${f && mo ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i>Thêm ${!f ? 'cha' : 'mẹ'}</button>
      <button class="abtn" data-a="insert" ${f || mo ? '' : 'disabled'}><i class="fa-solid fa-arrows-up-down"></i>Chèn đời ở giữa</button>
      <button class="abtn" data-a="link"><i class="fa-solid fa-link"></i>Nối quan hệ</button>
      ${isOwner() && S.tree.anchorId !== id ? '<button class="abtn" data-a="anchor"><i class="fa-solid fa-flag"></i>Đặt làm đời 1</button>' : ''}
      <button class="abtn red ${isOwner() && S.tree.anchorId !== id ? '' : 'full'}" data-a="del"><i class="fa-solid fa-trash"></i>Xóa</button>
    </div>` : S.role === 'viewer' ? '' : `<div class="sacts"><button class="abtn blue full" data-a="propose"><i class="fa-solid fa-paper-plane"></i>Đề xuất sửa thông tin</button></div>`}
    ${linksBlock(p)}
    <p style="font-size:var(--fs-sm);color:var(--muted);margin-top:14px;text-align:center">Cập nhật ${esc(ago(p.updatedAt))}</p>`;
  if (refresh) { const sc = $('sheet').scrollTop; $('sheet').innerHTML = `<div class="grab"></div>${html}`; $('sheet').scrollTop = sc; }
  else openSheet(html);
  const sh = $('sheet');
  sh.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { S.sel = b.dataset.p; if (S.tab === 'tree' && S.pz) jumpTo(b.dataset.p); else showPerson(b.dataset.p, true); }));
  sh.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => personAction(p, b.dataset.a)));
  bindLinks(p);
}

async function personAction(p, a) {
  if (a === 'edit') return personForm(p, { mode: 'edit' });
  if (a === 'child') return personForm(null, { mode: 'child', of: p });
  if (a === 'spouse') return personForm(null, { mode: 'spouse', of: p });
  if (a === 'parent') return personForm(null, { mode: 'parent', of: p, as: byId(p.fatherId) ? 'f' : 'm' });
  if (a === 'insert') return personForm(null, { mode: 'insert', of: p });
  if (a === 'link') return linkForm(p);
  if (a === 'propose') return propose(p);
  if (a === 'share') return shareForLink(p);
  if (a === 'linkcode') return linkWithCode(p);
  if (a === 'anchor') {
    if (!(await ask({ title: 'Đặt làm mốc đời 1?', msg: `<b>${esc(pname(p))}</b> sẽ là đời 1. Những người phía trên hiện là "Thượng tổ".`, ok: 'Đặt mốc' }))) return;
    try { await D.updateTree(S.tree.id, { anchorId: p.id }); S.tree.anchorId = p.id; S.A = analyze(S.persons, p.id); renderTab(true); showPerson(p.id, true); toast('Đã đặt mốc đời 1'); }
    catch (e) { toast(D.errMsg(e), 4000); }
    return;
  }
  if (a === 'del') {
    const kids = S.persons.filter((k) => k.fatherId === p.id || k.motherId === p.id).length;
    if (!(await ask({ title: 'Xóa người này?', msg: `Xóa <b>${esc(pname(p))}</b> khỏi gia phả.${kids ? ` ${kids} người con sẽ bị tách khỏi cây (vẫn giữ hồ sơ).` : ''} Lịch sử vẫn lưu trong Nhật ký.`, ok: 'Xóa', danger: true }))) return;
    busy('Đang xóa…');
    try { await D.deletePerson(S.tree.id, p, S.persons); busy(); closeSheet(true); toast('Đã xóa'); }
    catch (e) { busy(); toast(D.errMsg(e), 4000); }
  }
}

// ======================= Form thêm / sửa =======================
const FIELDS = ['name', 'nick', 'alias', 'gender', 'branch', 'order', 'adopted', 'birthSolar', 'birthLunar', 'alive', 'deathSolar', 'deathLunar', 'birthPlace', 'address', 'burial', 'job', 'note', 'photo'];
function personForm(p, ctx) {
  const of = ctx.of, isNew = !p;
  const d = p ? { ...p } : { gender: 'm', alive: true };
  if (ctx.mode === 'spouse') d.gender = of.gender === 'f' ? 'm' : 'f';
  if (ctx.mode === 'parent') d.gender = ctx.as;   // as = giới tính người cha/mẹ cần thêm
  if (ctx.mode === 'parent' || ctx.mode === 'insert') d.alive = isDead(of) ? false : true;
  if (ctx.mode === 'insert') d.gender = byId(of.fatherId) ? 'm' : 'f';
  if (ctx.mode === 'child') {
    const sibs = S.persons.filter((k) => k.fatherId === of.id || k.motherId === of.id);
    d.order = sibs.length + 1;
  }
  const title = { first: 'Thêm người', edit: 'Sửa thông tin', child: `Thêm con của ${pname(of)}`, spouse: `Thêm ${of && of.gender === 'f' ? 'chồng' : 'vợ'} của ${pname(of)}`,
    parent: `Thêm ${ctx.as === 'm' ? 'cha' : 'mẹ'} của ${pname(of)}`, insert: `Chèn đời giữa ${pname(of)} và ${pname(byId(of && (of.fatherId || of.motherId)))}` }[ctx.mode];
  // chọn cha/mẹ còn lại khi thêm con
  let otherSel = '';
  if (ctx.mode === 'child') {
    const sp = (of.spouseIds || []).map(byId).filter(Boolean);
    otherSel = `<div class="fld full"><label>${of.gender === 'f' ? 'Cha' : 'Mẹ'}</label><select id="f_other"><option value="">— Chưa rõ —</option>${sp.map((s, i) => `<option value="${esc(s.id)}" ${i === 0 ? 'selected' : ''}>${esc(pname(s))}</option>`).join('')}</select></div>`;
  }
  const html = `<h2 style="margin:0 0 4px;font-size:var(--fs-2xl)">${esc(title)}</h2>
    ${ctx.mode === 'insert' ? '<p style="font-size:var(--fs-base);color:var(--muted);margin:0">Người mới sẽ là con của đời trên và là cha/mẹ của người đang chọn. Số đời phía dưới tự tăng 1.</p>' : ''}
    <form id="pf">
    <div class="phw"><div class="ph ${d.gender === 'f' ? 'f' : 'm'}" id="fph">${d.photo ? `<img src="${esc(d.photo)}">` : '<i class="fa-solid fa-camera"></i>'}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="abtn sm" id="fphb"><i class="fa-solid fa-image"></i>Chọn ảnh</button>${d.photo ? '<button type="button" class="abtn sm red" id="fphx">Bỏ ảnh</button>' : ''}</div></div>
    <div class="fgrid">
      <div class="fld full"><label>Họ và tên</label><input id="f_name" value="${esc(d.name || '')}" placeholder="Để trống nếu chưa rõ" maxlength="120"></div>
      <div class="fld full"><label>Giới tính</label><div class="seg"><label><input type="radio" name="g" value="m" ${d.gender !== 'f' ? 'checked' : ''}>Nam</label><label><input type="radio" name="g" value="f" ${d.gender === 'f' ? 'checked' : ''}>Nữ</label></div></div>
      ${otherSel}
      <div class="fld"><label>Tên thường gọi</label><input id="f_nick" value="${esc(d.nick || '')}"></div>
      <div class="fld"><label>Tên húy / tự / hiệu</label><input id="f_alias" value="${esc(d.alias || '')}"></div>
      <div class="fld"><label>Chi / phái</label><input id="f_branch" value="${esc(d.branch || '')}" list="branches"></div>
      <div class="fld"><label>Con thứ</label><input id="f_order" type="number" min="1" max="30" value="${esc(d.order || '')}"></div>
      <label class="ck full"><input type="checkbox" id="f_adopted" ${d.adopted ? 'checked' : ''}>Con nuôi</label>
    </div>
    <div class="fsec"><i class="fa-solid fa-cake-candles"></i>Ngày sinh</div>
    <div class="fgrid">
      <div class="fld"><label>Dương lịch</label><input id="f_birthSolar" value="${esc(d.birthSolar || '')}" placeholder="dd/mm/yyyy" inputmode="numeric" maxlength="10" data-mask="solar"><div class="hint" id="h_birthSolar">Chỉ nhớ năm: gõ 4 số</div></div>
      <div class="fld"><label>Âm lịch</label><input id="f_birthLunar" value="${esc(d.birthLunar || '')}" placeholder="tự tính từ ngày dương" inputmode="numeric" maxlength="10" data-mask="solar"><div class="hint" id="h_birthLunar"></div></div>
    </div>
    <label class="ck"><input type="checkbox" id="f_dead" ${d.alive === false || d.deathSolar || d.deathLunar ? 'checked' : ''}>Đã mất</label>
    <div id="deadBox">
      <div class="fgrid">
        <div class="fld"><label>Ngày mất dương lịch</label><input id="f_deathSolar" value="${esc(d.deathSolar || '')}" placeholder="dd/mm/yyyy" inputmode="numeric" maxlength="10" data-mask="solar"><div class="hint" id="h_deathSolar">Chỉ nhớ năm: gõ 4 số</div></div>
        <div class="fld"><label>Ngày mất âm lịch (giỗ)</label><input id="f_deathLunar" value="${esc(d.deathLunar || '')}" placeholder="tự tính từ ngày dương" inputmode="numeric" maxlength="10" data-mask="dm"><div class="hint" id="h_deathLunar"></div></div>
        <div class="fld full"><label>Nơi an táng</label><input id="f_burial" value="${esc(d.burial || '')}"></div>
      </div>
    </div>
    <div class="fsec"><i class="fa-solid fa-circle-info"></i>Thông tin khác</div>
    <div class="fgrid">
      <div class="fld"><label>Nơi sinh / quê</label><input id="f_birthPlace" value="${esc(d.birthPlace || '')}"></div>
      <div class="fld"><label>Nơi ở</label><input id="f_address" value="${esc(d.address || '')}"></div>
      <div class="fld full"><label>Nghề nghiệp, học vị, chức vụ</label><input id="f_job" value="${esc(d.job || '')}"></div>
      <div class="fld full"><label>Ghi chú, tiểu sử</label><textarea id="f_note" maxlength="5000">${esc(d.note || '')}</textarea></div>
    </div>
    <datalist id="branches">${[...new Set(S.persons.map((x) => x.branch).filter(Boolean))].map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
    <div class="fbar"><button type="button" class="abtn" id="fcancel">Hủy</button><button class="abtn blue"><i class="fa-solid fa-check"></i>Lưu</button></div>
    </form>`;
  let dirty = false, photo = d.photo || '';
  openSheet(html, { beforeClose: () => (dirty ? (confirmLeave(), false) : true) });
  S.formOpen = true;
  const sh = $('sheet');
  sh.querySelectorAll('input,select,textarea').forEach((el) => el.addEventListener('input', () => (dirty = true)));
  const deadToggle = () => ($('deadBox').hidden = !$('f_dead').checked);
  $('f_dead').onchange = deadToggle; deadToggle();
  sh.querySelectorAll('input[name=g]').forEach((r) => (r.onchange = () => ($('fph').className = 'ph ' + (r.value === 'f' ? 'f' : 'm'))));
  // ô ngày: chỉ gõ số, tự chèn "/" (dd/mm/yyyy). Ô dương lịch: gõ 4 số = chỉ nhớ năm.
  sh.querySelectorAll('[data-mask]').forEach((el) => el.addEventListener('input', (e) => maskDate(el, e)));
  // Tự tính 2 chiều: nhập đủ ngày dương → điền ngày âm; nhập đủ ngày âm (có năm) → điền ngày dương.
  // Chỉ điền vào ô đang trống hoặc trước đó do app tự điền (data-auto); ô người dùng tự gõ thì giữ nguyên.
  const lunarStr = (v) => { const l = lunarOf(v); return l ? fmtD(l) : ''; };
  const solarStr = (v) => { const x = fullDate(v); if (!x) return ''; const s = lunarToSolar(x[0], x[1], x[2]); return s[0] ? fmtD(s) : ''; };
  const fill = (el, v) => { if (v === el.value) return; el.value = v; AUTO_FILL = true; el.dispatchEvent(new Event('input')); AUTO_FILL = false; };
  for (const [sol, lun] of [['birthSolar', 'birthLunar'], ['deathSolar', 'deathLunar']]) {
    const a = $('f_' + sol), b = $('f_' + lun);
    if (!b.value || b.value === lunarStr(a.value)) b.dataset.auto = '1';
    if (!a.value || (b.value && a.value === solarStr(b.value))) a.dataset.auto = '1';
    a.addEventListener('input', () => {
      if (AUTO_FILL) return;
      delete a.dataset.auto;                       // người dùng tự gõ ngày dương
      if (b.dataset.auto || !b.value) { b.dataset.auto = '1'; fill(b, lunarStr(a.value)); }
    });
    b.addEventListener('input', () => {
      if (AUTO_FILL) return;
      delete b.dataset.auto;                       // người dùng tự gõ ngày âm
      if (a.dataset.auto || !a.value) { a.dataset.auto = '1'; fill(a, solarStr(b.value)); }
    });
  }
  // gợi ý đổi âm / dương khi gõ ngày
  const hint = (id, fn, empty = '') => { const el = $('f_' + id), h = $('h_' + id); const run = () => { const v = el.value.trim(); if (!v) { h.textContent = empty; h.className = 'hint'; return; } const r = fn(v); h.textContent = r[0]; h.className = 'hint ' + (r[1] || ''); }; el.addEventListener('input', run); run(); };
  const solarHint = (v) => { if (!validDate(v)) return ['Ngày không hợp lệ', 'bad']; const l = lunarOf(v); return l ? ['Âm: ' + formatLunar(l), 'ok'] : [yearOf(v) ? 'Năm ' + yearCanChi(yearOf(v)) : '']; };
  const lunarHint = (v) => {
    if ($('f_birthLunar').dataset.auto && lunarOf($('f_birthSolar').value)) return ['Tự tính: ' + formatLunar(lunarOf($('f_birthSolar').value)), 'ok'];
    if (!validDate(v)) return ['Ngày không hợp lệ', 'bad'];
    const x = parseDate(v); if (!(x[0] && x[1] && x[2])) return [x[2] ? 'Năm ' + yearCanChi(x[2]) : ''];
    const s = lunarToSolar(x[0], x[1], x[2]); return s[0] ? ['Dương: ' + fmtD(s), 'ok'] : ['Ngày âm không tồn tại', 'bad'];
  };
  hint('birthSolar', solarHint, 'Chỉ nhớ năm: gõ 4 số'); hint('deathSolar', solarHint, 'Chỉ nhớ năm: gõ 4 số'); hint('birthLunar', lunarHint);
  hint('deathLunar', (v) => { if (!validDate(v)) return ['Ngày không hợp lệ', 'bad']; const dl = $('f_deathLunar').dataset.auto && lunarOf($('f_deathSolar').value); const x = parseDate(v); if (!(x[0] && x[1])) return ['Cần ngày và tháng âm để tính giỗ', 'bad']; const n = nextDeathAnniversary(x[0], x[1]); return n ? [`${dl ? 'Tự tính ' + formatLunar(dl) + ' · ' : ''}Giỗ năm nay: ${fmtD(n.solar)}`, 'ok'] : ['']; });
  // ảnh
  $('fphb').onclick = () => { $('photoIn').value = ''; $('photoIn').click(); };
  $('photoIn').onchange = async () => {
    const f = $('photoIn').files[0]; if (!f) return;
    try { photo = await fileToAvatar(f); dirty = true; $('fph').innerHTML = `<img src="${photo}">`; } catch (e) { toast('Không đọc được ảnh'); }
  };
  if ($('fphx')) $('fphx').onclick = () => { photo = ''; dirty = true; $('fph').innerHTML = '<i class="fa-solid fa-camera"></i>'; };
  $('fcancel').onclick = () => closeSheet();
  function confirmLeave() {
    ask({ title: 'Bỏ thay đổi?', msg: 'Thông tin vừa nhập chưa được lưu.', ok: 'Bỏ', danger: true }).then((ok) => { if (ok) { dirty = false; closeSheet(true); back(); } });
  }
  const back = () => { S.formOpen = false; if (p) setTimeout(() => showPerson(p.id), 250); else if (of) setTimeout(() => showPerson(of.id), 250); };

  $('pf').onsubmit = async (e) => {
    e.preventDefault();
    const v = (k) => ($('f_' + k) ? $('f_' + k).value.trim() : '');
    const dead = $('f_dead').checked;
    const data = {
      name: v('name'), nick: v('nick'), alias: v('alias'), branch: v('branch'), gender: sh.querySelector('input[name=g]:checked').value,
      order: Number(v('order')) || null, adopted: $('f_adopted').checked, birthSolar: v('birthSolar'), birthLunar: v('birthLunar'),
      alive: !dead, deathSolar: dead ? v('deathSolar') : '', deathLunar: dead ? v('deathLunar') : '', burial: dead ? v('burial') : '',
      birthPlace: v('birthPlace'), address: v('address'), job: v('job'), note: v('note'), photo,
    };
    for (const k of ['birthSolar', 'deathSolar', 'birthLunar', 'deathLunar']) if (!validDate(data[k])) { toast('Ngày tháng chưa hợp lệ'); $('f_' + k).focus(); return; }
    if (data.birthLunar && !(fullDate(data.birthLunar) || yearOf(data.birthLunar))) { toast('Ngày sinh âm cần có năm'); return; }
    // cảnh báo: con sinh trước cha mẹ
    const by = yearOf(data.birthSolar);
    const warn = [];
    if (by && p) for (const k of S.persons.filter((k) => k.fatherId === p.id || k.motherId === p.id)) { const ky = yearOf(k.birthSolar); if (ky && ky - by < 12) warn.push(`${pname(k)} (sinh ${ky})`); }
    if (warn.length && !(await ask({ title: 'Kiểm tra lại năm sinh', msg: `Năm sinh ${by} quá gần hoặc sau năm sinh của con: ${esc(warn.join(', '))}. Vẫn lưu?`, ok: 'Vẫn lưu' }))) return;
    busy('Đang lưu…');
    try {
      await save(p, data, ctx, v('other'));
      dirty = false; busy(); closeSheet(true); toast('Đã lưu');
      S.formOpen = false;
    } catch (er) { busy(); toast(D.errMsg(er), 4000); }
  };
}

/** Ghi theo từng kiểu thêm: tạo người mới + nối quan hệ trong cùng 1 batch */
async function save(p, data, ctx, otherId) {
  const T = S.tree.id, of = ctx.of, cur = S.A ? S.A.byId : new Map();
  if (p) {   // sửa: chỉ ghi các trường thay đổi
    const ch = {};
    for (const k of FIELDS) { const a = p[k] ?? '', b = data[k] ?? ''; if (String(a) !== String(b)) ch[k] = data[k]; }
    if (!Object.keys(ch).length) return;
    await D.saveChanges(T, { updates: [{ id: p.id, ...ch }] }, cur);
    S.sel = p.id; return;
  }
  const nid = D.newPersonId(T);
  const add = { id: nid, ...data, fatherId: '', motherId: '', spouseIds: [] }, updates = [];
  if (ctx.mode === 'child') {
    add[of.gender === 'f' ? 'motherId' : 'fatherId'] = of.id;
    if (otherId) add[of.gender === 'f' ? 'fatherId' : 'motherId'] = otherId;
  } else if (ctx.mode === 'spouse') {
    add.spouseIds = [of.id];
    updates.push({ id: of.id, spouseIds: D.rel.add(nid), _log: false });
  } else if (ctx.mode === 'parent') {
    const key = data.gender === 'f' ? 'motherId' : 'fatherId';
    if (byId(of[key])) throw new Error(`${pname(of)} đã có ${key === 'fatherId' ? 'cha' : 'mẹ'}.`);
    updates.push({ id: of.id, [key]: nid });
    // đã có cha (hoặc mẹ) → người mới là vợ/chồng của người đó
    const other = byId(of[key === 'fatherId' ? 'motherId' : 'fatherId']);
    if (other) { add.spouseIds = [other.id]; updates.push({ id: other.id, spouseIds: D.rel.add(nid), _log: false }); }
  } else if (ctx.mode === 'insert') {
    // chèn X giữa "of" và đời trên: X nhận cha/mẹ cũ của "of", "of" nhận X làm cha (hoặc mẹ)
    add.fatherId = of.fatherId || ''; add.motherId = of.motherId || '';
    updates.push({ id: of.id, fatherId: data.gender === 'f' ? '' : nid, motherId: data.gender === 'f' ? nid : '' });
  }
  await D.saveChanges(T, { adds: [add], updates }, cur);
  S.sel = nid;
  if (S.tab === 'tree' && S.pz) setTimeout(() => jumpTo(nid, false), 50);
}

/** Nối quan hệ giữa 2 người đã có (cha, mẹ, vợ/chồng) – dùng để gộp nhánh rời */
async function linkForm(p) {
  const others = S.persons.filter((x) => x.id !== p.id).sort((a, b) => pname(a).localeCompare(pname(b), 'vi'));
  const v = await ask({ title: `Nối quan hệ cho ${pname(p)}`, msg: 'Chọn người đã có trong gia phả.',
    fields: [{ id: 'k', type: 'select', value: 'father', options: [['father', 'Là cha của ' + pname(p)], ['mother', 'Là mẹ của ' + pname(p)], ['spouse', 'Là vợ/chồng của ' + pname(p)], ['child', 'Là con của ' + pname(p)], ['unspouse', 'Bỏ quan hệ vợ/chồng']] },
      { id: 'o', type: 'select', value: '', options: [['', '— Chọn người —'], ...others.map((x) => [x.id, `${pname(x)}${S.A.label(x.id) ? ' · ' + S.A.label(x.id) : ''}${lifeText(x) ? ' · ' + lifeText(x) : ''}`])] }],
    ok: 'Nối', validate: (v) => (!v.o ? 'Chưa chọn người' : '') });
  if (!v) return;
  const o = byId(v.o), updates = [];
  if (v.k === 'father' || v.k === 'mother') {
    if (wouldCycle(S.A, p.id, o.id)) return toast('Không được: người này là con cháu của ' + pname(p), 4000);
    updates.push({ id: p.id, [v.k + 'Id']: o.id });
  } else if (v.k === 'child') {
    if (wouldCycle(S.A, o.id, p.id)) return toast('Không được: ' + pname(p) + ' là con cháu của người này', 4000);
    updates.push({ id: o.id, [p.gender === 'f' ? 'motherId' : 'fatherId']: p.id });
  } else if (v.k === 'spouse') {
    updates.push({ id: p.id, spouseIds: D.rel.add(o.id) }, { id: o.id, spouseIds: D.rel.add(p.id), _log: false });
  } else {
    updates.push({ id: p.id, spouseIds: D.rel.remove(o.id) }, { id: o.id, spouseIds: D.rel.remove(p.id), _log: false });
  }
  busy('Đang lưu…');
  try { await D.saveChanges(S.tree.id, { updates }, S.A.byId); busy(); toast('Đã nối'); showPerson(p.id, true); }
  catch (e) { busy(); toast(D.errMsg(e), 4000); }
}

async function propose(p) {
  const v = await ask({ title: 'Đề xuất sửa', msg: `Gửi chủ gia phả / biên tập thông tin cần sửa hoặc bổ sung cho <b>${esc(pname(p))}</b>.`, fields: [{ id: 't', ph: 'Ví dụ: Ông mất ngày 12/3 âm lịch, an táng ở…' }], ok: 'Gửi', validate: (v) => (!v.t ? 'Chưa nhập nội dung' : '') });
  if (!v) return;
  try { await D.addProposal(S.tree.id, { personId: p.id, personName: pname(p), text: v.t }); toast('Đã gửi đề xuất'); }
  catch (e) { toast(D.errMsg(e), 4000); }
}

// ======================= Tab Danh sách =======================
function renderList(m) {
  const gens = [...new Set(S.persons.map((p) => S.A.shown(p.id)).filter((g) => g !== null))].sort((a, b) => a - b);
  m.innerHTML = `<div class="page">
    <div class="stats">
      <div class="stat"><div class="k">Tổng số</div><div class="v">${S.persons.length}</div></div>
      <div class="stat"><div class="k">Số đời</div><div class="v">${gens.filter((g) => g >= 1).length}</div></div>
      <div class="stat"><div class="k">Còn sống</div><div class="v">${S.persons.filter((p) => !isDead(p)).length}</div></div>
      <div class="stat"><div class="k">Đã mất</div><div class="v">${S.persons.filter(isDead).length}</div></div>
    </div>
    <div class="listbar">
      <div style="display:flex;gap:8px"><div class="search"><i class="fa-solid fa-magnifying-glass"></i><input id="lq" placeholder="Tìm tên (gõ không dấu cũng được)" value="${esc(S.q)}" autocomplete="off"><button class="clr" id="lqx" ${S.q ? '' : 'hidden'}><i class="fa-solid fa-xmark"></i></button></div>
        <button class="ibtn" id="csv" title="Xuất Excel (CSV)"><i class="fa-solid fa-file-excel"></i></button>${canEdit() ? '<button class="ibtn" id="ladd" title="Thêm người"><i class="fa-solid fa-user-plus"></i></button>' : ''}</div>
      <div class="filters">${[['all', 'Tất cả'], ['alive', 'Còn sống'], ['dead', 'Đã mất'], ['m', 'Nam'], ['f', 'Nữ'], ['loose', 'Chưa nối']].map(([k, n]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-f="${k}">${n}</button>`).join('')}
        <select class="chip" id="lgen" aria-label="Lọc theo đời"><option value="">Mọi đời</option>${gens.map((g) => `<option value="${g}" ${String(S.gen) === String(g) ? 'selected' : ''}>${esc(g >= 1 ? 'Đời ' + g : g === 0 ? 'Thượng tổ' : 'Thượng tổ ' + (1 - g))}</option>`).join('')}</select></div>
    </div>
    <div class="panel" id="lres"></div></div>`;
  const draw = () => {
    const t = fold(S.q.trim());
    const loose = (p) => !S.A.gen.has(p.id) || (!S.A.has(p.fatherId) && !S.A.has(p.motherId) && !(p.spouseIds || []).some(S.A.has) && !S.persons.some((k) => k.fatherId === p.id || k.motherId === p.id));
    const list = S.persons.filter((p) => (!t || fold([p.name, p.nick, p.alias, p.branch].join(' ')).includes(t))
      && (S.filter === 'all' || (S.filter === 'alive' && !isDead(p)) || (S.filter === 'dead' && isDead(p)) || (S.filter === 'm' && p.gender !== 'f') || (S.filter === 'f' && p.gender === 'f') || (S.filter === 'loose' && loose(p)))
      && (S.gen === '' || String(S.A.shown(p.id)) === String(S.gen)))
      .sort((a, b) => (S.A.gen.get(a.id) || 99) - (S.A.gen.get(b.id) || 99) || pname(a).localeCompare(pname(b), 'vi'));
    $('lres').innerHTML = list.length ? list.slice(0, 500).map((p) => `<div class="item" data-p="${esc(p.id)}">${avatar(p)}<div class="t"><b>${esc(pname(p))}</b><span>${esc([S.A.label(p.id), lifeText(p), p.branch].filter(Boolean).join(' · '))}</span></div>${isDead(p) ? '<span class="when info">Đã mất</span>' : ''}</div>`).join('')
      + (list.length > 500 ? `<div class="empty" style="padding:14px">… còn ${list.length - 500} người, hãy gõ tìm cụ thể hơn</div>` : '')
      : `<div class="empty"><i class="fa-solid fa-magnifying-glass"></i>Không có ai phù hợp</div>`;
    $('lres').querySelectorAll('[data-p]').forEach((el) => (el.onclick = () => { S.sel = el.dataset.p; showPerson(el.dataset.p); }));
  };
  $('lq').oninput = () => { S.q = $('lq').value; $('lqx').hidden = !S.q; draw(); };
  $('lqx').onclick = () => { S.q = ''; $('lq').value = ''; $('lqx').hidden = true; draw(); $('lq').focus(); };
  m.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { S.filter = b.dataset.f; m.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  $('lgen').onchange = () => { S.gen = $('lgen').value; draw(); };
  $('csv').onclick = exportCsv;
  if ($('ladd')) $('ladd').onclick = () => personForm(null, { mode: 'first' });
  draw();
}

function exportCsv() {
  const head = ['Mã', 'Đời', 'Họ tên', 'Tên thường gọi', 'Tên húy', 'Giới tính', 'Chi/phái', 'Con thứ', 'Con nuôi', 'Cha', 'Mẹ', 'Vợ/chồng',
    'Sinh (dương)', 'Sinh (âm)', 'Còn sống', 'Mất (dương)', 'Mất (âm)', 'Giỗ (âm)', 'Nơi sinh', 'Nơi ở', 'An táng', 'Nghề nghiệp', 'Ghi chú'];
  const rows = [...S.persons].sort((a, b) => (S.A.gen.get(a.id) || 99) - (S.A.gen.get(b.id) || 99)).map((p) => {
    const g = isDead(p) && gioOf(p);
    return [p.id, S.A.label(p.id), pname(p), p.nick, p.alias, p.gender === 'f' ? 'Nữ' : 'Nam', p.branch, p.order, p.adopted ? 'x' : '',
      byId(p.fatherId) ? pname(byId(p.fatherId)) : '', byId(p.motherId) ? pname(byId(p.motherId)) : '',
      (p.spouseIds || []).map(byId).filter(Boolean).map(pname).join('; '),
      p.birthSolar, p.birthLunar, isDead(p) ? 'Không' : 'Có', p.deathSolar, p.deathLunar, g ? `${g[0]}/${g[1]}` : '', p.birthPlace, p.address, p.burial, p.job, p.note];
  });
  const csv = '﻿' + [head, ...rows].map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${fold(S.tree.name).replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Đã xuất file');
}

// ======================= Tab Ngày giỗ =======================
const whenCls = (n) => (n <= 3 ? 'bad' : n <= 14 ? 'warn' : 'ok');
const whenTxt = (n) => (n ? n + ' ngày' : 'Hôm nay');
/** Danh sách sự kiện sắp tới: giỗ (người đã mất) + sinh nhật (người còn sống) */
function upcoming(today = new Date()) {
  const gio = S.persons.filter(isDead).map((p) => { const g = gioOf(p); const n = g && nextDeathAnniversary(g[0], g[1], today); return n && { p, kind: 'gio', g, n }; }).filter(Boolean);
  const sn = S.persons.map((p) => { const n = nextBirthday(p, today); return n && { p, kind: 'sn', n }; }).filter(Boolean);
  return { gio: gio.sort((a, b) => a.n.daysLeft - b.n.daysLeft), sn: sn.sort((a, b) => a.n.daysLeft - b.n.daysLeft) };
}
function eventItem(x) {
  const sub = x.kind === 'gio'
    ? `Giỗ ${x.g[0]}/${x.g[1]} âm · ${fmtD(x.n.solar)} · ${esc(S.A.label(x.p.id))}`
    : `Sinh nhật ${fmtD(x.n.solar)}${x.n.lunar ? ' (theo âm lịch)' : ''} · tròn ${x.n.age} tuổi`;
  const tag = x.kind === 'sn' && x.n.tho ? ` <span class="tag tho">Mừng thọ ${x.n.age}</span>` : '';
  return `<div class="item" data-p="${esc(x.p.id)}">${avatar(x.p)}<div class="t"><b>${esc(pname(x.p))}${tag}</b><span><i class="fa-solid ${x.kind === 'gio' ? 'fa-fire-flame-curved' : 'fa-cake-candles'}"></i> ${sub}</span></div>
    <span class="when ${whenCls(x.n.daysLeft)}">${whenTxt(x.n.daysLeft)}</span></div>`;
}
function renderGio(m) {
  S.cal = S.cal || 'gio';
  const today = new Date(), tl = solarToLunar(today.getDate(), today.getMonth() + 1, today.getFullYear());
  const U = upcoming(today), list = S.cal === 'gio' ? U.gio : U.sn;
  const soon = list.filter((x) => x.n.daysLeft <= 30), later = list.filter((x) => x.n.daysLeft > 30);
  const noDate = S.cal === 'gio' ? S.persons.filter((p) => isDead(p) && !gioOf(p)) : S.persons.filter((p) => !isDead(p) && !nextBirthday(p, today));
  const what = S.cal === 'gio' ? 'ngày giỗ' : 'sinh nhật';
  m.innerHTML = `<div class="page">
    <div class="sec"><i class="fa-regular fa-calendar"></i> Hôm nay ${fmtD([today.getDate(), today.getMonth() + 1, today.getFullYear()])} · âm lịch ${formatLunar(tl)}</div>
    <div class="seg segtab"><label><input type="radio" name="cal" value="gio" ${S.cal === 'gio' ? 'checked' : ''}><i class="fa-solid fa-fire-flame-curved"></i> Ngày giỗ (${U.gio.length})</label>
      <label><input type="radio" name="cal" value="sn" ${S.cal === 'sn' ? 'checked' : ''}><i class="fa-solid fa-cake-candles"></i> Sinh nhật (${U.sn.length})</label></div>
    <div class="sec"><i class="fa-solid fa-bell"></i> 30 ngày tới <span class="n">${soon.length}</span></div>
    <div class="panel">${soon.length ? soon.map(eventItem).join('') : `<div class="empty" style="padding:20px">Không có ${what} nào trong 30 ngày tới</div>`}</div>
    ${later.length ? `<div class="sec"><i class="fa-solid fa-calendar-days"></i> Cả năm <span class="n">${later.length}</span></div><div class="panel">${later.map(eventItem).join('')}</div>` : ''}
    ${noDate.length ? `<div class="sec"><i class="fa-solid fa-circle-question"></i> ${S.cal === 'gio' ? 'Chưa có ngày mất' : 'Chưa có ngày sinh đủ'} <span class="n">${noDate.length}</span></div><div class="panel">${noDate.map((p) => `<div class="item" data-p="${esc(p.id)}">${avatar(p)}<div class="t"><b>${esc(pname(p))}</b><span>${esc(S.A.label(p.id))} · ${S.cal === 'gio' ? 'cần bổ sung ngày mất âm lịch' : 'cần đủ ngày/tháng/năm sinh'}</span></div></div>`).join('')}</div>` : ''}
  </div>`;
  m.querySelectorAll('input[name=cal]').forEach((r) => (r.onchange = () => { S.cal = r.value; renderGio(m); }));
  m.querySelectorAll('[data-p]').forEach((el) => (el.onclick = () => showPerson(el.dataset.p)));
}

// ======================= Liên kết hồ sơ giữa 2 gia phả (nội – ngoại, họ vợ) – BA-lien-ket.md =======================
async function loadLinks() {
  if (!S.tree) return;
  try { S.links = await D.listLinks(S.tree.id); } catch (e) { S.links = new Map(); }
  if (S.tab === 'tree') drawTree();
  if (sheetOpen() && S.openPerson && !S.formOpen) showPerson(S.openPerson, true);
}
/** Khối "Liên kết gia phả khác" trong hồ sơ một người */
function linksBlock(p) {
  const arr = (S.links && S.links.get(p.id)) || [];
  if (!arr.length && !canEdit()) return '';
  return `<div class="fsec"><i class="fa-solid fa-link"></i>Liên kết gia phả khác</div>
    ${arr.length ? `<div class="rows">${arr.map((l) => `<div class="r lkrow"><i class="fa-solid fa-landmark"></i><div style="flex:1;min-width:0"><b>${esc(l.other.name)}</b>
        <small>${esc(l.other.clanName)} · ${esc(l.other.treeName)}${l.other.info ? ' · ' + esc(l.other.info) : ''}</small></div>
        <button class="abtn sm" data-lopen="${esc(l.id)}">Mở</button>${canEdit() ? `<button class="abtn sm red" data-lrm="${esc(l.id)}" title="Gỡ liên kết"><i class="fa-solid fa-link-slash"></i></button>` : ''}</div>`).join('')}</div>` : ''}
    ${canEdit() ? `<div class="sacts"><button class="abtn" data-a="share"><i class="fa-solid fa-share-nodes"></i>Gửi link liên kết</button><button class="abtn" data-a="linkcode"><i class="fa-solid fa-link"></i>Liên kết bằng mã</button></div>` : ''}`;
}
function bindLinks(p) {
  const sh = $('sheet');
  sh.querySelectorAll('[data-lopen]').forEach((b) => (b.onclick = () => openLinked(((S.links.get(p.id) || []).find((l) => l.id === b.dataset.lopen) || {}).other)));
  sh.querySelectorAll('[data-lrm]').forEach((b) => (b.onclick = async () => {
    const l = (S.links.get(p.id) || []).find((x) => x.id === b.dataset.lrm);
    if (!(await ask({ title: 'Gỡ liên kết?', msg: `<b>${esc(pname(p))}</b> sẽ không còn nối với <b>${esc(l.other.name)}</b> (${esc(l.other.clanName)}). Dữ liệu 2 gia phả không bị xóa.`, ok: 'Gỡ', danger: true }))) return;
    try { await D.removeLink(l.id); toast('Đã gỡ liên kết'); loadLinks(); } catch (e) { toast(D.errMsg(e), 4000); }
  }));
}
/** Bên có hồ sơ: tạo mã/link (hạn 7 ngày) gửi cho bên kia */
async function shareForLink(p) {
  const v = await ask({ title: 'Gửi link liên kết hồ sơ', msg: `Bên họ kia mở link / quét QR, đăng nhập tài khoản dòng họ của họ, rồi chọn người tương ứng với <b>${esc(pname(p))}</b>.`,
    fields: [{ id: 'd', type: 'select', value: '7', ph: 'Thời hạn', options: DAYS }], ok: 'Tạo link' });
  if (!v) return;
  busy('Đang tạo link…');
  let code;
  try { code = await D.createShareCode(S.tree, p, [S.A.label(p.id), lifeText(p)].filter(Boolean).join(' · '), Number(v.d)); }
  catch (e) { busy(); return toast(D.errMsg(e), 4000); }
  busy();
  showShareSheet({ title: 'Link liên kết hồ sơ', url: D.shareLink(code), expiresAt: Date.now() + Number(v.d) * 864e5,
    text: `Liên kết hồ sơ "${pname(p)}" (${D.clan.name}) trên app Gia phả`,
    note: `Gửi cho <b>quản trị / biên tập bên họ kia</b> để nối hồ sơ <b>${esc(pname(p))}</b>.` });
}
const codeFrom = (v) => { try { return new URL(v).searchParams.get('link') || v; } catch (e) { return v; } };
/** Bên nhận: liên kết người p (cây đang mở) với hồ sơ trong mã */
async function linkWithCode(p, code) {
  if (!code) {
    const how = await pick({ title: 'Liên kết bằng mã', options: [['scan', 'Quét mã QR'], ['paste', 'Dán link / mã']] });
    if (!how) return;
    if (how === 'scan') return scanAndHandle(p);
    const v = await ask({ title: 'Liên kết bằng mã', msg: `Dán link hoặc mã liên kết bên họ kia gửi cho <b>${esc(pname(p))}</b>.`, fields: [{ id: 'c', ph: 'Link hoặc mã liên kết' }], ok: 'Tiếp tục', validate: (v) => (!v.c ? 'Chưa nhập mã' : '') });
    if (!v) return;
    code = codeFrom(v.c.trim());
  }
  busy('Đang kiểm tra mã…');
  let sc;
  try { sc = await D.peekShareCode(code); } catch (e) { busy(); return toast(D.errMsg(e), 5000); }
  busy();
  if (!p) {   // mở từ link: chọn người tương ứng trong cây đang mở
    const opts = [...S.persons].sort((a, b) => (S.A.gen.get(a.id) || 99) - (S.A.gen.get(b.id) || 99) || pname(a).localeCompare(pname(b), 'vi'))
      .map((x) => [x.id, `${pname(x)}${S.A.label(x.id) ? ' · ' + S.A.label(x.id) : ''}${lifeText(x) ? ' · ' + lifeText(x) : ''}`]);
    if (!opts.length) return toast('Gia phả đang mở chưa có ai để liên kết.', 4000);
    const id = await pick({ title: `Ai trong "${S.tree.name}" là ${sc.name} (${sc.clanName})?`, options: opts });
    if (!id) return;
    p = byId(id);
  }
  const ok = await ask({ title: 'Xác nhận liên kết', ok: 'Liên kết',
    msg: `<b>${esc(pname(p))}</b> – ${esc(S.tree.name)}<br>là cùng một người với<br><b>${esc(sc.name)}</b> – ${esc(sc.clanName)} · ${esc(sc.treeName)}${sc.info ? ' · ' + esc(sc.info) : ''}<br><br><small>Liên kết không mở quyền xem dữ liệu giữa 2 dòng họ.</small>` });
  if (!ok) return;
  busy('Đang liên kết…');
  try { await D.createLink(sc, S.tree, p); busy(); toast('Đã liên kết'); await loadLinks(); showPerson(p.id); }
  catch (e) { busy(); toast(D.errMsg(e), 5000); }
}
/** Mở hồ sơ bên kia: cùng dòng họ → mở luôn; khác dòng họ → chuyển sang tài khoản đã lưu của họ đó */
async function openLinked(o) {
  if (!o) return;
  if (D.myTrees().some((t) => t.id === o.tree)) { S.jumpAfterLoad = o.person; closeSheet(true); return openTree(o.tree); }
  if (o.clan === D.clan.code) return toast('Bạn chưa được cấp quyền xem gia phả đó.', 4000);
  const acc = savedAccs().find((a) => a.code === o.clan);
  if (!acc) {
    return ask({ title: `Hồ sơ thuộc ${o.clanName}`, ok: 'Đã hiểu',
      msg: `<b>${esc(o.name)}</b> ở gia phả <b>${esc(o.treeName)}</b> của dòng họ <b>${esc(o.clanName)}</b> (mã <b>${esc(o.clan)}</b>).<br><br>Để xem, hãy nhờ quản trị họ đó cấp tài khoản, rồi đăng nhập bằng <b>Chuyển tài khoản → Đăng nhập tài khoản khác</b>.` });
  }
  if (!(await ask({ title: `Mở bên ${o.clanName}?`, msg: `App sẽ đăng xuất và chuyển sang tài khoản <b>${esc(acc.name || acc.user)}</b> của dòng họ <b>${esc(o.clanName)}</b>. Đăng nhập xong sẽ mở thẳng hồ sơ <b>${esc(o.name)}</b>.`, ok: 'Chuyển' }))) return;
  store('openAfterLogin', { clan: o.clan, tree: o.tree, person: o.person });
  store('accounts', [acc, ...savedAccs().filter((a) => a !== acc)]);
  D.logout();
}

// ======================= Chia sẻ link: mã QR + gửi Zalo (Web Share) + copy; quét QR bằng camera =======================
const loadScript = (src, name) => (window[name] ? Promise.resolve(window[name]) : new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = src; s.onload = () => res(window[name]); s.onerror = () => rej(new Error('Không tải được thư viện QR (kiểm tra mạng)')); document.head.appendChild(s);
}));
const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const JSQR_LIB = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
const fmtTime = (ts) => { const d = ts && ts.toDate ? ts.toDate() : new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${d.toLocaleDateString('vi-VN')}`; };
const DAYS = [['1', 'Hết hạn sau 1 ngày'], ['7', 'Hết hạn sau 7 ngày'], ['30', 'Hết hạn sau 30 ngày']];

/** Màn chia sẻ chung: QR to + Gửi (Zalo…) + Copy + Tải ảnh QR. Dùng cho link liên kết hồ sơ và link chia sẻ gia phả */
async function showShareSheet({ title, url, text, note, expiresAt }) {
  openSheet(`<h2 style="margin:0 0 4px;font-size:var(--fs-2xl)">${esc(title)}</h2>
    ${note ? `<p style="margin:0;color:var(--muted)">${note}</p>` : ''}
    <div class="qrbox" id="qrBox"><i class="fa-solid fa-circle-notch fa-spin"></i></div>
    <p class="qrexp"><i class="fa-regular fa-clock"></i> Hết hạn lúc <b>${esc(fmtTime(expiresAt))}</b></p>
    <span class="codebox">${esc(url)}</span>
    <div class="sacts">
      <button class="abtn blue full" id="shGo"><i class="fa-solid fa-paper-plane"></i>Gửi qua Zalo / ứng dụng khác</button>
      <button class="abtn" id="shCopy"><i class="fa-regular fa-copy"></i>Copy link</button>
      <button class="abtn" id="shPng"><i class="fa-solid fa-download"></i>Tải ảnh QR</button>
    </div>
    <p class="note">Người nhận: mở app Gia phả, đăng nhập tài khoản dòng họ của họ → bấm <b>icon quét mã <i class="fa-solid fa-qrcode"></i></b> trên thanh đầu → quét mã này. Hoặc bấm vào link được gửi qua Zalo.</p>`);
  let dataUrl = '';
  try {
    const qrcode = await loadScript(QR_LIB, 'qrcode');
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    dataUrl = q.createDataURL(8, 16);
    if ($('qrBox')) $('qrBox').innerHTML = `<img src="${dataUrl}" alt="Mã QR">`;
  } catch (e) { if ($('qrBox')) $('qrBox').innerHTML = `<small>${esc(e.message)}</small>`; }
  const msg = `${text}\n${url}`;
  const copy = async () => { try { await navigator.clipboard.writeText(msg); toast('Đã copy – dán gửi qua Zalo'); } catch (e) { toast('Không copy được, hãy bấm giữ link để copy', 4000); } };
  $('shCopy').onclick = copy;
  $('shGo').onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title, text, url }); } catch (e) { /* bấm hủy */ } }
    else copy();
  };
  $('shPng').onclick = () => { if (!dataUrl) return; const a = document.createElement('a'); a.href = dataUrl; a.download = 'ma-qr-gia-pha.gif'; a.click(); };
}

/** Quét mã QR bằng camera → trả về chuỗi trong mã (thường là link) */
function scanQR() {
  return new Promise((resolve) => {
    openSheet(`<h2 style="margin:0 0 8px;font-size:var(--fs-2xl)">Quét mã QR</h2>
      <div class="scanbox"><video id="qrv" playsinline muted></video><div class="scanframe"></div></div>
      <p class="note" id="qrMsg" style="text-align:center">Đưa mã QR vào khung</p>
      <div class="sacts"><button class="abtn full" id="qrStop">Đóng</button></div>`, { beforeClose: () => { stop(); return true; } });
    let stream = null, timer = null, done = false;
    const stop = () => { done = true; clearTimeout(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); };
    const finish = (v) => { if (done) return; stop(); closeSheet(true); resolve(v); };
    $('qrStop').onclick = () => finish(null);
    (async () => {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
      catch (e) { $('qrMsg').textContent = 'Không mở được camera. Hãy cho phép quyền camera, hoặc dán link.'; return; }
      const v = $('qrv'); if (!v) return stop();
      v.srcObject = stream; await v.play();
      let detect;
      if ('BarcodeDetector' in window) { const bd = new window.BarcodeDetector({ formats: ['qr_code'] }); detect = async () => { const r = await bd.detect(v); return r[0] && r[0].rawValue; }; }
      else {
        const jsQR = await loadScript(JSQR_LIB, 'jsQR'), cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
        detect = async () => { cv.width = v.videoWidth; cv.height = v.videoHeight; if (!cv.width) return null; cx.drawImage(v, 0, 0); const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height); return r && r.data; };
      }
      const loop = async () => { if (done) return; try { const t = await detect(); if (t) return finish(t); } catch (e) { /* khung hình lỗi */ } timer = setTimeout(loop, 250); };
      loop();
    })();
  });
}
/** Xử lý link nhận được (quét QR / dán): ?share= → nhận chia sẻ gia phả; ?link= → liên kết hồ sơ */
async function handleIncoming(text, person) {
  let u; try { u = new URL(text); } catch (e) { u = null; }
  const share = u && u.searchParams.get('share'), link = u ? u.searchParams.get('link') : text;
  if (share) return receiveShare(share);
  if (link) return linkWithCode(person || null, link);
  toast('Mã QR không phải link của app Gia phả', 4000);
}
async function scanAndHandle(person) { const t = await scanQR(); if (t) handleIncoming(t, person); }

/** Người nhận mở link chia sẻ gia phả */
async function receiveShare(code) {
  busy('Đang kiểm tra link…');
  let L;
  try { L = await D.peekShareLink(code); } catch (e) { busy(); return toast(D.errMsg(e), 5000); }
  busy();
  if (D.myTrees().some((t) => t.id === L.tree)) { toast('Bạn đã xem được gia phả này'); return openTree(L.tree); }
  const ok = await ask({ title: 'Nhận gia phả được chia sẻ', ok: 'Nhận',
    msg: `<b>${esc(L.clanName)}</b> chia sẻ gia phả <b>${esc(L.treeName)}</b> cho bạn.<br>Quyền: <b>${esc(D.shareRoleName(L.role))}</b>${L.single ? ' · link dùng cho 1 người' : ''}<br><br><small>Chỉ tài khoản <b>${esc(D.myName())}</b> (${esc(D.clan.name)}) xem được.</small>` });
  if (!ok) return;
  busy('Đang nhận…');
  try { await D.acceptShareLink(L); busy(); toast('Đã nhận – đang mở gia phả'); openTree(L.tree); }
  catch (e) { busy(); toast(D.errMsg(e), 5000); }
}

// ======================= Nhiều hơn (giống ech-client: header xanh + lưới chức năng theo nhóm) =======================
function renderMore(m) {
  const a = D.account, groups = {};
  for (const x of navOk().slice(4)) (groups[x.g || 'Gia phả'] ||= []).push(x);
  const cards = (arr) => `<div class="mgrid">${arr.map((x) => `<button data-go="${x.k}"><i class="fa-solid ${x.ic}"></i><span>${x.n}</span></button>`).join('')}</div>`;
  m.innerHTML = `<div class="morehead"><div class="mav">${esc(initials(a.name || a.username))}</div>
      <div class="mi"><small>Xin chào!</small><b>${esc(a.name || a.username)}</b><span class="rbadge">${D.isRoot() ? 'Quản trị dòng họ' : esc(a.title || (S.tree ? ROLE[S.role] : 'Người dùng'))}</span></div>
      <button class="mout" id="mOut" title="Đăng xuất"><i class="fa-solid fa-right-from-bracket"></i></button></div>
    <div class="moresheet">
      ${Object.entries(groups).map(([g, arr]) => `<div class="msec">${esc(g)}</div>${cards(arr)}`).join('')}
      <div class="msec">Tài khoản</div>
      <div class="mgrid">
        <button data-act="scan"><i class="fa-solid fa-qrcode"></i><span>Quét mã QR</span></button>
        <button data-act="me"><i class="fa-solid fa-id-card"></i><span>Thông tin tài khoản</span></button>
        <button data-act="pw"><i class="fa-solid fa-key"></i><span>Đổi mật khẩu</span></button>
        <button data-act="theme"><i class="fa-solid fa-sliders"></i><span>Giao diện</span></button>
        <button data-install ${canInstall() ? '' : 'hidden'}><i class="fa-solid fa-download"></i><span>Cài ứng dụng</span></button>
        ${D.isRoot() ? '<button data-act="clan"><i class="fa-solid fa-landmark"></i><span>Thông tin dòng họ</span></button>' : ''}
      </div>
      <p class="note" style="text-align:center">Dòng họ <b>${esc(D.clan.name || '')}</b> · mã <b>${esc(D.clan.code)}</b> · đăng nhập <b>${esc(a.username)}</b></p>
    </div>`;
  m.querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => go(el.dataset.go)));
  m.querySelector('[data-act=me]').onclick = editMe;
  m.querySelector('[data-act=scan]').onclick = () => scanAndHandle();
  m.querySelector('[data-act=pw]').onclick = changePw;
  m.querySelector('[data-act=theme]').onclick = uiSettings;
  bindInstall(m);
  if (m.querySelector('[data-act=clan]')) m.querySelector('[data-act=clan]').onclick = editClan;
  $('mOut').onclick = async () => { if (await ask({ title: 'Đăng xuất?', ok: 'Đăng xuất' })) D.logout(); };
}

// ======================= Giao diện: cỡ chữ (như ech-client, 11–16px) + sáng/tối =======================
const FONT_MIN = 11, FONT_MAX = 16, FONT_DEF = 13;
const fontSize = () => { const v = +store('fontSize'); return v >= FONT_MIN && v <= FONT_MAX ? v : FONT_DEF; };
function setFont(n) {
  n = Math.min(FONT_MAX, Math.max(FONT_MIN, n));
  document.documentElement.style.setProperty('--font-size', n + 'px');
  store('fontSize', n === FONT_DEF ? null : n);
  return n;
}
function uiSettings() {
  const dark = () => document.documentElement.dataset.theme === 'dark';
  openSheet(`<h2 style="margin:0 0 4px;font-size:var(--fs-2xl)">Giao diện</h2>
    <div class="rows">
      <div class="cfgrow"><div><b>Cỡ chữ</b><small>Mặc định ${FONT_DEF}px</small></div>
        <div class="stepper"><button type="button" id="fzMinus" aria-label="Nhỏ hơn"><i class="fa-solid fa-minus"></i></button><span id="fzVal">${fontSize()}px</span><button type="button" id="fzPlus" aria-label="Lớn hơn"><i class="fa-solid fa-plus"></i></button></div></div>
      <div class="preview">Xem trước: <b style="color:var(--text)">Nguyễn Văn Tổ</b> · Đời 1 · giỗ 16/2 âm lịch</div>
      <div class="cfgrow"><div><b>Chế độ màu</b><small>Sáng hoặc tối</small></div>
        <div class="seg" style="min-width:150px"><label><input type="radio" name="thm" value="light" ${dark() ? '' : 'checked'}>Sáng</label><label><input type="radio" name="thm" value="dark" ${dark() ? 'checked' : ''}>Tối</label></div></div>
    </div>
    <div class="sacts"><button type="button" class="abtn full" id="uiReset"><i class="fa-solid fa-rotate-left"></i>Về mặc định</button></div>`);
  const show = (n) => { $('fzVal').textContent = n + 'px'; $('fzMinus').disabled = n <= FONT_MIN; $('fzPlus').disabled = n >= FONT_MAX; };
  show(fontSize());
  $('fzMinus').onclick = () => show(setFont(fontSize() - 1));
  $('fzPlus').onclick = () => show(setFont(fontSize() + 1));
  $('sheet').querySelectorAll('input[name=thm]').forEach((r) => (r.onchange = () => applyTheme(r.value)));
  $('uiReset').onclick = () => { show(setFont(FONT_DEF)); applyTheme('light'); $('sheet').querySelector('input[name=thm][value=light]').checked = true; };
}

async function editMe() {
  const a = D.account;
  const v = await ask({ title: 'Thông tin tài khoản', msg: `Tên đăng nhập: <b>${esc(a.username)}</b>${a.email ? ` · Email: <b>${esc(a.email)}</b>` : ''}`,
    fields: [{ id: 'name', ph: 'Họ và tên', value: a.name || '' }, { id: 'phone', ph: 'Số điện thoại', type: 'tel', value: a.phone || '' }], ok: 'Lưu',
    validate: (v) => (!v.name ? 'Chưa nhập họ tên' : '') });
  if (!v) return;
  try { await D.updateMe(v); toast('Đã lưu'); if (S.tab === 'more') renderTab(); } catch (e) { toast(D.errMsg(e), 4000); }
}
async function changePw() {
  const v = await ask({ title: 'Đổi mật khẩu', fields: [{ id: 'o', type: 'password', ph: 'Mật khẩu hiện tại' }, { id: 'n', type: 'password', ph: 'Mật khẩu mới (ít nhất 6 ký tự)' }, { id: 'c', type: 'password', ph: 'Nhập lại mật khẩu mới' }],
    ok: 'Đổi', validate: (v) => (!v.o ? 'Nhập mật khẩu hiện tại' : v.n.length < 6 ? 'Mật khẩu mới cần ít nhất 6 ký tự' : v.n !== v.c ? 'Mật khẩu nhập lại không khớp' : '') });
  if (!v) return;
  busy('Đang đổi…');
  try { await D.changePassword(v.o, v.n); busy(); toast('Đã đổi mật khẩu'); } catch (e) { busy(); toast(D.errMsg(e), 4000); }
}
async function editClan() {
  const c = D.clan;
  const v = await ask({ title: 'Thông tin dòng họ', msg: `Mã dòng họ: <b>${esc(c.code)}</b> (không đổi được)`,
    fields: [{ id: 'name', ph: 'Tên dòng họ', value: c.name || '' }, { id: 'contact', ph: 'Người liên hệ', value: c.contact || '' }, { id: 'phone', ph: 'Số điện thoại', value: c.phone || '' }],
    ok: 'Lưu', validate: (v) => (!v.name ? 'Chưa nhập tên' : '') });
  if (!v) return;
  try { await D.updateClan(v); toast('Đã lưu'); renderTab(); } catch (e) { toast(D.errMsg(e), 4000); }
}

// ======================= Quản lý gia phả (root) =======================
function renderTrees(m) {
  const own = D.myTrees().filter((t) => !t.shared), tree = own[0];
  m.innerHTML = `<div class="page"><div class="sec"><i class="fa-solid fa-book"></i> Gia phả của dòng họ</div>
    <div class="tgrid">${own.map((t, i) => { const c = COLORS[i % COLORS.length]; return `<div class="tcard" data-t="${esc(t.id)}" style="--c1:${c[0]};--c2:${c[1]}">
      <div class="tn1">${esc(t.name)}</div><div class="tn2">${S.tree && S.tree.id === t.id ? 'Đang mở' : 'Bấm để mở'}</div><i class="fa-solid fa-sitemap tic"></i></div>`; }).join('')}
      ${!own.length ? `<button class="addtile" id="tNew"><span><i class="fa-solid fa-plus"></i>Tạo gia phả</span></button>` : ''}</div>
    ${tree ? `<div class="sacts"><button class="abtn full" id="tSet"><i class="fa-solid fa-pen"></i>Sửa thông tin gia phả</button></div>
      <div class="sec"><i class="fa-solid fa-share-nodes"></i> Chia sẻ cho dòng họ khác <span class="n"><button class="abtn sm blue" id="shAdd"><i class="fa-solid fa-qrcode"></i>Tạo link / QR</button></span></div>
      <div id="shList"><div class="empty" style="padding:16px"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>
      <p class="note">Cho người ở dòng họ khác (vd con rể, con dâu) <b>xem gia phả bằng chính tài khoản của họ</b>: tạo link / mã QR → gửi Zalo hoặc cho quét → người đó đăng nhập và bấm <b>Nhận</b>. Bấm <b>Rút</b> là mất quyền ngay.</p>` : ''}
    <p class="note">Mỗi dòng họ có <b>1 gia phả</b>. Họ ngoại, họ vợ… tự đăng ký dòng họ của họ rồi nối hồ sơ trùng người bằng <b>Gửi link liên kết</b> trong hồ sơ.</p></div>`;
  m.querySelectorAll('[data-t]').forEach((el) => (el.onclick = () => { openTree(el.dataset.t).then(() => go('tree')); }));
  if ($('tNew')) $('tNew').onclick = newTree;
  if ($('tSet')) $('tSet').onclick = async () => { if (!S.tree || S.tree.id !== tree.id) await openTree(tree.id); treeSettings(); };
  if (!tree) return;
  const shareSheet = (L) => showShareSheet({ title: 'Chia sẻ gia phả', url: D.treeShareLink(L.code), expiresAt: L.expiresAt,
    text: `Mời xem gia phả "${tree.name}" (${D.clan.name}) trên app Gia phả`,
    note: `Quyền: <b>${esc(D.shareRoleName(L.role))}</b> · ${L.single ? 'dùng cho <b>1 người</b>' : '<b>nhiều người</b> dùng được'}` });
  $('shAdd').onclick = async () => {
    const v = await ask({ title: 'Tạo link chia sẻ gia phả', msg: `Người nhận đăng nhập bằng tài khoản dòng họ của họ và bấm Nhận là xem được gia phả <b>${esc(tree.name)}</b>.`,
      fields: [{ id: 'r', type: 'select', value: 'viewer', ph: 'Quyền', options: [['viewer', 'Chỉ xem'], ['member', 'Xem + gửi đề xuất sửa']] },
        { id: 's', type: 'select', value: '1', ph: 'Số người', options: [['1', 'Dùng cho 1 người'], ['n', 'Nhiều người dùng được']] },
        { id: 'd', type: 'select', value: '7', ph: 'Thời hạn', options: DAYS }], ok: 'Tạo link' });
    if (!v) return;
    busy('Đang tạo link…');
    try { const code = await D.createShareLink(tree, v.r, v.s === '1', Number(v.d)); const L = await D.peekShareLink(code); busy(); drawShares(); shareSheet(L); }
    catch (e) { busy(); toast(D.errMsg(e), 5000); }
  };
  const drawShares = async () => {
    let links = [], people = [];
    try { [links, people] = await Promise.all([D.listShareLinks(tree.id), D.listShares(tree.id)]); }
    catch (e) { $('shList').innerHTML = `<div class="empty" style="padding:16px">${esc(D.errMsg(e))}</div>`; return; }
    if (!$('shList')) return;
    const now = Date.now(), live = links.filter((x) => x.expiresAt.toMillis() > now && !(x.single && x.usedBy));
    $('shList').innerHTML = `<div class="panel">${people.length ? people.map((x) => `<div class="item" style="cursor:default"><div class="ic ok"><i class="fa-solid fa-eye"></i></div>
        <div class="t"><b>${esc(x.name || x.username)}</b><span>${esc(x.fromClanName || '')} · @${esc(x.username || '')} · ${esc(D.shareRoleName(x.role))} · từ ${esc(fmtTime(x.at))}</span></div>
        <button class="abtn sm red" data-rv="${esc(x.id)}">Rút</button></div>`).join('') : '<div class="empty" style="padding:14px">Chưa ai xem nhờ chia sẻ</div>'}</div>
      ${live.length ? `<div class="msec">Link đang hiệu lực</div><div class="panel">${live.map((x) => `<div class="item" style="cursor:default"><div class="ic info"><i class="fa-solid fa-qrcode"></i></div>
        <div class="t"><b>${esc(D.shareRoleName(x.role))} · ${x.single ? '1 người' : 'nhiều người'}</b><span>Hết hạn ${esc(fmtTime(x.expiresAt))}</span></div>
        <button class="abtn sm" data-qr="${esc(x.code)}"><i class="fa-solid fa-qrcode"></i></button><button class="abtn sm red" data-cx="${esc(x.code)}">Hủy</button></div>`).join('')}</div>` : ''}`;
    $('shList').querySelectorAll('[data-qr]').forEach((b) => (b.onclick = () => shareSheet(live.find((x) => x.code === b.dataset.qr))));
    $('shList').querySelectorAll('[data-cx]').forEach((b) => (b.onclick = async () => {
      if (!(await ask({ title: 'Hủy link?', msg: 'Link và mã QR này sẽ không dùng được nữa. Người đã nhận vẫn xem được (bấm Rút để thu hồi).', ok: 'Hủy link', danger: true }))) return;
      try { await D.cancelShareLink(b.dataset.cx); toast('Đã hủy link'); drawShares(); } catch (e) { toast(D.errMsg(e), 4000); }
    }));
    $('shList').querySelectorAll('[data-rv]').forEach((b) => (b.onclick = async () => {
      const x = people.find((y) => y.id === b.dataset.rv);
      if (!(await ask({ title: 'Rút chia sẻ?', msg: `<b>${esc(x.name || x.username)}</b> (${esc(x.fromClanName || '')}) sẽ không xem được gia phả <b>${esc(tree.name)}</b> nữa.`, ok: 'Rút', danger: true }))) return;
      try { await D.revokeShare(x); toast('Đã rút chia sẻ'); drawShares(); } catch (e) { toast(D.errMsg(e), 4000); }
    }));
  };
  drawShares();
}

/** Gia phả đang xem nhờ chia sẻ (hiện ở Tổng quan) */
function shareBanners() {
  const cur = S.tree && D.myTrees().find((t) => t.id === S.tree.id && t.shared);
  return cur ? `<div class="panel" style="margin-top:14px"><div class="item" style="cursor:default"><div class="ic info"><i class="fa-solid fa-share-nodes"></i></div>
    <div class="t"><b>Đang xem gia phả được chia sẻ</b><span>${esc(cur.clanName)} · ${esc(D.shareRoleName(cur.role))}</span></div>
    <button class="abtn sm red" id="shLeave">Bỏ theo dõi</button></div></div>` : '';
}
function bindShareBanners() {
  if ($('shLeave')) $('shLeave').onclick = async () => {
    if (!(await ask({ title: 'Bỏ theo dõi gia phả này?', msg: 'Bạn sẽ không xem được gia phả này nữa, trừ khi được chia sẻ lại.', ok: 'Bỏ theo dõi', danger: true }))) return;
    try { await D.leaveShare(S.tree.id); toast('Đã bỏ theo dõi'); store('lastTree', null); const t = D.myTrees()[0]; if (t) openTree(t.id); else { S.tree = null; shell(); } }
    catch (e) { toast(D.errMsg(e), 4000); }
  };
}

// ======================= Quản lý người dùng (root) =======================
const TROLE = { '': 'Không truy cập', member: 'Thành viên – chỉ xem', editor: 'Biên tập – được sửa' };
async function renderUsers(m) {
  m.innerHTML = `<div class="page"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Đang tải…</div></div>`;
  let list;
  try { list = await D.listUsers(); } catch (e) { m.innerHTML = `<div class="page"><div class="empty">${esc(D.errMsg(e))}</div></div>`; return; }
  if (S.tab !== 'users') return;
  list.sort((a, b) => (a.role === 'root' ? -1 : b.role === 'root' ? 1 : 0) || (b.active !== false) - (a.active !== false) || String(a.name).localeCompare(String(b.name), 'vi'));
  const trees = D.clan.trees || {};
  S.uq = S.uq || '';
  m.innerHTML = `<div class="page">
    <div class="listbar"><div style="display:flex;gap:8px"><div class="search"><i class="fa-solid fa-magnifying-glass"></i><input id="uq" placeholder="Tìm người dùng" value="${esc(S.uq)}" autocomplete="off"></div>
      <button class="abtn blue" id="uAdd"><i class="fa-solid fa-user-plus"></i><span class="hide-s">Thêm người dùng</span></button></div></div>
    <div class="panel" id="ures"></div>
    <p class="note">Người dùng đăng nhập bằng <b>mã dòng họ ${esc(D.clan.code)}</b> + tên đăng nhập + mật khẩu. Người có email tự lấy lại mật khẩu được; người không có email quên mật khẩu thì tắt tài khoản cũ và tạo tên đăng nhập mới.</p></div>`;
  const draw = () => {
    const q = fold(S.uq.trim());
    const rows = list.filter((u) => !q || fold([u.name, u.username, u.title, u.phone].join(' ')).includes(q));
    $('ures').innerHTML = rows.map((u) => {
      const tr = u.role === 'root' ? 'Toàn quyền mọi gia phả' : Object.entries(u.trees || {}).map(([t, r]) => `${trees[t] || '?'}: ${r === 'editor' ? 'biên tập' : 'xem'}`).join(' · ') || 'Chưa cấp quyền gia phả nào';
      return `<div class="item" data-u="${esc(u.uid)}"><div class="ic ${u.role === 'root' ? 'warn' : u.active === false ? 'bad' : 'info'}"><i class="fa-solid fa-${u.role === 'root' ? 'crown' : 'user'}"></i></div>
        <div class="t"><b>${esc(u.name || u.username)}</b><span>@${esc(u.username)}${u.title ? ' · ' + esc(u.title) : ''}${u.phone ? ' · ' + esc(u.phone) : ''}</span><span>${esc(tr)}</span></div>
        <span class="when ${u.active === false ? 'bad' : 'ok'}">${u.active === false ? 'Tắt' : 'Hoạt động'}</span></div>`;
    }).join('') || '<div class="empty" style="padding:20px">Không tìm thấy</div>';
    $('ures').querySelectorAll('[data-u]').forEach((el) => (el.onclick = () => { const u = list.find((x) => x.uid === el.dataset.u); if (u.role === 'root') editMe(); else userForm(u); }));
  };
  $('uq').oninput = () => { S.uq = $('uq').value; draw(); };
  $('uAdd').onclick = () => userForm(null);
  draw();
}

function userForm(u) {
  const isNew = !u, d = u || { active: true, trees: {} }, trees = D.clan.trees || {};
  const html = `<h2 style="margin:0 0 4px;font-size:var(--fs-2xl)">${isNew ? 'Thêm người dùng' : 'Sửa người dùng'}</h2>
    <form id="uf">
    <div class="fsec"><i class="fa-solid fa-id-card"></i>Thông tin</div>
    <div class="fgrid">
      <div class="fld full"><label>Tên đăng nhập *</label><input id="u_username" value="${esc(d.username || '')}" ${isNew ? '' : 'disabled'} autocapitalize="none" maxlength="30" placeholder="vd: chi2.nam" required>
        <div class="hint">${isNew ? 'Chữ thường không dấu, số, dấu chấm, gạch dưới. Không đổi được sau khi tạo.' : 'Không đổi được'}</div></div>
      <div class="fld full"><label>Họ và tên *</label><input id="u_name" value="${esc(d.name || '')}" required maxlength="120"></div>
      <div class="fld"><label>Số điện thoại</label><input id="u_phone" type="tel" value="${esc(d.phone || '')}"></div>
      <div class="fld"><label>Chức vụ / chi</label><input id="u_title" value="${esc(d.title || '')}" placeholder="vd: Trưởng chi 2"></div>
      ${isNew ? `<div class="fld full"><label>Email (không bắt buộc)</label><input id="u_email" type="email" placeholder="Để người dùng tự lấy lại mật khẩu"><div class="hint">Không có email: quên mật khẩu thì phải tạo tài khoản mới</div></div>
      <div class="fld full"><label>Mật khẩu *</label><input id="u_pw" type="text" autocomplete="off" minlength="6" value="${esc(Math.random().toString(36).slice(2, 10))}" required><div class="hint">Gửi mật khẩu này cho người dùng; họ tự đổi sau khi đăng nhập</div></div>`
        : `<div class="fld full"><label>Email</label><input value="${esc(d.email || '— không có —')}" disabled></div>
      <label class="ck full"><input type="checkbox" id="u_active" ${d.active !== false ? 'checked' : ''}>Hoạt động (bỏ chọn để tắt tài khoản, gỡ mọi quyền)</label>`}
    </div>
    <div class="fsec"><i class="fa-solid fa-shield-halved"></i>Quyền theo gia phả</div>
    <div class="rows">${Object.entries(trees).map(([t, n]) => `<div class="r"><span style="color:var(--text);flex:1">${esc(n)}</span><select class="rsel" data-tr="${esc(t)}" aria-label="Quyền trên: ${esc(n)}">${Object.entries(TROLE).map(([k, l]) => `<option value="${k}" ${(d.trees || {})[t] === k || (!k && !(d.trees || {})[t]) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`).join('')
      || '<div class="r"><span>Chưa có gia phả nào</span></div>'}</div>
    <div class="fbar"><button type="button" class="abtn" id="ucancel">Hủy</button><button class="abtn blue"><i class="fa-solid fa-check"></i>${isNew ? 'Tạo' : 'Lưu'}</button></div>
    </form>`;
  openSheet(html);
  $('ucancel').onclick = () => closeSheet();
  $('uf').onsubmit = async (e) => {
    e.preventDefault();
    const v = (k) => ($('u_' + k) ? $('u_' + k).value.trim() : '');
    const tr = {}; $('sheet').querySelectorAll('[data-tr]').forEach((s) => { if (s.value) tr[s.dataset.tr] = s.value; });
    const f = { username: v('username').toLowerCase(), name: v('name'), phone: v('phone'), title: v('title'), email: v('email'), password: v('pw'), trees: tr, active: isNew ? true : $('u_active').checked };
    if (isNew && !D.USER_RE.test(f.username)) return toast('Tên đăng nhập chỉ gồm chữ thường không dấu, số, dấu chấm, gạch dưới', 4000);
    if (isNew && f.password.length < 6) return toast('Mật khẩu cần ít nhất 6 ký tự');
    busy(isNew ? 'Đang tạo…' : 'Đang lưu…');
    try {
      if (isNew) {
        await D.createUser(f); busy(); closeSheet(true);
        await ask({ title: 'Đã tạo người dùng', msg: `Gửi thông tin đăng nhập cho <b>${esc(f.name)}</b>:<br>Mã dòng họ: <b>${esc(D.clan.code)}</b><br>Tên đăng nhập: <b>${esc(f.username)}</b><br>Mật khẩu: <b>${esc(f.password)}</b>`, ok: 'Copy & đóng' })
          .then((ok) => ok && navigator.clipboard && navigator.clipboard.writeText(`Link: ${location.origin}${location.pathname}\nMã dòng họ: ${D.clan.code}\nTên đăng nhập: ${f.username}\nMật khẩu: ${f.password}`).then(() => toast('Đã copy')).catch(() => {}));
      } else { await D.updateUser(u, f); busy(); closeSheet(true); toast('Đã lưu'); }
      renderUsers($('main'));
    } catch (er) { busy(); toast(D.errMsg(er), 5000); }
  };
}

// ======================= Tab Đề xuất =======================
async function renderProps(m) {
  m.innerHTML = `<div class="page"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Đang tải…</div></div>`;
  let list;
  try { list = await D.listProposals(S.tree.id); } catch (e) { m.innerHTML = `<div class="page"><div class="empty">${esc(D.errMsg(e))}</div></div>`; return; }
  if (S.tab !== 'props') return;
  S.propCount = list.length; setBadge();
  m.innerHTML = `<div class="page"><div class="sec"><i class="fa-solid fa-inbox"></i> Đề xuất chờ xử lý <span class="n">${list.length}</span></div>
    <div class="panel">${list.length ? list.map((x) => `<div class="item" style="align-items:flex-start;cursor:default"><div class="ic info"><i class="fa-solid fa-message"></i></div>
      <div class="t"><b>${esc(x.personName || 'Chung')}</b><span style="white-space:pre-wrap;color:var(--text)">${esc(x.text)}</span><span>${esc(x.byName)} · ${esc(ago(x.at))}</span>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">${x.personId && byId(x.personId) ? `<button class="abtn sm" data-open="${esc(x.personId)}"><i class="fa-solid fa-user"></i>Mở hồ sơ</button>` : ''}
        <button class="abtn sm blue" data-ok="${esc(x.id)}"><i class="fa-solid fa-check"></i>Đã sửa</button><button class="abtn sm red" data-no="${esc(x.id)}">Từ chối</button></div></div></div>`).join('')
      : '<div class="empty" style="padding:20px"><i class="fa-regular fa-circle-check"></i>Không có đề xuất nào</div>'}</div></div>`;
  m.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => showPerson(b.dataset.open)));
  const res = (id, st) => D.resolveProposal(S.tree.id, id, st).then(() => { toast('Đã xử lý'); renderProps(m); }).catch((e) => toast(D.errMsg(e), 4000));
  m.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => res(b.dataset.ok, 'done')));
  m.querySelectorAll('[data-no]').forEach((b) => (b.onclick = () => res(b.dataset.no, 'rejected')));
}

// ======================= Tab Nhật ký =======================
const LABEL = { name: 'Họ tên', nick: 'Tên thường gọi', alias: 'Tên húy', gender: 'Giới tính', branch: 'Chi', order: 'Con thứ', adopted: 'Con nuôi', birthSolar: 'Sinh',
  birthLunar: 'Sinh (âm)', alive: 'Còn sống', deathSolar: 'Mất', deathLunar: 'Mất (âm)', birthPlace: 'Nơi sinh', address: 'Nơi ở', burial: 'An táng', job: 'Nghề nghiệp', note: 'Ghi chú',
  fatherId: 'Cha', motherId: 'Mẹ', spouseIds: 'Vợ/chồng', photo: 'Ảnh' };
async function renderLog(m) {
  m.innerHTML = `<div class="page"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Đang tải…</div></div>`;
  let list;
  try { list = await D.listLog(S.tree.id); } catch (e) { m.innerHTML = `<div class="page"><div class="empty">${esc(D.errMsg(e))}</div></div>`; return; }
  if (S.tab !== 'log') return;
  const show = (k, v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (k === 'fatherId' || k === 'motherId') return pname(byId(v));
    if (k === 'gender') return v === 'f' ? 'Nữ' : 'Nam';
    if (typeof v === 'boolean') return v ? 'Có' : 'Không';
    return String(v).slice(0, 60);
  };
  const desc = (x) => {
    if (x.action === 'add') return 'Thêm mới';
    if (x.action === 'share') return 'Chia sẻ gia phả (' + esc(D.shareRoleName((x.after || {}).role)) + ')';
    if (x.action === 'unshare') return 'Rút chia sẻ gia phả';
    if (x.action === 'delete') return 'Xóa';
    const keys = Object.keys(x.after || {}).filter((k) => k !== 'updatedBy');
    return keys.map((k) => `${LABEL[k] || k}: ${esc(show(k, (x.before || {})[k]))} → <b>${esc(show(k, x.after[k]))}</b>`).join('<br>') || 'Sửa';
  };
  m.innerHTML = `<div class="page"><div class="sec"><i class="fa-solid fa-clock-rotate-left"></i> 60 thay đổi gần nhất</div>
    <div class="panel">${list.length ? list.map((x) => `<div class="item logi" ${x.personId && byId(x.personId) ? `data-p="${esc(x.personId)}"` : ''} style="align-items:flex-start">
      <div class="ic ${x.action === 'delete' ? 'bad' : x.action === 'add' ? 'ok' : 'info'}"><i class="fa-solid fa-${x.action === 'delete' ? 'trash' : x.action === 'add' ? 'plus' : 'pen'}"></i></div>
      <div class="t"><b>${esc(x.personName)}</b><span>${desc(x)}</span><span>${esc(x.byName)} · ${esc(ago(x.at))}</span></div></div>`).join('')
      : '<div class="empty" style="padding:20px">Chưa có thay đổi nào</div>'}</div></div>`;
  m.querySelectorAll('[data-p]').forEach((el) => (el.onclick = () => showPerson(el.dataset.p)));
}

// ======================= Thông tin gia phả (chủ) =======================
async function treeSettings() {
  const v = await ask({ title: 'Thông tin gia phả', fields: [{ id: 'name', value: S.tree.name, ph: 'Tên gia phả' }, { id: 'origin', value: S.tree.origin || '', ph: 'Quê gốc' }, { id: 'desc', value: S.tree.desc || '', ph: 'Mô tả ngắn' }],
    ok: 'Lưu', validate: (v) => (!v.name ? 'Chưa nhập tên' : v.name.length > 120 ? 'Tên quá dài' : '') });
  if (!v) return;
  try { await D.updateTree(S.tree.id, v); Object.assign(S.tree, v); shell(); toast('Đã lưu'); }
  catch (e) { toast(D.errMsg(e), 4000); }
}

// đăng ký service worker (PWA)
if ('serviceWorker' in navigator && !D.isEmu && location.protocol === 'https:') navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
