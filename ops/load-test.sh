#!/usr/bin/env bash
# Load and Failure Testing for HNB Receivables Platform
#
# Usage:
#   ./ops/load-test.sh [options]
#
# Options:
#   -u, --url <url>          API base URL (default: http://localhost:4000)
#   -d, --duration <time>   Test duration (default: 30s)
#   -r, --rps <num>         Target RPS (default: 50)
#   -c, --concurrent <num>  Concurrent users (default: 10)
#   -o, --output <dir>      Output directory for results (default: ./load-test-results)
#   -h, --help              Show this help
#
# Prerequisites:
#   - Docker installed
#   - The backend API running and reachable at <url>
#   - A test database exists and migrations have been applied
#
# Example:
#   # Start the API first, then run:
#   ./ops/load-test.sh -u http://localhost:4000 -d 60s -r 100 -c 20 -o ./results

set -euo pipefail

# Default values
API_URL="${K6_TEST_URL:-http://localhost:4000}"
DURATION="${K6_DURATION:-30s}"
RPS="${K6_RPS:-50}"
CONCURRENT="${K6_CONCURRENT:-10}"
OUTPUT_DIR="${K6_OUTPUT:-./load-test-results}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

show_help() {
    grep '^#' "$0" | cut -c4-
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--url)
            API_URL="$2"
            shift 2
            ;;
        -d|--duration)
            DURATION="$2"
            shift 2
            ;;
        -r|--rps)
            RPS="$2"
            shift 2
            ;;
        -c|--concurrent)
            CONCURRENT="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

echo "=== HNB Receivables Platform Load Test ==="
echo "API URL:    $API_URL"
echo "Duration:   $DURATION"
echo "Target RPS: $RPS"
echo "Concurrent: $CONCURRENT"
echo "Output:     $OUTPUT_DIR"
echo ""

# Check if kubectl/k6 or docker is available
if command -v k6 &>/dev/null; then
    K6_CMD="k6"
elif docker pull grafana/k6:latest &>/dev/null; then
    K6_CMD="docker run --rm -i grafana/k6:latest load"
else
    echo "⚠️  k6 not installed and Docker pull failed. Install k6 or Docker with k6 image."
    echo "   - macOS: brew install k6"
    echo "   - Linux: curl -s https://raw.githubusercontent.com/k6io/k6-installer/master/k6-install.sh | bash"
    echo "   - Docker: docker pull grafana/k6:latest"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

# Simple k6 test script for critical API endpoints
TEST_SCRIPT=$(cat <<'K6SCRIPT'
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const errors = new Counter('errors');
const loginTime = new Trend('login_time');
const apiErrors = new Counter('api_errors');
const httpErrors = new Rate('http_errors');

export const options = {
  stages: [
    { duration: '10s', target: __ENV.K6_CONCURRENT * 0.3 }, // ramp up
    { duration: __ENV.K6_DURATION - '20s', target: __ENV.K6_CONCURRENT }, // steady
    { duration: '10s', target: 0 }, // ramp down
  ],
  thresholds: {
    http_errors: ['rate<0.01'],
    errors: ['count<10'],
    login_time: ['p(95)<2000'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';
let authToken = '';

function login() {
  const payload = JSON.stringify({
    email: 'loadtest-'+Math.random().toString(36).slice(2)+'@test.local',
    password: 'TestPassword123!',
  });
  const params = { headers: { 'Content-Type': 'application/json' } };
  const res = http.post(`${BASE_URL}/api/v1/auth/login`, payload, params);

  const success = check(res, {
    'login status is 200': (r) => r.status === 200,
    'has access token': (r) => !!r.json()?.accessToken,
  });

  if (success) {
    authToken = res.json().accessToken;
  } else {
    apiErrors.add(1);
  }
  return success;
}

function healthCheck() {
  const res = http.get(`${BASE_URL}/api/v1/health`);
  return check(res, { 'health is ok': (r) => r.status === 200 && r.json().status === 'ok' });
}

export default function () {
  // Health check - very lightweight
  if (!healthCheck()) {
    httpErrors.add(1);
    errors.add(1);
  }

  sleep(Math.random() * 2 + 1);

  // Simulated authenticated request
  if (authToken) {
    const res = http.get(`${BASE_URL}/api/v1/dashboard/summary`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.status === 401) {
      login();
    }
    check(res, { 'summary ok': (r) => r.status === 200 });
  } else {
    login();
  }

  sleep(Math.random() * 3 + 2);

  // List charge runs (read-heavy operation)
  if (authToken) {
    const res = http.get(`${BASE_URL}/api/v1/charge-runs?page=1&pageSize=20`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    check(res, { 'list charge-runs': (r) => r.status === 200 });
  }

  sleep(1);
}
K6SCRIPT
)

echo "Running load test..."
echo ""

# Run k6
if [[ "$K6_CMD" == "docker"*"run"* ]]; then
    docker run --rm -i \
        -e API_URL="$API_URL" \
        -e K6_DURATION="$DURATION" \
        -e K6_CONCURRENT="$CONCURRENT" \
        grafana/k6:latest load <<K6STDIN
$(echo "$TEST_SCRIPT" | envsubst)
K6STDIN
else
    echo "$TEST_SCRIPT" | env K6_CONCURRENT="$CONCURRENT" DURATION="$DURATION" API_URL="$API_URL" "$K6_CMD" run -
fi

echo ""
echo "=== Load Test Complete ==="
echo "Results saved to: $OUTPUT_DIR"