/* global chrome, document */

const DEFAULT_API_BASE_URL = "http://localhost:3000";
const feedback = document.querySelector("#feedback");
const form = document.querySelector("#config-form");
const input = document.querySelector("#api-base-url");
const resetButton = document.querySelector("#reset-button");
const appLink = document.querySelector("#app-link");

function setFeedback(state, message) {
  feedback.dataset.state = state || "";
  feedback.textContent = message || "";
}

async function send(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response || typeof response !== "object" || typeof response.ok !== "boolean") throw new Error("invalid response");
    return response;
  } catch {
    return { ok: false, error: { code: "NETWORK_ERROR" } };
  }
}

function updateLink(value) {
  if (typeof value === "string" && value) appLink.href = value;
}

async function loadConfig() {
  const response = await send({ type: "GET_CONFIG" });
  if (response.ok && typeof response.apiBaseUrl === "string") {
    input.value = response.apiBaseUrl;
    updateLink(typeof response.appUrl === "string" ? response.appUrl : "http://localhost:5173");
    return;
  }
  input.value = DEFAULT_API_BASE_URL;
  setFeedback("error", "Could not load the saved setting.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await send({ type: "SET_CONFIG", apiBaseUrl: input.value });
  if (!response.ok) {
    setFeedback("error", response.error?.code === "INVALID_API_BASE_URL"
      ? "Enter an HTTP or HTTPS origin, such as http://localhost:3000."
      : "Could not save this setting.");
    return;
  }
  input.value = response.apiBaseUrl;
  updateLink("http://localhost:5173");
  setFeedback("saved", "Settings saved.");
});

resetButton.addEventListener("click", () => {
  input.value = DEFAULT_API_BASE_URL;
  input.focus();
});

void loadConfig();
