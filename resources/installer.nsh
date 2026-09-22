; Context-menu integration for Windows (per-user): right-clicking a folder or
; the empty area inside a folder offers "Open with DamnedIDE". The file
; association for .md is handled by electron-builder's fileAssociations.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\Directory\shell\DamnedIDE" "" "Open with DamnedIDE"
  WriteRegStr HKCU "Software\Classes\Directory\shell\DamnedIDE" "Icon" "$INSTDIR\DamnedIDE.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\DamnedIDE\command" "" '"$INSTDIR\DamnedIDE.exe" "%1"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\DamnedIDE" "" "Open with DamnedIDE"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\DamnedIDE" "Icon" "$INSTDIR\DamnedIDE.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\DamnedIDE\command" "" '"$INSTDIR\DamnedIDE.exe" "%V"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\DamnedIDE"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\DamnedIDE"
!macroend
