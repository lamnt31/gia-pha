// Lớp dữ liệu: Firebase Auth + Cloud Firestore (gói Spark).
// Mô hình nhiều khách hàng: mỗi dòng họ đăng ký 1 tài khoản ROOT; root tự tạo người dùng (tên đăng nhập riêng trong dòng họ).
// Tiết kiệm lượt đọc: bộ nhớ đệm trên máy + chỉ tải người thay đổi sau lần đồng bộ trước (lọc theo updatedAt).
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {
  getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signOut, connectAuthEmulator,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, updatePassword,
  reauthenticateWithCredential, EmailAuthProvider,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED, connectFirestoreEmulator,
  doc, collection, getDoc, getDocs, getDocsFromCache, onSnapshot, query, where, orderBy, limit,
  writeBatch, serverTimestamp, increment, arrayUnion, arrayRemove, deleteField, Timestamp, updateDoc, setDoc,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import { firebaseConfig, recaptchaSiteKey } from './firebase-config.js';

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

export const LIMIT_TREES = 3, LIMIT_PERSONS = 5000;
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
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
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
