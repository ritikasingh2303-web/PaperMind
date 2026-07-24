const API_BASE = window.location.origin;

const els = {
  segments: document.querySelectorAll(".segment"),
  panels: document.querySelectorAll(".mode-panel"),
  textInput: document.getElementById("textInput"),
  dropzone: document.getElementById("dropzone"),
  dropzoneLabel: document.getElementById("dropzoneLabel"),
  fileInput: document.getElementById("fileInput"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  analyzeBtnLabel: document.getElementById("analyzeBtnLabel"),
  btnSpinner: document.getElementById("btnSpinner"),
  errorLine: document.getElementById("errorLine"),
  progressBarTrack: document.getElementById("progressBarTrack"),
  liveFeed: document.getElementById("liveFeed"),
  liveFeedText: document.getElementById("liveFeedText"),
  progressList: document.getElementById("progressList"),
};

let mode = "paste";
let selectedFile = null;

const PROGRESS_STEPS = [
  { key: "intake", label: "Document received" },
  { key: "model", label: "Sent to analysis model" },
  { key: "summary", label: "Summary drafted" },
  { key: "tone", label: "Tone assessed" },
  { key: "key_points", label: "Key points extracted" },
  { key: "action_items", label: "Action items checked" },
  { key: "suggested_rewrite", label: "Rewrite generated" },
];

function buildProgress() {
  els.progressList.innerHTML = PROGRESS_STEPS
    .map((s) => `<li class="progress-item" data-key="${s.key}"><span class="tick"></span><span>${s.label}</span></li>`)
    .join("");
}
buildProgress();

function markProgress(key) {
  const item = els.progressList.querySelector(`[data-key="${key}"]`);
  if (item) item.classList.add("done");
}

function resetProgress() {
  els.progressList.querySelectorAll(".progress-item").forEach((li) => li.classList.remove("done"));
}

// ---------- Segmented control ----------

els.segments.forEach((seg) => {
  seg.addEventListener("click", () => {
    mode = seg.dataset.mode;
    els.segments.forEach((s) => s.classList.toggle("active", s === seg));
    els.panels.forEach((p) => p.classList.toggle("active", p.dataset.panel === mode));
    clearError();
  });
});

// ---------- Upload handling ----------

els.dropzone.addEventListener("click", () => els.fileInput.click());

els.fileInput.addEventListener("change", () => {
  if (els.fileInput.files.length) {
    selectedFile = els.fileInput.files[0];
    els.dropzoneLabel.textContent = selectedFile.name;
  }
});

["dragover", "dragenter"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("dragover");
  })
);

["dragleave", "drop"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("dragover");
  })
);

els.dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file && file.type === "application/pdf") {
    selectedFile = file;
    els.fileInput.files = e.dataTransfer.files;
    els.dropzoneLabel.textContent = file.name;
  } else {
    showError("Only PDF files are supported.");
  }
});

// ---------- Status + errors ----------

function setStatus() {
  // Status pill was removed from the UI; progress is now shown via the
  // progress list and progress bar only.
}

function showError(msg) {
  els.errorLine.textContent = msg;
}

function clearError() {
  els.errorLine.textContent = "";
}

// ---------- Card rendering ----------

const CARD_RENDERERS = {
  summary: (val) => `<p>${escapeHtml(val)}</p>`,
  suggested_rewrite: (val) => `<p>${escapeHtml(val)}</p>`,
  tone: (val) => `
    <span class="tone-label">${escapeHtml(val.label || "")}</span>
    <p>${escapeHtml(val.justification || "")}</p>
  `,
  key_points: (val) => {
    const items = Array.isArray(val) ? val : [];
    if (!items.length) return `<p class="empty-note">No distinct key points found.</p>`;
    return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
  },
  action_items: (val) => {
    const items = Array.isArray(val) ? val : [];
    if (!items.length) return `<p class="empty-note">No action items implied by this document.</p>`;
    return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
  },
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

function fillCard(key, value) {
  const card = document.querySelector(`.result-card[data-card="${key}"]`);
  if (!card) return;
  const body = card.querySelector(".result-card-body");
  const renderer = CARD_RENDERERS[key];
  if (renderer) {
    body.innerHTML = renderer(value);
    card.classList.add("filled");
  }
  markProgress(key);
}

const PLACEHOLDERS = {
  summary: "Run an analysis to see a plain-language overview here.",
  tone: "Tone assessment will appear here.",
  key_points: "Key ideas will be extracted here.",
  action_items: "Any implied tasks or next steps will appear here.",
  suggested_rewrite: "A tightened rewrite of the opening will appear here.",
};

function resetCards() {
  document.querySelectorAll(".result-card").forEach((card) => {
    card.classList.remove("filled");
    const key = card.dataset.card;
    const body = card.querySelector(".result-card-body");
    body.innerHTML = `<p class="placeholder">${PLACEHOLDERS[key] || ""}</p>`;
  });
}

// ---------- Analyze ----------

els.analyzeBtn.addEventListener("click", runAnalysis);

function setBusy(isBusy) {
  els.analyzeBtn.disabled = isBusy;
  els.btnSpinner.hidden = !isBusy;
  els.analyzeBtnLabel.textContent = isBusy ? "Analyzing…" : "Analyze document";
}

async function runAnalysis() {
  clearError();

  let formData = new FormData();
  if (mode === "paste") {
    const text = els.textInput.value.trim();
    if (text.split(/\s+/).length < 5) {
      showError("Please paste a bit more text (at least a few sentences).");
      return;
    }
    formData.append("text", text);
  } else {
    if (!selectedFile) {
      showError("Please choose a PDF file first.");
      return;
    }
    formData.append("file", selectedFile);
  }

  resetCards();
  resetProgress();
  markProgress("intake");
  els.liveFeed.classList.add("active");
  els.liveFeedText.textContent = "";
  els.progressBarTrack.classList.add("active");
  setBusy(true);
  setStatus("running", "Analyzing");

  try {
    const response = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "Request failed." }));
      throw new Error(err.detail || "Request failed.");
    }

    markProgress("model");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });

      const events = sseBuffer.split("\n\n");
      sseBuffer = events.pop();

      for (const rawEvent of events) {
        const line = rawEvent.replace(/^data: /, "").trim();
        if (!line) continue;
        let payload;
        try {
          payload = JSON.parse(line);
        } catch {
          continue;
        }
        handleEvent(payload);
      }
    }

    setStatus("done", "Complete");
  } catch (err) {
    setStatus("error", "Error");
    showError(err.message || "Something went wrong. Please try again.");
  } finally {
    els.progressBarTrack.classList.remove("active");
    setBusy(false);
  }
}

function handleEvent(payload) {
  if (payload.type === "delta") {
    els.liveFeedText.textContent += payload.text;
    els.liveFeedText.scrollTop = els.liveFeedText.scrollHeight;
  } else if (payload.type === "field") {
    fillCard(payload.key, payload.value);
  } else if (payload.type === "error") {
    showError(payload.message);
    setStatus("error", "Error");
  } else if (payload.type === "done") {
    els.liveFeed.classList.remove("active");
  }
}
