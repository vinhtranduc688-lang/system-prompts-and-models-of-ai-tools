# 🏃 Marathon Coach

Web app cá nhân để **theo dõi chỉ số từ đồng hồ Garmin**, rồi tự lập **giáo án chạy, bài sức mạnh và kế hoạch dinh dưỡng** cho mục tiêu Full Marathon (mặc định: **27/12/2026**).

Chạy hoàn toàn trên máy bạn: không cần server, không cần tài khoản. Dữ liệu nằm trong trình duyệt (localStorage).

## Tính năng

| Tab | Nội dung |
|---|---|
| 📊 **Tổng quan** | Đếm ngược, bài tập hôm nay, **độ sẵn sàng** (HRV, nhịp nghỉ, giấc ngủ, Body Battery, TSB), dinh dưỡng hôm nay, dự đoán thành tích, CTL/ATL/TSB, km theo tuần |
| 📅 **Giáo án** | Giáo án theo từng ngày đến ngày đua (Xây nền → Đỉnh → Taper 3 tuần → Tuần đua), pace theo VDOT, vùng nhịp tim, bài sức mạnh, tự đánh dấu buổi đã hoàn thành theo dữ liệu Garmin, **xuất lịch .ics** sang Google/Apple Calendar |
| 🍚 **Dinh dưỡng** | kcal, carb/đạm/béo, lượng nước theo từng ngày tập, gợi ý món Việt, lộ trình nạp carb & số gel cho ngày đua |
| ❤️ **Chỉ số** | Biểu đồ HRV/nhịp nghỉ, giấc ngủ/Body Battery, danh sách hoạt động, nhập tay |
| ⌚ **Garmin** | Đồng bộ qua script, hoặc kéo-thả file CSV/TCX/GPX/JSON, sao lưu dữ liệu |
| ⚙️ **Hồ sơ** | Chỉ số cơ thể, thành tích gần nhất, mục tiêu, số buổi/tuần |

Nút **"📋 Sao chép báo cáo cho HLV AI"** tạo bản tóm tắt (tải tập, độ sẵn sàng, các buổi gần đây, giáo án tuần tới) để dán vào Claude và hỏi điều chỉnh.

## Bắt đầu nhanh

```bash
cd marathon-coach
python3 -m http.server 8000      # rồi mở http://localhost:8000
```

(Có thể mở thẳng `index.html`, nhưng nút "Tải garmin_data.json" chỉ chạy khi mở qua `http://localhost`.)

1. **⚙️ Hồ sơ**: nhập cân nặng, nhịp tim nghỉ/tối đa, **thành tích gần nhất** (vd. HM 1:55:00), mục tiêu marathon, số buổi chạy/tuần.
2. **⌚ Garmin**: đồng bộ dữ liệu (xem dưới).
3. Bấm **Lưu & tạo giáo án**. Nếu có ≥ 6 buổi chạy trong 4 tuần gần nhất, app dùng dữ liệu thật để xác định khối lượng nền.
4. Mỗi sáng: đồng bộ → xem **Tổng quan** để biết bài hôm nay và có cần giảm tải không.

## Kết nối Garmin

Garmin chỉ cấp API chính thức (Connect Developer Program) cho doanh nghiệp được duyệt, nên có 2 cách:

### ① Script đồng bộ (khuyên dùng)

```bash
pip install -r sync/requirements.txt
python sync/garmin_sync.py --days 60     # lần đầu sẽ hỏi email/mật khẩu (+ MFA nếu bật)
```

Script dùng thư viện mã nguồn mở [`garminconnect`](https://github.com/cyberjunky/python-garminconnect) và ghi ra `garmin_data.json` gồm: hoạt động, nhịp nghỉ, HRV đêm, giấc ngủ, Body Battery, stress, VO2max, Training Readiness, cân nặng. Token đăng nhập lưu ở `~/.garminconnect`, mật khẩu không được lưu. Sau đó vào tab **Garmin** → **Tải garmin_data.json**.

Mẹo: đặt lịch chạy script mỗi sáng (cron / Task Scheduler) để chỉ cần mở app.

> Đây là thư viện không chính thức: nếu Garmin đổi cách đăng nhập, cập nhật bằng `pip install -U garminconnect`.

### ② Xuất file thủ công

- **CSV**: connect.garmin.com → Hoạt động → Tất cả hoạt động → *Xuất CSV*
- **TCX/GPX**: mở một hoạt động → ⚙️ → *Xuất sang TCX/GPX*

Kéo-thả vào tab Garmin. Dữ liệu trùng được tự gộp.

## Phương pháp

- **VDOT** (công thức Daniels–Gilbert) từ thành tích gần nhất → dự đoán thời gian và pace E / M / T / I. Không có thành tích thì ước từ VO2max Garmin.
- **Vùng tim** theo Karvonen (dựa trên nhịp tim dự trữ).
- **Tải tập**: TRIMP Banister từ nhịp tim → CTL (42 ngày), ATL (7 ngày), TSB = CTL − ATL.
- **Giáo án**: tăng khối lượng ≤ 10%/tuần, giảm tải mỗi tuần thứ 4, chạy dài tăng tối đa 3.5 km/tuần, giới hạn 32 km hoặc 3 giờ, taper 85% → 65% → tuần đua; 2 bài chất lượng/tuần (ngưỡng/VO2max luân phiên + pace marathon), 2 buổi sức mạnh.
- **Độ sẵn sàng**: so HRV / nhịp nghỉ hôm nay với trung bình 7 ngày, cộng giấc ngủ, Body Battery, TSB và Training Readiness của Garmin → gợi ý giữ, giảm hoặc thay bài.
- **Dinh dưỡng**: BMR Mifflin-St Jeor + năng lượng chạy (~1 kcal/kg/km); carb 4–9 g/kg tuỳ ngày (nạp carb 8–10 g/kg ở 2 ngày trước đua), đạm 1.6–1.8 g/kg, trong đua 60–90 g carb/giờ (khuyến nghị ACSM/IOC/ISSN).

> ⚠️ App chỉ hỗ trợ, không thay chẩn đoán y khoa. Đau kéo dài, đau ngực, chóng mặt → dừng tập và gặp bác sĩ.

## Cấu trúc

```
marathon-coach/
├── index.html, styles.css
├── js/calc.js        # VDOT, pace, vùng tim, TRIMP/CTL/ATL, độ sẵn sàng, dinh dưỡng
├── js/plan.js        # bộ tạo giáo án + điều chỉnh theo độ sẵn sàng
├── js/importers.js   # đọc JSON / CSV / TCX / GPX, gộp dữ liệu trùng
├── js/app.js         # giao diện
└── sync/garmin_sync.py
```

`garmin_data.json` (dữ liệu cá nhân) đã nằm trong `.gitignore`.
