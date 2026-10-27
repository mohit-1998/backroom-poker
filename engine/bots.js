'use strict';
const { newDeck, bestScore } = require('./cards');

// Monte Carlo equity against `nOpp` random hands (ties split).
function equity(hole, board, nOpp, sims) {
  const known = new Set(hole.concat(board));
  const rest = newDeck().filter((c) => !known.has(c));
  const boardNeed = 5 - board.length;
  const need = boardNeed + 2 * nOpp;
  let win = 0;
  for (let i = 0; i < sims; i++) {
    for (let k = 0; k < need; k++) {
      const j = k + Math.floor(Math.random() * (rest.length - k));
      const tmp = rest[k]; rest[k] = rest[j]; rest[j] = tmp;
    }
    const full = board.concat(rest.slice(0, boardNeed));
    const mine = bestScore(hole.concat(full));
    let beaten = false;
    let ties = 0;
    for (let o = 0; o < nOpp; o++) {
      const a = rest[boardNeed + 2 * o];
      const b = rest[boardNeed + 2 * o + 1];
      const sc = bestScore([a, b].concat(full));
      if (sc > mine) { beaten = true; break; }
      if (sc === mine) ties++;
    }
    if (!beaten) win += 1 / (ties + 1);
  }
  return win / sims;
}

function roundTo(x, unit) {
  return Math.max(unit, Math.round(x / unit) * unit);
}

// Returns { a: 'fold'|'check'|'call'|'raise', amt }
function decide(t, p) {
  const lg = t.legalFor(p);
  const toCall = lg.toCall;
  const opp = Math.max(1, t.alive().filter((q) => q !== p).length);
  const pot = t.potTotal();
  const persona = p.persona || { aggr: 0.5, loose: 0.5 };
  const e = equity(p.hole, t.board, opp, 220);
  const s = e * (opp + 1); // 1.0 = average strength at this table size
  const strongT = 1.55 + (1 - persona.aggr) * 0.3;
  const medT = 1.15 + (1 - persona.loose) * 0.25;
  const r = Math.random();

  const sized = (frac) => {
    const target = t.currentBet + Math.max(t.minRaise, roundTo((pot + toCall) * frac, t.sb));
    if (target >= lg.maxRaiseTo * 0.6) return lg.maxRaiseTo; // commit when it is most of the stack
    return Math.min(target, lg.maxRaiseTo);
  };

  if (lg.canCheck) {
    if (lg.canRaise && s > strongT && r < 0.45 + persona.aggr * 0.45) return { a: 'raise', amt: sized(0.6 + r * 0.3) };
    if (lg.canRaise && s > medT && r < persona.aggr * 0.5) return { a: 'raise', amt: sized(0.4) };
    if (lg.canRaise && r < persona.aggr * 0.06) return { a: 'raise', amt: sized(0.6) }; // occasional bluff
    return { a: 'check' };
  }

  const potOdds = toCall / (pot + toCall || 1);
  const margin = 0.035 - persona.loose * 0.05;
  if (e < potOdds + margin && r > persona.loose * 0.04) return { a: 'fold' };
  if (lg.canRaise && s > strongT && r < 0.4 + persona.aggr * 0.4) return { a: 'raise', amt: sized(0.75) };
  if (lg.canRaise && r < persona.aggr * 0.03) return { a: 'raise', amt: sized(0.7) };
  return { a: 'call' };
}

module.exports = { equity, decide };
