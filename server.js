/**
 * Tutor booking — сервер для Render.com (free plan).
 * - отдаёт статику из /public
 * - API для записи на занятия
 * - хранение: Google Apps Script + Google Таблица (прод) или локальный data/db.json (демо)
 * - уведомления о заявках в Telegram (если заданы BOT_TOKEN + ADMIN_CHAT_ID)
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
const TUTOR_NAME = process.env.TUTOR_NAME || "Репетитор";
const SUBJECTS = (process.env.TUTOR_SUBJECTS ||
  "Математика,Физика,Русский язык,Обществознание,Информатика,Английский язык")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors());
app.use(express.json({ limit: "256kb" }));

// ---------- helpers ----------
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function isDateStr(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function isTimeStr(s) {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
function cleanPhone(p) {
  return String(p || "").replace(/[^\d+]/g, "");
}
function validPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  return d.length >= 10 && d.length <= 15;
}
function esc(s) {
  return String(s == null ? "" : s).slice(0, 500);
}

function defaultSlotsForWeekday(jsDay) {
  // пн–пт: вечер, сб–вс: день
  if (jsDay === 0 || jsDay === 6) return ["10:00", "11:30", "13:00", "14:30"];
  return ["15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];
}

function seedDb() {
  const db = { slots: {}, bookings: [] };
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    db.slots[key] = defaultSlotsForWeekday(d.getDay()).map((t) => ({
      time: t,
      format: "online",
      status: "free",
      subject: "",
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
    console.error("DB load error, using seed:", e.message);
    return seedDb();
  }
}
function saveDb(db) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error("DB save error:", e.message);
  }
}

async function appsScript(action, payload = {}, method = "GET") {
  if (!APPS_SCRIPT_URL) throw new Error("APPS_SCRIPT_URL not set");
  const body = { action, secret: API_SECRET, ...payload };
  if (method === "GET") {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
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
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("Telegram notify error:", e.message);
  }
}

// ---------- public API ----------
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    tutorName: TUTOR_NAME,
    subjects: SUBJECTS,
    storage: APPS_SCRIPT_URL ? "sheets" : "demo",
    sheetUrl: SHEET_URL,
    telegramWebApp: true,
  });
});

app.get("/api/slots", async (req, res) => {
  const date = req.query.date;
  const format = req.query.format || "";
  if (!isDateStr(date)) return res.status(400).json({ ok: false, error: "bad date" });
  try {
    if (APPS_SCRIPT_URL) {
      const data = await appsScript("getSlots", { date, format });
      return res.json(data);
    }
    const db = loadDb();
    let slots = db.slots[date] || [];
    if (format) slots = slots.filter((s) => s.format === format);
    res.json({ ok: true, date, slots });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "slots failed" });
  }
});

app.post("/api/book", async (req, res) => {
  const b = req.body || {};
  const date = esc(b.date), time = esc(b.time);
  const subject = esc(b.subject), format = ["online", "offline"].includes(b.format) ? b.format : "online";
  const name = esc(b.name), phone = cleanPhone(b.phone);
  const grade = esc(b.grade), comment = esc(b.comment), contact = esc(b.contact || "");
  const source = esc(b.source || "site").slice(0, 20);

  if (!isDateStr(date)) return res.status(400).json({ ok: false, error: "Выберите дату" });
  if (!isTimeStr(time)) return res.status(400).json({ ok: false, error: "Выберите время" });
  if (!subject) return res.status(400).json({ ok: false, error: "Выберите предмет" });
  if (name.trim().length < 2) return res.status(400).json({ ok: false, error: "Укажите имя" });
  if (!validPhone(phone)) return res.status(400).json({ ok: false, error: "Проверьте номер телефона" });

  try {
    if (APPS_SCRIPT_URL) {
      const data = await appsScript("book", { date, time, subject, format, name, phone, grade, comment, contact, source }, "POST");
      if (data && data.ok) notifyTelegram(`🆕 <b>Новая заявка</b>\n📚 ${subject}\n📅 ${date} в ${time} (${format === "online" ? "онлайн" : "очно"})\n👤 ${name}\n📞 ${phone}${grade ? `\n🎓 Класс: ${grade}` : ""}${comment ? `\n💬 ${comment}` : ""}\nИсточник: ${source}`);
      return res.status(data && data.ok ? 200 : 409).json(data);
    }
    const db = loadDb();
    const slots = db.slots[date] || [];
    const slot = slots.find((s) => s.time === time && (!b.format || s.format === format || true));
    const target = slots.find((s) => s.time === time);
    if (!target) return res.status(409).json({ ok: false, error: "Этот слот уже недоступен, выберите другое время" });
    if (target.status === "busy") return res.status(409).json({ ok: false, error: "Это время уже занято, выберите другое" });
    target.status = "busy";
    target.subject = subject;
    target.student = name;
    const id = "B" + Date.now().toString(36).toUpperCase();
    db.bookings.unshift({ id, createdAt: new Date().toISOString(), date, time, subject, format: target.format || format, name, phone, grade, comment, contact, source, status: "new" });
    saveDb(db);
    notifyTelegram(`🆕 <b>Новая заявка</b>\n📚 ${subject}\n📅 ${date} в ${time}\n👤 ${name}\n📞 ${phone}\nИсточник: ${source}`);
    res.json({ ok: true, bookingId: id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Не получилось записать, попробуйте ещё раз" });
  }
});

// ---------- admin API ----------
function needAdmin(req, res, next) {
  if ((req.headers["x-admin-key"] || "") !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

app.get("/api/bookings", needAdmin, async (req, res) => {
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("getBookings", {}));
    const db = loadDb();
    res.json({ ok: true, bookings: db.bookings, storage: "demo" });
  } catch (e) {
    res.status(500).json({ ok: false, error: "bookings failed" });
  }
});

app.patch("/api/bookings/:id", needAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!["new", "confirmed", "done", "cancelled"].includes(status)) {
    return res.status(400).json({ ok: false, error: "bad status" });
  }
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("setBookingStatus", { id: req.params.id, status }, "POST"));
    const db = loadDb();
    const bk = db.bookings.find((x) => x.id === req.params.id);
    if (!bk) return res.status(404).json({ ok: false, error: "not found" });
    bk.status = status;
    if (status === "cancelled") {
      const slots = db.slots[bk.date] || [];
      const s = slots.find((x) => x.time === bk.time);
      if (s) { s.status = "free"; delete s.student; }
    }
    saveDb(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: "update failed" });
  }
});

app.get("/api/admin/slots", needAdmin, async (req, res) => {
  const date = req.query.date;
  if (!isDateStr(date)) return res.status(400).json({ ok: false, error: "bad date" });
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("getSlots", { date }));
    const db = loadDb();
    res.json({ ok: true, date, slots: db.slots[date] || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: "slots failed" });
  }
});

app.post("/api/admin/slots", needAdmin, async (req, res) => {
  const { date, time, format = "online", subject = "" } = req.body || {};
  if (!isDateStr(date) || !isTimeStr(time)) return res.status(400).json({ ok: false, error: "bad payload" });
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("setSlot", { date, time, format, subject }, "POST"));
    const db = loadDb();
    if (!db.slots[date]) db.slots[date] = [];
    if (db.slots[date].some((s) => s.time === time)) return res.status(409).json({ ok: false, error: "Слот уже существует" });
    db.slots[date].push({ time, format, status: "free", subject });
    db.slots[date].sort((a, b) => a.time.localeCompare(b.time));
    saveDb(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: "add failed" });
  }
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
  } catch (e) {
    res.status(500).json({ ok: false, error: "delete failed" });
  }
});

app.post("/api/admin/generate", needAdmin, async (req, res) => {
  const { from, to, times, format = "online", weekdays } = req.body || {};
  if (!isDateStr(from) || !isDateStr(to) || !Array.isArray(times) || !times.length) {
    return res.status(400).json({ ok: false, error: "bad payload" });
  }
  try {
    if (APPS_SCRIPT_URL) return res.json(await appsScript("generateSlots", { from, to, times, format, weekdays }, "POST"));
    const db = loadDb();
    const d0 = new Date(from + "T00:00:00"), d1 = new Date(to + "T00:00:00");
    let added = 0;
    for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
      if (Array.isArray(weekdays) && weekdays.length && !weekdays.includes(d.getDay())) continue;
      const key = d.toISOString().slice(0, 10);
      if (!db.slots[key]) db.slots[key] = [];
      for (const t of times) {
        if (!isTimeStr(t)) continue;
        if (!db.slots[key].some((s) => s.time === t)) {
          db.slots[key].push({ time: t, format, status: "free", subject: "" });
          added++;
        }
      }
      db.slots[key].sort((a, b) => a.time.localeCompare(b.time));
    }
    saveDb(db);
    res.json({ ok: true, added });
  } catch (e) {
    res.status(500).json({ ok: false, error: "generate failed" });
  }
});

// ---------- static ----------
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.listen(PORT, HOST, () => {
  console.log(`Tutor booking listening on ${HOST}:${PORT}`);
  console.log(`Storage: ${APPS_SCRIPT_URL ? "Google Sheets" : "demo (data/db.json)"}`);
});
