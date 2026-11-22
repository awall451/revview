---
id: qa-20261122-r5-05
title: NEEDS PERMISSION for WebFetch or an MCP tool shows only the tool name: the driver allows without seeing the URL or target
severity: minor
area: board pending entry / view permission rows
how to reproduce: /tmp/qa5-scripts/r5.mjs, cases webfetch and mcp
evidence: /tmp/qa5-shots/r5-webfetch.png, /tmp/qa5-shots/r5-mcp.png
---

## Seen

WebFetch `{url: "https://example.com/api/docs"}`: the body is one grey word "WebFetch". MCP
`mcp__github__create_issue {title: "Fix the bar"}`: one grey row with the raw name. No stale Bash command (round 3
r3-01 fix holds), but also nothing to judge the request by.

## Expected

The press is an allow; the bar is the driver's only view of what is allowed. Show the URL host/path for WebFetch
(and WebSearch query), and a short readable form for MCP (server + tool, e.g. "github: create_issue").
