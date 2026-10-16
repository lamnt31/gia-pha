// Cách gọi họ hàng theo góc nhìn của "tôi" (người trong gia phả được gắn với tài khoản đang đăng nhập).
// Tìm tổ tiên chung gần nhất (LCA) giữa tôi và người kia → số đời mỗi bên (d: tôi, e: người kia) → cách gọi.
// Vai vế (bác/chú, anh/em họ) tính theo thứ bậc của nhánh (con thứ, rồi năm sinh) – không theo tuổi người đó.
// Người lấy vào họ (vợ/chồng): gọi theo người phối ngẫu (chú → thím, cô → dượng…).

/** Từ gọi theo vùng miền */
export const DIALECTS = {
  bac: { name: 'Miền Bắc', father: 'Bố', mother: 'Mẹ', pUo: 'Bác', pUy: 'Chú', pAo: 'Bác', pAy: 'Cô', mUo: 'Bác', mUy: 'Cậu', mAo: 'Bác', mAy: 'Dì', pU: 'Bác/Chú', pA: 'Bác/Cô', mU: 'Bác/Cậu', mA: 'Bác/Dì',
    wife: { Bác: 'Bác gái', Chú: 'Thím', Cậu: 'Mợ' }, hus: { Bác: 'Bác trai', Cô: 'Chú', Dì: 'Chú' } },
  trung: { name: 'Miền Trung', father: 'Ba', mother: 'Mạ', pUo: 'Bác', pUy: 'Chú', pAo: 'O', pAy: 'O', mUo: 'Cậu', mUy: 'Cậu', mAo: 'Dì', mAy: 'Dì', pU: 'Bác/Chú', pA: 'O', mU: 'Cậu', mA: 'Dì',
    wife: { Bác: 'Bác gái', Chú: 'Thím', Cậu: 'Mợ' }, hus: { O: 'Dượng', Dì: 'Dượng' } },
  nam: { name: 'Miền Nam', father: 'Ba', mother: 'Má', pUo: 'Bác', pUy: 'Chú', pAo: 'Cô', pAy: 'Cô', mUo: 'Cậu', mUy: 'Cậu', mAo: 'Dì', mAy: 'Dì', pU: 'Bác/Chú', pA: 'Cô', mU: 'Cậu', mA: 'Dì',
    wife: { Bác: 'Bác gái', Chú: 'Thím', Cậu: 'Mợ' }, hus: { Cô: 'Dượng', Dì: 'Dượng' } },
};
const yr = (p) => +((String(p.birthSolar || p.birthLunar || '').match(/(\d{3,4})$/) || [])[1]) || 0;
/** x lớn hơn (anh/chị) y? Cùng cha mẹ + có "con thứ" → theo con thứ; không thì theo năm sinh; không rõ → null */
function older(x, y) {
  const sib = (x.fatherId && x.fatherId === y.fatherId) || (x.motherId && x.motherId === y.motherId);
  if (sib && x.order && y.order && x.order !== y.order) return x.order < y.order;
  const a = yr(x), b = yr(y);
  return a && b && a !== b ? a < b : null;
}
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Tạo bộ tính cách gọi. A: analyze() của cây; meId: người "tôi"; dialect: bac | trung | nam.
 * Trả về kin(id) → { t: cách gọi, hint: giải thích } hoặc null
 */
export function makeKin(A, meId, dialect = 'bac') {
  const W = DIALECTS[dialect] || DIALECTS.bac, by = (id) => (id && A.byId.get(id)) || null, me = by(meId);
  if (!me) return () => null;
  // tổ tiên (kể cả chính mình ở 0 đời) + đường đi ngắn nhất: Map(id → [người, cha/mẹ, …, tổ tiên])
  const memo = new Map();
  const ups = (p) => {
    if (memo.has(p.id)) return memo.get(p.id);
    const m = new Map([[p.id, [p]]]), q = [p];
    while (q.length) {
      const x = q.shift(), path = m.get(x.id);
      for (const pid of [x.fatherId, x.motherId]) { const pr = by(pid); if (pr && !m.has(pr.id)) { m.set(pr.id, [...path, pr]); q.push(pr); } }
    }
    memo.set(p.id, m); return m;
  };
  const anc = (d, pm) => {   // gọi tổ tiên cách d đời; pm = đường đi của tôi (bên nội / ngoại theo cha / mẹ)
    const a = pm[d], side = pm[1] && pm[1].gender === 'f' ? ' ngoại' : ' nội', m = a.gender !== 'f';
    if (d === 1) return m ? W.father : W.mother;
    if (d === 2) return (m ? 'Ông' : 'Bà') + side;
    if (d === 3) return (m ? 'Cụ ông' : 'Cụ bà') + side;
    if (d === 4) return (m ? 'Kỵ ông' : 'Kỵ bà') + side;
    return `Tổ tiên (trên ${d} đời)`;
  };
  const uncle = (x, sideF, o) => {   // hàng cha mẹ: sideF = qua mẹ (ngoại)?; o = nhánh người kia lớn hơn nhánh tôi?
    const k = (sideF ? 'm' : 'p') + (x.gender === 'f' ? 'A' : 'U');
    return o === true ? W[k + 'o'] : o === false ? W[k + 'y'] : W[k];
  };
  /** Quan hệ huyết thống giữa người gốc (root) và x */
  const blood = (root, x) => {
    const um = ups(root), ux = ups(x);
    let best = null;
    for (const [id, px] of ux) { const pm = um.get(id); if (pm && (!best || pm.length + px.length < best.pm.length + best.px.length)) best = { pm, px }; }
    if (!best) return null;
    const { pm, px } = best, d = pm.length - 1, e = px.length - 1, m = x.gender !== 'f', lca = pm[d];
    const hint = d >= 1 && e >= 1 ? `chung ${lc(anc(d, pm))}: ${lca.name || 'Chưa rõ tên'}` : '';
    if (d === 0 && e === 0) return { t: 'Tôi', hint: '' };
    if (e === 0) return { t: anc(d, pm), hint: '' };
    if (d === 0) {
      const via = px[e - 1].gender === 'f' ? ' ngoại' : ' nội';   // con trai → cháu nội, con gái → cháu ngoại
      const t = e === 1 ? (m ? 'Con trai' : 'Con gái') : e === 2 ? 'Cháu' + via : e === 3 ? 'Chắt' : e === 4 ? 'Chút' : e === 5 ? 'Chít' : `Hậu duệ (dưới ${e} đời)`;
      return { t, hint: '' };
    }
    const a = pm[d - 1], b = px[e - 1], o = older(b, a), g = d - e;
    if (d === 1 && e === 1) { const ox = older(x, root); return { t: ox === true ? (m ? 'Anh' : 'Chị') : ox === false ? (m ? 'Em trai' : 'Em gái') : (m ? 'Anh/em trai' : 'Chị/em gái'), hint: '' }; }
    const ho = e === 1 ? '' : ' họ';   // anh/chị/em ruột của tổ tiên trực hệ → không thêm "họ"
    if (g === 0) return { t: (o === true ? (m ? 'Anh' : 'Chị') : o === false ? 'Em' : (m ? 'Anh/em' : 'Chị/em')) + ' họ', hint };
    if (g > 0) {
      const u = uncle(x, pm[g].gender === 'f', o);   // hàng chú bác của người tôi ở đời ngang người kia (pm[g-1])
      if (g === 1) return { t: u + (e === 1 ? '' : ' họ'), hint: e === 1 ? `${m ? 'anh/em trai' : 'chị/em gái'} của ${lc(anc(1, pm))}` : hint };
      if (g === 2) return { t: (m ? 'Ông ' : 'Bà ') + lc(u.split('/')[0]) + ho, hint };
      if (g === 3) return { t: (m ? 'Cụ ông ' : 'Cụ bà ') + lc(u.split('/')[0]) + ho, hint };
      return { t: `Bậc trên (${g} đời)`, hint };
    }
    const h = -g, ch = d === 1 ? '' : ' họ';
    return { t: h === 1 ? 'Cháu' + ch : h === 2 ? 'Chắt' + ch : `Cháu (dưới ${h} đời)`, hint };
  };
  /** Vợ / chồng của người có cách gọi t */
  const inLaw = (t, y, x) => {
    const f = x.gender === 'f';
    if (t === W.father) return { t: 'Mẹ kế' };
    if (t === W.mother) return { t: 'Bố dượng' };
    const mm = t.match(/^(Ông|Bà|Cụ ông|Cụ bà|Kỵ ông|Kỵ bà)( nội| ngoại)?$/);
    if (mm) return { t: ({ 'Ông': 'Bà', 'Bà': 'Ông', 'Cụ ông': 'Cụ bà', 'Cụ bà': 'Cụ ông', 'Kỵ ông': 'Kỵ bà', 'Kỵ bà': 'Kỵ ông' })[mm[1]] + (mm[2] || '') };
    const [base, ...rest] = t.split(' '), suf = rest.join(' ');
    const sfx = (s) => s + (suf === 'họ' ? ' họ' : '');
    if (t === 'Anh' || t === 'Anh họ') return { t: sfx('Chị dâu') };
    if (t === 'Chị' || t === 'Chị họ') return { t: sfx('Anh rể') };
    if (t === 'Em trai') return { t: 'Em dâu' };
    if (t === 'Em gái') return { t: 'Em rể' };
    if (/^Em( họ)?$/.test(t)) return { t: (f ? 'Em dâu' : 'Em rể') + (t.endsWith('họ') ? ' họ' : '') };
    if (t === 'Con trai') return { t: 'Con dâu' };
    if (t === 'Con gái') return { t: 'Con rể' };
    if (/^(Cháu|Chắt)/.test(t)) return { t: base + (f ? ' dâu' : ' rể') + (suf.endsWith('họ') ? ' họ' : '') };
    // hàng chú bác: chú → thím, cậu → mợ, cô → dượng…; ông chú → bà thím
    const pre = t.match(/^(Ông|Bà|Cụ ông|Cụ bà) (\S+)(.*)$/);
    const key = pre ? pre[2].charAt(0).toUpperCase() + pre[2].slice(1) : base.split('/')[0];
    const mp = f ? W.wife[key] : W.hus[key];
    if (mp) {
      if (pre) return { t: ({ 'Ông': 'Bà', 'Bà': 'Ông', 'Cụ ông': 'Cụ bà', 'Cụ bà': 'Cụ ông' })[pre[1]] + ' ' + lc(mp) + pre[3] };
      return { t: mp + (suf === 'họ' ? ' họ' : '') };
    }
    return { t: (f ? 'Vợ của ' : 'Chồng của ') + lc(t) };
  };
  // người "tôi" lấy vào họ (không có cha mẹ trong cây) → gọi theo vợ / chồng có trong họ
  const mySp = (me.spouseIds || []).map(by).filter(Boolean);
  const inHo = (p) => by(p.fatherId) || by(p.motherId) || A.allKids(p.id).length;
  const anchor = !by(me.fatherId) && !by(me.motherId) ? mySp.find(inHo) : null;
  const side = anchor ? (me.gender === 'f' ? ' (bên chồng)' : ' (bên vợ)') : '';

  return (id) => {
    const x = by(id); if (!x) return null;
    if (x.id === me.id) return { t: 'Tôi', hint: '' };
    if (mySp.some((s) => s.id === x.id)) return { t: x.gender === 'f' ? 'Vợ' : 'Chồng', hint: '' };
    const r = blood(me, x);
    if (r) return r;
    // vợ / chồng của người có họ hàng với tôi
    let best = null;
    for (const y of (x.spouseIds || []).map(by).filter(Boolean)) {
      const ry = blood(me, y);
      if (ry && ry.t !== 'Tôi') { const t = inLaw(ry.t, y, x).t; if (!best) best = { t, hint: `${x.gender === 'f' ? 'vợ' : 'chồng'} của ${lc(ry.t)} ${y.name || ''}`.trim() }; }
    }
    if (best) return best;
    if (anchor) {
      const ra = blood(anchor, x);
      if (ra) {
        if (ra.t === W.father || ra.t === W.mother) return { t: (ra.t === W.father ? W.father : W.mother) + (me.gender === 'f' ? ' chồng' : ' vợ'), hint: '' };
        return { t: ra.t + side, hint: ra.hint };
      }
      for (const y of (x.spouseIds || []).map(by).filter(Boolean)) { const ry = blood(anchor, y); if (ry) return { t: inLaw(ry.t, y, x).t + side, hint: `${x.gender === 'f' ? 'vợ' : 'chồng'} của ${y.name || ''}` }; }
    }
    return null;
  };
}
