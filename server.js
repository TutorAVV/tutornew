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
  heroLead: "Математика и физика — без пробелов.\nПомогаю подтянуть оценки, разобраться в сложных темах и полюбить предметы.\nИндивидуальные занятия для 4–9 классов, урок — 50 минут.\nЗанятия проходят онлайн по Екатеринбургскому времени (МСК+2).",
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
  { key: "tzOffsetMin", label: "Смещение часового пояса от UTC, минут", type: "number",
    hint: "Числом записывается ваш часовой пояс: Москва = 180, Екатеринбург (МСК+2) = 300. Сайт по нему понимает, какие слоты уже прошли, и вовремя шлёт напоминания." },
  { key: "tutorTg", label: "Telegram преподавателя для связи (без @)", type: "text" },
  { key: "contactsText", label: "Текст в разделе «Контакты»", type: "text" },
  { key: "bookingNote", label: "Подсказка под формой записи", type: "text" },
  { key: "cabinetEnabled", label: "Личный кабинет ученика включён (1/0)", type: "number" },
];

/** Каталог пройденных тем (российская школа, 4–9 классы) — для чекбоксов в админке.
 *  Можно переопределить строками листа TopicCatalog (колонки: subject, grade, topics через запятую). */
const TOPICS_CATALOG = {
  "Математика": {
    "4 класс": ["Натуральные числа и действия с ними", "Уравнения", "Обыкновенные дроби", "Периметр и площадь", "Таблицы и диаграммы"],
    "5 класс": ["Натуральные числа", "Обыкновенные дроби", "Десятичные дроби", "Проценты", "Буквенные выражения", "Простые уравнения"],
    "6 класс": ["Делимость чисел", "Действия с обыкновенными дробями", "Отношения и пропорции", "Целые и рациональные числа", "Координатная плоскость"],
    "7 класс": ["Многочлены", "Формулы сокращённого умножения", "Уравнения", "Функции и их графики", "Неравенства", "Треугольники и параллельные прямые (геометрия)"],
    "8 класс": ["Квадратные уравнения", "Квадратный корень", "Линейная функция и её график", "Четырёхугольники", "Окружность и круг", "Начало тригонометрии: синус и косинус"],
    "9 класс": ["Квадратные уравнения и функции (ОГЭ)", "Арифметическая и геометрическая прогрессии", "Векторы", "Статистика и теория вероятностей", "Планиметрия (ОГЭ)"],
  },
  "Физика": {
    "4 класс": ["Что такое физика и окружающий мир", "Свет и тень", "Звук", "Простые механизмы: рычаг, блок"],
    "5 класс": ["Материя и её свойства", "Тепловые явления", "Первое знакомство с электризацией", "Безопасность при опытах"],
    "6 класс": ["Наблюдения и измерения", "Движение в природе", "Магнитное притяжение (первые опыты)", "Техника и энергия"],
    "7 класс": ["Физические величины и единицы измерения", "Механическое движение", "Плотность", "Сила и вес", "Давление твёрдых тел, жидкостей и газов", "Рычаги, работа и энергия"],
    "8 класс": ["Тепловые явления. Теплопередача", "Молекулярное строение вещества", "Внутренняя энергия", "Тепловые двигатели", "Электрический ток и его действие", "Электричество в быту"],
    "9 класс": ["Равномерное и неравномерное движение", "Законы Ньютона", "Импульс и его сохранение", "Работа, мощность, энергия", "Колебания и волны", "Ток: закон Ома, сопротивление, мощность"],
  },
};

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
/** Флаг «вкл/выкл» из таблицы: в Google Sheets строка "0" читается как ЧИСЛО 0,
 *  поэтому сравниваем через String, иначе выключенное «показывается» всё равно. */
function flagOn(v) { return String(v == null ? "" : v) !== "0"; }
function clampInt(v, min, max) { const n = Math.trunc(+v); if (!Number.isFinite(n)) return min; return Math.max(min, Math.min(max, n)); }
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
    cabinetEnabled: flagOn(s.cabinetEnabled),
    botEnabled: !!BOT_TOKEN,
    botUsername: BOT_USERNAME,
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
/** Username бота — для ссылок «открыть бота». Обновляем в фоне, чтобы не тормозить запросы. */
let BOT_USERNAME = (process.env.BOT_USERNAME || "").trim().replace(/^@/, "");
async function refreshBotUsername() {
  if (!BOT_TOKEN) return;
  try { const r = await tgApi("getMe"); if (r && r.ok && r.result && r.result.username) BOT_USERNAME = r.result.username; }
  catch (e) {}
}
refreshBotUsername();
setInterval(refreshBotUsername, 10 * 60 * 1000).unref();
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
/** Все предметы ученика: из карточки + из всех его записей (без дублей, по порядку) */
function studentSubjects(st, mine) {
  const out = [];
  const push = (s) => { s = String(s || "").trim(); if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s); };
  push(st && st.subject);
  for (const b of mine) push(b.subject);
  return out;
}
/** Все занятия ученика для календаря (будущие + прошедшие + отменённые).
 *  Склеиваем два источника (заявки + «мои записи»), чтобы ни одно занятие не потерялось. */
async function cabinetLessons(phone) {
  const [all, active] = await Promise.all([allBookings(), activeBookings(phone)]);
  const map = new Map();
  const norm = (b) => ({ id: b.id, iso: b.iso || toIso(b.date) || "", dsp: toDsp(b.iso || toIso(b.date)), time: b.time, subject: b.subject || "", status: b.status || "new" });
  for (const b of all) { if (!b.id) continue; map.set(String(b.id), norm(b)); }
  for (const b of active) {
    if (!b.id) continue;
    const e = map.get(String(b.id));
    if (e) { if (!e.time) e.time = b.time; if (!e.subject) e.subject = b.subject || ""; if (e.iso !== b.iso) { e.iso = b.iso; e.dsp = b.dsp; } }
    else map.set(String(b.id), norm(b));
  }
  return [...map.values()].filter((b) => b.iso).sort((a, b) => (a.iso + a.time < b.iso + b.time ? -1 : 1));
}
/** Тесты ученика (для кабинета и отдельной страницы) */
function buildMyTests(phone, assigns, tests) {
  const testById = new Map(tests.map((t) => [String(t.id), t]));
  return assigns.filter((a) => samePhone(a.phone, phone) && flagOn(a.visible))
    .sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? 1 : -1))
    .map((a) => {
      const t = testById.get(String(a.testId));
      const answers = parseAssignAnswers(a);
      const maxAttempts = Math.max(1, Math.min(10, +(t && t.maxAttempts) || 1));
      const attempts = Math.max(0, +a.attempts || 0);
      return {
        id: a.id, title: a.title || (t && t.title) || "Тест", status: a.status || "assigned",
        score: a.score === "" || a.score == null ? null : +a.score,
        total: +a.total || +(t && t.count) || 0,
        answered: Object.keys(answers).length,
        showScore: !t || flagOn(t.showScore),
        maxAttempts, attempts, canRetry: a.status === "finished" && attempts < maxAttempts,
        createdAt: a.createdAt, finishedAt: a.finishedAt || "",
      };
    });
}
/** Сообщения преподавателя в кабинет (без тестовых) */
function buildMyNotes(phone, notes) {
  return notes.filter((n) => samePhone(n.phone, phone) && n.type !== "test")
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .map((n) => ({ id: n.id, ts: n.ts, type: n.type, text: n.text, link: n.link }));
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

/** Кабинет ученика: главная страница (тестовый режим, вход по телефону без пароля).
 *  Держим её лёгкой: остальное (расписание, тесты, сообщения) подгружается отдельными
 *  запросами при открытии соответствующих разделов кабинета (#/schedule, #/tests, …). */
app.get("/api/cabinet", async (req, res) => {
  const phone = req.query.phone || "";
  if (digits(phone).length < 10) return res.status(400).json({ ok: false, error: "Укажите телефон" });
  try {
    const cfg = await publicConfig();
    if (!cfg.cabinetEnabled) return res.status(403).json({ ok: false, error: "Кабинет отключён" });
    const [students, bookings, notes, users, assigns, tests, lessons] = await Promise.all([
      tbl.list("Students"), allBookings(), tbl.list("Notes"), tbl.list("Users"),
      tbl.list("TestAssign"), tbl.list("Tests"), cabinetLessons(phone),
    ]);
    const st = students.find((x) => samePhone(x.phone, phone));
    const mine = bookings.filter((b) => samePhone(b.phone, phone));
    if (!st && !mine.length) return res.status(404).json({ ok: false, error: "Ученик с таким номером не найден. Сначала запишитесь на занятие." });
    const lastB = mine[0] || {};
    const today = tutorTodayIso(cfg.tzOffsetMin);
    const upcoming = decorateBookings(lessons.filter((b) => b.status !== "cancelled" && b.status !== "done" && b.iso >= today), cfg);
    const next = upcoming.length ? upcoming[0] : null;
    const myTests = buildMyTests(phone, assigns, tests);
    const myNotes = buildMyNotes(phone, notes);
    const tgLinked = !!(st && st.chat_id) || users.some((u) => u.phone && samePhone(u.phone, phone));
    res.json({
      ok: true,
      student: {
        name: (st && st.name) || lastB.name || "", grade: (st && st.grade) || lastB.grade || "",
        subject: studentSubjects(st, mine).join(" · "), topics: (st && st.topics) || "", phone: (st && st.phone) || lastB.phone || phone,
      },
      stats: studentStats(phone, bookings, cfg),
      next: next ? { id: next.id, dsp: next.dsp, time: next.time, subject: next.subject, status: next.status } : null,
      upcomingTotal: upcoming.length,
      testsCount: myTests.length, notesCount: myNotes.length,
      tgLinked,
      rescheduleHours: cfg.rescheduleHours, tzLabel: cfg.tzLabel,
    });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "cabinet failed" }); }
});

/** Разделы кабинета (подгружаются при переходе: #/schedule, #/tests, #/messages) */
async function cabinetSection(req, res, build) {
  const phone = req.query.phone || "";
  if (digits(phone).length < 10) return res.status(400).json({ ok: false, error: "Укажите телефон" });
  try {
    const cfg = await publicConfig();
    if (!cfg.cabinetEnabled) return res.status(403).json({ ok: false, error: "Кабинет отключён" });
    res.json(await build(cfg));
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "cabinet section failed" }); }
}
app.get("/api/cabinet/lessons", (req, res) => cabinetSection(req, res, async () => ({
  ok: true, lessons: await cabinetLessons(req.query.phone || ""),
})));
app.get("/api/cabinet/tests", (req, res) => cabinetSection(req, res, async () => {
  const [assigns, tests] = await Promise.all([tbl.list("TestAssign"), tbl.list("Tests")]);
  return { ok: true, tests: buildMyTests(req.query.phone || "", assigns, tests) };
}));
app.get("/api/cabinet/notes", (req, res) => cabinetSection(req, res, async () => ({
  ok: true, notes: buildMyNotes(req.query.phone || "", await tbl.list("Notes")),
})));

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
    const bookingsByPhone = new Map();
    for (const b of bookings) {
      const pk = digits(b.phone).slice(-10);
      if (pk.length < 10) continue;
      if (!bookingsByPhone.has(pk)) bookingsByPhone.set(pk, []);
      bookingsByPhone.get(pk).push(b);
    }
    const out = [];
    for (const [k, s] of byKey) {
      const u = users.find((x) => x.phone && digits(x.phone).slice(-10) === k);
      const chatId = s.chat_id || (u ? String(u.chat_id) : "");
      out.push({ ...s, chat_id: chatId, tg: u ? "@" + (u.username || "") : "",
        subjects: studentSubjects(s, bookingsByPhone.get(k) || []).join(" · "),
        stats: studentStats(s.phone, bookings, cfg) });
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
    const fieldLimit = { name: 200, grade: 60, subject: 300, topics: 8000, notes: 8000, chat_id: 40 };
    for (const k of Object.keys(fieldLimit)) if (k in b) patch[k] = esc(b[k], fieldLimit[k]);
    const list = await tbl.list("Students");
    const ex = list.find((x) => samePhone(x.phone, b.phone));
    if (ex) await tbl.update("Students", "phone", ex.phone, patch);
    else await tbl.append("Students", { phone: String(b.phone), name: "", grade: "", subject: "", chat_id: "", topics: "", notes: "", created: new Date().toISOString(), ...patch });
    // Изменили ФИО — переименовываем ученика везде (заявки + слоты), чтобы не лазить в таблицу
    let renamed = 0;
    const newName = String(b.name || "").trim();
    if (newName.length >= 2 && (!ex || String(ex.name || "").trim() !== newName)) {
      try {
        if (APPS_SCRIPT_URL) {
          const r = await appsScript("renameStudent", { phone: b.phone, name: newName }, "POST");
          renamed = +((r && r.renamed) || 0);
        } else {
          const db = loadDb();
          for (const bk of db.bookings) if (samePhone(bk.phone, b.phone)) { bk.name = newName; renamed++; }
          for (const arr of Object.values(db.slots)) for (const s of arr) if (samePhone(s.phone, b.phone) && s.student) { s.student = newName; renamed++; }
          saveDb(db);
        }
      } catch (e) { console.error("renameStudent:", e.message); }
    }
    res.json({ ok: true, renamed });
  } catch (e) { res.status(500).json({ ok: false, error: "save failed" }); }
});
/** Каталог тем для чекбоксов: по умолчанию из кода (TOPICS_CATALOG),
 *  если преподаватель заполнил лист TopicCatalog — оттуда (subject, grade, topics через запятую). */
app.get("/api/admin/topics", needAdmin, async (req, res) => {
  try {
    const rows = await tbl.list("TopicCatalog");
    const catalog = {};
    for (const r of rows) {
      const subj = String(r.subject || "").trim(), grade = String(r.grade || "").trim();
      if (!subj || !grade) continue;
      (catalog[subj] = catalog[subj] || {})[grade] = String(r.topics || "").split(",").map((x) => x.trim()).filter(Boolean);
    }
    if (Object.keys(catalog).length) return res.json({ ok: true, catalog, source: "table" });
  } catch (e) { console.error("topics catalog:", e.message); }
  res.json({ ok: true, catalog: TOPICS_CATALOG, source: "default" });
});
app.get("/api/admin/students/notes", needAdmin, async (req, res) => {
  try {
    const phone = req.query.phone || "";
    const notes = (await tbl.list("Notes")).filter((n) => !phone || samePhone(n.phone, phone)).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    res.json({ ok: true, notes });
  } catch (e) { res.status(500).json({ ok: false, error: "notes failed" }); }
});
/** Сообщение ученику в кабинет (домашка, ссылка, заметка) + дублируем в Telegram, если привязан.
 *  Флаги sendCab / sendTg позволяют отключить один из каналов. */
app.post("/api/admin/students/notes", needAdmin, async (req, res) => {
  const b = req.body || {};
  const text = esc(b.text, 4000).trim(), link = esc(b.link, 500).trim();
  const type = ["homework", "info", "link"].includes(b.type) ? b.type : "info";
  if (digits(b.phone).length < 10 || (!text && !link)) return res.status(400).json({ ok: false, error: "Нужны телефон и текст" });
  try {
    const row = { id: newId("N"), ts: new Date().toISOString(), phone: String(b.phone), type, text, link };
    if (b.sendCab !== false) await tbl.append("Notes", row);
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
    } else tg = "skipped";
    res.json({ ok: true, note: b.sendCab !== false ? row : null, tg });
  } catch (e) { res.status(500).json({ ok: false, error: "note failed" }); }
});
app.delete("/api/admin/students/notes", needAdmin, async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: "bad id" });
  try { res.json(await tbl.remove("Notes", "id", id)); }
  catch (e) { res.status(500).json({ ok: false, error: "delete failed" }); }
});

// ---------- тесты ----------
/**
 * Тесты для учеников. Хранятся в отдельных листах (не трогаем основную БД):
 *   Tests       — id, title, questions(JSON), count, feedback, showScore, created
 *   TestAssign  — id (ссылка-токен для ученика), testId, title, phone, name, status,
 *                 answers(JSON), score, total, visible, createdAt, startedAt, finishedAt
 *
 * Правильные ответы НЕ отправляются ученику до того, как он ответил на вопрос,
 * и только если преподаватель включил обратную связь. Пройти тест можно один раз.
 */
const TEST_QUESTIONS_MAX = 60;

/** Нормализация текстового ответа для сравнения: регистр, пробелы, запятая в десятичных */
function normAnsText(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/,/g, ".").replace(/\s+/g, "").trim();
}
/** «а»/«A»/«1» → индекс варианта с нуля, иначе -1 */
function letterIndex(s) {
  s = String(s == null ? "" : s).trim().toLowerCase();
  if (!s) return -1;
  if (/^\d+$/.test(s)) { const n = +s; return n >= 1 ? n - 1 : -1; }
  if (s.length !== 1) return -1;
  const ru = "абвгдежз".indexOf(s);
  if (ru > -1) return ru;
  return "abcdefgh".indexOf(s);
}
/** Разобрать ссылку на ответ («б», «2», «1,3», «аб», «12 см») → массив индексов */
function parseAnswerRef(val, options) {
  const s = String(val == null ? "" : val).trim();
  if (!s) return [];
  let parts = s.split(/[,;+]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 1 && /^[абвгдежзabcdef]{2,8}$/i.test(parts[0])) parts = parts[0].split("");
  const idxs = parts.map(letterIndex);
  if (parts.length && idxs.every((i) => i >= 0 && i < options.length) && new Set(idxs).size === parts.length)
    return [...new Set(idxs)];
  // точное совпадение с текстом варианта
  const byText = [];
  for (const p of parts) {
    const i = options.findIndex((o) => normAnsText(o) === normAnsText(p));
    if (i === -1) return [];
    byText.push(i);
  }
  return [...new Set(byText)];
}
/** Приводим вопросы к единому виду: choice (options + correct[]) | input (answer) */
function normalizeQuestions(qs) {
  const out = [];
  if (!Array.isArray(qs)) return out;
  for (const q of qs.slice(0, TEST_QUESTIONS_MAX)) {
    if (!q || typeof q !== "object") continue;
    const text = String(q.text || q.q || q.question || "").trim().slice(0, 500);
    if (!text) continue;
    const explanation = String(q.explanation || q.comment || "").trim().slice(0, 500);
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o) => String(typeof o === "object" && o ? (o.text || o.label || "") : o).trim().slice(0, 300))
      .filter(Boolean).slice(0, 10);
    if (options.length >= 2) {
      const raw = q.correct === undefined ? q.answer : q.correct;
      let correct = [];
      for (const v of (Array.isArray(raw) ? raw : [raw])) {
        if (typeof v === "number" && Number.isFinite(v)) { const i = Math.trunc(v) - 1; if (i >= 0 && i < options.length) correct.push(i); }
        else correct.push(...parseAnswerRef(v, options));
      }
      correct = [...new Set(correct)].sort((a, b) => a - b);
      if (!correct.length) continue;
      out.push({ type: "choice", text, options, correct, multi: correct.length > 1, explanation });
    } else {
      const raw = q.answer !== undefined ? q.answer : (Array.isArray(q.correct) ? q.correct[0] : q.correct);
      if (raw === undefined || raw === null) continue;
      const answer = String(raw).trim().slice(0, 200);
      if (!answer) continue;
      out.push({ type: "input", text, answer, explanation });
    }
  }
  return out;
}
/** JSON-формат теста (удобно просить ИИ выдать сразу JSON) */
function parseTestJson(data) {
  let title = "", arr = [];
  if (Array.isArray(data)) arr = data;
  else {
    const o = data || {};
    title = String(o.title || o.name || o.test || o.topic || "").slice(0, 200);
    arr = o.questions || o.items || o.test || [];
    if (!Array.isArray(arr)) arr = [];
  }
  const questions = normalizeQuestions(arr);
  if (!questions.length) return { ok: false, error: "В JSON не нашлось ни одного вопроса с ответом" };
  return { ok: true, title: title || "Тест", questions, warnings: [] };
}
/** Тест простым текстом: «1. Вопрос / а) вариант / Ответ: б» (+ блок «Ответы: 1-б, 2-а» в конце) */
function parseTestPlain(raw) {
  const lines = String(raw).split("\n");
  const warnings = [];
  const blocks = []; // { n, text, options, answerRaw, explanation }
  const key = new Map(); // номер вопроса → строка ответа
  let title = "";
  let cur = null;
  let mode = "body";
  const isTitle = (l) => /^\s*(тест|тема|заголовок|название)\s*[:—-]\s*\S+/i.test(l);
  const flush = () => { if (cur) { blocks.push(cur); cur = null; } };
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (mode === "key") {
      const pairs = l.match(/\d{1,3}\s*[-–—.=)]\s*[^\s,;]+/g) || [];
      for (const p of pairs) {
        const m = p.match(/^(\d{1,3})\s*[-–—.=)]\s*(.+)$/);
        if (m) key.set(+m[1], m[2].replace(/[.,;]$/, ""));
      }
      continue;
    }
    const keyHead = l.match(/^(ключ|ответы)\s*[:\-–—]?\s*(.*)$/i);
    if (keyHead) {
      const rest = keyHead[2].trim();
      const restPairs = (rest.match(/\d{1,3}\s*[-–—.=)]\s*[^\s,;]+/g) || []);
      if (!rest || restPairs.length) {
        flush(); mode = "key";
        for (const p of restPairs) {
          const m = p.match(/^(\d{1,3})\s*[-–—.=)]\s*(.+)$/);
          if (m) key.set(+m[1], m[2].replace(/[.,;]$/, ""));
        }
        continue;
      }
      // «Ответы: б» без пар — считаем обычным ответом на текущий вопрос (ниже)
    }
    if (!title && !blocks.length && !cur) {
      if (isTitle(l)) { title = l.replace(/^\s*(тест|тема|заголовок|название)\s*[:—-]\s*/i, "").slice(0, 200); continue; }
      const looksQuestion = /^\s*(?:Вопрос\s*\d|Вопрос\b|\d{1,3}\s*[.)])/i.test(l);
      if (!looksQuestion) { title = l.replace(/^#+\s*/, "").slice(0, 200); continue; }
    }
    let m = l.match(/^(?:Ответ|Правильный ответ|Правильно|Ответы)\s*[:\-–—]?\s*(.+)$/i);
    if (m) { if (cur) cur.answerRaw = m[1].trim(); continue; }
    m = l.match(/^Пояснение\s*[:\-–—]?\s*(.+)$/i) || l.match(/^Объяснение\s*[:\-–—]?\s*(.+)$/i);
    if (m) { if (cur) cur.explanation = m[1].trim(); continue; }
    // вопрос: «1.», «1)», «Вопрос 3.»
    const qm = l.match(/^(?:Вопрос\s*(\d{1,3})\s*[.)]?|(\d{1,3})([.)]))\s*(.*)$/i);
    const om = l.match(/^(?:[-*•·]\s+(.+)|([а-яёa-z])(?:\)|[-–—.])\s+(.+)|(\d{1,2})\)\s*(.+))$/i);
    const expectedQ = blocks.length + 1;
    if (qm && qm[4]) {
      const num = +(qm[1] || qm[2] || expectedQ);
      const paren = qm[3] === ")";
      // «N)» может быть и вариантом ответа («1) да 2) нет»): вопросом считаем,
      // только если номер — следующий по порядку, а текущий вопрос уже «закрыт»
      // (набраны варианты или есть строка ответа). «N.» и «Вопрос N» — всегда вопрос.
      const startNew = !cur || !paren || (num === expectedQ && (cur.options.length >= 2 || cur.answerRaw != null));
      if (startNew) {
        flush();
        cur = { n: num, text: qm[4].trim(), options: [], answerRaw: null, explanation: "" };
        continue;
      }
    }
    if (om) {
      const optText = (om[1] || om[3] || om[5] || "").trim();
      if (cur && optText) { cur.options.push(optText.slice(0, 300)); continue; }
    }
    // продолжение текста вопроса/варианта на новой строке
    if (cur) {
      if (cur.options.length) cur.options[cur.options.length - 1] += " " + l;
      else cur.text += " " + l;
    }
  }
  flush();
  // применяем ответы (строка «Ответ: …» у вопроса или ключ в конце)
  const questions = [];
  for (const b of blocks) {
    if (b.options.length >= 2) {
      const ref = b.answerRaw != null && String(b.answerRaw).trim() !== ""
        ? parseAnswerRef(b.answerRaw, b.options)
        : parseAnswerRef(key.get(b.n) || "", b.options);
      if (ref.length) questions.push({ type: "choice", text: b.text, options: b.options, correct: ref, multi: ref.length > 1, explanation: b.explanation || "" });
      else warnings.push(`Вопрос ${b.n}: не понял, какой ответ правильный — вопрос пропущен.`);
    } else if (b.answerRaw != null && String(b.answerRaw).trim() !== "") {
      questions.push({ type: "input", text: b.text, answer: String(b.answerRaw).trim().slice(0, 200), explanation: b.explanation || "" });
    } else {
      warnings.push(`Вопрос ${b.n}: нет вариантов ответа и нет строки «Ответ: …» — пропущен.`);
    }
  }
  if (!questions.length) return { ok: false, error: "Не удалось найти ни одного вопроса. Проверьте формат (нумерация вопросов и варианты а)/б)/в), строка «Ответ: …»)." };
  if (!title) title = "Тест";
  return { ok: true, title: title.slice(0, 200), questions, warnings };
}
function parseTestRaw(raw) {
  raw = String(raw || "").replace(/\r/g, "").trim();
  if (!raw) return { ok: false, error: "Пустой текст" };
  let r;
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try { r = parseTestJson(JSON.parse(raw)); }
    catch (e) { return { ok: false, error: "Это похоже на JSON, но не разбирается: " + e.message }; }
  } else r = parseTestPlain(raw);
  // наружу отдаём номера правильных вариантов С ЕДИНИЦЫ (так же читает normalizeQuestions при сохранении)
  if (r && r.ok) {
    r.questions = r.questions.map((q) => q.type === "input" ? q : { ...q, correct: (q.correct || []).map((i) => i + 1) });
  }
  return r;
}
function parseAssignAnswers(a) {
  try { return JSON.parse(a && a.answers ? a.answers : "{}") || {}; } catch (e) { return {}; }
}
function isCorrectAnswer(q, given) {
  if (!q) return false;
  if (q.type === "input") return normAnsText(given) === normAnsText(q.answer);
  const g = (Array.isArray(given) ? given : [given]).map(Number).filter((x) => Number.isInteger(x));
  const c = q.correct || [];
  return g.length === c.length && g.every((x) => c.includes(x));
}

/** Разобрать вставленный текст теста (предпросмотр, без сохранения) */
app.post("/api/admin/tests/parse", needAdmin, async (req, res) => {
  try { res.json(parseTestRaw((req.body || {}).raw)); }
  catch (e) { res.status(500).json({ ok: false, error: "parse failed" }); }
});
/** Сохранить тест */
app.post("/api/admin/tests", needAdmin, async (req, res) => {
  const b = req.body || {};
  try {
    const questions = normalizeQuestions(b.questions);
    if (!questions.length) return res.status(400).json({ ok: false, error: "Нет ни одного корректного вопроса" });
    const row = {
      id: newId("TS"), title: esc(b.title || "Тест", 200), questions: JSON.stringify(questions),
      count: questions.length,
      feedback: b.feedback === false ? "0" : "1", showScore: b.showScore === false ? "0" : "1",
      noCopy: b.noCopy ? "1" : "0", maxAttempts: String(clampInt(b.maxAttempts, 1, 10)),
      created: new Date().toISOString(),
    };
    await tbl.append("Tests", row);
    res.json({ ok: true, test: { ...row, questions: undefined } });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "save failed" }); }
});
/** Список тестов (+ сводка по отправкам) */
app.get("/api/admin/tests", needAdmin, async (req, res) => {
  try {
    const [tests, assigns] = await Promise.all([tbl.list("Tests"), tbl.list("TestAssign")]);
    const out = tests.map((t) => ({
      id: t.id, title: t.title, count: +t.count || 0,
      feedback: flagOn(t.feedback), showScore: flagOn(t.showScore), noCopy: flagOn(t.noCopy),
      maxAttempts: clampInt(t.maxAttempts, 1, 10),
      created: t.created,
      assigned: assigns.filter((a) => String(a.testId) === String(t.id)).length,
      finished: assigns.filter((a) => String(a.testId) === String(t.id) && a.status === "finished").length,
    })).sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
    res.json({ ok: true, tests: out });
  } catch (e) { res.status(500).json({ ok: false, error: "list failed" }); }
});
/** Полностью открыть тест (для редактирования: вопросы + настройки) */
app.put("/api/admin/tests/:id", needAdmin, async (req, res) => {
  const b = req.body || {};
  try {
    const tests = await tbl.list("Tests");
    const t = tests.find((x) => String(x.id) === String(req.params.id));
    if (!t) return res.status(404).json({ ok: false, error: "Тест не найден" });
    const patch = {};
    if (b.title !== undefined) patch.title = esc(b.title || "Тест", 200);
    if (b.questions !== undefined) {
      const questions = normalizeQuestions(b.questions);
      if (!questions.length) return res.status(400).json({ ok: false, error: "Нет ни одного корректного вопроса" });
      patch.questions = JSON.stringify(questions);
      patch.count = questions.length;
    }
    if (b.feedback !== undefined) patch.feedback = b.feedback ? "1" : "0";
    if (b.showScore !== undefined) patch.showScore = b.showScore ? "1" : "0";
    if (b.noCopy !== undefined) patch.noCopy = b.noCopy ? "1" : "0";
    if (b.maxAttempts !== undefined) patch.maxAttempts = String(clampInt(b.maxAttempts, 1, 10));
    await tbl.update("Tests", "id", t.id, patch);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "save failed" }); }
});
app.delete("/api/admin/tests/:id", needAdmin, async (req, res) => {
  try {
    const assigns = (await tbl.list("TestAssign")).filter((a) => String(a.testId) === String(req.params.id));
    for (const a of assigns) await tbl.remove("TestAssign", "id", a.id);
    await tbl.remove("Tests", "id", req.params.id);
    res.json({ ok: true, removed: assigns.length + 1 });
  } catch (e) { res.status(500).json({ ok: false, error: "delete failed" }); }
});
/** Отправить тест ученику: создаёт персональную одноразовую ссылку */
app.post("/api/admin/tests/assign", needAdmin, async (req, res) => {
  const b = req.body || {};
  const testId = String(b.testId || "");
  if (digits(b.phone).length < 10 || !testId) return res.status(400).json({ ok: false, error: "Нужны тест и телефон ученика" });
  try {
    const tests = await tbl.list("Tests");
    const t = tests.find((x) => String(x.id) === testId);
    if (!t) return res.status(404).json({ ok: false, error: "Тест не найден" });
    const students = await tbl.list("Students");
    const st = students.find((x) => samePhone(x.phone, b.phone));
    const id = newId("Q");
    const maxAttempts = clampInt(t.maxAttempts, 1, 10);
    const row = {
      id, testId, title: t.title, phone: String(b.phone), name: (st && st.name) || b.name || "",
      status: "assigned", answers: "", score: "", total: t.count || "0",
      visible: b.sendCab === false ? "0" : "1", attempts: "0",
      createdAt: new Date().toISOString(), startedAt: "", finishedAt: "",
    };
    await tbl.append("TestAssign", row);
    let tg = "";
    if (b.sendTg !== false) {
      let chatId = (st && st.chat_id) || "";
      if (!chatId) { const u = (await tbl.list("Users")).find((x) => x.phone && samePhone(x.phone, b.phone)); if (u) chatId = String(u.chat_id); }
      if (chatId) {
        const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
        const base = PUBLIC_URL || `${proto}://${req.headers.host}`;
        const link = `${base}/test.html?t=${id}`;
        const tries = maxAttempts > 1 ? `Попыток: до ${maxAttempts} — ` : "Пройти можно один раз — ";
        const r = await tgSend(chatId, `📝 Новый тест: «${t.title}»\nВопросов: ${t.count}\n${tries}${link}`);
        tg = r.ok ? "sent" : "failed";
      } else tg = "no-chat";
    } else tg = "skipped";
    res.json({ ok: true, assignment: { ...row, answers: undefined, maxAttempts }, tg });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "assign failed" }); }
});
/** Результаты теста (только преподаватель): кто, когда, балл, ответы по вопросам */
app.get("/api/admin/tests/results", needAdmin, async (req, res) => {
  const testId = String(req.query.testId || "");
  try {
    const [tests, assigns] = await Promise.all([tbl.list("Tests"), tbl.list("TestAssign")]);
    const t = tests.find((x) => String(x.id) === testId);
    if (!t) return res.status(404).json({ ok: false, error: "Тест не найден" });
    let questions = [];
    try { questions = JSON.parse(t.questions || "[]"); } catch (e) {}
    const rows = assigns.filter((a) => String(a.testId) === testId)
      .sort((a, b) => String(a.createdAt) < String(b.createdAt) ? 1 : -1)
      .map((a) => {
        const answers = parseAssignAnswers(a);
        const detail = questions.map((q, i) => {
          const given = answers[i] ? answers[i].a : null;
          const givenText = q.type === "input" ? (given == null ? "" : String(given))
            : (Array.isArray(given) ? given : (given == null ? [] : [given])).map((x) => q.options[x] || ("#" + (+x + 1))).join(", ");
          return { i, text: q.text, given: givenText || "—", ok: !!answers[i] && !!answers[i].ok };
        });
        return {
          id: a.id, name: a.name, phone: a.phone, status: a.status || "assigned",
          score: a.score === "" || a.score == null ? null : +a.score, total: +a.total || questions.length,
          createdAt: a.createdAt, startedAt: a.startedAt || "", finishedAt: a.finishedAt || "", visible: flagOn(a.visible),
          attempts: Math.max(0, +a.attempts || 0),
          answered: Object.keys(answers).length, detail,
        };
      });
    res.json({ ok: true, test: { id: t.id, title: t.title, feedback: flagOn(t.feedback), showScore: flagOn(t.showScore),
      noCopy: flagOn(t.noCopy), maxAttempts: clampInt(t.maxAttempts, 1, 10) }, assignments: rows });
  } catch (e) { res.status(500).json({ ok: false, error: "results failed" }); }
});

/** Отменить попытку ученика: скрыть из кабинета и погасить ссылку (например, отправили не тому) */
app.get("/api/admin/tests/:id", needAdmin, async (req, res) => {
  try {
    const tests = await tbl.list("Tests");
    const t = tests.find((x) => String(x.id) === String(req.params.id));
    if (!t) return res.status(404).json({ ok: false, error: "Тест не найден" });
    let questions = [];
    try { questions = JSON.parse(t.questions || "[]"); } catch (e) {}
    res.json({ ok: true, test: {
      id: t.id, title: t.title, questions, count: questions.length,
      feedback: flagOn(t.feedback), showScore: flagOn(t.showScore), noCopy: flagOn(t.noCopy),
      maxAttempts: clampInt(t.maxAttempts, 1, 10), created: t.created,
    } });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "test not loaded" }); }
});
/** Изменить сохранённый тест (название, вопросы, настройки — можно по отдельности) */

app.post("/api/admin/tests/cancel", needAdmin, async (req, res) => {
  const id = String((req.body || {}).id || "");
  try {
    const a = (await tbl.list("TestAssign")).find((x) => String(x.id) === id);
    if (!a) return res.status(404).json({ ok: false, error: "Попытка не найдена" });
    await tbl.update("TestAssign", "id", id, { visible: "0", status: "cancelled", answers: "", score: "", startedAt: "", finishedAt: "", attempts: "0" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: "cancel failed" }); }
});

// --- тест: сторона ученика ---
/**
 * Что видит ученик по ссылке. Правильные ответы НЕ уходят до ответа на вопрос.
 * Флаги читаем через flagOn: в Google Sheets "0" приходит числом 0.
 */
function testView(a, tst) {
  let questions = [];
  try { questions = JSON.parse((tst && tst.questions) || "[]"); } catch (e) {}
  const answers = parseAssignAnswers(a);
  const finished = a.status === "finished";
  const showScore = flagOn(tst && tst.showScore);
  const feedback = flagOn(tst && tst.feedback);
  const maxAttempts = clampInt(tst && tst.maxAttempts, 1, 10);
  const attempts = Math.max(0, +a.attempts || 0);
  const answeredMap = {};
  for (const k of Object.keys(answers)) answeredMap[k] = feedback ? { ok: !!answers[k].ok } : {};
  return {
    ok: true, title: tst.title, student: a.name || "", count: questions.length,
    feedback, showScore, noCopy: flagOn(tst && tst.noCopy),
    maxAttempts, attempts, canRetry: finished && attempts < maxAttempts,
    status: finished ? "finished" : (Object.keys(answers).length ? "started" : "assigned"),
    answered: Object.keys(answers).length,
    answeredMap,
    score: finished && showScore ? (+a.score || 0) : null,
    // вопросы БЕЗ правильных ответов — они не уходят на клиент, пока не получен ответ
    questions: finished ? [] : questions.map((q) => ({ type: q.type, text: q.text, options: q.options || [], multi: !!q.multi })),
  };
}
/** В проде (Google Sheets) читаем тест одним запросом к Apps Script (testLoad) —
 *  это в 2 раза быстрее, чем два отдельных tblList. Старая версия Code.gs не знает
 *  action — тогда тихо откатываемся на обычный путь. */
async function testLoadRemote(token) {
  const data = await appsScript("testLoad", { token }, "POST");
  if (!data || data.error === "unknown action") return null;
  return data;
}
async function testAnswerRemote(token, qi, answer) {
  const data = await appsScript("testAnswer", { token, qi, answer }, "POST");
  if (!data || data.error === "unknown action") return null;
  return data;
}

app.get("/api/test", async (req, res) => {
  const t = String(req.query.t || "");
  try {
    if (APPS_SCRIPT_URL) {
      const remote = await testLoadRemote(t);
      if (remote) return res.status(remote.ok ? 200 : 404).json(remote);
    }
    const assigns = await tbl.list("TestAssign");
    const a = assigns.find((x) => String(x.id) === t);
    if (!a || !flagOn(a.visible)) return res.status(404).json({ ok: false, error: "Тест не найден. Попросите преподавателя прислать новую ссылку." });
    const tests = await tbl.list("Tests");
    const tst = tests.find((x) => String(x.id) === String(a.testId));
    if (!tst) return res.status(404).json({ ok: false, error: "Тест удалён" });
    res.json(testView(a, tst));
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "test failed" }); }
});
app.post("/api/test/answer", async (req, res) => {
  const b = req.body || {};
  const t = String(b.t || ""), qi = Number(b.qi);
  try {
    if (APPS_SCRIPT_URL) {
      const remote = await testAnswerRemote(t, qi, b.answer);
      if (remote) return res.status(remote.ok ? 200 : 409).json(remote);
    }
    const assigns = await tbl.list("TestAssign");
    const a = assigns.find((x) => String(x.id) === t);
    if (!a || !flagOn(a.visible)) return res.status(404).json({ ok: false, error: "Тест не найден" });
    if (a.status === "finished") return res.status(409).json({ ok: false, error: "Тест уже пройден" });
    const tests = await tbl.list("Tests");
    const tst = tests.find((x) => String(x.id) === String(a.testId));
    let questions = [];
    try { questions = JSON.parse((tst && tst.questions) || "[]"); } catch (e) {}
    const q = questions[qi];
    if (!q) return res.status(400).json({ ok: false, error: "Нет такого вопроса" });
    const answers = parseAssignAnswers(a);
    if (answers[qi] != null) return res.status(409).json({ ok: false, error: "На этот вопрос уже есть ответ" });
    // валидация ответа
    if (q.type === "input") {
      if (typeof b.answer !== "string" || !b.answer.trim()) return res.status(400).json({ ok: false, error: "Введите ответ" });
    } else {
      const arr = Array.isArray(b.answer) ? b.answer.map(Number) : [Number(b.answer)];
      if (!arr.length || !arr.every((x) => Number.isInteger(x) && x >= 0 && x < q.options.length))
        return res.status(400).json({ ok: false, error: "Выберите ответ" });
    }
    const ok = isCorrectAnswer(q, b.answer);
    answers[qi] = { a: b.answer, ok, ts: new Date().toISOString() };
    const started = a.status !== "started";
    await tbl.update("TestAssign", "id", t, {
      answers: JSON.stringify(answers), status: "started",
      ...(started ? { startedAt: new Date().toISOString() } : {}),
    });
    const feedback = tst && flagOn(tst.feedback);
    const out = { ok: true, answeredCount: Object.keys(answers).length };
    if (feedback) {
      out.correct = ok;
      out.correctAnswer = q.type === "input" ? q.answer : q.correct;
    }
    // пояснение показываем всегда, если оно у вопроса есть (и при верном, и при неверном ответе)
    if (q.explanation) out.explanation = q.explanation;
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "answer failed" }); }
});
app.post("/api/test/finish", async (req, res) => {
  const t = String((req.body || {}).t || "");
  try {
    const assigns = await tbl.list("TestAssign");
    const a = assigns.find((x) => String(x.id) === t);
    if (!a || !flagOn(a.visible)) return res.status(404).json({ ok: false, error: "Тест не найден" });
    const tests = await tbl.list("Tests");
    const tst = tests.find((x) => String(x.id) === String(a.testId));
    let questions = [];
    try { questions = JSON.parse((tst && tst.questions) || "[]"); } catch (e) {}
    const showScore = tst && flagOn(tst.showScore);
    const maxAttempts = clampInt(tst && tst.maxAttempts, 1, 10);
    if (a.status === "finished") {
      const attempts = Math.max(0, +a.attempts || 0);
      return res.json({ ok: true, finished: true, total: questions.length, score: showScore ? (+a.score || 0) : null,
        showScore, attempts, maxAttempts, canRetry: attempts < maxAttempts });
    }
    const answers = parseAssignAnswers(a);
    const score = questions.reduce((s, q, i) => s + (answers[i] && answers[i].ok ? 1 : 0), 0);
    const attempts = Math.max(0, +a.attempts || 0) + 1;
    const final = attempts >= maxAttempts;
    await tbl.update("TestAssign", "id", t, {
      status: "finished", score: String(score), total: String(questions.length),
      attempts: String(attempts), finishedAt: new Date().toISOString(),
    });
    notifyAdmin(`📝 Тест «${a.title}» ${final ? "пройден" : `завершён (попытка ${attempts} из ${maxAttempts}, можно ещё)`}\n👤 ${a.name || ""} 📞 ${a.phone}\nРезультат: ${score} из ${questions.length}`);
    res.json({ ok: true, finished: true, total: questions.length, score: showScore ? score : null,
      showScore, attempts, maxAttempts, canRetry: !final });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "finish failed" }); }
});
/** Повторная попытка: очищает ответы и возвращает тест (если лимит попыток не исчерпан) */
app.post("/api/test/retry", async (req, res) => {
  const t = String((req.body || {}).t || "");
  try {
    const assigns = await tbl.list("TestAssign");
    const a = assigns.find((x) => String(x.id) === t);
    if (!a || !flagOn(a.visible)) return res.status(404).json({ ok: false, error: "Тест не найден" });
    const tests = await tbl.list("Tests");
    const tst = tests.find((x) => String(x.id) === String(a.testId));
    if (!tst) return res.status(404).json({ ok: false, error: "Тест удалён" });
    const maxAttempts = clampInt(tst.maxAttempts, 1, 10);
    const attempts = Math.max(0, +a.attempts || 0);
    if (a.status !== "finished" || attempts >= maxAttempts)
      return res.status(409).json({ ok: false, error: "Повторное прохождение недоступно" });
    await tbl.update("TestAssign", "id", t, { answers: "", status: "assigned", score: "", startedAt: "" });
    res.json(testView({ ...a, answers: "", status: "assigned", score: "" }, tst));
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "retry failed" }); }
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
