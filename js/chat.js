// Chat trong dòng họ (BA-chat.md): nút nổi kéo thả được → danh sách cuộc trò chuyện → khung chat.
// Phòng: Cả họ (mọi tài khoản), 2 người, nhóm tự tạo. Điện thoại: toàn màn hình; máy tính: cửa sổ nhỏ góc dưới phải.
import * as D from './data.js?v=1792479341600';
import { $, esc, toast, ask, pick, store } from './ui.js?v=1792479341600';

let X = null;   // { ctx, tree, rooms, people, unRooms, room, unMsgs, msgs, n, reply, mentions, view }
const EMO = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const ms = (t) => (t && t.toMillis ? t.toMillis() : typeof t === 'number' ? t : 0);
const initials = (s) => String(s || '?').trim().split(/\s+/).slice(-1)[0].charAt(0).toUpperCase() || '?';
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const dayLabel = (d) => { const t = new Date(), y = new Date(Date.now() - 864e5); return d.toDateString() === t.toDateString() ? 'Hôm nay' : d.toDateString() === y.toDateString() ? 'Hôm qua' : `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; };
const shortTime = (t) => { const d = new Date(ms(t)); if (!ms(t)) return ''; return d.toDateString() === new Date().toDateString() ? hm(d) : dayLabel(d); };

/** Bật chat cho gia phả đang mở. ctx: { tree, canChat, byId, pname, kinOf, avatarHtml, showPerson, label } */
export function initChat(ctx) {
  stopChat();
  if (!ctx.tree || !ctx.canChat) return;
  X = { ctx, tree: ctx.tree.id, rooms: [], people: new Map(), room: null, msgs: [], n: 30, reply: null, mentions: new Set(), view: 'list' };
  D.ensureAllRoom(X.tree).catch(() => {});
  loadPeople();
  X.unRooms = D.watchRooms(X.tree, (rooms) => { if (!X) return; X.rooms = rooms; badge(); if (X.view === 'list') render(); else if (X.view === 'room') header(); });
  fab();
}
export function stopChat() {
  if (!X) return;
  if (X.unRooms) X.unRooms(); if (X.unMsgs) X.unMsgs();
  ['chatFab', 'chatBox'].forEach((id) => { const e = $(id); if (e) e.remove(); });
  swRoom(null); X = null;
}
/** Uid của tài khoản gắn với người trong gia phả (để nút "Nhắn tin" ở hồ sơ) */
export const chatUidOf = (pid) => (X ? [...X.people.values()].find((p) => p.me === pid && p.uid !== D.myUid()) : null);
export async function chatWith(uid) { if (!X) return; open(); try { const r = await D.openDm(X.tree, uid); openRoom(r); } catch (e) { toast(D.errMsg(e), 4000); } }
/** Mở thẳng 1 phòng (bấm thông báo tin nhắn) */
export function chatOpenRoom(room) { if (!X) return; open(); openRoom(room); }

// ---------- nút nổi ----------
function fab() {
  if ($('chatFab')) return;
  const b = document.createElement('button');
  b.id = 'chatFab'; b.className = 'cfab'; b.title = 'Tin nhắn'; b.innerHTML = '<i class="fa-solid fa-comments"></i><b class="cfabn" id="cfabN" hidden></b>';
  document.body.appendChild(b);
  const pos = store('chatFab') || { side: 'r', y: null };
  const place = () => { b.classList.toggle('left', pos.side === 'l'); b.style.top = pos.y != null ? Math.min(Math.max(pos.y, 70), innerHeight - 140) + 'px' : ''; };
  place();
  let st = null;
  b.onpointerdown = (e) => { st = { x: e.clientX, y: e.clientY, moved: false, top: b.getBoundingClientRect().top }; b.setPointerCapture(e.pointerId); };
  b.onpointermove = (e) => {
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.moved && Math.abs(dx) + Math.abs(dy) < 8) return;
    st.moved = true; b.classList.add('drag'); b.style.left = e.clientX - 28 + 'px'; b.style.right = 'auto'; b.style.top = e.clientY - 28 + 'px';
  };
  b.onpointerup = (e) => {
    if (!st) return;
    const moved = st.moved; st = null; b.classList.remove('drag'); b.style.left = ''; b.style.right = '';
    if (moved) { pos.side = e.clientX < innerWidth / 2 ? 'l' : 'r'; pos.y = e.clientY - 28; store('chatFab', pos); place(); return; }
    $('chatBox') && !$('chatBox').hidden ? close() : open();
  };
  badge();
}
function badge() {
  if (!X) return;
  const me = D.myUid();
  const n = X.rooms.filter((r) => r.last && r.last.by !== me && ms(r.last.at) > ((r.reads || {})[me] || 0) && !(r.muted || {})[me] && r.id !== (X.view === 'room' && X.room)).length;
  const el = $('cfabN'); if (el) { el.textContent = n > 99 ? '99+' : n; el.hidden = !n; }
}

// ---------- khung chat ----------
function box() {
  let el = $('chatBox');
  if (!el) {
    el = document.createElement('div'); el.id = 'chatBox'; el.className = 'cbox'; el.hidden = true;
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); X && X.view !== 'list' ? back() : close(); } });
    document.body.appendChild(el);
  }
  return el;
}
function loadPeople() { D.chatPeople(X.tree).then((l) => { if (!X) return; X.people = new Map(l.map((p) => [p.uid, p])); if (X.view === 'list') render(); }).catch(() => {}); }
function open() { const el = box(); el.hidden = false; document.body.classList.add('chat-open'); loadPeople(); if (X.view === 'list') render(); }
function close() { const el = $('chatBox'); if (el) el.hidden = true; document.body.classList.remove('chat-open'); leaveRoom(); X.view = 'list'; badge(); }
function back() { if (X.view === 'room') leaveRoom(); X.view = 'list'; render(); }
function leaveRoom() { if (X.unMsgs) { X.unMsgs(); X.unMsgs = null; } X.room = null; X.reply = null; swRoom(null); }
function swRoom(room) { try { navigator.serviceWorker && navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage({ chatOpen: room }); } catch (e) { /* bỏ qua */ } }

const person = (uid) => X.people.get(uid) || { uid, name: 'Người dùng' };
function nameOf(uid) { const p = person(uid); return p.name || 'Người dùng'; }
function kinTxt(uid) { const p = person(uid); const k = p.me && X.ctx.kinOf(p.me); return k && k.t !== 'Tôi' ? k.t : ''; }
function av(uid, sz = 36) {
  const p = person(uid), ps = p.me && X.ctx.byId(p.me);
  return ps && ps.photo ? `<img class="cav" style="width:${sz}px;height:${sz}px" src="${esc(ps.photo)}" alt="">`
    : `<span class="cav ${ps && ps.gender === 'f' ? 'f' : ''}" style="width:${sz}px;height:${sz}px">${esc(initials(p.name))}</span>`;
}
function roomTitle(r) {
  if (r.type === 'all') return 'Cả họ – ' + (X.ctx.tree.name || '');
  if (r.type === 'dm') { const o = (r.members || []).find((u) => u !== D.myUid()); return nameOf(o); }
  return r.name || 'Nhóm';
}
function roomAv(r, sz = 42) {
  if (r.type === 'dm') return av((r.members || []).find((u) => u !== D.myUid()), sz);
  return `<span class="cav grp ${r.type}" style="width:${sz}px;height:${sz}px"><i class="fa-solid ${r.type === 'all' ? 'fa-house-chimney' : 'fa-user-group'}"></i></span>`;
}
function render() {
  if (!X || !$('chatBox') || $('chatBox').hidden) return;
  if (X.view === 'list') return renderList();
}
function renderList() {
  const me = D.myUid(), el = box();
  const rooms = [...X.rooms].sort((a, b) => (a.type === 'all' ? -1 : b.type === 'all' ? 1 : 0) || ms((b.last || {}).at || b.updatedAt) - ms((a.last || {}).at || a.updatedAt));
  el.innerHTML = `<div class="cbh"><b>Tin nhắn</b><span class="sp"></span>
      <button class="cbi" id="cbNew" title="Nhắn tin mới"><i class="fa-solid fa-pen-to-square"></i></button><button class="cbi" id="cbGrp" title="Tạo nhóm"><i class="fa-solid fa-user-group"></i><i class="fa-solid fa-plus mini"></i></button>
      <button class="cbi" id="cbX" title="Đóng"><i class="fa-solid fa-xmark"></i></button></div>
    <div class="cbs"><i class="fa-solid fa-magnifying-glass"></i><input id="cbQ" placeholder="Tìm cuộc trò chuyện…" autocomplete="off"></div>
    <div class="cbl" id="cbL">${rooms.map((r) => {
      const un = r.last && r.last.by !== me && ms(r.last.at) > ((r.reads || {})[me] || 0), mute = (r.muted || {})[me];
      const tagMe = un && ((r.last.mention || []).includes(me) || (r.last.mention || []).includes('*'));
      const last = (tagMe ? '<b class="tagme">@ Có người nhắc bạn</b> ' : '') + (r.last ? `${r.type !== 'dm' && r.last.by !== me ? esc((r.last.byName || '').split(' ').slice(-1)[0]) + ': ' : r.last.by === me ? 'Bạn: ' : ''}${esc(r.last.text || '')}` : '<i>Chưa có tin nhắn</i>');
      const sub = r.type === 'dm' ? kinTxt((r.members || []).find((u) => u !== me)) : '';
      return `<div class="cbr ${un ? 'un' : ''}" data-r="${esc(r.id)}">${roomAv(r)}<div class="t"><b>${esc(roomTitle(r))}${sub ? ` <small>· ${esc(sub)}</small>` : ''}${mute ? ' <i class="fa-solid fa-bell-slash" style="opacity:.5"></i>' : ''}</b><span>${last}</span></div>
        <div class="m"><small>${esc(shortTime((r.last || {}).at))}</small>${un && !mute ? '<i class="dot"></i>' : ''}</div></div>`;
    }).join('') || '<div class="cbe"><i class="fa-regular fa-comments"></i>Chưa có cuộc trò chuyện</div>'}</div>`;
  $('cbX').onclick = close;
  $('cbNew').onclick = () => pickPeople(false);
  $('cbGrp').onclick = () => pickPeople(true);
  $('cbQ').oninput = () => { const t = $('cbQ').value.trim().toLowerCase(); el.querySelectorAll('.cbr').forEach((r) => (r.hidden = !!t && !r.innerText.toLowerCase().includes(t))); };
  el.querySelectorAll('[data-r]').forEach((r) => (r.onclick = () => openRoom(r.dataset.r)));
}

// ---------- chọn người: nhắn 2 người / tạo nhóm / thêm vào nhóm ----------
function sortedPeople(exclude = new Set()) {
  const me = D.myUid(), mine = person(me), A = X.ctx.A;
  const gMe = mine.me && A && A.gen.get(mine.me);
  const list = [...X.people.values()].filter((p) => p.uid !== me && !exclude.has(p.uid));
  const near = (p) => { const g = p.me && A && A.gen.get(p.me); return gMe != null && g != null && kinTxt(p.uid) ? Math.abs(g - gMe) : 99; };
  return list.sort((a, b) => near(a) - near(b) || String(a.name).localeCompare(String(b.name), 'vi')).map((p) => ({ ...p, near: near(p) < 99 }));
}
function pickPeople(group, room) {
  X.view = 'pick';
  const el = box(), sel = new Set(), list = sortedPeople(room ? new Set(room.members) : new Set());
  const row = (p) => `<label class="cbr" data-u="${esc(p.uid)}">${group ? `<input type="checkbox" value="${esc(p.uid)}">` : ''}${av(p.uid)}<div class="t"><b>${esc(p.name || '')}</b><span>${esc([kinTxt(p.uid), p.me && X.ctx.label(p.me)].filter(Boolean).join(' · ') || 'Chưa gắn với người trong gia phả')}</span></div></label>`;
  const near = list.filter((p) => p.near), rest = list.filter((p) => !p.near);
  el.innerHTML = `<div class="cbh"><button class="cbi" id="cbB"><i class="fa-solid fa-arrow-left"></i></button><b>${room ? 'Thêm người vào nhóm' : group ? 'Tạo nhóm' : 'Nhắn tin mới'}</b><span class="sp"></span></div>
    ${group && !room ? '<div class="cbs"><i class="fa-solid fa-user-group"></i><input id="cbGN" placeholder="Tên nhóm (vd: Cháu nội ông Tổ)" maxlength="80"></div>' : ''}
    <div class="cbs"><i class="fa-solid fa-magnifying-glass"></i><input id="cbQ" placeholder="Tìm người…" autocomplete="off"></div>
    <div class="cbl" id="cbL">${near.length ? `<div class="cbsec">Gần bạn</div>${near.map(row).join('')}` : ''}${rest.length ? `<div class="cbsec">${near.length ? 'Cả họ' : 'Người có tài khoản'}</div>${rest.map(row).join('')}` : ''}
      ${!list.length ? '<div class="cbe">Chưa có ai khác có tài khoản</div>' : ''}</div>
    ${group ? `<div class="cbf"><button class="abtn blue full" id="cbOk" disabled><i class="fa-solid fa-check"></i>${room ? 'Thêm' : 'Tạo nhóm'} (<span id="cbN">0</span>)</button></div>` : ''}`;
  $('cbB').onclick = () => (room ? openRoom(room.id) : back());
  $('cbQ').oninput = () => { const t = $('cbQ').value.trim().toLowerCase(); el.querySelectorAll('[data-u]').forEach((r) => (r.hidden = !!t && !r.innerText.toLowerCase().includes(t))); };
  if (!group) { el.querySelectorAll('[data-u]').forEach((r) => (r.onclick = async () => { try { openRoom(await D.openDm(X.tree, r.dataset.u)); } catch (e) { toast(D.errMsg(e), 4000); } })); return; }
  el.querySelectorAll('input[type=checkbox]').forEach((c) => (c.onchange = () => { c.checked ? sel.add(c.value) : sel.delete(c.value); $('cbN').textContent = sel.size; $('cbOk').disabled = !sel.size; }));
  $('cbOk').onclick = async () => {
    try {
      if (room) { await D.updateGroup(room.id, { name: room.name, members: [...new Set([...room.members, ...sel])] }); toast(`Đã thêm ${sel.size} người`); openRoom(room.id); return; }
      const name = $('cbGN').value.trim() || [...sel].slice(0, 3).map((u) => nameOf(u).split(' ').slice(-1)[0]).join(', ');
      openRoom(await D.createGroup(X.tree, name, [...sel]));
    } catch (e) { toast(D.errMsg(e), 4000); }
  };
}

// ---------- trong phòng ----------
function roomOf(id) { return X.rooms.find((r) => r.id === id); }
function openRoom(id) {
  leaveRoom();
  X.view = 'room'; X.room = id; X.n = 30; X.msgs = []; X.mentions = new Set();
  const el = box();
  el.innerHTML = `<div class="cbh" id="cbHead"></div>
    <div class="cbm" id="cbM"><div class="cbe"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>
    <div class="cbrep" id="cbRep" hidden></div><div class="cbmen" id="cbMen" hidden></div>
    <form class="cbc" id="cbC"><label class="cbi" title="Gửi ảnh"><i class="fa-regular fa-image"></i><input type="file" accept="image/*" id="cbImg" hidden></label>
      ${(roomOf(id) || {}).type !== 'dm' ? '<button type="button" class="cbi at" id="cbAt" title="Nhắc tên (@)">@</button>' : ''}
      <textarea id="cbT" rows="1" placeholder="Nhập tin nhắn…" maxlength="2000"></textarea><button class="cbi send" id="cbSend" title="Gửi"><i class="fa-solid fa-paper-plane"></i></button></form>`;
  header();
  swRoom(id);
  X.unMsgs = D.watchMsgs(id, X.n, (l, e) => { if (!X || X.room !== id) return; if (!l) { $('cbM').innerHTML = `<div class="cbe">${esc(D.errMsg(e))}</div>`; return; } X.msgs = l; drawMsgs(true); readNow(); });
  const t = $('cbT');
  t.oninput = () => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px'; mention(); };
  t.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); $('cbC').requestSubmit(); } };
  if ($('cbAt')) $('cbAt').onclick = () => {   // nút @: chèn @ tại con trỏ → hiện danh sách người để nhắc
    const p = t.selectionStart ?? t.value.length, pre = t.value.slice(0, p);
    const ins = (pre && !/\s$/.test(pre) ? ' ' : '') + '@';
    t.value = pre + ins + t.value.slice(p); t.focus(); t.selectionStart = t.selectionEnd = p + ins.length; mention();
  };
  $('cbC').onsubmit = async (e) => { e.preventDefault(); const text = t.value.trim(); if (!text) return; t.value = ''; t.oninput(); await send({ text }); };
  $('cbImg').onchange = async () => {
    const f = $('cbImg').files[0]; $('cbImg').value = ''; if (!f) return;
    try { const img = await compress(f); if (await ask({ title: 'Gửi ảnh?', msg: `<img src="${img}" style="max-width:100%;border-radius:12px">`, ok: 'Gửi' })) await send({ text: t.value.trim(), img }), (t.value = ''); }
    catch (er) { toast(er.message || 'Không đọc được ảnh', 4000); }
  };
  $('cbM').onscroll = () => { if ($('cbM').scrollTop < 40 && X.msgs.length >= X.n && !X.loading) older(); };
  setTimeout(() => { if (!matchMedia('(pointer:coarse)').matches) t.focus(); }, 100);
}
function header() {
  const r = roomOf(X.room), h = $('cbHead'); if (!h) return;
  if (!r) { h.innerHTML = '<button class="cbi" id="cbB"><i class="fa-solid fa-arrow-left"></i></button><b>Đang mở…</b>'; $('cbB').onclick = back; return; }
  const other = r.type === 'dm' ? (r.members || []).find((u) => u !== D.myUid()) : null, op = other && person(other);
  const sub = r.type === 'dm' ? [kinTxt(other), op && op.me && X.ctx.label(op.me)].filter(Boolean).join(' · ') : `${r.type === 'all' ? X.people.size : (r.members || []).length} thành viên`;
  h.innerHTML = `<button class="cbi" id="cbB"><i class="fa-solid fa-arrow-left"></i></button>${roomAv(r, 34)}<div class="t"><b>${esc(roomTitle(r))}</b><small>${esc(sub)}</small></div><span class="sp"></span>
    <button class="cbi" id="cbInfo" title="Thông tin"><i class="fa-solid fa-circle-info"></i></button>`;
  $('cbB').onclick = back; $('cbInfo').onclick = () => info(r);
}
let READ_T = 0;
function readNow() {
  const r = roomOf(X.room), me = D.myUid();
  if (!r || document.hidden || !r.last || ms(r.last.at) <= ((r.reads || {})[me] || 0)) return;
  clearTimeout(READ_T); const id = X.room;
  READ_T = setTimeout(() => D.markRead(id).catch(() => {}), 600);
}
document.addEventListener('visibilitychange', () => { if (X && X.view === 'room' && !document.hidden) readNow(); });
function drawMsgs(stick) {
  const m = $('cbM'); if (!m) return;
  const me = D.myUid(), r = roomOf(X.room) || {}, atBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 80;
  let day = '', prev = null;
  const seenTo = r.type === 'dm' ? (r.reads || {})[(r.members || []).find((u) => u !== me)] || 0 : 0;
  const lastMine = [...X.msgs].reverse().find((x) => x.by === me);
  m.innerHTML = (X.msgs.length >= X.n ? '<div class="cbe sm">Kéo lên để xem tin cũ hơn</div>' : '') + X.msgs.map((x) => {
    const d = new Date(ms(x.at) || Date.now()), dl = dayLabel(d), mine = x.by === me;
    const head = dl !== day ? `<div class="cbday"><span>${dl}</span></div>` : ''; day = dl;
    const cont = prev && prev.by === x.by && !head && ms(x.at) - ms(prev.at) < 5 * 60e3; prev = x;
    const reacts = Object.values(x.reactions || {}); const rc = {}; reacts.forEach((e) => (rc[e] = (rc[e] || 0) + 1));
    // tô đúng tên được nhắc (theo danh sách mentions của tin), không đoán theo số chữ
    let txt = esc(x.text || '').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    for (const u of x.mentions || []) { const nm = esc('@' + (u === '*' ? 'Tất cả' : nameOf(u))); txt = txt.split(nm).join(`<b class="men">${nm}</b>`); }
    const tagMe = !mine && (x.mentions || []).some((u) => u === me || u === '*');
    return `${head}<div class="cbmsg ${mine ? 'me' : ''} ${cont ? 'cont' : ''} ${tagMe ? 'tagme' : ''}" data-m="${esc(x.id)}">
      ${!mine ? `<div class="cbav">${cont ? '' : av(x.by, 28)}</div>` : ''}
      <div class="cbb">${!mine && !cont && r.type !== 'dm' ? `<div class="cbn">${esc(x.byName || nameOf(x.by))}${kinTxt(x.by) ? ` · ${esc(kinTxt(x.by))}` : ''}</div>` : ''}
        ${x.deleted ? '<i class="cbdel">Tin nhắn đã thu hồi</i>' : `${x.replyTo ? `<div class="cbq"><b>${esc(x.replyTo.byName || '')}</b>${esc(x.replyTo.text || '')}</div>` : ''}${x.img ? `<img class="cbimg" src="${esc(x.img)}" alt="Ảnh">` : ''}${txt ? `<div class="cbtx">${txt}</div>` : ''}`}
        <div class="cbt">${hm(d)}${mine && x === lastMine && r.type === 'dm' ? (seenTo >= ms(x.at) ? ' · Đã xem' : ' · Đã gửi') : ''}</div>
        ${reacts.length ? `<div class="cbrx">${Object.entries(rc).map(([e, n]) => `${e}${n > 1 ? n : ''}`).join(' ')}</div>` : ''}</div></div>`;
  }).join('') || '<div class="cbe"><i class="fa-regular fa-hand"></i>Hãy gửi lời chào đầu tiên</div>';
  m.querySelectorAll('[data-m]').forEach((el) => bindMsg(el));
  m.querySelectorAll('.cbimg').forEach((im) => (im.onclick = (e) => { e.stopPropagation(); viewImg(im.src); }));
  if (stick && (atBottom || !X.drawn)) m.scrollTop = m.scrollHeight;
  X.drawn = true;
}
async function older() {
  X.loading = true;
  try {
    const first = X.msgs[0]; if (!first) return;
    const more = await D.olderMsgs(X.room, first.at, 30);
    if (!more.length) { X.n = Infinity; return; }
    const m = $('cbM'), h = m.scrollHeight;
    X.msgs = [...more, ...X.msgs]; X.n += more.length; drawMsgs(false); m.scrollTop = m.scrollHeight - h;
  } finally { X.loading = false; }
}
function bindMsg(el) {
  let t = 0;
  const menu = async () => {
    const x = X.msgs.find((y) => y.id === el.dataset.m); if (!x || x.deleted) return;
    const mine = x.by === D.myUid(), young = Date.now() - ms(x.at) < 24 * 3600e3;
    const opts = [['reply', '↩  Trả lời'], ...EMO.map((e) => ['e' + e, `${e}  ${(x.reactions || {})[D.myUid()] === e ? 'Bỏ cảm xúc' : 'Thả cảm xúc'}`]), ...(x.text ? [['copy', '📋  Sao chép']] : []), ...(mine && young ? [['recall', '🗑  Thu hồi']] : [])];
    const v = await pick({ title: 'Tin nhắn', options: opts }); if (!v) return;
    try {
      if (v === 'reply') { X.reply = { id: x.id, by: x.by, byName: x.byName || nameOf(x.by), text: x.img && !x.text ? '📷 Ảnh' : (x.text || '').slice(0, 100) }; showReply(); $('cbT').focus(); }
      else if (v[0] === 'e') { const e = v.slice(1); await D.reactMsg(X.room, x.id, (x.reactions || {})[D.myUid()] === e ? null : e); }
      else if (v === 'copy') { await navigator.clipboard.writeText(x.text); toast('Đã sao chép'); }
      else if (v === 'recall' && await ask({ title: 'Thu hồi tin nhắn?', msg: 'Mọi người sẽ thấy "Tin nhắn đã thu hồi".', ok: 'Thu hồi', danger: true })) await D.recallMsg(X.room, x.id);
    } catch (er) { toast(D.errMsg(er), 4000); }
  };
  el.oncontextmenu = (e) => { e.preventDefault(); menu(); };
  el.onpointerdown = (e) => { if (e.target.closest('a')) return; t = setTimeout(menu, 500); };
  el.onpointerup = el.onpointerleave = el.onpointercancel = () => clearTimeout(t);
  el.ondblclick = () => menu();
}
function showReply() {
  const b = $('cbRep'); if (!b) return;
  b.hidden = !X.reply;
  if (X.reply) { b.innerHTML = `<div><b>Trả lời ${esc(X.reply.byName)}</b><span>${esc(X.reply.text)}</span></div><button class="cbi" id="cbRepX"><i class="fa-solid fa-xmark"></i></button>`; $('cbRepX').onclick = () => { X.reply = null; showReply(); }; }
}
// @ nhắc tên (Cả họ / nhóm): gõ @ → gợi ý người trong phòng
function mention() {
  const r = roomOf(X.room), box2 = $('cbMen'), t = $('cbT');
  if (!r || r.type === 'dm') return;
  const m = t.value.slice(0, t.selectionStart).match(/@([^\s@]*)$/);
  if (!m) { box2.hidden = true; return; }
  // gõ @ (chưa gõ chữ) → hiện cả danh sách như Zalo; gõ tiếp → lọc theo tên (không dấu cũng được)
  const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const q = fold(m[1]), uids = (r.type === 'all' ? [...X.people.keys()] : r.members || []).filter((u) => u !== D.myUid());
  const hit = uids.filter((u) => fold(nameOf(u) + ' ' + kinTxt(u)).includes(q)).slice(0, 50);
  const allOpt = !q || fold('tat ca moi nguoi all').includes(q);
  box2.hidden = !hit.length && !allOpt;
  box2.innerHTML = (allOpt ? `<button type="button" data-mu="*"><span class="cav grp all" style="width:24px;height:24px"><i class="fa-solid fa-at"></i></span> <b>Tất cả</b> <small>· báo cho mọi người trong ${r.type === 'all' ? 'họ' : 'nhóm'}</small></button>` : '')
    + hit.map((u) => `<button type="button" data-mu="${esc(u)}">${av(u, 24)} ${esc(nameOf(u))}${kinTxt(u) ? ` <small>· ${esc(kinTxt(u))}</small>` : ''}</button>`).join('');
  box2.querySelectorAll('[data-mu]').forEach((b) => (b.onclick = () => {
    const u = b.dataset.mu, nm = u === '*' ? 'Tất cả' : nameOf(u), pos = t.selectionStart, before = t.value.slice(0, pos).replace(/@([^\s@]*)$/, '@' + nm + ' ');
    t.value = before + t.value.slice(pos); X.mentions.add(u); box2.hidden = true; t.focus(); t.selectionStart = t.selectionEnd = before.length;
  }));
}
async function send({ text, img }) {
  const id = X.room, replyTo = X.reply || undefined, mentions = [...X.mentions].filter((u) => text.includes('@' + (u === '*' ? 'Tất cả' : nameOf(u))));
  X.reply = null; X.mentions = new Set(); showReply();
  try { await D.sendMsg(id, { text, img, replyTo, mentions }); }
  catch (e) { toast(D.errMsg(e), 4000); }
}
function viewImg(src) {
  const o = document.createElement('div'); o.className = 'cbview'; o.innerHTML = `<img src="${esc(src)}" alt=""><button class="cbi"><i class="fa-solid fa-xmark"></i></button>`;
  o.onclick = () => o.remove(); document.body.appendChild(o);
}
/** Nén ảnh trên máy trước khi gửi: cạnh dài ≤ 1280px, JPEG, ≤ ~115 KB (gói miễn phí). Sau này đổi sang Storage chỉ cần thay hàm này */
async function compress(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Không đọc được ảnh')); i.src = url; });
    for (const max of [1280, 1024, 800, 640]) {
      const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      for (const q of [0.75, 0.6, 0.45]) { const d = c.toDataURL('image/jpeg', q); if (d.length <= 155000) return d; }
    }
    throw new Error('Ảnh quá lớn, hãy chọn ảnh khác');
  } finally { URL.revokeObjectURL(url); }
}

// ---------- thông tin phòng: thành viên, tắt thông báo, đổi tên, thêm / bớt, rời nhóm ----------
function info(r) {
  X.view = 'info';
  const el = box(), me = D.myUid(), muted = !!(r.muted || {})[me], boss = r.type === 'group' && (r.createdBy === me || X.ctx.isOwner);
  const mem = r.type === 'all' ? [...X.people.keys()] : r.members || [];
  el.innerHTML = `<div class="cbh"><button class="cbi" id="cbB"><i class="fa-solid fa-arrow-left"></i></button><b>Thông tin</b><span class="sp"></span></div>
    <div class="cbl">
      <div class="cbinfo">${roomAv(r, 64)}<b>${esc(roomTitle(r))}</b>${boss ? '<button class="abtn sm" id="cbRen"><i class="fa-solid fa-pen"></i>Đổi tên</button>' : ''}</div>
      <label class="cbr"><i class="fa-solid fa-bell-slash" style="width:36px;text-align:center"></i><div class="t"><b>Tắt thông báo</b><span>Vẫn nhận khi có người @nhắc tên bạn</span></div><input type="checkbox" id="cbMute" ${muted ? 'checked' : ''}></label>
      <div class="cbsec">${mem.length} thành viên${boss ? ' <button class="abtn sm" id="cbAdd"><i class="fa-solid fa-user-plus"></i>Thêm</button>' : ''}</div>
      ${mem.map((u) => `<div class="cbr" data-u="${esc(u)}">${av(u)}<div class="t"><b>${esc(nameOf(u))}${u === me ? ' (bạn)' : ''}</b><span>${esc([kinTxt(u), r.createdBy === u && r.type === 'group' ? 'tạo nhóm' : ''].filter(Boolean).join(' · '))}</span></div>
        ${boss && u !== me ? `<button class="cbi" data-rm="${esc(u)}" title="Mời ra khỏi nhóm"><i class="fa-solid fa-user-minus"></i></button>` : u !== me ? `<button class="cbi" data-dm="${esc(u)}" title="Nhắn riêng"><i class="fa-regular fa-comment"></i></button>` : ''}</div>`).join('')}
      ${r.type === 'group' ? '<div class="cbf"><button class="abtn red full" id="cbLeave"><i class="fa-solid fa-right-from-bracket"></i>Rời nhóm</button></div>' : ''}
    </div>`;
  $('cbB').onclick = () => openRoom(r.id);
  $('cbMute').onchange = () => D.setMute(r.id, $('cbMute').checked).then(() => toast($('cbMute').checked ? 'Đã tắt thông báo' : 'Đã bật thông báo')).catch((e) => toast(D.errMsg(e), 4000));
  if ($('cbRen')) $('cbRen').onclick = async () => { const v = await ask({ title: 'Đổi tên nhóm', fields: [{ id: 'n', ph: 'Tên nhóm', value: r.name }], ok: 'Lưu' }); if (v && v.n.trim()) D.updateGroup(r.id, { name: v.n.trim().slice(0, 80), members: r.members }).then(() => { r.name = v.n.trim(); info(r); }).catch((e) => toast(D.errMsg(e), 4000)); };
  if ($('cbAdd')) $('cbAdd').onclick = () => pickPeople(true, r);
  el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
    if (!await ask({ title: 'Mời ra khỏi nhóm?', msg: `<b>${esc(nameOf(b.dataset.rm))}</b> sẽ không xem được nhóm này nữa.`, ok: 'Mời ra', danger: true })) return;
    const members = r.members.filter((u) => u !== b.dataset.rm); D.updateGroup(r.id, { name: r.name, members }).then(() => { r.members = members; info(r); }).catch((e) => toast(D.errMsg(e), 4000));
  }));
  el.querySelectorAll('[data-dm]').forEach((b) => (b.onclick = async () => { try { openRoom(await D.openDm(X.tree, b.dataset.dm)); } catch (e) { toast(D.errMsg(e), 4000); } }));
  if ($('cbLeave')) $('cbLeave').onclick = async () => {
    if (!await ask({ title: 'Rời nhóm?', msg: `Bạn sẽ không nhận tin của nhóm <b>${esc(r.name)}</b> nữa.`, ok: 'Rời nhóm', danger: true })) return;
    D.updateGroup(r.id, { members: r.members.filter((u) => u !== me) }).then(() => { X.view = 'list'; render(); toast('Đã rời nhóm'); }).catch((e) => toast(D.errMsg(e), 4000));
  };
  el.querySelectorAll('.cbr[data-u]').forEach((x) => (x.onclick = (e) => { if (e.target.closest('button')) return; const p = person(x.dataset.u); if (p.me && X.ctx.byId(p.me)) X.ctx.showPerson(p.me); }));
}
