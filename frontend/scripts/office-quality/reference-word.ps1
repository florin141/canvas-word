# Export a .docx to PDF through Microsoft Word's COM automation — the
# authoritative local reference for the visual-quality harness.
#
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
#     -File reference-word.ps1 -Source <docx> -Output <pdf>
#
# Prints exactly one machine-readable line on success:
#   WORD_VERSION=<Word major.minor>
# All failures exit non-zero with a diagnostic on stderr. The caller enforces a
# wall-clock deadline and kills the process tree; this script always closes the
# document (discarding changes) and quits Word.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = "Stop"

$sourcePath = [System.IO.Path]::GetFullPath($Source)
$outputPath = [System.IO.Path]::GetFullPath($Output)
if (-not [System.IO.File]::Exists($sourcePath)) {
  [Console]::Error.WriteLine("reference-word: source not found: $sourcePath")
  exit 1
}
$outputDir = [System.IO.Path]::GetDirectoryName($outputPath)
if (-not [System.IO.Directory]::Exists($outputDir)) {
  [void][System.IO.Directory]::CreateDirectory($outputDir)
}

$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0            # wdAlertsNone — never block on a dialog
  $word.AutomationSecurity = 3       # msoAutomationSecurityForceDisable — no macros

  # Open read-only, without conversion prompts, and without touching MRU.
  $document = $word.Documents.Open($sourcePath, $false, $true, $false)

  # ExportAsFixedFormat(OutputFileName, ExportFormat=wdExportFormatPDF,
  #   OpenAfterExport=false, OptimizeFor=wdExportOptimizeForPrint,
  #   Range=wdExportAllDocument, From, To, Item=wdExportDocumentContent,
  #   IncludeDocProps=true, KeepIRM=true, CreateBookmarks=wdExportCreateNoBookmarks,
  #   DocStructureTags=true, BitmapMissingFonts=true, UseISO19005_1=false)
  $document.ExportAsFixedFormat(
    $outputPath, 17, $false, 0, 0, 0, 0, 0, $true, $true, 0, $true, $true, $false
  )

  Write-Output "WORD_VERSION=$($word.Version)"
}
catch {
  [Console]::Error.WriteLine("reference-word: $($_.Exception.Message)")
  exit 1
}
finally {
  if ($null -ne $document) {
    try { $document.Close($false) } catch { }
    try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document) } catch { }
    $document = $null
  }
  if ($null -ne $word) {
    try { $word.Quit() } catch { }
    try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) } catch { }
    $word = $null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
