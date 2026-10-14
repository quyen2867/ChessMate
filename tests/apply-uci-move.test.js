import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUciMove } from '../src/utils/chess-translator.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('applyUciMove handles pawn double push with en-passant square', () => {
  assert.equal(
    applyUciMove(START, 'e2e4'),
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
  );
});

test('applyUciMove chains moves and flips clocks correctly', () => {
  const afterE4 = applyUciMove(START, 'e2e4');
  assert.equal(
    applyUciMove(afterE4, 'e7e5'),
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'
  );
});

test('applyUciMove handles knight move and halfmove clock', () => {
  assert.equal(
    applyUciMove(START, 'g1f3'),
    'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1'
  );
});

test('applyUciMove handles capture and resets halfmove clock', () => {
  const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  assert.equal(
    applyUciMove(fen, 'e4d5'),
    'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2'
  );
});

test('applyUciMove handles kingside castling', () => {
  const fen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
  assert.equal(
    applyUciMove(fen, 'e1g1'),
    'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R4RK1 b kq - 1 1'
  );
});

test('applyUciMove handles queenside castling', () => {
  const fen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
  assert.equal(
    applyUciMove(fen, 'e1c1'),
    'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/2KR3R b kq - 1 1'
  );
});

test('applyUciMove handles en passant capture', () => {
  const fen = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
  assert.equal(
    applyUciMove(fen, 'e5d6'),
    'rnbqkbnr/ppp1pppp/3P4/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3'
  );
});

test('applyUciMove handles promotion', () => {
  const fen = '8/2P5/8/8/8/1k6/8/4K3 w - - 0 1';
  assert.equal(
    applyUciMove(fen, 'c7c8q'),
    '2Q5/8/8/8/8/1k6/8/4K3 b - - 0 1'
  );
});

test('applyUciMove removes castling right when rook is captured on home square', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  assert.equal(
    applyUciMove(fen, 'a1a8'),
    'R3k2r/8/8/8/8/8/8/4K2R b Kk - 0 1'
  );
});

test('applyUciMove returns null for invalid input', () => {
  assert.equal(applyUciMove(START, 'e3e4'), null); // empty from-square
  assert.equal(applyUciMove('not-a-fen', 'e2e4'), null);
  assert.equal(applyUciMove(START, 'xx'), null);
});
