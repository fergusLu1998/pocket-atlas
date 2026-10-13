"""Create an anonymous, flat, offline-capable competition distribution."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import re
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path)
args = parser.parse_args()
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
target = args.output or root / 'outputs' / f'PocketAtlas_参赛代码_离线运行版_{commit[:7]}.zip'
if target.exists():
    raise RuntimeError('The output already exists. Supply a new --output path.')
if not (root / 'dist/local/index.html').exists():
    raise RuntimeError('Build the standalone distribution first: npm run build:standalone')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def anonymous(data):
    text = data.decode('utf-8-sig')
    text = re.sub(r'https://[a-zA-Z0-9.-]+\.chatgpt\.site', 'http://localhost:3000', text)
    text = re.sub(r'https://github\.com/[^\s)]+', 'local source distribution', text) if 'github.com/' in text and ('源码地址' in text or 'Open workbench' in text) else text
    return text.encode('utf-8')

files, entries = {}, []
def add(data, path):
    name = path.replace('/', '__')
    if name in files:
        raise RuntimeError('Flat filename collision: ' + path)
    files[name] = data
    entries.append({'file':name,'path':path,'sha256':sha(data)})

tracked = subprocess.check_output(['git','ls-tree','-r','--name-only',commit],cwd=root,text=True).splitlines()
for path in tracked:
    if path.startswith('.openai/') or path.endswith(('.zip','.wasm')):
        continue
    data = subprocess.check_output(['git','show',f'{commit}:{path}'],cwd=root)
    data=anonymous(data)
    if path.endswith('.ps1'):
        data=data.decode('utf-8-sig').encode('utf-8-sig')
    add(data,path)

for path in sorted((root/'dist/local').rglob('*')):
    if not path.is_file() or path.suffix in ('.wasm','.zip') or path.relative_to(root/'dist/local').as_posix() == 'standalone/index.html':
        continue
    relative = path.relative_to(root).as_posix()
    add(anonymous(path.read_bytes()),relative)

cmd = '''@echo off
setlocal
title Pocket Atlas
cd /d "%~dp0"
if not exist "%~dp0run-workbench.ps1" (
  echo Extract ALL files from this ZIP into a new folder before launching.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-workbench.ps1" %*
if errorlevel 1 pause
endlocal
'''
files['Start Pocket Atlas.cmd'] = cmd.replace('\n','\r\n').encode('ascii')
for e in entries:
    if e['file'] == 'Start Pocket Atlas.cmd':
        e['sha256'] = sha(files[e['file']])
add((root/'scripts/restore_submission.ps1').read_bytes(),'run-workbench.ps1')
wasm = (root/'public/rdkit/RDKit_minimal.wasm').read_bytes()
files['rdkit-runtime.txt'] = base64.b64encode(wasm)
files['source-map.json'] = json.dumps({'source_commit':commit,'format':'flat-offline-v2','rdkit_wasm_sha256':sha(wasm),'runtime_text_sha256':sha(files['rdkit-runtime.txt']),'entries':entries},ensure_ascii=False,indent=2).encode()
files['SUBMISSION_README.txt'] = '''Pocket Atlas 比赛发行说明

本包包含当前程序源码、锁定依赖清单、双语使用说明、验证记录、第三方许可证以及已构建的独立网页。文件直接位于 ZIP 根目录，路径清单记录源目录关系与校验值。程序不包含参赛者研究数据、录像、缓存、账户配置或凭据。

完整解压到新的文件夹后双击 Start Pocket Atlas.cmd。启动器使用 Windows PowerShell 恢复目录和浏览器资源，随后打开本机工作台。运行期间保留启动窗口。运行已构建版本不需要 Node.js、npm、Python 或网络下载；修改源码和重新构建另需 Node.js 与开发依赖。

RDKit 的运行模块以文本随包提供，启动时解码并校验，保留对应许可证。除可选的本机 Schrödinger 外，不需要额外分析服务。首次启动可选择是否配置 Schrödinger；不安装时仍可聚类、阅览受支持的结构文件及计算开源几何互作。开源方法及其解释边界见 README.md。

提交时按比赛要求改为项目题目对应的文件名。代码运行录像应在单独栏目上传，不放入本压缩包。程序的源目录和实际网页目录在解压后自动生成，因此提交 ZIP 无需嵌套文件夹。

English operation note

Extract every file and run Start Pocket Atlas.cmd on Windows. PowerShell restores the source tree and bundled browser assets before starting a loopback-only static server. The prebuilt application does not require Node.js, npm, Python, or Internet downloads. Keep the launch window open. Source rebuilding requires a separate development environment.

The package contains no recordings, research projects, cache data, personal settings, or credentials. RDKit runtime bytes are text-encoded and verified locally. Schrodinger is optional and separately licensed; the browser geometry method remains available without it. The README describes its approximate criteria and limitations.
'''.encode('utf-8-sig')

target.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name,data in files.items():
        z.writestr(name,data)
with zipfile.ZipFile(target) as z:
    assert z.testzip() is None
    assert all('/' not in name and '\\' not in name for name in z.namelist())
    assert not any(name.lower().endswith(('.zip','.mp4','.mp3','.wav','.mov','.avi','.m4a','.webm','.ogg','.wasm')) for name in z.namelist())
digest=sha(target.read_bytes())
target.with_suffix('.sha256.txt').write_text(f'{digest}  {target.name}\n',encoding='utf-8')
print(json.dumps({'archive':str(target),'commit':commit,'files':len(files),'bytes':target.stat().st_size,'sha256':digest},ensure_ascii=False))
