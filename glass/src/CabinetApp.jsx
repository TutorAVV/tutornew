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
} from "lucide-react";

const SESSION_KEY = "cabinetPhone";
const EXPLICIT_LOGOUT_KEY = "cabinetExplicitlyLoggedOut";
const VIEWS = ["home", "schedule", "tests", "messages", "topics"];

const DEFAULT_CONFIG = {
  tutorName: "Онлайн-уроки",
  tzLabel: "МСК+2",
  rescheduleHours: 12,
  cabinetEnabled: true,
  botEnabled: false,
  botUsername: "",
  tutorTg: "",
};

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
    cabinetEnabled: data.cabinetEnabled !== false && String(data.cabinetEnabled) !== "0",
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
  return <aside className="cab-rail"><div className="cab-student-card glass"><span className="cab-avatar">{initialFor(student)}</span><div><small>Кабинет ученика</small><b>{student.name || "Ученик"}</b><p>{[student.grade, student.subject].filter(Boolean).join(" · ") || "Индивидуальный план"}</p></div></div><nav className="cab-nav" aria-label="Разделы кабинета">{items.map(([id, Icon, label]) => <button key={id} className={view === id ? "active" : ""} onClick={() => onNavigate(id)}><Icon size={18} /><span>{label}</span>{view === id && <i></i>}</button>)}</nav><a href={bookingUrl} className="cab-rail-cta"><span><CalendarDays size={17} /></span><div><b>Нужно другое время?</b><small>Записаться или перенести</small></div><ArrowRight size={15} /></a>{config.botEnabled && <div className="cab-telegram-hint"><Send size={15} /><span>Напоминания могут приходить в Telegram</span></div>}</aside>;
}

function CabinetHome({ data, config, student, bookingUrl, onNavigate, onRefresh, refreshing }) {
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
            <a className="button button-primary" href={bookingUrl}>
              {next ? "Перенести занятие" : "Выбрать время"}<RotateCcw size={17} />
            </a>
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
        <NextLessonCard next={next} config={config} bookingUrl={bookingUrl} />
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

function NextLessonCard({ next, config, bookingUrl }) {
  if (!next) return <article className="cab-next-card glass cab-next-empty"><div className="cab-panel-title"><div><span className="cab-card-icon mint"><CalendarDays size={17} /></span><div><small>Ближайшее занятие</small><h2>Пока нет записи</h2></div></div></div><div className="cab-empty-lesson"><span><CalendarDays size={25} /></span><p>Выберите удобное окно — оно сразу появится в вашем расписании.</p><a className="button button-primary" href="/#booking">Выбрать время <ArrowRight size={16} /></a></div></article>;
  const meta = statusFor(next.status);
  const StatusIcon = meta.Icon;
  return <article className="cab-next-card glass"><div className="cab-panel-title"><div><span className="cab-card-icon mint"><CalendarDays size={17} /></span><div><small>Ближайшее занятие</small><h2>В расписании</h2></div></div><StatusPill status={next.status} compact /></div><div className="cab-next-lesson"><div className="cab-time-orb"><small>{next.dsp?.split(".").slice(0, 2).join(".") || "скоро"}</small><b>{next.time}</b><span>{config.tzLabel}</span></div><div><h3>{next.subject || "Занятие"}</h3><p>{next.dsp || "Дата уточняется"} · {next.time}</p><div className={`cab-next-status ${meta.tone}`}><StatusIcon size={14} />{meta.label}</div></div></div><div className="cab-next-footer"><span><Clock3 size={14} />Перенос — не позже чем за {dataSafeNumber(config.rescheduleHours, 12)} ч</span><a href={bookingUrl}>Изменить время <ArrowRight size={14} /></a></div></article>;
}

function dataSafeNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function ScheduleView({ lessons, state, error, onReload, calendar, setCalendar, selectedDay, setSelectedDay, config }) {
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
  })}</div><div className="cab-calendar-legend"><span><i className="pending"></i>ожидается</span><span><i className="confirmed"></i>подтверждено</span><span><i className="done"></i>проведено</span><span><i className="cancelled"></i>отменено</span></div></section><section className="cab-day-details"><div className="cab-day-heading"><div><small>{formatDate(selectedDay, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</small><h2>{selectedLessons.length ? `Занятия: ${selectedLessons.length}` : "Нет занятий"}</h2></div></div>{selectedLessons.length ? <div className="cab-day-lessons">{selectedLessons.map((lesson) => <LessonRow key={lesson.id || `${lesson.iso}-${lesson.time}`} lesson={lesson} config={config} />)}</div> : <div className="cab-day-empty glass"><CalendarDays size={21} /><p>На эту дату занятий нет. Выберите другой день в календаре.</p></div>}</section></ViewFrame>;
}

function LessonRow({ lesson, config }) {
  return <article className="cab-lesson-row glass"><div className="cab-lesson-time"><span>{lesson.dsp?.split(".").slice(0, 2).join(".") || formatDate(lesson.iso, { day: "numeric", month: "short" })}</span><b>{lesson.time}</b><small>{config.tzLabel}</small></div><div className="cab-lesson-copy"><h3>{lesson.subject || "Занятие"}</h3><p>{lesson.dsp || formatDate(lesson.iso, { day: "numeric", month: "long" })} · {lesson.time}</p><StatusPill status={lesson.status} /></div></article>;
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
