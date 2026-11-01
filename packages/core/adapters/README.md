# Adapters

Optional known details for one AI tool each: where it keeps its MCP configuration and which
project files it reads instructions from. OmniOrchestrator finds and uses tools without any
adapter (by category, from the tools' own files); an adapter only makes setup smoother.

- One JSON file per tool, validated by `schemas/adapter.schema.json`.
- `matches` lists the ids tool discovery gives the tool.
- Include only details you checked against the tool's own documentation, and cite each page in
  `sources` with the date you checked it. Leave out anything you could not confirm.
- Contributions welcome: add a file, run `npm test`, open a pull request.
