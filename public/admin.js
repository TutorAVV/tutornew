/* Админ-панель v3: расписание, заявки, слоты, ученики, Telegram, настройки */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));
  const key = () => sessionStorage.getItem("adminKey") || "";
  const H = () => ({ "Content-Type": "application/json", "x-admin-key": key() });
  let bookings = [], schedule = [], students = [], tgUsers = [], curStudent = null, curChat = null, settingsMeta = [], settingsDefaults = {};
  let tgTimer = null;
  let schCalMonth = null, schCalSel = null;
  let schRange = null, schLoadState = "idle", schLoadRequest = 0;

  const ST_RU = { new: "Новая", confirmed: "Подтверждена", done: "Завершена", cancelled: "Отменена" };
  const SL_RU = { open: "свободен", booked: "занят", closed: "закрыт" };
  const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  /** Небольшое уведомление в углу — понятно, что действие выполнилось */
  function toast(msg, type) {
    let host = document.getElementById("toasts");
    if (!host) { host = document.createElement("div"); host.id = "toasts"; document.body.appendChild(host); }
    const el = document.createElement("div");
    el.className = "toast" + (type === "ok" ? " t-ok" : type === "err" ? " t-err" : "");
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, 3400);
  }
  function showApp(show) {
    $("#loginView").classList.toggle("hidden", show);
    $("#appView").classList.toggle("hidden", !show);
  }
  function isoToday(off) {
    const d = new Date(); d.setDate(d.getDate() + (off || 0));
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function oneMonthForward() {
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function fmtTs(ts) {
    if (!ts) return "";
    const d = new Date(ts); if (isNaN(d)) return String(ts);
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  function dayTitle(iso) {
    const d = new Date(iso + "T00:00:00");
    const t = isoToday(0), tm = isoToday(1);
    const tag = iso === t ? " · сегодня" : iso === tm ? " · завтра" : "";
    return d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }) + tag;
  }
  async function api(url, opts) {
    const r = await fetch(url, opts);
    if (r.status === 401) { showApp(false); throw new Error("unauthorized"); }
    return r.json();
  }

  async function login() {
    // ключ сохраняем только если в поле что-то введено — иначе при
    // обновлении страницы сохранённая сессия перезаписывалась пустым
    const pass = $("#adminPass").value;
    if (pass) sessionStorage.setItem("adminKey", pass);
    if (!key()) { $("#loginErr").textContent = "Введите пароль"; return; }
    $("#loginErr").textContent = "";
    try {
      const data = await api("/api/bookings", { headers: H() });
      bookings = data.bookings || [];
      renderBookings();
      showApp(true);
      loadStorageInfo();
      applyHashTab();
    } catch (e) {
      if (e.message !== "unauthorized") $("#loginErr").textContent = "Неверный пароль";
    }
  }

  async function loadStorageInfo() {
    try {
      const cfg = (await (await fetch("/api/config")).json());
      const demo = cfg.storage !== "sheets";
      $("#storageBadge").innerHTML = demo
        ? `<span class="pill p-new">демо-режим (без таблицы)</span>`
        : `<span class="pill p-free">● Google Таблица</span>`;
      $("#storageText").textContent = demo
        ? "Сейчас данные в файле на сервере (демо). Подключите Google Таблицу по README — заявки, слоты, настройки и переписка будут там."
        : "Подключено: Google Таблица через Apps Script. Старая таблица поддерживается как есть.";
      if (cfg.sheetUrl) { const a = $("#sheetLink"); a.href = cfg.sheetUrl; a.style.display = ""; }
    } catch (e) {}
  }

  // ---------- schedule (сгруппировано по дням) ----------
  async function loadSchedule() {
    const from = $("#schFrom").value, to = $("#schTo").value;
    if (!from || !to || from > to) { toast("Выберите корректный диапазон дат", "err"); return; }
    const request = ++schLoadRequest;
    const box = $("#schDays");
    schLoadState = "loading";
    box.innerHTML = `<div class="muted">Загрузка…</div>`;
    if (!$("#calModal").classList.contains("hidden")) renderSchCalendarModal();
    try {
      const data = await api(`/api/schedule?from=${from}&to=${to}`, { headers: H() });
      if (request !== schLoadRequest) return;
      if (!data.ok) throw new Error(data.error || "Ошибка загрузки расписания");
      schedule = data.slots || [];
      const rangeChanged = !schRange || schRange.from !== from || schRange.to !== to;
      schRange = { from, to };
      if (rangeChanged || !schCalMonth) {
        const today = isoToday(0);
        schCalSel = today >= from && today <= to ? today : from;
        const d = new Date(schCalSel + "T00:00:00");
        schCalMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      }
      schLoadState = "ready";
      renderSchedule();
    } catch (e) {
      if (request !== schLoadRequest) return;
      schLoadState = "error";
      if (e.message !== "unauthorized") box.innerHTML = `<div class="muted">Не удалось загрузить расписание. Нажмите «Показать», чтобы попробовать снова.</div>`;
    } finally {
      if (request === schLoadRequest && !$("#calModal").classList.contains("hidden")) renderSchCalendarModal();
    }
  }
  /** Перерисовать расписание, не потеряв позицию прокрутки */
  async function loadScheduleKeep() {
    const y = window.scrollY;
    await loadSchedule();
    window.scrollTo({ top: y });
  }

  function renderScheduleTable(list) {
    return `<table class="tbl tbl-day">
      <thead><tr><th style="width:70px">Время</th><th style="width:60px">Длит.</th><th style="width:100px">Статус</th><th>Ученик</th><th class="col-act">Действие</th></tr></thead>
      <tbody>${list.map((s) => {
        const who = s.student
          ? `<b>${esc(s.student)}</b>${s.phone ? ` · <a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : ""}${s.subject ? ` <span class="muted-sm">· ${esc(s.subject)}</span>` : ""}${s.email ? `<br><span class="muted-sm">${esc(s.email)}</span>` : ""}`
          : `<span class="muted">—</span>`;
        const acts = s.status === "booked"
          ? `<button class="mini-btn" data-free="${s.iso}|${s.time}">Освободить</button>`
          : (s.status === "open"
            ? `<button class="mini-btn" data-close="${s.iso}|${s.time}">Закрыть</button>`
            : `<button class="mini-btn" data-open="${s.iso}|${s.time}">Открыть</button>`);
        return `<tr>
          <td><b>${esc(s.time)}</b></td><td>${esc(s.duration)}</td>
          <td><span class="pill p-${s.status === "open" ? "free" : s.status === "booked" ? "busy" : "cancelled"}">${esc(SL_RU[s.status] || s.status)}</span></td>
          <td>${who}</td>
          <td class="col-act"><div class="rowbtns">${acts}<button class="mini-btn danger" data-del="${s.iso}|${s.time}" title="Удалить слот">✕</button></div></td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
  }

  function renderSchedule() {
    const days = scheduleDaysMap();
    const box = $("#schDays");
    if (!Object.keys(days).length) {
      box.innerHTML = `<div class="muted">${$("#schStatus").value ? "Слотов с выбранным статусом нет" : "В выбранном периоде слотов нет — добавьте во вкладке «Слоты»"}</div>`;
      return;
    }
    // Список по дням. Календарь — отдельным pop-up по кнопке «Календарь».
    box.innerHTML = Object.keys(days).sort().map((iso) => {
      const list = days[iso];
      const busy = list.filter((s) => s.status === "booked").length, free = list.filter((s) => s.status === "open").length;
      const selected = iso === schCalSel ? " selected" : "";
      return `<div class="day-card${selected}" id="day-${esc(iso)}">
        <div class="day-head"><b>${esc(dayTitle(iso))}</b>
          <span class="muted-sm">${free ? `свободно ${free}` : ""}${free && busy ? " · " : ""}${busy ? `занято ${busy}` : ""}</span></div>
        ${renderScheduleTable(list)}
      </div>`;
    }).join("");
    bindScheduleActions(box);
  }

  /** Обработчики кнопок слотов — работают и в списке, и в pop-up календаре */
  function bindScheduleActions(root) {
    $$("[data-free]", root).forEach((b) => b.onclick = () => freeBooked(b.dataset.free));
    $$("[data-close]", root).forEach((b) => b.onclick = () => setSlotState(b.dataset.close, "closed"));
    $$("[data-open]", root).forEach((b) => b.onclick = () => setSlotState(b.dataset.open, "open"));
    $$("[data-del]", root).forEach((b) => b.onclick = () => delSlot(b.dataset.del));
  }

  // ---------- календарь расписания: pop-up по кнопке «Календарь» ----------
  function scheduleDaysMap() {
    const f = $("#schStatus").value;
    const days = {};
    for (const s of schedule.filter((x) => !f || x.status === f)) (days[s.iso] = days[s.iso] || []).push(s);
    return days;
  }
  function openSchCalendar() {
    $("#calModal").classList.remove("hidden");
    renderSchCalendarModal();
    if (schLoadState === "idle" || schLoadState === "error") loadSchedule();
  }
  function closeSchCalendar() {
    const modal = $("#calModal");
    if (modal) modal.classList.add("hidden");
  }
  function renderAdminCalendar(days) {
    const y = schCalMonth.getFullYear(), m = schCalMonth.getMonth();
    const title = schCalMonth.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // Пн = 0
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = isoToday(0);
    const colors = { open: "done", booked: "confirmed", closed: "cancelled" };
    let cells = `<div class="admin-cal-cell off" aria-hidden="true"></div>`.repeat(firstDow);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const list = days[iso] || [];
      const outside = iso < schRange.from || iso > schRange.to;
      const chips = list.slice(0, 2).map((s) => {
        const label = [s.time, SL_RU[s.status] || s.status, s.student, s.subject].filter(Boolean).join(" · ");
        return `<span class="cal-chip c-${colors[s.status] || "new"}" title="${esc(label)}">${esc(s.time)} ${esc(s.student || SL_RU[s.status] || s.status)}</span>`;
      }).join("");
      cells += `<button type="button" class="admin-cal-cell${iso === schCalSel ? " sel" : ""}${iso === today ? " today" : ""}${outside ? " outside" : ""}"
        data-cal-day="${iso}" aria-pressed="${iso === schCalSel}"${iso === today ? ` aria-current="date"` : ""} aria-label="${esc(dayTitle(iso))} · ${outside ? "вне загруженного периода" : `слотов: ${list.length}`}">
        <span class="cal-num">${d}</span>
        <span class="admin-cal-chips">${chips}${list.length > 2 ? `<span class="admin-cal-more">+${list.length - 2}</span>` : ""}</span>
      </button>`;
    }
    const selectedSlots = days[schCalSel] || [];
    const outside = schCalSel < schRange.from || schCalSel > schRange.to;
    const emptyText = outside
      ? "Этот день вне загруженного периода. Измените даты в расписании и нажмите «Показать»."
      : $("#schStatus").value ? "На этот день нет слотов с выбранным статусом." : "На этот день слотов нет.";
    return `<div class="admin-cal">
      <div class="admin-cal-head">
        <button type="button" class="mini-btn" data-cal-nav="-1" aria-label="Предыдущий месяц">‹</button>
        <b>${esc(title.charAt(0).toUpperCase() + title.slice(1))}</b>
        <button type="button" class="mini-btn" data-cal-nav="1" aria-label="Следующий месяц">›</button>
        <button type="button" class="mini-btn" data-cal-today>Сегодня</button>
      </div>
      <p class="muted-sm">Слоты за ${dtRu(schRange.from)} — ${dtRu(schRange.to)}. Период можно изменить в расписании кнопкой «Показать».</p>
      <div class="admin-cal-weekdays">${[...WD.slice(1), WD[0]].map((d) => `<span>${d.charAt(0).toUpperCase() + d.slice(1)}</span>`).join("")}</div>
      <div class="admin-cal-grid">${cells}</div>
      <div class="cal-legend">
        <span><i class="dot d-done"></i>свободен</span>
        <span><i class="dot d-confirmed"></i>занят</span>
        <span><i class="dot d-cancelled"></i>закрыт</span>
      </div>
    </div>
    <h4 class="cal-day-title">${esc(dayTitle(schCalSel))}</h4>
    ${selectedSlots.length ? `<div class="day-card">${renderScheduleTable(selectedSlots)}</div>` : `<p class="muted-sm">${emptyText}</p>`}`;
  }

  function renderSchCalendarModal() {
    const body = $("#calModalBody");
    if (!body) return;
    const go = $("#calGoDay");
    if (schLoadState !== "ready") {
      body.innerHTML = `<div class="muted" role="status">${schLoadState === "error" ? "Не удалось загрузить расписание. Закройте календарь и нажмите «Показать», чтобы попробовать снова." : "Загрузка расписания…"}</div>`;
      go.disabled = true;
      return;
    }
    const days = scheduleDaysMap();
    body.innerHTML = renderAdminCalendar(days);
    bindScheduleActions(body);
    go.disabled = !(days[schCalSel] || []).length;
    $$("#calModalBody [data-cal-day]").forEach((b) => b.onclick = () => {
      schCalSel = b.dataset.calDay;
      renderSchCalendarModal();
      renderSchedule();
    });
    $$("#calModalBody [data-cal-nav]").forEach((b) => b.onclick = () => {
      schCalMonth = new Date(schCalMonth.getFullYear(), schCalMonth.getMonth() + (+b.dataset.calNav), 1);
      renderSchCalendarModal();
    });
    $$("#calModalBody [data-cal-today]").forEach((b) => b.onclick = () => {
      const d = new Date(); schCalMonth = new Date(d.getFullYear(), d.getMonth(), 1); schCalSel = isoToday(0);
      renderSchCalendarModal(); renderSchedule();
    });
    // «Перейти к дню» — закрыть календарь и прокрутить к карточке дня в списке
    go.onclick = () => {
      closeSchCalendar();
      const target = schCalSel && $("#day-" + schCalSel);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      else toast("На этот день слотов нет", "err");
    };
  }

  function splitDT(v) { const [date, time] = v.split("|"); return { date, time }; }
  function dtRu(date) { return String(date).split("-").reverse().join("."); }

  async function setSlotState(v, status) {
    const { date, time } = splitDT(v);
    try {
      await api("/api/admin/slots", { method: "PATCH", headers: H(), body: JSON.stringify({ date, time, status }) });
      toast(status === "closed" ? `Слот ${dtRu(date)} ${time} закрыт` : `Слот ${dtRu(date)} ${time} снова открыт`, "ok");
    } catch (e) { toast("Не получилось: " + e.message, "err"); }
    loadScheduleKeep();
  }
  async function delSlot(v) {
    if (!confirm("Удалить слот?")) return;
    const { date, time } = splitDT(v);
    try {
      await api("/api/admin/slots", { method: "DELETE", headers: H(), body: JSON.stringify({ date, time }) });
      toast(`Слот ${dtRu(date)} ${time} удалён`, "ok");
    } catch (e) { toast("Не получилось: " + e.message, "err"); }
    loadScheduleKeep();
  }
  async function freeBooked(v) {
    if (!confirm("Освободить слот? Запись ученика будет отменена (ему уйдёт уведомление, если привязан Telegram).")) return;
    const { date, time } = splitDT(v);
    const y = window.scrollY;
    try {
      const bk = bookings.find((b) => (b.iso || b.date) === date && b.time === time && b.status !== "cancelled" && b.status !== "done");
      if (bk) await api(`/api/bookings/${encodeURIComponent(bk.id)}`, { method: "PATCH", headers: H(), body: JSON.stringify({ status: "cancelled" }) });
      await api("/api/admin/slots", { method: "PATCH", headers: H(), body: JSON.stringify({ date, time, status: "open" }) });
      toast(`Слот ${dtRu(date)} ${time} освобождён, запись отменена`, "ok");
    } catch (e) { toast("Не получилось: " + e.message, "err"); }
    await reloadBookings();
    await loadScheduleKeep();
    window.scrollTo({ top: y });
  }

  async function cleanup() {
    if (!confirm("Удалить все прошедшие свободные/закрытые слоты? Занятые (история) останутся.")) return;
    try {
      const data = await api("/api/admin/cleanup-past", { method: "POST", headers: H() });
      toast(`Удалено: ${data.deleted}, занятых оставлено: ${data.keptBooked || 0}`, "ok");
    } catch (e) { toast("Не получилось: " + e.message, "err"); }
    loadScheduleKeep();
  }

  async function clearRange(mode) {
    const from = $("#clrFrom").value, to = $("#clrTo").value;
    if (!from || !to) return toast("Выберите диапазон дат", "err");
    if (!confirm(mode === "delete" ? `УДАЛИТЬ все слоты ${from} — ${to}?` : `Закрыть все слоты ${from} — ${to}?`)) return;
    try {
      const data = await api("/api/admin/clear-range", { method: "POST", headers: H(), body: JSON.stringify({ from, to, mode }) });
      toast(`Готово: обработано ${data.affected}`, "ok");
    } catch (e) { toast("Не получилось: " + e.message, "err"); }
    loadScheduleKeep();
  }

  function downloadCsv(name, head, rows) {
    const lines = [head.join(";")].concat(rows.map((r) =>
      head.map((h) => `"${String(r[h] == null ? "" : r[h]).replace(/"/g, '""')}"`).join(";")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    a.click();
  }

  // ---------- bookings ----------
  function renderBookings() {
    const st = $("#fStatus").value;
    const q = $("#fSearch").value.trim().toLowerCase();
    const rows = bookings.filter((b) =>
      (!st || b.status === st) &&
      (!q || [b.name, b.phone, b.email, b.subject, b.date, b.time, b.comment].join(" ").toLowerCase().includes(q)));
    const tb = $("#bookTable tbody");
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="5" class="muted">Заявок нет</td></tr>`; return; }
    tb.innerHTML = rows.map((b) => `<tr>
      <td><b>${esc(b.date || "")}</b> ${esc(b.time || "")}<br><span class="muted-sm">${b.source || "site"}</span></td>
      <td><b>${esc(b.name)}</b><br><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>${b.email ? `<br><span class="muted-sm">${esc(b.email)}</span>` : ""}${b.grade ? `<br><span class="muted-sm">${esc(b.grade)}</span>` : ""}${b.comment ? `<br><span class="muted-sm">💬 ${esc(b.comment)}</span>` : ""}</td>
      <td>${esc(b.subject)}</td>
      <td><span class="pill p-${b.status || "new"}">${ST_RU[b.status] || b.status}</span></td>
      <td><div class="rowbtns col">
        ${b.status === "new" ? `<button class="mini-btn" data-act="confirmed" data-id="${b.id}">✓ Подтвердить</button>` : ""}
        ${(b.status === "new" || b.status === "confirmed") ? `<button class="mini-btn" data-act="done" data-id="${b.id}">✔ Завершить</button>` : ""}
        ${(b.status === "new" || b.status === "confirmed") ? `<button class="mini-btn danger" data-act="cancelled" data-id="${b.id}">✕ Отменить</button>` : ""}
      </div></td></tr>`).join("");
    $$("#bookTable [data-act]").forEach((btn) => btn.onclick = () => setStatus(btn.dataset.id, btn.dataset.act));
  }

  async function reloadBookings() {
    const data = await api("/api/bookings", { headers: H() });
    bookings = data.bookings || [];
    renderBookings();
  }

  async function setStatus(id, status) {
    if (status === "cancelled" && !confirm("Отменить запись? Слот снова станет свободным, ученику уйдёт уведомление в Telegram (если привязан).")) return;
    const y = window.scrollY;
    try {
      await api(`/api/bookings/${encodeURIComponent(id)}`, { method: "PATCH", headers: H(), body: JSON.stringify({ status }) });
      toast(status === "confirmed" ? "Заявка подтверждена" : status === "done" ? "Заявка завершена" : "Заявка отменена, слот свободен", "ok");
    } catch (e) { toast("Не получилось: " + e.message, "err"); }
    await reloadBookings();
    await loadScheduleKeep();
    window.scrollTo({ top: y });
  }

  // ---------- slots add/generate ----------
  async function addSlot() {
    const date = $("#slotDate").value || isoToday(0);
    const time = $("#newTime").value;
    const duration = +($("#newDur").value || 50);
    if (!time) return toast("Укажите время", "err");
    try {
      const data = await api("/api/admin/slots", { method: "POST", headers: H(), body: JSON.stringify({ date, time, duration }) });
      if (!data.ok) throw new Error(data.error || "Не получилось");
      toast(`Слот ${dtRu(date)} ${time} добавлен`, "ok");
    } catch (e) { toast(e.message, "err"); }
    loadScheduleKeep();
  }

  async function generate() {
    const body = {
      from: $("#genFrom").value, to: $("#genTo").value,
      wdFrom: $("#wdFrom").value, wdTo: $("#wdTo").value,
      weFrom: $("#weFrom").value, weTo: $("#weTo").value,
      duration: +($("#genDur").value || 50), step: +($("#genStep").value || 60),
      keepExisting: $("#genKeep").checked,
      times: $("#genTimes").value.split(",").map((s) => s.trim()).filter(Boolean),
    };
    if (!body.from || !body.to) return toast("Выберите диапазон дат", "err");
    const btn = $("#genBtn"); btn.disabled = true; btn.textContent = "Генерируем… ⏳";
    try {
      const data = await api("/api/admin/generate", { method: "POST", headers: H(), body: JSON.stringify(body) });
      if (!data.ok) throw new Error(data.error || "Не получилось");
      toast(`Готово: добавлено слотов — ${data.added}`, "ok");
    } catch (e) { toast(e.message, "err"); }
    finally { btn.disabled = false; btn.textContent = "⚡ Сгенерировать"; }
    loadScheduleKeep();
  }

  // ---------- students ----------
  async function loadStudents() {
    try {
      const data = await api("/api/admin/students", { headers: H() });
      students = data.students || [];
      renderStudents();
    } catch (e) { $("#stList").innerHTML = `<div class="muted">Ошибка</div>`; }
  }
  function renderStudents() {
    const q = $("#stSearch").value.trim().toLowerCase();
    const rows = students.filter((s) => !q || [s.name, s.phone, s.grade, s.subject].join(" ").toLowerCase().includes(q));
    $("#stCount").textContent = `всего: ${students.length}`;
    if (!rows.length) { $("#stList").innerHTML = `<div class="muted">Учеников пока нет</div>`; return; }
    $("#stList").innerHTML = rows.map((s) => `
      <div class="list-item${curStudent && curStudent.phone === s.phone ? " active" : ""}" data-ph="${esc(s.phone)}">
        <div><b>${esc(s.name || "Без имени")}</b>${s.chat_id ? " <span title='Telegram привязан'>✈️</span>" : ""}</div>
        <div class="muted-sm">${esc(s.phone)}${s.grade ? " · " + esc(s.grade) : ""}${s.subject ? " · " + esc(s.subject) : ""}</div>
        <div class="muted-sm">уроков: ${s.stats.done} · впереди: ${s.stats.upcoming}</div>
      </div>`).join("");
    $$("#stList [data-ph]").forEach((el) => el.onclick = () => openStudent(el.dataset.ph));
  }
  async function openStudent(phone) {
    curStudent = students.find((s) => s.phone === phone);
    renderStudents();
    const s = curStudent; if (!s) return;
    const box = $("#stDetail");
    box.innerHTML = `
      <h3 style="margin:0 0 4px">${esc(s.name || "Без имени")}</h3>
      <div class="muted-sm" style="margin-bottom:12px"><a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>${s.tg && s.tg !== "@" ? " · " + esc(s.tg) : ""}${s.chat_id ? " · ✈️ Telegram привязан" : " · Telegram не привязан"}
        · <a href="/cabinet.html?phone=${encodeURIComponent(s.phone)}" target="_blank">кабинет ↗</a></div>
      <div class="stats-row">
        <div class="stat-box"><b>${s.stats.done}</b><span>проведено</span></div>
        <div class="stat-box"><b>${s.stats.upcoming}</b><span>впереди</span></div>
        <div class="stat-box"><b>${s.stats.cancelled}</b><span>отменено</span></div>
        <div class="stat-box"><b>${s.stats.lastDone ? s.stats.lastDone.split("-").reverse().join(".") : "—"}</b><span>последний урок</span></div>
      </div>
      <div class="form" style="margin-top:14px">
        <div class="row2">
          <label>ФИО ученика<input id="sName" value="${esc(s.name || "")}"></label>
          <label>Класс<input id="sGrade" value="${esc(s.grade || "")}"></label>
        </div>
        <div class="row2">
          <label>Предмет<input id="sSubject" value="${esc(s.subject || "")}"></label>
          <label>Chat ID Telegram<input id="sChat" value="${esc(s.chat_id || "")}" placeholder="заполняется сам после /start + номер"></label>
        </div>
        <label>Пройденные темы (видит ученик)
          <textarea id="sTopics" rows="3" placeholder="Можно выбрать из списка кнопкой ниже или написать вручную">${esc(s.topics || "")}</textarea>
        </label>
        <div class="toolbar">
          <button class="mini-btn" id="sTopicsPick">📚 Выбрать из списка тем</button>
          <span class="muted-sm">Список — по предметам и классам (4–9); можно оставить и ручной текст</span>
        </div>
        <label>Заметки для себя (ученик не видит)<textarea id="sNotes" rows="2">${esc(s.notes || "")}</textarea></label>
        <div class="toolbar"><button class="btn btn-primary btn-sm" id="sSave">💾 Сохранить карточку</button><span class="muted-sm" id="sMsg"></span></div>
      </div>
      <h4 style="margin:18px 0 8px">📨 Отправить ученику</h4>
      <div class="form">
        <div class="row2">
          <label>Тип<select id="nType"><option value="homework">📝 Домашнее задание</option><option value="info">ℹ️ Сообщение</option><option value="link">🔗 Ссылка (урок, материалы)</option></select></label>
          <label>Ссылка (необязательно)<input id="nLink" placeholder="https://…"></label>
        </div>
        <label>Текст<textarea id="nText" rows="3" placeholder="Например: №245–250 из учебника, повторить формулы сокращённого умножения"></textarea></label>
        <div class="toolbar">
          <label class="chk"><input type="checkbox" id="nCab" checked> в кабинет</label>
          <label class="chk${s.chat_id ? "" : " disabled"}"><input type="checkbox" id="nTg" ${s.chat_id ? "checked" : ""} ${s.chat_id ? "" : "disabled"}> в Telegram${s.chat_id ? "" : " (не привязан)"}</label>
        </div>
        <div class="toolbar"><button class="btn btn-primary btn-sm" id="nSend">Отправить</button><span class="muted-sm" id="nMsg"></span></div>
      </div>
      <div id="nList" class="muted-sm">Загрузка сообщений…</div>`;
    $("#sSave").onclick = async () => {
      const body = { phone: s.phone, name: $("#sName").value, grade: $("#sGrade").value, subject: $("#sSubject").value, chat_id: $("#sChat").value, topics: $("#sTopics").value, notes: $("#sNotes").value };
      const r = await api("/api/admin/students", { method: "PUT", headers: H(), body: JSON.stringify(body) });
      $("#sMsg").textContent = r.ok ? (r.renamed ? `Сохранено ✓ (имя обновлено в ${r.renamed} записях)` : "Сохранено ✓") : (r.error || "Ошибка");
      if (r.ok && r.renamed) toast(`ФИО обновлено в ${r.renamed} записях`, "ok");
      Object.assign(s, body); renderStudents();
    };
    $("#nSend").onclick = async () => {
      const sendCab = $("#nCab").checked, sendTg = s.chat_id ? $("#nTg").checked : false;
      if (!sendCab && !sendTg) return toast("Выберите, куда отправить", "err");
      const body = { phone: s.phone, type: $("#nType").value, link: $("#nLink").value, text: $("#nText").value, sendCab, sendTg };
      if (!body.text.trim() && !body.link.trim()) return toast("Введите текст", "err");
      const r = await api("/api/admin/students/notes", { method: "POST", headers: H(), body: JSON.stringify(body) });
      let msg;
      if (!r.ok) msg = r.error || "Ошибка";
      else if (!sendCab) msg = r.tg === "sent" ? "Отправлено в Telegram ✓" : "Не доставлено в Telegram";
      else msg = r.tg === "sent" ? "Отправлено в кабинет и Telegram ✓" : r.tg === "no-chat" ? "Сохранено в кабинет (Telegram не привязан)" : r.tg === "skipped" ? "Сохранено в кабинет ✓" : "Сохранено в кабинет, Telegram не доставлено";
      $("#nMsg").textContent = msg;
      if (r.ok) { toast(msg, "ok"); $("#nText").value = ""; $("#nLink").value = ""; loadNotes(s.phone); }
    };
    $("#sTopicsPick").onclick = () => openTopicsModal(s);
    loadNotes(s.phone);
  }

  // ---------- выбор тем из списка (математика/физика, 4–9 классы) ----------
  function parseTopicsText(text) {
    // «[Математика] / 7 класс: дроб, уравнения» → { sub: { grade: { тема: 1 } } }
    const out = {};
    let sub = null;
    for (const raw of String(text || "").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const sm = line.match(/^\[(.+?)\]$/);
      if (sm) { sub = sm[1].trim(); out[sub] = out[sub] || {}; continue; }
      const gm = line.match(/^([^:]+):\s*(.+)$/);
      if (gm && sub) {
        const grade = gm[1].trim();
        out[sub][grade] = out[sub][grade] || {};
        gm[2].split(",").map((x) => x.trim()).filter(Boolean).forEach((t) => out[sub][grade][t] = 1);
      }
    }
    return out;
  }
  async function openTopicsModal(st) {
    const modal = $("#topicsModal");
    const body = $("#topicsModalBody");
    modal.classList.remove("hidden");
    body.innerHTML = `<div class="muted">Загружаем список… ⏳</div>`;
    let d = { ok: false, catalog: {}, source: "" };
    try { d = await api("/api/admin/topics", { headers: H() }); } catch (e) {}
    const current = parseTopicsText($("#sTopics").value);
    const subs = Object.keys(d.catalog || {});
    $("#topicsModalInfo").textContent = d.source === "table"
      ? "Список загружен из таблицы (лист TopicCatalog — можно править его под свои темы)."
      : "Встроенный список по школьной программе, 4–9 класс. Чтобы поменять сами темы — лист TopicCatalog в таблице.";
    if (!subs.length) { body.innerHTML = `<div class="muted">Список тем недоступен. Напишите темы вручную в поле выше.</div>`; return; }
    body.innerHTML = `<div class="topics-cols">` + subs.map((sub) => `
      <div class="topics-col">
        <h4>${esc(sub)}</h4>` + Object.entries(d.catalog[sub]).map(([grade, list]) => `
          <div class="topics-grade">
            <b>${esc(grade)}</b>
            ${list.map((topic) => `
              <label class="chk chk-sm"><input type="checkbox" data-sub="${esc(sub)}" data-grade="${esc(grade)}" data-topic="${esc(topic)}"
                ${current[sub] && current[sub][grade] && current[sub][grade][topic] ? "checked" : ""}> ${esc(topic)}</label>`).join("")}
          </div>`).join("") + `
      </div>`).join("") + `</div>`;
  }
  function saveTopicsPick() {
    const checks = $$("#topicsModalBody input[type=checkbox]");
    const order = []; // порядок предметов как в списке
    const bySub = {};
    checks.forEach((c) => {
      const sub = c.dataset.sub, grade = c.dataset.grade, topic = c.dataset.topic;
      if (!bySub[sub]) { bySub[sub] = {}; order.push(sub); }
      if (!bySub[sub][grade]) bySub[sub][grade] = [];
      if (c.checked && !bySub[sub][grade].includes(topic)) bySub[sub][grade].push(topic);
    });
    const lines = [];
    order.forEach((sub) => {
      const grades = Object.keys(bySub[sub]).filter((g) => bySub[sub][g].length);
      if (!grades.length) return;
      lines.push(`[${sub}]`);
      grades.forEach((g) => lines.push(`${g}: ${bySub[sub][g].join(", ")}`));
    });
    $("#sTopics").value = lines.join("\n");
    $("#topicsModal").classList.add("hidden");
    toast("Темы подставлены в поле — нажмите «Сохранить карточку»", "ok");
  }

  async function loadNotes(phone) {
    const r = await api(`/api/admin/students/notes?phone=${encodeURIComponent(phone)}`, { headers: H() });
    const list = r.notes || [];
    const box = $("#nList"); if (!box) return;
    if (!list.length) { box.innerHTML = `<div class="muted-sm">Сообщений ученику ещё не было.</div>`; return; }
    const ICON = { homework: "📝", info: "ℹ️", link: "🔗", test: "🧪" };
    box.innerHTML = `<h4 style="margin:14px 0 6px">История</h4>` + list.map((n) => `
      <div class="note-item"><div><span class="muted-sm">${fmtTs(n.ts)}</span> ${ICON[n.type] || ""} ${esc(n.text)}${n.link ? ` <a href="${esc(n.link)}" target="_blank" rel="noopener">ссылка</a>` : ""}</div>
      <button class="mini-btn danger" data-nid="${esc(n.id)}">✕</button></div>`).join("");
    $$("#nList [data-nid]").forEach((b) => b.onclick = async () => {
      if (!confirm("Удалить сообщение из кабинета?")) return;
      await api("/api/admin/students/notes", { method: "DELETE", headers: H(), body: JSON.stringify({ id: b.dataset.nid }) });
      loadNotes(phone);
    });
  }

  // ---------- telegram ----------
  async function loadTgStatus() {
    const box = $("#tgStatus");
    try {
      const s = await api("/api/admin/tg/status", { headers: H() });
      if (!s.enabled) { box.innerHTML = `⚠️ Бот не настроен: задайте <span class="kbd">BOT_TOKEN</span> в Render → Environment.`; return; }
      const wh = s.webhook && s.webhook.url;
      box.innerHTML = `Бот: <b>@${esc(s.bot ? s.bot.username : "?")}</b> · ${wh ? `вебхук подключён ✓${s.webhook.last_error_message ? ` <span style="color:var(--danger)">(ошибка: ${esc(s.webhook.last_error_message)})</span>` : ""}` : `<span style="color:var(--danger)">вебхук не подключён</span>`}
        ${s.adminChat ? "" : " · ⚠️ ADMIN_CHAT_ID не задан"}
        <button class="mini-btn" id="tgHook">${wh ? "Переподключить вебхук" : "Подключить вебхук"}</button>`;
      $("#tgHook").onclick = async () => {
        const r = await api("/api/admin/tg/set-webhook", { method: "POST", headers: H() });
        alert(r.ok ? `Вебхук установлен: ${r.url}` : `Ошибка: ${(r.result && r.result.description) || r.error}`);
        loadTgStatus();
      };
    } catch (e) { box.textContent = "Не удалось проверить бота"; }
  }
  async function loadTgUsers() {
    try {
      const d = await api("/api/admin/tg/users", { headers: H() });
      tgUsers = d.users || [];
      const box = $("#tgUsers");
      if (!tgUsers.length) { box.innerHTML = `<div class="muted-sm">Пока никто не нажимал /start в боте.</div>`; return; }
      box.innerHTML = tgUsers.map((u) => `
        <div class="list-item${curChat === u.chat_id ? " active" : ""}" data-cid="${esc(u.chat_id)}">
          <div><b>${esc(u.display)}</b>${u.blocked ? " <span class='muted-sm'>(заблокировал бота)</span>" : ""}</div>
          <div class="muted-sm">${u.phone ? "📞 " + esc(u.phone) : "номер не указан"}${u.username ? " · @" + esc(u.username) : ""}</div>
          ${u.last ? `<div class="muted-sm">${u.last.dir === "in" ? "←" : "→"} ${esc(String(u.last.text).slice(0, 60))} <span style="opacity:.7">${fmtTs(u.last.ts)}</span></div>` : ""}
        </div>`).join("");
      $$("#tgUsers [data-cid]").forEach((el) => el.onclick = () => openChat(el.dataset.cid));
    } catch (e) { $("#tgUsers").innerHTML = `<div class="muted">Ошибка</div>`; }
  }
  async function openChat(cid) {
    curChat = cid;
    loadTgUsers();
    const u = tgUsers.find((x) => x.chat_id === cid);
    $("#tgChatHead").innerHTML = `<b>${esc(u ? u.display : cid)}</b> <span class="muted-sm">chat id ${esc(cid)}${u && u.phone ? " · " + esc(u.phone) : ""}</span>`;
    $("#tgSendBox").classList.remove("hidden");
    await loadChat();
  }
  async function loadChat() {
    if (!curChat) return;
    const d = await api(`/api/admin/tg/messages?chat_id=${encodeURIComponent(curChat)}`, { headers: H() });
    const list = d.messages || [];
    const box = $("#tgChat");
    box.innerHTML = list.length ? list.map((m) => `
      <div class="msg ${m.dir === "in" ? "in" : "out"}">
        <div class="msg-text">${esc(m.text)}</div>
        <div class="msg-meta">${fmtTs(m.ts)}${m.kind === "broadcast" ? " · рассылка" : ""}${m.status && m.status !== "ok" ? " · ⚠️ " + esc(m.status) : ""}</div>
      </div>`).join("") : `<div class="muted-sm">Сообщений ещё нет.</div>`;
    box.scrollTop = box.scrollHeight;
  }
  async function tgSendMsg() {
    const text = $("#tgText").value.trim();
    if (!curChat || !text) return;
    const btn = $("#tgSend"); btn.disabled = true;
    try {
      const r = await api("/api/admin/tg/send", { method: "POST", headers: H(), body: JSON.stringify({ chatId: curChat, text }) });
      if (!r.ok) alert("Не отправлено: " + (r.error || ""));
      else $("#tgText").value = "";
      await loadChat(); loadTgUsers();
    } finally { btn.disabled = false; }
  }
  function openBroadcast() {
    const n = tgUsers.filter((u) => !u.blocked).length;
    $("#bcCount").textContent = n;
    $("#bcText").value = ""; $("#bcConfirm").value = ""; $("#bcErr").textContent = "";
    $("#bcSend").disabled = true;
    $("#bcModal").classList.remove("hidden");
  }
  function bcCheck() {
    $("#bcSend").disabled = !($("#bcText").value.trim().length > 0 && $("#bcConfirm").value.trim() === "РАЗОСЛАТЬ");
  }
  async function bcSend() {
    const n = tgUsers.filter((u) => !u.blocked).length;
    if (!confirm(`Точно отправить ${n} получателям? Это последнее подтверждение.`)) return;
    const btn = $("#bcSend"); btn.disabled = true; btn.textContent = "Отправляем… ⏳";
    try {
      const r = await api("/api/admin/tg/broadcast", { method: "POST", headers: H(), body: JSON.stringify({ text: $("#bcText").value.trim(), confirm: $("#bcConfirm").value.trim(), expected: n }) });
      if (!r.ok) { $("#bcErr").textContent = r.error || "Ошибка"; return; }
      alert(`Рассылка выполнена. Доставлено: ${r.sent}, не доставлено: ${r.failed}`);
      $("#bcModal").classList.add("hidden");
      loadTgUsers(); if (curChat) loadChat();
    } finally { btn.textContent = "Отправить всем"; bcCheck(); }
  }

  // ---------- тесты ----------
  let tests = [], curTest = null;

  async function loadTests() {
    const box = $("#tstList");
    try {
      const data = await api("/api/admin/tests", { headers: H() });
      tests = data.tests || [];
      if (!tests.length) { box.innerHTML = `<div class="muted-sm" style="padding:8px">Тестов пока нет.<br>Нажмите «＋ Создать тест».</div>`; return; }
      box.innerHTML = tests.map((t) => `
        <div class="list-item${curTest && curTest.id === t.id ? " active" : ""}" data-tid="${esc(t.id)}">
          <div><b>${esc(t.title)}</b></div>
          <div class="muted-sm">вопросов: ${t.count} · отправлено: ${t.assigned} · пройдено: ${t.finished}</div>
          <div class="muted-sm">${fmtTs(t.created)}</div>
        </div>`).join("");
      $$("#tstList [data-tid]").forEach((el) => el.onclick = () => openTest(el.dataset.tid));
    } catch (e) { box.innerHTML = `<div class="muted">Ошибка загрузки</div>`; }
  }
  async function reloadTests() {
    const box = $("#tstList");
    box.innerHTML = `<div class="muted">Обновляем… ⏳</div>`;
    try {
      await loadTests();
      if (curTest) await loadTestResults(curTest, true);
      toast("Тесты обновлены", "ok");
    } catch (e) { toast("Не получилось: " + e.message, "err"); }
  }

  /** Готовый промпт для ИИ: на выходе — формат, который сайт сам разбирает
   *  («Ответ: б», «Пояснение: …»). Заполняет преподаватель: предмет/класс/тема/кол-во/сложность. */
  function aiPromptText(subj, grade, topic, count, diff, options) {
    const letters = "абвгдежзи";
    const examples = [];
    for (let i = 0; i < (options || 4); i++) {
      examples.push(`${letters[i]}) вариант ${i + 1}`);
    }
    const optsLine = examples.join(", ");
    return [
      `Составь тест по предмету ${subj} для ученика ${grade} класса.`,
      `Тема: ${topic}.`,
      `Количество вопросов: ${count}. Сложность: ${diff}.`,
      "",
      "Строгие требования к формату (сайт сам разберёт текст):",
      '- Вопросы нумеруются: "1. Текст вопроса"',
      `- У каждого вопроса ${options} варианта: ${optsLine}`,
      '- Сразу после вопроса — отдельной строкой "Ответ: б" (буква правильного варианта)',
      '- Следующей строкой — "Пояснение: 1–2 предложения, почему этот ответ правильный"',
      '- 2–3 вопроса могут быть открытыми: вместо вариантов — одна строка "Ответ: 3,14" (точный числовой или короткий ответ)',
      "- Без лишнего текста, без вступлений и пояснений за пределами формата.",
      "",
      "Пример:",
      "1. Сколько будет 1/2 + 1/3?",
      "а) 2/5",
      "б) 5/6",
      "в) 1/6",
      "г) 4/5",
      "Ответ: б",
      "Пояснение: Общий знаменатель 6: 3/6 + 2/6 = 5/6.",
    ].join("\n");
  }
  function aiPromptBlock() {
    return `
      <details style="margin:10px 0 4px;border:1px dashed var(--line);border-radius:12px;padding:8px 12px">
        <summary class="muted-sm" style="cursor:pointer;font-weight:700">🤖 Промпт для ИИ — заполните тему, скопируйте, вставьте в ChatGPT/Claude/Gemini</summary>
        <div class="toolbar ai-fields" style="flex-wrap:wrap;margin-top:10px">
          <label>Предмет:<select id="apSubj"><option>Математика</option><option>Физика</option></select></label>
          <label>Класс:<select id="apGrade">${[4, 5, 6, 7, 8, 9].map((g) => `<option>${g} класс</option>`).join("")}</select></label>
          <label>Тема:<input id="apTopic" type="text" placeholder="например, дроби" style="min-width:180px"></label>
          <label>Вопросов:<input id="apCount" type="number" value="10" min="1" max="30" style="width:70px" title="Сколько вопросов"></label>
          <label>Вариантов:<input id="apOptions" type="number" value="4" min="2" max="8" style="width:60px" title="Сколько вариантов ответа"></label>
          <label>Сложность:<select id="apDiff"><option>средняя</option><option>лёгкая</option><option>сложная</option></select></label>
        </div>
        <textarea id="apText" rows="10" style="width:100%;margin-top:8px;border:1.5px solid var(--line);border-radius:10px;padding:9px 12px;font-family:monospace;font-size:12.5px" readonly></textarea>
        <div class="toolbar" style="margin-top:8px">
          <button class="btn btn-primary btn-sm" id="apCopy">📋 Скопировать промпт</button>
          <span class="muted-sm">Ответ ИИ вставьте в поле «Текст теста» ниже → «Разобрать». Строки «Ответ:» и «Пояснение:» подхватятся автоматически.</span>
        </div>
      </details>`;
  }
  function bindAiPrompt() {
    const upd = () => {
      const el = $("#apText");
      if (!el) return;
      el.value = aiPromptText($("#apSubj").value, $("#apGrade").value,
        $("#apTopic").value.trim() || "тема", $("#apCount").value || "10", $("#apDiff").value, +$("#apOptions").value || 4);
    };
    ["apSubj", "apGrade", "apTopic", "apCount", "apDiff", "apOptions"].forEach((id) => {
      const el = $("#" + id);
      if (el) el.addEventListener("input", upd);
    });
    upd();
    const cb = $("#apCopy");
    if (cb) cb.onclick = () => {
      const el = $("#apText");
      const done = () => toast("Промпт скопирован — вставьте в диалог с ИИ", "ok");
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(el.value).then(done, () => { el.focus(); el.select(); document.execCommand("copy"); done(); });
      else { el.focus(); el.select(); document.execCommand("copy"); done(); }
    };
  }

  function openTestEditor() {
    curTest = null;
    renderTestsListActive();
    $("#tstDetail").innerHTML = `
      <h3 style="margin-top:0">Новый тест</h3>
      <p class="muted-sm">Вставьте тест текстом (из учебника, сайта или от ИИ) или JSON. Понимаются варианты «а) …», «1) …», «- …», ответы после вопроса («Ответ: б») или ключом в конце («Ответы: 1-б, 2-а»), а также открытые вопросы («Ответ: 3,14»).</p>
      <div class="form">
        ${aiPromptBlock()}
        <label>Текст теста<textarea id="tRaw" rows="12" placeholder="Тест: Сложение дробей

1. Сколько будет 1/2 + 1/3?
а) 2/5
б) 5/6
в) 1/5
Ответ: б

2. Чему равно число π (с точностью до сотых)?
Ответ: 3,14"></textarea></label>
        <div class="toolbar">
          <button class="btn btn-primary btn-sm" id="tParse">🔍 Разобрать</button>
          <span class="muted-sm" id="tParseMsg"></span>
        </div>
        <div id="tParsed" class="hidden">
          <label>Название теста<input id="tTitle"></label>
          <label>Количество вариантов ответа (для вопросов с выбором)<input id="tOptions" type="number" value="4" min="2" max="8" style="width:90px"></label>
          <div class="toolbar" style="flex-wrap:wrap">
            <label class="chk"><input type="checkbox" id="tFeedback" checked> показывать ученику правильность после ответа</label>
            <label class="chk"><input type="checkbox" id="tShowScore" checked> показывать ученику итоговый балл</label>
            <label class="chk"><input type="checkbox" id="tNoCopy"> запретить копирование текста</label>
            <label class="chk">попыток: <input type="number" id="tMaxAttempts" value="1" min="1" max="10" style="width:64px;margin:0" title="Сколько раз ученик может пройти тест"></label>
          </div>
          <div id="tPreview"></div>
          <details style="margin:8px 0">
            <summary class="muted-sm" style="cursor:pointer">Правка в JSON (если предпросмотр не идеален)</summary>
            <textarea id="tJson" rows="10" style="width:100%;margin-top:6px;border:1.5px solid var(--line);border-radius:10px;padding:9px 12px;font-family:monospace;font-size:12.5px"></textarea>
          </details>
          <div class="toolbar">
            <button class="btn btn-primary btn-sm" id="tSave">💾 Сохранить тест</button>
            <span class="muted-sm" id="tSaveMsg"></span>
          </div>
        </div>
        <div class="form-err" id="tErr"></div>
      </div>`;
    $("#tParse").onclick = parseTest;
    $("#tSave").onclick = saveTest;
    bindAiPrompt();
  }

  async function parseTest() {
    const raw = $("#tRaw").value.trim();
    const msg = $("#tParseMsg"), err = $("#tErr");
    msg.textContent = "Разбираем… ⏳"; err.textContent = "";
    try {
      const r = await api("/api/admin/tests/parse", { method: "POST", headers: H(), body: JSON.stringify({ raw, optionsCount: Math.max(2, Math.min(8, +$("#tOptions").value || 4)) }) });
      msg.textContent = "";
      if (!r.ok) throw new Error(r.error || "Не удалось разобрать");
      const box = $("#tParsed");
      box.classList.remove("hidden");
      $("#tTitle").value = r.title;
      $("#tJson").value = JSON.stringify(r.questions, null, 2);
      const warns = (r.warnings || []).map((w) => `<div>⚠️ ${esc(w)}</div>`).join("");
      $("#tPreview").innerHTML =
        (warns ? `<div class="warn-box">${warns}</div>` : "") +
        r.questions.map((q, i) => {
          const corr = new Set((q.correct || []).map((n) => +n - 1));
          return `
          <div class="q-preview">
            <b>${i + 1}. ${esc(q.text)}</b>
            ${q.type === "input"
              ? `<span class="muted-sm">✏️ открытый ответ: <b>${esc(q.answer)}</b></span>`
              : q.options.map((o, j) => `<div class="q-opt${corr.has(j) ? " ok" : ""}">${"абвгдежзи"[j] || (j + 1)}) ${esc(o)}${corr.has(j) ? " ✓" : ""}</div>`).join("")}
          </div>`;
        }).join("");
      $("#tParseMsg").textContent = `Нашлось вопросов: ${r.questions.length}` + (r.questions.length ? " ✓" : "");
    } catch (e) { msg.textContent = ""; err.textContent = e.message; }
  }

  async function saveTest() {
    let questions;
    try { questions = JSON.parse($("#tJson").value); }
    catch (e) { return $("#tSaveMsg").textContent = "JSON в поле правки сломан: " + e.message; }
    const body = {
      title: $("#tTitle").value.trim() || "Тест",
      questions,
      feedback: $("#tFeedback").checked,
      showScore: $("#tShowScore").checked,
      noCopy: $("#tNoCopy").checked,
      maxAttempts: Math.max(1, Math.min(10, +$("#tMaxAttempts").value || 1)),
      optionsCount: Math.max(2, Math.min(8, +$("#tOptions").value || 4)),
    };
    $("#tSaveMsg").textContent = "Сохраняем… ⏳";
    try {
      const r = await api("/api/admin/tests", { method: "POST", headers: H(), body: JSON.stringify(body) });
      if (!r.ok) throw new Error(r.error || "Не получилось");
      toast(`Тест «${r.test.title}» сохранён (${r.test.count} вопросов)`, "ok");
      await loadTests();
      openTest(r.test.id);
    } catch (e) { $("#tSaveMsg").textContent = ""; $("#tErr").textContent = e.message; }
  }

  async function openTest(id) {
    curTest = tests.find((t) => t.id === id) || null;
    renderTestsListActive();
    if (!curTest) return;
    const t = curTest;
    $("#tstDetail").innerHTML = `
      <h3 style="margin-top:0">📝 ${esc(t.title)}</h3>
      <div class="muted-sm" style="margin-bottom:10px">вопросов: ${t.count} · создан ${fmtTs(t.created)}<br>
        обратная связь после ответа: ${t.feedback ? "вкл" : "выкл"} · итоговый балл ученику: ${t.showScore ? "показывается" : "не показывается (результат — только вам)"}<br>
        копирование текста: ${t.noCopy ? "запрещено" : "разрешено"} · попыток: ${t.maxAttempts > 1 ? "до " + t.maxAttempts : "1"} · вариантов ответа: ${t.optionsCount || 4}</div>
      <div class="toolbar">
        <button class="btn btn-primary btn-sm" id="tAssign">📤 Отправить ученику</button>
        <button class="mini-btn" id="tEdit">✏️ Редактировать</button>
        <button class="mini-btn" id="tResults">📊 Результаты</button>
        <button class="mini-btn danger" id="tDelete">🗑 Удалить</button>
      </div>
      <div id="tAssignList" style="margin-top:14px"></div>`;
    $("#tAssign").onclick = () => openTestSend(t);
    $("#tEdit").onclick = () => editTest(t.id);
    $("#tResults").onclick = async () => {
      await loadTestResults(t, true);
      const el = $("#tAssignList");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Результаты обновлены", "ok");
    };
    $("#tDelete").onclick = async () => {
      if (!confirm(`Удалить тест «${t.title}» вместе с результатами?`)) return;
      try {
        await api(`/api/admin/tests/${encodeURIComponent(t.id)}`, { method: "DELETE", headers: H() });
        toast("Тест удалён", "ok");
        curTest = null;
        $("#tstDetail").innerHTML = `<div class="muted">Выберите тест слева или создайте новый.</div>`;
        loadTests();
      } catch (e) { toast("Не получилось: " + e.message, "err"); }
    };
    loadTestResults(t, true);
  }
  /** Редактор сохранённого теста. Вопросы из таблицы 0-индексные —
   *  для правки переводим в 1-индексные, сервер при сохранении переведёт обратно. */
  async function editTest(id) {
    let data;
    try {
      data = await api(`/api/admin/tests/${encodeURIComponent(id)}`, { headers: H() });
    } catch (e) { return toast("Не удалось загрузить тест: " + e.message, "err"); }
    if (!data.ok) return toast(data.error || "Ошибка", "err");
    const t = data.test;
    const questions = t.questions.map((q) => {
      const o = { type: q.type, text: q.text };
      if (q.type === "input") o.answer = q.answer;
      else { o.options = q.options || []; o.correct = (q.correct || []).map((x) => x + 1); }
      if (q.multi) o.multi = true;
      if (q.explanation) o.explanation = q.explanation;
      return o;
    });
    $("#tstDetail").innerHTML = `
      <h3 style="margin-top:0">✏️ Редактирование теста</h3>
      <p class="muted-sm">Изменения применяются сразу. Ученик, который ещё не начал, увидит новую версию; начавший — ту, что открыл.</p>
      <div class="form">
        <label>Название теста<input id="eTitle" value="${esc(t.title)}"></label>
        <div class="toolbar" style="flex-wrap:wrap">
          <label class="chk"><input type="checkbox" id="eFeedback" ${t.feedback ? "checked" : ""}> показывать ученику правильность после ответа</label>
          <label class="chk"><input type="checkbox" id="eShowScore" ${t.showScore ? "checked" : ""}> показывать ученику итоговый балл</label>
          <label class="chk"><input type="checkbox" id="eNoCopy" ${t.noCopy ? "checked" : ""}> запретить копирование текста</label>
          <label class="chk">попыток: <input type="number" id="eMaxAttempts" value="${t.maxAttempts}" min="1" max="10" style="width:64px;margin:0"></label>
          <label class="chk">вариантов ответа: <input type="number" id="eOptions" value="${t.optionsCount || 4}" min="2" max="8" style="width:56px;margin:0"></label>
        </div>
        <details style="margin:8px 0" open>
          <summary class="muted-sm" style="cursor:pointer">Вопросы (JSON) — редактировать аккуратно, правильные варианты — номером 1–N</summary>
          <textarea id="eJson" rows="14" style="width:100%;margin-top:6px;border:1.5px solid var(--line);border-radius:10px;padding:9px 12px;font-family:monospace;font-size:12.5px">${esc(JSON.stringify(questions, null, 2))}</textarea>
        </details>
        <div class="toolbar">
          <button class="btn btn-primary btn-sm" id="eSave">💾 Сохранить изменения</button>
          <button class="btn btn-ghost btn-sm" id="eCancel">← Назад</button>
          <span class="muted-sm" id="eSaveMsg"></span>
        </div>
        <div class="form-err" id="eErr"></div>
      </div>`;
    $("#eCancel").onclick = () => openTest(id);
    $("#eSave").onclick = async () => {
      let qs;
      try { qs = JSON.parse($("#eJson").value); }
      catch (e) { return $("#eErr").textContent = "JSON сломан: " + e.message; }
      $("#eSaveMsg").textContent = "Сохраняем… ⏳";
      $("#eErr").textContent = "";
      try {
        const r = await api(`/api/admin/tests/${encodeURIComponent(id)}`, {
          method: "PUT", headers: H(),
          body: JSON.stringify({
            title: $("#eTitle").value.trim() || "Тест",
            questions: qs,
            feedback: $("#eFeedback").checked,
            showScore: $("#eShowScore").checked,
            noCopy: $("#eNoCopy").checked,
            maxAttempts: Math.max(1, Math.min(10, +$("#eMaxAttempts").value || 1)),
            optionsCount: Math.max(2, Math.min(8, +$("#eOptions").value || 4)),
          }),
        });
        if (!r.ok) throw new Error(r.error || "Не получилось");
        toast("Тест обновлён", "ok");
        await loadTests();
        openTest(id);
      } catch (e2) { $("#eSaveMsg").textContent = ""; $("#eErr").textContent = e2.message; }
    };
  }
  function renderTestsListActive() {
    $$("#tstList [data-tid]").forEach((el) => el.classList.toggle("active", !!curTest && el.dataset.tid === curTest.id));
  }

  async function openTestSend(t) {
    if (!students.length) { try { await loadStudents(); } catch (e) {} }
    const sel = $("#tstSendStudent");
    $("#tstSendTitle").textContent = t.title;
    $("#tstSendErr").textContent = "";
    sel.style.display = "";
    $("#tstSendNoStudents").style.display = "none";
    $("#tstSendGo").disabled = false;
    const guest = `<option value="__guest__">🕊 Пустой ученик (введёт ФИО сам)</option>`;
    sel.innerHTML = guest + students.map((s) => `<option value="${esc(s.phone)}">${esc(s.name || "Без имени")} · ${esc(s.phone)}${s.chat_id ? " ✈️" : ""}</option>`).join("");
    const syncTg = () => {
      const s = students.find((x) => x.phone === sel.value);
      const wrap = $("#tstSendTgWrap");
      const cb = $("#tstSendTg");
      const has = !!(s && s.chat_id);
      cb.disabled = !has; cb.checked = has;
      wrap.classList.toggle("disabled", !has);
    };
    sel.onchange = syncTg;
    syncTg();
    $("#tstSendModal").classList.remove("hidden");
  }

  async function sendTest() {
    const t = curTest;
    if (!t) return;
    const rawValue = $("#tstSendStudent").value;
    const guest = rawValue === "__guest__";
    const phone = guest ? "" : rawValue;
    const sendCab = $("#tstSendCab").checked;
    const sendTg = $("#tstSendTg").checked && !$("#tstSendTg").disabled;
    if (!sendCab && !sendTg) return $("#tstSendErr").textContent = "Выберите, куда отправить";
    const btn = $("#tstSendGo"); btn.disabled = true; btn.textContent = "Отправляем… ⏳";
    try {
      const r = await api("/api/admin/tests/assign", { method: "POST", headers: H(), body: JSON.stringify({ testId: t.id, phone, guest, sendCab, sendTg: guest ? false : sendTg }) });
      if (!r.ok) throw new Error(r.error || "Не получилось");
      const where = guest ? "по ссылке" : [sendCab ? "кабинет" : "", sendTg && r.tg === "sent" ? "Telegram" : ""].filter(Boolean).join(" + ") || "кабинет";
      toast(`Тест отправлен (${where}). Ссылка: /test.html?t=${r.assignment.id}`, "ok");
      $("#tstSendModal").classList.add("hidden");
      loadTests();
      if (curTest && curTest.id === t.id) loadTestResults(curTest, true);
    } catch (e) { $("#tstSendErr").textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = "Отправить"; }
  }

  async function loadTestResults(t, silent) {
    const box = $("#tAssignList");
    if (!box) return;
    try {
      const r = await api(`/api/admin/tests/results?testId=${encodeURIComponent(t.id)}`, { headers: H() });
      if (!r.ok) throw new Error(r.error || "Ошибка");
      if (!r.assignments.length) {
        box.innerHTML = `<div class="muted-sm">Пока никому не отправлен. Нажмите «📤 Отправить ученику».</div>`;
        return;
      }
      const ST = { assigned: ["p-new", "не начат"], started: ["p-confirmed", "начат"], finished: ["p-done", "пройден"], cancelled: ["p-cancelled", "отменён"] };
      const answerPreview = (list) => list.map((d) => `
        <div class="q-preview">
          <b>${d.i + 1}. ${esc(d.text)}</b>
          <span class="muted-sm tst-answer">ответ ученика: <b>${esc(d.given)}</b> ${d.ok ? "✅" : "❌"}</span>
        </div>`).join("");
      const attemptPreview = (title, detail) => `<section class="tst-attempt"><h5>${esc(title)}</h5>${answerPreview(detail)}</section>`;
      box.innerHTML = `<h4 style="margin:0 0 8px">Отправки и результаты</h4>` + r.assignments.map((a) => `
        <div class="tst-result">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
            <div><b>${esc(a.name || (a.guest ? "Пустой ученик (введёт ФИО сам)" : "Ученик"))}</b>
              ${a.guest ? `<span class="muted-sm">🕊 по ссылке</span>` : `<a href="tel:${esc(a.phone)}" class="muted-sm">${esc(a.phone)}</a>`}
              <span class="pill ${ST[a.status] ? ST[a.status][0] : "p-new"}">${ST[a.status] ? ST[a.status][1] : a.status}</span>
              ${a.status === "finished" ? `<b>${a.score}/${a.total}</b>` : `отвечено ${a.answered}/${a.total}`}
              ${a.visible ? "" : `<span class="muted-sm">(в кабинете скрыт)</span>`}
            </div>
            <div>${a.status !== "finished" ? `<button class="mini-btn danger" data-tcancel="${esc(a.id)}" title="Отменить попытку и скрыть">✕</button>` : ""}
              ${a.status === "finished" || a.answered ? `<button class="mini-btn" data-tdet="${esc(a.id)}">Ответы</button>` : ""}</div>
          </div>
          <div style="margin-top:6px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <a class="muted-sm" href="${esc(a.link)}" target="_blank" rel="noopener">🔗 ${esc(a.link)}</a>
            <button class="mini-btn" data-tcopy="${esc(a.id)}" title="Скопировать ссылку">📋 Копировать</button>
          </div>
          <div class="tst-det hidden" id="det-${esc(a.id)}"></div>
        </div>`).join("");
      $$("#tAssignList [data-tcopy]").forEach((b) => b.onclick = () => {
        const a = r.assignments.find((x) => x.id === b.dataset.tcopy);
        if (!a) return;
        const done = () => toast("Ссылка скопирована", "ok");
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(a.link).then(done, () => { done(); });
        else done();
      });
      $$("#tAssignList [data-tdet]").forEach((b) => b.onclick = () => {
        const det = $("#det-" + b.dataset.tdet);
        if (!det.classList.contains("hidden")) { det.classList.add("hidden"); return; }
        const a = r.assignments.find((x) => x.id === b.dataset.tdet);
        det.classList.remove("hidden");
        const attemptNo = Math.max(1, (+a.attempts || 0) + (a.status === "finished" ? 0 : 1));
        const currentTitle = `Попытка ${attemptNo}${a.status !== "finished" ? " · в процессе" : ""}${a.status === "finished" && a.finishedAt ? " · " + fmtTs(a.finishedAt) : ""}${a.score != null ? ` · ${a.score}/${a.total}` : ""}`;
        const current = a.detail && a.detail.length ? attemptPreview(currentTitle, a.detail) : "";
        const history = (a.history || []).slice().reverse().map((h) =>
          attemptPreview(`Попытка ${h.n} · ${fmtTs(h.finishedAt)} · ${h.score}/${h.total}`, h.detail || [])).join("");
        det.innerHTML = `<div class="muted-sm">${esc(a.name || "Ученик")} · попыток: ${a.attempts || 0}</div>
          <div class="tst-attempts">${history}${current}</div>`;
      });
      $$("#tAssignList [data-tcancel]").forEach((b) => b.onclick = async () => {
        if (!confirm("Отменить эту попытку? Тест скроется из кабинета ученика (ссылка перестанет работать).")) return;
        try {
          await api("/api/admin/tests/cancel", { method: "POST", headers: H(), body: JSON.stringify({ id: b.dataset.tcancel }) });
          toast("Попытка отменена", "ok");
          loadTestResults(t, true);
          loadTests();
        } catch (e) { toast("Не получилось: " + e.message, "err"); }
      });
    } catch (e) { if (!silent) toast("Не получилось: " + e.message, "err"); box.innerHTML = `<div class="muted-sm">Ошибка загрузки результатов</div>`; }
  }

  // ---------- settings ----------
  async function loadSettings() {
    const d = await api("/api/admin/settings", { headers: H() });
    settingsMeta = d.meta || []; settingsDefaults = d.defaults || {};
    const s = d.settings || {};
    $("#settingsForm").innerHTML = settingsMeta.map((m) => `
      <label class="set-item${m.type === "textarea" ? " wide" : ""}">${esc(m.label)}
        ${m.type === "textarea"
          ? `<textarea data-k="${m.key}" rows="3">${esc(s[m.key] || "")}</textarea>`
          : `<input data-k="${m.key}" type="${m.type === "number" ? "number" : "text"}" value="${esc(s[m.key] || "")}">`}
        ${m.hint ? `<span class="set-hint">${esc(m.hint)}</span>` : ""}
      </label>`).join("");
    const e = d.env || {};
    $("#envState").innerHTML = [
      ["Google Таблица (APPS_SCRIPT_URL)", e.appsScript], ["Telegram-бот (BOT_TOKEN)", e.botToken],
      ["Уведомления преподавателю (ADMIN_CHAT_ID)", e.adminChatId], ["Адрес сайта для бота (PUBLIC_URL)", !!e.publicUrl],
    ].map(([n, ok]) => `<div>${ok ? "✅" : "⚠️"} ${n}${!ok ? " — не задано в Render → Environment" : ""}</div>`).join("");
  }
  async function saveSettings() {
    const patch = {};
    $$("#settingsForm [data-k]").forEach((el) => patch[el.dataset.k] = el.value);
    $("#setMsg").textContent = "Сохраняем…";
    const r = await api("/api/admin/settings", { method: "PUT", headers: H(), body: JSON.stringify(patch) });
    $("#setMsg").textContent = r.ok ? "Сохранено ✓ — сайт уже обновлён" : (r.error || "Ошибка");
  }
  async function resetSettings() {
    if (!confirm("Вернуть все настройки к значениям по умолчанию?")) return;
    const r = await api("/api/admin/settings", { method: "PUT", headers: H(), body: JSON.stringify(settingsDefaults) });
    if (r.ok) loadSettings();
  }

  // ---------- init ----------
  // Вкладка — в адресной строке (#tests, #students, …): при обновлении страницы
  // открывается та же вкладка, а назад/вперёд работают.
  const TAB_NAMES = ["schedule", "bookings", "slots", "students", "tests", "tg", "settings", "help"];
  function switchTab(name) {
    if (!TAB_NAMES.includes(name)) name = "schedule";
    $$(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === name));
    TAB_NAMES.forEach((n) => $("#tab-" + n).classList.toggle("hidden", n !== name));
    if (name === "schedule") loadSchedule();
    if (name === "students") loadStudents();
    if (name === "tests") loadTests();
    if (name === "settings") loadSettings();
    if (name === "tg") { loadTgStatus(); loadTgUsers(); clearInterval(tgTimer); tgTimer = setInterval(() => { if (!$("#tab-tg").classList.contains("hidden")) { loadTgUsers(); if (curChat) loadChat(); } }, 20000); }
  }
  function applyHashTab() {
    if (!key()) return;
    const h = location.hash.replace(/^#/, "");
    const name = TAB_NAMES.includes(h) ? h : "schedule";
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    switchTab(name);
  }
  function onTabClick(e) {
    const name = e.currentTarget.dataset.tab;
    if (location.hash !== "#" + name) location.hash = name;
    else switchTab(name);
  }
  function init() {
    $$(".tab").forEach((t) => t.onclick = onTabClick);
    window.addEventListener("hashchange", applyHashTab);
    $("#loginBtn").onclick = login;
    $("#adminPass").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
    $("#logoutBtn").onclick = () => { sessionStorage.removeItem("adminKey"); showApp(false); };

    $("#schFrom").value = isoToday(0);
    $("#schTo").value = isoToday(13); // 14 дней, включая сегодня; границы периода включительны.
    $("#schLoad").onclick = loadSchedule;
    $("#schStatus").onchange = () => { if (schLoadState === "ready") renderSchedule(); if (!$("#calModal").classList.contains("hidden")) renderSchCalendarModal(); };
    $("#schCal").onclick = openSchCalendar;
    $("#calClose").onclick = closeSchCalendar;
    $("#calDone").onclick = closeSchCalendar;
    $("#calModal").onclick = (e) => { if (e.target === $("#calModal")) closeSchCalendar(); };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSchCalendar(); });
    $("#schCsv").onclick = () => downloadCsv("schedule.csv",
      ["date", "time", "duration", "status", "student", "email", "phone", "subject"], schedule);
    $("#cleanupBtn").onclick = cleanup;
    $("#clrFrom").value = isoToday(0); $("#clrTo").value = oneMonthForward();
    $("#clrClose").onclick = () => clearRange("close");
    $("#clrDelete").onclick = () => clearRange("delete");

    $("#reloadBookings").onclick = reloadBookings;
    $("#fStatus").onchange = renderBookings;
    $("#fSearch").oninput = renderBookings;
    $("#exportCsv").onclick = () => downloadCsv("bookings.csv",
      ["id", "createdAt", "date", "time", "subject", "name", "email", "phone", "grade", "comment", "status", "source"], bookings);

    $("#slotDate").value = isoToday(0);
    $("#addSlot").onclick = addSlot;
    $("#genFrom").value = isoToday(0);
    $("#genTo").value = oneMonthForward();
    $("#genBtn").onclick = generate;

    $("#stSearch").oninput = renderStudents;
    $("#stReload").onclick = loadStudents;

    $("#topicsSave").onclick = saveTopicsPick;
    $("#topicsCancel").onclick = () => $("#topicsModal").classList.add("hidden");
    $("#topicsNone").onclick = () => $$("#topicsModalBody input[type=checkbox]").forEach((c) => c.checked = false);

    $("#tstReload").onclick = reloadTests;
    $("#tstNew").onclick = openTestEditor;
    $("#tstSendCancel").onclick = () => $("#tstSendModal").classList.add("hidden");
    $("#tstSendGo").onclick = sendTest;

    $("#tgReload").onclick = () => { loadTgStatus(); loadTgUsers(); if (curChat) loadChat(); };
    $("#tgSend").onclick = tgSendMsg;
    $("#tgText").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) tgSendMsg(); });
    $("#tgBroadcastBtn").onclick = openBroadcast;
    $("#bcCancel").onclick = () => $("#bcModal").classList.add("hidden");
    $("#bcText").oninput = bcCheck; $("#bcConfirm").oninput = bcCheck;
    $("#bcSend").onclick = bcSend;

    $("#setSave").onclick = saveSettings;
    $("#setReset").onclick = resetSettings;

    if (key()) login();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
