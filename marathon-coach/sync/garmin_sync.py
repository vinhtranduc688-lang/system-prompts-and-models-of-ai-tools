#!/usr/bin/env python3
"""Đồng bộ dữ liệu Garmin Connect -> garmin_data.json cho Marathon Coach.

Lấy: hoạt động (chạy, đạp xe, gym...), nhịp tim nghỉ, HRV đêm, giấc ngủ, Body Battery,
stress, VO2max, Training Readiness, cân nặng, và một số thông tin hồ sơ.

Dùng thư viện không chính thức `garminconnect` (https://github.com/cyberjunky/python-garminconnect),
đăng nhập bằng tài khoản Garmin Connect của bạn. Token được lưu ở ~/.garminconnect để lần sau
không cần nhập lại mật khẩu. Dữ liệu chỉ được ghi ra máy của bạn.

Ví dụ:
    export GARMIN_EMAIL="ban@example.com"     # tuỳ chọn, nếu không sẽ hỏi
    python sync/garmin_sync.py --days 60
"""
from __future__ import annotations

import argparse
import datetime as dt
import getpass
import json
import os
import sys
import time
from pathlib import Path

try:
    from garminconnect import Garmin
except ImportError:  # pragma: no cover
    sys.exit("Thiếu thư viện: pip install -r sync/requirements.txt")

TOKEN_DIR = Path(os.environ.get("GARMINTOKENS", "~/.garminconnect")).expanduser()
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "garmin_data.json"


def login() -> Garmin:
    """Đăng nhập: thử token đã lưu trước, sau đó mới dùng email/mật khẩu (hỗ trợ MFA)."""
    if TOKEN_DIR.exists():
        try:
            api = Garmin()
            api.login(str(TOKEN_DIR))
            print("✓ Đăng nhập bằng token đã lưu")
            return api
        except Exception as exc:  # token hết hạn / lỗi
            print(f"Token không dùng được ({exc}), đăng nhập lại…")

    email = os.environ.get("GARMIN_EMAIL") or input("Email Garmin Connect: ").strip()
    password = os.environ.get("GARMIN_PASSWORD") or getpass.getpass("Mật khẩu: ")
    api = Garmin(email=email, password=password, return_on_mfa=True)
    result1, result2 = api.login()
    if result1 == "needs_mfa":
        code = input("Mã MFA (gửi qua email/app): ").strip()
        api.resume_login(result2, code)
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    api.garth.dump(str(TOKEN_DIR))
    print(f"✓ Đăng nhập thành công, token lưu tại {TOKEN_DIR}")
    return api


def safe(fn, *args, default=None):
    try:
        return fn(*args)
    except Exception as exc:  # API Garmin đôi khi trả lỗi cho ngày không có dữ liệu
        if os.environ.get("DEBUG"):
            print(f"  ! {getattr(fn, '__name__', fn)}{args}: {exc}")
        return default


def pick(d, *path, default=None):
    for p in path:
        if isinstance(d, list):
            d = d[0] if d else None
        if not isinstance(d, dict):
            return default
        d = d.get(p)
    return default if d is None else d


def fetch_activities(api: Garmin, start: dt.date, end: dt.date) -> list[dict]:
    raw = safe(api.get_activities_by_date, start.isoformat(), end.isoformat(), default=[]) or []
    out = []
    for a in raw:
        start_local = a.get("startTimeLocal") or a.get("startTimeGMT") or ""
        out.append({
            "id": f"garmin-{a.get('activityId')}",
            "source": "garmin",
            "date": start_local[:10],
            "startTime": start_local.replace(" ", "T"),
            "type": pick(a, "activityType", "typeKey", default="running"),
            "name": a.get("activityName") or "",
            "distanceKm": round((a.get("distance") or 0) / 1000, 3),
            "durationSec": round(a.get("movingDuration") or a.get("duration") or 0),
            "avgHR": round(a.get("averageHR") or 0),
            "maxHR": round(a.get("maxHR") or 0),
            "calories": round(a.get("calories") or 0),
            "elevGain": round(a.get("elevationGain") or 0),
            "cadence": round(a.get("averageRunningCadenceInStepsPerMinute") or 0),
            "aerobicTE": a.get("aerobicTrainingEffect") or 0,
            "anaerobicTE": a.get("anaerobicTrainingEffect") or 0,
            "trainingLoad": round(a.get("activityTrainingLoad") or 0, 1),
            "vo2max": a.get("vO2MaxValue") or 0,
        })
    return out


def fetch_day(api: Garmin, day: dt.date) -> dict:
    d = day.isoformat()
    rec: dict = {"date": d}

    stats = safe(api.get_stats, d, default={}) or {}
    rec["restHR"] = stats.get("restingHeartRate")
    rec["bodyBattery"] = stats.get("bodyBatteryHighestValue") or stats.get("bodyBatteryMostRecentValue")
    rec["stress"] = stats.get("averageStressLevel")
    rec["steps"] = stats.get("totalSteps")

    hrv = safe(api.get_hrv_data, d, default={}) or {}
    rec["hrv"] = pick(hrv, "hrvSummary", "lastNightAvg")
    rec["hrvStatus"] = pick(hrv, "hrvSummary", "status")

    sleep = safe(api.get_sleep_data, d, default={}) or {}
    secs = pick(sleep, "dailySleepDTO", "sleepTimeSeconds")
    rec["sleepHours"] = round(secs / 3600, 2) if secs else None
    rec["sleepScore"] = pick(sleep, "dailySleepDTO", "sleepScores", "overall", "value")

    mm = safe(api.get_max_metrics, d, default=None)
    rec["vo2max"] = pick(mm, "generic", "vo2MaxPreciseValue") or pick(mm, "generic", "vo2MaxValue")

    if hasattr(api, "get_training_readiness"):
        tr = safe(api.get_training_readiness, d, default=None)
        rec["trainingReadiness"] = pick(tr, "score")

    return {k: v for k, v in rec.items() if v not in (None, "", 0)}


def fetch_weights(api: Garmin, start: dt.date, end: dt.date) -> dict[str, float]:
    bc = safe(api.get_body_composition, start.isoformat(), end.isoformat(), default={}) or {}
    out = {}
    for w in bc.get("dateWeightList", []) or []:
        if w.get("weight") and w.get("calendarDate"):
            out[w["calendarDate"]] = round(w["weight"] / 1000, 1)
    return out


def fetch_profile(api: Garmin) -> dict:
    prof = safe(api.get_user_profile, default={}) or {}
    ud = prof.get("userData", {}) if isinstance(prof, dict) else {}
    out = {}
    if ud.get("weight"):
        out["weight"] = round(ud["weight"] / 1000, 1)
    if ud.get("height"):
        out["height"] = round(ud["height"])
    if ud.get("gender"):
        out["sex"] = "female" if str(ud["gender"]).upper().startswith("F") else "male"
    if ud.get("birthDate"):
        try:
            b = dt.date.fromisoformat(ud["birthDate"][:10])
            t = dt.date.today()
            out["age"] = t.year - b.year - ((t.month, t.day) < (b.month, b.day))
        except ValueError:
            pass
    if ud.get("lactateThresholdHeartRate"):
        out["lthr"] = ud["lactateThresholdHeartRate"]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=60, help="số ngày lấy dữ liệu (mặc định 60)")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="file JSON đầu ra")
    ap.add_argument("--no-wellness", action="store_true", help="chỉ lấy hoạt động (nhanh hơn)")
    args = ap.parse_args()

    api = login()
    end = dt.date.today()
    start = end - dt.timedelta(days=args.days - 1)

    print(f"→ Lấy hoạt động {start} → {end}…")
    activities = fetch_activities(api, start, end)
    print(f"  {len(activities)} hoạt động")

    wellness = []
    if not args.no_wellness:
        weights = fetch_weights(api, start, end)
        print(f"→ Lấy chỉ số sức khoẻ từng ngày ({args.days} ngày)…")
        for i in range(args.days):
            day = start + dt.timedelta(days=i)
            rec = fetch_day(api, day)
            if day.isoformat() in weights:
                rec["weight"] = weights[day.isoformat()]
            if len(rec) > 1:
                wellness.append(rec)
            print(f"  {day} {'✓' if len(rec) > 1 else '–'}", end="\r")
            time.sleep(0.3)  # tránh bị Garmin giới hạn tốc độ
        print(f"\n  {len(wellness)} ngày có dữ liệu")

    data = {
        "meta": {"source": "garmin_sync", "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
                 "range": [start.isoformat(), end.isoformat()]},
        "profile": fetch_profile(api),
        "activities": activities,
        "wellness": wellness,
    }
    rhr = [w["restHR"] for w in wellness[-14:] if w.get("restHR")]
    if rhr:
        data["profile"]["restHR"] = round(sum(rhr) / len(rhr))

    args.out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✓ Đã ghi {args.out}")
    print("  Mở app (python -m http.server 8000 trong thư mục marathon-coach) → tab Garmin → 'Tải garmin_data.json'")


if __name__ == "__main__":
    main()
