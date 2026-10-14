import { BoardObserver } from './board-observer.js';
import { findBoardElement, resetExtractorState, getUserColor } from './board-extractor.js';
import { Overlay } from './overlay.js';
import { ChatHUD } from './chat-hud.js';
import { executeMove } from './move-executor.js';
import { EngineManager } from '../engine/engine-manager.js';
import { getConfig, onChange } from '../storage/config-manager.js';
import { clearLlmCache } from '../ai/llm-client.js';
import { fenToBoard, squareToIndices, applyUciMove } from '../utils/chess-translator.js';
import { logger } from '../utils/logger.js';

const observer = new BoardObserver();
const engine = new EngineManager();
let config;
let overlay;
let chatHud;
let board;
let isAnalyzing = false;
let lastAnalyzedFEN = null;  // dedup: tránh phân tích cùng một FEN nhiều lần
let nextPendingFEN = null;   // queue: FEN mới nhất cần phân tích nếu FEN đến khi đang tính
let _analysisToken = 0;      // stale guard: hủy kết quả cũ nếu FEN thay đổi giữa chừng
let _lastChimeFen = null;    // chống rung chuông 2 lần trên cùng một FEN
let ponderState = null;      // { fen, promise, result } — kết quả tính trước cho nước đối thủ
let _audioCtx = null;
let _titleTimer = null;

// ---- Chuông báo khi đến lượt (WebAudio, không cần file âm thanh) ----
function ensureAudioCtx() {
  if (_audioCtx) return _audioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    _audioCtx = new AC();
  } catch (_) {
    return null;
  }
  return _audioCtx;
}

// Trình duyệt chặn âm thanh trước khi user tương tác — mở khóa ngay lần chạm/phím đầu tiên
['pointerdown', 'keydown', 'touchstart'].forEach(ev => {
  window.addEventListener(ev, () => {
    try { ensureAudioCtx()?.resume?.(); } catch (_) {}
  }, { once: true, passive: true });
});

function playTurnChime() {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    // Hai nốt C5 -> G5, nhẹ nhàng không giật mình
    [523.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t + i * 0.13;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.22);
    });
  } catch (_) {}
}

function flashTurnTitle() {
  try {
    if (document.title.startsWith('♟')) return;
    const orig = document.title;
    document.title = '♟ Đến lượt bạn! ' + orig;
    clearTimeout(_titleTimer);
    _titleTimer = setTimeout(() => {
      if (document.title.startsWith('♟')) document.title = orig;
    }, 8000);
  } catch (_) {}
}

function startNewGameSession(reason = 'manual') {
  logger.info(`[ChessMate] Starting new game session (${reason})`);
  _analysisToken++;
  engine.stop();
  overlay?.clear();
  lastAnalyzedFEN = null;
  nextPendingFEN = null;
  ponderState = null;
  _lastChimeFen = null;
  observer.reset();
  resetExtractorState();
  chatHud?.reset();
  clearLlmCache();
}

async function waitForBoard(attempt = 0) {
  const el = findBoardElement();
  if (el) return el;
  if (attempt >= 12) return null;
  await new Promise(resolve => setTimeout(resolve, Math.min(3000, 150 * 1.5 ** attempt)));
  return waitForBoard(attempt + 1);
}

/**
 * Tính trước (ponder): khi đối thủ đang nghĩ, dùng nước "ponder" mà Stockfish
 * dự đoán để tính sẵn nước đáp trả cho thế cờ sau nước đó. Khi đối thủ đi đúng
 * nước dự đoán, kết quả có sẵn ngay lập tức — không phải chờ engine chạy lại.
 */
function maybeStartPonder(fen, best, isMyTurn) {
  ponderState = null;
  if (isMyTurn) return;
  if (config?.ponder === false) return;
  if (document.visibilityState === 'hidden') return;
  const ponderMove = best?.ponder;
  if (!ponderMove || ponderMove.length < 4) return;
  const ponderFen = applyUciMove(fen, ponderMove);
  if (!ponderFen) return;

  logger.info('[ChessMate] Pondering predicted reply:', ponderMove);
  const state = { fen: ponderFen, promise: null, result: null };
  ponderState = state;
  state.promise = engine.getBestMove(ponderFen, config)
    .then(result => {
      // Chỉ giữ cache nếu chưa bị thay thế bởi lần ponder mới hơn
      if (ponderState === state) {
        state.result = result;
        logger.info('[ChessMate] Ponder result cached.');
      }
    })
    .catch(() => {
      // Bị hủy vì đối thủ đi nước khác — đó là chuyện bình thường
      if (ponderState === state) ponderState = null;
    });
}

/**
 * Xử lý kết quả phân tích: cập nhật HUD, vẽ mũi tên, chuông báo lượt,
 * AutoPlay và khởi động ponder cho lượt đối thủ. Dùng chung cho cả
 * phân tích thường và kết quả tính trước (ponder hit).
 */
async function handleAnalysisResult(fen, best) {
  if (!config.enabled) {
    overlay?.clear();
    return;
  }

  const turn = fen.split(' ')[1] || 'w';
  const effectiveUserColor = chatHud?.sideOverride || getUserColor(board);

  // Determine the actual side of the recommended move from the piece at fromSq:
  let moveColor = turn;
  let fromPiece = null;
  if (best.move && best.move.length >= 4) {
    const fromSq = best.move.slice(0, 2).toLowerCase();
    const fromIdx = squareToIndices(fromSq);
    if (fromIdx) {
      const boardMatrix = fenToBoard(fen);
      fromPiece = boardMatrix?.[fromIdx.row]?.[fromIdx.col] || null;
      if (fromPiece) {
        moveColor = (fromPiece === fromPiece.toUpperCase()) ? 'w' : 'b';
      }
    }
  }

  // Stale guard: nước đi phải xuất phát từ một quân của bên đang đi.
  // - Nếu ô đi TRỐNG (fromPiece null): kết quả stale do race (nước của thế cờ
  //   cũ lọt vào promise của thế cờ mới) -> bỏ, phân tích lại.
  // - Nếu là lượt của user mà engine trả nước của đối phương -> bỏ, phân tích lại.
  if (!fromPiece || (turn === effectiveUserColor && moveColor !== effectiveUserColor)) {
    if (!fromPiece) {
      logger.warn(`[ChessMate] Discarded invalid engine move ${best.move}: from-square empty in current FEN (stale result). Triggering fresh analysis.`);
    } else {
      logger.info(`[ChessMate] Discarded stale opponent move (${best.move}) during user turn (${effectiveUserColor}). Triggering fresh analysis.`);
    }
    setTimeout(() => {
      if (!isAnalyzing) analyzeCurrentState();
    }, 100);
    return;
  }

  // It is ONLY our turn if turn matches user color AND the move belongs to user's side
  const isMyTurn = (turn === effectiveUserColor) && (moveColor === effectiveUserColor);

  // Chuông + nháy tiêu đề tab khi vừa chuyển sang lượt mình
  if (isMyTurn && config.turnChime !== false && fen !== _lastChimeFen) {
    playTurnChime();
    flashTurnTitle();
    _lastChimeFen = fen;
  }

  // Update Chat HUD with side, turn context, shortest path note and top candidates
  chatHud?.updateAnalysis({
    fen,
    uci: best.move,
    evaluation: best.evaluation,
    depth: config.depth,
    userColor: effectiveUserColor,
    isMyTurn,
    efficiencyNote: best.efficiencyNote,
    candidates: best.candidates || []
  });

  // Arrow overlay on board:
  // Only show green arrow when it is OUR turn!
  // When it's opponent's turn, clear overlay so user is not told to play opponent's piece!
  if (isMyTurn && config.showArrows !== false && config.showOverlay !== false) {
    overlay?.showArrow(best.move, best.evaluation, config.depth);
  } else {
    overlay?.clear();
  }

  if (isMyTurn && config.autoPlay) {
    await executeMove(board, best.move, config);
  }

  // Khi đối thủ đang nghĩ: tính trước nước đáp trả cho thế cờ dự đoán
  maybeStartPonder(fen, best, isMyTurn);
}

async function analyzeCurrentState(forcedFen = null, force = false) {
  if (!config?.enabled) {
    overlay?.clear();
    chatHud?.status('ChessMate: Đang tắt');
    return;
  }
  if (document.visibilityState === 'hidden') return;

  const fen = forcedFen || observer.getCurrentFEN();
  if (!fen) {
    const diag = observer.getLastDiagnostic() || 'Đang quét bàn cờ...';
    logger.info('Waiting for valid FEN:', diag);
    chatHud?.status(diag, true);

    setTimeout(() => {
      if (config?.enabled && !isAnalyzing) {
        const retryFen = observer.getCurrentFEN();
        if (retryFen && retryFen !== lastAnalyzedFEN) {
          analyzeCurrentState(retryFen);
        } else {
          const finalDiag = observer.getLastDiagnostic() || 'Bấm quét lại bàn cờ';
          chatHud?.status(`Quét: ${finalDiag}`);
        }
      }
    }, 600);
    return;
  }

  // Ponder HIT: đối thủ đi đúng nước đã dự đoán -> dùng kết quả tính trước ngay,
  // không cần chờ engine chạy lại từ đầu.
  if (!forcedFen && !force && ponderState && ponderState.fen === fen && ponderState.result) {
    const cached = ponderState.result;
    ponderState = null;
    lastAnalyzedFEN = fen;
    logger.info('[ChessMate] Ponder HIT — instant suggestion, no engine wait.');
    chatHud?.status('Có ngay nước đi (tính trước)!', false);
    await handleAnalysisResult(fen, cached);
    return;
  }
  // Ponder MISS hoặc ponder chưa xong: dọn cache (engine.stop trong getBestMove
  // sẽ tự hủy lần tính trước đang chạy dở nếu có)
  ponderState = null;

  // Bỏ qua nếu FEN giống hệt lần phân tích trước (tránh lặp do animation/DOM noise)
  // Ngoại lệ: khi force=true (user bấm phân tích lại / vừa bật AutoPlay giữa lượt),
  // vẫn phân tích để AutoPlay có cơ hội đi nước hiện tại.
  if (!force && !forcedFen && fen === lastAnalyzedFEN) {
    logger.info('[ChessMate] FEN unchanged, skipping analysis.');
    return;
  }

  // Nếu đang phân tích nước cũ mà nước đi mới đã xuất hiện: huỷ phân tích cũ và xếp hàng FEN mới
  if (isAnalyzing) {
    logger.info('[ChessMate] New move detected during active analysis. Aborting old for new FEN:', fen);
    engine.stop();
    nextPendingFEN = fen;
    return;
  }

  isAnalyzing = true;
  lastAnalyzedFEN = fen;  // đánh dấu FEN này đang/đã được phân tích
  const myToken = ++_analysisToken;  // stale guard token
  chatHud?.status('Đang suy nghĩ nước cờ...', true);

  // Xoá arrow cũ ngay lập tức để tránh gây nhầm lẫn khi đợi kết quả mới
  overlay?.clear();

  try {
    logger.info('Analyzing FEN:', fen, 'Mode:', config.thinkingMode);
    const best = await engine.getBestMove(fen, config);

    if (!config.enabled) {
      overlay?.clear();
      return;
    }

    // Stale guard: FEN đã thay đổi trong lúc Stockfish đang tính — bỏ kết quả này
    if (myToken !== _analysisToken) {
      logger.info('[ChessMate] Stale analysis result discarded (FEN changed).');
      return;
    }

    await handleAnalysisResult(fen, best);
  } catch (e) {
    if (e.message === 'Cancelled') {
      logger.info('[ChessMate] Previous engine analysis cancelled for newer board position.');
      return;
    }
    logger.warn('Analysis error:', e);
    chatHud?.status('Engine: ' + (e.message || 'Lỗi'));
  } finally {
    isAnalyzing = false;
    if (nextPendingFEN) {
      const queued = nextPendingFEN;
      nextPendingFEN = null;
      analyzeCurrentState(queued);
    }
  }
}

async function boot() {
  console.log('%c[ChessMate Agent]', 'color: #22c55e; font-weight: bold;', 'Content script booting on', window.location.href);
  config = await getConfig();

  // Initialize Chat HUD (Draggable, Minimizable, Unobtrusive)
  chatHud = new ChatHUD({
    onReanalyze: () => analyzeCurrentState(null, true),
    onNewGame: () => {
      startNewGameSession('user_manual_button');
      setTimeout(() => analyzeCurrentState(), 300);
    },
    onModeChange: (mode) => {
      config.thinkingMode = mode;
      analyzeCurrentState();
    }
  });
  // Pre-warm engine iframe runner for mobile / Safari / Orion support
  try {
    engine.ensureEngineIframe();
  } catch (_) {}

  chatHud.updateConfig(config);

  let unsubscribeMove = null;
  let unsubscribeNewGame = null;

  const initBoard = (b) => {
    if (!b) return;
    if (board === b) return;

    if (board) {
      logger.info('[ChessMate] Cleaning up previous board session before attaching new board');
      unsubscribeMove?.();
      unsubscribeNewGame?.();
      overlay?.destroy();
      startNewGameSession('board_replaced');
    }

    board = b;
    logger.info('Chess board successfully located:', board);
    overlay = new Overlay(board);

    unsubscribeMove = observer.on('move-detected', async ({ fen }) => {
      await analyzeCurrentState(fen);
    });

    unsubscribeNewGame = observer.on('new-game', ({ reason }) => {
      startNewGameSession(reason);
      setTimeout(() => analyzeCurrentState(), 300);
    });

    observer.start(board);

    if (config.enabled) {
      setTimeout(() => analyzeCurrentState(), 200);
    } else {
      chatHud.status('ChessMate: Đang tắt');
    }
  };

  const initialBoard = await waitForBoard();
  if (initialBoard) {
    initBoard(initialBoard);
  } else {
    logger.info('Board not found immediately, observing DOM for board appearance...');
    const bodyObserver = new MutationObserver(() => {
      const found = findBoardElement();
      if (found) {
        bodyObserver.disconnect();
        initBoard(found);
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Watch URL changes for new game sessions (SPA navigation on chess.com)
  let lastUrl = window.location.href;
  const checkUrl = () => {
    if (window.location.href !== lastUrl) {
      logger.info(`URL navigation detected from ${lastUrl} to ${window.location.href}`);
      lastUrl = window.location.href;
      startNewGameSession('url_change');
      const b = findBoardElement();
      if (b && b !== board) {
        initBoard(b);
      } else if (b) {
        setTimeout(() => analyzeCurrentState(), 500);
      }
    }
  };
  setInterval(checkUrl, 1000);
  window.addEventListener('popstate', checkUrl);

  onChange(next => {
    const wasDisabled = !config?.enabled;
    config = { ...config, ...next };
    chatHud?.updateConfig(config);

    if (!config.enabled) {
      overlay?.clear();
      lastAnalyzedFEN = null;  // reset khi tắt để khi bật lại sẽ phân tích mới
    } else if (wasDisabled && config.enabled) {
      lastAnalyzedFEN = null;  // force re-analyze khi bật lại
      analyzeCurrentState();
    }
  });

  chrome.runtime?.onMessage?.addListener((msg) => {
    if (msg?.type === 'reanalyze') {
      analyzeCurrentState(null, true);
    }
    if (msg?.type === 'new_game' || msg?.type === 'reset_session') {
      startNewGameSession('runtime_message');
      setTimeout(() => analyzeCurrentState(), 300);
    }
    if (msg?.type === 'show_hud') {
      chatHud?.show();
    }
  });
}

boot().catch(logger.error);
