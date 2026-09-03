/**
 * Tutor booking — backend на Google Apps Script + Google Таблица.
 *
 * УСТАНОВКА (5 минут):
 * 1. Создайте Google Таблицу (пустую).
 * 2. В ней: Расширения → Apps Script → сотрите всё → вставьте этот файл → Сохранить.
 * 3. Ниже заполните SHEET_ID, API_SECRET (и при желании BOT_TOKEN + ADMIN_CHAT_ID).
 * 4. Развернуть → Новое развертывание → тип «Веб-приложение»:
 *    Выполнять от имени: «Я», Доступ: «Все».
 * 5. Скопируйте URL вида https://script.google.com/macros/s/.../exec
 *    → вставьте в Render → Environment → APPS_SCRIPT_URL,
 *    секрет — в API_SECRET → перезапустите сервис.
 */

var SHEET_ID = "ВСТАВЬТЕ_ID_ТАБЛИЦЫ";      // из ссылки на таблицу: docs.google.com/spreadsheets/d/XXX/edit
var API_SECRET = "придумайте-длинный-секрет"; // тот же в Render (API_SECRET)
var BOT_TOKEN = "";        // необязательно: токен от @BotFather — заявки придут в Telegram
var ADMIN_CHAT_ID = "";    // необязательно: ваш chat id (узнать: @userinfobot)

function ss_() { return SpreadsheetApp.openById(SHEET_ID); }

function sheet_(name, headers) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function slotsSheet_() {
  return sheet_("Slots", ["date", "time", "format", "subject", "status", "student", "phone"]);
}

function bookingsSheet_() {
  return sheet_("Bookings", ["id", "createdAt", "date", "time", "subject", "format", "name", "phone", "grade", "comment", "contact", "source", "status"]);
}

function check_(p) {
  if (!API_SECRET) return true;
  return (p && p.secret) === API_SECRET;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- actions ----------
function getSlots_(p) {
  var sh = slotsSheet_();
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (String(r[0]) !== String(p.date)) continue;
    if (p.format && String(r[2]) !== String(p.format)) continue;
    out.push({ date: String(r[0]), time: String(r[1]), format: String(r[2] || "online"), subject: String(r[3] || ""), status: String(r[4] || "free"), student: String(r[5] || "") });
  }
  out.sort(function (a, b) { return a.time < b.time ? -1 : 1; });
  return { ok: true, date: p.date, slots: out };
}

function book_(p) {
  if (!p.date || !p.time || !p.name || !p.phone || !p.subject) {
    return { ok: false, error: "Заполните все поля" };
  }
  var digits = String(p.phone).replace(/\D/g, "");
  if (digits.length < 10) return { ok: false, error: "Проверьте номер телефона" };

  var sh = slotsSheet_();
  var values = sh.getDataRange().getValues();
  var rowIdx = -1;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(p.date) && String(values[i][1]) === String(p.time)) { rowIdx = i + 1; break; }
  }
  if (rowIdx === -1) return { ok: false, error: "Этот слот уже недоступен, выберите другое время" };
  if (String(values[rowIdx - 1][4]) === "busy") return { ok: false, error: "Это время уже занято, выберите другое" };

  // помечаем слот занятым
  sh.getRange(rowIdx, 4).setValue(String(p.subject || values[rowIdx - 1][3] || ""));
  sh.getRange(rowIdx, 5).setValue("busy");
  sh.getRange(rowIdx, 6).setValue(String(p.name));
  sh.getRange(rowIdx, 7).setValue(String(p.phone));

  var id = "B" + new Date().getTime().toString(36).toUpperCase();
  bookingsSheet_().appendRow([
    id, new Date(), String(p.date), String(p.time), String(p.subject || ""),
    String(p.format || "online"), String(p.name), String(p.phone),
    String(p.grade || ""), String(p.comment || ""), String(p.contact || ""),
    String(p.source || "site"), "new"
  ]);

  notify_(
    "🆕 Новая заявка\n" +
    "📚 " + p.subject + "\n" +
    "📅 " + p.date + " в " + p.time + " (" + (p.format === "offline" ? "очно" : "онлайн") + ")\n" +
    "👤 " + p.name + "\n📞 " + p.phone +
    (p.grade ? "\n🎓 " + p.grade : "") +
    (p.comment ? "\n💬 " + p.comment : "") +
    "\nИсточник: " + (p.source || "site")
  );
  return { ok: true, bookingId: id };
}

function getBookings_() {
  var values = bookingsSheet_().getDataRange().getValues();
  var out = [];
  for (var i = values.length - 1; i >= 1; i--) {
    var r = values[i];
    out.push({
      id: String(r[0]), createdAt: r[1], date: String(r[2]), time: String(r[3]),
      subject: String(r[4]), format: String(r[5] || "online"), name: String(r[6]),
      phone: String(r[7]), grade: String(r[8] || ""), comment: String(r[9] || ""),
      contact: String(r[10] || ""), source: String(r[11] || "site"), status: String(r[12] || "new")
    });
  }
  return { ok: true, bookings: out, storage: "sheets" };
}

function setBookingStatus_(p) {
  var sh = bookingsSheet_();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(p.id)) {
      sh.getRange(i + 1, 13).setValue(String(p.status));
      if (String(p.status) === "cancelled") {
        // освобождаем слот
        var ssh = slotsSheet_();
        var sv = ssh.getDataRange().getValues();
        for (var j = 1; j < sv.length; j++) {
          if (String(sv[j][0]) === String(values[i][2]) && String(sv[j][1]) === String(values[i][3])) {
            ssh.getRange(j + 1, 5).setValue("free");
            break;
          }
        }
      }
      return { ok: true };
    }
  }
  return { ok: false, error: "not found" };
}

function setSlot_(p) {
  var sh = slotsSheet_();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(p.date) && String(values[i][1]) === String(p.time)) {
      return { ok: false, error: "Слот уже существует" };
    }
  }
  sh.appendRow([String(p.date), String(p.time), String(p.format || "online"), String(p.subject || ""), "free", "", ""]);
  return { ok: true };
}

function deleteSlot_(p) {
  var sh = slotsSheet_();
  var values = sh.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === String(p.date) && String(values[i][1]) === String(p.time)) {
      sh.deleteRow(i + 1);
    }
  }
  return { ok: true };
}

function generateSlots_(p) {
  var sh = slotsSheet_();
  var values = sh.getDataRange().getValues();
  var have = {};
  for (var i = 1; i < values.length; i++) have[String(values[i][0]) + "|" + String(values[i][1])] = true;
  var times = p.times;
  if (typeof times === "string") { try { times = JSON.parse(times); } catch (e) { times = String(times).split(","); } }
  var wd = p.weekdays;
  if (typeof wd === "string" && wd) { try { wd = JSON.parse(wd); } catch (e) { wd = null; } }
  var d0 = new Date(p.from + "T00:00:00"), d1 = new Date(p.to + "T00:00:00");
  var added = 0;
  for (var d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
    if (wd && wd.length && wd.indexOf(d.getDay()) === -1) continue;
    var key = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    for (var k = 0; k < times.length; k++) {
      var t = String(times[k]).trim();
      if (!/^\d{2}:\d{2}$/.test(t)) continue;
      if (!have[key + "|" + t]) {
        sh.appendRow([key, t, String(p.format || "online"), "", "free", "", ""]);
        have[key + "|" + t] = true;
        added++;
      }
    }
  }
  return { ok: true, added: added };
}

// ---------- telegram ----------
function notify_(text) {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return;
  try {
    UrlFetchApp.fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: text })
    });
  } catch (e) { /* тихо */ }
}

// ---------- entry points ----------
function route_(p) {
  if (!check_(p)) return { ok: false, error: "forbidden" };
  var a = p.action;
  if (a === "getSlots") return getSlots_(p);
  if (a === "book") return book_(p);
  if (a === "getBookings") return getBookings_();
  if (a === "setBookingStatus") return setBookingStatus_(p);
  if (a === "setSlot") return setSlot_(p);
  if (a === "deleteSlot") return deleteSlot_(p);
  if (a === "generateSlots") return generateSlots_(p);
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
