import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLichessSite,
  placementFromPieces,
  gridFromPlacement,
  findMoveByDiff,
  heuristicFen,
} from '../src/content/lichess-adapter.js';

test('isLichessSite detects lichess hosts only', () => {
  assert.equal(isLichessSite('lichess.org'), true);
  assert.equal(isLichessSite('www.lichess.org'), true);
  assert.equal(isLichessSite('chess.com'), false);
  assert.equal(isLichessSite('fakelichess.org'), false);
  assert.equal(isLichessSite(''), false);
});

test('placementFromPieces serializes board coordinates', () => {
  const pieces = [
    { color: 'w', role: 'king', file: 4, rank: 0 },
    { color: 'b', role: 'king', file: 4, rank: 7 },
    { color: 'w', role: 'pawn', file: 4, rank: 3 },
    { color: 'b', role: 'rook', file: 0, rank: 7 },
  ];
  assert.equal(placementFromPieces(pieces), 'r3k3/8/8/8/4P3/8/8/4K3');
});

test('gridFromPlacement round-trips placementFromPieces', () => {
  const placement = 'r3k3/8/8/8/4P3/8/8/4K3';
  const grid = gridFromPlacement(placement);
  assert.equal(grid[3][4], 'P'); // e4
  assert.equal(grid[7][4], 'k'); // e8
  assert.equal(grid[0][4], 'K'); // e1
  assert.equal(grid[7][0], 'r'); // a8
  assert.equal(grid[4][4], null);
});

test('findMoveByDiff detects a normal pawn push', () => {
  const prevFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const prev = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  const curr = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
  assert.equal(findMoveByDiff(prevFen, prev, curr), 'e2e4');
});

test('findMoveByDiff detects a capture', () => {
  const prevFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
  const prev = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R';
  const curr = 'rnbqkbnr/pppp1ppp/8/4N3/4P3/8/PPPP1PPP/RNBQKB1R';
  assert.equal(findMoveByDiff(prevFen, prev, curr), 'f3e5');
});

test('findMoveByDiff detects kingside castling', () => {
  const prevFen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
  const prev = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R';
  const curr = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R4RK1';
  assert.equal(findMoveByDiff(prevFen, prev, curr), 'e1g1');
});

test('findMoveByDiff detects en passant', () => {
  const prevFen = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
  const prev = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR';
  const curr = 'rnbqkbnr/ppp1pppp/3P4/8/8/8/PPPP1PPP/RNBQKBNR';
  assert.equal(findMoveByDiff(prevFen, prev, curr), 'e5d6');
});

test('findMoveByDiff detects promotion', () => {
  const prevFen = '6k1/4P3/8/8/8/1K6/8/8 w - - 0 1';
  const prev = '6k1/4P3/8/8/8/1K6/8/8';
  const curr = '4Q1k1/8/8/8/8/1K6/8/8';
  assert.equal(findMoveByDiff(prevFen, prev, curr), 'e7e8q');
});

test('findMoveByDiff returns null when nothing changed or too chaotic', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const p = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  assert.equal(findMoveByDiff(fen, p, p), null);
  assert.equal(findMoveByDiff(fen, p, '8/8/8/8/8/8/8/8'), null);
});

test('heuristicFen infers castling rights from home squares', () => {
  const fen = heuristicFen(null, 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R');
  assert.equal(fen, 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
});

test('heuristicFen drops castling rights when pieces moved', () => {
  // Đen mất nhập thành cánh vua (xe h8 không còn), giữ cánh hậu (xe a8 còn)
  const fen = heuristicFen(null, 'r3k3/pppppppp/8/8/8/8/PPPPPPPP/R3K2R');
  assert.ok(fen.includes(' KQq '), fen);
});
