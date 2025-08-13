FROM ghcr.io/surnet/alpine-wkhtmltopdf:3.22.0-024b2b2-full

# Install Node.js, npm, and fonts for broad glyph coverage
RUN apk add --no-cache nodejs npm coreutils poppler-utils chromium font-noto ttf-freefont

# Install mhtml-to-html CLI globally
RUN npm i -g mhtml-to-html

# Create non-root user
RUN addgroup -S app && adduser -S app -G app

# Prepare application directory with correct ownership
RUN mkdir -p /app && chown -R app:app /app
WORKDIR /app
USER app

# Copy server code metadata first to leverage layer caching
COPY --chown=app:app package*.json ./

# Install only production dependencies (no lockfile to keep image simple)
RUN npm install --omit=dev

# Copy application code
COPY --chown=app:app . ./

ENV PORT=8080 NODE_ENV=production
EXPOSE 8080

# Clear base image entrypoint (wkhtmltopdf) so our server runs
ENTRYPOINT []
CMD ["node", "server.js"]


