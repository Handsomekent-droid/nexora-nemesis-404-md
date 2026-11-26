/**
 * Tracks message IDs that OUR OWN code sent, from ANY paired WhatsApp session. All sessions run
 * in this one Node process, so this is shared across every paired account. Without this, one
 * paired account's own output (a warning, a menu, anything) can be seen by a DIFFERENT paired
 * account in the same group as "not fromMe" and get re-processed/re-flagged by that account —
 * two bot accounts can then start replying to each other's warnings forever. Checking this at
 * the very top of message handling stops that category of bug completely, for every feature.
 */
const ids = new Set();
const CAP = 1000;

function mark(id) {
  if (!id) return;
  ids.add(id);
  if (ids.size > CAP) ids.delete(ids.values().next().value);
}
const isOurs = (id) => ids.has(id);

module.exports = { mark, isOurs };
