#!/bin/bash

# Build the Docker image if it doesn't exist
docker build --platform linux/amd64 --build-arg NODE_ENV=test -t media-opticonverter .

# Run tests in Docker
docker run --platform linux/amd64 --rm \
  -v "$(pwd):/app" \
  -w /app \
  media-opticonverter \
  npm test 