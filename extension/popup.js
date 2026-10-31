/* global chrome, document */

const STATES = Object.freeze({
  saved: "saved",
  saving: "saving",
  duplicate: "duplicate",
  processing: "processing",
  error: "error",
  notAuthenticated: "not-authenticated"
});

const elements = {
  feedback: document.querySelector("#feedback"),
  authView: document.querySelector("#auth-view"),
  saveView: document.querySelector("#save-view"),
  authTitle: document.querySelector("#auth-title"),
  authIntro: document.querySelector("#auth-intro"),
  authForm: document.querySelector("#auth-form"),
  authSubmit: document.querySelector("#auth-submit"),
  authSwitch: document.querySelector("#auth-switch"),
  displayNameField: document.querySelector("#display-name-field"),
  displayName: document.querySelector("#display-name"),
  email: document.querySelector("#email"),
  password: document.querySelector("#password"),
  saveButton: document.querySelector("#save-button"),
  pageCard: document.querySelector("#page-card"),
  pageTitle: document.querySelector("#page-title"),
  pageUrl: document.querySelector("#page-url"),
  appLink: document.querySelector("#app-link"),
  logoutButton: document.querySelector("#logout-button"),
  settingsLink: document.querySelector("#settings-link")
};

let authMode = "login";
let authenticated = false;

function setFeedback(state, message) {
  elements.feedback.dataset.state = state || "";
  elements.feedback.textContent = message || "";
}

function errorMessage(error) {
  const messages = {
    INVALID_CREDENTIALS: "Email or password is incorrect.",
    EMAIL_ALREADY_REGISTERED: "An account with that email already exists.",
    VALIDATION_ERROR: "Check the form details and try again.",
    INVALID_API_BASE_URL: "Check the API URL in extension settings.",
    NETWORK_ERROR: "Nook could not be reached. Check the API URL and try again.",
    PAGE_UNAVAILABLE: "This page cannot be saved. Open a regular HTTP or HTTPS page first.",
    EXACT_DUPLICATE: "This page is already in your Nook library.",
    INVALID_SERVER_RESPONSE: "Nook returned an unexpected response.",
    AUTHENTICATION_REQUIRED: "Sign in again to continue.",
    INVALID_TOKEN: "Sign in again to continue."
  };
  return messages[error?.code] || "Nook could not complete the request. Try again.";
}

function showPage(page) {
  if (!page || typeof page.url !== "string") return;
  elements.pageTitle.textContent = page.title || page.url;
  elements.pageUrl.textContent = page.url;
  elements.pageCard.hidden = false;
}

function setAuthenticated(user) {
  authenticated = true;
  elements.authView.hidden = true;
  elements.saveView.hidden = false;
  elements.logoutButton.hidden = false;
  elements.settingsLink.hidden = false;
  const name = user?.displayName || user?.email || "your library";
  setFeedback("", `Ready to save to ${name}.`);
}

function setNotAuthenticated(message = "Sign in to save this page to your personal library.") {
  authenticated = false;
  elements.authView.hidden = false;
  elements.saveView.hidden = true;
  elements.pageCard.hidden = true;
  elements.logoutButton.hidden = true;
  elements.settingsLink.hidden = false;
  setFeedback(STATES.notAuthenticated, message);
}

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";
  const registering = authMode === "register";
  elements.authTitle.textContent = registering ? "Create your Nook" : "Welcome back";
  elements.authIntro.textContent = registering
    ? "Create an account to start your personal library."
    : "Sign in to save this page to your personal library.";
  elements.displayNameField.hidden = !registering;
  elements.password.autocomplete = registering ? "new-password" : "current-password";
  elements.authSubmit.textContent = registering ? "Create account" : "Sign in";
  elements.authSwitch.textContent = registering ? "Already have an account? Sign in" : "Need an account? Register";
}

function validateAuthForm() {
  const email = elements.email.value.trim();
  const password = elements.password.value;
  const displayName = elements.displayName.value.trim();
  if (!email || !email.includes("@")) return "Enter a valid email address.";
  if (!password) return "Enter your password.";
  if (authMode === "register" && password.length < 12) return "Registration passwords must be at least 12 characters.";
  if (authMode === "register" && displayName.length > 80) return "Display name must be 80 characters or fewer.";
  return "";
}

async function send(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
      throw new Error("invalid response");
    }
    return response;
  } catch {
    return { ok: false, status: STATES.error, error: { code: "NETWORK_ERROR" } };
  }
}

async function refreshAppLink() {
  const response = await send({ type: "GET_CONFIG" });
  if (response.ok && typeof response.appUrl === "string") elements.appLink.href = response.appUrl;
}

async function loadSession() {
  setFeedback("", "Checking your Nook session…");
  const response = await send({ type: "GET_SESSION" });
  if (response.ok && response.authenticated) {
    setAuthenticated(response.user);
    return;
  }
  if (response.ok && response.status === STATES.notAuthenticated) {
    setNotAuthenticated();
    return;
  }
  setNotAuthenticated("Nook could not verify your session. Try again.");
  setFeedback(STATES.error, errorMessage(response.error));
}

async function submitAuth(event) {
  event.preventDefault();
  const validationMessage = validateAuthForm();
  if (validationMessage) {
    setFeedback(STATES.error, validationMessage);
    return;
  }

  elements.authSubmit.disabled = true;
  setFeedback("", authMode === "register" ? "Creating your account…" : "Signing in…");
  const response = await send({
    type: "AUTH_SUBMIT",
    mode: authMode,
    email: elements.email.value.trim(),
    password: elements.password.value,
    displayName: elements.displayName.value.trim()
  });
  elements.authSubmit.disabled = false;

  if (response.ok && response.authenticated) {
    elements.authForm.reset();
    setAuthenticated(response.user);
    return;
  }
  setFeedback(STATES.error, errorMessage(response.error));
}

async function savePage() {
  if (!authenticated) {
    setNotAuthenticated();
    return;
  }
  elements.saveButton.disabled = true;
  setFeedback(STATES.saving, "Saving this page to Nook…");
  const response = await send({ type: "SAVE_CURRENT_PAGE" });
  elements.saveButton.disabled = false;

  if (response.status === STATES.notAuthenticated) {
    setNotAuthenticated("Your session has expired. Sign in again to save this page.");
    return;
  }
  if (response.page) showPage(response.page);
  if (response.ok) {
    if (response.status === STATES.saved) {
      setFeedback(STATES.saved, "Saved to Nook.");
    } else if (response.status === STATES.processing) {
      setFeedback(STATES.processing, "Saved to Nook. Processing will continue in the background.");
    } else if (response.status === STATES.duplicate) {
      setFeedback(STATES.duplicate, "This page is already saved in Nook.");
    } else {
      setFeedback(STATES.error, "Nook could not finish processing this page.");
    }
    return;
  }
  setFeedback(STATES.error, errorMessage(response.error));
}

async function logout() {
  elements.logoutButton.disabled = true;
  const response = await send({ type: "LOGOUT" });
  elements.logoutButton.disabled = false;
  if (response.ok) {
    elements.pageCard.hidden = true;
    setNotAuthenticated();
  } else {
    setFeedback(STATES.error, errorMessage(response.error));
  }
}

elements.authForm.addEventListener("submit", submitAuth);
elements.authSwitch.addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
elements.saveButton.addEventListener("click", savePage);
elements.logoutButton.addEventListener("click", logout);
elements.settingsLink.addEventListener("click", () => chrome.runtime.openOptionsPage());

setAuthMode("login");
void refreshAppLink();
void loadSession();
