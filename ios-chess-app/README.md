# ChessMate Chess — App cờ vua iOS độc lập

> **Cách dùng chính (khuyên dùng): TIÊM vào app ChessMate có sẵn** — không tạo app mới.
> Xem mục "Tiêm vào app ChessMate (converter)" bên dưới.

App cờ vua **thật sự** cho iPhone/iPad: mở app là chơi ngay với máy (Stockfish),
không cần Safari, không cần extension. Toàn bộ tính năng phân tích của ChessMate
được "tiêm" thẳng vào app.

## Tiêm vào app ChessMate (converter) — không làm app mới

Dùng khi bạn đã có project `ChessMate` do `safari-web-extension-converter` tạo ra
(cái app mở lên chỉ hiện dòng "You can turn on ChessMate's Safari extension").
Cách này biến **chính app đó** thành app cờ vua thật, extension Safari vẫn giữ
nguyên chạy trong Safari.

Trên Mac, trong project ChessMate đã mở sẵn:

1. Kéo thư mục `ios-chess-app/ChessMateChess/web` từ repo vào khung Project
   navigator của Xcode, thả vào dưới app target:
   - Tick **"Copy items if needed"**
   - Chọn **"Create folder references"** (quang trọng: phải là folder xanh dương,
     không phải group vàng — để giữ nguyên cấu trúc thư mục)
   - Tick add vào **app target** (ChessMate, KHÔNG phải ChessMate Extension)
2. Mở file `ViewController.swift` của **app target** → xóa hết nội dung cũ →
   paste toàn bộ nội dung file `ios-chess-app/inject/ViewController.swift`
   (giữ nguyên tên class `ViewController` cho khớp storyboard).
3. **Cmd+R** để build & cài — mở app là chơi cờ ngay.
   Muốn file IPA: làm như cũ (Archive → lấy `.app` trong `.xcarchive` →
   thư mục `Payload` → zip → `.ipa` → ký bằng cert của bạn).

Xong: **một app duy nhất** — vừa là app cờ vua thật, vừa chứa Safari extension
dùng trong Safari như cũ.

## Phương án 2: project app độc lập

Nếu muốn app cờ vua tách riêng, mở `ios-chess-app/ChessMateChess.xcodeproj`
bằng Xcode → chọn Team → Cmd+R. (Xem chi tiết build ở phần dưới.)

## Tính năng

- ♟️ **Đánh cờ với máy** (Stockfish WASM chạy ngay trên máy, không cần mạng)
- 💡 **Top 3 gợi ý nước đi** mỗi lượt, diễn giải bằng **tiếng Việt tự nhiên**
- 📊 **Thanh eval bar** dọc cạnh bàn cờ
- 🔊 **Đọc gợi ý bằng giọng tiếng Việt** (bật/tắt)
- 🧠 **5 chế độ tư duy**: Đường Đi Ngắn Nhất, Săn Chiếu Hết, Phòng Thủ, Tấn Công, Cân Bằng
- 📖 **Nhận diện khai cuộc** (Ruy Lopez, Italian, Sicilian, French, Caro-Kann, …)
- 🎚️ **3 độ khó**: Dễ / Vừa / Khó — chọn cầm Trắng hay Đen
- ↩️ Đi lại (undo), ↔️ xoay bàn cờ, 📜 lịch sử ván cờ, ♛ chọn quân phong cấp
- Chạm để chọn quân → chấm xanh hiện nước đi hợp lệ, chạm mũi tên gợi ý để xem trên bàn cờ

## Build & cài (trên Mac)

Yêu cầu: Xcode (bản mới), Apple ID (free cũng được).

```bash
git clone https://github.com/quyen2867/ChessMate.git
cd ChessMate/ios-chess-app
open ChessMateChess.xcodeproj
```

Trong Xcode:

1. Chọn target **ChessMateChess** → **Signing & Capabilities** → **Team**: chọn
   Apple ID của bạn. (Bundle Identifier mặc định `com.chessmate.chessapp`,
   đổi thành ID riêng nếu muốn.)
2. Cắm iPhone → chọn thiết bị trên thanh toolbar → **Cmd+R** để build & cài trực tiếp.
3. Muốn file **IPA** để ký bằng cert riêng: **Product → Archive**, rồi chuột phải
   vào archive → **Show in Finder** → chuột phải `.xcarchive` →
   **Show Package Contents** → `Products/Applications` → copy `ChessMateChess.app`
   vào thư mục tên `Payload` → nén lại → đổi đuôi thành `.ipa` → ký bằng cert
   của bạn rồi cài.

## Cấu trúc

```
ChessMateChess.xcodeproj/   Project Xcode (mở là build được ngay)
ChessMateChess/
  ChessMateChessApp.swift   Entry point SwiftUI
  ContentView.swift         WKWebView load web app bundle trong app
  web/
    index.html              Giao diện app
    css/style.css           Dark theme
    js/app.js               Logic game + UI (board, gợi ý, eval, TTS)
    vendor/chess.min.js     Luật cờ (chess.js 0.13.4)
    src/engine/             Stockfish WASM + EngineManager (tái dùng từ extension,
      stockfish.js/.wasm    đã gồm fix crash "RuntimeError: unreachable" v0.1.13)
    src/utils/              Dịch nước đi tiếng Việt, đánh giá thế cờ
    src/ai/                 Opening book + nhận diện khai cuộc
```

## Ghi chú kỹ thuật

- Engine chạy trong **Web Worker** riêng, giao tiếp UCI qua `EngineManager`
  (tái dùng nguyên si từ extension ChessMate, gồm cả cơ chế chờ `bestmove`
  sau `stop()` để tránh crash WASM).
- `chess.js` (MIT) lo luật cờ: nước đi hợp lệ, nhập thành, bắt tốt qua đường,
  phong cấp, chiếu/chiếu hết, hòa.
- Giọng đọc dùng **Web Speech API** (`vi-VN`) của iOS — không cần mạng.
- Lần đầu mở app engine mất vài giây để tải (file ~1.8MB).

## License

- App code: theo license của repo ChessMate.
- `vendor/chess.min.js`: MIT (joshgoebel/chess.js).
- `src/engine/stockfish.js` + `stockfish.wasm`: GPLv3 (Stockfish).
