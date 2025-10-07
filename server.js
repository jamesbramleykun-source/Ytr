#!/usr/bin/env node
"use strict";
const path = require("path");
const fs = require("fs");
const express = require("express");
const morgan = require("morgan");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(morgan("dev"));
app.use(bodyParser.json({ limit: "256kb" }));

// Load config if exists
const CONFIG_DIR = path.join(__dirname, ".config");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.ini");
let CONFIG = {};
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    CONFIG = parseIni(raw);
  }
} catch {}

function parseIni(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith(";")) continue;
    const idx = t.indexOf("=");
    if (idx === -1) continue;
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

function toIni(obj) {
  return Object.entries(obj).map(([k,v]) => `${k}=${String(v)}`).join("\n") + "\n";
}

function requireAuth(req, res, next) {
  const auth = req.get("authorization") || "";
  const token = (auth.startsWith("Bearer ") ? auth.slice(7) : auth) || req.query.token || req.body?.token;
  if (!CONFIG.apiToken) return res.status(401).json({ ok: false, error: "Not installed" });
  if (token !== CONFIG.apiToken) return res.status(403).json({ ok: false, error: "Forbidden" });
  next();
}

// Strict static: only specific files, no directory listing
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.get(["/index.html", "/styles.css", "/app.js"], (req, res) => {
  res.sendFile(path.join(__dirname, req.path.replace(/^\//, "")));
});
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  return res.status(404).send("Forbidden");
});

app.post("/api/install", (req, res) => {
  const { adminEmail, accessParam, getAccount, doubleCredit, apiToken, installedAt } = req.body || {};
  if (!adminEmail || !accessParam || !apiToken) {
    return res.status(400).json({ ok: false, error: "Missing fields" });
  }
  const cfg = {
    adminEmail,
    accessParam,
    getAccount: !!getAccount,
    doubleCredit: !!doubleCredit,
    apiToken,
    installedAt: installedAt || new Date().toISOString(),
  };
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(CONFIG_PATH, toIni(cfg), { mode: 0o600 });
    CONFIG = cfg;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/api/notify", requireAuth, async (req, res) => {
  const { subject, text } = req.body || {};
  if (!subject || !text) return res.status(400).json({ ok: false, error: "Missing subject/text" });
  try {
    const result = await sendMail(CONFIG.adminEmail, subject, text);
    return res.json({ ok: true, id: result.messageId || null });
  } catch (e) {
    console.log("[Email fallback log]", subject, text);
    return res.json({ ok: true, logged: true });
  }
});

async function sendMail(to, subject, text) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) throw new Error("SMTP not configured");
  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  return await transporter.sendMail({ from: user, to, subject, text });
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
