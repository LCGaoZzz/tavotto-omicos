"""engine-only distribution `omicos-figure-engine`（`scripts/build_engine_package.py`）。

三件事各一条看护，缺一条就是空门禁：

* 打包清单 == worker 的 import 闭包（**两个方向**都钉：漏一个模块装出来的包
  第一次 import 就炸；多一个模块就是把 Flask 侧的东西悄悄塞进 OmicOS 的环境）；
* 装出来的包在 flask / pymupdf / tavotto 全都 import 不了的解释器里照样跑通
  v1 协议（这正是 OmicOS 的运行形态：只有 matplotlib + numpy）；
* OmicVerse 垫片是**懒**的：没 import OmicVerse 的脚本一分钱不付，import 了的
  脚本在 `omicverse.pl` 落地之后立刻被打上垫片。

都要一个装了 matplotlib 的解释器（与 `test_worker_roundtrip.py` 同一条判据），
没有就整文件 skip。
"""

from __future__ import annotations

import contextlib
import importlib.util
import json
import os
import re
import subprocess
import textwrap
from pathlib import Path

import pytest

from tavotto.engine import pool

ROOT = Path(__file__).resolve().parents[1]
ENGINE_DIR = ROOT / "src" / "tavotto" / "engine"
SCRIPT = ROOT / "scripts" / "build_engine_package.py"

try:
    WORKER_PY = pool.find_worker_python()
except pool.WorkerError:
    WORKER_PY = None

pytestmark = pytest.mark.skipif(
    WORKER_PY is None, reason="找不到装有 matplotlib 的解释器（TAVOTTO_WORKER_PYTHON）"
)


def _build_module():
    spec = importlib.util.spec_from_file_location("build_engine_package", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def staged(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("engine-package")
    return _build_module().stage(out, "0.0.0+test")


def _run(
    code: str, env: dict | None = None, cwd: Path | None = None
) -> subprocess.CompletedProcess:
    full_env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    if env:
        full_env.update(env)
    return subprocess.run(
        [WORKER_PY, "-c", textwrap.dedent(code)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=full_env,
        cwd=cwd,
    )


def test_shipped_modules_are_exactly_the_worker_import_closure():
    """`ENGINE_MODULES` ↔ 真正 import worker 时落进 sys.modules 的引擎模块，双向相等。"""
    proc = _run(
        f"""
        import json, os, sys
        engine = {str(ENGINE_DIR)!r}
        sys.path.insert(0, engine)
        before = set(sys.modules)
        import worker  # noqa: F401
        local = sorted(
            m for m in set(sys.modules) - before
            if "." not in m and os.path.isfile(os.path.join(engine, m + ".py"))
        )
        print(json.dumps(local))
        """
    )
    assert proc.returncode == 0, proc.stderr
    closure = set(json.loads(proc.stdout.strip().splitlines()[-1]))
    shipped = set(_build_module().ENGINE_MODULES)
    assert shipped == closure, (
        f"missing from package: {sorted(closure - shipped)}; "
        f"shipped but never imported: {sorted(shipped - closure)}"
    )


def test_staged_tree_carries_identity_and_notices(staged):
    pkg = staged / "src" / "omicos_figure_engine"
    build = json.loads((pkg / "_build.json").read_text(encoding="utf-8"))
    assert build["engine"] == "omicos-figure-engine"
    assert build["engine_version"] == "0.0.0+test"
    assert build["upstream_commit"] == "eb1404942ad60a776403fd4a9d3c85459bc5a8b0"
    assert set(build["modules"]) == set(_build_module().ENGINE_MODULES)
    # The AGPL text and the §5a statement travel inside the wheel, not only in the sdist.
    assert (
        (pkg / "LICENSE").read_text(encoding="utf-8").startswith("                    GNU AFFERO")
    )
    assert "Statement of modifications" in (pkg / "MODIFICATIONS.md").read_text(encoding="utf-8")
    pyproject = (staged / "pyproject.toml").read_text(encoding="utf-8")
    assert 'name = "omicos-figure-engine"' in pyproject
    deps = re.search(r"^dependencies = \[(.*?)\]", pyproject, re.S | re.M)
    assert deps is not None
    specs = re.findall(r'"([^"]+)"', deps.group(1))
    names = {re.match(r"[A-Za-z0-9_.-]+", spec).group(0).lower() for spec in specs}
    assert names == {"matplotlib", "numpy"}, names


def test_staged_package_imports_without_flask_pymupdf_or_tavotto(staged):
    """OmicOS 的环境里只有 matplotlib + numpy：把另外三样变成 import 就炸。"""
    proc = _run(
        f"""
        import sys
        for name in ("flask", "pymupdf", "tavotto"):
            sys.modules[name] = None  # `import name` -> ImportError
        sys.path.insert(0, {str(staged / "src")!r})
        import omicos_figure_engine
        import omicos_figure_engine.worker as w
        assert omicos_figure_engine.worker_path().endswith("worker.py")
        assert callable(w.main)
        print("ok", omicos_figure_engine.__version__)
        """
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip().endswith("0.0.0+test")


class _Worker:
    """最小的 v1 客户端：一请求一行，按 request_id 收。"""

    def __init__(self, argv: list[str], env: dict, cwd: Path):
        self.proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            env=env,
            cwd=cwd,
        )
        self._n = 0

    def request(self, cmd: str, payload: dict | None = None, **extra) -> dict:
        self._n += 1
        rid = f"r{self._n}"
        req = {
            "protocol_version": 1,
            "request_id": rid,
            "cmd": cmd,
            "payload": payload or {},
            "worker_generation": 1,
            **extra,
        }
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.proc.stdin.write(json.dumps(req) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        assert line, f"worker EOF on {cmd}"
        reply = json.loads(line)
        assert reply["request_id"] == rid
        return reply

    def close(self) -> str:
        """shutdown（协议上不回信封）→ 等退出 → 回 stderr 全文（脚本的 stdout 也在里面）。"""
        assert self.proc.stdin is not None and self.proc.stderr is not None
        envelope = {"protocol_version": 1, "request_id": "bye", "cmd": "shutdown", "payload": {}}
        with contextlib.suppress(OSError):
            self.proc.stdin.write(json.dumps(envelope) + "\n")
            self.proc.stdin.flush()
            self.proc.stdin.close()
        self.proc.wait(timeout=10)
        return self.proc.stderr.read()


def _spawn(staged: Path, script: Path, tmp_path: Path, extra_env: dict | None = None) -> _Worker:
    tmp_path.mkdir(parents=True, exist_ok=True)
    out = tmp_path / "out"
    sandbox = tmp_path / "sb"
    env = {**os.environ, "PYTHONPATH": str(staged / "src"), "PYTHONIOENCODING": "utf-8"}
    if extra_env:
        env.update(extra_env)
    return _Worker(
        [
            WORKER_PY,
            "-m",
            "omicos_figure_engine.worker",
            "--script",
            str(script),
            "--figures-dir",
            str(script.parent),
            "--out-dir",
            str(out),
            "--sandbox",
            str(sandbox),
            "--entry",
            "__main__",
        ],
        env,
        tmp_path,
    )


LINE_SCRIPT = """\
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(3, 2))
ax.plot([0, 1, 2], [0, 1, 4], label="sq")
ax.set_title("before")
fig.savefig("line.png")
"""


def test_staged_worker_speaks_v1_and_reports_identity(staged, tmp_path):
    figs = tmp_path / "figs"
    figs.mkdir()
    script = figs / "line.py"
    script.write_text(LINE_SCRIPT, encoding="utf-8")
    w = _spawn(staged, script, tmp_path)
    try:
        ping = w.request("ping")
        assert ping["ok"] is True
        # 加字段不升版：身份来自包旁边的 _build.json，解释器信息来自进程本身。
        assert ping["engine"] == "omicos-figure-engine"
        assert ping["engine_version"] == "0.0.0+test"
        assert ping["python"].count(".") >= 1 and ping["matplotlib"].count(".") >= 1
        build = w.request("build", render_revision=1)
        assert build["ok"] is True, build
        assert list(build["stems"]) == ["line"]
        # preview_png 现在与 render / export 同一条口径报 warnings：一条孤儿 gid
        # 不再被静默吞掉，同时预览照样成功且状态中立。
        preview = w.request(
            "preview_png",
            {
                "patches": [
                    {"gid": "axes_0.title", "prop": "text", "value": "after"},
                    {"gid": "axes_9.title", "prop": "text", "value": "orphan"},
                ],
                "width": 200,
                "tag": "t",
            },
            stem="line",
            render_revision=1,
        )
        assert preview["ok"] is True, preview
        assert Path(preview["path"]).is_file()
        assert any("axes_9.title" in wmsg for wmsg in preview["warnings"]), preview["warnings"]
        manifest = json.loads((tmp_path / "out" / "line.json").read_text(encoding="utf-8"))
        title = next(e for e in manifest["elements"] if e["gid"] == "axes_0.title")
        text = next(f for f in title["editable"] if f["prop"] == "text")
        assert text["value"] == "before", "preview must leave the session untouched"
    finally:
        w.close()


def _fake_omicverse(site: Path, marker: Path) -> None:
    pkg = site / "omicverse"
    (pkg / "pl").mkdir(parents=True)
    (pkg / "__init__.py").write_text(
        textwrap.dedent(
            f"""
            import importlib as _il
            from pathlib import Path as _P
            _P({str(marker)!r}).write_text("imported", encoding="utf-8")
            def __getattr__(name):
                if name == "pl":
                    return _il.import_module("omicverse.pl")
                raise AttributeError(name)
            """
        ),
        encoding="utf-8",
    )
    (pkg / "pl" / "__init__.py").write_text(
        "def marker_heatmap(*args, **kwargs):\n    return 'original'\n", encoding="utf-8"
    )


def test_omicverse_shim_is_installed_lazily(staged, tmp_path):
    """没碰 OmicVerse 的脚本绝不 import 它；碰了的脚本在 `omicverse.pl` 落地后立刻被打垫片。"""
    site = tmp_path / "site"
    marker = tmp_path / "imported.txt"
    _fake_omicverse(site, marker)
    figs = tmp_path / "figs"
    figs.mkdir()
    plain = figs / "plain.py"
    plain.write_text(LINE_SCRIPT, encoding="utf-8")
    env = {"PYTHONPATH": os.pathsep.join([str(staged / "src"), str(site)])}

    w = _spawn(staged, plain, tmp_path / "a", env)
    try:
        assert w.request("build", render_revision=1)["ok"] is True
    finally:
        w.close()
    assert not marker.exists(), "a plain matplotlib script must not pay for importing OmicVerse"

    uses_ov = figs / "uses_ov.py"
    uses_ov.write_text(
        LINE_SCRIPT
        + textwrap.dedent(
            """
            import sys
            import omicverse as ov
            pl = ov.pl
            hooked = any(type(f).__name__ == "_OmicverseCompatHook" for f in sys.meta_path)
            print("HOOK_STILL_INSTALLED" if hooked else "HOOK_FIRED")
            print("SHIM_APPLIED" if getattr(pl.marker_heatmap, "__omicos_compat__", False) else "SHIM_ABSENT")
            """
        ),
        encoding="utf-8",
    )
    w = _spawn(staged, uses_ov, tmp_path / "b", env)
    try:
        assert w.request("build", render_revision=1)["ok"] is True
    finally:
        stderr = w.close()
    assert marker.exists()
    assert "HOOK_FIRED" in stderr, stderr
    # The shim itself needs pandas; without it the hook still fires and the
    # compat installer returns quietly (that is its documented behaviour).
    has_pandas = _run("import pandas").returncode == 0
    assert ("SHIM_APPLIED" in stderr) is has_pandas, stderr
