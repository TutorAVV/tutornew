import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileText,
  GraduationCap,
  Info,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListTodo,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  UsersRound,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";

const SESSION_KEY = "adminKey";
const ADMIN_VIEWS = ["schedule", "bookings", "slots", "students", "tests", "tg", "settings", "help"];

const FALLBACK_CONFIG = {
  tutorName: "Онлайн-уроки",
  storage: "demo",
  sheetUrl: "",
  tzLabel: "МСК+2",
};

const BOOKING_STATUS = {
  new: { label: "Новая", tone: "pending", Icon: Clock3 },
  confirmed: { label: "Подтверждена", tone: "confirmed", Icon: CheckCircle2 },
  done: { label: "Завершена", tone: "done", Icon: Check },
  cancelled: { label: "Отменена", tone: "cancelled", Icon: CircleAlert },
};

const SLOT_STATUS = {
  open: { label: "Свободен", tone: "open" },
  booked: { label: "Занят", tone: "booked" },
  closed: { label: "Закрыт", tone: "closed" },
};

const NAV_ITEMS = [
  ["schedule", CalendarDays, "Расписание", "Слоты и календарь"],
  ["bookings", ListTodo, "Заявки", "Записи учеников"],
  ["slots", Plus, "Слоты", "Добавить и сгенерировать"],
  ["students", UsersRound, "Ученики", "Карточки и материалы"],
  ["tests", FileText, "Тесты", "Задания и результаты"],
  ["tg", Send, "Telegram", "Диалоги и рассылки"],
  ["settings", Settings, "Настройки", "Сайт и уведомления"],
  ["help", CircleHelp, "Помощь", "Подсказки по сервису"],
];

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><Sparkles size={17} strokeWidth={2.4} /></span>;
}

function toIso(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function isoToday(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isoMonthForward() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(iso, options = { day: "numeric", month: "short" }) {
  const value = toIso(iso);
  if (!value) return String(iso || "");
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(iso || "");
  return date.toLocaleDateString("ru-RU", { ...options, timeZone: "UTC" }).replace(".", "");
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function dayTitle(iso) {
  const value = toIso(iso);
  if (!value) return String(iso || "");
  const date = new Date(`${value}T12:00:00`);
  const label = date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const today = isoToday();
  const tomorrow = isoToday(1);
  return `${label}${value === today ? " · сегодня" : value === tomorrow ? " · завтра" : ""}`;
}

function titleCase(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function bookingIso(booking) {
  return toIso(booking?.iso || booking?.date || "");
}

function statusMeta(status) {
  return BOOKING_STATUS[status] || BOOKING_STATUS.new;
}

function slotMeta(status) {
  return SLOT_STATUS[status] || SLOT_STATUS.closed;
}

function viewFromHash() {
  if (typeof window === "undefined") return "schedule";
  const value = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return ADMIN_VIEWS.includes(value) ? value : "schedule";
}

function hashForView(view) {
  return `#${ADMIN_VIEWS.includes(view) ? view : "schedule"}`;
}

function safeError(error, fallback = "Не удалось выполнить действие. Попробуйте ещё раз.") {
  return error?.message && error.message !== "unauthorized" ? error.message : fallback;
}

async function publicRequest(path) {
  let response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" } });
  } catch (_error) {
    throw new Error("Нет связи с сервисом. Попробуйте ещё раз.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) throw new Error(data?.error || "Не удалось загрузить данные.");
  return data || {};
}

async function adminRequest(key, path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        Accept: "application/json",
        "x-admin-key": key,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (_error) {
    throw new Error("Нет связи с сервисом. Попробуйте ещё раз.");
  }

  const data = await response.json().catch(() => null);
  if (response.status === 401) {
    const error = new Error("unauthorized");
    error.code = "unauthorized";
    throw error;
  }
  if (!response.ok || data?.ok === false) throw new Error(data?.error || "Не удалось выполнить действие.");
  return data || {};
}

function downloadCsv(filename, headers, rows) {
  const lines = [headers.join(";")].concat(rows.map((row) => headers.map((key) =>
    `"${String(row[key] == null ? "" : row[key]).replace(/"/g, '""')}"`).join(";")));
  const url = URL.createObjectURL(new Blob([`\ufeff${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 250);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch (_error) { /* use fallback */ }
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

function promptForAi(subject, grade, topic, count, difficulty, optionsCount) {
  const letters = "абвгдежзи";
  const options = Array.from({ length: Math.max(2, Math.min(8, number(optionsCount, 4))) }, (_, index) => `${letters[index]}) вариант ${index + 1}`).join(", ");
  return [
    `Составь тест по предмету ${subject} для ученика ${grade} класса.`,
    `Тема: ${topic || "тема"}.`,
    `Количество вопросов: ${count}. Сложность: ${difficulty}.`,
    "",
    "Строгие требования к формату (сайт сам разберёт текст):",
    '- Вопросы нумеруются: "1. Текст вопроса"',
    `- У каждого вопроса ${optionsCount} варианта: ${options}`,
    '- Сразу после вопроса — отдельной строкой "Ответ: б" (буква правильного варианта)',
    '- Следующей строкой — "Пояснение: 1–2 предложения, почему этот ответ правильный"',
    '- 2–3 вопроса могут быть открытыми: вместо вариантов — одна строка "Ответ: 3,14"',
    "- Без вступлений и лишнего текста за пределами формата.",
    "",
    "Пример:",
    "1. Сколько будет 1/2 + 1/3?",
    "а) 2/5",
    "б) 5/6",
    "в) 1/6",
    "г) 4/5",
    "Ответ: б",
    "Пояснение: Общий знаменатель 6: 3/6 + 2/6 = 5/6.",
  ].join("\n");
}

function parseTopics(text) {
  const result = {};
  let subject = "";
  String(text || "").split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const subjectMatch = line.match(/^\[(.+?)]$/);
    if (subjectMatch) {
      subject = subjectMatch[1].trim();
      result[subject] ||= {};
      return;
    }
    const gradeMatch = line.match(/^([^:]+):\s*(.+)$/);
    if (gradeMatch && subject) {
      const grade = gradeMatch[1].trim();
      result[subject][grade] ||= {};
      gradeMatch[2].split(",").map((item) => item.trim()).filter(Boolean).forEach((topic) => { result[subject][grade][topic] = true; });
    }
  });
  return result;
}

function topicsToText(catalog, selection) {
  const lines = [];
  Object.entries(catalog || {}).forEach(([subject, grades]) => {
    const gradeLines = Object.entries(grades || {}).map(([grade, topics]) => {
      const selected = (topics || []).filter((topic) => selection?.[subject]?.[grade]?.[topic]);
      return selected.length ? `${grade}: ${selected.join(", ")}` : "";
    }).filter(Boolean);
    if (gradeLines.length) lines.push(`[${subject}]`, ...gradeLines);
  });
  return lines.join("\n");
}

function IconButton({ label, children, className = "", ...props }) {
  return <button className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>{children}</button>;
}

function StatusPill({ status, kind = "booking" }) {
  const meta = kind === "slot" ? slotMeta(status) : statusMeta(status);
  const Icon = meta.Icon;
  return <span className={`adm-status ${meta.tone}`}>{Icon && <Icon size={12} />}{meta.label}</span>;
}

function LoadingPanel({ label = "Загружаем данные" }) {
  return <div className="adm-loading-panel" role="status"><span><LoaderCircle size={21} /></span><div><b>{label}</b><small>Это займёт всего мгновение</small></div></div>;
}

function InlineError({ children, onRetry }) {
  return <div className="adm-inline-error"><CircleAlert size={18} /><div><b>Не получилось загрузить</b><p>{children}</p></div>{onRetry && <button type="button" onClick={onRetry}>Повторить</button>}</div>;
}

function EmptyState({ icon, title, text, action }) {
  return <div className="adm-empty-state glass"><span>{icon}</span><h2>{title}</h2><p>{text}</p>{action}</div>;
}

function Modal({ title, children, onClose, wide = false, className = "" }) {
  return <div className="adm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section className={`adm-modal glass ${wide ? "wide" : ""} ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
      <header className="adm-modal-head"><div><small>Рабочее пространство</small><h2>{title}</h2></div><IconButton label="Закрыть" onClick={onClose}><X size={18} /></IconButton></header>
      {children}
    </section>
  </div>;
}

function ToastStack({ items }) {
  return <div className="adm-toast-stack" aria-live="polite">{items.map((item) => <div key={item.id} className={`adm-toast ${item.tone || "success"}`}><span>{item.tone === "error" ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}</span>{item.message}</div>)}</div>;
}

function ConfirmDialog({ task, busy, onCancel, onConfirm }) {
  if (!task) return null;
  return <Modal title={task.title || "Подтвердите действие"} onClose={busy ? undefined : onCancel} className="adm-confirm-modal">
    <div className="adm-confirm-symbol"><CircleAlert size={22} /></div>
    <p>{task.description}</p>
    <div className="adm-modal-actions"><button className="button button-quiet" type="button" onClick={onCancel} disabled={busy}>Вернуться</button><button className={`button ${task.danger ? "adm-danger-button" : "button-primary"}`} type="button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : task.confirmLabel || "Подтвердить"}</button></div>
  </Modal>;
}

export default function AdminApp() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");
  const [config, setConfig] = useState(FALLBACK_CONFIG);
  const [screen, setScreen] = useState("boot");
  const [adminKey, setAdminKey] = useState("");
  const [view, setView] = useState(viewFromHash);
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [bookingsState, setBookingsState] = useState({ loading: false, error: "" });
  const [schedule, setSchedule] = useState([]);
  const [scheduleState, setScheduleState] = useState({ loading: false, error: "" });
  const [scheduleRange, setScheduleRange] = useState(() => ({ from: isoToday(), to: isoMonthForward() }));
  const scheduleRangeRef = useRef(scheduleRange);
  const loadedRangeRef = useRef({ from: "", to: "" });
  const [loadedRange, setLoadedRange] = useState({ from: "", to: "" });
  const [scheduleStatus, setScheduleStatus] = useState("all");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarSelection, setCalendarSelection] = useState(isoToday());
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [students, setStudents] = useState([]);
  const [studentsState, setStudentsState] = useState({ loading: false, error: "" });
  const [toasts, setToasts] = useState([]);
  const [confirmTask, setConfirmTask] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const authStarted = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    document.title = "Панель преподавателя";
    publicRequest("/api/config").then((data) => setConfig((current) => ({ ...current, ...data }))).catch(() => {});
  }, []);

  useEffect(() => {
    scheduleRangeRef.current = scheduleRange;
  }, [scheduleRange]);

  const notify = useCallback((message, tone = "success") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);

  const signOut = useCallback((message) => {
    sessionStorage.removeItem(SESSION_KEY);
    setAdminKey("");
    setScreen("login");
    setLoginBusy(false);
    setConfirmTask(null);
    if (message) setLoginError(message);
  }, []);

  const request = useCallback(async (path, options) => {
    try {
      return await adminRequest(adminKey, path, options);
    } catch (error) {
      if (error?.code === "unauthorized") signOut("Сессия закончилась. Введите ключ ещё раз.");
      throw error;
    }
  }, [adminKey, signOut]);

  const refreshBookings = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setBookingsState({ loading: true, error: "" });
    try {
      const data = await request("/api/bookings");
      const list = Array.isArray(data.bookings) ? data.bookings : [];
      setBookings(list);
      setBookingsState({ loading: false, error: "" });
      return list;
    } catch (error) {
      if (!silent) setBookingsState({ loading: false, error: safeError(error) });
      throw error;
    }
  }, [request]);

  const refreshStudents = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStudentsState({ loading: true, error: "" });
    try {
      const data = await request("/api/admin/students");
      const list = Array.isArray(data.students) ? data.students : [];
      setStudents(list);
      setStudentsState({ loading: false, error: "" });
      return list;
    } catch (error) {
      if (!silent) setStudentsState({ loading: false, error: safeError(error) });
      throw error;
    }
  }, [request]);

  const ensureStudents = useCallback(async () => {
    if (students.length) return students;
    return refreshStudents({ silent: false });
  }, [students, refreshStudents]);

  const loadSchedule = useCallback(async (range = scheduleRangeRef.current) => {
    if (!range.from || !range.to || range.to < range.from) {
      const message = "Проверьте диапазон дат: дата окончания должна быть не раньше начала.";
      setScheduleState({ loading: false, error: message });
      notify(message, "error");
      return [];
    }
    setScheduleState({ loading: true, error: "" });
    try {
      const data = await request(`/api/schedule?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
      const list = (Array.isArray(data.slots) ? data.slots : Array.isArray(data.schedule) ? data.schedule : []).map((slot) => ({
        ...slot,
        // API returns a display date plus `iso`; keep one canonical date for actions and grouping.
        displayDate: slot.date,
        date: toIso(slot.iso || slot.date),
      }));
      const previous = loadedRangeRef.current;
      const changedRange = previous.from !== range.from || previous.to !== range.to;
      loadedRangeRef.current = { ...range };
      setSchedule(list);
      setLoadedRange({ ...range });
      setScheduleState({ loading: false, error: "" });
      setCalendarSelection((current) => (changedRange || !current || current < range.from || current > range.to ? range.from : current));
      if (changedRange) {
        const start = new Date(`${range.from}T12:00:00`);
        setCalendarMonth({ year: start.getFullYear(), month: start.getMonth() });
      }
      return list;
    } catch (error) {
      setScheduleState({ loading: false, error: safeError(error) });
      throw error;
    }
  }, [notify, request]);

  const authenticate = useCallback(async (candidate) => {
    const key = String(candidate || "").trim();
    if (!key) {
      setLoginError("Введите пароль администратора.");
      return false;
    }
    setLoginBusy(true);
    setLoginError("");
    try {
      const data = await adminRequest(key, "/api/bookings");
      setAdminKey(key);
      setBookings(Array.isArray(data.bookings) ? data.bookings : []);
      setBookingsState({ loading: false, error: "" });
      sessionStorage.setItem(SESSION_KEY, key);
      setScreen("ready");
      return true;
    } catch (error) {
      sessionStorage.removeItem(SESSION_KEY);
      setScreen("login");
      setLoginError(error?.code === "unauthorized" ? "Неверный пароль администратора." : safeError(error));
      return false;
    } finally {
      setLoginBusy(false);
    }
  }, []);

  useEffect(() => {
    if (authStarted.current) return;
    authStarted.current = true;
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) {
      setScreen("login");
      return;
    }
    authenticate(saved);
  }, [authenticate]);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}#schedule`);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (screen !== "ready") return;
    if (view === "schedule") loadSchedule().catch(() => {});
    if (view === "students" && !students.length) refreshStudents().catch(() => {});
  }, [screen, view, loadSchedule, refreshStudents, students.length]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !confirmBusy) {
        setConfirmTask(null);
        setCalendarOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmBusy]);

  const navigate = useCallback((nextView) => {
    const target = ADMIN_VIEWS.includes(nextView) ? nextView : "schedule";
    if (window.location.hash !== hashForView(target)) window.location.hash = target;
    else setView(target);
  }, []);

  const ask = useCallback((task) => setConfirmTask(task), []);

  const runConfirm = useCallback(async () => {
    if (!confirmTask?.action) return;
    setConfirmBusy(true);
    try {
      await confirmTask.action();
      setConfirmTask(null);
    } catch (error) {
      notify(safeError(error), "error");
    } finally {
      setConfirmBusy(false);
    }
  }, [confirmTask, notify]);

  const updateBookingStatus = useCallback(async (booking, status) => {
    await request(`/api/bookings/${encodeURIComponent(booking.id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
    notify(status === "cancelled" ? "Запись отменена, слот снова доступен." : "Статус записи обновлён.");
    await Promise.all([refreshBookings({ silent: true }), loadSchedule().catch(() => {})]);
  }, [request, notify, refreshBookings, loadSchedule]);

  const changeBookingStatus = useCallback((booking, status) => {
    if (status === "cancelled") {
      ask({
        title: "Отменить запись?",
        description: `Заявка ${booking.name || booking.phone} будет отменена, а её слот снова станет свободным.`,
        confirmLabel: "Отменить запись",
        danger: true,
        action: () => updateBookingStatus(booking, status),
      });
      return;
    }
    updateBookingStatus(booking, status).catch((error) => notify(safeError(error), "error"));
  }, [ask, updateBookingStatus, notify]);

  const updateSlot = useCallback(async (slot, status) => {
    try {
      await request("/api/admin/slots", { method: "PATCH", body: JSON.stringify({ date: slot.date, time: slot.time, status }) });
      notify(status === "open" ? "Слот открыт для записи." : "Слот закрыт.");
      await loadSchedule();
    } catch (error) {
      notify(safeError(error), "error");
      throw error;
    }
  }, [request, notify, loadSchedule]);

  const freeBookedSlot = useCallback((slot) => ask({
    title: "Освободить занятой слот?",
    description: "Связанная активная запись будет отменена, после чего время станет свободным для новой записи.",
    confirmLabel: "Освободить слот",
    danger: true,
    action: async () => {
      const latestBookings = await refreshBookings({ silent: true });
      const booking = latestBookings.find((item) => bookingIso(item) === slot.date && item.time === slot.time && !["cancelled", "done"].includes(item.status));
      if (booking) await request(`/api/bookings/${encodeURIComponent(booking.id)}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) });
      await request("/api/admin/slots", { method: "PATCH", body: JSON.stringify({ date: slot.date, time: slot.time, status: "open" }) });
      notify(booking ? "Запись отменена, слот освобождён." : "Слот открыт для новой записи.");
      await Promise.all([refreshBookings({ silent: true }), loadSchedule()]);
    },
  }), [ask, refreshBookings, request, notify, loadSchedule]);

  const deleteSlot = useCallback((slot) => ask({
    title: "Удалить слот?",
    description: `${formatDate(slot.date)} в ${slot.time} будет безвозвратно удалён из расписания.`,
    confirmLabel: "Удалить слот",
    danger: true,
    action: async () => {
      await request("/api/admin/slots", { method: "DELETE", body: JSON.stringify({ date: slot.date, time: slot.time }) });
      notify("Слот удалён.");
      await loadSchedule();
    },
  }), [ask, request, notify, loadSchedule]);

  const handleScheduleCsv = useCallback(() => {
    const rows = schedule.map((slot) => ({
      date: slot.displayDate || formatDate(slot.date, { day: "2-digit", month: "2-digit", year: "numeric" }),
      time: slot.time,
      duration: slot.duration || "",
      status: slot.status,
      student: slot.student || "",
      email: slot.email || "",
      phone: slot.phone || "",
      subject: slot.subject || "",
    }));
    downloadCsv("schedule.csv", ["date", "time", "duration", "status", "student", "email", "phone", "subject"], rows);
    notify("CSV-файл расписания подготовлен.");
  }, [schedule, notify]);

  const renderView = () => {
    const common = { request, notify, ask };
    if (view === "bookings") return <BookingsView bookings={bookings} state={bookingsState} onRefresh={refreshBookings} onStatus={changeBookingStatus} onExport={() => {
      downloadCsv("bookings.csv", ["id", "createdAt", "date", "time", "subject", "name", "email", "phone", "grade", "comment", "status", "source"], bookings);
      notify("CSV-файл заявок подготовлен.");
    }} />;
    if (view === "slots") return <SlotsView {...common} onScheduleChanged={() => loadSchedule().catch(() => {})} />;
    if (view === "students") return <StudentsView {...common} students={students} state={studentsState} onReload={refreshStudents} />;
    if (view === "tests") return <TestsView {...common} students={students} ensureStudents={ensureStudents} />;
    if (view === "tg") return <TelegramView {...common} />;
    if (view === "settings") return <SettingsView {...common} onSaved={(settings) => setConfig((current) => ({ ...current, ...settings }))} />;
    if (view === "help") return <HelpView />;
    return <ScheduleView
      range={scheduleRange}
      loadedRange={loadedRange}
      onRangeChange={setScheduleRange}
      schedule={schedule}
      state={scheduleState}
      statusFilter={scheduleStatus}
      onStatusFilter={setScheduleStatus}
      onLoad={() => loadSchedule().catch(() => {})}
      onOpenCalendar={() => setCalendarOpen(true)}
      onExport={handleScheduleCsv}
      onCleanup={() => ask({
        title: "Очистить прошедшие слоты?",
        description: "Все слоты до сегодняшней даты будут удалены. Это действие нельзя отменить.",
        confirmLabel: "Очистить прошедшие",
        danger: true,
        action: async () => {
          const data = await request("/api/admin/cleanup-past", { method: "POST" });
          notify(`Удалено прошедших слотов: ${data.deleted || 0}.`);
          await loadSchedule();
        },
      })}
      onClearRange={(from, to, mode) => ask({
        title: mode === "close" ? "Закрыть диапазон?" : "Удалить диапазон?",
        description: mode === "close"
          ? `Свободные слоты с ${formatDate(from)} по ${formatDate(to)} будут закрыты для записи.`
          : `Все слоты с ${formatDate(from)} по ${formatDate(to)} будут удалены.`,
        confirmLabel: mode === "close" ? "Закрыть слоты" : "Удалить слоты",
        danger: mode !== "close",
        action: async () => {
          const data = await request("/api/admin/clear-range", { method: "POST", body: JSON.stringify({ from, to, mode }) });
          notify(`${mode === "close" ? "Закрыто" : "Удалено"} слотов: ${data.affected || 0}.`);
          await loadSchedule();
        },
      })}
      onSlotStatus={updateSlot}
      onFreeBooked={freeBookedSlot}
      onDeleteSlot={deleteSlot}
    />;
  };

  if (screen === "boot") return <AdminBoot />;
  if (screen !== "ready") return <AdminLogin config={config} error={loginError} busy={loginBusy} onSubmit={authenticate} theme={theme} onTheme={() => setTheme((value) => value === "dark" ? "light" : "dark")} />;

  return <div className="admin-page-shell">
    <AdminShell config={config} view={view} onNavigate={navigate} theme={theme} onTheme={() => setTheme((value) => value === "dark" ? "light" : "dark")} onSignOut={() => signOut()}>{renderView()}</AdminShell>
    <ScheduleCalendarModal
      open={calendarOpen}
      onClose={() => setCalendarOpen(false)}
      schedule={schedule}
      statusFilter={scheduleStatus}
      month={calendarMonth}
      onMonth={setCalendarMonth}
      selected={calendarSelection}
      onSelected={setCalendarSelection}
      onSlotStatus={updateSlot}
      onFreeBooked={freeBookedSlot}
      onDeleteSlot={deleteSlot}
      range={loadedRange}
    />
    <ConfirmDialog task={confirmTask} busy={confirmBusy} onCancel={() => setConfirmTask(null)} onConfirm={runConfirm} />
    <ToastStack items={toasts} />
  </div>;
}

function AdminBoot() {
  return <main className="adm-auth-page"><div className="ambient ambient-a" /><div className="ambient ambient-b" /><div className="adm-boot glass"><BrandMark /><LoaderCircle className="spin" size={24} /><div><b>Открываем кабинет преподавателя</b><small>Проверяем защищённую сессию</small></div></div></main>;
}

function AdminLogin({ config, error, busy, onSubmit, theme, onTheme }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const submit = (event) => { event.preventDefault(); onSubmit(password); };
  return <main className="adm-auth-page">
    <div className="ambient ambient-a" /><div className="ambient ambient-b" /><div className="ambient ambient-c" />
    <header className="adm-auth-top"><a href="/" className="brand-lockup"><BrandMark /><span>{config.tutorName || "Онлайн-уроки"}</span></a><IconButton label={theme === "dark" ? "Светлая тема" : "Тёмная тема"} onClick={onTheme}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</IconButton></header>
    <section className="adm-login-card glass">
      <div className="adm-login-emblem"><ShieldCheck size={30} /></div>
      <span className="eyebrow"><LockKeyhole size={13} /> Только для преподавателя</span>
      <h1>Панель управления<br /><i>без лишнего.</i></h1>
      <p>Расписание, ученики, тесты и диалоги — в одном спокойном рабочем пространстве.</p>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="admin-password">Пароль администратора</label>
        <div className="password-field"><KeyRound size={18} /><input id="admin-password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Введите пароль" autoFocus /><button type="button" aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Скрыть" : "Показать"}</button></div>
        {error && <div className="adm-form-error"><CircleAlert size={15} />{error}</div>}
        <button className="button button-primary adm-login-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}Войти в кабинет</button>
      </form>
      <footer><span><Check size={14} /> Защищённое соединение</span><span><Check size={14} /> Сессия хранится только в браузере</span></footer>
    </section>
    <p className="adm-auth-foot">Рабочее пространство преподавателя · {new Date().getFullYear()}</p>
  </main>;
}

function AdminShell({ config, view, onNavigate, theme, onTheme, onSignOut, children }) {
  const current = NAV_ITEMS.find(([id]) => id === view) || NAV_ITEMS[0];
  return <>
    <div className="admin-aurora" aria-hidden="true"><span /><span /><span /></div>
    <header className="adm-topbar">
      <a href="/" className="brand-lockup"><BrandMark /><span>{config.tutorName || "Онлайн-уроки"}</span><em>admin</em></a>
      <div className="adm-top-actions"><span className={`adm-storage ${config.storage === "sheets" ? "online" : "demo"}`}><Database size={14} />{config.storage === "sheets" ? "Google Sheets" : "Демо-хранилище"}</span>{config.sheetUrl && <a className="icon-button" href={config.sheetUrl} target="_blank" rel="noreferrer" aria-label="Открыть таблицу" title="Открыть таблицу"><ExternalLink size={17} /></a>}<IconButton label={theme === "dark" ? "Светлая тема" : "Тёмная тема"} onClick={onTheme}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</IconButton><button className="adm-signout" type="button" onClick={onSignOut}><LogOut size={16} /><span>Выйти</span></button></div>
    </header>
    <div className="adm-layout">
      <aside className="adm-sidebar glass">
        <div className="adm-side-intro"><span>Управление</span><b>Добрый день</b><small>Всё важное — здесь и сейчас.</small></div>
        <nav aria-label="Разделы админ-панели">{NAV_ITEMS.map(([id, Icon, label, hint]) => <button type="button" key={id} className={view === id ? "active" : ""} onClick={() => onNavigate(id)}><Icon size={18} /><span><b>{label}</b><small>{hint}</small></span>{view === id && <i />}</button>)}</nav>
        <div className="adm-side-tip"><Sparkles size={15} /><span>Изменения сохраняются сразу после подтверждения.</span></div>
      </aside>
      <div className="adm-workspace">
        <nav className="adm-mobile-nav" aria-label="Разделы админ-панели">{NAV_ITEMS.map(([id, Icon, label]) => <button type="button" key={id} className={view === id ? "active" : ""} onClick={() => onNavigate(id)}><Icon size={17} /><span>{label}</span></button>)}</nav>
        <div className="adm-context"><span><LayoutDashboard size={14} /> Панель преподавателя</span><ChevronRight size={14} /><b>{current[2]}</b></div>
        {children}
      </div>
    </div>
  </>;
}

function PageHeader({ eyebrow, title, accent, description, actions }) {
  return <header className="adm-page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title} {accent && <i>{accent}</i>}</h1>{description && <p>{description}</p>}</div>{actions && <div className="adm-page-actions">{actions}</div>}</header>;
}

function ScheduleView({ range, loadedRange, onRangeChange, schedule, state, statusFilter, onStatusFilter, onLoad, onOpenCalendar, onExport, onCleanup, onClearRange, onSlotStatus, onFreeBooked, onDeleteSlot }) {
  const filtered = useMemo(() => schedule.filter((slot) => statusFilter === "all" || slot.status === statusFilter), [schedule, statusFilter]);
  const days = useMemo(() => Object.entries(filtered.reduce((result, slot) => {
    (result[slot.date] ||= []).push(slot);
    return result;
  }, {})).sort(([a], [b]) => a.localeCompare(b)), [filtered]);
  const counts = useMemo(() => schedule.reduce((result, slot) => ({ ...result, [slot.status]: (result[slot.status] || 0) + 1 }), {}), [schedule]);
  const [clearFrom, setClearFrom] = useState(range.from);
  const [clearTo, setClearTo] = useState(range.to);

  useEffect(() => { setClearFrom(range.from); setClearTo(range.to); }, [range.from, range.to]);

  const clear = (mode) => {
    if (!clearFrom || !clearTo || clearTo < clearFrom) return;
    onClearRange(clearFrom, clearTo, mode);
  };

  return <section className="adm-page">
    <PageHeader eyebrow="Календарь занятий" title="Расписание" accent="в фокусе." description="Смотрите загрузку, меняйте доступность и держите ближайшие уроки под контролем." actions={<><button className="button button-quiet" type="button" onClick={onExport} disabled={!schedule.length}><Download size={16} />CSV</button><button className="button button-primary" type="button" onClick={onOpenCalendar}><CalendarDays size={16} />Календарь</button></>} />
    <section className="adm-metric-grid">
      <Metric icon={<CalendarDays size={19} />} label="Всего в диапазоне" value={schedule.length} hint={loadedRange.from ? `${formatDate(loadedRange.from)} — ${formatDate(loadedRange.to)}` : "Выберите даты"} />
      <Metric icon={<Sparkles size={19} />} label="Свободные окна" value={counts.open || 0} hint="Доступны для записи" tone="mint" />
      <Metric icon={<UsersRound size={19} />} label="Занятые слоты" value={counts.booked || 0} hint="Ожидают урока" tone="violet" />
      <Metric icon={<LockKeyhole size={19} />} label="Закрытые" value={counts.closed || 0} hint="Скрыты от записи" tone="orange" />
    </section>
    <section className="adm-control-card glass">
      <form className="adm-range-form" onSubmit={(event) => { event.preventDefault(); onLoad(); }}>
        <div><label className="field-label" htmlFor="schedule-from">Период</label><div className="adm-date-pair"><input id="schedule-from" type="date" value={range.from} onChange={(event) => onRangeChange((current) => ({ ...current, from: event.target.value }))} /><span>—</span><input type="date" aria-label="Конец периода" value={range.to} onChange={(event) => onRangeChange((current) => ({ ...current, to: event.target.value }))} /></div></div>
        <button className="button button-primary" type="submit" disabled={state.loading}>{state.loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}Показать</button>
      </form>
      <div className="adm-filter-row"><span>Показывать</span>{[["all", "Все"], ["open", "Свободные"], ["booked", "Занятые"], ["closed", "Закрытые"]].map(([value, label]) => <button type="button" key={value} className={statusFilter === value ? "active" : ""} onClick={() => onStatusFilter(value)}>{label}{value !== "all" && <b>{counts[value] || 0}</b>}</button>)}</div>
    </section>
    <section className="adm-schedule-area">
      {state.loading && <LoadingPanel label="Собираем ваше расписание" />}
      {!state.loading && state.error && <InlineError onRetry={onLoad}>{state.error}</InlineError>}
      {!state.loading && !state.error && !days.length && <EmptyState icon={<CalendarDays size={28} />} title={schedule.length ? "В этом фильтре пусто" : "Пока нет слотов"} text={schedule.length ? "Выберите другой статус, чтобы увидеть остальные слоты." : "Добавьте первое окно для записи или сгенерируйте рабочую неделю."} />}
      {!state.loading && !state.error && days.length > 0 && <div className="adm-schedule-list">{days.map(([date, slots]) => <section className="adm-day-card glass" id={`day-${date}`} key={date}><header><div><span>{formatDate(date, { weekday: "short" })}</span><h2>{titleCase(dayTitle(date))}</h2></div><b>{slots.length} {slots.length === 1 ? "слот" : "слотов"}</b></header><div className="adm-slot-list">{slots.map((slot) => <ScheduleSlotCard key={`${slot.date}-${slot.time}`} slot={slot} onSlotStatus={onSlotStatus} onFreeBooked={onFreeBooked} onDeleteSlot={onDeleteSlot} />)}</div></section>)}</div>}
    </section>
    <details className="adm-danger-zone glass"><summary><span><Trash2 size={17} /> Управление очисткой</span><ChevronDown size={17} /></summary><div className="adm-danger-content"><div><h3>Удалить диапазон слотов</h3><p>Удаляет все слоты, попадающие в выбранные даты. Это нельзя отменить.</p><div className="adm-date-pair compact"><input type="date" value={clearFrom} onChange={(event) => setClearFrom(event.target.value)} /><span>—</span><input type="date" value={clearTo} onChange={(event) => setClearTo(event.target.value)} /></div><div className="adm-inline-actions"><button className="button button-quiet" type="button" disabled={!clearFrom || !clearTo || clearTo < clearFrom} onClick={() => clear("close")}><LockKeyhole size={16} />Закрыть слоты</button><button className="button adm-danger-button" type="button" disabled={!clearFrom || !clearTo || clearTo < clearFrom} onClick={() => clear("delete")}><Trash2 size={16} />Удалить слоты</button></div></div><div><h3>Убрать прошлые даты</h3><p>Быстрый способ оставить в базе только актуальные окна.</p><button className="button button-quiet" type="button" onClick={onCleanup}><RotateCcw size={16} />Очистить прошедшие</button></div></div></details>
  </section>;
}

function Metric({ icon, label, value, hint, tone = "blue" }) {
  return <article className={`adm-metric glass ${tone}`}><span>{icon}</span><div><small>{label}</small><b>{value}</b><em>{hint}</em></div></article>;
}

function ScheduleSlotCard({ slot, onSlotStatus, onFreeBooked, onDeleteSlot, compact = false }) {
  const meta = slotMeta(slot.status);
  const run = (callback, ...args) => { Promise.resolve(callback(...args)).catch(() => {}); };
  return <article className={`adm-slot-card ${meta.tone} ${compact ? "compact" : ""}`}><div className="adm-slot-time"><Clock3 size={16} /><b>{slot.time}</b>{slot.duration && <small>{slot.duration} мин</small>}</div><StatusPill status={slot.status} kind="slot" /><div className="adm-slot-person">{slot.student || slot.phone || slot.email ? <><b>{slot.student || "Занятой слот"}</b><span>{slot.phone || slot.email || "Запись подтверждается"}{slot.subject ? ` · ${slot.subject}` : ""}</span></> : <span>Время свободно для записи</span>}</div><div className="adm-slot-actions">{slot.status === "open" && <><button type="button" onClick={() => run(onSlotStatus, slot, "closed")}>Закрыть</button><IconButton label="Удалить слот" className="danger" onClick={() => onDeleteSlot(slot)}><Trash2 size={15} /></IconButton></>}{slot.status === "closed" && <><button type="button" onClick={() => run(onSlotStatus, slot, "open")}>Открыть</button><IconButton label="Удалить слот" className="danger" onClick={() => onDeleteSlot(slot)}><Trash2 size={15} /></IconButton></>}{slot.status === "booked" && <><button type="button" onClick={() => onFreeBooked(slot)}>Освободить</button><IconButton label="Удалить слот" className="danger" onClick={() => onDeleteSlot(slot)}><Trash2 size={15} /></IconButton></>}</div></article>;
}

function ScheduleCalendarModal({ open, onClose, schedule, statusFilter, month, onMonth, selected, onSelected, onSlotStatus, onFreeBooked, onDeleteSlot, range }) {
  const filtered = useMemo(() => schedule.filter((slot) => statusFilter === "all" || slot.status === statusFilter), [schedule, statusFilter]);
  const byDate = useMemo(() => filtered.reduce((result, slot) => { (result[slot.date] ||= []).push(slot); return result; }, {}), [filtered]);
  const selectedSlots = byDate[selected] || [];
  const start = new Date(month.year, month.month, 1);
  const leading = (start.getDay() + 6) % 7;
  const total = new Date(month.year, month.month + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((leading + total) / 7) * 7 }, (_, index) => {
    const day = index - leading + 1;
    if (day < 1 || day > total) return null;
    return `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  });
  const changeMonth = (delta) => {
    const date = new Date(month.year, month.month + delta, 1);
    onMonth({ year: date.getFullYear(), month: date.getMonth() });
  };
  const goToday = () => {
    const now = new Date();
    onMonth({ year: now.getFullYear(), month: now.getMonth() });
    onSelected(isoToday());
  };
  const goToList = () => {
    onClose();
    window.setTimeout(() => document.getElementById(`day-${selected}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };
  if (!open) return null;
  return <Modal title="Календарь расписания" onClose={onClose} wide className="adm-calendar-modal">
    <div className="adm-calendar-top"><div><small>{range.from ? `${formatDate(range.from)} — ${formatDate(range.to)}` : "Загруженный период"}</small><h3>{new Date(month.year, month.month, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</h3></div><div><button className="button button-quiet adm-calendar-today" type="button" onClick={goToday}>Сегодня</button><IconButton label="Предыдущий месяц" onClick={() => changeMonth(-1)}><ChevronLeft size={18} /></IconButton><IconButton label="Следующий месяц" onClick={() => changeMonth(1)}><ChevronRight size={18} /></IconButton></div></div>
    <div className="adm-calendar-weekdays">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="adm-calendar-grid">{cells.map((iso, index) => iso ? <button key={iso} type="button" className={`${iso === selected ? "selected" : ""} ${iso === isoToday() ? "today" : ""} ${byDate[iso]?.some((slot) => slot.status === "booked") ? "has-booked" : ""}`} onClick={() => onSelected(iso)}><b>{Number(iso.slice(-2))}</b><span>{(byDate[iso] || []).map((slot) => <i key={`${slot.date}-${slot.time}`} className={slot.status} />)}</span></button> : <span key={`blank-${index}`} className="blank" />)}</div>
    <div className="adm-calendar-selection"><div><span className="eyebrow">Выбранный день</span><h3>{titleCase(dayTitle(selected))}</h3></div>{selectedSlots.length ? <div className="adm-slot-list">{selectedSlots.map((slot) => <ScheduleSlotCard compact key={`${slot.date}-${slot.time}`} slot={slot} onSlotStatus={onSlotStatus} onFreeBooked={onFreeBooked} onDeleteSlot={onDeleteSlot} />)}</div> : <p>В загруженном диапазоне на этот день нет слотов.</p>}<div className="adm-calendar-actions"><button className="button button-quiet" type="button" disabled={!selectedSlots.length} onClick={goToList}>Перейти к дню в списке</button><button className="button button-primary" type="button" onClick={onClose}>Готово</button></div></div>
  </Modal>;
}

function BookingsView({ bookings, state, onRefresh, onStatus, onExport }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => bookings.filter((booking) => {
    const matchesStatus = filter === "all" || booking.status === filter;
    const haystack = `${booking.name || ""} ${booking.phone || ""} ${booking.contact || ""} ${booking.date || ""} ${booking.time || ""}`.toLowerCase();
    return matchesStatus && haystack.includes(query.trim().toLowerCase());
  }), [bookings, filter, query]);
  const active = bookings.filter((booking) => !["cancelled", "done"].includes(booking.status)).length;
  return <section className="adm-page">
    <PageHeader eyebrow="Входящие заявки" title="Записи" accent="учеников." description="Подтверждайте удобные времена и сразу видьте, с кем связаться." actions={<><button className="button button-quiet" type="button" onClick={() => onRefresh().catch(() => {})} disabled={state.loading}>{state.loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}Обновить</button><button className="button button-primary" type="button" onClick={onExport} disabled={!bookings.length}><Download size={16} />CSV</button></>} />
    <section className="adm-booking-summary glass"><div><span><Zap size={16} /> В работе</span><b>{active}</b><p>активных заявок</p></div><div><span><Clock3 size={16} /> Новые</span><b>{bookings.filter((item) => item.status === "new").length}</b><p>ждут вашего решения</p></div><div><span><CheckCircle2 size={16} /> Всего</span><b>{bookings.length}</b><p>за всё время</p></div></section>
    <section className="adm-list-toolbar glass"><label className="adm-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, телефон, дата…" /></label><div className="adm-filter-row">{[["all", "Все"], ["new", "Новые"], ["confirmed", "Подтверждённые"], ["done", "Завершённые"], ["cancelled", "Отменённые"]].map(([value, label]) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div></section>
    {state.loading && <LoadingPanel label="Обновляем заявки" />}
    {!state.loading && state.error && <InlineError onRetry={() => onRefresh().catch(() => {})}>{state.error}</InlineError>}
    {!state.loading && !state.error && !visible.length && <EmptyState icon={<ListTodo size={28} />} title={bookings.length ? "Ничего не найдено" : "Заявок пока нет"} text={bookings.length ? "Измените фильтр или поисковый запрос." : "Когда ученик выберет время на сайте, его запись появится здесь."} />}
    {!state.loading && !state.error && visible.length > 0 && <div className="adm-booking-list">{visible.map((booking) => <BookingCard key={booking.id} booking={booking} onStatus={onStatus} />)}</div>}
  </section>;
}

function BookingCard({ booking, onStatus }) {
  const phone = String(booking.phone || "");
  const learning = [booking.grade, booking.subject].filter(Boolean).join(" · ");
  return <article className="adm-booking-card glass"><div className="adm-booking-date"><b>{booking.date || formatDate(booking.iso)}</b><span>{booking.time || "—"}</span><small>{booking.duration ? `${booking.duration} мин` : booking.source || "site"}</small></div><div className="adm-booking-person"><span>{String(booking.name || "У").trim().charAt(0).toUpperCase()}</span><div><h2>{booking.name || "Без имени"}</h2><a href={`tel:${phone}`}>{phone || "Телефон не указан"}</a>{(booking.contact || booking.email) && <small>{booking.contact || booking.email}</small>}{learning && <small>{learning}</small>}{booking.comment && <small>💬 {booking.comment}</small>}</div></div><div className="adm-booking-status"><StatusPill status={booking.status} /><small>#{booking.id}</small></div><div className="adm-booking-actions">{booking.status === "new" && <button className="button button-primary" type="button" onClick={() => onStatus(booking, "confirmed")}><Check size={15} />Подтвердить</button>}{["new", "confirmed"].includes(booking.status) && <button className="button button-quiet" type="button" onClick={() => onStatus(booking, "done")}>Завершить</button>}{!["cancelled", "done"].includes(booking.status) && <button className="button adm-danger-text" type="button" onClick={() => onStatus(booking, "cancelled")}>Отменить</button>}</div></article>;
}

function SlotsView({ request, notify, onScheduleChanged }) {
  const [single, setSingle] = useState({ date: isoToday(), time: "17:00", duration: "50" });
  const [generator, setGenerator] = useState({
    from: isoToday(), to: isoMonthForward(), wdFrom: "16:00", wdTo: "20:00", weFrom: "10:00", weTo: "13:00", duration: "50", step: "60", keepExisting: true, times: "",
  });
  const [singleBusy, setSingleBusy] = useState(false);
  const [generatorBusy, setGeneratorBusy] = useState(false);
  const addOne = async (event) => {
    event.preventDefault();
    if (!single.date || !single.time) return;
    setSingleBusy(true);
    try {
      await request("/api/admin/slots", { method: "POST", body: JSON.stringify({ date: single.date, time: single.time, duration: number(single.duration, 50) }) });
      notify(`Слот ${formatDate(single.date)} в ${single.time} добавлен.`);
      onScheduleChanged();
    } catch (error) { notify(safeError(error), "error"); } finally { setSingleBusy(false); }
  };
  const generate = async (event) => {
    event.preventDefault();
    if (!generator.from || !generator.to || generator.to < generator.from) {
      notify("Выберите корректный диапазон дат.", "error");
      return;
    }
    const times = generator.times.split(",").map((item) => item.trim()).filter(Boolean);
    setGeneratorBusy(true);
    try {
      const data = await request("/api/admin/generate", { method: "POST", body: JSON.stringify({
        from: generator.from, to: generator.to, wdFrom: generator.wdFrom, wdTo: generator.wdTo,
        weFrom: generator.weFrom, weTo: generator.weTo, duration: number(generator.duration, 50),
        step: number(generator.step, 60), keepExisting: generator.keepExisting, times,
      }) });
      notify(`Готово: добавлено слотов — ${data.added || 0}.`);
      onScheduleChanged();
    } catch (error) { notify(safeError(error), "error"); } finally { setGeneratorBusy(false); }
  };
  const setGen = (field, value) => setGenerator((current) => ({ ...current, [field]: value }));
  return <section className="adm-page">
    <PageHeader eyebrow="Доступность для записи" title="Создайте" accent="окна." description="Добавьте одно время вручную или соберите привычный ритм занятий сразу на весь период." />
    <div className="adm-slot-builder-grid"><form className="adm-builder-card glass" onSubmit={addOne}><div className="adm-builder-icon blue"><Plus size={21} /></div><span className="eyebrow">Точечное добавление</span><h2>Один удобный слот</h2><p>Подходит для переноса урока или редкого дополнительного окна.</p><label className="field-label">Дата</label><input type="date" value={single.date} onChange={(event) => setSingle((current) => ({ ...current, date: event.target.value }))} required /><label className="field-label">Время начала</label><input type="time" value={single.time} onChange={(event) => setSingle((current) => ({ ...current, time: event.target.value }))} required /><label className="field-label">Длительность, мин</label><input type="number" min="15" max="240" step="5" value={single.duration} onChange={(event) => setSingle((current) => ({ ...current, duration: event.target.value }))} required /><button className="button button-primary" type="submit" disabled={singleBusy}>{singleBusy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Добавить слот</button></form>
      <form className="adm-builder-card wide glass" onSubmit={generate}><div className="adm-builder-icon purple"><WandSparkles size={21} /></div><span className="eyebrow">Умное заполнение</span><h2>Регулярное расписание</h2><p>По умолчанию будни и выходные имеют разные временные окна. Сервис не создаст дубликаты, если оставить защиту включённой.</p><div className="adm-form-grid two"><label><span className="field-label">С даты</span><input type="date" value={generator.from} onChange={(event) => setGen("from", event.target.value)} required /></label><label><span className="field-label">По дату</span><input type="date" value={generator.to} onChange={(event) => setGen("to", event.target.value)} required /></label></div><div className="adm-generation-windows"><section><span><CalendarDays size={16} /> Будни · Пн–Пт</span><div><label><small>С</small><input type="time" value={generator.wdFrom} onChange={(event) => setGen("wdFrom", event.target.value)} /></label><label><small>До</small><input type="time" value={generator.wdTo} onChange={(event) => setGen("wdTo", event.target.value)} /></label></div></section><section><span><Sparkles size={16} /> Выходные · Сб–Вс</span><div><label><small>С</small><input type="time" value={generator.weFrom} onChange={(event) => setGen("weFrom", event.target.value)} /></label><label><small>До</small><input type="time" value={generator.weTo} onChange={(event) => setGen("weTo", event.target.value)} /></label></div></section></div><label><span className="field-label">Точные времена <small>необязательно</small></span><input value={generator.times} onChange={(event) => setGen("times", event.target.value)} placeholder="Например: 10:00, 12:30, 17:00" /><small className="adm-field-hint">Если заполнить это поле, указанные времена будут использоваться каждый день вместо окон будней и выходных.</small></label><div className="adm-form-grid two"><label><span className="field-label">Длительность, мин</span><input type="number" min="15" max="240" step="5" value={generator.duration} onChange={(event) => setGen("duration", event.target.value)} required /></label><label><span className="field-label">Шаг между слотами, мин</span><input type="number" min="15" max="240" step="5" value={generator.step} onChange={(event) => setGen("step", event.target.value)} required /></label></div><label className="adm-check-line"><input type="checkbox" checked={generator.keepExisting} onChange={(event) => setGen("keepExisting", event.target.checked)} />Не изменять уже созданные слоты</label><button className="button button-primary" type="submit" disabled={generatorBusy}>{generatorBusy ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />}Сгенерировать слоты</button></form></div>
    <section className="adm-info-strip glass"><Info size={18} /><div><b>Безопасное повторение</b><span>При включённой защите существующие дата и время сохранятся как есть. Запускайте генератор для новых недель без риска стереть записи учеников.</span></div></section>
  </section>;
}

function StudentsView({ request, notify, ask, students, state, onReload }) {
  const [query, setQuery] = useState("");
  const [selectedPhone, setSelectedPhone] = useState("");
  const [draft, setDraft] = useState(null);
  const [notes, setNotes] = useState([]);
  const [notesState, setNotesState] = useState({ loading: false, error: "" });
  const [noteDraft, setNoteDraft] = useState({ type: "homework", text: "", link: "", sendCab: true, sendTg: false });
  const [saveBusy, setSaveBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [topicsModal, setTopicsModal] = useState(null);
  const [topicsCatalog, setTopicsCatalog] = useState({});
  const [topicsSource, setTopicsSource] = useState("");
  const [topicsLoading, setTopicsLoading] = useState(false);

  const visible = useMemo(() => students.filter((student) => `${student.name || ""} ${student.phone || ""} ${student.grade || ""} ${student.subject || ""}`.toLowerCase().includes(query.trim().toLowerCase())), [students, query]);
  const selected = useMemo(() => students.find((student) => student.phone === selectedPhone) || visible[0] || students[0] || null, [students, selectedPhone, visible]);

  useEffect(() => {
    if (selected && selected.phone !== selectedPhone) setSelectedPhone(selected.phone);
  }, [selected, selectedPhone]);

  useEffect(() => {
    if (!selected) { setDraft(null); return; }
    setDraft({ phone: selected.phone || "", name: selected.name || "", grade: selected.grade || "", subject: selected.subject || "", chat_id: selected.chat_id || "", topics: selected.topics || "", notes: selected.notes || "" });
    setNoteDraft({ type: "homework", text: "", link: "", sendCab: true, sendTg: Boolean(selected.chat_id) });
  }, [selected?.phone, selected?.name, selected?.grade, selected?.subject, selected?.chat_id, selected?.topics, selected?.notes]);

  const loadNotes = useCallback(async (phone) => {
    if (!phone) return;
    setNotesState({ loading: true, error: "" });
    try {
      const data = await request(`/api/admin/students/notes?phone=${encodeURIComponent(phone)}`);
      setNotes(Array.isArray(data.notes) ? data.notes : []);
      setNotesState({ loading: false, error: "" });
    } catch (error) { setNotesState({ loading: false, error: safeError(error) }); }
  }, [request]);

  useEffect(() => { if (selected?.phone) loadNotes(selected.phone); }, [selected?.phone, loadNotes]);

  const chooseStudent = (phone) => { setSelectedPhone(phone); setTopicsModal(null); };
  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const save = async (event) => {
    event.preventDefault();
    if (!draft?.phone) return;
    setSaveBusy(true);
    try {
      const data = await request("/api/admin/students", { method: "PUT", body: JSON.stringify(draft) });
      const renamed = number(data.renamed);
      notify(renamed ? `Карточка сохранена. Имя обновлено в ${renamed} записях.` : "Карточка ученика сохранена.");
      await onReload({ silent: true });
    } catch (error) { notify(safeError(error), "error"); } finally { setSaveBusy(false); }
  };
  const loadTopicPicker = async () => {
    if (!draft) return;
    setTopicsModal({ selection: parseTopics(draft.topics) });
    setTopicsLoading(true);
    try {
      const data = await request("/api/admin/topics");
      setTopicsCatalog(data.catalog || {});
      setTopicsSource(data.source || "");
    } catch (error) { notify(safeError(error), "error"); } finally { setTopicsLoading(false); }
  };
  const sendNote = async (event) => {
    event.preventDefault();
    if (!selected || (!noteDraft.text.trim() && !noteDraft.link.trim())) { notify("Введите текст сообщения или ссылку.", "error"); return; }
    if (!noteDraft.sendCab && !noteDraft.sendTg) { notify("Выберите, куда отправить сообщение.", "error"); return; }
    setSendBusy(true);
    try {
      const data = await request("/api/admin/students/notes", { method: "POST", body: JSON.stringify({ phone: selected.phone, ...noteDraft }) });
      let text = "Сообщение сохранено в кабинете.";
      if (!noteDraft.sendCab) text = data.tg === "sent" ? "Сообщение отправлено в Telegram." : "Не удалось доставить сообщение в Telegram.";
      else if (data.tg === "sent") text = "Сообщение отправлено в кабинет и Telegram.";
      else if (data.tg === "no-chat") text = "Сообщение сохранено в кабинете — Telegram пока не привязан.";
      notify(text, data.tg === "failed" ? "error" : "success");
      setNoteDraft((current) => ({ ...current, text: "", link: "" }));
      loadNotes(selected.phone);
    } catch (error) { notify(safeError(error), "error"); } finally { setSendBusy(false); }
  };
  const deleteNote = (note) => ask({ title: "Удалить сообщение?", description: "Сообщение исчезнет из кабинета ученика. Отправленное сообщение в Telegram удалить нельзя.", confirmLabel: "Удалить сообщение", danger: true, action: async () => { await request("/api/admin/students/notes", { method: "DELETE", body: JSON.stringify({ id: note.id }) }); notify("Сообщение удалено из кабинета."); await loadNotes(selected.phone); } });

  return <section className="adm-page">
    <PageHeader eyebrow="Карточки и коммуникация" title="Ваши" accent="ученики." description="Храните учебный контекст, темы и материалы в одной понятной карточке." actions={<button className="button button-quiet" type="button" onClick={() => onReload().catch(() => {})} disabled={state.loading}>{state.loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}Обновить</button>} />
    {state.loading && !students.length && <LoadingPanel label="Собираем карточки учеников" />}
    {state.error && !students.length && <InlineError onRetry={() => onReload().catch(() => {})}>{state.error}</InlineError>}
    {!state.loading && !state.error && !students.length && <EmptyState icon={<UsersRound size={29} />} title="Учеников пока нет" text="Карточка появится автоматически после первой заявки на урок." />}
    {students.length > 0 && <div className="adm-students-layout"><aside className="adm-student-list glass"><div className="adm-student-list-head"><div><b>Ученики</b><span>{students.length} всего</span></div><label className="adm-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти ученика" /></label></div><div className="adm-student-scroll">{visible.map((student) => <button type="button" key={student.phone} className={selected?.phone === student.phone ? "active" : ""} onClick={() => chooseStudent(student.phone)}><span>{String(student.name || "У").trim().charAt(0).toUpperCase()}</span><div><b>{student.name || "Без имени"}{student.chat_id && <em title="Telegram привязан">✈</em>}</b><small>{student.phone}{student.grade ? ` · ${student.grade}` : ""}</small><i>уроков: {student.stats?.done || 0} · впереди: {student.stats?.upcoming || 0}</i></div></button>)}{!visible.length && <p className="adm-small-empty">Поиск ничего не нашёл.</p>}</div></aside>
      {selected && draft && <article className="adm-student-detail"><header className="adm-student-hero glass"><div className="adm-avatar">{String(selected.name || "У").trim().charAt(0).toUpperCase()}</div><div><span className="eyebrow">Карточка ученика</span><h2>{selected.name || "Без имени"}</h2><p><a href={`tel:${selected.phone}`}>{selected.phone}</a>{selected.tg && selected.tg !== "@" ? ` · ${selected.tg}` : ""}{selected.chat_id ? " · Telegram привязан" : " · Telegram не привязан"} · <a href={`/cabinet?phone=${encodeURIComponent(selected.phone)}`} target="_blank" rel="noreferrer">кабинет ↗</a></p></div></header><div className="adm-student-stats">{[[selected.stats?.done || 0, "проведено"], [selected.stats?.upcoming || 0, "впереди"], [selected.stats?.cancelled || 0, "отменено"], [selected.stats?.lastDone ? formatDate(selected.stats.lastDone, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—", "последний урок"]].map(([value, label]) => <div key={label} className="glass"><b>{value}</b><span>{label}</span></div>)}</div>
        <form className="adm-detail-card glass" onSubmit={save}><div className="adm-section-title"><div><span className="eyebrow">Учебный профиль</span><h3>Контекст занятий</h3></div><UserRound size={19} /></div><div className="adm-form-grid two"><label><span className="field-label">ФИО ученика</span><input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} /></label><label><span className="field-label">Класс</span><input value={draft.grade} onChange={(event) => updateDraft("grade", event.target.value)} placeholder="Например, 7 класс" /></label><label><span className="field-label">Предмет</span><input value={draft.subject} onChange={(event) => updateDraft("subject", event.target.value)} placeholder="Математика" /></label><label><span className="field-label">Chat ID Telegram</span><input value={draft.chat_id} onChange={(event) => updateDraft("chat_id", event.target.value)} placeholder="Появится после /start + номер" /></label></div><label><span className="field-label">Пройденные темы <small>видит ученик</small></span><textarea rows="4" value={draft.topics} onChange={(event) => updateDraft("topics", event.target.value)} placeholder="Можно выбрать из каталога или написать вручную" /></label><div className="adm-inline-actions"><button type="button" className="button button-quiet" onClick={loadTopicPicker}><BookOpen size={16} />Выбрать из списка</button><span>Темы отображаются в кабинете ученика.</span></div><label><span className="field-label">Заметки для себя <small>ученик не видит</small></span><textarea rows="3" value={draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} /></label><div className="adm-form-submit"><button className="button button-primary" type="submit" disabled={saveBusy}>{saveBusy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Сохранить карточку</button></div></form>
        <form className="adm-detail-card glass" onSubmit={sendNote}><div className="adm-section-title"><div><span className="eyebrow">Связь с учеником</span><h3>Отправить материал</h3></div><Send size={19} /></div><div className="adm-form-grid two"><label><span className="field-label">Тип</span><select value={noteDraft.type} onChange={(event) => setNoteDraft((current) => ({ ...current, type: event.target.value }))}><option value="homework">📝 Домашнее задание</option><option value="info">ℹ️ Сообщение</option><option value="link">🔗 Ссылка и материалы</option></select></label><label><span className="field-label">Ссылка <small>необязательно</small></span><input type="url" value={noteDraft.link} onChange={(event) => setNoteDraft((current) => ({ ...current, link: event.target.value }))} placeholder="https://…" /></label></div><label><span className="field-label">Текст</span><textarea rows="4" value={noteDraft.text} onChange={(event) => setNoteDraft((current) => ({ ...current, text: event.target.value }))} placeholder="Например: №245–250 из учебника, повторить формулы…" /></label><div className="adm-destination-row"><label><input type="checkbox" checked={noteDraft.sendCab} onChange={(event) => setNoteDraft((current) => ({ ...current, sendCab: event.target.checked }))} />В кабинет</label><label className={!selected.chat_id ? "disabled" : ""}><input type="checkbox" checked={noteDraft.sendTg} disabled={!selected.chat_id} onChange={(event) => setNoteDraft((current) => ({ ...current, sendTg: event.target.checked }))} />В Telegram{!selected.chat_id && " · не привязан"}</label></div><div className="adm-form-submit"><button className="button button-primary" type="submit" disabled={sendBusy}>{sendBusy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}Отправить</button></div></form>
        <section className="adm-detail-card glass adm-note-history"><div className="adm-section-title"><div><span className="eyebrow">История</span><h3>Сообщения ученику</h3></div><button className="text-action" type="button" onClick={() => loadNotes(selected.phone)}><RefreshCw size={14} />Обновить</button></div>{notesState.loading && <LoadingPanel label="Загружаем историю" />}{notesState.error && <InlineError onRetry={() => loadNotes(selected.phone)}>{notesState.error}</InlineError>}{!notesState.loading && !notesState.error && !notes.length && <p className="adm-small-empty">Сообщений ученику ещё не было.</p>}{!notesState.loading && notes.map((note) => <article className="adm-note-item" key={note.id}><span>{note.type === "homework" ? "📝" : note.type === "link" ? "🔗" : note.type === "test" ? "🧪" : "ℹ️"}</span><div><small>{formatDateTime(note.ts)}</small><p>{note.text}</p>{note.link && <a href={note.link} target="_blank" rel="noreferrer">Открыть ссылку <ExternalLink size={12} /></a>}</div><IconButton label="Удалить сообщение" className="danger" onClick={() => deleteNote(note)}><Trash2 size={15} /></IconButton></article>)}</section>
      </article>}
    </div>}
    {topicsModal && <TopicsPickerModal catalog={topicsCatalog} source={topicsSource} selection={topicsModal.selection} loading={topicsLoading} onClose={() => setTopicsModal(null)} onToggle={(subject, grade, topic) => setTopicsModal((current) => {
      const selectedTopics = { ...current.selection, [subject]: { ...(current.selection[subject] || {}), [grade]: { ...((current.selection[subject] || {})[grade] || {}) } } };
      const next = !selectedTopics[subject][grade][topic];
      if (next) selectedTopics[subject][grade][topic] = true; else delete selectedTopics[subject][grade][topic];
      return { selection: selectedTopics };
    })} onSave={() => { updateDraft("topics", topicsToText(topicsCatalog, topicsModal.selection)); setTopicsModal(null); notify("Темы подставлены в карточку. Не забудьте сохранить её."); }} />}
  </section>;
}

function TopicsPickerModal({ catalog, source, selection, loading, onClose, onToggle, onSave }) {
  return <Modal title="Выберите пройденные темы" onClose={onClose} wide className="adm-topics-modal"><p className="adm-modal-lead">{source === "table" ? "Каталог загружен из таблицы. Отметьте темы, которые уже прошли с учеником." : "Школьный каталог по предметам и классам. Отметьте только актуальные темы."}</p>{loading && <LoadingPanel label="Загружаем каталог тем" />}{!loading && !Object.keys(catalog).length && <InlineError>Каталог недоступен. Темы можно вписать вручную в карточке.</InlineError>}{!loading && Object.entries(catalog).map(([subject, grades]) => <section className="adm-topic-subject" key={subject}><h3>{subject}</h3><div>{Object.entries(grades || {}).map(([grade, topics]) => <article key={grade}><b>{grade}</b>{(topics || []).map((topic) => <label key={topic}><input type="checkbox" checked={Boolean(selection?.[subject]?.[grade]?.[topic])} onChange={() => onToggle(subject, grade, topic)} />{topic}</label>)}</article>)}</div></section>)}<div className="adm-modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Отмена</button><button className="button button-primary" type="button" disabled={loading || !Object.keys(catalog).length} onClick={onSave}><Check size={16} />Подставить темы</button></div></Modal>;
}

function TestsView({ request, notify, ask, students, ensureStudents }) {
  const [tests, setTests] = useState([]);
  const [state, setState] = useState({ loading: true, error: "" });
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState("welcome");
  const [editorTest, setEditorTest] = useState(null);
  const [results, setResults] = useState({ loading: false, error: "", assignments: [] });
  const [assign, setAssign] = useState(null);

  const selected = useMemo(() => tests.find((test) => test.id === selectedId) || null, [tests, selectedId]);
  const loadTests = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState({ loading: true, error: "" });
    try {
      const data = await request("/api/admin/tests");
      const list = Array.isArray(data.tests) ? data.tests : [];
      setTests(list);
      setState({ loading: false, error: "" });
      setSelectedId((current) => current && list.some((test) => test.id === current) ? current : current ? "" : current);
      return list;
    } catch (error) { setState({ loading: false, error: safeError(error) }); throw error; }
  }, [request]);
  const loadResults = useCallback(async (testId, { silent = false } = {}) => {
    if (!testId) return;
    if (!silent) setResults({ loading: true, error: "", assignments: [] });
    try {
      const data = await request(`/api/admin/tests/results?testId=${encodeURIComponent(testId)}`);
      setResults({ loading: false, error: "", assignments: Array.isArray(data.assignments) ? data.assignments : [] });
      return data;
    } catch (error) { setResults((current) => ({ ...current, loading: false, error: safeError(error) })); throw error; }
  }, [request]);

  useEffect(() => { loadTests().catch(() => {}); }, [loadTests]);

  const openTest = (test) => {
    setSelectedId(test.id);
    setMode("detail");
    setEditorTest(null);
    loadResults(test.id).catch(() => {});
  };
  const create = () => { setSelectedId(""); setEditorTest(null); setMode("create"); setResults({ loading: false, error: "", assignments: [] }); };
  const edit = async () => {
    if (!selected) return;
    try {
      const data = await request(`/api/admin/tests/${encodeURIComponent(selected.id)}`);
      setEditorTest(data.test);
      setMode("edit");
    } catch (error) { notify(safeError(error), "error"); }
  };
  const saved = async (id, title) => {
    await loadTests({ silent: true });
    setSelectedId(id);
    setMode("detail");
    setEditorTest(null);
    notify(`Тест «${title}» сохранён.`);
    loadResults(id).catch(() => {});
  };
  const remove = () => {
    if (!selected) return;
    ask({ title: "Удалить тест?", description: `Тест «${selected.title}» и все его отправки с результатами будут удалены.`, confirmLabel: "Удалить тест", danger: true, action: async () => { await request(`/api/admin/tests/${encodeURIComponent(selected.id)}`, { method: "DELETE" }); setSelectedId(""); setMode("welcome"); setResults({ loading: false, error: "", assignments: [] }); await loadTests({ silent: true }); notify("Тест и его результаты удалены."); } });
  };
  const openAssign = async () => {
    if (!selected) return;
    try {
      const roster = await ensureStudents();
      setAssign({ test: selected, roster: roster || students });
    } catch (error) { notify(safeError(error), "error"); }
  };
  const cancelAssignment = (assignment) => ask({ title: "Отменить попытку?", description: "Тест скроется из кабинета ученика, а персональная ссылка перестанет работать.", confirmLabel: "Отменить попытку", danger: true, action: async () => { await request("/api/admin/tests/cancel", { method: "POST", body: JSON.stringify({ id: assignment.id }) }); notify("Попытка отменена."); await Promise.all([loadResults(selectedId, { silent: true }), loadTests({ silent: true })]); } });

  return <section className="adm-page">
    <PageHeader eyebrow="Проверка знаний" title="Тесты" accent="и результаты." description="Собирайте задания из текста, отправляйте персональные ссылки и видьте прогресс каждого ученика." actions={<><button className="button button-quiet" type="button" onClick={() => loadTests().catch(() => {})} disabled={state.loading}>{state.loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}Обновить</button><button className="button button-primary" type="button" onClick={create}><Plus size={16} />Создать тест</button></>} />
    <div className="adm-tests-layout"><aside className="adm-test-list glass"><header><div><b>Библиотека</b><span>{tests.length} {tests.length === 1 ? "тест" : "тестов"}</span></div><button className="text-action" type="button" onClick={create}><Plus size={15} />Новый</button></header>{state.loading && <LoadingPanel label="Загружаем тесты" />}{!state.loading && state.error && <InlineError onRetry={() => loadTests().catch(() => {})}>{state.error}</InlineError>}{!state.loading && !state.error && !tests.length && <p className="adm-small-empty">Тестов пока нет. Создайте первый.</p>}{!state.loading && tests.map((test) => <button key={test.id} type="button" className={selectedId === test.id && mode !== "create" ? "active" : ""} onClick={() => openTest(test)}><FileText size={18} /><span><b>{test.title}</b><small>{test.count} вопросов · отправлено: {test.assigned}</small><i>{formatDateTime(test.created)}</i></span></button>)}</aside>
      <main className="adm-test-detail">{mode === "create" && <TestEditor key="create" request={request} notify={notify} onDone={saved} onBack={() => setMode(selected ? "detail" : "welcome")} />}{mode === "edit" && editorTest && <TestEditor key={editorTest.id} initial={editorTest} request={request} notify={notify} onDone={saved} onBack={() => setMode("detail")} />}{mode === "detail" && selected && <TestDetail test={selected} results={results} onAssign={openAssign} onEdit={edit} onDelete={remove} onRefresh={() => loadResults(selected.id).catch(() => {})} onCancel={cancelAssignment} notify={notify} />}{mode === "welcome" && <EmptyState icon={<FileText size={30} />} title="Выберите тест или создайте новый" text="Новый тест можно собрать из обычного текста, материалов учебника или ответа ИИ." action={<button className="button button-primary" type="button" onClick={create}><Plus size={16} />Создать первый тест</button>} />}</main></div>
    {assign && <AssignTestModal test={assign.test} students={assign.roster} request={request} notify={notify} onClose={() => setAssign(null)} onSent={async () => { setAssign(null); await Promise.all([loadTests({ silent: true }), loadResults(assign.test.id, { silent: true })]); }} />}
  </section>;
}

function TestDetail({ test, results, onAssign, onEdit, onDelete, onRefresh, onCancel, notify }) {
  return <section className="adm-test-overview glass"><header className="adm-test-title"><div><span className="eyebrow">Сохранённый тест</span><h2>{test.title}</h2><p>{test.count} вопросов · создан {formatDateTime(test.created)}</p></div><div className="adm-test-title-actions"><button className="button button-primary" type="button" onClick={onAssign}><Send size={16} />Отправить</button><IconButton label="Редактировать тест" onClick={onEdit}><Pencil size={17} /></IconButton><IconButton label="Удалить тест" className="danger" onClick={onDelete}><Trash2 size={17} /></IconButton></div></header><div className="adm-test-settings"><span><CheckCircle2 size={15} />{test.feedback ? "Правильность после ответа" : "Без правильности после ответа"}</span><span><GraduationCap size={15} />{test.showScore ? "Баллы видны ученику" : "Баллы только преподавателю"}</span><span><LockKeyhole size={15} />{test.noCopy ? "Копирование запрещено" : "Копирование разрешено"}</span><span><RotateCcw size={15} />{test.maxAttempts > 1 ? `До ${test.maxAttempts} попыток` : "Одна попытка"}</span><span><ListTodo size={15} />{test.optionsCount || 4} вариантов ответа</span></div><section className="adm-result-section"><header><div><span className="eyebrow">Отправки и результаты</span><h3>Прогресс учеников</h3></div><button className="text-action" type="button" onClick={onRefresh}><RefreshCw size={14} />Обновить</button></header>{results.loading && <LoadingPanel label="Загружаем результаты" />}{results.error && <InlineError onRetry={onRefresh}>{results.error}</InlineError>}{!results.loading && !results.error && !results.assignments.length && <p className="adm-small-empty">Пока никому не отправлен. Нажмите «Отправить», чтобы создать персональную ссылку.</p>}{!results.loading && results.assignments.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} onCancel={onCancel} notify={notify} />)}</section></section>;
}

function AssignmentCard({ assignment, onCancel, notify }) {
  const [details, setDetails] = useState(false);
  const labels = { assigned: ["Не начат", "pending"], started: ["Начат", "confirmed"], finished: ["Пройден", "done"], cancelled: ["Отменён", "cancelled"] };
  const [label, tone] = labels[assignment.status] || [assignment.status, "pending"];
  const attempt = Math.max(1, number(assignment.attempts) + (assignment.status === "finished" ? 0 : 1));
  return <article className="adm-assignment-card"><div className="adm-assignment-main"><div><b>{assignment.name || (assignment.guest ? "Пустой ученик" : "Ученик")}</b><p>{assignment.guest ? "🕊 Откроет ФИО по ссылке" : <a href={`tel:${assignment.phone}`}>{assignment.phone}</a>} {assignment.visible ? "" : "· скрыт в кабинете"}</p></div><StatusPill status={assignment.status === "finished" ? "done" : assignment.status === "cancelled" ? "cancelled" : assignment.status === "started" ? "confirmed" : "new"} /></div><div className="adm-assignment-meta"><span>{assignment.status === "finished" ? <><b>{assignment.score}/{assignment.total}</b> баллов</> : <>Отвечено: <b>{assignment.answered}/{assignment.total}</b></>}</span><span>Попыток: {assignment.attempts || 0}</span>{assignment.finishedAt && <span>{formatDateTime(assignment.finishedAt)}</span>}</div><div className="adm-assignment-actions"><a className="button button-quiet" href={assignment.link} target="_blank" rel="noreferrer"><ExternalLink size={15} />Открыть</a><button className="button button-quiet" type="button" onClick={async () => { await copyText(`${window.location.origin}${assignment.link}`); notify("Ссылка скопирована."); }}><Link2 size={15} />Скопировать</button>{(assignment.status === "finished" || assignment.answered) && <button className="button button-quiet" type="button" onClick={() => setDetails((value) => !value)}>{details ? "Скрыть ответы" : "Ответы"}</button>}{assignment.status !== "finished" && assignment.status !== "cancelled" && <button className="button adm-danger-text" type="button" onClick={() => onCancel(assignment)}>Отменить</button>}</div>{details && <div className="adm-answer-details"><small>Попытка {attempt}{assignment.status !== "finished" ? " · в процессе" : ""}</small>{(assignment.history || []).slice().reverse().map((history) => <AttemptPreview key={`${history.n}-${history.finishedAt}`} title={`Попытка ${history.n} · ${formatDateTime(history.finishedAt)} · ${history.score}/${history.total}`} detail={history.detail} />)}{assignment.detail?.length > 0 && <AttemptPreview title={assignment.status === "finished" ? `Попытка ${attempt}` : "Текущие ответы"} detail={assignment.detail} />}</div>}</article>;
}

function AttemptPreview({ title, detail = [] }) {
  return <section className="adm-attempt-preview"><b>{title}</b>{detail.map((item) => <div key={item.i}><span>{item.i + 1}. {item.text}</span><em>Ответ: <strong>{Array.isArray(item.given) ? item.given.join(", ") : item.given || "—"}</strong> {item.ok ? "✓" : "✕"}</em></div>)}</section>;
}

function TestEditor({ initial, request, notify, onDone, onBack }) {
  const editable = useMemo(() => (initial?.questions || []).map((question) => ({ ...question, correct: Array.isArray(question.correct) ? question.correct.map((value) => number(value) + 1) : question.correct })), [initial]);
  const [raw, setRaw] = useState("");
  const [title, setTitle] = useState(initial?.title || "");
  const [questions, setQuestions] = useState(editable);
  const [json, setJson] = useState(() => editable.length ? JSON.stringify(editable, null, 2) : "");
  const [warnings, setWarnings] = useState([]);
  const [optionsCount, setOptionsCount] = useState(initial?.optionsCount || 4);
  const [feedback, setFeedback] = useState(initial?.feedback !== false);
  const [showScore, setShowScore] = useState(initial?.showScore !== false);
  const [noCopy, setNoCopy] = useState(Boolean(initial?.noCopy));
  const [maxAttempts, setMaxAttempts] = useState(initial?.maxAttempts || 1);
  const [parseBusy, setParseBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState("");
  const [ai, setAi] = useState({ subject: "Математика", grade: "7 класс", topic: "", count: 10, difficulty: "средняя" });
  const aiPrompt = promptForAi(ai.subject, ai.grade, ai.topic || "тема", ai.count, ai.difficulty, optionsCount);
  const parse = async () => {
    if (!raw.trim()) { setError("Вставьте текст теста, который нужно разобрать."); return; }
    setParseBusy(true); setError("");
    try {
      const data = await request("/api/admin/tests/parse", { method: "POST", body: JSON.stringify({ raw: raw.trim(), optionsCount: number(optionsCount, 4) }) });
      const parsed = Array.isArray(data.questions) ? data.questions : [];
      if (!parsed.length) throw new Error("Не удалось найти вопросы в этом тексте.");
      setQuestions(parsed);
      setJson(JSON.stringify(parsed, null, 2));
      setTitle((current) => current || data.title || "Тест");
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      notify(`Разобрано вопросов: ${parsed.length}.`);
    } catch (requestError) { setError(safeError(requestError)); } finally { setParseBusy(false); }
  };
  const save = async () => {
    let parsed;
    try { parsed = JSON.parse(json); } catch (jsonError) { setError(`Проверьте JSON: ${jsonError.message}`); return; }
    if (!Array.isArray(parsed) || !parsed.length) { setError("Добавьте хотя бы один корректный вопрос."); return; }
    const body = { title: title.trim() || "Тест", questions: parsed, feedback, showScore, noCopy, maxAttempts: Math.max(1, Math.min(10, number(maxAttempts, 1))), optionsCount: Math.max(2, Math.min(8, number(optionsCount, 4))) };
    setSaveBusy(true); setError("");
    try {
      if (initial?.id) {
        await request(`/api/admin/tests/${encodeURIComponent(initial.id)}`, { method: "PUT", body: JSON.stringify(body) });
        await onDone(initial.id, body.title);
      } else {
        const data = await request("/api/admin/tests", { method: "POST", body: JSON.stringify(body) });
        await onDone(data.test.id, data.test.title || body.title);
      }
    } catch (requestError) { setError(safeError(requestError)); } finally { setSaveBusy(false); }
  };
  return <section className="adm-test-editor glass"><header><div><span className="eyebrow">{initial ? "Редактирование" : "Новый тест"}</span><h2>{initial ? initial.title : "Соберите тест из текста"}</h2><p>Понимаем варианты «а) …», «1) …», «- …», открытые вопросы и строки «Ответ:» / «Пояснение:».</p></div><button className="button button-quiet" type="button" onClick={onBack}><ArrowLeft size={16} />Назад</button></header>{!initial && <details className="adm-ai-prompt"><summary><WandSparkles size={16} />Промпт для ИИ <span>заполните тему и скопируйте</span></summary><div className="adm-ai-fields"><label><span className="field-label">Предмет</span><select value={ai.subject} onChange={(event) => setAi((current) => ({ ...current, subject: event.target.value }))}><option>Математика</option><option>Физика</option></select></label><label><span className="field-label">Класс</span><select value={ai.grade} onChange={(event) => setAi((current) => ({ ...current, grade: event.target.value }))}>{[4, 5, 6, 7, 8, 9].map((grade) => <option key={grade}>{grade} класс</option>)}</select></label><label><span className="field-label">Тема</span><input value={ai.topic} onChange={(event) => setAi((current) => ({ ...current, topic: event.target.value }))} placeholder="Например, дроби" /></label><label><span className="field-label">Вопросов</span><input type="number" min="1" max="30" value={ai.count} onChange={(event) => setAi((current) => ({ ...current, count: event.target.value }))} /></label><label><span className="field-label">Сложность</span><select value={ai.difficulty} onChange={(event) => setAi((current) => ({ ...current, difficulty: event.target.value }))}><option>средняя</option><option>лёгкая</option><option>сложная</option></select></label></div><textarea readOnly rows="10" value={aiPrompt} /><button className="button button-primary" type="button" onClick={async () => { await copyText(aiPrompt); notify("Промпт скопирован — вставьте его в диалог с ИИ."); }}><Link2 size={16} />Скопировать промпт</button></details>}<label className="adm-editor-raw"><span className="field-label">Текст теста</span><textarea rows="12" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={'Тест: Сложение дробей\n\n1. Сколько будет 1/2 + 1/3?\nа) 2/5\nб) 5/6\nв) 1/5\nОтвет: б\nПояснение: Общий знаменатель 6.'} /></label>{!initial && <div className="adm-inline-actions"><button className="button button-primary" type="button" onClick={parse} disabled={parseBusy}>{parseBusy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}Разобрать текст</button><span>Можно поправить результат вручную в JSON ниже.</span></div>}{(questions.length > 0 || initial) && <div className="adm-editor-parsed"><div className="adm-form-grid two"><label><span className="field-label">Название теста</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label><span className="field-label">Вариантов ответа</span><input type="number" min="2" max="8" value={optionsCount} onChange={(event) => setOptionsCount(event.target.value)} /></label></div><div className="adm-checkbox-grid"><label><input type="checkbox" checked={feedback} onChange={(event) => setFeedback(event.target.checked)} />Показывать правильность после ответа</label><label><input type="checkbox" checked={showScore} onChange={(event) => setShowScore(event.target.checked)} />Показывать итоговый балл ученику</label><label><input type="checkbox" checked={noCopy} onChange={(event) => setNoCopy(event.target.checked)} />Запретить копирование текста</label><label>Попыток: <input type="number" min="1" max="10" value={maxAttempts} onChange={(event) => setMaxAttempts(event.target.value)} /></label></div>{warnings.length > 0 && <div className="adm-warning-box">{warnings.map((warning) => <span key={warning}><CircleAlert size={14} />{warning}</span>)}</div>}<div className="adm-question-preview"><span className="eyebrow">Предпросмотр</span>{questions.map((question, index) => <QuestionPreview question={question} index={index} key={`${question.text}-${index}`} />)}</div><details className="adm-json-editor"><summary>Правка в JSON <span>если предпросмотр неидеален</span></summary><textarea rows="12" value={json} onChange={(event) => { setJson(event.target.value); setError(""); }} /></details><div className="adm-editor-save"><button className="button button-primary" type="button" onClick={save} disabled={saveBusy}>{saveBusy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{initial ? "Сохранить изменения" : "Сохранить тест"}</button></div></div>}{error && <div className="adm-form-error"><CircleAlert size={16} />{error}</div>}</section>;
}

function QuestionPreview({ question, index }) {
  const correct = new Set((question.correct || []).map((value) => number(value) - 1));
  return <article><b>{index + 1}. {question.text}</b>{question.type === "input" ? <span>Открытый ответ: <strong>{question.answer || "—"}</strong></span> : <div>{(question.options || []).map((option, optionIndex) => <span className={correct.has(optionIndex) ? "correct" : ""} key={`${option}-${optionIndex}`}>{"абвгдежзи"[optionIndex] || optionIndex + 1}) {option}{correct.has(optionIndex) && " ✓"}</span>)}</div>}{question.explanation && <small>{question.explanation}</small>}</article>;
}

function AssignTestModal({ test, students, request, notify, onClose, onSent }) {
  const [target, setTarget] = useState("__guest__");
  const [sendCab, setSendCab] = useState(true);
  const [sendTg, setSendTg] = useState(false);
  const [busy, setBusy] = useState(false);
  const guest = target === "__guest__";
  const student = students.find((item) => item.phone === target);
  useEffect(() => { setSendTg(Boolean(student?.chat_id)); }, [target, student?.chat_id]);
  const send = async (event) => {
    event.preventDefault();
    if (!sendCab && !sendTg) { notify("Выберите, куда отправить тест.", "error"); return; }
    setBusy(true);
    try {
      const data = await request("/api/admin/tests/assign", { method: "POST", body: JSON.stringify({ testId: test.id, phone: guest ? "" : target, guest, sendCab, sendTg: guest ? false : sendTg }) });
      const where = guest ? "по персональной ссылке" : [sendCab ? "в кабинет" : "", sendTg && data.tg === "sent" ? "в Telegram" : ""].filter(Boolean).join(" и ") || "в кабинет";
      const link = `${window.location.origin}/test.html?t=${data.assignment.id}`;
      await copyText(link);
      notify(`Тест отправлен ${where}. Ссылка скопирована.`);
      await onSent();
    } catch (error) { notify(safeError(error), "error"); } finally { setBusy(false); }
  };
  return <Modal title="Отправить тест" onClose={busy ? undefined : onClose} className="adm-assign-modal"><p className="adm-modal-lead">Тест «<b>{test.title}</b>» получит персональную ссылку. Её можно открыть только в рамках этой отправки.</p><form onSubmit={send}><label><span className="field-label">Получатель</span><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="__guest__">🕊 Пустой ученик · введёт ФИО сам</option>{students.map((studentItem) => <option value={studentItem.phone} key={studentItem.phone}>{studentItem.name || "Без имени"} · {studentItem.phone}{studentItem.chat_id ? " ✈️" : ""}</option>)}</select></label><div className="adm-destination-row"><label><input type="checkbox" checked={sendCab} onChange={(event) => setSendCab(event.target.checked)} />Показать в кабинете</label><label className={guest || !student?.chat_id ? "disabled" : ""}><input type="checkbox" checked={sendTg} disabled={guest || !student?.chat_id} onChange={(event) => setSendTg(event.target.checked)} />Отправить в Telegram{!guest && !student?.chat_id ? " · не привязан" : ""}</label></div><div className="adm-modal-actions"><button className="button button-quiet" type="button" onClick={onClose} disabled={busy}>Отмена</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}Отправить тест</button></div></form></Modal>;
}

function TelegramView({ request, notify, ask }) {
  const [status, setStatus] = useState({ loading: true, error: "", data: null });
  const [users, setUsers] = useState({ loading: true, error: "", data: [] });
  const [chatId, setChatId] = useState("");
  const [messages, setMessages] = useState({ loading: false, error: "", data: [] });
  const [text, setText] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastConfirm, setBroadcastConfirm] = useState("");
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const chatBottom = useRef(null);

  const loadStatus = useCallback(async () => {
    setStatus((current) => ({ ...current, loading: true, error: "" }));
    try { const data = await request("/api/admin/tg/status"); setStatus({ loading: false, error: "", data }); return data; }
    catch (error) { setStatus({ loading: false, error: safeError(error), data: null }); throw error; }
  }, [request]);
  const loadUsers = useCallback(async () => {
    setUsers((current) => ({ ...current, loading: true, error: "" }));
    try { const data = await request("/api/admin/tg/users"); const list = Array.isArray(data.users) ? data.users : []; setUsers({ loading: false, error: "", data: list }); return list; }
    catch (error) { setUsers({ loading: false, error: safeError(error), data: [] }); throw error; }
  }, [request]);
  const loadMessages = useCallback(async (id = chatId) => {
    if (!id) return;
    setMessages((current) => ({ ...current, loading: true, error: "" }));
    try { const data = await request(`/api/admin/tg/messages?chat_id=${encodeURIComponent(id)}`); setMessages({ loading: false, error: "", data: Array.isArray(data.messages) ? data.messages : [] }); }
    catch (error) { setMessages({ loading: false, error: safeError(error), data: [] }); }
  }, [request, chatId]);
  const refreshAll = useCallback(() => Promise.all([loadStatus(), loadUsers()]), [loadStatus, loadUsers]);

  useEffect(() => { refreshAll().catch(() => {}); }, [refreshAll]);
  useEffect(() => {
    const timer = window.setInterval(() => { loadUsers().catch(() => {}); if (chatId) loadMessages(chatId); }, 20000);
    return () => window.clearInterval(timer);
  }, [loadUsers, loadMessages, chatId]);
  useEffect(() => { if (chatId) loadMessages(chatId); }, [chatId, loadMessages]);
  useEffect(() => { chatBottom.current?.scrollIntoView({ block: "end" }); }, [messages.data.length]);

  const currentUser = users.data.find((user) => String(user.chat_id) === String(chatId));
  const activeUsers = users.data.filter((user) => !user.blocked);
  const send = async (event) => {
    event.preventDefault();
    if (!chatId || !text.trim()) return;
    setSendBusy(true);
    try {
      await request("/api/admin/tg/send", { method: "POST", body: JSON.stringify({ chatId, text: text.trim() }) });
      setText("");
      notify("Сообщение отправлено.");
    } catch (error) { notify(safeError(error), "error"); } finally { setSendBusy(false); loadMessages(chatId); loadUsers().catch(() => {}); }
  };
  const setWebhook = async () => {
    try { const data = await request("/api/admin/tg/set-webhook", { method: "POST" }); notify(`Вебхук подключён: ${data.url}`); loadStatus().catch(() => {}); }
    catch (error) { notify(safeError(error), "error"); }
  };
  const broadcast = async () => {
    if (broadcastConfirm !== "РАЗОСЛАТЬ") return;
    setBroadcastBusy(true);
    try {
      const data = await request("/api/admin/tg/broadcast", { method: "POST", body: JSON.stringify({ text: broadcastText.trim(), confirm: broadcastConfirm, expected: activeUsers.length }) });
      notify(`Рассылка готова: доставлено ${data.sent}, не доставлено ${data.failed}.`);
      setBroadcastOpen(false); setBroadcastText(""); setBroadcastConfirm("");
      if (chatId) loadMessages(chatId);
      loadUsers().catch(() => {});
    } catch (error) { notify(safeError(error), "error"); } finally { setBroadcastBusy(false); }
  };

  return <section className="adm-page">
    <PageHeader eyebrow="Связь с учениками" title="Telegram" accent="в диалоге." description="Читайте обращения, отвечайте от имени преподавателя и бережно отправляйте важные новости." actions={<><button className="button button-quiet" type="button" onClick={() => refreshAll().catch(() => {})}><RefreshCw size={16} />Обновить</button><button className="button button-primary" type="button" onClick={() => setBroadcastOpen(true)} disabled={!activeUsers.length}><Send size={16} />Рассылка</button></>} />
    <section className="adm-tg-status glass">{status.loading && <LoadingPanel label="Проверяем подключение бота" />}{!status.loading && status.error && <InlineError onRetry={() => loadStatus().catch(() => {})}>{status.error}</InlineError>}{!status.loading && !status.error && !status.data?.enabled && <><div className="adm-status-symbol danger"><CircleAlert size={21} /></div><div><b>Бот пока не настроен</b><p>Добавьте <code>BOT_TOKEN</code> в Render → Environment, чтобы подключить Telegram.</p></div></>}{!status.loading && !status.error && status.data?.enabled && <><div className="adm-status-symbol success"><Bot size={21} /></div><div><b>Бот @{status.data.bot?.username || "подключён"}</b><p>{status.data.webhook?.url ? "Вебхук подключён и принимает сообщения." : "Вебхук ещё не подключён."}{status.data.webhook?.last_error_message ? ` Последняя ошибка: ${status.data.webhook.last_error_message}` : ""}{!status.data.adminChat ? " ADMIN_CHAT_ID не задан — вы не получите служебные уведомления." : ""}</p></div><button className="button button-quiet" type="button" onClick={setWebhook}><Link2 size={16} />{status.data.webhook?.url ? "Переподключить вебхук" : "Подключить вебхук"}</button></>}</section>
    <div className="adm-tg-layout"><aside className="adm-tg-users glass"><header><div><b>Диалоги</b><span>{activeUsers.length} активных</span></div></header>{users.loading && <LoadingPanel label="Загружаем диалоги" />}{!users.loading && users.error && <InlineError onRetry={() => loadUsers().catch(() => {})}>{users.error}</InlineError>}{!users.loading && !users.error && !users.data.length && <p className="adm-small-empty">Пока никто не нажимал /start в боте.</p>}{!users.loading && users.data.map((user) => <button type="button" key={user.chat_id} className={String(chatId) === String(user.chat_id) ? "active" : ""} onClick={() => setChatId(String(user.chat_id))}><span>{String(user.display || "У").trim().charAt(0).toUpperCase()}</span><div><b>{user.display || user.chat_id}{user.blocked && <em>заблокировал бота</em>}</b><small>{user.phone ? `📞 ${user.phone}` : "Номер не указан"}{user.username ? ` · @${user.username}` : ""}</small>{user.last && <i>{user.last.dir === "in" ? "←" : "→"} {String(user.last.text || "").slice(0, 58)} · {formatDateTime(user.last.ts)}</i>}</div></button>)}</aside>
      <section className="adm-tg-chat glass">{!chatId && <EmptyState icon={<MessageCircle size={29} />} title="Выберите диалог" text="Здесь появится история переписки и поле для быстрого ответа." />}{chatId && <><header><div><span className="eyebrow">Telegram-диалог</span><h2>{currentUser?.display || chatId}</h2><p>chat ID {chatId}{currentUser?.phone ? ` · ${currentUser.phone}` : ""}</p></div><IconButton label="Обновить сообщения" onClick={() => loadMessages(chatId)}><RefreshCw size={17} /></IconButton></header><div className="adm-chat-thread">{messages.loading && <LoadingPanel label="Загружаем сообщения" />}{messages.error && <InlineError onRetry={() => loadMessages(chatId)}>{messages.error}</InlineError>}{!messages.loading && !messages.error && !messages.data.length && <p className="adm-small-empty">Сообщений ещё нет.</p>}{!messages.loading && messages.data.map((message) => <article key={message.id || `${message.ts}-${message.text}`} className={message.dir === "in" ? "in" : "out"}><p>{message.text}</p><span>{formatDateTime(message.ts)}{message.kind === "broadcast" ? " · рассылка" : ""}{message.status && message.status !== "ok" ? ` · ⚠ ${message.status}` : ""}</span></article>)}<div ref={chatBottom} /></div><form className="adm-chat-compose" onSubmit={send}><textarea rows="3" value={text} onChange={(event) => setText(event.target.value)} placeholder="Напишите сообщение…" /><button className="button button-primary" type="submit" disabled={sendBusy || !text.trim()}>{sendBusy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}Отправить</button></form></>}</section></div>
    {broadcastOpen && <Modal title="Рассылка в Telegram" onClose={broadcastBusy ? undefined : () => setBroadcastOpen(false)} className="adm-broadcast-modal"><div className="adm-broadcast-count"><UsersRound size={20} /><div><b>{activeUsers.length} получателей</b><span>Только пользователи, которые не заблокировали бота.</span></div></div><form onSubmit={(event) => { event.preventDefault(); ask({ title: "Отправить рассылку?", description: `Сообщение получат ${activeUsers.length} пользователей. Это последнее подтверждение.`, confirmLabel: "Отправить всем", danger: true, action: broadcast }); }}><label><span className="field-label">Текст сообщения</span><textarea rows="6" value={broadcastText} onChange={(event) => setBroadcastText(event.target.value)} placeholder="Важное сообщение для учеников…" required /></label><label><span className="field-label">Напишите РАЗОСЛАТЬ для подтверждения</span><input value={broadcastConfirm} onChange={(event) => setBroadcastConfirm(event.target.value)} placeholder="РАЗОСЛАТЬ" /></label><div className="adm-modal-actions"><button className="button button-quiet" type="button" onClick={() => setBroadcastOpen(false)} disabled={broadcastBusy}>Отмена</button><button className="button button-primary" type="submit" disabled={!broadcastText.trim() || broadcastConfirm !== "РАЗОСЛАТЬ" || broadcastBusy}>{broadcastBusy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}Продолжить</button></div></form></Modal>}
  </section>;
}

function SettingsView({ request, notify, ask, onSaved }) {
  const [state, setState] = useState({ loading: true, error: "" });
  const [meta, setMeta] = useState([]);
  const [defaults, setDefaults] = useState({});
  const [draft, setDraft] = useState({});
  const [env, setEnv] = useState({});
  const [saveBusy, setSaveBusy] = useState(false);
  const load = useCallback(async () => {
    setState({ loading: true, error: "" });
    try {
      const data = await request("/api/admin/settings");
      setMeta(Array.isArray(data.meta) ? data.meta : []); setDefaults(data.defaults || {}); setDraft(data.settings || {}); setEnv(data.env || {}); setState({ loading: false, error: "" });
      return data;
    } catch (error) { setState({ loading: false, error: safeError(error) }); throw error; }
  }, [request]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const save = async (event) => {
    event.preventDefault(); setSaveBusy(true);
    try { const data = await request("/api/admin/settings", { method: "PUT", body: JSON.stringify(draft) }); setDraft(data.settings || draft); onSaved(data.settings || draft); notify("Настройки сохранены — сайт уже обновлён."); }
    catch (error) { notify(safeError(error), "error"); } finally { setSaveBusy(false); }
  };
  const reset = () => ask({ title: "Вернуть настройки по умолчанию?", description: "Все поля будут заменены стартовыми значениями. Вы сможете сохранить их или отредактировать снова.", confirmLabel: "Вернуть значения", danger: true, action: async () => { const data = await request("/api/admin/settings", { method: "PUT", body: JSON.stringify(defaults) }); setDraft(data.settings || defaults); onSaved(data.settings || defaults); notify("Настройки возвращены к значениям по умолчанию."); } });
  return <section className="adm-page"><PageHeader eyebrow="Сайт и уведомления" title="Тонкая" accent="настройка." description="Все значения хранятся в текущем подключённом хранилище и сразу применяются на сайте." actions={<button className="button button-quiet" type="button" onClick={reset} disabled={state.loading || !Object.keys(defaults).length}><RotateCcw size={16} />По умолчанию</button>} />{state.loading && <LoadingPanel label="Загружаем настройки" />}{!state.loading && state.error && <InlineError onRetry={() => load().catch(() => {})}>{state.error}</InlineError>}{!state.loading && !state.error && <><form className="adm-settings-form glass" onSubmit={save}><header><div><span className="eyebrow">Публичная конфигурация</span><h2>Что видят ученики</h2></div><Settings size={20} /></header><div>{meta.map((item) => <label className={item.type === "textarea" ? "wide" : ""} key={item.key}><span className="field-label">{item.label}</span>{item.type === "textarea" ? <textarea rows="3" value={draft[item.key] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [item.key]: event.target.value }))} /> : <input type={item.type === "number" ? "number" : "text"} value={draft[item.key] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [item.key]: event.target.value }))} />}{item.hint && <small>{item.hint}</small>}</label>)}</div><footer><button className="button button-primary" type="submit" disabled={saveBusy}>{saveBusy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Сохранить настройки</button></footer></form><section className="adm-env-card glass"><div><span className="eyebrow">Render · Environment</span><h2>Подключения сервиса</h2><p>Переменные окружения не редактируются в браузере — изменяйте их в настройках Render и перезапускайте сервис.</p></div><div>{[["Google Таблица · APPS_SCRIPT_URL", env.appsScript], ["Telegram-бот · BOT_TOKEN", env.botToken], ["Служебные уведомления · ADMIN_CHAT_ID", env.adminChatId], ["Публичный адрес для бота · PUBLIC_URL", Boolean(env.publicUrl)]].map(([label, ok]) => <span key={label} className={ok ? "ok" : "missing"}>{ok ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}{label}{!ok && " · не задано"}</span>)}</div></section></>}</section>;
}

function HelpView() {
  const cards = [
    [CalendarDays, "Расписание и слоты", ["Выберите период и нажмите «Показать», чтобы обновить список.", "Свободный слот можно закрыть, закрытый — открыть; занятой — освободить вместе с записью.", "В «Слотах» добавляйте отдельные окна или создавайте регулярное расписание."]],
    [ListTodo, "Заявки", ["Новая заявка появляется после записи ученика на сайте.", "Подтверждение, завершение и отмена сразу меняют доступность слота.", "CSV помогает сохранить выборку для внешней работы."]],
    [UsersRound, "Карточки учеников", ["Карточка создаётся автоматически из первой заявки.", "Пройденные темы видит ученик, заметки для себя — только преподаватель.", "Материалы можно положить в кабинет, отправить в Telegram или сделать оба действия."]],
    [FileText, "Тесты", ["Вставьте текст из учебника или ответ ИИ и нажмите «Разобрать».", "Перед сохранением проверьте предпросмотр и при необходимости поправьте JSON.", "Каждая отправка создаёт отдельную ссылку; гостевой вариант подходит для новых учеников."]],
    [Send, "Telegram", ["Пользователь появляется после команды /start в боте.", "Для сообщений из карточки нужен привязанный Chat ID — он заполнится после /start и номера.", "Рассылка требует слово «РАЗОСЛАТЬ» и точное число получателей как защиту от случайной отправки."]],
    [Settings, "Хранилище и настройки", ["В демо-режиме данные лежат в data/db.json, в боевом — в Google Sheets через Apps Script.", "ADMIN_KEY, BOT_TOKEN и другие секреты задаются в Render → Environment, а не в интерфейсе.", "Перед запуском Telegram укажите PUBLIC_URL и подключите вебхук в разделе Telegram."]],
  ];
  return <section className="adm-page"><PageHeader eyebrow="Короткие подсказки" title="Всё" accent="под рукой." description="Небольшая шпаргалка по основным сценариям рабочего пространства." /><div className="adm-help-grid">{cards.map(([Icon, title, items]) => <article className="glass" key={title}><span><Icon size={20} /></span><h2>{title}</h2><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div><section className="adm-help-callout glass"><Sparkles size={20} /><div><b>Нужна проверка перед уроками?</b><p>Откройте «Расписание», выберите ближайшую неделю и экспортируйте CSV. Так вы быстро увидите все свободные и занятые окна.</p></div></section></section>;
}
