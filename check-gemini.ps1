$ErrorActionPreference = 'Stop'
try {
    $configPath = Join-Path $PSScriptRoot '.env.local'
    $keyLine = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^\s*GEMINI_API_KEY\s*=' } | Select-Object -First 1
    if (-not $keyLine) { throw 'Missing GEMINI_API_KEY in .env.local.' }
    $geminiKey = ($keyLine -split '=', 2)[1].Trim().Trim('"').Trim("'")
    if (-not $geminiKey -or $geminiKey -eq 'PASTE_YOUR_KEY_HERE') { throw 'The key placeholder has not been replaced.' }
    $headers = @{ 'x-goog-api-key' = $geminiKey }
    $catalog = Invoke-RestMethod -Uri 'https://generativelanguage.googleapis.com/v1beta/models' -Headers $headers -Method Get
    $candidates = @($catalog.models | Where-Object { $_.name -match '^models/gemini.*flash' -and $_.name -notmatch 'image|audio|live|tts' -and $_.supportedGenerationMethods -contains 'generateContent' })
    if ($candidates.Count -eq 0) { Write-Host 'Key authenticated, but no suitable Flash model was listed.'; exit 1 }
    $preferred = $candidates | Where-Object { $_.name -eq 'models/gemini-2.5-flash' } | Select-Object -First 1
    if (-not $preferred) { $preferred = $candidates | Select-Object -First 1 }
    Write-Host ('Key authenticated. Testing model: ' + $preferred.name)
    $payload = @{ contents = @(@{ parts = @(@{ text = 'Reply with the single word READY.' }) }); generationConfig = @{ maxOutputTokens = 256 } } | ConvertTo-Json -Depth 8 -Compress
    $endpoint = 'https://generativelanguage.googleapis.com/v1beta/' + $preferred.name + ':generateContent'
    $result = Invoke-RestMethod -Uri $endpoint -Method Post -Headers $headers -ContentType 'application/json' -Body $payload
    if ($result.candidates) { Write-Host 'SUCCESS: A real generation request completed. Your key was not displayed.' }
    else { Write-Host 'Request returned without generated candidates. Further checking needed.' }
} catch {
    $statusCode = $null
    if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
    if ($statusCode -eq 429) { Write-Host 'LIMIT: Google returned 429. The model quota is unavailable or exhausted; check AI Studio limits.' }
    elseif ($statusCode) { Write-Host ('FAILED: HTTP ' + $statusCode + '. Your key was not displayed.') }
    else { Write-Host 'FAILED: Could not read the configuration or connect to Google. Your key was not displayed.' }
    exit 1
}
