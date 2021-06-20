### [<sub>⬇</sub> Password Backup Tool](https://github.com/JustOff/password-backup-tool/releases)

Export and import passwords saved in Pale Moon browser. Also allows to import from Chromium based browsers (Windows only) and Firefox 58+ (key4.db). To do so just open Import Passwords dialog and paste the path to the password database for the corresponding browser from the list below or manually navigate to the required profile and select "Login Data" or "logins.json" file. The browser that you importing data from must be closed during the import.

Well known paths to Chromium based browsers passwords database:
```"%LOCALAPPDATA%\Chromium\User Data\Default\Login Data"
"%LOCALAPPDATA%\Google\Chrome\User Data\Default\Login Data"
"%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Login Data"
"%APPDATA%\Opera Software\Opera Stable\Login Data"
"%LOCALAPPDATA%\Vivaldi\User Data\Default\Login Data"
```

Firefox profile folder can be found using the menu "Help" -> "Troubleshooting Information".

Starting from version 1.4.0, [Firefox Lockwise](https://support.mozilla.org/en-US/kb/password-manager-remember-delete-edit-logins) CSV file format is supported directly, both for export and import.

**Warning**

When selecting to "obfuscate" your usernames and passwords, note that this only makes the data not readable to the human eye, but is easily reversed. Even with this option selected, ANYONE CAN EASILY DISCOVER YOUR PASSWORDS. Please take this into account when exporting your passwords and never place your exported file(s) where others could access them.
