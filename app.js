/* =========================================================
 * 任务清单 —— 交互逻辑
 * 原生 JavaScript，无任何依赖；数据保存在浏览器 localStorage。
 * ========================================================= */
(() => {
  "use strict";

  const STORAGE_KEY = "task-list.tasks.v1";
  const FILTERS = ["all", "active", "completed"];

  const EMPTY_MESSAGES = {
    all: "还没有任务，先添加一个吧。",
    active: "太棒了，当前没有未完成的任务。",
    completed: "还没有已完成的任务。",
  };

  /* ---------- 状态 ---------- */

  let tasks = loadTasks();
  let currentFilter = "all";
  let lastAddedId = null; // 仅用于给新增任务播放一次入场动画
  let focusPlan = null; // 重新渲染后需要恢复焦点的目标
  let announceTimer = null;

  /* ---------- DOM 引用 ---------- */

  const form = document.getElementById("task-form");
  const input = document.getElementById("task-input");
  const list = document.getElementById("task-list");
  const emptyState = document.getElementById("empty-state");
  const summary = document.getElementById("summary");
  const status = document.getElementById("status");
  const filterButtons = Array.from(document.querySelectorAll(".filter-btn"));
  const countEls = {};
  document.querySelectorAll(".count").forEach((el) => {
    countEls[el.dataset.count] = el;
  });

  /* ---------- 本地存储 ---------- */

  function loadTasks() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return []; // 隐私模式等场景下读取失败：以空清单启动
    }
    if (!raw) return [];

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return []; // 数据损坏：重置为空清单
    }
    if (!Array.isArray(parsed)) return [];

    const seenIds = new Set();
    const result = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.text !== "string" || item.text.trim() === "") continue;
      let id = typeof item.id === "string" && item.id !== "" ? item.id : createId();
      if (seenIds.has(id)) id = createId(); // 修复重复 id，避免勾选联动
      seenIds.add(id);
      result.push({ id, text: item.text, done: item.done === true });
    }
    return result;
  }

  function saveTasks() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (err) {
      // 写入失败（配额不足 / 隐私模式）时静默降级为仅内存保存
    }
  }

  function createId() {
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ---------- 操作 ---------- */

  function addTask(rawText) {
    const text = rawText.trim();
    if (text === "") return false; // 空内容或纯空白不允许添加

    const task = { id: createId(), text, done: false };
    tasks.push(task);
    lastAddedId = task.id;
    if (currentFilter === "completed") {
      currentFilter = "all"; // 新任务一定未完成，切回“全部”保证其可见
    }
    saveTasks();
    render();
    announce(`已添加任务：${text}`);
    return true;
  }

  function toggleTask(id) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    task.done = !task.done;
    focusPlan = { kind: "toggle", id };
    saveTasks();
    render();
    announce(task.done ? `已完成：${task.text}` : `已恢复未完成：${task.text}`);
  }

  function deleteTask(id, li) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;

    focusPlan = { kind: "index", index: Array.prototype.indexOf.call(list.children, li) };

    const commit = () => {
      tasks = tasks.filter((item) => item.id !== id);
      saveTasks();
      render();
    };

    announce(`已删除任务：${task.text}`);

    if (li) {
      li.classList.add("removing");
      let finished = false;
      const once = () => {
        if (finished) return;
        finished = true;
        commit();
      };
      li.addEventListener("transitionend", once, { once: true });
      window.setTimeout(once, 250); // 兜底：动画被禁用或未触发时也能完成删除
    } else {
      commit();
    }
  }

  function setFilter(filter) {
    if (!FILTERS.includes(filter) || filter === currentFilter) return;
    currentFilter = filter;
    render();
  }

  /* ---------- 渲染 ---------- */

  function visibleTasks() {
    if (currentFilter === "active") return tasks.filter((task) => !task.done);
    if (currentFilter === "completed") return tasks.filter((task) => task.done);
    return tasks;
  }

  function render() {
    renderList();
    renderFilters();
    renderSummary();
    applyFocusPlan();
  }

  function renderList() {
    const items = visibleTasks();
    list.textContent = "";

    const fragment = document.createDocumentFragment();
    for (const task of items) {
      fragment.appendChild(createTaskElement(task, task.id === lastAddedId));
    }
    lastAddedId = null;
    list.appendChild(fragment);

    emptyState.hidden = items.length > 0;
    emptyState.textContent = EMPTY_MESSAGES[currentFilter];
  }

  function createTaskElement(task, isNew) {
    const li = document.createElement("li");
    li.className = "task-item";
    li.dataset.id = task.id;
    if (task.done) li.classList.add("completed");
    if (isNew) li.classList.add("task-enter");

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "task-toggle";
    toggle.checked = task.done;
    toggle.setAttribute("aria-label", (task.done ? "标记为未完成：" : "标记为已完成：") + task.text);
    toggle.addEventListener("change", () => toggleTask(task.id));

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text; // 使用 textContent，避免把输入当作 HTML 解析

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "task-delete";
    remove.textContent = "删除";
    remove.setAttribute("aria-label", `删除任务：${task.text}`);
    remove.addEventListener("click", () => deleteTask(task.id, li));

    li.append(toggle, text, remove);
    return li;
  }

  function renderFilters() {
    const counts = {
      all: tasks.length,
      active: tasks.filter((task) => !task.done).length,
      completed: tasks.filter((task) => task.done).length,
    };
    for (const btn of filterButtons) {
      const filter = btn.dataset.filter;
      const isActive = filter === currentFilter;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
      if (countEls[filter]) {
        countEls[filter].textContent = String(counts[filter]);
      }
    }
  }

  function renderSummary() {
    const total = tasks.length;
    if (total === 0) {
      summary.textContent = "暂无任务，从添加第一条开始吧";
      return;
    }
    const remaining = tasks.filter((task) => !task.done).length;
    summary.textContent =
      remaining === 0
        ? `全部 ${total} 项任务已完成 🎉`
        : `共 ${total} 项，还有 ${remaining} 项未完成`;
  }

  /* ---------- 焦点恢复（整表重渲染后保持键盘操作连续性） ---------- */

  function applyFocusPlan() {
    if (!focusPlan) return;
    const plan = focusPlan;
    focusPlan = null;

    if (plan.kind === "index") {
      const items = list.querySelectorAll(".task-item");
      if (items.length === 0) {
        activeFilterButton().focus();
        return;
      }
      const target = items[Math.min(plan.index, items.length - 1)];
      const btn = target.querySelector(".task-delete");
      if (btn) btn.focus();
      return;
    }

    const li = list.querySelector(`.task-item[data-id="${CSS.escape(plan.id)}"]`);
    if (!li) {
      activeFilterButton().focus(); // 任务已不满足当前筛选条件，焦点交给筛选按钮
      return;
    }
    const control = li.querySelector(plan.kind === "toggle" ? ".task-toggle" : ".task-delete");
    if (control) control.focus();
  }

  function activeFilterButton() {
    return filterButtons.find((btn) => btn.dataset.filter === currentFilter) || filterButtons[0];
  }

  /* ---------- 无障碍播报 ---------- */

  function announce(message) {
    window.clearTimeout(announceTimer);
    status.textContent = "";
    announceTimer = window.setTimeout(() => {
      status.textContent = message;
    }, 60);
  }

  /* ---------- 事件绑定 ---------- */

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (addTask(input.value)) {
      input.value = "";
      input.classList.remove("input-error");
    } else {
      showInputError();
    }
    input.focus();
  });

  input.addEventListener("input", () => {
    input.classList.remove("input-error");
  });

  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => setFilter(btn.dataset.filter));
  });

  function showInputError() {
    input.classList.remove("input-error");
    void input.offsetWidth; // 强制重排，使连续触发时抖动动画仍能播放
    input.classList.add("input-error");
    announce("任务内容不能为空");
  }

  /* ---------- 启动 ---------- */

  render();
})();
