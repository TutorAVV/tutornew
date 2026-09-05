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
    tzLabel: "МСК+2", chatId: "", grades: [], rescheduleHours: 12, tutorTg: "",
    resched: null,
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
    const p = (n) => String(n).padStart(2, "0");
    for (let i = 0; i < 45; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      state.dates.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    }
    state.date = state.dates[0];
    let html = "", prevMonth = null;
    state.dates.forEach((ds, i) => {
      const f = fmtDate(ds);
      const dm = new Date(ds + "T00:00:00").getMonth();
      if (prevMonth !== null && dm !== prevMonth) html += `<div class="date-sep" aria-hidden="true"></div>`;
      prevMonth = dm;
      html += `<button class="date-btn${i === 0 ? " active" : ""}" data-d="${ds}">
        <span class="dw">${i === 0 ? "сег" : i === 1 ? "зав" : f.wd}</span>
        <span class="dn">${f.dn}</span><span class="dm">${f.mn}</span></button>`;
    });
    $("#dateStrip").innerHTML = html;
    $$("#dateStrip .date-btn").forEach((b) => b.onclick = () => {
      state.date = b.dataset.d; state.time = "";
      $$("#dateStrip .date-btn").forEach((x) => x.classList.toggle("active", x === b));
      loadSlots();
    });
    enableDateDragScroll();
  }
  function enableDateDragScroll() {
    const el = $("#dateStrip");
    if (!el || el.dataset.drag) return;
    el.dataset.drag = "1";
    let down = false, startX = 0, startScroll = 0, moved = false;
    el.addEventListener("mousedown", (e) => { down = true; moved = false; startX = e.clientX; startScroll = el.scrollLeft; e.preventDefault(); });
    window.addEventListener("mousemove", (e) => { if (!down) return; const dx = e.clientX - startX; if (Math.abs(dx) > 3) moved = true; el.scrollLeft = startScroll - dx; });
    window.addEventListener("mouseup", () => { down = false; setTimeout(() => { moved = false; }, 0); });
    el.addEventListener("click", (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
  }

  // ---------- slots ----------
  const isFree = (s) => s === "open" || s === "free";
  function slotLabel(st) {
    if (st === "booked" || st === "busy") return "занято";
    if (st === "closed") return "закрыто";
    if (st === "past") return "прошло";
    return `свободно`;
  }

  async function loadSlots() {
    const grid = $("#slotsGrid"), hint = $("#slotsHint");
    grid.innerHTML = `<div class="spin">Загружаем свободное время… ⏳</div>`;
    hint.textContent = `${fmtLong(state.date)} · время по ${state.tzLabel}`;
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
        return `<button class="slot" data-t="${s.time}" ${free ? "" : "disabled"}>
          <b>${s.time}</b>${free ? "" : `<small>${slotLabel(s.status)}</small>`}</button>`;
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
      el.textContent = (state.resched ? "🔁 Новое время: " : "✅ ") + `${state.subject} · ${fmtLong(state.date)} в ${state.time} (${state.tzLabel})`;
    } else {
      el.classList.remove("ready");
      const need = [];
      if (!state.subject) need.push("предмет");
      if (!state.time) need.push("время");
      el.textContent = need.length ? `Выберите ${need.join(" и ")} ↑` : "Заполните имя и телефон ↓";
    }
    if (tg && tg.MainButton) {
      if (state.subject && state.date && state.time) { tg.MainButton.setText(state.resched ? "Перенести 🔁" : "Записаться ✅"); tg.MainButton.show(); }
      else tg.MainButton.hide();
    }
  }

  // ---------- booking ----------
  function setErr(m) { $("#formErr").textContent = m || ""; }

  function dsp(iso) { return iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4); }

  // ---------- reschedule ----------
  function enterResched(b, phone) {
    state.resched = { id: b.id, phone, subject: b.subject, dsp: b.dsp || dsp(b.iso), time: b.time };
    $("#reschedBanner").classList.remove("hidden");
    $("#reschedInfo").textContent = `${b.subject || ""} · ${state.resched.dsp} в ${b.time} → выберите новое время`;
    $("#formFields").classList.add("hidden");
    $("#formTitle").innerHTML = `<span class="step-n">4</span> Подтверждение переноса`;
    $("#bookBtn").textContent = "Перенести на выбранное время";
    $("#bookSuccess").classList.add("hidden");
    $("#formStep").classList.remove("hidden");
    if (b.subject && state.subjects.includes(b.subject)) selectSubject(b.subject);
    state.time = ""; updateSummary();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function exitResched() {
    state.resched = null;
    $("#reschedBanner").classList.add("hidden");
    $("#formFields").classList.remove("hidden");
    $("#formTitle").innerHTML = `<span class="step-n">4</span> Ваши данные`;
    $("#bookBtn").textContent = "Записаться на занятие";
    state.time = ""; $$("#slotsGrid .slot").forEach((x) => x.classList.remove("selected"));
    updateSummary();
  }
  async function submitResched() {
    const rs = state.resched;
    state.booking = true;
    const btn = $("#bookBtn");
    btn.disabled = true; btn.textContent = "Переносим… ⏳";
    try {
      const r = await fetch("/api/reschedule", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rs.id, phone: rs.phone, date: state.date, time: state.time }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Не получилось перенести");
      haptic("success");
      const newDate = state.date, newTime = state.time, subj = state.subject;
      exitResched();
      $("#formStep").classList.add("hidden");
      const s = $("#bookSuccess");
      s.classList.remove("hidden");
      $("#successTitle").textContent = "Занятие перенесено!";
      $("#successText").textContent = `${subj}, ${fmtLong(newDate)} в ${newTime} (${state.tzLabel}).`;
      if (tg) { try { tg.MainButton.hide(); } catch (e) {} }
      $("#myPhone").value = rs.phone; myFind();
    } catch (e) {
      setErr(e.message); haptic("error");
      loadSlots();
    } finally {
      state.booking = false;
      btn.disabled = false; btn.textContent = state.resched ? "Перенести на выбранное время" : "Записаться на занятие";
    }
  }

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
      try { localStorage.setItem("myPhone", phone); } catch (e) {}
      if (!data.bookings.length) { list.innerHTML = `<div class="muted">Будущих записей нет.</div>`; return; }
      const hrs = data.rescheduleHours || state.rescheduleHours;
      list.innerHTML = data.bookings.map((b) => `
        <div class="my-item">
          <div><b>${b.subject || ""}</b> · ${b.dsp || dsp(b.iso || b.date)} в ${b.time}
            ${b.canReschedule ? "" : `<div class="muted-sm">меньше ${hrs} ч — только через преподавателя</div>`}</div>
          <button class="mini-btn" data-res="${b.id}" ${b.canReschedule ? "" : "disabled"}>🔁 Перенести</button>
        </div>`).join("") +
        `<div class="muted-sm" style="margin-top:8px">Перенос — не позже чем за ${hrs} ч. Отменить может только преподаватель${state.tutorTg ? ` — <a href="https://t.me/${state.tutorTg}">написать</a>` : ""}.</div>`;
      $$("#myList [data-res]").forEach((btn) => btn.onclick = () => {
        const b = data.bookings.find((x) => String(x.id) === btn.dataset.res);
        if (b) enterResched(b, phone);
      });
    } catch (e) { err.textContent = e.message; list.innerHTML = ""; }
  }

  async function submit() {
    if (state.booking) return;
    setErr("");
    if (state.resched) {
      if (!state.time) { setErr("Выберите новое время"); haptic("error"); return; }
      return submitResched();
    }
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
      $("#successTitle").textContent = "Вы записаны!";
      $("#successText").textContent =
        `${state.subject}, ${fmtLong(state.date)} в ${state.time} (${state.tzLabel}).\nПодтверждение придёт на ${phone}.`;      try { localStorage.setItem("myPhone", phone); } catch (e) {}
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
      if (cfg.tzLabel) state.tzLabel = cfg.tzLabel;
      if (cfg.rescheduleHours) state.rescheduleHours = cfg.rescheduleHours;
      if (cfg.tutorTg) state.tutorTg = cfg.tutorTg;
      if (cfg.grades && cfg.grades.length) {
        $("#fGrade").innerHTML = `<option value="">—</option>` + cfg.grades.map((g) => `<option>${g}</option>`).join("");
      }
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
    $("#reschedCancel").onclick = exitResched;
    $("#myFind").onclick = myFind;
    $("#myPhone").addEventListener("keydown", (e) => { if (e.key === "Enter") myFind(); });
    try { const p = localStorage.getItem("myPhone"); if (p) { $("#myPhone").value = p; if (!$("#fPhone").value) $("#fPhone").value = p; myFind(); } } catch (e) {}

    loadSlots();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
