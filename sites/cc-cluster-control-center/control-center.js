/* ── CC Cluster Control Center ──────────────────────────────────────────── */
(() => {
  "use strict";

  /* ── State ──────────────────────────────────────────────────────────── */
  const state = {
    tasks: [],
    nextId: 1,
    maxParallel: 4,
    dryRun: false,
    watchInterval: 5,
    summaryTail: 20,
    summaryLogDir: "",
  };

  /* ── DOM refs ───────────────────────────────────────────────────────── */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  /* ── Init ───────────────────────────────────────────────────────────── */
  function init() {
    bindTabs();
    bindLaunchForm();
    bindLaunchOptions();
    bindMonitorControls();
    bindSummaryForm();
    bindKeyboard();
    updateHeaderStats();
    startClock();
    loadSampleManifest();
  }

  /* ── Tabs ───────────────────────────────────────────────────────────── */
  function bindTabs() {
    $$(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".tab-btn").forEach((b) => b.classList.remove("active"));
        $$(".panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        const panel = $(`#panel-${btn.dataset.tab}`);
        if (panel) panel.classList.add("active");
      });
    });
  }

  /* ── Keyboard shortcuts ─────────────────────────────────────────────── */
  function bindKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (e.key === "1") clickTab("launch");
      if (e.key === "2") clickTab("monitor");
      if (e.key === "3") clickTab("summary");
    });
  }
  function clickTab(name) {
    const btn = $(`.tab-btn[data-tab="${name}"]`);
    if (btn) btn.click();
  }

  /* ── Header stats ───────────────────────────────────────────────────── */
  function updateHeaderStats() {
    const taskCount = state.tasks.length;
    const totalPrompts = state.tasks.filter((t) => t.prompt).length;
    setText("#s-tasks", taskCount);
    setText("#s-prompts", totalPrompts);
    setText("#s-parallel", state.maxParallel);
    setText("#s-estimate", estimateTotal());
  }

  function setText(sel, val) {
    const el = $(sel);
    if (el) el.textContent = val;
  }

  function estimateTotal() {
    if (state.tasks.length === 0) return "-";
    const minutes = state.tasks.length * 8;
    if (minutes < 60) return `${minutes}m`;
    return `${(minutes / 60).toFixed(1)}h`;
  }

  /* ── Clock ──────────────────────────────────────────────────────────── */
  function startClock() {
    const el = $("#clock");
    if (!el) return;
    const tick = () => {
      el.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ── Launch: form ───────────────────────────────────────────────────── */
  function bindLaunchForm() {
    const form = $("#task-form");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      addTask();
    });
    $("#btn-add-task")?.addEventListener("click", addTask);
    $("#btn-clear-all")?.addEventListener("click", () => {
      state.tasks = [];
      renderTasks();
      updateHeaderStats();
    });
    $("#btn-generate")?.addEventListener("click", generateManifest);
    $("#btn-copy-cmd")?.addEventListener("click", copyCommand);
    $("#btn-dry-run-cmd")?.addEventListener("click", copyDryRunCommand);
  }

  function addTask() {
    const name = val("#tf-name");
    const cwd = val("#tf-cwd");
    const prompt = val("#tf-prompt");
    const effort = val("#tf-effort") || "medium";
    const logName = val("#tf-logname") || name;

    if (!name) { showToast("需要任务名"); return; }
    if (!cwd) { showToast("需要工作目录"); return; }

    state.tasks.push({
      id: state.nextId++,
      name,
      cwd,
      prompt,
      effort,
      logName,
    });

    renderTasks();
    updateHeaderStats();
    clearForm(["#tf-name", "#tf-prompt", "#tf-logname"]);
    showToast(`已添加: ${name}`);
  }

  function removeTask(id) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    renderTasks();
    updateHeaderStats();
  }

  function renderTasks() {
    const list = $("#task-list");
    if (!list) return;

    if (state.tasks.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9634;</div>暂无任务</div>';
      return;
    }

    list.innerHTML = state.tasks.map((t, i) => `
      <div class="task-item">
        <span class="task-num">#${i + 1}</span>
        <span class="task-name" title="${esc(t.name)}">${esc(t.name)}</span>
        <span class="task-meta">${esc(t.effort)}</span>
        <span class="task-meta" title="${esc(t.cwd)}">${shortPath(t.cwd)}</span>
        ${t.prompt ? '<span class="tag tag-success" style="font-size:10px">prompt</span>' : '<span class="tag tag-warning" style="font-size:10px">interactive</span>'}
        <button class="task-del" data-id="${t.id}" title="删除">&times;</button>
      </div>
    `).join("");

    list.querySelectorAll(".task-del").forEach((btn) => {
      btn.addEventListener("click", () => removeTask(Number(btn.dataset.id)));
    });
  }

  /* ── Launch: options ────────────────────────────────────────────────── */
  function bindLaunchOptions() {
    const mp = $("#opt-max-parallel");
    if (mp) {
      mp.addEventListener("change", () => {
        state.maxParallel = parseInt(mp.value, 10) || 4;
        updateHeaderStats();
      });
    }
  }

  /* ── Launch: generate ───────────────────────────────────────────────── */
  function generateManifest() {
    if (state.tasks.length === 0) { showToast("先添加任务"); return; }

    const manifest = {
      generated: new Date().toISOString(),
      waves: state.tasks.map((t) => {
        const wave = { name: t.name, cwd: t.cwd, effort: t.effort, logName: t.logName };
        if (t.prompt) wave.promptFile = `prompts/${t.logName}.txt`;
        return wave;
      }),
    };

    const json = JSON.stringify(manifest, null, 2);
    setText("#manifest-output", json);
    renderCommand();
    showToast("Manifest 已生成");
  }

  function renderCommand() {
    const el = $("#command-output");
    if (!el) return;
    const parallel = state.maxParallel;
    const lines = [
      `<span class="cmd-comment"># 在 PowerShell 中运行以下命令启动集群:</span>`,
      `<span class="cmd-action">cd</span> <span class="cmd-string">"cc-ops-kit"</span>`,
      ``,
      `<span class="cmd-comment"># DryRun 先验证 manifest:</span>`,
      `<span class="cmd-action">.\\Invoke-CcWave.ps1</span> <span class="cmd-string">-ManifestPath ..\\cc-cluster-control-center\\sample-wave.json</span> <span class="cmd-action">-DryRun</span>`,
      ``,
      `<span class="cmd-comment"># 正式启动 (最大 ${parallel} 并行):</span>`,
      `<span class="cmd-action">.\\Invoke-CcWave.ps1</span> <span class="cmd-string">-ManifestPath ..\\cc-cluster-control-center\\sample-wave.json</span> <span class="cmd-action">-MaxParallel ${parallel}</span>`,
    ];
    el.innerHTML = lines.join("\n");
  }

  function copyCommand() {
    if (state.tasks.length === 0) { showToast("先生成 manifest"); return; }
    const parallel = state.maxParallel;
    const cmd = [
      `cd "cc-ops-kit"`,
      `.\\Invoke-CcWave.ps1 -ManifestPath ..\\cc-cluster-control-center\\sample-wave.json -MaxParallel ${parallel}`,
    ].join("\n");
    navigator.clipboard.writeText(cmd).then(() => showToast("命令已复制到剪贴板"));
  }

  function copyDryRunCommand() {
    const cmd = `cd "cc-ops-kit"\\n.\\Invoke-CcWave.ps1 -ManifestPath ..\\cc-cluster-control-center\\sample-wave.json -DryRun`;
    navigator.clipboard.writeText(cmd).then(() => showToast("DryRun 命令已复制"));
  }

  /* ── Monitor ────────────────────────────────────────────────────────── */
  function bindMonitorControls() {
    $("#btn-watch-refresh")?.addEventListener("click", simulateWatch);
    const sel = $("#watch-interval");
    if (sel) {
      sel.addEventListener("change", () => {
        state.watchInterval = parseInt(sel.value, 10) || 5;
      });
    }
  }

  function simulateWatch() {
    const processes = [
      { name: "claude", pid: Math.floor(Math.random() * 9000 + 1000), cpu: (Math.random() * 30).toFixed(1), mem: Math.floor(Math.random() * 400 + 100), uptime: randomUptime() },
      { name: "claude", pid: Math.floor(Math.random() * 9000 + 1000), cpu: (Math.random() * 20).toFixed(1), mem: Math.floor(Math.random() * 300 + 80), uptime: randomUptime() },
    ];

    const procsEl = $("#watch-processes");
    if (procsEl) {
      procsEl.innerHTML = processes.map((p) => `
        <div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-family:var(--font-mono);font-size:12px;">
          <span class="tag tag-success" style="font-size:10px">${p.name}</span>
          <span style="color:var(--text2)">pid=${p.pid}</span>
          <span style="color:var(--text2)">cpu=${p.cpu}s</span>
          <span style="color:var(--text2)">mem=${p.mem}MB</span>
          <span style="color:var(--text2)">up=${p.uptime}</span>
        </div>
      `).join("");
    }

    const logsEl = $("#watch-logs");
    if (logsEl) {
      const logFiles = ["invoke-wave-01.log", "invoke-wave-02.log", "invoke-wave-03.log"];
      logsEl.innerHTML = logFiles.map((f) => {
        const size = (Math.random() * 200 + 10).toFixed(1);
        const mod = new Date().toLocaleTimeString("zh-CN", { hour12: false });
        return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-family:var(--font-mono);font-size:12px;">
          <span style="color:var(--text2)">${f}</span>
          <span>${size} KB <span style="color:var(--text2)">(mod ${mod})</span></span>
        </div>`;
      }).join("");
    }

    appendWatchLog("ok", `Monitor refresh @ ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`);
  }

  function appendWatchLog(cls, msg) {
    const el = $("#watch-log-viewer");
    if (!el) return;
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const div = document.createElement("div");
    div.innerHTML = `<span class="ts">${ts}</span> <span class="${cls}">[${cls.toUpperCase()}]</span> ${esc(msg)}`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  /* ── Summary ────────────────────────────────────────────────────────── */
  function bindSummaryForm() {
    $("#btn-summary-gen")?.addEventListener("click", generateSummary);
    $("#btn-summary-copy")?.addEventListener("click", copySummaryCommand);
  }

  function generateSummary() {
    state.summaryLogDir = val("#summary-logdir") || "logs/latest";
    state.summaryTail = parseInt(val("#summary-tail") || "20", 10);

    const el = $("#summary-output");
    if (!el) return;

    const cmd = `# PowerShell 汇总命令:\n.\\Summarize-CcOutputs.ps1 -LogDir "${state.summaryLogDir}" -TailLines ${state.summaryTail}`;
    el.innerHTML = cmd;

    renderSummaryPreview();
    showToast("汇总命令已生成");
  }

  function renderSummaryPreview() {
    const preview = $("#summary-preview");
    if (!preview) return;

    const sampleLogs = [
      { task: "security-pr", status: "OK", pid: "4512", size: "42.3", lines: ["[INFO] 开始安全审计扫描", "[INFO] 检测到 3 个潜在问题", "[OK] 修复完成，所有测试通过"] },
      { task: "test-coverage", status: "OK", pid: "4518", size: "31.7", lines: ["[INFO] 生成测试用例...", "[INFO] 覆盖率: 87.3%", "[OK] 报告已写入 docs/"] },
      { task: "api-contract", status: "ERROR", pid: "4622", size: "18.9", lines: ["[INFO] 开始 API 合约验证", "[ERROR] Schema validation failed at line 42", "[WARN] 重试中..."] },
    ];

    let html = '';
    sampleLogs.forEach((log) => {
      const statusCls = log.status === "OK" ? "tag-success" : "tag-danger";
      html += `
        <div style="margin-bottom:12px;border:1px solid var(--border);border-radius:4px;padding:10px 14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-family:var(--font-mono);font-size:13px;font-weight:600;">${log.task}</span>
            <span class="tag ${statusCls}">${log.status}</span>
          </div>
          <table class="kv-table">
            <tr><td>PID</td><td>${log.pid}</td></tr>
            <tr><td>Size</td><td>${log.size} KB</td></tr>
          </table>
          <details>
            <summary style="font-size:12px;color:var(--text2);cursor:pointer;padding:4px 0;">最近输出</summary>
            <div class="code-block" style="margin-top:6px;max-height:80px;">${log.lines.map((l) => esc(l)).join("\n")}</div>
          </details>
        </div>
      `;
    });

    preview.innerHTML = html;
  }

  function copySummaryCommand() {
    const cmd = `.\\Summarize-CcOutputs.ps1 -LogDir "${state.summaryLogDir || 'logs/latest'}" -TailLines ${state.summaryTail}`;
    navigator.clipboard.writeText(cmd).then(() => showToast("汇总命令已复制"));
  }

  /* ── Sample manifest ────────────────────────────────────────────────── */
  function loadSampleManifest() {
    try {
      if (typeof sampleWave !== "undefined") {
        setText("#sample-manifest", JSON.stringify(sampleWave, null, 2));
      }
    } catch (e) { /* no-op */ }
  }

  /* ── Utilities ──────────────────────────────────────────────────────── */
  function val(sel) {
    const el = $(sel);
    return el ? el.value.trim() : "";
  }

  function clearForm(selectors) {
    selectors.forEach((s) => {
      const el = $(s);
      if (el) el.value = "";
    });
  }

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function shortPath(p) {
    if (!p) return "";
    const parts = p.replace(/\\/g, "/").split("/");
    if (parts.length <= 2) return p;
    return "..." + parts.slice(-2).join("/");
  }

  function randomUptime() {
    const h = Math.floor(Math.random() * 4);
    const m = Math.floor(Math.random() * 60);
    const s = Math.floor(Math.random() * 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function showToast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2200);
  }

  /* ── Boot ───────────────────────────────────────────────────────────── */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
