## Task: Build a minimal MHT→PDF Docker service (self-contained MHT, no network fetches)

### 1) Scope and constraints
- **Input**: `.mht/.mhtml` where all resources are embedded (images/CSS/fonts via multipart/related). No external fetching.
- **Output**: `application/pdf` rendered from the MHT’s HTML content.
- **No fallbacks**, no internet access during conversion, deterministic output.
- **Scripts disabled** by default during MHT→HTML conversion.

### 2) High-level architecture
- Base container: `ghcr.io/surnet/alpine-wkhtmltopdf:3.20-0.12.6-full` (includes wkhtmltopdf dependencies).
- Add Node.js runtime and `mhtml-to-html` CLI.
- Minimal HTTP service (Node/Express):
  - `POST /mht-to-pdf`: accept multipart upload of the `.mht` file, convert to HTML (inlined), pipe to wkhtmltopdf, stream PDF.
  - `GET /healthz`: readiness/liveness probe.
- Temp workspace per request (created and deleted per call). No network egress.

### 3) Conversion pipeline (request lifecycle)
1. Receive upload (multipart form-data key `file`). Validate MIME (`message/rfc822`, `multipart/related`, or `.mht/.mhtml` filename) and size.
2. Save to unique temp dir (e.g., `/tmp/job-<uuid>`).
3. Run `mhtml-to-html` with scripts disabled and offline mode:
   - Command: `mhtml-to-html input.mht --output output.html` (no `--fetch-missing-resources`).
4. Run wkhtmltopdf on the resulting HTML and write PDF to stdout:
   - Suggested flags: `wkhtmltopdf --quiet --encoding utf-8 -s A4 -T 10mm -B 10mm -L 10mm -R 10mm - output.pdf` (use stdin/stdout piping if preferred).
5. Stream `application/pdf` back to the client.
6. Cleanup temp directory.

### 4) HTTP API contract
- `POST /mht-to-pdf`
  - Content-Type: `multipart/form-data`
  - Fields:
    - `file` (required): the MHT file.
    - Optional: `page_size` (default `A4`), `margin_top/bottom/left/right` (mm), `dpi` (integer), `disable_smart_shrinking` (bool).
  - Response: `200 OK`, body is PDF (`application/pdf`).
  - Errors:
    - `400` invalid input (missing file, too large, wrong type).
    - `422` conversion failed (bad MHT structure).
    - `500` internal error.
- `GET /healthz`: `200 OK` with `{"status":"ok"}`.

### 5) Dockerfile outline
```Dockerfile
FROM ghcr.io/surnet/alpine-wkhtmltopdf:3.20-0.12.6-full

# Install Node and fonts (for broad glyph coverage)
RUN apk add --no-cache nodejs npm font-noto ttf-freefont

# Install mhtml-to-html CLI
RUN npm i -g mhtml-to-html

# Create non-root user
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
USER app

# Copy server code
COPY --chown=app:app package*.json ./
RUN npm ci --only=production
COPY --chown=app:app . ./

ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
```

### 6) Server implementation notes (Node/Express)
- Use `multer` (or `busboy`) for streaming uploads to disk under `/tmp`.
- Generate a per-request temp dir and ensure cleanup with `finally`.
- Execute child processes with bounded timeouts and max buffer sizes (`child_process.spawn`), stream to avoid buffering large files in memory.
- Disallow `--enable-scripts` and `--fetch-missing-resources` (hardcode off) to enforce offline behavior.
- Map API options to wkhtmltopdf flags (validate/sanitize):
  - `page_size` → `-s <size>`
  - margins → `-T/-B/-L/-R <mm>`
  - `dpi` → `--dpi <int>`
  - `disable_smart_shrinking` → `--disable-smart-shrinking`
- Return streamed PDF with `Content-Type: application/pdf` and `Content-Disposition: inline; filename="output.pdf"`.

### 7) Security & isolation
- Run as non-root, restrict to `/app` and `/tmp`.
- No outbound network calls (do not pass `--fetch-missing-resources`).
- Validate upload size and set timeout per job (e.g., 120s default).
- Sanitize filenames, never execute untrusted paths.
- Consider seccomp/cap drop (if deploying on platforms supporting it).

### 8) Observability
- Structured JSON logs: start/end timestamps, durations, sizes, exit codes.
- Include request id; return it in response header `X-Request-Id`.
- Health endpoint checks: Node process OK, `mhtml-to-html --version`, `wkhtmltopdf --version` cached at startup.

### 9) Config (env vars)
- `PORT` (default 8080)
- `MAX_UPLOAD_MB` (default 25)
- `JOB_TIMEOUT_MS` (default 120000)
- `DEFAULT_PAGE_SIZE` (default A4)
- `DEFAULT_MARGINS_MM` (default 10)

### 10) Repository layout (separate repo)
```
/ (new repo)
  Dockerfile
  package.json
  package-lock.json
  server.js
  src/
    logger.js
    convert.js
    wkhtml.js
    routes.js
  README.md
  HEALTHCHECK.md
  LICENSE
```

### 11) Build & run
```bash
# Build
docker build -t mht-to-pdf:latest .

# Run
docker run --rm -p 8080:8080 mht-to-pdf:latest

# Convert (example)
curl -f -X POST \
  -F file=@/path/to/input.mht \
  http://localhost:8080/mht-to-pdf > output.pdf
```

### 12) Test plan (offline)
- Unit: simulate malformed MHT (missing HTML part) → `422`.
- E2E: sample valid MHT with embedded images/CSS → rendered PDF visually correct.
- Limits: reject files > `MAX_UPLOAD_MB`; enforce timeout.
- Concurrency: 5–10 parallel requests complete within expected bounds.

### 13) Acceptance criteria
- Produces correct PDFs from fully self-contained MHTs.
- No external network access; scripts disabled; deterministic output.
- Single `POST /mht-to-pdf` endpoint streams PDF; robust error handling.
- Container runs as non-root and cleans up temp files.

### 14) Next steps
1. Scaffold repo with Dockerfile and `server.js` stub.
2. Implement upload, temp dir handling, and child process wrappers.
3. Wire `mhtml-to-html` → `wkhtmltopdf` pipeline with streaming.
4. Add logging, config, health endpoint.
5. Write README with usage and constraints; add sample MHT for local tests.


