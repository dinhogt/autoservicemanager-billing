#!/usr/bin/env sh
set -eu

yarn audit --groups dependencies --level high

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --source . --no-banner
else
  echo "gitleaks not installed; CI runs the mandatory secret scan"
fi

if command -v trivy >/dev/null 2>&1; then
  trivy fs --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .
else
  echo "trivy not installed; CI runs the mandatory filesystem scan"
fi
