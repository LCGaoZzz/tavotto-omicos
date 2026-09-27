# Building this runtime

The build is upstream's, with upstream's pins. Reproducing the artifact OmicOS ships
needs the same toolchain, because generated raster assets are toolchain-sensitive.

| Tool | Version |
| --- | --- |
| Python | 3.12 (upstream supports 3.10–3.14) |
| Node.js | 22 |
| pnpm | 10.34.5 |
| matplotlib | 3.10.8 (pinned by `scripts/generate_playground_examples.py`) |

```sh
# 1. frontend
cd web && pnpm install --frozen-lockfile
pnpm exec i18next-cli types && pnpm run i18n:check && pnpm run build
cd .. && rm -rf src/tavotto/web && cp -R web/dist src/tavotto/web

# 2. MCP widget + wheel
python scripts/build_mcp_widget.py
python -m build --wheel

# 3. (optional) the MCP bridge OmicOS installs alongside the wheel
#    is the codex-plugin/ directory of this tree.
```

The wheel installs as the `tavotto` distribution with the `worker` and
`pdfium-preview` extras: `pip install 'dist/<wheel>[worker,pdfium-preview]'`.

`SOURCE_DATE_EPOCH=946684800 CI=true` is set during OmicOS's own builds for
determinism.
