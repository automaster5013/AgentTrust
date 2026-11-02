param([Parameter(Mandatory=$true)][string]$InputImage)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
    $root=[IO.Path]::GetFullPath('C:/AgentTrust').TrimEnd('\')+'\'
    $image=[IO.Path]::GetFullPath($InputImage)
    if(-not $image.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($image) -ne '.png'){throw 'invalid-input'}
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [void][Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
    [void][Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
    [void][Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
    $asTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1)
    function Await($operation,[Type]$resultType){
        $task=$asTask.MakeGenericMethod($resultType).Invoke($null,@($operation))
        if(-not $task.Wait(15000)){throw 'ocr-timeout'}
        $task.Result
    }
    $file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($image)) ([Windows.Storage.StorageFile])
    $stream=Await ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    try {
        $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        try {
            $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
            if($null -eq $engine){throw 'ocr-language-unavailable'}
            $result=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
            $patterns=@{
                'credential-assignment'='(?i)(\b(password|token|access_token|api[_-]?key|client_secret|secret)|\uBE44\uBC00\uBC88\uD638|\uC811\uADFC\uD0A4)\s*[:=]\s*\S+'
                'bearer-token'='(?i)\bBearer\s+[A-Za-z0-9._~+/-]{8,}'
                'provider-token'='\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,})\b'
                'private-key'='-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
                'email'='\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b'
                'uuid-record-id'='(?i)\b[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\b'
            }
            $findings=@()
            foreach($line in $result.Lines){
                foreach($kind in $patterns.Keys){
                    if($line.Text -match $patterns[$kind]){
                        $boxes=@($line.Words | ForEach-Object { @{x=$_.BoundingRect.X;y=$_.BoundingRect.Y;width=$_.BoundingRect.Width;height=$_.BoundingRect.Height} })
                        $findings+=@{kind=$kind;lineBoxes=$boxes}
                    }
                }
            }
            # A whole-frame text pass catches tokens split between recognized lines.
            $wholeKinds=@($patterns.Keys | Where-Object { $result.Text -match $patterns[$_] })
            @{status='sample-scanned';language=$engine.RecognizerLanguage.LanguageTag;width=$bitmap.PixelWidth;height=$bitmap.PixelHeight;findings=$findings;wholeFrameKinds=$wholeKinds;fullVideoReviewed=$false} | ConvertTo-Json -Depth 8 -Compress
        } finally { if($null -ne $bitmap){$bitmap.Dispose()} }
    } finally { $stream.Dispose() }
} catch {
    @{status='ocr-blocked';findings=@();fullVideoReviewed=$false;errorType=$_.Exception.GetType().Name;line=$_.InvocationInfo.ScriptLineNumber} | ConvertTo-Json -Compress
    exit 2
}
