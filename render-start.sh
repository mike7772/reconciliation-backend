#!/bin/sh
# Runs both the API server and the worker in this one Render service.
# Kept as a real script (not an inline dockerCommand string) because
# Render's dockerCommand field does its own tokenization of whatever
# string you give it and is not forgiving of shell chaining or nested
# quoting - a single simple "sh render-start.sh" invocation has nothing
# for that parser to mangle, since all the actual quoting/argument
# handling happens inside this file, interpreted by a real shell.
set -e
exec npx concurrently \
  "npx ts-node --transpile-only server.ts" \
  "npx ts-node --transpile-only worker.ts"
