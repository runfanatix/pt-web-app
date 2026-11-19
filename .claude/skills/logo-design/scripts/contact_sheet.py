"""contact_sheet.py <workdir> [models=5] [brands=10] [aspect=3:4]

Renders <workdir>/up/<idx>.jpg into one review grid: a row per brand, a column per model,
where idx = model_slot * brands + brand. Writes <workdir>/sheet.png and a 2000px-tall
sheet-s.png small enough to Read. Uses headless Chrome (macOS path).
"""
import subprocess
import sys
from pathlib import Path

work = Path(sys.argv[1])
models = int(sys.argv[2]) if len(sys.argv) > 2 else 5
brands = int(sys.argv[3]) if len(sys.argv) > 3 else 10
aw, ah = (int(x) for x in (sys.argv[4] if len(sys.argv) > 4 else "3:4").split(":"))
up = work / "up"
w = 225
h = round(w * ah / aw)

rows = ""
for b in range(brands):
    cells = ""
    for m in range(models):
        i = m * brands + b
        f = next((p for p in (up / f"{i}.jpg", up / f"{i}.svg") if p.exists()), None)
        img = f'<img src="file://{f}" style="width:100%;height:100%;object-fit:cover">' if f else ""
        cells += (f'<div style="position:relative;width:{w}px;height:{h}px;background:#fff">{img}'
                  f'<b style="position:absolute;left:3px;top:1px;font:bold 15px sans-serif;'
                  f'color:#f0f;background:#fff">{i}</b></div>')
    rows += f'<div style="display:flex;gap:6px;margin-bottom:6px">{cells}</div>'

html = work / "sheet.html"
html.write_text(f'<body style="margin:0;background:#888;padding:6px">{rows}</body>')
width = models * (w + 6) + 12
height = brands * (h + 6) + 12
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--allow-file-access-from-files", f"--screenshot={work}/sheet.png",
                f"--window-size={width},{height}", "--virtual-time-budget=6000",
                f"file://{html}"], capture_output=True, timeout=120)
subprocess.run(["sips", "-Z", "2000", str(work / "sheet.png"), "--out", str(work / "sheet-s.png")],
               capture_output=True)
print(work / "sheet-s.png")
