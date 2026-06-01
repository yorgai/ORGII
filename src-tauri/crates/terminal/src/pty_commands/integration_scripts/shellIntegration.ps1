# Orgii terminal shell integration for PowerShell
# Emits OSC 633 sequences for structured command detection.

if ($env:ORGII_SHELL_INTEGRATION) { return }
$env:ORGII_SHELL_INTEGRATION = "1"

function Global:__orgii_escape([string]$Value) {
    $Value = $Value.Replace('\', '\\')
    $Value = $Value.Replace(';', '\x3b')
    return $Value
}

function Global:__orgii_osc([string]$Data) {
    [Console]::Write("$([char]0x1b)]633;${Data}`a")
}

$Global:__orgii_in_command = $false

$Global:__orgii_original_prompt = $function:prompt

function Global:prompt {
    $ec = $LASTEXITCODE
    if ($null -eq $ec) { $ec = 0 }

    if ($Global:__orgii_in_command) {
        __orgii_osc "D;$ec"
        $Global:__orgii_in_command = $false
    }

    $cwd = __orgii_escape (Get-Location).Path
    __orgii_osc "P;Cwd=$cwd"
    __orgii_osc "A"

    $originalResult = & $Global:__orgii_original_prompt
    return $originalResult
}

if (Get-Module -Name PSReadLine -ErrorAction SilentlyContinue) {
    $Global:__orgii_original_readline = $null
    try {
        $Global:__orgii_original_readline = (Get-PSReadLineOption).ReadLineHandler
    } catch {}

    Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
        $line = $null
        $cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)

        $escaped = __orgii_escape $line
        __orgii_osc "E;$escaped"
        __orgii_osc "C"
        $Global:__orgii_in_command = $true

        [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
    }
}

$cwd = __orgii_escape (Get-Location).Path
__orgii_osc "P;Cwd=$cwd"
__orgii_osc "A"
