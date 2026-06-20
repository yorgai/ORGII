#!/bin/bash

###############################################################################
# Cleanup Orphaned Dev Processes
#
# This script kills orphaned processes from previous `npm run tauri:dev` sessions
# that weren't properly cleaned up.
#
# Usage: ./scripts/dev/cleanup-orphans.sh [--quiet]
###############################################################################

QUIET=false
if [ "${1:-}" = "--quiet" ]; then
    QUIET=true
fi

if [ "$QUIET" != "true" ]; then
    echo "🧹 Cleaning up orphaned development processes..."
    echo ""
fi

# Count processes before cleanup
BUILD_COUNT=$(ps aux | grep "build.js --watch" | grep -v grep | wc -l | xargs)
ESBUILD_COUNT=$(ps aux | grep "esbuild --service" | grep -v grep | wc -l | xargs)
ORGII_COUNT=$(pgrep -f "ORG2 Dev" | wc -l | xargs)
CARGO_ORPHAN_COUNT=$(ps aux | grep "cargo run.*no-default-features" | grep -v grep | wc -l | xargs)
PORT_PID=$(lsof -ti :1998 2>/dev/null | head -1)

if [ "$QUIET" != "true" ]; then
    echo "Found orphaned processes:"
    echo "  - Node build watchers: $BUILD_COUNT"
    echo "  - esbuild services: $ESBUILD_COUNT"
    echo "  - ORG2 Dev (webpack): $ORGII_COUNT"
    echo "  - Orphaned cargo run: $CARGO_ORPHAN_COUNT"
    if [ -n "$PORT_PID" ]; then
        echo "  - Port 1998 held by PID: $PORT_PID"
    else
        echo "  - Port 1998: free"
    fi
    echo ""
fi

TOTAL=$((BUILD_COUNT + ESBUILD_COUNT + ORGII_COUNT + CARGO_ORPHAN_COUNT))
if [ "$TOTAL" -eq 0 ] && [ -z "$PORT_PID" ]; then
    if [ "$QUIET" != "true" ]; then
        echo "✅ No orphaned processes found. System is clean!"
    fi
    exit 0
fi

# Kill orphaned processes
if [ "$QUIET" != "true" ]; then
    echo "Killing orphaned processes..."
else
    SUMMARY_PARTS=""
    [ "$BUILD_COUNT" -gt 0 ] && SUMMARY_PARTS="$SUMMARY_PARTS build-watchers=$BUILD_COUNT"
    [ "$ESBUILD_COUNT" -gt 0 ] && SUMMARY_PARTS="$SUMMARY_PARTS esbuild=$ESBUILD_COUNT"
    [ "$ORGII_COUNT" -gt 0 ] && SUMMARY_PARTS="$SUMMARY_PARTS orgii-dev=$ORGII_COUNT"
    [ "$CARGO_ORPHAN_COUNT" -gt 0 ] && SUMMARY_PARTS="$SUMMARY_PARTS cargo=$CARGO_ORPHAN_COUNT"
    [ -n "$PORT_PID" ] && SUMMARY_PARTS="$SUMMARY_PARTS port-1998=$PORT_PID"
    echo "🧹 Cleanup:${SUMMARY_PARTS}"
fi

if [ "$BUILD_COUNT" -gt 0 ]; then
    pkill -f "build.js --watch" 2>/dev/null || true
    [ "$QUIET" != "true" ] && echo "  ✓ Killed $BUILD_COUNT build watchers"
fi

if [ "$ESBUILD_COUNT" -gt 0 ]; then
    pkill -f "esbuild --service" 2>/dev/null || true
    [ "$QUIET" != "true" ] && echo "  ✓ Killed $ESBUILD_COUNT esbuild services"
fi

if [ "$ORGII_COUNT" -gt 0 ]; then
    pkill -f "ORG2 Dev" 2>/dev/null || true
    [ "$QUIET" != "true" ] && echo "  ✓ Killed $ORGII_COUNT ORG2 Dev processes"
fi

if [ "$CARGO_ORPHAN_COUNT" -gt 0 ]; then
    pkill -f "cargo run.*no-default-features" 2>/dev/null || true
    [ "$QUIET" != "true" ] && echo "  ✓ Killed $CARGO_ORPHAN_COUNT orphaned cargo run processes"
fi

if [ -n "$PORT_PID" ]; then
    kill -9 "$PORT_PID" 2>/dev/null || true
    [ "$QUIET" != "true" ] && echo "  ✓ Freed port 1998 (killed PID $PORT_PID)"
fi

# Wait a moment for processes to die
sleep 1

# Verify cleanup
if [ "$QUIET" != "true" ]; then
    echo ""
    echo "Verification:"
fi
BUILD_AFTER=$(ps aux | grep "build.js --watch" | grep -v grep | wc -l | xargs)
ESBUILD_AFTER=$(ps aux | grep "esbuild --service" | grep -v grep | wc -l | xargs)
ORGII_AFTER=$(pgrep -f "ORG2 Dev" | wc -l | xargs)
PORT_AFTER=$(lsof -ti :1998 2>/dev/null | head -1)

if [ "$QUIET" != "true" ]; then
    echo "  - Remaining build watchers: $BUILD_AFTER"
    echo "  - Remaining esbuild services: $ESBUILD_AFTER"
    echo "  - Remaining ORG2 Dev: $ORGII_AFTER"
    echo "  - Port 1998: ${PORT_AFTER:-free}"
    echo ""
fi

REMAINING=$((BUILD_AFTER + ESBUILD_AFTER + ORGII_AFTER))
if [ "$REMAINING" -eq 0 ] && [ -z "$PORT_AFTER" ]; then
    if [ "$QUIET" != "true" ]; then
        echo "✅ Cleanup successful! All orphaned processes removed."
    fi
else
    echo "⚠️  Cleanup left running processes: build-watchers=$BUILD_AFTER esbuild=$ESBUILD_AFTER orgii-dev=$ORGII_AFTER port-1998=${PORT_AFTER:-free}"
    echo "   If you're not running dev server, try running this script again."
fi

exit 0
