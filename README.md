<div align="center">

<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:000000,50:8b0000,100:000000&height=220&section=header&text=NEXORA%20NEMESIS%20404%20MD&fontSize=46&fontColor=ff1a1a&animation=twinkling&fontAlignY=36&desc=450%2B%20Commands%20·%20WhatsApp%20%2B%20Telegram%20·%20Self-Hosted&descAlignY=56&descSize=18&descColor=f5f5f5" alt="Nexora Nemesis 404 MD banner">

<a href="https://github.com/Handsomekent-droid/nexora-nemesis-404-md">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=700&size=26&duration=2500&pause=900&color=FF1A1A&center=true&vCenter=true&width=700&height=50&lines=%F0%9F%92%80+NEXORA+NEMESIS+%E2%80%A2+%2404+MD;450%2B+Commands+.+Zero+Mercy;Multi-Session+%E2%80%A2+1000+Numbers;Self-Hosted+%E2%80%A2+No+Leaks" alt="Typing SVG" />
</a>

**A WhatsApp bot with 450+ commands** — downloads · groups · fun · games · anime · an AI chatbot · and more.
Built on [Baileys](https://github.com/WhiskeySockets/Baileys).

[![License](https://img.shields.io/badge/license-see%20LICENSE.md-red?style=for-the-badge&logo=gitbook&logoColor=white)](LICENSE.md)
[![Node](https://img.shields.io/badge/node-%3E%3D18-success?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Build](https://img.shields.io/badge/build-49-critical?style=for-the-badge&logo=github)](CHANGELOG.md)
[![Commands](https://img.shields.io/badge/commands-450%2B-orange?style=for-the-badge&logo=whatsapp&logoColor=white)](COMMANDS.md)
[![Status](https://img.shields.io/badge/status-online-brightgreen?style=for-the-badge&logo=statuspage&logoColor=white)](#)

<img width="100%" src="https://capsule-render.vercel.app/api?type=rect&color=0:8b0000,100:000000&height=3" alt="divider">

</div>

---

> [!WARNING]
> **Use a spare WhatsApp number, never your main one.** WhatsApp can ban numbers that automate
> messages — that risk is entirely yours. See [LICENSE.md](LICENSE.md) for the full terms.

## 🚀 Steps to Deploy

### Step 1: Fork the Repository

Click the button below to fork this repo to your own GitHub account:

<p>
<a href="../../fork"><img src="https://img.shields.io/badge/FORK-REPOSITORY-1f6feb?style=for-the-badge&logo=github" alt="Fork Repository"></a>
</p>

### Step 2: Get Your Number Paired

Two ways — pick whichever is easier for you:

<p>
<a href="https://prime-kent-hub.vercel.app/pair"><img src="https://img.shields.io/badge/PAIR-ON%20THE%20WEBSITE-25D366?style=for-the-badge&logo=whatsapp" alt="Pair on the website"></a>
<a href="#-deploy-on-a-panel-pterodactyl-etc"><img src="https://img.shields.io/badge/PAIR-FROM%20YOUR%20OWN%20PANEL-blueviolet?style=for-the-badge" alt="Pair from your own panel"></a>
</p>

**Easiest:** use the hosted pairing website above — enter your number, get a code, done, no server needed.
**Self-hosting instead?** Deploy the bot (Step 3) — its *console* will ask you for the number directly, no separate "creds.json" step needed.

### Step 3: Deploy Now

<p>
<a href="#-deploy-on-a-panel-pterodactyl-etc"><img src="https://img.shields.io/badge/DEPLOY-TUTORIAL-ff4757?style=for-the-badge&logo=youtube" alt="Deploy Tutorial"></a>
<a href="https://t.me/NexoraNemesisXBot"><img src="https://img.shields.io/badge/DEPLOY-EASIEST%20(TELEGRAM)-2CA5E0?style=for-the-badge&logo=telegram" alt="Deploy via Telegram"></a>
</p>

Full panel steps are below, under **[🚀 Deploy on a panel](#-deploy-on-a-panel-pterodactyl-etc)**.

### Join Us

<p>
<a href="https://t.me/NexoraNemesisXBot"><img src="https://img.shields.io/badge/JOIN-TELEGRAM-2CA5E0?style=for-the-badge&logo=telegram" alt="Join Telegram"></a>
<a href="https://wa.me/254784747151"><img src="https://img.shields.io/badge/JOIN-WHATSAPP-25D366?style=for-the-badge&logo=whatsapp" alt="Join WhatsApp"></a>
</p>

---

## ⚙️ Features

- **Self-service pairing** — anyone can send `.pair 254xxxxxxxxx` to any live copy of the bot to link their own number, no panel/Telegram/website needed
- **Privacy mode** — `.self` makes the bot answer only you; `.public` opens it back up to everyone
- **Tag all group members** with `.tagall` / `.hidetag`
- **Admin-restricted commands** — kick, promote, mute, and more work only for group admins
- **🚔 Jail system** — `.jail @user` auto-deletes everything a jailed member sends until `.unjail`
- **🤖 Nexora AI** — a chatbot that replies when it's tagged or named, even while you're offline
- **Games** — tic-tac-toe, hangman, trivia, riddles, rock-paper-scissors, and more
- **🎌 Anime menu** — waifu/neko pictures, manga & character lookups, anime quotes
- **Sticker & media tools** — `.sticker`, `.toimg`, `.tourl`, audio/image effects (bass, nightcore, sepia, pixelate...)
- **Anti-link & anti-delete** for group safety, plus a full warning system
- **Downloads** — YouTube, TikTok, Instagram, Facebook, GitHub repos
- **450+ commands total** — see the full, always up to date list in **[COMMANDS.md](COMMANDS.md)**

---

## 🚀 Deploy on a panel (Pterodactyl, etc.)

> [!TIP]
> No `.env` editing is required for the basics below — every setting has a safe default.

1. Create a **Node.js 18+** server/egg on your panel.
2. Upload this zip (or `git clone` your fork), then unarchive it so `index.js` sits in the server's root folder.
3. Set the **Startup Command** to `node index.js` (most Node eggs already do this).
4. Press **Start**. The console installs what it needs, then prints:

   ```
   📟 FIRST-TIME SETUP
   📱 WhatsApp number:
   ```

5. Type your WhatsApp number — **country code, digits only** (example `254712345678`) — into the
   panel's command box and press **Enter**.
6. A pairing code appears in the console:

   ```
   ━ 🔑 PAIRING CODE ━
   » AB12-CD34
   ```

   On that phone: **WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number instead**, then type the code.
7. Once linked, send `.menu` to the bot from any chat. 🎉

<details>
<summary>💻 Deploy on your own computer / VPS instead</summary>

```bash
git clone <your fork's URL>
cd nexora-nemesis-404-md
node index.js
```

Then follow step 5 onward above.
</details>

<details>
<summary>🧩 Optional <code>.env</code> settings (click to expand)</summary>

Nothing here is required for a working bot — set a value only to unlock that feature.

| Variable | Unlocks |
|---|---|
| `BOT_TOKEN` | A Telegram control bot (pair/manage numbers from Telegram, not just the console) |
| `REMOVEBG_KEY` | `.removebg` |
| `RIZZ_KEY` / `RIZZ_USER` | `.play` / `.song` / `.video` YouTube downloads |
| `WEB_PORT` | A small built-in pairing website |

Every setting is commented in **[.env.example](.env.example)**.
</details>

## 🔁 Updating

Download the newest release zip, unarchive it over your files, and restart.

> [!NOTE]
> This **never touches** your `sessions/` or `data/` folders — your pairing and settings are safe.

## 📜 License

Free to self-host — **[read LICENSE.md](LICENSE.md)** before you redistribute or rebrand it.
In short: keep the credit, don't resell it, don't rebrand it as your own.

## 🙏 Credit

<div align="center">

Built and maintained by **『𖤍ᴏᴠ』𝟑ˣ𝟑ᴄᴜ́ᴛᴏʀ_⁴⁰⁴_ᴋᴇɴᴛ**
Found a bug, or want a command added? **[wa.me/254784747151](https://wa.me/254784747151)** · [@NexoraNemesisXBot](https://t.me/NexoraNemesisXBot)

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=16&duration=3000&pause=1200&color=8B0000&center=true&vCenter=true&width=600&height=35&lines=%E2%80%A2+no+leaks+%E2%80%A2+no+resale+%E2%80%A2+just+code+%E2%80%A2" alt="footer typing" />

<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:000000,50:8b0000,100:000000&height=120&section=footer&animation=twinkling" alt="footer banner">

</div>
