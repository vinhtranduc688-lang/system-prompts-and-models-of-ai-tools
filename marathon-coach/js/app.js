/* Marathon Coach – giao diện & trạng thái (lưu trong localStorage của trình duyệt) */
(function () {
  'use strict';
  const MC = window.MC;
  const KEY = 'marathon-coach-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const DEFAULT_PROFILE = {
    name: '', sex: 'male', age: 30, weight: 65, height: 170, restHR: 55, maxHR: 190,
    raceName: 'Full Marathon', raceDate: '2026-12-27', goalTime: '',
    refDist: 21.0975, refTime: '', weeklyKm: 30, longestKm: 15, runDays: 5,
  };

  let state = load();
  const charts = {};

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* bỏ qua */ }
    s = s || {};
    return {
      profile: Object.assign({}, DEFAULT_PROFILE, s.profile || {}),
      activities: s.activities || [],
      wellness: s.wellness || [],
      planParams: s.planParams || null,
      lastSync: s.lastSync || null,
    };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast('Không lưu được dữ liệu: ' + e.message); }
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3500);
  }
  function today() { return MC.ymd(new Date()); }

  // ---------- Dữ liệu dẫn xuất ----------
  function latestWellness(key) {
    const w = state.wellness.filter((x) => x[key] > 0).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return w ? w[key] : null;
  }
  function fitness() {
    const p = state.profile;
    const refSec = MC.parseTime(p.refTime);
    let vdot = MC.vdotFromRace(+p.refDist, refSec), vdotSrc = 'thành tích tham chiếu';
    if (!isFinite(vdot)) {
      const vo2 = latestWellness('vo2max');
      if (vo2) { vdot = vo2 * 0.95; vdotSrc = 'VO2max Garmin (ước tính)'; }
      else { vdot = 40; vdotSrc = 'mặc định – hãy nhập thành tích gần nhất'; }
    }
    const paces = MC.trainingPaces(vdot);
    const predicted = MC.predictTime(vdot, 42.195);
    const goalSec = MC.parseTime(p.goalTime);
    let trainingMP = paces.marathon, goalNote = null;
    if (goalSec > 0) {
      const gp = goalSec / 42.195;
      const gap = (paces.marathon - gp) / paces.marathon; // >0: mục tiêu nhanh hơn dự đoán
      if (gap > 0.03) {
        trainingMP = paces.marathon * 0.985;
        goalNote = `Mục tiêu ${p.goalTime} nhanh hơn dự đoán ${Math.round(gap * 100)}%. Với ~7 tuần, an toàn hơn là tập ở pace ${MC.fmtPace(trainingMP)}/km (≈${MC.fmtTime(trainingMP * 42.195)}) và quyết định ở km 30.`;
      } else trainingMP = gp;
    }
    return { vdot, vdotSrc, paces, predicted, goalSec, trainingMP, goalNote };
  }
  function getPlan(fit) {
    const pp = state.planParams;
    if (!pp) return null;
    const profile = Object.assign({}, state.profile, { weeklyKm: pp.weeklyKm, longestKm: pp.longestKm, runDays: pp.runDays, raceDate: pp.raceDate });
    const paces = MC.trainingPaces(pp.vdot);
    return MC.buildPlan(profile, { today: pp.createdOn, paces, trainingMP: pp.trainingMP || paces.marathon });
  }
  function createPlan() {
    const fit = fitness();
    const p = state.profile;
    const rs = MC.recentStats(state.activities, today());
    const useData = rs.runs >= 6;
    state.planParams = {
      createdOn: today(), raceDate: p.raceDate, runDays: +p.runDays,
      weeklyKm: useData ? Math.round(Math.max(rs.avgWeeklyKm, 10)) : +p.weeklyKm,
      longestKm: useData ? Math.round(rs.longestKm) : +p.longestKm,
      vdot: fit.vdot, trainingMP: fit.trainingMP,
    };
    save();
    toast(`Đã tạo giáo án (nền ${state.planParams.weeklyKm} km/tuần, chạy dài nhất ${state.planParams.longestKm} km${useData ? ' – lấy từ dữ liệu Garmin 4 tuần' : ''}).`);
    render();
  }
  function actualsByDate() {
    const m = {};
    state.activities.filter(MC.isRun).forEach((a) => {
      const d = a.date.slice(0, 10);
      m[d] = m[d] || { km: 0, sec: 0, list: [] };
      m[d].km += a.distanceKm || 0; m[d].sec += a.durationSec || 0; m[d].list.push(a);
    });
    return m;
  }
  function loadNow() {
    const s = MC.loadSeries(state.activities, state.profile, today(), 120);
    return s[s.length - 1] || { ctl: 0, atl: 0, tsb: 0 };
  }

  // ---------- Render ----------
  function render() {
    const fit = fitness();
    const plan = getPlan(fit);
    renderCountdown();
    renderDashboard(fit, plan);
    renderPlan(fit, plan);
    renderNutrition(plan);
    renderData();
    renderSync();
    renderProfile(fit);
  }

  function renderCountdown() {
    const d = MC.diffDays(today(), state.profile.raceDate);
    $('#countdown').innerHTML = d >= 0 ? `<b>${d}</b> ngày<br><span class="small">${esc(state.profile.raceName)} · ${fmtDate(state.profile.raceDate)}</span>` : 'Đã qua ngày đua';
  }
  function fmtDate(s, withDow) {
    const d = MC.parseYmd(s);
    return (withDow ? MC.DOW_VN[MC.dow(s)] + ', ' : '') + d.getDate() + '/' + (d.getMonth() + 1);
  }
  function statusFor(day, act) {
    if (day.date > today()) return '';
    if (day.distanceKm === 0) return act ? `<span class="done">+${act.km.toFixed(1)} km</span>` : '';
    if (!act) return day.date < today() ? '<span class="miss">✗ chưa ghi nhận</span>' : '<span class="miss">hôm nay</span>';
    const pct = Math.round((act.km / day.distanceKm) * 100);
    return `<span class="done">✓ ${act.km.toFixed(1)} km (${pct}%)</span>`;
  }

  function dayCard(day, fit, ready) {
    if (!day) return '<p class="muted">Không có bài tập.</p>';
    const adj = MC.adjustForReadiness(day, ready);
    return `
      <h3><span class="tag ${day.type}"></span>${esc(day.title)}</h3>
      ${day.pace ? `<div class="small">Pace: <b>${day.pace}</b>${day.zone ? ' · Vùng tim: <b>' + day.zone + '</b>' : ''}${day.estDurationSec ? ' · ~' + MC.fmtTime(day.estDurationSec) : ''}</div>` : ''}
      <p class="small muted">${esc(day.description)}</p>
      ${day.strength ? `<div class="small"><b>${day.strength.title}:</b> ${day.strength.items.join(' · ')}</div>` : ''}
      ${adj ? `<div class="note ${ready.level === 'red' ? 'bad' : ''}">${adj}</div>` : ''}`;
  }

  function renderDashboard(fit, plan) {
    const el = $('#tab-dashboard');
    const t = today();
    const L = loadNow();
    const ready = MC.readiness(state.wellness, t, L.tsb);
    const acts = actualsByDate();
    const day = plan && plan.days.find((d) => d.date === t);
    const tomorrow = plan && plan.days.find((d) => d.date === MC.addDays(t, 1));
    const nut = day ? MC.nutritionForDay(state.profile, day) : MC.nutritionForDay(state.profile, { kind: 'rest' });
    const rs = MC.recentStats(state.activities, t);
    const thisWeek = plan && plan.weeks.find((w) => w.start === MC.mondayOf(t));
    const weekDone = thisWeek ? plan.days.filter((d) => d.week === thisWeek.index).reduce((s, d) => s + ((acts[d.date] || {}).km || 0), 0) : 0;
    const ringColor = { green: 'var(--good)', amber: 'var(--warn)', red: 'var(--bad)', unknown: 'var(--line)' }[ready.level];
    const levelTxt = { green: 'Sẵn sàng tập', amber: 'Tập vừa phải', red: 'Cần hồi phục', unknown: 'Chưa rõ' }[ready.level];
    const gapTxt = fit.goalSec > 0 ? (fit.predicted <= fit.goalSec ? '<span class="pill green">Mục tiêu khả thi</span>' : `<span class="pill ${fit.predicted - fit.goalSec < 300 ? 'amber' : 'red'}">Chậm hơn mục tiêu ${MC.fmtTime(fit.predicted - fit.goalSec)}</span>`) : '';

    el.innerHTML = `
      ${!state.planParams ? `<div class="note info">👋 Bắt đầu: vào <b>⚙️ Hồ sơ</b> nhập chỉ số + thành tích gần nhất, (tuỳ chọn) đồng bộ Garmin ở tab <b>⌚ Garmin</b>, rồi bấm <b>Tạo giáo án</b>.</div>` : ''}
      <div class="grid">
        <div class="card">
          <h2>Bài tập hôm nay · ${fmtDate(t, true)}</h2>
          ${plan ? dayCard(day, fit, ready) : '<p class="muted">Chưa có giáo án.</p><button class="btn" data-act="create-plan">Tạo giáo án</button>'}
          ${tomorrow ? `<div class="small muted mt">Ngày mai: <span class="tag ${tomorrow.type}"></span>${esc(tomorrow.title)}</div>` : ''}
        </div>
        <div class="card">
          <h2>Độ sẵn sàng</h2>
          <div class="row">
            <div class="ring" style="--p:${ready.score || 0};--c:${ringColor}"><div>${ready.score == null ? '–' : ready.score}</div></div>
            <div><span class="pill ${ready.level}">${levelTxt}</span>
              <ul class="clean small">${ready.reasons.map((r) => '<li>' + esc(r) + '</li>').join('')}</ul></div>
          </div>
        </div>
        <div class="card">
          <h2>Dinh dưỡng hôm nay</h2>
          <div class="spread"><b>${nut.label}</b><span class="big">${nut.kcal}<span class="small muted"> kcal</span></span></div>
          <div class="macro mt"><div><b>${nut.carbs}g</b><span class="small muted">Carb</span></div><div><b>${nut.protein}g</b><span class="small muted">Đạm</span></div><div><b>${nut.fat}g</b><span class="small muted">Béo</span></div><div><b>${nut.water}L</b><span class="small muted">Nước</span></div></div>
          ${nut.fueling ? `<div class="note info">${nut.fueling}</div>` : ''}
        </div>
      </div>

      <div class="grid mt">
        <div class="card">
          <h2>Dự đoán Full Marathon</h2>
          <div class="big">${MC.fmtTime(fit.predicted)}</div>
          <div class="small muted">VDOT ${fit.vdot.toFixed(1)} · nguồn: ${fit.vdotSrc}</div>
          <div class="row mt">${fit.goalSec > 0 ? `<span class="small">Mục tiêu <b>${esc(state.profile.goalTime)}</b> (${MC.fmtPace(fit.goalSec / 42.195)}/km)</span>` : ''}${gapTxt}</div>
          <div class="small mt">Pace marathon tập luyện: <b>${MC.fmtPace(fit.trainingMP)}/km</b></div>
          ${fit.goalNote ? `<div class="note">${fit.goalNote}</div>` : ''}
        </div>
        <div class="card">
          <h2>Tải tập luyện</h2>
          <div class="kpis">
            <div class="kpi"><div class="v">${L.ctl.toFixed(0)}</div><div class="l">Thể lực (CTL 42 ngày)</div></div>
            <div class="kpi"><div class="v">${L.atl.toFixed(0)}</div><div class="l">Mệt mỏi (ATL 7 ngày)</div></div>
            <div class="kpi"><div class="v" style="color:${L.tsb < -25 ? 'var(--bad)' : L.tsb > 5 ? 'var(--good)' : 'inherit'}">${L.tsb.toFixed(0)}</div><div class="l">Phong độ (TSB)</div></div>
          </div>
          <div class="small muted mt">4 tuần qua: ${rs.avgWeeklyKm.toFixed(1)} km/tuần · dài nhất ${rs.longestKm.toFixed(1)} km · ${rs.runs} buổi</div>
        </div>
        <div class="card">
          <h2>Tuần này</h2>
          ${thisWeek ? `<div class="spread"><span>${thisWeek.phaseLabel}</span><span><b>${weekDone.toFixed(1)}</b> / ${thisWeek.plannedKm} km</span></div>
            <div class="bar"><span style="width:${Math.min(100, (weekDone / Math.max(1, thisWeek.plannedKm)) * 100)}%"></span></div>
            <ul class="clean small mt">${plan.days.filter((d) => d.week === thisWeek.index).map((d) => `<li>${MC.DOW_VN[d.dow]}: <span class="tag ${d.type}"></span>${esc(d.title)} ${statusFor(d, acts[d.date])}</li>`).join('')}</ul>` : '<p class="muted">–</p>'}
        </div>
      </div>

      <div class="grid two mt">
        <div class="card"><h2>Khối lượng theo tuần (km)</h2><div class="chart-box"><canvas id="chWeekly"></canvas></div></div>
        <div class="card"><h2>Thể lực / Mệt mỏi / Phong độ (90 ngày)</h2><div class="chart-box"><canvas id="chLoad"></canvas></div></div>
      </div>
      <div class="row mt"><button class="btn ghost" data-act="coach-report">📋 Sao chép báo cáo cho HLV AI</button></div>`;
    drawDashboardCharts(plan);
  }

  function chartColors() {
    const cs = getComputedStyle(document.documentElement);
    return { text: cs.getPropertyValue('--muted').trim(), line: cs.getPropertyValue('--line').trim(), accent: cs.getPropertyValue('--accent').trim() };
  }
  function makeChart(id, cfg) {
    if (!window.Chart) return;
    const c = document.getElementById(id);
    if (!c) return;
    if (charts[id]) charts[id].destroy();
    const col = chartColors();
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: col.text, boxWidth: 12 } } },
      scales: { x: { ticks: { color: col.text, maxRotation: 0, autoSkip: true }, grid: { color: col.line } }, y: { ticks: { color: col.text }, grid: { color: col.line } } } }, cfg.options || {});
    charts[id] = new Chart(c, cfg);
  }
  function drawDashboardCharts(plan) {
    const t = today();
    const past = MC.weeklyKm(state.activities, t, 8);
    const weeks = past.map((w) => w.week);
    if (plan) plan.weeks.forEach((w) => { if (!weeks.includes(w.start)) weeks.push(w.start); });
    const actualMap = {}; past.forEach((w) => (actualMap[w.week] = w.km));
    const planMap = {}; if (plan) plan.weeks.forEach((w) => (planMap[w.start] = w.plannedKm));
    const allActual = MC.weeklyKm(state.activities, weeks[weeks.length - 1] || t, weeks.length);
    allActual.forEach((w) => (actualMap[w.week] = w.km));
    makeChart('chWeekly', {
      type: 'bar',
      data: { labels: weeks.map((w) => fmtDate(w)), datasets: [
        { label: 'Thực tế', data: weeks.map((w) => (w <= t ? +(actualMap[w] || 0).toFixed(1) : null)), backgroundColor: '#0f766e' },
        { label: 'Giáo án', data: weeks.map((w) => planMap[w] ?? null), backgroundColor: 'rgba(139,92,246,.45)' },
      ] },
    });
    let s = MC.loadSeries(state.activities, state.profile, t, 90);
    const firstIdx = s.findIndex((x) => x.load > 0);
    if (firstIdx > 0) s = s.slice(firstIdx);
    makeChart('chLoad', {
      type: 'line',
      data: { labels: s.map((x) => fmtDate(x.date)), datasets: [
        { label: 'CTL', data: s.map((x) => +x.ctl.toFixed(1)), borderColor: '#3b82f6', pointRadius: 0, tension: 0.3 },
        { label: 'ATL', data: s.map((x) => +x.atl.toFixed(1)), borderColor: '#f97316', pointRadius: 0, tension: 0.3 },
        { label: 'TSB', data: s.map((x) => +x.tsb.toFixed(1)), borderColor: '#10b981', pointRadius: 0, tension: 0.3, borderDash: [4, 3] },
      ] },
    });
  }

  function renderPlan(fit, plan) {
    const el = $('#tab-plan');
    const p = fit.paces;
    const zones = MC.hrZones(+state.profile.restHR, +state.profile.maxHR);
    const acts = actualsByDate();
    const t = today();
    let html = `
      <div class="grid two">
        <div class="card"><h2>Pace tập luyện (VDOT ${fit.vdot.toFixed(1)})</h2>
          <table><tr><th>Loại</th><th>Pace</th><th>Mục đích</th></tr>
          <tr><td><span class="tag easy"></span>Dễ / hồi phục</td><td>${MC.fmtPace(p.easy[0])}–${MC.fmtPace(p.easy[1])}</td><td>Nền aerobic</td></tr>
          <tr><td><span class="tag long"></span>Chạy dài</td><td>${MC.fmtPace(p.long[0])}–${MC.fmtPace(p.long[1])}</td><td>Sức bền</td></tr>
          <tr><td><span class="tag mp"></span>Marathon</td><td>${MC.fmtPace(fit.trainingMP)}</td><td>Pace đua</td></tr>
          <tr><td><span class="tag threshold"></span>Ngưỡng (T)</td><td>${MC.fmtPace(p.threshold)}</td><td>Ngưỡng lactate</td></tr>
          <tr><td><span class="tag interval"></span>Interval (I)</td><td>${MC.fmtPace(p.interval)}</td><td>VO2max</td></tr>
          </table></div>
        <div class="card"><h2>Vùng nhịp tim (Karvonen)</h2>
          <table><tr><th>Vùng</th><th>BPM</th></tr>${zones.map((z) => `<tr><td>${z.name}</td><td>${z.lo}–${z.hi}</td></tr>`).join('')}</table>
          <div class="small muted mt">Nhịp nghỉ ${state.profile.restHR}, tối đa ${state.profile.maxHR}. Cập nhật ở tab Hồ sơ.</div></div>
      </div>
      <div class="row mt"><button class="btn" data-act="create-plan">${plan ? '🔄 Tạo lại giáo án' : 'Tạo giáo án'}</button>
        ${plan ? '<button class="btn ghost" data-act="ics">📆 Xuất lịch (.ics)</button>' : ''}
        ${state.planParams ? `<span class="small muted">Tạo ngày ${fmtDate(state.planParams.createdOn)} · nền ${state.planParams.weeklyKm} km/tuần · ${state.planParams.runDays} buổi/tuần · đỉnh ${plan.peakVol} km · chạy dài tối đa ${plan.maxLong} km</span>` : ''}</div>`;
    if (plan) {
      html += '<div class="mt">';
      plan.weeks.forEach((w) => {
        const days = plan.days.filter((d) => d.week === w.index);
        const done = days.reduce((s, d) => s + ((acts[d.date] || {}).km || 0), 0);
        const current = w.start === MC.mondayOf(t);
        html += `<details class="week" ${current || (w.start > t && !html.includes('open data-first')) ? 'open data-first' : ''}>
          <summary><span><b>Tuần ${w.index + 1}</b> · ${fmtDate(w.start)}–${fmtDate(MC.addDays(w.start, 6))}<span class="phase">${w.phaseLabel}</span></span>
          <span class="small">${w.start <= t ? done.toFixed(0) + ' / ' : ''}${w.plannedKm} km</span></summary><div class="days">
          ${days.map((d) => `<div class="day ${d.date === t ? 'today' : d.date < t ? 'past' : ''}">
            <div class="dt"><b>${MC.DOW_VN[d.dow]}</b>${fmtDate(d.date)}</div>
            <div><div class="t"><span class="tag ${d.type}"></span>${esc(d.title)}</div>
              ${d.pace ? `<div class="small">${d.pace}${d.zone ? ' · ' + d.zone : ''}${d.estDurationSec ? ' · ~' + MC.fmtTime(d.estDurationSec) : ''}</div>` : ''}
              <div class="desc">${esc(d.description)}</div>
              ${d.strength ? `<div class="desc">💪 <b>${d.strength.title}</b>: ${d.strength.items.join(' · ')}</div>` : ''}</div>
            <div class="st">${statusFor(d, acts[d.date])}</div></div>`).join('')}
          </div></details>`;
      });
      html += '</div>';
    }
    el.innerHTML = html;
  }

  function renderNutrition(plan) {
    const el = $('#tab-nutrition');
    const sel = renderNutrition.date || today();
    const day = plan && plan.days.find((d) => d.date === sel);
    const nut = MC.nutritionForDay(state.profile, day || { kind: 'rest' });
    const ideas = MC.mealIdeas(nut.kind);
    const w = +state.profile.weight;
    const weekRows = plan ? plan.days.filter((d) => d.date >= today()).slice(0, 7).map((d) => {
      const n = MC.nutritionForDay(state.profile, d);
      return `<tr><td>${fmtDate(d.date, true)}</td><td><span class="tag ${d.type}"></span>${esc(d.title)}</td><td>${n.kcal}</td><td>${n.carbs}</td><td>${n.protein}</td><td>${n.fat}</td></tr>`;
    }).join('') : '';
    el.innerHTML = `
      <div class="grid two">
        <div class="card">
          <div class="spread"><h2>Kế hoạch ăn theo ngày</h2><input type="date" id="nutDate" value="${sel}"></div>
          <div class="small muted">${day ? '<span class="tag ' + day.type + '"></span>' + esc(day.title) : 'Không có bài tập'}</div>
          <div class="spread mt"><b>${nut.label}</b><span class="big">${nut.kcal}<span class="small muted"> kcal</span></span></div>
          <div class="macro mt"><div><b>${nut.carbs}g</b><span class="small muted">Carb (${(nut.carbs / w).toFixed(1)} g/kg)</span></div><div><b>${nut.protein}g</b><span class="small muted">Đạm</span></div><div><b>${nut.fat}g</b><span class="small muted">Béo</span></div><div><b>${nut.water}L</b><span class="small muted">Nước</span></div></div>
          <p class="small">${nut.note}</p>
          ${nut.fueling ? `<div class="note info">${nut.fueling}</div>` : ''}
          <h2 class="mt">Gợi ý bữa ăn</h2><ul class="clean small">${ideas.map((i) => '<li>' + i + '</li>').join('')}</ul>
        </div>
        <div class="card">
          <h2>Lộ trình dinh dưỡng tuần đua</h2>
          <ul class="clean small">
            <li><b>T-7 → T-3:</b> ăn bình thường theo tập, carb ~5–6 g/kg. Không thử món mới. Ngủ 8 giờ.</li>
            <li><b>T-2 & T-1 (nạp carb):</b> ${Math.round(8 * w)}–${Math.round(10 * w)} g carb/ngày (8–10 g/kg), giảm chất xơ/chất béo, uống nước có điện giải. Cân có thể tăng 1–2 kg – bình thường (glycogen + nước).</li>
            <li><b>Tối T-1:</b> ăn sớm (trước 19h), cơm/mì trắng, thịt nạc, ít rau sống, không đồ cay/chiên.</li>
            <li><b>Sáng ngày đua (3–4h trước):</b> ${Math.round(2 * w)}–${Math.round(3 * w)} g carb (bánh mì trắng + mật ong + chuối), 400–600 ml nước.</li>
            <li><b>Trong đua:</b> 60–90 g carb/giờ – với mục tiêu ~${MC.fmtTime(42.195 * (state.planParams ? state.planParams.trainingMP : fitness().trainingMP))} cần khoảng ${Math.ceil((42.195 * (state.planParams ? state.planParams.trainingMP : fitness().trainingMP)) / 3600 * 2.5)} gel (25 g/gel). Gel đầu tiên ở phút 30–40.</li>
            <li><b>Sau đua:</b> 1–1.2 g/kg carb + 20–30 g đạm trong 1 giờ, bù 150% lượng mồ hôi mất.</li>
          </ul>
          <div class="note">Tập ăn gel/đồ uống <b>đúng loại dùng ngày đua</b> trong các buổi chạy dài để dạ dày thích nghi. Người có bệnh lý nên tham khảo chuyên gia dinh dưỡng.</div>
        </div>
      </div>
      ${weekRows ? `<div class="card mt"><h2>7 ngày tới</h2><div class="table-wrap"><table><tr><th>Ngày</th><th>Bài tập</th><th>kcal</th><th>Carb g</th><th>Đạm g</th><th>Béo g</th></tr>${weekRows}</table></div></div>` : ''}`;
    $('#nutDate').onchange = (e) => { renderNutrition.date = e.target.value; renderNutrition(getPlan(fitness())); };
  }

  function renderData() {
    const el = $('#tab-data');
    const acts = state.activities.slice(0, 60);
    const wel = state.wellness.slice(0, 30);
    el.innerHTML = `
      <div class="grid two">
        <div class="card"><h2>HRV & nhịp tim nghỉ (30 ngày)</h2><div class="chart-box"><canvas id="chWell"></canvas></div></div>
        <div class="card"><h2>Giấc ngủ (giờ) & Body Battery</h2><div class="chart-box"><canvas id="chSleep"></canvas></div></div>
      </div>
      <div class="grid two mt">
        <div class="card"><h2>Thêm buổi chạy thủ công</h2>
          <form class="grid-form" id="fAct">
            <label>Ngày<input type="date" name="date" value="${today()}" required></label>
            <label>Quãng đường (km)<input type="number" step="0.01" name="distanceKm" required></label>
            <label>Thời gian (h:mm:ss)<input name="duration" placeholder="0:45:00" required></label>
            <label>Nhịp tim TB<input type="number" name="avgHR"></label>
            <label>Loại<select name="type"><option>Running</option><option>Treadmill Running</option><option>Trail Running</option><option>Cycling</option><option>Strength</option></select></label>
            <label>&nbsp;<button class="btn">Lưu</button></label>
          </form></div>
        <div class="card"><h2>Thêm chỉ số sức khoẻ</h2>
          <form class="grid-form" id="fWell">
            <label>Ngày<input type="date" name="date" value="${today()}" required></label>
            <label>Nhịp nghỉ (bpm)<input type="number" name="restHR"></label>
            <label>HRV đêm (ms)<input type="number" name="hrv"></label>
            <label>Ngủ (giờ)<input type="number" step="0.1" name="sleepHours"></label>
            <label>Body Battery<input type="number" name="bodyBattery"></label>
            <label>Cân nặng (kg)<input type="number" step="0.1" name="weight"></label>
            <label>&nbsp;<button class="btn">Lưu</button></label>
          </form></div>
      </div>
      <div class="card mt"><h2>Hoạt động (${state.activities.length})</h2><div class="table-wrap"><table>
        <tr><th>Ngày</th><th>Loại</th><th>Tên</th><th>Km</th><th>Thời gian</th><th>Pace</th><th>HR TB</th><th>Tải</th><th></th></tr>
        ${acts.map((a) => `<tr><td>${a.date}</td><td>${esc(a.type)}</td><td>${esc(a.name || '')}</td><td>${(a.distanceKm || 0).toFixed(2)}</td><td>${MC.fmtTime(a.durationSec)}</td><td>${a.distanceKm ? MC.fmtPace(a.durationSec / a.distanceKm) : '–'}</td><td>${a.avgHR || '–'}</td><td>${MC.trimp(a, state.profile).toFixed(0)}</td><td><button class="btn sm ghost" data-del-act="${esc(a.id)}">✕</button></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Chưa có dữ liệu – đồng bộ ở tab Garmin.</td></tr>'}
      </table></div></div>
      <div class="card mt"><h2>Sức khoẻ (${state.wellness.length} ngày)</h2><div class="table-wrap"><table>
        <tr><th>Ngày</th><th>RHR</th><th>HRV</th><th>Ngủ</th><th>Điểm ngủ</th><th>Body Battery</th><th>Stress</th><th>VO2max</th><th>Readiness</th><th>Cân</th></tr>
        ${wel.map((w) => `<tr><td>${w.date}</td><td>${w.restHR || '–'}</td><td>${w.hrv || '–'}</td><td>${w.sleepHours ? (+w.sleepHours).toFixed(1) : '–'}</td><td>${w.sleepScore || '–'}</td><td>${w.bodyBattery || '–'}</td><td>${w.stress || '–'}</td><td>${w.vo2max || '–'}</td><td>${w.trainingReadiness || '–'}</td><td>${w.weight || '–'}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">Chưa có dữ liệu.</td></tr>'}
      </table></div></div>`;

    $('#fAct').onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const r = MC.mergeActivities(state.activities, [{ id: 'manual-' + Date.now(), source: 'manual', date: f.date, type: f.type, distanceKm: +f.distanceKm, durationSec: MC.parseTime(f.duration) || 0, avgHR: +f.avgHR || 0 }]);
      state.activities = r.list; save(); render(); toast('Đã lưu buổi tập');
    };
    $('#fWell').onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const rec = { date: f.date };
      ['restHR', 'hrv', 'sleepHours', 'bodyBattery', 'weight'].forEach((k) => { if (f[k]) rec[k] = +f[k]; });
      state.wellness = MC.mergeWellness(state.wellness, [rec]).list; save(); render(); toast('Đã lưu chỉ số');
    };
    const ws = state.wellness.slice(0, 30).reverse();
    makeChart('chWell', {
      type: 'line',
      data: { labels: ws.map((w) => fmtDate(w.date)), datasets: [
        { label: 'HRV (ms)', data: ws.map((w) => w.hrv || null), borderColor: '#8b5cf6', tension: 0.3, spanGaps: true, yAxisID: 'y' },
        { label: 'Nhịp nghỉ (bpm)', data: ws.map((w) => w.restHR || null), borderColor: '#ef4444', tension: 0.3, spanGaps: true, yAxisID: 'y1' },
      ] },
      options: { scales: { y: { position: 'left', ticks: { color: chartColors().text }, grid: { color: chartColors().line } }, y1: { position: 'right', ticks: { color: chartColors().text }, grid: { display: false } }, x: { ticks: { color: chartColors().text }, grid: { color: chartColors().line } } } },
    });
    makeChart('chSleep', {
      type: 'bar',
      data: { labels: ws.map((w) => fmtDate(w.date)), datasets: [
        { label: 'Ngủ (giờ)', data: ws.map((w) => w.sleepHours || null), backgroundColor: '#3b82f6', yAxisID: 'y' },
        { type: 'line', label: 'Body Battery', data: ws.map((w) => w.bodyBattery || null), borderColor: '#10b981', spanGaps: true, yAxisID: 'y1' },
      ] },
      options: { scales: { y: { position: 'left', ticks: { color: chartColors().text }, grid: { color: chartColors().line } }, y1: { position: 'right', min: 0, max: 100, ticks: { color: chartColors().text }, grid: { display: false } }, x: { ticks: { color: chartColors().text }, grid: { color: chartColors().line } } } },
    });
  }

  function renderSync() {
    const el = $('#tab-sync');
    el.innerHTML = `
      <div class="card">
        <h2>Kết nối Garmin</h2>
        <p class="small">Garmin chỉ mở API chính thức (Garmin Connect Developer Program) cho doanh nghiệp được duyệt, nên app dùng 2 cách sau – dữ liệu chỉ nằm trên máy bạn:</p>
        <div class="grid two">
          <div><h3>① Tự động: script đồng bộ (khuyên dùng)</h3>
            <p class="small muted">Lấy hoạt động + HRV, nhịp nghỉ, giấc ngủ, Body Battery, VO2max, Training Readiness.</p>
<pre>cd marathon-coach
pip install -r sync/requirements.txt
python sync/garmin_sync.py --days 60
python -m http.server 8000</pre>
            <p class="small">Mở <code>http://localhost:8000</code> rồi bấm:</p>
            <button class="btn" data-act="load-sync">⌚ Tải garmin_data.json</button>
            ${state.lastSync ? `<div class="small muted mt">Lần đồng bộ cuối: ${new Date(state.lastSync).toLocaleString('vi-VN')}</div>` : ''}
          </div>
          <div><h3>② Thủ công: xuất file từ Garmin Connect</h3>
            <ul class="clean small"><li><b>CSV:</b> connect.garmin.com → Hoạt động → Tất cả hoạt động → <i>Xuất CSV</i></li>
            <li><b>TCX/GPX:</b> mở 1 hoạt động → ⚙️ → <i>Xuất sang TCX/GPX</i></li>
            <li><b>JSON:</b> file từ script hoặc bản sao lưu của app</li></ul>
            <div class="drop mt" id="drop">Kéo-thả file vào đây hoặc bấm để chọn<br><span class="small">.json · .csv · .tcx · .gpx (nhiều file cùng lúc)</span>
              <input type="file" id="fileIn" multiple accept=".json,.csv,.tcx,.gpx,.fit" hidden></div>
          </div>
        </div>
      </div>
      <div class="card mt"><h2>Sao lưu dữ liệu</h2>
        <p class="small muted">Dữ liệu lưu trong trình duyệt (localStorage). Hãy xuất bản sao lưu định kỳ.</p>
        <div class="row"><button class="btn ghost" data-act="export">⬇️ Xuất sao lưu JSON</button>
        <button class="btn danger" data-act="clear">Xoá toàn bộ dữ liệu</button>
        <span class="small muted">${state.activities.length} hoạt động · ${state.wellness.length} ngày chỉ số</span></div></div>`;
    const drop = $('#drop'), inp = $('#fileIn');
    drop.onclick = () => inp.click();
    inp.onchange = () => handleFiles(inp.files);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); };
  }

  function applyImport(res, label) {
    let msg = [];
    if (res.activities && res.activities.length) {
      const r = MC.mergeActivities(state.activities, res.activities);
      state.activities = r.list; msg.push(`${r.added} hoạt động mới`);
    }
    if (res.wellness && res.wellness.length) {
      const r = MC.mergeWellness(state.wellness, res.wellness);
      state.wellness = r.list; msg.push(`${res.wellness.length} ngày chỉ số`);
    }
    if (res.profile) {
      const pr = res.profile;
      ['restHR', 'maxHR', 'weight', 'height', 'age', 'sex'].forEach((k) => { if (pr[k]) state.profile[k] = pr[k]; });
      if (pr.raceDate || pr.goalTime) Object.assign(state.profile, pr); // bản sao lưu đầy đủ
      msg.push('hồ sơ');
    }
    if (res.planParams) state.planParams = res.planParams;
    if (res.meta && res.meta.source === 'garmin_sync') state.lastSync = res.meta.generatedAt || new Date().toISOString();
    save(); render();
    toast(`${label}: ${msg.join(', ') || 'không có dữ liệu mới'}`);
  }
  function handleFiles(files) {
    Array.from(files).forEach((f) => {
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const res = MC.importFile(f.name, rd.result);
          if (f.name.endsWith('.json')) { try { const j = JSON.parse(rd.result); if (j.planParams) res.planParams = j.planParams; } catch (e) {} }
          applyImport(res, f.name);
        } catch (e) { toast(f.name + ': ' + e.message); }
      };
      rd.readAsText(f);
    });
  }

  function renderProfile(fit) {
    const p = state.profile;
    const rs = MC.recentStats(state.activities, today());
    $('#tab-profile').innerHTML = `
      <div class="card"><h2>Hồ sơ vận động viên</h2>
        <form class="grid-form" id="fProfile">
          <label>Tên<input name="name" value="${esc(p.name)}"></label>
          <label>Giới tính<select name="sex"><option value="male" ${p.sex === 'male' ? 'selected' : ''}>Nam</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>Nữ</option></select></label>
          <label>Tuổi<input type="number" name="age" value="${p.age}"></label>
          <label>Cân nặng (kg)<input type="number" step="0.1" name="weight" value="${p.weight}"></label>
          <label>Chiều cao (cm)<input type="number" name="height" value="${p.height}"></label>
          <label>Nhịp tim nghỉ<input type="number" name="restHR" value="${p.restHR}"></label>
          <label>Nhịp tim tối đa<input type="number" name="maxHR" value="${p.maxHR}"></label>
        </form></div>
      <div class="card mt"><h2>Mục tiêu & nền tảng</h2>
        <form class="grid-form" id="fGoal">
          <label>Giải đua<input name="raceName" value="${esc(p.raceName)}"></label>
          <label>Ngày đua<input type="date" name="raceDate" value="${p.raceDate}"></label>
          <label>Mục tiêu (h:mm:ss)<input name="goalTime" value="${esc(p.goalTime)}" placeholder="4:00:00"></label>
          <label>Cự ly thành tích gần nhất<select name="refDist">
            ${[[5, '5 km'], [10, '10 km'], [21.0975, 'Half marathon'], [42.195, 'Marathon']].map(([v, l]) => `<option value="${v}" ${+p.refDist === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Thời gian thành tích (h:mm:ss)<input name="refTime" value="${esc(p.refTime)}" placeholder="1:55:00"></label>
          <label>Km/tuần hiện tại<input type="number" name="weeklyKm" value="${p.weeklyKm}"></label>
          <label>Chạy dài nhất gần đây (km)<input type="number" name="longestKm" value="${p.longestKm}"></label>
          <label>Số buổi chạy/tuần<select name="runDays">${[3, 4, 5, 6].map((n) => `<option ${+p.runDays === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </form>
        ${rs.runs >= 6 ? `<div class="note info">Dữ liệu Garmin 4 tuần: ${rs.avgWeeklyKm.toFixed(1)} km/tuần, dài nhất ${rs.longestKm.toFixed(1)} km – sẽ được dùng thay số nhập tay khi tạo giáo án.</div>` : ''}
        <div class="row mt"><button class="btn" data-act="save-profile">💾 Lưu</button><button class="btn ghost" data-act="save-create">💾 Lưu & tạo giáo án</button></div>
        <div class="small muted mt">VDOT hiện tại: <b>${fit.vdot.toFixed(1)}</b> (${fit.vdotSrc}). Dự đoán: 5K ${MC.fmtTime(MC.predictTime(fit.vdot, 5))} · 10K ${MC.fmtTime(MC.predictTime(fit.vdot, 10))} · HM ${MC.fmtTime(MC.predictTime(fit.vdot, 21.0975))} · FM ${MC.fmtTime(fit.predicted)}</div>
      </div>`;
  }
  function saveProfile() {
    const f = Object.assign({}, Object.fromEntries(new FormData($('#fProfile'))), Object.fromEntries(new FormData($('#fGoal'))));
    ['age', 'weight', 'height', 'restHR', 'maxHR', 'refDist', 'weeklyKm', 'longestKm', 'runDays'].forEach((k) => (f[k] = +f[k]));
    Object.assign(state.profile, f);
    save();
  }

  // ---------- Xuất lịch & báo cáo ----------
  function exportICS() {
    const plan = getPlan(fitness());
    if (!plan) return;
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Marathon Coach//VN', 'CALSCALE:GREGORIAN'];
    const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
    plan.days.filter((d) => d.type !== 'rest' || d.strength).forEach((d) => {
      const dt = d.date.replace(/-/g, ''), next = MC.addDays(d.date, 1).replace(/-/g, '');
      const desc = [d.pace ? 'Pace: ' + d.pace : '', d.description, d.strength ? d.strength.title + ': ' + d.strength.items.join(', ') : ''].filter(Boolean).join('\n');
      lines.push('BEGIN:VEVENT', `UID:mc-${dt}@marathon-coach`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`, `DTSTART;VALUE=DATE:${dt}`, `DTEND;VALUE=DATE:${next}`, `SUMMARY:${icsEsc((d.type === 'rest' ? '💪 ' + d.strength.title : '🏃 ' + d.title))}`, `DESCRIPTION:${icsEsc(desc)}`, 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    download('giao-an-marathon.ics', lines.join('\r\n'), 'text/calendar');
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function coachReport() {
    const fit = fitness(), plan = getPlan(fit), t = today(), L = loadNow();
    const ready = MC.readiness(state.wellness, t, L.tsb);
    const p = state.profile;
    const wk = MC.weeklyKm(state.activities, t, 6).map((w) => `${w.week}: ${w.km.toFixed(1)} km`).join('; ');
    const recent = state.activities.filter((a) => a.date > MC.addDays(t, -14)).map((a) => `- ${a.date} ${a.type} ${(a.distanceKm || 0).toFixed(1)} km ${MC.fmtTime(a.durationSec)} HR ${a.avgHR || '?'}`).join('\n');
    const next = plan ? plan.days.filter((d) => d.date >= t).slice(0, 7).map((d) => `- ${d.date}: ${d.title}`).join('\n') : '(chưa có)';
    const txt = `Tôi đang chuẩn bị ${p.raceName} ngày ${p.raceDate} (còn ${MC.diffDays(t, p.raceDate)} ngày). Hãy đóng vai HLV chạy bộ, nhận xét và điều chỉnh giáo án tuần tới.
Hồ sơ: ${p.sex === 'female' ? 'nữ' : 'nam'}, ${p.age} tuổi, ${p.weight} kg, nhịp nghỉ ${p.restHR}, HRmax ${p.maxHR}. Mục tiêu: ${p.goalTime || 'hoàn thành'}.
VDOT ${fit.vdot.toFixed(1)} -> dự đoán FM ${MC.fmtTime(fit.predicted)}; pace MP tập ${MC.fmtPace(fit.trainingMP)}/km.
Tải: CTL ${L.ctl.toFixed(0)}, ATL ${L.atl.toFixed(0)}, TSB ${L.tsb.toFixed(0)}. Độ sẵn sàng: ${ready.score ?? 'N/A'} (${ready.reasons.join('; ')}).
Km/tuần 6 tuần gần nhất: ${wk}.
Buổi tập 14 ngày qua:\n${recent || '(không có)'}
Giáo án 7 ngày tới:\n${next}`;
    navigator.clipboard ? navigator.clipboard.writeText(txt).then(() => toast('Đã sao chép – dán vào Claude để được tư vấn'), () => download('bao-cao.txt', txt, 'text/plain')) : download('bao-cao.txt', txt, 'text/plain');
  }

  // ---------- Sự kiện ----------
  document.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('#tabs button');
    if (tabBtn) {
      document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b === tabBtn));
      document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + tabBtn.dataset.tab));
      try { localStorage.setItem(KEY + '-tab', tabBtn.dataset.tab); } catch (err) {}
      Object.values(charts).forEach((c) => c.resize());
      return;
    }
    const del = e.target.closest('[data-del-act]');
    if (del) { state.activities = state.activities.filter((a) => a.id !== del.dataset.delAct); save(); render(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    switch (act.dataset.act) {
      case 'create-plan': createPlan(); break;
      case 'save-profile': saveProfile(); render(); toast('Đã lưu hồ sơ'); break;
      case 'save-create': saveProfile(); createPlan(); break;
      case 'ics': exportICS(); break;
      case 'coach-report': coachReport(); break;
      case 'export': download('marathon-coach-backup-' + today() + '.json', JSON.stringify(Object.assign({ meta: { source: 'backup', generatedAt: new Date().toISOString() } }, state), null, 1), 'application/json'); break;
      case 'clear': if (confirm('Xoá toàn bộ dữ liệu trong trình duyệt?')) { localStorage.removeItem(KEY); state = load(); render(); } break;
      case 'load-sync':
        try {
          const r = await fetch('garmin_data.json', { cache: 'no-store' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          applyImport(MC.importJSON(await r.text()), 'garmin_data.json');
        } catch (err) { toast('Không tải được garmin_data.json (' + err.message + '). Hãy chạy script & mở app qua http://localhost:8000'); }
        break;
    }
  });

  window.addEventListener('load', () => render()); // vẽ lại khi Chart.js sẵn sàng
  render();
  try {
    const tab = localStorage.getItem(KEY + '-tab');
    if (tab) { const b = document.querySelector(`#tabs button[data-tab="${tab}"]`); if (b) b.click(); }
  } catch (e) {}
})();
