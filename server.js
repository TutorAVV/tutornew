/**
 * Tutor booking v3 — сервер для Render.com (free plan).
 *
 * Что умеет:
 *  - запись на слоты (сайт / Telegram WebApp), «Мои записи» по телефону
 *  - ПЕРЕНОС занятия учеником (не позже чем за N часов, N — настройка), отмена — только у преподавателя
 *  - настройки сайта, которые преподаватель меняет в админке (хранятся в таблице, лист Settings)
 *  - Telegram-бот: вебхук, пользователи бота, переписка, рассылка (лист Users / Messages)
 *  - ученики и личный кабинет (лист Students / Notes)
 *
 * Хранение: Google Apps Script + Таблица (прод) или data/db.json (демо).
 */
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const ADMIN_KEY = process.env.ADMIN_KEY || "admin123";
const API_SECRET = process.env.API_SECRET || "";
const APPS_SCRIPT_URL = (process.env.APPS_SCRIPT_URL || "").trim();
const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const ADMIN_CHAT_ID = (process.env.ADMIN_CHAT_ID || "").trim();
const SHEET_URL = (process.env.SHEET_URL || "").trim();
const PUBLIC_URL = (process.env.PUBLIC_URL || "").trim().replace(/\/$/, "");
const TG_WEBHOOK_SECRET = (process.env.TG_WEBHOOK_SECRET || "").trim()
  || (BOT_TOKEN ? crypto.createHash("sha256").update(BOT_TOKEN).digest("hex").slice(0, 32) : "");

/** Значения по умолчанию (из env). Всё это преподаватель может переопределить в админке → Настройки. */
const DEFAULTS = {
  tutorName: process.env.TUTOR_NAME || "Онлайн-уроки",
  siteTitle: process.env.SITE_TITLE || "Онлайн‑уроки | Запись на занятия по математике и физике",
  heroTitle: "Онлайн-уроки по математике и физике",
  heroLead: "Математика и физика — без пробелов.\nПомогаю подтянуть оценки, разобраться в сложных темах и полюбить предметы.\nИндивидуальные занятия для 4–9 классов, урок — 50 минут.",
  subjects: process.env.TUTOR_SUBJECTS || "Математика,Физика",
  grades: "4 класс,5 класс,6 класс,7 класс,8 класс,9 класс (ОГЭ)",
  tutorTg: (process.env.TUTOR_TG || "aviation09").replace(/^@/, ""),
  tzLabel: process.env.TZ_LABEL || "МСК+2",
  tzOffsetMin: process.env.TZ_OFFSET_MIN || "300",
  lessonDuration: process.env.LESSON_DURATION || "50",
  rescheduleHours: process.env.RESCHEDULE_HOURS || "12",
  reminderMinutes: process.env.REMINDER_MINUTES || "60",
  contactsText: "Вопросы — в Telegram, отвечаю в течение дня",
  bookingNote: "Телефон и e-mail — для связи и подтверждения.",
  cabinetEnabled: "1",
};
/** Описание настроек для админки (порядок = порядок на странице) */
const SETTINGS_META = [
  { key: "tutorName", label: "Название (шапка, подвал, уведомления)", type: "text" },
  { key: "siteTitle", label: "Заголовок вкладки браузера", type: "text" },
  { key: "heroTitle", label: "Заголовок на главной", type: "text" },
  { key: "heroLead", label: "Текст под заголовком (каждая строка — с новой строки)", type: "textarea" },
  { key: "subjects", label: "Предметы (через запятую)", type: "text" },
  { key: "grades", label: "Классы в форме записи (через запятую)", type: "text" },
  { key: "lessonDuration", label: "Длительность урока по умолчанию, мин", type: "number" },
  { key: "rescheduleHours", label: "Перенос возможен не позже чем за N часов до занятия", type: "number" },
  { key: "reminderMinutes", label: "Напоминание в Telegram за N минут до занятия", type: "number" },
  { key: "tzLabel", label: "Подпись часового пояса (например МСК+2)", type: "text" },
  { key: "tzOffsetMin", label: "Смещение часового пояса от UTC, минут (МСК+2 = 300)", type: "number" },
  { key: "tutorTg", label: "Telegram преподавателя для связи (без @)", type: "text" },
  { key: "contactsText", label: "Текст в разделе «Контакты»", type: "text" },
  { key: "bookingNote", label: "Подсказка под формой записи", type: "text" },
  { key: "cabinetEnabled", label: "Личный кабинет ученика включён (1/0)", type: "number" },
];

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
function toIso(d) { // "ДД.ММ.ГГГГ" | ISO → ISO
  const s = String(d || "");
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}
function toDsp(iso) { return isDateStr(iso) ? `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : String(iso || ""); }
function newId(prefix) { return (prefix || "X") + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(); }

/** Начало занятия в UTC мс (дата/время указаны в часовом поясе преподавателя) */
function startUtc(dateIso, time, tzOffsetMin) {
  if (!isDateStr(dateIso) || !isTimeStr(time)) return NaN;
  return Date.UTC(+dateIso.slice(0, 4), +dateIso.slice(5, 7) - 1, +dateIso.slice(8, 10), +time.slice(0, 2), +time.slice(3)) - tzOffsetMin * 60000;
}
function hoursUntil(dateIso, time, tz) { return (startUtc(dateIso, time, tz) - Date.now()) / 3600000; }
function tutorTodayIso(tz) { return new Date(Date.now() + tz * 60000).toISOString().slice(0, 10); }

// ---------- demo db ----------
function seedDb() {
  const db = { slots: {}, bookings: [], tables: {} };
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const js = d.getDay();
    const times = (js === 0 || js === 6)
      ? ["10:00", "11:00", "12:00", "13:00"]
      : ["16:00", "17:00", "18:00", "19:00", "20:00"];
    db.slots[key] = times.map((t) => ({
      time: t, duration: +DEFAULTS.lessonDuration, status: "open",
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
    if (!db.tables) db.tables = {};
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

// ---------- Apps Script ----------
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

/**
 * Универсальные таблицы: Settings, Users, Messages, Students, Notes.
 * В проде — листы Google Таблицы (создаются сами), в демо — db.tables.
 */
const tbl = {
  async list(name) {
    if (APPS_SCRIPT_URL) { const r = await appsScript("tblList", { table: name }, "POST"); return r.rows || []; }
    const db = loadDb(); return db.tables[name] || [];
  },
  async append(name, rows) {
    rows = Array.isArray(rows) ? rows : [rows];
    if (APPS_SCRIPT_URL) return appsScript("tblAppend", { table: name, rows }, "POST");
    const db = loadDb(); db.tables[name] = (db.tables[name] || []).concat(rows); saveDb(db); return { ok: true };
  },
  async update(name, field, value, patch) {
    if (APPS_SCRIPT_URL) return appsScript("tblUpdate", { table: name, field, value, patch }, "POST");
    const db = loadDb(); let n = 0;
    for (const r of db.tables[name] || []) if (String(r[field]) === String(value)) { Object.assign(r, patch); n++; }
    saveDb(db); return { ok: true, updated: n };
  },
  async remove(name, field, value) {
    if (APPS_SCRIPT_URL) return appsScript("tblRemove", { table: name, field, value }, "POST");
    const db = loadDb(); const before = (db.tables[name] || []).length;
    db.tables[name] = (db.tables[name] || []).filter((r) => String(r[field]) !== String(value));
    saveDb(db); return { ok: true, removed: before - db.tables[name].length };
  },
};

// ---------- settings (кэш 60 сек) ----------
let settingsCache = { at: 0, data: null };
async function getSettings(force) {
  if (!force && settingsCache.data && Date.now() - settingsCache.at < 60000) return settingsCache.data;
  const out = { ...DEFAULTS };
  try {
    const rows = await tbl.list("Settings");
    for (const r of rows) if (r.key && r.key in DEFAULTS && String(r.value) !== "") out[r.key] = String(r.value);
  } catch (e) { console.error("settings load:", e.message); }
  settingsCache = { at: Date.now(), data: out };
  return out;
}
async function saveSettings(patch) {
  const rows = await tbl.list("Settings");
  const have = new Set(rows.map((r) => String(r.key)));
  const toAdd = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS)) continue;
    const val = String(v == null ? "" : v).slice(0, 2000);
    if (have.has(k)) await tbl.update("Settings", "key", k, { value: val });
    else toAdd.push({ key: k, value: val });
  }
  if (toAdd.length) await tbl.append("Settings", toAdd);
  settingsCache = { at: 0, data: null };
  return getSettings(true);
}
function cfgNum(s, k, def) { const n = +s[k]; return Number.isFinite(n) ? n : def; }
function cfgList(s, k) { return String(s[k] || "").split(",").map((x) => x.trim()).filter(Boolean); }
async function publicConfig() {
  const s = await getSettings();
  return {
    ok: true,
    tutorName: s.tutorName, siteTitle: s.siteTitle, heroTitle: s.heroTitle, heroLead: s.heroLead,
    subjects: cfgList(s, "subjects"), grades: cfgList(s, "grades"),
    storage: APPS_SCRIPT_URL ? "sheets" : "demo",
    sheetUrl: SHEET_URL, tutorTg: s.tutorTg,
    tzLabel: s.tzLabel, tzOffsetMin: cfgNum(s, "tzOffsetMin", 300),
    lessonDuration: cfgNum(s, "lessonDuration", 50),
    rescheduleHours: cfgNum(s, "rescheduleHours", 12),
    reminderMinutes: cfgNum(s, "reminderMinutes", 60),
    contactsText: s.contactsText, bookingNote: s.bookingNote,
    cabinetEnabled: s.cabinetEnabled !== "0",
    botEnabled: !!BOT_TOKEN,
  };
}

// ---------- telegram ----------
async function tgApi(method, body) {
  if (!BOT_TOKEN) return { ok: false, description: "BOT_TOKEN не задан" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
    });
    return r.json();
  } catch (e) { return { ok: false, description: e.message }; }
}
async function tgSend(chatId, text, extra) {
  if (!chatId) return { ok: false, description: "нет chat id" };
  return tgApi("sendMessage", { chat_id: String(chatId), text, ...(extra || {}) });
}
async function notifyAdmin(text) { if (ADMIN_CHAT_ID) await tgSend(ADMIN_CHAT_ID, text); }

async function storeMessage(m) {
  const row = {
    id: newId("M"), ts: new Date().toISOString(), dir: m.dir, chat_id: String(m.chatId || ""),
    name: esc(m.name, 120), text: esc(m.text, 4000), status: m.status || "ok", kind: m.kind || "chat",
  };
  try { await tbl.append("Messages", row); } catch (e) { console.error("storeMessage:", e.message); }
  return row;
}
async function upsertUser(u, patch) {
  const users = await tbl.list("Users");
  const ex = users.find((x) => String(x.chat_id) === String(u.id));
  const base = {
    chat_id: String(u.id), username: u.username || "", first_name: u.first_name || "", last_name: u.last_name || "",
    last_seen: new Date().toISOString(),
  };
  if (ex) { await tbl.update("Users", "chat_id", String(u.id), { ...base, ...(patch || {}) }); return { ...ex, ...base, ...(patch || {}) }; }
  const row = { ...base, phone: "", created: new Date().toISOString(), blocked: "", ...(patch || {}) };
  await tbl.append("Users", row);
  return row;
}
function userDisplay(u) {
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return n || (u.username ? "@" + u.username : "id" + u.chat_id);
}

/** Привязать chat_id к записям ученика по телефону (для напоминаний) */
async function linkChat(phone, chatId) {
  if (APPS_SCRIPT_URL) return appsScript("linkChat", { phone, chatId }, "POST");
  const db = loadDb(); let n = 0;
  for (const arr of Object.values(db.slots)) for (const s of arr) if (samePhone(s.phone, phone) && !s.chatId) { s.chatId = chatId; n++; }
  for (const b of db.bookings) if (samePhone(b.phone, phone) && !b.chatId) { b.chatId = chatId; n++; }
  saveDb(db); return { ok: true, linked: n };
}

async function handleTgUpdate(upd) {
  const msg = upd.message || upd.edited_message;
  if (!msg || !msg.chat || msg.chat.type !== "private") return;
  const from = msg.from || { id: msg.chat.id };
  const cfg = await publicConfig();
  const base = PUBLIC_URL || "";
  const appBtn = base ? { inline_keyboard: [[{ text: "📅 Записаться на занятие", web_app: { url: `${base}/telegram.html` } }]] } : undefined;

  if (msg.contact) {
    const phone = msg.contact.phone_number || "";
    const isOwn = !msg.contact.user_id || String(msg.contact.user_id) === String(from.id);
    if (!isOwn) { await tgSend(from.id, "Пожалуйста, отправьте свой номер кнопкой ниже."); return; }
    await upsertUser(from, { phone });
    await linkChat(phone, String(from.id));
    await tgSend(from.id, "Спасибо! Номер сохранён ✅\nТеперь напоминания о занятиях и сообщения преподавателя будут приходить сюда.",
      { reply_markup: { remove_keyboard: true } });
    if (appBtn) await tgSend(from.id, "Записаться или перенести занятие можно здесь:", { reply_markup: appBtn });
    await notifyAdmin(`📱 Пользователь бота поделился номером\n👤 ${userDisplay(from)}\n📞 ${phone}`);
    return;
  }

  const text = String(msg.text || msg.caption || "").trim();
  const user = await upsertUser(from);
  if (/^\/start/.test(text)) {
    await tgSend(from.id,
      `Здравствуйте! Это бот «${cfg.tutorName}» 📐\n\nЗдесь можно записаться на занятие, перенести его и получать напоминания.\n\n` +
      `Чтобы напоминания приходили именно вам, нажмите кнопку «Поделиться номером» ниже.` +
      (user.phone ? "\n\n(Номер уже сохранён ✅)" : ""),
      { reply_markup: { keyboard: [[{ text: "📱 Поделиться номером", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
    if (appBtn) await tgSend(from.id, "Открыть запись:", { reply_markup: appBtn });
    return;
  }
  if (/^\/(help|menu)/.test(text)) {
    await tgSend(from.id, "Команды:\n/start — начать и поделиться номером\n/app — открыть запись\nЛюбое другое сообщение будет передано преподавателю.",
      appBtn ? { reply_markup: appBtn } : undefined);
    return;
  }
  if (/^\/app/.test(text)) {
    await tgSend(from.id, appBtn ? "Открыть запись:" : "Адрес сайта не настроен (PUBLIC_URL).", appBtn ? { reply_markup: appBtn } : undefined);
    return;
  }
  if (!text) return;
  // обычное сообщение → сохраняем и пересылаем преподавателю
  await storeMessage({ dir: "in", chatId: from.id, name: userDisplay(from), text });
  await notifyAdmin(`💬 Сообщение в бот от ${userDisplay(from)}${user.phone ? ` (📞 ${user.phone})` : ""}:\n\n${text}\n\nОтветить: админка → Telegram`);
  await tgSend(from.id, "Сообщение передано преподавателю 👌");
}

app.post("/api/tg/webhook", (req, res) => {
  if (!BOT_TOKEN) return res.status(404).end();
  if ((req.headers["x-telegram-bot-api-secret-token"] || "") !== TG_WEBHOOK_SECRET) return res.status(403).end();
  res.json({ ok: true }); // отвечаем сразу, обрабатываем асинхронно
  handleTgUpdate(req.body || {}).catch((e) => console.error("tg update:", e.message));
});

// ---------- public API ----------
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get("/api/config", async (req, res) => {
  try { res.json(await publicConfig()); }
  catch (e) { res.status(500).json({ ok: false, error: "config failed" }); }
});

/** Слоты дня. Прошедшие (по времени преподавателя) отдаём как status=past */
app.get("/api/slots", async (req, res) => {
  const date = req.query.date;
  const subject = req.query.subject || "";
  if (!isDateStr(date)) return res.status(400).json({ ok: false, error: "bad date" });
  try {
    const cfg = await publicConfig();
    let data;
    if (APPS_SCRIPT_URL) data = await appsScript("getSlots", { date, subject });
    else {
      const db = loadDb();
      let slots = (db.slots[date] || []).map((s) => ({
        time: s.time, duration: s.duration || cfg.lessonDuration,
        status: normStatus(s.status), subject: s.subject || "",
      }));
      if (subject) slots = slots.filter((s) => !s.subject || s.subject === subject);
      data = { ok: true, date, slots };
    }
    const slots = (data.slots || []).map((s) => {
      const past = startUtc(date, s.time, cfg.tzOffsetMin) <= Date.now();
      return { ...s, status: past && s.status !== "booked" ? "past" : s.status };
    }).sort((a, b) => a.time.localeCompare(b.time));
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
    const cfg = await publicConfig();
    if (startUtc(date, time, cfg.tzOffsetMin) <= Date.now())
      return res.status(409).json({ ok: false, error: "Это время уже прошло, выберите другое" });
    // chat_id из бота по телефону (если ученик делился номером)
    let cid = chatId;
    if (!cid) { try { const u = (await tbl.list("Users")).find((x) => x.phone && samePhone(x.phone, phone)); if (u) cid = String(u.chat_id); } catch (e) {} }

    if (APPS_SCRIPT_URL) {
      const data = await appsScript("book",
        { date, time, subject, name, email, phone, grade, comment, contact, chatId: cid, source }, "POST");
      if (data && data.ok) { touchStudent({ phone, name, grade, subject, chatId: cid }).catch(() => {}); if (cid) tgSend(cid, `✅ Вы записаны: ${subject}, ${toDsp(date)} в ${time} (${cfg.tzLabel}).`); }
      return res.status(data && data.ok ? 200 : 409).json(data);
    }
    const db = loadDb();
    const slots = db.slots[date] || [];
    const slot = slots.find((s) => s.time === time);
    if (!slot) return res.status(409).json({ ok: false, error: "Этот слот уже недоступен, выберите другое время" });
    if (slot.status === "booked") return res.status(409).json({ ok: false, error: "Это время уже занято, выберите другое" });
    if (slot.status === "closed") return res.status(409).json({ ok: false, error: "Запись на это время закрыта, выберите другое" });
    Object.assign(slot, { status: "booked", student: name, email, phone, subject, chatId: cid, reminded: "" });
    const id = "B" + Date.now().toString(36).toUpperCase();
    db.bookings.unshift({
      id, createdAt: new Date().toISOString(), date, time, subject,
      duration: slot.duration || cfg.lessonDuration,
      name, email, phone, grade, comment, contact, chatId: cid, source, status: "new",
    });
    saveDb(db);
    touchStudent({ phone, name, grade, subject, chatId: cid }).catch(() => {});
    notifyAdmin(`🆕 Новая заявка\n📚 ${subject}\n📅 ${toDsp(date)} в ${time}\n👤 ${name}\n📞 ${phone}${email ? `\n✉️ ${email}` : ""}${grade ? `\n🎓 ${grade}` : ""}\nИсточник: ${source}`);
    if (cid) tgSend(cid, `✅ Вы записаны: ${subject}, ${toDsp(date)} в ${time} (${cfg.tzLabel}).`);
    res.json({ ok: true, bookingId: id });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "Не получилось записать, попробуйте ещё раз" }); }
});

/** Активные будущие записи по телефону */
async function activeBookings(phone) {
  if (APPS_SCRIPT_URL) { const r = await appsScript("myBookings", { phone }); return (r.bookings || []).map((x) => ({ ...x, iso: x.iso || toIso(x.date) })); }
  const db = loadDb();
  const today = new Date().toISOString().slice(0, 10);
  return db.bookings
    .filter((x) => samePhone(x.phone, phone) && x.status !== "cancelled" && x.status !== "done" && x.date >= today)
    .map((x) => ({ id: x.id, date: x.date, iso: x.date, time: x.time, subject: x.subject, status: x.status }));
}
function decorateBookings(list, cfg) {
  return list.map((b) => {
    const h = hoursUntil(b.iso, b.time, cfg.tzOffsetMin);
    return { ...b, dsp: toDsp(b.iso), hoursLeft: Math.round(h * 10) / 10, canReschedule: h >= cfg.rescheduleHours };
  }).filter((b) => b.hoursLeft > -3).sort((a, b) => (a.iso + a.time < b.iso + b.time ? -1 : 1));
}

// Мои записи по телефону
app.get("/api/my", async (req, res) => {
  const phone = req.query.phone || "";
  if (digits(phone).length < 10) return res.status(400).json({ ok: false, error: "Укажите телефон" });
  try {
    const cfg = await publicConfig();
    res.json({ ok: true, bookings: decorateBookings(await activeBookings(phone), cfg), rescheduleHours: cfg.rescheduleHours });
  } catch (e) { res.status(500).json({ ok: false, error: "lookup failed" }); }
});

// Отмена учеником отключена: отменяет только преподаватель
app.post("/api/cancel", (req, res) => {
  res.status(403).json({ ok: false, error: "Отменить занятие может только преподаватель. Вы можете перенести его на другое время." });
});

/** Перенос занятия учеником */
app.post("/api/reschedule", async (req, res) => {
  const { id, phone } = req.body || {};
  const date = esc((req.body || {}).date, 10), time = esc((req.body || {}).time, 5);
  if (!id || digits(phone).length < 10) return res.status(400).json({ ok: false, error: "bad payload" });
  if (!isDateStr(date) || !isTimeStr(time)) return res.status(400).json({ ok: false, error: "Выберите новое время" });
  try {
    const cfg = await publicConfig();
    const list = await activeBookings(phone);
    const bk = list.find((x) => String(x.id) === String(id));
    if (!bk) return res.status(404).json({ ok: false, error: "Запись не найдена" });
    const h = hoursUntil(bk.iso, bk.time, cfg.tzOffsetMin);
    if (h < cfg.rescheduleHours)
      return res.status(409).json({ ok: false, error: `Перенести можно не позже чем за ${cfg.rescheduleHours} ч до занятия. Напишите преподавателю.` });
    if (startUtc(date, time, cfg.tzOffsetMin) <= Date.now())
      return res.status(409).json({ ok: false, error: "Это время уже прошло, выберите другое" });
    if (bk.iso === date && bk.time === time) return res.status(409).json({ ok: false, error: "Это то же самое время" });

    let chatId = "";
    if (APPS_SCRIPT_URL) {
      const data = await appsScript("rescheduleBooking", { id, phone, date, time }, "POST");
      if (!data.ok) return res.status(409).json(data);
      chatId = data.chatId || "";
    } else {
      const db = loadDb();
      const b = db.bookings.find((x) => x.id === id && samePhone(x.phone, phone));
      const target = (db.slots[date] || []).find((s) => s.time === time);
      if (!target) return res.status(409).json({ ok: false, error: "Этот слот уже недоступен, выберите другое время" });
      if (target.status === "booked") return res.status(409).json({ ok: false, error: "Это время уже занято, выберите другое" });
      if (target.status === "closed") return res.status(409).json({ ok: false, error: "Запись на это время закрыта" });
      const old = (db.slots[b.date] || []).find((s) => s.time === b.time);
      if (old) Object.assign(old, { status: "open", student: "", email: "", phone: "", chatId: "", reminded: "" });
      Object.assign(target, { status: "booked", student: b.name, email: b.email, phone: b.phone, subject: b.subject, chatId: b.chatId || "", reminded: "" });
      b.date = date; b.time = time; if (b.status !== "confirmed") b.status = "new";
      chatId = b.chatId || "";
      saveDb(db);
      notifyAdmin(`🔁 Ученик перенёс занятие\n👤 ${b.name} 📞 ${b.phone}\n📅 Было: ${toDsp(bk.iso)} в ${bk.time}\n📅 Стало: ${toDsp(date)} в ${time}`);
    }
    if (!chatId) { try { const u = (await tbl.list("Users")).find((x) => x.phone && samePhone(x.phone, phone)); if (u) chatId = String(u.chat_id); } catch (e) {} }
    if (chatId) tgSend(chatId, `🔁 Занятие перенесено: ${toDsp(date)} в ${time} (${cfg.tzLabel}).`);
    res.json({ ok: true, date, time });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "Не получилось перенести, попробуйте ещё раз" }); }
});

// ---------- students / cabinet ----------
async function allBookings() {
  if (APPS_SCRIPT_URL) { const r = await appsScript("getBookings", {}); return (r.bookings || []).map((x) => ({ ...x, iso: x.iso || toIso(x.date) })); }
  return loadDb().bookings.map((x) => ({ ...x, iso: x.date, date: toDsp(x.date) }));
}
/** Карточка ученика создаётся/обновляется при записи */
async function touchStudent(s) {
  const key = digits(s.phone).slice(-10);
  if (key.length < 10) return;
  const list = await tbl.list("Students");
  const ex = list.find((x) => digits(x.phone).slice(-10) === key);
  if (ex) {
    const patch = { last_seen: new Date().toISOString() };
    if (!ex.name && s.name) patch.name = s.name;
    if (!ex.grade && s.grade) patch.grade = s.grade;
    if (!ex.subject && s.subject) patch.subject = s.subject;
    if (!ex.chat_id && s.chatId) patch.chat_id = s.chatId;
    await tbl.update("Students", "phone", ex.phone, patch);
  } else {
    await tbl.append("Students", {
      phone: String(s.phone), name: s.name || "", grade: s.grade || "", subject: s.subject || "",
      chat_id: s.chatId || "", topics: "", notes: "", created: new Date().toISOString(), last_seen: new Date().toISOString(),
    });
  }
}
function studentStats(phone, bookings, cfg) {
  const mine = bookings.filter((b) => samePhone(b.phone, phone));
  const today = tutorTodayIso(cfg.tzOffsetMin);
  const done = mine.filter((b) => b.status === "done").length;
  const cancelled = mine.filter((b) => b.status === "cancelled").length;
  const upcoming = mine.filter((b) => b.status !== "cancelled" && b.status !== "done" && b.iso >= today);
  const last = mine.filter((b) => b.status === "done").map((b) => b.iso).sort().pop() || "";
  return { total: mine.length, done, cancelled, upcoming: upcoming.length, lastDone: last };
}

/** Кабинет ученика: вход по телефону (тестовый режим, без пароля) */
app.get("/api/cabinet", async (req, res) => {
  const phone = req.query.phone || "";
  if (digits(phone).length < 10) return res.status(400).json({ ok: false, error: "Укажите телефон" });
  try {
    const cfg = await publicConfig();
    if (!cfg.cabinetEnabled) return res.status(403).json({ ok: false, error: "Кабинет отключён" });
    const [students, bookings, notes, users] = await Promise.all([tbl.list("Students"), allBookings(), tbl.list("Notes"), tbl.list("Users")]);
    const st = students.find((x) => samePhone(x.phone, phone));
    const mine = bookings.filter((b) => samePhone(b.phone, phone));
    if (!st && !mine.length) return res.status(404).json({ ok: false, error: "Ученик с таким номером не найден. Сначала запишитесь на занятие." });
    const lastB = mine[0] || {};
    const today = tutorTodayIso(cfg.tzOffsetMin);
    const upcoming = decorateBookings(mine.filter((b) => b.status !== "cancelled" && b.status !== "done" && b.iso >= today), cfg)
      .map((b) => ({ id: b.id, dsp: b.dsp, time: b.time, subject: b.subject, status: b.status, canReschedule: b.canReschedule }));
    const history = mine.filter((b) => b.status === "done").sort((a, b) => (a.iso + a.time < b.iso + b.time ? 1 : -1)).slice(0, 30)
      .map((b) => ({ date: toDsp(b.iso), time: b.time, subject: b.subject }));
    const myNotes = notes.filter((n) => samePhone(n.phone, phone)).sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .map((n) => ({ id: n.id, ts: n.ts, type: n.type, text: n.text, link: n.link }));
    const tgLinked = !!(st && st.chat_id) || users.some((u) => u.phone && samePhone(u.phone, phone));
    res.json({
      ok: true,
      student: {
        name: (st && st.name) || lastB.name || "", grade: (st && st.grade) || lastB.grade || "",
        subject: (st && st.subject) || lastB.subject || "", topics: (st && st.topics) || "", phone: (st && st.phone) || lastB.phone || phone,
      },
      stats: studentStats(phone, bookings, cfg), upcoming, history, notes: myNotes, tgLinked,
      rescheduleHours: cfg.rescheduleHours, tzLabel: cfg.tzLabel,
    });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "cabinet failed" }); }
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
    res.json({ ok: true, bookings: db.bookings.map((b) => ({ ...b, iso: b.date, date: toDsp(b.date) })), storage: "demo" });
  } catch (e) { res.status(500).json({ ok: false, error: "bookings failed" }); }
});

app.patch("/api/bookings/:id", needAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!["new", "confirmed", "done", "cancelled"].includes(status))
    return res.status(400).json({ ok: false, error: "bad status" });
  try {
    let bk = null, chatId = "";
    if (APPS_SCRIPT_URL) {
      const list = await allBookings();
      bk = list.find((x) => String(x.id) === String(req.params.id));
      const data = await appsScript("setBookingStatus", { id: req.params.id, status }, "POST");
      if (!data.ok) return res.json(data);
      chatId = (bk && bk.chatId) || "";
    } else {
      const db = loadDb();
      bk = db.bookings.find((x) => x.id === req.params.id);
      if (!bk) return res.status(404).json({ ok: false, error: "not found" });
      bk.status = status;
      if (status === "cancelled") {
        const s = (db.slots[bk.date] || []).find((x) => x.time === bk.time);
        if (s) Object.assign(s, { status: "open", student: "", email: "", phone: "", chatId: "", reminded: "" });
      }
      saveDb(db);
      chatId = bk.chatId || "";
      bk = { ...bk, iso: bk.date };
    }
    // уведомление ученику в Telegram, если знаем chat id
    if (bk && (status === "cancelled" || status === "confirmed")) {
      if (!chatId) { try { const u = (await tbl.list("Users")).find((x) => x.phone && samePhone(x.phone, bk.phone)); if (u) chatId = String(u.chat_id); } catch (e) {} }
      if (chatId) {
        const cfg = await publicConfig();
        const when = `${toDsp(bk.iso || toIso(bk.date))} в ${bk.time} (${cfg.tzLabel})`;
        tgSend(chatId, status === "cancelled"
          ? `🚫 Занятие ${when} отменено преподавателем. Вы можете выбрать другое время на сайте.`
          : `✅ Занятие ${when} подтверждено. До встречи!`);
      }
    }
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
        out.push({
          date: toDsp(date), iso: date, time: s.time,
          duration: s.duration || +DEFAULTS.lessonDuration, status: normStatus(s.status),
          student: s.student || "", email: s.email || "", phone: s.phone || "",
          subject: s.subject || "", chatId: s.chatId || "",
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
    const cfg = await publicConfig();
    if (APPS_SCRIPT_URL) return res.json(await appsScript("setSlot", { date, time, duration: +(duration || cfg.lessonDuration), subject: subject || "" }, "POST"));
    const db = loadDb();
    if (!db.slots[date]) db.slots[date] = [];
    if (db.slots[date].some((s) => s.time === time)) return res.status(409).json({ ok: false, error: "Слот уже существует" });
    db.slots[date].push({
      time, duration: +(duration || cfg.lessonDuration), status: "open",
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
  const cfg = await publicConfig();
  const payload = {
    from: b.from, to: b.to,
    times: b.times || "", wdFrom: b.wdFrom || "", wdTo: b.wdTo || "",
    weFrom: b.weFrom || "", weTo: b.weTo || "", step: +(b.step || 60),
    duration: +(b.duration || cfg.lessonDuration),
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

// --- настройки ---
app.get("/api/admin/settings", needAdmin, async (req, res) => {
  try {
    const s = await getSettings(true);
    res.json({ ok: true, settings: s, meta: SETTINGS_META, defaults: DEFAULTS,
      env: { botToken: !!BOT_TOKEN, adminChatId: !!ADMIN_CHAT_ID, appsScript: !!APPS_SCRIPT_URL, publicUrl: PUBLIC_URL } });
  } catch (e) { res.status(500).json({ ok: false, error: "settings failed" }); }
});
app.put("/api/admin/settings", needAdmin, async (req, res) => {
  try {
    const s = await saveSettings(req.body || {});
    res.json({ ok: true, settings: s });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "save failed" }); }
});

// --- telegram: пользователи, переписка, отправка, рассылка ---
app.get("/api/admin/tg/status", needAdmin, async (req, res) => {
  if (!BOT_TOKEN) return res.json({ ok: true, enabled: false });
  const me = await tgApi("getMe");
  const wh = await tgApi("getWebhookInfo");
  res.json({ ok: true, enabled: true, bot: me.result || null, webhook: wh.result || null, adminChat: !!ADMIN_CHAT_ID });
});
app.post("/api/admin/tg/set-webhook", needAdmin, async (req, res) => {
  if (!BOT_TOKEN) return res.status(400).json({ ok: false, error: "BOT_TOKEN не задан" });
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const base = PUBLIC_URL || `${proto}://${req.headers.host}`;
  const r = await tgApi("setWebhook", {
    url: `${base}/api/tg/webhook`, secret_token: TG_WEBHOOK_SECRET,
    allowed_updates: ["message", "edited_message"], drop_pending_updates: false,
  });
  res.json({ ok: !!r.ok, result: r, url: `${base}/api/tg/webhook` });
});
app.get("/api/admin/tg/users", needAdmin, async (req, res) => {
  try {
    const [users, msgs] = await Promise.all([tbl.list("Users"), tbl.list("Messages")]);
    const last = {};
    for (const m of msgs) { const k = String(m.chat_id); if (!last[k] || last[k].ts < m.ts) last[k] = m; }
    const out = users.map((u) => ({ ...u, chat_id: String(u.chat_id), display: userDisplay(u), last: last[String(u.chat_id)] || null }))
      .sort((a, b) => ((b.last && b.last.ts) || b.last_seen || "").localeCompare((a.last && a.last.ts) || a.last_seen || ""));
    res.json({ ok: true, users: out });
  } catch (e) { res.status(500).json({ ok: false, error: "users failed" }); }
});
app.get("/api/admin/tg/messages", needAdmin, async (req, res) => {
  try {
    const chatId = String(req.query.chat_id || "");
    let msgs = await tbl.list("Messages");
    if (chatId) msgs = msgs.filter((m) => String(m.chat_id) === chatId);
    msgs.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    res.json({ ok: true, messages: msgs.slice(-300) });
  } catch (e) { res.status(500).json({ ok: false, error: "messages failed" }); }
});
app.post("/api/admin/tg/send", needAdmin, async (req, res) => {
  const { chatId } = req.body || {};
  const text = esc((req.body || {}).text, 4000).trim();
  if (!chatId || !text) return res.status(400).json({ ok: false, error: "Нужны получатель и текст" });
  const r = await tgSend(chatId, text);
  const row = await storeMessage({ dir: "out", chatId, name: "Преподаватель", text, status: r.ok ? "ok" : "failed: " + (r.description || "") });
  res.json({ ok: !!r.ok, error: r.ok ? undefined : (r.description || "не отправлено"), message: row });
});
/** Массовая рассылка. Защита: тело должно содержать confirm: "РАЗОСЛАТЬ" и точное число получателей */
app.post("/api/admin/tg/broadcast", needAdmin, async (req, res) => {
  const b = req.body || {};
  const text = esc(b.text, 4000).trim();
  if (!text) return res.status(400).json({ ok: false, error: "Пустой текст" });
  if (b.confirm !== "РАЗОСЛАТЬ") return res.status(400).json({ ok: false, error: "Нет подтверждения" });
  try {
    let users = (await tbl.list("Users")).filter((u) => u.chat_id && !u.blocked);
    if (Array.isArray(b.ids) && b.ids.length) users = users.filter((u) => b.ids.map(String).includes(String(u.chat_id)));
    if (+b.expected !== users.length) return res.status(409).json({ ok: false, error: `Число получателей изменилось (${users.length}). Обновите список и повторите.` });
    let sent = 0, failed = 0;
    const rows = [];
    for (const u of users) {
      const r = await tgSend(u.chat_id, text);
      if (r.ok) sent++; else failed++;
      if (r.error_code === 403) await tbl.update("Users", "chat_id", String(u.chat_id), { blocked: "1" }).catch(() => {});
      rows.push({ id: newId("M"), ts: new Date().toISOString(), dir: "out", chat_id: String(u.chat_id), name: "Преподаватель",
        text, status: r.ok ? "ok" : "failed: " + (r.description || ""), kind: "broadcast" });
      await new Promise((ok) => setTimeout(ok, 60));
    }
    if (rows.length) await tbl.append("Messages", rows);
    res.json({ ok: true, sent, failed });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "broadcast failed" }); }
});

// --- ученики ---
app.get("/api/admin/students", needAdmin, async (req, res) => {
  try {
    const cfg = await publicConfig();
    const [students, bookings, users] = await Promise.all([tbl.list("Students"), allBookings(), tbl.list("Users")]);
    const byKey = new Map();
    for (const s of students) byKey.set(digits(s.phone).slice(-10), { ...s });
    // ученики, которых ещё нет в Students (старые заявки)
    for (const b of bookings) {
      const k = digits(b.phone).slice(-10);
      if (k.length < 10 || byKey.has(k)) continue;
      byKey.set(k, { phone: b.phone, name: b.name, grade: b.grade || "", subject: b.subject || "", chat_id: b.chatId || "", topics: "", notes: "", created: "", virtual: true });
    }
    const out = [];
    for (const [k, s] of byKey) {
      const u = users.find((x) => x.phone && digits(x.phone).slice(-10) === k);
      const chatId = s.chat_id || (u ? String(u.chat_id) : "");
      out.push({ ...s, chat_id: chatId, tg: u ? "@" + (u.username || "") : "", stats: studentStats(s.phone, bookings, cfg) });
    }
    out.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
    res.json({ ok: true, students: out });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "students failed" }); }
});
app.put("/api/admin/students", needAdmin, async (req, res) => {
  const b = req.body || {};
  if (digits(b.phone).length < 10) return res.status(400).json({ ok: false, error: "bad phone" });
  try {
    const patch = {};
    for (const k of ["name", "grade", "subject", "topics", "notes", "chat_id"]) if (k in b) patch[k] = esc(b[k], 4000);
    const list = await tbl.list("Students");
    const ex = list.find((x) => samePhone(x.phone, b.phone));
    if (ex) await tbl.update("Students", "phone", ex.phone, patch);
    else await tbl.append("Students", { phone: String(b.phone), name: "", grade: "", subject: "", chat_id: "", topics: "", notes: "", created: new Date().toISOString(), ...patch });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: "save failed" }); }
});
app.get("/api/admin/students/notes", needAdmin, async (req, res) => {
  try {
    const phone = req.query.phone || "";
    const notes = (await tbl.list("Notes")).filter((n) => !phone || samePhone(n.phone, phone)).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    res.json({ ok: true, notes });
  } catch (e) { res.status(500).json({ ok: false, error: "notes failed" }); }
});
/** Сообщение ученику в кабинет (домашка, ссылка, заметка) + дублируем в Telegram, если привязан */
app.post("/api/admin/students/notes", needAdmin, async (req, res) => {
  const b = req.body || {};
  const text = esc(b.text, 4000).trim(), link = esc(b.link, 500).trim();
  const type = ["homework", "info", "link"].includes(b.type) ? b.type : "info";
  if (digits(b.phone).length < 10 || (!text && !link)) return res.status(400).json({ ok: false, error: "Нужны телефон и текст" });
  try {
    const row = { id: newId("N"), ts: new Date().toISOString(), phone: String(b.phone), type, text, link };
    await tbl.append("Notes", row);
    let tg = "";
    if (b.sendTg !== false) {
      let chatId = "";
      const st = (await tbl.list("Students")).find((x) => samePhone(x.phone, b.phone));
      if (st && st.chat_id) chatId = String(st.chat_id);
      if (!chatId) { const u = (await tbl.list("Users")).find((x) => x.phone && samePhone(x.phone, b.phone)); if (u) chatId = String(u.chat_id); }
      if (chatId) {
        const head = type === "homework" ? "📝 Домашнее задание" : type === "link" ? "🔗 Ссылка" : "ℹ️ Сообщение от преподавателя";
        const r = await tgSend(chatId, `${head}\n\n${text}${link ? `\n${link}` : ""}`);
        tg = r.ok ? "sent" : "failed";
        await storeMessage({ dir: "out", chatId, name: "Преподаватель", text: `${head}: ${text} ${link}`.trim(), status: r.ok ? "ok" : "failed", kind: "note" });
      } else tg = "no-chat";
    }
    res.json({ ok: true, note: row, tg });
  } catch (e) { res.status(500).json({ ok: false, error: "note failed" }); }
});
app.delete("/api/admin/students/notes", needAdmin, async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: "bad id" });
  try { res.json(await tbl.remove("Notes", "id", id)); }
  catch (e) { res.status(500).json({ ok: false, error: "delete failed" }); }
});

// ---------- static ----------
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/cabinet", (req, res) => res.sendFile(path.join(__dirname, "public", "cabinet.html")));

app.listen(PORT, HOST, () => {
  console.log(`Tutor booking v3 on ${HOST}:${PORT}`);
  console.log(`Storage: ${APPS_SCRIPT_URL ? "Google Sheets" : "demo (data/db.json)"}`);
  console.log(`Telegram bot: ${BOT_TOKEN ? "on (webhook: /api/tg/webhook)" : "off"}`);
});
