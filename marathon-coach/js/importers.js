/* Marathon Coach – nhập dữ liệu: JSON (script đồng bộ Garmin / bản sao lưu), CSV Garmin Connect, TCX, GPX */
(function (root) {
  'use strict';
  const MC = root.MC;

  function num(x) {
    if (x == null) return 0;
    const n = parseFloat(String(x).replace(/,/g, '').replace(/[^\d.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }

  // ---------- CSV (Garmin Connect > Hoạt động > Xuất CSV) ----------
  function parseCSVText(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }
  function findCol(header, patterns) {
    const h = header.map((x) => x.trim().toLowerCase());
    for (const p of patterns) {
      const i = h.findIndex((x) => p.test(x));
      if (i >= 0) return i;
    }
    return -1;
  }
  function importGarminCSV(text) {
    const rows = parseCSVText(text.replace(/^﻿/, ''));
    if (rows.length < 2) throw new Error('CSV trống');
    const H = rows[0];
    const col = {
      type: findCol(H, [/^activity type$/, /loại hoạt động/, /type/]),
      date: findCol(H, [/^date$/, /^ngày/, /date/]),
      title: findCol(H, [/^title$/, /tiêu đề/, /name/]),
      dist: findCol(H, [/^distance$/, /khoảng cách/, /quãng đường/, /distance/]),
      cal: findCol(H, [/^calories$/, /calo/]),
      time: findCol(H, [/^time$/, /^thời gian$/, /moving time/, /elapsed/, /duration/]),
      avgHR: findCol(H, [/^avg hr$/, /nhịp tim trung bình/, /average heart rate/, /avg hr/]),
      maxHR: findCol(H, [/^max hr$/, /nhịp tim tối đa/, /max heart rate/]),
      cad: findCol(H, [/avg run cadence/, /nhịp bước trung bình/, /cadence/]),
      elev: findCol(H, [/total ascent/, /tổng độ cao/, /ascent/]),
      te: findCol(H, [/aerobic te/, /hiệu quả tập luyện hiếu khí/]),
      load: findCol(H, [/training stress|training load|tải tập luyện/]),
    };
    if (col.date < 0 || col.dist < 0) throw new Error('Không nhận ra cột Date/Distance trong CSV');
    const out = [];
    rows.slice(1).forEach((r, idx) => {
      const rawDate = (r[col.date] || '').trim();
      const d = new Date(rawDate.replace(' ', 'T'));
      if (isNaN(d)) return;
      let km = num(r[col.dist]);
      if (km > 300) km = km / 1000; // mét -> km
      out.push({
        id: 'csv-' + rawDate + '-' + idx,
        source: 'garmin-csv',
        date: MC.ymd(d),
        startTime: d.toISOString(),
        type: col.type >= 0 ? r[col.type] : 'Running',
        name: col.title >= 0 ? r[col.title] : '',
        distanceKm: km,
        durationSec: col.time >= 0 ? MC.parseTime(String(r[col.time]).split('.')[0]) || 0 : 0,
        avgHR: col.avgHR >= 0 ? num(r[col.avgHR]) : 0,
        maxHR: col.maxHR >= 0 ? num(r[col.maxHR]) : 0,
        calories: col.cal >= 0 ? num(r[col.cal]) : 0,
        cadence: col.cad >= 0 ? num(r[col.cad]) : 0,
        elevGain: col.elev >= 0 ? num(r[col.elev]) : 0,
        aerobicTE: col.te >= 0 ? num(r[col.te]) : 0,
        trainingLoad: col.load >= 0 ? num(r[col.load]) : 0,
      });
    });
    return { activities: out };
  }

  // ---------- TCX ----------
  function importTCX(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const acts = Array.from(doc.getElementsByTagNameNS('*', 'Activity'));
    return {
      activities: acts.map((a, i) => {
        const laps = Array.from(a.getElementsByTagNameNS('*', 'Lap'));
        let dist = 0, time = 0, hrSum = 0, hrMax = 0, cal = 0;
        laps.forEach((l) => {
          const g = (n) => { const e = l.getElementsByTagNameNS('*', n)[0]; return e ? num(e.textContent) : 0; };
          const t = g('TotalTimeSeconds');
          dist += g('DistanceMeters'); time += t; cal += g('Calories');
          const avg = l.getElementsByTagNameNS('*', 'AverageHeartRateBpm')[0];
          const mx = l.getElementsByTagNameNS('*', 'MaximumHeartRateBpm')[0];
          if (avg) hrSum += num(avg.textContent) * t;
          if (mx) hrMax = Math.max(hrMax, num(mx.textContent));
        });
        const idEl = a.getElementsByTagNameNS('*', 'Id')[0];
        const start = idEl ? idEl.textContent.trim() : laps[0] && laps[0].getAttribute('StartTime');
        return {
          id: 'tcx-' + start + '-' + i, source: 'tcx', date: MC.ymd(new Date(start)), startTime: start,
          type: a.getAttribute('Sport') || 'Running', distanceKm: dist / 1000, durationSec: time,
          avgHR: time ? Math.round(hrSum / time) : 0, maxHR: hrMax, calories: cal,
        };
      }),
    };
  }

  // ---------- GPX ----------
  function haversine(a, b) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function importGPX(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const pts = Array.from(doc.getElementsByTagNameNS('*', 'trkpt')).map((p) => {
      const t = p.getElementsByTagNameNS('*', 'time')[0];
      const hr = p.getElementsByTagNameNS('*', 'hr')[0];
      const ele = p.getElementsByTagNameNS('*', 'ele')[0];
      return { lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon'), time: t ? new Date(t.textContent) : null, hr: hr ? num(hr.textContent) : 0, ele: ele ? num(ele.textContent) : null };
    });
    if (pts.length < 2) throw new Error('GPX không có điểm track');
    let dist = 0, up = 0;
    const hrs = pts.map((p) => p.hr).filter((x) => x > 0);
    for (let i = 1; i < pts.length; i++) {
      dist += haversine(pts[i - 1], pts[i]);
      if (pts[i].ele != null && pts[i - 1].ele != null && pts[i].ele > pts[i - 1].ele) up += pts[i].ele - pts[i - 1].ele;
    }
    const t0 = pts[0].time, t1 = pts[pts.length - 1].time;
    const typeEl = doc.getElementsByTagNameNS('*', 'type')[0];
    const nameEl = doc.getElementsByTagNameNS('*', 'name')[0];
    return {
      activities: [{
        id: 'gpx-' + (t0 ? t0.toISOString() : Date.now()), source: 'gpx', date: MC.ymd(t0 || new Date()), startTime: t0 && t0.toISOString(),
        type: typeEl ? typeEl.textContent : 'running', name: nameEl ? nameEl.textContent : '',
        distanceKm: dist / 1000, durationSec: t0 && t1 ? (t1 - t0) / 1000 : 0,
        avgHR: hrs.length ? Math.round(hrs.reduce((s, x) => s + x, 0) / hrs.length) : 0,
        maxHR: hrs.length ? Math.max(...hrs) : 0, elevGain: Math.round(up),
      }],
    };
  }

  // ---------- JSON (garmin_sync.py hoặc bản sao lưu của app) ----------
  function importJSON(text) {
    const j = JSON.parse(text);
    return {
      activities: Array.isArray(j.activities) ? j.activities : [],
      wellness: Array.isArray(j.wellness) ? j.wellness : [],
      profile: j.profile || null,
      meta: j.meta || null,
    };
  }

  function importFile(name, text) {
    const n = name.toLowerCase();
    if (n.endsWith('.json')) return importJSON(text);
    if (n.endsWith('.csv')) return importGarminCSV(text);
    if (n.endsWith('.tcx')) return importTCX(text);
    if (n.endsWith('.gpx')) return importGPX(text);
    if (n.endsWith('.fit')) throw new Error('File .FIT là nhị phân: hãy dùng script garmin_sync.py hoặc xuất TCX/GPX/CSV từ Garmin Connect.');
    throw new Error('Định dạng chưa hỗ trợ: ' + name);
  }

  // Gộp dữ liệu, chống trùng (cùng id, hoặc cùng ngày + quãng đường gần bằng)
  function mergeActivities(existing, incoming) {
    const out = existing.slice();
    let added = 0;
    incoming.forEach((a) => {
      if (!a || !a.date) return;
      a.date = String(a.date).slice(0, 10);
      const dup = out.find((b) => b.id === a.id || (b.date === a.date && Math.abs((b.distanceKm || 0) - (a.distanceKm || 0)) < 0.15 && Math.abs((b.durationSec || 0) - (a.durationSec || 0)) < 120));
      if (dup) Object.assign(dup, a, { id: dup.id });
      else { out.push(a); added++; }
    });
    out.sort((x, y) => (x.date < y.date ? 1 : -1));
    return { list: out, added };
  }
  function mergeWellness(existing, incoming) {
    const map = {};
    existing.forEach((w) => (map[w.date] = w));
    let added = 0;
    incoming.forEach((w) => {
      if (!w || !w.date) return;
      const d = String(w.date).slice(0, 10);
      if (!map[d]) added++;
      const clean = {};
      Object.keys(w).forEach((k) => { if (w[k] != null && w[k] !== '') clean[k] = w[k]; });
      map[d] = Object.assign(map[d] || {}, clean, { date: d });
    });
    return { list: Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1)), added };
  }

  Object.assign(MC, { importFile, importGarminCSV, importTCX, importGPX, importJSON, mergeActivities, mergeWellness, parseCSVText });
})(typeof window !== 'undefined' ? window : globalThis);
