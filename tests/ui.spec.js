const { test: base, expect } = require("@playwright/test");

const TODAY = "2026-09-05";
const json = (route, body, status = 200) => route.fulfill({ status, json: body });
const addDays = (iso, days) => {
  const date = new Date(iso + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const slotsFrom = (start = TODAY) => Array.from({ length: 60 }, (_, i) => ({
  iso: addDays(start, i), time: "16:00", duration: 50,
  status: ["open", "booked", "closed"][i % 3],
  student: i % 3 === 1 ? "Тестовый ученик" : "", subject: "Математика",
}));

// All API calls are mocked: the UI checks never modify a real database or send Telegram messages.
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [], unexpected = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date(TODAY + "T12:00:00Z"));
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/config") return json(route, { storage: "demo", tutorName: "Онлайн-уроки", cabinetEnabled: true });
      if (path === "/api/bookings") return json(route, { ok: true, bookings: [] });
      unexpected.push(path);
      return json(route, { ok: false, error: "Unmocked API" }, 500);
    });
    await use(page);
    expect(errors, "No uncaught browser errors").toEqual([]);
    expect(unexpected, "All API requests must be mocked").toEqual([]);
  },
});

async function admin(page, tab = "schedule") {
  await page.addInitScript(() => sessionStorage.setItem("adminKey", "ui-test"));
  await page.goto(`/admin.html#${tab}`);
  await expect(page.locator("#appView")).toBeVisible();
}
async function mockSchedule(page, slots = slotsFrom()) {
  const requests = [];
  await page.route("**/api/schedule?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const from = params.get("from"), to = params.get("to");
    requests.push({ from, to });
    return json(route, { ok: true, slots: slots.filter((s) => s.iso >= from && s.iso <= to) });
  });
  return requests;
}
async function screenshot(page, name) {
  if (process.env.UI_SCREENSHOTS) await page.screenshot({ path: test.info().outputPath(name + ".png"), fullPage: true });
}
async function gapBetween(first, second) {
  const a = await first.boundingBox(), b = await second.boundingBox();
  return b.y - a.y - a.height;
}

test("расписание загружается на 14 дней после входа и обновления страницы", async ({ page }) => {
  const requests = await mockSchedule(page);
  await page.goto("/admin.html");
  await expect(page.locator("#loginView")).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.locator("#adminPass").fill("ui-test");
  await page.locator("#loginBtn").click();
  await expect(page.locator("#schDays .day-card")).toHaveCount(14);
  expect(requests).toEqual([{ from: TODAY, to: "2026-09-18" }]);
  await expect(page.locator("#schFrom")).toHaveValue(TODAY);
  await expect(page.locator("#schTo")).toHaveValue("2026-09-18");
  await page.reload();
  await expect(page.locator("#schDays .day-card")).toHaveCount(14);
  expect(requests).toHaveLength(2);
});

for (const [today, end] of [["2026-09-26", "2026-10-09"], ["2026-12-26", "2027-01-08"]]) {
  test(`две недели при переходе месяца/года: ${today}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(today + "T12:00:00Z"));
    const requests = await mockSchedule(page, slotsFrom(today));
    await admin(page);
    await expect(page.locator("#schDays .day-card")).toHaveCount(14);
    expect(requests).toEqual([{ from: today, to: end }]);
  });
}

test("произвольный период применяется по Показать и сохраняется при переходе между вкладками", async ({ page }) => {
  const requests = await mockSchedule(page);
  await admin(page, "bookings");
  expect(requests).toHaveLength(0);
  await page.locator('[data-tab="schedule"]').click();
  await expect(page.locator("#schDays .day-card")).toHaveCount(14);
  await page.locator("#schFrom").fill("2026-09-10");
  await page.locator("#schTo").fill("2026-10-10");
  expect(requests).toHaveLength(1);
  await page.locator("#schLoad").click();
  await expect(page.locator("#schDays .day-card")).toHaveCount(31);
  expect(requests.at(-1)).toEqual({ from: "2026-09-10", to: "2026-10-10" });
  await page.locator('[data-tab="bookings"]').click();
  await page.locator('[data-tab="schedule"]').click();
  await expect.poll(() => requests.length).toBe(3);
  await expect(page.locator("#schDays .day-card")).toHaveCount(31);
  await expect(page.locator("#schFrom")).toHaveValue("2026-09-10");
  await expect(page.locator("#schTo")).toHaveValue("2026-10-10");
  await page.locator("#schTo").fill("2026-09-11");
  await page.locator("#schLoad").click();
  await expect(page.locator("#schDays .day-card")).toHaveCount(2);
  await page.locator("#schTo").fill("2026-09-09");
  await page.locator("#schLoad").click();
  await expect(page.locator(".toast")).toContainText("корректный диапазон");
  expect(requests).toHaveLength(4);
});

test("календарь показывает дни, слоты, навигацию и переход к выбранному дню", async ({ page }) => {
  const slots = slotsFrom();
  slots.push({ ...slots[0], time: "17:00" }, { ...slots[0], time: "18:00", status: "closed" });
  await mockSchedule(page, slots);
  await admin(page);
  await expect(page.locator("#schDays .day-card")).toHaveCount(14);
  await page.locator("#schCal").click();
  const modal = page.locator("#calModal");
  await expect(modal).toBeVisible();
  await expect(modal.locator("[data-cal-day]")).toHaveCount(30);
  await expect(modal.locator(".admin-cal-weekdays span")).toHaveText(["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]);
  await expect(modal.locator(".admin-cal-head b")).toContainText("Сентябрь 2026");
  await expect(modal.locator(`[data-cal-day="${TODAY}"] .cal-chip`)).toHaveCount(2);
  await expect(modal.locator(`[data-cal-day="${TODAY}"] .admin-cal-more`)).toHaveText("+1");
  await modal.locator('[data-cal-nav="1"]').click();
  await expect(modal.locator("[data-cal-day]")).toHaveCount(31);
  await expect(modal.locator(".admin-cal-head b")).toContainText("Октябрь");
  await modal.locator('[data-cal-nav="-1"]').click();
  await modal.locator('[data-cal-day="2026-09-06"]').click();
  await expect(modal.locator('[data-cal-day="2026-09-06"]')).toHaveAttribute("aria-pressed", "true");
  await expect(modal.locator("tbody")).toContainText("Тестовый ученик");
  await screenshot(page, "calendar");
  // The month grid must fit even on a phone; only the detailed slot table may scroll horizontally.
  expect(await modal.locator(".modal-card").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator("#calGoDay").click();
  await expect(modal).toBeHidden();
  await expect(page.locator("#day-2026-09-06")).toHaveClass(/selected/);
  await expect(page.locator("#day-2026-09-06")).toBeInViewport();
  await page.locator("#schCal").click();
  await modal.locator("[data-cal-today]").click();
  await expect(modal.locator(`[data-cal-day="${TODAY}"]`)).toHaveAttribute("aria-current", "date");
  await expect(modal.locator(`[data-cal-day="${TODAY}"]`)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});

test("пустой период, фильтр без слотов и високосный месяц не скрывают календарь", async ({ page }) => {
  await mockSchedule(page, []);
  await admin(page);
  await expect(page.locator("#schDays")).toContainText("слотов нет");
  await page.locator("#schCal").click();
  await expect(page.locator("#calModal [data-cal-day]")).toHaveCount(30);
  await expect(page.locator("#calGoDay")).toBeDisabled();
  await expect(page.locator("#calModalBody")).toContainText("На этот день слотов нет");
  await page.locator("#calDone").click();
  await page.locator("#schFrom").fill("2028-02-01");
  await page.locator("#schTo").fill("2028-02-29");
  await page.locator("#schStatus").selectOption("booked");
  await page.locator("#schLoad").click();
  await expect(page.locator("#schDays")).toContainText("Слотов с выбранным статусом нет");
  await page.locator("#schCal").click();
  await expect(page.locator("#calModal [data-cal-day]")).toHaveCount(29);
  await expect(page.locator("#calModal .admin-cal-cell.off")).toHaveCount(1);
  await expect(page.locator("#calModalBody")).toContainText("нет слотов с выбранным статусом");
  await page.locator('#calModal [data-cal-nav="1"]').click();
  await page.locator('#calModal [data-cal-day="2028-03-01"]').click();
  await expect(page.locator("#calModalBody")).toContainText("вне загруженного периода");
});

test("календарь открывается во время загрузки и обновляется после получения данных", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/schedule?*", async (route) => { await gate; await json(route, { ok: true, slots: slotsFrom().slice(0, 14) }); });
  await admin(page);
  await page.locator("#schCal").click();
  await expect(page.locator("#calModalBody")).toContainText("Загрузка расписания");
  await expect(page.locator("#calGoDay")).toBeDisabled();
  release();
  await expect(page.locator("#calModal [data-cal-day]")).toHaveCount(30);
  await expect(page.locator("#calGoDay")).toBeEnabled();
});

test("ошибку загрузки не путаем с пустым расписанием; календарь может повторить запрос", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/schedule?*", (route) => ++requests === 1
    ? json(route, { ok: false, error: "schedule failed" }, 500)
    : json(route, { ok: true, slots: [] }));
  await admin(page);
  await expect(page.locator("#schDays")).toContainText("Не удалось загрузить расписание");
  await page.locator("#schCal").click();
  await expect(page.locator("#calModal [data-cal-day]")).toHaveCount(30);
  expect(requests).toBe(2);
});

test("изменение статуса слота в календаре обновляет календарь и список с учётом фильтра", async ({ page }) => {
  const slots = slotsFrom();
  await mockSchedule(page, slots);
  await page.route("**/api/admin/slots", (route) => {
    const { date, time, status } = route.request().postDataJSON();
    const slot = slots.find((s) => s.iso === date && s.time === time);
    slot.status = status;
    return json(route, { ok: true });
  });
  await admin(page);
  await expect(page.locator("#schDays .day-card")).toHaveCount(14);
  await page.locator("#schStatus").selectOption("open");
  await expect(page.locator("#schDays .day-card")).toHaveCount(5);
  await page.locator("#schCal").click();
  await page.locator(`#calModal [data-close="${TODAY}|16:00"]`).click();
  await expect(page.locator("#calModalBody")).toContainText("нет слотов с выбранным статусом");
  await expect(page.locator("#calGoDay")).toBeDisabled();
  await expect(page.locator(`#calModal [data-cal-day="${TODAY}"] .cal-chip`)).toHaveCount(0);
  await page.locator("#calDone").click();
  await expect(page.locator("#schDays .day-card")).toHaveCount(4);
  await page.locator("#schStatus").selectOption("closed");
  await page.locator("#schCal").click();
  await page.locator(`#calModal [data-open="${TODAY}|16:00"]`).click();
  await expect(page.locator("#calModalBody")).toContainText("нет слотов с выбранным статусом");
  expect(slots[0].status).toBe("open");
});

test("Telegram: короткие сообщения компактны, длинные и многострочные подстраиваются под текст", async ({ page }) => {
  const messages = [
    { dir: "in", text: "Привет" }, { dir: "out", text: "Да" },
    { dir: "in", text: "Разберём эту тему на следующем занятии. ".repeat(12) },
    { dir: "out", text: "https://example.com/" + "a".repeat(240) },
    { dir: "out", text: "Первая строка\n\nТретья строка" },
  ].map((m) => ({ ...m, ts: TODAY + "T12:00:00Z", status: "ok" }));
  await page.route("**/api/admin/tg/status", (route) => json(route, { enabled: false }));
  await page.route("**/api/admin/tg/users", (route) => json(route, { users: [{ chat_id: "123", display: "Ученик" }] }));
  await page.route("**/api/admin/tg/messages?*", (route) => json(route, { messages }));
  await page.route("**/api/admin/tg/send", (route) => {
    const { text } = route.request().postDataJSON();
    messages.push({ dir: "out", text, ts: TODAY + "T12:01:00Z", status: "ok" });
    return json(route, { ok: true });
  });
  await admin(page, "tg");
  await page.locator('[data-cid="123"]').click();
  const bubbles = page.locator("#tgChat .msg"), chat = page.locator("#tgChat");
  await expect(bubbles).toHaveCount(5);
  const chatBox = await chat.boundingBox();
  const first = await bubbles.nth(0).boundingBox(), reply = await bubbles.nth(1).boundingBox();
  expect(first.width).toBeLessThan(chatBox.width * 0.6);
  expect(reply.width).toBeLessThan(chatBox.width * 0.6);
  expect(first.height).toBeLessThan(80);
  expect(reply.height).toBeLessThan(80);
  expect(reply.x).toBeGreaterThan(first.x);
  expect(await chat.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const bubble of await bubbles.all()) {
    expect(await bubble.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect((await bubble.boundingBox()).width).toBeLessThan(chatBox.width * 0.8);
  }
  await expect(bubbles.nth(4).locator(".msg-text")).toHaveText("Первая строка\n\nТретья строка", { useInnerText: true });
  await expect(bubbles.nth(4).locator(".msg-text")).toHaveCSS("white-space", "pre-wrap");
  expect((await bubbles.nth(4).boundingBox()).height).toBeGreaterThan(reply.height + 20);
  await chat.evaluate((el) => { el.scrollTop = 0; });
  await screenshot(page, "chat");
  await page.locator("#tgText").fill("Короткий ответ");
  await page.locator("#tgSend").click();
  await expect(bubbles).toHaveCount(6);
  await expect(bubbles.last().locator(".msg-text")).toHaveText("Короткий ответ");
});

test("в тёмной теме все ссылки разделов кабинета читаемы, в светлой цвет возвращается", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("cabinetPhone", "+79990000000");
  });
  await page.route("**/api/cabinet?*", (route) => json(route, {
    ok: true, student: { name: "Тестовый ученик", phone: "+79990000000" },
    stats: { done: 3, upcoming: 1 }, upcomingTotal: 1, testsCount: 2, notesCount: 3, rescheduleHours: 12,
    next: { subject: "Математика", dsp: "06.09.2026", time: "16:00", status: "confirmed" },
  }));
  await page.goto("/cabinet.html");
  const titles = page.locator("#cQuick .ql-t b");
  await expect(titles).toHaveCount(4);
  for (const title of await titles.all()) await expect(title).toHaveCSS("color", "rgb(238, 240, 255)");
  for (const sub of await page.locator("#cQuick .muted-sm, #cQuick .ql-arrow").all()) {
    await expect(sub).toHaveCSS("color", "rgb(154, 163, 199)");
  }
  await screenshot(page, "cabinet-dark");
  await page.locator("#themeBtn").click();
  for (const title of await titles.all()) await expect(title).toHaveCSS("color", "rgb(20, 26, 51)");
});

test("результаты учеников и отдельные попытки визуально разделены", async ({ page }) => {
  const detail = [
    { i: 0, text: "Сколько будет 2 + 2?", given: "4", ok: true },
    { i: 1, text: "Сколько будет 3 + 3?", given: "7", ok: false },
  ];
  const assignment = {
    name: "Тестовый ученик", phone: "+79990000000", status: "finished", visible: true,
    score: 1, total: 2, answered: 2, attempts: 2, finishedAt: TODAY + "T12:00:00Z", detail,
    history: [{ n: 1, score: 0, total: 2, finishedAt: TODAY + "T11:00:00Z", detail }],
  };
  await page.route("**/api/admin/tests", (route) => json(route, { ok: true, tests: [{ id: "T1", title: "Арифметика", count: 2, maxAttempts: 3, assigned: 2, finished: 1, feedback: true, showScore: true, created: TODAY + "T10:00:00Z" }] }));
  await page.route("**/api/admin/tests/results?*", (route) => json(route, { ok: true, assignments: [
    { ...assignment, id: "A1", link: "/test.html?t=A1" },
    { ...assignment, id: "A2", name: "Другой ученик", link: "/test.html?t=A2", status: "started", score: null },
  ] }));
  await admin(page, "tests");
  await page.locator('[data-tid="T1"]').click();
  const results = page.locator(".tst-result");
  await expect(results).toHaveCount(2);
  expect(await gapBetween(results.nth(0), results.nth(1))).toBeGreaterThanOrEqual(16);
  await page.locator('[data-tdet="A1"]').click();
  const attempts = page.locator("#det-A1 .tst-attempt");
  await expect(attempts).toHaveCount(2);
  await expect(attempts.nth(0).locator("h5")).toContainText("Попытка 1");
  await expect(attempts.nth(1).locator("h5")).toContainText("Попытка 2");
  expect(await gapBetween(attempts.nth(0), attempts.nth(1))).toBeGreaterThanOrEqual(20);
  await expect(attempts.nth(0).locator(".tst-answer").first()).toHaveCSS("display", "block");
  await screenshot(page, "test-results");
  await page.locator('[data-tdet="A1"]').click();
  await expect(page.locator("#det-A1")).toBeHidden();
  await page.locator('[data-tdet="A2"]').click();
  await expect(page.locator("#det-A2 .tst-attempt").last().locator("h5")).toHaveText("Попытка 3 · в процессе");
});

async function guestTest(page) {
  await page.route("**/api/test?*", (route) => json(route, {
    ok: true, title: "Арифметика", needName: true, guest: true, status: "assigned",
    count: 1, maxAttempts: 1, attempts: 0, answeredMap: {},
    questions: [{ type: "input", text: "Сколько будет 2 + 2?" }],
  }));
  await page.goto("/test.html?t=guest-test");
  await expect(page.locator("#guestName")).toBeVisible();
}

test("гостевой тест: нейтральный текст, сохранение ФИО кнопкой и защита от повторного запроса", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const names = [];
  await page.route("**/api/test/name", async (route) => {
    names.push(route.request().postDataJSON());
    await gate;
    await json(route, { ok: true });
  });
  await guestTest(page);
  await expect(page.locator("#quiz h3")).toHaveText("Введите своё ФИО для сохранения результата");
  await expect(page.locator("#quiz")).not.toContainText("пустому ученику");
  await expect(page.locator("#quiz")).not.toContainText("В общий список учеников");
  await page.locator("#guestGo").click();
  await expect(page.locator("#guestErr")).toHaveText("Введите своё ФИО");
  expect(names).toHaveLength(0);
  await page.locator("#guestName").fill("  Иванов Иван Иванович  ");
  await expect(page.locator("#guestErr")).toBeEmpty();
  await screenshot(page, "guest-test");
  await page.locator("#guestGo").click();
  await expect(page.locator("#guestGo")).toBeDisabled();
  await page.locator("#guestName").press("Enter");
  await expect.poll(() => names.length).toBe(1);
  expect(names[0]).toEqual({ t: "guest-test", name: "Иванов Иван Иванович" });
  release();
  await expect(page.locator(".quiz-q")).toHaveText("Сколько будет 2 + 2?");
  await expect(page.locator("#tName")).toHaveText("Иванов Иван Иванович");
});

test("гостевой тест: ошибка сохранения допускает повторную отправку через Enter", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/test/name", (route) => ++requests === 1
    ? json(route, { ok: false, error: "Не удалось сохранить" }, 500)
    : json(route, { ok: true }));
  await guestTest(page);
  await page.locator("#guestName").fill("Иванов Иван Иванович");
  await page.locator("#guestName").press("Enter");
  await expect(page.locator("#guestErr")).toHaveText("Не удалось сохранить");
  await expect(page.locator("#guestGo")).toBeEnabled();
  await expect(page.locator("#guestGo")).toHaveText("Начать тест");
  await page.locator("#guestName").press("Enter");
  await expect(page.locator(".quiz-q")).toBeVisible();
  expect(requests).toBe(2);
});
