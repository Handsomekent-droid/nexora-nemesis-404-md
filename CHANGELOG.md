# NEXORA NEMESIS 404 MD — changelog
Zip name = `Nexora-Nemesis-404-MD-<build>.zip`. The highest build number is the latest. Build is also shown in
WhatsApp `.menu`, Telegram `/start`, and `/version` on Telegram. Bump `BUILD` in `config.js` for each new zip.

## Build 49
- README.md restyled with a live, animated "glitch" look: an animated waving gradient banner (capsule-render)
  at the top and bottom, and an animated typing-cursor tagline (readme-typing-svg) that cycles through a few
  lines. All rendered as live SVGs by GitHub itself — no images to host, nothing to break. Documentation
  only, no code changed.

## Build 48
- New privacy toggle: `.self` (alias `.private`) makes this number answer **only the paired owner** — every
  other sender, sudo included, is silently ignored (no "maintenance" notice, it just looks like the bot
  never replies to them). `.public` turns it back off so anyone can use the bot again. Owner-only, like
  `.maintenance`. Group moderation (anti-link, jail, welcome, etc.) keeps working either way — this only
  gates who can issue bot *commands*.

## Build 47
- Fixed the anime/manga commands (`.anime`, `.manga`, `.animechar`, `.topanime`, `.randomanime`) "bringing
  nothing": they all share Jikan (MyAnimeList), which is free but strictly rate-limited (3 req/s, 60/min) —
  shared-hosting panels often share one outbound IP across many tenants, so 429s from Jikan were common and
  every one of them was shown to you as a plain "not found", even when something real just wasn't reachable.
- New shared `lib/jikan.js` helper: retries once automatically on a 429/5xx, and now every one of those
  commands tells you WHICH actually happened — rate-limited, the database being down, or a genuine "nothing
  matched that name" — instead of the same generic message every time.
- `.animequote` (a different service, animechan.io) gets the same rate-limited/down-right-now distinction.

## Build 46
- New `.pair 254xxxxxxxxx` command (aliases: `.pairme`, `.linkme`, `.reqpair`) — message any already-running
  copy of the bot and it pairs that number for you right there, the same flow the console/Telegram/website
  use. No panel, Telegram or website needed.
- Guarded against abuse: `.pair` refuses to touch a number that already has an active or offline session
  unless it's the SAME number asking (so one person can always re-link their own session, but nobody can use
  `.pair <someone else's number>` to kick another person's bot offline or steal their slot). It also respects
  the existing `MAX_SESSIONS` cap.
- Sessions themselves are still **never** committed to git/GitHub — `creds.json`/`session-*.json` are full
  login credentials for that WhatsApp number (equivalent to a password). `.gitignore` already excludes
  `sessions/` and `data/`; that's intentional and stays that way for everyone's safety, including yours.

## Build 45
- Fixed `.vv`: it now gives a different message for each real situation instead of always falling back to the same
  one ("not a reply", "not a view-once message", "couldn't recover it") so you can actually tell what went wrong.
- Broadened view-once detection to catch every shape WhatsApp uses: the 3 wrapper types (`viewOnceMessage`,
  `viewOnceMessageV2`, `viewOnceMessageV2Extension`) AND the newer direct `.viewOnce: true` flag some clients put
  straight on the photo/video/voice note itself (this second form was never checked before — likely why some
  view-once messages were always missed and `.vv` fell through to the generic reply).
- `.vv` still tries the bot's RAM copy first (for view-once media that already got opened, if the bot was online
  when it arrived), then falls back to downloading straight from the replied-to message if it's still fresh.
- `.vv2` is now public (was owner-only) and sends the revealed media to **your own DM** (whoever typed the command),
  not just the bot owner's chat — so anyone in a group can `.vv2` a view-once privately to themselves.

## Build 44
- README.md restyled with clickable deploy badges (Fork, Pair, Deploy, Join Telegram/WhatsApp) in the same "Steps to
  Deploy" layout other popular bot repos use, plus a bullet-point Features list. Documentation only, no code changed.

## Build 43
- README.md rebuilt for GitHub: badges, a banner image, highlighted warning/tip/note boxes, a feature table and a
  collapsible FAQ/settings section (purely a documentation change — no code behaviour changed).

## Build 42
- Console pairing (lib/consolepair.js): a server with nothing paired yet now asks for a WhatsApp number right in the
  console/panel command box, no Telegram or website needed. BOT_TOKEN is now optional — without it the bot runs
  WhatsApp-only instead of refusing to start.
- Public GitHub release prepared: README.md (deploy steps for a panel or a VPS), LICENSE.md (credit required, no resale,
  no rebranding), .gitignore (sessions/data/.env/node_modules never get committed).

## Build 41
- Colored console output (lib/clog.js, no package needed — raw ANSI codes): a boxed "✅ <bot> CONNECTED" card with build/startup/mode/prefix
  when a session connects, and a per-message debug trace (type, time, delay, sender, chat) like other well-known bots show in their console.
  Pure logging — nothing it prints is sent anywhere or touches secrets. Turn the per-message trace off with DEBUG_TRACE=0 in .env; turn colors
  off with NO_COLOR=1.

## Build 40
- More famous-bot commands: image effects sepia, pixelate, sketch; fun meters cute, handsome, beautiful, simp, genius, rich; couple, flirt;
  fliptext, hash, timezone; warns, unwarn; whois, quran, search (aliases google/ddg). Extra names: everyone, getid.

## Build 39
- `.vv` is now open to everyone (it was owner-only, so members got no answer); `.vv2` (send to your own chat) stays owner-only.
- `.jail @user [10m|2h|1d] [reason]`, `.unjail @user`, `.jailed`: a jailed member's messages are deleted until an admin frees them (needs the bot to be admin; admins can't be jailed).
- New menus `.animemenu` and `.gamemenu` (`.gamesmenu`) with the anime / game commands collected in one place; new anime commands manga, animechar, topanime, randomanime, animequote.

## Build 38
- Nexora AI (lib/nexoraai.js): `.nexora on|off|status|dm on|dm off|clear`. When on, the bot chats (with short memory per chat) with anyone who
  says "Nexora"/"Nemesis", @-tags the paired number, or replies to one of its messages. `dm on` = answer every DM. Never answers itself,
  commands, banned users, old messages or other Baileys bots. Brain: pollinations.ai text model (free, no key).

## Build 37
- New lib/cmds/famous.js: audio effects (bass, nightcore, slow, fast, reverseaudio, robot, deep, earrape, chipmunk), image effects
  (grayscale, invert, blurimg, mirror, cropcircle), AI chat `.ai` (gpt, chatgpt, gemini, ask) and AI pictures `.imagine` (dalle, draw)
  via pollinations.ai (no key), `.readmore`, `.gitclone`, `.totalmember`.
- Extra names from other bots: igdl, fbdl, tiktokdl, ytdl, ssweb, toqr, shorten, ghstalk, gcinfo, resetlink, listadmin, lyric.

## Build 36
- `.url` (aliases tourl, upload, tolink): reply to a photo/video/file (or send it with the caption) and get a public link; a typed link still downloads it.
- `.vv`: view-once messages you sent / opened yourself are kept too (they used to be skipped, so `.vv` said "usage").

## Build 35 (Baileys 7 test build)
- Runs on Baileys 7.0.0-rc13, which maps WhatsApp's new private-chat ids (lid) to numbers inside the library. Goal: no more
  "Waiting for this message" in the paired account's own chat. The own-chat redirect from Build 33 only runs on Baileys 6.
  Go back to Build 34 (Baileys 6.7.x) by putting "^6.7.9" in package.json and deleting node_modules/@whiskeysockets.

## Build 34
- Socket now keeps a device-list cache (`userDevicesCache`), like other well-known bots; sent-message memory for resend requests
  raised to 500 per session. The JSON store recreates `data/` if it was deleted while running (fixes the activity.json.tmp ENOENT crash).

## Build 33
- Own-chat reply redirect now finds the account's lid from `user.lid` OR the saved credentials (Build 31/32's check never fired:
  the console kept saying "sent text to lid"). Logs `[tx] own chat: sending to the number id` when it applies.

## Build 32
- Baileys' initial history sync is no longer switched off (`shouldSyncHistoryMessage` override removed). Other bots that answer
  right after pairing leave it on; with it off a new pairing could not decrypt chats until much later.

## Build 31
- Removed the own-phone "warm-up" added in Build 30: forcing a new encryption session right after connecting made the phone's
  own messages (and groups) undecryptable. Kept: replies to the account's own @lid chat go to its phone-number id.
- index.js reinstalls a dependency when package.json pins an exact version that differs from the installed one.

## Build 18
- YouTube downloads now try ytm.xcasper.space FIRST (no key needed): `.play .song .video .ytmp3 .ytmp4` ask it for the audio/video
  by video id (`/api/download/<id>` and `?format=mp4`). AlwaysRizz and the older providers stay as backups. Override the
  address with CASPER_API in .env if it ever moves.

## Build 17
- `.lock` now mutes the group (only admins can message) and `.unlock` opens it again. `.close` / `.open` still work as
  aliases. `.mute` and `.unmute` with NO name do the same; with a name or reply they still mute/unmute that one member.
  The old "only admins can edit group info" lock is now `.lockinfo` / `.unlockinfo`.
- 29 new commands (new file lib/cmds/extra.js), all keyless/free services:
  GROUP rules setrules disappear leave top afk | TOOLS tts ss lyrics github npm crypto |
  UTILITIES urban bible prayer anime recipe | FUN advice catfact dog cat slap hug kiss pat poke rps slot rate.

## Build 16
- FIX YouTube files that arrived but would not play ("video isn't available because something is wrong with the file",
  audio with 0:00): every download is now inspected. Web pages/JSON/playlists are rejected and the next link/provider is
  tried; webm/opus/AV1 etc. are converted to MP3 or H.264+AAC MP4 with ffmpeg. Console shows `[yt] rejected <link> — <why>`.
  Needs ffmpeg on the server (the `ffmpeg-static` package installs it with `npm install`).

## Build 15
- YouTube commands (`.play .song .video .ytmp3 .ytmp4`) now use the AlwaysRizz API first, then fall back to the older
  providers if it fails (one new file: lib/yt.js). TikTok / Instagram / Facebook / X / Pinterest etc. are untouched.
  Needs `RIZZ_KEY` and `RIZZ_USER` in the panel's .env (the key is NOT stored in the code). Mid-quality video is chosen so
  files stay small enough for WhatsApp. Failures print `[yt] <provider> failed ...` in the console.

## Build 14
- Bot host / main owner is now ONLY 254784747151 (config.js OWNER_NUMBER + OWNER_NUMBERS). The two other numbers are removed
  everywhere: they no longer have host rights (logs, shutdown, owner-only host commands) or appear in the menu/contact.

## Build 13
- FIX owner not recognised when WhatsApp shows a person (or your own number) as a `...@lid` id: the bot now resolves it to the
  phone number (key phone fields, own lid, Baileys lid map, group list), so owner/sudo commands work from your other
  number and in DMs. (Seen in logs as `[cmd] <acct>: .ping (user)` / `denied .logs`.)

## Build 12
- "View channel" is now a real button, not a link: replies are marked as forwarded from your WhatsApp channel, the same
  way a forwarded channel post looks (channel name on top, native "View channel" button under it). The bot looks the
  channel up from CHANNEL_URL once and prints `[channel] button linked to <name>`. Link text removed from the menu.

## Build 11
- `.menu` is now ONE message: the menu picture with the whole menu as its caption, in a richer look that uses bold, italic,
  strikethrough, monospace chips, quote bars, greeting by time of day and the "view channel" link at the bottom.
  Menu pictures are resized (720px, ~60 KB) so they upload fast. Falls back to a text card, then plain text.
- "Waiting for this message": the bot now always answers WhatsApp's resend request (empty message if the original is no
  longer cached) so the encryption session renews instead of staying stuck. Console prints the Baileys version at boot.

## Build 10
- New menu look (default `nexora`) plus 4 more designs, all plain WhatsApp text formatting so they show everywhere:
  `.setmenu design nexora|quote|mono|compact|classic` (per account).
- Every bot reply now carries a small "View channel" card linking to the WhatsApp channel (CHANNEL_URL in config.js);
  the menu uses the large version. The app link card, the `.app` command and the "get your own bot" line in `.ping` are gone.
- Reply cards use a 7 KB thumbnail instead of 14-36 KB so each reply is lighter and sends sooner.

## Build 9
- FIX `.menu` not answering: the business-style (interactive buttons) menu is accepted by WhatsApp but never shown on many
  accounts, so nothing appeared and the fallback never ran. Default is now `MENU_STYLE=classic` (large picture card with the
  full menu text, always shows). Interactive is still available with MENU_STYLE=interactive and now falls back after 15s.

## Build 8
- Console now logs every reply: `[tx] sent text to <chat type> id=…`, `[tx] FAILED …`, or `[tx] still sending … after 20s`.

## Build 7
- Diagnostics for "linked but not responding": console prints `[rx:<id>] type=… fromMe=… chat=… content=…` for the first
  15 incoming messages of each connection, and `[cmd] … unknown command` when a prefixed message matches nothing.

## Build 6
- Pairing: every account now identifies as Ubuntu + Chrome (the shape Baileys documents and reports confirm pairs); the
  Mac OS / Windows variants are dropped. Console now prints the WhatsApp Web version in use and, if a pairing socket
  closes early, `[pair:<id>] closed before link finished: code=… msg=…` so failures can be diagnosed.

## Build 5
- Telegram: channel/group join buttons now show ONLY on the lock screen. After verifying, the menu shows just
  SESSION / MY SESSIONS / TOOLS / OWNER.
- Telegram lock is now enforced on every command, button and pairing text (not only some). Membership is checked live
  each time, so leaving any channel/group locks the bot again on the next tap until the user rejoins.
  Only /start, /menu, /help, /version and the verify button stay open. The owner is never locked.

## Build 4
- FIX pairing ("Couldn't link device" on the phone after typing the code): the per-account device identity was written
  in the wrong order ([browser, OS] instead of Baileys' [OS, browser, version]), so WhatsApp got an invalid platform.
  Now `['Windows'|'Mac OS'|'Ubuntu', 'Chrome', version]` — always Chrome, only the OS varies.
- Pairing now starts from clean credentials (leftovers from a failed earlier attempt are wiped) and the code is requested
  the moment the WhatsApp connection is ready instead of after a fixed delay.

## Build 3
- Full WhatsApp command system: 204 commands in 8 categories (Download, Utilities, Tools, Fun & Games, Owner, Group,
  Moderation, Bot Info) + your existing Spam / Scam Shield extras. One file per category in `lib/cmds/`.
  Full table with who-can-use-what: `COMMANDS.md`. The menu builds itself from the command registry.
- Permissions: everyone / group admin (sender must be admin; bot admin checked where it acts) / owner+sudo / bot host.
  "Bot host" = the numbers in `config.OWNER_NUMBERS` (shutdown, logs). Every paired account owns its own bot:
  prefix, theme, footer, sudo list, banned users, auto-features are saved per account in `data/settings.json`.
- Group settings (welcome/goodbye texts, anti-features, warns, filters, blacklist, whitelist, mod logs) in `data/groups.json`.
- Cooldowns + flood limit per user, maintenance mode, banned users ignored, SSRF protection on every link-fetching command.
- Renamed to avoid clashes: group `setname`→`setgname`, old `report`→`reportwa`, old coin `flip`→`coinflip` (`flip` is now the
  image flip), `tag`→`tagall` (alias `tag`), `mute/unmute` now mute a *user* (`close/open` lock the whole group).
- Needs on the server: ffmpeg (or the optional `ffmpeg-static` package) for sticker/audio/video/image tools;
  `REMOVEBG_KEY` in `.env` for `removebg`. Everything else uses free keyless APIs.

## Build 2
- Telegram menu redone in your style: picture + quoted BOT INFO / COMMANDS boxes, coloured buttons.
- Must-join: your 7 channels as 2-per-row buttons — green ✅ when joined, blue when missing; "I HAVE JOINED" green.
  The check always runs through the MAIN bot (it must be admin in the channels), so sub-bots need no admin rights.
- Menu buttons: ➕ SESSION (help: `/reqpair 254xxxx`), 📂 MY SESSIONS, 🛠 TOOLS, 👑 OWNER (@Handsomeprimekillerkent, at the bottom).
- Every bot reply now carries 🏠 MENU + 👑 OWNER buttons.
- Tools menu: runtime, add bot, my bots, referral, and owner-only (🔒) users / broadcast / stats / active.
- New commands: `/reqpair <number>` `/delpair` `/session` `/mysession` `/runtime` `/owner` (public contact) `/addbot <token>`
  `/mybots` `/delbot @name`. Owner list moved to `/ownercmds`. Owner commands unchanged: `/broadcast` `/users` `/active`
  `/inactive` `/allusers` `/new` `/stats` `/id`.
- Sub-bots (`/addbot <token>`): the bot runs on the person's own token, same sessions/users, restarts with the server.
  Their token message is deleted. Main owner (ID 8195349331, built in) controls everything on every sub-bot.
  Tokens are stored in `data/subbots.json` — keep `data/` private. Limit per person: `MAX_SUBBOTS` (default 25).
- Code split: `lib/tgbot.js` (Telegram logic), `lib/ui.js` (buttons/look), `lib/subbots.js`; `bot.js` is just the boot file.

## Build 1
- New name, dev name, owner numbers (main 254782529625), WhatsApp group + 2 channels auto-join.
- 400+ sessions: staggered restore, reconnect jitter, lighter memory, `MAX_SESSIONS` (default 1000).
- 7 green Telegram must-join buttons next to the menu.
- WhatsApp interactive menu (picture + "Visit My Creator" + "See all options" list), per-category menus
  (`.menu group`, `.menu download` ...). Categories: main, group, admin, download, ai, search, convert, spam, fun, tools, fraud, music.
- Pictures: Telegram menu/gate = your 1st image (`assets/tg_menu.jpg`); WhatsApp menu = your 2nd + 3rd images, one picked
  at random per `.menu` (`assets/wa_menu_1.jpg`, `wa_menu_2.jpg`, add `wa_menu_3.jpg`... for more); Telegram pairing code =
  your 4th image (`assets/tg_pair.jpg`). To swap any picture, replace that file and restart.
- One look for every reply: plain bot replies are boxed (╭━━〔 ✦ name ✦ 〕━━⬣ ... dev tag), category menus are boxed too.
  `.say` still sends your exact text.
- Download category using prexzyapis.com all-in-one API: `.download` `.tiktok` `.instagram` `.facebook` `.twitter` `.pinterest` `.threads` `.ytmp4`

## Build 19
- New: 160+ commands (now 400+): reaction GIFs (.hug .kiss .pat .slap .cuddle … 40 actions) + anime pictures, 64 text/encoding tools, 44 math/finance tools, 26 web-info commands, `.vv` (open view-once), `.getpp .getbio .whoami .jid`, `.opentime/.closetime`, `.join .groups .online`, and more fun commands.
- Faster: `.ping` now answers with one immediate message.
- Long menus are sent in several messages so they always display.

## Build 20
- Menu is no longer split: `.menu` is ONE picture message with the bot info and a list of category menus.
- Each category has its own command: `.downloadmenu .toolsmenu .funmenu .reactmenu .textmenu .mathmenu .webmenu .groupmenu .ownermenu …` (also `.menu <category>`; `.menu all` prints everything).

## Build 21
- New default menu design "hub": a framed INFO BOT panel + a MAIN HUB panel listing `.all-menu .download-menu .tools-menu .fun-menu …` (also work without the dash). Category lists use the same frame. No bug menu. Old designs remain via `.setmenu design <name>`.

## Build 22
- Every category menu (`.fun-menu`, `.menu fun`, …) is now one picture message: a random picture (assets/cat_menu_*.jpg — drop more files named `cat_menu_<n>.jpg` to add pictures), the INFO BOT panel, the command list and a `↩️ BACK ➜ .menu` line. The main menu is unchanged.

## Build 23
- YouTube video limit raised from 30 min to 2h30m (`MAX_VIDEO_MIN`, default 150). File limit raised from 60 MB to 700 MB (`MAX_FILE_MB`).
- Big files are streamed to a temp file and sent from disk (not held in RAM), then deleted. Files over ~50 MB are only sent if already H.264+AAC mp4 (no re-encoding for big files).

## Build 24
- Each Telegram user can pair up to **10 WhatsApp numbers** (`MAX_SESSIONS_PER_USER`), counted across the main bot and all sub-bots. `/reqpair <number>` adds one (same number = re-pair), `/mysession` lists them as USED x / 10, `/delpair <number>` or `/delpair all` removes. A single session behaves exactly as before; existing sessions keep working.
- Sub-bots (`/addbot`): up to 10 per person (`MAX_SUBBOTS`, owners unlimited).
- Total capacity is `MAX_SESSIONS` (default 1000, so 500+ fits); sessions restore 10 at a time on startup.

## Build 25
- Fix: Telegram `/start` and `/menu` were silent because the text `<number>` in the command list was read as an HTML tag and Telegram rejected the message. Text fixed, and the home screen now retries as plain text if Telegram ever rejects the formatting.

## Build 26
- Fix `.vv`: the command crashed after downloading (`ctx.config` did not exist). It now also keeps a temporary RAM copy of every view-once photo/video/voice note that arrives while the bot is online (WhatsApp strips the media from the quoted copy once it is opened), so `.vv` works on those. `.vv2` sends the result only to your own chat.
- New automatic features (owner, saved per account): `.autoviewstatus`, `.autolikestatus` + `.statusemoji`, `.alwaysonline`, `.anticall on|off|block`, `.antidelete`, `.antiviewonce`, `.autorecording`, `.autobio` + `.setautobio`, `.autosettings` (panel). Existing: `.autoread`, `.autotyping`, `.autoreact`, `.autoreply` + `.setautoreply`.
- New `.tostatus`: post a replied-to photo/video/voice note, or text, to your own WhatsApp status.

## Build 27
- New **pairing website** for people without Telegram (lib/webpair.js, no new packages). Set `WEB_PORT` (or the panel's `PORT`) in `.env` and open `http://your-host:PORT/`: type the number, get the pairing code, enter it in WhatsApp → Linked Devices. Same sessions, same bot, same limit of 10 numbers per person (kept per browser with a private token). People can see their linked numbers and remove them on the page.
- Abuse protection (the code request makes WhatsApp notify that number): 5 requests per IP per hour (`WEB_IP_LIMIT`), 10 minutes per number, 30 s per browser, max 25 codes at once, hidden honeypot field, 2 KB request limit. `WEB_PAIR=off` disables it; `WEB_TRUST_PROXY=1` behind nginx/Cloudflare.

## Build 28
- Bot: secret-protected `/hub/*` API (`WEB_API_SECRET`) used by the new Vercel + Supabase website (Prime Kent Dev Hub). `WEB_PUBLIC=off` hides the built-in simple page. See the website's README.md.

## Build 29
- Website API part 2 (lib/hubapi.js, same `WEB_API_SECRET`): read/change a number's switches (`/hub/settings`, whitelisted keys only), reconnect without logging out (`/hub/reconnect`), post a text or photo status (`/hub/post-status`), and admin routes (`/hub/admin/overview|sessions|remove`, only when the Vercel site marks the caller as admin).
- `lib/wa.js`: new `getSock(id)` and `restart(id)`. `/hub/my` now also returns `pairedAt` and commands run.
