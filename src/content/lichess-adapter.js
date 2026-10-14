/**
 * Lichess.org adapter for ChessMate.
 *
 * Lichess renders boards with the chessground library:
 *   <div class="cg-wrap orientation-white|orientation-black">
 *     <cg-container><cg-board>
 *       <piece class="white pawn" style="transform: translate(Xpx, Ypx);">
 *       <square class="last-move" style="transform: translate(Xpx, Ypx);">
 *
 * The move list does NOT expose UCI (only SAN text), so FEN is tracked
 * incrementally: each board mutation is diffed to a single UCI move and
 * applied with applyUciMove (castling rights / en-passant stay correct).
 * The very first read (e.g. extension loaded mid-game) falls back to a
 * heuristic FEN built from the pieces + last-move highlight / clocks.
 */
import { applyUciMove } from '../utils/chess-translator.js';
import { isValidPlacement } from '../utils/chess-utils.js';
import { logger } from '../utils/logger.js';

const ROLE_CHAR = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
const ROLE_NAMES = Object.keys(ROLE_CHAR);

let trackedFen = null;
let trackedPlacement = null;

export function resetLichessState() {
  trackedFen = null;
  trackedPlacement = null;
}

export function isLichessSite(hostname = (typeof location !== 'undefined' ? location.hostname : '')) {
  return /(^|\.)lichess\.org$/.test(hostname || '');
}

export function findLichessBoard(root = document) {
  // Round page, analysis board, TV, puzzles — all use a single main cg-board.
  return root.querySelector('.round__app cg-board, main cg-board, cg-board') || null;
}

/** 'w' | 'b' — whose perspective the board is shown from. */
export function getLichessOrientation(cgBoard) {
  if (!cgBoard) return 'w';
  const wrap = cgBoard.closest('.cg-wrap');
  const cls = ((wrap && wrap.className) || '') + ' ' + (cgBoard.className || '');
  return cls.includes('orientation-black') ? 'b' : 'w';
}

function parseTranslatePx(transform) {
  const m = /translate\(\s*([\d.]+)px,\s*([\d.]+)px\s*\)/.exec(transform || '');
  if (!m) return null;
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

/**
 * Read pieces as board coordinates (a1 = file 0, rank 0), independent of
 * board orientation.
 */
export function readLichessPieces(cgBoard) {
  if (!cgBoard) return [];
  const rect = cgBoard.getBoundingClientRect();
  if (!rect.width) return [];
  const sq = rect.width / 8;
  const orientation = getLichessOrientation(cgBoard);
  const pieces = [];
  cgBoard.querySelectorAll('piece').forEach((el) => {
    const cls = (el.className || '').toLowerCase();
    const color = cls.includes('white') ? 'w' : cls.includes('black') ? 'b' : null;
    const role = ROLE_NAMES.find((r) => cls.includes(r));
    if (!color || !role) return;
    const pos = parseTranslatePx(el.style && el.style.transform);
    if (!pos) return;
    const colFromLeft = Math.round(pos.x / sq);
    const rowFromTop = Math.round(pos.y / sq);
    if (colFromLeft < 0 || colFromLeft > 7 || rowFromTop < 0 || rowFromTop > 7) return;
    const file = orientation === 'w' ? colFromLeft : 7 - colFromLeft;
    const rank = orientation === 'w' ? 7 - rowFromTop : rowFromTop;
    pieces.push({ color, role, file, rank });
  });
  return pieces;
}

export function placementFromPieces(pieces) {
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const pc of pieces) {
    if (pc.file < 0 || pc.file > 7 || pc.rank < 0 || pc.rank > 7) continue;
    const ch = ROLE_CHAR[pc.role] || 'p';
    grid[pc.rank][pc.file] = pc.color === 'w' ? ch.toUpperCase() : ch;
  }
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let s = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const cell = grid[r][f];
      if (!cell) { empty++; continue; }
      if (empty) { s += empty; empty = 0; }
      s += cell;
    }
    if (empty) s += empty;
    rows.push(s);
  }
  return rows.join('/');
}

export function gridFromPlacement(placement) {
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  const ranks = String(placement || '').split('/');
  for (let ri = 0; ri < 8 && ri < ranks.length; ri++) {
    let f = 0;
    for (const c of ranks[ri]) {
      if (/^[1-8]$/.test(c)) { f += Number(c); continue; }
      if (f < 8) grid[7 - ri][f] = c;
      f++;
    }
  }
  return grid;
}

/**
 * Given the previously tracked FEN + placement and the new placement,
 * find the single UCI move connecting them. Self-validating: a candidate
 * is accepted only if applyUciMove reproduces the new placement exactly.
 * Handles normal moves, captures, castling, en-passant and promotions.
 */
export function findMoveByDiff(prevFen, prevPlacement, currPlacement) {
  const prev = gridFromPlacement(prevPlacement);
  const curr = gridFromPlacement(currPlacement);
  const changed = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      if (prev[r][f] !== curr[r][f]) changed.push({ r, f, from: prev[r][f], to: curr[r][f] });
    }
  }
  if (!changed.length || changed.length > 4) return null;
  const sqName = ({ r, f }) => 'abcdefgh'[f] + (r + 1);
  const origins = changed.filter((s) => s.from);
  const dests = changed.filter((s) => s.to);
  for (const o of origins) {
    for (const d of dests) {
      if (o.r === d.r && o.f === d.f) continue;
      const base = sqName(o) + sqName(d);
      const isPromo = o.from.toLowerCase() === 'p' && (d.r === 0 || d.r === 7);
      const promos = isPromo ? ['q', 'r', 'b', 'n'] : [''];
      for (const pr of promos) {
        const nf = applyUciMove(prevFen, base + pr);
        if (nf && nf.split(' ')[0] === currPlacement) return base + pr;
      }
    }
  }
  return null;
}

function squareFromTranslate(transform, rect, orientation) {
  const pos = parseTranslatePx(transform);
  if (!pos || !rect.width) return null;
  const sq = rect.width / 8;
  const colFromLeft = Math.round(pos.x / sq);
  const rowFromTop = Math.round(pos.y / sq);
  if (colFromLeft < 0 || colFromLeft > 7 || rowFromTop < 0 || rowFromTop > 7) return null;
  return {
    file: orientation === 'w' ? colFromLeft : 7 - colFromLeft,
    rank: orientation === 'w' ? 7 - rowFromTop : rowFromTop,
  };
}

/** Turn = opposite of the color that just moved (from last-move highlight). */
function detectTurnFromLastMove(cgBoard, grid) {
  try {
    const rect = cgBoard.getBoundingClientRect();
    const orientation = getLichessOrientation(cgBoard);
    let movedColor = null;
    cgBoard.querySelectorAll('square.last-move').forEach((el) => {
      const sq = squareFromTranslate(el.style && el.style.transform, rect, orientation);
      if (!sq) return;
      const piece = grid[sq.rank] && grid[sq.rank][sq.file];
      if (piece) movedColor = piece === piece.toUpperCase() ? 'w' : 'b';
    });
    if (movedColor === 'w') return 'b';
    if (movedColor === 'b') return 'w';
  } catch (_) {}
  return null;
}

/** Turn from live-game clocks (round page): the running clock's side. */
function detectTurnFromClocks() {
  try {
    const clocks = [...document.querySelectorAll('.rclock, .clock')];
    for (const el of clocks) {
      const cls = (el.className || '').toLowerCase();
      const isTurn = cls.includes('rclock-turn') || cls.includes('running');
      if (!isTurn) continue;
      if (cls.includes('black')) return 'b';
      if (cls.includes('white')) return 'w';
      // Fallback: top clock belongs to the opponent of the bottom player.
      return null;
    }
  } catch (_) {}
  return null;
}

function countPliesFromMoveList() {
  try {
    const selectors = [
      '.analyse__moves .tview2 > move',
      '.rmoves move',
      'div.moves > move',
    ];
    for (const sel of selectors) {
      const n = document.querySelectorAll(sel).length;
      if (n > 0) return n;
    }
  } catch (_) {}
  return 0;
}

/**
 * First-read FEN when there is nothing tracked yet (extension loaded
 * mid-game, or diff failed). Castling rights are inferred from king/rook
 * home squares; en-passant is unknown ('-').
 */
export function heuristicFen(cgBoard, placement) {
  const grid = gridFromPlacement(placement);
  let turn = detectTurnFromLastMove(cgBoard, grid)
    || detectTurnFromClocks();
  const plies = countPliesFromMoveList();
  if (!turn && plies > 0) turn = plies % 2 === 0 ? 'w' : 'b';
  if (!turn) turn = 'w';

  let castling = '';
  if (grid[0][4] === 'K') {
    if (grid[0][7] === 'R') castling += 'K';
    if (grid[0][0] === 'R') castling += 'Q';
  }
  if (grid[7][4] === 'k') {
    if (grid[7][7] === 'r') castling += 'k';
    if (grid[7][0] === 'r') castling += 'q';
  }
  const fullmove = plies > 0 ? Math.floor(plies / 2) + 1 : 1;
  return `${placement} ${turn} ${castling || '-'} - 0 ${fullmove}`;
}

/**
 * Full FEN for the current lichess board. Prefers incremental tracking
 * (exact castling/ep/clocks); falls back to heuristic on first read.
 */
export function getLichessFEN(cgBoard) {
  const pieces = readLichessPieces(cgBoard);
  if (!pieces.length) return null;
  const placement = placementFromPieces(pieces);
  if (!isValidPlacement(placement)) return null;

  if (trackedFen && trackedPlacement && trackedPlacement !== placement) {
    const uci = findMoveByDiff(trackedFen, trackedPlacement, placement);
    if (uci) {
      const next = applyUciMove(trackedFen, uci);
      if (next && next.split(' ')[0] === placement) {
        trackedFen = next;
        trackedPlacement = placement;
        return next;
      }
    }
    logger.info('[ChessMate] Lichess diff failed, rebuilding FEN heuristically.');
    trackedFen = null;
  }

  if (!trackedFen || trackedPlacement !== placement) {
    trackedFen = heuristicFen(cgBoard, placement);
    trackedPlacement = placement;
  }
  return trackedFen;
}

/**
 * Click the right piece in lichess's promotion dialog (#promotion-choice).
 * Returns true when handled.
 */
export async function pickLichessPromotion(promoChar, userColor = 'w') {
  try {
    const dlg = document.querySelector('#promotion-choice');
    if (!dlg) return false;
    const roleNames = { q: 'queen', n: 'knight', r: 'rook', b: 'bishop' };
    const role = roleNames[(promoChar || 'q').toLowerCase()] || 'queen';
    const colorWord = userColor === 'b' ? 'black' : 'white';
    const pieceEl = dlg.querySelector(`piece.${colorWord}.${role}`)
      || [...dlg.querySelectorAll('piece')].find((el) => {
        const c = (el.className || '').toLowerCase();
        return c.includes(role) && c.includes(colorWord);
      });
    if (!pieceEl) return false;
    const target = pieceEl.closest('square') || pieceEl;
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true };
    target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    target.dispatchEvent(new MouseEvent('mousedown', { ...opts, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    target.dispatchEvent(new MouseEvent('mouseup', { ...opts, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    target.dispatchEvent(new MouseEvent('click', { ...opts, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Mutation observer for lichess boards — same event interface as
 * BoardObserver: 'move-detected' ({fen, previous, board}),
 * 'new-game' ({fen, reason}), 'turn-changed'.
 */
export class LichessObserver {
  constructor() {
    this.listeners = new Map();
    this.lastFEN = null;
    this.timer = null;
    this.observer = null;
    this.board = null;
    this.movesRoot = null;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  emit(event, data) {
    this.listeners.get(event)?.forEach((fn) => {
      try { fn(data); } catch (e) { logger.error(e); }
    });
  }

  getLastDiagnostic() {
    return this.board ? 'lichess cg-board tracked' : 'lichess board not found';
  }

  getCurrentFEN() {
    return getLichessFEN(this.board || findLichessBoard());
  }

  start(boardEl = null) {
    this.board = boardEl || findLichessBoard();
    if (!this.board) {
      let retries = 0;
      const retry = () => {
        this.board = findLichessBoard();
        if (this.board) this.initObserver();
        else if (retries++ < 8) setTimeout(retry, 150 * 2 ** retries);
      };
      setTimeout(retry, 150);
      return;
    }
    this.initObserver();
  }

  initObserver() {
    if (!this.board) return;
    this.stop();
    const schedule = () => {
      clearTimeout(this.timer);
      // 220ms: đủ để animation quân cờ hoàn tất trước khi đọc FEN
      this.timer = setTimeout(() => this.check(), 220);
    };
    this.observer = new MutationObserver(schedule);
    try {
      this.observer.observe(this.board, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style'],
      });
      // Move list changes too (round page / analysis)
      this.movesRoot = document.querySelector('.analyse__moves, .rmoves, div.moves');
      if (this.movesRoot) {
        this.observer.observe(this.movesRoot, { childList: true, subtree: true });
      }
    } catch (_) {}

    clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => this.check(), 650);
    setTimeout(() => this.check(true), 150);
  }

  check(force = false) {
    if (document.visibilityState === 'hidden') return;
    // Tương tự BoardObserver: bám lại board mới nếu element cũ bị thay.
    if (this.board && !this.board.isConnected) {
      const fresh = findLichessBoard();
      if (fresh && fresh !== this.board) {
        logger.info('[ChessMate] Lichess board element was replaced; re-attaching.');
        this.board = fresh;
        this.initObserver();
        this.emit('board-replaced', { board: fresh });
      } else {
        return;
      }
    }
    const fen = this.getCurrentFEN();
    if (!fen) return;
    if (!force && fen === this.lastFEN) return;

    const previous = this.lastFEN;
    this.lastFEN = fen;

    const START_POS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
    if (fen.startsWith(START_POS) && previous && !previous.startsWith(START_POS)) {
      this.emit('new-game', { fen, reason: 'start_position_reset' });
    }

    this.emit('move-detected', { fen, previous, board: this.board });
    this.emit('turn-changed', fen.split(' ')[1]);
  }

  forceCheck() {
    this.check(true);
  }

  reset() {
    this.lastFEN = null;
    resetLichessState();
    clearTimeout(this.timer);
  }

  stop() {
    this.observer?.disconnect();
    clearTimeout(this.timer);
    clearInterval(this.pollInterval);
    this.pollInterval = null;
    this.observer = null;
    this.movesRoot = null;
  }
}
