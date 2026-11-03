"""Read-only checks for the portfolio documents. Never prints matched values."""
from __future__ import annotations
import argparse,json,re,unicodedata
from pathlib import Path,PureWindowsPath
from urllib.parse import unquote,urlsplit,parse_qsl

DEFAULT_DOCUMENTS=(
 'README.md','docs/console-ux-quality.md','docs/portfolio-demo.md',
 'docs/portfolio-engineering.md','docs/stack-reviewer-guide.md',
 'docs/user-workflow-delivery-board.md','docs/portfolio-accessibility-review.md',
 'docs/portfolio-submission.md','docs/portfolio-submission-checklist.md',
 'docs/portfolio-technical-overview.md',
 'docs/portfolio-4310-overview.md','docs/portfolio-4310-verification.md',
 'docs/portfolio-media-tools.md','docs/portfolio-status.md',
)
PRIVATE_PARTS={'.local','.git','.cache','.next','node_modules'}
SECRET_PATTERNS=(
 ('private-key-material',re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{48,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),
 ('provider-key-shape',re.compile(r'\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b')),
 ('github-token-shape',re.compile(r'\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b')),
)
SENSITIVE_QUERY={'token','access_token','api_key','apikey','password','secret','client_secret'}
LINK=re.compile(r'!?\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]+)\)')

def without_fences(text):
 inside=False;output=[]
 for line in text.splitlines(keepends=True):
  if re.match(r'^\s{0,3}(```|~~~)',line):inside=not inside;output.append('\n' if line.endswith('\n') else '');continue
  output.append(('\n' if line.endswith('\n') else '') if inside else line)
 return ''.join(output)

def anchors(text):
 found=set(re.findall(r'\b(?:id|name)=[\"\x27]([^\"\x27]+)',text));counts={}
 for line in without_fences(text).splitlines():
  m=re.match(r'^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$',line)
  if not m:continue
  title=re.sub(r'<[^>]+>','',m[1]).lower()
  title=''.join(c for c in title if c in '-_ ' or unicodedata.category(c)[0] in 'LN')
  slug=title.replace(' ','-');n=counts.get(slug,0);counts[slug]=n+1;found.add(slug if not n else f'{slug}-{n}')
 return found

def audit(root,documents=DEFAULT_DOCUMENTS):
 root=Path(root).resolve();findings=[];checked=0;links=0
 def issue(file,line,kind):findings.append({'file':file,'line':line,'kind':kind})
 for rel in documents:
  p=(root/rel).resolve()
  if not p.is_relative_to(root):issue(rel,1,'document-outside-root');continue
  if any(x in PRIVATE_PARTS for x in p.relative_to(root).parts) or p.name=='.env':issue(rel,1,'private-document-path');continue
  if not p.is_file():issue(rel,1,'missing-document');continue
  if p.stat().st_size>1048576:issue(rel,1,'document-too-large');continue
  try:text=p.read_text(encoding='utf-8')
  except UnicodeDecodeError:issue(rel,1,'invalid-utf8');continue
  checked+=1
  for kind,pattern in SECRET_PATTERNS:
   for match in pattern.finditer(text):issue(rel,text[:match.start()].count('\n')+1,kind)
  # Keep line positions when ignoring examples inside fenced code blocks.
  clean=without_fences(text)
  for match in LINK.finditer(clean):
   links+=1;line=clean[:match.start()].count('\n')+1;raw=match[1].strip()
   if raw.startswith('<'):raw=raw[1:-1]
   else:raw=re.split(r'\s+[\"\x27]',raw,maxsplit=1)[0]
   try:url=urlsplit(raw)
   except ValueError:issue(rel,line,'invalid-link');continue
   if url.username or url.password:issue(rel,line,'credentials-in-url');continue
   if any(k.lower() in SENSITIVE_QUERY for k,_ in parse_qsl(url.query)):issue(rel,line,'sensitive-url-query');continue
   if url.scheme in {'https','http','mailto'}:continue
   if url.scheme or url.netloc:issue(rel,line,'unsupported-link-scheme');continue
   path=unquote(url.path);fragment=unquote(url.fragment)
   if '\x00' in path:issue(rel,line,'invalid-link-path');continue
   if path.startswith(('/',chr(92))) or PureWindowsPath(path).drive:issue(rel,line,'absolute-link-path');continue
   target=(p.parent/path).resolve() if path else p
   if not target.is_relative_to(root):issue(rel,line,'link-outside-root');continue
   parts=target.relative_to(root).parts
   if any(x in PRIVATE_PARTS for x in parts) or target.name=='.env':issue(rel,line,'private-path-link');continue
   if not target.is_file():issue(rel,line,'missing-link-target');continue
   if fragment and target.suffix.lower()=='.md':
    if target.stat().st_size>1048576:issue(rel,line,'link-target-too-large');continue
    try:ids=anchors(target.read_text(encoding='utf-8'))
    except (OSError,UnicodeDecodeError):issue(rel,line,'unreadable-link-target');continue
    if fragment not in ids:issue(rel,line,'missing-heading-anchor')
 return {'passed':not findings,'documentsChecked':checked,'linksChecked':links,'findings':findings,
  'limitations':'Selected documents only; no network, browser, media-content, runtime, or comprehensive secret audit.'}

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.parse_args()
 result=audit(Path(__file__).resolve().parents[1]);print(json.dumps(result,ensure_ascii=True,indent=2));return 0 if result['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
