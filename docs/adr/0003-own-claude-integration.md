# 0003: Your own Claude Code over HTTP MCP and a plugin

## Context and Problem Statement
Users bring their own Claude. A third-party product may not offer a claude.ai login. Channels are a preview and need a dev flag.

## Considered Options
- Local Claude Code as an MCP client
- Server agent with an API key
- Connector and cloud sessions

## Decision Outcome
Local Claude Code talks to spur over HTTP MCP, set up through a plugin with the token in `userConfig`. Jobs arrive through the long-poll tool `wait_for_event` with progress messages. Run 0 confirmed this on 2026-11-06 with Claude Code 2.1.319: after two minutes the call moves to the background, and an incoming job wakes the idle session without a channel and without a dev flag. The fallback is `/spur:lauf` in the terminal; a channel remains optional.

### Consequences
- spur stores no subscription data from Claude.
- Jobs only reach an open session. After each job, Claude calls `wait_for_event` again; this is stated in the server instructions and in the plugin skill.
- The inbox stores events with a cursor so that nothing is lost when no call is waiting.
- Tokens are valid for 90 days, can be revoked and never carry more rights than the Overleaf account.
- Connector and cloud button are in the backlog; the HTTP interface stays open for them.
