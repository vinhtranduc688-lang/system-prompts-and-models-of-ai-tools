/* Marathon Coach – lõi tính toán (VDOT, pace, vùng nhịp tim, tải tập, độ sẵn sàng, dinh dưỡng)
 * Hàm thuần, không phụ thuộc DOM -> dùng được cả trong trình duyệt và Node (để test). */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  // ---------- Tiện ích thời gian / ngày ----------
  function parseTime(str) {
    if (typeof str === 'number') return str;
    if (str == null || str === '') return NaN;
    const parts = String(str).trim().split(':').map(Number);
    if (parts.some((p) => isNaN(p))) return NaN;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  function fmtTime(sec) {
    if (!isFinite(sec)) return '–';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function fmtPace(secPerKm) {
    if (!isFinite(secPerKm) || secPerKm <= 0) return '–';
    const s = Math.round(secPerKm);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  // Ngày dạng 'YYYY-MM-DD' theo giờ địa phương
  function ymd(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  function parseYmd(s) {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(s, n) {
    const d = parseYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }
  function diffDays(a, b) { // b - a (ngày)
    return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
  }
  function mondayOf(s) {
    const d = parseYmd(s);
    const dow = (d.getDay() + 6) % 7; // Mon=0
    d.setDate(d.getDate() - dow);
    return ymd(d);
  }
  function dow(s) { return (parseYmd(s).getDay() + 6) % 7; }

  // ---------- VDOT (công thức Daniels & Gilbert) ----------
  function vo2FromVelocity(v) { // v: m/phút
    return -4.6 + 0.182258 * v + 0.000104 * v * v;
  }
  function pctMax(tMin) {
    return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
  }
  function vdotFromRace(distKm, timeSec) {
    if (!(distKm > 0) || !(timeSec > 0)) return NaN;
    const t = timeSec / 60;
    const v = (distKm * 1000) / t;
    return vo2FromVelocity(v) / pctMax(t);
  }
  function velocityFromVo2(vo2) {
    const a = 0.000104, b = 0.182258, c = -(vo2 + 4.6);
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  }
  function predictTime(vdot, distKm) {
    if (!(vdot > 0)) return NaN;
    let lo = distKm * 60 * 1.5, hi = distKm * 60 * 15; // giây
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (vdotFromRace(distKm, mid) > vdot) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  // Pace (giây/km) tại một % VO2max
  function paceAtPct(vdot, pct) {
    return (1000 / velocityFromVo2(vdot * pct)) * 60;
  }
  function trainingPaces(vdot) {
    return {
      easy: [paceAtPct(vdot, 0.7), paceAtPct(vdot, 0.62)], // [nhanh, chậm]
      long: [paceAtPct(vdot, 0.68), paceAtPct(vdot, 0.6)],
      marathon: predictTime(vdot, 42.195) / 42.195,
      threshold: paceAtPct(vdot, 0.88),
      interval: paceAtPct(vdot, 0.975),
      rep: paceAtPct(vdot, 1.05),
      recovery: paceAtPct(vdot, 0.58),
    };
  }

  // ---------- Nhịp tim ----------
  function hrZones(restHR, maxHR) {
    const hrr = maxHR - restHR;
    const z = (p) => Math.round(restHR + hrr * p);
    return [
      { name: 'Z1 Hồi phục', lo: z(0.5), hi: z(0.6) },
      { name: 'Z2 Aerobic nền', lo: z(0.6), hi: z(0.7) },
      { name: 'Z3 Tempo / Marathon', lo: z(0.7), hi: z(0.8) },
      { name: 'Z4 Ngưỡng', lo: z(0.8), hi: z(0.9) },
      { name: 'Z5 VO2max', lo: z(0.9), hi: maxHR },
    ];
  }

  // TRIMP Banister – tải tập của một buổi
  function trimp(act, profile) {
    const min = (act.durationSec || 0) / 60;
    if (!min) return 0;
    if (act.trainingLoad > 0 && !act.avgHR) return act.trainingLoad; // Garmin "Training Load" thô
    const rest = profile.restHR || 55, max = profile.maxHR || 190;
    if (act.avgHR > rest && max > rest) {
      const x = Math.min(1, Math.max(0, (act.avgHR - rest) / (max - rest)));
      const k = profile.sex === 'female' ? 0.86 * Math.exp(1.67 * x) : 0.64 * Math.exp(1.92 * x);
      return min * x * k;
    }
    // Không có nhịp tim: ước lượng ~ Z2
    return min * 0.65 * (profile.sex === 'female' ? 0.86 * Math.exp(1.67 * 0.65) : 0.64 * Math.exp(1.92 * 0.65));
  }

  // CTL (thể lực, 42 ngày) / ATL (mệt mỏi, 7 ngày) / TSB (phong độ)
  function loadSeries(activities, profile, endDate, days) {
    const daily = {};
    activities.forEach((a) => {
      const d = String(a.date).slice(0, 10);
      daily[d] = (daily[d] || 0) + trimp(a, profile);
    });
    const dates = Object.keys(daily).sort();
    const start = dates.length ? (dates[0] < addDays(endDate, -days) ? dates[0] : addDays(endDate, -days)) : addDays(endDate, -days);
    const out = [];
    let ctl = 0, atl = 0;
    for (let d = start; d <= endDate; d = addDays(d, 1)) {
      const l = daily[d] || 0;
      ctl += (l - ctl) / 42;
      atl += (l - atl) / 7;
      out.push({ date: d, load: l, ctl, atl, tsb: ctl - atl });
    }
    return out.slice(-days);
  }

  // ---------- Thống kê khối lượng ----------
  function isRun(a) {
    const t = String(a.type || 'running').toLowerCase();
    return /run|chạy|treadmill|trail|track/.test(t);
  }
  function weeklyKm(activities, endDate, weeks) {
    const res = [];
    const lastMon = mondayOf(endDate);
    for (let i = weeks - 1; i >= 0; i--) {
      const ws = addDays(lastMon, -7 * i), we = addDays(ws, 6);
      const km = activities
        .filter((a) => isRun(a) && a.date.slice(0, 10) >= ws && a.date.slice(0, 10) <= we)
        .reduce((s, a) => s + (a.distanceKm || 0), 0);
      res.push({ week: ws, km });
    }
    return res;
  }
  function recentStats(activities, today) {
    const from = addDays(today, -28);
    const runs = activities.filter((a) => isRun(a) && a.date.slice(0, 10) > from && a.date.slice(0, 10) <= today);
    const total = runs.reduce((s, a) => s + (a.distanceKm || 0), 0);
    const longest = runs.reduce((m, a) => Math.max(m, a.distanceKm || 0), 0);
    return { avgWeeklyKm: total / 4, longestKm: longest, runs: runs.length };
  }

  // ---------- Độ sẵn sàng (HRV / RHR / giấc ngủ / TSB) ----------
  function readiness(wellness, today, tsb) {
    const sorted = wellness.filter((w) => w.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
    const latest = sorted[sorted.length - 1];
    const reasons = [];
    let score = 100;
    if (!latest || diffDays(latest.date, today) > 1) {
      return { score: null, level: 'unknown', reasons: ['Chưa có dữ liệu sức khoẻ hôm nay/hôm qua – đồng bộ Garmin hoặc nhập tay.'] };
    }
    const base = sorted.slice(-8, -1);
    const avg = (k) => {
      const v = base.map((w) => w[k]).filter((x) => x > 0);
      return v.length >= 3 ? v.reduce((s, x) => s + x, 0) / v.length : null;
    };
    const hrvB = avg('hrv'), rhrB = avg('restHR');
    if (latest.hrv > 0 && hrvB) {
      const d = (latest.hrv - hrvB) / hrvB;
      if (d < -0.12) { score -= 25; reasons.push(`HRV thấp hơn nền ${Math.round(-d * 100)}% (${latest.hrv} vs ${Math.round(hrvB)} ms)`); }
      else if (d < -0.06) { score -= 10; reasons.push(`HRV hơi thấp (${latest.hrv} vs ${Math.round(hrvB)} ms)`); }
      else reasons.push(`HRV ổn định (${latest.hrv} ms)`);
    }
    if (latest.restHR > 0 && rhrB) {
      const d = latest.restHR - rhrB;
      if (d >= 5) { score -= 25; reasons.push(`Nhịp tim nghỉ cao hơn nền ${Math.round(d)} bpm`); }
      else if (d >= 3) { score -= 10; reasons.push(`Nhịp tim nghỉ nhích ${Math.round(d)} bpm`); }
      else reasons.push(`Nhịp tim nghỉ bình thường (${latest.restHR} bpm)`);
    }
    if (latest.sleepHours > 0) {
      if (latest.sleepHours < 6) { score -= 20; reasons.push(`Ngủ ít (${latest.sleepHours.toFixed(1)} giờ)`); }
      else if (latest.sleepHours < 7) { score -= 10; reasons.push(`Giấc ngủ hơi ngắn (${latest.sleepHours.toFixed(1)} giờ)`); }
      else reasons.push(`Ngủ đủ (${latest.sleepHours.toFixed(1)} giờ)`);
    }
    if (latest.bodyBattery > 0 && latest.bodyBattery < 30) { score -= 10; reasons.push(`Body Battery thấp (${latest.bodyBattery})`); }
    if (latest.stress > 50) { score -= 5; reasons.push(`Stress cao (${latest.stress})`); }
    if (tsb != null && tsb < -25) { score -= 15; reasons.push(`Mệt tích luỹ cao (TSB ${tsb.toFixed(0)})`); }
    if (latest.trainingReadiness > 0) {
      score = Math.round((score + latest.trainingReadiness) / 2);
      reasons.push(`Garmin Training Readiness: ${latest.trainingReadiness}`);
    }
    score = Math.max(0, Math.min(100, score));
    return { score, level: score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red', reasons, latest };
  }

  // ---------- Dinh dưỡng ----------
  // Tham khảo: ACSM/IOC/ISSN – carb theo tải 3–12 g/kg, protein 1.6–1.8 g/kg, carb-loading 8–10 g/kg, 60–90 g carb/giờ khi đua.
  const DAY_KIND = {
    rest: { carb: 4, label: 'Ngày nghỉ', note: 'Ưu tiên rau, đạm nạc, chất béo tốt; carb vừa phải.' },
    easy: { carb: 5.5, label: 'Ngày chạy nhẹ', note: 'Carb vừa đủ, bổ sung đạm sau buổi chạy trong 60 phút.' },
    quality: { carb: 6.5, label: 'Ngày bài chất lượng', note: 'Ăn carb 2–3 giờ trước buổi tập; sau tập 1–1.2 g/kg carb + 20–30 g đạm.' },
    long: { carb: 7.5, label: 'Ngày chạy dài', note: 'Tập ăn uống như ngày đua: gel/nước điện giải mỗi 30–40 phút.' },
    carbload: { carb: 9, label: 'Nạp carb (carb-loading)', note: 'Giảm chất xơ & chất béo, chia 5–6 bữa; cơm trắng, xôi, bánh mì, chuối, nước ép.' },
    race: { carb: 8, label: 'Ngày đua', note: 'Bữa sáng 1–4 g/kg carb trước xuất phát 3–4 giờ; trong đua 60–90 g carb/giờ.' },
  };
  function bmr(p) {
    const base = 10 * p.weight + 6.25 * p.height - 5 * p.age;
    return p.sex === 'female' ? base - 161 : base + 5;
  }
  function nutritionForDay(profile, day) {
    const kind = DAY_KIND[day.kind] ? day.kind : 'rest';
    const w = profile.weight || 65;
    const km = day.distanceKm || 0;
    const runKcal = km * w * 1.0; // ~1 kcal/kg/km
    const strengthKcal = day.strength ? 200 : 0;
    const tdee = bmr(profile) * 1.35 + runKcal + strengthKcal;
    const carbs = DAY_KIND[kind].carb * w;
    const protein = (kind === 'carbload' ? 1.5 : 1.7) * w;
    let fat = (tdee - carbs * 4 - protein * 4) / 9;
    const minFat = (kind === 'carbload' ? 0.6 : 0.8) * w;
    fat = Math.max(fat, minFat);
    const kcal = Math.round(carbs * 4 + protein * 4 + fat * 9);
    const durationH = (day.estDurationSec || 0) / 3600;
    const water = Math.round((w * 35 + durationH * 600) / 100) / 10; // lít
    let fueling = null;
    if (kind === 'race') fueling = `Trong đua: 60–90 g carb/giờ (≈ 1 gel mỗi 25–30 phút) + 400–800 ml nước/giờ có điện giải (Na 300–600 mg/giờ).`;
    else if (durationH >= 1.25) fueling = `Buổi dài ${fmtTime(durationH * 3600)}: mang ${Math.ceil((durationH - 0.75) * 2)} gel (≈${Math.round(Math.max(30, Math.min(75, 45 + (durationH - 1.5) * 15)))} g carb/giờ) + nước điện giải. Luyện "dạ dày" cho ngày đua.`;
    return { kind, label: DAY_KIND[kind].label, note: DAY_KIND[kind].note, kcal, carbs: Math.round(carbs), protein: Math.round(protein), fat: Math.round(fat), water, fueling };
  }
  function mealIdeas(kind) {
    const m = {
      rest: ['Sáng: phở gà / trứng + bánh mì nguyên cám', 'Trưa: cơm gạo lứt, cá hấp, rau luộc', 'Tối: ức gà / đậu phụ, salad, khoai lang nhỏ', 'Phụ: sữa chua Hy Lạp + hạt'],
      easy: ['Sáng: yến mạch + chuối + sữa', 'Trưa: cơm, thịt bò xào rau', 'Sau tập: sữa socola / sữa chua + chuối', 'Tối: bún cá, rau sống'],
      quality: ['Trước tập 2–3h: bánh mì + mật ong + chuối', 'Sau tập: cơm + trứng + thịt nạc (trong 60 phút)', 'Tối: mì/bún + cá hồi/thịt gà, rau xanh', 'Phụ: khoai lang, sữa'],
      long: ['Tối hôm trước: cơm/mì nhiều carb, ít dầu mỡ', 'Sáng: bánh mì mật ong / xôi ít mỡ + chuối (2–3h trước)', 'Trong buổi: gel/ chuối/ nước điện giải', 'Sau: phở/bún bò + nước dừa, sữa chua'],
      carbload: ['Sáng: xôi trắng/bánh mì + mứt + nước cam', 'Trưa: cơm trắng nhiều, thịt gà nạc, ít rau xơ', 'Chiều: bánh chuối, bánh gạo, nước ép', 'Tối: mì Ý sốt cà chua / cơm, tránh đồ cay, chiên, sữa lạ'],
      race: ['3–4h trước: bánh mì trắng + mật ong + chuối, 500 ml nước', '15 phút trước: 1 gel + vài ngụm nước', 'Trong đua: gel mỗi 25–30 phút, nước ở mỗi trạm', 'Sau đua: sữa socola, cơm/phở, bù nước điện giải'],
    };
    return m[kind] || m.rest;
  }

  Object.assign(MC, {
    parseTime, fmtTime, fmtPace, ymd, parseYmd, addDays, diffDays, mondayOf, dow,
    vdotFromRace, predictTime, trainingPaces, paceAtPct, hrZones, trimp, loadSeries,
    isRun, weeklyKm, recentStats, readiness, nutritionForDay, mealIdeas, bmr, DAY_KIND,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = MC;
})(typeof window !== 'undefined' ? window : globalThis);
