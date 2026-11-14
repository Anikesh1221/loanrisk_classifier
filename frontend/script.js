"use strict";

/* ---------- Config ---------- */
const API_URL = "http://127.0.0.1:8000/predict";
const REQUEST_TIMEOUT_MS = 20000;

/* Field names match the FastAPI request model exactly. */
const FIELDS = [
  { name: "person_age", label: "Age", type: "int", min: 18, max: 100 },
  { name: "person_income", label: "Annual income", type: "num", min: 0 },
  { name: "person_home_ownership", label: "Home ownership", type: "select" },
  { name: "person_emp_length", label: "Employment length", type: "num", min: 0, max: 70 },
  { name: "loan_intent", label: "Loan intent", type: "select" },
  { name: "loan_grade", label: "Loan grade", type: "select" },
  { name: "loan_amnt", label: "Loan amount", type: "num", min: 0 },
  { name: "loan_int_rate", label: "Interest rate", type: "num", min: 0, max: 100 },
  { name: "loan_percent_income", label: "Loan percent of income", type: "num", min: 0, max: 1 },
  { name: "cb_person_default_on_file", label: "Previous default", type: "select" },
  { name: "cb_person_cred_hist_length", label: "Credit history length", type: "num", min: 0, max: 80 },
];

const SAMPLE = {
  person_age: 25, person_income: 50000, person_home_ownership: "RENT",
  person_emp_length: 2.5, loan_intent: "EDUCATION", loan_grade: "B",
  loan_amnt: 10000, loan_int_rate: 11.5, loan_percent_income: 0.2,
  cb_person_default_on_file: "N", cb_person_cred_hist_length: 5,
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const form = $("riskForm");
const submitBtn = $("submitBtn");
const submitLabel = $("submitLabel");
const formError = $("formError");
const resultEl = $("result");

let isLoading = false;

/* ---------- Validation ---------- */
function getError(field) {
  const el = $(field.name);
  const raw = el.value.trim();

  if (raw === "") return field.type === "select" ? "Please choose an option." : "This field is required.";
  if (field.type === "select") return "";

  const value = Number(raw);
  if (!Number.isFinite(value)) return "Enter a valid number.";
  if (field.type === "int" && !Number.isInteger(value)) return "Enter a whole number.";
  if (field.min !== undefined && value < field.min) return `${field.label} must be ${field.min} or more.`;
  if (field.max !== undefined && value > field.max) return `${field.label} must be ${field.max} or less.`;

  // Credit history cannot be longer than the borrower's life.
  if (field.name === "cb_person_cred_hist_length") {
    const age = Number($("person_age").value);
    if (Number.isFinite(age) && age > 0 && value > age) return "Credit history cannot be longer than the borrower's age.";
  }
  return "";
}

function showFieldError(field, message) {
  const wrapper = $(field.name).closest(".field");
  wrapper.classList.toggle("invalid", Boolean(message));
  $("err_" + field.name).textContent = message;
  $(field.name).setAttribute("aria-invalid", message ? "true" : "false");
  $(field.name).setAttribute("aria-describedby", "err_" + field.name);
}

function validateForm() {
  let firstInvalid = null;
  FIELDS.forEach((field) => {
    const message = getError(field);
    showFieldError(field, message);
    if (message && !firstInvalid) firstInvalid = $(field.name);
  });
  if (firstInvalid) firstInvalid.focus();
  return !firstInvalid;
}

/* ---------- Request ---------- */
function buildPayload() {
  const payload = {};
  FIELDS.forEach((field) => {
    const raw = $(field.name).value.trim();
    payload[field.name] = field.type === "select" ? raw : Number(raw);
  });
  return payload;
}

/* Turns FastAPI error bodies (including 422 validation lists) into readable text. */
function readApiError(body, status) {
  if (body && Array.isArray(body.detail)) {
    return body.detail.map((d) => `${(d.loc || []).slice(1).join(".") || "input"}: ${d.msg}`).join("; ");
  }
  if (body && typeof body.detail === "string") return body.detail;
  return `The server responded with status ${status}.`;
}

async function requestPrediction(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let body = null;
    try { body = await response.json(); } catch (_) { /* non-JSON body */ }

    if (!response.ok) {
      const err = new Error(readApiError(body, response.status));
      err.kind = "api";
      throw err;
    }
    const valid = body && typeof body.risk_probability === "number" && typeof body.threshold === "number" &&
      typeof body.risk_status === "string" && body.prediction !== undefined;
    if (!valid) {
      const err = new Error("The server reply was missing prediction fields.");
      err.kind = "api";
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- UI state ---------- */
function setLoading(on) {
  isLoading = on;
  submitBtn.disabled = on;
  submitBtn.classList.toggle("loading", on);
  submitBtn.setAttribute("aria-busy", String(on));
  submitLabel.textContent = on ? "Assessing..." : "Assess risk";
}

function showError(title, detail) {
  formError.replaceChildren();
  const strong = document.createElement("b");
  strong.textContent = title;
  formError.append(strong, document.createTextNode(detail));
  formError.hidden = false;
}

function clearError() {
  formError.hidden = true;
  formError.replaceChildren();
}

function friendlyError(err) {
  if (err.name === "AbortError") {
    return ["The model took too long to reply.", "Check that your FastAPI server is running and try again."];
  }
  if (err.kind === "api") return ["The model could not process this request.", err.message];
  return [
    "Could not reach the prediction service.",
    "Make sure FastAPI is running at 127.0.0.1:8000 and that CORS allows this page. Then try again.",
  ];
}

/* ---------- Result ---------- */
const money = (n) => Number(n).toLocaleString("en-US");
const label = (v) => v.charAt(0) + v.slice(1).toLowerCase();

function renderResult(data, payload) {
  const probability = Math.max(0, Math.min(100, data.risk_probability));
  const thresholdPct = data.threshold * 100;
  const risky = Number(data.prediction) === 1;

  resultEl.className = "result " + (risky ? "risky" : "safe");
  $("resProb").textContent = probability.toFixed(2) + "%";
  $("resStatus").textContent = data.risk_status;
  $("resStatus").className = "chip " + (risky ? "risky" : "safe");
  $("resClass").textContent = data.risk_status;
  $("resPred").textContent = String(data.prediction);
  $("resThr").textContent = thresholdPct.toFixed(0) + "% (" + data.threshold.toFixed(2) + ")";

  $("meter").style.setProperty("--thr", thresholdPct + "%");
  $("meter").setAttribute("aria-label", `Estimated risk score ${probability.toFixed(2)} percent, threshold ${thresholdPct.toFixed(0)} percent`);
  $("meterTick").style.left = thresholdPct + "%";
  $("meterTickLabel").textContent = "Threshold " + thresholdPct.toFixed(0) + "%";
  $("meterFill").style.width = "0";

  const side = risky ? "at or above" : "below";
  $("resText").textContent =
    `The model classified this borrower as "${data.risk_status}". The estimated score of ${probability.toFixed(2)}% is ${side} ` +
    `the decision threshold of ${data.threshold.toFixed(2)}, which is the cut-off used to label a borrower as risky. ` +
    "This is an uncalibrated model score, so read it as a relative indicator and not as an exact chance of default.";

  const rows = [
    ["Age", payload.person_age + " years"],
    ["Annual income", money(payload.person_income)],
    ["Home ownership", label(payload.person_home_ownership)],
    ["Employment length", payload.person_emp_length + " years"],
    ["Loan intent", label(payload.loan_intent)],
    ["Loan grade", payload.loan_grade],
    ["Loan amount", money(payload.loan_amnt)],
    ["Interest rate", payload.loan_int_rate + "%"],
    ["Loan percent of income", payload.loan_percent_income],
    ["Previous default", payload.cb_person_default_on_file === "Y" ? "Yes" : "No"],
    ["Credit history", payload.cb_person_cred_hist_length + " years"],
  ];
  const list = $("borrowerList");
  list.replaceChildren();
  rows.forEach(([term, value]) => {
    const wrap = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = String(value);
    wrap.append(dt, dd);
    list.append(wrap);
  });

  resultEl.hidden = false;
  resultEl.style.animation = "none";
  void resultEl.offsetWidth; // restart the reveal animation
  resultEl.style.animation = "";
  requestAnimationFrame(() => { $("meterFill").style.width = probability + "%"; });
  resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Events ---------- */
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isLoading) return;
  clearError();
  if (!validateForm()) return;

  const payload = buildPayload();
  setLoading(true);
  try {
    const data = await requestPrediction(payload);
    renderResult(data, payload);
  } catch (err) {
    const [title, detail] = friendlyError(err);
    showError(title, detail);
  } finally {
    setLoading(false);
  }
});

// Validate a field once the user leaves it, and clear its error while they fix it.
FIELDS.forEach((field) => {
  const el = $(field.name);
  el.addEventListener("blur", () => { if (el.value !== "") showFieldError(field, getError(field)); });
  el.addEventListener("input", () => { if (el.closest(".field").classList.contains("invalid")) showFieldError(field, getError(field)); });
});

form.addEventListener("reset", () => {
  FIELDS.forEach((field) => showFieldError(field, ""));
  clearError();
  resultEl.hidden = true;
});

$("sampleBtn").addEventListener("click", () => {
  Object.entries(SAMPLE).forEach(([name, value]) => { $(name).value = value; });
  FIELDS.forEach((field) => showFieldError(field, ""));
  clearError();
});

$("calcPercent").addEventListener("click", () => {
  const income = Number($("person_income").value);
  const amount = Number($("loan_amnt").value);
  const target = FIELDS.find((f) => f.name === "loan_percent_income");
  if (!(income > 0) || !(amount >= 0) || $("loan_amnt").value === "") {
    showFieldError(target, "Enter annual income (above 0) and loan amount first.");
    return;
  }
  $("loan_percent_income").value = Math.min(1, amount / income).toFixed(2);
  showFieldError(target, getError(target));
});

/* Mobile navigation */
const burger = $("burger");
const menu = $("menu");
function setMenu(open) {
  menu.classList.toggle("open", open);
  burger.setAttribute("aria-expanded", String(open));
  burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}
burger.addEventListener("click", () => setMenu(!menu.classList.contains("open")));
menu.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

$("year").textContent = new Date().getFullYear();