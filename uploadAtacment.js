(() => {
  "use strict";

  const CONFIG = Object.freeze({
    uploadUrl: "https://middle.wow24-7.net:8081/api/uploads",
    requireAttachment: false,
    maxFileSizeBytes: 20 * 1024 * 1024,
    requestTimeoutMs: 60_000,
    allowedExtensions: [
      "pdf",
      "png",
      "jpg",
      "jpeg",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "txt",
      "csv"
    ]
  });

  const state = {
    uploadInProgress: false,
    lastUploadedFileSignature: null,
    multiSelectInstances: {}
  };

  const allowedExtensions = new Set(
    (CONFIG.allowedExtensions || []).map((ext) => String(ext).toLowerCase())
  );

  function byId(id) {
    return document.getElementById(id);
  }

  function getReplyButton() {
    return byId("replyBtn");
  }

  function getForm() {
    return getReplyButton()?.form || document.querySelector("form");
  }

  function getSelectedFile() {
    return byId("attachInput")?.files?.[0] || null;
  }

  function getFileSignature(file) {
    return file ? `${file.name}::${file.size}::${file.lastModified}` : null;
  }

  function setHidden(id, value) {
    const el = byId(id);
    if (el) {
      el.value = value == null ? "" : String(value);
    }
  }

  function getHidden(id) {
    return byId(id)?.value ?? "";
  }

  function getRawElementValue(id) {
    const el = byId(id);
    if (!el) {
      return "";
    }

    if (typeof el.value === "string") {
      return el.value;
    }

    return el.textContent || "";
  }

  function setStatus(message, color = "#374151") {
    const el = byId("attachmentStatus");
    if (!el) {
      return;
    }

    el.textContent = message;
    el.style.color = color;
  }

  function setRemoveButtonVisible(visible) {
    const btn = byId("removeAttachBtn");
    if (btn) {
      btn.style.display = visible ? "inline-block" : "none";
    }
  }

  function getFileExtension(fileName) {
    const parts = String(fileName || "").split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : "";
  }

  function isCurrentFileUploaded() {
    const file = getSelectedFile();

    if (!file) {
      return getHidden("uploadOk") === "true";
    }

    return getHidden("uploadOk") === "true" && state.lastUploadedFileSignature === getFileSignature(file);
  }

  function canSubmit() {
    const hasSelectedFile = !!getSelectedFile();

    if (state.uploadInProgress) {
      return false;
    }

    if (CONFIG.requireAttachment && !isCurrentFileUploaded()) {
      return false;
    }

    if (hasSelectedFile && !isCurrentFileUploaded()) {
      return false;
    }

    return true;
  }

  function updateSubmitState() {
    const btn = getReplyButton();
    if (!btn) {
      return;
    }

    const enabled = canSubmit();
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? "1" : "0.7";
    btn.style.cursor = enabled ? "pointer" : "not-allowed";
  }

  function resetUploadState() {
    setHidden("uploadToken", "");
    setHidden("fileName", "");
    setHidden("fileSize", "");
    setHidden("mimeType", "");
    setHidden("uploadOk", "false");
    setHidden("uploadError", "");
    state.lastUploadedFileSignature = null;
    setRemoveButtonVisible(false);
    updateSubmitState();
  }

  function setUploadSuccess(file, response) {
    setHidden("uploadToken", response?.uploadToken || "");
    setHidden("fileName", response?.fileName || file.name || "");
    setHidden("fileSize", response?.fileSize || file.size || "");
    setHidden("mimeType", response?.mimeType || file.type || "");
    setHidden("uploadOk", "true");
    setHidden("uploadError", "");
    state.lastUploadedFileSignature = getFileSignature(file);
    setRemoveButtonVisible(true);
    updateSubmitState();
  }

  function setUploadFailure(message) {
    setHidden("uploadToken", "");
    setHidden("fileName", "");
    setHidden("fileSize", "");
    setHidden("mimeType", "");
    setHidden("uploadOk", "false");
    setHidden("uploadError", message || "Upload failed");
    state.lastUploadedFileSignature = null;
    setRemoveButtonVisible(false);
    updateSubmitState();
  }

  function validateSelectedFile(file) {
    if (!file) {
      return "No file selected";
    }

    const ext = getFileExtension(file.name);
    if (allowedExtensions.size > 0 && !allowedExtensions.has(ext)) {
      return `File type .${ext || "unknown"} is not allowed`;
    }

    if (Number.isFinite(CONFIG.maxFileSizeBytes) && CONFIG.maxFileSizeBytes > 0 && file.size > CONFIG.maxFileSizeBytes) {
      const maxMb = Math.round(CONFIG.maxFileSizeBytes / 1024 / 1024);
      return `File is too large. Max size: ${maxMb} MB`;
    }

    return "";
  }

  function normalizeText(raw) {
    return String(raw || "").replace(/\r/g, "").trim();
  }

  function toRecipientItem(entry) {
    if (entry == null) {
      return null;
    }

    if (typeof entry === "string") {
      const raw = entry.trim();
      if (!raw) {
        return null;
      }

      if (raw.includes("|")) {
        const [labelPart, emailPart] = raw.split("|");
        const email = String(emailPart || "").trim();
        if (!email) {
          return null;
        }

        return {
          label: String(labelPart || email).trim() || email,
          email
        };
      }

      return {
        label: raw,
        email: raw
      };
    }

    if (typeof entry === "object") {
      const email = String(entry.email || entry.value || entry.address || "").trim();
      const label = String(entry.label || entry.name || email).trim();
      if (!email) {
        return null;
      }

      return {
        label: label || email,
        email
      };
    }

    return null;
  }

  function parseRecipientSource(raw) {
    const normalized = normalizeText(raw);
    if (!normalized) {
      return [];
    }

    try {
      const parsed = JSON.parse(normalized);
      if (Array.isArray(parsed)) {
        return parsed.map(toRecipientItem).filter(Boolean);
      }
    } catch {
      // fallback below
    }

    const separator = normalized.includes("\n")
      ? /\n+/
      : normalized.includes(";")
        ? /\s*;\s*/
        : /\s*,\s*/;

    return normalized.split(separator).map(toRecipientItem).filter(Boolean);
  }

  function dedupeRecipientItems(items) {
    const seen = new Set();
    const result = [];

    for (const item of items) {
      const key = String(item.email || "").trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push({ label: item.label, email: item.email });
    }

    return result;
  }

  function parseDefaultSelectionSet(raw) {
    const items = parseRecipientSource(raw);
    return new Set(items.map((item) => String(item.email || "").trim().toLowerCase()));
  }

  function getSelectedEmailsFromSelect(select) {
    return Array.from(select.options)
      .filter((option) => option.selected)
      .map((option) => String(option.value || "").trim())
      .filter(Boolean);
  }

  function updateRecipientHiddenValues(kind) {
    const select = byId(`${kind}Select`);
    if (!select) {
      return;
    }

    const emails = getSelectedEmailsFromSelect(select);

    setHidden(`${kind}Emails`, emails.join(","));
    setHidden(`${kind}EmailsJson`, JSON.stringify(emails));

    const summary = byId(`${kind}SelectedSummary`);
    if (summary) {
      summary.textContent = emails.length === 0
        ? "No recipients selected"
        : `Selected (${emails.length}): ${emails.join(", ")}`;
    }

    updateMultiSelectToggleText(kind);
    syncMultiSelectChecks(kind);
  }

  function updateMultiSelectToggleText(kind) {
    const instance = state.multiSelectInstances[kind];
    if (!instance) {
      return;
    }

    const emails = getSelectedEmailsFromSelect(instance.select);
    if (emails.length === 0) {
      instance.toggle.textContent = instance.placeholder;
      return;
    }

    if (emails.length <= 2) {
      instance.toggle.textContent = emails.join(", ");
      return;
    }

    instance.toggle.textContent = `${emails.length} selected`;
  }

  function syncMultiSelectChecks(kind) {
    const instance = state.multiSelectInstances[kind];
    if (!instance) {
      return;
    }

    const selected = new Set(getSelectedEmailsFromSelect(instance.select).map((email) => email.toLowerCase()));
    const checkboxes = instance.optionsRoot.querySelectorAll("input[type='checkbox'][data-email]");

    checkboxes.forEach((checkbox) => {
      checkbox.checked = selected.has(String(checkbox.dataset.email || "").toLowerCase());
    });
  }

  function closeAllMultiSelectPanels(exceptKind = "") {
    Object.entries(state.multiSelectInstances).forEach(([kind, instance]) => {
      if (kind !== exceptKind) {
        instance.panel.hidden = true;
      }
    });
  }

  function createMultiSelectUi(kind, placeholder) {
    const select = byId(`${kind}Select`);
    const host = byId(`${kind}MultiSelectHost`);
    if (!select || !host) {
      return;
    }

    host.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "ms-wrapper";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ms-toggle";
    toggle.textContent = placeholder;
    toggle.disabled = select.options.length === 0;

    const panel = document.createElement("div");
    panel.className = "ms-panel";
    panel.hidden = true;

    const search = document.createElement("input");
    search.type = "text";
    search.className = "ms-search";
    search.placeholder = "Search...";

    const optionsRoot = document.createElement("div");
    optionsRoot.className = "ms-options";

    if (select.options.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ms-empty";
      empty.textContent = "No options available";
      optionsRoot.appendChild(empty);
    } else {
      Array.from(select.options).forEach((option) => {
        const row = document.createElement("label");
        row.className = "ms-option";
        row.dataset.filterText = option.textContent.toLowerCase();

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.email = option.value;
        checkbox.checked = option.selected;
        checkbox.addEventListener("change", () => {
          option.selected = checkbox.checked;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });

        const caption = document.createElement("span");
        caption.textContent = option.textContent;

        row.appendChild(checkbox);
        row.appendChild(caption);
        optionsRoot.appendChild(row);
      });
    }

    search.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      const rows = optionsRoot.querySelectorAll(".ms-option");
      rows.forEach((row) => {
        const matches = !query || String(row.dataset.filterText || "").includes(query);
        row.hidden = !matches;
      });
    });

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      const shouldOpen = panel.hidden;
      closeAllMultiSelectPanels(shouldOpen ? kind : "");
      panel.hidden = !shouldOpen;
      if (shouldOpen) {
        search.focus();
      }
    });

    panel.appendChild(search);
    panel.appendChild(optionsRoot);
    wrapper.appendChild(toggle);
    wrapper.appendChild(panel);
    host.appendChild(wrapper);

    state.multiSelectInstances[kind] = {
      select,
      host,
      wrapper,
      toggle,
      panel,
      search,
      optionsRoot,
      placeholder
    };

    updateMultiSelectToggleText(kind);
  }

  function renderRecipientGroup(kind, sourceId, defaultsId) {
    const select = byId(`${kind}Select`);
    if (!select) {
      return;
    }

    const options = dedupeRecipientItems(parseRecipientSource(getRawElementValue(sourceId)));
    const defaultSelections = parseDefaultSelectionSet(getRawElementValue(defaultsId));

    select.innerHTML = "";

    options.forEach((option) => {
      const item = document.createElement("option");
      item.value = option.email;
      item.textContent = option.label === option.email
        ? option.email
        : `${option.label} (${option.email})`;
      item.selected = defaultSelections.has(option.email.toLowerCase());
      select.appendChild(item);
    });

    select.addEventListener("change", () => updateRecipientHiddenValues(kind));
    createMultiSelectUi(kind, kind.toUpperCase());
    updateRecipientHiddenValues(kind);
  }

  async function uploadSelectedFile() {
    const input = byId("attachInput");
    const file = getSelectedFile();

    resetUploadState();

    if (!file) {
      setStatus("No file selected", "#374151");
      return;
    }

    const validationError = validateSelectedFile(file);
    if (validationError) {
      setUploadFailure(validationError);
      setStatus(validationError, "#b91c1c");
      if (input) {
        input.value = "";
      }
      return;
    }

    state.uploadInProgress = true;
    updateSubmitState();
    setStatus(`Uploading ${file.name}...`, "#2563eb");

    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("source", "cxone-runapp");
    formData.append("originalFileName", file.name);
    formData.append("bodyTextLength", String((byId("bodyText")?.value || "").length));

    const ticketId = getHidden("ticketId");
    if (ticketId) {
      formData.append("ticketId", ticketId);
    }

    const ccEmails = getHidden("ccEmails");
    if (ccEmails) {
      formData.append("ccEmails", ccEmails);
    }

    const bccEmails = getHidden("bccEmails");
    if (bccEmails) {
      formData.append("bccEmails", bccEmails);
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

    try {
      const response = await fetch(CONFIG.uploadUrl, {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
        signal: controller.signal
      });

      const rawText = await response.text();
      let data = null;

      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = null;
        }
      }

      if (!response.ok) {
        throw new Error(data?.message || data?.error || rawText || `Upload failed with status ${response.status}`);
      }

      if (!data?.uploadToken) {
        throw new Error("Middleware response does not contain uploadToken");
      }

      setUploadSuccess(file, data);
      setStatus(`Attached: ${file.name}`, "#15803d");
    } catch (err) {
      const message = err?.name === "AbortError"
        ? "Upload timed out. Please try again."
        : err?.message || "Upload failed";

      setUploadFailure(message);
      setStatus(`Upload error: ${message}`, "#b91c1c");
      console.error("Attachment upload failed:", err);
    } finally {
      window.clearTimeout(timeoutId);
      state.uploadInProgress = false;
      updateSubmitState();
    }
  }

  function clearAttachment(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const input = byId("attachInput");
    if (input) {
      input.value = "";
    }

    resetUploadState();
    setStatus("No file attached", "#374151");
  }

  function validateBeforeSubmit(event) {
    setHidden("attachmentRequired", CONFIG.requireAttachment ? "true" : "false");

    if (!getHidden("ticketId")) {
      event.preventDefault();
      setStatus("Ticket ID is missing", "#b91c1c");
      return false;
    }

    if (state.uploadInProgress) {
      event.preventDefault();
      setStatus("Please wait until the attachment upload is finished", "#b91c1c");
      return false;
    }

    if (CONFIG.requireAttachment && !isCurrentFileUploaded()) {
      event.preventDefault();
      setStatus("Attachment is required before submit", "#b91c1c");
      return false;
    }

    if (getSelectedFile() && !isCurrentFileUploaded()) {
      event.preventDefault();
      setStatus("Selected file was not uploaded successfully", "#b91c1c");
      return false;
    }

    return true;
  }

  function attachGlobalUiHandlers() {
    document.addEventListener("click", (event) => {
      const clickedInside = Object.values(state.multiSelectInstances).some((instance) => instance.wrapper.contains(event.target));
      if (!clickedInside) {
        closeAllMultiSelectPanels();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeAllMultiSelectPanels();
      }
    });
  }

  function init() {
    resetUploadState();
    setHidden("attachmentRequired", CONFIG.requireAttachment ? "true" : "false");
    setStatus("No file attached", "#374151");

    renderRecipientGroup("cc", "ccOptionsSource", "defaultCcSource");
    renderRecipientGroup("bcc", "bccOptionsSource", "defaultBccSource");
    attachGlobalUiHandlers();
    updateSubmitState();

    const form = getForm();
    if (form) {
      form.addEventListener("submit", validateBeforeSubmit);
    } else {
      const replyBtn = getReplyButton();
      if (replyBtn) {
        replyBtn.addEventListener("click", validateBeforeSubmit);
      }
    }

    const removeBtn = byId("removeAttachBtn");
    if (removeBtn) {
      removeBtn.addEventListener("click", clearAttachment);
    }
  }

  window.uploadSelectedFile = uploadSelectedFile;
  window.clearAttachment = clearAttachment;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
