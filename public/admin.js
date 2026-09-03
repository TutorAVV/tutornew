/* Админ-панель v2: расписание (все слоты incl. занятые), заявки, генерация, чистка */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const key = () => sessionStorage.getItem("adminKey") || "";
  const H = () => ({ "Content-Type": "application/json", "x-admin-key": key() });
  let bookings = [], schedule = [];

  const ST_RU = { new: "Новая", confirmed: "Подтверждена", done: "Завершена", cancelled: "Отменена" };
  const SL_RU = { open: "свободен", booked: "занят", closed: "закрыт" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function showApp(show) {
    $("#loginView").classList.toggle("hidden", show);
    $("#appView").classList.toggle("hidden", !show);
  }
  function isoToday(off) {
    const d = new Date(); d.setDate(d.getDate() + (off || 0));
    return d.toISOString().slice(0, 10);
  }
  async function api(url, opts) {
    const r = await fetch(url, opts);
    if (r.status === 401) { showApp(false); throw new Error("unauthorized"); }
    return r.json();
  }

  async function login() {
    sessionStorage.setItem("adminKey", $("#adminPass").value);
    $("#loginErr").textContent = "";
    try {
      await loadSchedule();
      const data = await api("/api/bookings", { headers: H() });
      bookings = data.bookings || [];
      renderBookings();
      showApp(true);
      loadStorageInfo();
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
        ? "Сейчас данные в памяти сервера (демо). Подключите Google Таблицу по README — заявки и слоты будут там."
        : "Подключено: Google Таблица через Apps Script. Старая таблица поддерживается как есть.";
      if (cfg.sheetUrl) { const a = $("#sheetLink"); a.href = cfg.sheetUrl; a.style.display = ""; }
    } catch (e) {}
  }

  // ---------- schedule ----------
  async function loadSchedule() {
    const tb = $("#schTable tbody");
    tb.innerHTML = `<tr><td colspan="6" class="muted">Загрузка…</td></tr>`;
    try {
      const data = await api(`/api/schedule?from=${$("#schFrom").value}&to=${$("#schTo").value}`, { headers: H() });
      schedule = data.slots || [];
      renderSchedule();
    } catch (e) { if (e.message !== "unauthorized") tb.innerHTML = `<tr><td colspan="6" class="muted">Ошибка загрузки</td></tr>`; }
  }

  function renderSchedule() {
    const f = $("#schStatus").value;
    const rows = schedule.filter((s) => !f || s.status === f);
    const tb = $("#schTable tbody");
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="6" class="muted">Слотов нет — добавьте во вкладке «Слоты»</td></tr>`; return; }
    tb.innerHTML = rows.map((s) => {
      const who = s.student
        ? `<b>${esc(s.student)}</b>${s.phone ? `<br><a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : ""}${s.email ? `<br><span class="muted-sm">${esc(s.email)}</span>` : ""}${s.subject ? `<br><span class="muted-sm">${esc(s.subject)}</span>` : ""}`
        : `<span class="muted">—</span>`;
      const acts = s.status === "booked"
        ? `<button class="mini-btn" data-free="${s.iso}|${s.time}">Освободить</button>`
        : (s.status === "open"
          ? `<button class="mini-btn" data-close="${s.iso}|${s.time}">Закрыть</button>`
          : `<button class="mini-btn" data-open="${s.iso}|${s.time}">Открыть</button>`);
      return `<tr>
        <td><b>${esc(s.date)}</b></td><td>${esc(s.time)}</td><td>${esc(s.duration)}</td>
        <td><span class="pill p-${s.status === "open" ? "free" : s.status === "booked" ? "busy" : "cancelled"}">${SL_RU[s.status] || s.status}</span></td>
        <td>${who}</td>
        <td><div class="rowbtns">${acts}<button class="mini-btn danger" data-del="${s.iso}|${s.time}">✕</button></div></td>
      </tr>`;
    }).join("");
    $$("#schTable [data-free]").forEach((b) => b.onclick = () => freeBooked(b.dataset.free));
    $$("#schTable [data-close]").forEach((b) => b.onclick = () => setSlotState(b.dataset.close, "closed"));
    $$("#schTable [data-open]").forEach((b) => b.onclick = () => setSlotState(b.dataset.open, "open"));
    $$("#schTable [data-del]").forEach((b) => b.onclick = () => delSlot(b.dataset.del));
  }

  function splitDT(v) { const [date, time] = v.split("|"); return { date, time }; }

  async function setSlotState(v, status) {
    const { date, time } = splitDT(v);
    await api("/api/admin/slots", { method: "PATCH", headers: H(), body: JSON.stringify({ date, time, status }) });
    loadSchedule();
  }
  async function delSlot(v) {
    if (!confirm("Удалить слот?")) return;
    const { date, time } = splitDT(v);
    await api("/api/admin/slots", { method: "DELETE", headers: H(), body: JSON.stringify({ date, time }) });
    loadSchedule();
  }
  async function freeBooked(v) {
    // освободить занятый слот = найти заявку и отменить
    if (!confirm("Освободить слот? Запись ученика будет отменена.")) return;
    const { date, time } = splitDT(v);
    await api("/api/admin/slots", { method: "PATCH", headers: H(), body: JSON.stringify({ date, time, status: "open" }) });
    // чистим ученика из слота через удаление+создание? нет — статус open + заявка:
    const bk = bookings.find((b) => (b.iso || b.date) === date && b.time === time && b.status !== "cancelled" && b.status !== "done");
    if (bk) await api(`/api/bookings/${encodeURIComponent(bk.id)}`, { method: "PATCH", headers: H(), body: JSON.stringify({ status: "cancelled" }) });
    await reloadBookings();
    loadSchedule();
  }

  async function cleanup() {
    if (!confirm("Удалить все прошедшие свободные/закрытые слоты? Занятые (история) останутся.")) return;
    const data = await api("/api/admin/cleanup-past", { method: "POST", headers: H() });
    alert(`Удалено: ${data.deleted}, занятых оставлено: ${data.keptBooked || 0}`);
    loadSchedule();
  }

  async function clearRange(mode) {
    const from = $("#clrFrom").value, to = $("#clrTo").value;
    if (!from || !to) return alert("Выберите диапазон");
    if (!confirm(mode === "delete" ? `УДАЛИТЬ все слоты ${from} — ${to}?` : `Закрыть все слоты ${from} — ${to}?`)) return;
    const data = await api("/api/admin/clear-range", { method: "POST", headers: H(), body: JSON.stringify({ from, to, mode }) });
    alert(`Готово: ${data.affected}`);
    loadSchedule();
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
      <td><div class="rowbtns">
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
    if (status === "cancelled" && !confirm("Отменить запись? Слот снова станет свободным.")) return;
    await api(`/api/bookings/${encodeURIComponent(id)}`, { method: "PATCH", headers: H(), body: JSON.stringify({ status }) });
    await reloadBookings();
    loadSchedule();
  }

  // ---------- slots add/generate ----------
  async function addSlot() {
    const date = $("#slotDate").value || isoToday(0);
    const time = $("#newTime").value;
    const duration = +($("#newDur").value || 50);
    if (!time) return alert("Укажите время");
    const data = await api("/api/admin/slots", { method: "POST", headers: H(), body: JSON.stringify({ date, time, duration }) });
    if (!data.ok) return alert(data.error || "Не получилось");
    loadSchedule();
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
    if (!body.from || !body.to) return alert("Выберите диапазон дат");
    const data = await api("/api/admin/generate", { method: "POST", headers: H(), body: JSON.stringify(body) });
    if (!data.ok) return alert(data.error || "Не получилось");
    alert(`Готово: добавлено слотов — ${data.added}`);
    loadSchedule();
  }

  // ---------- init ----------
  function init() {
    $$(".tab").forEach((t) => t.onclick = () => {
      $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
      ["schedule", "bookings", "slots", "help"].forEach((n) => $("#tab-" + n).classList.toggle("hidden", n !== t.dataset.tab));
    });
    $("#loginBtn").onclick = login;
    $("#adminPass").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
    $("#logoutBtn").onclick = () => { sessionStorage.removeItem("adminKey"); showApp(false); };

    $("#schFrom").value = isoToday(0);
    $("#schTo").value = isoToday(60);
    $("#schLoad").onclick = loadSchedule;
    $("#schStatus").onchange = renderSchedule;
    $("#schCsv").onclick = () => downloadCsv("schedule.csv",
      ["date", "time", "duration", "status", "student", "email", "phone", "subject"], schedule);
    $("#cleanupBtn").onclick = cleanup;
    $("#clrFrom").value = isoToday(0); $("#clrTo").value = isoToday(7);
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
    $("#genTo").value = isoToday(7);
    $("#genBtn").onclick = generate;

    if (key()) login();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
