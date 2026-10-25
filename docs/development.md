# Development

## Tools

mise installs nub (refer to `mise.toml`). nub installs Node (the version in `.node-version`) and
runs the scripts in `package.json`. The repo has no package dependencies.

| Command           | Function                                                          |
| ----------------- | ----------------------------------------------------------------- |
| `nub run test`    | Runs the protocol smoke test. Discord is not necessary            |
| `mise run deploy` | Copies the plugin into `$VENCORD_DIR` and builds Vencord with nub |

After `deploy`, quit Vesktop (Cmd+Q) and open it again. Refer to [setup.md](setup.md#updates).

## Source layout

| Path                       | Contents                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `vencord-plugin/native.ts` | Runs in the Vesktop main process. The HTTP endpoint, the MCP protocol, the tool list with hints, the call queue |
| `vencord-plugin/index.tsx` | Runs in the Discord page. The plugin settings, the scope checks and the code of each tool                       |
| `test/native-smoke.mjs`    | The smoke test for `native.ts`                                                                                  |
| `mise.toml`                | nub, `VENCORD_DIR` and the `deploy` task                                                                        |
| `.node-version`            | The Node version that nub installs                                                                              |
| `docs/`                    | These guides                                                                                                    |

`native.ts` sends each call to `index.tsx` through the plugin IPC of Vencord. `index.tsx` asks
for calls in a loop (long poll). When it has a result, it sends the result back.

## Tests

The tests use `node:test`. `native.ts` uses only Node built-in modules. Thus the smoke test starts
`native.ts` without Electron, on port 7912, with a temporary token.

The smoke test examines these items:

- `server/discover`, the version check, and the rejection of `initialize`.
- The header checks, the `_meta` check and the Base64 form of `Mcp-Name`.
- The bearer token, and the method, path, host and origin checks.
- A full call through a simulated Discord page, and the curated permission errors.
- A second call that arrives while the page does a first call after a long idle time. The test
  changes the clock (`Date`) to make the idle time.
- The owner rules for a second page.
- The hints of all tools. The read-only tools must agree with `READ_ACTIONS` in `index.tsx`.

`index.tsx` runs in the Discord page and has no unit tests. Test a change to this file in Vesktop.

## Add a tool

1. Add the tool schema to `TOOLS` in `native.ts`.
2. Add the hint of the tool to `ANNOTATIONS` in `native.ts`.
3. Add the code of the tool to `handleAction` in `index.tsx`.
4. If the tool does not change data, add its name to `READ_ACTIONS` in `index.tsx`. If you do not
   do this, `readonlyMode` blocks the tool.
5. Change the number of tools in `test/native-smoke.mjs` and in [mcp.md](mcp.md#tools).
6. Run the tests.

   ```bash
   nub run test
   ```

7. Deploy the plugin and test the tool in Vesktop.

## Commits

Use Conventional Commits: `<type>(<scope>): <subject>`.

- Write the subject in lowercase, without a period at the end.
- Wrap the body at 100 columns.
- Make one commit for each logical change.
