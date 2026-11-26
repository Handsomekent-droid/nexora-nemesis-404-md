/**
 * Shared Jikan (MyAnimeList) fetcher used by every anime/manga command (lib/cmds/extra.js's `.anime`
 * and lib/cmds/famous.js's `.manga`/`.animechar`/`.topanime`/`.randomanime`).
 *
 * Jikan's public API is free but STRICTLY rate-limited (3 req/s, 60/min) and shared-hosting panels
 * often share one outbound IP across many tenants, so 429s are common — not a sign the bot is broken.
 * This retries once on 429/5xx with a short backoff, and throws an Error whose .message already says
 * WHICH of "rate-limited" / "down right now" / "couldn't be reached" happened, instead of commands all
 * showing the same generic "not found" regardless of whether anything was actually found or not.
 */
const axios = require('axios');

async function jikan(path, { retries = 1 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await axios.get(`https://api.jikan.moe/v4${path}`, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      return r.data;
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      if (i < retries && (status === 429 || (status >= 500 && status < 600))) {
        await new Promise((res) => setTimeout(res, status === 429 ? 2000 * (i + 1) : 800));
        continue;
      }
      break;
    }
  }
  const status = lastErr?.response?.status;
  const err = new Error(
    status === 429 ? '⏳ The anime database is rate-limiting this server right now (it does that under heavy shared traffic). Wait ~10s and try again.' :
    status >= 500 ? '🛠 The anime database (MyAnimeList/Jikan) is down or overloaded right now. Try again in a minute.' :
    status ? `❌ The anime database returned an error (HTTP ${status}).` :
    '❌ Could not reach the anime database — check the server\'s network/outbound access.'
  );
  err.jikanStatus = status || null;
  throw err;
}

module.exports = { jikan };
