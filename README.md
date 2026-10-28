# Backroom Poker

Texas Hold'em for you and your friends. Private rooms with a 4-letter code, up to 8 players, bots to fill empty seats, 3D clay chips with clay-chip sounds. No accounts, no database.

## Run it on your computer

```bash
npm install
npm start            # http://localhost:3000
npm test             # rules, pots, bots, and a full websocket game
```

Needs Node 18 or newer.

## Put it online for free (Render)

1. Create a free GitHub account and a new empty repository, then upload this folder to it
   (on github.com: **Add file → Upload files**, drag everything except `node_modules`).
2. Create a free account at <https://render.com> and sign in with GitHub.
3. **New → Blueprint**, pick your repository. Render reads `render.yaml` and sets everything up
   (a free Node web service, start command `npm start`, health check `/healthz`).
   Or **New → Web Service** and enter: build `npm install`, start `npm start`, instance type **Free**.
4. After the first deploy you get a URL like `https://backroom-poker.onrender.com`.
   Open it, create a room, press **Invite friends** and send the link. Friends open it and type their name.

### What to expect on the free plan

- The service **sleeps after 15 minutes with no traffic**. The first visit after that takes about a minute to wake up. Open the link yourself a minute before your friends arrive.
- While a game is open the browser sends a small message every 20 seconds, which Render counts as activity, so a running game stays awake.
- Render may restart a free service at any time. Rooms live in memory, so a restart ends the games in progress. Start a new room if that happens.
- 750 free hours per month is enough for one always-awake service.

## Other free options

| Option | Good for | Catch |
| --- | --- | --- |
| Your own computer + a tunnel such as Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3000`) | A game night tonight, zero signup | Your computer must stay on; the link changes each time |
| Google Cloud `e2-micro` VM (Always Free) | Always on, no sleeping | Needs a card, and you set up the server yourself |
| Railway | Easy deploys | Free plan is a small monthly credit, not unlimited |

## How it works

- `engine/` holds the rules: `cards.js` (hand ranking), `table.js` (betting, side pots, timers), `bots.js` (bot decisions from a quick odds estimate).
- `server.js` serves `public/` and runs rooms over WebSockets. The server decides everything; clients only ask to fold, call or raise. Other players' cards are never sent to your browser until showdown.
- `public/` is the game screen: lobby, table, chip drawing and sounds.
- Closing the tab and coming back (same browser) puts you back in your seat. If you miss two turns in a row you are sat out until you press **I'm back**. A busted player can **Rebuy**.

## Action log, bot speed and sound

- **Action log:** a panel on the right lists every move in order: blinds, folds, calls, raises, each new street with its cards, every hand shown at showdown, and the winner. On a phone, open it with the speech-bubble button in the top bar.
- **Bot speed:** chosen when you create the room. Relaxed (2–4 s per move, the default), Normal, or Quick. The numbers live in `BOT_DELAY` in `server.js`.
- **Sound effects:** clay-chip clacks with different patterns and pitches each time, a riffle shuffle when a hand starts, card flicks, a knock for check, a card slide for fold, and a soft tick for the last 5 seconds of your turn.
- **Music:** a lounge soundtrack made live in the browser. Chords, key, melody and rhythm keep changing, so it does not loop. Music and effects have separate buttons in the top bar. Browsers only allow sound after a tap, so it starts at your first click.

## Settings

Chips and blinds are picked when creating a room. The turn timer is 30 seconds. To change defaults, edit `public/index.html` (the preset buttons) and `server.js` (`actionTime`).
