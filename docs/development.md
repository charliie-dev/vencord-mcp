# Development

## Tools

mise installs nub (refer to `mise.toml`). nub installs Node (the version in `.node-version`) and
starts the scripts in `package.json`. The repo has no package dependencies.

| Command           | Function                                                          |
| ----------------- | ----------------------------------------------------------------- |
| `nub run test`    | Starts the protocol smoke test. Discord is not necessary          |
| `mise run deploy` | Copies the plugin into `$VENCORD_DIR` and builds Vencord with nub |

After `deploy`, stop Vesktop fully (Cmd+Q) and start it again. Refer to
[setup.md](setup.md#new-versions).

## Source layout

| Path                       | Contents                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `vencord-plugin/native.ts` | Operates in the Vesktop main process. The HTTP endpoint, the MCP protocol, the tool list with hints, the call queue |
| `vencord-plugin/index.tsx` | Operates in the Discord page. The plugin settings, the access checks and the code of each tool                      |
| `test/native-smoke.mjs`    | The smoke test for `native.ts`                                                                                      |
| `mise.toml`                | nub, `VENCORD_DIR` and the `deploy` task                                                                            |
| `.node-version`            | The Node version that nub installs                                                                                  |
| `docs/`                    | These documents                                                                                                     |

`native.ts` sends each call to `index.tsx` through the plugin IPC of Vencord. `index.tsx` gets the
calls from `native.ts` in a loop (long poll). When it has a result, it sends the result back.

## Tests

The tests use `node:test`. `native.ts` uses only the modules that Node includes. Thus the smoke
test starts `native.ts` without Electron, on port 7912, with a token that it makes for the test.

The smoke test examines these items:

- `server/discover`, the version check, and the error for `initialize`.
- The header checks, the `_meta` check and the Base64 format of `Mcp-Name`.
- The bearer token, and the checks of the HTTP method, the path, the host and the `Origin` header.
- A full call through a simulated Discord page, and the text of the permission errors.
- A second call that comes while the page does a first call, after a long time without calls. The
  test changes the time (`Date`) to make this condition.
- The rules for a second page.
- The hints of all tools. The read-only tools must agree with `READ_ACTIONS` in `index.tsx`.

`index.tsx` operates in the Discord page and has no unit tests. Test a change to this file in
Vesktop.

## Add a tool

1. Add the tool schema to `TOOLS` in `native.ts`.
2. Add the hint of the tool to `ANNOTATIONS` in `native.ts`.
3. Add the code of the tool to `handleAction` in `index.tsx`.
4. If the tool does not change data, add its name to `READ_ACTIONS` in `index.tsx`. If you do not
   do this, `readonlyMode` stops the tool.
5. Change the number of tools in `test/native-smoke.mjs` and in [mcp.md](mcp.md#tools).
6. Do the tests.

   ```bash
   nub run test
   ```

7. Copy the plugin into Vencord and build Vencord. Then test the tool in Vesktop.

## Commits

Use Conventional Commits: `<type>(<scope>): <subject>`.

- Write the subject in lowercase, without a period at the end.
- Make each line of the body 100 characters or less.
- Make a different commit for each change.
