#!/bin/bash
if [ "$GITHUB_ACTIONS" = "true" ]; then
  git lfs install || echo "(LFS install skipped or failed — maybe no .git present)"
  git lfs pull || echo "(LFS pull skipped or failed — maybe no .git present)"
fi

# Build the Docker image if it doesn't exist
docker build --platform linux/amd64 --build-arg NODE_ENV=test -t media-opticonverter .

# Run tests in Docker
if [ "$GITHUB_ACTIONS" = "true" ]; then
  echo "Running in GitHub Actions - skipping measurement tests"
  docker run --platform linux/amd64 --rm \
    -v "$(pwd):/app" \
    -w /app \
    media-opticonverter \
    npm run test:base:no-measure
else
  echo "Running locally - including measurement tests"
  docker run --platform linux/amd64 --rm \
    -v "$(pwd):/app" \
    -w /app \
    media-opticonverter \
    npm run test:base
fi