@echo off
set VER=1.4.0

sed -i -E "s/version>.+?</version>%VER%</" install.rdf
sed -i -E "s/version>.+?</version>%VER%</; s/download\/.+?\/password-backup-tool-.+?\.xpi/download\/%VER%\/password-backup-tool-%VER%\.xpi/" update.xml

set XPI=password-backup-tool-%VER%.xpi
if exist %XPI% del %XPI%
zip -r9q %XPI% * -x .git/* .gitignore update.xml LICENSE README.md *.cmd *.xpi *.exe
