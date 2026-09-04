/* Админ-панель v3: расписание, заявки, слоты, ученики, Telegram, настройки */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const key = () => sessionStorage.getItem("adminKey") || "";
  const H = () => ({ "Content-Type": "application/json", "x-admin-key": key() });
  let bookings = [], schedule = [], students = [], tgUsers = [], curStudent = null, curChat = null, settingsMeta = [], settingsDefaults = {};
  let tgTimer = null;

  const ST_RU = { new: "Новая", confirmed: "Подтверждена", done: "Завершена", cancelled: "Отменена" };
  const SL_RU = { open: "свободен", booked: "занят", closed: "закрыт" };
  const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

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
        ? "Сейчас данные в файле на сервере (демо). Подключите Google Таблицу по README — заявки, слоты, настройки и переписка будут там."
        : "Подключено: Google Таблица через Apps Script. Старая таблица поддерживается как есть.";
      if (cfg.sheetUrl) { const a = $("#sheetLink"); a.href = cfg.sheetUrl; a.style.display = ""; }
    } catch (e) {}
  }

  // ---------- schedule (сгруппировано по дням) ----------
  async function loadSchedule() {
    const box = $("#schDays");
    box.innerHTML = `<div class="muted">Загрузка…</div>`;
    try {
      const data = await api(`/api/schedule?from=${$("#schFrom").value}&to=${$("#schTo").value}`, { headers: H() });
      schedule = data.slots || [];
      renderSchedule();
    } catch (e) { if (e.message !== "unauthorized") box.innerHTML = `<div class="muted">Ошибка загрузки</div>`; }
  }

  function renderSchedule() {
    const f = $("#schStatus").value;
    const rows = schedule.filter((s) => !f || s.status === f);
    const box = $("#schDays");
    if (!rows.length) { box.innerHTML = `<div class="muted">Слотов нет — добавьте во вкладке «Слоты»</div>`; return; }
    const days = {};
    for (const s of rows) (days[s.iso] = days[s.iso] || []).push(s);
    box.innerHTML = Object.keys(days).sort().map((iso) => {
      const list = days[iso];
      const busy = list.filter((s) => s.status === "booked").length, free = list.filter((s) => s.status === "open").length;
      return `<div class="day-card">
        <div class="day-head"><b>${esc(dayTitle(iso))}</b>
          <span class="muted-sm">${free ? `свободно ${free}` : ""}${free && busy ? " · " : ""}${busy ? `занято ${busy}` : ""}</span></div>
        <table class="tbl tbl-day">
          <thead><tr><th style="width:70px">Время</th><th style="width:60px">Длит.</th><th style="width:100px">Статус</th><th>Ученик</th><th style="width:130px">Действие</th></tr></thead>
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
              <td><span class="pill p-${s.status === "open" ? "free" : s.status === "booked" ? "busy" : "cancelled"}">${SL_RU[s.status] || s.status}</span></td>
              <td>${who}</td>
              <td><div class="rowbtns">${acts}<button class="mini-btn danger" data-del="${s.iso}|${s.time}" title="Удалить слот">✕</button></div></td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>`;
    }).join("");
    $$("#schDays [data-free]").forEach((b) => b.onclick = () => freeBooked(b.dataset.free));
    $$("#schDays [data-close]").forEach((b) => b.onclick = () => setSlotState(b.dataset.close, "closed"));
    $$("#schDays [data-open]").forEach((b) => b.onclick = () => setSlotState(b.dataset.open, "open"));
    $$("#schDays [data-del]").forEach((b) => b.onclick = () => delSlot(b.dataset.del));
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
    if (!confirm("Освободить слот? Запись ученика будет отменена (ему уйдёт уведомление, если привязан Telegram).")) return;
    const { date, time } = splitDT(v);
    const bk = bookings.find((b) => (b.iso || b.date) === date && b.time === time && b.status !== "cancelled" && b.status !== "done");
    if (bk) await api(`/api/bookings/${encodeURIComponent(bk.id)}`, { method: "PATCH", headers: H(), body: JSON.stringify({ status: "cancelled" }) });
    await api("/api/admin/slots", { method: "PATCH", headers: H(), body: JSON.stringify({ date, time, status: "open" }) });
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
    const btn = $("#genBtn"); btn.disabled = true; btn.textContent = "Генерируем… ⏳";
    try {
      const data = await api("/api/admin/generate", { method: "POST", headers: H(), body: JSON.stringify(body) });
      if (!data.ok) return alert(data.error || "Не получилось");
      alert(`Готово: добавлено слотов — ${data.added}`);
      loadSchedule();
    } finally { btn.disabled = false; btn.textContent = "⚡ Сгенерировать"; }
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
          <label>Имя<input id="sName" value="${esc(s.name || "")}"></label>
          <label>Класс<input id="sGrade" value="${esc(s.grade || "")}"></label>
        </div>
        <div class="row2">
          <label>Предмет<input id="sSubject" value="${esc(s.subject || "")}"></label>
          <label>Chat ID Telegram<input id="sChat" value="${esc(s.chat_id || "")}" placeholder="заполняется сам после /start + номер"></label>
        </div>
        <label>Пройденные темы (видит ученик)<textarea id="sTopics" rows="3">${esc(s.topics || "")}</textarea></label>
        <label>Заметки для себя (ученик не видит)<textarea id="sNotes" rows="2">${esc(s.notes || "")}</textarea></label>
        <div class="toolbar"><button class="btn btn-primary btn-sm" id="sSave">💾 Сохранить карточку</button><span class="muted-sm" id="sMsg"></span></div>
      </div>
      <h4 style="margin:18px 0 8px">📨 Отправить в кабинет (и в Telegram, если привязан)</h4>
      <div class="form">
        <div class="row2">
          <label>Тип<select id="nType"><option value="homework">📝 Домашнее задание</option><option value="info">ℹ️ Сообщение</option><option value="link">🔗 Ссылка (урок, материалы)</option></select></label>
          <label>Ссылка (необязательно)<input id="nLink" placeholder="https://…"></label>
        </div>
        <label>Текст<textarea id="nText" rows="3" placeholder="Например: №245–250 из учебника, повторить формулы сокращённого умножения"></textarea></label>
        <div class="toolbar"><button class="btn btn-primary btn-sm" id="nSend">Отправить</button><span class="muted-sm" id="nMsg"></span></div>
      </div>
      <div id="nList" class="muted-sm">Загрузка сообщений…</div>`;
    $("#sSave").onclick = async () => {
      const body = { phone: s.phone, name: $("#sName").value, grade: $("#sGrade").value, subject: $("#sSubject").value, chat_id: $("#sChat").value, topics: $("#sTopics").value, notes: $("#sNotes").value };
      const r = await api("/api/admin/students", { method: "PUT", headers: H(), body: JSON.stringify(body) });
      $("#sMsg").textContent = r.ok ? "Сохранено ✓" : (r.error || "Ошибка");
      Object.assign(s, body); renderStudents();
    };
    $("#nSend").onclick = async () => {
      const body = { phone: s.phone, type: $("#nType").value, link: $("#nLink").value, text: $("#nText").value };
      if (!body.text.trim() && !body.link.trim()) return alert("Введите текст");
      const r = await api("/api/admin/students/notes", { method: "POST", headers: H(), body: JSON.stringify(body) });
      $("#nMsg").textContent = r.ok ? (r.tg === "sent" ? "Отправлено в кабинет и Telegram ✓" : r.tg === "no-chat" ? "Сохранено в кабинет (Telegram не привязан)" : "Сохранено в кабинет, Telegram не доставлено") : (r.error || "Ошибка");
      if (r.ok) { $("#nText").value = ""; $("#nLink").value = ""; loadNotes(s.phone); }
    };
    loadNotes(s.phone);
  }
  async function loadNotes(phone) {
    const r = await api(`/api/admin/students/notes?phone=${encodeURIComponent(phone)}`, { headers: H() });
    const list = r.notes || [];
    const box = $("#nList"); if (!box) return;
    if (!list.length) { box.innerHTML = `<div class="muted-sm">Сообщений ученику ещё не было.</div>`; return; }
    const ICON = { homework: "📝", info: "ℹ️", link: "🔗" };
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
        <div>${esc(m.text)}</div>
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
  function init() {
    $$(".tab").forEach((t) => t.onclick = () => {
      $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
      ["schedule", "bookings", "slots", "students", "tg", "settings", "help"].forEach((n) => $("#tab-" + n).classList.toggle("hidden", n !== t.dataset.tab));
      if (t.dataset.tab === "students") loadStudents();
      if (t.dataset.tab === "settings") loadSettings();
      if (t.dataset.tab === "tg") { loadTgStatus(); loadTgUsers(); clearInterval(tgTimer); tgTimer = setInterval(() => { if (!$("#tab-tg").classList.contains("hidden")) { loadTgUsers(); if (curChat) loadChat(); } }, 20000); }
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

    $("#stSearch").oninput = renderStudents;
    $("#stReload").onclick = loadStudents;

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
