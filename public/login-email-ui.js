(() => {
  const STORAGE_KEY = "domain_radar_admin_email";
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init = {}) => {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      if (url.includes("/api/auth/login") && init && init.body) {
        const body = JSON.parse(init.body);
        if (!body.email) {
          const email = document.querySelector("[data-admin-email]")?.value || localStorage.getItem(STORAGE_KEY) || "";
          body.email = email.trim().toLowerCase();
          init = { ...init, body: JSON.stringify(body) };
        }
      }
    } catch (_) {}
    return originalFetch(input, init);
  };

  function injectEmailField() {
    const form = document.querySelector(".loginCard");
    if (!form || form.querySelector("[data-admin-email]")) return;
    const password = form.querySelector('input[type="password"]');
    if (!password) return;

    const input = document.createElement("input");
    input.type = "email";
    input.inputMode = "email";
    input.autocomplete = "email";
    input.placeholder = "Admin email";
    input.setAttribute("data-admin-email", "1");
    input.value = localStorage.getItem(STORAGE_KEY) || "";
    input.addEventListener("input", () => localStorage.setItem(STORAGE_KEY, input.value.trim().toLowerCase()));
    password.parentNode.insertBefore(input, password);
  }

  const timer = setInterval(injectEmailField, 400);
  window.addEventListener("focus", injectEmailField);
  setTimeout(() => clearInterval(timer), 30000);
})();
