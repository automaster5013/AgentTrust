param(
    [Parameter(Mandatory=$true)][string]$Video,
    [string]$Captions,
    [string]$Timeline,
    [switch]$Ocr,
    [ValidateRange(1,60)][double]$SampleInterval=10,
    [string]$PythonPath=(Join-Path $env:LOCALAPPDATA 'Python/pythoncore-3.14-64/python.exe')
)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath 'C:/AgentTrust'
$python=$PythonPath
if($Captions -and $Timeline){throw 'Choose captions or timeline'}
$arguments=@('C:/AgentTrust/scripts/portfolio-media-review.py','--video',$Video,'--frames','--sample-interval',$SampleInterval.ToString([Globalization.CultureInfo]::InvariantCulture))
if($Captions){$arguments+=@('--captions',$Captions)}
if($Timeline){$arguments+=@('--timeline',$Timeline)}
if($Ocr){$arguments+='--ocr'}
& $python @arguments
# Exit 2 is expected while actual provenance/full visual/audio review remain unapproved.
exit $LASTEXITCODE
