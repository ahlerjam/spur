// `--` beendet die Werkzeugliste: --allowedTools nimmt sonst auch den Prompt als Werkzeug.
export const START =
  'claude --allowedTools "mcp__plugin_spur_spur__quote_mark mcp__plugin_spur_spur__doc_edit ' +
  'mcp__plugin_spur_spur__doc_create mcp__plugin_spur_spur__reply mcp__plugin_spur_spur__run_finish ' +
  'mcp__plugin_spur_spur__wait_for_event" -- "Warte mit wait_for_event auf Aufträge aus spur. Bei ereignis: null ' +
  'rufst du es sofort erneut auf, bei abgeloest tust du nichts; einen Auftrag erledigst du und rufst danach ' +
  'wait_for_event erneut auf."'
