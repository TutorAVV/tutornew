import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  EyeOff,
  FileText,
  GraduationCap,
  Home,
  KeyRound,
  LoaderCircle,
  Moon,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Sun,
  Trophy,
  UserRound,
  X,
} from "lucide-react";

const DEFAULT_CONFIG = { tutorName: "Онлайн-уроки" };
const LETTERS = "абвгдежзи";

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
    throw new Error("Нет связи с сервисом тестов. Попробуйте ещё раз.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) throw new Error(data?.error || "Не удалось выполнить запрос.");
  return data || {};
}

function firstUnanswered(test, map) {
  for (let index = 0; index < Number(test?.count || 0); index += 1) if (!map?.[index]) return index;
  return Number(test?.count || 0);
}

function answeredTotal(map) {
  return Object.keys(map || {}).length;
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><Sparkles size={17} strokeWidth={2.4} /></span>;
}

function IconButton({ label, children, className = "", ...props }) {
  return <button className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>{children}</button>;
}

function TestApp() {
  const token = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get("t") || ""; } catch (_error) { return ""; }
  }, []);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("glass-theme") || localStorage.getItem("theme") || "dark"; } catch (_error) { return "dark"; }
  });
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");
  const [test, setTest] = useState(null);
  const [answered, setAnswered] = useState({});
  const [current, setCurrent] = useState(0);
  const [choice, setChoice] = useState([]);
  const [input, setInput] = useState("");
  const [response, setResponse] = useState(null);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestBusy, setGuestBusy] = useState(false);
  const [finishBusy, setFinishBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("glass-theme", theme); localStorage.setItem("theme", theme); } catch (_error) { /* optional storage */ }
  }, [theme]);

  useEffect(() => {
    let active = true;
    api("/api/config").then((data) => { if (active) setConfig((currentConfig) => ({ ...currentConfig, ...data })); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const load = useCallback(async () => {
    if (!token) { setError("Ссылка на тест неполная — попросите преподавателя прислать её заново."); setPhase("error"); return; }
    setPhase("loading"); setError(""); setResponse(null);
    try {
      const data = await api(`/api/test?t=${encodeURIComponent(token)}`);
      setTest(data);
      setAnswered(data.answeredMap || {});
      document.title = `${data.title || "Тест"} — Онлайн-уроки`;
      if (data.needName) { setGuestName(data.student || ""); setPhase("guest"); return; }
      if (data.status === "finished") { setPhase("finished"); return; }
      const next = firstUnanswered(data, data.answeredMap || {});
      if (next >= data.count) { setPhase("ready-to-finish"); return; }
      setCurrent(next); setChoice([]); setInput(""); setPhase("question");
    } catch (loadError) { setError(loadError.message); setPhase("error"); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!test?.noCopy) return undefined;
    const prevent = (event) => {
      const target = event.target;
      if (target?.closest?.("input, textarea")) return;
      event.preventDefault();
    };
    const events = ["copy", "cut", "contextmenu", "selectstart", "dragstart"];
    events.forEach((event) => document.addEventListener(event, prevent, true));
    document.body.classList.add("testapp-no-copy");
    return () => { events.forEach((event) => document.removeEventListener(event, prevent, true)); document.body.classList.remove("testapp-no-copy"); };
  }, [test?.noCopy]);

  useEffect(() => {
    if (phase === "question" && test?.questions?.[current]?.type === "input") window.setTimeout(() => inputRef.current?.focus(), 60);
  }, [phase, test, current]);

  const question = test?.questions?.[current] || null;
  const complete = answeredTotal(answered);
  const canAnswer = question?.type === "input" ? Boolean(input.trim()) : choice.length > 0;

  const saveGuestName = async (event) => {
    event.preventDefault();
    if (!guestName.trim()) { setError("Введите своё ФИО, чтобы преподаватель увидел результат."); return; }
    setGuestBusy(true); setError("");
    try {
      const data = await api("/api/test/name", { method: "POST", body: JSON.stringify({ t: token, name: guestName.trim() }) });
      const next = { ...test, student: data.name || guestName.trim(), needName: false };
      setTest(next);
      const unanswered = firstUnanswered(next, answered);
      if (next.status === "finished") setPhase("finished");
      else if (unanswered >= next.count) setPhase("ready-to-finish");
      else { setCurrent(unanswered); setPhase("question"); }
    } catch (saveError) { setError(saveError.message); } finally { setGuestBusy(false); }
  };

  const chooseOption = (index) => {
    if (!question || answerBusy || response) return;
    setChoice((currentChoice) => question.multi
      ? currentChoice.includes(index) ? currentChoice.filter((item) => item !== index) : [...currentChoice, index]
      : [index]);
  };

  const submitAnswer = async () => {
    if (!question || !canAnswer || answerBusy || response) return;
    setAnswerBusy(true); setError("");
    const answer = question.type === "input" ? input.trim() : question.multi ? choice : choice[0];
    try {
      const data = await api("/api/test/answer", { method: "POST", body: JSON.stringify({ t: token, qi: current, answer }) });
      setAnswered((currentMap) => ({ ...currentMap, [current]: data.correct === undefined ? {} : { ok: Boolean(data.correct) } }));
      setResponse(data);
    } catch (answerError) { setError(answerError.message); } finally { setAnswerBusy(false); }
  };

  const nextQuestion = () => {
    if (!test) return;
    const next = firstUnanswered(test, { ...answered, [current]: {} });
    // Keep the accepted final answer visible while the finish request runs.
    // If that request fails, the learner can safely press the same button again.
    if (next >= test.count) { finish(); return; }
    setChoice([]); setInput(""); setResponse(null); setError("");
    setCurrent(next); setPhase("question");
  };

  const finish = async () => {
    if (finishBusy) return;
    setFinishBusy(true); setError("");
    try {
      const data = await api("/api/test/finish", { method: "POST", body: JSON.stringify({ t: token }) });
      setTest((currentTest) => ({ ...currentTest, status: "finished", score: data.score, showScore: data.showScore ?? currentTest.showScore, attempts: data.attempts ?? currentTest.attempts, maxAttempts: data.maxAttempts ?? currentTest.maxAttempts, canRetry: Boolean(data.canRetry) }));
      setPhase("finished");
    } catch (finishError) { setError(finishError.message); } finally { setFinishBusy(false); }
  };

  const retry = async () => {
    if (retryBusy) return;
    setRetryBusy(true); setError("");
    try {
      const data = await api("/api/test/retry", { method: "POST", body: JSON.stringify({ t: token }) });
      setTest(data); setAnswered(data.answeredMap || {}); setResponse(null); setChoice([]); setInput("");
      const next = firstUnanswered(data, data.answeredMap || {});
      if (data.needName) setPhase("guest");
      else if (next >= data.count) setPhase("ready-to-finish");
      else { setCurrent(next); setPhase("question"); }
    } catch (retryError) { setError(retryError.message); } finally { setRetryBusy(false); }
  };

  const progress = test?.count ? Math.round((complete / test.count) * 100) : 0;
  const currentNumber = Math.min(current + 1, test?.count || 1);

  return <main className="testapp-shell">
    <div className="testapp-aurora" aria-hidden="true"><span /><span /><span /></div>
    <header className="testapp-topbar"><a href="/" className="brand-lockup"><BrandMark /><span>{config.tutorName}</span></a><div><a className="testapp-cabinet-link" href="/cabinet#/tests"><ArrowLeft size={15} /><span>К тестам</span></a><IconButton label={theme === "dark" ? "Светлая тема" : "Тёмная тема"} onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</IconButton></div></header>
    <div className="testapp-container">
      {phase === "loading" && <section className="testapp-loading glass"><span><LoaderCircle size={24} /></span><div><b>Открываем тест</b><p>Подготавливаем вопросы и ваш прогресс.</p></div></section>}
      {phase === "error" && <section className="testapp-error glass"><span><CircleAlert size={29} /></span><h1>Не получилось<br /><i>открыть тест.</i></h1><p>{error}</p><div><button className="button button-primary" type="button" onClick={load}><RefreshCw size={16} />Попробовать снова</button><a className="button button-quiet" href="/cabinet#/tests"><ArrowLeft size={16} />В кабинет</a></div></section>}
      {test && !["loading", "error"].includes(phase) && <><header className="testapp-title"><span className="eyebrow"><FileText size={13} /> Персональное задание</span><h1>{test.title}</h1><div className="testapp-title-meta"><span><ClipboardCheck size={14} />{test.count} {test.count === 1 ? "вопрос" : "вопросов"}</span>{test.maxAttempts > 1 && <span><RotateCcw size={14} />Попытка {Math.min(Number(test.attempts || 0) + (phase === "finished" ? 0 : 1), test.maxAttempts)} из {test.maxAttempts}</span>}{test.student && <span><UserRound size={14} />{test.student}</span>}</div>{test.noCopy && <span className="testapp-copy-note"><EyeOff size={13} />Копирование вопросов отключено преподавателем</span>}</header>
        {phase === "guest" && <section className="testapp-identity glass"><span className="testapp-card-icon"><UserRound size={23} /></span><span className="eyebrow">Перед началом</span><h2>Как к вам <i>обращаться?</i></h2><p>Сохраним имя только в этой попытке, чтобы преподаватель увидел ваш результат.</p><form onSubmit={saveGuestName}><label><span>Фамилия, имя, отчество</span><input value={guestName} onChange={(event) => { setGuestName(event.target.value); setError(""); }} placeholder="Иванов Иван Иванович" autoComplete="name" maxLength="200" autoFocus /></label>{error && <ErrorLine>{error}</ErrorLine>}<button className="button button-primary" type="submit" disabled={guestBusy}>{guestBusy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}Начать тест</button></form></section>}
        {phase === "question" && question && <section className="testapp-question-card glass"><header><div><span>Вопрос {currentNumber} из {test.count}</span><b>{complete} отвечено</b></div><div className="testapp-progress" aria-label={`Пройдено ${progress}%`}><i style={{ width: `${progress}%` }} /></div></header><div className="testapp-question-body"><span className="testapp-question-index">{String(currentNumber).padStart(2, "0")}</span><h2>{question.text}</h2>{question.type === "input" ? <label className="testapp-input-answer"><span>Ваш ответ</span><input ref={inputRef} value={input} onChange={(event) => { setInput(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter" && canAnswer) submitAnswer(); }} placeholder="Введите ответ…" disabled={Boolean(response)} autoComplete="off" /></label> : <div className="testapp-options">{question.options.map((option, index) => { const correct = response && Array.isArray(response.correctAnswer) ? response.correctAnswer.includes(index) : response?.correctAnswer === index; const wrong = response && choice.includes(index) && !correct; return <button type="button" disabled={Boolean(response)} key={`${option}-${index}`} className={`${choice.includes(index) ? "selected" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`} onClick={() => chooseOption(index)}><span>{LETTERS[index] || index + 1}</span><b>{option}</b>{correct && <Check size={17} />}{wrong && <X size={16} />}</button>; })}</div>}{question.multi && !response && <p className="testapp-multi-note"><KeyRound size={14} />В этом вопросе несколько правильных вариантов — отметьте все подходящие.</p>}{response && <Feedback data={response} question={question} />}{error && <ErrorLine>{error}</ErrorLine>}<div className="testapp-question-actions">{!response && <button className="button button-primary" type="button" onClick={submitAnswer} disabled={!canAnswer || answerBusy}>{answerBusy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Ответить</button>}{response && <button className="button button-primary" type="button" onClick={nextQuestion}>{complete >= test.count ? <><Trophy size={17} />Завершить тест</> : <>Следующий вопрос <ArrowRight size={17} /></>}</button>}</div></div></section>}
        {phase === "ready-to-finish" && <section className="testapp-finish-ready glass"><span><Trophy size={29} /></span><span className="eyebrow">Все ответы приняты</span><h2>Финишная <i>прямая.</i></h2><p>Вы ответили на все {test.count} вопросов. Отправьте результат преподавателю.</p>{error && <ErrorLine>{error}</ErrorLine>}<button className="button button-primary" type="button" onClick={finish} disabled={finishBusy}>{finishBusy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}Завершить и отправить</button></section>}
        {phase === "finished" && <FinishCard test={test} retryBusy={retryBusy} onRetry={retry} error={error} />}</>}
      <footer className="testapp-footer"><span><BrandMark />{config.tutorName}</span><span><GraduationCap size={14} />Учиться спокойно, шаг за шагом</span><a href="/"><Home size={14} />На главную</a></footer>
    </div>
  </main>;
}

function Feedback({ data, question }) {
  const hasCorrectness = data.correct !== undefined;
  const right = Boolean(data.correct);
  const correctAnswer = data.correctAnswer;
  let answerText = "";
  if (hasCorrectness && !right && correctAnswer !== undefined) answerText = question.type === "input" ? String(correctAnswer) : (Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer]).map((index) => question.options[index] || `Вариант ${Number(index) + 1}`).join(", ");
  return <div className={`testapp-feedback ${hasCorrectness ? right ? "right" : "wrong" : "accepted"}`}><span>{hasCorrectness ? right ? <CheckCircle2 size={19} /> : <CircleAlert size={19} /> : <CheckCircle2 size={19} />}</span><div><b>{hasCorrectness ? right ? "Верно!" : "Неправильно" : "Ответ принят"}</b>{answerText && <p>Правильный ответ: <strong>{answerText}</strong></p>}{hasCorrectness && data.explanation && <p className="explanation">💡 {data.explanation}</p>}</div></div>;
}

function ErrorLine({ children }) {
  return <p className="testapp-error-line"><CircleAlert size={15} />{children}</p>;
}

function FinishCard({ test, retryBusy, onRetry, error }) {
  const scoreVisible = test.showScore && test.score != null;
  const percent = scoreVisible && test.count ? Math.round((Number(test.score) / test.count) * 100) : 0;
  const message = percent >= 80 ? "Отличный результат!" : percent >= 50 ? "Хорошая работа — вы на верном пути." : "Ответы уже у преподавателя, разберёте тему вместе.";
  return <section className="testapp-finished glass"><span className="testapp-trophy"><Trophy size={31} /></span><span className="eyebrow">Тест завершён</span><h2>{scoreVisible ? "Результат" : "Ответы отправлены"} <i>готов.</i></h2>{scoreVisible ? <><div className="testapp-score"><b>{test.score}</b><span>из {test.count}</span><i>{percent}%</i></div><p>{message}</p></> : <p>Преподаватель получил ваши ответы. Результат вы узнаете на занятии или в кабинете.</p>}{error && <ErrorLine>{error}</ErrorLine>}<div className="testapp-finish-actions">{test.canRetry && <button className="button button-primary" type="button" onClick={onRetry} disabled={retryBusy}>{retryBusy ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />}Ещё попытка <small>({test.attempts} из {test.maxAttempts})</small></button>}<a className={`button ${test.canRetry ? "button-quiet" : "button-primary"}`} href="/cabinet#/tests"><ArrowLeft size={16} />К тестам</a><a className="button button-quiet" href="/"><Home size={16} />На главную</a></div></section>;
}

export default TestApp;
