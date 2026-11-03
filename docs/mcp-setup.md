# Connecting an AI tool to OmniOrchestrator (MCP)

OmniOrchestrator's MCP server lets any AI tool that supports MCP (Model Context Protocol) read the
project memory, follow the current phase's skills, and record its work. Only you can approve a
phase. The server has no approve tool.

This guide works for any MCP-capable tool, including tools OmniOrchestrator has never heard of.
The desktop app can also do it for you (see [Automatic setup](#automatic-setup) for what is
available in v0.1).

## What you need

- **Node.js** installed (the server is a Node program). Check with `node --version`.
- **The built server.** In v0.1 the server runs from your OmniOrchestrator folder: run
  `npm install` and `npm run build` there. The file to run is
  `packages/mcp-server/dist/main.js` inside that folder. (A packaged server comes with the
  installer in a later version.)
- **A project.** Create one in the OmniOrchestrator app first. It is a folder with an `.agents/`
  folder inside.

## Add the server to your tool

Most tools keep their MCP servers in a JSON file under a key called `mcpServers`. Add this
entry, using full paths for your computer:

```json
{
  "mcpServers": {
    "omni-orchestrator": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/path/to/OmniOrchestrator/packages/mcp-server/dist/main.js",
        "--project",
        "C:/path/to/your/project"
      ]
    }
  }
}
```

- If the file already has other servers, add `omni-orchestrator` next to them. Don't replace the
  file.
- Some tools use the key `servers` instead of `mcpServers` (for example VS Code's
  `.vscode/mcp.json`). Use the key your tool's file already has.
- On macOS and Linux, `command` is usually `/usr/local/bin/node` or the output of `which node`.

### Where tools keep this file

It differs per tool, and tools move it between versions, so check your tool's MCP documentation.
Typical places are a project file (for example `.mcp.json`, `.cursor/mcp.json`,
`.vscode/mcp.json`) or a file in your home folder (for example `~/.cursor/mcp.json`,
`~/.gemini/settings.json`). The locations OmniOrchestrator has checked against each tool's own
documentation are listed, with sources, in [`packages/core/adapters/`](../packages/core/adapters/).

### Which project the server serves

- `--project <folder>` names the project. Use it in a config in your home folder, where the tool
  may start the server from anywhere.
- Without `--project`, the server looks for the project from the folder the tool starts it in,
  walking up to the nearest `.agents/` (or `.agents-link`). That works for a config inside the
  project when the tool starts servers in the project folder.
- An AI tool can also pass `projectPath` to any tool call.

### Your own skills

`--user-skills <folder>` adds the skills you added, edited or switched off in the app's Skills
area. The app writes it into each tool's entry for you. The folder is the app's own skills
folder (absolute path); without it, tools get the bundled skills only.

## Check that it works

1. Restart the tool, or reload its MCP servers.
2. The tool should list a server called `omni-orchestrator` with these tools: `get_context`,
   `get_phase_skills`, `submit_phase`, `create_tasks`, `submit_design_note`,
   `mark_task_trivial`, `start_task`, `complete_task`, `record_decision`, `record_problem`,
   `record_lesson`.
3. Ask the AI: *"Call get_context from omni-orchestrator."* It should report your project's name,
   current phase and tasks.

If it says no project was found, check the `--project` folder, or pass `projectPath`.

## Automatic setup

The desktop app finds the AI tools on your computer, including ones it has no special knowledge
of. For a tool with MCP support it can add the entry for you. In v0.1 this is the app's
`setup_mcp` command. The screen where you pick your tools and connect them comes in a later
step. What automatic setup does and does not do:

- It changes only its own `omni-orchestrator` entry. Your other servers and settings stay, in
  their order. The file's spacing is rewritten as standard 2-space JSON, and its line endings are
  kept.
- Before the first change it saves the original next to it as `<file>.omni-backup`.
- If the entry is already there, it writes nothing.
- It refuses, and shows you the entry to add by hand, when it can't edit the file safely: JSON
  with comments, TOML or YAML, a file that lists servers in a different shape (an `mcp` key), or
  no known config file for that tool. The file is left exactly as it was.
- It never adds an entry for a tool without MCP support. Those tools follow the project through
  `AGENTS.md` and their own instruction files instead.

After setup, restart the tool.

## Troubleshooting

| What you see | What to do |
|---|---|
| The server doesn't appear in the tool | Check the paths are absolute and exist, then restart the tool. |
| "usage: omni-orchestrator-mcp [--project <folder>]" | Only `--project <folder>` is accepted. Remove other arguments. |
| "no OmniOrchestrator project found" | Point `--project` at the project folder, the one that contains `.agents/`. |
| "The MCP server is not built yet" (app) | Run `npm run build` in the OmniOrchestrator folder. |
| "Node.js was not found on PATH" (app) | Install Node.js, then restart the app. |
