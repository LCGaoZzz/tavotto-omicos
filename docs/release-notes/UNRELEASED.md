<!--
待发条目：已经合进 main、但还没有任何一版告诉用户的行为变更与迁移提示。

写在这里而不是留在 PR 正文里，因为发行说明是发版那天写的，写的人不会回头
翻每一个 PR 的「遗留」段——issue #244 就是这么漏掉的。

发版时（RELEASING.md 第 2 步）把下面的 `## ` 段落搬进
`docs/release-notes/vX.Y.Z.md` 并从这里删掉；带着没搬走的段落打 tag，
release.yml 的「拼 release body」当场红（scripts/check_pending_release_notes.py）。
这段注释留在原处。

英文写，与 release notes 一致：**按症状和触发条件写，不要按提交写**。
-->

## Engine-only package `omicos-figure-engine`; OmicVerse no longer imported eagerly

- A new distribution, `omicos-figure-engine`, ships just the rendering worker and
  its modules (`python -m omicos_figure_engine.worker`), depending on matplotlib and
  numpy only. Build it with `python scripts/build_engine_package.py --version X.Y.Z`.
- Opening any figure in an environment that has OmicVerse installed used to take
  10–30 s before the script even ran, because the worker imported OmicVerse on every
  build to patch `marker_heatmap`. The patch is now applied the moment a script
  imports `omicverse.pl`; scripts that never touch OmicVerse start immediately.
- Protocol additions (no version bump): `ping` replies carry `python`, `matplotlib`
  and, in the packaged engine, `engine` / `engine_version`; `preview_png` replies
  carry `warnings` (orphan gids, unsupported props, rejected values), the same list
  `render` and `export` already returned.
