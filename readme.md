# radui-mcp-test

### usage 
add this into the config file

``` bash
  "mcpServers": {
    "radui-mcp": {
      "command": "npx",
      "args": ["-y", "radui-mcp"]
    }
  }

```

### generate mcp index

Use local docs to build a single `mcp.json` file:

```bash
npm run generate:mcp-json
```

This generates `./mcp.json`, which can be hosted on GitHub Pages.
Each component record in `mcp.json` contains:

- `component`
- `exports` (full source of truth: `code`, `anatomy`, `api_documentation`, `default`)
- `notes`

Top-level `mcp.json` also contains `installation` with package install methods and guide content.

### use hosted mcp.json

Set `MCP_JSON_URL` so the server reads your hosted file instead of local:

```bash
MCP_JSON_URL=https://<your-user>.github.io/<your-repo>/mcp.json
```
