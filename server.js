"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { randomUUID } = require("crypto");
const multer = require("multer");
const { spawn } = require("child_process");
const pino = require("pino");
const pinoHttp = require("pino-http");

const PORT = parseInt(process.env.PORT || "8080", 10);
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || "25", 10);
const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || "120000", 10);
const DEFAULT_PAGE_SIZE = process.env.DEFAULT_PAGE_SIZE || "A4";
const DEFAULT_MARGINS_MM = parseInt(process.env.DEFAULT_MARGINS_MM || "10", 10);
const RENDERER = (process.env.RENDERER || "wkhtml").toLowerCase();

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();
app.use(pinoHttp({ logger, genReqId: () => randomUUID() }));

// Multer storage to temp directory
const upload = multer({
  dest: path.join(os.tmpdir(), "mht2pdf-uploads"),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

function buildWkhtmlArgs(htmlPath, opts) {
  const args = [
    "--encoding",
    "utf-8",
    "--disable-javascript",
    "--enable-local-file-access",
    "--load-error-handling",
    "ignore",
    "--print-media-type",
    "-s",
    opts.pageSize || DEFAULT_PAGE_SIZE,
    "-T",
    String(opts.marginTop ?? DEFAULT_MARGINS_MM) + "mm",
    "-B",
    String(opts.marginBottom ?? DEFAULT_MARGINS_MM) + "mm",
    "-L",
    String(opts.marginLeft ?? DEFAULT_MARGINS_MM) + "mm",
    "-R",
    String(opts.marginRight ?? DEFAULT_MARGINS_MM) + "mm",
  ];

  if (opts.dpi && Number.isInteger(opts.dpi)) {
    args.push("--dpi", String(opts.dpi));
  }
  if (opts.disableSmartShrinking === true) {
    args.push("--disable-smart-shrinking");
  }
  args.push(htmlPath, "-"); // output to stdout
  return args;
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Process timeout after ${JOB_TIMEOUT_MS}ms: ${cmd}`));
    }, JOB_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ code, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
    });

    resolve.child = child; // expose child for piping if needed
  });
}

async function convertMhtToPdf(mhtPath, wkhtmlOptions, res) {
  const jobDir = path.join(os.tmpdir(), `job-${randomUUID()}`);
  await fs.promises.mkdir(jobDir, { recursive: true });
  const jobMhtPath = path.join(jobDir, "input.mht");
  const pdfPath = path.join(jobDir, "output.pdf");

  try {
    // Copy input into job directory with a fixed name
    await fs.promises.copyFile(mhtPath, jobMhtPath);

    // Single-step: render MHT directly to PDF using headless Chromium
    const chromeArgs = [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-software-rasterizer",
      "--allow-file-access-from-files",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost",
      "--virtual-time-budget=10000",
      `--print-to-pdf=${pdfPath}`,
      `file://${jobMhtPath}`,
    ];

    // Try chromium-browser first, then chromium as a fallback
    const runChromium = (bin) => new Promise((resolve, reject) => {
      const child = spawn(bin, chromeArgs, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`chromium timeout after ${JOB_TIMEOUT_MS}ms`));
      }, JOB_TIMEOUT_MS);
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => {
        clearTimeout(t);
        if (code === 0) resolve();
        else reject(new Error(`chromium failed (${code}): ${stderr}`));
      });
      child.on("error", reject);
    });

    try {
      await runChromium("chromium-browser");
    } catch (err) {
      if (err && err.code === "ENOENT") {
        // binary not found → try alternate name
        await runChromium("chromium");
      } else {
        throw err;
      }
    }

    // Stream the generated PDF to the response
    const stat = await fs.promises.stat(pdfPath).catch(() => null);
    if (!stat || stat.size === 0) {
      throw new Error("wkhtmltopdf produced empty output");
    }
    // Check page count via pdfinfo and reject zero-page PDFs
    const pages = await new Promise((resolve) => {
      const child = spawn("pdfinfo", [pdfPath], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.on("close", () => {
        const m = out.match(/Pages:\s+(\d+)/i);
        resolve(m ? parseInt(m[1], 10) : 0);
      });
      child.on("error", () => resolve(0));
    });
    if (!pages || pages <= 0) {
      throw new Error("wkhtmltopdf produced a zero-page PDF");
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=output.pdf");
    await new Promise((resolve, reject) => {
      const read = fs.createReadStream(pdfPath);
      read.on("error", reject);
      res.on("error", reject);
      res.on("finish", resolve);
      read.pipe(res);
    });
  } finally {
    // Cleanup
    if (process.env.KEEP_JOBS === "1") {
      // keep for debugging
    } else {
      try {
        await fs.promises.rm(jobDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

app.get("/healthz", async (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/mht-to-pdf", upload.single("file"), async (req, res) => {
  const requestId = req.id || randomUUID();
  if (!req.file) {
    res.status(400).json({ error: "missing file field 'file'" });
    return;
  }
  // Validate filename extension (best-effort)
  const original = req.file.originalname || "";
  const lower = original.toLowerCase();
  if (!(lower.endsWith(".mht") || lower.endsWith(".mhtml"))) {
    // allow but warn; some uploaders may not set extension
    req.log.warn({ requestId, original }, "File does not have .mht/.mhtml extension");
  }

  // Map options
  const options = {
    pageSize: req.body?.page_size,
    marginTop: req.body?.margin_top ? parseInt(req.body.margin_top, 10) : undefined,
    marginBottom: req.body?.margin_bottom ? parseInt(req.body.margin_bottom, 10) : undefined,
    marginLeft: req.body?.margin_left ? parseInt(req.body.margin_left, 10) : undefined,
    marginRight: req.body?.margin_right ? parseInt(req.body.margin_right, 10) : undefined,
    dpi: req.body?.dpi ? parseInt(req.body.dpi, 10) : undefined,
    disableSmartShrinking: req.body?.disable_smart_shrinking === "true" || req.body?.disable_smart_shrinking === true,
  };

  res.setHeader("X-Request-Id", requestId);

  try {
    await convertMhtToPdf(req.file.path, options, res);
  } catch (err) {
    req.log.error({ err, requestId }, "conversion failed");
    if (!res.headersSent) {
      res.status(422).json({ error: "conversion failed" });
    } else {
      try { res.end(); } catch {}
    }
  } finally {
    // cleanup uploaded temp file
    if (req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }
});

app.use((err, req, res, next) => {
  req.log?.error({ err }, "unhandled error");
  res.status(500).json({ error: "internal error" });
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, "server started");
});


