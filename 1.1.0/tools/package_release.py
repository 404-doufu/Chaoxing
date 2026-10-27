"""按公开文件清单生成 GitHub 发布目录与 ZIP，拒绝覆盖已有归档。"""
from hashlib import sha256
from pathlib import Path
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['stableVersion']
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise SystemExit('stableVersion 必须是三段数字发行号')
target, archive = ROOT / version, ROOT / f'{version}.zip'
if target.exists() or archive.exists():
    raise SystemExit(f'拒绝覆盖已有发布目录或 ZIP：{version}')

release = f'发行{version}.user.js'
paths = [Path(name) for name in [release, 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
         'LICENSE', '参考脚本.txt', 'package.json', 'package-lock.json',
         'docs/字体适配说明.md', 'docs/licenses/SourceHanSans-OFL.txt']]
for folder, extensions in [('src', {'.js', '.json'}), ('tests', {'.cjs', '.html', '.ttf'}), ('tools', {'.py'})]:
    paths.extend(path.relative_to(ROOT) for path in (ROOT / folder).rglob('*')
                 if path.is_file() and path.suffix in extensions and '__pycache__' not in path.parts)
paths = sorted(set(paths), key=lambda path: path.as_posix())
missing = [str(path) for path in paths if not (ROOT / path).is_file()]
if missing:
    raise SystemExit('缺少公开文件：' + ', '.join(missing))
code = (ROOT / release).read_text(encoding='utf-8')
if re.search(r'^// @version\s+(.+)$', code, re.M).group(1) != version:
    raise SystemExit('安装脚本版本不一致，请先 npm run build')
if re.search(r"apiKey\s*:\s*['\"][^'\"]+['\"]", code):
    raise SystemExit('安装脚本出现非空 Key 字面值，停止打包')

target.mkdir()
for path in paths:
    output = target / path
    output.parent.mkdir(parents=True, exist_ok=True)
    data = (ROOT / path).read_bytes()
    if path.suffix != '.ttf':
        data = data.replace(b'\r\n', b'\n')
    output.write_bytes(data)
(target / '.gitignore').write_text('node_modules/\nbuild/\ntest-results/\n__pycache__/\n*.log\n*.zip\n'
    '[0-9]*.[0-9]*.[0-9]*/\n学习通-Edge稳定学习版.user.js\n学习通-Edge后台监督.user.js\n', encoding='utf-8', newline='\n')
(target / '.gitattributes').write_text('* text=auto eol=lf\n*.ttf binary\n*.png binary\n', encoding='utf-8', newline='\n')
files = sorted((path for path in target.rglob('*') if path.is_file()), key=lambda path: path.relative_to(target).as_posix())
manifest = ''.join(f'{sha256(path.read_bytes()).hexdigest()}  {path.relative_to(target).as_posix()}\n' for path in files)
(target / 'SHA256SUMS').write_text(manifest, encoding='utf-8', newline='\n')
with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for path in [*files, target / 'SHA256SUMS']:
        bundle.write(path, arcname=path.relative_to(target).as_posix())
print(f'已整理：{target.name}/；{len(files) + 1} 个文件；ZIP {archive.stat().st_size:,} 字节')
