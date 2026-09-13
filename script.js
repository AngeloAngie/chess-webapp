import {
  auth, db, onAuthStateChanged, signInAnonymously,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut,
  linkWithCredential, linkWithPopup, EmailAuthProvider,
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, addDoc, query, where, getDocs, orderBy, limit,
  arrayUnion, serverTimestamp, runTransaction,
} from './firebase-config.js';

// ==================== Chess engine (board, rules, move generation) ====================

const FILES = 'abcdefgh';
const PIECE_UNICODE = {
  w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' },
  b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' },
};

const PIECE_VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

const PST = {
  P: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  N: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  B: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  R: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  Q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  K: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

const DIRS = {
  bishop: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  rook: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  king: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
  knight: [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]],
};

function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function squareName(r, c) { return FILES[c] + (8 - r); }
function opposite(color) { return color === 'w' ? 'b' : 'w'; }

let pieceIdCounter = 0;
function nextPieceId() { return `p${pieceIdCounter++}`; }

function createInitialGame() {
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let c = 0; c < 8; c++) {
    board[0][c] = { type: back[c], color: 'b', id: nextPieceId() };
    board[1][c] = { type: 'P', color: 'b', id: nextPieceId() };
    board[6][c] = { type: 'P', color: 'w', id: nextPieceId() };
    board[7][c] = { type: back[c], color: 'w', id: nextPieceId() };
  }
  return {
    board,
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null, // {r, c} square a capturing pawn would land on
    history: [],
    capturedByWhite: [], // pieces white has captured (black pieces)
    capturedByBlack: [],
    moveLog: [],
  };
}

function cloneBoard(board) {
  return board.map((row) => row.map((p) => (p ? { ...p } : null)));
}

// Squares attacked by a piece at (r,c), ignoring pins/checks. Used for attack maps & castling checks.
function attackSquaresFor(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const { type, color } = piece;
  const squares = [];
  if (type === 'P') {
    const dir = color === 'w' ? -1 : 1;
    for (const dc of [-1, 1]) {
      const nr = r + dir, nc = c + dc;
      if (inBounds(nr, nc)) squares.push([nr, nc]);
    }
  } else if (type === 'N') {
    for (const [dr, dc] of DIRS.knight) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc)) squares.push([nr, nc]);
    }
  } else if (type === 'K') {
    for (const [dr, dc] of DIRS.king) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc)) squares.push([nr, nc]);
    }
  } else {
    const dirs = type === 'B' ? DIRS.bishop : type === 'R' ? DIRS.rook : [...DIRS.bishop, ...DIRS.rook];
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (inBounds(nr, nc)) {
        squares.push([nr, nc]);
        if (board[nr][nc]) break;
        nr += dr; nc += dc;
      }
    }
  }
  return squares;
}

function isSquareAttacked(board, r, c, byColor) {
  for (let rr = 0; rr < 8; rr++) {
    for (let cc = 0; cc < 8; cc++) {
      const piece = board[rr][cc];
      if (piece && piece.color === byColor) {
        const squares = attackSquaresFor(board, rr, cc);
        for (const [sr, sc] of squares) {
          if (sr === r && sc === c) return true;
        }
      }
    }
  }
  return false;
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'K' && p.color === color) return [r, c];
    }
  }
  return null;
}

// Pseudo-legal moves for a single piece (doesn't check own-king safety).
function pseudoMovesForPiece(game, r, c) {
  const { board } = game;
  const piece = board[r][c];
  if (!piece) return [];
  const { type, color } = piece;
  const moves = [];

  if (type === 'P') {
    const dir = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;
    const promoRow = color === 'w' ? 0 : 7;
    const oneR = r + dir;
    if (inBounds(oneR, c) && !board[oneR][c]) {
      moves.push({ to: [oneR, c], promotion: oneR === promoRow });
      const twoR = r + dir * 2;
      if (r === startRow && !board[twoR][c]) {
        moves.push({ to: [twoR, c], twoSquare: true });
      }
    }
    for (const dc of [-1, 1]) {
      const nr = r + dir, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr][nc];
      if (target && target.color !== color) {
        moves.push({ to: [nr, nc], capture: true, promotion: nr === promoRow });
      } else if (!target && game.enPassant && game.enPassant.r === nr && game.enPassant.c === nc) {
        moves.push({ to: [nr, nc], capture: true, enPassant: true });
      }
    }
  } else if (type === 'N' || type === 'K') {
    const dirs = type === 'N' ? DIRS.knight : DIRS.king;
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr][nc];
      if (!target) moves.push({ to: [nr, nc] });
      else if (target.color !== color) moves.push({ to: [nr, nc], capture: true });
    }
    if (type === 'K') {
      // Castling
      const rights = game.castling;
      const rank = color === 'w' ? 7 : 0;
      if (r === rank && c === 4 && !isSquareAttacked(board, rank, 4, opposite(color))) {
        const canK = color === 'w' ? rights.wK : rights.bK;
        const canQ = color === 'w' ? rights.wQ : rights.bQ;
        if (canK && !board[rank][5] && !board[rank][6] &&
            board[rank][7] && board[rank][7].type === 'R' && board[rank][7].color === color &&
            !isSquareAttacked(board, rank, 5, opposite(color)) &&
            !isSquareAttacked(board, rank, 6, opposite(color))) {
          moves.push({ to: [rank, 6], castle: 'K' });
        }
        if (canQ && !board[rank][3] && !board[rank][2] && !board[rank][1] &&
            board[rank][0] && board[rank][0].type === 'R' && board[rank][0].color === color &&
            !isSquareAttacked(board, rank, 3, opposite(color)) &&
            !isSquareAttacked(board, rank, 2, opposite(color))) {
          moves.push({ to: [rank, 2], castle: 'Q' });
        }
      }
    }
  } else {
    const dirs = type === 'B' ? DIRS.bishop : type === 'R' ? DIRS.rook : [...DIRS.bishop, ...DIRS.rook];
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (inBounds(nr, nc)) {
        const target = board[nr][nc];
        if (!target) {
          moves.push({ to: [nr, nc] });
        } else {
          if (target.color !== color) moves.push({ to: [nr, nc], capture: true });
          break;
        }
        nr += dr; nc += dc;
      }
    }
  }

  return moves.map((m) => ({ from: [r, c], piece, ...m }));
}

function applyMove(game, move) {
  const board = cloneBoard(game.board);
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = board[fr][fc];
  let captured = move.capture ? board[tr][tc] : null;

  if (move.enPassant) {
    const capR = piece.color === 'w' ? tr + 1 : tr - 1;
    captured = board[capR][tc];
    board[capR][tc] = null;
  }

  board[tr][tc] = piece;
  board[fr][fc] = null;

  if (move.promotion) {
    board[tr][tc] = { type: move.promoteTo || 'Q', color: piece.color, id: piece.id };
  }

  if (move.castle === 'K') {
    const rank = piece.color === 'w' ? 7 : 0;
    board[rank][5] = board[rank][7];
    board[rank][7] = null;
  } else if (move.castle === 'Q') {
    const rank = piece.color === 'w' ? 7 : 0;
    board[rank][3] = board[rank][0];
    board[rank][0] = null;
  }

  const castling = { ...game.castling };
  if (piece.type === 'K') {
    if (piece.color === 'w') { castling.wK = false; castling.wQ = false; }
    else { castling.bK = false; castling.bQ = false; }
  }
  if (piece.type === 'R') {
    if (fr === 7 && fc === 0) castling.wQ = false;
    if (fr === 7 && fc === 7) castling.wK = false;
    if (fr === 0 && fc === 0) castling.bQ = false;
    if (fr === 0 && fc === 7) castling.bK = false;
  }
  if (captured && captured.type === 'R') {
    if (tr === 7 && tc === 0) castling.wQ = false;
    if (tr === 7 && tc === 7) castling.wK = false;
    if (tr === 0 && tc === 0) castling.bQ = false;
    if (tr === 0 && tc === 7) castling.bK = false;
  }

  let enPassant = null;
  if (move.twoSquare) {
    enPassant = { r: (fr + tr) / 2, c: fc };
  }

  return { board, castling, enPassant, captured, piece };
}

// Legal moves for the side to move (or a specific square if given).
function generateLegalMoves(game, onlyR = null, onlyC = null) {
  const { board, turn } = game;
  const legal = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (onlyR !== null && (r !== onlyR || c !== onlyC)) continue;
      const piece = board[r][c];
      if (!piece || piece.color !== turn) continue;
      const pseudo = pseudoMovesForPiece(game, r, c);
      for (const move of pseudo) {
        const result = applyMove(game, move);
        const [kr, kc] = findKing(result.board, turn);
        if (!isSquareAttacked(result.board, kr, kc, opposite(turn))) {
          legal.push(move);
        }
      }
    }
  }
  return legal;
}

function isInCheck(game, color) {
  const [kr, kc] = findKing(game.board, color);
  return isSquareAttacked(game.board, kr, kc, opposite(color));
}

function toAlgebraic(game, move, legalMovesBefore) {
  const { piece } = move;
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  if (move.castle === 'K') return 'O-O';
  if (move.castle === 'Q') return 'O-O-O';

  let s = '';
  if (piece.type !== 'P') {
    s += piece.type;
    // Disambiguation
    const ambiguous = legalMovesBefore.filter((m) =>
      m.piece.type === piece.type && m.to[0] === tr && m.to[1] === tc &&
      !(m.from[0] === fr && m.from[1] === fc));
    if (ambiguous.length) {
      const sameFile = ambiguous.some((m) => m.from[1] === fc);
      const sameRank = ambiguous.some((m) => m.from[0] === fr);
      if (!sameFile) s += FILES[fc];
      else if (!sameRank) s += (8 - fr);
      else s += FILES[fc] + (8 - fr);
    }
  }
  const isCapture = move.capture;
  if (isCapture) {
    if (piece.type === 'P') s += FILES[fc];
    s += 'x';
  }
  s += squareName(tr, tc);
  if (move.promotion) s += '=' + (move.promoteTo || 'Q');
  return s;
}

// ==================== AI (minimax with alpha-beta) ====================

function evaluateBoard(board) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const pstIndex = p.color === 'w' ? r * 8 + c : (7 - r) * 8 + c;
      const value = PIECE_VALUE[p.type] + PST[p.type][pstIndex];
      score += p.color === 'w' ? value : -value;
    }
  }
  return score;
}

function orderMoves(moves) {
  return moves.slice().sort((a, b) => {
    const av = a.capture ? (PIECE_VALUE[a.captured?.type] || 0) : 0;
    const bv = b.capture ? (PIECE_VALUE[b.captured?.type] || 0) : 0;
    return bv - av;
  });
}

function minimax(game, depth, alpha, beta, maximizing) {
  const legal = generateLegalMoves(game);
  if (legal.length === 0) {
    if (isInCheck(game, game.turn)) {
      return maximizing ? -100000 - depth : 100000 + depth;
    }
    return 0; // stalemate
  }
  if (depth === 0) {
    return evaluateBoard(game.board);
  }

  const ordered = orderMoves(legal);
  if (maximizing) {
    let best = -Infinity;
    for (const move of ordered) {
      const nextGame = makeGameAfterMove(game, move);
      const val = minimax(nextGame, depth - 1, alpha, beta, false);
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of ordered) {
      const nextGame = makeGameAfterMove(game, move);
      const val = minimax(nextGame, depth - 1, alpha, beta, true);
      best = Math.min(best, val);
      beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function makeGameAfterMove(game, move) {
  const result = applyMove(game, move);
  return {
    board: result.board,
    turn: opposite(game.turn),
    castling: result.castling,
    enPassant: result.enPassant,
  };
}

function findBestMove(game, depth) {
  const legal = generateLegalMoves(game);
  if (!legal.length) return null;
  const ordered = orderMoves(legal);
  const maximizing = game.turn === 'w';
  let bestMove = ordered[0];
  let bestVal = maximizing ? -Infinity : Infinity;
  for (const move of ordered) {
    // Auto-queen promotion for AI search simplicity
    if (move.promotion) move.promoteTo = 'Q';
    const nextGame = makeGameAfterMove(game, move);
    const val = minimax(nextGame, depth - 1, -Infinity, Infinity, !maximizing);
    if (maximizing ? val > bestVal : val < bestVal) {
      bestVal = val;
      bestMove = move;
    }
  }
  return bestMove;
}

// ==================== Learn Mode: move quality analysis ====================

const PIECE_NAME_NL = {
  P: { name: 'pion', article: 'de' },
  N: { name: 'paard', article: 'het' },
  B: { name: 'loper', article: 'de' },
  R: { name: 'toren', article: 'de' },
  Q: { name: 'dame', article: 'de' },
  K: { name: 'koning', article: 'de' },
};

function pieceDesc(type, capitalize = false) {
  const { name, article } = PIECE_NAME_NL[type];
  const a = capitalize ? (article === 'de' ? 'De' : 'Het') : article;
  return `${a} ${name}`;
}

function sameMove(a, b) {
  return a.from[0] === b.from[0] && a.from[1] === b.from[1] &&
    a.to[0] === b.to[0] && a.to[1] === b.to[1] &&
    (a.promoteTo || 'Q') === (b.promoteTo || 'Q');
}

// Scores every legal reply to gameBefore from the mover's own perspective (positive = good for mover),
// looking one extra ply ahead so simple blunders (hanging pieces) are caught.
function analyzeMoveQuality(gameBefore, playedMove) {
  const mover = gameBefore.turn;
  const legalMoves = generateLegalMoves(gameBefore);
  let bestScore = -Infinity;
  let playedScore = null;
  for (const m of legalMoves) {
    if (m.promotion && !m.promoteTo) m.promoteTo = 'Q';
    const next = makeGameAfterMove(gameBefore, m);
    const raw = minimax(next, 1, -Infinity, Infinity, mover !== 'w');
    const score = mover === 'w' ? raw : -raw;
    if (score > bestScore) bestScore = score;
    if (sameMove(m, playedMove)) playedScore = score;
  }
  if (playedScore === null) playedScore = bestScore;
  const loss = Math.max(0, Math.round(bestScore - playedScore));
  return { loss, bestScore, playedScore };
}

function classifyLoss(loss) {
  if (loss <= 15) return { label: 'Sterke zet', cls: 'good' };
  if (loss <= 75) return { label: 'Oké zet', cls: 'ok' };
  return { label: 'Zwakke zet', cls: 'bad' };
}

// Best immediate reply for the side to move, evaluated only one ply deep (used to spot hanging pieces).
function findOpponentBestReply(afterMoveGame) {
  const oppLegal = generateLegalMoves(afterMoveGame);
  if (!oppLegal.length) return null;
  const maximizing = afterMoveGame.turn === 'w';
  let best = null;
  let bestVal = maximizing ? -Infinity : Infinity;
  for (const om of oppLegal) {
    if (om.promotion) om.promoteTo = om.promoteTo || 'Q';
    const val = evaluateBoard(applyMove(afterMoveGame, om).board);
    if (maximizing ? val > bestVal : val < bestVal) {
      bestVal = val;
      best = om;
    }
  }
  return best;
}

function explainMove(gameBefore, move, quality, plyNumber) {
  const afterMove = makeGameAfterMove(gameBefore, move);
  const oppReply = findOpponentBestReply(afterMove);

  if (quality.bestScore > 90000 && quality.loss > 300) {
    return 'Hier stond een mat op het bord die nu wordt gemist.';
  }

  if (oppReply && oppReply.capture) {
    const recapturesMovedPiece = oppReply.from[0] === move.to[0] && oppReply.from[1] === move.to[1];
    if (recapturesMovedPiece && quality.loss > 50) {
      return `${pieceDesc(move.piece.type, true)} staat nu onbeschermd op een aangevallen veld.`;
    }
    if (!recapturesMovedPiece && quality.loss > 50) {
      const capturedType = oppReply.enPassant ? 'P' : afterMove.board[oppReply.to[0]][oppReply.to[1]]?.type;
      if (capturedType) {
        return `Laat ${pieceDesc(capturedType)} onbeschermd staan.`;
      }
    }
  }

  if (move.capture) return 'Sterke zet — wint materiaal.';
  if (move.castle) return 'De koning staat veiliger na de rokade.';

  const isMinorPiece = move.piece.type === 'N' || move.piece.type === 'B';
  const fromBackRank = (move.piece.color === 'w' && move.from[0] === 7) || (move.piece.color === 'b' && move.from[0] === 0);
  if (isMinorPiece && fromBackRank && plyNumber <= 16) {
    return 'Sterke ontwikkelingszet.';
  }
  if (move.piece.type === 'P' && (move.to[1] === 3 || move.to[1] === 4) && plyNumber <= 10) {
    return 'Goede centrumzet.';
  }

  if (quality.loss <= 15) return 'Sterke, nauwkeurige zet.';
  if (quality.loss <= 75) return 'Prima zet, niets op aan te merken.';
  return 'Deze zet verzwakt de positie — let op onbeschermde stukken en het centrum.';
}

// ==================== Sound engine (synthesized, no audio files) ====================

let audioCtx = null;
let soundEnabled = true;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freq, startDelay, duration, { type = 'sine', volume = 0.18 } = {}) {
  if (!soundEnabled) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + startDelay;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function playClick({ freq = 1600, duration = 0.05, volume = 0.35, delay = 0 } = {}) {
  if (!soundEnabled) return;
  const ctx = getAudioCtx();
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 1.1;
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + delay;
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start(t0);
}

function playMoveSound() { playClick({ freq: 1400, duration: 0.06, volume: 0.3 }); }
function playCaptureSound() {
  playClick({ freq: 700, duration: 0.09, volume: 0.4 });
  playTone(180, 0.01, 0.12, { type: 'triangle', volume: 0.15 });
}
function playCastleSound() {
  playClick({ freq: 1400, duration: 0.05, volume: 0.3 });
  playClick({ freq: 1200, duration: 0.06, volume: 0.32, delay: 0.09 });
}
function playPromoteSound() {
  [523, 659, 784, 1046].forEach((f, i) => playTone(f, i * 0.08, 0.14, { type: 'sine', volume: 0.16 }));
}
function playCheckSound() {
  playTone(880, 0, 0.1, { type: 'square', volume: 0.14 });
  playTone(1046, 0.11, 0.14, { type: 'square', volume: 0.14 });
}
function playGameOverSound(result) {
  if (result === 'checkmate') {
    [660, 554, 440, 330].forEach((f, i) => playTone(f, i * 0.14, 0.22, { type: 'sawtooth', volume: 0.14 }));
  } else {
    [440, 440].forEach((f, i) => playTone(f, i * 0.18, 0.2, { type: 'sine', volume: 0.12 }));
  }
}

function setSoundEnabled(on) {
  soundEnabled = on;
  soundBtn.textContent = on ? '🔊' : '🔇';
  savePref('sound', on);
}

// ==================== Saved preferences (theme, sound, learn mode) ====================

const PREF_PREFIX = 'chess.';

function savePref(key, value) {
  try {
    localStorage.setItem(PREF_PREFIX + key, JSON.stringify(value));
  } catch (e) {
    // localStorage unavailable (private browsing, disabled storage, etc.) — ignore.
  }
}

function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem(PREF_PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

// ==================== UI wiring ====================

let game = createInitialGame();
let selected = null; // [r, c]
let legalForSelected = [];
let humanSide = 'w';
let mode = 'ai';
let aiDepth = 2;
let pendingPromotion = null;
let lastMove = null;
let gameOver = false;
let history = []; // stack of previous snapshots for undo
let redoStack = []; // stack of snapshots for redo
let learnMode = false;
let currentTheme = 'classic';

// Authentication state
let currentUser = null; // Firebase auth user (anonymous or real)
let currentUserProfile = null; // Firestore users/{uid} doc data, once loaded (null for guests)
let authReadyPromise = null;
let authMode = 'login'; // 'login' | 'register', which tab the auth modal is showing

// Online multiplayer state
let onlineGameId = null;
let onlineUnsubscribe = null;
let onlineMyColor = null; // 'w' or 'b'
let onlineAppliedMoveCount = 0;
let onlineStatus = 'idle'; // 'idle' | 'waiting' | 'active' | 'finished'
let onlineOpponentUid = null;
let onlineOpponentUsername = null;

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const moveListEl = document.getElementById('moveList');
const capturedByWhiteEl = document.getElementById('capturedByWhite');
const capturedByBlackEl = document.getElementById('capturedByBlack');
const promotionOverlay = document.getElementById('promotionOverlay');
const promotionChoices = document.getElementById('promotionChoices');
const modeSelect = document.getElementById('modeSelect');
const difficultySelect = document.getElementById('difficultySelect');
const difficultyWrap = document.getElementById('difficultyWrap');
const sideSelect = document.getElementById('sideSelect');
const themeSelect = document.getElementById('themeSelect');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const soundBtn = document.getElementById('soundBtn');
const learnModeToggle = document.getElementById('learnModeToggle');
const feedbackCard = document.getElementById('feedbackCard');
const feedbackBadge = document.getElementById('feedbackBadge');
const feedbackText = document.getElementById('feedbackText');
const onlinePanel = document.getElementById('onlinePanel');
const onlineIdle = document.getElementById('onlineIdle');
const onlineWaiting = document.getElementById('onlineWaiting');
const onlineConnected = document.getElementById('onlineConnected');
const onlineConnectedText = document.getElementById('onlineConnectedText');
const inviteLinkInput = document.getElementById('inviteLinkInput');
const createInviteBtn = document.getElementById('createInviteBtn');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const leaveOnlineBtn = document.getElementById('leaveOnlineBtn');
const authArea = document.getElementById('authArea');
const authStatusText = document.getElementById('authStatusText');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const authModal = document.getElementById('authModal');
const closeAuthModalBtn = document.getElementById('closeAuthModalBtn');
const authTabLogin = document.getElementById('authTabLogin');
const authTabRegister = document.getElementById('authTabRegister');
const authError = document.getElementById('authError');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const usernameModal = document.getElementById('usernameModal');
const usernameError = document.getElementById('usernameError');
const usernameInput = document.getElementById('usernameInput');
const usernameSubmitBtn = document.getElementById('usernameSubmitBtn');
const profileBtn = document.getElementById('profileBtn');
const profileModal = document.getElementById('profileModal');
const closeProfileBtn = document.getElementById('closeProfileBtn');
const profileUsername = document.getElementById('profileUsername');
const profileWins = document.getElementById('profileWins');
const profileLosses = document.getElementById('profileLosses');
const profileDraws = document.getElementById('profileDraws');
const profileMatchList = document.getElementById('profileMatchList');
const addFriendInput = document.getElementById('addFriendInput');
const addFriendBtn = document.getElementById('addFriendBtn');
const addFriendError = document.getElementById('addFriendError');
const friendsList = document.getElementById('friendsList');
const addOpponentFriendBtn = document.getElementById('addOpponentFriendBtn');
const replayModal = document.getElementById('replayModal');
const closeReplayBtn = document.getElementById('closeReplayBtn');
const replayTitle = document.getElementById('replayTitle');
const replayBoardEl = document.getElementById('replayBoard');
const replayPrevBtn = document.getElementById('replayPrevBtn');
const replayNextBtn = document.getElementById('replayNextBtn');
const replayPlyLabel = document.getElementById('replayPlyLabel');

let squareEls = [];
let piecesLayerEl = null;
let pieceTokenEls = new Map(); // piece id -> DOM element

function snapshotState() {
  return JSON.parse(JSON.stringify({
    board: game.board,
    turn: game.turn,
    castling: game.castling,
    enPassant: game.enPassant,
    capturedByWhite: game.capturedByWhite,
    capturedByBlack: game.capturedByBlack,
    moveLog: game.moveLog,
    lastMove,
  }));
}

function restoreSnapshot(snap) {
  game.board = snap.board;
  game.turn = snap.turn;
  game.castling = snap.castling;
  game.enPassant = snap.enPassant;
  game.capturedByWhite = snap.capturedByWhite;
  game.capturedByBlack = snap.capturedByBlack;
  game.moveLog = snap.moveLog;
  lastMove = snap.lastMove;
}

function initBoardDOM() {
  boardEl.innerHTML = '';
  const squaresLayer = document.createElement('div');
  squaresLayer.className = 'squares-layer';
  const piecesLayer = document.createElement('div');
  piecesLayer.className = 'pieces-layer';

  squareEls = [];
  for (let r = 0; r < 8; r++) {
    const rowEls = [];
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement('div');
      sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
      sq.dataset.r = r;
      sq.dataset.c = c;
      if (c === 7) {
        const label = document.createElement('span');
        label.className = 'file-label';
        label.textContent = 8 - r;
        sq.appendChild(label);
      }
      if (r === 7) {
        const label = document.createElement('span');
        label.className = 'rank-label';
        label.textContent = FILES[c];
        sq.appendChild(label);
      }
      sq.addEventListener('click', () => onSquareClick(r, c));
      squaresLayer.appendChild(sq);
      rowEls.push(sq);
    }
    squareEls.push(rowEls);
  }

  boardEl.appendChild(squaresLayer);
  boardEl.appendChild(piecesLayer);
  piecesLayerEl = piecesLayer;
  pieceTokenEls = new Map();
}

function positionToken(el, r, c, animate) {
  if (!animate) {
    el.classList.add('no-transition');
  }
  el.style.left = (c * 12.5) + '%';
  el.style.top = (r * 12.5) + '%';
  if (!animate) {
    void el.offsetWidth; // force reflow so the position applies before re-enabling transitions
    requestAnimationFrame(() => el.classList.remove('no-transition'));
  }
}

function createPieceToken(piece, r, c) {
  const el = document.createElement('div');
  el.className = 'piece-token ' + (piece.color === 'w' ? 'piece-white' : 'piece-black');
  el.textContent = PIECE_UNICODE[piece.color][piece.type];
  piecesLayerEl.appendChild(el);
  positionToken(el, r, c, false);
  pieceTokenEls.set(piece.id, el);
  return el;
}

function removePieceToken(id, animate) {
  const el = pieceTokenEls.get(id);
  if (!el) return;
  pieceTokenEls.delete(id);
  if (animate) {
    el.classList.add('captured-fx');
    setTimeout(() => el.remove(), 300);
  } else {
    el.remove();
  }
}

function syncPieceTokens(animate) {
  const seen = new Set();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = game.board[r][c];
      if (!piece) continue;
      seen.add(piece.id);
      let el = pieceTokenEls.get(piece.id);
      if (!el) {
        createPieceToken(piece, r, c);
      } else {
        const glyph = PIECE_UNICODE[piece.color][piece.type];
        const promoted = el.textContent !== glyph;
        el.textContent = glyph;
        positionToken(el, r, c, animate);
        if (promoted && animate) {
          el.classList.add('promote-pop');
          setTimeout(() => el.classList.remove('promote-pop'), 320);
        }
      }
    }
  }
  for (const id of Array.from(pieceTokenEls.keys())) {
    if (!seen.has(id)) removePieceToken(id, animate);
  }
}

function updateSquareHighlights() {
  const inCheckColor = isInCheck(game, game.turn) ? game.turn : null;
  const kingPos = inCheckColor ? findKing(game.board, inCheckColor) : null;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = squareEls[r][c];
      sq.classList.toggle('selected', !!(selected && selected[0] === r && selected[1] === c));
      sq.classList.toggle('last-move', !!(lastMove &&
        ((lastMove.from[0] === r && lastMove.from[1] === c) || (lastMove.to[0] === r && lastMove.to[1] === c))));
      sq.classList.toggle('in-check', !!(kingPos && kingPos[0] === r && kingPos[1] === c));
      const legalHere = legalForSelected.find((m) => m.to[0] === r && m.to[1] === c);
      sq.classList.toggle('legal-move', !!legalHere && !legalHere.capture);
      sq.classList.toggle('legal-capture', !!legalHere && !!legalHere.capture);
    }
  }
}

function renderBoard(animate = false) {
  syncPieceTokens(animate);
  updateSquareHighlights();
  renderCaptured();
  renderStatus();
}

function renderCaptured() {
  const materialDiff = (list, color) => list.reduce((sum, p) => sum + PIECE_VALUE[p.type], 0);
  const whiteGain = materialDiff(game.capturedByWhite) / 100;
  const blackGain = materialDiff(game.capturedByBlack) / 100;
  capturedByWhiteEl.textContent = game.capturedByWhite.map((p) => PIECE_UNICODE.b[p.type]).join(' ') +
    (whiteGain > blackGain ? `  (+${whiteGain - blackGain})` : '');
  capturedByBlackEl.textContent = game.capturedByBlack.map((p) => PIECE_UNICODE.w[p.type]).join(' ') +
    (blackGain > whiteGain ? `  (+${blackGain - whiteGain})` : '');
}

function renderStatus() {
  if (gameOver) return; // status already set by endgame handler
  const turnName = game.turn === 'w' ? 'White' : 'Black';
  if (isInCheck(game, game.turn)) {
    statusEl.textContent = `${turnName} is in check`;
  } else {
    statusEl.textContent = `${turnName} to move`;
  }
}

function renderMoveList() {
  moveListEl.innerHTML = '';
  for (let i = 0; i < game.moveLog.length; i += 2) {
    const li = document.createElement('li');
    const whiteMove = game.moveLog[i] || '';
    const blackMove = game.moveLog[i + 1] || '';
    li.textContent = blackMove ? `${whiteMove}   ${blackMove}` : whiteMove;
    moveListEl.appendChild(li);
  }
}

function onSquareClick(r, c) {
  if (gameOver || pendingPromotion) return;
  if (mode === 'ai' && game.turn !== humanSide) return;
  if (mode === 'online' && (onlineStatus !== 'active' || game.turn !== onlineMyColor)) return;

  const piece = game.board[r][c];

  if (selected) {
    const move = legalForSelected.find((m) => m.to[0] === r && m.to[1] === c);
    if (move) {
      performMove(move);
      return;
    }
    if (piece && piece.color === game.turn) {
      selected = [r, c];
      legalForSelected = generateLegalMoves(game, r, c);
      updateSquareHighlights();
      return;
    }
    selected = null;
    legalForSelected = [];
    updateSquareHighlights();
    return;
  }

  if (piece && piece.color === game.turn) {
    selected = [r, c];
    legalForSelected = generateLegalMoves(game, r, c);
    updateSquareHighlights();
  }
}

function performMove(move) {
  getAudioCtx(); // unlock audio on user gesture
  if (move.promotion) {
    pendingPromotion = move;
    showPromotionOverlay(move.piece.color);
    return;
  }
  if (mode === 'online') {
    submitOnlineMove(move);
  } else {
    finalizeMove(move);
  }
}

function showPromotionOverlay(color) {
  promotionChoices.innerHTML = '';
  for (const type of ['Q', 'R', 'B', 'N']) {
    const btn = document.createElement('button');
    btn.textContent = PIECE_UNICODE[color][type];
    btn.addEventListener('click', () => {
      const move = pendingPromotion;
      move.promoteTo = type;
      promotionOverlay.classList.add('hidden');
      pendingPromotion = null;
      if (mode === 'online') {
        submitOnlineMove(move);
      } else {
        finalizeMove(move);
      }
    });
    promotionChoices.appendChild(btn);
  }
  promotionOverlay.classList.remove('hidden');
}

function finalizeMove(move) {
  const legalBefore = generateLegalMoves(game);
  const gameBeforeMove = { board: game.board, turn: game.turn, castling: game.castling, enPassant: game.enPassant };
  const plyNumber = game.moveLog.length;

  history.push(snapshotState());
  redoStack = [];

  const result = applyMove(game, move);
  const mover = game.turn;

  game.board = result.board;
  game.castling = result.castling;
  game.enPassant = result.enPassant;
  game.turn = opposite(mover);

  if (result.captured) {
    if (mover === 'w') game.capturedByWhite.push(result.captured);
    else game.capturedByBlack.push(result.captured);
  }

  const nextLegal = generateLegalMoves(game);
  const inCheckNow = isInCheck(game, game.turn);
  let notation = toAlgebraic({ board: result.board }, move, legalBefore);
  const isCheckmate = nextLegal.length === 0 && inCheckNow;
  const isStalemate = nextLegal.length === 0 && !inCheckNow;
  if (isCheckmate) notation += '#';
  else if (inCheckNow) notation += '+';
  game.moveLog.push(notation);

  lastMove = move;
  selected = null;
  legalForSelected = [];

  renderMoveList();
  renderBoard(true);

  if (isCheckmate || isStalemate) {
    gameOver = true;
    if (isCheckmate) {
      const winner = mover === 'w' ? 'White' : 'Black';
      statusEl.textContent = `Checkmate — ${winner} wins`;
      playGameOverSound('checkmate');
    } else {
      statusEl.textContent = 'Stalemate — draw';
      playGameOverSound('stalemate');
    }
    if (mode === 'online') {
      markOnlineGameFinished(isCheckmate ? (mover === 'w' ? 'checkmate-w' : 'checkmate-b') : 'stalemate');
    }
  } else {
    playMoveSoundFor(move, result, inCheckNow);
  }

  if (learnMode) {
    showMoveFeedback(gameBeforeMove, move, plyNumber);
  } else {
    feedbackCard.classList.add('hidden');
  }

  if (!gameOver && mode === 'ai' && game.turn !== humanSide) {
    setTimeout(makeAiMove, 350);
  }
}

function showMoveFeedback(gameBeforeMove, move, plyNumber) {
  const quality = analyzeMoveQuality(gameBeforeMove, move);
  const { label, cls } = classifyLoss(quality.loss);
  const explanation = explainMove(gameBeforeMove, move, quality, plyNumber);
  const moverName = gameBeforeMove.turn === 'w' ? 'Wit' : 'Zwart';

  feedbackBadge.textContent = `${moverName}: ${label}`;
  feedbackBadge.className = 'feedback-badge ' + cls;
  feedbackText.textContent = explanation;
  feedbackCard.classList.remove('hidden');
}

function playMoveSoundFor(move, result, inCheckNow) {
  if (move.promotion) playPromoteSound();
  else if (move.castle) playCastleSound();
  else if (result.captured) playCaptureSound();
  else playMoveSound();
  if (inCheckNow) setTimeout(playCheckSound, 130);
}

function makeAiMove() {
  if (gameOver) return;
  const move = findBestMove(game, aiDepth);
  if (!move) return;
  if (move.promotion) move.promoteTo = move.promoteTo || 'Q';
  finalizeMove(move);
}

function resetLocalBoard() {
  game = createInitialGame();
  selected = null;
  legalForSelected = [];
  lastMove = null;
  gameOver = false;
  pendingPromotion = null;
  history = [];
  redoStack = [];
  promotionOverlay.classList.add('hidden');
  feedbackCard.classList.add('hidden');
  initBoardDOM();
  renderMoveList();
  renderBoard(false);
}

function newGame() {
  if (mode === 'online') {
    leaveOnlineGame();
    resetLocalBoard();
    showOnlineIdlePanel();
    return;
  }
  resetLocalBoard();
  if (mode === 'ai' && game.turn !== humanSide) {
    setTimeout(makeAiMove, 300);
  }
}

function undo() {
  if (mode === 'online' || pendingPromotion || !history.length) return;
  do {
    redoStack.push(snapshotState());
    restoreSnapshot(history.pop());
  } while (mode === 'ai' && game.turn !== humanSide && history.length);
  gameOver = false;
  selected = null;
  legalForSelected = [];
  feedbackCard.classList.add('hidden');
  renderMoveList();
  renderBoard(false);
}

function redo() {
  if (mode === 'online' || pendingPromotion || !redoStack.length) return;
  do {
    history.push(snapshotState());
    restoreSnapshot(redoStack.pop());
  } while (mode === 'ai' && game.turn !== humanSide && redoStack.length);
  gameOver = false;
  selected = null;
  legalForSelected = [];
  feedbackCard.classList.add('hidden');
  renderMoveList();
  renderBoard(false);
}

// ==================== Authentication ====================

const AUTH_ERROR_MESSAGES_NL = {
  'auth/invalid-email': 'Ongeldig e-mailadres.',
  'auth/user-not-found': 'Geen account gevonden met dit e-mailadres.',
  'auth/wrong-password': 'Onjuist wachtwoord.',
  'auth/invalid-credential': 'E-mailadres of wachtwoord is onjuist.',
  'auth/email-already-in-use': 'Dit e-mailadres is al in gebruik. Probeer in te loggen.',
  'auth/weak-password': 'Wachtwoord moet minstens 6 tekens zijn.',
  'auth/popup-closed-by-user': 'Google-login geannuleerd.',
  'auth/popup-blocked': 'Je browser blokkeerde het Google-inlogvenster. Sta pop-ups toe voor deze site en probeer opnieuw.',
  'auth/network-request-failed': 'Netwerkfout. Probeer het opnieuw.',
};

function authErrorMessage(e) {
  return AUTH_ERROR_MESSAGES_NL[e.code] || `Er ging iets mis (${e.code || e.message}). Probeer het opnieuw.`;
}

// Handles both real onAuthStateChanged events AND the direct result of a
// register/login/Google action. onAuthStateChanged does NOT reliably re-fire
// when linkWithCredential/linkWithPopup upgrades an anonymous user in place
// (same uid, so Firebase doesn't always treat it as a new "sign-in" event) —
// so register/login/Google handlers call this explicitly with their result
// rather than relying solely on the passive listener.
async function handleUserSignedIn(user) {
  currentUser = user;

  if (user.isAnonymous) {
    currentUserProfile = null;
    renderAuthUI();
    return;
  }

  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      currentUserProfile = snap.data();
      renderAuthUI();
    } else {
      currentUserProfile = null;
      renderAuthUI();
      openUsernameModal();
    }
  } catch (e) {
    console.error('Kon gebruikersprofiel niet laden', e);
    renderAuthUI();
  }
}

authReadyPromise = new Promise((resolve) => {
  let resolved = false;
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try {
        await signInAnonymously(auth);
      } catch (e) {
        console.error('Anoniem inloggen mislukt', e);
      }
      return;
    }

    if (!resolved) {
      resolved = true;
      resolve(user);
    }

    await handleUserSignedIn(user);
  });
});

function renderAuthUI() {
  if (!currentUser || currentUser.isAnonymous) {
    authStatusText.textContent = 'Gast';
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    profileBtn.classList.add('hidden');
  } else if (currentUserProfile) {
    authStatusText.textContent = currentUserProfile.username;
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    profileBtn.classList.remove('hidden');
  } else {
    authStatusText.textContent = currentUser.email || '…';
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    profileBtn.classList.add('hidden');
  }
}

function openAuthModal(initialTab) {
  setAuthTab(initialTab || 'login');
  authError.classList.add('hidden');
  authForm.reset();
  authModal.classList.remove('hidden');
}

function closeAuthModal() {
  authModal.classList.add('hidden');
}

function setAuthTab(tabMode) {
  authMode = tabMode;
  authTabLogin.classList.toggle('active', tabMode === 'login');
  authTabRegister.classList.toggle('active', tabMode === 'register');
  authSubmitBtn.textContent = tabMode === 'login' ? 'Inloggen' : 'Registreren';
  authPassword.autocomplete = tabMode === 'login' ? 'current-password' : 'new-password';
}

function showAuthError(message) {
  authError.textContent = message;
  authError.classList.remove('hidden');
}

async function registerWithEmail(email, password) {
  const current = auth.currentUser;
  try {
    if (current && current.isAnonymous) {
      const credential = EmailAuthProvider.credential(email, password);
      const result = await linkWithCredential(current, credential);
      return result.user;
    }
    const result = await createUserWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (e) {
    if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
      const result = await signInWithEmailAndPassword(auth, email, password);
      return result.user;
    }
    throw e;
  }
}

async function loginWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const current = auth.currentUser;
  try {
    if (current && current.isAnonymous) {
      const result = await linkWithPopup(current, provider);
      return result.user;
    }
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (e) {
    if (e.code === 'auth/credential-already-in-use') {
      const result = await signInWithPopup(auth, provider);
      return result.user;
    }
    throw e;
  }
}

async function isUsernameTaken(usernameLower) {
  const q = query(collection(db, 'users'), where('usernameLower', '==', usernameLower));
  const snaps = await getDocs(q);
  return !snaps.empty;
}

function openUsernameModal() {
  usernameError.classList.add('hidden');
  usernameInput.value = '';
  usernameModal.classList.remove('hidden');
}

function closeUsernameModal() {
  usernameModal.classList.add('hidden');
}

function showUsernameError(message) {
  usernameError.textContent = message;
  usernameError.classList.remove('hidden');
}

async function submitUsername() {
  const username = usernameInput.value.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    showUsernameError('3-20 tekens: letters, cijfers en _.');
    return;
  }
  const usernameLower = username.toLowerCase();
  usernameSubmitBtn.disabled = true;
  try {
    if (await isUsernameTaken(usernameLower)) {
      showUsernameError('Deze gebruikersnaam is al in gebruik.');
      return;
    }
    await setDoc(doc(db, 'users', currentUser.uid), {
      username,
      usernameLower,
      email: currentUser.email || null,
      createdAt: serverTimestamp(),
      stats: { wins: 0, losses: 0, draws: 0 },
    });
    currentUserProfile = { username, usernameLower, stats: { wins: 0, losses: 0, draws: 0 } };
    renderAuthUI();
    closeUsernameModal();
  } catch (e) {
    console.error('Kon gebruikersnaam niet opslaan', e);
    showUsernameError('Kon niet opslaan. Probeer het opnieuw.');
  } finally {
    usernameSubmitBtn.disabled = false;
  }
}

loginBtn.addEventListener('click', () => openAuthModal('login'));
closeAuthModalBtn.addEventListener('click', closeAuthModal);
authTabLogin.addEventListener('click', () => setAuthTab('login'));
authTabRegister.addEventListener('click', () => setAuthTab('register'));

authForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  authError.classList.add('hidden');
  authSubmitBtn.disabled = true;
  try {
    const user = authMode === 'login'
      ? await loginWithEmail(authEmail.value.trim(), authPassword.value)
      : await registerWithEmail(authEmail.value.trim(), authPassword.value);
    await handleUserSignedIn(user);
    closeAuthModal();
  } catch (e) {
    console.error('Auth error', e);
    showAuthError(authErrorMessage(e));
  } finally {
    authSubmitBtn.disabled = false;
  }
});

googleSignInBtn.addEventListener('click', async () => {
  authError.classList.add('hidden');
  googleSignInBtn.disabled = true;
  try {
    const user = await signInWithGoogle();
    await handleUserSignedIn(user);
    closeAuthModal();
  } catch (e) {
    console.error('Google sign-in error', e);
    showAuthError(authErrorMessage(e));
  } finally {
    googleSignInBtn.disabled = false;
  }
});

usernameSubmitBtn.addEventListener('click', submitUsername);
usernameInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') submitUsername();
});

logoutBtn.addEventListener('click', async () => {
  if (mode === 'online') {
    leaveOnlineGame();
    resetLocalBoard();
    showOnlineIdlePanel();
  }
  currentUserProfile = null;
  await signOut(auth);
});

// ==================== Profile, stats & match history ====================

const MATCH_LIST_LIMIT = 20;

function matchDate(entry) {
  if (!entry.createdAt || !entry.createdAt.toDate) return '';
  return entry.createdAt.toDate().toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

async function openProfileModal() {
  if (!currentUser || currentUser.isAnonymous || !currentUserProfile) return;
  profileUsername.textContent = currentUserProfile.username;
  profileWins.textContent = '…';
  profileLosses.textContent = '…';
  profileDraws.textContent = '…';
  profileMatchList.innerHTML = '';
  profileModal.classList.remove('hidden');

  friendsList.innerHTML = '';
  try {
    const entries = await fetchMatchHistory(currentUser.uid, MATCH_LIST_LIMIT);
    renderProfileStats(entries);
    renderMatchList(profileMatchList, entries);
    await loadAndRenderFriends();
  } catch (e) {
    console.error('Kon profiel niet laden', e);
  }
}

function closeProfileModal() {
  profileModal.classList.add('hidden');
}

async function fetchMatchHistory(uid, max) {
  const q = query(
    collection(db, 'users', uid, 'appliedGames'),
    orderBy('createdAt', 'desc'),
    limit(max)
  );
  const snaps = await getDocs(q);
  return snaps.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function renderProfileStats(entries) {
  const wins = entries.filter((e) => e.result === 'win').length;
  const losses = entries.filter((e) => e.result === 'loss').length;
  const draws = entries.filter((e) => e.result === 'draw').length;
  profileWins.textContent = wins;
  profileLosses.textContent = losses;
  profileDraws.textContent = draws;
}

function renderMatchList(listEl, entries) {
  listEl.innerHTML = '';
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'match-row';
    li.textContent = 'Nog geen online partijen gespeeld.';
    listEl.appendChild(li);
    return;
  }
  const resultLabelNL = { win: 'Gewonnen', loss: 'Verloren', draw: 'Gelijk' };
  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'match-row';

    const badge = document.createElement('span');
    badge.className = 'match-result-badge ' + entry.result;
    badge.textContent = resultLabelNL[entry.result] || entry.result;

    const opponent = document.createElement('span');
    opponent.className = 'match-opponent';
    opponent.textContent = `vs ${entry.opponentUsername}`;

    const date = document.createElement('span');
    date.className = 'match-date';
    date.textContent = matchDate(entry);

    const viewBtn = document.createElement('button');
    viewBtn.textContent = 'Bekijk';
    viewBtn.addEventListener('click', () => openReplay(entry));

    li.append(badge, opponent, date, viewBtn);
    listEl.appendChild(li);
  }
}

profileBtn.addEventListener('click', openProfileModal);
closeProfileBtn.addEventListener('click', closeProfileModal);

// ==================== Friends ====================

async function findUserByUsername(username) {
  const q = query(collection(db, 'users'), where('usernameLower', '==', username.toLowerCase()));
  const snaps = await getDocs(q);
  if (snaps.empty) return null;
  const d = snaps.docs[0];
  return { uid: d.id, ...d.data() };
}

async function addFriend(friendUid, friendUsername) {
  if (!currentUser || currentUser.isAnonymous) return;
  await Promise.all([
    setDoc(doc(db, 'users', currentUser.uid, 'friends', friendUid), {
      username: friendUsername,
      addedAt: serverTimestamp(),
    }),
    setDoc(doc(db, 'users', friendUid, 'friends', currentUser.uid), {
      username: currentUserProfile.username,
      addedAt: serverTimestamp(),
    }),
  ]);
}

async function fetchFriends() {
  const snaps = await getDocs(collection(db, 'users', currentUser.uid, 'friends'));
  return snaps.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

async function fetchHeadToHead(friendUid) {
  const q = query(
    collection(db, 'users', currentUser.uid, 'appliedGames'),
    where('opponentUid', '==', friendUid)
  );
  const snaps = await getDocs(q);
  const record = { wins: 0, losses: 0, draws: 0 };
  snaps.docs.forEach((d) => {
    const r = d.data().result;
    if (r === 'win') record.wins++;
    else if (r === 'loss') record.losses++;
    else if (r === 'draw') record.draws++;
  });
  return record;
}

async function loadAndRenderFriends() {
  const friends = await fetchFriends();
  friendsList.innerHTML = '';
  if (!friends.length) {
    const li = document.createElement('li');
    li.className = 'friend-row';
    li.textContent = 'Nog geen vrienden toegevoegd.';
    friendsList.appendChild(li);
    return;
  }
  for (const friend of friends) {
    const li = document.createElement('li');
    li.className = 'friend-row';

    const name = document.createElement('span');
    name.className = 'friend-name';
    name.textContent = friend.username;

    const record = document.createElement('span');
    record.className = 'friend-record';
    record.textContent = '…';

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Verwijder';
    removeBtn.addEventListener('click', async () => {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'friends', friend.uid));
      loadAndRenderFriends();
    });

    li.append(name, record, removeBtn);
    friendsList.appendChild(li);

    fetchHeadToHead(friend.uid).then((r) => {
      record.textContent = `${r.wins}-${r.losses}-${r.draws}`;
    });
  }
}

addFriendBtn.addEventListener('click', async () => {
  const username = addFriendInput.value.trim();
  addFriendError.classList.add('hidden');
  if (!username) return;
  addFriendBtn.disabled = true;
  try {
    if (username.toLowerCase() === currentUserProfile.usernameLower) {
      addFriendError.textContent = 'Je kan jezelf niet toevoegen.';
      addFriendError.classList.remove('hidden');
      return;
    }
    const found = await findUserByUsername(username);
    if (!found) {
      addFriendError.textContent = 'Geen gebruiker gevonden met die naam.';
      addFriendError.classList.remove('hidden');
      return;
    }
    await addFriend(found.uid, found.username);
    addFriendInput.value = '';
    await loadAndRenderFriends();
  } catch (e) {
    console.error('Kon vriend niet toevoegen', e);
    addFriendError.textContent = 'Er ging iets mis. Probeer het opnieuw.';
    addFriendError.classList.remove('hidden');
  } finally {
    addFriendBtn.disabled = false;
  }
});

addFriendInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') addFriendBtn.click();
});

function resolveOnlineOpponent(data) {
  const opponentColor = onlineMyColor === 'w' ? 'b' : 'w';
  onlineOpponentUid = data.players[opponentColor];
  onlineOpponentUsername = data.displayNames ? data.displayNames[opponentColor] : null;
  onlineConnectedText.textContent =
    `Verbonden met ${onlineOpponentUsername || 'je tegenstander'}! Jij speelt ${onlineMyColor === 'w' ? 'wit' : 'zwart'}.`;
  addOpponentFriendBtn.classList.add('hidden');

  if (!onlineOpponentUid || !currentUser || currentUser.isAnonymous) return;
  // A guest opponent has no users/{uid} profile, so there's nothing permanent to
  // befriend — only offer the button once we've confirmed a real account exists.
  (async () => {
    try {
      const snap = await getDoc(doc(db, 'users', onlineOpponentUid));
      if (!snap.exists()) return;
      onlineOpponentUsername = snap.data().username; // prefer the canonical username for the friend record
      const alreadyFriends = await getDoc(doc(db, 'users', currentUser.uid, 'friends', onlineOpponentUid));
      if (!alreadyFriends.exists()) {
        addOpponentFriendBtn.classList.remove('hidden');
      }
    } catch (e) {
      console.error('Kon tegenstander niet controleren voor vriendschap', e);
    }
  })();
}

addOpponentFriendBtn.addEventListener('click', async () => {
  if (!onlineOpponentUid || !onlineOpponentUsername) return;
  addOpponentFriendBtn.disabled = true;
  try {
    await addFriend(onlineOpponentUid, onlineOpponentUsername);
    addOpponentFriendBtn.textContent = 'Toegevoegd!';
  } catch (e) {
    console.error('Kon vriend niet toevoegen', e);
  } finally {
    addOpponentFriendBtn.disabled = false;
  }
});

// ==================== Match replay ====================

let replayMoves = [];
let replayPly = 0;

function buildBoardAtPly(moves, uptoIndex) {
  const g = createInitialGame();
  for (let i = 0; i < uptoIndex; i++) {
    const legal = generateLegalMoves(g);
    const stored = moves[i];
    const match = legal.find((m) => sameMove(m, stored));
    if (!match) break;
    if (stored.promoteTo) match.promoteTo = stored.promoteTo;
    const result = applyMove(g, match);
    g.board = result.board;
    g.castling = result.castling;
    g.enPassant = result.enPassant;
    g.turn = opposite(g.turn);
  }
  return g.board;
}

function renderStaticBoard(container, board) {
  container.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement('div');
      sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
      const piece = board[r][c];
      if (piece) {
        const span = document.createElement('span');
        span.textContent = PIECE_UNICODE[piece.color][piece.type];
        span.className = piece.color === 'w' ? 'piece-white' : 'piece-black';
        sq.appendChild(span);
      }
      container.appendChild(sq);
    }
  }
}

function renderReplayAtCurrentPly() {
  const board = buildBoardAtPly(replayMoves, replayPly);
  renderStaticBoard(replayBoardEl, board);
  replayPlyLabel.textContent = `${replayPly} / ${replayMoves.length}`;
  replayPrevBtn.disabled = replayPly <= 0;
  replayNextBtn.disabled = replayPly >= replayMoves.length;
}

function openReplay(entry) {
  replayMoves = entry.moves || [];
  replayPly = replayMoves.length;
  replayTitle.textContent = `vs ${entry.opponentUsername} — jij speelde ${entry.myColor === 'w' ? 'wit' : 'zwart'}`;
  renderReplayAtCurrentPly();
  replayModal.classList.remove('hidden');
}

function closeReplay() {
  replayModal.classList.add('hidden');
}

replayPrevBtn.addEventListener('click', () => {
  if (replayPly > 0) { replayPly--; renderReplayAtCurrentPly(); }
});
replayNextBtn.addEventListener('click', () => {
  if (replayPly < replayMoves.length) { replayPly++; renderReplayAtCurrentPly(); }
});
closeReplayBtn.addEventListener('click', closeReplay);

// ==================== Online multiplayer (Firestore) ====================

function gameDocRef(id) {
  return doc(db, 'games', id);
}

// authReadyPromise only guarantees the initial sign-in bootstrap has completed once
// (avoids a race at page load) — it must NOT be used as "get the current user", since
// after any later login/logout currentUser changes but the promise's resolved value doesn't.
async function ensureAuth() {
  await authReadyPromise;
  return currentUser;
}

function showOnlineIdlePanel() {
  onlineStatus = 'idle';
  onlineIdle.classList.remove('hidden');
  onlineWaiting.classList.add('hidden');
  onlineConnected.classList.add('hidden');
  leaveOnlineBtn.classList.add('hidden');
}

function showOnlineWaitingPanel() {
  onlineIdle.classList.add('hidden');
  onlineWaiting.classList.remove('hidden');
  onlineConnected.classList.add('hidden');
  leaveOnlineBtn.classList.remove('hidden');
}

function showOnlineConnectedPanel() {
  onlineIdle.classList.add('hidden');
  onlineWaiting.classList.add('hidden');
  onlineConnected.classList.remove('hidden');
  leaveOnlineBtn.classList.remove('hidden');
}

function getMyDisplayName() {
  if (currentUserProfile) return currentUserProfile.username;
  let name = null;
  try { name = sessionStorage.getItem('chess.guestName'); } catch (e) { /* ignore */ }
  if (!name) {
    name = 'Gast' + Math.floor(1000 + Math.random() * 9000);
    try { sessionStorage.setItem('chess.guestName', name); } catch (e) { /* ignore */ }
  }
  return name;
}

async function createOnlineGame() {
  createInviteBtn.disabled = true;
  try {
    const user = await ensureAuth();
    const newDocRef = await addDoc(collection(db, 'games'), {
      hostUid: user.uid,
      players: { w: user.uid, b: null },
      displayNames: { w: getMyDisplayName(), b: null },
      moves: [],
      status: 'waiting',
      result: null,
      createdAt: serverTimestamp(),
    });
    onlineGameId = newDocRef.id;
    onlineMyColor = 'w';
    const url = new URL(window.location.href);
    url.searchParams.set('game', onlineGameId);
    inviteLinkInput.value = url.toString();
    window.history.replaceState({}, '', url.toString());
    resetLocalBoard();
    showOnlineWaitingPanel();
    attachOnlineListener(onlineGameId);
  } catch (e) {
    console.error('Kon geen online partij aanmaken', e);
    alert('Kon geen online partij aanmaken. Probeer het opnieuw.');
  } finally {
    createInviteBtn.disabled = false;
  }
}

async function joinOnlineGame(gameId) {
  try {
    const user = await ensureAuth();
    const ref = gameDocRef(gameId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      alert('Deze uitnodiging bestaat niet (meer).');
      showOnlineIdlePanel();
      return;
    }
    const data = snap.data();
    if (data.players.w === user.uid) {
      onlineMyColor = 'w';
    } else if (data.players.b === user.uid) {
      onlineMyColor = 'b';
    } else if (!data.players.b) {
      await updateDoc(ref, { 'players.b': user.uid, 'displayNames.b': getMyDisplayName(), status: 'active' });
      onlineMyColor = 'b';
    } else {
      alert('Deze partij is al vol.');
      showOnlineIdlePanel();
      return;
    }
    onlineGameId = gameId;
    resetLocalBoard();
    attachOnlineListener(gameId);
  } catch (e) {
    console.error('Kon niet deelnemen aan online partij', e);
    alert('Kon niet deelnemen aan de partij. Probeer het opnieuw.');
    showOnlineIdlePanel();
  }
}

function updateBoardOrientation() {
  boardEl.classList.toggle('flipped', mode === 'online' && onlineMyColor === 'b');
}

function attachOnlineListener(gameId) {
  if (onlineUnsubscribe) onlineUnsubscribe();
  onlineAppliedMoveCount = 0;
  updateBoardOrientation();
  onlineUnsubscribe = onSnapshot(gameDocRef(gameId), (snap) => {
    if (!snap.exists()) return;
    handleOnlineGameUpdate(snap.data());
  }, (err) => {
    console.error('Online listener error', err);
  });
}

function handleOnlineGameUpdate(data) {
  if (data.status === 'waiting') {
    onlineStatus = 'waiting';
    showOnlineWaitingPanel();
    return;
  }

  if (onlineStatus !== 'active' && data.status !== 'finished') {
    onlineStatus = 'active';
    showOnlineConnectedPanel();
    resolveOnlineOpponent(data);
  }

  const moves = data.moves || [];
  while (onlineAppliedMoveCount < moves.length) {
    applyStoredMove(moves[onlineAppliedMoveCount]);
    onlineAppliedMoveCount++;
  }

  if (data.status === 'finished') {
    onlineStatus = 'finished';
    if (!gameOver) {
      gameOver = true;
      if (data.result === 'stalemate') {
        statusEl.textContent = 'Stalemate — draw';
      } else if (data.result) {
        const winner = data.result.endsWith('w') ? 'White' : 'Black';
        statusEl.textContent = `Checkmate — ${winner} wins`;
      }
    }
  }
}

function applyStoredMove(stored) {
  const legal = generateLegalMoves(game);
  const match = legal.find((m) => sameMove(m, stored));
  if (!match) {
    console.error('Kon opgeslagen zet niet matchen met een legale zet', stored);
    return;
  }
  if (stored.promoteTo) match.promoteTo = stored.promoteTo;
  finalizeMove(match);
}

async function submitOnlineMove(move) {
  if (!onlineGameId || onlineStatus !== 'active' || game.turn !== onlineMyColor) return;
  const stored = {
    ply: game.moveLog.length,
    from: move.from,
    to: move.to,
    promoteTo: move.promoteTo || null,
  };
  try {
    await updateDoc(gameDocRef(onlineGameId), { moves: arrayUnion(stored) });
  } catch (e) {
    console.error('Kon zet niet versturen', e);
  }
}

async function markOnlineGameFinished(result) {
  if (!onlineGameId) return;
  const gameId = onlineGameId;
  try {
    // Step 1: atomically flip status -> finished exactly once. This has to be its own
    // transaction and commit BEFORE step 2, because our appliedGames security rule checks
    // (via get()) that the game is already 'finished' — and get() inside a rule always
    // sees the pre-transaction state, so it can never observe a write from the same
    // transaction that's still in flight.
    let gameDataAtFinish = null;
    await runTransaction(db, async (tx) => {
      const ref = gameDocRef(gameId);
      const snap = await tx.get(ref);
      if (!snap.exists() || snap.data().status === 'finished') return;
      gameDataAtFinish = snap.data();
      tx.update(ref, { status: 'finished', result });
    });

    // Someone else's client already finished this game — nothing more for us to do.
    if (!gameDataAtFinish) return;

    // Step 2: write the per-player match-history/stats record, using the data captured
    // during the transaction above rather than re-reading the doc — a getDoc() right
    // after can be served from the local watch cache (since a live onSnapshot listener
    // is attached to this same doc) before that cache has caught up to what we just
    // committed, making it look like the write never happened.
    await writeMatchRecords(gameId, { ...gameDataAtFinish, status: 'finished', result });
  } catch (e) {
    console.error('Kon partij niet als afgelopen markeren', e);
  }
}

async function writeMatchRecords(gameId, data) {
  const wUid = data.players.w;
  const bUid = data.players.b;
  const isDraw = data.result === 'stalemate';
  const winnerColor = data.result === 'checkmate-w' ? 'w' : data.result === 'checkmate-b' ? 'b' : null;
  const outcomeFor = (color) => (isDraw ? 'draw' : (color === winnerColor ? 'win' : 'loss'));

  const [wProfileSnap, bProfileSnap] = await Promise.all([
    getDoc(doc(db, 'users', wUid)),
    getDoc(doc(db, 'users', bUid)),
  ]);

  const guestName = (color) => (data.displayNames && data.displayNames[color]) || 'Gast';

  const writes = [];
  // Guests (no users/{uid} profile) don't get match history / stats — only real accounts do.
  if (wProfileSnap.exists()) {
    writes.push(setDoc(doc(db, 'users', wUid, 'appliedGames', gameId), {
      opponentUid: bUid,
      opponentUsername: bProfileSnap.exists() ? bProfileSnap.data().username : guestName('b'),
      myColor: 'w',
      result: outcomeFor('w'),
      moves: data.moves,
      createdAt: serverTimestamp(),
    }).catch((e) => console.warn('Match-record (wit) niet opgeslagen (mogelijk al aanwezig)', e.code)));
  }
  if (bProfileSnap.exists()) {
    writes.push(setDoc(doc(db, 'users', bUid, 'appliedGames', gameId), {
      opponentUid: wUid,
      opponentUsername: wProfileSnap.exists() ? wProfileSnap.data().username : guestName('w'),
      myColor: 'b',
      result: outcomeFor('b'),
      moves: data.moves,
      createdAt: serverTimestamp(),
    }).catch((e) => console.warn('Match-record (zwart) niet opgeslagen (mogelijk al aanwezig)', e.code)));
  }
  await Promise.all(writes);
}

function leaveOnlineGame() {
  if (onlineUnsubscribe) {
    onlineUnsubscribe();
    onlineUnsubscribe = null;
  }
  onlineGameId = null;
  onlineMyColor = null;
  onlineAppliedMoveCount = 0;
  onlineStatus = 'idle';
  onlineOpponentUid = null;
  onlineOpponentUsername = null;
  addOpponentFriendBtn.classList.add('hidden');
  addOpponentFriendBtn.textContent = '+ Vriend toevoegen';
  updateBoardOrientation();
  const url = new URL(window.location.href);
  url.searchParams.delete('game');
  window.history.replaceState({}, '', url.toString());
}

createInviteBtn.addEventListener('click', createOnlineGame);

copyInviteBtn.addEventListener('click', async () => {
  inviteLinkInput.select();
  try {
    await navigator.clipboard.writeText(inviteLinkInput.value);
  } catch (e) {
    // clipboard API unavailable — the text is still selected for manual copy
  }
  const original = copyInviteBtn.textContent;
  copyInviteBtn.textContent = 'Gekopieerd!';
  setTimeout(() => { copyInviteBtn.textContent = original; }, 1500);
});

leaveOnlineBtn.addEventListener('click', () => {
  leaveOnlineGame();
  resetLocalBoard();
  showOnlineIdlePanel();
});

// ==================== Controls ====================

modeSelect.addEventListener('change', () => {
  const previousMode = mode;
  mode = modeSelect.value;
  difficultyWrap.style.display = mode === 'ai' ? '' : 'none';
  sideSelect.closest('.mode-toggle').style.display = mode === 'online' ? 'none' : '';
  undoBtn.disabled = mode === 'online';
  redoBtn.disabled = mode === 'online';

  if (previousMode === 'online' && mode !== 'online') {
    leaveOnlineGame();
  }

  if (mode === 'online') {
    onlinePanel.classList.remove('hidden');
    resetLocalBoard();
    showOnlineIdlePanel();
  } else {
    onlinePanel.classList.add('hidden');
    newGame();
  }
});

difficultySelect.addEventListener('change', () => {
  aiDepth = parseInt(difficultySelect.value, 10) + 1; // Easy=2, Medium=3, Hard=4
});

sideSelect.addEventListener('change', () => {
  humanSide = sideSelect.value;
  newGame();
});

themeSelect.addEventListener('change', () => {
  currentTheme = themeSelect.value;
  document.documentElement.setAttribute('data-theme', currentTheme);
  savePref('theme', currentTheme);
});

soundBtn.addEventListener('click', () => {
  getAudioCtx();
  setSoundEnabled(!soundEnabled);
});

learnModeToggle.addEventListener('change', () => {
  learnMode = learnModeToggle.checked;
  if (!learnMode) feedbackCard.classList.add('hidden');
  savePref('learnMode', learnMode);
});

document.getElementById('newGameBtn').addEventListener('click', newGame);
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// ==================== Fullscreen ====================

const fullscreenBtn = document.getElementById('fullscreenBtn');

function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}

function enterFullscreen() {
  const el = document.querySelector('.board-wrap'); // just the game area, not the whole page
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (fn) fn.call(el);
}

function exitFullscreenMode() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (fn) fn.call(document);
}

function updateFullscreenButton() {
  const active = isFullscreenActive();
  fullscreenBtn.textContent = active ? '⤢' : '⛶';
  fullscreenBtn.title = active ? 'Exit fullscreen' : 'Toggle fullscreen';
}

fullscreenBtn.addEventListener('click', () => {
  if (isFullscreenActive()) exitFullscreenMode();
  else enterFullscreen();
});

['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach((evt) => {
  document.addEventListener(evt, updateFullscreenButton);
});

// Init — restore saved preferences (theme, sound, learn mode) before first render
mode = modeSelect.value;
humanSide = sideSelect.value;
aiDepth = parseInt(difficultySelect.value, 10) + 1;
difficultyWrap.style.display = mode === 'ai' ? '' : 'none';

currentTheme = loadPref('theme', currentTheme);
themeSelect.value = currentTheme;
document.documentElement.setAttribute('data-theme', currentTheme);

setSoundEnabled(loadPref('sound', soundEnabled));

learnMode = loadPref('learnMode', learnMode);
learnModeToggle.checked = learnMode;

updateFullscreenButton();

initBoardDOM();
renderMoveList();
renderBoard(false);

const inviteGameId = new URLSearchParams(window.location.search).get('game');
if (inviteGameId) {
  modeSelect.value = 'online';
  mode = 'online';
  difficultyWrap.style.display = 'none';
  sideSelect.closest('.mode-toggle').style.display = 'none';
  undoBtn.disabled = true;
  redoBtn.disabled = true;
  onlinePanel.classList.remove('hidden');
  showOnlineWaitingPanel();
  joinOnlineGame(inviteGameId);
} else if (mode === 'ai' && game.turn !== humanSide) {
  setTimeout(makeAiMove, 300);
}
