from tavotto.engine.bridge_runner import _normalize_managed_source


def test_normalize_managed_source_accepts_open_code_bytes():
    source = (
        b"# OmicOS managed figure source v1\nfigmeta = {'sem': 'standard error'}\npanel.sem = 1\n"
    )

    normalized = _normalize_managed_source(source)

    assert isinstance(normalized, bytes)
    assert b'panel["sem"] = 1' in normalized


def test_normalize_managed_source_preserves_non_utf8_source_bytes():
    source = b"# user source\nlabel = 'caf\xe9'\n"

    assert _normalize_managed_source(source) is source
