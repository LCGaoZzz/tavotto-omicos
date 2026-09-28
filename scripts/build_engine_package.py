#!/usr/bin/env python3
"""Build the engine-only distribution **omicos-figure-engine**.

OmicOS embeds the *worker side* of the Tavotto engine (`src/tavotto/engine/`:
`worker.py` and the modules it imports) and drives it over the wire protocol
v1 (`docs/adr/0003-worker-protocol-v1.md`).  It never runs the Flask app, the
web workbench or the PDF backend, so those must not come along: the base
`tavotto` distribution depends on `flask` and `pymupdf`, and the wheel carries
the built frontend.  This script stages exactly the worker's import closure
into a standalone package `omicos_figure_engine` and builds a wheel + sdist
that depend on nothing but matplotlib and numpy.

Why a staged copy and not a second pyproject over the same files: the engine
modules import each other *flat* (`import figcapture`, see `worker.py`), so
the package only has to put them side by side; and a build that lists every
shipped module explicitly is checkable — `tests/test_engine_package.py`
asserts that the list below is exactly the worker's import closure, in both
directions.

Usage:
    python scripts/build_engine_package.py --version 0.1.0            # stage + build
    python scripts/build_engine_package.py --version 0.1.0 --stage-only --out DIR

The staged tree lands in `build/engine-package/` (gitignored), artifacts in
`dist/engine-package/`.  Publishing is a separate, explicit `twine upload`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE_DIR = ROOT / "src" / "tavotto" / "engine"

DIST_NAME = "omicos-figure-engine"
PACKAGE = "omicos_figure_engine"
UPSTREAM_COMMIT = "eb1404942ad60a776403fd4a9d3c85459bc5a8b0"

#: The worker's import closure — every module `worker.py` pulls in, directly
#: or through its siblings, and nothing else.  Keep it sorted; the test
#: recomputes the closure by importing the worker and compares both ways.
ENGINE_MODULES = (
    "axestraversal",
    "colorbarmodel",
    "figcapture",
    "figsession",
    "importscope",
    "legendmodel",
    "manifest",
    "overrides",
    "patchspec",
    "pathgeom",
    "preview_complexity",
    "preview_hybrid",
    "previewbudget",
    "spinemodel",
    "tickmodel",
    "wireproto",
    "worker",
)

PYPROJECT = """\
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "{dist}"
version = "{version}"
description = "OmicOS scientific figure engine: instrument a live matplotlib Figure, apply semantic overrides, render and export it over a JSON line protocol."
readme = "README.md"
requires-python = ">=3.10,<3.15"
license = "AGPL-3.0-only"
license-files = ["LICENSE"]
authors = [{{ name = "OmicOS (OmicVerse)" }}]
keywords = ["matplotlib", "figure", "publication", "omicos"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Intended Audience :: Science/Research",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Programming Language :: Python :: 3.13",
    "Programming Language :: Python :: 3.14",
    "Topic :: Scientific/Engineering :: Visualization",
]
# Exactly the worker extra of the base distribution; the Flask parent-process
# dependencies (flask, pymupdf) are deliberately absent — OmicOS talks to this
# package over stdin/stdout only.
dependencies = ["matplotlib>=3.8,<3.12", "numpy>=1.24,<3"]

[project.urls]
Source = "https://github.com/omicverse/tavotto-omicos"
Upstream = "https://github.com/Tavotto/Tavotto"
Protocol = "https://github.com/Tavotto/Tavotto/blob/{upstream}/docs/adr/0003-worker-protocol-v1.md"

[tool.hatch.build.targets.wheel]
packages = ["src/{package}"]

[tool.hatch.build.targets.sdist]
include = ["src/{package}", "README.md", "LICENSE", "MODIFICATIONS.md", "pyproject.toml"]
"""

README = """\
# omicos-figure-engine

The scientific figure engine that OmicOS runs in the user's own Python
environment: it executes a matplotlib figure script once, keeps the resulting
`Figure` objects alive, describes every editable artist in a manifest, applies
semantic overrides (title text, line colour, tick font size, …) and renders
previews and publication exports — all driven by a supervisor over a JSON
line protocol on stdin/stdout (wire protocol v1, see `Protocol` in the project
URLs).

This distribution is the **worker side only** of the engine in
[tavotto-omicos](https://github.com/omicverse/tavotto-omicos), a modified
version of [Tavotto](https://github.com/Tavotto/Tavotto).  It depends on
matplotlib and numpy and nothing else: no Flask, no PyMuPDF, no web assets.

## Running

    python -m omicos_figure_engine.worker --script fig.py --figures-dir DIR \\
        --out-dir OUT --sandbox SB --entry __main__

then write one JSON request per line to stdin, e.g.
`{{"protocol_version": 1, "request_id": "r1", "cmd": "ping", "payload": {{}}}}`.
`omicos_figure_engine.worker_path()` returns the entry script for supervisors
that spawn `python <worker.py> …` directly.

## Licence

AGPL-3.0-only, unchanged from the base project.  `LICENSE` and
`MODIFICATIONS.md` (the AGPL §5a statement of modifications) ship inside the
package; the complete corresponding source is the repository above at the
commit recorded in `omicos_figure_engine/_build.json`.
"""

INIT = '''\
"""omicos-figure-engine — worker side of the OmicOS scientific figure engine."""

from __future__ import annotations

from pathlib import Path

__version__ = "{version}"
ENGINE_NAME = "{dist}"
BASE_COMMIT = "{commit}"

__all__ = ["BASE_COMMIT", "ENGINE_NAME", "__version__", "worker_path"]


def worker_path() -> str:
    """Absolute path of the worker entry script, for supervisors that spawn
    `python <worker.py> ...` directly (the modules import each other flat, so
    the script must be run from inside this package directory)."""
    return str(Path(__file__).resolve().parent / "worker.py")
'''

MAIN = """\
from .worker import main

main()
"""


def _git_head() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
        )
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _tavotto_version() -> str:
    text = (ROOT / "src" / "tavotto" / "__init__.py").read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.startswith("__version__"):
            return line.split("=", 1)[1].strip().strip("\"'")
    return "unknown"


def stage(out_dir: Path, version: str) -> Path:
    """Materialise the package tree under `out_dir` and return it."""
    if out_dir.exists():
        shutil.rmtree(out_dir)
    pkg = out_dir / "src" / PACKAGE
    pkg.mkdir(parents=True)
    digest = hashlib.sha256()
    for name in ENGINE_MODULES:
        src = ENGINE_DIR / f"{name}.py"
        data = src.read_bytes()
        digest.update(name.encode("utf-8") + b"\0" + data + b"\0")
        (pkg / f"{name}.py").write_bytes(data)
    commit = _git_head()
    (pkg / "__init__.py").write_text(
        INIT.format(version=version, dist=DIST_NAME, commit=commit), encoding="utf-8"
    )
    (pkg / "__main__.py").write_text(MAIN, encoding="utf-8")
    (pkg / "_build.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "engine": DIST_NAME,
                "engine_version": version,
                "base_commit": commit,
                "upstream_commit": UPSTREAM_COMMIT,
                "tavotto_version": _tavotto_version(),
                "modules": list(ENGINE_MODULES),
                "source_digest": digest.hexdigest(),
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    shutil.copyfile(ROOT / "LICENSE", pkg / "LICENSE")
    shutil.copyfile(ROOT / "MODIFICATIONS.md", pkg / "MODIFICATIONS.md")
    shutil.copyfile(ROOT / "LICENSE", out_dir / "LICENSE")
    shutil.copyfile(ROOT / "MODIFICATIONS.md", out_dir / "MODIFICATIONS.md")
    (out_dir / "README.md").write_text(README, encoding="utf-8")
    (out_dir / "pyproject.toml").write_text(
        PYPROJECT.format(
            dist=DIST_NAME, version=version, package=PACKAGE, upstream=UPSTREAM_COMMIT
        ),
        encoding="utf-8",
    )
    return out_dir


def build(staged: Path, dist_dir: Path) -> list[Path]:
    """Run PEP 517 builds for the staged tree; returns the produced artifacts."""
    dist_dir.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    # Reproducible archives: hatchling honours SOURCE_DATE_EPOCH for member
    # timestamps, so two builds of the same tree produce identical bytes.
    env.setdefault("SOURCE_DATE_EPOCH", "946684800")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "build",
            "--sdist",
            "--wheel",
            "--outdir",
            str(dist_dir),
            str(staged),
        ],
        check=True,
        env=env,
    )
    return sorted(p for p in dist_dir.iterdir() if p.suffix in {".whl", ".gz"})


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--version", required=True, help="PEP 440 public version, e.g. 0.1.0")
    ap.add_argument(
        "--out", default=str(ROOT / "build" / "engine-package"), help="staging directory"
    )
    ap.add_argument(
        "--dist", default=str(ROOT / "dist" / "engine-package"), help="artifact directory"
    )
    ap.add_argument("--stage-only", action="store_true", help="stage the tree, do not build")
    args = ap.parse_args(argv)
    staged = stage(Path(args.out), args.version)
    print(f"staged {DIST_NAME} {args.version} -> {staged}")
    if args.stage_only:
        return 0
    for artifact in build(staged, Path(args.dist)):
        print(f"built {artifact}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
