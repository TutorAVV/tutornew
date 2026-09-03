/* Главная: предметы, слоты-кнопки, запись, Telegram WebApp */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const isTg = !!tg;
  if (tg) {
    try {
      tg.ready(); tg.expand();
      tg.setHeaderColor("#ffffff"); tg.setBackgroundColor("#ffffff");
    } catch (e) {}
  }

  const state = {
    subjects: ["Математика", "Физика", "Русский язык", "Обществознание", "Информатика", "Английский язык"],
    subject: "",
    format: "online",
    dates: [],      // ["2026-09-04", ...]
    date: "",
    slots: [],      // [{time, format, status}]
    time: "",
    booking: false,
    tutorName: "Репетитор",
  };

  const SUBJECT_EMOJI = {
    "Математика": "📐", "Физика": "⚛️", "Русский язык": "📝", "Обществознание": "🌍",
    "Информатика": "💻", "Английский язык": "🇬🇧", "Химия": "🧪", "Биология": "🧬", "История": "📜",
  };
  const emojiFor = (s) => SUBJECT_EMOJI[s] || "📚";
  const haptic = (type) => { try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred(type); } catch (e) {} };

  function fmtDate(dstr) {
    const d = new Date(dstr + "T00:00:00");
    const wd = d.toLocaleDateString("ru-RU", { weekday: "short" }).replace(".", "");
    const dn = d.getDate();
    const mn = d.toLocaleDateString("ru-RU", { month: "short" }).replace(".", "");
    return { wd, dn, mn };
  }
  function fmtDateLong(dstr) {
    return new Date(dstr + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  }

  // ---------- subjects ----------
  function renderSubjects() {
    const chips = $("#subjectChips"), cards = $("#subjectCards");
    const book = $("#bookSubjects");
    if (chips) chips.innerHTML = state.subjects.map((s) =>
      `<button class="chip" data-sub="${s}">${emojiFor(s)} ${s}</button>`).join("");
    if (cards) cards.innerHTML = state.subjects.map((s) =>
      `<div class="card"><div class="card-emoji">${emojiFor(s)}</div><h3>${s}</h3>
       <p class="muted">ЕГЭ и ОГЭ · онлайн и очно · пробное бесплатно</p>
       <button class="btn btn-ghost btn-sm pick-sub" data-sub="${s}">Выбрать время →</button></div>`).join("");
    if (book) book.innerHTML = state.subjects.map((s) =>
      `<button class="chip" data-book-sub="${s}">${emojiFor(s)} ${s}</button>`).join("");

    $$("#subjectChips .chip").forEach((b) => b.onclick = () => {
      selectSubject(b.dataset.sub);
      document.querySelector("#booking").scrollIntoView({ behavior: "smooth" });
    });
    $$(".pick-sub").forEach((b) => b.onclick = () => {
      selectSubject(b.dataset.sub);
      document.querySelector("#booking").scrollIntoView({ behavior: "smooth" });
    });
    $$("#bookSubjects .chip").forEach((b) => b.onclick = () => selectSubject(b.dataset.bookSub));
  }

  function selectSubject(s) {
    state.subject = s;
    $$("#bookSubjects .chip").forEach((b) => b.classList.toggle("active", b.dataset.bookSub === s));
    updateSummary();
  }

  // ---------- dates ----------
  function buildDates() {
    state.dates = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      state.dates.push(d.toISOString().slice(0, 10));
    }
    state.date = state.dates[0];
    const strip = $("#dateStrip");
    strip.innerHTML = state.dates.map((ds, i) => {
      const f = fmtDate(ds);
      const label = i === 0 ? "сег" : i === 1 ? "зав" : f.wd;
      return `<button class="date-btn${i === 0 ? " active" : ""}" data-date="${ds}">
        <span class="dw">${label}</span><span class="dn">${f.dn}</span><span class="dm">${f.mn}</span></button>`;
    }).join("");
    $$("#dateStrip .date-btn").forEach((b) => b.onclick = () => {
      state.date = b.dataset.date; state.time = "";
      $$("#dateStrip .date-btn").forEach((x) => x.classList.toggle("active", x === b));
      loadSlots();
    });
  }

  // ---------- slots ----------
  async function loadSlots() {
    const grid = $("#slotsGrid"), hint = $("#slotsHint");
    grid.innerHTML = `<div class="spin">Загружаем свободное время… ⏳</div>`;
    hint.textContent = "· " + fmtDateLong(state.date);
    try {
      const r = await fetch(`/api/slots?date=${state.date}&format=${state.format}`);
      const data = await r.json();
      state.slots = (data.slots || []).slice().sort((a, b) => a.time.localeCompare(b.time));
    } catch (e) {
      state.slots = [];
    }
    if (!state.slots.length) {
      grid.innerHTML = `<div class="slots-empty">На этот день окон нет 😔<br>Попробуйте другую дату — добавим время под вас при звонке.</div>`;
    } else {
      grid.innerHTML = state.slots.map((s) => {
        const busy = s.status === "busy";
        return `<button class="slot" data-time="${s.time}" ${busy ? "disabled" : ""}>
          <b>${s.time}</b><small>${busy ? "занято" : (s.format === "online" ? "💻 онлайн" : "📍 очно")}</small></button>`;
      }).join("");
      $$("#slotsGrid .slot").forEach((b) => b.onclick = () => {
        state.time = b.dataset.time;
        $$("#slotsGrid .slot").forEach((x) => x.classList.toggle("selected", x === b));
        try { tg && tg.HapticFeedback && tg.HapticFeedback.selectionChanged(); } catch (e) {}
        updateSummary();
      });
    }
    updateSummary();
  }

  function updateSummary() {
    const el = $("#bookSummary");
    if (!el) return;
    if (state.subject && state.date && state.time) {
      el.classList.add("ready");
      el.textContent = `✅ ${state.subject} · ${fmtDateLong(state.date)} в ${state.time} · ${state.format === "online" ? "онлайн" : "очно"}`;
    } else {
      el.classList.remove("ready");
      const need = [];
      if (!state.subject) need.push("предмет");
      if (!state.time) need.push("время");
      el.textContent = need.length ? `Выберите ${need.join(" и ")} ↑` : "Заполните имя и телефон ↓";
    }
    // Telegram MainButton
    if (tg && tg.MainButton) {
      const ready = !!(state.subject && state.date && state.time);
      if (ready) { tg.MainButton.setText("Записаться ✅"); tg.MainButton.show(); }
      else tg.MainButton.hide();
    }
  }

  // ---------- booking ----------
  function setErr(msg) { const e = $("#formErr"); if (e) e.textContent = msg || ""; }

  async function submitBooking() {
    if (state.booking) return;
    setErr("");
    const name = $("#fName").value.trim();
    const phone = $("#fPhone").value.trim();
    const grade = $("#fGrade").value;
    const comment = $("#fComment").value.trim();
    if (!state.subject) { setErr("Выберите предмет (шаг 1)"); haptic("error"); return; }
    if (!state.time) { setErr("Выберите время (шаг 4)"); haptic("error"); return; }
    if (name.length < 2) { setErr("Укажите имя"); $("#fName").focus(); haptic("error"); return; }
    if (phone.replace(/\D/g, "").length < 10) { setErr("Проверьте номер телефона"); $("#fPhone").focus(); haptic("error"); return; }

    state.booking = true;
    const btn = $("#bookBtn");
    btn.disabled = true; btn.textContent = "Записываем… ⏳";
    try {
      let contact = "";
      if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const u = tg.initDataUnsafe.user;
        contact = "tg:" + (u.username ? "@" + u.username : "id" + u.id);
      }
      const r = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: state.date, time: state.time, subject: state.subject, format: state.format,
          name, phone, grade, comment, contact, source: isTg ? "telegram" : "site",
        }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Не получилось записать");
      haptic("success");
      $("#formStep").classList.add("hidden");
      const s = $("#bookSuccess");
      s.classList.remove("hidden");
      $("#successText").textContent =
        `${state.subject}, ${fmtDateLong(state.date)} в ${state.time} (${state.format === "online" ? "онлайн" : "очно"}). Перезвоним на ${phone} для подтверждения.`;
      if (tg) { try { tg.MainButton.hide(); tg.showAlert("Вы записаны! 🎉"); } catch (e) {} }
      s.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      setErr(e.message);
      haptic("error");
      // время могли занять — обновить сетку
      loadSlots();
    } finally {
      state.booking = false;
      btn.disabled = false; btn.textContent = "✅ Записаться";
    }
  }

  // ---------- hero mini slots ----------
  async function loadHeroSlots() {
    const el = $("#heroSlots");
    if (!el) return;
    try {
      const d0 = new Date().toISOString().slice(0, 10);
      const r = await fetch(`/api/slots?date=${d0}`);
      const data = await r.json();
      const free = (data.slots || []).filter((s) => s.status !== "busy").slice(0, 4);
      el.innerHTML = free.length
        ? free.map((s) => `<a class="hero-chip" href="#booking">сегодня · ${s.time}</a>`).join("")
        : `<span class="muted">Сегодня всё занято — но завтра есть окна 👇</span>`;
    } catch (e) { el.innerHTML = `<span class="muted">Онлайн-запись ниже 👇</span>`; }
  }

  // ---------- init ----------
  async function init() {
    // burger
    const burger = $("#burger"), nav = $("#nav");
    if (burger) burger.onclick = () => nav.classList.toggle("open");
    $$("#nav a").forEach((a) => a.onclick = () => nav.classList.remove("open"));

    // config
    try {
      const r = await fetch("/api/config");
      const cfg = await r.json();
      if (cfg.subjects && cfg.subjects.length) state.subjects = cfg.subjects;
      if (cfg.tutorName) {
        state.tutorName = cfg.tutorName;
        const ln = $("#logoName"); if (ln) ln.textContent = cfg.tutorName;
        const fn = $("#footName"); if (fn) fn.textContent = cfg.tutorName;
      }
    } catch (e) {}

    // startapp param: ?subject=Физика
    const qs = new URLSearchParams(location.search);
    const preSub = qs.get("subject");

    renderSubjects();
    buildDates();

    // format seg
    $$("#formatSeg .seg-btn").forEach((b) => b.onclick = () => {
      state.format = b.dataset.format; state.time = "";
      $$("#formatSeg .seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      loadSlots();
    });

    if (preSub && state.subjects.includes(preSub)) selectSubject(preSub);
    // предзаполнение имени из Telegram
    try {
      const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
      if (u && u.first_name && !$("#fName").value) $("#fName").value = u.first_name;
    } catch (e) {}

    $("#bookBtn").onclick = submitBooking;
    if (tg && tg.MainButton) { try { tg.MainButton.onClick(submitBooking); } catch (e) {} }
    $("#againBtn").onclick = (e) => {
      e.preventDefault();
      $("#bookSuccess").classList.add("hidden");
      $("#formStep").classList.remove("hidden");
      state.time = "";
      loadSlots();
    };

    // Telegram contact button → ссылка на бота если задан, иначе скрыть
    const tgBtn = $("#openTgBtn");
    if (tgBtn) tgBtn.onclick = () => {
      if (isTg) { try { tg.showAlert("Вы уже в Telegram-версии 😉"); } catch (e) {} }
      else alert("Откройте этот же адрес через кнопку в нашем Telegram-боте — всё уже адаптировано 📱");
    };

    loadSlots();
    loadHeroSlots();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
