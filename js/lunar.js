/**
 * Âm lịch Việt Nam (múi giờ +7) – theo thuật toán thiên văn của Hồ Ngọc Đức.
 * Dùng cho: ngày sinh/mất âm lịch, ngày giỗ năm nay, can chi.
 */
const TZ = 7;
const { floor, sin, PI } = Math;

export function jdFromDate(dd, mm, yy) {
  const a = floor((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
  let jd = dd + floor((153 * m + 2) / 5) + 365 * y + floor(y / 4) - floor(y / 100) + floor(y / 400) - 32045;
  if (jd < 2299161) jd = dd + floor((153 * m + 2) / 5) + 365 * y + floor(y / 4) - 32083;
  return jd;
}

export function jdToDate(jd) {
  let b, c;
  if (jd > 2299160) { const a = jd + 32044; b = floor((4 * a + 3) / 146097); c = a - floor((b * 146097) / 4); }
  else { b = 0; c = jd + 32082; }
  const d = floor((4 * c + 3) / 1461), e = c - floor((1461 * d) / 4), m = floor((5 * e + 2) / 153);
  return [e - floor((153 * m + 2) / 5) + 1, m + 3 - 12 * floor(m / 10), b * 100 + d - 4800 + floor(m / 10)];
}

function newMoon(k) {
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
  let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  jd1 += 0.00033 * sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  // Viết tường minh từng số hạng (gộp kiểu "C1 -= a + b" sẽ đảo dấu b → lệch tháng nhuận)
  let C1 = (0.1734 - 0.000393 * T) * sin(M * dr) + 0.0021 * sin(2 * dr * M);
  C1 = C1 - 0.4068 * sin(Mpr * dr) + 0.0161 * sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * sin(dr * 2 * F) - 0.0051 * sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * sin(dr * (M - Mpr)) + 0.0004 * sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * sin(dr * (2 * F - M)) - 0.0006 * sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.0010 * sin(dr * (2 * F - Mpr)) + 0.0005 * sin(dr * (2 * Mpr + M));
  const deltat = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
    : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return jd1 + C1 - deltat;
}

function sunLongitude(jdn) {
  const T = (jdn - 2451545.0) / 36525, T2 = T * T, dr = PI / 180;
  const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * sin(dr * M);
  DL += (0.019993 - 0.000101 * T) * sin(dr * 2 * M) + 0.000290 * sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  return L - PI * 2 * floor(L / (PI * 2));
}

const sunLong = (dayNumber) => floor(sunLongitude(dayNumber - 0.5 - TZ / 24) / PI * 6);
const newMoonDay = (k) => floor(newMoon(k) + 0.5 + TZ / 24);

function lunarMonth11(yy) {
  const off = jdFromDate(31, 12, yy) - 2415021, k = floor(off / 29.530588853);
  let nm = newMoonDay(k);
  if (sunLong(nm) >= 9) nm = newMoonDay(k - 1);
  return nm;
}

function leapMonthOffset(a11) {
  const k = floor((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last, i = 1, arc = sunLong(newMoonDay(k + i));
  do { last = arc; i++; arc = sunLong(newMoonDay(k + i)); } while (arc !== last && i < 14);
  return i - 1;
}

/** Dương → âm: [ngày, tháng, năm, nhuận(0/1)] */
export function solarToLunar(dd, mm, yy) {
  const dayNumber = jdFromDate(dd, mm, yy), k = floor((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = newMoonDay(k + 1);
  if (monthStart > dayNumber) monthStart = newMoonDay(k);
  let a11 = lunarMonth11(yy), b11 = a11, lunarYear;
  if (a11 >= monthStart) { lunarYear = yy; a11 = lunarMonth11(yy - 1); }
  else { lunarYear = yy + 1; b11 = lunarMonth11(yy + 1); }
  const lunarDay = dayNumber - monthStart + 1, diff = floor((monthStart - a11) / 29);
  let leap = 0, lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const lmd = leapMonthOffset(a11);
    if (diff >= lmd) { lunarMonth = diff + 10; if (diff === lmd) leap = 1; }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return [lunarDay, lunarMonth, lunarYear, leap];
}

/** Âm → dương: [ngày, tháng, năm]; [0,0,0] nếu tháng nhuận không tồn tại năm đó */
export function lunarToSolar(lunarDay, lunarMonth, lunarYear, leap = 0) {
  let a11, b11;
  if (lunarMonth < 11) { a11 = lunarMonth11(lunarYear - 1); b11 = lunarMonth11(lunarYear); }
  else { a11 = lunarMonth11(lunarYear); b11 = lunarMonth11(lunarYear + 1); }
  const k = floor(0.5 + (a11 - 2415021.076998695) / 29.530588853);
  let off = lunarMonth - 11;
  if (off < 0) off += 12;
  if (b11 - a11 > 365) {
    const leapOff = leapMonthOffset(a11);
    let leapMonth = leapOff - 2;
    if (leapMonth < 0) leapMonth += 12;
    if (leap && lunarMonth !== leapMonth) return [0, 0, 0];
    if (leap || off >= leapOff) off += 1;
  }
  return jdToDate(newMoonDay(k + off) + lunarDay - 1);
}

/** Số ngày của tháng âm (29 hoặc 30) */
export function lunarMonthLength(lunarMonth, lunarYear, leap = 0) {
  const [d, m, y] = lunarToSolar(1, lunarMonth, lunarYear, leap);
  if (!d) return 0;
  const start = jdFromDate(d, m, y);
  // ngày 30 có tồn tại không: đổi ngược ngày start+29 sang âm, nếu vẫn cùng tháng thì tháng đủ
  const [dd, mm, yy] = jdToDate(start + 29);
  const [ld] = solarToLunar(dd, mm, yy);
  return ld === 30 ? 30 : 29;
}

const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
/** Năm can chi: 2024 -> "Giáp Thìn" */
export const yearCanChi = (y) => CAN.at((y + 6) % 10) + ' ' + CHI.at((y + 8) % 12);

/**
 * Ngày giỗ lần tới (từ hôm nay trở đi) của người mất ngày âm d/m.
 * Quy ước: mất vào tháng nhuận → giỗ theo tháng thường; mất ngày 30 mà tháng năm nay thiếu → giỗ ngày 29.
 * Trả về { solar: [d,m,y], lunarYear, daysLeft }
 */
export function nextDeathAnniversary(d, m, today = new Date()) {
  const t = [today.getDate(), today.getMonth() + 1, today.getFullYear()];
  const jdToday = jdFromDate(...t);
  const [, , ly] = solarToLunar(...t);
  for (const y of [ly, ly + 1]) {
    const day = d === 30 && lunarMonthLength(m, y) < 30 ? 29 : d;
    const s = lunarToSolar(day, m, y);
    const jd = jdFromDate(...s);
    if (jd >= jdToday) return { solar: s, lunarYear: y, daysLeft: jd - jdToday, lunarDay: day };
  }
  return null;
}

/** "15/7/2024" (dương) -> "11/6 năm Giáp Thìn" */
export function formatLunar([ld, lm, ly, leap]) {
  return `${ld}/${lm}${leap ? ' (nhuận)' : ''} năm ${yearCanChi(ly)}`;
}
