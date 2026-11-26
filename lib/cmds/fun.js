/**
 * 🎮 FUN & GAMES — joke meme quote fact truth dare ship love character riddle trivia quiz guess roll
 * tictactoe hangman numbergame wouldyourather compliment roast.
 * (coinflip, dice, 8ball, choose already exist in commands.js.)
 *
 * Games reply to plain (non-prefixed) messages, so they register ONE message hook. Game state lives
 * in memory, per account + chat, with a TTL; a single unref'd timer sweeps expired games.
 */
const MAX_GAMES = 50;

/* ------------------------------ local content ------------------------------ */
const JOKES = [
  'Why don\'t scientists trust atoms? Because they make up everything.',
  'I told my computer I needed a break. It said: "No problem, I\'ll go to sleep."',
  'Why did the scarecrow win an award? He was outstanding in his field.',
  'What do you call fake spaghetti? An impasta.',
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'I would tell you a UDP joke, but you might not get it.',
  'Why was the math book sad? It had too many problems.',
  'What did the ocean say to the beach? Nothing, it just waved.',
  'Why did the bicycle fall over? It was two-tired.',
  'How does a penguin build its house? Igloos it together.',
  'I used to hate facial hair, but then it grew on me.',
  'What do you call cheese that isn\'t yours? Nacho cheese.',
  'Why can\'t your nose be 12 inches long? Because then it would be a foot.',
  'Parallel lines have so much in common. It\'s a shame they\'ll never meet.',
  'Why did the phone wear glasses? It lost its contacts.',
  'What\'s a computer\'s favourite snack? Microchips.'
];
const QUOTES = [
  ['The only way to do great work is to love what you do.', 'Steve Jobs'],
  ['It always seems impossible until it\'s done.', 'Nelson Mandela'],
  ['Whether you think you can, or you think you can\'t — you\'re right.', 'Henry Ford'],
  ['The best way to predict the future is to create it.', 'Peter Drucker'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['Success is the sum of small efforts repeated day in and day out.', 'Robert Collier'],
  ['You miss 100% of the shots you don\'t take.', 'Wayne Gretzky'],
  ['The journey of a thousand miles begins with a single step.', 'Lao Tzu'],
  ['What we think, we become.', 'Buddha'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['Fall seven times, stand up eight.', 'Japanese proverb'],
  ['Everything you can imagine is real.', 'Pablo Picasso'],
  ['Act as if what you do makes a difference. It does.', 'William James'],
  ['Courage is not the absence of fear, but the triumph over it.', 'Nelson Mandela'],
  ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci']
];
const FACTS = [
  'Honey never spoils — edible honey has been found in ancient Egyptian tombs.',
  'Octopuses have three hearts and blue blood.',
  'A day on Venus is longer than a year on Venus.',
  'Bananas are berries, but strawberries are not.',
  'The Eiffel Tower can grow about 15 cm taller in summer because metal expands in heat.',
  'Sharks existed before trees did.',
  'A group of flamingos is called a "flamboyance".',
  'Wombat droppings are cube-shaped.',
  'There are more possible chess games than atoms in the observable universe.',
  'Sound travels about four times faster in water than in air.',
  'Your stomach gets a new lining every few days.',
  'The shortest war in history lasted about 38 minutes (Anglo-Zanzibar War, 1896).',
  'Some turtles can breathe through their rear ends.',
  'Lightning is about five times hotter than the surface of the sun.',
  'Cows have best friends and get stressed when separated.',
  'The human brain uses roughly 20% of the body\'s energy.',
  'Mount Kilimanjaro is the tallest free-standing mountain in the world.',
  'Butterflies taste with their feet.',
  'A bolt of lightning can toast a slice of bread — in theory — with energy to spare.',
  'Antarctica is the largest desert on Earth.'
];
const TRUTHS = [
  'What is the most embarrassing thing you have done in public?', 'What is your biggest fear?',
  'What is the last lie you told?', 'Who was your first crush?', 'What is a secret talent nobody knows you have?',
  'What is the worst gift you ever received?', 'What is the silliest thing you are afraid of?',
  'Have you ever pretended to be sick to skip something? What was it?', 'What is your most-used app and how many hours a day?',
  'What is the weirdest dream you have ever had?', 'What is one habit you wish you could break?',
  'What is the most childish thing you still do?', 'Who in this chat do you text the most?',
  'What is your guilty-pleasure song?', 'What was your most awkward moment in school?',
  'What would you do with a million dollars in 24 hours?', 'What is the longest you have gone without a shower?',
  'What is the biggest mistake you have ever made?', 'What is something you are secretly proud of?',
  'If you could swap lives with someone for a day, who would it be?', 'What is your most irrational pet peeve?',
  'What food could you never give up?', 'What is the last thing you searched on your phone?',
  'What is the nicest thing someone has done for you?', 'When did you last cry, and why?',
  'What is one thing you would change about yourself?', 'What is the most trouble you have ever been in?',
  'What is a movie you pretended to like?', 'Have you ever laughed at the wrong moment? What happened?',
  'What is your hidden obsession?', 'What is the worst haircut you have ever had?',
  'What is the most spontaneous thing you have ever done?', 'Which of your friends would survive longest in the wild?',
  'What is your go-to excuse when you are late?', 'What is a rule you secretly love breaking?',
  'What is the strangest thing in your fridge right now?', 'What would your superhero name be?',
  'What is the most useless skill you have?', 'Who is the person you admire most and why?',
  'What do you do when nobody is watching?', 'What is one thing on your bucket list?',
  'What was the last thing that made you laugh out loud?'
];
const DARES = [
  'Send a voice note singing the chorus of your favourite song.', 'Change your profile picture to a funny face for 10 minutes.',
  'Type your next three messages using only emojis.', 'Do 15 jumping jacks and send proof (a voice note of you counting).',
  'Say the alphabet backwards in a voice note.', 'Talk in a robot voice for the next five minutes.',
  'Send the 7th photo in your gallery (only if you are comfortable).', 'Compliment every person in this chat.',
  'Write a two-line poem about the person above you.', 'Speak only in questions for the next three messages.',
  'Send a voice note doing your best animal impression.', 'Set your status to "I love Mondays" for an hour.',
  'Text your best friend "I just saw a purple cow" and share the reply.', 'Describe your day as a movie trailer.',
  'Do your best dance move and describe it in detail.', 'Send a selfie pulling your silliest (clean) face.',
  'Spell your full name using only emojis.', 'Tell the group your most embarrassing nickname.',
  'Say a tongue twister three times fast in a voice note.', 'Write a compliment for yourself in the third person.',
  'Make up a 10-second advert for a pencil.', 'Hum a song and let the group guess it.',
  'Send a message in rhyme.', 'Draw something on paper with your eyes closed and send it.',
  'Balance a spoon on your nose (or try for 30 seconds) and send proof.', 'Share the last emoji you used and explain why.',
  'Tell a joke — if nobody laughs you do 10 squats.', 'Speak in an accent of your choice for three messages.',
  'Send a voice note saying "good morning" in three different moods.', 'Name 10 fruits in 15 seconds.',
  'Let someone else write your next status.', 'Say something nice about the last person who messaged you.',
  'Pretend to be a news reporter and announce what you had for breakfast.', 'Type with your eyes closed: "I am a typing wizard".',
  'Do your best impression of a famous cartoon character.', 'Share your phone\'s screen-time number.',
  'Write the group a thank-you note in exactly 12 words.', 'Make up a handshake and describe it.',
  'Send a voice note laughing for 10 seconds straight.', 'Whisper-yell a sentence of your choice in a voice note.',
  'Find something blue near you and send a photo.', 'Tell the group one thing you are grateful for today.'
];
const RIDDLES = [
  ['What has keys but can\'t open locks?', 'piano'], ['What has hands but can\'t clap?', 'clock'],
  ['What gets wetter the more it dries?', 'towel'], ['What has a head and a tail but no body?', 'coin'],
  ['What can you catch but not throw?', 'cold'], ['I speak without a mouth and hear without ears. What am I?', 'echo'],
  ['What has to be broken before you can use it?', 'egg'], ['The more of me you take, the more you leave behind. What am I?', 'footsteps'],
  ['What has many teeth but can\'t bite?', 'comb'], ['What goes up but never comes down?', 'age'],
  ['What has one eye but can\'t see?', 'needle'], ['What can travel around the world while staying in a corner?', 'stamp'],
  ['What has a neck but no head?', 'bottle'], ['What building has the most stories?', 'library'],
  ['What is full of holes but still holds water?', 'sponge'], ['What comes once in a minute, twice in a moment, but never in a thousand years?', 'm'],
  ['What is always in front of you but can\'t be seen?', 'future'], ['What can fill a room but takes up no space?', 'light'],
  ['What begins with T, ends with T, and has T in it?', 'teapot'], ['What has four legs in the morning, two at noon and three in the evening?', 'man'],
  ['What invention lets you look right through a wall?', 'window'], ['What word becomes shorter when you add two letters to it?', 'short'],
  ['The person who makes it sells it. The buyer never uses it. The user never sees it. What is it?', 'coffin'],
  ['What runs but never walks, has a mouth but never talks?', 'river'], ['What has a thumb and four fingers but is not alive?', 'glove'],
  ['What can you break without touching it?', 'promise'], ['What is so fragile that saying its name breaks it?', 'silence'],
  ['I am tall when I am young and short when I am old. What am I?', 'candle'], ['What belongs to you but other people use it more than you?', 'name'],
  ['What month of the year has 28 days?', 'all'], ['What gets bigger the more you take away from it?', 'hole']
];
const WORDS = ['planet', 'rocket', 'jungle', 'island', 'castle', 'dragon', 'puzzle', 'garden', 'winter', 'summer', 'monkey', 'pencil',
  'bridge', 'candle', 'mirror', 'window', 'forest', 'guitar', 'butter', 'cookie', 'pepper', 'orange', 'purple', 'silver',
  'golden', 'lizard', 'turtle', 'rabbit', 'falcon', 'ticket', 'basket', 'camera', 'laptop', 'mobile', 'screen', 'switch',
  'wallet', 'ladder', 'hammer', 'anchor', 'pirate', 'wizard', 'knight', 'spider', 'beetle', 'cactus', 'desert', 'volcano',
  'thunder', 'rainbow', 'blanket', 'pillow', 'library', 'kitchen', 'balcony', 'chicken', 'giraffe', 'penguin', 'dolphin',
  'octopus', 'elephant', 'journey', 'diamond', 'compass', 'harvest', 'network', 'program', 'keyboard', 'battery', 'journal',
  'mystery', 'whisper', 'freedom', 'courage', 'rhythm', 'galaxy', 'meteor', 'eclipse', 'horizon', 'orchard', 'lantern',
  'festival', 'umbrella', 'treasure', 'football', 'bicycle', 'sandwich', 'mountain', 'universe', 'sunshine'];
const WYR = [
  'be able to fly or be invisible?', 'live without music or live without movies?', 'always be 10 minutes late or always be 20 minutes early?',
  'have unlimited money or unlimited time?', 'speak every language or talk to animals?', 'never use social media again or never watch TV again?',
  'live in the mountains or by the sea?', 'be famous or be rich and unknown?', 'have a rewind button or a pause button for your life?',
  'eat only pizza forever or never eat pizza again?', 'be the smartest person alive or the funniest?', 'travel to the past or to the future?',
  'have super strength or super speed?', 'lose your phone for a month or lose your wallet for a week?', 'always say what you think or never speak again?',
  'have a personal chef or a personal driver?', 'live in a treehouse or in a castle?', 'be able to teleport or read minds?',
  'have no homework/work forever or no weekends ever?', 'always be cold or always be hot?', 'have a pet dragon or a pet unicorn?',
  'fight one horse-sized duck or a hundred duck-sized horses?', 'know how you die or when you die?', 'be a master of one skill or okay at everything?',
  'have free WiFi everywhere or free coffee everywhere?', 'lose all your memories or never make new ones?', 'win the lottery or find your soulmate?',
  'wear socks with sandals forever or flip-flops in the snow?', 'live a quiet village life or a busy city life?', 'have a time machine or a teleporter?',
  'only whisper or only shout?', 'be stuck on an island with your best friend or alone with a million dollars?', 'never feel tired or never feel hungry?',
  'ride a rollercoaster daily or never ride one again?', 'have a talking cat or a talking dog?', 'be a superhero or a wizard?',
  'only eat sweet food or only salty food?', 'swap lives with a celebrity or with a cartoon character?', 'play every sport badly or one sport professionally?',
  'have a world without rain or without wind?', 'sleep on a cloud or on a hammock under the stars?', 'be able to breathe underwater or survive in space?'
];
const COMPLIMENTS = [
  'You have a way of making everyone feel welcome.', 'Your laugh is contagious.', 'You are more helpful than you realise.',
  'You make hard things look easy.', 'Your kindness does not go unnoticed.', 'You have great taste.',
  'You light up the chat when you show up.', 'You are a great listener.', 'Your ideas are brilliant.',
  'You bring out the best in people.', 'Your positivity is a superpower.', 'You are braver than you believe.',
  'You are the kind of friend everyone wishes they had.', 'Your creativity is inspiring.', 'You always know the right thing to say.',
  'You are seriously talented.', 'Your energy is amazing.', 'You make the world a little brighter.',
  'You have an incredible work ethic.', 'You are wiser than you give yourself credit for.', 'Your sense of humour is top tier.',
  'You handle challenges with grace.', 'You are dependable and that is rare.', 'You are doing better than you think.',
  'You make people feel understood.', 'Your style is unique and it works.', 'You are a problem-solving machine.',
  'You are generous in all the right ways.', 'You are a fantastic teammate.', 'Your curiosity is admirable.',
  'You are easy to talk to.', 'You make ordinary days feel special.', 'You have a heart of gold.',
  'You are an absolute legend.', 'You inspire people without even trying.', 'You deserve all the good things coming your way.',
  'You are patient and it shows.', 'Your voice matters.', 'You are the main character today.', 'You are proof that good people exist.'
];
const ROASTS = [
  'You are the human equivalent of a "low battery" notification.', 'Your WiFi password is probably "password" and it still disconnects.',
  'You have the confidence of someone who reads only the first line of the instructions.', 'You bring the energy of a phone at 1% — dramatic, but nobody is rushing to help.',
  'You are proof that autocorrect can\'t fix everything.', 'If procrastination were a sport, you would reschedule the final.',
  'You treat "reply later" like a personality trait.', 'You are like a cloud — when you disappear, it is a beautiful day. (Kidding. Mostly.)',
  'You have more unfinished projects than a hardware store has screws.', 'Your cooking skills make smoke alarms nervous.',
  'You say "five minutes" like it is a unit of time that exists.', 'You are the reason the group chat has a mute button.',
  'You have the navigation skills of a GPS on airplane mode.', 'You would lose an argument with a calculator.',
  'Your sense of direction is a plot twist waiting to happen.', 'You type "on my way" while still looking for your shoes.',
  'You are the type to read a book\'s ending first and still be surprised.', 'You are the main character in a cooking show — "Disasters in the Kitchen".',
  'Your alarm clock has given up on you.', 'You are like a software update — nobody asked for you, but here you are.',
  'You treat the snooze button like a cardio exercise.', 'You hold the world record for opening the fridge and forgetting why.',
  'Your gaming skills are a gift — to the other team.', 'You are the "I\'ll just have one snack" champion of the world.',
  'You have the memory of a goldfish with a busy schedule.', 'You would get lost in a one-room house.',
  'Your phone has 3,000 photos and none of them are in focus.', 'You are the reason "seen" was invented.',
  'You laugh at your own jokes because someone has to.', 'You have never won rock-paper-scissors in your life.',
  'You could trip over a wireless connection.', 'You are living proof that "ctrl+z" does not work on real life.',
  'You are unbeatable at one thing: being five minutes late.', 'Your dance moves look like a loading screen.',
  'You pack for a day trip like you are moving abroad.', 'You are the human version of a pop-up ad — hard to ignore, impossible to close.',
  'You say "I am almost there" from your bed.', 'You are so indecisive that a coin flip would need a second opinion.',
  'You use "LOL" more than you actually laugh.', 'You are a walking "I will do it tomorrow" sticker.'
];
const ROAST_SUFFIX = ' 😄 (just for fun!)';
const LOCAL_TRIVIA = [
  ['What is the capital of Kenya?', 'Nairobi', ['Mombasa', 'Kisumu', 'Nakuru']],
  ['Which planet is known as the Red Planet?', 'Mars', ['Venus', 'Jupiter', 'Mercury']],
  ['How many continents are there?', '7', ['5', '6', '8']],
  ['What is H2O commonly known as?', 'Water', ['Salt', 'Oxygen', 'Hydrogen']],
  ['Who wrote "Romeo and Juliet"?', 'William Shakespeare', ['Charles Dickens', 'Mark Twain', 'Jane Austen']],
  ['What is the largest ocean on Earth?', 'Pacific Ocean', ['Atlantic Ocean', 'Indian Ocean', 'Arctic Ocean']],
  ['How many sides does a hexagon have?', '6', ['5', '7', '8']],
  ['Which animal is the tallest in the world?', 'Giraffe', ['Elephant', 'Camel', 'Horse']],
  ['What gas do plants absorb from the air?', 'Carbon dioxide', ['Oxygen', 'Nitrogen', 'Helium']],
  ['What is the hardest natural substance?', 'Diamond', ['Gold', 'Iron', 'Quartz']],
  ['Which country has the city of Cairo?', 'Egypt', ['Morocco', 'Sudan', 'Libya']],
  ['What is the smallest prime number?', '2', ['1', '3', '0']],
  ['Which is the longest river in Africa?', 'Nile', ['Congo', 'Niger', 'Zambezi']],
  ['How many days are in a leap year?', '366', ['365', '364', '367']],
  ['What do bees make?', 'Honey', ['Milk', 'Silk', 'Wax paper']],
  ['Which planet has rings most famously?', 'Saturn', ['Mars', 'Earth', 'Neptune']],
  ['What is the freezing point of water in Celsius?', '0', ['10', '-10', '32']],
  ['Which language is spoken in Brazil?', 'Portuguese', ['Spanish', 'French', 'English']],
  ['What is the chemical symbol for gold?', 'Au', ['Ag', 'Gd', 'Go']],
  ['Who painted the Mona Lisa?', 'Leonardo da Vinci', ['Pablo Picasso', 'Vincent van Gogh', 'Michelangelo']],
  ['Mount Kilimanjaro is in which country?', 'Tanzania', ['Kenya', 'Uganda', 'Ethiopia']],
  ['How many players are on a football (soccer) team on the pitch?', '11', ['9', '10', '12']]
];
const LOCAL_CHARACTERS = [
  { name: 'Sherlock Holmes', about: 'A brilliant consulting detective from the stories of Arthur Conan Doyle, famous for his deductions and his friend Dr. Watson.' },
  { name: 'Alice', about: 'The curious girl who follows a white rabbit into Wonderland in Lewis Carroll\'s classic tale.' },
  { name: 'Count Dracula', about: 'The vampire nobleman of Transylvania from Bram Stoker\'s 1897 gothic novel.' },
  { name: 'Robin Hood', about: 'The legendary outlaw of English folklore who robbed from the rich to give to the poor.' },
  { name: 'Don Quixote', about: 'The dreamy knight-errant of Cervantes who tilts at windmills thinking they are giants.' },
  { name: 'Captain Nemo', about: 'The mysterious commander of the submarine Nautilus in Jules Verne\'s "Twenty Thousand Leagues Under the Seas".' },
  { name: 'Anansi', about: 'The clever spider trickster of West African and Caribbean folklore, master of stories and wit.' },
  { name: 'Peter Pan', about: 'The boy who never grows up, from J. M. Barrie\'s Neverland adventures.' }
];

/* ------------------------------ helpers ------------------------------ */
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const LETTERS = ['A', 'B', 'C', 'D'];
const decode = (s) => { try { return decodeURIComponent(s); } catch { return String(s); } };
function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
const bar = (pct) => `${'█'.repeat(Math.round(pct / 10))}${'░'.repeat(10 - Math.round(pct / 10))}`;

module.exports = (H) => {
  const { userPart, getTargets, http, hooks, frame } = H;
  const fun = { cat: 'fun', cooldown: 3 };
  const tag = (jid) => '@' + userPart(jid);

  /* ----- game state ----- */
  const games = new Map(); // `${acct}|${jid}|${type}` -> state
  const key = (acct, jid, type) => `${acct}|${jid}|${type}`;
  const countFor = (acct) => { let n = 0; for (const k of games.keys()) if (k.startsWith(acct + '|')) n++; return n; };
  const chatGames = (acct, jid) => { const p = `${acct}|${jid}|`; return [...games.entries()].filter(([k]) => k.startsWith(p)).map(([k, v]) => v); };
  // returns false (after telling the user) when this account already runs too many games
  const canStart = async (ctx, type) => {
    if (games.has(key(ctx.acct, ctx.jid, type))) return true; // restarting replaces it
    if (countFor(ctx.acct) >= MAX_GAMES) { await ctx.reply('⚠️ Too many games are running right now. Try again in a minute.'); return false; }
    return true;
  };
  const start = (ctx, type, state) => {
    const st = { type, acct: ctx.acct, jid: ctx.jid, rawSock: ctx.rawSock, ttl: state.ttl, expires: Date.now() + state.ttl, ...state };
    games.set(key(ctx.acct, ctx.jid, type), st);
    return st;
  };
  const end = (st) => games.delete(key(st.acct, st.jid, st.type));
  const touch = (st) => { st.expires = Date.now() + st.ttl; };
  const say = (st, text, mentions) => st.rawSock.sendMessage(st.jid, mentions?.length ? { text: frame(text), mentions } : { text: frame(text) }).catch(() => {});

  function sweep(now = Date.now()) {
    for (const [k, st] of [...games.entries()]) {
      if (st.expires > now) continue;
      let keep = false;
      try { keep = st.onExpire ? st.onExpire(st) === true : false; } catch (e) { console.error('[fun] expire', e?.message || 'unknown error'); }
      if (!keep) games.delete(k);
    }
  }
  const timer = setInterval(() => sweep(), 10000);
  timer.unref?.();

  /* ----- joke / meme / quote / fact ----- */
  const getJson = (url, opts) => http.getJson(url, { timeout: 15000, ...opts });

  async function fetchJoke() {
    try {
      const d = await getJson('https://v2.jokeapi.dev/joke/Any?safe-mode&blacklistFlags=nsfw,religious,political,racist,sexist,explicit');
      if (d && !d.error) {
        if (d.type === 'twopart' && d.setup) return `${d.setup}\n\n👉 ${d.delivery}`;
        if (d.joke) return d.joke;
      }
    } catch {}
    try {
      const d = await getJson('https://official-joke-api.appspot.com/random_joke');
      if (d?.setup && d?.punchline) return `${d.setup}\n\n👉 ${d.punchline}`;
    } catch {}
    return pickOne(JOKES);
  }
  async function fetchQuote() {
    try {
      const d = await getJson('https://zenquotes.io/api/random');
      const q = Array.isArray(d) ? d[0] : null;
      if (q?.q && q?.a) return `“${q.q}”\n— *${q.a}*`;
    } catch {}
    const [t, a] = pickOne(QUOTES);
    return `“${t}”\n— *${a}*`;
  }
  async function fetchFact() {
    try {
      const d = await getJson('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en');
      if (d?.text) return d.text;
    } catch {}
    return pickOne(FACTS);
  }

  /* ----- trivia / quiz (shared engine) ----- */
  async function fetchQuestions(n) {
    try {
      const d = await getJson(`https://opentdb.com/api.php?amount=${n}&type=multiple&encode=url3986`);
      if (d?.response_code === 0 && Array.isArray(d.results) && d.results.length) {
        return d.results.map((r) => {
          const correct = decode(r.correct_answer);
          const options = shuffle([correct, ...r.incorrect_answers.map(decode)]).slice(0, 4);
          return { q: decode(r.question), options, answer: options.indexOf(correct), category: decode(r.category), difficulty: r.difficulty };
        });
      }
    } catch {}
    return shuffle(LOCAL_TRIVIA).slice(0, n).map(([q, a, wrong]) => {
      const options = shuffle([a, ...wrong]);
      return { q, options, answer: options.indexOf(a), category: 'General', difficulty: 'easy' };
    });
  }
  const questionText = (st) => {
    const q = st.questions[st.idx];
    return `${st.series ? `Question ${st.idx + 1}/${st.questions.length}\n` : ''}📚 ${q.category}${q.difficulty ? ` · ${q.difficulty}` : ''}\n\n❓ ${q.q}\n\n` +
      q.options.map((o, i) => `*${LETTERS[i]}.* ${o}`).join('\n') + `\n\n_Reply with A, B, C or D — you have ${Math.round(st.ttl / 1000)}s._`;
  };
  const scoreboard = (st) => {
    const rows = [...st.scores.entries()].sort((a, b) => b[1] - a[1]);
    return rows.length ? rows.map(([n, p], i) => `${i + 1}. @${n} — ${p} pt${p === 1 ? '' : 's'}`).join('\n') : 'Nobody scored this time.';
  };
  const scoreMentions = (st) => [...st.scores.keys()].map((n) => `${n}@s.whatsapp.net`);
  function nextQuestion(st) {
    st.idx++;
    if (st.idx >= st.questions.length) {
      end(st);
      return say(st, `🏁 *Quiz finished!*\n\n${scoreboard(st)}`, scoreMentions(st));
    }
    st.answered = new Set();
    touch(st);
    return say(st, questionText(st));
  }
  async function startQuiz(ctx, n, series) {
    if (!(await canStart(ctx, 'quiz'))) return;
    const questions = await fetchQuestions(n);
    const st = start(ctx, 'quiz', {
      ttl: 60000, questions, idx: 0, series, scores: new Map(), answered: new Set(),
      onExpire: (s) => {
        const q = s.questions[s.idx];
        say(s, `⏰ Time's up! The answer was *${LETTERS[q.answer]}. ${q.options[q.answer]}*`);
        if (s.series && s.idx + 1 < s.questions.length) { nextQuestion(s); return true; }
        if (s.series) say(s, `🏁 *Quiz finished!*\n\n${scoreboard(s)}`, scoreMentions(s));
        return false;
      }
    });
    return ctx.reply(questionText(st));
  }

  /* ----- tic-tac-toe ----- */
  const NUM_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
  const boardText = (b) => [0, 3, 6].map((r) => b.slice(r, r + 3).map((c, i) => (c === 'X' ? '❌' : c === 'O' ? '⭕' : NUM_EMOJI[r + i])).join('')).join('\n');
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const winner = (b) => { for (const [x, y, z] of LINES) if (b[x] && b[x] === b[y] && b[x] === b[z]) return b[x]; return null; };

  /* ----- hangman ----- */
  const GALLOWS = [
    '  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========',
    '  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========',
    '  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========',
    '  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========',
    '  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========',
    '  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========',
    '  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n========='
  ];
  const hangText = (st) =>
    `\`\`\`${GALLOWS[st.wrong.size]}\`\`\`\n${[...st.word].map((c) => (st.guessed.has(c) ? c.toUpperCase() : '_')).join(' ')}\n\n` +
    `❌ Wrong (${st.wrong.size}/6): ${[...st.wrong].join(' ').toUpperCase() || '—'}`;

  /* ----- name helpers for ship / love / roast / compliment ----- */
  const cleanName = (s) => s.replace(/@\d+/g, '').replace(/[|&]/g, ' ').trim();
  function twoNames(ctx) {
    const t = getTargets(ctx.m, ctx.args);
    if (t.length >= 2) return { a: t[0], b: t[1], mentions: [t[0], t[1]], na: tag(t[0]), nb: tag(t[1]) };
    if (t.length === 1) { const me = ctx.sender || ctx.m.key.participant || ''; return { a: me, b: t[0], mentions: [me, t[0]].filter(Boolean), na: me ? tag(me) : 'You', nb: tag(t[0]) }; }
    const parts = ctx.text.split(/\s*(?:\||&|\band\b|\+|,)\s*/i).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) return { na: parts[0], nb: parts[1], mentions: [] };
    const words = ctx.text.split(/\s+/).filter(Boolean);
    if (words.length === 2) return { na: words[0], nb: words[1], mentions: [] };
    return null;
  }
  async function sayMention(ctx, text, mentions) {
    if (mentions?.length) return ctx.sock.sendMessage(ctx.jid, { text: frame(text), mentions }, { quoted: ctx.m });
    return ctx.reply(text);
  }

  /* ============================== the message hook ============================== */
  hooks.message.push(async (h) => {
    const { body, acct, jid } = h;
    if (!body || (h.prefix && body.startsWith(h.prefix))) return false;
    const mine = chatGames(acct, jid);
    if (!mine.length) return false;
    const text = body.trim();
    const get = (type) => mine.find((g) => g.type === type);

    // quiz / trivia: a single letter A-D
    const quiz = get('quiz');
    if (quiz && /^[a-d]$/i.test(text)) {
      if (quiz.answered.has(h.senderNum)) return true; // one try per person per question
      const q = quiz.questions[quiz.idx];
      const choice = text.toUpperCase().charCodeAt(0) - 65;
      if (choice >= q.options.length) return false;
      if (choice === q.answer) {
        quiz.scores.set(h.senderNum, (quiz.scores.get(h.senderNum) || 0) + 1);
        await h.sock.sendMessage(jid, { text: frame(`✅ Correct, @${h.senderNum}! The answer was *${LETTERS[q.answer]}. ${q.options[q.answer]}*`), mentions: [`${h.senderNum}@s.whatsapp.net`] }, { quoted: h.m });
        if (quiz.series) await nextQuestion(quiz); else end(quiz);
      } else {
        quiz.answered.add(h.senderNum);
        await h.reply(`❌ Not quite, @${h.senderNum} — others can still answer.`.replace('@' + h.senderNum, h.m.pushName || 'try again'));
      }
      return true;
    }

    // number mini-game: first correct answer wins (wrong answers fall through, e.g. to "guess")
    const ng = get('numbergame');
    if (ng && /^-?\d{1,6}$/.test(text) && Number(text) === ng.answer) {
      end(ng);
      await h.sock.sendMessage(jid, { text: frame(`⚡ *@${h.senderNum} got it first!* ${ng.question} = *${ng.answer}* 🎉`), mentions: [`${h.senderNum}@s.whatsapp.net`] }, { quoted: h.m });
      return true;
    }

    // tic-tac-toe: current player sends 1-9
    const ttt = get('ttt');
    if (ttt && /^[1-9]$/.test(text) && h.senderNum === ttt.players[ttt.turn]) {
      const cell = Number(text) - 1;
      if (ttt.board[cell]) { await h.reply('⚠️ That square is taken. Pick a free number.'); return true; }
      ttt.board[cell] = ttt.turn === 0 ? 'X' : 'O';
      touch(ttt);
      const w = winner(ttt.board);
      const mentions = ttt.players.map((p) => `${p}@s.whatsapp.net`);
      if (w) {
        end(ttt);
        await h.sock.sendMessage(jid, { text: frame(`${boardText(ttt.board)}\n\n🏆 *@${ttt.players[ttt.turn]} wins!*`), mentions }, { quoted: h.m });
      } else if (ttt.board.every(Boolean)) {
        end(ttt);
        await h.sock.sendMessage(jid, { text: frame(`${boardText(ttt.board)}\n\n🤝 *It's a draw!*`), mentions }, { quoted: h.m });
      } else {
        ttt.turn = 1 - ttt.turn;
        await h.sock.sendMessage(jid, { text: frame(`${boardText(ttt.board)}\n\nYour move @${ttt.players[ttt.turn]} (${ttt.turn === 0 ? '❌' : '⭕'}) — send a number 1-9.`), mentions }, { quoted: h.m });
      }
      return true;
    }

    // number guessing
    const gs = get('guess');
    if (gs && /^\d{1,3}$/.test(text)) {
      const n = Number(text);
      if (n < 1 || n > 100) { await h.reply('⚠️ Pick a number between 1 and 100.'); return true; }
      gs.tries++;
      touch(gs);
      if (n === gs.secret) {
        end(gs);
        await h.reply(`🎉 *Correct!* The number was *${gs.secret}* — you got it in ${gs.tries} ${gs.tries === 1 ? 'try' : 'tries'}.`);
      } else if (gs.tries >= gs.max) {
        end(gs);
        await h.reply(`💀 *Game over!* The number was *${gs.secret}*.`);
      } else {
        await h.reply(`${n < gs.secret ? '⬆️ Higher' : '⬇️ Lower'}! (${gs.max - gs.tries} ${gs.max - gs.tries === 1 ? 'try' : 'tries'} left)`);
      }
      return true;
    }

    // hangman: a single letter
    const hm = get('hangman');
    if (hm && /^[a-z]$/i.test(text)) {
      const c = text.toLowerCase();
      if (hm.guessed.has(c) || hm.wrong.has(c)) { await h.reply(`ℹ️ *${c.toUpperCase()}* was already guessed.`); return true; }
      touch(hm);
      if (hm.word.includes(c)) hm.guessed.add(c); else hm.wrong.add(c);
      const won = [...hm.word].every((x) => hm.guessed.has(x));
      if (won) { end(hm); await h.reply(`${hangText(hm)}\n\n🎉 *You win!* The word was *${hm.word.toUpperCase()}*.`); }
      else if (hm.wrong.size >= 6) { end(hm); await h.reply(`${hangText(hm)}\n\n💀 *You lose!* The word was *${hm.word.toUpperCase()}*.`); }
      else await h.reply(hangText(hm));
      return true;
    }

    // riddle: answer by typing it
    const rd = get('riddle');
    if (rd && text.length <= 60) {
      const n = norm(text);
      const a = norm(rd.answer);
      if (n && (n === a || n.split(' ').includes(a) || n.includes(a) && a.length > 3)) {
        end(rd);
        await h.sock.sendMessage(jid, { text: frame(`🧠 *Correct, @${h.senderNum}!* The answer is *${rd.answer}*.`), mentions: [`${h.senderNum}@s.whatsapp.net`] }, { quoted: h.m });
        return true;
      }
    }
    return false;
  });

  /* ============================== commands ============================== */
  return {
    joke: { ...fun, usage: 'joke', desc: 'a random clean joke', run: async (ctx) => ctx.reply(`😂 ${await fetchJoke()}`) },

    meme: {
      ...fun, usage: 'meme', desc: 'a random meme', cooldown: 5,
      run: async (ctx) => {
        let pick;
        for (let i = 0; i < 3 && !pick; i++) {
          try {
            const d = await getJson('https://meme-api.com/gimme');
            if (d?.url && !d.nsfw && !d.spoiler) pick = d;
          } catch { break; }
        }
        if (!pick) return ctx.reply('❌ Couldn\'t fetch a meme right now. Try again in a moment.');
        await ctx.sock.sendMessage(ctx.jid, { image: { url: pick.url }, caption: `😹 *${pick.title || 'Meme'}*\n${pick.subreddit ? `r/${pick.subreddit}` : ''}` }, { quoted: ctx.m });
      }
    },

    quote: { ...fun, usage: 'quote', desc: 'an inspiring quote', run: async (ctx) => ctx.reply(`💬 ${await fetchQuote()}`) },
    fact: { ...fun, usage: 'fact', desc: 'a random fact', run: async (ctx) => ctx.reply(`🧠 *Did you know?*\n${await fetchFact()}`) },
    truth: { ...fun, usage: 'truth', desc: 'a truth question', run: async (ctx) => ctx.reply(`🫢 *TRUTH*\n${pickOne(TRUTHS)}`) },
    dare: { ...fun, usage: 'dare', desc: 'a dare challenge', run: async (ctx) => ctx.reply(`🔥 *DARE*\n${pickOne(DARES)}`) },
    wouldyourather: { ...fun, usage: 'wouldyourather', desc: 'would you rather…', aliases: ['wyr'], run: async (ctx) => ctx.reply(`🤔 *WOULD YOU RATHER*\n${pickOne(WYR)}\n\n_Vote by replying A or B._`.replace('Vote by replying A or B.', 'Reply with your pick!')) },

    ship: {
      ...fun, usage: 'ship @a @b', desc: 'love match percentage',
      run: async (ctx) => {
        const n = twoNames(ctx);
        if (!n) return ctx.reply(`${H.usage('ship @user1 @user2')}\nor ${H.usage('ship name1 name2')}`);
        const key2 = [norm(n.na), norm(n.nb)].sort().join('+');
        const pct = hash(key2 + ':ship') % 101;
        const msg = pct >= 90 ? 'Soulmates! Start planning the wedding 💍' : pct >= 70 ? 'A beautiful match 💞' : pct >= 50 ? 'There is potential here 💫' : pct >= 30 ? 'Needs some work… 🌱' : 'Better as friends 😅';
        return sayMention(ctx, `💘 *SHIP*\n${n.na} ❤️ ${n.nb}\n\n${bar(pct)} *${pct}%*\n${msg}`, n.mentions);
      }
    },

    love: {
      ...fun, usage: 'love name1 name2', desc: 'love compatibility meter',
      run: async (ctx) => {
        const n = twoNames(ctx);
        if (!n) return ctx.reply(`${H.usage('love name1 name2')}\nExample: ${H.P()}love Amina | Juma`);
        const key2 = [norm(n.na), norm(n.nb)].sort().join('&');
        const pct = hash(key2 + ':love') % 101;
        const verdict = pct >= 85 ? '🔥 Perfect harmony' : pct >= 60 ? '💖 Strong connection' : pct >= 40 ? '🌤 Could grow with time' : '🧊 Opposites… maybe?';
        return sayMention(ctx, `💗 *LOVE METER*\n${n.na} + ${n.nb}\n\n${bar(pct)} *${pct}%*\n${verdict}\n_(just for fun!)_`, n.mentions);
      }
    },

    character: {
      ...fun, usage: 'character', desc: 'a random character', cooldown: 5,
      run: async (ctx) => {
        try {
          const d = (await getJson('https://api.jikan.moe/v4/random/characters'))?.data;
          if (d?.name) {
            const about = String(d.about || 'No description available.').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
            const caption = `🎭 *${d.name}*${d.name_kanji ? ` (${d.name_kanji})` : ''}\n❤️ Favourites: ${d.favorites ?? 0}\n\n${about.length > 600 ? about.slice(0, 600).trimEnd() + '…' : about}${d.url ? `\n\n🔗 ${d.url}` : ''}`;
            const img = d.images?.jpg?.image_url;
            return img ? await ctx.sock.sendMessage(ctx.jid, { image: { url: img }, caption }, { quoted: ctx.m }) : await ctx.reply(caption);
          }
        } catch {}
        const c = pickOne(LOCAL_CHARACTERS);
        return ctx.reply(`🎭 *${c.name}*\n\n${c.about}`);
      }
    },

    riddle: {
      ...fun, usage: 'riddle', desc: 'a riddle — type the answer; "riddle answer" reveals it',
      run: async (ctx) => {
        const sub = (ctx.args[0] || '').toLowerCase();
        const cur = games.get(key(ctx.acct, ctx.jid, 'riddle'));
        if (sub === 'answer' || sub === 'reveal' || sub === 'giveup') {
          if (!cur) return ctx.reply(`No riddle is running. Start one with ${H.P()}riddle`);
          end(cur);
          return ctx.reply(`💡 The answer was *${cur.answer}*.`);
        }
        if (cur) return ctx.reply(`🧩 *Riddle (still open)*\n${cur.q}\n\n_Type your answer, or ${H.P()}riddle answer to reveal it._`);
        if (!(await canStart(ctx, 'riddle'))) return;
        const [q, answer] = pickOne(RIDDLES);
        start(ctx, 'riddle', {
          ttl: 120000, q, answer,
          onExpire: (s) => { say(s, `⏰ Time's up! The riddle answer was *${s.answer}*.`); return false; }
        });
        return ctx.reply(`🧩 *RIDDLE*\n${q}\n\n_Type your answer in the chat (2 min), or ${H.P()}riddle answer to reveal it._`);
      }
    },

    trivia: {
      ...fun, usage: 'trivia', desc: 'one trivia question (answer A-D)', cooldown: 5,
      run: async (ctx) => startQuiz(ctx, 1, false).catch((e) => { console.error('[trivia]', e?.message || 'unknown error'); return ctx.reply('❌ Could not start trivia right now.'); })
    },
    quiz: {
      ...fun, usage: 'quiz [1-5]', desc: 'a quiz of up to 5 questions with a scoreboard', cooldown: 5,
      run: async (ctx) => {
        const raw = ctx.args[0];
        let n = 5;
        if (raw !== undefined) {
          if (!/^\d+$/.test(raw) || Number(raw) < 1) return ctx.reply(H.usage('quiz [1-5]'));
          n = Math.min(Number(raw), 5);
        }
        return startQuiz(ctx, n, true).catch((e) => { console.error('[quiz]', e?.message || 'unknown error'); return ctx.reply('❌ Could not start the quiz right now.'); });
      }
    },

    guess: {
      ...fun, usage: 'guess', desc: 'guess the number 1-100 (8 tries)',
      run: async (ctx) => {
        if (ctx.args[0]?.toLowerCase() === 'end' || ctx.args[0]?.toLowerCase() === 'stop') {
          const cur = games.get(key(ctx.acct, ctx.jid, 'guess'));
          if (!cur) return ctx.reply('No guessing game is running.');
          end(cur);
          return ctx.reply(`🛑 Stopped. The number was *${cur.secret}*.`);
        }
        if (!(await canStart(ctx, 'guess'))) return;
        start(ctx, 'guess', { ttl: 5 * 60 * 1000, secret: 1 + Math.floor(Math.random() * 100), tries: 0, max: 8 });
        return ctx.reply('🔢 *GUESS THE NUMBER*\nI am thinking of a number from 1 to 100.\nYou have *8* tries — just send a number!');
      }
    },

    roll: {
      ...fun, usage: 'roll [NdM]', desc: 'roll dice, e.g. 2d6', cooldown: 2,
      run: async (ctx) => {
        const arg = (ctx.args[0] || '1d6').toLowerCase();
        const m = arg.match(/^(\d{1,2})?d(\d{1,4})$/) || arg.match(/^()(\d{1,4})$/);
        if (!m) return ctx.reply(`${H.usage('roll [NdM]')}\nExample: ${H.P()}roll 2d6 (N up to 20, M up to 1000)`);
        const count = m[1] ? Number(m[1]) : 1;
        const sides = Number(m[2]);
        if (count < 1 || count > 20) return ctx.reply('⚠️ You can roll between 1 and 20 dice.');
        if (sides < 2 || sides > 1000) return ctx.reply('⚠️ Dice need between 2 and 1000 sides.');
        const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
        const total = rolls.reduce((a, b) => a + b, 0);
        return ctx.reply(`🎲 *${count}d${sides}*\n${rolls.join(' + ')}${count > 1 ? `\n\nTotal: *${total}*` : ''}`);
      }
    },

    tictactoe: {
      ...fun, usage: 'tictactoe @opponent', desc: 'play tic-tac-toe (end with "tictactoe end")', aliases: ['ttt'], cooldown: 3,
      run: async (ctx) => {
        const cur = games.get(key(ctx.acct, ctx.jid, 'ttt'));
        const sub = (ctx.args[0] || '').toLowerCase();
        if (sub === 'end' || sub === 'stop') {
          if (!cur) return ctx.reply('No tic-tac-toe game is running here.');
          if (!cur.players.includes(ctx.senderNum) && ctx.rank < 1) return ctx.reply('⚠️ Only the players can end the game.');
          end(cur);
          return ctx.reply('🛑 Tic-tac-toe ended.');
        }
        if (cur) return ctx.sock.sendMessage(ctx.jid, { text: frame(`🎮 A game is already running:\n\n${boardText(cur.board)}\n\n@${cur.players[cur.turn]} to move.`), mentions: cur.players.map((p) => `${p}@s.whatsapp.net`) }, { quoted: ctx.m });
        let opp = getTargets(ctx.m, ctx.args)[0];
        let p2;
        if (opp) p2 = userPart(opp);
        else if (!ctx.isGroup) p2 = userPart(ctx.jid) === ctx.senderNum ? ctx.acct : userPart(ctx.jid); // DM: play against the other side of the chat
        if (!p2) return ctx.reply(`${H.usage('tictactoe @opponent')} (or reply to their message)`);
        if (p2 === ctx.senderNum) return ctx.reply('⚠️ You need a different opponent.');
        if (!(await canStart(ctx, 'ttt'))) return;
        const st = start(ctx, 'ttt', { ttl: 10 * 60 * 1000, board: Array(9).fill(null), players: [ctx.senderNum, p2], turn: 0 });
        return ctx.sock.sendMessage(ctx.jid, {
          text: frame(`🎮 *TIC-TAC-TOE*\n❌ @${st.players[0]}  vs  ⭕ @${st.players[1]}\n\n${boardText(st.board)}\n\n@${st.players[0]} starts — send a number 1-9.`),
          mentions: st.players.map((p) => `${p}@s.whatsapp.net`)
        }, { quoted: ctx.m });
      }
    },

    hangman: {
      ...fun, usage: 'hangman', desc: 'guess the word letter by letter', cooldown: 3,
      run: async (ctx) => {
        const sub = (ctx.args[0] || '').toLowerCase();
        const cur = games.get(key(ctx.acct, ctx.jid, 'hangman'));
        if (sub === 'end' || sub === 'stop') {
          if (!cur) return ctx.reply('No hangman game is running.');
          end(cur);
          return ctx.reply(`🛑 Stopped. The word was *${cur.word.toUpperCase()}*.`);
        }
        if (cur) return ctx.reply(`${hangText(cur)}\n\n_Send a single letter to guess._`);
        if (!(await canStart(ctx, 'hangman'))) return;
        const st = start(ctx, 'hangman', { ttl: 10 * 60 * 1000, word: pickOne(WORDS), guessed: new Set(), wrong: new Set() });
        return ctx.reply(`🪢 *HANGMAN*\n${hangText(st)}\n\n_Send a single letter to guess (6 mistakes allowed)._`);
      }
    },

    numbergame: {
      ...fun, usage: 'numbergame', desc: 'quick-math race: first right answer wins (30s)', cooldown: 3,
      run: async (ctx) => {
        if (!(await canStart(ctx, 'numbergame'))) return;
        const ops = ['+', '-', '×'];
        const op = pickOne(ops);
        let a = 2 + Math.floor(Math.random() * (op === '×' ? 11 : 60));
        let b = 2 + Math.floor(Math.random() * (op === '×' ? 11 : 60));
        if (op === '-' && b > a) [a, b] = [b, a];
        const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
        const question = `${a} ${op} ${b}`;
        start(ctx, 'numbergame', {
          ttl: 30000, question, answer,
          onExpire: (s) => { say(s, `⏰ Nobody got it! ${s.question} = *${s.answer}*`); return false; }
        });
        return ctx.reply(`⚡ *QUICK MATH*\nWhat is *${question}* ?\n\n_First correct answer in 30 seconds wins!_`);
      }
    },

    compliment: {
      ...fun, usage: 'compliment @user', desc: 'send a kind compliment',
      run: async (ctx) => {
        const t = getTargets(ctx.m, ctx.args)[0];
        const name = t ? tag(t) : (cleanName(ctx.text) || '');
        const to = name || 'you';
        return sayMention(ctx, `💐 *COMPLIMENT*\n${name ? `Hey ${to}! ` : ''}${pickOne(COMPLIMENTS)}`, t ? [t] : []);
      }
    },

    roast: {
      ...fun, usage: 'roast @user', desc: 'a light-hearted, harmless roast', cooldown: 4,
      run: async (ctx) => {
        const t = getTargets(ctx.m, ctx.args)[0];
        const name = t ? tag(t) : cleanName(ctx.text);
        if (!name) return ctx.reply(`${H.usage('roast @user')} (or reply to their message)`);
        return sayMention(ctx, `🔥 *ROAST*\n${name}, ${pickOne(ROASTS).replace(/^You/, 'you').replace(/^Your/, 'your')}${ROAST_SUFFIX}`, t ? [t] : []);
      }
    }
  };
};

// exposed for tests only
module.exports.__lists = { JOKES, QUOTES, FACTS, TRUTHS, DARES, RIDDLES, WORDS, WYR, COMPLIMENTS, ROASTS, LOCAL_TRIVIA };
