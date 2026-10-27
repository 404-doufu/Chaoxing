"""一次性离线导入字形指纹数据；不用于安装脚本运行或正常构建。

用法：python tools/import_font_signatures.py build/数据目录
来源和许可说明见 docs/字体适配说明.md。仅允许反序列化无行为的字形数据占位对象。
"""
import hashlib
import json
import pickle
import sys
from pathlib import Path


class GlyphData:
    pass


class DataOnly(pickle.Unpickler):
    def find_class(self, module, name):
        if (module, name) == ('fontTools.ttLib.tables._g_l_y_f', 'Glyph'):
            return GlyphData
        raise ValueError('拒绝可执行数据类型')


root = Path(__file__).resolve().parents[1]
folder = Path(sys.argv[1])
cmap_file = folder / 'HanSansCN_CmapTables.pkl'
hash_file = folder / 'HanSansCN_glyfHashedTables.pkl'
expected = ['78ab61655817560f619aaaf89e23555e53d0750022da36a89c290d6c0fe97942', 'd192fd6f32db69805b585c760b3d325177522b59fa158b996339df125ade04ca']
for file, digest in zip([cmap_file, hash_file], expected):
    if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
        raise ValueError('输入数据摘要与已审查版本不一致：' + file.name)
with cmap_file.open('rb') as file:
    cmap = DataOnly(file).load()
with hash_file.open('rb') as file:
    hashes = DataOnly(file).load()[0]
# 仅保存字形摘要到 Unicode 的事实映射，不复制第三方 Python/JS 实现。
reverse = {}
for cp, glyph in cmap:
    if 0x4e00 <= cp <= 0x9fff:
        reverse.setdefault(glyph, set()).add(chr(cp))
result = {}
for glyph, (sha1, _md5) in hashes:
    for char in reverse.get(glyph, ()):
        result.setdefault(sha1.hex(), set()).add(char)
# 同一个轮廓有多个 Unicode 时不猜测。
result = {key: next(iter(chars)) for key, chars in result.items() if len(chars) == 1}
target = root / 'src/data/font-signatures.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + '\n', encoding='utf-8')
for file in [cmap_file, hash_file]:
    print(file.name, hashlib.sha256(file.read_bytes()).hexdigest())
print('字形指纹数量:', len(result))
