
Add-Type -AssemblyName System.IO.Compression;
Add-Type -AssemblyName System.IO.Compression.FileSystem;

$zipPath = '/home/hatch/workspace/chessmate-review/repo/chessmate-agent.zip';
$distDir = '/home/hatch/workspace/chessmate-review/repo/dist';

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create);

# Create folder entries first (required by iOS / Safari / Orion zip extractors)
Get-ChildItem -Path $distDir -Recurse | Where-Object { $_.PSIsContainer } | ForEach-Object {
    $relDir = $_.FullName.Substring($distDir.Length + 1).Replace('\', '/') + '/';
    $zip.CreateEntry($relDir) | Out-Null;
};

# Create file entries
Get-ChildItem -Path $distDir -Recurse | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
    $rel = $_.FullName.Substring($distDir.Length + 1).Replace('\', '/');
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel) | Out-Null;
};

$zip.Dispose();
