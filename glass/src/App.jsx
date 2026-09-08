import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  GraduationCap,
  Layers3,
  LoaderCircle,
  Menu,
  MessageCircle,
  Moon,
  Phone,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
  Zap,
} from "lucide-react";

const FALLBACK_CONFIG = {
  tutorName: "Онлайн-уроки",
  siteTitle: "Онлайн-уроки — запись на занятия",
  heroTitle: "Онлайн-занятия, после которых становится понятно",
  heroLead: "Математика и физика — без пробелов.\nИндивидуальные занятия в спокойном темпе, с понятным планом и поддержкой между уроками.",
  subjects: ["Математика", "Физика"],
  grades: ["4 класс", "5 класс", "6 класс", "7 класс", "8 класс", "9 класс (ОГЭ)"],
  tutorTg: "",
  tzLabel: "МСК+2",
  tzOffsetMin: 300,
  lessonDuration: 50,
  rescheduleHours: 12,
  contactsText: "Вопросы — в Telegram, отвечаю в течение дня",
  bookingNote: "Телефон и e-mail нужны только для связи и подтверждения записи.",
  cabinetEnabled: true,
  botUsername: "",
};

const SUBJECT_MARKS = {
  математика: "∑",
  физика: "⚛",
  информатика: "⌘",
  химия: "◈",
  английский: "Aa",
};

const SLOT_STATUS = {
  booked: "занято",
  busy: "занято",
  closed: "закрыто",
  past: "прошло",
};

function getRuntimeConfig() {
  if (typeof window === "undefined") return {};
  return window.__GLASS_CONFIG__ || {};
}

function normaliseConfig(data = {}) {
  return {
    ...FALLBACK_CONFIG,
    ...data,
    subjects: Array.isArray(data.subjects) && data.subjects.length ? data.subjects : FALLBACK_CONFIG.subjects,
    grades: Array.isArray(data.grades) && data.grades.length ? data.grades : FALLBACK_CONFIG.grades,
    tzOffsetMin: Number.isFinite(Number(data.tzOffsetMin)) ? Number(data.tzOffsetMin) : FALLBACK_CONFIG.tzOffsetMin,
    lessonDuration: Number.isFinite(Number(data.lessonDuration)) ? Number(data.lessonDuration) : FALLBACK_CONFIG.lessonDuration,
    rescheduleHours: Number.isFinite(Number(data.rescheduleHours)) ? Number(data.rescheduleHours) : FALLBACK_CONFIG.rescheduleHours,
    cabinetEnabled: data.cabinetEnabled !== false && String(data.cabinetEnabled) !== "0",
  };
}

async function request(path, options = {}) {
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
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Нет связи с сервисом записи. Попробуйте ещё раз.");
  }

  let data = null;
  try {
    data = await response.json();
  } catch (_error) {
    // A useful status message is still better than a JSON parsing exception.
  }

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || "Не удалось выполнить запрос. Попробуйте ещё раз.");
  }
  return data || {};
}

function dateFromTutorClock(offsetMinutes) {
  return new Date(Date.now() + Number(offsetMinutes || 0) * 60_000).toISOString().slice(0, 10);
}

function addDays(iso, amount) {
  const value = new Date(`${iso}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function buildDates(offsetMinutes, count = 45) {
  const today = dateFromTutorClock(offsetMinutes);
  return Array.from({ length: count }, (_, index) => addDays(today, index));
}

function asDate(iso) {
  return new Date(`${iso}T12:00:00Z`);
}

function formatLongDate(iso) {
  if (!iso) return "";
  return asDate(iso).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function formatShortDate(iso) {
  if (!iso) return "";
  return asDate(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).replace(".", "");
}

function displayDate(booking) {
  if (booking?.dsp) return booking.dsp;
  if (booking?.iso && /^\d{4}-\d{2}-\d{2}$/.test(booking.iso)) return formatShortDate(booking.iso);
  if (booking?.date && /^\d{4}-\d{2}-\d{2}$/.test(booking.date)) return formatShortDate(booking.date);
  return booking?.date || "";
}

function bookingIso(booking) {
  const value = booking?.iso || booking?.date || "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function dateParts(iso, index) {
  const date = asDate(iso);
  const weekday = date.toLocaleDateString("ru-RU", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  const month = date.toLocaleDateString("ru-RU", { month: "short", timeZone: "UTC" }).replace(".", "");
  return {
    label: index === 0 ? "сегодня" : index === 1 ? "завтра" : weekday,
    day: date.getUTCDate(),
    month,
  };
}

function compactLead(lead) {
  return String(lead || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

function subjectMark(subject) {
  const lower = String(subject || "").toLowerCase();
  const matched = Object.keys(SUBJECT_MARKS).find((key) => lower.includes(key));
  return matched ? SUBJECT_MARKS[matched] : "✦";
}

function isFree(slot) {
  return slot?.status === "open" || slot?.status === "free";
}

function legacyHref(path) {
  const runtime = getRuntimeConfig();
  const base = String(runtime.legacySiteUrl || "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

function storedPhone() {
  try { return localStorage.getItem("myPhone") || ""; } catch (_error) { return ""; }
}

function IconButton({ label, children, className = "", ...props }) {
  return <button className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>{children}</button>;
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><Sparkles size={17} strokeWidth={2.4} /></span>;
}

function SectionKicker({ children }) {
  return <div className="section-kicker"><span></span>{children}</div>;
}

function ErrorLine({ children }) {
  if (!children) return null;
  return <p className="error-line" role="alert"><CircleAlert size={16} />{children}</p>;
}

function App() {
  const [config, setConfig] = useState(FALLBACK_CONFIG);
  const [configReady, setConfigReady] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("glass-theme") || "dark"; } catch (_error) { return "dark"; }
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const dates = useMemo(() => buildDates(config.tzOffsetMin), [config.tzOffsetMin]);
  const [subject, setSubject] = useState(FALLBACK_CONFIG.subjects[0]);
  const [date, setDate] = useState(() => buildDates(FALLBACK_CONFIG.tzOffsetMin)[0]);
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState([]);
  const [slotsState, setSlotsState] = useState("loading");
  const [slotsError, setSlotsError] = useState("");
  const [form, setForm] = useState(() => ({ name: "", email: "", phone: storedPhone(), grade: "", comment: "" }));
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);
  const [reschedule, setReschedule] = useState(null);
  const [confirmReschedule, setConfirmReschedule] = useState(false);
  const [lookupPhone, setLookupPhone] = useState(storedPhone);
  const [lookupState, setLookupState] = useState("idle");
  const [lookupError, setLookupError] = useState("");
  const [myBookings, setMyBookings] = useState([]);
  const [lookupHours, setLookupHours] = useState(FALLBACK_CONFIG.rescheduleHours);
  const bookingRef = useRef(null);
  const slotRequestId = useRef(0);
  const autoLookupDone = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#071326" : "#e8f0ff");
    try { localStorage.setItem("glass-theme", theme); } catch (_error) { /* storage is optional */ }
  }, [theme]);

  useEffect(() => {
    let active = true;
    request("/api/config")
      .then((data) => {
        if (!active) return;
        const next = normaliseConfig(data);
        setConfig(next);
        setSubject((current) => next.subjects.includes(current) ? current : next.subjects[0]);
        document.title = next.siteTitle || FALLBACK_CONFIG.siteTitle;
      })
      .catch(() => {
        // The fallback makes the first paint useful even while the original
        // Render service is waking up. Booking remains disabled until config loads.
      })
      .finally(() => { if (active) setConfigReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!dates.includes(date)) setDate(dates[0]);
  }, [date, dates]);

  const loadSlots = useCallback(async () => {
    if (!configReady || !date) return;
    const requestId = ++slotRequestId.current;
    setSlotsState("loading");
    setSlotsError("");
    try {
      const data = await request(`/api/slots?date=${encodeURIComponent(date)}&subject=${encodeURIComponent(subject || "")}`);
      if (requestId !== slotRequestId.current) return;
      const nextSlots = Array.isArray(data.slots) ? [...data.slots].sort((a, b) => String(a.time).localeCompare(String(b.time))) : [];
      setSlots(nextSlots);
      setTime((chosen) => nextSlots.some((slot) => slot.time === chosen && isFree(slot)) ? chosen : "");
      setSlotsState("ready");
    } catch (error) {
      if (requestId !== slotRequestId.current) return;
      setSlots([]);
      setSlotsError(error.message || "Не удалось загрузить время.");
      setSlotsState("error");
    }
  }, [configReady, date, subject]);

  useEffect(() => { loadSlots(); }, [loadSlots]);

  // Keep the useful legacy behaviour: a saved phone is looked up automatically
  // only when the visitor opens the "my bookings" anchor directly.
  useEffect(() => {
    if (autoLookupDone.current || !configReady || !lookupPhone || typeof window === "undefined") return;
    if (["#my", "#my-bookings"].includes(window.location.hash)) {
      autoLookupDone.current = true;
      findBookings(lookupPhone);
    }
  }, [configReady]); // findBookings is intentionally invoked only once for this entry path.

  const selectedLabel = subject && date && time
    ? `${subject} · ${formatLongDate(date)} в ${time} (${config.tzLabel})`
    : "";

  function scrollToBooking() {
    setMobileNavOpen(false);
    bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function changeSubject(nextSubject) {
    setSubject(nextSubject);
    setTime("");
    setSuccess(null);
    setFormError("");
  }

  function changeDate(nextDate) {
    setDate(nextDate);
    setTime("");
    setSuccess(null);
    setFormError("");
  }

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (formError) setFormError("");
  }

  function selectionError() {
    if (!subject) return "Выберите предмет.";
    if (!time) return "Выберите свободное время.";
    return "";
  }

  async function submitBooking(event) {
    event?.preventDefault();
    const selectionIssue = selectionError();
    if (selectionIssue) { setFormError(selectionIssue); return; }
    if (form.name.trim().length < 2) { setFormError("Укажите фамилию и имя."); return; }
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) { setFormError("Проверьте адрес e-mail."); return; }
    if (form.phone.replace(/\D/g, "").length < 10) { setFormError("Проверьте номер телефона."); return; }

    setSubmitting(true);
    setFormError("");
    try {
      await request("/api/book", {
        method: "POST",
        body: JSON.stringify({
          date,
          time,
          subject,
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          grade: form.grade,
          comment: form.comment.trim(),
          contact: "",
          chatId: "",
          source: "site",
        }),
      });
      try { localStorage.setItem("myPhone", form.phone.trim()); } catch (_error) { /* storage is optional */ }
      setLookupPhone(form.phone.trim());
      setSuccess({ kind: "book", subject, date, time, phone: form.phone.trim() });
      await loadSlots();
    } catch (error) {
      setFormError(error.message || "Не удалось записаться. Попробуйте ещё раз.");
      await loadSlots();
    } finally {
      setSubmitting(false);
    }
  }

  function validateReschedule() {
    const issue = selectionError();
    if (issue) { setFormError(issue); return false; }
    if (!reschedule) return false;
    if (reschedule.booking.iso === date && reschedule.booking.time === time) {
      setFormError("Выберите другое время для переноса.");
      return false;
    }
    setFormError("");
    setConfirmReschedule(true);
    return true;
  }

  async function submitReschedule() {
    if (!reschedule) return;
    setConfirmReschedule(false);
    setSubmitting(true);
    setFormError("");
    try {
      await request("/api/reschedule", {
        method: "POST",
        body: JSON.stringify({ id: reschedule.booking.id, phone: reschedule.phone, date, time }),
      });
      setSuccess({ kind: "reschedule", subject, date, time, phone: reschedule.phone });
      setReschedule(null);
      setLookupPhone(reschedule.phone);
      try { localStorage.setItem("myPhone", reschedule.phone); } catch (_error) { /* storage is optional */ }
      await loadSlots();
      findBookings(reschedule.phone, { quiet: true });
    } catch (error) {
      setFormError(error.message || "Не удалось перенести занятие.");
      await loadSlots();
    } finally {
      setSubmitting(false);
    }
  }

  function resetBooking() {
    setSuccess(null);
    setTime("");
    setFormError("");
    loadSlots();
    setTimeout(scrollToBooking, 0);
  }

  async function findBookings(phone = lookupPhone, options = {}) {
    const trimmed = String(phone || "").trim();
    if (trimmed.replace(/\D/g, "").length < 10) {
      setLookupError("Введите номер телефона из заявки.");
      setLookupState("idle");
      return;
    }
    setLookupPhone(trimmed);
    setLookupError("");
    if (!options.quiet) setLookupState("loading");
    try {
      const data = await request(`/api/my?phone=${encodeURIComponent(trimmed)}`);
      setMyBookings(Array.isArray(data.bookings) ? data.bookings : []);
      setLookupHours(Number(data.rescheduleHours) || config.rescheduleHours);
      setLookupState("ready");
      try { localStorage.setItem("myPhone", trimmed); } catch (_error) { /* storage is optional */ }
    } catch (error) {
      setMyBookings([]);
      setLookupError(error.message || "Не удалось найти записи.");
      setLookupState("error");
    }
  }

  function beginReschedule(booking, phone) {
    const iso = bookingIso(booking);
    const normalised = { ...booking, iso };
    setReschedule({ booking: normalised, phone });
    setSuccess(null);
    setFormError("");
    setTime("");
    if (booking.subject && config.subjects.includes(booking.subject)) setSubject(booking.subject);
    if (iso && dates.includes(iso)) setDate(iso);
    setTimeout(scrollToBooking, 80);
  }

  function stopReschedule() {
    setReschedule(null);
    setConfirmReschedule(false);
    setTime("");
    setFormError("");
  }

  const heroLines = compactLead(config.heroLead);
  const gradesLabel = config.grades.length ? "Школьная программа" : "Индивидуальный план";
  const dateIndex = dates.indexOf(date);

  return (
    <div className="app-shell">
      <div className="aurora aurora-a" aria-hidden="true"></div>
      <div className="aurora aurora-b" aria-hidden="true"></div>
      <div className="aurora aurora-c" aria-hidden="true"></div>
      <div className="grid-glow" aria-hidden="true"></div>

      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="#top" onClick={() => setMobileNavOpen(false)} aria-label={`${config.tutorName}, на главную`}>
            <BrandMark />
            <span>{config.tutorName}</span>
          </a>

          <nav className={`main-nav ${mobileNavOpen ? "is-open" : ""}`} aria-label="Основная навигация">
            <a href="#approach" onClick={() => setMobileNavOpen(false)}>Подход</a>
            <a href="#booking" onClick={() => setMobileNavOpen(false)}>Запись</a>
            <a href="#my-bookings" onClick={() => setMobileNavOpen(false)}>Мои занятия</a>
            <a href="#contact" onClick={() => setMobileNavOpen(false)}>Контакты</a>
          </nav>

          <div className="header-actions">
            {config.cabinetEnabled && <a className="header-cabinet" href={legacyHref("/cabinet.html")}>Кабинет <ArrowUpRight size={14} /></a>}
            <IconButton label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"} onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </IconButton>
            <IconButton label={mobileNavOpen ? "Закрыть меню" : "Открыть меню"} className="mobile-menu" onClick={() => setMobileNavOpen((current) => !current)}>
              {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
            </IconButton>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero section-pad">
          <div className="container hero-grid">
            <div className="hero-copy">
              <div className="hero-pill"><Sparkles size={15} /> Индивидуальные онлайн-занятия</div>
              <h1>{config.heroTitle}</h1>
              <div className="hero-lead">
                {heroLines.map((line, index) => <p key={`${line}-${index}`} className={index === 0 ? "lead-strong" : ""}>{line}</p>)}
              </div>
              <div className="hero-actions">
                <button className="button button-primary button-large" onClick={scrollToBooking}>Выбрать время <ArrowRight size={18} /></button>
                {config.tutorTg && <a className="button button-quiet button-large" href={`https://t.me/${config.tutorTg.replace(/^@/, "")}`} target="_blank" rel="noreferrer">Написать в Telegram <MessageCircle size={18} /></a>}
              </div>
              <div className="hero-facts" aria-label="Ключевые условия занятий">
                <div><Clock3 size={16} /><span><b>{config.lessonDuration} мин</b> урок</span></div>
                <div><GraduationCap size={16} /><span><b>{gradesLabel}</b></span></div>
                <div><Layers3 size={16} /><span>Время: <b>{config.tzLabel}</b></span></div>
              </div>
            </div>

            <div className="hero-art" aria-label="Запись на урок в четыре простых шага">
              <div className="hero-ring ring-one"></div>
              <div className="hero-ring ring-two"></div>
              <div className="glass hero-schedule-card">
                <div className="hero-card-top">
                  <span className="mini-orb"><CalendarDays size={18} /></span>
                  <div><span className="eyebrow-text">Запись без звонков</span><b>Всё в одном месте</b></div>
                  <span className="status-dot"><i></i> online</span>
                </div>
                <div className="hero-progress"><span></span><span></span><span></span><span></span></div>
                <div className="hero-path">
                  <div><span className="path-index">01</span><span>Выберите предмет</span><Check size={15} /></div>
                  <div><span className="path-index">02</span><span>Найдите удобное окно</span><Check size={15} /></div>
                  <div><span className="path-index">03</span><span>Оставьте контакты</span><Check size={15} /></div>
                </div>
                <div className="hero-card-footer"><Sparkles size={15} /> Подтверждение и напоминание придут автоматически</div>
              </div>
              <div className="glass floating-note note-top"><span className="note-icon mint"><Zap size={16} /></span><div><b>1 минута</b><small>на запись</small></div></div>
              <div className="glass floating-note note-bottom"><span className="note-icon violet"><ShieldCheck size={16} /></span><div><b>Всё под контролем</b><small>перенос в личном кабинете</small></div></div>
            </div>
          </div>
        </section>

        <section id="approach" className="approach-section section-pad">
          <div className="container">
            <div className="section-heading split-heading">
              <div><SectionKicker>Как устроены занятия</SectionKicker><h2>Меньше тревоги.<br /><em>Больше ясности.</em></h2></div>
              <p>Всё, что нужно ученику и родителю: понятный ритм, удобная самостоятельная запись и связь с преподавателем.</p>
            </div>
            <div className="benefit-grid">
              <article className="glass benefit-card benefit-violet"><div className="benefit-icon"><BookOpen size={22} /></div><span className="card-number">01</span><h3>Разбираем по смыслу</h3><p>Не заучиваем шаблоны: идём от вопроса к пониманию темы и уверенности в решении.</p></article>
              <article className="glass benefit-card benefit-blue"><div className="benefit-icon"><CalendarDays size={22} /></div><span className="card-number">02</span><h3>Гибкое расписание</h3><p>Свободные окна видны сразу. Запись и перенос занимают пару нажатий.</p></article>
              <article className="glass benefit-card benefit-mint"><div className="benefit-icon"><MessageCircle size={22} /></div><span className="card-number">03</span><h3>На связи между уроками</h3><p>Напоминания, материалы и сообщения не теряются — всё приходит в удобный канал.</p></article>
            </div>
          </div>
        </section>

        <section id="booking" ref={bookingRef} className="booking-section section-pad">
          <div className="container">
            <div className="section-heading booking-heading">
              <SectionKicker>Онлайн-запись</SectionKicker>
              <h2>Выберите окно<br /><em>для занятия</em></h2>
              <p>Слоты обновляются в реальном времени. После записи преподаватель получит вашу заявку сразу.</p>
            </div>

            {reschedule && <div className="reschedule-banner glass" role="status">
              <div className="reschedule-banner-icon"><RotateCcw size={19} /></div>
              <div><b>Перенос занятия</b><p>{reschedule.booking.subject} · {displayDate(reschedule.booking)} в {reschedule.booking.time}. Выберите новое время ниже.</p></div>
              <button className="text-button" onClick={stopReschedule}>Отменить <X size={15} /></button>
            </div>}

            <div className="booking-layout">
              <div className="glass booking-studio">
                <div className="studio-topline"><span><i></i> Свободные окна</span><span className="timezone"><Clock3 size={14} /> {config.tzLabel}</span></div>

                <div className="booking-step">
                  <div className="step-title"><span>01</span><div><b>Предмет</b><small>С чего начнём?</small></div></div>
                  <div className="subject-switch" role="group" aria-label="Выберите предмет">
                    {config.subjects.map((item) => <button key={item} className={`subject-button ${subject === item ? "selected" : ""}`} onClick={() => changeSubject(item)} aria-pressed={subject === item}><span className="subject-symbol">{subjectMark(item)}</span>{item}<ChevronRight size={16} /></button>)}
                  </div>
                </div>

                <div className="booking-step">
                  <div className="step-title"><span>02</span><div><b>Дата</b><small>Выберите удобный день</small></div></div>
                  <div className="date-scroller" aria-label="Даты для записи">
                    {dates.map((item, index) => {
                      const parts = dateParts(item, index);
                      return <button key={item} className={`date-button ${date === item ? "selected" : ""}`} onClick={() => changeDate(item)} aria-pressed={date === item}><small>{parts.label}</small><b>{parts.day}</b><span>{parts.month}</span></button>;
                    })}
                  </div>
                </div>

                <div className="booking-step slots-step">
                  <div className="step-title"><span>03</span><div><b>Время</b><small>{date ? `${formatLongDate(date)} · ${config.tzLabel}` : "Выберите дату"}</small></div>{slotsState === "loading" && <LoaderCircle className="mini-loader" size={17} />}</div>
                  {slotsState === "loading" && <div className="slot-grid slot-skeleton" aria-label="Загружаем свободное время">{Array.from({ length: 6 }, (_, index) => <span key={index}></span>)}</div>}
                  {slotsState === "error" && <div className="slots-message is-error"><CircleAlert size={18} /><div><b>Время пока не загрузилось</b><p>{slotsError}</p></div><button className="text-button" onClick={loadSlots}>Повторить</button></div>}
                  {slotsState === "ready" && !slots.length && <div className="slots-message"><CalendarDays size={19} /><div><b>На этот день пока нет окон</b><p>Выберите другую дату — расписание постоянно обновляется.</p></div></div>}
                  {slotsState === "ready" && Boolean(slots.length) && <div className="slot-grid">
                    {slots.map((slot) => <button key={`${slot.time}-${slot.status}`} className={`slot-button ${time === slot.time ? "selected" : ""} ${!isFree(slot) ? "unavailable" : ""}`} disabled={!isFree(slot)} onClick={() => { setTime(slot.time); setFormError(""); }} aria-pressed={time === slot.time}><b>{slot.time}</b><small>{isFree(slot) ? "свободно" : (SLOT_STATUS[slot.status] || "недоступно")}</small>{time === slot.time && <Check size={14} />}</button>)}
                  </div>}
                </div>

                {success ? <SuccessPanel success={success} config={config} onAgain={resetBooking} /> : (
                  <form className="details-form" onSubmit={reschedule ? (event) => { event.preventDefault(); validateReschedule(); } : submitBooking}>
                    <div className="step-title form-step-title"><span>04</span><div><b>{reschedule ? "Подтвердите новое время" : "Контакты для подтверждения"}</b><small>{reschedule ? "Проверьте выбор перед переносом" : "Заполним только самое необходимое"}</small></div></div>
                    {reschedule ? <div className="reschedule-choice"><RotateCcw size={18} /><span>{selectedLabel || "Выберите дату и время выше"}</span></div> : <>
                      <div className="form-grid">
                        <label>Фамилия и имя<input name="name" value={form.name} onChange={updateForm} autoComplete="name" placeholder="Иванов Иван" maxLength="80" /></label>
                        <label>Телефон<input name="phone" value={form.phone} onChange={updateForm} type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 999 123-45-67" /></label>
                        <label>E-mail <span>необязательно</span><input name="email" value={form.email} onChange={updateForm} type="email" autoComplete="email" placeholder="name@example.com" maxLength="120" /></label>
                        <label>Класс<select name="grade" value={form.grade} onChange={updateForm}><option value="">Выберите класс</option>{config.grades.map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label>
                      </div>
                      <label className="comment-field">Комментарий <span>необязательно</span><input name="comment" value={form.comment} onChange={updateForm} placeholder="Тема, цель или пожелания…" maxLength="200" /></label>
                    </>}
                    <div className={`selection-summary ${selectedLabel ? "ready" : ""}`}><span>{selectedLabel ? <Check size={17} /> : <CalendarDays size={17} />}</span><div><small>{reschedule ? "Новое время" : "Ваш выбор"}</small><b>{selectedLabel || "Выберите предмет, дату и свободное время"}</b></div></div>
                    <ErrorLine>{formError}</ErrorLine>
                    <button className="button button-primary booking-submit" type="submit" disabled={submitting || !configReady}>{submitting ? <><LoaderCircle className="spin" size={18} /> Обрабатываем…</> : <>{reschedule ? "Перенести занятие" : "Записаться на занятие"}<ArrowRight size={18} /></>}</button>
                    {!reschedule && <p className="privacy-note"><ShieldCheck size={14} /> {config.bookingNote}</p>}
                  </form>
                )}
              </div>

              <aside className="booking-aside">
                <div className="glass aside-card flow-card"><div className="aside-card-head"><span className="aside-icon"><Sparkles size={17} /></span><b>Как это работает</b></div><ol><li><span>1</span>Выбираете время</li><li><span>2</span>Оставляете контакты</li><li><span>3</span>Получаете подтверждение</li></ol><div className="aside-divider"></div><p><Zap size={15} /> Без регистрации и звонков</p></div>
                <div className="glass aside-card"><div className="aside-card-head"><span className="aside-icon blue"><RotateCcw size={17} /></span><b>Нужно перенести?</b></div><p>Откройте «Мои занятия» по номеру телефона. Перенос доступен не позже чем за <strong>{config.rescheduleHours} ч</strong> до урока.</p><a href="#my-bookings" className="aside-link">Найти мою запись <ArrowRight size={15} /></a></div>
                {config.botUsername && <a className="glass bot-card" href={`https://t.me/${config.botUsername.replace(/^@/, "")}`} target="_blank" rel="noreferrer"><span><Send size={18} /></span><div><b>Напоминания в Telegram</b><small>Открыть бота</small></div><ArrowUpRight size={17} /></a>}
              </aside>
            </div>
          </div>
        </section>

        <section id="my-bookings" className="my-section section-pad">
          <div className="container my-layout">
            <div className="my-copy"><SectionKicker>Личный ритм</SectionKicker><h2>Ваши занятия —<br /><em>под рукой</em></h2><p>Введите номер из заявки. Здесь можно проверить ближайшие уроки и перенести подходящую запись.</p><div className="mini-trust"><ShieldCheck size={18} /><span>Номер нужен только для поиска ваших записей.</span></div></div>
            <div className="glass lookup-card">
              <div className="lookup-heading"><div className="lookup-icon"><Phone size={20} /></div><div><h3>Мои занятия</h3><p>Найдём записи по телефону</p></div></div>
              <form className="lookup-form" onSubmit={(event) => { event.preventDefault(); findBookings(); }}>
                <label className="sr-only" htmlFor="lookup-phone">Номер телефона</label>
                <input id="lookup-phone" value={lookupPhone} onChange={(event) => { setLookupPhone(event.target.value); setLookupError(""); }} type="tel" inputMode="tel" placeholder="+7 999 123-45-67" autoComplete="tel" />
                <button className="button button-primary" type="submit" disabled={lookupState === "loading"}>{lookupState === "loading" ? <LoaderCircle className="spin" size={17} /> : "Найти"}</button>
              </form>
              <ErrorLine>{lookupError}</ErrorLine>
              {lookupState === "ready" && !myBookings.length && <div className="lookup-empty"><CalendarDays size={22} /><b>Будущих занятий пока нет</b><p>Выберите удобное окно в записи выше.</p></div>}
              {lookupState === "ready" && Boolean(myBookings.length) && <div className="my-bookings-list">
                {myBookings.map((booking) => <article className="my-booking" key={booking.id}><div className="my-booking-time"><small>{displayDate(booking)}</small><b>{booking.time}</b></div><div className="my-booking-info"><b>{booking.subject || "Занятие"}</b><span>{booking.canReschedule ? "Можно перенести" : `Перенос — не позже чем за ${lookupHours} ч`}</span></div>{booking.canReschedule ? <button className="mini-action" onClick={() => beginReschedule(booking, lookupPhone)}>Перенести <RotateCcw size={14} /></button> : <span className="locked-action"><Clock3 size={15} /></span>}</article>)}
                <p className="lookup-footnote">Отменить занятие может преподаватель. {config.tutorTg && <a href={`https://t.me/${config.tutorTg.replace(/^@/, "")}`} target="_blank" rel="noreferrer">Написать в Telegram</a>}.</p>
              </div>}
            </div>
          </div>
        </section>

        <section id="contact" className="contact-section section-pad">
          <div className="container"><div className="glass contact-card"><div className="contact-planet contact-planet-one" aria-hidden="true"></div><div className="contact-planet contact-planet-two" aria-hidden="true"></div><div className="contact-content"><SectionKicker>Есть вопрос?</SectionKicker><h2>Давайте найдём<br /><em>понятный путь.</em></h2><p>{config.contactsText}</p><div className="contact-actions">{config.tutorTg && <a className="button button-primary button-large" href={`https://t.me/${config.tutorTg.replace(/^@/, "")}`} target="_blank" rel="noreferrer">Связаться в Telegram <MessageCircle size={18} /></a>}<button className="button button-quiet button-large" onClick={scrollToBooking}>Выбрать время <ArrowRight size={18} /></button></div></div><div className="contact-orbit" aria-hidden="true"><div className="orbit-core"><BrandMark /></div><span className="orbit-item orbit-a">∑</span><span className="orbit-item orbit-b">⚛</span><span className="orbit-item orbit-c">✦</span></div></div></div>
        </section>
      </main>

      <footer className="site-footer"><div className="container footer-inner"><a className="brand" href="#top"><BrandMark /><span>{config.tutorName}</span></a><p>© {new Date().getFullYear()} · Индивидуальные онлайн-занятия</p><div className="footer-links">{config.cabinetEnabled && <a href={legacyHref("/cabinet.html")}>Кабинет ученика <ExternalLink size={13} /></a>}<a href={legacyHref("/admin.html")}>Администратору <ExternalLink size={13} /></a></div></div></footer>

      {confirmReschedule && reschedule && <div className="modal-backdrop" role="presentation"><div className="glass confirm-modal" role="dialog" aria-modal="true" aria-labelledby="reschedule-dialog-title"><IconButton label="Закрыть" className="modal-close" onClick={() => setConfirmReschedule(false)}><X size={18} /></IconButton><span className="modal-symbol"><RotateCcw size={21} /></span><h3 id="reschedule-dialog-title">Подтвердить перенос?</h3><p>Старое время освободится, а выбранное окно будет закреплено за вами.</p><div className="transfer-summary"><div><small>Было</small><b>{displayDate(reschedule.booking)} · {reschedule.booking.time}</b></div><ArrowRight size={17} /><div><small>Станет</small><b>{formatShortDate(date)} · {time}</b></div></div><div className="modal-actions"><button className="button button-quiet" onClick={() => setConfirmReschedule(false)}>Вернуться</button><button className="button button-primary" onClick={submitReschedule} disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={17} /> : "Перенести"}<ArrowRight size={17} /></button></div></div></div>}
    </div>
  );
}

function SuccessPanel({ success, config, onAgain }) {
  const isRescheduled = success.kind === "reschedule";
  return <div className="success-panel" aria-live="polite"><div className="success-burst"><Check size={28} /></div><p className="success-overline">{isRescheduled ? "Новое время сохранено" : "Заявка отправлена"}</p><h3>{isRescheduled ? "Занятие перенесено" : "Вы записаны!"}</h3><p className="success-selection">{success.subject} · {formatLongDate(success.date)} в <b>{success.time}</b> <span>({config.tzLabel})</span></p><p className="success-copy">{isRescheduled ? "Мы обновили расписание. Напоминание придёт как обычно." : `Подтверждение придёт на ${success.phone}.`}</p><div className="success-actions"><button className="button button-primary" onClick={onAgain}>Выбрать ещё время <ArrowRight size={17} /></button><a className="button button-quiet" href="#my-bookings">Мои занятия</a></div></div>;
}

export default App;
