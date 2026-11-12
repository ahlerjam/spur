# 0003: Your own Claude Code over HTTP MCP and a plugin

## Context and Problem Statement
Users bring their own Claude. A third-party product may not offer a claude.ai login. Channels are a preview and need a dev flag.

## Considered Options
- Local Claude Code as an MCP client
- Server agent with an API key
- Connector and cloud sessions

## Decision Outcome
Local Claude Code talks to spur over HTTP MCP, set up through a plugin with the token in `userConfig`. Jobs arrive through the tool `wait_for_event`. Run 0 confirmed on 2026-11-06 with Claude Code 2.1.319 that a long call moves to the background after two minutes and that an incoming job wakes the idle session without a channel and without a dev flag. In practice the backgrounded call had to be restarted by hand, so since P8 one call waits at most 100 seconds: without a job it returns `ereignis: null` and Claude calls again at once; a newer call of the same client ends the older one with `abgeloest: true`. Users who prefer one long call can raise `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` in Claude Code. MCP tasks and channels remain options for later.

### Consequences
- spur stores no subscription data from Claude.
- Jobs only reach an open session. After each job and after every empty answer, Claude calls `wait_for_event` again; the server instructions, the tool description, the plugin skill and the start command in the Claude panel say so in the same words.
- The inbox stores events with a cursor so that nothing is lost when no call is waiting.
- Tokens are valid for 90 days, can be revoked and never carry more rights than the Overleaf account.
- Connector and cloud button are in the backlog; the HTTP interface stays open for them.
