(() => {
  function clickByText(text) {
    const needle = String(text || "").toLowerCase();
    const buttons = Array.from(document.querySelectorAll("button"));
    const target = buttons.find((btn) => String(btn.textContent || "").trim().toLowerCase() === needle);
    if (target) target.click();
    return Boolean(target);
  }

  function routeAuthMode() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    if (!mode) return;
    const loginCard = document.querySelector(".loginCard");
    if (!loginCard) return;
    if (mode === "register") clickByText("Register");
    if (mode === "forgot") clickByText("Forgot password");
  }

  const timer = setInterval(routeAuthMode, 300);
  window.addEventListener("focus", routeAuthMode);
  setTimeout(() => clearInterval(timer), 10000);
})();
