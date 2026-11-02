param([switch]$Record,[string]$PythonPath=(Join-Path $env:LOCALAPPDATA 'Python/pythoncore-3.14-64/python.exe'))
$ErrorActionPreference='Stop'
Set-Location -LiteralPath 'C:/AgentTrust'
$python=$PythonPath
if(-not (Test-Path -LiteralPath $python -PathType Leaf)){throw 'Pinned Python unavailable'}
if($Record){ & $python 'C:/AgentTrust/scripts/portfolio-capture.py' --record }
else{ & $python 'C:/AgentTrust/scripts/portfolio-capture.py' }
exit $LASTEXITCODE
