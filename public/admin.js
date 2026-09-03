/* Админ-панель: заявки, слоты, генерация */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const key = () => sessionStorage.getItem("adminKey") || "";
  const H = () => ({ "Content-Type": "application/json", "x-admin-key": key() });
  let bookings = [];

  const STATUS_RU = { new: "Новая", confirmed: "Подтверждена", done: "Завершена", cancelled: "Отменена" };

  function showApp(show) {
    $("#loginView").classList.toggle("hidden", show);
    $("#appView").classList.toggle("hidden", !show);
  }

  async function login() {
    const pass = $("#adminPass").value;
    sessionStorage.setItem("adminKey", pass);
    $("#loginErr").textContent = "";
    try {
      const r = await fetch("/api/bookings", { headers: H() });
      if (r.status === 401) throw new Error("Неверный пароль");
      const data = await r.json();
      bookings = data.bookings || [];
      renderBookings();
      showApp(true);
      loadStorageInfo();
    } catch (e) {
      $("#loginErr").textContent = e.message || "Ошибка входа";
    }
  }

  async function loadStorageInfo() {
    try {
      const r = await fetch("/api/config");
      const cfg = await r.json();
      const demo = cfg.storage !== "sheets";
      $("#storageBadge").innerHTML = demo
        ? `<span class="pill p-new">демо-режим (без таблицы)</span>`
        : `<span class="pill p-free">● Google Таблица</span>`;
      $("#storageText").textContent = demo
        ? "Сейчас заявки хранятся в памяти сервера (демо). Подключите Google Таблицу по инструкции ниже — и заявки будут падать туда."
        : "Подключено: Google Таблица через Apps Script. Все заявки и слоты — там.";
      if (cfg.sheetUrl) { const a = $("#sheetLink"); a.href = cfg.sheetUrl; a.style.display = ""; }
    } catch (e) {}
  }

  // ---------- bookings ----------
  function renderBookings() {
    const st = $("#fStatus").value;
    const q = $("#fSearch").value.trim().toLowerCase();
    const rows = bookings.filter((b) =>
      (!st || b.status === st) &&
      (!q || [b.name, b.phone, b.subject, b.date, b.time, b.comment].join(" ").toLowerCase().includes(q)));
    const tb = $("#bookTable tbody");
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="5" class="muted">Заявок нет</td></tr>`; return; }
    tb.innerHTML = rows.map((b) => `<tr>
      <td><b>${b.date || ""}</b> ${b.time || ""}<br><span class="muted-sm">${b.format === "offline" ? "📍 очно" : "💻 онлайн"} · ${b.source || "site"}</span></td>
      <td><b>${escapeHtml(b.name)}</b><br><a href="tel:${escapeHtml(b.phone)}">${escapeHtml(b.phone)}</a>${b.grade ? `<br><span class="muted-sm">${escapeHtml(b.grade)}</span>` : ""}${b.comment ? `<br><span class="muted-sm">💬 ${escapeHtml(b.comment)}</span>` : ""}</td>
      <td>${escapeHtml(b.subject)}</td>
      <td><span class="pill p-${b.status || "new"}">${STATUS_RU[b.status] || b.status}</span></td>
      <td><div class="rowbtns">
        ${b.status === "new" ? `<button class="mini-btn" data-act="confirmed" data-id="${b.id}">✓ Подтвердить</button>` : ""}
        ${(b.status === "new" || b.status === "confirmed") ? `<button class="mini-btn" data-act="done" data-id="${b.id}">✔ Завершить</button>` : ""}
        ${(b.status === "new" || b.status === "confirmed") ? `<button class="mini-btn danger" data-act="cancelled" data-id="${b.id}">✕ Отменить</button>` : ""}
      </div></td></tr>`).join("");
    $$("#bookTable [data-act]").forEach((btn) => btn.onclick = () => setStatus(btn.dataset.id, btn.dataset.act));
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  async function reloadBookings() {
    const r = await fetch("/api/bookings", { headers: H() });
    if (r.status === 401) { showApp(false); return; }
    const data = await r.json();
    bookings = data.bookings || [];
    renderBookings();
  }

  async function setStatus(id, status) {
    if (status === "cancelled" && !confirm("Отменить запись? Слот снова станет свободным.")) return;
    await fetch(`/api/bookings/${encodeURIComponent(id)}`, { method: "PATCH", headers: H(), body: JSON.stringify({ status }) });
    reloadBookings();
  }

  function exportCsv() {
    const head = ["id", "createdAt", "date", "time", "subject", "format", "name", "phone", "grade", "comment", "status", "source"];
    const lines = [head.join(";")].concat(bookings.map((b) =>
      head.map((h) => `"${String(b[h] == null ? "" : b[h]).replace(/"/g, '""')}"`).join(";")));
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bookings.csv";
    a.click();
  }

  // ---------- slots ----------
  function todayInput() { return new Date().toISOString().slice(0, 10); }

  async function loadDay() {
    const date = $("#slotDate").value || todayInput();
    const box = $("#daySlots");
    box.innerHTML = `<div class="spin">Загрузка…</div>`;
    const r = await fetch(`/api/admin/slots?date=${date}`, { headers: H() });
    if (r.status === 401) { showApp(false); return; }
    const data = await r.json();
    const slots = (data.slots || []).slice().sort((a, b) => a.time.localeCompare(b.time));
    box.innerHTML = slots.length ? slots.map((s) => `
      <div class="slot ${s.status === "busy" ? "selected" : ""}" style="cursor:default">
        <b>${s.time}</b><small>${s.status === "busy" ? "занято" + (s.student ? " · " + escapeHtml(s.student) : "") : (s.format === "offline" ? "📍 очно · свободно" : "💻 онлайн · свободно")}</small>
        <div class="rowbtns" style="justify-content:center;margin-top:8px">
          <button class="mini-btn danger" data-del="${s.time}">Удалить</button>
        </div>
      </div>`).join("") : `<div class="slots-empty">На этот день слотов нет — добавьте выше или сгенерируйте на период.</div>`;
    $$("#daySlots [data-del]").forEach((b) => b.onclick = async () => {
      if (!confirm(`Удалить слот ${b.dataset.del}?`)) return;
      await fetch("/api/admin/slots", { method: "DELETE", headers: H(), body: JSON.stringify({ date, time: b.dataset.del }) });
      loadDay();
    });
  }

  async function addSlot() {
    const date = $("#slotDate").value || todayInput();
    const time = $("#newTime").value;
    const format = $("#newFormat").value;
    if (!time) return alert("Укажите время");
    const r = await fetch("/api/admin/slots", { method: "POST", headers: H(), body: JSON.stringify({ date, time, format }) });
    const data = await r.json();
    if (!data.ok) return alert(data.error || "Не получилось");
    loadDay();
  }

  async function generate() {
    const from = $("#genFrom").value, to = $("#genTo").value;
    const times = $("#genTimes").value.split(",").map((s) => s.trim()).filter(Boolean);
    const format = $("#genFormat").value;
    if (!from || !to || !times.length) return alert("Заполните период и время");
    const r = await fetch("/api/admin/generate", { method: "POST", headers: H(), body: JSON.stringify({ from, to, times, format }) });
    const data = await r.json();
    if (!data.ok) return alert(data.error || "Не получилось");
    alert(`Готово: добавлено слотов — ${data.added}`);
    loadDay();
  }

  // ---------- init ----------
  function init() {
    $$(".tab").forEach((t) => t.onclick = () => {
      $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
      ["bookings", "slots", "help"].forEach((n) => $("#tab-" + n).classList.toggle("hidden", n !== t.dataset.tab));
    });
    $("#loginBtn").onclick = login;
    $("#adminPass").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
    $("#logoutBtn").onclick = () => { sessionStorage.removeItem("adminKey"); showApp(false); };
    $("#reloadBookings").onclick = reloadBookings;
    $("#fStatus").onchange = renderBookings;
    $("#fSearch").oninput = renderBookings;
    $("#exportCsv").onclick = exportCsv;
    $("#slotDate").value = todayInput();
    $("#loadDay").onclick = loadDay;
    $("#addSlot").onclick = addSlot;
    $("#genBtn").onclick = generate;
    const gf = $("#genFrom"), gt = $("#genTo");
    gf.value = todayInput();
    const d = new Date(); d.setDate(d.getDate() + 7);
    gt.value = d.toISOString().slice(0, 10);
    if (key()) login();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
