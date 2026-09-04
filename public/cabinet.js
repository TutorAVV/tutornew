/* Личный кабинет ученика (тестовый режим: вход по телефону без пароля) */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  let cfg = {};

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function fmtTs(ts) { const d = new Date(ts); return isNaN(d) ? String(ts || "") : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); }
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
    const err = $("#cErr"); err.textContent = "";
    if (phone.replace(/\D/g, "").length < 10) { err.textContent = "Введите номер телефона"; return; }
    $("#cEnter").disabled = true;
    try {
      const r = await fetch(`/api/cabinet?phone=${encodeURIComponent(phone)}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Не удалось войти");
      localStorage.setItem("myPhone", phone);
      render(d, phone);
    } catch (e) { err.textContent = e.message; }
    finally { $("#cEnter").disabled = false; }
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
      [st.lastDone ? st.lastDone.split("-").reverse().join(".") : "—", "последний урок"],
    ].map(([v, l]) => `<div class="stat-box"><b>${esc(v)}</b><span>${l}</span></div>`).join("");

    const ICON = { homework: "📝", info: "ℹ️", link: "🔗" };
    $("#cNotes").innerHTML = d.notes.length ? d.notes.map((n) => `
      <div class="note-card">
        <div class="muted-sm">${fmtTs(n.ts)} · ${n.type === "homework" ? "Домашнее задание" : n.type === "link" ? "Ссылка" : "Сообщение"}</div>
        <div>${ICON[n.type] || ""} ${linkify(n.text)}${n.link ? `<br><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.link)}</a>` : ""}</div>
      </div>`).join("") : `<div class="muted">Пока ничего нет — здесь появятся домашние задания и ссылки от преподавателя.</div>`;

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
    try {
      cfg = await (await fetch("/api/config")).json();
      if (cfg.tutorName) { $("#logoName").textContent = cfg.tutorName; $("#footName").textContent = cfg.tutorName; document.title = `Кабинет ученика — ${cfg.tutorName}`; }
      if (cfg.cabinetEnabled === false) { $("#loginBox").innerHTML = `<h2>Кабинет временно отключён</h2><p><a href="/">На главную</a></p>`; return; }
    } catch (e) {}
    $("#cEnter").onclick = () => enter($("#cPhone").value.trim());
    $("#cPhone").addEventListener("keydown", (e) => { if (e.key === "Enter") enter($("#cPhone").value.trim()); });
    $("#logoutBtn").onclick = () => { localStorage.removeItem("myPhone"); location.reload(); };
    const qs = new URLSearchParams(location.search);
    const p = qs.get("phone") || localStorage.getItem("myPhone");
    if (p) { $("#cPhone").value = p; enter(p); }
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
