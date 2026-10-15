// Lớp dữ liệu: Firebase Auth + Cloud Firestore (gói Spark).
// Mô hình nhiều khách hàng: mỗi dòng họ đăng ký 1 tài khoản ROOT; root tự tạo người dùng (tên đăng nhập riêng trong dòng họ).
// Tiết kiệm lượt đọc: bộ nhớ đệm trên máy + chỉ tải người thay đổi sau lần đồng bộ trước (lọc theo updatedAt).
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {
  getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signOut, connectAuthEmulator,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, updatePassword,
  reauthenticateWithCredential, EmailAuthProvider, signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED, connectFirestoreEmulator,
  doc, collection, getDoc, getDocs, getDocsFromCache, onSnapshot, query, where, orderBy, limit,
  writeBatch, serverTimestamp, increment, arrayUnion, arrayRemove, deleteField, Timestamp, updateDoc, setDoc, deleteDoc,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import { firebaseConfig, recaptchaSiteKey, vapidPublicKey } from './firebase-config.js?v=1792059859463';

// ?emu=1 → chạy với Firebase Emulator trên máy (kiểm thử, không đụng dữ liệu thật)
export const isEmu = new URLSearchParams(location.search).has('emu') && ['localhost', '127.0.0.1'].includes(location.hostname);
const CFG = isEmu ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-gia-pha', appId: 'demo' } : firebaseConfig;
const app = initializeApp(CFG);
export const auth = getAuth(app);
export const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: CACHE_SIZE_UNLIMITED }) });
if (isEmu) { connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectFirestoreEmulator(db, '127.0.0.1', 8080); }
if (!isEmu && recaptchaSiteKey) {
  import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app-check.js').then(({ initializeAppCheck, ReCaptchaV3Provider }) =>
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(recaptchaSiteKey), isTokenAutoRefreshEnabled: true }));
}

export const LIMIT_TREES = 1, LIMIT_PERSONS = 5000;   // mỗi dòng họ 1 gia phả; xem họ khác bằng chia sẻ (làm sau)
export const CODE_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;      // mã dòng họ
export const USER_RE = /^[a-z0-9][a-z0-9._]{1,29}$/;     // tên đăng nhập
// Người dùng không có email: đăng nhập bằng email "ảo" không gửi thư được (chỉ để Firebase Auth nhận diện)
const synthEmail = (username, code) => `${username}@${code}.giapha.local`;

export let me = null;        // Firebase user đang đăng nhập
export let clan = null;      // { code, name, rootUid, trees: {id: tên}, treeCount, ... }
export let account = null;   // clans/{code}/users/{uid}: { role: 'root'|'user', username, name, phone, email, title, active, trees: {id: 'editor'|'member'} }
export const isRoot = () => !!account && account.role === 'root';
export const myName = () => (account && (account.name || account.username)) || '';
export const clanCode = () => (clan && clan.code) || localStorage.getItem('clan') || '';

/** Thông báo lỗi dễ hiểu */
export function errMsg(e) {
  const c = String(e && (e.code || e.message) || e);
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-login'))
    return 'Sai mã dòng họ, tên đăng nhập hoặc mật khẩu.';
  if (c.includes('too-many-requests')) return 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ít phút.';
  if (c.includes('email-already-in-use')) return 'Email này đã được dùng cho một tài khoản khác.';
  if (c.includes('invalid-email')) return 'Email không hợp lệ.';
  if (c.includes('weak-password')) return 'Mật khẩu cần ít nhất 6 ký tự.';
  if (c.includes('requires-recent-login')) return 'Vui lòng đăng nhập lại rồi thử lại.';
  if (c.includes('resource-exhausted') || c.includes('quota')) return 'Hệ thống tạm quá tải (hết hạn mức miễn phí trong ngày). Vui lòng thử lại sau.';
  if (c.includes('permission-denied')) return 'Bạn không có quyền thực hiện thao tác này.';
  if (c.includes('unavailable') || c.includes('network')) return 'Mất kết nối mạng. Thay đổi sẽ tự gửi khi có mạng lại.';
  return (e && e.message) || c;
}

// ======================= Đăng nhập, đăng ký =======================
let userCb = null, busyAuth = false;
/** cb(user | null, lỗi?) – gọi khi đăng nhập / đăng xuất, đã nạp sẵn dòng họ và tài khoản */
export function onUser(cb) {
  userCb = cb;
  return onAuthStateChanged(auth, async (u) => {
    if (busyAuth) return;                // đang đăng ký: chờ ghi xong rồi tự gọi lại
    me = u; clan = null; account = null;
    if (u && u.isAnonymous) { await signOut(auth); return; }   // phiên ẩn danh của link nhờ điền: không dùng cho app
    if (!u) return cb(null);
    try { await loadAccount(); cb(u); }
    catch (e) { await signOut(auth); cb(null, e); }
  });
}
async function loadAccount() {
  const code = localStorage.getItem('clan');
  if (!code) throw new Error('Phiên đăng nhập cũ. Vui lòng đăng nhập lại.');
  const a = await getDoc(doc(db, 'clans', code, 'users', me.uid));
  if (!a.exists()) throw new Error('Tài khoản không thuộc dòng họ này.');
  account = { uid: me.uid, ...a.data() };
  if (account.active === false) throw new Error('Tài khoản đã bị tắt. Liên hệ quản trị dòng họ.');
  clan = { code, ...(await getDoc(doc(db, 'clans', code))).data() };
  await loadShares();
}
export async function reloadAccount() { await loadAccount(); }

/** Đăng nhập: mã dòng họ + tên đăng nhập + mật khẩu */
export async function login(code, username, password) {
  code = code.trim().toLowerCase(); username = username.trim().toLowerCase();
  const l = await getDoc(doc(db, 'logins', `${code}_${username}`));
  if (!l.exists()) throw { code: 'invalid-credential' };
  localStorage.setItem('clan', code);
  await signInWithEmailAndPassword(auth, l.data().authEmail, password);
}
export const logout = () => signOut(auth);

/** Quên mật khẩu: chỉ người dùng có email thật mới tự lấy lại được */
export async function forgotPassword(code, username) {
  code = code.trim().toLowerCase(); username = username.trim().toLowerCase();
  const l = await getDoc(doc(db, 'logins', `${code}_${username}`));
  if (!l.exists()) throw new Error('Không tìm thấy tên đăng nhập trong dòng họ này.');
  if (!l.data().hasEmail) throw new Error('Tài khoản này không có email. Hãy nhờ quản trị dòng họ cấp tài khoản mới.');
  await sendPasswordResetEmail(auth, l.data().authEmail);
  return l.data().authEmail.replace(/^(.{2}).*(@.*)$/, '$1***$2');
}
export async function changePassword(oldPw, newPw) {
  await reauthenticateWithCredential(me, EmailAuthProvider.credential(me.email, oldPw));
  await updatePassword(me, newPw);
}

/**
 * Đăng ký dòng họ mới: tạo tài khoản root (email thật để lấy lại mật khẩu) + dòng họ + gia phả đầu tiên.
 * f: { code, clanName, name, phone, email, username, password }
 */
export async function register(f) {
  const code = f.code.trim().toLowerCase(), username = (f.username || 'admin').trim().toLowerCase();
  if (!CODE_RE.test(code)) throw new Error('Mã dòng họ chỉ gồm chữ thường không dấu, số, gạch ngang; 3–30 ký tự.');
  if (!USER_RE.test(username)) throw new Error('Tên đăng nhập chỉ gồm chữ thường không dấu, số, dấu chấm, gạch dưới.');
  if ((await getDoc(doc(db, 'logins', `${code}_${username}`))).exists()) throw new Error('Mã dòng họ này đã được đăng ký.');
  busyAuth = true;
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, f.email.trim(), f.password);
    const uid = cred.user.uid, b = writeBatch(db);
    b.set(doc(db, 'clans', code), { name: f.clanName.trim(), rootUid: uid, contact: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(),
      treeCount: 0, trees: {}, createdAt: serverTimestamp() });
    b.set(doc(db, 'clans', code, 'users', uid), { role: 'root', username, name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(),
      title: 'Quản trị dòng họ', active: true, trees: {}, createdAt: serverTimestamp() });
    b.set(doc(db, 'logins', `${code}_${username}`), { clan: code, username, uid, role: 'root', authEmail: f.email.trim(), hasEmail: true });
    try { await b.commit(); }
    catch (e) { await cred.user.delete().catch(() => {}); throw String(e.code).includes('permission') ? new Error('Mã dòng họ này đã được đăng ký.') : e; }
    localStorage.setItem('clan', code);
    me = cred.user; await loadAccount();
    await createTree({ name: f.clanName.trim() });
  } finally { busyAuth = false; }
  if (userCb) userCb(me);
}

// ======================= Gia phả =======================
/** Gia phả tôi được xem: root thấy tất cả gia phả của dòng họ; người dùng chỉ thấy gia phả được gán */
export function myTrees() {
  const all = (clan && clan.trees) || {};
  return Object.entries(all).filter(([id]) => isRoot() || (account.trees || {})[id])
    .map(([id, name]) => ({ id, name, role: isRoot() ? 'owner' : account.trees[id] }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'))
    // gia phả họ khác được chia sẻ cho tôi
    .concat(shares.filter((x) => !all[x.tree]).map((x) => ({ id: x.tree, name: x.treeName, role: x.role, shared: true, clanName: x.clanName })));
}

export async function createTree({ name, origin = '', desc = '' }) {
  if (!isRoot()) throw new Error('Chỉ quản trị dòng họ mới tạo được gia phả.');
  if ((clan.treeCount || 0) >= LIMIT_TREES) throw new Error(`Mỗi dòng họ tạo tối đa ${LIMIT_TREES} gia phả.`);
  const ref = doc(collection(db, 'trees'));
  const b = writeBatch(db);
  b.update(doc(db, 'clans', clan.code), { treeCount: increment(1), [`trees.${ref.id}`]: name });
  b.set(ref, { name, origin, desc, clan: clan.code, owner: me.uid, personCount: 0, anchorId: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.set(doc(db, 'trees', ref.id, 'members', me.uid), { role: 'owner', name: myName() });
  await b.commit();
  clan.treeCount = (clan.treeCount || 0) + 1; clan.trees = { ...clan.trees, [ref.id]: name };
  return ref.id;
}

/** Mở gia phả: đọc thông tin + vai trò của tôi */
export async function openTree(treeId) {
  try {
    const [t, m] = await Promise.all([getDoc(doc(db, 'trees', treeId)), getDoc(doc(db, 'trees', treeId, 'members', me.uid))]);
    if (!t.exists() || !m.exists()) throw { code: 'permission-denied' };
    return { tree: { id: treeId, ...t.data() }, role: m.data().role };
  } catch (e) {
    if (String(e.code).includes('permission-denied')) throw new Error('Bạn chưa được cấp quyền xem gia phả này.');
    throw e;
  }
}
export async function updateTree(treeId, data) {
  await updateDoc(doc(db, 'trees', treeId), { ...data, updatedAt: serverTimestamp() });
  if (data.name) { await updateDoc(doc(db, 'clans', clan.code), { [`trees.${treeId}`]: data.name }); clan.trees[treeId] = data.name; }
}
export async function updateClan(data) {
  await updateDoc(doc(db, 'clans', clan.code), data);
  Object.assign(clan, data);
}
/** Tự sửa thông tin của mình (tên, số điện thoại) */
export async function updateMe(data) {
  await updateDoc(doc(db, 'clans', clan.code, 'users', me.uid), data);
  Object.assign(account, data);
}

// ======================= Quản lý người dùng (root) =======================
export async function listUsers() {
  const s = await getDocs(collection(db, 'clans', clan.code, 'users'));
  return s.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
/** Ghi quyền trên từng gia phả: có quyền → set member; không có / bị tắt → xóa member */
function applyTreeRoles(b, uid, name, newTrees, oldTrees, active) {
  for (const t of new Set([...Object.keys(newTrees || {}), ...Object.keys(oldTrees || {})])) {
    const ref = doc(db, 'trees', t, 'members', uid);
    if (active && newTrees[t]) b.set(ref, { role: newTrees[t], name });
    else if (oldTrees && oldTrees[t]) b.delete(ref);
  }
}
/**
 * Root tạo người dùng. f: { username, name, phone, email?, title, password, trees: {treeId: 'editor'|'member'} }
 * Dùng 1 phiên Firebase phụ để tạo tài khoản, không làm root bị đăng xuất.
 */
export async function createUser(f) {
  const username = f.username.trim().toLowerCase(), email = (f.email || '').trim();
  if (!USER_RE.test(username)) throw new Error('Tên đăng nhập chỉ gồm chữ thường không dấu, số, dấu chấm, gạch dưới (2–30 ký tự).');
  const key = `${clan.code}_${username}`;
  if ((await getDoc(doc(db, 'logins', key))).exists()) throw new Error('Tên đăng nhập này đã có trong dòng họ.');
  const sec = initializeApp(CFG, 'tao-user-' + Date.now());
  const sa = initializeAuth(sec, { persistence: inMemoryPersistence });
  if (isEmu) connectAuthEmulator(sa, 'http://127.0.0.1:9099', { disableWarnings: true });
  try {
    const cred = await createUserWithEmailAndPassword(sa, email || synthEmail(username, clan.code), f.password);
    const uid = cred.user.uid, b = writeBatch(db), trees = f.trees || {};
    b.set(doc(db, 'clans', clan.code, 'users', uid), { role: 'user', username, name: f.name.trim(), phone: (f.phone || '').trim(), email,
      title: (f.title || '').trim(), active: true, trees, createdAt: serverTimestamp(), createdBy: me.uid });
    b.set(doc(db, 'logins', key), { clan: clan.code, username, uid, role: 'user', authEmail: email || synthEmail(username, clan.code), hasEmail: !!email });
    applyTreeRoles(b, uid, f.name.trim(), trees, {}, true);
    try { await b.commit(); } catch (e) { await cred.user.delete().catch(() => {}); throw e; }
    return uid;
  } finally { await signOut(sa).catch(() => {}); await deleteApp(sec).catch(() => {}); }
}
/** Root sửa người dùng: thông tin, quyền từng gia phả, bật / tắt */
export async function updateUser(u, f) {
  const b = writeBatch(db), active = f.active !== false, trees = f.trees || {};
  b.update(doc(db, 'clans', clan.code, 'users', u.uid), { name: f.name.trim(), phone: (f.phone || '').trim(), title: (f.title || '').trim(), active, trees });
  applyTreeRoles(b, u.uid, f.name.trim(), trees, u.trees || {}, active);
  await b.commit();
}

// ======================= Người trong gia phả =======================
// Đồng bộ: đọc toàn bộ từ đệm trên máy (miễn phí) → lắng nghe từ server chỉ những người có updatedAt mới hơn.
let SYNC = null;   // { treeId, map, cb, unsub }
const val = (d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) });
export function watchPersons(treeId, cb) {
  stopPersons();
  const S = (SYNC = { treeId, map: new Map(), cb, unsub: null, stopped: false });
  const col = collection(db, 'trees', treeId, 'persons');
  const emit = () => S.cb([...S.map.values()].filter((p) => !p.deleted), null);
  (async () => {
    let max = null;
    try {
      const snap = await getDocsFromCache(col);
      snap.forEach((d) => {
        const p = val(d); S.map.set(d.id, p);
        if (!d.metadata.hasPendingWrites && p.updatedAt && (!max || p.updatedAt.toMillis() > max.toMillis())) max = p.updatedAt;
      });
      if (snap.size) emit();
    } catch (e) { /* chưa có đệm */ }
    if (S.stopped) return;
    const q = max ? query(col, where('updatedAt', '>', max)) : col;
    S.unsub = onSnapshot(q, (snap) => {
      // bỏ qua 'removed': người rời khỏi kết quả lọc vì đang chờ ghi (xóa thật dùng cờ deleted)
      snap.docChanges().forEach((ch) => { if (ch.type !== 'removed') S.map.set(ch.doc.id, val(ch.doc)); });
      emit();
    }, (e) => S.cb(null, e));
  })();
}
export function stopPersons() { if (SYNC) { SYNC.stopped = true; if (SYNC.unsub) SYNC.unsub(); SYNC = null; } }
const patchLocal = (id, data) => {
  if (!SYNC) return;
  SYNC.map.set(id, { ...(SYNC.map.get(id) || { id }), ...data, updatedAt: Timestamp.now() });
  SYNC.cb([...SYNC.map.values()].filter((p) => !p.deleted), null);
};

const logOp = (b, treeId, action, person, before, after) =>
  b.set(doc(collection(db, 'trees', treeId, 'log')), {
    by: me.uid, byName: myName(), at: serverTimestamp(), action, personId: person.id, personName: person.name || 'Chưa rõ tên',
    ...(before ? { before } : {}), ...(after ? { after } : {}),
  });
const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: me.uid });
const clean = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v; return r; };
const forLog = (o) => { const r = { ...o }; delete r.photo; delete r.updatedAt; delete r.id; return r; };

/**
 * Lưu nhiều thay đổi trong 1 lượt (batch):
 *   adds:    [{id?, ...data}]  → người mới (tăng personCount)
 *   updates: [{id, ...fields}] → sửa (fields có thể dùng arrayUnion/arrayRemove qua helper rel)
 * Trả về id các người mới.
 */
export async function saveChanges(treeId, { adds = [], updates = [] }, current = new Map()) {
  const b = writeBatch(db), ids = [];
  for (const a of adds) {
    const ref = a.id ? doc(db, 'trees', treeId, 'persons', a.id) : doc(collection(db, 'trees', treeId, 'persons'));
    const data = clean({ ...a, id: undefined, deleted: false, createdBy: me.uid, ...stamp() });
    b.set(ref, data); ids.push(ref.id);
    logOp(b, treeId, 'add', { id: ref.id, name: a.name }, null, forLog(a));
  }
  for (const u of updates) {
    const { id, _log = true, ...fields } = u;
    b.update(doc(db, 'trees', treeId, 'persons', id), clean({ ...fields, ...stamp() }));
    if (_log) {
      const old = current.get(id) || {};
      const plain = Object.fromEntries(Object.entries(fields).filter(([, v]) => v === null || typeof v !== 'object' || Array.isArray(v)));
      const before = Object.fromEntries(Object.keys(plain).map((k) => [k, old[k] ?? null]));
      logOp(b, treeId, 'edit', { id, name: fields.name ?? old.name }, forLog(before), forLog(plain));
    }
  }
  if (adds.length) b.update(doc(db, 'trees', treeId), { personCount: increment(adds.length), updatedAt: serverTimestamp() });
  const commit = b.commit();
  // cập nhật giao diện ngay, không chờ server (ngoại tuyến vẫn dùng được)
  adds.forEach((a, i) => patchLocal(ids[i], clean({ ...a, id: ids[i], deleted: false })));
  updates.forEach(({ id, _log, ...f }) => {
    const old = SYNC && SYNC.map.get(id);
    const nf = {};
    for (const [k, v] of Object.entries(f)) nf[k] = v && v._rel ? v.apply((old && old[k]) || []) : v;
    patchLocal(id, nf);
  });
  await Promise.race([commit, new Promise((r) => setTimeout(r, navigator.onLine ? 15000 : 300))]);
  return ids;
}
/** Thêm/bớt phần tử trong mảng (spouseIds): dùng được cả cho Firestore lẫn bản tạm trên máy */
export const rel = {
  add: (id) => Object.assign(arrayUnion(id), { _rel: true, apply: (a) => [...new Set([...a, id])] }),
  remove: (id) => Object.assign(arrayRemove(id), { _rel: true, apply: (a) => a.filter((x) => x !== id) }),
};

/** Xóa mềm (để máy khác đồng bộ được): đánh dấu deleted + gỡ khỏi quan hệ của người khác */
export async function deletePerson(treeId, p, all) {
  const b = writeBatch(db);
  b.update(doc(db, 'trees', treeId, 'persons', p.id), { deleted: true, ...stamp() });
  const touched = [];
  for (const o of all) {
    if (o.id === p.id) continue;
    const f = {};
    if (o.fatherId === p.id) f.fatherId = '';
    if (o.motherId === p.id) f.motherId = '';
    if ((o.spouseIds || []).includes(p.id)) f.spouseIds = arrayRemove(p.id);
    if (Object.keys(f).length) { b.update(doc(db, 'trees', treeId, 'persons', o.id), { ...f, ...stamp() }); touched.push([o, f]); }
  }
  b.update(doc(db, 'trees', treeId), { personCount: increment(-1), updatedAt: serverTimestamp() });
  logOp(b, treeId, 'delete', p, forLog(p), null);
  const commit = b.commit();
  patchLocal(p.id, { deleted: true });
  for (const [o, f] of touched) patchLocal(o.id, { ...f, ...(f.spouseIds ? { spouseIds: (o.spouseIds || []).filter((x) => x !== p.id) } : {}) });
  await Promise.race([commit, new Promise((r) => setTimeout(r, navigator.onLine ? 15000 : 300))]);
}

// ======================= Đề xuất sửa (thành viên chỉ xem) =======================
export async function addProposal(treeId, { personId, personName, text }) {
  const ref = doc(collection(db, 'trees', treeId, 'proposals'));
  await setDoc(ref, { by: me.uid, byName: myName(), at: serverTimestamp(), personId: personId || '', personName: personName || '', text, status: 'open' });
}
export async function listProposals(treeId, onlyOpen = true) {
  const col = collection(db, 'trees', treeId, 'proposals');
  const s = await getDocs(onlyOpen ? query(col, where('status', '==', 'open')) : query(col, orderBy('at', 'desc'), limit(50)));
  return s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).sort((a, b) => b.at - a.at);
}
export const resolveProposal = (treeId, id, status) =>
  updateDoc(doc(db, 'trees', treeId, 'proposals', id), { status, resolvedBy: me.uid, resolvedByName: myName(), resolvedAt: serverTimestamp() });

// ======================= Nhật ký =======================
export async function listLog(treeId, n = 60) {
  const s = await getDocs(query(collection(db, 'trees', treeId, 'log'), orderBy('at', 'desc'), limit(n)));
  return s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
}

/** Tạo sẵn mã cho người mới (để nối quan hệ trong cùng 1 batch) */
export const newPersonId = (treeId) => doc(collection(db, 'trees', treeId, 'persons')).id;

// ======================= Liên kết hồ sơ giữa 2 gia phả (nội – ngoại, họ vợ) =======================
// Bên B (có hồ sơ) tạo mã hồ sơ → gửi link → bên A chọn người tương ứng trong cây mình → tạo liên kết.
const randomCode = () => { const a = crypto.getRandomValues(new Uint8Array(18)); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_'); };
export async function createShareCode(tree, person, info = '', days = 7) {   // link liên kết hồ sơ
  const code = randomCode();
  await setDoc(doc(db, 'shareCodes', code), {
    clan: clan.code, clanName: clan.name || clan.code, tree: tree.id, treeName: tree.name, person: person.id, name: person.name || 'Chưa rõ tên', info,
    createdBy: me.uid, createdByName: myName(), createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + days * 864e5),
  });
  return code;
}
export const shareLink = (code) => `${location.origin}${location.pathname}?link=${encodeURIComponent(code)}`;
export async function peekShareCode(code) {
  const s = await getDoc(doc(db, 'shareCodes', code));
  if (!s.exists()) throw new Error('Mã liên kết không tồn tại hoặc đã bị hủy.');
  const d = s.data();
  if (d.expiresAt.toMillis() < Date.now()) throw new Error('Mã liên kết đã hết hạn. Hãy xin bên kia gửi mã mới.');
  return { code, ...d };
}
/** Tạo liên kết: a = người trong cây đang mở (của tôi), b = người trong mã hồ sơ */
export async function createLink(sc, tree, person) {
  const a = { clan: clan.code, clanName: clan.name || clan.code, tree: tree.id, treeName: tree.name, person: person.id, name: person.name || 'Chưa rõ tên' };
  const b = { clan: sc.clan, clanName: sc.clanName, tree: sc.tree, treeName: sc.treeName, person: sc.person, name: sc.name, info: sc.info || '' };
  if (a.tree === b.tree) throw new Error('Hai hồ sơ cùng một gia phả – hãy dùng "Nối quan hệ".');
  const id = `${a.tree}_${a.person}__${b.tree}_${b.person}`;
  const ref = doc(db, 'links', id);
  try { await setDoc(ref, { a, b, code: sc.code, by: me.uid, byName: myName(), at: serverTimestamp() }); }
  catch (e) { if (String(e.code).includes('permission')) throw new Error('Không liên kết được: đã liên kết rồi, mã hết hạn, hoặc bạn không có quyền sửa gia phả này.'); throw e; }
  return id;
}
/** Liên kết của 1 gia phả → Map(personId → [{id, other:{clan, clanName, tree, treeName, person, name, info}}]) */
export async function listLinks(treeId) {
  const col = collection(db, 'links');
  const [x, y] = await Promise.all([getDocs(query(col, where('a.tree', '==', treeId))), getDocs(query(col, where('b.tree', '==', treeId)))]);
  const m = new Map(), add = (pid, v) => { if (!m.has(pid)) m.set(pid, []); m.get(pid).push(v); };
  x.forEach((d) => { const v = d.data(); add(v.a.person, { id: d.id, other: v.b, by: v.byName }); });
  y.forEach((d) => { const v = d.data(); add(v.b.person, { id: d.id, other: v.a, by: v.byName }); });
  return m;
}
export const removeLink = (id) => deleteDoc(doc(db, 'links', id));

// ======================= Chia sẻ gia phả bằng LINK / QR (vd chồng xem gia phả họ vợ) =======================
// Root tạo link (chọn quyền, hạn dùng, 1 người hay nhiều người) → gửi Zalo / QR → người dòng họ khác mở link,
// đăng nhập bằng tài khoản của họ, bấm Nhận → chỉ tài khoản đó xem được. Rút chia sẻ: mất quyền ngay.
export let shares = [];   // gia phả được chia sẻ cho tôi
export async function loadShares() {
  try { const s = await getDocs(query(collection(db, 'shares'), where('uid', '==', me.uid))); shares = s.docs.map((d) => ({ id: d.id, ...d.data() })); }
  catch (e) { shares = []; }
}
const SHARE_ROLE = { viewer: 'Chỉ xem', member: 'Xem + gửi đề xuất' };
export const shareRoleName = (r) => SHARE_ROLE[r] || r;
export async function createShareLink(tree, role, single, days = 7) {
  const code = randomCode();
  await setDoc(doc(db, 'shareLinks', code), { tree: tree.id, treeName: tree.name, clan: clan.code, clanName: clan.name || clan.code, role, single,
    usedBy: null, by: me.uid, byName: myName(), createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + days * 864e5) });
  return code;
}
export const treeShareLink = (code) => `${location.origin}${location.pathname}?share=${encodeURIComponent(code)}`;
export async function peekShareLink(code) {
  const s = await getDoc(doc(db, 'shareLinks', code));
  if (!s.exists()) throw new Error('Link chia sẻ không tồn tại hoặc đã bị hủy.');
  const L = { code, ...s.data() };
  if (L.expiresAt.toMillis() < Date.now()) throw new Error('Link chia sẻ đã hết hạn. Hãy xin quản trị bên kia gửi link mới.');
  if (L.single && L.usedBy && L.usedBy !== me.uid) throw new Error('Link này chỉ dùng cho 1 người và đã có người nhận.');
  return L;
}
/** Người mở link bấm Nhận: ghi quyền xem cho chính tài khoản này */
export async function acceptShareLink(L) {
  if (L.clan === clan.code) throw new Error('Đây là gia phả của dòng họ bạn – không cần nhận chia sẻ.');
  const b = writeBatch(db);
  if (L.single) b.update(doc(db, 'shareLinks', L.code), { usedBy: me.uid, usedByName: myName(), usedAt: serverTimestamp() });
  b.set(doc(db, 'shares', `${L.tree}_${me.uid}`), { tree: L.tree, treeName: L.treeName, clan: L.clan, clanName: L.clanName, uid: me.uid, role: L.role, via: L.code,
    name: myName(), fromClan: clan.code, fromClanName: clan.name || clan.code, username: account.username, at: serverTimestamp() });
  b.set(doc(db, 'trees', L.tree, 'members', me.uid), { role: L.role, name: myName(), shared: true, via: L.code, fromClan: clan.code, username: account.username });
  try { await b.commit(); }
  catch (e) { if (String(e.code).includes('permission')) throw new Error('Không nhận được: link hết hạn, đã bị hủy, đã có người dùng, hoặc bạn đã xem gia phả này rồi.'); throw e; }
  await loadShares();
}
/** Root: link đang có + ai đang xem */
export async function listShareLinks(treeId) {
  const s = await getDocs(query(collection(db, 'shareLinks'), where('tree', '==', treeId)));
  return s.docs.map((d) => ({ code: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
}
export async function listShares(treeId) {
  const s = await getDocs(query(collection(db, 'shares'), where('tree', '==', treeId)));
  return s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
}
export const cancelShareLink = (code) => deleteDoc(doc(db, 'shareLinks', code));
/** Root rút chia sẻ: xóa quyền + bản ghi trong 1 lượt → mất quyền ngay */
export async function revokeShare(sh) {
  const b = writeBatch(db);
  b.delete(doc(db, 'trees', sh.tree, 'members', sh.uid));
  b.delete(doc(db, 'shares', sh.id));
  b.set(doc(collection(db, 'trees', sh.tree, 'log')), { by: me.uid, byName: myName(), at: serverTimestamp(), action: 'unshare', personId: '', personName: `${sh.name || ''} (${sh.fromClanName || ''})` });
  await b.commit();
}
/** Người được chia sẻ tự bỏ theo dõi */
export async function leaveShare(treeId) {
  const b = writeBatch(db);
  b.delete(doc(db, 'trees', treeId, 'members', me.uid));
  b.delete(doc(db, 'shares', `${treeId}_${me.uid}`));
  await b.commit();
  await loadShares();
}

// ======================= Thông báo đẩy (Web Push) – giỗ, sinh nhật (BA-thong-bao.md) =======================
// Thiết bị đăng ký → lưu pushSubs/{id}. Máy gửi theo lịch (repo gia-pha-cron, 7h sáng) đọc bảng sự kiện của các gia phả
// mà tài khoản có quyền xem (kể cả được chia sẻ) rồi gửi thông báo.
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!vapidPublicKey;
const b64ToU8 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...b].map((c) => c.charCodeAt(0))); };
const subId = async (endpoint) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)))].slice(0, 20).map((x) => x.toString(16).padStart(2, '0')).join('');
/** Trạng thái thông báo trên máy này: { supported, permission, on, days, kinds } */
export async function pushStatus() {
  if (!pushSupported()) return { supported: false };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  let saved = null;
  if (sub) { try { const s = await getDoc(doc(db, 'pushSubs', await subId(sub.endpoint))); if (s.exists() && s.data().uid === me.uid) saved = s.data(); } catch (e) { /* chưa có */ } }
  return { supported: true, permission: Notification.permission, on: !!saved, days: (saved && saved.days) || [0, 3], kinds: (saved && saved.kinds) || ['gio', 'sn', 'duyet'] };
}
export async function enablePush({ days, kinds }) {
  if (!pushSupported()) throw new Error('Trình duyệt này chưa hỗ trợ thông báo đẩy.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Bạn chưa cho phép thông báo. Hãy bật lại quyền Thông báo cho trang này trong cài đặt trình duyệt.');
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('sw.js'));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(vapidPublicKey) }));
  await setDoc(doc(db, 'pushSubs', await subId(sub.endpoint)), { uid: me.uid, clan: clan.code, name: myName(), sub: JSON.parse(JSON.stringify(sub)), days, kinds,
    ua: navigator.userAgent.slice(0, 200), updatedAt: serverTimestamp() });
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return;
  try { await deleteDoc(doc(db, 'pushSubs', await subId(sub.endpoint))); } catch (e) { /* đã xóa */ }
  await sub.unsubscribe();
}
/** Thông báo thử ngay trên máy này (kiểm tra hiển thị) */
export async function testNotify(title, body) {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: location.pathname + '?tab=gio' } });
}

/** Bảng sự kiện thu gọn của 1 gia phả (máy gửi chỉ đọc 1 tài liệu). Chỉ ghi khi có thay đổi. */
const EVH = new Map();
export async function syncEvents(treeId, items) {
  const json = JSON.stringify(items);
  let h = 0; for (let i = 0; i < json.length; i++) h = (h * 31 + json.charCodeAt(i)) | 0;
  const hash = String(h >>> 0) + ':' + items.length;
  if (!EVH.has(treeId)) { try { const s = await getDoc(doc(db, 'trees', treeId, 'meta', 'events')); EVH.set(treeId, s.exists() ? s.data().hash : ''); } catch (e) { EVH.set(treeId, ''); } }
  if (EVH.get(treeId) === hash) return;
  await setDoc(doc(db, 'trees', treeId, 'meta', 'events'), { items, hash, updatedAt: serverTimestamp() });
  EVH.set(treeId, hash);
}

// ======================= Link nhờ điền thông tin (không cần tài khoản) – 1 người, cả gia đình hoặc cả nhánh =======================
// Biên tập tạo link kèm bản chép thông tin hiện tại của các thành viên trong phạm vi → gửi vào nhóm / cho chủ hộ.
// Mỗi người mở link (phiên ẩn danh) gửi 1 bản cho mỗi thành viên, có thể thêm người mới (con, vợ/chồng).
// Biên tập duyệt ở "Duyệt thông tin", chọn trường áp dụng vào hồ sơ.
export const COLLECT_FIELDS = ['name', 'nick', 'alias', 'gender', 'branch', 'order', 'adopted', 'birthSolar', 'birthLunar', 'alive', 'deathSolar', 'deathLunar', 'birthPlace', 'address', 'burial', 'job', 'note', 'photo'];
const COLLECT_MAX = 300;
/** list: [{p, info}] – thành viên trong phạm vi (người đầu tiên = người gốc) */
export async function createCollectLink(tree, list, { scope = 'one', allowAdd = false, days = 7 } = {}) {
  const code = randomCode(), snaps = {}, persons = [];
  let budget = 600000;   // ảnh nén ~40 KB/người; giữ tài liệu < 1 MB
  for (const { p, info } of list.slice(0, COLLECT_MAX)) {
    const snap = { info: info || '' };
    for (const k of COLLECT_FIELDS) if (p[k] !== undefined && p[k] !== null && p[k] !== '') snap[k] = p[k];
    if (snap.photo) { if (snap.photo.length > budget) delete snap.photo; else budget -= snap.photo.length; }
    snaps[p.id] = snap; persons.push(p.id);
  }
  const main = list[0].p;
  await setDoc(doc(db, 'collectLinks', code), { tree: tree.id, treeName: tree.name, clanName: clan.name || clan.code, person: main.id, name: main.name || 'Chưa rõ tên',
    persons, snaps, scope, allowAdd: !!allowAdd, by: me.uid, byName: myName(), createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + days * 864e5) });
  return code;
}
export const collectLinkUrl = (code) => `${location.origin}${location.pathname}?collect=${encodeURIComponent(code)}`;
/** Mở link: phiên đang có hoặc phiên ẩn danh; trả về link + các bản tôi đã gửi (Map khóa → bản) */
export async function openCollect(code) {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const s = await getDoc(doc(db, 'collectLinks', code));
  if (!s.exists()) throw new Error('Link không tồn tại hoặc đã bị hủy.');
  const link = { code, ...s.data() };
  if (link.expiresAt.toMillis() < Date.now()) throw new Error('Link đã hết hạn. Hãy xin người quản lý gia phả gửi link mới.');
  if (!link.persons) { link.persons = [link.person]; link.snaps = { [link.person]: link.snap || {} }; }   // link cũ (1 người)
  const mine = new Map();
  try {
    const q = await getDocs(query(collection(db, 'collectSubs'), where('uid', '==', auth.currentUser.uid), where('code', '==', code)));
    q.forEach((d) => mine.set(d.data().key || d.data().person, { id: d.id, ...d.data() }));
  } catch (e) { /* chưa gửi */ }
  return { link, mine };
}
/** Gửi / gửi lại 1 bản. person = '' khi thêm người mới (kèm rel {kind, of}) */
export async function submitCollect(link, { key, person, personName, all, from, phone, rel, existed }) {
  const snap = (person && link.snaps[person]) || {}, data = {};
  for (const k of COLLECT_FIELDS) {
    const a = all[k] ?? '', b = snap[k] ?? (k === 'alive' ? true : k === 'gender' ? 'm' : k === 'adopted' ? false : '');
    if (person ? String(a) !== String(b) : a !== '' && a !== null && !(k === 'adopted' && !a)) data[k] = all[k];
  }
  if (!person) { data.alive = all.alive; data.gender = all.gender; }
  const ref = doc(db, 'collectSubs', `${link.code}_${auth.currentUser.uid}_${key}`);
  if (existed) await updateDoc(ref, { data, from, phone, at: serverTimestamp() });
  else await setDoc(ref, { code: link.code, uid: auth.currentUser.uid, tree: link.tree, person, key, personName, ...(rel ? { rel } : {}), data, from, phone, status: 'open', at: serverTimestamp() });
}
export const newKey = () => 'new' + Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, '').padEnd(8, '0');
export async function listCollectSubs(treeId) {
  const s = await getDocs(query(collection(db, 'collectSubs'), where('tree', '==', treeId), where('status', '==', 'open')));
  return s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
}
export const resolveCollect = (id, status, applied = []) =>
  updateDoc(doc(db, 'collectSubs', id), { status, applied, resolvedBy: me.uid, resolvedByName: myName(), resolvedAt: serverTimestamp() });
