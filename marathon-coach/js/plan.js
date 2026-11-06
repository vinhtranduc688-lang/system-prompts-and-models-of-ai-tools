/* Marathon Coach – bộ tạo giáo án theo chu kỳ (Build -> Peak -> Taper -> Race)
 * Nguyên tắc: tăng khối lượng ≤10%/tuần, tuần giảm tải mỗi 4 tuần, chạy dài tối đa ~32 km hoặc 3 giờ,
 * taper 3 tuần (85% -> 65% -> 40%), 80% khối lượng ở cường độ dễ. */
(function (root) {
  'use strict';
  const MC = root.MC;
  const P = (s) => MC.fmtPace(s);
  const rng = (a, b) => `${P(a)}–${P(b)}/km`;
  const DOW_VN = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

  // Bố trí buổi chạy theo số buổi/tuần (0 = Thứ 2 ... 6 = CN)
  const LAYOUT = {
    3: { 1: 'Q1', 3: 'Q2', 6: 'L' },
    4: { 1: 'Q1', 3: 'Q2', 5: 'E', 6: 'L' },
    5: { 1: 'Q1', 2: 'E', 3: 'Q2', 5: 'E', 6: 'L' },
    6: { 1: 'Q1', 2: 'E', 3: 'Q2', 4: 'E', 5: 'E', 6: 'L' },
  };
  const STRENGTH_DAYS = { 3: [0, 4], 4: [0, 4], 5: [0, 4], 6: [0, 2] };

  const STRENGTH = {
    A: { title: 'Sức mạnh A (35–40 phút)', items: ['Goblet squat 3×10', 'Romanian deadlift 3×8', 'Bulgarian split squat 3×8/chân', 'Nhón gót (calf raise) 3×15', 'Plank 3×45s', 'Side plank 2×30s/bên'] },
    B: { title: 'Sức mạnh B (35–40 phút)', items: ['Step-up lên bục 3×10/chân', 'Single-leg RDL 3×8/chân', 'Hip thrust 3×12', 'Calf raise lệch tâm 1 chân 3×12', 'Dead bug 3×10', 'Copenhagen plank 2×20s/bên'] },
    light: { title: 'Sức mạnh nhẹ + linh hoạt (20–25 phút)', items: ['Squat bodyweight 2×12', 'Glute bridge 2×15', 'Calf raise 2×15', 'Plank 2×30s', 'Giãn cơ hông, đùi sau, bắp chân'] },
    mobility: { title: 'Linh hoạt & lăn cơ (15 phút)', items: ['Foam roller bắp chân, đùi', 'Mở hông 90/90', 'Kéo giãn nhẹ – không tập nặng'] },
  };

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function r1(x) { return Math.round(x * 2) / 2; } // làm tròn 0.5 km

  // Bài chất lượng 1: luân phiên ngưỡng (threshold) và VO2max (interval)
  function q1Workout(weekIdx, phase, paces, scale) {
    const T = paces.threshold, I = paces.interval;
    // n lần × d km (hoặc tempo liên tục: min phút)
    const thr = [
      { n: 3, d: 2, rest: 'nghỉ chạy chậm 2 phút' },
      { n: 2, d: 3, rest: 'nghỉ chạy chậm 3 phút' },
      { n: 4, d: 1.6, rest: 'nghỉ chạy chậm 90 giây' },
      { min: 25 },
    ];
    const vo2 = [
      { n: 5, d: 1, rest: 'nghỉ chạy chậm 2–3 phút' },
      { n: 6, d: 0.8, rest: 'nghỉ chạy chậm 2 phút' },
      { n: 4, d: 1.2, rest: 'nghỉ chạy chậm 3 phút' },
    ];
    const useThr = phase === 'taper' || weekIdx % 2 === 0;
    const w = useThr ? thr[weekIdx % thr.length] : vo2[weekIdx % vo2.length];
    const pace = useThr ? T : I;
    const wu = scale < 0.85 ? 2 : 3;
    let reps, workKm;
    if (w.min) {
      const min = Math.max(15, Math.round((w.min * scale) / 5) * 5);
      reps = `${min} phút tempo liên tục`;
      workKm = (min * 60) / T;
    } else {
      const n = Math.max(2, Math.round(w.n * Math.min(scale, 1)));
      const dTxt = w.d < 1.5 && w.d !== 1 ? `${Math.round(w.d * 1000)} m` : `${w.d} km`;
      reps = `${n}×${dTxt}`;
      workKm = n * w.d;
    }
    return {
      type: useThr ? 'threshold' : 'interval',
      title: useThr ? `Ngưỡng: ${reps}` : `Interval VO2max: ${reps}`,
      distanceKm: r1(wu + workKm * 1.3 + 2), // +30% cho đoạn nghỉ chạy chậm
      pace: `${P(pace)}/km`,
      zone: useThr ? 'Z4' : 'Z4–Z5',
      description: `Khởi động ${wu} km chạy dễ + 4 lần tăng tốc 20s. Phần chính ${reps} @ ${P(pace)}/km${w.rest ? ' (' + w.rest + ')' : ''}. Thả lỏng 2 km.`,
      estSec: (wu + 2 + workKm * 0.3) * paces.easy[1] + workKm * pace,
    };
  }

  function buildPlan(profile, ctx) {
    const today = ctx.today;
    const race = profile.raceDate;
    const paces = ctx.paces;
    const mp = ctx.trainingMP;
    const easyMid = (paces.easy[0] + paces.easy[1]) / 2;
    const longMid = (paces.long[0] + paces.long[1]) / 2;
    const runDays = clamp(profile.runDays || 5, 3, 6);
    const layout = LAYOUT[runDays];
    const startMon = MC.mondayOf(today);
    const raceMon = MC.mondayOf(race);
    const N = Math.floor(MC.diffDays(startMon, raceMon) / 7) + 1; // gồm tuần đua
    if (N < 1) return { weeks: [], days: [] };

    const base = Math.max(15, profile.weeklyKm || 30);
    const peakVol = clamp(base * 1.3, base, runDays * 17);
    const startLong = Math.max(10, profile.longestKm || base * 0.35);
    const maxLong = Math.min(32, (3 * 3600) / longMid, Math.max(startLong, peakVol * 0.55));

    const taperN = N >= 6 ? 3 : N >= 3 ? 2 : 1;
    const buildN = N - taperN;
    const taperVol = [0.85, 0.65, 0.4].slice(3 - taperN);
    const taperLong = [0.75, 0.5].slice(Math.max(0, 2 - (taperN - 1)));

    // Lên khung từng tuần
    const weeks = [];
    let nonCut = 0;
    const cutIdx = (i) => buildN >= 4 && (i + 1) % 4 === 0 && i < buildN - 1;
    const nonCutTotal = Array.from({ length: buildN }, (_, i) => i).filter((i) => !cutIdx(i)).length;
    const longStep = nonCutTotal > 1 ? clamp((maxLong - startLong) / (nonCutTotal - 1), 0, 3.5) : 0;
    let lastLong = startLong, lastVol = base;
    for (let i = 0; i < N; i++) {
      const ws = MC.addDays(startMon, 7 * i);
      let phase, vol, longKm, mpKm;
      if (i < buildN) {
        if (cutIdx(i)) {
          phase = 'recovery'; vol = lastVol * 0.8; longKm = lastLong * 0.7; mpKm = 5;
        } else {
          phase = i === buildN - 1 ? 'peak' : 'build';
          const frac = buildN > 1 ? i / (buildN - 1) : 1;
          vol = Math.min(base + (peakVol - base) * frac, lastVol * 1.1);
          longKm = Math.min(maxLong, startLong + longStep * nonCut);
          lastLong = longKm; nonCut++;
          mpKm = clamp(Math.round(vol * 0.12 + i), 5, 14);
        }
        lastVol = phase === 'recovery' ? lastVol : vol;
      } else {
        const t = i - buildN;
        phase = i === N - 1 ? 'race' : 'taper';
        vol = peakVol * taperVol[t];
        longKm = i === N - 1 ? 42.195 : maxLong * (taperLong[t] || 0.5);
        mpKm = t === 0 ? clamp(Math.round(vol * 0.2), 5, 10) : 6;
      }
      weeks.push({ index: i, start: ws, phase, targetKm: Math.round(vol), longKm: r1(longKm), mpKm });
    }

    const PHASE_VN = { build: 'Xây nền', peak: 'Đỉnh', recovery: 'Giảm tải', taper: 'Taper', race: 'Tuần đua' };
    const days = [];
    weeks.forEach((wk) => {
      wk.phaseLabel = PHASE_VN[wk.phase];
      if (wk.phase === 'race') return raceWeek(wk, days);
      const scale = (wk.phase === 'taper' ? 0.7 : wk.phase === 'recovery' ? 0.75 : 1) * clamp(wk.targetKm / 50, 0.7, 1.1);
      const q1 = q1Workout(wk.index, wk.phase, paces, scale);
      // Co bài pace marathon nếu tổng tuần vượt mục tiêu (người chạy volume thấp)
      const eSlots = Object.values(layout).filter((s) => s === 'E').length;
      const over = q1.distanceKm + wk.mpKm + 4 + wk.longKm + eSlots * 4 - wk.targetKm;
      const mpKm = over > 0 ? Math.max(4, Math.round(wk.mpKm - over)) : wk.mpKm;
      const q2 = {
        type: 'mp',
        title: `Pace marathon: ${mpKm} km`,
        distanceKm: r1(mpKm + 4),
        pace: `${P(mp)}/km`,
        zone: 'Z3',
        description: `Khởi động 2 km dễ, ${mpKm} km liên tục @ ${P(mp)}/km (pace mục tiêu), thả lỏng 2 km. Tập uống nước/gel như ngày đua nếu > 60 phút.`,
        estSec: 4 * easyMid + mpKm * mp,
      };
      const longMpKm = wk.phase === 'build' && wk.index % 2 === 1 ? Math.round(wk.longKm * 0.25) : 0;
      const L = {
        type: 'long',
        title: longMpKm ? `Chạy dài ${wk.longKm} km (${longMpKm} km cuối pace marathon)` : `Chạy dài ${wk.longKm} km`,
        distanceKm: wk.longKm,
        pace: rng(paces.long[0], paces.long[1]),
        zone: 'Z2',
        description: longMpKm
          ? `${wk.longKm - longMpKm} km đầu chạy dễ ${rng(paces.long[0], paces.long[1])}, ${longMpKm} km cuối @ ${P(mp)}/km. Uống/ăn gel mỗi 30–40 phút.`
          : `Chạy đều, nói chuyện được, ${rng(paces.long[0], paces.long[1])}. Mang gel + nước, tập nạp 40–60 g carb/giờ.`,
        estSec: (wk.longKm - longMpKm) * longMid + longMpKm * mp,
      };
      const slots = Object.entries(layout);
      const eCount = slots.filter(([, s]) => s === 'E').length;
      const usedKm = q1.distanceKm + q2.distanceKm + L.distanceKm;
      const eKm = eCount ? Math.max(4, r1((wk.targetKm - usedKm) / eCount)) : 0;
      let total = 0;
      for (let d = 0; d < 7; d++) {
        const date = MC.addDays(wk.start, d);
        const slot = layout[d];
        let day;
        if (slot === 'Q1') day = Object.assign({}, q1);
        else if (slot === 'Q2') day = Object.assign({}, q2);
        else if (slot === 'L') day = Object.assign({}, L);
        else if (slot === 'E') {
          const strides = d === 5 ? '' : ' + 6 lần tăng tốc 20 giây (strides)';
          day = { type: 'easy', title: `Chạy nhẹ ${eKm} km`, distanceKm: eKm, pace: rng(paces.easy[0], paces.easy[1]), zone: 'Z2', description: `Chạy dễ, thở bằng mũi được, nhịp tim Z2${strides}.`, estSec: eKm * easyMid };
        } else day = { type: 'rest', title: 'Nghỉ / đi bộ nhẹ', distanceKm: 0, description: 'Nghỉ ngơi chủ động: đi bộ 20–30 phút, giãn cơ, ngủ đủ 7–9 giờ.', estSec: 0 };
        const sd = STRENGTH_DAYS[runDays];
        if (sd.includes(d) && wk.phase !== 'race') {
          const key = wk.phase === 'taper' ? (d === sd[0] ? 'light' : null) : d === sd[0] ? 'A' : 'B';
          if (key) day.strength = STRENGTH[key];
        }
        total += day.distanceKm;
        day.kind = kindOf(day);
        days.push(Object.assign(day, { date, week: wk.index, phase: wk.phase, dow: d, estDurationSec: day.estSec }));
      }
      wk.plannedKm = Math.round(total);
    });

    function raceWeek(wk, out) {
      const tpl = [
        { type: 'rest', title: 'Nghỉ', distanceKm: 0, description: 'Nghỉ hoàn toàn. Bắt đầu ưu tiên ngủ sớm.', strength: STRENGTH.mobility },
        { type: 'mp', title: 'Kích hoạt: 3×1.5 km pace marathon', distanceKm: 8, pace: `${P(mp)}/km`, zone: 'Z3', description: `2 km dễ, 3×1.5 km @ ${P(mp)}/km (nghỉ 2 phút), 1.5 km thả lỏng. Cảm giác phải "nhẹ".` , estSec: 8 * mp * 1.08 },
        { type: 'easy', title: 'Chạy nhẹ 5 km', distanceKm: 5, pace: rng(paces.easy[0], paces.easy[1]), zone: 'Z1–Z2', description: 'Chạy rất dễ.', estSec: 5 * easyMid },
        { type: 'easy', title: 'Chạy nhẹ 6 km + 4 strides', distanceKm: 6, pace: rng(paces.easy[0], paces.easy[1]), zone: 'Z2', description: 'Chạy dễ, 4 lần tăng tốc 20 giây. Kiểm tra giày, trang phục đua.', estSec: 6 * easyMid },
        { type: 'rest', title: 'Nghỉ – nạp carb ngày 1', distanceKm: 0, description: 'Nghỉ. Bắt đầu carb-loading 8–10 g/kg. Chuẩn bị BIB, gel, vaseline.' },
        { type: 'easy', title: 'Shakeout 3 km + 4 strides', distanceKm: 3, pace: rng(paces.easy[0], paces.easy[1]), zone: 'Z1', description: 'Chạy 15–20 phút rất nhẹ. Nạp carb ngày 2, ăn tối sớm, đi ngủ sớm.', estSec: 3 * easyMid },
        { type: 'race', title: '🏁 FULL MARATHON 42.195 km', distanceKm: 42.195, pace: `${P(mp)}/km`, zone: 'Z3', description: raceStrategy(mp), estSec: 42.195 * mp },
      ];
      let total = 0;
      tpl.forEach((t, d) => {
        const date = MC.addDays(wk.start, d);
        if (date > race) return;
        const day = Object.assign({}, t, { date, week: wk.index, phase: 'race', dow: d, estDurationSec: t.estSec || 0 });
        day.kind = d === 4 || d === 5 ? 'carbload' : kindOf(day);
        total += day.distanceKm;
        out.push(day);
      });
      wk.plannedKm = Math.round(total);
      wk.targetKm = wk.plannedKm;
    }

    function raceStrategy(mpSec) {
      return `Chiến thuật: 5 km đầu chậm hơn mục tiêu 5–10 s/km (${P(mpSec + 8)}/km). Km 5–30 giữ đều ${P(mpSec)}/km, ` +
        `nhìn nhịp tim không vượt Z3 cao. Km 30–42: nếu còn sức, tăng dần. Gel mỗi 25–30 phút (bắt đầu từ phút 30), uống nước ở mỗi trạm. ` +
        `Mục tiêu về đích ≈ ${MC.fmtTime(42.195 * mpSec)}.`;
    }
    function kindOf(day) {
      if (day.type === 'race') return 'race';
      if (day.type === 'long') return 'long';
      if (day.type === 'interval' || day.type === 'threshold' || day.type === 'mp') return 'quality';
      if (day.type === 'easy') return 'easy';
      return 'rest';
    }

    // Đánh dấu ngày trước nạp carb ở tuần đua
    return { weeks, days, N, peakVol: Math.round(peakVol), maxLong: r1(maxLong) };
  }

  // Điều chỉnh bài tập theo độ sẵn sàng
  function adjustForReadiness(day, ready) {
    if (!day || !ready || ready.level === 'unknown' || ready.level === 'green' || day.type === 'race') return null;
    if (ready.level === 'red') {
      if (day.type === 'rest') return 'Giữ nghỉ ngơi hoàn toàn, ngủ bù' + (day.strength ? ' – bỏ buổi sức mạnh hôm nay, chỉ giãn cơ nhẹ.' : '.');
      return `Cơ thể đang báo mệt: thay bài "${day.title}" bằng 30–40 phút chạy rất nhẹ Z1 hoặc nghỉ. Dời bài chất lượng sang 1–2 ngày sau, không dồn bài.`;
    }
    if (day.type === 'interval' || day.type === 'threshold' || day.type === 'mp')
      return 'Độ sẵn sàng trung bình: giảm 20–30% số lặp/khối lượng phần chính, giữ đúng pace (không cố nhanh hơn).';
    if (day.type === 'long') return 'Độ sẵn sàng trung bình: chạy dài nhưng giữ Z2 nghiêm ngặt, có thể rút ngắn 10–15%.';
    return 'Độ sẵn sàng trung bình: giữ buổi nhẹ, ưu tiên giấc ngủ tối nay.';
  }

  MC.buildPlan = buildPlan;
  MC.adjustForReadiness = adjustForReadiness;
  MC.DOW_VN = DOW_VN;
  MC.STRENGTH = STRENGTH;
})(typeof window !== 'undefined' ? window : globalThis);
