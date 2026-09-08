import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  GraduationCap,
  LoaderCircle,
  Moon,
  Phone,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Sun,
  Zap,
} from "lucide-react";

const DEFAULT_CONFIG = {
  tutorName: "Онлайн-уроки",
  subjects: ["Математика", "Физика"],
  grades: ["4 класс", "5 класс", "6 класс", "7 класс", "8 класс", "9 класс (ОГЭ)"],
  tzLabel: "МСК+2",
  tzOffsetMin: 300,
  lessonDuration: 50,
  rescheduleHours: 12,
  tutorTg: "",
};

const SUBJECT_MARKS = {
  математика: "∑",
  физика: "⚛",
  информатика: "⌘",
  химия: "◈",
  английский: "Aa",
};

function normaliseConfig(data = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...data,
    subjects: Array.isArray(data.subjects) && data.subjects.length ? data.subjects : DEFAULT_CONFIG.subjects,
    grades: Array.isArray(data.grades) && data.grades.length ? data.grades : DEFAULT_CONFIG.grades,
    tzOffsetMin: Number.isFinite(Number(data.tzOffsetMin)) ? Number(data.tzOffsetMin) : DEFAULT_CONFIG.tzOffsetMin,
    rescheduleHours: Number.isFinite(Number(data.rescheduleHours)) ? Number(data.rescheduleHours) : DEFAULT_CONFIG.rescheduleHours,
  };
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (_error) {
    throw new Error("Нет связи с сервисом записи. Попробуйте ещё раз.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) throw new Error(data?.error || "Не удалось выполнить запрос. Попробуйте ещё раз.");
  return data || {};
}

function dateForTutor(offsetMinutes) {
  return new Date(Date.now() + Number(offsetMinutes || 0) * 60_000).toISOString().slice(0, 10);
}

function addDays(iso, amount) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function buildDates(offsetMinutes, count = 45) {
  const today = dateForTutor(offsetMinutes);
  return Array.from({ length: count }, (_, index) => addDays(today, index));
}

function dateParts(iso, index) {
  const date = new Date(`${iso}T12:00:00Z`);
  return {
    day: date.getUTCDate(),
    weekDay: index === 0 ? "сегодня" : index === 1 ? "завтра" : date.toLocaleDateString("ru-RU", { weekday: "short", timeZone: "UTC" }).replace(".", ""),
    month: date.toLocaleDateString("ru-RU", { month: "short", timeZone: "UTC" }).replace(".", ""),
  };
}

function formatLongDate(iso) {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function displayBookingDate(booking) {
  if (booking?.dsp) return booking.dsp;
  const date = String(booking?.iso || booking?.date || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
  return date;
}

function validPhone(value) {
  return String(value || "").replace(/\D/g, "").length >= 10;
}

function subjectMark(subject) {
  const lower = String(subject || "").toLowerCase();
  const key = Object.keys(SUBJECT_MARKS).find((item) => lower.includes(item));
  return key ? SUBJECT_MARKS[key] : "✦";
}

function freeSlot(slot) {
  return slot?.status === "open" || slot?.status === "free";
}

function unavailableLabel(status) {
  if (status === "booked" || status === "busy") return "занято";
  if (status === "closed") return "закрыто";
  if (status === "past") return "прошло";
  return "недоступно";
}

function telegramBridge() {
  try { return window.Telegram?.WebApp || null; } catch (_error) { return null; }
}

function haptic(bridge, type) {
  try { bridge?.HapticFeedback?.notificationOccurred(type); } catch (_error) { /* Telegram API is optional */ }
}

function selectionHaptic(bridge) {
  try { bridge?.HapticFeedback?.selectionChanged(); } catch (_error) { /* Telegram API is optional */ }
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><Sparkles size={17} strokeWidth={2.4} /></span>;
}

function TelegramApp() {
  const [bridge, setBridge] = useState(() => telegramBridge());
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("glass-theme") || localStorage.getItem("theme") || "dark"; } catch (_error) { return "dark"; }
  });
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [subject, setSubject] = useState(DEFAULT_CONFIG.subjects[0]);
  const dates = useMemo(() => buildDates(config.tzOffsetMin), [config.tzOffsetMin]);
  const [date, setDate] = useState(() => buildDates(DEFAULT_CONFIG.tzOffsetMin)[0]);
  const [slots, setSlots] = useState([]);
  const [slotsState, setSlotsState] = useState("loading");
  const [slotsError, setSlotsError] = useState("");
  const [time, setTime] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", grade: "", comment: "" });
  const [formError, setFormError] = useState("");
  const [bookingBusy, setBookingBusy] = useState(false);
  const [success, setSuccess] = useState(null);
  const [reschedule, setReschedule] = useState(null);
  const [myPhone, setMyPhone] = useState(() => {
    try { return localStorage.getItem("myPhone") || ""; } catch (_error) { return ""; }
  });
  const [myState, setMyState] = useState("idle");
  const [myError, setMyError] = useState("");
  const [myBookings, setMyBookings] = useState([]);
  const [lookupHours, setLookupHours] = useState(DEFAULT_CONFIG.rescheduleHours);
  const [telegramUser, setTelegramUser] = useState(null);
  const bookingRef = useRef(null);
  const slotRequest = useRef(0);
  const submittedRef = useRef(null);
  const autoLookup = useRef(false);

  const setTutorTheme = useCallback((next) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("glass-theme", next); localStorage.setItem("theme", next); } catch (_error) { /* optional storage */ }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("glass-theme", theme); localStorage.setItem("theme", theme); } catch (_error) { /* optional storage */ }
  }, [theme]);

  useEffect(() => {
    let active = true;
    const registered = [];
    const applyInsets = (tg) => {
      try {
        const safe = tg.contentSafeAreaInset || {};
        const base = tg.safeAreaInset || {};
        const top = Math.max(Number(safe.top) || 0, Number(base.top) || 0, 10);
        document.documentElement.style.setProperty("--tg-top-inset", `${top}px`);
      } catch (_error) { /* standalone browser */ }
    };
    const connect = () => {
      if (!active) return;
      const tg = telegramBridge();
      if (!tg) return;
      setBridge(tg);
      try {
        tg.ready?.();
        tg.expand?.();
        applyInsets(tg);
        const events = ["safeAreaChanged", "contentSafeAreaChanged", "viewportChanged", "fullscreenChanged"];
        events.forEach((event) => {
          const listener = () => applyInsets(tg);
          tg.onEvent?.(event, listener);
          registered.push([event, listener]);
        });
        const user = tg.initDataUnsafe?.user || null;
        setTelegramUser(user);
      } catch (_error) { /* a partial WebApp API still works */ }
    };
    connect();
    if (!telegramBridge()) {
      const existing = document.querySelector('script[data-tg-webapp-sdk="true"]');
      if (existing) existing.addEventListener("load", connect, { once: true });
      else {
        const script = document.createElement("script");
        script.src = "https://telegram.org/js/telegram-web-app.js";
        script.async = true;
        script.dataset.tgWebappSdk = "true";
        script.addEventListener("load", connect, { once: true });
        document.head.appendChild(script);
      }
    }
    return () => {
      active = false;
      const tg = telegramBridge();
      registered.forEach(([event, listener]) => { try { tg?.offEvent?.(event, listener); } catch (_error) {} });
    };
  }, []);

  useEffect(() => {
    if (!bridge) return;
    const applyHostTheme = () => setTutorTheme(bridge.colorScheme === "light" ? "light" : "dark");
    applyHostTheme();
    try { bridge.onEvent?.("themeChanged", applyHostTheme); } catch (_error) {}
    return () => { try { bridge.offEvent?.("themeChanged", applyHostTheme); } catch (_error) {} };
  }, [bridge, setTutorTheme]);

  useEffect(() => {
    let active = true;
    api("/api/config").then((data) => {
      if (!active) return;
      const next = normaliseConfig(data);
      setConfig(next);
      document.title = `${next.tutorName} — запись в Telegram`;
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setSubject((current) => config.subjects.includes(current) ? current : config.subjects[0] || "");
  }, [config.subjects]);

  useEffect(() => {
    setDate((current) => dates.includes(current) ? current : dates[0]);
  }, [dates]);

  useEffect(() => {
    if (!telegramUser) return;
    setForm((current) => ({
      ...current,
      name: current.name || [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(" "),
    }));
  }, [telegramUser]);

  // A learner who has already used "My lessons" should not need to type the
  // same saved contact again when making another booking.
  useEffect(() => {
    if (!validPhone(myPhone)) return;
    setForm((current) => current.phone ? current : { ...current, phone: myPhone });
  }, [myPhone]);

  const loadSlots = useCallback(async () => {
    if (!date) return;
    const requestId = ++slotRequest.current;
    setSlotsState("loading");
    setSlotsError("");
    try {
      const data = await api(`/api/slots?date=${encodeURIComponent(date)}&subject=${encodeURIComponent(subject || "")}`);
      if (requestId !== slotRequest.current) return;
      setSlots(Array.isArray(data.slots) ? data.slots.slice().sort((a, b) => a.time.localeCompare(b.time)) : []);
      setSlotsState("ready");
    } catch (error) {
      if (requestId !== slotRequest.current) return;
      setSlots([]);
      setSlotsState("error");
      setSlotsError(error.message);
    }
  }, [date, subject]);

  useEffect(() => { loadSlots(); }, [loadSlots]);

  const findBookings = useCallback(async (phone = myPhone) => {
    const value = String(phone || "").trim();
    if (!validPhone(value)) { setMyError("Введите номер телефона из заявки."); setMyBookings([]); return; }
    setMyState("loading"); setMyError("");
    try {
      const data = await api(`/api/my?phone=${encodeURIComponent(value)}`);
      setMyBookings(Array.isArray(data.bookings) ? data.bookings : []);
      setLookupHours(Number(data.rescheduleHours) || config.rescheduleHours);
      setMyState("ready");
      try { localStorage.setItem("myPhone", value); } catch (_error) {}
    } catch (error) { setMyState("error"); setMyError(error.message); setMyBookings([]); }
  }, [myPhone, config.rescheduleHours]);

  useEffect(() => {
    if (autoLookup.current || !validPhone(myPhone)) return;
    autoLookup.current = true;
    findBookings(myPhone);
  }, [myPhone, findBookings]);

  const enterReschedule = (booking) => {
    setSuccess(null);
    setReschedule({ id: booking.id, phone: myPhone, subject: booking.subject || subject, date: booking.iso || booking.date || "", time: booking.time || "" });
    if (booking.subject && config.subjects.includes(booking.subject)) setSubject(booking.subject);
    setTime("");
    setFormError("");
    selectionHaptic(bridge);
    window.setTimeout(() => bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };

  const exitReschedule = () => {
    setReschedule(null);
    setTime("");
    setFormError("");
  };

  const startAgain = () => {
    setSuccess(null);
    setTime("");
    setFormError("");
    setReschedule(null);
    window.setTimeout(() => bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };

  const submit = useCallback(async () => {
    if (bookingBusy) return;
    setFormError("");
    if (!subject) { setFormError("Выберите предмет."); haptic(bridge, "error"); return; }
    if (!time) { setFormError(reschedule ? "Выберите новое время." : "Выберите удобное время."); haptic(bridge, "error"); return; }
    if (!reschedule && form.name.trim().length < 2) { setFormError("Укажите фамилию и имя."); haptic(bridge, "error"); return; }
    if (!reschedule && form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) { setFormError("Проверьте email."); haptic(bridge, "error"); return; }
    if (!reschedule && !validPhone(form.phone)) { setFormError("Проверьте номер телефона."); haptic(bridge, "error"); return; }
    setBookingBusy(true);
    try {
      if (reschedule) {
        await api("/api/reschedule", { method: "POST", body: JSON.stringify({ id: reschedule.id, phone: reschedule.phone, date, time }) });
        const done = { kind: "reschedule", subject: reschedule.subject || subject, date, time, phone: reschedule.phone };
        setSuccess(done);
        setMyPhone(reschedule.phone);
        await findBookings(reschedule.phone);
        haptic(bridge, "success");
        try { bridge?.MainButton?.hide?.(); bridge?.showAlert?.("Занятие перенесено!"); } catch (_error) {}
        setReschedule(null);
      } else {
        const user = bridge?.initDataUnsafe?.user;
        const contact = user ? `tg:${user.username ? `@${user.username}` : `id${user.id}`}` : "";
        const chatId = user?.id ? String(user.id) : "";
        await api("/api/book", { method: "POST", body: JSON.stringify({ date, time, subject, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), grade: form.grade, comment: form.comment.trim(), contact, chatId, source: "telegram" }) });
        const done = { kind: "booking", subject, date, time, phone: form.phone.trim() };
        setSuccess(done);
        setMyPhone(form.phone.trim());
        try { localStorage.setItem("myPhone", form.phone.trim()); } catch (_error) {}
        await findBookings(form.phone.trim());
        haptic(bridge, "success");
        try { bridge?.MainButton?.hide?.(); bridge?.showAlert?.("Вы записаны!"); } catch (_error) {}
      }
    } catch (error) {
      setFormError(error.message);
      haptic(bridge, "error");
      loadSlots();
    } finally { setBookingBusy(false); }
  }, [bookingBusy, subject, time, reschedule, form, bridge, date, findBookings, loadSlots]);

  useEffect(() => { submittedRef.current = submit; }, [submit]);

  useEffect(() => {
    if (!bridge?.MainButton) return undefined;
    const onMainButton = () => submittedRef.current?.();
    try { bridge.MainButton.onClick?.(onMainButton); } catch (_error) {}
    return () => { try { bridge.MainButton.offClick?.(onMainButton); } catch (_error) {} };
  }, [bridge]);

  useEffect(() => {
    const button = bridge?.MainButton;
    if (!button) return;
    try {
      if (!success && subject && time) {
        button.setText?.(reschedule ? "Перенести занятие" : "Записаться на занятие");
        if (bookingBusy) button.showProgress?.(); else { button.hideProgress?.(); button.enable?.(); }
        button.show?.();
      } else {
        button.hideProgress?.();
        button.hide?.();
      }
    } catch (_error) { /* standalone browser */ }
  }, [bridge, subject, time, reschedule, success, bookingBusy]);

  useEffect(() => {
    if (!bridge) return undefined;
    const dirty = !success && Boolean(time || form.name.trim() || form.email.trim() || form.phone.trim() || form.comment.trim());
    try { if (dirty) bridge.enableClosingConfirmation?.(); else bridge.disableClosingConfirmation?.(); } catch (_error) {}
    return () => { try { bridge.disableClosingConfirmation?.(); } catch (_error) {} };
  }, [bridge, form, time, success]);

  const selectedSubject = reschedule?.subject || subject;
  const summary = selectedSubject && date && time ? `${selectedSubject} · ${formatLongDate(date)} в ${time} (${config.tzLabel})` : "Выберите предмет и удобное время";

  return <main className="tgapp-shell">
    <div className="tgapp-aurora" aria-hidden="true"><span /><span /></div>
    <header className="tgapp-topbar"><a href="/" className="brand-lockup"><BrandMark /><span>{config.tutorName}</span></a><div><span className="tgapp-host-badge"><Send size={13} />{bridge ? "Telegram WebApp" : "Онлайн-запись"}</span><button className="icon-button" type="button" aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"} onClick={() => setTutorTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button></div></header>
    <div className="tgapp-container">
      <section className="tgapp-hero glass"><div><span className="eyebrow"><Send size={13} /> Запись прямо в Telegram</span><h1>Время для <i>понятного урока.</i></h1><p>Выберите предмет и свободное окно — напоминание придёт в этот чат.</p></div><div className="tgapp-hero-orbit" aria-hidden="true"><span>{subjectMark(subject)}</span><i /><i /></div></section>
      <section className="tgapp-booking" ref={bookingRef} id="booking">
        {reschedule && <div className="tgapp-reschedule glass"><span><RotateCcw size={18} /></span><div><b>Перенос занятия</b><p>{reschedule.subject} · {displayBookingDate({ iso: reschedule.date })} в {reschedule.time} → выберите новое время</p></div><button type="button" onClick={exitReschedule}>Отменить перенос</button></div>}
        {!success && <><header className="tgapp-section-head"><span className="eyebrow">Запись на занятие</span><h2>{reschedule ? "Выберите новое" : "Соберите удобное"} <i>время.</i></h2><p>Все времена указаны по {config.tzLabel}.</p></header>
          <div className="tgapp-step-stack"><section className="tgapp-step glass"><div className="tgapp-step-title"><span>01</span><div><b>Предмет</b><small>С чего начнём?</small></div></div><div className="tgapp-subjects">{config.subjects.map((item) => <button type="button" key={item} className={subject === item ? "active" : ""} onClick={() => { setSubject(item); setTime(""); selectionHaptic(bridge); }}><em>{subjectMark(item)}</em>{item}<Check size={14} /></button>)}</div></section>
            <section className="tgapp-step glass"><div className="tgapp-step-title"><span>02</span><div><b>Дата</b><small>Ближайшие 45 дней</small></div></div><div className="tgapp-date-strip" aria-label="Выберите дату">{dates.map((item, index) => { const parts = dateParts(item, index); return <button type="button" key={item} className={date === item ? "active" : ""} onClick={() => { setDate(item); setTime(""); selectionHaptic(bridge); }}><small>{parts.weekDay}</small><b>{parts.day}</b><span>{parts.month}</span></button>; })}</div></section>
            <section className="tgapp-step glass"><div className="tgapp-step-title"><span>03</span><div><b>Время</b><small>{formatLongDate(date)} · {config.tzLabel}</small></div><button className="tgapp-refresh" type="button" onClick={loadSlots} aria-label="Обновить свободное время"><RefreshCw size={15} /></button></div>{slotsState === "loading" && <div className="tgapp-slot-loading" role="status"><span><LoaderCircle size={19} /></span><div><b>Ищем свободные окна</b><small>Проверяем актуальную доступность</small></div></div>}{slotsState === "error" && <div className="tgapp-slot-error"><CircleAlert size={17} /><span>{slotsError}</span><button type="button" onClick={loadSlots}>Повторить</button></div>}{slotsState === "ready" && !slots.length && <div className="tgapp-slot-empty"><CalendarDays size={21} /><b>На этот день окон нет</b><span>Попробуйте соседнюю дату — расписание часто меняется.</span></div>}{slotsState === "ready" && slots.length > 0 && <div className="tgapp-slot-grid">{slots.map((slot) => <button type="button" key={slot.time} className={`${time === slot.time ? "selected" : ""} ${freeSlot(slot) ? "" : "unavailable"}`} disabled={!freeSlot(slot)} onClick={() => { setTime(slot.time); setFormError(""); selectionHaptic(bridge); }}><b>{slot.time}</b>{(slot.duration || config.lessonDuration) && <small>{slot.duration || config.lessonDuration} мин</small>}{!freeSlot(slot) && <em>{unavailableLabel(slot.status)}</em>}</button>)}</div>}</section>
            <section className="tgapp-step tgapp-summary-step glass"><div className="tgapp-step-title"><span>04</span><div><b>{reschedule ? "Подтверждение переноса" : "Ваши данные"}</b><small>{reschedule ? "Осталось подтвердить новое время" : "Для подтверждения записи"}</small></div></div>{!reschedule && <div className="tgapp-form-grid"><label><span>Фамилия и имя <i>*</i></span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Иванов Иван" autoComplete="name" maxLength="80" /></label><label><span>Email <small>необязательно</small></span><input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="name@example.com" autoComplete="email" maxLength="120" /></label><label><span>Телефон <i>*</i></span><input type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+7 999 123-45-67" autoComplete="tel" inputMode="tel" /></label><label><span>Класс <small>необязательно</small></span><select value={form.grade} onChange={(event) => setForm((current) => ({ ...current, grade: event.target.value }))}><option value="">Не указывать</option>{config.grades.map((grade) => <option key={grade}>{grade}</option>)}</select></label><label className="wide"><span>Комментарий <small>необязательно</small></span><input value={form.comment} onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))} placeholder="Темы, цель, пожелания…" maxLength="200" /></label></div>}<div className={`tgapp-summary ${subject && time ? "ready" : ""}`}><span>{reschedule ? <RotateCcw size={16} /> : <CheckCircle2 size={16} />}</span><div><small>{reschedule ? "Новое время" : "Выбранное занятие"}</small><b>{summary}</b></div></div>{formError && <div className="tgapp-form-error"><CircleAlert size={16} />{formError}</div>}<button className="button button-primary tgapp-submit" type="button" onClick={submit} disabled={bookingBusy}>{bookingBusy ? <LoaderCircle className="spin" size={17} /> : reschedule ? <RotateCcw size={17} /> : <ArrowRight size={17} />}{bookingBusy ? (reschedule ? "Переносим…" : "Записываем…") : (reschedule ? "Перенести на выбранное время" : "Записаться на занятие")}</button><p className="tgapp-security"><Check size={13} />{bridge ? "Telegram передаст напоминание прямо в этот чат." : "Данные нужны только для подтверждения записи."}</p></section></div></>}
        {success && <section className="tgapp-success glass"><span className="tgapp-success-orb"><CheckCircle2 size={31} /></span><span className="eyebrow">Готово</span><h2>{success.kind === "reschedule" ? "Занятие перенесено!" : "Вы записаны!"}</h2><p>{success.subject}, {formatLongDate(success.date)} в <b>{success.time}</b> ({config.tzLabel}).</p><div><a className="button button-quiet" href="#my-bookings"><CalendarDays size={16} />Мои записи</a><button className="button button-primary" type="button" onClick={startAgain}><Zap size={16} />Записать ещё</button></div></section>}
      </section>
      <section className="tgapp-my-section" id="my-bookings"><header className="tgapp-section-head"><span className="eyebrow">Управление записью</span><h2>Мои <i>занятия.</i></h2><p>Введите номер из заявки, чтобы увидеть будущие уроки и перенести подходящие.</p></header><div className="tgapp-lookup glass"><div className="tgapp-lookup-row"><label><Phone size={17} /><input type="tel" value={myPhone} onChange={(event) => { setMyPhone(event.target.value); setMyError(""); }} onKeyDown={(event) => { if (event.key === "Enter") findBookings(); }} placeholder="+7 999 123-45-67" inputMode="tel" /></label><button className="button button-primary" type="button" onClick={() => findBookings()} disabled={myState === "loading"}>{myState === "loading" ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}Найти</button></div>{myError && <div className="tgapp-form-error"><CircleAlert size={16} />{myError}</div>}{myState === "loading" && <div className="tgapp-my-loading"><LoaderCircle className="spin" size={17} />Ищем будущие занятия…</div>}{myState === "ready" && !myBookings.length && <div className="tgapp-my-empty">Будущих записей по этому номеру нет.</div>}{myState === "ready" && myBookings.length > 0 && <div className="tgapp-my-list">{myBookings.map((booking) => <article key={booking.id}><span><CalendarDays size={16} /></span><div><small>{booking.subject || "Занятие"}</small><b>{displayBookingDate(booking)} в {booking.time}</b><p>{booking.canReschedule ? `Перенос доступен не позже чем за ${lookupHours} ч.` : `До занятия меньше ${lookupHours} ч — перенос только через преподавателя.`}</p></div><button className="button button-quiet" type="button" disabled={!booking.canReschedule} onClick={() => enterReschedule(booking)}><RotateCcw size={15} />Перенести</button></article>)}</div>}{config.tutorTg && <p className="tgapp-lookup-foot">Отменить занятие может преподаватель. <a href={`https://t.me/${config.tutorTg.replace(/^@/, "")}`} target="_blank" rel="noreferrer">Написать в Telegram <ExternalLink size={12} /></a></p>}</div></section>
      <footer className="tgapp-footer"><span><BrandMark />{config.tutorName}</span><span><GraduationCap size={14} />Индивидуальные онлайн-занятия</span><a href="/">Открыть сайт <ChevronRight size={14} /></a></footer>
    </div>
  </main>;
}

export default TelegramApp;
