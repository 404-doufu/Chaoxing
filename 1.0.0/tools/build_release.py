"""生成 tofu 正式单文件发行；先构建 stable，不导出任何浏览器存储。"""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['stableVersion']
name = '发行' + version
source = (ROOT / '学习通-Edge稳定学习版.user.js').read_text(encoding='utf-8')


def once(old, new):
    global source
    if source.count(old) != 1:
        raise RuntimeError('发行构建基线发生变化：' + old[:75])
    source = source.replace(old, new, 1)


source = re.sub(r'^// @name\s+.*$', '// @name         ' + name, source, count=1, flags=re.M)
source = re.sub(r'^// @namespace\s+.*$', '// @namespace    tofu-chaoxing-release', source, count=1, flags=re.M)
source = re.sub(r'^// @author\s+.*$', '// @author       tofu', source, count=1, flags=re.M)
source = re.sub(r'^// @description\s+.*$', '// @description  tofu 正式发行：个人 API 答题、原生音视频、文档翻阅、自动切章与停滞恢复；单文件安装，首次使用在浮窗配置自己的 API。', source, count=1, flags=re.M)
source = re.sub(r'^// @icon\s+http:', '// @icon         https:', source, count=1, flags=re.M)
source = re.sub(r'^// @connect\s+.*\n', '', source, flags=re.M)
once('// @grant        GM_registerMenuCommand', '''// @grant        GM_registerMenuCommand
// @grant        GM_listValues
// @grant        GM_notification
// @connect      *''')
start = source.index('//@ 如果脚本提示添加安全网址')
end = source.index('// ==/UserScript==',start)
source = source[:start] + source[end:]
supervisor = (ROOT / 'src/page-supervisor.js').read_text(encoding='utf-8')
source = source.replace('(() => {', '(() => {\n' + supervisor + '\n',1)
once('        version: ' + json.dumps(version) + ',', '''        version: ''' + json.dumps(version) + ''',
        brand: 'tofu', supervisorMode: 'page', apiConfigured: () => ai.isConfigured(),''')
once('    studyRuntime.handleRoute();', '''    studyRuntime.handleRoute();
    createPageSupervisor({
        win: _w, doc: _d, getValue: GM_getValue, setValue: GM_setValue, listValues: GM_listValues,
        notify: message => { try { GM_notification({title:'tofu · 课程监督',text:message,timeout:10000}); } catch (_) {} }
    }).install();''')
once('自用 AI 答题设置', 'tofu · 模型 API 配置')
once('自建服务须实现 Chat Completions 接口；更换服务域名时须在脚本头添加对应 @connect。', '自建服务须实现 Chat Completions 接口；本发行支持自填域名，脚本猫如提示访问授权，请仅核对并允许你配置的服务地址。')

# 安装/配置/使用说明统一放在 README.md；发行脚本只保留元信息和必要来源声明。
once('// ==/UserScript==', '// ==/UserScript==\n\n// SPDX-License-Identifier: GPL-3.0-or-later\n// 字形摘要来源：TellMeYourWish/chaoxing_solution_of_font_confusion；原字体 Adobe Source Han Sans（SIL OFL 1.1）。\n// 完整许可见 LICENSE 和 docs/licenses/SourceHanSans-OFL.txt。')

target = ROOT / (name + '.user.js')
target.write_text(source, encoding='utf-8',newline='\n')
print('已生成正式单文件：' + target.name + '；作者 tofu，版本 ' + version)
