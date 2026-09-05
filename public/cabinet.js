/* Личный кабинет ученика (тестовый режим: вход по телефону без пароля).
   Сессия — в localStorage: при обновлении страницы кабинет открывается сразу,
   без экрана входа. Разделы — в адресной строке (#/schedule, #/tests, …),
   данные раздела подгружаются при первом открытии. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const SESSION_KEY = "cabinetPhone";

  let cfg = {};
  let phone = "";
  let homeData = null;
  let cache = { lessons: null, tests: null, notes: null };
  let calMonth = null;   // 1-е число месяца (Date)
  let calSel = null;     // выбранная дата (ISO)
  let entering = false;

  const VIEWS = ["", "schedule", "tests", "messages", "topics"];

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
  const STATUS = {
    new: { pill: "p-new", label: "⏳ ожидает подтверждения" },
    confirmed: { pill: "p-confirmed", label: "✅ подтверждено" },
    done: { pill: "p-done", label: "✔ проведено" },
    cancelled: { pill: "p-cancelled", label: "✕ отменено" },
  };
  const statusPill = (s) => { const m = STATUS[s] || STATUS.new; return `<span class="pill ${m.pill}">${m.label}</span>`; };

  function initTheme() {
    const btn = $("#themeBtn");
    if (localStorage.getItem("theme") === "dark") document.body.classList.add("dark");
    const paint = () => { btn.textContent = document.body.classList.contains("dark") ? "☀️ Светлая тема" : "🌙 Тёмная тема"; };
    paint();
    btn.onclick = () => { document.body.classList.toggle("dark"); localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light"); paint(); };
  }

  // ---------- вход / сессия ----------
  async function enter(rawPhone, silent) {
    if (entering) return;
    const phone0 = formatPhone(rawPhone);
    if (!validPhone(phone0)) { if (!silent) $("#cErr").textContent = "Введите номер телефона полностью"; return; }
    entering = true;
    $("#loginBox").classList.add("hidden");
    $("#cab").classList.add("hidden");
    $("#loadingBox").classList.remove("hidden");
    try {
      const r = await fetch(`/api/cabinet?phone=${encodeURIComponent(phone0)}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Не удалось войти");
      phone = phone0;
      homeData = d;
      try { localStorage.setItem(SESSION_KEY, phone0); localStorage.setItem("myPhone", phone0); } catch (e) {}
      renderHeader(d);
      renderHome();
      $("#loadingBox").classList.add("hidden");
      $("#cab").classList.remove("hidden");
      showView(currentView());
    } catch (e) {
      // ошиблись/сервер спит — показываем форму входа с текстом ошибки
      $("#loadingBox").classList.add("hidden");
      $("#loginBox").classList.remove("hidden");
      if (!silent) $("#cErr").textContent = e.message;
    } finally { entering = false; }
  }
  function logout() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    history.replaceState(null, "", location.pathname);
    location.reload();
  }

  function renderHeader(d) {
    const s = d.student;
    $("#cName").textContent = s.name || "Ученик";
    $("#cMeta").textContent = [s.grade, s.subject, s.phone].filter(Boolean).join(" · ");
    const st = d.stats;
    $("#cStats").innerHTML = [
      [st.done, "уроков проведено"], [st.upcoming, "занятий впереди"],
      [st.lastDone ? fmtDateShort(st.lastDone) : "—", "последний урок"],
    ].map(([v, l]) => `<div class="stat-box"><b>${esc(v)}</b><span>${l}</span></div>`).join("");
  }

  // ---------- главная ----------
  function renderHome() {
    const d = homeData;
    if (!d) return;
    const n = d.next;
    if (n) {
      $("#cUpcoming").innerHTML = `
        <div class="lesson-card">
          <div class="lesson-subj">${esc(n.subject || "Занятие")}</div>
          <div class="lesson-line">${esc(n.dsp)}</div>
          <div class="lesson-line">${esc(n.time)}</div>
          <div class="lesson-status">${statusPill(n.status)}</div>
        </div>`;
      $("#cReschedBlock").innerHTML = `
        <a class="btn btn-ghost btn-sm" href="/?phone=${encodeURIComponent(phone)}#my" style="text-decoration:none">🔁 Перенести занятие</a>
        <div class="muted-sm" style="margin-top:8px">Перенос — не позже чем за ${d.rescheduleHours} ч до занятия (в списке выберите, какое переносить). Отменить занятие может только преподаватель.</div>`;
    } else {
      $("#cUpcoming").innerHTML = `<div class="muted">Будущих занятий нет. <a href="/#booking">Записаться →</a></div>`;
      $("#cReschedBlock").innerHTML = "";
    }
    $("#cQuick").innerHTML = [
      ["schedule", "🗓", "Расписание", d.upcomingTotal > 0 ? `занятий впереди: ${d.upcomingTotal}` : "все занятия в календаре"],
      ["tests", "📝", "Тесты", d.testsCount ? `у вас: ${d.testsCount}` : "пока нет"],
      ["messages", "📨", "Сообщения", d.notesCount ? `от преподавателя: ${d.notesCount}` : "пока нет"],
      ["topics", "📚", "Пройденные темы", ""],
    ].map(([v, ic, title, sub]) => `
      <button class="quick-link" data-go="${v}">
        <span class="ql-ic">${ic}</span>
        <span class="ql-t"><b>${title}</b><span class="muted-sm">${sub}</span></span>
        <span class="ql-arrow">→</span>
      </button>`).join("");
    $$("#cQuick [data-go]").forEach((b) => b.onclick = () => go(b.dataset.go));
    $("#cTgHint").classList.toggle("hidden", !!d.tgLinked || !cfg.botEnabled);
  }
  async function refreshHome() {
    if (!validPhone(phone)) return;
    try {
      const r = await fetch(`/api/cabinet?phone=${encodeURIComponent(phone)}`);
      const d = await r.json();
      if (d.ok) { homeData = d; renderHeader(d); renderHome(); }
    } catch (e) {}
  }

  // ---------- календарь ----------
  function isoOf(y, m, d) { return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
  async function ensureLessons() {
    if (!cache.lessons) {
      const r = await fetch(`/api/cabinet/lessons?phone=${encodeURIComponent(phone)}`);
      const d = await r.json();
      cache.lessons = (d.ok ? d.lessons : []) || [];
    }
    return cache.lessons;
  }
  async function showSchedule() {
    const grid = $("#calGrid");
    if (!cache.lessons) {
      grid.innerHTML = `<div class="muted" style="padding:20px;text-align:center">Загружаем занятия… ⏳</div>`;
      try { await ensureLessons(); } catch (e) { grid.innerHTML = `<div class="muted">Не удалось загрузить расписание</div>`; return; }
    }
    if (!calMonth) {
      const t = new Date();
      calMonth = new Date(t.getFullYear(), t.getMonth(), 1);
      const todayIso = isoOf(t.getFullYear(), t.getMonth(), t.getDate());
      calSel = todayIso;
    }
    renderCalendar();
  }
  function renderCalendar() {
    const lessons = cache.lessons || [];
    const byDate = {};
    for (const l of lessons) (byDate[l.iso] = byDate[l.iso] || []).push(l);
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    const monthTitle = calMonth.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    $("#calTitle").textContent = monthTitle.charAt(0).toUpperCase() + monthTitle.slice(1);
    const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // Пн = 0
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayIso = isoOf(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    let cells = "";
    for (let i = 0; i < firstDow; i++) cells += `<div class="cal-cell off"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoOf(y, m, d);
      const list = byDate[iso] || [];
      const chips = list.slice(0, 2).map((l) =>
        `<span class="cal-chip c-${l.status || "new"}" title="${esc(l.time)} ${esc(l.subject)}">${esc(l.time)} ${esc(l.subject)}</span>`).join("");
      const more = list.length > 2 ? `<span class="cal-more">+${list.length - 2}</span>` : "";
      cells += `<div class="cal-cell${iso === calSel ? " sel" : ""}${iso === todayIso ? " today" : ""}" data-iso="${iso}">
        <span class="cal-num">${d}</span>
        <span class="cal-chips">${chips}${more}</span>
      </div>`;
    }
    $("#calGrid").innerHTML = cells;
    $$("#calGrid [data-iso]").forEach((c) => c.onclick = () => { calSel = c.dataset.iso; renderCalendar(); });
    renderDayDetail(byDate);
  }
  function renderDayDetail(byDate) {
    const box = $("#calDay");
    const list = (byDate && byDate[calSel]) || [];
    if (!list.length) { box.innerHTML = ""; return; }
    const d = new Date(calSel + "T00:00:00");
    const dateTitle = d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    box.innerHTML = `<h4 class="cal-day-title" style="text-transform:capitalize">${esc(dateTitle)}</h4>` + list.map((l) => `
      <div class="lesson-card">
        <div class="lesson-subj${l.status === "cancelled" ? " cancelled" : ""}">${esc(l.subject || "Занятие")}</div>
        <div class="lesson-line">${esc(l.dsp)}</div>
        <div class="lesson-line">${esc(l.time)}</div>
        <div class="lesson-status">${statusPill(l.status)}</div>
      </div>`).join("");
  }

  // ---------- тесты ----------
  async function ensureTests() {
    if (!cache.tests) {
      const r = await fetch(`/api/cabinet/tests?phone=${encodeURIComponent(phone)}`);
      const d = await r.json();
      cache.tests = (d.ok ? d.tests : []) || [];
    }
    return cache.tests;
  }
  async function showTests() {
    const box = $("#cTests");
    if (!cache.tests) { box.innerHTML = `<div class="muted">Загружаем тесты… ⏳</div>`; try { await ensureTests(); } catch (e) { box.innerHTML = `<div class="muted">Не удалось загрузить тесты</div>`; return; } }
    const tests = cache.tests;
    box.innerHTML = tests.length ? tests.map((t) => {
      const status = t.status === "finished"
        ? (t.canRetry
          ? `<a class="mini-btn" href="/test.html?t=${esc(t.id)}">🔁 Ещё попытка →</a>`
          : `<span class="pill ${t.showScore ? "p-done" : "p-confirmed"}">${t.showScore ? `✅ ${t.score}/${t.total}` : "✅ пройден"}</span>`)
        : `<a class="mini-btn" href="/test.html?t=${esc(t.id)}">${t.status === "started" ? "Продолжить →" : "Пройти →"}</a>`;
      const tries = t.maxAttempts > 1 ? ` · попыток: до ${t.maxAttempts}` : " · пройти можно один раз";
      const sub = t.status === "finished"
        ? "пройден" + (t.finishedAt ? " · " + fmtTs(t.finishedAt) : "")
        : t.status === "started" ? `начат, отвечено ${t.answered || "?"} из ${t.total}` : `вопросов: ${t.total}`;
      return `<div class="test-item">
        <div><b>${esc(t.title)}</b><div class="muted-sm">${sub}${tries}</div></div>
        ${status}
      </div>`;
    }).join("") : `<div class="muted">Пока заданий нет — здесь появятся тесты от преподавателя.</div>`;
  }

  // ---------- сообщения ----------
  async function ensureNotes() {
    if (!cache.notes) {
      const r = await fetch(`/api/cabinet/notes?phone=${encodeURIComponent(phone)}`);
      const d = await r.json();
      cache.notes = (d.ok ? d.notes : []) || [];
    }
    return cache.notes;
  }
  async function showMessages() {
    const box = $("#cNotes");
    if (!cache.notes) { box.innerHTML = `<div class="muted">Загружаем сообщения… ⏳</div>`; try { await ensureNotes(); } catch (e) { box.innerHTML = `<div class="muted">Не удалось загрузить сообщения</div>`; return; } }
    const ICON = { homework: "📝", info: "ℹ️", link: "🔗" };
    const notes = cache.notes;
    box.innerHTML = notes.length ? notes.map((n) => `
      <div class="note-card">
        <div class="muted-sm">${fmtTs(n.ts)} · ${n.type === "homework" ? "Домашнее задание" : n.type === "link" ? "Ссылка" : "Сообщение"}</div>
        <div>${ICON[n.type] || ""} ${linkify(n.text)}${n.link ? `<br><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.link)}</a>` : ""}</div>
      </div>`).join("") : `<div class="muted">Пока ничего нет — здесь появятся домашние задания и ссылки от преподавателя.</div>`;
  }

  // ---------- темы ----------
  function showTopics() {
    const s = homeData && homeData.student;
    const topics = (s && s.topics) || "";
    const box = $("#cTopics");
    if (!topics) { box.innerHTML = `Преподаватель ещё не заполнил список тем.`; return; }
    box.innerHTML = topics.split("\n").map((line) => {
      const l = line.trim();
      if (!l) return "";
      if (/^\[.+\]$/.test(l)) return `<div class="topics-subj">${esc(l.replace(/^\[|\]$/g, ""))}</div>`;
      return `<div class="topics-line">${esc(l)}</div>`;
    }).join("");
  }

  // ---------- навигация (hash-роутинг: #/schedule и т.п.) ----------
  function currentView() {
    const h = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
    return VIEWS.includes(h) ? h : "";
  }
  function go(v) {
    const target = v ? "#/" + v : "#";
    if (location.hash === target) { showView(v); return; }
    location.hash = target;
  }
  function showView(v) {
    $$(".cab-tab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    ["", "schedule", "tests", "messages", "topics"].forEach((name) => {
      const el = $(name ? "#view-" + name : "#view-home");
      if (el) el.classList.toggle("hidden", name !== v);
    });
    if (v === "") renderHome();
    else if (v === "schedule") showSchedule();
    else if (v === "tests") showTests();
    else if (v === "messages") showMessages();
    else if (v === "topics") showTopics();
    window.scrollTo({ top: 0 });
  }

  // ---------- init ----------
  async function init() {
    initTheme();
    $("#year").textContent = new Date().getFullYear();
    $$(".cab-tab").forEach((b) => b.onclick = () => go(b.dataset.view));
    $("#logoutBtn").onclick = logout;
    $("#logoutBtn2").onclick = logout;

    // календарь
    $("#calPrev").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); };
    $("#calNext").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); };
    $("#calToday").onclick = () => { const t = new Date(); calMonth = new Date(t.getFullYear(), t.getMonth(), 1); calSel = isoOf(t.getFullYear(), t.getMonth(), t.getDate()); renderCalendar(); };

    // обновление разделов
    $$(".cab-refresh").forEach((b) => b.onclick = async () => {
      const k = b.dataset.refresh;
      if (k === "home") { await refreshHome(); }
      else if (k === "lessons") { cache.lessons = null; await showSchedule(); }
      else if (k === "tests") { cache.tests = null; await showTests(); }
      else if (k === "notes") { cache.notes = null; await showMessages(); }
    });

    const input = $("#cPhone");
    const sync = () => {
      const v = formatPhone(input.value);
      if (v !== input.value) input.value = v;
      $("#cErr").textContent = "";
    };
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    $("#cEnter").onclick = () => enter(input.value.trim());
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") enter(input.value.trim()); });

    window.addEventListener("hashchange", () => { if (phone) showView(currentView()); });

    try {
      cfg = await (await fetch("/api/config")).json();
      if (cfg.tutorName) { $("#logoName").textContent = cfg.tutorName; $("#footName").textContent = cfg.tutorName; document.title = `Кабинет ученика — ${cfg.tutorName}`; }
      if (cfg.cabinetEnabled === false) { $("#loginBox").innerHTML = `<h2>Кабинет временно отключён</h2><p><a href="/">На главную</a></p>`; $("#loadingBox").classList.add("hidden"); return; }
    } catch (e) {}

    // вход: из ссылки ?phone=… или из сохранённой сессии — без экрана входа (пока грузится)
    const qs = new URLSearchParams(location.search);
    const saved = qs.get("phone") || (() => { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } })();
    if (saved && validPhone(saved)) { input.value = formatPhone(saved); enter(saved, true); }
    else { $("#loadingBox").classList.add("hidden"); }
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
