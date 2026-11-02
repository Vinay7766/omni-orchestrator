param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CargoArgs
)

# Initialize MSVC environment
cmd.exe /c 'call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsx86_amd64.bat" && set' | ForEach-Object {
    if ($_ -match '^(.*?)=(.*)$') {
        Set-Item -Path "env:$($matches[1])" -Value $matches[2]
    }
}

# CI's form (--manifest-path src-tauri/Cargo.toml) runs from the repository root;
# the short form (cargo-dev.ps1 test) runs inside src-tauri.
if ($CargoArgs -contains '--manifest-path') {
    Set-Location "$PSScriptRoot\.."
} else {
    Set-Location "$PSScriptRoot\..\src-tauri"
}
& cargo @CargoArgs
# Pass cargo's result on: callers (the pre-push check) must see a failure as a failure.
exit $LASTEXITCODE
