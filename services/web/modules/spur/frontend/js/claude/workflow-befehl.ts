// Claude Code stellt Prompts eines Plugin-Servers als /plugin:<plugin>:<server>:<prompt> bereit (Entscheidung D3).
export const WORKFLOW_PRAEFIX = '/plugin:spur:spur:'
export const workflowBefehl = (name: string) => `${WORKFLOW_PRAEFIX}${name}`
