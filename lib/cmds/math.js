/**
 * MATH & CONVERTERS (cat math) — all offline, no API.
 *   Money   : tip percent percentof percentchange discount vat interest compound emi split profit
 *   Shapes  : circle area volume pythagoras quadratic
 *   Numbers : fibonacci prime primefactors factorial gcd lcm sqrt power average median sum stats roman numwords
 *             tobin frombin tohex fromhex tooct
 *   Dates   : age dayofweek leapyear zodiac daysbetween countdown newyear
 *   Health  : bmi bmr water
 */
module.exports = (H) => {
  const { usage } = H;
  const P = () => H.P();
  const out = {};
  const def = (name, u, desc, fn, extra = {}) => {
    out[name] = {
      cat: 'math', access: 'public', cooldown: 2, usage: `${name} ${u}`.trim(), desc, aliases: extra.aliases,
      run: async (ctx) => {
        try {
          const r = await fn(ctx);
          if (r) await ctx.reply(r);
        } catch (e) {
          if (e && e.usage) return ctx.reply(`${usage(`${name} ${u}`.trim())}${e.example ? `\nExample: ${P()}${e.example}` : ''}`);
          await ctx.reply(`❌ ${e?.message || 'Could not calculate that.'}`);
        }
      }
    };
  };
  const need = (example) => { const e = new Error('usage'); e.usage = true; e.example = example; return e; };
  const nums = (ctx, min = 1, example) => {
    const v = ctx.args.map((a) => Number(String(a).replace(/,/g, '')));
    if (v.length < min || v.some((x) => !Number.isFinite(x))) throw need(example);
    return v;
  };
  const f = (n, d = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });

  /* ---------- money ---------- */
  def('percent', '<percent> <of number>', 'x% of a number', (c) => { const [p, n] = nums(c, 2, 'percent 15 200'); return `🧮 ${f(p)}% of ${f(n)} = *${f(p * n / 100, 4)}*`; });
  def('percentof', '<a> <b>', 'a is what percent of b', (c) => { const [a, b] = nums(c, 2, 'percentof 30 200'); if (!b) throw new Error('b cannot be 0'); return `🧮 ${f(a)} is *${f(a / b * 100, 4)}%* of ${f(b)}`; });
  def('percentchange', '<old> <new>', 'percent increase or decrease', (c) => { const [a, b] = nums(c, 2, 'percentchange 80 100'); if (!a) throw new Error('old value cannot be 0'); const ch = (b - a) / Math.abs(a) * 100; return `${ch >= 0 ? '📈 Increase' : '📉 Decrease'} of *${f(Math.abs(ch), 4)}%* (${f(a)} → ${f(b)})`; });
  def('discount', '<price> <percent off>', 'price after a discount', (c) => { const [p, d] = nums(c, 2, 'discount 2500 20'); return `🏷 Price: ${f(p)}\nDiscount: ${f(d)}% (−${f(p * d / 100)})\n*You pay: ${f(p - p * d / 100)}*`; });
  def('tip', '<bill> [percent] [people]', 'tip and bill split', (c) => { const [b, pc = 10, n = 1] = nums(c, 1, 'tip 4500 10 3'); const tip = b * pc / 100; return `🍽 Bill: ${f(b)}\nTip (${f(pc)}%): ${f(tip)}\n*Total: ${f(b + tip)}*${n > 1 ? `\nPer person (${n}): *${f((b + tip) / n)}*` : ''}`; });
  def('vat', '<amount> [rate=16]', 'add/remove VAT (default 16%)', (c) => { const [a, r = 16] = nums(c, 1, 'vat 1000 16'); return `🧾 *Amount without VAT ${f(a)}*\nVAT ${f(r)}%: ${f(a * r / 100)}\nWith VAT: *${f(a * (1 + r / 100))}*\n\n_If ${f(a)} already includes VAT:_ net = *${f(a / (1 + r / 100))}*, VAT = ${f(a - a / (1 + r / 100))}`; });
  def('interest', '<amount> <rate%> <years>', 'simple interest', (c) => { const [p, r, y] = nums(c, 3, 'interest 10000 8 2'); const i = p * r * y / 100; return `💰 Principal: ${f(p)}\nInterest: *${f(i)}*\nTotal: *${f(p + i)}*`; });
  def('compound', '<amount> <rate%> <years> [times a year=12]', 'compound interest', (c) => { const [p, r, y, n = 12] = nums(c, 3, 'compound 10000 8 5 12'); const t = p * (1 + r / 100 / n) ** (n * y); return `📈 Start: ${f(p)}\nAfter ${f(y)} years: *${f(t)}*\nEarned: *${f(t - p)}*`; });
  def('emi', '<loan> <rate% a year> <months>', 'monthly loan repayment', (c) => { const [p, r, m] = nums(c, 3, 'emi 500000 14 24'); const i = r / 1200; const e = i ? p * i * (1 + i) ** m / ((1 + i) ** m - 1) : p / m; return `🏦 Loan: ${f(p)} at ${f(r)}% for ${f(m, 0)} months\n*Monthly: ${f(e)}*\nTotal paid: ${f(e * m)}\nInterest: ${f(e * m - p)}`; }, { aliases: ['loan'] });
  def('split', '<total> <people>', 'split a bill equally', (c) => { const [t, n] = nums(c, 2, 'split 3600 4'); if (n < 1) throw new Error('people must be at least 1'); return `🍕 ${f(t)} ÷ ${f(n, 0)} = *${f(t / n)}* each`; });
  def('profit', '<cost> <selling price>', 'profit and margin', (c) => { const [a, b] = nums(c, 2, 'profit 700 1000'); const p = b - a; return `${p >= 0 ? '📈 Profit' : '📉 Loss'}: *${f(Math.abs(p))}*\nMargin: ${f(p / b * 100)}%\nMarkup: ${a ? f(p / a * 100) : '—'}%`; });

  /* ---------- shapes ---------- */
  def('circle', '<radius>', 'area and circumference', (c) => { const [r] = nums(c, 1, 'circle 7'); return `⭕ Radius ${f(r)}\nArea: *${f(Math.PI * r * r, 4)}*\nCircumference: *${f(2 * Math.PI * r, 4)}*\nDiameter: ${f(2 * r)}`; });
  def('area', '<square|rectangle|triangle|circle> <sizes>', 'area of a shape', (c) => {
    const shape = (c.args[0] || '').toLowerCase(); const v = c.args.slice(1).map(Number);
    if (v.some((x) => !Number.isFinite(x))) throw need('area rectangle 4 5');
    const calc = { square: () => v[0] ** 2, rectangle: () => v[0] * v[1], triangle: () => 0.5 * v[0] * v[1], circle: () => Math.PI * v[0] ** 2 };
    const need2 = { square: 1, rectangle: 2, triangle: 2, circle: 1 };
    if (!calc[shape] || v.length < need2[shape]) throw need('area rectangle 4 5');
    return `📐 Area of ${shape}: *${f(calc[shape](), 4)}*\n_(triangle: base height · rectangle: length width)_`;
  });
  def('volume', '<cube|sphere|cylinder|cone> <sizes>', 'volume of a solid', (c) => {
    const s = (c.args[0] || '').toLowerCase(); const v = c.args.slice(1).map(Number);
    if (v.some((x) => !Number.isFinite(x))) throw need('volume cylinder 3 10');
    const calc = { cube: () => v[0] ** 3, sphere: () => 4 / 3 * Math.PI * v[0] ** 3, cylinder: () => Math.PI * v[0] ** 2 * v[1], cone: () => Math.PI * v[0] ** 2 * v[1] / 3 };
    const n = { cube: 1, sphere: 1, cylinder: 2, cone: 2 };
    if (!calc[s] || v.length < n[s]) throw need('volume cylinder 3 10');
    return `🧊 Volume of ${s}: *${f(calc[s](), 4)}*\n_(cylinder/cone: radius height)_`;
  });
  def('pythagoras', '<a> <b>', 'hypotenuse of a right triangle', (c) => { const [a, b] = nums(c, 2, 'pythagoras 3 4'); return `📐 Hypotenuse = √(${f(a)}² + ${f(b)}²) = *${f(Math.hypot(a, b), 6)}*`; }, { aliases: ['hypotenuse'] });
  def('quadratic', '<a> <b> <c>', 'solve ax²+bx+c=0', (c) => {
    const [a, b, k] = nums(c, 3, 'quadratic 1 -3 2'); if (!a) throw new Error('a cannot be 0');
    const d = b * b - 4 * a * k;
    if (d > 0) return `📈 Two real roots:\nx₁ = *${f((-b + Math.sqrt(d)) / (2 * a), 6)}*\nx₂ = *${f((-b - Math.sqrt(d)) / (2 * a), 6)}*`;
    if (d === 0) return `📈 One root: x = *${f(-b / (2 * a), 6)}*`;
    return `📈 No real roots (discriminant ${f(d)}).\nComplex: ${f(-b / (2 * a), 4)} ± ${f(Math.sqrt(-d) / (2 * a), 4)}i`;
  });

  /* ---------- numbers ---------- */
  def('fibonacci', '<how many>', 'first n Fibonacci numbers (max 60)', (c) => { const [n] = nums(c, 1, 'fibonacci 10'); const k = Math.max(1, Math.min(60, Math.floor(n))); let a = 0n; let b = 1n; const r = []; for (let i = 0; i < k; i++) { r.push(a); [a, b] = [b, a + b]; } return `🌀 ${r.join(', ')}`; }, { aliases: ['fib'] });
  const isPrime = (n) => { if (n < 2 || !Number.isInteger(n)) return false; if (n < 4) return true; if (n % 2 === 0) return false; for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false; return true; };
  def('prime', '<number>', 'is it prime? + next prime', (c) => { const [n] = nums(c, 1, 'prime 97'); if (n > 1e12) throw new Error('Keep it under 1 trillion.'); let nx = Math.floor(n) + 1; while (!isPrime(nx)) nx++; return `${isPrime(n) ? '✅' : '❌'} ${f(n, 0)} is ${isPrime(n) ? '' : 'not '}prime.\nNext prime: *${f(nx, 0)}*`; }, { aliases: ['isprime'] });
  def('primefactors', '<number>', 'prime factors', (c) => { let [n] = nums(c, 1, 'primefactors 360'); n = Math.floor(n); if (n < 2 || n > 1e12) throw new Error('Use a whole number from 2 to 1 trillion.'); const o = n; const r = []; for (let d = 2; d * d <= n; d++) while (n % d === 0) { r.push(d); n /= d; } if (n > 1) r.push(n); return `🔢 ${f(o, 0)} = *${r.join(' × ')}*`; }, { aliases: ['factorize'] });
  def('factorial', '<n>', 'n! (max 170)', (c) => { const [n] = nums(c, 1, 'factorial 10'); if (n < 0 || n > 170 || !Number.isInteger(n)) throw new Error('Use a whole number from 0 to 170.'); let r = 1n; for (let i = 2n; i <= BigInt(n); i++) r *= i; const s = r.toString(); return `❗ ${n}! = *${s.length > 300 ? s.slice(0, 40) + `… (${s.length} digits)` : s}*`; }, { aliases: ['fact2'] });
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
  def('gcd', '<a> <b>', 'greatest common divisor', (c) => { const [a, b] = nums(c, 2, 'gcd 48 18'); return `➗ GCD(${f(a, 0)}, ${f(b, 0)}) = *${f(gcd(a, b), 0)}*`; }, { aliases: ['hcf'] });
  def('lcm', '<a> <b>', 'least common multiple', (c) => { const [a, b] = nums(c, 2, 'lcm 4 6'); return `✖️ LCM(${f(a, 0)}, ${f(b, 0)}) = *${f(Math.abs(a * b) / (gcd(a, b) || 1), 0)}*`; });
  def('sqrt', '<number>', 'square root', (c) => { const [n] = nums(c, 1, 'sqrt 144'); if (n < 0) throw new Error('No real square root for a negative number.'); return `√${f(n, 6)} = *${f(Math.sqrt(n), 8)}*`; });
  def('power', '<base> <exponent>', 'base to the power', (c) => { const [a, b] = nums(c, 2, 'power 2 10'); const r = a ** b; if (!Number.isFinite(r)) throw new Error('Too large.'); return `⚡ ${f(a, 6)}^${f(b, 6)} = *${f(r, 8)}*`; }, { aliases: ['pow'] });
  def('sum', '<numbers>', 'add numbers', (c) => { const v = nums(c, 1, 'sum 5 10 15'); return `➕ Sum = *${f(v.reduce((a, b) => a + b, 0), 6)}*`; });
  def('average', '<numbers>', 'mean of numbers', (c) => { const v = nums(c, 1, 'average 4 8 15'); return `📊 Average = *${f(v.reduce((a, b) => a + b, 0) / v.length, 6)}*`; }, { aliases: ['mean', 'avg'] });
  const med = (v) => { const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  def('median', '<numbers>', 'middle value', (c) => `📊 Median = *${f(med(nums(c, 1, 'median 3 1 9 7')), 6)}*`);
  def('stats', '<numbers>', 'sum, mean, median, min, max, spread', (c) => {
    const v = nums(c, 2, 'stats 4 8 15 16 23 42'); const sum = v.reduce((a, b) => a + b, 0); const mean = sum / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
    return `📊 *Statistics* (${v.length} numbers)\n\nSum: ${f(sum, 4)}\nMean: ${f(mean, 4)}\nMedian: ${f(med(v), 4)}\nMin: ${f(Math.min(...v), 4)}\nMax: ${f(Math.max(...v), 4)}\nRange: ${f(Math.max(...v) - Math.min(...v), 4)}\nStd dev: ${f(sd, 4)}`;
  });
  const ROM = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  def('roman', '<number|ROMAN>', 'roman numerals both ways', (c) => {
    const a = (c.args[0] || '').toUpperCase(); if (!a) throw need('roman 2024');
    if (/^[IVXLCDM]+$/.test(a)) { const val = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; let n = 0; for (let i = 0; i < a.length; i++) n += val[a[i]] < (val[a[i + 1]] || 0) ? -val[a[i]] : val[a[i]]; return `🏛 ${a} = *${n}*`; }
    let n = parseInt(a, 10); if (!(n > 0 && n < 4000)) throw new Error('Use a number from 1 to 3999 (or Roman letters).');
    let r = ''; for (const [v, s] of ROM) while (n >= v) { r += s; n -= v; } return `🏛 ${a} = *${r}*`;
  });
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const words = (n) => {
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
    if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + words(n % 100) : '');
    for (const [v, w] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) if (n >= v) return words(Math.floor(n / v)) + ' ' + w + (n % v ? (n % v < 100 ? ' and ' : ' ') + words(n % v) : '');
    return '';
  };
  def('numwords', '<number>', 'number in words', (c) => { let [n] = nums(c, 1, 'numwords 1250'); n = Math.floor(n); if (n < 0 || n >= 1e12) throw new Error('Use a number from 0 to 999,999,999,999.'); return `🔤 ${f(n, 0)} = *${words(n)}*`; }, { aliases: ['n2w'] });
  def('tobin', '<number>', 'decimal to binary', (c) => { const [n] = nums(c, 1, 'tobin 42'); return `💻 ${f(n, 0)} = *${Math.floor(n).toString(2)}* (binary)`; });
  def('frombin', '<binary>', 'binary to decimal', (c) => { const b = (c.args[0] || '').replace(/^0b/, ''); if (!/^[01]+$/.test(b)) throw need('frombin 101010'); return `💻 ${b} = *${parseInt(b, 2)}* (decimal)`; });
  def('tohex', '<number>', 'decimal to hex', (c) => { const [n] = nums(c, 1, 'tohex 255'); return `💻 ${f(n, 0)} = *${Math.floor(n).toString(16).toUpperCase()}* (hex)`; });
  def('fromhex', '<hex>', 'hex to decimal', (c) => { const h = (c.args[0] || '').replace(/^0x/i, ''); if (!/^[0-9a-f]+$/i.test(h)) throw need('fromhex FF'); return `💻 ${h.toUpperCase()} = *${parseInt(h, 16)}* (decimal)`; });
  def('tooct', '<number>', 'decimal to octal', (c) => { const [n] = nums(c, 1, 'tooct 64'); return `💻 ${f(n, 0)} = *${Math.floor(n).toString(8)}* (octal)`; });

  /* ---------- dates ---------- */
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function parseDate(s) {
    s = String(s || '').trim(); if (!s) return null;
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s); if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s); if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    m = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i.exec(s); if (m) { const mi = MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase().slice(0, 3))); if (mi >= 0) return new Date(Date.UTC(+m[3], mi, +m[1])); }
    const t = Date.parse(s); return Number.isFinite(t) ? new Date(t) : null;
  }
  const dstr = (d) => d.toUTCString().slice(0, 16);
  const today = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); };
  const need_date = (ctx, example) => { const d = parseDate(ctx.text); if (!d) throw need(example); return d; };
  def('age', '<birthday>', 'exact age + next birthday', (c) => {
    const b = need_date(c, 'age 2001-05-14'); const t = today(); if (b > t) throw new Error('That date is in the future.');
    let y = t.getUTCFullYear() - b.getUTCFullYear(); let mo = t.getUTCMonth() - b.getUTCMonth(); let d = t.getUTCDate() - b.getUTCDate();
    if (d < 0) { mo--; d += new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)).getUTCDate(); }
    if (mo < 0) { y--; mo += 12; }
    let nb = new Date(Date.UTC(t.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())); if (nb < t) nb = new Date(Date.UTC(t.getUTCFullYear() + 1, b.getUTCMonth(), b.getUTCDate()));
    return `🎂 Born ${dstr(b)}\nAge: *${y} years, ${mo} months, ${d} days*\nTotal days: ${f(Math.round((t - b) / 864e5), 0)}\nNext birthday in *${Math.round((nb - t) / 864e5)} days*`;
  });
  def('dayofweek', '<date>', 'what day was/is that date?', (c) => { const d = need_date(c, 'dayofweek 2000-01-01'); return `📅 ${dstr(d)} is a *${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()]}*`; }, { aliases: ['weekday'] });
  def('leapyear', '<year>', 'is it a leap year?', (c) => { const [y] = nums(c, 1, 'leapyear 2028'); const l = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; return `${l ? '✅' : '❌'} ${y} is ${l ? '' : 'not '}a leap year.`; });
  const SIGNS = [['Capricorn ♑', 12, 22, 1, 19], ['Aquarius ♒', 1, 20, 2, 18], ['Pisces ♓', 2, 19, 3, 20], ['Aries ♈', 3, 21, 4, 19], ['Taurus ♉', 4, 20, 5, 20], ['Gemini ♊', 5, 21, 6, 20], ['Cancer ♋', 6, 21, 7, 22], ['Leo ♌', 7, 23, 8, 22], ['Virgo ♍', 8, 23, 9, 22], ['Libra ♎', 9, 23, 10, 22], ['Scorpio ♏', 10, 23, 11, 21], ['Sagittarius ♐', 11, 22, 12, 21]];
  def('zodiac', '<birthday>', 'star sign from a date', (c) => {
    const d = need_date(c, 'zodiac 2001-05-14'); const mo = d.getUTCMonth() + 1; const day = d.getUTCDate();
    const s = SIGNS.find(([, m1, d1, m2, d2]) => (mo === m1 && day >= d1) || (mo === m2 && day <= d2));
    return `✨ ${dstr(d)} → *${s ? s[0] : 'Capricorn ♑'}*`;
  }, { aliases: ['starsign'] });
  def('daysbetween', '<date1> <date2>', 'days between two dates', (c) => {
    const parts = c.text.split(/\s+(?:to|and|-)\s+|\s{2,}|,/).filter(Boolean); const a = parseDate(parts[0] || c.args[0]); const b = parseDate(parts[1] || c.args[1]);
    if (!a || !b) throw need('daysbetween 2024-01-01 2024-12-25');
    const days = Math.round(Math.abs(b - a) / 864e5); return `📆 ${dstr(a)} ↔ ${dstr(b)}\n*${f(days, 0)} days* (${f(days / 7, 1)} weeks)`;
  });
  def('countdown', '<date>', 'days until a date', (c) => {
    const d = need_date(c, 'countdown 2026-12-25'); const days = Math.round((d - today()) / 864e5);
    return days >= 0 ? `⏳ *${f(days, 0)} days* until ${dstr(d)}` : `⌛ ${dstr(d)} was *${f(-days, 0)} days* ago`;
  }, { aliases: ['daysuntil'] });
  def('newyear', '', 'days until New Year', () => { const t = today(); const ny = new Date(Date.UTC(t.getUTCFullYear() + 1, 0, 1)); return `🎆 *${Math.round((ny - t) / 864e5)} days* until New Year ${ny.getUTCFullYear()}!`; });

  /* ---------- health ---------- */
  def('bmi', '<weight kg> <height cm>', 'body mass index', (c) => {
    const [kg, cm] = nums(c, 2, 'bmi 70 175'); const m = cm / 100; const b = kg / (m * m);
    const cat = b < 18.5 ? 'Underweight' : b < 25 ? 'Healthy weight' : b < 30 ? 'Overweight' : 'Obese';
    return `⚖️ BMI: *${f(b, 1)}* — ${cat}\n_General guide only, not medical advice._`;
  });
  def('bmr', '<male|female> <kg> <cm> <age>', 'daily calories at rest', (c) => {
    const sex = (c.args[0] || '').toLowerCase(); const [kg, cm, age] = c.args.slice(1).map(Number);
    if (!['male', 'female'].includes(sex) || [kg, cm, age].some((x) => !Number.isFinite(x))) throw need('bmr male 70 175 25');
    const b = 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161);
    return `🔥 BMR: *${f(b, 0)} kcal/day*\nLight activity: ${f(b * 1.375, 0)}\nModerate: ${f(b * 1.55, 0)}\nVery active: ${f(b * 1.725, 0)}\n_Estimate only, not medical advice._`;
  });
  def('water', '<weight kg>', 'daily water intake guide', (c) => { const [kg] = nums(c, 1, 'water 70'); return `💧 About *${f(kg * 0.035, 1)} litres* of water a day (${f(kg * 0.035 / 0.25, 0)} cups).\n_General guide only._`; });

  return out;
};
