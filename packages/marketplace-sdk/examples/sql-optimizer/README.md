# SQL Optimizer — Example Agent App

Demonstrates how to build and consume a marketplace agent app using `@orgii/marketplace-sdk`.

## Setup

```bash
npm install
```

## Run the Agent

```bash
npm start
```

The agent starts on `http://localhost:8400` with two skills:

- **optimize-query** — Rewrites SQL for better performance
- **analyze-schema** — Deep analysis of database tables (supports streaming)

## Test with the Client

In a separate terminal:

```bash
npm run client
```

This sends a blocking delegation to `optimize-query` and a streaming delegation to `analyze-schema`.

## Manual Testing

```bash
# Health check
curl http://localhost:8400/health

# Agent card
curl http://localhost:8400/.well-known/agent-card.json

# Delegate (JSON-RPC)
curl -X POST http://localhost:8400 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "id": "1",
    "params": {
      "message": {
        "kind": "message",
        "messageId": "msg-1",
        "role": "user",
        "parts": [{
          "kind": "data",
          "data": {
            "skill_id": "optimize-query",
            "input": {
              "query": "SELECT * FROM users WHERE 1=1 AND active = true",
              "engine": "postgres"
            }
          }
        }]
      }
    }
  }'
```
