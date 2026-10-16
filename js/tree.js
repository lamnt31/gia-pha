// Vẽ cây gia phả (SVG): xếp theo đời, vợ/chồng đứng cạnh, con dưới cha mẹ; thu gọn nhánh; kéo / phóng to / 2 ngón tay
import { esc } from './ui.js?v=1792137394822';

const NW = 156, NH = 66, GAP_SP = 10, GAP_SIB = 26, VGAP = 120;

/**
 * Tính quan hệ + số đời.
 * persons: [{id, name, gender, fatherId, motherId, spouseIds, order, ...}]
 * anchorId: người làm mốc "đời 1" (tùy chọn)
 * -> { byId, kids(id), spouseIn:Set, roots:[], gen:Map(id -> đời thật từ gốc), label(id) -> "Đời 3" / "Thượng tổ" }
 */
export function analyze(persons, anchorId) {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const has = (id) => id && byId.has(id);
  // Người "về làm dâu / rể" (đứng cạnh vợ/chồng, không đứng riêng): X không có cha mẹ trong cây và có vợ/chồng S mà
  //   - S có cha mẹ trong cây, hoặc
  //   - S cũng không có cha mẹ → chọn 1 người làm gốc (ưu tiên nam; cùng giới thì mã nhỏ hơn)
  const hasParent = (x) => has(x.fatherId) || has(x.motherId);
  const spouseIn = new Set();
  for (const p of persons) {
    if (hasParent(p)) continue;
    for (const sid of (p.spouseIds || []).filter(has)) {
      const s = byId.get(sid);
      if (hasParent(s) || (s.gender !== 'f' && p.gender === 'f') || (s.gender === p.gender && String(s.id) < String(p.id))) { spouseIn.add(p.id); break; }
    }
  }
  // phải còn ít nhất 1 vợ/chồng đứng riêng để đứng cạnh
  for (const id of [...spouseIn]) if (!(byId.get(id).spouseIds || []).some((s) => has(s) && !spouseIn.has(s))) spouseIn.delete(id);

  // con gắn vào người cha/mẹ "máu mủ" (đứng riêng trên cây): ưu tiên cha, nếu cha là con rể thì gắn vào mẹ
  const kidsOf = new Map(), allKids = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const p of persons) {
    const f = has(p.fatherId) ? p.fatherId : null, mo = has(p.motherId) ? p.motherId : null;
    let parent = f && !spouseIn.has(f) ? f : mo && !spouseIn.has(mo) ? mo : f || mo;
    // con riêng của dâu / rể → vẽ dưới đôi vợ chồng
    if (parent && spouseIn.has(parent)) parent = (byId.get(parent).spouseIds || []).find((s) => has(s) && !spouseIn.has(s)) || parent;
    if (parent) push(kidsOf, parent, p);
    if (f) push(allKids, f, p);
    if (mo) push(allKids, mo, p);
  }
  const birthYear = (p) => Number(String(p.birthSolar || p.birthLunar || '').slice(-4)) || 9999;
  for (const list of kidsOf.values()) list.sort((a, b) => (a.order || 99) - (b.order || 99) || birthYear(a) - birthYear(b) || String(a.name).localeCompare(String(b.name)));
  const roots = persons.filter((p) => !has(p.fatherId) && !has(p.motherId) && !spouseIn.has(p.id));
  // đời: gốc = 1, con = cha mẹ + 1 (BFS)
  const gen = new Map();
  const queue = roots.map((r) => [r, 1]);
  while (queue.length) {
    const [p, g] = queue.shift();
    if (gen.has(p.id)) continue;
    gen.set(p.id, g);
    for (const s of p.spouseIds || []) if (spouseIn.has(s) && !gen.has(s)) gen.set(s, g);
    for (const k of kidsOf.get(p.id) || []) queue.push([k, g + 1]);
  }
  // đồng bộ đời các nhánh gốc khác nhau theo mốc (nếu mốc nằm trong nhánh đó)
  const base = anchorId && gen.has(anchorId) ? gen.get(anchorId) - 1 : 0;
  const label = (id) => {
    if (!gen.has(id)) return '';
    const g = gen.get(id) - base;
    return g >= 1 ? `Đời ${g}` : g === 0 ? 'Thượng tổ' : `Thượng tổ ${1 - g}`;
  };
  const shown = (id) => (gen.has(id) ? gen.get(id) - base : null);
  const isDeadP = (p) => p.alive === false || !!(p.deathSolar || p.deathLunar);
  /** Vô hậu (đứt mạch): nam, đã mất, người trong dòng, không có con trai nào (con trai nuôi vẫn tính là có người nối dõi) */
  const noHeir = (id) => { const p = byId.get(id); return !!p && p.gender !== 'f' && isDeadP(p) && !spouseIn.has(id) && !(allKids.get(id) || []).some((k) => k.gender !== 'f'); };
  const branch = new Map(), branchHeads = [];
  for (const r of roots) {
    let split = r;
    while ((kidsOf.get(split.id) || []).length === 1) split = kidsOf.get(split.id)[0];
    for (const h of kidsOf.get(split.id) || []) {
      const idx = branchHeads.length; branchHeads.push({ id: h.id, idx });
      const walk = (x) => { branch.set(x.id, idx); (kidsOf.get(x.id) || []).forEach(walk); };
      walk(h);
    }
  }
  return { byId, kids: (id) => kidsOf.get(id) || [], allKids: (id) => allKids.get(id) || [], spouseIn, roots, gen, label, shown, has, noHeir, branch, branchHeads };
}

/** Kiểm tra gán cha/mẹ có tạo vòng lặp không: newParent không được là con cháu của personId */
export function wouldCycle(A, personId, newParentId) {
  if (!newParentId) return false;
  if (newParentId === personId) return true;
  const stack = [personId], seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const k of A.allKids(id)) { if (k.id === newParentId) return true; stack.push(k.id); }
  }
  return false;
}

/** Xếp vị trí: trả về {nodes:[{p, x, y, kind}], links:[path], w, h} */
export function layout(A, collapsed) {
  const units = new Map();   // id người máu mủ -> {spouses, w}
  const sp = (p) => (p.spouseIds || []).filter((s) => A.spouseIn.has(s) && A.has(s)).map((s) => A.byId.get(s));
  const unitW = (p) => { const n = 1 + sp(p).length; return n * NW + (n - 1) * GAP_SP; };
  const visKids = (p) => (collapsed.has(p.id) ? [] : A.kids(p.id));
  const widthOf = new Map();
  const measure = (p) => {
    const ks = visKids(p);
    const kw = ks.reduce((s, k) => s + measure(k), 0) + Math.max(0, ks.length - 1) * GAP_SIB;
    const w = Math.max(unitW(p), kw);
    widthOf.set(p.id, w);
    return w;
  };
  const minGen = Math.min(...A.roots.map((r) => A.gen.get(r.id) || 1));
  const nodes = [], links = [];
  const place = (p, x0) => {
    const w = widthOf.get(p.id), uw = unitW(p), ux = x0 + (w - uw) / 2;
    const y = ((A.gen.get(p.id) || 1) - minGen) * VGAP + 20;
    const sps = sp(p);
    nodes.push({ p, x: ux, y, kind: 'blood', kids: A.kids(p.id).length, collapsed: collapsed.has(p.id) });
    sps.forEach((s, i) => nodes.push({ p: s, x: ux + (i + 1) * (NW + GAP_SP), y, kind: 'spouse', idx: i, count: sps.length }));
    units.set(p.id, { x: ux, w: uw, y });
    // con xếp theo nhóm mẹ (với nam) / cha (với nữ): nhóm chưa rõ trước, rồi vợ cả, vợ hai…
    const otherKey = p.gender === 'f' ? 'fatherId' : 'motherId';
    const gi = (k) => sps.findIndex((s) => s.id === k[otherKey]);
    const ks = visKids(p).map((k, i) => [k, gi(k), i]).sort((m, n) => m[1] - n[1] || m[2] - n[2]).map((x) => x[0]);
    if (!ks.length) return;
    const kw = ks.reduce((s, k) => s + widthOf.get(k.id), 0) + (ks.length - 1) * GAP_SIB;
    let cx = x0 + (w - kw) / 2;
    const groups = new Map();   // nhóm → [[x con, y con]]
    for (const k of ks) {
      place(k, cx); const u = units.get(k.id), g = gi(k);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push([u.x + NW / 2, u.y]);
      cx += widthOf.get(k.id) + GAP_SIB;
    }
    // đường nối từng nhóm: chưa rõ mẹ → từ người này; vợ cả (1 vợ) → giữa đôi vợ chồng; nhiều vợ → từ chính bà mẹ
    const multi = sps.length > 1, fromY = y + NH;
    let gn = 0;
    for (const [g, tops] of groups) {
      const fromX = g < 0 ? ux + NW / 2 : !multi ? ux + NW + GAP_SP / 2 : ux + (g + 1) * (NW + GAP_SP) + NW / 2;
      const midY = y + NH + (VGAP - NH) / 2 + (groups.size > 1 ? (gn - (groups.size - 1) / 2) * 7 : 0);
      const c = multi && g >= 0 ? `lw${g % 4}` : '';
      const add = (d) => links.push(c ? { d, c } : d);
      add(`M${fromX} ${fromY}V${midY}`);
      const lo = Math.min(fromX, tops[0][0]), hi = Math.max(fromX, tops.at(-1)[0]);
      if (hi - lo > 1) add(`M${lo} ${midY}H${hi}`);
      for (const [tx, ty] of tops) add(`M${tx} ${midY}V${ty}`);
      gn++;
    }
  };
  let x = 20;
  for (const r of A.roots) { measure(r); place(r, x); x += widthOf.get(r.id) + GAP_SIB * 2; }
  const w = Math.max(x, 200), h = Math.max(...nodes.map((n) => n.y), 0) + NH + 60;
  return { nodes, links, w, h };
}

const isDeadP = (p) => p.alive === false || !!(p.deathSolar || p.deathLunar);
const dmy = (s) => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{3,4})$/); return m ? [+m[1], +m[2], +m[3]] : null; };
const yr = (s) => +((String(s || '').match(/(\d{3,4})$/) || [])[1]) || 0;
/** Tuổi: còn sống = tới hôm nay; đã mất = tuổi lúc mất (thọ). Đủ ngày/tháng/năm thì chính xác tới ngày, chỉ có năm thì theo năm */
export function ageOf(p, today = new Date()) {
  const bY = yr(p.birthSolar) || yr(p.birthLunar), bF = dmy(p.birthSolar);
  if (!bY) return null;
  let eF, eY;
  if (isDeadP(p)) { eF = dmy(p.deathSolar); eY = yr(p.deathSolar) || yr(p.deathLunar); if (!eY) return null; }
  else { eF = [today.getDate(), today.getMonth() + 1, today.getFullYear()]; eY = eF[2]; }
  let a = eY - bY;
  if (bF && eF && (eF[1] < bF[1] || (eF[1] === bF[1] && eF[0] < bF[0]))) a--;
  return a >= 0 && a < 130 ? a : null;
}
const years = (p) => {
  const b = yr(p.birthSolar) || yr(p.birthLunar), d = yr(p.deathSolar) || yr(p.deathLunar), a = ageOf(p);
  if (isDeadP(p)) return `${b || '?'} – ${d || '?'}${a !== null ? ` · thọ ${a}` : ''}`;
  return b ? `${b}${a !== null ? ` · ${a} tuổi` : ''}` : '';
};
// Đo độ rộng chữ thật (chữ Việt có dấu rộng hẹp khác nhau) để tên không tràn khỏi ô
const CTX = document.createElement('canvas').getContext('2d');
const FONT = '"Be Vietnam Pro", -apple-system, "Segoe UI", Roboto, sans-serif';
const textW = (t, px, w) => { CTX.font = `${w} ${px}px ${FONT}`; return CTX.measureText(t).width; };
/** Vừa ô: giữ cỡ; hơi dài: thu nhỏ dần tới minPx; vẫn dài: cắt + "…". Trả về [chữ, cỡ] */
function fit(t, maxW, px, minPx, w = 700) {
  for (let f = px; f >= minPx; f -= 0.5) if (textW(t, f, w) <= maxW) return [t, f];
  let lo = 0, hi = t.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (textW(t.slice(0, mid).trimEnd() + '…', minPx, w) <= maxW) lo = mid; else hi = mid - 1; }
  return [t.slice(0, lo).trimEnd() + '…', minPx];
}

/** Vẽ cây vào svg; trả về hàm render lại */
/** Màu nam theo nhánh (nữ giữ màu hồng). Tránh xanh dương mặc định và hồng */
export const BRANCH_COLORS = ['#059669', '#d97706', '#7c3aed', '#0891b2', '#b45309', '#65a30d', '#c026d3', '#0d9488', '#ea580c', '#4f46e5', '#a16207', '#be123c'];
export const branchColor = (i) => BRANCH_COLORS[i % BRANCH_COLORS.length];
export function renderTree(svg, L, A, selectedId, linked = new Set(), colorBranches = true) {
  const node = (n) => {
    const p = n.p, dead = p.alive === false || p.deathSolar || p.deathLunar || p.deathLunarDay;
    const nh = n.kind === 'blood' && A.noHeir(p.id), icons = (linked.has(p.id) ? 1 : 0) + (nh ? 1 : 0);
    const bi = colorBranches && p.gender !== 'f' && n.kind === 'blood' ? A.branch.get(p.id) : undefined;
    const cls = `tn ${p.gender === 'f' ? 'f' : 'm'} ${dead ? 'dead' : ''} ${nh ? 'noheir' : ''} ${bi !== undefined ? 'br' : ''} ${n.kind} ${p.id === selectedId ? 'sel' : ''}`;
    const name = p.name || 'Chưa rõ tên';
    const x = p.photo ? 48 : 12, room = NW - x - 8;
    const [nm, nf] = fit(name, room - icons * 14, 13.5, 11.5);
    const spLabel = n.kind !== 'spouse' ? '' : p.gender === 'f' ? (n.count > 1 ? ' · vợ ' + (['cả', 'hai', 'ba', 'tư', 'năm', 'sáu'][n.idx] || n.idx + 1) : ' · vợ') : (n.count > 1 ? ' · chồng ' + (n.idx + 1) : ' · chồng');
    const [gen] = fit(A.label(p.id) + spLabel, room, 10.5, 10.5, 600);
    return `<g class="${cls}" data-id="${esc(p.id)}" transform="translate(${n.x},${n.y})"${bi !== undefined ? ` style="--bc:${branchColor(bi)}"` : ''}>
      <title>${esc(name)}</title>
      <rect width="${NW}" height="${NH}" rx="10"/>${dead ? '<g class="lotus"><title>Đã mất</title><circle cx="3" cy="3" r="10"/><text x="3" y="7" text-anchor="middle">&#xf5bb;</text></g>' : ''}
      ${p.photo ? `<clipPath id="c${esc(p.id)}"><circle cx="24" cy="${NH / 2}" r="16"/></clipPath><image href="${esc(p.photo)}" x="8" y="${NH / 2 - 16}" width="32" height="32" clip-path="url(#c${esc(p.id)})"/>` : ''}
      <text x="${x}" y="24" class="nm" style="font-size:${nf}px">${esc(nm)}</text>
      ${(() => { const [t, fz] = fit(years(p), room, 11.5, 10, 400); return `<text x="${x}" y="42" class="sub" style="font-size:${fz}px">${esc(t)}</text>`; })()}
      <text x="${x}" y="57" class="gen">${esc(gen)}</text>
      ${linked.has(p.id) ? `<text x="${NW - 9}" y="17" text-anchor="end" class="lk">&#xf0c1;</text>` : ""}
      ${nh ? `<g class="nh"><title>Vô hậu – không có con trai nối dõi</title><text x="${NW - 9 - (linked.has(p.id) ? 15 : 0)}" y="17" text-anchor="end">&#xf28d;</text></g>` : ""}
      ${n.kind === 'blood' && n.kids ? `<g class="tog" data-tog="${esc(p.id)}" transform="translate(${NW / 2},${NH + 2})"><circle r="10"/><text y="4" text-anchor="middle">${n.collapsed ? '+' + n.kids : '−'}</text></g>` : ''}
    </g>`;
  };
  svg.setAttribute('viewBox', `0 0 ${L.w} ${L.h}`);
  svg.setAttribute('width', L.w); svg.setAttribute('height', L.h);
  svg.innerHTML = `<g class="links">${L.links.map((l) => (typeof l === 'string' ? `<path d="${l}"/>` : `<path d="${l.d}" class="${l.c}"/>`)).join('')}</g><g>${L.nodes.map(node).join('')}</g>`;
}

/** Kéo / phóng to / 2 ngón tay cho khung chứa cây. onTap(id) khi chạm 1 người, onToggle(id) khi chạm +/− */
export function panZoom(box, svg, { onTap, onToggle }) {
  const S = { x: 0, y: 0, k: 1 };
  const apply = () => { svg.style.transform = `translate(${S.x}px,${S.y}px) scale(${S.k})`; };
  const pts = new Map();
  let start = null, moved = false;
  const clampK = (k) => Math.min(2.5, Math.max(0.15, k));
  const zoomAt = (k, cx, cy) => { const nk = clampK(k); S.x = cx - ((cx - S.x) * nk) / S.k; S.y = cy - ((cy - S.y) * nk) / S.k; S.k = nk; apply(); };
  const ui = (e) => e.target.closest && e.target.closest('.tsearch, .tools, .blegend');   // ô tìm kiếm, nút, thanh nhánh: không kéo cây (để click chuột được)
  box.addEventListener('pointerdown', (e) => {
    if (ui(e)) return;
    try { box.setPointerCapture(e.pointerId); } catch (x) { /* không sao */ } pts.set(e.pointerId, [e.clientX, e.clientY]);
    moved = false;
    if (pts.size === 1) start = { x: S.x, y: S.y, px: e.clientX, py: e.clientY, target: e.target };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; start = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), k: S.k }; }
  });
  box.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1 && start && start.px !== undefined) {
      const dx = e.clientX - start.px, dy = e.clientY - start.py;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) { S.x = start.x + dx; S.y = start.y + dy; apply(); }
    } else if (pts.size === 2 && start && start.pinch) {
      const [a, b] = [...pts.values()], r = box.getBoundingClientRect();
      moved = true;
      zoomAt(start.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / start.pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
    }
  });
  const up = (e) => {
    const wasTap = pts.size === 1 && !moved && start && start.target;
    pts.delete(e.pointerId);
    if (wasTap) {
      const tog = start.target.closest && start.target.closest('[data-tog]');
      const nd = start.target.closest && start.target.closest('[data-id]');
      if (tog) onToggle(tog.dataset.tog); else if (nd) onTap(nd.dataset.id);
    }
    if (!pts.size) start = null;
  };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.addEventListener('wheel', (e) => { if (ui(e)) return; e.preventDefault(); const r = box.getBoundingClientRect(); zoomAt(S.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  return {
    fit() {
      const r = box.getBoundingClientRect(), w = Number(svg.getAttribute('width')), h = Number(svg.getAttribute('height'));
      S.k = clampK(Math.min(r.width / w, r.height / h, 1)); S.x = (r.width - w * S.k) / 2; S.y = 10; apply();
    },
    zoom(f) { const r = box.getBoundingClientRect(); zoomAt(S.k * f, r.width / 2, r.height / 2); },
    center(x, y, k, ty = 1 / 3) {
      const r = box.getBoundingClientRect();
      S.k = clampK(k || Math.max(S.k, 0.8)); S.x = r.width / 2 - (x + NW / 2) * S.k; S.y = r.height * ty - (y + NH / 2) * S.k;
      svg.style.transition = 'transform .45s cubic-bezier(.2,.8,.2,1)'; apply();
      clearTimeout(svg._tt); svg._tt = setTimeout(() => (svg.style.transition = ''), 480);
    },
    state: S,
  };
}
