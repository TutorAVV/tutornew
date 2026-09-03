/* Telegram WebApp: слоты-кнопки, запись, haptic, source: telegram */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    try {
      tg.ready();
      tg.expand();
      tg.enableClosingConfirmation && tg.enableClosingConfirmation();
      // Apply Telegram theme
      document.body.classList.add("tg");
      if (tg.colorScheme === "dark") {
        document.body.classList.add("dark");
      }
      tg.onEvent && tg.onEvent("themeChanged", function () {
        if (tg.colorScheme === "dark") {
          document.body.classList.add("dark");
        } else {
          document.body.classList.remove("dark");
        }
      });
    } catch (e) {}
  }

  const state = {
    subjects: ["Математика", "Физика"],
    subject: "", dates: [], date: "", slots: [], time: "",
    booking: false, tutorName: "Онлайн-уроки",
    tzLabel: "МСК+2", chatId: "",
  };

  const EMOJI = { "Математика": "📐", "Физика": "⚛️" };
  const emojiFor = (s) => EMOJI[s] || "📚";
  const haptic = (t) => { try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred(t); } catch (e) {} };

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
        try { tg && tg.HapticFeedback && tg.HapticFeedback.selectionChanged(); } catch (e) {}
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
    if (tg && tg.MainButton) {
      if (state.subject && state.date && state.time) { tg.MainButton.setText("Записаться ✅"); tg.MainButton.show(); }
      else tg.MainButton.hide();
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
    if (!state.subject) { setErr("Выберите предмет (шаг 1)"); haptic("error"); return; }
    if (!state.time) { setErr("Выберите время (шаг 3)"); haptic("error"); return; }
    if (name.length < 2) { setErr("Укажите фамилию и имя"); $("#fName").focus(); haptic("error"); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr("Проверьте email"); $("#fEmail").focus(); haptic("error"); return; }
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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: state.date, time: state.time, subject: state.subject,
          name, email, phone, grade, comment, contact,
          chatId: state.chatId, source: "telegram",
        }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Не получилось записать");
      haptic("success");
      $("#formStep").classList.add("hidden");
      const s = $("#bookSuccess");
      s.classList.remove("hidden");
      $("#successText").textContent =
        `${state.subject}, ${fmtLong(state.date)} в ${state.time} (${state.tzLabel}).`;
      if (tg) { try { tg.MainButton.hide(); tg.showAlert("Вы записаны! 🎉"); } catch (e) {} }
      s.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      setErr(e.message); haptic("error");
      loadSlots();
    } finally {
      state.booking = false;
      btn.disabled = false; btn.textContent = "Записаться на занятие";
    }
  }

  // ---------- init ----------
  async function init() {
    try {
      const r = await fetch("/api/config");
      const cfg = await r.json();
      if (cfg.subjects && cfg.subjects.length) state.subjects = cfg.subjects;
      if (cfg.tzLabel) { state.tzLabel = cfg.tzLabel; $("#tzLabel").textContent = cfg.tzLabel; }
    } catch (e) {}

    try {
      const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
      if (u) {
        if (u.id) state.chatId = String(u.id);
        if (u.first_name && !$("#fName").value) {
          $("#fName").value = u.first_name + (u.last_name ? " " + u.last_name : "");
        }
      }
    } catch (e) {}

    renderSubjects();
    buildDates();
    if (state.subjects.length) selectSubject(state.subjects[0]);

    $("#bookBtn").onclick = submit;
    if (tg && tg.MainButton) { try { tg.MainButton.onClick(submit); } catch (e) {} }
    $("#againBtn").onclick = (e) => {
      e.preventDefault();
      $("#bookSuccess").classList.add("hidden");
      $("#formStep").classList.remove("hidden");
      state.time = ""; loadSlots();
    };

    loadSlots();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
