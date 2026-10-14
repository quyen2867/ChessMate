import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineManager } from '../src/engine/engine-manager.js';
import { evaluateMoveStrategy } from '../src/utils/board-evaluator.js';

// Regression test cho bug report 2026-10-14 ("t quân đen mà"):
// Khi nước đi mới đến lúc Stockfish vừa tính xong nước cũ, 'bestmove' cũ
// có thể resolve nhầm promise của lần phân tích mới -> HUD hiển thị nước đi
// của thế cờ cũ (ví dụ: gợi ý d2d3 trong khi ô d2 đã trống).

test('EngineManager discards stale bestmove after stop() during active search', () => {
  const engine = new EngineManager();
  // Giả lập engine đang search (có worker mock để stop() ghi nợ)
  engine.worker = { postMessage() {} };
  engine.isSearching = true;

  let resolvedValue = null;
  let rejected = false;
  engine.pending = {
    resolve: (v) => { resolvedValue = v; },
    reject: () => { rejected = true; }
  };

  // stop() khi đang search -> ghi nợ 1 stale bestmove
  engine.stop();
  assert.equal(engine.staleBestmoveDebt, 1, 'stop() during search must record stale-bestmove debt');
  assert.ok(rejected, 'pending promise must be rejected with Cancelled');

  // Đặt promise mới cho lần phân tích tiếp theo (mô phỏng getBestMove mới)
  let newResolved = null;
  engine.pending = {
    resolve: (v) => { newResolved = v; },
    reject: () => {}
  };
  engine.isSearching = true;

  // bestmove cũ đến trễ -> phải bị loại bỏ, KHÔNG resolve promise mới
  engine.handle('bestmove d2d3');
  assert.equal(engine.staleBestmoveDebt, 0, 'stale bestmove must consume the debt');
  assert.equal(newResolved, null, 'stale bestmove must NOT resolve the new promise');

  // bestmove thật của lần search mới -> được xử lý bình thường
  engine.pending = {
    resolve: (v) => { newResolved = v; },
    reject: () => {}
  };
  engine.isSearching = true;
  engine.handle('bestmove e7e5');
  assert.ok(newResolved, 'fresh bestmove must resolve the pending promise');
  assert.equal(newResolved.move, 'e7e5');
});

test('EngineManager does not record debt when stop() called while idle', () => {
  const engine = new EngineManager();
  engine.worker = { postMessage() {} };
  engine.isSearching = false;
  engine.stop();
  assert.equal(engine.staleBestmoveDebt, 0, 'no debt when engine was idle');

  // bestmove đến sau đó phải được xử lý bình thường
  let resolved = null;
  engine.pending = { resolve: (v) => { resolved = v; }, reject: () => {} };
  engine.isSearching = true;
  engine.handle('bestmove e2e4');
  assert.ok(resolved, 'bestmove must resolve when no debt');
  assert.equal(resolved.move, 'e2e4');
});

test('evaluateMoveStrategy never renders "undefined" for empty from-square', () => {
  // FEN sau 1.e4 c5 2.Bc4 Nc6 3.d3 (đen đi): ô d2 trống, tốt trắng ở d3.
  // Nếu engine (do race) trả về nước d2d3, UI không được hiện "undefined".
  const fen = 'r1bqkbnr/pp1ppppp/2n5/2p5/2B1P3/3P4/PPP2PPP/RNBQKBNR b KQkq - 0 1';
  const strat = evaluateMoveStrategy({ fen, uci: 'd2d3', evaluation: -0.2, userColor: 'b' });
  assert.ok(strat, 'strategy should be returned');
  assert.ok(!strat.advice.includes('undefined'), `advice must not contain "undefined": ${strat.advice}`);
});
