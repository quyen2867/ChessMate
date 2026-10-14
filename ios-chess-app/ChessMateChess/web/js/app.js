/**
 * ChessMate Chess App — standalone chess game with injected ChessMate engine features.
 * - Play vs Stockfish (WASM) with thinking modes, difficulty levels
 * - Top-3 MultiPV suggestions, eval bar, Vietnamese TTS
 * - Opening recognition, move history, undo, board flip
 */
import { EngineManager } from '../src/engine/engine-manager.js';
import { THINKING_MODES, getModeConfig } from '../src/engine/thinking-modes.js';
import { translateMoveToVietnamese, formatEvaluationVi } from '../src/utils/chess-translator.js';
import { identifyOpening } from '../src/ai/chess-book.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- state
const game = new Chess();
const engine = new EngineManager();

let playerColor = 'w';
let flipped = false;
let selected = null;          // square like 'e2'
let legalTargets = [];        // verbose moves from selected
let soundOn = true;
let difficulty = 'medium';
let modeKey = 'mate_hunt';
let positionToken = 0;        // invalidates stale engine callbacks
let engineBusy = false;
let lastHintKey = '';
let pendingPromo = null;      // {from,to}

const DIFFS = {
  easy:   { depth: 8,  skillLevel: 5,  movetime: 450,  label: 'Dễ' },
  medium: { depth: 12, skillLevel: 12, movetime: 900,  label: 'Vừa' },
  hard:   { depth: 16, skillLevel: 20, movetime: 1600, label: 'Khó' },
};

const GLYPHS = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const PROMO_GLYPHS = { q: '♕', r: '♖', b: '♗', n: '♘' };

// ---------------------------------------------------------------- helpers
function files() { return flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h']; }
function ranks() { return flipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1']; }

function uciHistory() {
  return game.history({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
}

function sideName(c) { return c === 'w' ? 'Trắng' : 'Đen'; }

function isPromotionMove(from, to) {
  const p = game.get(from);
  if (!p || p.type !== 'p') return false;
  const toRank = to[1];
  return (p.color === 'w' && toRank === '8') || (p.color === 'b' && toRank === '1');
}

// ---------------------------------------------------------------- audio / TTS
let viVoice = null;
function pickVoice() {
  try {
    const vs = speechSynthesis.getVoices();
    viVoice = vs.find(v => v.lang && v.lang.toLowerCase().startsWith('vi')) || null;
  } catch (_) {}
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
  // iOS unlock
  const unlock = () => { try { speechSynthesis.getVoices(); } catch (_) {} };
  window.addEventListener('touchend', unlock, { once: true });
  window.addEventListener('pointerdown', unlock, { once: true });
}

function speak(text) {
  if (!soundOn || !text || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'vi-VN';
    if (viVoice) u.voice = viVoice;
    u.rate = 1.0;
    speechSynthesis.speak(u);
  } catch (_) {}
}

let audioCtx = null;
function blip(freq = 520, dur = 0.07) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (_) {}
}

// ---------------------------------------------------------------- board render
const boardEl = $('board');
const arrowsEl = $('arrows');
let lastMoveSquares = [];

function squareColor(sq) {
  const f = 'abcdefgh'.indexOf(sq[0]);
  const r = parseInt(sq[1], 10);
  return (f + r) % 2 === 0 ? 'dark' : 'light';
}

function renderBoard() {
  boardEl.innerHTML = '';
  const b = game.board(); // b[0] = rank 8
  const fs = files(), rs = ranks();
  const kingSq = findKing(game.turn());

  for (let dr = 0; dr < 8; dr++) {
    for (let dc = 0; dc < 8; dc++) {
      const sq = fs[dc] + rs[dr];
      const f = 'abcdefgh'.indexOf(sq[0]);
      const rIdx = 8 - parseInt(sq[1], 10);
      const cell = b[rIdx][f];
      const d = document.createElement('div');
      d.className = `sq ${squareColor(sq)}`;
      d.dataset.sq = sq;
      if (lastMoveSquares.includes(sq)) d.classList.add('lastmove');
      if (selected === sq) d.classList.add('selected');
      if (kingSq === sq && game.in_check()) d.classList.add('incheck');

      if (cell) {
        const s = document.createElement('span');
        s.className = 'piece';
        s.textContent = GLYPHS[cell.color][cell.type];
        d.appendChild(s);
        d.classList.add(cell.color);
      }

      const tgt = legalTargets.find(m => m.to === sq);
      if (tgt) {
        const mark = document.createElement('span');
        mark.className = cell ? 'capture-ring' : 'dot';
        d.appendChild(mark);
      }

      // coordinates
      if (dc === 0) {
        const c = document.createElement('span');
        c.className = 'coord rank'; c.textContent = sq[1];
        d.appendChild(c);
      }
      if (dr === 7) {
        const c = document.createElement('span');
        c.className = 'coord file'; c.textContent = sq[0];
        d.appendChild(c);
      }

      d.addEventListener('click', () => onSquareTap(sq));
      boardEl.appendChild(d);
    }
  }
}

function findKing(color) {
  const b = game.board();
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const c = b[r][f];
      if (c && c.type === 'k' && c.color === color)
        return 'abcdefgh'[f] + (8 - r);
    }
  return null;
}

// --- arrows (SVG) ---
function sqToXY(sq) {
  const fs = files(), rs = ranks();
  const x = fs.indexOf(sq[0]) * 100 + 50;
  const y = rs.indexOf(sq[1]) * 100 + 50;
  return { x, y };
}
function drawArrow(from, to, color = '#f5a623') {
  arrowsEl.innerHTML = '';
  if (!from || !to) return;
  const a = sqToXY(from), b = sqToXY(to);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const ex = b.x - ux * 38, ey = b.y - uy * 38;
  const sx = a.x + ux * 20, sy = a.y + uy * 20;
  const px = -uy, py = ux;
  const head = 26;
  const pts = `${ex + ux * head},${ey + uy * head} ${ex + px * 16},${ey + py * 16} ${ex - px * 16},${ey - py * 16}`;
  arrowsEl.innerHTML =
    `<defs><marker id="ah" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto">` +
    `<polygon points="${pts}" fill="${color}" opacity="0.92"/></marker></defs>` +
    `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="17" ` +
    `stroke-linecap="round" opacity="0.85" marker-end="url(#ah)"/>`;
}
function clearArrow() { arrowsEl.innerHTML = ''; }

// ---------------------------------------------------------------- interaction
function onSquareTap(sq) {
  if (engineBusy || isGameOver()) return;
  if (game.turn() !== playerColor) return;

  // tapped a legal target -> move
  const tgt = legalTargets.find(m => m.to === sq);
  if (selected && tgt) {
    if (isPromotionMove(selected, sq)) {
      pendingPromo = { from: selected, to: sq };
      // glyph color follows player
      document.querySelectorAll('.promo-choices button').forEach(btn => {
        const p = btn.dataset.promo;
        btn.firstChild.textContent = playerColor === 'w' ? PROMO_GLYPHS[p] : { q:'♛',r:'♜',b:'♝',n:'♞' }[p];
      });
      $('promo-modal').classList.remove('hidden');
      return;
    }
    doPlayerMove(selected, sq, undefined);
    return;
  }

  const piece = game.get(sq);
  if (piece && piece.color === playerColor) {
    if (selected === sq) {
      selected = null; legalTargets = [];
    } else {
      selected = sq;
      legalTargets = game.moves({ square: sq, verbose: true });
      blip(660, 0.05);
    }
    clearArrow();
    renderBoard();
  } else {
    selected = null; legalTargets = [];
    renderBoard();
  }
}

document.querySelectorAll('.promo-choices button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!pendingPromo) return;
    const { from, to } = pendingPromo;
    pendingPromo = null;
    $('promo-modal').classList.add('hidden');
    doPlayerMove(from, to, btn.dataset.promo);
  });
});

function doPlayerMove(from, to, promotion) {
  const mv = game.move({ from, to, promotion });
  if (!mv) return;
  selected = null; legalTargets = [];
  clearArrow();
  blip(520, 0.07);
  positionToken++;
  onPositionChanged();
}

// ---------------------------------------------------------------- engine flow
function engineConfig() {
  const d = DIFFS[difficulty];
  return { depth: d.depth, movetime: d.movetime, skillLevel: d.skill, thinkingMode: modeKey };
}

function setThinking(on, text) {
  $('thinking').classList.toggle('hidden', !on);
  if (text) $('thinking-text').textContent = text;
  engineBusy = on;
}

async function onPositionChanged() {
  renderAll();
  const over = gameOverInfo();
  if (over) { showResult(over); return; }
  $('result').classList.add('hidden');

  if (game.turn() !== playerColor) {
    await engineMove();
    if (gameOverInfo()) { renderAll(); showResult(gameOverInfo()); return; }
  }
  await updateHints(true);
}

async function engineMove() {
  const token = positionToken;
  setThinking(true, 'Máy đang nghĩ…');
  try {
    const res = await engine.getBestMove(game.fen(), engineConfig());
    if (token !== positionToken) return; // stale
    if (res && res.move) {
      showCandidates(res.candidates, game.fen(), 'Máy chọn');
      const u = res.move;
      game.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      lastMoveSquares = [u.slice(0, 2), u.slice(2, 4)];
      blip(440, 0.08);
      positionToken++;
    }
  } catch (e) {
    console.warn('[ChessMate] engine move failed:', e.message);
  } finally {
    setThinking(false);
    renderAll();
  }
}

async function updateHints(speakFirst) {
  const token = positionToken;
  if (isGameOver()) return;
  setThinking(true, 'Đang phân tích…');
  try {
    const res = await engine.getBestMove(game.fen(), engineConfig());
    if (token !== positionToken) return; // stale
    if (res && res.candidates) {
      showCandidates(res.candidates, game.fen(), game.turn() === playerColor ? 'Gợi ý cho bạn' : 'Máy đang tính');
      updateEvalBar(res.candidates);
      if (speakFirst && game.turn() === playerColor && soundOn && res.candidates.length) {
        const c = res.candidates[0];
        const t = translateMoveToVietnamese(c.move, game.fen());
        const key = game.fen() + '|' + c.move;
        if (key !== lastHintKey) {
          lastHintKey = key;
          speak(`Gợi ý: ${t.title}. ${t.desc}`);
        }
      }
    }
  } catch (e) {
    console.warn('[ChessMate] hint analysis failed:', e.message);
  } finally {
    setThinking(false);
  }
}

// ---------------------------------------------------------------- UI: hints, eval, history, status
function evalToWhitePawns(c) {
  // candidate evaluation is from side-to-move perspective
  const turn = game.turn();
  let pawns;
  if (c.mateIn != null) {
    pawns = c.mateIn > 0 ? 999 : -999;
  } else if (typeof c.evaluation === 'string' && c.evaluation.startsWith('#')) {
    const m = parseInt(c.evaluation.slice(1), 10);
    pawns = m > 0 ? 999 : -999;
  } else {
    pawns = Number(c.evaluation) || 0;
  }
  return turn === 'w' ? pawns : -pawns;
}

function fmtEval(pawns) {
  if (Math.abs(pawns) >= 900) {
    const m = Math.abs(pawns) === 999 ? '' : '';
    return pawns > 0 ? 'Trắng chiếu hết' : 'Đen chiếu hết';
  }
  try { return formatEvaluationVi(pawns); }
  catch (_) { return pawns > 0 ? `Trắng +${pawns.toFixed(1)}` : pawns < 0 ? `Đen +${Math.abs(pawns).toFixed(1)}` : 'Cân bằng'; }
}

function updateEvalBar(candidates) {
  if (!candidates || !candidates.length) return;
  const pawns = evalToWhitePawns(candidates[0]);
  const clamped = Math.max(-1, Math.min(1, pawns / 8));
  const whitePct = 50 * (1 + clamped);
  $('evalbar-white').style.height = whitePct + '%';
  $('evalbar-black').style.height = (100 - whitePct) + '%';
  const label = $('evalbar-label');
  if (Math.abs(pawns) >= 900) {
    label.textContent = '#';
    label.style.color = pawns > 0 ? '#333' : '#eee';
  } else {
    label.textContent = Math.abs(pawns).toFixed(1);
    label.style.color = pawns >= 0 ? '#333' : '#eee';
  }
}

function showCandidates(candidates, fenBefore, caption) {
  const list = $('suggestion-list');
  list.innerHTML = '';
  if (!candidates || !candidates.length) {
    list.innerHTML = '<div class="suggestion empty">Chưa có gợi ý.</div>';
    return;
  }
  document.querySelector('#suggestions .section-title span').textContent = `Gợi ý nước đi — ${caption}`;
  candidates.slice(0, 3).forEach((c, i) => {
    const t = translateMoveToVietnamese(c.move, fenBefore);
    const pawns = evalToWhitePawns(c);
    const el = document.createElement('div');
    el.className = 'suggestion' + (i === 0 ? ' active' : '');
    el.innerHTML =
      `<div class="sug-head"><span class="sug-rank">${i + 1}</span>` +
      `<span class="sug-title">${t.title}</span>` +
      `<span class="sug-eval">${fmtEval(pawns)}</span></div>` +
      `<div class="sug-desc">${t.desc || ''}</div>`;
    el.addEventListener('click', () => {
      document.querySelectorAll('.suggestion').forEach(s => s.classList.remove('active'));
      el.classList.add('active');
      drawArrow(c.move.slice(0, 2), c.move.slice(2, 4));
      speak(`${t.title}. ${t.desc || ''}`);
      blip(700, 0.05);
    });
    list.appendChild(el);
  });
}

function renderHistory() {
  const ol = $('move-history');
  ol.innerHTML = '';
  const h = game.history();
  for (let i = 0; i < h.length; i += 2) {
    const li = document.createElement('li');
    const n = i / 2 + 1;
    li.textContent = `${n}. ${h[i]}${h[i + 1] ? '  ' + h[i + 1] : ''}`;
    ol.appendChild(li);
  }
  ol.scrollTop = ol.scrollHeight;
}

function renderStatus() {
  const turn = game.turn();
  const badge = $('turn-badge');
  const who = turn === playerColor ? ' (bạn)' : ' (máy)';
  badge.textContent = `${sideName(turn)} đi${who}`;
  badge.classList.toggle('black', turn === 'b');

  const op = identifyOpening(uciHistory());
  $('opening-name').textContent = op ? op.name : (game.history().length ? 'Khai cuộc tự do' : 'Ván cờ mới');
}

function renderAll() {
  renderBoard();
  renderHistory();
  renderStatus();
}

function isGameOver() { return !!gameOverInfo(); }

function gameOverInfo() {
  if (game.in_checkmate()) {
    const winner = game.turn() === 'w' ? 'b' : 'w';
    const youWin = winner === playerColor;
    return { text: youWin ? '🏆 Bạn thắng! Chiếu hết!' : '🤖 Máy thắng. Chiếu hết!', win: youWin };
  }
  if (game.in_stalemate()) return { text: '🤝 Hòa — Hết nước đi (stalemate).' };
  if (game.in_threefold_repetition()) return { text: '🤝 Hòa — Lặp lại 3 lần.' };
  if (game.insufficient_material()) return { text: '🤝 Hòa — Không đủ quân chiếu hết.' };
  if (game.in_draw()) return { text: '🤝 Hòa — Luật 50 nước.' };
  return null;
}

function showResult(info) {
  const el = $('result');
  el.textContent = info.text;
  el.classList.remove('hidden');
  setThinking(false);
  if (info.win !== undefined) speak(info.text);
  blip(info.win ? 880 : 330, 0.25);
}

// ---------------------------------------------------------------- controls
function newGame() {
  positionToken++;
  engine.stop();
  game.reset();
  selected = null; legalTargets = [];
  lastMoveSquares = [];
  lastHintKey = '';
  clearArrow();
  $('result').classList.add('hidden');
  $('suggestion-list').innerHTML = '<div class="suggestion empty">Ván mới bắt đầu. Chúc may mắn!</div>';
  updateEvalBar([{ evaluation: 0.2 }]);
  blip(600, 0.08);
  onPositionChanged();
}

function undoRound() {
  if (!game.history().length || engineBusy) return;
  positionToken++;
  engine.stop();
  clearArrow();
  game.undo();
  if (game.turn() !== playerColor && game.history().length) game.undo();
  selected = null; legalTargets = [];
  lastMoveSquares = [];
  lastHintKey = '';
  const h = game.history({ verbose: true });
  if (h.length) {
    const last = h[h.length - 1];
    lastMoveSquares = [last.from, last.to];
  }
  $('result').classList.add('hidden');
  blip(500, 0.06);
  onPositionChanged();
}

$('btn-new').addEventListener('click', newGame);
$('btn-undo').addEventListener('click', undoRound);
$('btn-flip').addEventListener('click', () => {
  flipped = !flipped;
  clearArrow();
  renderBoard();
  blip(600, 0.05);
});

$('btn-sound').addEventListener('click', () => {
  soundOn = !soundOn;
  $('btn-sound').classList.toggle('off', !soundOn);
  $('btn-sound').textContent = soundOn ? '🔊' : '🔇';
  if (!soundOn && 'speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (_) {} }
  if (soundOn) speak('Đã bật đọc gợi ý.');
});

$('btn-speak').addEventListener('click', () => {
  const cards = document.querySelectorAll('#suggestion-list .suggestion:not(.empty)');
  if (!cards.length) { speak('Chưa có gợi ý nào.'); return; }
  const texts = [];
  cards.forEach((el, i) => {
    const title = el.querySelector('.sug-title')?.textContent || '';
    const desc = el.querySelector('.sug-desc')?.textContent || '';
    texts.push(`Gợi ý ${i + 1}: ${title}. ${desc}`);
  });
  speak(texts.join(' '));
});

$('btn-hint').addEventListener('click', () => {
  if (isGameOver() || game.turn() !== playerColor) return;
  lastHintKey = ''; // force re-speak
  updateHints(true);
});

$('seg-color').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const c = btn.dataset.color;
  if (c === playerColor) return;
  document.querySelectorAll('#seg-color button').forEach(b => b.classList.toggle('active', b === btn));
  playerColor = c;
  flipped = (playerColor === 'b');
  newGame();
});

$('seg-diff').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#seg-diff button').forEach(b => b.classList.toggle('active', b === btn));
  difficulty = btn.dataset.diff;
  blip(700, 0.05);
});

// thinking modes
(function initModes() {
  const sel = $('sel-mode');
  Object.values(THINKING_MODES).forEach(m => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.name;
    sel.appendChild(o);
  });
  sel.value = modeKey;
  sel.addEventListener('change', () => {
    modeKey = sel.value;
    const cfg = getModeConfig(modeKey);
    speak(`Chế độ ${cfg.name}. ${cfg.description}`);
  });
})();

// ---------------------------------------------------------------- boot
renderAll();
updateEvalBar([{ evaluation: 0.2 }]);
// warm up engine in background
engine.getBestMove(game.fen(), { depth: 6, movetime: 200, skillLevel: 5, thinkingMode: 'balanced' })
  .catch(() => {})
  .finally(() => { if (!engineBusy) renderStatus(); });
