/* Личный кабинет ученика (тестовый режим: вход по телефону без пароля).
   Сессия хранится в localStorage — при обновлении страницы вход сохраняется. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const SESSION_KEY = "cabinetPhone";
  let cfg = {};
  let entering = false;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function digits(s) { return String(s || "").replace(/\D/g, ""); }
  function validPhone(s) { return digits(s).length >= 10; }
  /** Маска: +7 (999) 123-45-67 — по мере набора, чтобы ввод был предсказуемым */
  function formatPhone(val) {
    let d = digits(val);
    if (!d) return "";
    if (d[0] === "8") d = "7" + d.slice(1);
    if (d[0] === "9" && d.length <= 10) d = "7" + d;
    if (d[0] === "7") {
      const p = ["+7"];
      if (d.length > 1) p.push(" (" + d.slice(1, 4));
      if (d.length >= 4) p[1] += ")";
      if (d.length > 4) p.push(" " + d.slice(4, 7));
      if (d.length > 7) p.push("-" + d.slice(7, 9));
      if (d.length > 9) p.push("-" + d.slice(9, 11));
      return p.join("");
    }
    return "+" + d.slice(0, 15);
  }
  function fmtTs(ts) { const d = new Date(ts); return isNaN(d) ? String(ts || "") : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); }
  function fmtDateShort(iso) {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? String(iso || "") : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
  }
  function linkify(t) {
    return esc(t).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  }

  function initTheme() {
    const btn = $("#themeBtn");
    if (localStorage.getItem("theme") === "dark") document.body.classList.add("dark");
    const paint = () => { btn.textContent = document.body.classList.contains("dark") ? "☀️ Светлая тема" : "🌙 Тёмная тема"; };
    paint();
    btn.onclick = () => { document.body.classList.toggle("dark"); localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light"); paint(); };
  }

  async function enter(phone) {
    if (entering) return;
    const err = $("#cErr");
    if (!validPhone(phone)) { err.textContent = "Введите номер телефона полностью"; return; }
    entering = true;
    const btn = $("#cEnter");
    btn.disabled = true; btn.textContent = "Входим… ⏳";
    err.textContent = "";
    try {
      const r = await fetch(`/api/cabinet?phone=${encodeURIComponent(phone)}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Не удалось войти");
      try { localStorage.setItem(SESSION_KEY, phone); localStorage.setItem("myPhone", phone); } catch (e) {}
      render(d, phone);
    } catch (e) {
      err.textContent = e.message;
      try { localStorage.removeItem(SESSION_KEY); } catch (e2) {}
    } finally { entering = false; btn.disabled = false; btn.textContent = "Войти"; }
  }

  function render(d, phone) {
    $("#loginBox").classList.add("hidden");
    $("#cab").classList.remove("hidden");
    $("#logoutBtn").classList.remove("hidden");
    const s = d.student;
    $("#cName").textContent = s.name || "Ученик";
    $("#cMeta").textContent = [s.grade, s.subject, s.phone].filter(Boolean).join(" · ");
    const st = d.stats;
    $("#cStats").innerHTML = [
      [st.done, "уроков проведено"], [st.upcoming, "впереди"],
      [st.lastDone ? fmtDateShort(st.lastDone) : "—", "последний урок"],
    ].map(([v, l]) => `<div class="stat-box"><b>${esc(v)}</b><span>${l}</span></div>`).join("");

    const ICON = { homework: "📝", info: "ℹ️", link: "🔗" };
    $("#cNotes").innerHTML = d.notes.length ? d.notes.map((n) => `
      <div class="note-card">
        <div class="muted-sm">${fmtTs(n.ts)} · ${n.type === "homework" ? "Домашнее задание" : n.type === "link" ? "Ссылка" : "Сообщение"}</div>
        <div>${ICON[n.type] || ""} ${linkify(n.text)}${n.link ? `<br><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.link)}</a>` : ""}</div>
      </div>`).join("") : `<div class="muted">Пока ничего нет — здесь появятся домашние задания и ссылки от преподавателя.</div>`;

    // тесты
    $("#cTests").innerHTML = d.tests && d.tests.length ? d.tests.map((t) => {
      const status = t.status === "finished"
        ? `<span class="pill ${t.showScore ? "p-done" : "p-confirmed"}">${t.showScore ? `✅ ${t.score}/${t.total}` : "✅ пройден"}</span>`
        : `<a class="mini-btn" href="/test.html?t=${esc(t.id)}">${t.status === "started" ? "Продолжить →" : "Пройти →"}</a>`;
      return `<div class="test-item">
        <div><b>${esc(t.title)}</b><div class="muted-sm">${t.status === "finished" ? "пройден" + (t.finishedAt ? " · " + fmtTs(t.finishedAt) : "") : t.status === "started" ? `начат, отвечено ${t.answered || "?"} из ${t.total}` : `вопросов: ${t.total}`} · пройти можно один раз</div></div>
        ${status}
      </div>`;
    }).join("") : `<div class="muted">Пока заданий нет — здесь появятся тесты от преподавателя.</div>`;

    $("#cUpcoming").innerHTML = d.upcoming.length ? d.upcoming.map((b) => `
      <div class="my-item">
        <div><b>${esc(b.subject || "")}</b> · ${esc(b.dsp)} в ${esc(b.time)} (${esc(d.tzLabel)})
          <div class="muted-sm">${b.status === "confirmed" ? "✅ подтверждено" : "⏳ ожидает подтверждения"}</div></div>
        <a class="mini-btn" href="/?phone=${encodeURIComponent(phone)}#my" ${b.canReschedule ? "" : "style='opacity:.5;pointer-events:none'"}>🔁 Перенести</a>
      </div>`).join("") : `<div class="muted">Будущих занятий нет. <a href="/#booking">Записаться →</a></div>`;
    $("#cReschedNote").textContent = `Перенос возможен не позже чем за ${d.rescheduleHours} ч до занятия. Отменить занятие может только преподаватель.`;

    $("#cTopics").innerHTML = s.topics ? esc(s.topics).replace(/\n/g, "<br>") : "Преподаватель ещё не заполнил список тем.";
    $("#cHistory").innerHTML = d.history.length ? `<ul class="side-list">${d.history.map((h) => `<li>${esc(h.date)} ${esc(h.time)} — ${esc(h.subject)}</li>`).join("")}</ul>` : `<div class="muted">Завершённых занятий пока нет.</div>`;
    $("#cTgHint").classList.toggle("hidden", !!d.tgLinked || !cfg.botEnabled);
  }

  async function init() {
    initTheme();
    $("#year").textContent = new Date().getFullYear();

    // обработчики вешаем сразу — форма отвечает мгновенно, без «подлагиваний»
    const input = $("#cPhone"), btn = $("#cEnter");
    const sync = () => {
      const v = formatPhone(input.value);
      if (v !== input.value) input.value = v;
      $("#cErr").textContent = "";
    };
    input.addEventListener("input", sync);
    input.addEventListener("change", sync); // автозаполнение браузера
    btn.onclick = () => enter(input.value.trim());
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") enter(input.value.trim()); });
    $("#logoutBtn").onclick = () => {
      try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem("myPhone"); } catch (e) {}
      location.reload();
    };

    const qs = new URLSearchParams(location.search);
    const fromUrl = qs.get("phone");

    try {
      cfg = await (await fetch("/api/config")).json();
      if (cfg.tutorName) { $("#logoName").textContent = cfg.tutorName; $("#footName").textContent = cfg.tutorName; document.title = `Кабинет ученика — ${cfg.tutorName}`; }
      if (cfg.cabinetEnabled === false) { $("#loginBox").innerHTML = `<h2>Кабинет временно отключён</h2><p><a href="/">На главную</a></p>`; return; }
    } catch (e) {}

    // вход: из ссылки ?phone=… или из сохранённой сессии (иначе — просто ждём ввода)
    const saved = fromUrl || (() => { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } })();
    if (saved && validPhone(saved)) { input.value = formatPhone(saved); enter(formatPhone(saved)); }
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
