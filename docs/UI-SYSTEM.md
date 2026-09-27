# Enterprise Research Workbench — UI System

## Product grammar

The desktop app is a three-column research workspace: projects on the left, project evidence and outcomes in the center, and a project-linked Agent on the right. Settings and About are secondary surfaces. The central workspace keeps the evidence trail visible beside the report so conclusions can be checked against sources.

## Visual rules

- Retain the existing Folio desktop frame and calm, compact panel grammar; do not copy or claim Craft Agents assets.
- Use semantic tokens such as `bg-background`, `bg-surface`, `bg-surface-muted`, `text-foreground`, and `border-border`.
- Keep controls and cards accessible, keyboard operable, and legible in light and dark themes.
- Label fixture data as illustrative; distinguish search excerpts from opened page text.
- Avoid stock-market metaphors, quote cards, investment badges, or financial dashboards.

## Interaction rules

- Project selection updates the center and right panes as one scope.
- Agent submission starts a project-linked run; follow-ups retain parent-run lineage.
- Show queued/running/terminal states, dynamic decisions, evidence links, errors, and cancellation.
- Monitor controls are scoped to the current project; removing an active subscription retains history.
- Keep model configuration, credential status, diagnostics, error recovery, and runtime restart accessible in settings.

## Acceptance
