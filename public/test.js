/* Страница теста для ученика (/test.html?t=…).
   Правильные ответы приходят с сервера только после ответа на вопрос
   и только если преподаватель включил обратную связь.
   Количество попыток — настройка теста (по умолчанию одна).
   Заголовок теста — над блоком, ФИО ученика — под ним (меньше). */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const token = new URLSearchParams(location.search).get("t") || "";

  const KEY_LETTERS = "абвгдежзи";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  let T = null;        // данные теста с сервера
  let answered = {};   // индекс → {ok} (ok только при обратной связи)
  let cur = 0;         // текущий вопрос
  let selected = [];   // выбранные варианты
  let inputVal = "";
  let locked = false;  // ответ отправлен, ждём «Далее»

  function initTheme() {
    const btn = $("#themeBtn");
    if (localStorage.getItem("theme") === "dark") document.body.classList.add("dark");
    const paint = () => { btn.textContent = document.body.classList.contains("dark") ? "☀️ Светлая тема" : "🌙 Тёмная тема"; };
    paint();
    btn.onclick = () => { document.body.classList.toggle("dark"); localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light"); paint(); };
  }

  function applyNoCopy() {
    if (!T || !T.noCopy) return;
    document.body.classList.add("no-copy");
    ["copy", "cut", "contextmenu", "selectstart", "dragstart"].forEach((ev) =>
      document.addEventListener(ev, (e) => {
        const t = e.target;
        if (t && t.closest && t.closest("#quiz .quiz-input, input, textarea")) return;
        e.preventDefault();
      }, true));
  }

  function headerMeta() {
    const parts = [];
    if (T) {
      parts.push(`вопросов: ${T.count}`);
      if (T.maxAttempts > 1) parts.push(`попытка ${Math.min(T.attempts + (T.status === "finished" ? 0 : 1), T.maxAttempts)} из ${T.maxAttempts}`);
    }
    $("#tMeta").textContent = parts.join(" · ");
  }

  async function load() {
    if (!token) return renderError("Ссылка на тест неполная — попросите её прислать заново.");
    try {
      const r = await fetch(`/api/test?t=${encodeURIComponent(token)}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Тест не найден");
      T = d;
      answered = d.answeredMap || {};
      document.title = `${T.title} — тест`;
      $("#tTitle").textContent = T.title;
      if (T.student) { $("#tName").textContent = T.student; $("#tName").classList.remove("hidden"); }
      applyNoCopy();
      headerMeta();
      if (T.needName) return renderGuestName();
      if (T.status === "finished") return renderFinish(true);
      cur = firstUnanswered();
      if (cur >= T.count) return finish();
      renderQuestion();
    } catch (e) { renderError(e.message); }
  }
  function renderGuestName() {
    $("#quiz").innerHTML = `
      <div class="panel-center">
        <h3>Введите своё ФИО для сохранения результата</h3>
        <input class="quiz-input" id="guestName" type="text" placeholder="Фамилия Имя Отчество" aria-label="ФИО" autocomplete="name" maxlength="200" style="max-width:380px;text-align:center">
        <button class="btn btn-primary btn-lg" id="guestGo" style="margin-top:12px">Начать тест</button>
        <div class="form-err" id="guestErr"></div>
      </div>`;
    const inp = $("#guestName"), btn = $("#guestGo");
    const go = async () => {
      if (btn.disabled) return;
      const name = inp.value.trim();
      if (!name) { $("#guestErr").textContent = "Введите своё ФИО"; return; }
      $("#guestErr").textContent = "";
      btn.disabled = true; btn.textContent = "Сохраняем… ⏳";
      try {
        const r = await fetch("/api/test/name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, name }) });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || "Не сохранилось");
        T.name = name; T.student = name; T.needName = false;
        $("#tName").textContent = name; $("#tName").classList.remove("hidden");
        headerMeta();
        if (T.status === "finished") return renderFinish(true);
        cur = firstUnanswered();
        if (cur >= T.count) return finish();
        renderQuestion();
      } catch (e) { $("#guestErr").textContent = e.message; }
      finally { btn.disabled = false; btn.textContent = "Начать тест"; }
    };
    btn.onclick = go;
    inp.addEventListener("input", () => { $("#guestErr").textContent = ""; });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    inp.focus();
  }
  function firstUnanswered() {
    for (let i = 0; i < (T ? T.count : 0); i++) if (!answered[i]) return i;
    return T ? T.count : 0;
  }
  const answeredCount = () => Object.keys(answered).length;

  function renderError(msg) {
    $("#quiz").innerHTML = `
      <div class="panel-center">
        <div style="font-size:44px">😕</div>
        <h3>Не получилось открыть тест</h3>
        <p class="muted">${esc(msg)}</p>
        <p><a class="btn btn-ghost" href="/cabinet.html">← В кабинет ученика</a></p>
      </div>`;
  }

  function renderQuestion() {
    const q = T.questions[cur];
    const total = T.count;
    const prog = Math.round((answeredCount() / total) * 100);
    let body = "";
    if (q.type === "input") {
      body = `
        <input class="quiz-input" id="qInput" type="text" placeholder="Ваш ответ…" autocomplete="off" value="${esc(inputVal)}">
      `;
    } else {
      body = `<div class="quiz-opts">` + q.options.map((o, i) => `
        <button class="quiz-opt${selected.includes(i) ? " sel" : ""}" data-i="${i}">
          <span class="key">${KEY_LETTERS[i] || (i + 1)}</span><span>${esc(o)}</span>
        </button>`).join("") + `</div>`;
      if (q.multi) body += `<div class="muted-sm" style="margin-top:8px">Вопрос с несколькими правильными ответами — отметьте все подходящие варианты.</div>`;
    }
    $("#quiz").innerHTML = `
      <div class="muted-sm">${esc(T.title)}${T.student ? " · " + esc(T.student) : ""} · вопрос ${cur + 1} из ${total}</div>
      <div class="quiz-progress"><i style="width:${prog}%"></i></div>
      <div class="quiz-q">${esc(q.text)}</div>
      ${body}
      <div id="qFb"></div>
      <div class="hero-btns" style="margin:16px 0 0">
        <button class="btn btn-primary btn-lg" id="qAnswer" ${canAnswer() ? "" : "disabled"}>Ответить</button>
        <button class="btn btn-ghost btn-lg hidden" id="qNext"></button>
      </div>
      <div class="form-err" id="qErr"></div>`;
    if (q.type === "input") {
      const inp = $("#qInput");
      inp.addEventListener("input", () => { inputVal = inp.value; $("#qAnswer").disabled = !inp.value.trim(); });
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && inp.value.trim()) answer(); });
      inp.focus();
    } else {
      document.querySelectorAll(".quiz-opt").forEach((b) => b.onclick = () => {
        if (locked) return;
        const i = +b.dataset.i;
        if (q.multi) {
          selected = selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i];
          b.classList.toggle("sel", selected.includes(i));
        } else {
          selected = [i];
          document.querySelectorAll(".quiz-opt").forEach((x) => x.classList.toggle("sel", +x.dataset.i === i));
        }
        $("#qAnswer").disabled = !canAnswer();
      });
    }
    $("#qAnswer").onclick = answer;
  }

  function canAnswer() {
    const q = T.questions[cur];
    if (!q) return false;
    if (q.type === "input") return !!inputVal.trim();
    return selected.length > 0;
  }

  async function answer() {
    if (locked || !canAnswer()) return;
    const q = T.questions[cur];
    const payload = q.type === "input" ? inputVal.trim() : (q.multi ? selected : selected[0]);
    const btn = $("#qAnswer");
    btn.disabled = true; btn.textContent = "Проверяем… ⏳";
    $("#qErr").textContent = "";
    document.querySelectorAll(".quiz-opt").forEach((b) => b.classList.add("locked"));
    try {
      const r = await fetch("/api/test/answer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token, qi: cur, answer: payload }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Не получилось отправить ответ");
      answered[cur] = d.correct === undefined ? {} : { ok: d.correct };
      locked = true;
      const next = firstUnanswered();
      const isLast = next >= T.count;
      if (T.feedback) showFeedback(d, q);
      else $("#qFb").innerHTML = `<div class="quiz-fb ok">Ответ принят ✓</div>`;
      btn.classList.add("hidden");
      const nb = $("#qNext");
      nb.classList.remove("hidden");
      nb.textContent = isLast ? "Завершить тест 🏁" : "Следующий вопрос →";
      nb.onclick = () => {
        locked = false; selected = []; inputVal = "";
        if (isLast) finish();
        else { cur = next; renderQuestion(); }
      };
    } catch (e) {
      $("#qErr").textContent = e.message;
      btn.disabled = false; btn.textContent = "Ответить";
      document.querySelectorAll(".quiz-opt").forEach((b) => b.classList.remove("locked"));
    }
  }

  function showFeedback(d, q) {
    const ok = !!d.correct;
    let html = `<div class="quiz-fb ${ok ? "ok" : "err"}">${ok ? "✅ Верно!" : "❌ Неправильно"}`;
    if (!ok && d.correctAnswer !== undefined) {
      if (q.type === "input") html += `<br>Правильный ответ: <b>${esc(d.correctAnswer)}</b>`;
      else html += `<br>Правильный ответ: <b>${esc(markCorrect(q, d.correctAnswer))}</b>`;
    }
    html += `</div>`;
    if (d.explanation) html += `<div class="quiz-expl muted-sm">💡 ${esc(d.explanation)}</div>`;
    $("#qFb").innerHTML = html;
    // подсветим варианты
    if (q.type !== "input") {
      document.querySelectorAll(".quiz-opt").forEach((b) => {
        const i = +b.dataset.i;
        const isCorrect = Array.isArray(d.correctAnswer) ? d.correctAnswer.includes(i) : d.correctAnswer === i;
        if (isCorrect) b.classList.add("ok");
        else if (selected.includes(i)) b.classList.add("err");
      });
    }
  }
  function markCorrect(q, correctAnswer) {
    if (!Array.isArray(correctAnswer)) correctAnswer = [correctAnswer];
    return correctAnswer.map((i) => q.options[i] || ("#" + (+i + 1))).join(", ");
  }

  async function finish() {
    const r0 = await fetch("/api/test/finish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: token }),
    });
    const d = await r0.json().catch(() => ({}));
    if (!d.ok) {
      $("#quiz").innerHTML = `<div class="panel-center"><p class="form-err">${esc(d.error || "Ошибка")}</p>
        <button class="btn btn-primary" onclick="location.reload()">Попробовать снова</button></div>`;
      return;
    }
    T.status = "finished";
    T.score = d.score;
    T.canRetry = !!d.canRetry;
    T.attempts = d.attempts != null ? d.attempts : T.attempts;
    T.maxAttempts = d.maxAttempts != null ? d.maxAttempts : T.maxAttempts;
    headerMeta();
    renderFinish(false);
  }

  function renderFinish(already) {
    const showScore = T.showScore;
    let res;
    if (showScore && T.score != null) {
      const s = T.score;
      const pct = T.count ? Math.round((s / T.count) * 100) : 0;
      res = `<div class="quiz-result-num">${s} <span class="muted" style="font-size:22px">из ${T.count}</span></div>
        <p class="muted">${pct >= 80 ? "Отличный результат! 🌟" : pct >= 50 ? "Хорошо, есть куда расти 💪" : "Стоит повторить тему — разберём на занятии 📚"}</p>`;
    } else {
      res = `<div style="font-size:44px">📨</div><p>Ответы отправлены преподавателю.<br>Результат вы узнаете на занятии или в кабинете.</p>`;
    }
    const retryBtn = T.canRetry
      ? `<div style="margin:26px 0 14px;display:flex;justify-content:center"><button class="btn btn-primary" id="btnRetry">🔁 Ещё попытка (${T.attempts} из ${T.maxAttempts})</button></div>`
      : "";
    $("#quiz").innerHTML = `
      <div class="panel-center">
        <h2>Тест пройден ${already ? "" : "🏁"}</h2>
        ${res}
        ${retryBtn}
        <div class="hero-btns" style="justify-content:center;margin-top:${retryBtn ? "10px" : "26px"};gap:14px">
          <a class="btn ${retryBtn ? "btn-ghost" : "btn-primary"}" href="/cabinet.html#/tests">← К тестам</a>
          <a class="btn btn-ghost" href="/">На главную</a>
        </div>
      </div>`;
    const rb = $("#btnRetry");
    if (rb) rb.onclick = doRetry;
  }

  async function doRetry() {
    $("#quiz").innerHTML = `<div class="muted">Начинаем новую попытку… ⏳</div>`;
    const r = await fetch("/api/test/retry", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: token }),
    });
    const d = await r.json();
    if (!d.ok) { alert(d.error || "Не удалось начать новую попытку"); return load(); }
    T = d;
    answered = T.answeredMap || {};
    locked = false; selected = []; inputVal = "";
    headerMeta();
    cur = firstUnanswered();
    renderQuestion();
  }

  function init() {
    initTheme();
    $("#year").textContent = new Date().getFullYear();
    fetch("/api/config").then((r) => r.json()).then((cfg) => {
      if (cfg.tutorName) { $("#logoName").textContent = cfg.tutorName; $("#footName").textContent = cfg.tutorName; }
    }).catch(() => {});
    load();
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
