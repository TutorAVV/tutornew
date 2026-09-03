/* Сайт: слоты-кнопки, запись, мои записи (перезапись), тема */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const state = {
    subjects: ["Математика", "Физика"],
    subject: "", dates: [], date: "", slots: [], time: "",
    booking: false, tutorName: "Онлайн-уроки",
    tzLabel: "МСК+2", tutorTg: "aviation09", chatId: "",
  };

  const EMOJI = { "Математика": "📐", "Физика": "⚛️" };
  const emojiFor = (s) => EMOJI[s] || "📚";

  // ---------- theme ----------
  function initTheme() {
    const btn = $("#themeBtn");
    const saved = localStorage.getItem("theme");
    if (saved === "dark") document.body.classList.add("dark");
    const paint = () => { if (btn) btn.textContent = document.body.classList.contains("dark") ? "☀️ Светлая тема" : "🌙 Тёмная тема"; };
    paint();
    if (btn) btn.onclick = () => {
      document.body.classList.toggle("dark");
      localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
      paint();
    };
  }

  // ---------- dates ----------
  function fmtDate(ds) {
    const d = new Date(ds + "T00:00:00");
    return {
      wd: d.toLocaleDateString("ru-RU", { weekday: "short" }).replace(".", ""),
      dn: d.getDate(),
      mn: d.toLocaleDateString("ru-RU", { month: "short" }).replace(".", ""),
    };
  }
  function fmtLong(ds) {
    return new Date(ds + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  }
  function dsp(iso) { return iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4); }

  // ---------- subjects ----------
  function renderSubjects() {
    const box = $("#bookSubjects");
    box.innerHTML = state.subjects.map((s) =>
      `<button class="chip" data-s="${s}">${emojiFor(s)} ${s}</button>`).join("");
    $$("#bookSubjects .chip").forEach((b) => b.onclick = () => selectSubject(b.dataset.s));
  }
  function selectSubject(s) {
    state.subject = s;
    $$("#bookSubjects .chip").forEach((b) => b.classList.toggle("active", b.dataset.s === s));
    loadSlots();
    updateSummary();
  }

  function buildDates() {
    state.dates = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      state.dates.push(d.toISOString().slice(0, 10));
    }
    state.date = state.dates[0];
    $("#dateStrip").innerHTML = state.dates.map((ds, i) => {
      const f = fmtDate(ds);
      return `<button class="date-btn${i === 0 ? " active" : ""}" data-d="${ds}">
        <span class="dw">${i === 0 ? "сег" : i === 1 ? "зав" : f.wd}</span>
        <span class="dn">${f.dn}</span><span class="dm">${f.mn}</span></button>`;
    }).join("");
    $$("#dateStrip .date-btn").forEach((b) => b.onclick = () => {
      state.date = b.dataset.d; state.time = "";
      $$("#dateStrip .date-btn").forEach((x) => x.classList.toggle("active", x === b));
      loadSlots();
    });
  }

  // ---------- slots ----------
  const isFree = (s) => s === "open" || s === "free";
  function slotLabel(st) {
    if (st === "booked" || st === "busy") return "занято";
    if (st === "closed") return "закрыто";
    return `свободно`;
  }

  async function loadSlots() {
    const grid = $("#slotsGrid"), hint = $("#slotsHint");
    grid.innerHTML = `<div class="spin">Загружаем свободное время… ⏳</div>`;
    hint.textContent = "· " + fmtLong(state.date);
    try {
      const r = await fetch(`/api/slots?date=${state.date}&subject=${encodeURIComponent(state.subject || "")}`);
      const data = await r.json();
      state.slots = (data.slots || []).slice().sort((a, b) => a.time.localeCompare(b.time));
    } catch (e) { state.slots = []; }
    if (!state.slots.length) {
      grid.innerHTML = `<div class="slots-empty">На этот день окон нет 😔<br>Выберите другую дату выше.</div>`;
    } else {
      grid.innerHTML = state.slots.map((s) => {
        const free = isFree(s.status);
        const dur = s.duration ? `<small> · ${s.duration} мин</small>` : "";
        return `<button class="slot" data-t="${s.time}" ${free ? "" : "disabled"}>
          <b>${s.time}</b><small>${free ? "💻 " + state.tzLabel : slotLabel(s.status)}${free ? dur : ""}</small></button>`;
      }).join("");
      $$("#slotsGrid .slot").forEach((b) => b.onclick = () => {
        if (b.disabled) return;
        state.time = b.dataset.t;
        $$("#slotsGrid .slot").forEach((x) => x.classList.toggle("selected", x === b));
        updateSummary();
      });
    }
    updateSummary();
  }

  function updateSummary() {
    const el = $("#bookSummary");
    if (state.subject && state.date && state.time) {
      el.classList.add("ready");
      el.textContent = `✅ ${state.subject} · ${fmtLong(state.date)} в ${state.time} (${state.tzLabel})`;
    } else {
      el.classList.remove("ready");
      const need = [];
      if (!state.subject) need.push("предмет");
      if (!state.time) need.push("время");
      el.textContent = need.length ? `Выберите ${need.join(" и ")} ↑` : "Заполните имя и телефон ↓";
    }
  }

  // ---------- booking ----------
  function setErr(m) { $("#formErr").textContent = m || ""; }

  async function submit() {
    if (state.booking) return;
    setErr("");
    const name = $("#fName").value.trim();
    const email = $("#fEmail").value.trim();
    const phone = $("#fPhone").value.trim();
    const grade = $("#fGrade").value;
    const comment = $("#fComment").value.trim();
    if (!state.subject) { setErr("Выберите предмет (шаг 1)"); return; }
    if (!state.time) { setErr("Выберите время (шаг 3)"); return; }
    if (name.length < 2) { setErr("Укажите фамилию и имя"); $("#fName").focus(); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr("Проверьте email"); $("#fEmail").focus(); return; }
    if (phone.replace(/\D/g, "").length < 10) { setErr("Проверьте номер телефона"); $("#fPhone").focus(); return; }

    state.booking = true;
    const btn = $("#bookBtn");
    btn.disabled = true; btn.textContent = "Записываем… ⏳";
    try {
      const r = await fetch("/api/book", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: state.date, time: state.time, subject: state.subject,
          name, email, phone, grade, comment, contact: "",
          chatId: "", source: "site",
        }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Не получилось записать");
      $("#formStep").classList.add("hidden");
      const s = $("#bookSuccess");
      s.classList.remove("hidden");
      $("#successText").textContent =
        `${state.subject}, ${fmtLong(state.date)} в ${state.time} (${state.tzLabel}). Подтверждение придет на ${phone}.`;
      $("#remindNote").textContent = "💡 Запись с сайта успешно оформлена. Для автоматических напоминаний в Telegram открывайте расписание через наш Telegram-бот.";
      s.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      setErr(e.message);
      loadSlots();
    } finally {
      state.booking = false;
      btn.disabled = false; btn.textContent = "Записаться на занятие";
    }
  }

  // ---------- my bookings ----------
  async function myFind() {
    const phone = $("#myPhone").value.trim();
    const err = $("#myErr"), list = $("#myList");
    err.textContent = ""; list.innerHTML = "";
    if (phone.replace(/\D/g, "").length < 10) { err.textContent = "Введите номер телефона из заявки"; return; }
    list.innerHTML = `<div class="muted">Ищем… ⏳</div>`;
    try {
      const r = await fetch(`/api/my?phone=${encodeURIComponent(phone)}`);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Не получилось найти");
      if (!data.bookings.length) {
        list.innerHTML = `<div class="muted">Будущих записей на этот номер нет. Запишитесь выше 👆</div>`;
        return;
      }
      list.innerHTML = data.bookings.map((b) => `
        <div class="my-item">
          <div><b>${b.subject || ""}</b> · ${dsp(b.iso || b.date)} в ${b.time} (${state.tzLabel})</div>
          <button class="mini-btn danger" data-cancel="${b.id}">Отменить</button>
        </div>`).join("") +
        `<div class="muted-sm" style="margin-top:8px">Чтобы перезаписаться: отмените запись и выберите новое время выше 👆</div>`;
      $$("#myList [data-cancel]").forEach((btn) => btn.onclick = () => myCancel(btn.dataset.cancel, phone));
    } catch (e) { err.textContent = e.message; list.innerHTML = ""; }
  }

  async function myCancel(id, phone) {
    if (!confirm("Отменить эту запись? Слот освободится.")) return;
    try {
      const r = await fetch("/api/cancel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, phone }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Не получилось отменить");
      myFind();
      loadSlots();
    } catch (e) { $("#myErr").textContent = e.message; }
  }

  // ---------- init ----------
  async function init() {
    initTheme();
    const burger = $("#burger"), nav = $("#nav");
    if (burger) burger.onclick = () => nav.classList.toggle("open");
    $$("#nav a").forEach((a) => a.onclick = () => nav.classList.remove("open"));
    $("#year").textContent = new Date().getFullYear();

    try {
      const r = await fetch("/api/config");
      const cfg = await r.json();
      if (cfg.subjects && cfg.subjects.length) state.subjects = cfg.subjects;
      if (cfg.tutorName) {
        state.tutorName = cfg.tutorName;
        $("#logoName").textContent = cfg.tutorName;
        $("#footName").textContent = cfg.tutorName;
        document.title = `${cfg.tutorName} — запись онлайн`;
      }
      if (cfg.tzLabel) { state.tzLabel = cfg.tzLabel; $("#tzLabel").textContent = cfg.tzLabel; }
      if (cfg.tutorTg) { state.tutorTg = cfg.tutorTg; $("#contactTg").href = `https://t.me/${cfg.tutorTg}`; }
    } catch (e) {}

    const qs = new URLSearchParams(location.search);
    renderSubjects();
    buildDates();
    const pre = qs.get("subject");
    if (pre && state.subjects.includes(pre)) selectSubject(pre);
    else { state.subject = state.subjects[0] || ""; if (state.subject) selectSubject(state.subject); }

    $("#bookBtn").onclick = submit;
    $("#againBtn").onclick = (e) => {
      e.preventDefault();
      $("#bookSuccess").classList.add("hidden");
      $("#formStep").classList.remove("hidden");
      state.time = ""; loadSlots();
    };
    $("#myFind").onclick = myFind;
    $("#myPhone").addEventListener("keydown", (e) => { if (e.key === "Enter") myFind(); });

    loadSlots();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
