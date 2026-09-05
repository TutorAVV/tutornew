/**
 * Tutor booking v3 — backend на Google Apps Script + Google Таблица.
 *
 * СОВМЕСТИМОСТЬ: понимает СТАРУЮ таблицу (date ДД.ММ.ГГГГ, статусы open/booked/closed,
 * колонки date|time|duration|status|student|email|phone) и новую. Колонки ищутся
 * ПО НАЗВАНИЯМ, даты нормализуются, дни/время пишутся как текст (чтобы Sheets
 * не превращал их в свои объекты).
 *
 * УСТАНОВКА:
 * 1. Расширения → Apps Script → вставить этот файл целиком → Сохранить.
 * 2. Заполнить SHEET_ID, API_SECRET (+ BOT_TOKEN, ADMIN_CHAT_ID для уведомлений
 *    и напоминаний).
 * 3. Развернуть → НОВОЕ развертывание → Веб-приложение (Я / Все) → URL в Render
 *    → APPS_SCRIPT_URL. ⚠️ После КАЖДОГО изменения кода: Управление
 *    развертываниями → ✏️ → Новая версия (иначе сайт видит старый код!).
 * 4. Для напоминаний: один раз запустить функцию createReminderTrigger()
 *    (▶️ в редакторе) и разрешить доступ.
 *
 * v3: перенос занятий учеником, универсальные таблицы (Settings, Users,
 * Messages, Students, Notes) для сервера, исправлена ошибка
 * «You can't set the number format of cells in a typed column».
 */

var SHEET_ID = "ВСТАВЬТЕ_ID_ТАБЛИЦЫ";
var API_SECRET = "придумайте-длинный-секрет"; // тот же, что в Render (API_SECRET)
var BOT_TOKEN = "";        // токен от @BotFather (уведомления + напоминания)
var ADMIN_CHAT_ID = "";    // ваш chat id (@userinfobot) — заявки и копии напоминаний
var SLOTS_SHEET_NAME = "Slots";
var BOOKINGS_SHEET_NAME = "Bookings";
var TUTOR_TZ_OFFSET_MIN = 5 * 60; // МСК+2 = UTC+5
var DEFAULT_DURATION = 50;        // минут

var NEW_SLOT_HEADERS = ["date", "time", "duration", "status", "student", "email", "phone", "subject", "chat_id", "reminded"];
var NEW_BOOK_HEADERS = ["id", "createdAt", "date", "time", "subject", "duration", "name", "email", "phone", "grade", "comment", "contact", "chat_id", "source", "status"];

// ---------- utils ----------
function ss_() { return SpreadsheetApp.openById(SHEET_ID); }

function pad2_(n) { return ("0" + n).slice(-2); }

function tutorNow_() {
  var d = new Date();
  return new Date(d.getTime() + (TUTOR_TZ_OFFSET_MIN + d.getTimezoneOffset()) * 60000);
}

function todayDisplay_() {
  var t = tutorNow_();
  return pad2_(t.getDate()) + "." + pad2_(t.getMonth() + 1) + "." + t.getFullYear();
}

/** Любое значение даты → "ДД.ММ.ГГГГ" */
function normDate_(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return "";
    return pad2_(v.getDate()) + "." + pad2_(v.getMonth() + 1) + "." + v.getFullYear();
  }
  var s = String(v == null ? "" : v).trim();
  if (!s) return "";
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // ISO
  if (m) return pad2_(m[3]) + "." + pad2_(m[2]) + "." + m[1];
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/); // ДД.ММ.ГГГГ
  if (m) {
    var y = m[3].length === 2 ? "20" + m[3] : m[3];
    return pad2_(m[1]) + "." + pad2_(m[2]) + "." + y;
  }
  return s;
}

/** "ДД.ММ.ГГГГ" → "ГГГГ-ММ-ДД" */
function toIso_(dsp) {
  var m = String(dsp).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? m[3] + "-" + m[2] + "-" + m[1] : "";
}

function parseDsp_(dsp) {
  var m = String(dsp).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? { y: +m[3], m: +m[2], d: +m[1] } : null;
}

/** Любое значение времени → "HH:mm" */
function normTime_(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return "";
    return pad2_(v.getHours()) + ":" + pad2_(v.getMinutes());
  }
  var s = String(v == null ? "" : v).trim();
  var m = s.match(/(\d{1,2})\s*:\s*(\d{2})/);
  return m ? pad2_(m[1]) + ":" + m[2] : "";
}

function normStatus_(s) {
  s = String(s == null ? "" : s).trim().toLowerCase();
  if (s === "free") return "open";
  if (s === "busy") return "booked";
  if (s === "open" || s === "booked" || s === "closed") return s;
  return "open";
}

function digits_(p) { return String(p || "").replace(/\D/g, ""); }
function samePhone_(a, b) {
  a = digits_(a); b = digits_(b);
  return a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10);
}

// ---------- sheets by header names ----------
function sheetByName_(name, headers) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** карта "имя колонки → индекс", понимает ru/en и старые названия */
function colMap_(sh) {
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var map = {};
  var alias = {
    date: ["date", "дата", "day"],
    time: ["time", "время"],
    duration: ["duration", "длительность", "длит", "длит.", "mins"],
    status: ["status", "статус"],
    student: ["student", "ученик", "name", "фио", "фамилия имя", "имя"],
    email: ["email", "e-mail", "mail", "почта"],
    phone: ["phone", "телефон", "tel"],
    subject: ["subject", "предмет"],
    chat_id: ["chat_id", "chatid", "tg_id", "telegram_id"],
    reminded: ["reminded", "напомнили"],
    id: ["id"], createdAt: ["createdat", "created_at", "дата заявки", "создано"],
    grade: ["grade", "класс"], comment: ["comment", "комментарий"],
    contact: ["contact", "контакт"], source: ["source", "источник"]
  };
  for (var c = 0; c < head.length; c++) {
    var h = String(head[c]).trim().toLowerCase();
    for (var k in alias) {
      if (alias[k].indexOf(h) !== -1 && !(k in map)) map[k] = c;
    }
  }
  return { map: map, width: head.length };
}

function ensureCol_(sh, cm, key) {
  if (key in cm.map) return cm.map[key];
  var c = sh.getLastColumn();
  sh.getRange(1, c + 1).setValue(key);
  cm.map[key] = c;
  cm.width = c + 1;
  return c;
}

function rows_(sh) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function check_(p) {
  if (!API_SECRET) return true;
  return p && p.secret === API_SECRET;
}

// ---------- actions ----------
function getSlots_(p) {
  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm = colMap_(sh).map;
  if (!("date" in cm) || !("time" in cm)) return { ok: true, date: p.date, slots: [] };
  var want = normDate_(p.date);
  var out = [];
  rows_(sh).forEach(function (r) {
    if (normDate_(r[cm.date]) !== want) return;
    var subj = ("subject" in cm) ? String(r[cm.subject] || "") : "";
    if (p.subject && subj && subj !== String(p.subject)) return;
    out.push({
      time: normTime_(r[cm.time]),
      duration: ("duration" in cm) ? (+r[cm.duration] || DEFAULT_DURATION) : DEFAULT_DURATION,
      status: normStatus_(("status" in cm) ? r[cm.status] : "open"),
      subject: subj
    });
  });
  out.sort(function (a, b) { return a.time < b.time ? -1 : 1; });
  return { ok: true, date: p.date, slots: out };
}

function findSlotRow_(sh, cm, dateDsp, timeStr) {
  var vals = rows_(sh);
  for (var i = 0; i < vals.length; i++) {
    if (normDate_(vals[i][cm.date]) === dateDsp && normTime_(vals[i][cm.time]) === timeStr) {
      return { row: i + 2, vals: vals[i] };
    }
  }
  return null;
}

function book_(p) {
  var dateDsp = normDate_(p.date), timeStr = normTime_(p.time);
  if (!dateDsp || !timeStr) return { ok: false, error: "Выберите дату и время" };
  if (!p.subject) return { ok: false, error: "Выберите предмет" };
  if (String(p.name || "").trim().length < 2) return { ok: false, error: "Укажите имя" };
  if (digits_(p.phone).length < 10) return { ok: false, error: "Проверьте номер телефона" };

  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm0 = colMap_(sh);
  var cm = cm0.map;
  ["status", "student", "email", "phone", "subject", "chat_id", "reminded"].forEach(function (k) { ensureCol_(sh, cm0, k); });
  cm = cm0.map;

  var found = findSlotRow_(sh, cm, dateDsp, timeStr);
  if (!found) return { ok: false, error: "Этот слот уже недоступен, выберите другое время" };
  var st = normStatus_(found.vals[cm.status]);
  if (st === "booked") return { ok: false, error: "Это время уже занято, выберите другое" };
  if (st === "closed") return { ok: false, error: "Запись на это время закрыта, выберите другое" };

  sh.getRange(found.row, cm.status + 1).setValue("booked");
  sh.getRange(found.row, cm.student + 1).setValue(String(p.name).slice(0, 120));
  sh.getRange(found.row, cm.email + 1).setValue(String(p.email || "").slice(0, 120));
  sh.getRange(found.row, cm.phone + 1).setValue(String(p.phone).slice(0, 40));
  if (String(p.subject)) sh.getRange(found.row, cm.subject + 1).setValue(String(p.subject).slice(0, 60));
  if (String(p.chatId || "")) sh.getRange(found.row, cm.chat_id + 1).setValue(String(p.chatId).slice(0, 40));
  sh.getRange(found.row, cm.reminded + 1).setValue("");

  var dur = ("duration" in cm) ? (+found.vals[cm.duration] || DEFAULT_DURATION) : DEFAULT_DURATION;
  var id = "B" + new Date().getTime().toString(36).toUpperCase();
  var bh = sheetByName_(BOOKINGS_SHEET_NAME, NEW_BOOK_HEADERS);
  var bm = colMap_(bh).map;
  var brow = [];
  brow[bm.id || 0] = id;
  if ("createdAt" in bm) brow[bm.createdAt] = new Date();
  brow[bm.date] = dateDsp;
  brow[bm.time] = timeStr;
  if ("subject" in bm) brow[bm.subject] = String(p.subject);
  if ("duration" in bm) brow[bm.duration] = dur;
  if ("student" in bm) brow[bm.student] = String(p.name).slice(0, 120);
  if ("email" in bm) brow[bm.email] = String(p.email || "").slice(0, 120);
  if ("phone" in bm) brow[bm.phone] = String(p.phone).slice(0, 40);
  if ("grade" in bm) brow[bm.grade] = String(p.grade || "");
  if ("comment" in bm) brow[bm.comment] = String(p.comment || "").slice(0, 300);
  if ("contact" in bm) brow[bm.contact] = String(p.contact || "");
  if ("chat_id" in bm) brow[bm.chat_id] = String(p.chatId || "");
  if ("source" in bm) brow[bm.source] = String(p.source || "site");
  if ("status" in bm) brow[bm.status] = "new";
  var arr = [];
  for (var c = 0; c < bh.getLastColumn(); c++) arr.push(c in brow ? brow[c] : "");
  bh.appendRow(arr);

  notify_(
    "🆕 Новая заявка\n📚 " + p.subject + "\n📅 " + dateDsp + " в " + timeStr +
    "\n👤 " + p.name + "\n📞 " + p.phone +
    (p.email ? "\n✉️ " + p.email : "") +
    (p.grade ? "\n🎓 " + p.grade : "") +
    (p.comment ? "\n💬 " + p.comment : "") +
    "\nИсточник: " + (p.source || "site")
  );
  return { ok: true, bookingId: id };
}

/** Мои записи по телефону (для перезаписи) */
function myBookings_(p) {
  var bh = sheetByName_(BOOKINGS_SHEET_NAME, NEW_BOOK_HEADERS);
  var bm = colMap_(bh).map;
  if (!("phone" in bm)) return { ok: true, bookings: [] };
  var t = todayDisplay_();
  var out = [];
  rows_(bh).forEach(function (r) {
    if (!samePhone_(r[bm.phone], p.phone)) return;
    var st = ("status" in bm) ? String(r[bm.status] || "new") : "new";
    if (st === "cancelled" || st === "done") return;
    var dsp = normDate_(r[bm.date]);
    if (toIso_(dsp) < toIso_(t)) return;
    out.push({
      id: String(r[bm.id] || ""), date: dsp, iso: toIso_(dsp),
      time: normTime_(r[bm.time]),
      subject: ("subject" in bm) ? String(r[bm.subject] || "") : "",
      status: st
    });
  });
  out.sort(function (a, b) { return (a.iso + a.time) < (b.iso + b.time) ? -1 : 1; });
  return { ok: true, bookings: out };
}

/** Отмена своей записи учеником (освобождает слот) */
function cancelBooking_(p) {
  var bh = sheetByName_(BOOKINGS_SHEET_NAME, NEW_BOOK_HEADERS);
  var bm = colMap_(bh).map;
  var vals = rows_(bh);
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (String(r[bm.id] || "") === String(p.id) && samePhone_(r[bm.phone], p.phone)) {
      if ("status" in bm) bh.getRange(i + 2, bm.status + 1).setValue("cancelled");
      freeSlotRow_(normDate_(r[bm.date]), normTime_(r[bm.time]));
      notify_("🚫 Ученик отменил запись\n📅 " + normDate_(r[bm.date]) + " в " + normTime_(r[bm.time]) + "\n👤 " + r[bm.student || bm.name] + " 📞 " + r[bm.phone]);
      return { ok: true };
    }
  }
  return { ok: false, error: "Запись не найдена" };
}

/**
 * Перенос записи учеником: старый слот освобождается, новый занимается,
 * строка в Bookings остаётся та же (меняются date/time). Проверка «не позже
 * чем за N часов» делается на сервере (настройка rescheduleHours), здесь —
 * только целостность данных.
 */
function rescheduleBooking_(p) {
  var newDate = normDate_(p.date), newTime = normTime_(p.time);
  if (!newDate || !newTime) return { ok: false, error: "Выберите новое время" };
  var bh = sheetByName_(BOOKINGS_SHEET_NAME, NEW_BOOK_HEADERS);
  var bm = colMap_(bh).map;
  var vals = rows_(bh);
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (String(r[bm.id] || "") !== String(p.id) || !samePhone_(r[bm.phone], p.phone)) continue;
    var st = ("status" in bm) ? String(r[bm.status] || "new") : "new";
    if (st === "cancelled" || st === "done") return { ok: false, error: "Эта запись уже неактивна" };
    var oldDate = normDate_(r[bm.date]), oldTime = normTime_(r[bm.time]);
    if (oldDate === newDate && oldTime === newTime) return { ok: false, error: "Это то же самое время" };

    var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
    var cm0 = colMap_(sh);
    ["status", "student", "email", "phone", "subject", "chat_id", "reminded"].forEach(function (k) { ensureCol_(sh, cm0, k); });
    var cm = cm0.map;
    var target = findSlotRow_(sh, cm, newDate, newTime);
    if (!target) return { ok: false, error: "Этот слот уже недоступен, выберите другое время" };
    var tst = normStatus_(target.vals[cm.status]);
    if (tst === "booked") return { ok: false, error: "Это время уже занято, выберите другое" };
    if (tst === "closed") return { ok: false, error: "Запись на это время закрыта, выберите другое" };

    // данные ученика — из старого слота (если есть) или из заявки
    var old = findSlotRow_(sh, cm, oldDate, oldTime);
    var name = String(r[("student" in bm) ? bm.student : bm.name] || "");
    var email = ("email" in bm) ? String(r[bm.email] || "") : "";
    var phone = String(r[bm.phone] || "");
    var subject = ("subject" in bm) ? String(r[bm.subject] || "") : "";
    var chatId = ("chat_id" in bm) ? String(r[bm.chat_id] || "") : "";
    if (old) {
      if (!email && old.vals[cm.email]) email = String(old.vals[cm.email]);
      if (!chatId && old.vals[cm.chat_id]) chatId = String(old.vals[cm.chat_id]);
      if (!subject && old.vals[cm.subject]) subject = String(old.vals[cm.subject]);
    }
    // занять новый
    sh.getRange(target.row, cm.status + 1).setValue("booked");
    sh.getRange(target.row, cm.student + 1).setValue(name);
    sh.getRange(target.row, cm.email + 1).setValue(email);
    sh.getRange(target.row, cm.phone + 1).setValue(phone);
    if (subject) sh.getRange(target.row, cm.subject + 1).setValue(subject);
    sh.getRange(target.row, cm.chat_id + 1).setValue(chatId);
    sh.getRange(target.row, cm.reminded + 1).setValue("");
    // освободить старый
    freeSlotRow_(oldDate, oldTime);
    // обновить заявку
    writeText_(bh, i + 2, bm.date, newDate);
    writeText_(bh, i + 2, bm.time, newTime);
    if ("status" in bm && st !== "confirmed") bh.getRange(i + 2, bm.status + 1).setValue("new");

    notify_("🔁 Ученик перенёс занятие\n👤 " + name + " 📞 " + phone +
      "\n📅 Было: " + oldDate + " в " + oldTime + "\n📅 Стало: " + newDate + " в " + newTime);
    return { ok: true, id: String(p.id), date: newDate, time: newTime, chatId: chatId };
  }
  return { ok: false, error: "Запись не найдена" };
}

/** Переименовать ученика (ФИО) во всех слотах и заявках — из админки, без правки таблицы */
function renameStudent_(p) {
  var name = String(p.name || "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "bad name" };
  var n = 0;
  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm0 = colMap_(sh); ensureCol_(sh, cm0, "student");
  var cm = cm0.map;
  if ("phone" in cm) {
    rows_(sh).forEach(function (r, i) {
      if (samePhone_(r[cm.phone], p.phone) && String(r[cm.student] || "")) {
        sh.getRange(i + 2, cm.student + 1).setValue(name); n++;
      }
    });
  }
  var bh = sheetByName_(BOOKINGS_SHEET_NAME, NEW_BOOK_HEADERS);
  var bm0 = colMap_(bh);
  var bm = bm0.map;
  var nameCol = ("student" in bm) ? bm.student : ensureCol_(bh, bm0, "name");
  if ("phone" in bm) {
    rows_(bh).forEach(function (r, i) {
      if (samePhone_(r[bm.phone], p.phone)) {
        bh.getRange(i + 2, nameCol + 1).setValue(name); n++;
      }
    });
  }
  return { ok: true, renamed: n };
}

/** Привязать chat_id к ученику по телефону (после «Поделиться номером» в боте) — для напоминаний */
function linkChat_(p) {
  var n = 0;
  if (!p.phone || !p.chatId) return { ok: false, error: "bad payload" };
  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm0 = colMap_(sh); ensureCol_(sh, cm0, "chat_id"); var cm = cm0.map;
  rows_(sh).forEach(function (r, i) {
    if ("phone" in cm && samePhone_(r[cm.phone], p.phone) && !String(r[cm.chat_id] || "")) {
      sh.getRange(i + 2, cm.chat_id + 1).setValue(String(p.chatId)); n++;
    }
  });
  var bh = sheetByName_(BOOKINGS_SHEET_NAME, NEW_BOOK_HEADERS);
  var bm0 = colMap_(bh); ensureCol_(bh, bm0, "chat_id"); var bm = bm0.map;
  rows_(bh).forEach(function (r, i) {
    if ("phone" in bm && samePhone_(r[bm.phone], p.phone) && !String(r[bm.chat_id] || "")) {
      bh.getRange(i + 2, bm.chat_id + 1).setValue(String(p.chatId)); n++;
    }
  });
  return { ok: true, linked: n };
}

function freeSlotRow_(dateDsp, timeStr) {
  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm = colMap_(sh).map;
  if (!("date" in cm)) return;
  var f = findSlotRow_(sh, cm, dateDsp, timeStr);
  if (!f) return;
  if ("status" in cm) sh.getRange(f.row, cm.status + 1).setValue("open");
  ["student", "email", "phone", "chat_id", "reminded"].forEach(function (k) {
    if (k in cm) sh.getRange(f.row, cm[k] + 1).setValue("");
  });
}

function getBookings_(p) {
  var bh = sheetByName_(BOOKINGS_SHEET_NAME, NEW_BOOK_HEADERS);
  var bm = colMap_(bh).map;
  var from = p.from ? toIso_(normDate_(p.from)) : "";
  var to = p.to ? toIso_(normDate_(p.to)) : "";
  var out = [];
  var vals = rows_(bh);
  for (var i = vals.length - 1; i >= 0; i--) {
    var r = vals[i];
    var dsp = ("date" in bm) ? normDate_(r[bm.date]) : "";
    var iso = toIso_(dsp);
    if (from && iso < from) continue;
    if (to && iso > to) continue;
    var st = ("status" in bm) ? String(r[bm.status] || "new") : "new";
    if (p.status && st !== p.status) continue;
    out.push({
      id: String(r[bm.id] || ""),
      createdAt: ("createdAt" in bm) ? r[bm.createdAt] : "",
      date: dsp, iso: iso,
      time: ("time" in bm) ? normTime_(r[bm.time]) : "",
      subject: ("subject" in bm) ? String(r[bm.subject] || "") : "",
      duration: ("duration" in bm) ? (+r[bm.duration] || DEFAULT_DURATION) : DEFAULT_DURATION,
      name: String(r[("student" in bm) ? bm.student : bm.name] || ""),
      email: ("email" in bm) ? String(r[bm.email] || "") : "",
      phone: ("phone" in bm) ? String(r[bm.phone] || "") : "",
      grade: ("grade" in bm) ? String(r[bm.grade] || "") : "",
      comment: ("comment" in bm) ? String(r[bm.comment] || "") : "",
      contact: ("contact" in bm) ? String(r[bm.contact] || "") : "",
      source: ("source" in bm) ? String(r[bm.source] || "") : "",
      chatId: ("chat_id" in bm) ? String(r[bm.chat_id] || "") : "",
      status: st
    });
  }
  return { ok: true, bookings: out, storage: "sheets" };
}

function setBookingStatus_(p) {
  var bh = sheetByName_(BOOKINGS_SHEET_NAME, NEW_BOOK_HEADERS);
  var bm = colMap_(bh).map;
  var vals = rows_(bh);
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][bm.id] || "") === String(p.id)) {
      if ("status" in bm) bh.getRange(i + 2, bm.status + 1).setValue(String(p.status));
      if (String(p.status) === "cancelled") {
        freeSlotRow_(normDate_(vals[i][bm.date]), normTime_(vals[i][bm.time]));
      }
      return { ok: true };
    }
  }
  return { ok: false, error: "not found" };
}

/** Расписание для админки: все слоты диапазона ВМЕСТЕ с занятыми */
function getSchedule_(p) {
  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm = colMap_(sh).map;
  if (!("date" in cm)) return { ok: true, slots: [] };
  var from = p.from ? toIso_(normDate_(p.from)) : "";
  var to = p.to ? toIso_(normDate_(p.to)) : "";
  var out = [];
  rows_(sh).forEach(function (r) {
    var dsp = normDate_(r[cm.date]);
    var iso = toIso_(dsp);
    if (!iso) return;
    if (from && iso < from) return;
    if (to && iso > to) return;
    var g = function (k) { return (k in cm) ? r[cm[k]] : ""; };
    out.push({
      date: dsp, iso: iso,
      time: normTime_(g("time")),
      duration: +g("duration") || DEFAULT_DURATION,
      status: normStatus_(g("status")),
      student: String(g("student") || ""),
      email: String(g("email") || ""),
      phone: String(g("phone") || ""),
      subject: String(g("subject") || ""),
      chatId: String(g("chat_id") || "")
    });
  });
  out.sort(function (a, b) { return (a.iso + a.time) < (b.iso + b.time) ? -1 : 1; });
  return { ok: true, slots: out };
}

/**
 * Записать текст. В «типизированных» колонках (Sheets → Формат → Тип колонки /
 * таблицы) setNumberFormat бросает исключение — поэтому формат ставим
 * «по возможности», а значение всё равно записываем (чтение через normDate_/
 * normTime_ понимает и текст, и объекты Date).
 */
function writeText_(sh, row, colIdx, val) {
  var rng = sh.getRange(row, colIdx + 1);
  try { rng.setNumberFormat("@"); } catch (e) { /* typed column — пропускаем */ }
  rng.setValue(val);
}

/** Добавить сразу несколько строк слотов (быстро, без setNumberFormat на каждую ячейку) */
function appendSlotRows_(sh, cm, rows) {
  if (!rows.length) return;
  var width = Math.max(sh.getLastColumn(), 1);
  var data = rows.map(function (r) {
    var arr = [];
    for (var c = 0; c < width; c++) arr.push("");
    arr[cm.date] = r.date;
    arr[cm.time] = r.time;
    if ("duration" in cm) arr[cm.duration] = r.duration;
    if ("status" in cm) arr[cm.status] = "open";
    if ("subject" in cm && r.subject) arr[cm.subject] = r.subject;
    return arr;
  });
  var start = sh.getLastRow() + 1;
  var rng = sh.getRange(start, 1, data.length, width);
  try {
    sh.getRange(start, cm.date + 1, data.length, 1).setNumberFormat("@");
    sh.getRange(start, cm.time + 1, data.length, 1).setNumberFormat("@");
  } catch (e) { /* typed column */ }
  rng.setValues(data);
}

function setSlot_(p) {
  var dateDsp = normDate_(p.date), timeStr = normTime_(p.time);
  if (!dateDsp || !timeStr) return { ok: false, error: "bad payload" };
  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm0 = colMap_(sh);
  var cm = cm0.map;
  if (findSlotRow_(sh, cm, dateDsp, timeStr)) return { ok: false, error: "Слот уже существует" };
  appendSlotRows_(sh, cm, [{ date: dateDsp, time: timeStr, duration: +(p.duration || DEFAULT_DURATION), subject: String(p.subject || "") }]);
  return { ok: true };
}

/** Закрыть/открыть слот (без удаления ученика при закрытии свободного) */
function setSlotStatus_(p) {
  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm = colMap_(sh).map;
  var f = findSlotRow_(sh, cm, normDate_(p.date), normTime_(p.time));
  if (!f) return { ok: false, error: "not found" };
  var ns = normStatus_(p.status);
  sh.getRange(f.row, cm.status + 1).setValue(ns);
  if (ns === "open") {
    // освобождение занятого слота — стираем данные ученика
    ["student", "email", "phone", "chat_id", "reminded"].forEach(function (k) {
      if (k in cm) sh.getRange(f.row, cm[k] + 1).setValue("");
    });
  }
  return { ok: true };
}

function deleteSlot_(p) {
  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm = colMap_(sh).map;
  if (!("date" in cm)) return { ok: true, deleted: 0 };
  var vals = rows_(sh);
  var n = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (normDate_(vals[i][cm.date]) === normDate_(p.date) && normTime_(vals[i][cm.time]) === normTime_(p.time)) {
      sh.deleteRow(i + 2);
      n++;
    }
  }
  return { ok: true, deleted: n };
}

function timesFromWindows_(p) {
  // Явный список важнее окон
  if (p.times && p.times.length) {
    var t = (typeof p.times === "string") ? p.times.split(",") : p.times;
    return t.map(normTime_).filter(function (x) { return /^\d{2}:\d{2}$/.test(x); });
  }
  return null;
}

function windowTimes_(from, to, stepMin) {
  var out = [];
  var a = normTime_(from), b = normTime_(to);
  if (!/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b)) return out;
  var ah = +a.slice(0, 2), am = +a.slice(3), bh = +b.slice(0, 2), bm = +b.slice(3);
  var cur = ah * 60 + am, end = bh * 60 + bm;
  var step = Math.max(15, +(stepMin || 60));
  while (cur <= end) {
    out.push(pad2_(Math.floor(cur / 60)) + ":" + pad2_(cur % 60));
    cur += step;
  }
  return out;
}

function generateSlots_(p) {
  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm = colMap_(sh).map;
  var d0 = parseDsp_(normDate_(p.from)), d1 = parseDsp_(normDate_(p.to));
  if (!d0 || !d1) return { ok: false, error: "bad range" };
  var explicit = timesFromWindows_(p);
  var dur = +(p.duration || DEFAULT_DURATION);
  var keep = p.keepExisting !== false && p.keepExisting !== "false";
  // существующие слоты — одним чтением
  var existing = {};
  rows_(sh).forEach(function (r) { existing[normDate_(r[cm.date]) + " " + normTime_(r[cm.time])] = true; });
  var toAdd = [];
  var d = new Date(d0.y, d0.m - 1, d0.d), end = new Date(d1.y, d1.m - 1, d1.d);
  while (d <= end) {
    var dsp = pad2_(d.getDate()) + "." + pad2_(d.getMonth() + 1) + "." + d.getFullYear();
    var dow = d.getDay(), isWe = (dow === 0 || dow === 6);
    var times = explicit;
    if (!times) {
      times = isWe
        ? windowTimes_(p.weFrom, p.weTo, p.step)
        : windowTimes_(p.wdFrom, p.wdTo, p.step);
    }
    (times || []).forEach(function (t) {
      if (keep && existing[dsp + " " + t]) return;
      existing[dsp + " " + t] = true;
      toAdd.push({ date: dsp, time: t, duration: dur, subject: "" });
    });
    d.setDate(d.getDate() + 1);
  }
  appendSlotRows_(sh, cm, toAdd);
  return { ok: true, added: toAdd.length };
}

/** Очистить диапазон: mode=delete (удалить) или close (закрыть) */
function clearRange_(p) {
  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm = colMap_(sh).map;
  if (!("date" in cm)) return { ok: true, affected: 0 };
  var from = toIso_(normDate_(p.from)), to = toIso_(normDate_(p.to));
  var vals = rows_(sh);
  var n = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    var iso = toIso_(normDate_(vals[i][cm.date]));
    if (from && iso < from) continue;
    if (to && iso > to) continue;
    if (p.mode === "delete") { sh.deleteRow(i + 2); n++; }
    else { sh.getRange(i + 2, cm.status + 1).setValue("closed"); n++; }
  }
  return { ok: true, affected: n };
}

/** Чистка прошлого: удалить слоты старше сегодня (booked — только со статусом, ученика не трогаем? нет: удаляем open/closed, booked оставляем как историю) */
function cleanupPast_() {
  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm = colMap_(sh).map;
  if (!("date" in cm)) return { ok: true, deleted: 0, kept: 0 };
  var t = toIso_(todayDisplay_());
  var vals = rows_(sh);
  var del = 0, kept = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    var iso = toIso_(normDate_(vals[i][cm.date]));
    if (iso && iso < t) {
      var st = normStatus_(vals[i][cm.status]);
      if (st === "booked") { kept++; continue; }
      sh.deleteRow(i + 2);
      del++;
    }
  }
  return { ok: true, deleted: del, keptBooked: kept };
}

// ---------- универсальные таблицы (Settings, Users, Messages, Students, Notes) ----------
// Сервер хранит здесь настройки сайта, пользователей бота, переписку и данные учеников.
// Первая строка — заголовки; недостающие колонки добавляются автоматически.
function tblSheet_(name) {
  name = String(name || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
  if (!name) throw new Error("bad table");
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.setFrozenRows(1); }
  return sh;
}
function tblHeaders_(sh) {
  if (sh.getLastColumn() < 1) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h || "").trim(); });
}
function tblEnsure_(sh, headers, keys) {
  var added = false;
  keys.forEach(function (k) {
    if (headers.indexOf(k) === -1) { headers.push(k); added = true; }
  });
  if (added) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  return headers;
}
function tblCell_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString();
  return v == null ? "" : v;
}
function tblList_(p) {
  var sh = tblSheet_(p.table);
  var head = tblHeaders_(sh);
  var out = [];
  if (sh.getLastRow() >= 2 && head.length) {
    sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues().forEach(function (r) {
      var o = {}, empty = true;
      head.forEach(function (h, i) { if (!h) return; o[h] = tblCell_(r[i]); if (o[h] !== "") empty = false; });
      if (!empty) out.push(o);
    });
  }
  return { ok: true, rows: out };
}
function tblAppend_(p) {
  var sh = tblSheet_(p.table);
  var rows = Array.isArray(p.rows) ? p.rows : [p.row || {}];
  var head = tblHeaders_(sh);
  var keys = [];
  rows.forEach(function (o) { Object.keys(o).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); }); });
  head = tblEnsure_(sh, head, keys);
  var data = rows.map(function (o) { return head.map(function (h) { return (h in o) ? tblCell_(o[h]) : ""; }); });
  if (data.length) sh.getRange(sh.getLastRow() + 1, 1, data.length, head.length).setValues(data);
  return { ok: true, added: data.length };
}
function tblUpdate_(p) {
  var sh = tblSheet_(p.table);
  var head = tblHeaders_(sh);
  var patch = p.patch || {};
  head = tblEnsure_(sh, head, Object.keys(patch));
  var fi = head.indexOf(String(p.field));
  if (fi === -1) return { ok: true, updated: 0 };
  var n = 0;
  if (sh.getLastRow() >= 2) {
    var rng = sh.getRange(2, 1, sh.getLastRow() - 1, head.length);
    var vals = rng.getValues();
    var changed = false;
    vals.forEach(function (r) {
      if (String(tblCell_(r[fi])) !== String(p.value)) return;
      Object.keys(patch).forEach(function (k) { r[head.indexOf(k)] = tblCell_(patch[k]); });
      n++; changed = true;
    });
    if (changed) rng.setValues(vals);
  }
  return { ok: true, updated: n };
}
function tblRemove_(p) {
  var sh = tblSheet_(p.table);
  var head = tblHeaders_(sh);
  var fi = head.indexOf(String(p.field));
  if (fi === -1 || sh.getLastRow() < 2) return { ok: true, removed: 0 };
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();
  var n = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(tblCell_(vals[i][fi])) === String(p.value)) { sh.deleteRow(i + 2); n++; }
  }
  return { ok: true, removed: n };
}
/** Настройка из листа Settings (key/value) — для триггера напоминаний */
function setting_(key, def) {
  try {
    var rows = tblList_({ table: "Settings" }).rows;
    for (var i = 0; i < rows.length; i++) if (String(rows[i].key) === key && String(rows[i].value) !== "") return rows[i].value;
  } catch (e) {}
  return def;
}
/** chat_id по телефону из Users (кто поделился номером в боте) */
function chatByPhone_(phone) {
  try {
    var rows = tblList_({ table: "Users" }).rows;
    for (var i = 0; i < rows.length; i++) if (rows[i].phone && samePhone_(rows[i].phone, phone)) return String(rows[i].chat_id || "");
  } catch (e) {}
  return "";
}

// ---------- telegram ----------
function tgSend_(chatId, text) {
  if (!BOT_TOKEN || !chatId) return false;
  try {
    var r = UrlFetchApp.fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: String(chatId), text: text })
    });
    return r.getResponseCode() === 200;
  } catch (e) { return false; }
}

function notify_(text) {
  if (ADMIN_CHAT_ID) tgSend_(ADMIN_CHAT_ID, text);
}

/**
 * Напоминания. Запускается триггером каждые 15 минут.
 * За сколько минут — настройка reminderMinutes в листе Settings (по умолчанию 60,
 * меняется в админке → Настройки). chat_id берётся из слота, а если его нет —
 * из листа Users по телефону (ученик поделился номером в боте).
 */
function reminderTick() {
  var sh = sheetByName_(SLOTS_SHEET_NAME, NEW_SLOT_HEADERS);
  var cm0 = colMap_(sh);
  ensureCol_(sh, cm0, "chat_id"); ensureCol_(sh, cm0, "reminded");
  var cm = cm0.map;
  if (!("date" in cm)) return;
  var now = new Date().getTime();
  var lead = +setting_("reminderMinutes", 60) || 60;
  var tz = +setting_("tzOffsetMin", TUTOR_TZ_OFFSET_MIN) || TUTOR_TZ_OFFSET_MIN;
  var tzLabel = String(setting_("tzLabel", "МСК+2"));
  rows_(sh).forEach(function (r, i) {
    if (normStatus_(r[cm.status]) !== "booked") return;
    if (String(r[cm.reminded] || "") === "yes") return;
    var pd = parseDsp_(normDate_(r[cm.date]));
    var tm = normTime_(r[cm.time]);
    if (!pd || !/^\d{2}:\d{2}$/.test(tm)) return;
    var startUtc = Date.UTC(pd.y, pd.m - 1, pd.d, +tm.slice(0, 2), +tm.slice(3)) - tz * 60000;
    var mins = (startUtc - now) / 60000;
    // окно: [lead-15, lead] минут до начала (триггер раз в 15 минут)
    if (mins <= lead && mins > lead - 16) {
      var chatId = String(r[cm.chat_id] || "").trim();
      if (!chatId && ("phone" in cm)) chatId = chatByPhone_(r[cm.phone]);
      if (!chatId) return;
      var subj = ("subject" in cm) ? String(r[cm.subject] || "занятие") : "занятие";
      var ok = tgSend_(chatId, "⏰ Напоминание: " + subj + " сегодня в " + tm + " (" + tzLabel + ").\nДо встречи! 🎓");
      if (ok) {
        sh.getRange(i + 2, cm.reminded + 1).setValue("yes");
        if (ADMIN_CHAT_ID) tgSend_(ADMIN_CHAT_ID, "⏰ Скоро занятие: " + (r[cm.student] || "") + ", " + subj + ", " + tm + ", тел. " + (r[cm.phone] || ""));
      }
    }
  });
}

/** Запустить ОДИН РАЗ в редакторе (выбрать в списке функций → ▶️) — создаёт триггер напоминаний каждые 15 минут */
function createReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === "reminderTick" || h === "reminderTick_") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("reminderTick").timeBased().everyMinutes(15).create();
}

// ---------- entry ----------
function route_(p) {
  if (!check_(p)) return { ok: false, error: "forbidden" };
  var a = p.action;
  if (a === "getSlots") return getSlots_(p);
  if (a === "book") return book_(p);
  if (a === "myBookings") return myBookings_(p);
  if (a === "cancelBooking") return cancelBooking_(p);
  if (a === "rescheduleBooking") return rescheduleBooking_(p);
  if (a === "linkChat") return linkChat_(p);
  if (a === "renameStudent") return renameStudent_(p);
  if (a === "tblList") return tblList_(p);
  if (a === "tblAppend") return tblAppend_(p);
  if (a === "tblUpdate") return tblUpdate_(p);
  if (a === "tblRemove") return tblRemove_(p);
  if (a === "getBookings") return getBookings_(p);
  if (a === "setBookingStatus") return setBookingStatus_(p);
  if (a === "getSchedule") return getSchedule_(p);
  if (a === "setSlot") return setSlot_(p);
  if (a === "setSlotStatus") return setSlotStatus_(p);
  if (a === "deleteSlot") return deleteSlot_(p);
  if (a === "generateSlots") return generateSlots_(p);
  if (a === "clearRange") return clearRange_(p);
  if (a === "cleanupPast") return cleanupPast_();
  return { ok: false, error: "unknown action" };
}

function doGet(e) {
  try { return out_(route_(e.parameter || {})); }
  catch (err) { return out_({ ok: false, error: String(err) }); }
}

function doPost(e) {
  try {
    var p = {};
    try { p = JSON.parse(e.postData.contents); } catch (err2) { p = e.parameter || {}; }
    return out_(route_(p));
  } catch (err) { return out_({ ok: false, error: String(err) }); }
}
