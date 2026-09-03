/**
 * Tutor booking v2 — сервер для Render.com (free plan).
 * Схема как в старой таблице: статусы open/booked/closed, длительность, email.
 * Хранение: Google Apps Script + Таблица (прод) или data/db.json (демо).
 */
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const ADMIN_KEY = process.env.ADMIN_KEY || "admin123";
const API_SECRET = process.env.API_SECRET || "";
const APPS_SCRIPT_URL = (process.env.APPS_SCRIPT_URL || "").trim();
const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const ADMIN_CHAT_ID = (process.env.ADMIN_CHAT_ID || "").trim();
const SHEET_URL = (process.env.SHEET_URL || "").trim();
const TUTOR_NAME = process.env.TUTOR_NAME || "Онлайн-уроки";
const TUTOR_TG = (process.env.TUTOR_TG || "aviation09").replace(/^@/, "");
const TZ_LABEL = process.env.TZ_LABEL || "МСК+2";
const LESSON_DURATION = +(process.env.LESSON_DURATION || 50);
const SUBJECTS = (process.env.TUTOR_SUBJECTS || "Математика,Физика")
  .split(",").map((s) => s.trim()).filter(Boolean);

app.use(cors());
app.use(express.json({ limit: "256kb" }));

// ---------- helpers ----------
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function isDateStr(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isTimeStr(s) { return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
function digits(p) { return String(p || "").replace(/\D/g, ""); }
function samePhone(a, b) {
  a = digits(a); b = digits(b);
  return a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10);
}
function esc(s, n) { return String(s == null ? "" : s).slice(0, n || 200); }
function normStatus(s) {
  s = String(s || "").toLowerCase();
  if (s === "free") return "open";
  if (s === "busy") return "booked";
  return ["open", "booked", "closed"].includes(s) ? s : "open";
}

function seedDb() {
  const db = { slots: {}, bookings: [] };
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const js = d.getDay();
    const times = (js === 0 || js === 6)
      ? ["10:00", "11:00", "12:00", "13:00"]
      : ["16:00", "17:00", "18:00", "19:00", "20:00"];
    db.slots[key] = times.map((t) => ({
      time: t, duration: LESSON_DURATION, status: "open",
      student: "", email: "", phone: "", subject: "", chatId: "", reminded: "",
    }));
  }
  return db;
}
function loadDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) {
      const db = seedDb();
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
      return db;
    }
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    if (!db.slots) db.slots = {};
    if (!db.bookings) db.bookings = [];
    return db;
  } catch (e) {
    console.error("DB load error:", e.message);
    return seedDb();
  }
}
function saveDb(db) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) { console.error("DB save error:", e.message); }
}

async function appsScript(action, payload = {}, method = "GET") {
  if (!APPS_SCRIPT_URL) throw new Error("APPS_SCRIPT_URL not set");
  const body = { action, secret: API_SECRET, ...payload };
  if (method === "GET") {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(body))
      qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v == null ? "" : v));
    const res = await fetch(`${APPS_SCRIPT_URL}?${qs.toString()}`);
    return res.json();
  }
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function notifyTelegram(text) {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text }),
    });
  } catch (e) { console.error("TG notify error:", e.message); }
}

// ---------- public API ----------
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get("/api/config", (req, res) => {
  res.json({
    ok: true, tutorName: TUTOR_NAME, subjects: SUBJECTS,
    storage: APPS_SCRIPT_URL ? "sheets" : "demo",
    sheetUrl: SHEET_URL, tutorTg: TUTOR_TG,
    tzLabel: TZ_LABEL, lessonDuration: LESSON_DURATION,
  });
});

app.get("/api/slots", async (req, res) => {
  const date = req.query.date;
  const subject = req.query.subject || "";
  if (!isDateStr(date)) return res.status(400).json({ ok: false, error: "bad date" });
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("getSlots", { date, subject }));
    const db = loadDb();
    let slots = (db.slots[date] || []).map((s) => ({
      time: s.time, duration: s.duration || LESSON_DURATION,
      status: normStatus(s.status), subject: s.subject || "",
    }));
    if (subject) slots = slots.filter((s) => !s.subject || s.subject === subject);
    slots.sort((a, b) => a.time.localeCompare(b.time));
    res.json({ ok: true, date, slots });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "slots failed" }); }
});

app.post("/api/book", async (req, res) => {
  const b = req.body || {};
  const date = esc(b.date, 10), time = esc(b.time, 5);
  const subject = esc(b.subject, 60);
  const name = esc(b.name, 120), email = esc(b.email, 120), phone = esc(b.phone, 40);
  const grade = esc(b.grade, 20), comment = esc(b.comment, 300), contact = esc(b.contact, 60);
  const chatId = esc(b.chatId, 40);
  const source = esc(b.source || "site", 20);

  if (!isDateStr(date)) return res.status(400).json({ ok: false, error: "Выберите дату" });
  if (!isTimeStr(time)) return res.status(400).json({ ok: false, error: "Выберите время" });
  if (!subject) return res.status(400).json({ ok: false, error: "Выберите предмет" });
  if (name.trim().length < 2) return res.status(400).json({ ok: false, error: "Укажите фамилию и имя" });
  if (digits(phone).length < 10) return res.status(400).json({ ok: false, error: "Проверьте номер телефона" });

  try {
    if (APPS_SCRIPT_URL) {
      const data = await appsScript("book",
        { date, time, subject, name, email, phone, grade, comment, contact, chatId, source }, "POST");
      return res.status(data && data.ok ? 200 : 409).json(data);
    }
    const db = loadDb();
    const slots = db.slots[date] || [];
    const slot = slots.find((s) => s.time === time);
    if (!slot) return res.status(409).json({ ok: false, error: "Этот слот уже недоступен, выберите другое время" });
    if (slot.status === "booked") return res.status(409).json({ ok: false, error: "Это время уже занято, выберите другое" });
    if (slot.status === "closed") return res.status(409).json({ ok: false, error: "Запись на это время закрыта, выберите другое" });
    Object.assign(slot, { status: "booked", student: name, email, phone, subject, chatId, reminded: "" });
    const id = "B" + Date.now().toString(36).toUpperCase();
    db.bookings.unshift({
      id, createdAt: new Date().toISOString(), date, time, subject,
      duration: slot.duration || LESSON_DURATION,
      name, email, phone, grade, comment, contact, chatId, source, status: "new",
    });
    saveDb(db);
    notifyTelegram(`🆕 Новая заявка\n📚 ${subject}\n📅 ${date} в ${time}\n👤 ${name}\n📞 ${phone}${email ? `\n✉️ ${email}` : ""}\nИсточник: ${source}`);
    res.json({ ok: true, bookingId: id });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "Не получилось записать, попробуйте ещё раз" }); }
});

// Мои записи по телефону (перезапись учеником)
app.get("/api/my", async (req, res) => {
  const phone = req.query.phone || "";
  if (digits(phone).length < 10) return res.status(400).json({ ok: false, error: "Укажите телефон" });
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("myBookings", { phone }));
    const db = loadDb();
    const today = new Date().toISOString().slice(0, 10);
    const list = db.bookings
      .filter((x) => samePhone(x.phone, phone) && x.status !== "cancelled" && x.status !== "done" && x.date >= today)
      .map((x) => ({ id: x.id, date: x.date, iso: x.date, time: x.time, subject: x.subject, status: x.status }));
    res.json({ ok: true, bookings: list });
  } catch (e) { res.status(500).json({ ok: false, error: "lookup failed" }); }
});

app.post("/api/cancel", async (req, res) => {
  const { id, phone } = req.body || {};
  if (!id || digits(phone).length < 10) return res.status(400).json({ ok: false, error: "bad payload" });
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("cancelBooking", { id, phone }, "POST"));
    const db = loadDb();
    const bk = db.bookings.find((x) => x.id === id && samePhone(x.phone, phone));
    if (!bk) return res.status(404).json({ ok: false, error: "Запись не найдена" });
    bk.status = "cancelled";
    const s = (db.slots[bk.date] || []).find((x) => x.time === bk.time);
    if (s) Object.assign(s, { status: "open", student: "", email: "", phone: "", chatId: "", reminded: "" });
    saveDb(db);
    notifyTelegram(`🚫 Ученик отменил запись\n📅 ${bk.date} в ${bk.time}\n👤 ${bk.name} 📞 ${bk.phone}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: "cancel failed" }); }
});

// ---------- admin ----------
function needAdmin(req, res, next) {
  if ((req.headers["x-admin-key"] || "") !== ADMIN_KEY)
    return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
}

app.get("/api/bookings", needAdmin, async (req, res) => {
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("getBookings", { from: req.query.from || "", to: req.query.to || "", status: req.query.status || "" }));
    const db = loadDb();
    res.json({ ok: true, bookings: db.bookings, storage: "demo" });
  } catch (e) { res.status(500).json({ ok: false, error: "bookings failed" }); }
});

app.patch("/api/bookings/:id", needAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!["new", "confirmed", "done", "cancelled"].includes(status))
    return res.status(400).json({ ok: false, error: "bad status" });
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("setBookingStatus", { id: req.params.id, status }, "POST"));
    const db = loadDb();
    const bk = db.bookings.find((x) => x.id === req.params.id);
    if (!bk) return res.status(404).json({ ok: false, error: "not found" });
    bk.status = status;
    if (status === "cancelled") {
      const s = (db.slots[bk.date] || []).find((x) => x.time === bk.time);
      if (s) Object.assign(s, { status: "open", student: "", email: "", phone: "", chatId: "", reminded: "" });
    }
    saveDb(db);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: "update failed" }); }
});

// Расписание (все слоты диапазона, включая занятые)
app.get("/api/schedule", needAdmin, async (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  let to = req.query.to || "";
  if (!to) { const d = new Date(); d.setDate(d.getDate() + 60); to = d.toISOString().slice(0, 10); }
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("getSchedule", { from, to }));
    const db = loadDb();
    const out = [];
    for (const [date, arr] of Object.entries(db.slots)) {
      if (date < from || date > to) continue;
      for (const s of arr) {
        const [dd, mm, yyyy] = [date.slice(8), date.slice(5, 7), date.slice(0, 4)];
        out.push({
          date: `${dd}.${mm}.${yyyy}`, iso: date, time: s.time,
          duration: s.duration || LESSON_DURATION, status: normStatus(s.status),
          student: s.student || "", email: s.email || "", phone: s.phone || "",
          subject: s.subject || "",
        });
      }
    }
    out.sort((a, b) => (a.iso + a.time < b.iso + b.time ? -1 : 1));
    res.json({ ok: true, slots: out });
  } catch (e) { res.status(500).json({ ok: false, error: "schedule failed" }); }
});

app.get("/api/admin/slots", needAdmin, async (req, res) => {
  const date = req.query.date;
  if (!isDateStr(date)) return res.status(400).json({ ok: false, error: "bad date" });
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("getSlots", { date }));
    const db = loadDb();
    res.json({ ok: true, date, slots: db.slots[date] || [] });
  } catch (e) { res.status(500).json({ ok: false, error: "slots failed" }); }
});

app.post("/api/admin/slots", needAdmin, async (req, res) => {
  const { date, time, duration, subject } = req.body || {};
  if (!isDateStr(date) || !isTimeStr(time)) return res.status(400).json({ ok: false, error: "bad payload" });
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("setSlot", { date, time, duration: +(duration || LESSON_DURATION), subject: subject || "" }, "POST"));
    const db = loadDb();
    if (!db.slots[date]) db.slots[date] = [];
    if (db.slots[date].some((s) => s.time === time)) return res.status(409).json({ ok: false, error: "Слот уже существует" });
    db.slots[date].push({
      time, duration: +(duration || LESSON_DURATION), status: "open",
      student: "", email: "", phone: "", subject: subject || "", chatId: "", reminded: "",
    });
    db.slots[date].sort((a, b) => a.time.localeCompare(b.time));
    saveDb(db);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: "add failed" }); }
});

app.patch("/api/admin/slots", needAdmin, async (req, res) => {
  const { date, time, status } = req.body || {};
  if (!isDateStr(date) || !isTimeStr(time) || !["open", "closed"].includes(status))
    return res.status(400).json({ ok: false, error: "bad payload" });
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("setSlotStatus", { date, time, status }, "POST"));
    const db = loadDb();
    const s = (db.slots[date] || []).find((x) => x.time === time);
    if (!s) return res.status(404).json({ ok: false, error: "not found" });
    s.status = status;
    if (s.status === "open" && (s.student || s.phone)) {
      // освобождение занятого слота — стираем данные ученика
      Object.assign(s, { student: "", email: "", phone: "", chatId: "", reminded: "" });
    }
    saveDb(db);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: "update failed" }); }
});

app.delete("/api/admin/slots", needAdmin, async (req, res) => {
  const { date, time } = req.body || {};
  if (!isDateStr(date) || !isTimeStr(time)) return res.status(400).json({ ok: false, error: "bad payload" });
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("deleteSlot", { date, time }, "POST"));
    const db = loadDb();
    db.slots[date] = (db.slots[date] || []).filter((s) => s.time !== time);
    saveDb(db);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: "delete failed" }); }
});

app.post("/api/admin/generate", needAdmin, async (req, res) => {
  const b = req.body || {};
  // поддерживаем и новый формат (окна будни/выходные), и старый (times)
  const payload = {
    from: b.from, to: b.to,
    times: b.times || "", wdFrom: b.wdFrom || "", wdTo: b.wdTo || "",
    weFrom: b.weFrom || "", weTo: b.weTo || "", step: +(b.step || 60),
    duration: +(b.duration || LESSON_DURATION),
    keepExisting: b.keepExisting !== false,
  };
  if (!isDateStr(payload.from) || !isDateStr(payload.to))
    return res.status(400).json({ ok: false, error: "bad payload" });
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("generateSlots", payload, "POST"));
    const db = loadDb();
    let times = Array.isArray(b.times) ? b.times.filter(isTimeStr)
      : String(b.times || "").split(",").map((s) => s.trim()).filter(isTimeStr);
    const win = (f, t) => {
      if (!isTimeStr(f) || !isTimeStr(t)) return [];
      const out = [];
      let cur = (+f.slice(0, 2)) * 60 + (+f.slice(3));
      const end = (+t.slice(0, 2)) * 60 + (+t.slice(3));
      const step = Math.max(15, payload.step);
      while (cur <= end) {
        out.push(String(Math.floor(cur / 60)).padStart(2, "0") + ":" + String(cur % 60).padStart(2, "0"));
        cur += step;
      }
      return out;
    };
    let added = 0;
    const d0 = new Date(payload.from + "T00:00:00"), d1 = new Date(payload.to + "T00:00:00");
    for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const isWe = d.getDay() === 0 || d.getDay() === 6;
      const dayTimes = times.length ? times : win(isWe ? b.weFrom : b.wdFrom, isWe ? b.weTo : b.wdTo);
      if (!dayTimes.length) continue;
      if (!db.slots[key]) db.slots[key] = [];
      for (const t of dayTimes) {
        if (payload.keepExisting && db.slots[key].some((s) => s.time === t)) continue;
        db.slots[key].push({
          time: t, duration: payload.duration, status: "open",
          student: "", email: "", phone: "", subject: "", chatId: "", reminded: "",
        });
        added++;
      }
      db.slots[key].sort((a, b) => a.time.localeCompare(b.time));
    }
    saveDb(db);
    res.json({ ok: true, added });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "generate failed" }); }
});

app.post("/api/admin/clear-range", needAdmin, async (req, res) => {
  const { from, to, mode } = req.body || {};
  if (!isDateStr(from) || !isDateStr(to) || !["close", "delete"].includes(mode))
    return res.status(400).json({ ok: false, error: "bad payload" });
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("clearRange", { from, to, mode }, "POST"));
    const db = loadDb();
    let n = 0;
    for (const [date, arr] of Object.entries(db.slots)) {
      if (date < from || date > to) continue;
      if (mode === "delete") { n += arr.length; delete db.slots[date]; }
      else { for (const s of arr) { if (s.status === "open") { s.status = "closed"; n++; } } }
    }
    saveDb(db);
    res.json({ ok: true, affected: n });
  } catch (e) { res.status(500).json({ ok: false, error: "clear failed" }); }
});

app.post("/api/admin/cleanup-past", needAdmin, async (req, res) => {
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("cleanupPast", {}, "POST"));
    const db = loadDb();
    const today = new Date().toISOString().slice(0, 10);
    let del = 0, kept = 0;
    for (const date of Object.keys(db.slots)) {
      if (date >= today) continue;
      const arr = db.slots[date];
      const keepBooked = arr.filter((s) => s.status === "booked");
      kept += keepBooked.length;
      del += arr.length - keepBooked.length;
      if (keepBooked.length) db.slots[date] = keepBooked;
      else delete db.slots[date];
    }
    saveDb(db);
    res.json({ ok: true, deleted: del, keptBooked: kept });
  } catch (e) { res.status(500).json({ ok: false, error: "cleanup failed" }); }
});

// ---------- static ----------
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.listen(PORT, HOST, () => {
  console.log(`Tutor booking v2 on ${HOST}:${PORT}`);
  console.log(`Storage: ${APPS_SCRIPT_URL ? "Google Sheets" : "demo (data/db.json)"}`);
});
