'use strict';
// Cards are 2-char strings: rank (23456789TJQKA) + suit (s h d c), e.g. "Ah", "Td".

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const RV = {};
RANKS.split('').forEach((c, i) => { RV[c] = i + 2; });

function newDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  return d;
}

function shuffle(a, rnd = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const COMBO_CACHE = {};
function combos(n, k = 5) {
  const key = n + ',' + k;
  if (COMBO_CACHE[key]) return COMBO_CACHE[key];
  const out = [];
  const idx = [];
  (function rec(start) {
    if (idx.length === k) { out.push(idx.slice()); return; }
    for (let i = start; i < n; i++) { idx.push(i); rec(i + 1); idx.pop(); }
  })(0);
  COMBO_CACHE[key] = out;
  return out;
}

const BASE = 15;
const TOP = BASE ** 5; // one category step

// Score a 5-card hand. Higher is better. Packs category + tie-breakers in base 15.
function score5(rr, ss) {
  const ranks = rr.slice().sort((a, b) => b - a);
  const flush = ss[0] === ss[1] && ss[1] === ss[2] && ss[2] === ss[3] && ss[3] === ss[4];
  const cnt = {};
  for (const r of ranks) cnt[r] = (cnt[r] || 0) + 1;
  const groups = Object.keys(cnt)
    .map((r) => ({ r: +r, c: cnt[r] }))
    .sort((a, b) => b.c - a.c || b.r - a.r);
  let straightHigh = 0;
  if (groups.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5 && ranks[4] === 2) straightHigh = 5; // wheel
  }
  let cat;
  let tb;
  if (straightHigh && flush) { cat = 8; tb = [straightHigh]; }
  else if (groups[0].c === 4) { cat = 7; tb = [groups[0].r, groups[1].r]; }
  else if (groups[0].c === 3 && groups[1].c === 2) { cat = 6; tb = [groups[0].r, groups[1].r]; }
  else if (flush) { cat = 5; tb = ranks; }
  else if (straightHigh) { cat = 4; tb = [straightHigh]; }
  else if (groups[0].c === 3) { cat = 3; tb = [groups[0].r, groups[1].r, groups[2].r]; }
  else if (groups[0].c === 2 && groups[1].c === 2) { cat = 2; tb = [groups[0].r, groups[1].r, groups[2].r]; }
  else if (groups[0].c === 2) { cat = 1; tb = [groups[0].r, groups[1].r, groups[2].r, groups[3].r]; }
  else { cat = 0; tb = ranks; }
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * BASE + (tb[i] || 0);
  return s;
}

// Best 5-card score out of 5..7 cards.
function bestScore(cards) {
  const n = cards.length;
  const rr = new Array(n);
  const ss = new Array(n);
  for (let i = 0; i < n; i++) { rr[i] = RV[cards[i][0]]; ss[i] = cards[i][1]; }
  let best = -1;
  for (const c of combos(n)) {
    const s = score5([rr[c[0]], rr[c[1]], rr[c[2]], rr[c[3]], rr[c[4]]],
      [ss[c[0]], ss[c[1]], ss[c[2]], ss[c[3]], ss[c[4]]]);
    if (s > best) best = s;
  }
  return best;
}

const PLURAL = { 14: 'Aces', 13: 'Kings', 12: 'Queens', 11: 'Jacks', 10: 'Tens', 9: 'Nines', 8: 'Eights', 7: 'Sevens', 6: 'Sixes', 5: 'Fives', 4: 'Fours', 3: 'Threes', 2: 'Twos' };
const SINGLE = { 14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: 'Ten', 9: 'Nine', 8: 'Eight', 7: 'Seven', 6: 'Six', 5: 'Five', 4: 'Four', 3: 'Three', 2: 'Two' };

function category(score) { return Math.floor(score / TOP); }

function handLabel(score) {
  const cat = category(score);
  let s = score % TOP;
  const tb = [];
  for (let i = 4; i >= 0; i--) { tb[i] = s % BASE; s = Math.floor(s / BASE); }
  switch (cat) {
    case 0: return SINGLE[tb[0]] + ' High';
    case 1: return 'Pair of ' + PLURAL[tb[0]];
    case 2: return 'Two Pair, ' + PLURAL[tb[0]] + ' and ' + PLURAL[tb[1]];
    case 3: return 'Three ' + PLURAL[tb[0]];
    case 4: return 'Straight, ' + SINGLE[tb[0]] + ' High';
    case 5: return 'Flush, ' + SINGLE[tb[0]] + ' High';
    case 6: return 'Full House, ' + PLURAL[tb[0]] + ' full of ' + PLURAL[tb[1]];
    case 7: return 'Four ' + PLURAL[tb[0]];
    default: return tb[0] === 14 ? 'Royal Flush' : 'Straight Flush, ' + SINGLE[tb[0]] + ' High';
  }
}

// Label for a player's current holding (works with just two hole cards too).
function describe(hole, board) {
  const cards = hole.concat(board);
  if (cards.length < 2) return '';
  if (cards.length < 5) {
    const a = RV[hole[0][0]];
    const b = RV[hole[1][0]];
    if (a === b) return 'Pair of ' + PLURAL[a];
    const hi = Math.max(a, b);
    return SINGLE[hi] + ' High';
  }
  return handLabel(bestScore(cards));
}

module.exports = { RANKS, SUITS, RV, newDeck, shuffle, score5, bestScore, handLabel, describe, category };
