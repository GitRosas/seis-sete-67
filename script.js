// 6-7 / 67 — vanilla js, sem libs. tudo offline, sons feitos no browser.
"use strict";

// atalhos e helpers
const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
const SEM_MOVIMENTO = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/* Modo "poupar": telemóvel / ecrã pequeno ou CPU fraca → menos partículas, menos fps,
   chuva desligada por defeito. Partilhado por BG, FX e o som dos botões. */
const POUPAR = window.matchMedia("(max-width: 600px)").matches || (navigator.hardwareConcurrency || 8) <= 4;
const rnd = (n) => Math.floor(Math.random() * n);
const escolha = (arr) => arr[rnd(arr.length)];

/* Wrapper seguro do localStorage (não rebenta se estiver bloqueado) */
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v)   { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

/* Cache de sprites: desenha cada emoji/número UMA vez para um canvas e
   reutiliza com drawImage (muito mais rápido que fillText a cada frame). */
const _spriteCache = {};
function spriteEmoji(ch) {
  if (_spriteCache[ch]) return _spriteCache[ch];
  const S = 96, c = document.createElement("canvas");
  c.width = c.height = S;
  const cx = c.getContext("2d");
  cx.font = `bold ${Math.floor(S * 0.78)}px "Arial Black","Segoe UI Emoji",sans-serif`;
  cx.textAlign = "center"; cx.textBaseline = "middle"; cx.fillStyle = "#fff";
  cx.fillText(ch, S / 2, S / 2 + 2);
  _spriteCache[ch] = c; return c;
}

// som: web audio (tons) + web speech (voz)
const SOM = (() => {
  let ac = null;
  function ctx() {
    if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ac = new AC(); }
    if (ac.state === "suspended") ac.resume();
    return ac;
  }
  function tom(freq, inicio, dur, tipo = "sine", vol = 0.3) {
    const a = ctx(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = tipo; o.frequency.value = freq;
    const t = a.currentTime + inicio;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  function ruido(t, dur, vol, hp) {
    const a = ctx(); if (!a) return;
    const len = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = a.createBufferSource(); s.buffer = buf;
    const f = a.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
    const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(a.destination); s.start(t); s.stop(t + dur + 0.02);
  }
  function kick(t) { const a = ctx(); if (!a) return; t = (t == null ? a.currentTime : t);
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.13);
    g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.22);
  }
  function hat(t)  { const a = ctx(); if (!a) return; ruido(t == null ? a.currentTime : t, 0.05, 0.14, 7500); }
  function snare(t){ const a = ctx(); if (!a) return; t = (t == null ? a.currentTime : t); ruido(t, 0.18, 0.3, 1800); tom(180, t - a.currentTime, 0.18, "triangle", 0.2); }
  function ding()  { tom(880, 0, 0.18, "triangle", 0.3); tom(1320, 0.05, 0.3, "triangle", 0.25); }
  function doisTons(f1, f2, tipo = "sine") { tom(f1, 0, 0.22, tipo, 0.3); tom(f2, 0.26, 0.3, tipo, 0.3); }
  function beep(freq = 440, n = 3, gap = 0.12, tipo = "square") { for (let i = 0; i < n; i++) tom(freq, i * gap, gap * 0.6, tipo, 0.25); }

  // Voz (Web Speech). Nada de áudio com direitos: é tudo síntese de voz.
  const temVoz = "speechSynthesis" in window;
  let vozes = [], vozPT = null, vozEN = null;
  function carregar() { if (!temVoz) return; vozes = speechSynthesis.getVoices(); vozPT = vozes.find(v => /^pt/i.test(v.lang)) || null; vozEN = vozes.find(v => /^en/i.test(v.lang)) || null; }
  if (temVoz) { carregar(); speechSynthesis.onvoiceschanged = carregar; }
  function falar(rate, pitch, texto = "six seven", lang = "en-US") {
    if (!temVoz) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = lang;
    if (lang.startsWith("pt") && vozPT) u.voice = vozPT; else if (vozEN) u.voice = vozEN;
    u.rate = rate; u.pitch = pitch; u.volume = 1;
    speechSynthesis.speak(u); return true;
  }
  return { ctx, tom, kick, hat, snare, ding, doisTons, beep, falar };
})();

// confetti + toasts
const FX = (() => {
  let canvas, ctx, parts = [], raf = null;
  const EMOJIS = ["6", "7", "🤚", "🤌", "🔮", "🕕", "🎲", "✨", "💥"];
  const MAX = POUPAR ? 90 : 240;
  function init() { canvas = $("#fxCanvas"); ctx = canvas.getContext("2d"); resize(); window.addEventListener("resize", resize); }
  function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
  function criar(x, y, vx, vy) { return { x, y, vx, vy, emoji: escolha(EMOJIS), tam: 18 + Math.random() * 26, rot: Math.random() * 6.28, vrot: (Math.random() - 0.5) * 0.3, vida: 1 }; }
  function explosao(x, y, n = 26) { if (SEM_MOVIMENTO || parts.length > MAX) return; for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = 4 + Math.random() * 9; parts.push(criar(x, y, Math.cos(a) * v, Math.sin(a) * v - 4)); } correr(); }
  function chuva(n = 45) { if (SEM_MOVIMENTO || parts.length > MAX) return; for (let i = 0; i < n; i++) parts.push(criar(Math.random() * canvas.width, -30, (Math.random() - 0.5) * 3, 2 + Math.random() * 5)); correr(); }
  function burstEl(el, n = 22) { if (!el) return; const r = el.getBoundingClientRect(); explosao(r.left + r.width / 2, r.top + r.height / 2, n); }
  function correr() {
    if (raf) return;
    const passo = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      parts.forEach(p => {
        p.vy += 0.22; p.x += p.vx; p.y += p.vy; p.rot += p.vrot; p.vida -= 0.006;
        const sp = spriteEmoji(p.emoji);
        ctx.save(); ctx.globalAlpha = Math.max(0, p.vida); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.drawImage(sp, -p.tam / 2, -p.tam / 2, p.tam, p.tam); ctx.restore();
      });
      parts = parts.filter(p => p.vida > 0 && p.y < canvas.height + 60);
      if (parts.length) raf = requestAnimationFrame(passo);
      else { ctx.clearRect(0, 0, canvas.width, canvas.height); raf = null; }
    };
    raf = requestAnimationFrame(passo);
  }
  // Toasts (mensagens curtas; conquistas usam variante .ach)
  function toast(msg, opts = {}) {
    const cont = $("#toasts"); if (!cont) return;
    const t = document.createElement("div");
    t.className = "toast" + (opts.ach ? " ach" : "");
    t.innerHTML = msg;
    cont.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 350); }, opts.ms || 2400);
  }
  return { init, explosao, chuva, burstEl, toast };
})();

// conquistas
const ACH = (() => {
  const CHAVE = "conquistas67";
  const LISTA = [
    { id: "click67",   ico: "🔢", nome: "Profissional",   desc: "Chegaste a 67 no contador" },
    { id: "scroll",    ico: "♾️", nome: "Sobrevivente",    desc: "Passaste 300 no scroll" },
    { id: "panic",     ico: "🚨", nome: "Pânico Total",    desc: "Entraste em modo pânico" },
    { id: "konami",    ico: "🕹️", nome: "Código Secreto",  desc: "6 7 6 7 dentro do pânico 🚨" },
    { id: "wheel",     ico: "🎡", nome: "Roleta Viciada",  desc: "Giraste a roda (deu 67!)" },
    { id: "factory",   ico: "🏭", nome: "Industrial",      desc: "Produziste 67 na fábrica" },
    { id: "pet",       ico: "🐣", nome: "Cuidador",        desc: "Alimentaste o pet" },
    { id: "theme",     ico: "🌗", nome: "Dois Lados",      desc: "Mudaste de tema" },
    { id: "quiz",      ico: "🧠", nome: "100% Six Seven",  desc: "Completaste o quiz" },
    { id: "translate", ico: "🔤", nome: "Poliglota",       desc: "Traduziste para 67-ês" },
    { id: "cpm",       ico: "⚡", nome: "Dedos Rápidos",    desc: "Fizeste o teste CPM" },
    { id: "calc",      ico: "🧮", nome: "Matemático",      desc: "67 = 67. Sempre." },
    { id: "crystal",   ico: "🔮", nome: "Vidente",         desc: "Consultaste a bola de cristal" },
    { id: "rng",       ico: "🎲", nome: "Aleatório?",      desc: "Geraste o número (67, claro)" },
    { id: "reasons",   ico: "📜", nome: "Tens Razão",      desc: "Geraste as 67 razões" },
    { id: "username",  ico: "🎮", nome: "Gamertag",        desc: "Geraste uma alcunha 67" },
    { id: "weather",   ico: "🌦️", nome: "Meteorologista",  desc: "Viste a previsão (sempre 67°)" },
    { id: "boombox",   ico: "📻", nome: "Produtor",        desc: "Tocaste a batida 6-7" },
    { id: "rain",      ico: "🌧️", nome: "Chove 67",        desc: "Ligaste a chuva de 67" },
    { id: "counter670",ico: "😵", nome: "Procura Ajuda",   desc: "Chegaste a 670 no contador" },
    { id: "explorer",  ico: "🗺️", nome: "Explorador",      desc: "Abriste todas as ferramentas" },
    { id: "lenda",     ico: "👑", nome: "LENDA DO 67",     desc: "Desbloqueaste tudo. És 6-7." },
  ];
  let ganhas = new Set(store.get(CHAVE, []));
  function unlock(id) {
    if (ganhas.has(id)) return;
    const a = LISTA.find(x => x.id === id); if (!a) return;
    ganhas.add(id); store.set(CHAVE, [...ganhas]);
    FX.toast(`🏆 Conquista! / Achievement!<br><b>${a.ico} ${a.nome}</b>`, { ach: true, ms: 3200 });
    render();
    // Meta-conquista: desbloqueia "LENDA" quando todas as outras estiverem feitas
    if (id !== "lenda" && LISTA.every(x => x.id === "lenda" || ganhas.has(x.id))) {
      setTimeout(() => unlock("lenda"), 600);
    }
  }
  function render() {
    const grid = $("#achGrid"); if (!grid) return;
    grid.innerHTML = "";
    LISTA.forEach(a => {
      const d = document.createElement("div");
      const on = ganhas.has(a.id);
      d.className = "ach" + (on ? " unlocked" : "");
      d.innerHTML = `<div class="ach-ico">${on ? a.ico : "🔒"}</div><div class="ach-name">${a.nome}</div><div class="ach-desc">${a.desc}</div>`;
      grid.appendChild(d);
    });
    const prog = $("#achProgress");
    if (prog) prog.textContent = `${ganhas.size} / ${LISTA.length} desbloqueadas`;

    // Crachá no troféu da topbar (sempre visível) — destaca que há conquistas por fazer
    const badge = $("#achBadge");
    if (badge) {
      badge.textContent = `${ganhas.size}/${LISTA.length}`;
      $("#openAch").classList.toggle("tem-por-fazer", ganhas.size < LISTA.length);
    }
    // Barra de progresso no hub
    const hubCount = $("#hubAchCount"), hubFill = $("#hubAchFill");
    if (hubCount) hubCount.textContent = `${ganhas.size}/${LISTA.length}`;
    if (hubFill) hubFill.style.width = Math.round(ganhas.size / LISTA.length * 100) + "%";
  }
  return { unlock, render, total: LISTA.length };
})();

// fundo animado + chuva de 67
const BG = (() => {
  let canvas, ctx, itens = [], gotas = [], rain = false, lastW = -1, rzT = null, last = 0;
  function init() {
    canvas = $("#bgCanvas"); ctx = canvas.getContext("2d");
    aplicarTamanho();
    // debounce do resize (a barra de endereço do telemóvel dispara resize a cada scroll)
    window.addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(aplicarTamanho, 150); });
    window.addEventListener("orientationchange", aplicarTamanho);
    if (SEM_MOVIMENTO) estatico(); else requestAnimationFrame(loop);
  }
  function aplicarTamanho() {
    canvas.width = innerWidth; canvas.height = innerHeight + 140;   // folga p/ a barra de endereço
    if (innerWidth !== lastW) { lastW = innerWidth; criar(); }      // só recria partículas se a LARGURA mudar
  }
  function criar() {
    const n = Math.min(POUPAR ? 16 : 54, Math.round(innerWidth * innerHeight / 32000));
    const s = ["6", "7", "🤚", "🤌"];
    itens = [];
    for (let i = 0; i < n; i++) itens.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, tam: 22 + Math.random() * 50, vel: 0.15 + Math.random() * 0.45, deriva: (Math.random() - 0.5) * 0.3, rot: Math.random() * 6.28, vrot: (Math.random() - 0.5) * 0.01, simb: escolha(s), alfa: 0.05 + Math.random() * 0.09 });
  }
  function estatico() { itens.forEach(it => { const sp = spriteEmoji(it.simb); ctx.save(); ctx.globalAlpha = it.alfa; ctx.drawImage(sp, it.x - it.tam / 2, it.y - it.tam / 2, it.tam, it.tam); ctx.restore(); }); }
  function loop(t) {
    if (document.hidden) { requestAnimationFrame(loop); return; }          // pausa com a aba escondida
    if (POUPAR && t - last < 33) { requestAnimationFrame(loop); return; }   // ~30fps no telemóvel
    last = t;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    itens.forEach(it => {
      it.y -= it.vel; it.x += it.deriva; it.rot += it.vrot;
      if (it.y < -80) { it.y = canvas.height + 80; it.x = Math.random() * canvas.width; }
      const sp = spriteEmoji(it.simb);
      ctx.save(); ctx.globalAlpha = it.alfa; ctx.translate(it.x, it.y); ctx.rotate(it.rot);
      ctx.drawImage(sp, -it.tam / 2, -it.tam / 2, it.tam, it.tam); ctx.restore();
    });
    if (rain) {
      const maxG = POUPAR ? 28 : 70, prob = POUPAR ? 0.5 : 0.85;
      if (gotas.length < maxG && Math.random() < prob) gotas.push({ x: Math.random() * canvas.width, y: -40, tam: 28 + Math.random() * 44, vel: 3 + Math.random() * 6, simb: escolha(["6", "7", "67", "6-7"]) });
      gotas.forEach(g => { g.y += g.vel; const sp = spriteEmoji(g.simb); ctx.save(); ctx.globalAlpha = 0.5; ctx.drawImage(sp, g.x - g.tam / 2, g.y - g.tam / 2, g.tam, g.tam); ctx.restore(); });
      gotas = gotas.filter(g => g.y < canvas.height + 60);
    } else if (gotas.length) gotas = [];
    requestAnimationFrame(loop);
  }
  function setRain(b) { rain = b; }
  return { init, setRain };
})();

// arranque
document.addEventListener("DOMContentLoaded", () => {
  // se uma ferramenta rebentar, as outras continuam
  const mods = [
    FX.init, BG.init, iniciarLoader, iniciarNavegacao, iniciarTema, iniciarPanico,
    iniciarKonami, iniciarRasto, iniciarToggles, iniciarSomBotoes, iniciarOnboarding,
    iniciarContador, iniciarBola, iniciarRandom, iniciarRelogio, iniciarRazoes,
    iniciarCalculadora, iniciarQuiz, iniciarTradutor, iniciarRoda,
    iniciarAlcunha, iniciarTempo, iniciarFabrica, iniciarPet, iniciarCPM, iniciarBoombox,
    iniciarScroll,
  ];
  mods.forEach(fn => { try { fn(); } catch (e) { console.warn("falhou:", fn.name, e); } });
  ACH.render();
});

// ecrã de loading
function iniciarLoader() {
  const fill = $("#loaderFill"), pct = $("#loaderPct"), txt = $("#loaderTxt"), loader = $("#loader");
  function fim() { loader.classList.add("done"); setTimeout(() => loader.remove(), 600); }
  if (SEM_MOVIMENTO) { fill.style.width = "100%"; pct.textContent = "100%"; fim(); return; }
  let p = 0;
  const t = setInterval(() => {
    p += 4 + rnd(8);
    if (p >= 67 && p < 100) {                 // pausa dramática nos 67%
      p = 67; fill.style.width = "67%"; pct.textContent = "67%"; txt.textContent = "67%… obviamente / obviously 😏";
      clearInterval(t);
      setTimeout(() => {
        let q = 67;
        const t2 = setInterval(() => { q += 6 + rnd(6); if (q >= 100) { q = 100; clearInterval(t2); fill.style.width = "100%"; pct.textContent = "100%"; setTimeout(fim, 350); } else { fill.style.width = q + "%"; pct.textContent = q + "%"; } }, 90);
      }, 700);
      return;
    }
    fill.style.width = p + "%"; pct.textContent = p + "%";
  }, 110);
}

// navegação entre vistas
const TOOLS = ["counter","crystal","random","clock","reasons","calc","quiz","translator","wheel","username","weather","factory","pet","cpm","boombox","scroll"];
let abertas = new Set();
function iniciarNavegacao() {
  function mostrar(nome) {
    // Ao sair do boombox, desliga-o sozinho
    if (nome !== "boombox" && window.__pararBoombox) window.__pararBoombox();
    $$(".view").forEach(v => v.classList.remove("active"));
    const alvo = $("#view-" + nome); if (alvo) alvo.classList.add("active");
    document.body.classList.toggle("full-mode", nome === "scroll");
    document.documentElement.classList.toggle("full-mode", nome === "scroll");
    if (nome !== "scroll") window.scrollTo({ top: 0, behavior: "auto" });
    // Conquista "explorador": abrir todas as ferramentas
    if (TOOLS.includes(nome)) { abertas.add(nome); if (abertas.size >= TOOLS.length) ACH.unlock("explorer"); }
  }
  $$("[data-view]").forEach(b => b.addEventListener("click", () => mostrar(b.dataset.view)));
  $("#openAch").addEventListener("click", () => mostrar("achievements"));
  window.__mostrar = mostrar;
}

// tema 6/7
function iniciarTema() {
  const btn = $("#toggleTheme");
  function aplicar(t) {
    document.documentElement.dataset.theme = t;
    btn.innerHTML = t === "7" ? "🌙&nbsp;7" : "☀️&nbsp;6";
    store.set("tema67", t);
  }
  aplicar(store.get("tema67", "7"));
  btn.addEventListener("click", () => {
    const novo = document.documentElement.dataset.theme === "7" ? "6" : "7";
    aplicar(novo); ACH.unlock("theme");
  });
}

// modo pânico
function iniciarPanico() {
  const overlay = $("#panic"), btn = $("#panicBtn"), esc = $("#panicEscape"), texto = $(".panic-text", overlay);
  let intervalo = null;
  const ativo = () => overlay.classList.contains("show");
  function ligar() {
    overlay.classList.add("show");
    if (texto) texto.classList.add("shake");   // abana só o texto (nunca o body!)
    ACH.unlock("panic");
    SOM.beep(120, 8, 0.08, "sawtooth"); SOM.tom(80, 0, 1, "sawtooth", 0.3);
    FX.chuva(60);
    if (!SEM_MOVIMENTO) intervalo = setInterval(() => FX.chuva(30), 600);
  }
  function desligar() {
    overlay.classList.remove("show");
    if (texto) texto.classList.remove("shake");
    if (intervalo) { clearInterval(intervalo); intervalo = null; }
  }
  btn.addEventListener("click", () => ativo() ? desligar() : ligar());
  // só fecha pelo botão ou ESC (clicar no fundo não conta)
  esc.addEventListener("click", e => { e.stopPropagation(); desligar(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && ativo()) desligar(); });
  window.__sairPanico = desligar;   // usado pelo código secreto
}

// código secreto (6 7 6 7)
function iniciarKonami() {
  // O código secreto SÓ conta dentro do ecrã de PÂNICO 🚨.
  // Funciona por TECLADO (6 7 6 7) e por TOQUE (4 toques no ecrã de pânico, p/ telemóvel).
  const overlay = $("#panic");
  const noPanico = () => !!overlay && overlay.classList.contains("show");
  function ativar() {
    if (window.__sairPanico) window.__sairPanico();   // fecha o pânico
    if (window.__mostrar) window.__mostrar("hub");     // volta à página inicial
    FX.chuva(POUPAR ? 50 : 80);
    FX.toast("🕹️ MODO SECRETO! / SECRET MODE!<br>seis sete seis sete 🤯", { ms: 4000 });
    SOM.doisTons(523, 784, "triangle"); SOM.falar(1.2, 1.4, "six seven six seven");
    const main = document.getElementById("main");
    if (main) { main.classList.add("shake"); setTimeout(() => main.classList.remove("shake"), 1500); }
    ACH.unlock("konami");
  }

  // Teclado: 6 7 6 7 — só avança se o pânico estiver aberto
  const alvo = ["6", "7", "6", "7"]; let pos = 0;
  document.addEventListener("keydown", e => {
    if (!noPanico()) { pos = 0; return; }
    if (e.key === alvo[pos]) { pos++; if (pos === alvo.length) { pos = 0; ativar(); } }
    else { pos = (e.key === alvo[0]) ? 1 : 0; }
  });

  // Toque (telemóvel): 4 toques no ecrã de pânico (o botão "ACALMA" não conta)
  let toques = 0, tT = null;
  if (overlay) overlay.addEventListener("click", (e) => {
    if (!noPanico() || e.target.closest("#panicEscape")) return;
    toques++; clearTimeout(tT); tT = setTimeout(() => { toques = 0; }, 1500);
    if (toques >= 4) { toques = 0; ativar(); }
  });
}

// rasto do cursor
function iniciarRasto() {
  const layer = $("#trailLayer");
  let ligado = false, ultimo = 0;
  function spawn(x, y) {
    const b = document.createElement("span");
    b.className = "trail-bit"; b.textContent = escolha(["🤚", "67", "🤌", "✨"]);
    b.style.left = x + "px"; b.style.top = y + "px";
    layer.appendChild(b);
    setTimeout(() => b.remove(), 800);
  }
  window.addEventListener("pointermove", e => {
    if (!ligado || SEM_MOVIMENTO) return;
    const agora = performance.now(); if (agora - ultimo < 40) return; ultimo = agora;
    spawn(e.clientX, e.clientY);
  });
  window.__setTrail = b => { ligado = b; };
}

// toggles (chuva, rasto)
function iniciarToggles() {
  const rain = $("#toggleRain"), trail = $("#toggleTrail");
  // Chuva de 67: ligada por defeito no desktop, desligada no telemóvel (poupa bateria).
  // A escolha do utilizador fica guardada e tem prioridade.
  const chuvaOn = store.get("chuva67on", !POUPAR);
  rain.setAttribute("aria-pressed", chuvaOn ? "true" : "false");
  BG.setRain(chuvaOn);
  rain.addEventListener("click", () => {
    const on = rain.getAttribute("aria-pressed") !== "true";
    rain.setAttribute("aria-pressed", on); BG.setRain(on); store.set("chuva67on", on);
    if (on) ACH.unlock("rain");
    FX.toast(on ? "🌧️ chuva de 67 ligada" : "chuva desligada");
  });
  trail.addEventListener("click", () => {
    const on = trail.getAttribute("aria-pressed") !== "true";
    trail.setAttribute("aria-pressed", on); if (window.__setTrail) window.__setTrail(on);
    FX.toast(on ? "🖐️ rasto ligado" : "rasto desligado");
  });
}

// blip ao clicar nos botões
function iniciarSomBotoes() {
  // Um "blip" curto ao carregar num botão (feedback). Com throttle e a saltar
  // botões que já têm som próprio, para não sobrepor sons ao martelar no mobile.
  let ultimo = 0;
  document.addEventListener("click", (e) => {
    if (document.hidden) return;
    const b = e.target.closest("button"); if (!b) return;
    if (b.closest("#cpmBtn,#factoryBtn")) return;          // já fazem o próprio som
    const agora = performance.now(); if (agora - ultimo < 60) return; ultimo = agora;
    SOM.tom(470 + Math.random() * 240, 0, 0.045, "square", 0.12);
  });
}

// boas-vindas na 1.ª visita
function iniciarOnboarding() {
  // Só na primeira visita: dá as boas-vindas e avisa que há conquistas a desbloquear.
  if (store.get("visto67", false)) return;
  store.set("visto67", true);
  setTimeout(() => {
    FX.toast(`👋 Bem-vindo ao 6-7! / Welcome!<br>🏆 <b>${ACH.total}</b> conquistas para desbloquear — explora tudo!`, { ach: true, ms: 5200 });
  }, SEM_MOVIMENTO ? 400 : 2800);   // depois do ecrã de loading
}

// ===== as ferramentas =====

// contador
function iniciarContador() {
  const num = $("#counterNum"), msg = $("#counterMsg"), btn = $("#counterBtn"), reset = $("#counterReset");
  let total = store.get("contador67", 0); if (typeof total !== "number" || total < 0) total = 0;
  const MSGS = [
    { min: 0, t: "carrega aí / tap it 👇" }, { min: 1, t: "começou / it begins 👀" },
    { min: 7, t: "seis… SETE! six seven! 🔥" }, { min: 10, t: "dezena! double digits 😎" },
    { min: 30, t: "a aquecer / warming up 🌡️" }, { min: 67, t: "ÉS UM PROFISSIONAL / a PRO 🏆" },
    { min: 100, t: "centena de caos / a hundred 💯" }, { min: 300, t: "os teus dedos / your fingers 😩" },
    { min: 670, t: "procura ajuda 😟 / seek help" }, { min: 6700, t: "👁️ ELES sabem / THEY know 👁️" },
  ];
  function txt(n) { let r = MSGS[0].t; MSGS.forEach(m => { if (n >= m.min) r = m.t; }); return r; }
  function atualizar() { num.textContent = total; msg.textContent = txt(total); }
  btn.addEventListener("click", () => {
    total++; store.set("contador67", total); atualizar();
    num.classList.remove("kick"); void num.offsetWidth; num.classList.add("kick");
    FX.burstEl(btn, 10);
    if (total === 67) ACH.unlock("click67");
    if (total === 670) ACH.unlock("counter670");
  });
  reset.addEventListener("click", () => { total = 0; store.set("contador67", 0); atualizar(); });
  atualizar();
}

// bola de cristal
function iniciarBola() {
  const form = $("#crystalForm"), input = $("#crystalIn"), bola = $("#crystalBall"), resp = $("#crystalAns"), hist = $("#crystalHist");
  const R = ["6…… 7", "As estrelas dizem: 6-7 ⭐", "Hmm… 6? … … 7.", "O destino responde: six seven",
    "definitely 6-7", "6. 7. Nada mais. 🌌", "the answer was always 6… 7", "sigo o meu coração: ssseis… sete",
    "6️⃣ ➡️ 7️⃣, claramente", "o nevoeiro abre… vejo 6 e 7 🔮", "yes. (it's 6-7)", "as energias apontam: 67"];
  let ocupado = false;
  function escrever(el, t, fim) {
    if (SEM_MOVIMENTO) { el.textContent = t; if (fim) fim(); return; }
    el.textContent = ""; let i = 0;
    const tm = setInterval(() => { el.textContent += t.charAt(i++); if (i >= t.length) { clearInterval(tm); if (fim) fim(); } }, 55);
  }
  form.addEventListener("submit", e => {
    e.preventDefault(); if (ocupado) return; ocupado = true;
    const perg = input.value.trim();
    if (!SEM_MOVIMENTO) { bola.classList.add("shaking"); setTimeout(() => bola.classList.remove("shaking"), 500); }
    resp.textContent = "…";
    const a = escolha(R);
    setTimeout(() => {
      escrever(resp, a, () => FX.burstEl(bola, 10));
      ACH.unlock("crystal");
      if (perg) { const li = document.createElement("li"); li.innerHTML = `<b>“${esc(perg)}”</b> → ${esc(a)}`; hist.prepend(li); while (hist.children.length > 5) hist.lastChild.remove(); }
      ocupado = false;
    }, SEM_MOVIMENTO ? 200 : 950);
  });
}
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

// gerador "aleatório"
function iniciarRandom() {
  const btn = $("#rngBtn"), meters = $$(".meter-fill"), log = $("#rngLog"), canvas = $("#rngCanvas"), ctx = canvas.getContext("2d");
  const res = $("#rngResult"), num = $("#rngNum"), stats = $("#rngStats");
  const P = ["> a iniciar reator de entropia…", "> a recolher aleatoriedade quântica…", "> a medir flutuações do vácuo… ✓",
    "> a baralhar 6 700 000 bits…", "> a consultar gerador estocástico…", "> calibrating chaos engine…",
    "> a aplicar incerteza de Heisenberg…", "> a validar com o cosmos… ✓", "> a destilar o número puro…"];
  let anim = null;
  function ruido() {
    const w = canvas.width, h = canvas.height; ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(0,255,163,.9)"; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x <= w; x += 6) { const y = h / 2 + (Math.random() - 0.5) * h * 0.85; x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke();
    ctx.fillStyle = "rgba(255,60,172,.5)"; for (let x = 0; x < w; x += 14) { const bh = Math.random() * h * 0.5; ctx.fillRect(x, h - bh, 8, bh); }
  }
  btn.addEventListener("click", () => {
    btn.disabled = true; res.hidden = true; log.textContent = ""; meters.forEach(m => m.style.width = "0%");
    if (!SEM_MOVIMENTO) anim = setInterval(ruido, 80); else ruido();
    let i = 0; const dt = SEM_MOVIMENTO ? 60 : 360;
    const t = setInterval(() => {
      log.textContent += (i === 0 ? "" : "\n") + P[i]; log.scrollTop = log.scrollHeight;
      const p = ((i + 1) / P.length) * 100; meters.forEach((m, k) => m.style.width = Math.min(100, p * [1, 0.92, 1.06][k]) + "%");
      if (++i >= P.length) { clearInterval(t); fim(); }
    }, dt);
  });
  function fim() {
    if (anim) { clearInterval(anim); anim = null; } meters.forEach(m => m.style.width = "100%");
    num.textContent = "67";
    stats.innerHTML = "confiança / confidence: <b>100%</b> · ±0.0000<br>entropia: 6,7 ZB · prob.: <b>67/67</b><br>veredito: estatisticamente inevitável ✅";
    res.hidden = false; log.textContent += "\n> RESULTADO: 67 (verificado)_"; log.scrollTop = log.scrollHeight; btn.disabled = false; ACH.unlock("rng");
    FX.burstEl(num, 28); SOM.doisTons(660, 880, "triangle");
  }
  ruido();
}

// relógio parado nas 6:07
function iniciarRelogio() {
  const ticks = $("#cTicks"), nums = $("#cNums"), hH = $("#hH"), mH = $("#mH"), sH = $("#sH"), dgSecs = $("#dgSecs");
  const NS = "http://www.w3.org/2000/svg", cx = 110, cy = 110;
  for (let i = 0; i < 60; i++) {
    const ang = i / 60 * 6.283, maj = i % 5 === 0, fora = 98, dentro = maj ? 88 : 93;
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", cx + Math.sin(ang) * dentro); l.setAttribute("y1", cy - Math.cos(ang) * dentro);
    l.setAttribute("x2", cx + Math.sin(ang) * fora); l.setAttribute("y2", cy - Math.cos(ang) * fora);
    l.setAttribute("class", "c-tick" + (maj ? " major" : "")); ticks.appendChild(l);
  }
  for (let n = 1; n <= 12; n++) {
    const ang = n / 12 * 6.283, t = document.createElementNS(NS, "text");
    t.setAttribute("x", cx + Math.sin(ang) * 76); t.setAttribute("y", cy - Math.cos(ang) * 76);
    t.setAttribute("class", "c-num" + (n === 6 || n === 7 ? " hot" : "")); t.textContent = n; nums.appendChild(t);
  }
  // Posiciona um ponteiro por coordenadas (sem transforms — evita o conflito
  // CSS transform-origin vs atributo transform do SVG, que anulava a rotação).
  // grau: 0 = topo (12h), aumenta no sentido dos ponteiros do relógio.
  function porPonteiro(el, grau, comp, cauda = 0) {
    const a = grau * Math.PI / 180;
    el.setAttribute("x1", cx - cauda * Math.sin(a));
    el.setAttribute("y1", cy + cauda * Math.cos(a));
    el.setAttribute("x2", cx + comp * Math.sin(a));
    el.setAttribute("y2", cy - comp * Math.cos(a));
  }
  porPonteiro(hH, 183.5, 50);    // hora:   6h + 7min  (180° + 3,5°)
  porPonteiro(mH, 42, 72);       // minuto: 7 min      (42°)
  porPonteiro(sH, 42, 84, 18);   // segundos: ~7 s, com cauda
  if (!SEM_MOVIMENTO) {
    // O ponteiro dos segundos treme à volta do 7 mas nunca avança
    setInterval(() => porPonteiro(sH, 42 + (Math.random() - 0.5) * 8, 84, 18), 120);
    let liga = false; setInterval(() => { liga = !liga; dgSecs.textContent = liga ? "07" : "06"; }, 600);
  } else dgSecs.textContent = "07";
}

// 67 razões
function iniciarRazoes() {
  const form = $("#reasonsForm"), input = $("#reasonsIn"), lista = $("#reasonsList"), bar = $("#reasonsBar"), count = $("#reasonsCount"), copy = $("#reasonsCopy");
  const NORMAIS = ["{X} faz toda a gente dizer 6-7", "porque {X} é literalmente 67", "{X} tem 6 problemas e 7 soluções",
    "cientificamente, {X} mede-se em 67", "sem {X} não havia six seven", "{X} is just built different (67 different)",
    "os filósofos concordam: {X} = 6, depois 7", "{X} dá-te aquele feeling de seis-sete", "{X} bate certo às 6:07",
    "por causa de {X}, conto: 1, 2… 6, 7", "{X} aparece sempre que olho o relógio", "everyone studies {X}. I just say 67."];
  const PICANTES = ["{X} sussurra «67» enquanto dormes 😴", "se inverteres {X} dá 7-6 (proibido)", "{X} foi banido em 6 países, amado em 7",
    "até os pombos sabem que {X} = 67 🐦", "{X} cheira a sexta às seis e sete", "{X} é porque o número 8 anda assustado",
    "comprovado: {X} aumenta o brainrot em 670%", "{X} apareceu-me num sonho com uma calculadora 🧮", "a minha avó disse: «{X}? six seven»",
    "{X} tem o QI de um 6 e um 7 juntos", "{X} só faz sentido depois das 6:07am", "{X} já deu 67 teses de doutoramento"];
  const CAOS = ["🤚🤌 {X} 🤌🤚 6️⃣7️⃣ AAAAH", "{X} {X} {X} sixsevensixseven SEIS SETE", "por causa do queijo. e do {X}. e do 67.",
    "{X} são três patos a fingir de número 🦆🦆🦆", "BREAKING: {X} confirmado como 67 pela ONU dos memes", "{X}??? more like SIX-SEVEN-{X}-zilla 🦖",
    "lê ao contrário e ouves 67 a 0.5x", "{X} desbloqueou o final secreto: 6… 7… 🏆", "já nem sei o que é {X} mas é 67 de certeza",
    "{X} = 🤚 = 🔮 = 🕕 = 🎲 = 67. matemática.", "o {X} olhou para mim e disse: «six seven»", "acordei a gritar {X} e estava lá o 67"];
  function baralhar(a) { const c = a.slice(); for (let i = c.length - 1; i > 0; i--) { const j = rnd(i + 1); [c[i], c[j]] = [c[j], c[i]]; } return c; }
  function construir(x) {
    const f = [];
    [{ p: NORMAIS, n: 18 }, { p: PICANTES, n: 24 }, { p: CAOS, n: 24 }].forEach(b => {
      let s = baralhar(b.p), idx = 0;
      for (let k = 0; k < b.n; k++) { if (idx >= s.length) { s = baralhar(b.p); idx = 0; } f.push(s[idx++].replaceAll("{X}", x)); }
    });
    return f;
  }
  let txtCopia = "";
  form.addEventListener("submit", e => {
    e.preventDefault();
    const x = (input.value.trim() || "isto").toLowerCase();
    const f = construir(x), remate = `${x.toUpperCase()} É 6-7. PONTO FINAL. THE END. 🤚🔮🎲🕕`;
    lista.innerHTML = ""; bar.hidden = false;
    f.forEach((t, i) => { const li = document.createElement("li"); li.textContent = t; if (i >= 42) li.classList.add("chaos"); else if (i >= 18) li.classList.add("spicy"); li.style.animationDelay = Math.min(i * 11, 650) + "ms"; lista.appendChild(li); });
    const fin = document.createElement("li"); fin.textContent = remate; fin.className = "finale"; lista.appendChild(fin);
    let n = 0; const tm = setInterval(() => { n += 3; if (n > 67) n = 67; count.textContent = `${n} / 67`; if (n >= 67) clearInterval(tm); }, 20);
    setTimeout(() => { const r = fin.getBoundingClientRect(); if (r.top < innerHeight) FX.burstEl(fin, 22); }, 200);
    txtCopia = f.map((t, i) => `${i + 1}. ${t}`).join("\n") + `\n67. ${remate}`;
    ACH.unlock("reasons");
  });
  copy.addEventListener("click", async () => { if (!txtCopia) return; try { await navigator.clipboard.writeText(txtCopia); FX.toast("📋 copiado! / copied!"); } catch { FX.toast("⚠️ não deu para copiar"); } });
}

// calculadora (dá sempre 67)
function iniciarCalculadora() {
  const screen = $("#calcScreen"), keys = $("#calcKeys");
  const LAYOUT = ["C", "(", ")", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "0", ".", "⌫", "="];
  let expr = "", pensando = false;
  function render() { screen.textContent = expr || "0"; }
  LAYOUT.forEach(k => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = k;
    b.className = "calc-key" + ("÷×−+".includes(k) ? " op" : "") + (k === "=" ? " eq" : "") + ("C⌫".includes(k) ? " fn" : "");
    b.addEventListener("click", () => premir(k));
    keys.appendChild(b);
  });
  function premir(k) {
    if (pensando) return;
    if (k === "C") { expr = ""; render(); return; }
    if (k === "⌫") { expr = expr.slice(0, -1); render(); return; }
    if (k === "=") {
      // Tem de existir pelo menos um operador (e algo de cada lado) para dar conta
      if (!/[÷×−+]/.test(expr) || !/\d[÷×−+]/.test(expr) || !/[÷×−+].*\d/.test(expr)) {
        FX.toast("🤓 mete pelo menos uma conta a sério / add a real sum (ex.: 6+7)");
        return;
      }
      pensando = true; screen.textContent = "a pensar… 🤔";
      SOM.beep(500, 2, 0.08);
      setTimeout(() => { screen.textContent = "67"; expr = "67"; pensando = false; FX.burstEl(screen, 14); ACH.unlock("calc"); }, SEM_MOVIMENTO ? 150 : 650);
      return;
    }
    expr += k; render();
  }
  render();
}

// quiz (resultado fixo: 67% six seven)
function iniciarQuiz() {
  const body = $("#quizBody"), result = $("#quizResult");
  const Q = [
    { q: "Que horas são? / What time is it?", o: ["6:07", "Já são 6:07", "67 horas", "Sempre 6:07"] },
    { q: "Quanto é 2+2?", o: ["67", "Obviamente 67", "67, duh", "67 (sempre)"] },
    { q: "Comida preferida? / Favourite food?", o: ["67 batatas", "six seven", "67% pizza", "sopa de 67"] },
    { q: "Animal espiritual? / Spirit animal?", o: ["🤚 mãozinha", "pombo do 67", "gato seis-sete", "67 patos"] },
    { q: "O sentido da vida? / Meaning of life?", o: ["six seven", "67", "6, depois 7", "🤌"] },
    { q: "Em que pensas agora? / Thinking about?", o: ["6-7", "67", "six seven", "🕕"] },
  ];
  let respondidas = 0; const dados = new Array(Q.length).fill(false);
  Q.forEach((item, qi) => {
    const div = document.createElement("div"); div.className = "quiz-q";
    div.innerHTML = `<h3>${qi + 1}. ${item.q}</h3>`;
    const opts = document.createElement("div"); opts.className = "quiz-opts";
    item.o.forEach(txt => {
      const b = document.createElement("button"); b.type = "button"; b.className = "quiz-opt"; b.textContent = txt;
      b.addEventListener("click", () => {
        $$(".quiz-opt", opts).forEach(x => x.classList.remove("sel")); b.classList.add("sel");
        if (!dados[qi]) { dados[qi] = true; respondidas++; }
      });
      opts.appendChild(b);
    });
    div.appendChild(opts); body.appendChild(div);
  });
  const submit = document.createElement("button");
  submit.type = "button"; submit.className = "act-btn full"; submit.textContent = "✅ Submeter / Submit";
  submit.addEventListener("click", () => {
    if (respondidas < Q.length) { FX.toast(`🤨 responde às ${Q.length} perguntas primeiro / answer all`); return; }
    mostrarResultado();
  });
  body.appendChild(submit);
  function mostrarResultado() {
    result.hidden = false;
    result.innerHTML = `<div class="quiz-score">67% SIX SEVEN</div>
      <p>O teu QI é exatamente <b>67</b> 🧠</p>
      <div class="quiz-bars">
        <div><small>Energia 6-7</small><div class="meter"><div class="meter-fill" style="width:67%"></div></div></div>
        <div><small>Nível de brainrot</small><div class="meter"><div class="meter-fill" style="width:100%"></div></div></div>
        <div><small>Capacidade de dizer outra coisa</small><div class="meter"><div class="meter-fill" style="width:6.7%"></div></div></div>
      </div>
      <p><b>Diagnóstico:</b> incurável. És 6-7 até à medula. 🤚</p>`;
    result.scrollIntoView({ behavior: SEM_MOVIMENTO ? "auto" : "smooth", block: "center" });
    FX.burstEl(result, 24); ACH.unlock("quiz");
  }
}

// tradutor para 67-ês
function iniciarTradutor() {
  const inp = $("#transIn"), out = $("#transOut"), swap = $("#transSwap"), copy = $("#transCopy");
  const PALAVRAS = ["six", "seven", "six-seven", "67", "sixty-seven", "seis", "sete", "6-7"];
  function traduzir(t) {
    // Substitui cada "palavra" por uma da salada, mantendo pontuação/espaços
    return t.replace(/[\p{L}\p{N}]+/gu, () => escolha(PALAVRAS));
  }
  let primeira = true;
  function correr() {
    out.value = traduzir(inp.value);
    if (primeira && inp.value.trim()) { primeira = false; ACH.unlock("translate"); }
  }
  inp.addEventListener("input", correr);
  swap.addEventListener("click", () => { inp.value = out.value; correr(); });
  copy.addEventListener("click", async () => { if (!out.value) return; try { await navigator.clipboard.writeText(out.value); FX.toast("📋 copiado! / copied!"); } catch { FX.toast("⚠️ não deu"); } });
}

// roda da sorte (cai sempre no 67)
function iniciarRoda() {
  const canvas = $("#wheelCanvas"), ctx = canvas.getContext("2d"), btn = $("#wheelBtn"), result = $("#wheelResult");
  const SEG = ["12", "67", "7", "34", "6", "67", "99", "21"];   // dois "67" para parecer natural
  const CORES = ["#ff3cac", "#ffe600", "#2bc4ff", "#a14bff", "#00ffa3", "#ff8a00", "#ff3cac", "#2bc4ff"];
  const N = SEG.length, seg = 6.283 / N, R = canvas.width / 2;
  let rot = 0, girando = false;
  function desenhar() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < N; i++) {
      const a0 = -Math.PI / 2 + i * seg + rot;
      ctx.beginPath(); ctx.moveTo(R, R); ctx.arc(R, R, R - 4, a0, a0 + seg); ctx.closePath();
      ctx.fillStyle = SEG[i] === "67" ? "#ffe600" : CORES[i]; ctx.fill();
      ctx.strokeStyle = "#14081f"; ctx.lineWidth = 3; ctx.stroke();
      // texto
      ctx.save(); ctx.translate(R, R); ctx.rotate(a0 + seg / 2);
      ctx.textAlign = "right"; ctx.fillStyle = "#14081f"; ctx.font = `bold ${SEG[i] === "67" ? 30 : 22}px "Arial Black",sans-serif`;
      ctx.fillText(SEG[i], R - 16, 8); ctx.restore();
    }
    ctx.beginPath(); ctx.arc(R, R, 22, 0, 6.283); ctx.fillStyle = "#14081f"; ctx.fill();
  }
  function girar() {
    if (girando) return; girando = true; result.textContent = ""; btn.disabled = true;
    const TWO = Math.PI * 2, alvo = 1;           // índice de um "67"
    // Resíduo que alinha o segmento alvo com o ponteiro (topo)
    const residuo = ((-(alvo + 0.5) * seg) % TWO + TWO) % TWO;
    // Destino SEMPRE à frente do rot atual (+5 voltas) → gira sempre, mesmo 2.ª vez
    let destino = rot + TWO * 5;
    destino += ((residuo - (destino % TWO)) % TWO + TWO) % TWO;
    if (SEM_MOVIMENTO) { rot = destino; desenhar(); fim(); return; }
    const ini = rot, dur = 3400, t0 = performance.now();
    let feito = false;
    const concluir = () => { if (feito) return; feito = true; rot = destino; desenhar(); fim(); };
    (function passo(t) {
      const p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      rot = ini + (destino - ini) * e; desenhar();
      if (p < 1) requestAnimationFrame(passo); else concluir();
    })(t0);
    // Rede de segurança: garante a conclusão mesmo que o rAF seja pausado/limitado
    setTimeout(concluir, dur + 400);
  }
  function fim() { girando = false; btn.disabled = false; result.textContent = "🎉 67! (que surpresa)"; SOM.ding(); FX.burstEl(result, 24); ACH.unlock("wheel"); }
  btn.addEventListener("click", girar);
  desenhar();
}

// gerador de alcunhas
function iniciarAlcunha() {
  const form = $("#userForm"), inp = $("#userIn"), out = $("#userOut"), copy = $("#userCopy");
  const PRE = ["xX_", "o_", "The", "Pro", "iam", "ItsYa", "Lord", "Mr", "Sir"];
  const POS = ["_Xx", "_67", "Slayer67", "_YT", "Gaming", "67_Official", "TTV", "_PT", "x67"];
  const MEIO = ["SixSeven", "67", "Six7", "S1xSev3n", "67_", "_67_"];
  let ultimo = "";
  function gerar(nome) {
    nome = (nome || "Anon").replace(/\s+/g, "");
    const lista = [];
    for (let i = 0; i < 5; i++) lista.push(escolha(PRE) + nome + escolha(MEIO) + escolha(POS));
    return lista;
  }
  form.addEventListener("submit", e => {
    e.preventDefault();
    out.innerHTML = ""; const nomes = gerar(inp.value.trim());
    nomes.forEach((n, i) => { const d = document.createElement("div"); d.className = "user-name"; d.style.animationDelay = (i * 60) + "ms"; d.textContent = n; d.title = "clica para copiar"; d.addEventListener("click", () => copiar(n)); out.appendChild(d); });
    ultimo = nomes[0]; copy.hidden = false; FX.burstEl(out, 14); ACH.unlock("username");
  });
  async function copiar(txt) { try { await navigator.clipboard.writeText(txt); FX.toast("📋 " + txt); } catch { FX.toast("⚠️ não deu"); } }
  copy.addEventListener("click", () => copiar(ultimo));
}

// previsão do tempo (sempre 67°)
function iniciarTempo() {
  const form = $("#weatherForm"), inp = $("#weatherIn"), card = $("#weatherCard"), week = $("#weatherWeek");
  const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const ICOS = ["☀️", "🌤️", "🌦️", "⛅", "🌈"];
  function render(cidade) {
    card.innerHTML = `<div class="weather-temp">67°</div>
      <div class="weather-desc">${cidade ? "📍 " + esc(cidade) + " · " : ""}six-seven com abertas 🤚</div>
      <div class="weather-meta"><span>💧 67% six-seven</span><span>💨 vento 6–7 km/h</span><span>🌡️ sensação 67°</span></div>`;
    week.innerHTML = "";
    DIAS.forEach((d, i) => { const el = document.createElement("div"); el.className = "weather-day"; el.innerHTML = `<b>${d}</b><div>${ICOS[i % ICOS.length]}</div><span class="wd-t">67°</span>`; week.appendChild(el); });
  }
  form.addEventListener("submit", e => { e.preventDefault(); if (inp.value.trim()) FX.toast("🙄 cidade ignorada / city ignored"); render(inp.value.trim()); ACH.unlock("weather"); });
  render("");
}

// fábrica idle (guarda no localStorage)
function iniciarFabrica() {
  const numEl = $("#factoryNum"), rateEl = $("#factoryRate"), btn = $("#factoryBtn"), perEl = $("#factoryPer"), ups = $("#upgrades"), reset = $("#factoryReset");
  const UPG = [
    { id: "mao", nome: "Mãozinha Auto 🤚", baseCost: 67, perSec: 1 },
    { id: "relogio", nome: "Relógio 6:07 🕕", baseCost: 670, perSec: 6 },
    { id: "bola", nome: "Bola de Cristal 🔮", baseCost: 6700, perSec: 67 },
    { id: "fabrica", nome: "Mega-Fábrica 🏭", baseCost: 67000, perSec: 670 },
  ];
  let st = store.get("fabrica67", null);
  if (!st || typeof st.n !== "number") st = { n: 0, perClick: 1, own: {} };
  UPG.forEach(u => { if (!st.own[u.id]) st.own[u.id] = 0; });
  const fmt = n => Math.floor(n).toLocaleString("pt-PT");
  function perSecTotal() { return UPG.reduce((s, u) => s + u.perSec * st.own[u.id], 0); }
  function custo(u) { return Math.floor(u.baseCost * Math.pow(1.5, st.own[u.id])); }
  function render() {
    numEl.textContent = fmt(st.n); rateEl.textContent = fmt(perSecTotal()) + " / seg"; perEl.textContent = st.perClick;
    ups.innerHTML = "";
    UPG.forEach(u => {
      const c = custo(u); const b = document.createElement("button"); b.type = "button"; b.className = "upg"; b.disabled = st.n < c;
      b.innerHTML = `<span><b>${u.nome}</b><br><small>+${u.perSec}/seg · tens ${st.own[u.id]}</small></span><span class="upg-cost">${fmt(c)}</span>`;
      b.addEventListener("click", () => { const cc = custo(u); if (st.n >= cc) { st.n -= cc; st.own[u.id]++; SOM.tom(523, 0, 0.12, "triangle", 0.25); salvar(); render(); } });
      ups.appendChild(b);
    });
  }
  function salvar() { store.set("fabrica67", st); }
  btn.addEventListener("click", () => { st.n += st.perClick; if (st.n >= 67) ACH.unlock("factory"); FX.burstEl(btn, 6); SOM.tom(660, 0, 0.06, "square", 0.15); render(); });
  reset.addEventListener("click", () => { st = { n: 0, perClick: 1, own: {} }; UPG.forEach(u => st.own[u.id] = 0); salvar(); render(); });
  let acc = 0;
  setInterval(() => { const ps = perSecTotal(); if (ps > 0) { st.n += ps; if (st.n >= 67) ACH.unlock("factory"); render(); acc++; if (acc % 5 === 0) salvar(); } }, 1000);
  render();
}

// pet virtual (guarda no localStorage)
function iniciarPet() {
  const pet = $("#pet"), speech = $("#petSpeech"), hungerEl = $("#petHunger"), happyEl = $("#petHappy"), feed = $("#petFeed"), play = $("#petPlay");
  const CARAS = ["🐣", "🐥", "🐤"];
  let st = store.get("pet67", null);
  if (!st) st = { hunger: 80, happy: 80, ts: Date.now() };
  // Decaimento desde a última visita (1 ponto por minuto, ~)
  const min = Math.max(0, (Date.now() - (st.ts || Date.now())) / 60000);
  st.hunger = Math.max(0, st.hunger - min * 1.5); st.happy = Math.max(0, st.happy - min * 4);
  function salvar() { st.ts = Date.now(); store.set("pet67", st); }
  function render() {
    hungerEl.style.width = st.hunger + "%"; happyEl.style.width = st.happy + "%";
    hungerEl.classList.toggle("low", st.hunger < 30); happyEl.classList.toggle("low", st.happy < 30);
    const feliz = st.happy > 40 && st.hunger > 30;
    pet.classList.toggle("sad", !feliz);
    pet.textContent = feliz ? CARAS[0] : "🥺";
  }
  function dizer(t) { speech.textContent = t; speech.classList.add("show"); setTimeout(() => speech.classList.remove("show"), 1400); }
  function festejar() { if (!SEM_MOVIMENTO) { pet.classList.remove("happy"); void pet.offsetWidth; pet.classList.add("happy"); } }
  feed.addEventListener("click", () => { st.hunger = Math.min(100, st.hunger + 20); st.happy = Math.min(100, st.happy + 5); dizer("six seven! 😋"); SOM.falar(1.3, 1.5, "six seven"); festejar(); FX.burstEl(pet, 8); salvar(); render(); ACH.unlock("pet"); });
  play.addEventListener("click", () => { st.happy = Math.min(100, st.happy + 20); st.hunger = Math.max(0, st.hunger - 5); dizer("yay! 6-7! 🎉"); SOM.doisTons(660, 880, "triangle"); festejar(); FX.burstEl(pet, 12); salvar(); render(); });
  pet.addEventListener("click", () => { dizer(escolha(["six seven!", "6-7 💛", "🤚", "seis… sete"])); festejar(); });
  // Decaimento contínuo enquanto se vê
  setInterval(() => { st.hunger = Math.max(0, st.hunger - 0.5); st.happy = Math.max(0, st.happy - 3.5); salvar(); render(); }, 4000);
  render();
}

// cliques por minuto (6,7s)
function iniciarCPM() {
  const timer = $("#cpmTimer"), btn = $("#cpmBtn"), label = $("#cpmLabel"), result = $("#cpmResult");
  const DUR = 6.7;
  let estado = "pronto", cliques = 0, fim = 0, tickTimer = null;
  const best = () => store.get("cpm67", 0);
  function reset() { estado = "pronto"; label.textContent = "START"; timer.textContent = "6.7s"; result.textContent = best() ? `recorde / best: ${best()} CPM` : ""; }
  btn.addEventListener("click", () => {
    if (estado === "pronto") {
      estado = "a-jogar"; cliques = 0; label.textContent = "CLICA!"; result.textContent = "";
      fim = performance.now() + DUR * 1000;
      tickTimer = setInterval(() => {
        const resta = Math.max(0, (fim - performance.now()) / 1000);
        timer.textContent = resta.toFixed(1) + "s";
        if (resta <= 0) terminar();
      }, 50);
    } else if (estado === "a-jogar") {
      cliques++; SOM.tom(600 + Math.random() * 200, 0, 0.05, "square", 0.18);
      label.textContent = cliques; FX.burstEl(btn, 3);
    }
  });
  function terminar() {
    clearInterval(tickTimer); estado = "espera"; timer.textContent = "0.0s";
    const cpm = Math.round(cliques / DUR * 60);
    const rec = cpm > best(); if (rec) store.set("cpm67", cpm);
    result.innerHTML = `🏁 ${cliques} cliques → <b>${cpm} CPM</b>` + (rec ? "<br>🎉 novo recorde! / new best!" : `<br>recorde: ${best()}`);
    label.textContent = "…"; btn.disabled = true; FX.burstEl(result, 20); ACH.unlock("cpm");
    // O botão fica parado 1s logo após acabar (evita recomeçar sem querer)
    setTimeout(() => { estado = "pronto"; btn.disabled = false; label.textContent = "OUTRA? / AGAIN?"; }, 1000);
  }
  reset();
}

// boombox: batida em loop + voz six/seven
function iniciarBoombox() {
  const stepsEl = $("#bbSteps"), playBtn = $("#bbPlay"), tempo = $("#bbTempo"), bpmEl = $("#bbBpm"), L = $("#bbL"), R = $("#bbR");
  const N = 8;
  const KICK = [0, 2, 4, 6], SNARE = [2, 6], CANTA = [0, 4];   // passos onde a voz canta
  let tocar = false, passo = 0, intervalo = null, vozTimer = null, vozPasso = 0;
  const cells = [];
  for (let i = 0; i < N; i++) { const c = document.createElement("div"); c.className = "bb-step" + (CANTA.includes(i) ? " on" : ""); stepsEl.appendChild(c); cells.push(c); }
  function bpmMs() { return (60 / parseInt(tempo.value, 10) / 2) * 1000; }   // colcheias

  // BATIDA (precisa, via Web Audio) — corre à velocidade do bpm
  function tick() {
    const a = SOM.ctx(); const now = a ? a.currentTime : 0;
    if (KICK.includes(passo)) SOM.kick(now);
    if (SNARE.includes(passo)) SOM.snare(now);
    SOM.hat(now);
    cells.forEach((c, i) => c.classList.toggle("active", i === passo));
    passo = (passo + 1) % N;
  }
  // VOZ (independente da batida) — cadência própria, nunca sobreposta → sem bugar a 250bpm.
  // voz com cadência própria, senão buga a 250bpm
  function vozTick() {
    const seis = vozPasso % 2 === 0;
    SOM.falar(1.25, 1, seis ? "six" : "seven");
    const spk = seis ? L : R;
    spk.classList.add("thump"); setTimeout(() => spk.classList.remove("thump"), 160);
    vozPasso++;
  }
  function vozMs() { return Math.max(600, bpmMs() * 4); }   // segue a batida, mas nunca <600ms
  function play() {
    if (tocar) return; tocar = true; playBtn.textContent = "⏹️ Parar / Stop"; passo = 0; vozPasso = 0; SOM.ctx();
    intervalo = setInterval(tick, bpmMs());
    vozTick(); vozTimer = setInterval(vozTick, vozMs());
    ACH.unlock("boombox");
  }
  function stop() {
    if (!tocar) return; tocar = false; playBtn.textContent = "▶️ Tocar / Play";
    if (intervalo) clearInterval(intervalo); intervalo = null;
    if (vozTimer) clearInterval(vozTimer); vozTimer = null;
    if (window.speechSynthesis) speechSynthesis.cancel();
    cells.forEach(c => c.classList.remove("active"));
  }
  playBtn.addEventListener("click", () => tocar ? stop() : play());
  tempo.addEventListener("input", () => {
    bpmEl.textContent = tempo.value;
    if (tocar) {
      clearInterval(intervalo); intervalo = setInterval(tick, bpmMs());
      clearInterval(vozTimer); vozTimer = setInterval(vozTick, vozMs());
    }
  });
  window.__pararBoombox = stop;   // a navegação usa isto para desligar ao sair da página
}

// scroll infinito
function iniciarScroll() {
  const feed = $("#scrollFeed"), escape = $("#escapeBtn"), depthEl = $("#scrollDepth");
  let contador = 0, sentinela = null, observer = null, conquista = false;
  const MS = ["já passaste 60 números 🤨", "porquê? / why are you still here?", "isto não acaba / it never ends",
    "vai beber água 💧 / drink water", "procura um hobby 😬", "ainda aqui? respeito / respect",
    "o 6 e o 7 nunca te largam 🤚", "scroll infinito é um estilo de vida", "podias fazer 67 coisas melhores", "o fundo é mentira 🕳️"];
  function lote(q = 14) {
    for (let i = 0; i < q; i++) {
      contador++;
      const seis = contador % 2 === 1;
      const div = document.createElement("div");
      div.className = "scroll-item " + (seis ? "s6" : "s7");
      div.textContent = seis ? "6" : "7";
      div.style.fontSize = "clamp(4rem," + (POUPAR ? (14 + rnd(8)) : (24 + rnd(14))) + "vw,14rem)";
      if (contador % 67 === 0) { div.className = "scroll-item giant"; div.textContent = "67"; div.style.fontSize = ""; }
      feed.insertBefore(div, sentinela);
      if (contador % 30 === 0) { const m = document.createElement("div"); m.className = "scroll-milestone"; m.textContent = `🚩 ${MS[Math.floor(contador / 30 - 1) % MS.length]} (nº ${contador})`; feed.insertBefore(m, sentinela); }
    }
    depthEl.textContent = "profundidade: " + contador;
    if (contador >= 300 && !conquista) { conquista = true; ACH.unlock("scroll"); }
  }
  function preparar() {
    if (sentinela) return;
    sentinela = document.createElement("div"); sentinela.style.height = "1px"; feed.appendChild(sentinela);
    lote(24);
    observer = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) lote(14); }), { root: feed, rootMargin: "500px" });
    observer.observe(sentinela);
  }
  $$("[data-view='scroll']").forEach(b => b.addEventListener("click", () => { preparar(); feed.scrollTop = 0; }));
  escape.addEventListener("click", () => { if (window.__mostrar) window.__mostrar("hub"); });
}
