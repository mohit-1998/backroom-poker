'use strict';
const assert = require('assert');
const { bestScore, handLabel, describe, category } = require('../engine/cards');
const { Table } = require('../engine/table');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name); throw e; }
}
const sc = (s) => bestScore(s.split(' '));

console.log('hand evaluator');
ok('category order', () => {
  const hands = [
    'Ah Kh Qh Jh Th', // royal
    '9s 8s 7s 6s 5s', // straight flush
    '9s 9h 9d 9c 2h', // quads
    'Ks Kh Kd 2c 2h', // full house
    'As 9s 7s 4s 2s', // flush
    '9s 8h 7d 6c 5h', // straight
    'Qs Qh Qd 8c 2h', // trips
    'As Ah Kd Kc 2h', // two pair
    'As Ah Kd 7c 2h', // pair
    'As Qh 9d 7c 2h'  // high card
  ].map(sc);
  for (let i = 1; i < hands.length; i++) assert(hands[i - 1] > hands[i], 'hand ' + i);
  assert.strictEqual(category(hands[0]), 8);
  assert.strictEqual(category(hands[9]), 0);
});
ok('wheel straight beats pair, loses to six-high straight', () => {
  assert(sc('As 2h 3d 4c 5h') > sc('Ks Kh 3d 4c 9h'));
  assert(sc('2s 3h 4d 5c 6h') > sc('As 2h 3d 4c 5h'));
});
ok('kickers decide', () => {
  assert(sc('As Ah Kd 7c 2h') > sc('As Ah Qd 7c 2h'));
  assert(sc('As Ah Kd 7c 3h') > sc('As Ah Kd 7c 2h'));
  assert.strictEqual(sc('As Ah Kd 7c 2h'), sc('Ad Ac Kh 7d 2s'));
});
ok('best five of seven', () => {
  assert.strictEqual(category(sc('Ah Kh 2h 7h 9h 3c 3d')), 5); // flush beats pair
  assert.strictEqual(category(sc('Ah Ad As Kc Kd 2c 3d')), 6); // full house
  assert(sc('Ah Ad 2c 3d 4s 5h 9c') > sc('Kh Kd 2c 3d 4s 9h Jc')); // wheel straight beats pair of kings
});
ok('labels', () => {
  assert.strictEqual(handLabel(sc('Ah Kh Qh Jh Th')), 'Royal Flush');
  assert.strictEqual(handLabel(sc('Ks Kh Kd 2c 2h')), 'Full House, Kings full of Twos');
  assert.strictEqual(describe(['Kh', 'Jh'], ['Ks', '7h', '2c', 'Qd']), 'Pair of Kings');
  assert.strictEqual(describe(['Ah', 'Ad'], []), 'Pair of Aces');
  assert.strictEqual(describe(['Ah', '9d'], []), 'Ace High');
});

console.log('pots');
function manualTable() {
  const t = new Table({ startChips: 1000, speed: 0.001 }, {});
  return t;
}
ok('main pot and side pot go to the right winners', () => {
  const t = manualTable();
  t.sit({ name: 'A', token: 'a' }); t.sit({ name: 'B', token: 'b' }); t.sit({ name: 'C', token: 'c' });
  const [A, B, C] = [t.seats[0], t.seats[4], t.seats[2]];
  t.board = ['2c', '7d', '9h', 'Js', '4s'];
  A.hole = ['Ah', 'Ad']; B.hole = ['Kh', 'Kd']; C.hole = ['Qh', 'Qd'];
  A.total = 100; B.total = 300; C.total = 300;
  for (const p of [A, B, C]) { p.inHand = true; p.chips = 0; }
  t.dealer = 0; t.street = 'river';
  t.doShowdown();
  assert.strictEqual(A.chips, 300); // 3 x 100
  assert.strictEqual(B.chips, 400); // 2 x 200
  assert.strictEqual(C.chips, 0);
  t.destroy();
});
ok('split pot with an odd chip', () => {
  const t = manualTable();
  t.sit({ name: 'A', token: 'a' }); t.sit({ name: 'B', token: 'b' }); t.sit({ name: 'C', token: 'c' });
  const [A, B, C] = [t.seats[0], t.seats[4], t.seats[2]];
  t.board = ['Ah', 'Kd', 'Qs', 'Jc', 'Th']; // broadway on board: everyone plays it
  A.hole = ['2c', '3d']; B.hole = ['2h', '3s']; C.hole = ['4c', '5d'];
  A.total = 50; B.total = 50; C.total = 51; // 151 total, three way chop -> 51,50,50
  for (const p of [A, B, C]) { p.inHand = true; p.chips = 0; }
  t.dealer = 0; t.street = 'river';
  t.doShowdown();
  assert.strictEqual(A.chips + B.chips + C.chips, 151);
  assert(Math.max(A.chips, B.chips, C.chips) - Math.min(A.chips, B.chips, C.chips) <= 1);
  t.destroy();
});
ok('uncalled bet comes back', () => {
  const t = manualTable();
  t.sit({ name: 'A', token: 'a' }); t.sit({ name: 'B', token: 'b' });
  const [A, B] = [t.seats[0], t.seats[4]];
  t.board = ['2c', '7d', '9h', 'Js', '4s'];
  A.hole = ['Ah', 'Ad']; B.hole = ['3h', '5d'];
  A.total = 500; B.total = 200; // B all-in for 200, A bet 500
  for (const p of [A, B]) { p.inHand = true; p.chips = 0; }
  t.dealer = 0; t.street = 'river';
  t.doShowdown();
  assert.strictEqual(A.chips, 700);
  assert.strictEqual(B.chips, 0);
  t.destroy();
});

console.log('simulated games');
function simulate(nBots, hands, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ': simulation timed out')), 90000);
    let seatsAdded = 0;
    let t;
    let human;
    let sawSidePots = 0;
    const check = () => {
      // chip conservation at every state change
      const inPlay = t.totalChips() + (t.handRunning() ? t.potTotal() : 0);
      const expected = t.startChips * seatsAdded + t.startChips * t.rebuys;
      // a finished hand has already paid out, so pot is zero then
      if (t.handRunning()) {
        assert.strictEqual(inPlay, expected, `${label}: chips not conserved (${inPlay} vs ${expected}) hand ${t.handNo}`);
      } else if (t.street === 'showdown') {
        assert.strictEqual(t.totalChips(), expected, `${label}: chips not conserved after hand ${t.handNo}`);
      }
      if (t.result && t.result.pots.length > 1) sawSidePots++;
      // auto-play the human with a loose call/check strategy
      if (t.handRunning() && t.toAct === human && !t._acting) {
        t._acting = true;
        setImmediate(() => {
          t._acting = false;
          if (t.toAct !== human || !t.handRunning()) return;
          const lg = t.legalFor(t.seats[human]);
          const r = Math.random();
          if (lg.canRaise && r < 0.15) t.act(human, 'raise', lg.minRaiseTo + Math.floor(Math.random() * 3) * t.bb);
          else if (r < 0.25 && !lg.canCheck) t.act(human, 'fold');
          else t.act(human, lg.canCheck ? 'check' : 'call');
        });
      }
      // a busted human has to rebuy, otherwise the table pauses (the real client shows a Rebuy button)
      if (human >= 0 && t.seats[human] && t.seats[human].chips === 0 && !t.handRunning() && !t._rebuying) {
        t._rebuying = true;
        setImmediate(() => { t._rebuying = false; t.rebuy(human); });
      }
      if (t.handNo >= hands && t.street === 'showdown') {
        clearTimeout(timer);
        t.destroy();
        resolve({ hands: t.handNo, rebuys: t.rebuys, sawSidePots });
      }
    };
    // huge action time so the sped-up timers never auto-fold the simulated human
    t = new Table({ startChips: 1000, sb: 10, bb: 20, speed: 0.0004, actionTime: 1e6 }, { onChange: check });
    human = t.sit({ name: 'Human', token: 'h' });
    seatsAdded = 1;
    for (let i = 0; i < nBots; i++) { t.addBot(); seatsAdded++; }
    t.startGame();
  });
}

(async () => {
  for (const [n, label] of [[1, 'heads-up'], [3, '4-handed'], [7, 'full table']]) {
    const r = await simulate(n, 120, label);
    console.log(`  ✓ ${label}: ${r.hands} hands, chips conserved, ${r.rebuys} rebuys, ${r.sawSidePots} side-pot hands`);
    passed++;
  }
  console.log(`\n${passed} checks passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
