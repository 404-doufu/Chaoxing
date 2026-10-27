"""按 stableVersion 检查本次生成的安装脚本，避免升级版本后仍检查旧文件。"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['stableVersion']
for name in ['build/legacy.user.js', '学习通-Edge稳定学习版.user.js',
             '学习通-Edge后台监督.user.js', f'发行{version}.user.js']:
    subprocess.run(['node', '--check', str(ROOT / name)], cwd=ROOT, check=True)
print(f'全部构建脚本语法检查通过：{version}')
