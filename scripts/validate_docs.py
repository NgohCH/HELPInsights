#!/usr/bin/env python3
"""Safe documentation package preflight; NOT application tests."""
from pathlib import Path
import os,re,sys,yaml
root=Path(__file__).resolve().parents[1]
required=['AGENTS.md','INTENT.md','SPEC.md','HANDOFF.md','README.md','docs/CONTINUOUS_TESTING.md','docs/DOMAIN_MODEL.md','docs/TASK_GRAPH.md','docs/FEATURE_MATRIX.md','docs/UNATTENDED_EXECUTION_GUIDE.md','api/openapi.yaml']
errors=[]
for name in required:
 if not (root/name).is_file():errors.append('Missing '+name)
api=root/'api/openapi.yaml'
if api.exists():
 try:
  data=yaml.safe_load(api.read_text(encoding='utf-8'))
  if not str(data.get('openapi','')).startswith('3.'):errors.append('Expected OpenAPI 3.x')
  ids=[o['operationId'] for path in data.get('paths',{}).values() for meth,o in path.items() if meth.lower() in ('get','post','put','patch','delete') and isinstance(o,dict) and 'operationId' in o]
  if len(ids)!=len(set(ids)): errors.append('Duplicate operationId')
 except Exception as e:errors.append('OpenAPI parse: '+str(e))
for directory, children, files in os.walk(root):
 children[:] = [name for name in children if name not in {'.git','node_modules','dist','playwright-report','test-results'}]
 for filename in files:
  if not filename.endswith('.md'): continue
  p = Path(directory) / filename
  for ref in re.findall(r'(?<!!)\[[^]\n]*\]\(([^)]+)\)',p.read_text(encoding='utf-8')):
   dest=ref.strip().split('#')[0]
   if dest and not dest.startswith(('http:','https:','mailto:','sandbox:')) and not (p.parent/dest).exists():errors.append(f'Broken link {p.relative_to(root)} -> {dest}')
for err in errors: print('ERROR',err)
if errors:sys.exit(1)
print('DOCUMENTATION_ONLY_PASS; does NOT verify any running application')
