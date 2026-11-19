#!/usr/bin/env python3
"""Thumbnails of each diagram type's example, light and dark, for the Archify panel.

Renders every example in lib/examples.mjs with the bundled Archify, opens it in
headless Chromium in embed mode (the drawing alone, motion reduced), captures
the drawing and writes assets/previews/<type>-<theme>.webp.

A development step, not run on install. Needs node, python3 with Playwright
(and its Chromium) and Pillow:

    python3 scripts/build-previews.py
"""

import io
import pathlib
import re
import subprocess
import sys
import tempfile

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'previews'
WIDTH = 640  # pixels of a thumbnail; the panel shows it at up to half that and full width in a preview
MAX_ASPECT = 1.1  # a taller drawing keeps its top part


def examples():
    text = (ROOT / 'lib' / 'examples.mjs').read_text()
    block = re.search(r'export const EXAMPLES = \{(.*?)\};', text, re.S).group(1)
    found = dict(re.findall(r"(\w+): '([^']+)'", block))
    pair = re.search(r"compare: \['([^']+)', '([^']+)'\]", block)
    if pair:
        found['compare'] = [pair.group(1), pair.group(2)]
    return found


def render(tmp, kind, name):
    out = tmp / f'{kind}.html'
    cli = str(ROOT / 'archify' / 'bin' / 'archify.mjs')
    ex = ROOT / 'archify' / 'examples'
    if kind == 'compare':
        args = ['node', cli, 'compare', 'architecture', str(ex / name[0]), str(ex / name[1]), str(out)]
    else:
        args = ['node', cli, 'deliver', kind, str(ex / name), str(out), '--quality', 'showcase']
    subprocess.run(args, cwd=tmp, check=True, capture_output=True)
    return out


def shoot(page, html, theme):
    # Diagrams take the theme from the address; an explainer page follows the color scheme.
    page.emulate_media(color_scheme=theme, reduced_motion='reduce')
    page.goto(f'{html.as_uri()}?embed=1&theme={theme}')
    page.wait_for_timeout(1800)
    drawing = page.locator('svg[aria-labelledby^="archify-diagram-title"]')
    if drawing.count() > 0:
        return drawing.first.screenshot(type='png', animations='disabled')
    return page.screenshot(type='png', clip={'x': 0, 'y': 0, 'width': 960, 'height': 900}, animations='disabled')


def save(png, path):
    img = Image.open(io.BytesIO(png)).convert('RGB')
    w, h = img.size
    if h > w * MAX_ASPECT:
        img = img.crop((0, 0, w, int(w * MAX_ASPECT)))
        w, h = img.size
    img = img.resize((WIDTH, round(h * WIDTH / w)), Image.LANCZOS)
    img.save(path, 'WEBP', quality=80, method=6)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmpname, sync_playwright() as p:
        tmp = pathlib.Path(tmpname)
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 960, 'height': 1200}, device_scale_factor=2, reduced_motion='reduce')
        for kind, name in examples().items():
            html = render(tmp, kind, name)
            for theme in ('light', 'dark'):
                target = OUT / f'{kind}-{theme}.webp'
                save(shoot(page, html, theme), target)
                print(f'{target.relative_to(ROOT)}  {target.stat().st_size // 1024} KB')
        browser.close()


if __name__ == '__main__':
    sys.exit(main())
