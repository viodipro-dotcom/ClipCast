!include "LogicLib.nsh"
!include "Sections.nsh"

!define CLIPCAST_STARTUP_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define CLIPCAST_STARTUP_REG_VALUE "ClipCast"

!define CLIPCAST_DESKTOP_SHORTCUT "$DESKTOP\ClipCast.lnk"

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
  !insertmacro MUI_PAGE_COMPONENTS
!macroend

!macro customInit
  SectionSetFlags ${SecDesktopShortcut} ${SF_SELECTED}
!macroend

Section /o "Launch ClipCast at Windows startup" SecRunAtStartup
SectionEnd

Section /o "Create Desktop Shortcut" SecDesktopShortcut
SectionEnd

!macro customInstall
  SectionGetFlags ${SecRunAtStartup} $0
  IntOp $0 $0 & ${SF_SELECTED}
  ${If} $0 != 0
    WriteRegStr HKCU "${CLIPCAST_STARTUP_REG_KEY}" "${CLIPCAST_STARTUP_REG_VALUE}" "$\"$INSTDIR\ClipCast.exe$\" --autostart"
  ${Else}
    DeleteRegValue HKCU "${CLIPCAST_STARTUP_REG_KEY}" "${CLIPCAST_STARTUP_REG_VALUE}"
  ${EndIf}

  SectionGetFlags ${SecDesktopShortcut} $1
  IntOp $1 $1 & ${SF_SELECTED}
  ${If} $1 != 0
    CreateShortCut "${CLIPCAST_DESKTOP_SHORTCUT}" "$INSTDIR\ClipCast.exe"
  ${Else}
    Delete "${CLIPCAST_DESKTOP_SHORTCUT}"
  ${EndIf}
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "${CLIPCAST_STARTUP_REG_KEY}" "${CLIPCAST_STARTUP_REG_VALUE}"
  Delete "${CLIPCAST_DESKTOP_SHORTCUT}"
!macroend
