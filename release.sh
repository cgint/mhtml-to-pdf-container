#!/bin/bash

set -euo pipefail

# Release script: test, build, push
# Assumes: you are already authenticated to the registry (e.g., Docker Hub)
#
# Env vars:
#   IMAGE        Image name (default: cgint/mht-to-pdf)
#   TAG          Tag to push (default: latest)
#   PLATFORMS    If set (e.g. "linux/amd64,linux/arm64"), uses buildx multi-arch build+push
#
# Examples:
#   ./release.sh
#   TAG=0.1.0 ./release.sh
#   PLATFORMS=linux/amd64,linux/arm64 TAG=latest ./release.sh

IMAGE=${IMAGE:-cgint/mht-to-pdf}
TAG=${TAG:-latest}

step() {
  echo
  echo "==> $*"
}

step "Install deps (npm ci)"
# mht-to-pdf-container has a package-lock.json
npm ci

step "Run smoke test via ./run_test.sh"
# run_test.sh brings up docker compose, sends a curl request, but does not tear down.
# Ensure we always tear down afterwards.
(
  set -e
  ./run_test.sh
)

docker compose down >/dev/null 2>&1 || true

if [ -n "${PLATFORMS:-}" ]; then
  step "Build + push multi-arch image via buildx (${PLATFORMS})"
  docker buildx build \
    --platform "${PLATFORMS}" \
    -t "${IMAGE}:${TAG}" \
    --push \
    .
else
  step "Build image"
  docker build -t "${IMAGE}:${TAG}" .

  step "Push image"
  docker push "${IMAGE}:${TAG}"
fi

step "Done"
echo "Pushed: ${IMAGE}:${TAG}"
