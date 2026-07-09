(() => {
  const originalFetch = window.fetch.bind(window);

  function showQuotaNotice(data) {
    if (!data || data.code !== "PLAN_LIMIT_REACHED") return;
    document.querySelector(".quotaToast")?.remove();
    const toast = document.createElement("div");
    toast.className = "quotaToast";
    toast.innerHTML = `
      <button type="button" aria-label="Close">×</button>
      <b>Plan limit reached</b>
      <span>${data.resource || "Resource"}: ${data.current || 0}/${data.limit || 0}. Upgrade your plan to continue.</span>
      <a href="#" data-open-billing>Open Billing</a>
    `;
    toast.querySelector("button").addEventListener("click", () => toast.remove());
    toast.querySelector("[data-open-billing]").addEventListener("click", (event) => {
      event.preventDefault();
      const billingButton = document.querySelector("[data-billing-button]");
      if (billingButton) billingButton.click();
      else window.location.hash = "#settings";
      toast.remove();
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 12000);
  }

  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    try {
      if (response.status === 403) {
        const clone = response.clone();
        const data = await clone.json();
        showQuotaNotice(data);
      }
    } catch (_) {}
    return response;
  };
})();
