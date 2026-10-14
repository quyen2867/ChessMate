# ChessMate — bản app iOS (cài IPA)

Gói extension ChessMate thành **Safari Web Extension** nằm trong một app iOS,
cài trực tiếp vào iPhone qua Xcode (ký bằng Apple ID cá nhân, giống cách cài KTransit).

## Yêu cầu

- Mac có **Xcode** (tải free trên App Store)
- iPhone cắm cáp vào Mac, đã bật **Chế độ nhà phát triển** (Developer Mode)
- Apple ID đăng nhập trong Xcode (free cũng được — cert hết hạn sau 7 ngày, hết thì build lại)

## Các bước

### 1. Chuẩn bị thư mục extension cho Safari

Mở Terminal trên Mac:

```bash
git clone https://github.com/quyen2867/ChessMate.git
cd ChessMate
npm install
./scripts/prepare-safari.sh
```

Script sẽ build bản mới nhất và tạo thư mục `safari-extension/` (đã bỏ
permission `offscreen` vì Safari không có — code tự dùng iframe thay thế,
đúng như đường chạy trên Orion iOS).

### 2. Convert thành project Xcode

```bash
xcrun safari-web-extension-converter safari-extension \
  --app-name "ChessMate" \
  --ios-only
```

Xcode tự mở project vừa tạo (`ChessMate/`).

### 3. Ký và cài vào iPhone

1. Trong Xcode: chọn target **ChessMate** → tab **Signing & Capabilities** →
   Team: chọn Apple ID của bạn (làm tương tự cho target **ChessMate Extension**).
2. Cắm iPhone, chọn nó ở thanh device (thay vì Simulator).
3. Bấm **Cmd + R** — app cài thẳng vào iPhone.

**Muốn ra file IPA** (để cài bằng Sideloadly/AltStore hoặc giữ lại):
Product → Archive → Distribute App → **Ad Hoc** hoặc **Development** → Export ra `.ipa`.

### 4. Bật extension trong Safari

Trên iPhone: **Cài đặt → Safari → Phần mở rộng** → bật **ChessMate** →
mở chess.com hoặc lichess.org trong Safari → cấp quyền **Luôn cho phép**
cho 2 trang này.

### 5. Dùng

Mở ván cờ trên **Safari** (không phải Orion) → HUD gợi ý + đọc tiếng Việt
hiện như bản extension trên desktop. Vào popup extension (biểu tượng mảnh
ghép trên thanh địa chỉ) để chỉnh cấu hình.

## Lưu ý

- Cert Apple ID free hết hạn sau **7 ngày** → app không mở được nữa thì cắm
  máy build lại (mất 1 phút).
- Engine chạy trong iframe của extension (đường fallback iOS) — chỉ có đúng
  1 Stockfish, không bị crash như bản desktop cũ.
- Muốn dùng acc chính: chess.com cấm engine/auto-play, nên dùng **acc phụ**.
