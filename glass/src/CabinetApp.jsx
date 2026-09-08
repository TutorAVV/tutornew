import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileText,
  GraduationCap,
  Info,
  LayoutDashboard,
  Link2,
  ListTodo,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Moon,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Sun,
  UserRound,
  X,
} from "lucide-react";

const SESSION_KEY = "cabinetPhone";
const EXPLICIT_LOGOUT_KEY = "cabinetExplicitlyLoggedOut";
const VIEWS = ["home", "schedule", "tests", "messages", "topics"];

const DEFAULT_CONFIG = {
  tutorName: "Онлайн-уроки",
  subjects: ["Математика", "Физика"],
  tzLabel: "МСК+2",
  tzOffsetMin: 300,
  lessonDuration: 50,
  rescheduleHours: 12,
  cabinetEnabled: true,
  botEnabled: false,
  botUsername: "",
  tutorTg: "",
};

const RESCHEDULE_DATE_PAGE_SIZE = 5;

const LESSON_STATUS = {
  new: { label: "Ждёт подтверждения", short: "Ожидается", tone: "pending", Icon: Clock3 },
  confirmed: { label: "Подтверждено", short: "Подтверждено", tone: "confirmed", Icon: CheckCircle2 },
  done: { label: "Проведено", short: "Проведено", tone: "done", Icon: Check },
  cancelled: { label: "Отменено", short: "Отменено", tone: "cancelled", Icon: CircleAlert },
};

const TEST_STATUS = {
  assigned: { label: "Можно начать", tone: "pending" },
  started: { label: "В процессе", tone: "confirmed" },
  finished: { label: "Пройден", tone: "done" },
};

function normalizeConfig(data = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...data,
    subjects: Array.isArray(data.subjects) && data.subjects.length ? data.subjects : DEFAULT_CONFIG.subjects,
    cabinetEnabled: data.cabinetEnabled !== false && String(data.cabinetEnabled) !== "0",
    tzOffsetMin: Number.isFinite(Number(data.tzOffsetMin)) ? Number(data.tzOffsetMin) : DEFAULT_CONFIG.tzOffsetMin,
    lessonDuration: Number.isFinite(Number(data.lessonDuration)) ? Number(data.lessonDuration) : DEFAULT_CONFIG.lessonDuration,
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
    throw new Error("Нет связи с кабинетом. Попробуйте ещё раз.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || "Не удалось загрузить данные. Попробуйте ещё раз.");
  }
  return data || {};
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function validPhone(value) {
  return onlyDigits(value).length >= 10;
}

function formatPhone(value) {
  let digits = onlyDigits(value);
  if (!digits) return "";
  if (digits[0] === "8") digits = `7${digits.slice(1)}`;
  if (digits[0] === "9" && digits.length <= 10) digits = `7${digits}`;
  if (digits[0] === "7") {
    const parts = ["+7"];
    if (digits.length > 1) parts.push(` (${digits.slice(1, 4)}`);
    if (digits.length >= 4) parts[1] += ")";
    if (digits.length > 4) parts.push(` ${digits.slice(4, 7)}`);
    if (digits.length > 7) parts.push(`-${digits.slice(7, 9)}`);
    if (digits.length > 9) parts.push(`-${digits.slice(9, 11)}`);
    return parts.join("");
  }
  return `+${digits.slice(0, 15)}`;
}

function rememberedPhone() {
  try {
    const cabinetSession = localStorage.getItem(SESSION_KEY);
    // `myPhone` is saved by the booking page for convenient prefill. A logout
    // must still end the cabinet session, so only use that fallback until the
    // learner explicitly signs out (a ?phone=… link always remains available).
    if (cabinetSession) return cabinetSession;
    if (localStorage.getItem(EXPLICIT_LOGOUT_KEY) === "1") return "";
    return localStorage.getItem("myPhone") || "";
  } catch (_error) { return ""; }
}

function phoneFromQuery() {
  try { return new URLSearchParams(window.location.search).get("phone") || ""; } catch (_error) { return ""; }
}

function formatDate(iso, options = { day: "numeric", month: "long" }) {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleDateString("ru-RU", { ...options, timeZone: "UTC" }).replace(".", "");
}

function formatDateTime(ts) {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return String(ts);
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
}

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function tutorTodayIso(offsetMinutes) {
  return new Date(Date.now() + Number(offsetMinutes || 0) * 60_000).toISOString().slice(0, 10);
}

function addIsoDays(iso, amount) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function availabilityDates(offsetMinutes, count = 45) {
  const today = tutorTodayIso(offsetMinutes);
  return Array.from({ length: count }, (_, index) => addIsoDays(today, index));
}

function availabilityDateParts(iso, index) {
  const date = new Date(`${iso}T12:00:00Z`);
  const weekday = date.toLocaleDateString("ru-RU", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  return {
    day: date.getUTCDate(),
    month: date.toLocaleDateString("ru-RU", { month: "short", timeZone: "UTC" }).replace(".", ""),
    label: index === 0 ? "сег" : index === 1 ? "зав" : weekday,
  };
}

function isFreeSlot(slot) {
  return slot?.status === "open" || slot?.status === "free";
}

function slotAvailabilityLabel(slot) {
  if (slot?.status === "booked" || slot?.status === "busy") return "занято";
  if (slot?.status === "closed") return "закрыто";
  if (slot?.status === "past") return "прошло";
  return "недоступно";
}

function isoFor(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function statusFor(status) {
  return LESSON_STATUS[status] || LESSON_STATUS.new;
}

function titleCase(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function initialFor(student) {
  const name = String(student?.name || "У").trim();
  return name.charAt(0).toUpperCase() || "У";
}

function viewFromHash() {
  if (typeof window === "undefined") return "home";
  const value = (window.location.hash || "").replace(/^#\/?/, "").split("?")[0];
  return VIEWS.includes(value) ? value : "home";
}

function hashForView(view) {
  return view === "home" ? "" : `#/${view}`;
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><Sparkles size={17} strokeWidth={2.4} /></span>;
}

function IconButton({ label, children, className = "", ...props }) {
  return <button className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>{children}</button>;
}

function StatusPill({ status, compact = false }) {
  const meta = statusFor(status);
  const Icon = meta.Icon;
  return <span className={`cab-status ${meta.tone}`}><Icon size={13} />{compact ? meta.short : meta.label}</span>;
}

function SectionLoading({ label = "Загружаем данные" }) {
  return <div className="cab-section-loading" role="status"><span><LoaderCircle size={19} /></span><div><b>{label}</b><small>Это займёт всего мгновение</small></div></div>;
}

function InlineError({ children, onRetry }) {
  return <div className="cab-inline-error"><CircleAlert size={18} /><div><b>Не получилось загрузить</b><p>{children}</p></div>{onRetry && <button onClick={onRetry}>Повторить</button>}</div>;
}

function LinkifiedText({ text }) {
  const values = String(text || "").split(/(https?:\/\/[^\s]+)/g);
  return <>{values.map((part, index) => /^https?:\/\//.test(part)
    ? <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer">{part}<ExternalLink size={12} /></a>
    : <span key={`${part}-${index}`}>{part}</span>)}</>;
}

function CabinetApp() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("glass-theme") || localStorage.getItem("theme") || "dark"; } catch (_error) { return "dark"; }
  });
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [configReady, setConfigReady] = useState(false);
  const [screen, setScreen] = useState("boot"); // boot | login | loading | cabinet | disabled
  const [loginPhone, setLoginPhone] = useState(() => formatPhone(phoneFromQuery() || rememberedPhone()));
  const [loginError, setLoginError] = useState("");
  const [data, setData] = useState(null);
  const [phone, setPhone] = useState("");
  const [view, setView] = useState(viewFromHash);
  const [sections, setSections] = useState({ lessons: null, tests: null, notes: null });
  const [sectionState, setSectionState] = useState({ lessons: "idle", tests: "idle", notes: "idle" });
  const [sectionErrors, setSectionErrors] = useState({ lessons: "", tests: "", notes: "" });
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [rescheduleLesson, setRescheduleLesson] = useState(null);
  const [calendar, setCalendar] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(todayIso);
  const didBootstrap = useRef(false);
  const entering = useRef(false);
  const noticeTimer = useRef(null);

  const showNotice = useCallback((message, tone = "success") => {
    setNotice({ message, tone });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  }, []);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#071326" : "#e8f0ff");
    try { localStorage.setItem("glass-theme", theme); localStorage.setItem("theme", theme); } catch (_error) { /* preference storage is optional */ }
  }, [theme]);

  const loadCabinet = useCallback(async (rawPhone, options = {}) => {
    const value = formatPhone(rawPhone);
    if (!validPhone(value)) {
      if (!options.silent) setLoginError("Введите номер телефона полностью.");
      return false;
    }
    // A fast double tap on the login button must not start overlapping sessions.
    if (entering.current) return false;
    entering.current = true;
    if (!options.keepScreen) setScreen("loading");
    setLoginError("");
    try {
      const response = await api(`/api/cabinet?phone=${encodeURIComponent(value)}`);
      setPhone(value);
      setData(response);
      setConfig((current) => normalizeConfig({
        ...current,
        tzLabel: response.tzLabel || current.tzLabel,
        rescheduleHours: response.rescheduleHours ?? current.rescheduleHours,
      }));
      setSections({ lessons: null, tests: null, notes: null });
      setSectionState({ lessons: "idle", tests: "idle", notes: "idle" });
      setSectionErrors({ lessons: "", tests: "", notes: "" });
      try {
        localStorage.setItem(SESSION_KEY, value);
        localStorage.setItem("myPhone", value);
        localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
      } catch (_error) { /* storage is optional */ }
      setScreen("cabinet");
      return true;
    } catch (error) {
      setData(null);
      setScreen("login");
      setLoginError(error.message || "Не удалось открыть кабинет.");
      return false;
    } finally {
      entering.current = false;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api("/api/config")
      .then((response) => {
        if (!alive) return;
        const next = normalizeConfig(response);
        setConfig(next);
        document.title = `Кабинет ученика — ${next.tutorName}`;
      })
      .catch(() => { /* fallback config keeps the login page usable */ })
      .finally(() => { if (alive) setConfigReady(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!configReady || didBootstrap.current) return;
    didBootstrap.current = true;
    if (!config.cabinetEnabled) {
      setScreen("disabled");
      return;
    }
    const saved = phoneFromQuery() || rememberedPhone();
    if (saved && validPhone(saved)) loadCabinet(saved, { silent: true });
    else setScreen("login");
  }, [config.cabinetEnabled, configReady, loadCabinet]);

  useEffect(() => {
    const syncView = () => setView(viewFromHash());
    window.addEventListener("hashchange", syncView);
    window.addEventListener("popstate", syncView);
    return () => {
      window.removeEventListener("hashchange", syncView);
      window.removeEventListener("popstate", syncView);
    };
  }, []);

  const loadSection = useCallback(async (name, force = false) => {
    if (!phone || (!force && sections[name] !== null)) return;
    const endpoint = { lessons: "lessons", tests: "tests", notes: "notes" }[name];
    if (!endpoint) return;
    setSectionState((current) => ({ ...current, [name]: "loading" }));
    setSectionErrors((current) => ({ ...current, [name]: "" }));
    try {
      const response = await api(`/api/cabinet/${endpoint}?phone=${encodeURIComponent(phone)}`);
      const payload = response[name] || [];
      setSections((current) => ({ ...current, [name]: payload }));
      setSectionState((current) => ({ ...current, [name]: "ready" }));
    } catch (error) {
      setSectionState((current) => ({ ...current, [name]: "error" }));
      setSectionErrors((current) => ({ ...current, [name]: error.message || "Попробуйте ещё раз." }));
    }
  }, [phone, sections]);

  useEffect(() => {
    if (screen !== "cabinet") return;
    if (view === "schedule") loadSection("lessons");
    if (view === "tests") loadSection("tests");
    if (view === "messages") loadSection("notes");
  }, [loadSection, screen, view]);

  function goTo(viewName) {
    const next = VIEWS.includes(viewName) ? viewName : "home";
    const hash = hashForView(next);
    if (window.location.hash !== hash) window.location.hash = hash;
    // Also update immediately: assigning an empty hash is not consistently
    // observed as a hashchange by every embedded browser.
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function logout() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.setItem(EXPLICIT_LOGOUT_KEY, "1");
    } catch (_error) { /* storage is optional */ }
    window.history.replaceState(null, "", window.location.pathname);
    setData(null);
    setPhone("");
    setLoginPhone("");
    setLoginError("");
    setView("home");
    setSections({ lessons: null, tests: null, notes: null });
    setRescheduleLesson(null);
    setScreen("login");
  }

  async function refreshHome() {
    if (!phone || refreshing) return;
    setRefreshing(true);
    try {
      const response = await api(`/api/cabinet?phone=${encodeURIComponent(phone)}`);
      setData(response);
      showNotice("Данные кабинета обновлены");
    } catch (error) {
      showNotice(error.message || "Не удалось обновить кабинет", "error");
    } finally {
      setRefreshing(false);
    }
  }

  function openReschedule(lesson) {
    if (!lesson?.id) {
      showNotice("Не удалось определить занятие для переноса.", "error");
      return;
    }
    if (lesson.canReschedule === false) {
      showNotice(`Перенос доступен не позже чем за ${config.rescheduleHours} ч до занятия.`, "error");
      return;
    }
    setRescheduleLesson(lesson);
  }

  async function syncAfterReschedule() {
    setRescheduleLesson(null);
    try {
      const [summary, lessonResponse] = await Promise.all([
        api(`/api/cabinet?phone=${encodeURIComponent(phone)}`),
        sections.lessons !== null ? api(`/api/cabinet/lessons?phone=${encodeURIComponent(phone)}`) : Promise.resolve(null),
      ]);
      setData(summary);
      if (lessonResponse) {
        setSections((current) => ({ ...current, lessons: lessonResponse.lessons || [] }));
        setSectionState((current) => ({ ...current, lessons: "ready" }));
        setSectionErrors((current) => ({ ...current, lessons: "" }));
      }
      showNotice("Новое время занятия сохранено");
    } catch (error) {
      // The move already succeeded server-side. Keep that honest while making
      // it easy to refresh the cabinet if its follow-up request had an issue.
      showNotice("Занятие перенесено. Обновите кабинет, чтобы увидеть новое время.", "error");
    }
  }

  const bookingUrl = phone ? `/?phone=${encodeURIComponent(phone)}#my-bookings` : "/#booking";
  const student = data?.student || {};

  if (screen === "boot" || screen === "loading") {
    return <CabinetLoading config={config} theme={theme} setTheme={setTheme} loading={screen === "loading"} />;
  }

  if (screen === "disabled") {
    return <CabinetDisabled config={config} theme={theme} setTheme={setTheme} />;
  }

  if (screen === "login") {
    return <CabinetLogin
      config={config}
      theme={theme}
      setTheme={setTheme}
      phone={loginPhone}
      error={loginError}
      onChange={(value) => { setLoginPhone(formatPhone(value)); setLoginError(""); }}
      onSubmit={(event) => { event.preventDefault(); loadCabinet(loginPhone); }}
    />;
  }

  return <div className="cabinet-shell">
    <CabinetHeader
      config={config}
      theme={theme}
      setTheme={setTheme}
      student={student}
      onLogout={logout}
    />
    <main className="cab-main">
      <div className="cab-aurora cab-aurora-a" aria-hidden="true"></div>
      <div className="cab-aurora cab-aurora-b" aria-hidden="true"></div>
      <div className="cab-container cab-layout">
        <CabinetRail
          view={view}
          onNavigate={goTo}
          student={student}
          config={config}
          bookingUrl={bookingUrl}
        />
        <section className="cab-content" aria-live="polite">
          {view === "home" && <CabinetHome
            data={data}
            config={config}
            student={student}
            bookingUrl={bookingUrl}
            onNavigate={goTo}
            onRefresh={refreshHome}
            onReschedule={openReschedule}
            refreshing={refreshing}
          />}
          {view === "schedule" && <ScheduleView
            lessons={sections.lessons}
            state={sectionState.lessons}
            error={sectionErrors.lessons}
            onReload={() => loadSection("lessons", true)}
            calendar={calendar}
            setCalendar={setCalendar}
            selectedDay={selectedDay}
            setSelectedDay={setSelectedDay}
            config={config}
            onReschedule={openReschedule}
          />}
          {view === "tests" && <TestsView
            tests={sections.tests}
            state={sectionState.tests}
            error={sectionErrors.tests}
            onReload={() => loadSection("tests", true)}
          />}
          {view === "messages" && <MessagesView
            notes={sections.notes}
            state={sectionState.notes}
            error={sectionErrors.notes}
            onReload={() => loadSection("notes", true)}
          />}
          {view === "topics" && <TopicsView student={student} />}
        </section>
      </div>
    </main>
    {rescheduleLesson && <RescheduleLessonModal lesson={rescheduleLesson} phone={phone} config={config} onClose={() => setRescheduleLesson(null)} onComplete={syncAfterReschedule} />}
    {notice && <div className={`cab-toast ${notice.tone === "error" ? "error" : ""}`} role="status">{notice.tone === "error" ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}{notice.message}</div>}
  </div>;
}

function PublicHeader({ config, theme, setTheme }) {
  return <header className="cab-public-header"><div className="cab-container cab-public-header-in">
    <a className="brand" href="/"><BrandMark /><span>{config.tutorName}</span></a>
    <div className="cab-public-actions">
      <a className="cab-back-link" href="/"><ArrowLeft size={15} />На сайт</a>
      <IconButton label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"} onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</IconButton>
    </div>
  </div></header>;
}

function CabinetLoading({ config, theme, setTheme, loading }) {
  return <div className="cabinet-shell cab-public-screen"><PublicHeader config={config} theme={theme} setTheme={setTheme} /><main className="cab-public-main"><div className="cab-aurora cab-aurora-a" aria-hidden="true"></div><section className="cab-loading-card glass"><span className="cab-loading-glyph"><GraduationCap size={30} /></span><h1>{loading ? "Открываем ваш кабинет" : "Готовим пространство"}</h1><p>{loading ? "Собираем занятия, материалы и прогресс в одном месте." : "Подключаем безопасный вход в кабинет ученика."}</p><div className="cab-loading-line"><i></i></div></section></main></div>;
}

function CabinetDisabled({ config, theme, setTheme }) {
  return <div className="cabinet-shell cab-public-screen"><PublicHeader config={config} theme={theme} setTheme={setTheme} /><main className="cab-public-main"><div className="cab-aurora cab-aurora-b" aria-hidden="true"></div><section className="cab-disabled-card glass"><span><Clock3 size={28} /></span><div className="cab-eyebrow">Временно недоступно</div><h1>Кабинет ученика<br />сейчас отключён</h1><p>Запись на занятия по-прежнему доступна на главной странице.</p><a className="button button-primary" href="/#booking">Выбрать время <ArrowRight size={17} /></a></section></main></div>;
}

function CabinetLogin({ config, theme, setTheme, phone, error, onChange, onSubmit }) {
  return <div className="cabinet-shell cab-public-screen"><PublicHeader config={config} theme={theme} setTheme={setTheme} /><main className="cab-public-main cab-login-main"><div className="cab-aurora cab-aurora-a" aria-hidden="true"></div><div className="cab-aurora cab-aurora-b" aria-hidden="true"></div><section className="cab-login-grid"><div className="cab-login-copy"><div className="hero-pill"><Sparkles size={15} />Личное пространство ученика</div><h1>Все занятия.<br /><em>В одном ритме.</em></h1><p>Расписание, материалы, тесты и сообщения преподавателя — в аккуратном личном кабинете.</p><div className="cab-login-features"><span><CalendarDays size={17} />Ближайший урок под рукой</span><span><ListTodo size={17} />Тесты и задания без путаницы</span><span><MessageCircle size={17} />Связь и материалы в одном месте</span></div></div><form className="cab-login-card glass" onSubmit={onSubmit}><div className="cab-login-mark"><UserRound size={22} /></div><div className="cab-eyebrow">Вход в кабинет</div><h2>Рады вас видеть</h2><p>Введите номер, который был указан при записи на занятие.</p><label htmlFor="cab-phone">Номер телефона<input id="cab-phone" value={phone} onChange={(event) => onChange(event.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 999 123-45-67" autoFocus /></label>{error && <div className="cab-login-error" role="alert"><CircleAlert size={16} />{error}</div>}<button className="button button-primary cab-login-submit" type="submit">Открыть кабинет <ArrowRight size={18} /></button><small><ShieldCheckIcon />Номер используется только для доступа к вашим занятиям.</small></form></section></main></div>;
}

function ShieldCheckIcon() {
  return <span className="cab-shield">✓</span>;
}

function CabinetHeader({ config, theme, setTheme, student, onLogout }) {
  return <header className="cabinet-header"><div className="cab-container cabinet-header-in"><a className="brand" href="/"><BrandMark /><span>{config.tutorName}</span></a><div className="cabinet-header-actions"><a className="cab-home-link" href="/"><ArrowLeft size={15} /><span>На сайт</span></a><IconButton label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"} onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</IconButton><button className="cab-profile-button" onClick={onLogout} title="Выйти из кабинета"><span>{initialFor(student)}</span><div><b>{student.name || "Ученик"}</b><small>Выйти</small></div><LogOut size={15} /></button></div></div></header>;
}

function CabinetRail({ view, onNavigate, student, config, bookingUrl }) {
  const items = [
    ["home", LayoutDashboard, "Обзор"],
    ["schedule", CalendarDays, "Расписание"],
    ["tests", FileText, "Тесты"],
    ["messages", MessageCircle, "Сообщения"],
    ["topics", BookOpen, "Пройденное"],
  ];
  return <aside className="cab-rail"><div className="cab-student-card glass"><span className="cab-avatar">{initialFor(student)}</span><div><small>Кабинет ученика</small><b>{student.name || "Ученик"}</b><p>{[student.grade, student.subject].filter(Boolean).join(" · ") || "Индивидуальный план"}</p></div></div><nav className="cab-nav" aria-label="Разделы кабинета">{items.map(([id, Icon, label]) => <button key={id} className={view === id ? "active" : ""} onClick={() => onNavigate(id)}><Icon size={18} /><span>{label}</span>{view === id && <i></i>}</button>)}</nav><a href={bookingUrl} className="cab-rail-cta"><span><CalendarDays size={17} /></span><div><b>Нужно ещё занятие?</b><small>Выбрать свободное время</small></div><ArrowRight size={15} /></a>{config.botEnabled && <div className="cab-telegram-hint"><Send size={15} /><span>Напоминания могут приходить в Telegram</span></div>}</aside>;
}

function CabinetHome({ data, config, student, bookingUrl, onNavigate, onRefresh, onReschedule, refreshing }) {
  const stats = data?.stats || {};
  const next = data?.next;
  const telegramUsername = String(config.botUsername || config.tutorTg || "").replace(/^@/, "");
  const telegramAction = config.botUsername ? "Открыть бота" : "Написать преподавателю";
  const firstName = student.name ? student.name.split(/\s+/)[1] || student.name.split(/\s+/)[0] : "ученик";

  return (
    <div className="cab-view cab-home-view">
      <section className="cab-welcome glass">
        <div className="cab-welcome-copy">
          <div className="cab-eyebrow">Ваш учебный ритм</div>
          <h1>Привет, {firstName} <span>✦</span></h1>
          <p>{next
            ? "Всё готово к следующему шагу: проверьте ближайшее занятие или откройте нужный раздел."
            : "Здесь будут собраны ваши занятия, материалы и учебный прогресс."}</p>
          <div className="cab-welcome-actions">
            {next ? (next.canReschedule ? <button className="button button-primary" type="button" onClick={() => onReschedule(next)}>
              Перенести занятие<RotateCcw size={17} />
            </button> : <button className="button button-primary" type="button" onClick={() => onNavigate("schedule")}>Открыть расписание<CalendarDays size={17} /></button>) : <a className="button button-primary" href={bookingUrl}>Выбрать время<CalendarDays size={17} /></a>}
            <button className="button button-quiet" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}Обновить
            </button>
          </div>
        </div>
        <div className="cab-welcome-orbit" aria-hidden="true">
          <div className="cab-orbit-ring"></div>
          <div className="cab-orbit-core"><GraduationCap size={29} /></div>
          <i className="cab-orbit-dot dot-a">∑</i><i className="cab-orbit-dot dot-b">⚛</i><i className="cab-orbit-dot dot-c">✦</i>
        </div>
      </section>

      <section className="cab-stat-grid" aria-label="Статистика занятий">
        <StatCard icon={<CheckCircle2 size={19} />} value={stats.done || 0} label="проведено уроков" tone="mint" />
        <StatCard icon={<CalendarDays size={19} />} value={stats.upcoming || 0} label="занятий впереди" tone="blue" />
        <StatCard icon={<Clock3 size={19} />} value={stats.lastDone ? formatDate(stats.lastDone, { day: "numeric", month: "short" }) : "—"} label="последний урок" tone="violet" />
      </section>

      <section className="cab-home-grid">
        <NextLessonCard next={next} config={config} onReschedule={onReschedule} />
        <div className="cab-journey-card glass">
          <div className="cab-panel-title"><div>
            <span className="cab-card-icon blue"><Sparkles size={17} /></span>
            <div><small>Учебное пространство</small><h2>Всё важное рядом</h2></div>
          </div></div>
          <div className="cab-journey-list">
            <QuickAction icon={<CalendarDays size={18} />} label="Расписание" text={data?.upcomingTotal ? `Ближайших занятий: ${data.upcomingTotal}` : "Откройте календарь занятий"} onClick={() => onNavigate("schedule")} />
            <QuickAction icon={<FileText size={18} />} label="Тесты" text={data?.testsCount ? `Доступно заданий: ${data.testsCount}` : "Пока нет новых тестов"} onClick={() => onNavigate("tests")} />
            <QuickAction icon={<MessageCircle size={18} />} label="Сообщения" text={data?.notesCount ? `Новых материалов: ${data.notesCount}` : "Материалы появятся здесь"} onClick={() => onNavigate("messages")} />
            <QuickAction icon={<BookOpen size={18} />} label="Пройденное" text="Темы и результаты обучения" onClick={() => onNavigate("topics")} />
          </div>
        </div>
      </section>

      {config.botEnabled && !data?.tgLinked && (
        <section className="cab-connect-card glass">
          <span><Send size={20} /></span>
          <div><b>Telegram пока не привязан</b><p>Откройте бота, нажмите /start и поделитесь номером — тогда напоминания и материалы смогут приходить прямо в Telegram.</p></div>
          {telegramUsername && <a href={`https://t.me/${telegramUsername}`} target="_blank" rel="noreferrer">{telegramAction} <ArrowRight size={15} /></a>}
        </section>
      )}
    </div>
  );
}
function StatCard({ icon, value, label, tone }) {
  return <article className={`cab-stat-card glass ${tone}`}><span>{icon}</span><b>{value}</b><small>{label}</small></article>;
}

function QuickAction({ icon, label, text, onClick }) {
  return <button className="cab-quick-action" onClick={onClick}><span>{icon}</span><div><b>{label}</b><small>{text}</small></div><ChevronRight size={17} /></button>;
}

function NextLessonCard({ next, config, onReschedule }) {
  if (!next) return <article className="cab-next-card glass cab-next-empty"><div className="cab-panel-title"><div><span className="cab-card-icon mint"><CalendarDays size={17} /></span><div><small>Ближайшее занятие</small><h2>Пока нет записи</h2></div></div></div><div className="cab-empty-lesson"><span><CalendarDays size={25} /></span><p>Выберите удобное окно — оно сразу появится в вашем расписании.</p><a className="button button-primary" href="/#booking">Выбрать время <ArrowRight size={16} /></a></div></article>;
  const meta = statusFor(next.status);
  const StatusIcon = meta.Icon;
  return <article className="cab-next-card glass"><div className="cab-panel-title"><div><span className="cab-card-icon mint"><CalendarDays size={17} /></span><div><small>Ближайшее занятие</small><h2>В расписании</h2></div></div><StatusPill status={next.status} compact /></div><div className="cab-next-lesson"><div className="cab-time-orb"><small>{next.dsp?.split(".").slice(0, 2).join(".") || "скоро"}</small><b>{next.time}</b><span>{config.tzLabel}</span></div><div><h3>{next.subject || "Занятие"}</h3><p>{next.dsp || "Дата уточняется"} · {next.time}</p><div className={`cab-next-status ${meta.tone}`}><StatusIcon size={14} />{meta.label}</div></div></div><div className="cab-next-footer"><span><Clock3 size={14} />Перенос — не позже чем за {dataSafeNumber(config.rescheduleHours, 12)} ч</span>{next.canReschedule ? <button type="button" onClick={() => onReschedule(next)}>Изменить время <ArrowRight size={14} /></button> : <small className="cab-next-unavailable"><Info size={13} />Срок переноса истёк</small>}</div></article>;
}

function dataSafeNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function ScheduleView({ lessons, state, error, onReload, calendar, setCalendar, selectedDay, setSelectedDay, config, onReschedule }) {
  const byDate = useMemo(() => {
    const result = {};
    (lessons || []).forEach((lesson) => {
      if (!lesson.iso) return;
      (result[lesson.iso] ||= []).push(lesson);
    });
    Object.values(result).forEach((list) => list.sort((a, b) => String(a.time).localeCompare(String(b.time))));
    return result;
  }, [lessons]);

  const monthTitle = titleCase(new Date(Date.UTC(calendar.year, calendar.month, 1)).toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }));
  const firstWeekday = (new Date(Date.UTC(calendar.year, calendar.month, 1)).getUTCDay() + 6) % 7;
  const totalDays = new Date(Date.UTC(calendar.year, calendar.month + 1, 0)).getUTCDate();
  const cells = [];
  for (let index = 0; index < firstWeekday; index += 1) cells.push({ blank: true, id: `blank-${index}` });
  for (let day = 1; day <= totalDays; day += 1) cells.push({ day, iso: isoFor(calendar.year, calendar.month, day) });
  const selectedLessons = byDate[selectedDay] || [];

  function switchMonth(delta) {
    const cursor = new Date(Date.UTC(calendar.year, calendar.month + delta, 1));
    setCalendar({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() });
    setSelectedDay(isoFor(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
  }

  if (state === "loading" && lessons === null) return <ViewFrame eyebrow="Учебный календарь" title={<>Ваше <em>расписание</em></>} subtitle="Все занятия — будущие и прошедшие — собраны в одном месте."><SectionLoading label="Собираем ваше расписание" /></ViewFrame>;
  if (state === "error") return <ViewFrame eyebrow="Учебный календарь" title={<>Ваше <em>расписание</em></>} subtitle="Все занятия — будущие и прошедшие — собраны в одном месте."><InlineError onRetry={onReload}>{error}</InlineError></ViewFrame>;

  return <ViewFrame eyebrow="Учебный календарь" title={<>Ваше <em>расписание</em></>} subtitle="Все занятия — будущие и прошедшие — собраны в одном месте." action={<button className="cab-refresh-action" onClick={onReload} disabled={state === "loading"}>{state === "loading" ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}Обновить</button>}><section className="cab-calendar-card glass"><div className="cab-calendar-head"><div><small>Календарь занятий</small><h2>{monthTitle}</h2></div><div className="cab-calendar-controls"><IconButton label="Предыдущий месяц" onClick={() => switchMonth(-1)}><ChevronLeft size={19} /></IconButton><button onClick={() => { const now = new Date(); setCalendar({ year: now.getFullYear(), month: now.getMonth() }); setSelectedDay(todayIso()); }}>Сегодня</button><IconButton label="Следующий месяц" onClick={() => switchMonth(1)}><ChevronRight size={19} /></IconButton></div></div><div className="cab-calendar-week"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div><div className="cab-calendar-grid">{cells.map((cell) => {
    if (cell.blank) return <span className="cab-calendar-blank" key={cell.id}></span>;
    const items = byDate[cell.iso] || [];
    const isToday = cell.iso === todayIso();
    return <button key={cell.iso} className={`cab-calendar-day ${cell.iso === selectedDay ? "selected" : ""} ${isToday ? "today" : ""}`} onClick={() => setSelectedDay(cell.iso)} aria-pressed={cell.iso === selectedDay}><b>{cell.day}</b><span>{items.slice(0, 2).map((lesson) => <i className={statusFor(lesson.status).tone} key={lesson.id || `${lesson.time}-${lesson.subject}`}>{lesson.time}</i>)}</span>{items.length > 2 && <small>+{items.length - 2}</small>}</button>;
  })}</div><div className="cab-calendar-legend"><span><i className="pending"></i>ожидается</span><span><i className="confirmed"></i>подтверждено</span><span><i className="done"></i>проведено</span><span><i className="cancelled"></i>отменено</span></div></section><section className="cab-day-details"><div className="cab-day-heading"><div><small>{formatDate(selectedDay, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</small><h2>{selectedLessons.length ? `Занятия: ${selectedLessons.length}` : "Нет занятий"}</h2></div></div>{selectedLessons.length ? <div className="cab-day-lessons">{selectedLessons.map((lesson) => <LessonRow key={lesson.id || `${lesson.iso}-${lesson.time}`} lesson={lesson} config={config} onReschedule={onReschedule} />)}</div> : <div className="cab-day-empty glass"><CalendarDays size={21} /><p>На эту дату занятий нет. Выберите другой день в календаре.</p></div>}</section></ViewFrame>;
}

function LessonRow({ lesson, config, onReschedule }) {
  return <article className="cab-lesson-row glass"><div className="cab-lesson-time"><span>{lesson.dsp?.split(".").slice(0, 2).join(".") || formatDate(lesson.iso, { day: "numeric", month: "short" })}</span><b>{lesson.time}</b><small>{config.tzLabel}</small></div><div className="cab-lesson-copy"><h3>{lesson.subject || "Занятие"}</h3><p>{lesson.dsp || formatDate(lesson.iso, { day: "numeric", month: "long" })} · {lesson.time}</p><StatusPill status={lesson.status} /></div>{lesson.canReschedule && <button className="cab-lesson-reschedule" type="button" onClick={() => onReschedule(lesson)}><RotateCcw size={15} />Перенести</button>}</article>;
}

function RescheduleLessonModal({ lesson, phone, config, onClose, onComplete }) {
  const dates = useMemo(() => availabilityDates(config.tzOffsetMin), [config.tzOffsetMin]);
  const [date, setDate] = useState(() => dates.includes(lesson.iso) ? lesson.iso : dates[0]);
  const [page, setPage] = useState(() => Math.max(0, Math.floor(Math.max(0, dates.indexOf(lesson.iso)) / RESCHEDULE_DATE_PAGE_SIZE)));
  const [slots, setSlots] = useState([]);
  const [slotsState, setSlotsState] = useState("loading");
  const [slotsError, setSlotsError] = useState("");
  const [time, setTime] = useState("");
  const [step, setStep] = useState("select");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const dialogRef = useRef(null);
  const subject = lesson.subject || config.subjects[0] || "";
  const pageCount = Math.max(1, Math.ceil(dates.length / RESCHEDULE_DATE_PAGE_SIZE));
  const shownDates = dates.slice(page * RESCHEDULE_DATE_PAGE_SIZE, (page + 1) * RESCHEDULE_DATE_PAGE_SIZE);
  const selectedLabel = date && time ? `${formatDate(date, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} в ${time}` : "Выберите новую дату и свободное время";

  useEffect(() => {
    if (!dates.includes(date)) setDate(dates[0]);
  }, [date, dates]);

  useEffect(() => {
    const index = dates.indexOf(date);
    if (index >= 0) setPage(Math.floor(index / RESCHEDULE_DATE_PAGE_SIZE));
  }, [date, dates]);

  const loadSlots = useCallback(async () => {
    if (!date) return;
    const currentRequest = ++requestId.current;
    setSlotsState("loading");
    setSlotsError("");
    try {
      const response = await api(`/api/slots?date=${encodeURIComponent(date)}&subject=${encodeURIComponent(subject)}`);
      if (currentRequest !== requestId.current) return;
      const nextSlots = Array.isArray(response.slots) ? [...response.slots].sort((a, b) => String(a.time).localeCompare(String(b.time))) : [];
      setSlots(nextSlots);
      setTime((current) => nextSlots.some((slot) => slot.time === current && isFreeSlot(slot) && !(date === lesson.iso && slot.time === lesson.time)) ? current : "");
      setSlotsState("ready");
    } catch (loadError) {
      if (currentRequest !== requestId.current) return;
      setSlots([]);
      setSlotsState("error");
      setSlotsError(loadError.message || "Не удалось загрузить свободное время.");
    }
  }, [date, lesson.iso, lesson.time, subject]);

  useEffect(() => { loadSlots(); }, [loadSlots]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 30);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [onClose, saving]);

  function chooseDate(nextDate) {
    setDate(nextDate);
    setTime("");
    setStep("select");
    setError("");
  }

  function movePage(delta) {
    setPage((current) => Math.max(0, Math.min(pageCount - 1, current + delta)));
  }

  function chooseTime(nextTime) {
    setTime(nextTime);
    setError("");
  }

  function continueToConfirm() {
    if (!time) { setError("Выберите свободное время для переноса."); return; }
    if (date === lesson.iso && time === lesson.time) { setError("Это текущее время занятия — выберите другое окно."); return; }
    setError("");
    setStep("confirm");
  }

  async function submitReschedule() {
    if (!time || saving) return;
    setSaving(true);
    setError("");
    try {
      await api("/api/reschedule", { method: "POST", body: JSON.stringify({ id: lesson.id, phone, date, time }) });
      await onComplete({ ...lesson, iso: date, time, subject });
    } catch (submitError) {
      setError(submitError.message || "Не удалось перенести занятие.");
      setTime("");
      setStep("select");
      loadSlots();
    } finally {
      setSaving(false);
    }
  }

  return <div className="cab-reschedule-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="cab-reschedule-modal glass" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cab-reschedule-title" tabIndex="-1">
      <header className="cab-reschedule-modal-head"><div><span className="cab-eyebrow">Изменить занятие</span><h2 id="cab-reschedule-title">Новое время <em>без перехода.</em></h2></div><IconButton label="Закрыть окно переноса" onClick={onClose} disabled={saving}><X size={18} /></IconButton></header>
      <div className="cab-reschedule-current"><span><CalendarDays size={19} /></span><div><small>Сейчас в расписании</small><b>{subject || "Занятие"}</b><p>{lesson.dsp || formatDate(lesson.iso, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} · {lesson.time} ({config.tzLabel})</p></div></div>
      {step === "select" && <div className="cab-reschedule-picker">
        <section className="cab-reschedule-step"><div className="cab-reschedule-step-title"><span>01</span><div><b>Новая дата</b><small>Выберите удобный день</small></div></div><div className="cab-reschedule-date-head"><button type="button" onClick={() => movePage(-1)} disabled={page === 0} aria-label="Предыдущие дни"><ChevronLeft size={17} /></button><b>{formatDate(shownDates[0], { day: "numeric", month: "short", timeZone: "UTC" })} — {formatDate(shownDates[shownDates.length - 1], { day: "numeric", month: "short", timeZone: "UTC" })}</b><button type="button" onClick={() => movePage(1)} disabled={page >= pageCount - 1} aria-label="Следующие дни"><ChevronRight size={17} /></button></div><div className="cab-reschedule-dates">{shownDates.map((item) => { const index = dates.indexOf(item); const parts = availabilityDateParts(item, index); return <button type="button" key={item} className={date === item ? "selected" : ""} onClick={() => chooseDate(item)} aria-pressed={date === item} aria-label={formatDate(item, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}><small>{parts.label}</small><b>{parts.day}</b><span>{parts.month}</span></button>; })}</div></section>
        <section className="cab-reschedule-step"><div className="cab-reschedule-step-title"><span>02</span><div><b>Свободное время</b><small>{formatDate(date, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} · {config.tzLabel}</small></div><button className="cab-reschedule-reload" type="button" onClick={loadSlots} aria-label="Обновить свободное время"><RefreshCw size={15} /></button></div>{slotsState === "loading" && <div className="cab-reschedule-loading" role="status"><LoaderCircle className="spin" size={19} /><div><b>Ищем свободные окна</b><small>Проверяем актуальное расписание</small></div></div>}{slotsState === "error" && <div className="cab-reschedule-error"><CircleAlert size={17} /><span>{slotsError}</span><button type="button" onClick={loadSlots}>Повторить</button></div>}{slotsState === "ready" && !slots.length && <div className="cab-reschedule-empty"><CalendarDays size={19} /><b>На этот день свободных окон нет</b><span>Попробуйте соседний день.</span></div>}{slotsState === "ready" && Boolean(slots.length) && <div className="cab-reschedule-slots">{slots.map((slot) => { const currentSlot = date === lesson.iso && slot.time === lesson.time; const available = isFreeSlot(slot) && !currentSlot; return <button type="button" key={`${slot.time}-${slot.status}`} className={`${time === slot.time ? "selected" : ""} ${available ? "" : "unavailable"}`} disabled={!available} onClick={() => chooseTime(slot.time)}><b>{slot.time}</b><small>{available ? `${slot.duration || config.lessonDuration} мин` : currentSlot ? "текущее" : slotAvailabilityLabel(slot)}</small>{time === slot.time && <Check size={15} />}</button>; })}</div>}</section>
        <div className={`cab-reschedule-selection ${time ? "ready" : ""}`}><span><RotateCcw size={17} /></span><div><small>Новое время</small><b>{selectedLabel}</b></div></div>{error && <div className="cab-reschedule-form-error" role="alert"><CircleAlert size={16} />{error}</div>}<footer className="cab-reschedule-actions"><button className="button button-quiet" type="button" onClick={onClose} disabled={saving}>Отмена</button><button className="button button-primary" type="button" onClick={continueToConfirm} disabled={!time || slotsState !== "ready"}>Продолжить <ArrowRight size={17} /></button></footer>
      </div>}
      {step === "confirm" && <div className="cab-reschedule-confirm"><span><RotateCcw size={26} /></span><small className="cab-eyebrow">Проверьте изменения</small><h3>Перенести занятие?</h3><p>Старое окно освободится, а новое время сразу появится в вашем расписании.</p><div className="cab-reschedule-transfer"><div><small>Было</small><b>{lesson.dsp || formatDate(lesson.iso)} · {lesson.time}</b></div><ArrowRight size={17} /><div><small>Станет</small><b>{formatDate(date)} · {time}</b></div></div>{error && <div className="cab-reschedule-form-error" role="alert"><CircleAlert size={16} />{error}</div>}<footer className="cab-reschedule-actions"><button className="button button-quiet" type="button" onClick={() => { setStep("select"); setError(""); }} disabled={saving}>Изменить выбор</button><button className="button button-primary" type="button" onClick={submitReschedule} disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />}{saving ? "Переносим…" : "Подтвердить перенос"}</button></footer></div>}
    </section>
  </div>;
}

function TestsView({ tests, state, error, onReload }) {
  return <ViewFrame eyebrow="Практика и проверка" title={<>Ваши <em>тесты</em></>} subtitle="Здесь появляются задания от преподавателя. Ответы и прогресс сохраняются автоматически." action={<button className="cab-refresh-action" onClick={onReload} disabled={state === "loading"}>{state === "loading" ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}Обновить</button>}>{state === "loading" && tests === null && <SectionLoading label="Загружаем задания" />}{state === "error" && <InlineError onRetry={onReload}>{error}</InlineError>}{state === "ready" && !tests?.length && <EmptyState icon={<FileText size={26} />} title="Тестов пока нет" text="Когда преподаватель отправит задание, оно появится прямо здесь." />}{state === "ready" && Boolean(tests?.length) && <div className="cab-test-grid">{tests.map((test) => <TestCard key={test.id} test={test} />)}</div>}</ViewFrame>;
}

function TestCard({ test }) {
  const status = TEST_STATUS[test.status] || TEST_STATUS.assigned;
  const actionText = test.status === "finished" ? (test.canRetry ? "Пройти ещё раз" : "Посмотреть результат") : test.status === "started" ? "Продолжить" : "Начать тест";
  const description = test.status === "finished"
    ? (test.showScore && test.score != null ? `Результат: ${test.score} из ${test.total}` : "Ответы отправлены преподавателю")
    : test.status === "started" ? `Отвечено ${test.answered || 0} из ${test.total}` : `Вопросов: ${test.total}`;
  return <article className="cab-test-card glass"><div className="cab-test-top"><span className="cab-card-icon violet"><FileText size={18} /></span><span className={`cab-status ${status.tone}`}>{status.label}</span></div><h2>{test.title}</h2><p>{description}</p><div className="cab-test-meta"><span><ListTodo size={14} />{test.maxAttempts > 1 ? `Попыток: ${test.attempts || 0} из ${test.maxAttempts}` : "Одна попытка"}</span>{test.finishedAt && <span><CheckCircle2 size={14} />{formatDateTime(test.finishedAt)}</span>}</div><a className="button button-primary" href={`/test?t=${encodeURIComponent(test.id)}`}>{actionText}<ArrowRight size={16} /></a></article>;
}

function MessagesView({ notes, state, error, onReload }) {
  return <ViewFrame eyebrow="От преподавателя" title={<>Материалы и <em>сообщения</em></>} subtitle="Домашние задания, ссылки и важные заметки остаются здесь, чтобы ничего не потерялось." action={<button className="cab-refresh-action" onClick={onReload} disabled={state === "loading"}>{state === "loading" ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}Обновить</button>}>{state === "loading" && notes === null && <SectionLoading label="Загружаем сообщения" />}{state === "error" && <InlineError onRetry={onReload}>{error}</InlineError>}{state === "ready" && !notes?.length && <EmptyState icon={<MessageCircle size={26} />} title="Сообщений пока нет" text="Материалы от преподавателя появятся здесь." />}{state === "ready" && Boolean(notes?.length) && <div className="cab-message-list">{notes.map((note) => <MessageCard key={note.id} note={note} />)}</div>}</ViewFrame>;
}

function MessageCard({ note }) {
  const type = note.type === "homework" ? { label: "Домашнее задание", Icon: ListTodo, tone: "violet" } : note.type === "link" ? { label: "Ссылка", Icon: Link2, tone: "blue" } : { label: "Сообщение", Icon: Info, tone: "mint" };
  const Icon = type.Icon;
  return <article className="cab-message-card glass"><div className={`cab-message-icon ${type.tone}`}><Icon size={18} /></div><div className="cab-message-body"><div className="cab-message-meta"><span>{type.label}</span><time>{formatDateTime(note.ts)}</time></div><p><LinkifiedText text={note.text} /></p>{note.link && <a className="cab-material-link" href={note.link} target="_blank" rel="noreferrer"><Link2 size={15} />Открыть материал <ExternalLink size={13} /></a>}</div></article>;
}

function TopicsView({ student }) {
  const groups = useMemo(() => {
    const result = [];
    let current = null;
    String(student?.topics || "").split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
      const subject = line.match(/^\[(.+)]$/);
      if (subject) {
        current = { title: subject[1], rows: [] };
        result.push(current);
      } else {
        if (!current) { current = { title: "Пройденные темы", rows: [] }; result.push(current); }
        const separator = line.indexOf(":");
        current.rows.push(separator > 0 ? { label: line.slice(0, separator), text: line.slice(separator + 1).trim() } : { label: "Тема", text: line });
      }
    });
    return result;
  }, [student?.topics]);
  return <ViewFrame eyebrow="Ваша траектория" title={<>Пройденные <em>темы</em></>} subtitle="Здесь преподаватель отмечает темы, которые уже были разобраны на занятиях.">{!groups.length && <EmptyState icon={<BookOpen size={26} />} title="Список тем пока заполняется" text="После первых занятий преподаватель добавит сюда пройденные темы." />}{Boolean(groups.length) && <div className="cab-topic-grid">{groups.map((group) => <article className="cab-topic-card glass" key={group.title}><div className="cab-topic-head"><span><BookOpen size={18} /></span><h2>{group.title}</h2></div>{group.rows.map((row, index) => <div className="cab-topic-row" key={`${row.label}-${index}`}><b>{row.label}</b><p>{row.text}</p></div>)}</article>)}</div>}</ViewFrame>;
}

function EmptyState({ icon, title, text }) {
  return <div className="cab-empty-state glass"><span>{icon}</span><h2>{title}</h2><p>{text}</p></div>;
}

function ViewFrame({ eyebrow, title, subtitle, action, children }) {
  return <div className="cab-view"><header className="cab-view-header"><div><div className="cab-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>{children}</div>;
}

export default CabinetApp;
