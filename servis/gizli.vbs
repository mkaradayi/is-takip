' Is Takip - zamanlanmis gorevin calistirdigi baslatici.
' calistir.cmd'yi gizli pencerede calistirir ve bitmesini bekler (calistir.cmd sunucu cokerse kendisi yeniden baslatir).
' Kullanim: wscript gizli.vbs <port> [veri-klasoru]
Option Explicit
Dim sh, fso, dir, port, data, q, cmd, rc
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
port = "3000"
data = ""
If WScript.Arguments.Count > 0 Then port = WScript.Arguments(0)
If WScript.Arguments.Count > 1 Then data = WScript.Arguments(1)
q = Chr(34)
cmd = q & dir & "\calistir.cmd" & q & " " & port
If data <> "" Then cmd = cmd & " " & q & data & q
' cmd /c, ikiden fazla tirnak gorunce ilk ve son tirnagi siler; bu yuzden komutun tamami bir kat daha tirnaga alinir
cmd = "cmd.exe /c " & q & cmd & q
rc = sh.Run(cmd, 0, True)
WScript.Quit rc
