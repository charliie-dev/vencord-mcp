# Development

## Tools

mise installs nub (refer to `mise.toml`). nub installs Node (the version in `.node-version`) and
starts the scripts in `package.json`. The plugin and the tests have no package dependencies. The
`devDependencies` are only for the [demo video](#demo-video). Each has an exact version.
`nub.jsonc` stops nub from installing a version that is newer than 14 days.

| Command           | Function                                                           |
| ----------------- | ------------------------------------------------------------------ |
| `nub run test`    | Starts the smoke test and the unit tests. Discord is not necessary |
| `mise run deploy` | Copies the plugin into `$VENCORD_DIR` and builds Vencord with nub  |

After `deploy`, stop Vesktop fully (Cmd+Q) and start it again. Refer to
[setup.md](setup.md#new-versions).

## Source layout

| Path                       | Contents                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `vencord-plugin/native.ts` | Operates in the Vesktop main process. The HTTP endpoint, the MCP protocol, the tool list with hints, the call queue |
| `vencord-plugin/index.tsx` | Operates in the Discord page. The plugin settings, the permission checks and the code of each tool                  |
| `vencord-plugin/scope.ts`  | The access rules: `READ_ACTIONS`, `readonlyMode`, the server list and DMs. `index.tsx` uses it                      |
| `test/native-smoke.mjs`    | The smoke test for `native.ts`                                                                                      |
| `test/scope.test.mjs`      | The unit tests for `scope.ts`                                                                                       |
| `mise.toml`                | nub, `VENCORD_DIR`, the `deploy` task and the `demo:*` tasks                                                        |
| `.node-version`            | The Node version that nub installs                                                                                  |
| `nub.jsonc`                | The minimum age (14 days) of a package version that nub installs                                                    |
| `demo/index.html`          | The README demo video, as a HyperFrames composition                                                                 |
| `docs/`                    | These documents                                                                                                     |

`native.ts` sends each call to `index.tsx` through the plugin IPC of Vencord. `index.tsx` gets the
calls from `native.ts` in a loop (long poll). When it has a result, it sends the result back.

## Tests

The tests use `node:test`. `native.ts` uses only the modules that Node includes. Thus the smoke
test starts `native.ts` without Electron, on a free port, with a token that it makes for the test.

The smoke test examines these items:

- `server/discover`, the version check, and the error for `initialize`.
- The header checks, the `_meta` check and the Base64 format of `Mcp-Name`.
- The bearer token, and the checks of the HTTP method, the path, the host and the `Origin` header.
- The check of the tool arguments, the 413 error, and `id: null` in errors.
- A full call through a simulated Discord page, and the text of the permission errors.
- A second call that comes while the page does a first call, after a long time without calls. The
  test changes the time (`Date`) to make this condition.
- A call that gets a timeout in the queue. The Discord page must not get this call after the
  timeout.
- The rules for a second page, and a page that stops without a message.
- A token file that is empty or that the plugin cannot read.
- The hints of all tools. The read-only tools must agree with `READ_ACTIONS` in `scope.ts`.

`scope.ts` has no Discord code. Thus the unit tests examine all its access rules without Discord:
`readonlyMode`, the server list, DMs, a channel with an unknown server, the permission target, and
the server of `search_messages` and `join_voice`.

The other code in `index.tsx` operates in the Discord page and has no unit tests. Test a change to
this code in Vesktop.

## Add a tool

1. Add the tool schema to `TOOLS` in `native.ts`.
2. Add the hint of the tool to `ANNOTATIONS` in `native.ts`.
3. Add the code of the tool to `handleAction` in `index.tsx`.
4. If the tool does not change data, add its name to `READ_ACTIONS` in `scope.ts`. If you do not
   do this, `readonlyMode` stops the tool.
5. Change the number of tools in `test/native-smoke.mjs` and in [mcp.md](mcp.md#tools).
6. Do the tests.

   ```bash
   nub run test
   ```

7. Copy the plugin into Vencord and build Vencord. Then test the tool in Vesktop.

## Demo video

The README video is `demo/index.html`. HyperFrames renders this page to an MP4 file: headless
Chrome captures each frame, and ffmpeg encodes the frames. The same input gives the same video. All
the servers, persons and IDs in the video are mock data.

| Command                         | Function                                                                   |
| ------------------------------- | -------------------------------------------------------------------------- |
| `mise run demo:check`           | Examines the page: the HyperFrames rules, the layout, the motion, contrast |
| `mise run demo:snapshot 2,9,14` | Captures a frame at each of these seconds into `demo/snapshots/`           |
| `mise run demo:render`          | Renders `demo/renders/vencord-mcp.mp4`: 1920×1080, 30 fps, 48 s, no audio  |

- Before the first task, do `nub install`.
- Each task first copies GSAP and the fonts from `node_modules` into `demo/vendor/`. Thus the
  render does not use the network.
- mise installs ffmpeg only for these tasks.
- At the first render, HyperFrames downloads chrome-headless-shell into `~/.cache/hyperframes/`.
- The tasks set `HYPERFRAMES_NO_TELEMETRY=1`. HyperFrames sends telemetry by default.
- Git does not keep `demo/vendor/`, `demo/snapshots/` and `demo/renders/`.
- Do not use `hyperframes init`, because it writes skills into the repo. Do not use
  `hyperframes feedback`, because it sends to a public channel. Do not use `hyperframes publish`.

If the first render gives the error `FFmpeg cannot start`, examine ffmpeg. Then render again.

```bash
HYPERFRAMES_NO_TELEMETRY=1 mise x conda:ffmpeg@8.1.2 -- nub exec hyperframes doctor
```

### Replace the video

1. Change `demo/index.html`. If you change the name, the colors or the text, also change the
   `<title>`, the composition ID, the title card, the end card and the file name in the
   `demo:render` task.
2. Do `mise run demo:check`. Correct each error. If two layers overlap because you want them to,
   add `data-layout-allow-overlap` or `data-layout-allow-overflow` to the element.
3. Do `mise run demo:snapshot` with the important seconds. Make each highlight, click and small
   text larger, for example with `magick <frame> -crop <geometry> -resize 200%`. A small error of
   some pixels is not visible in the contact sheet.
4. Do `mise run demo:render`. With `ffprobe`, examine the size, the frame rate, the number of
   frames, the duration and the file size. The file must be smaller than 10 MB for GitHub.
5. Format the page with prettier and render again. With the `psnr` filter of ffmpeg, compare the
   new video with the previous video. The result must be `inf`.
6. On github.com, edit `README.md` and drag the MP4 file into the editor. GitHub uploads the file
   and adds its `user-attachments` URL. Replace the old URL with the new URL. Keep the URL on its
   own line.

## Commits

Use Conventional Commits: `<type>(<scope>): <subject>`.

- Write the subject in lowercase, without a period at the end.
- Make each line of the body 100 characters or less.
- Make a different commit for each change.
