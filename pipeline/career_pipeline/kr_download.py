"""Download the KOSIS tables used for South Korea into data/raw/kr/ (UTF-8 CSV).

KOSIS has no keyless API, and its CSV download only works from the table viewer's own JavaScript
(session state, form fields built in the page), so a headless browser opens each table, selects
every category and the requested year, and calls the page's download endpoint.

playwright is deliberately not a pipeline dependency. Run with:

    cd pipeline
    uv run --with playwright playwright install chromium     # once
    uv run --with playwright python -m career_pipeline.kr_download

Set CHROME_PATH to use an installed Chrome instead of playwright's bundled Chromium.
This module must not import polars (it runs under `uv run --with playwright` only for downloading).
"""

from __future__ import annotations

import asyncio
import base64
import os
import sys
from pathlib import Path

RAW = Path(__file__).resolve().parents[2] / "data" / "raw" / "kr"
YEAR = 2025
# orgId 118 = Ministry of Employment and Labor
TABLES = {
    "DT_118N_PAYM41": "occupation (KSCO 7th, 3-digit) × sex: wages and working conditions",
    "DT_118N_PAYM42": "occupation (major) × education × sex × age: wages",
    "DT_118N_PAYM39": "occupation (major) × sex × pay band × age: worker counts",
    "DT_118N_MON061": "province × industry × size: wages of regular employees (Labour Force Survey at Establishments)",
    "DT_118N_MON051": "industry × size: national wages (Labour Force Survey at Establishments)",
}

JS = """async (years) => {
  const trees = [];
  $('.fancytree-container').each(function () {
    try { const t = $.ui.fancytree.getTree(this); if (t && trees.indexOf(t) < 0) trees.push(t); } catch (e) {}
  });
  for (const t of trees) t.visit(nd => { if (!nd.unselectable) nd.setSelected(true); });
  fn_searchCond();
  const fl = JSON.parse(form.fieldList.value);
  fl[0].prdValue = 'Y,' + years + ',@';
  form.fieldList.value = JSON.stringify(fl);
  form.view.value = 'csv'; form.viewSubKind.value = '2_3'; form.viewKind.value = '2'; form.dataOpt.value = 'cdko';
  const r = await $.ajax({dataType: 'json', type: 'POST', url: '/statHtml/downGrid.do', data: $('#ParamInfo').serialize()});
  form.file.value = r.file;
  const resp = await fetch('/statHtml/downNormal.do', {method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: $('#ParamInfo').serialize()});
  const u = new Uint8Array(await resp.arrayBuffer());
  let s = '';
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  return btoa(s);
}"""

INSTRUCTIONS = """KOSIS tables for South Korea are missing from data/raw/kr/ and need a headless browser to download.
playwright is not a pipeline dependency; run once from pipeline/:

    uv run --with playwright playwright install chromium
    uv run --with playwright python -m career_pipeline.kr_download

(or set CHROME_PATH=/usr/bin/google-chrome to use an installed Chrome), then rebuild with `kr`."""


def missing() -> list[str]:
    return [t for t in TABLES if not (RAW / f"{t}.csv").exists()]


async def _download(tables: list[str]) -> None:
    from playwright.async_api import async_playwright

    RAW.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        chrome = os.environ.get("CHROME_PATH")
        browser = await p.chromium.launch(headless=True, **({"executable_path": chrome} if chrome else {}))
        page = await browser.new_page()
        for tbl in tables:
            print(f"downloading KOSIS {tbl} ({TABLES[tbl]})")
            await page.goto(f"https://kosis.kr/statHtml/statHtml.do?orgId=118&tblId={tbl}&conn_path=I2",
                            wait_until="networkidle", timeout=120_000)
            frame = next(f for f in page.frames if "statHtmlContent" in f.url)
            await asyncio.sleep(3)  # trees are populated after networkidle
            data = base64.b64decode(await frame.evaluate(JS, str(YEAR)))
            if len(data) < 1000:
                raise RuntimeError(f"{tbl}: download returned {len(data)} bytes")
            text = data.decode("cp949", errors="replace")  # KOSIS CSVs are EUC-KR/CP949
            (RAW / f"{tbl}.csv").write_text(text, encoding="utf-8")
            print(f"  wrote {RAW / f'{tbl}.csv'} ({len(text):,} chars)")
        await browser.close()


def download(force: bool = False) -> None:
    tables = list(TABLES) if force else missing()
    if not tables:
        return
    try:
        import playwright  # noqa: F401
    except ImportError:
        raise SystemExit(INSTRUCTIONS) from None
    asyncio.run(_download(tables))


if __name__ == "__main__":
    download(force="--force" in sys.argv)
