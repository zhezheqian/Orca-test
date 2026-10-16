(function () {
  'use strict';

  var STORAGE_KEY = 'todo-app.tasks.v1';

  var els = {
    form: document.getElementById('composer'),
    input: document.getElementById('task-input'),
    error: document.getElementById('composer-error'),
    list: document.getElementById('task-list'),
    empty: document.getElementById('empty-state'),
    summary: document.getElementById('summary-line'),
    status: document.getElementById('status'),
    clearCompleted: document.getElementById('clear-completed'),
    confirm: document.getElementById('clear-confirm'),
    confirmText: document.getElementById('clear-confirm-text'),
    filterButtons: Array.prototype.slice.call(
      document.querySelectorAll('.filters__btn')
    ),
    counts: {
      all: document.querySelector('[data-count="all"]'),
      active: document.querySelector('[data-count="active"]'),
      completed: document.querySelector('[data-count="completed"]')
    }
  };

  var state = {
    tasks: [],
    filter: 'all',
    // Id of a task that should play the "just added" animation once.
    animateId: null
  };

  /* ---------- Storage ---------- */

  var storageAvailable = (function () {
    try {
      var probe = '__todo_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch (err) {
      return false;
    }
  })();

  function load() {
    if (!storageAvailable) {
      return;
    }
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return;
    }
    if (!raw) {
      return;
    }
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Ids have to stay unique: rows are addressed by id, so a duplicate
        // would make toggling or deleting one row act on another.
        var seenIds = Object.create(null);
        state.tasks = [];
        parsed.forEach(function (item) {
          var task = normalizeTask(item);
          if (!task) {
            return;
          }
          if (seenIds[task.id]) {
            task.id = createId();
          }
          seenIds[task.id] = true;
          state.tasks.push(task);
        });
      }
    } catch (err) {
      // Corrupted payload: start clean rather than breaking the page.
      console.warn('无法解析本地存储中的任务数据，已重置。', err);
    }
  }

  function normalizeTask(item) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    var text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) {
      return null;
    }
    return {
      id:
        typeof item.id === 'string' && item.id
          ? item.id
          : createId(),
      text: text,
      done: item.done === true,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0
    };
  }

  function save() {
    if (!storageAvailable) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
    } catch (err) {
      console.warn('无法写入本地存储，本次改动不会被保存。', err);
    }
  }

  /* ---------- Helpers ---------- */

  function createId() {
    return (
      't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    );
  }

  // Element ids used by aria-labelledby must be unique in the document. Task
  // ids come from storage and may contain characters that are not valid in an
  // id, so hand out a fresh counter-based id for every rendered row instead.
  var idSeq = 0;

  function nextElementId(prefix) {
    idSeq += 1;
    return prefix + '-' + idSeq;
  }

  function countBy(filter) {
    if (filter === 'active') {
      return state.tasks.filter(function (t) {
        return !t.done;
      }).length;
    }
    if (filter === 'completed') {
      return state.tasks.filter(function (t) {
        return t.done;
      }).length;
    }
    return state.tasks.length;
  }

  function visibleTasks() {
    if (state.filter === 'active') {
      return state.tasks.filter(function (t) {
        return !t.done;
      });
    }
    if (state.filter === 'completed') {
      return state.tasks.filter(function (t) {
        return t.done;
      });
    }
    return state.tasks;
  }

  function findIndex(id) {
    for (var i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === id) {
        return i;
      }
    }
    return -1;
  }

  // Rows are looked up through their data-id instead of a CSS selector: ids
  // come from storage, and a corrupted value would break the selector.
  function findRow(id) {
    var rows = els.list.children;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].dataset.id === id) {
        return rows[i];
      }
    }
    return null;
  }

  /* ---------- Delete mis-click guard ----------
   * Deleting a task re-renders the list, so every row below it slides up into
   * the freed slot. Someone who double-clicks (or keeps clicking) a delete
   * button would then fire the follow-up clicks on whichever task has just
   * moved under the pointer, losing a task they never aimed at.
   *
   * Swallow clicks that repeat (nearly) the same screen position within the
   * guard window; a click anywhere else is a deliberate deletion and is never
   * blocked. The position is recorded for swallowed clicks too, so a whole
   * burst stays guarded for as long as it lasts.
   */

  var DELETE_GUARD_MS = 500; // matches the usual double-click interval
  var DELETE_GUARD_PX = 24; // half a row, so the next row's button is out of range
  var lastDeleteClick = null;

  function isRepeatedDeleteClick(event) {
    // Keyboard activation (Enter/Space) reports detail 0 and carries no
    // pointer position; it can never be a mis-aimed repeat.
    if (!event.detail) {
      return false;
    }
    var previous = lastDeleteClick;
    lastDeleteClick = {
      x: event.clientX,
      y: event.clientY,
      time: Date.now()
    };
    if (!previous) {
      return false;
    }
    return (
      Math.abs(event.clientX - previous.x) <= DELETE_GUARD_PX &&
      Math.abs(event.clientY - previous.y) <= DELETE_GUARD_PX &&
      Date.now() - previous.time < DELETE_GUARD_MS
    );
  }

  /* ---------- Screen-reader announcements ----------
   * The list is re-rendered wholesale on every change and the visible summary
   * only reports counts, so mirror the action itself into a polite live
   * region; otherwise a screen reader user gets no confirmation at all.
   */

  var announceTimer = null;

  function announce(message) {
    if (!els.status) {
      return;
    }
    window.clearTimeout(announceTimer);
    // Empty the region first: replacing the text within the same tick is not
    // reliably picked up by screen readers.
    els.status.textContent = '';
    announceTimer = window.setTimeout(function () {
      els.status.textContent = message;
    }, 60);
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
    els.form.classList.add('is-invalid');
  }

  function clearError() {
    if (els.error.hidden) {
      return;
    }
    els.error.textContent = '';
    els.error.hidden = true;
    els.form.classList.remove('is-invalid');
  }

  /* ---------- Rendering ---------- */

  function render() {
    // Remember which control had focus so keyboard users keep their place
    // across the full re-render.
    var focusToken = describeFocused();
    var fragment = document.createDocumentFragment();
    var tasks = visibleTasks();

    tasks.forEach(function (task) {
      fragment.appendChild(buildRow(task));
    });

    els.list.textContent = '';
    els.list.appendChild(fragment);
    state.animateId = null;

    updateFilterChrome();
    updateEmptyState(tasks.length);

    restoreFocus(focusToken);
  }

  function buildRow(task) {
    var rowId = nextElementId('task-row');
    var actionId = rowId + '-action';
    var textId = rowId + '-text';

    var li = document.createElement('li');
    li.className = 'task' + (task.done ? ' is-done' : '');
    if (task.id === state.animateId) {
      li.classList.add('task--enter');
    }
    li.dataset.id = task.id;

    var toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'task__toggle';
    toggle.checked = task.done;
    // Point the checkbox at both the (visually hidden) action text and the
    // task's own text node, so every row is announced as
    // "标记为已完成 <任务内容>" instead of an identical generic label.
    toggle.setAttribute('aria-labelledby', actionId + ' ' + textId);
    toggle.addEventListener('change', function () {
      toggleTask(task.id);
    });

    var action = document.createElement('span');
    action.className = 'visually-hidden';
    action.id = actionId;
    action.textContent = task.done ? '标记为未完成' : '标记为已完成';

    // textContent (not innerHTML) keeps user input inert.
    var text = document.createElement('span');
    text.className = 'task__text';
    text.id = textId;
    text.textContent = task.text;

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'task__delete';
    remove.textContent = '×';
    remove.setAttribute('aria-label', '删除任务：' + task.text);
    remove.title = '删除';
    remove.addEventListener('click', function (event) {
      if (isRepeatedDeleteClick(event)) {
        return;
      }
      removeTask(task.id);
    });

    li.appendChild(toggle);
    li.appendChild(action);
    li.appendChild(text);
    li.appendChild(remove);
    return li;
  }

  function updateFilterChrome() {
    els.counts.all.textContent = String(countBy('all'));
    els.counts.active.textContent = String(countBy('active'));
    els.counts.completed.textContent = String(countBy('completed'));

    els.filterButtons.forEach(function (btn) {
      var isActive = btn.dataset.filter === state.filter;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    els.clearCompleted.hidden = countBy('completed') === 0;

    var total = state.tasks.length;
    var remaining = countBy('active');
    if (total === 0) {
      els.summary.textContent = '还没有任务，先添加一条吧';
    } else if (remaining === 0) {
      els.summary.textContent = '共 ' + total + ' 条任务，已全部完成 🎉';
    } else {
      els.summary.textContent =
        '共 ' + total + ' 条任务，' + remaining + ' 条未完成';
    }
  }

  function updateEmptyState(visibleCount) {
    if (visibleCount > 0) {
      els.empty.hidden = true;
      els.empty.textContent = '';
      return;
    }
    var messages = {
      all: '还没有任务，在上面输入框添加第一条吧。',
      active: '没有未完成的任务，都做完了 🎉',
      completed: '还没有已完成的任务。'
    };
    els.empty.textContent = messages[state.filter];
    els.empty.hidden = false;
  }

  function describeFocused() {
    var el = document.activeElement;
    if (!el || !els.list.contains(el)) {
      return null;
    }
    var row = el.closest('.task');
    if (!row) {
      return null;
    }
    return {
      id: row.dataset.id,
      role: el.classList.contains('task__toggle') ? 'toggle' : 'delete'
    };
  }

  function restoreFocus(token) {
    if (!token) {
      return;
    }
    var row = findRow(token.id);
    if (!row) {
      return;
    }
    var target = row.querySelector(
      token.role === 'toggle' ? '.task__toggle' : '.task__delete'
    );
    if (target) {
      target.focus();
    }
  }

  /* ---------- Actions ---------- */

  function addTask(rawText) {
    var text = rawText.trim();
    if (!text) {
      showError('任务内容不能为空，请先输入内容。');
      els.input.focus();
      return;
    }
    if (text.length > 200) {
      showError('任务内容最多 200 个字符。');
      els.input.focus();
      return;
    }

    var task = {
      id: createId(),
      text: text,
      done: false,
      createdAt: Date.now()
    };
    state.tasks.push(task);
    state.animateId = task.id;
    save();

    els.input.value = '';
    clearError();

    // A newly added task must be reachable even if the current filter
    // would hide it.
    if (state.filter === 'completed') {
      state.filter = 'all';
    }

    render();
    focusRow(task.id);
    els.input.focus();
    announce('已添加任务：' + text);
  }

  function focusRow(id) {
    var row = findRow(id);
    if (row) {
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  function toggleTask(id) {
    var index = findIndex(id);
    if (index === -1) {
      return;
    }
    var task = state.tasks[index];
    task.done = !task.done;
    save();
    render();
    announce((task.done ? '已完成：' : '已恢复未完成：') + task.text);
  }

  function removeTask(id) {
    var index = findIndex(id);
    if (index === -1) {
      return;
    }
    var removed = state.tasks.splice(index, 1)[0];
    save();
    render();
    announce('已删除任务：' + removed.text);
  }

  function clearCompleted() {
    var doneCount = countBy('completed');
    if (doneCount === 0) {
      return;
    }
    var message = '将删除 ' + doneCount + ' 条已完成的任务，此操作无法撤销。';

    if (!els.confirm || typeof els.confirm.showModal !== 'function') {
      // No <dialog> support: fall back to the native confirmation.
      if (window.confirm('清除已完成任务？\n' + message)) {
        dropCompletedTasks();
      }
      return;
    }

    els.confirmText.textContent = message;
    // Reset first, otherwise a stale "confirm" from an earlier round would be
    // read again the next time the dialog closes.
    els.confirm.returnValue = '';
    els.confirm.showModal();
  }

  function dropCompletedTasks() {
    var doneCount = countBy('completed');
    state.tasks = state.tasks.filter(function (t) {
      return !t.done;
    });
    save();
    render();
    announce('已清除 ' + doneCount + ' 条已完成的任务。');
  }

  function setFilter(filter) {
    if (state.filter === filter) {
      return;
    }
    state.filter = filter;
    render();
  }

  /* ---------- Wiring ---------- */

  els.form.addEventListener('submit', function (event) {
    event.preventDefault();
    addTask(els.input.value);
  });

  els.input.addEventListener('input', clearError);

  els.filterButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setFilter(btn.dataset.filter);
    });
  });

  els.clearCompleted.addEventListener('click', clearCompleted);

  if (els.confirm) {
    // A <dialog> closes with the submitting button's value, or an empty
    // returnValue when dismissed with Esc; only an explicit confirm deletes.
    els.confirm.addEventListener('close', function () {
      if (els.confirm.returnValue === 'confirm') {
        dropCompletedTasks();
      }
    });
  }

  load();
  render();
})();
