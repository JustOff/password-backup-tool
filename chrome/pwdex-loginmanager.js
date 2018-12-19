/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/.
 **/

/**
 * Password Backup Tool - Login Manager support
 * This file is for use with the new login manager in Firefox 3+
 */
var { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "Sqlite",
                                  "resource://gre/modules/Sqlite.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "OSCrypto",
                                  "chrome://pwdbackuptool/content/OSCrypto.jsm");

const AUTH_TYPE = {
  SCHEME_HTML: 0,
  SCHEME_BASIC: 1,
  SCHEME_DIGEST: 2
};

const expEngine = "Password Backup Tool";
const oldEngine = "Password Exporter";
const expPwdVer = "2.0";
const expHostVer = "1.0";

var passwordExporterLoginMgr = {
    version: expPwdVer,
    
    export: {
        currentExport: '', // CSV or XML string of current export
        count: 0, // count of exported logins
        errorCount: 0, // count of failed logins
        failed: '', // failed hosts

        // starts export of saved passwords to XML/CSV file
        start: function() {
            let masterPassword;

            // Check if user has accepted agreement
            passwordExporter.checkAgreement();
            masterPassword = passwordExporter.showMasterPasswordPrompt();

            if (masterPassword && passwordExporter.accepted == true) {
                var picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
                picker.init(window, passwordExporter.getString("passwordexporter.filepicker-title"), picker.modeSave);
                picker.defaultString = "password-export-" + passwordExporter.getDateString() + ".xml";
                picker.defaultExtension = "xml";
                picker.appendFilter("XML", "*.xml");
                picker.appendFilter("CSV", "*.csv");

                if (picker.returnCancel != picker.show()) {
                    var result = { file : picker.file, type : picker.filterIndex };
                } else {
                    return;
                }

                var ostream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);

                // Remove file if it exists
                if (result.file.exists()) {
                    result.file.remove(true);
                }

                result.file.create(result.file.NORMAL_FILE_TYPE, parseInt("0666", 8));
                ostream.init(result.file, 0x02, 0x200, null);

                // Whether to encrypt the passwords
                var encrypt = document.getElementById('pwdex-encrypt').checked;
                var content = "";
                // do export
                switch (result.type) {
                    case 0:
                        content = this.export('xml', encrypt);
                        break;
                    case 1:
                        content = this.export('csv', encrypt);
                        break;
                }

                var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
                                    .createInstance(Ci.nsIScriptableUnicodeConverter);
                converter.charset = "UTF-8";
                var istream = converter.convertToInputStream(content);
                var that = this, win = window;

                NetUtil.asyncCopy(istream, ostream, function(status) {
                    if (that.errorCount == 0) {
                        alert(passwordExporter.stringBundle.formatStringFromName('passwordexporter.alert-passwords-exported', [that.count], 1));
                    } else {
                        var promptService = Cc["@mozilla.org/embedcomp/prompt-service;1"].getService(Ci.nsIPromptService);

                        var flags = promptService.BUTTON_TITLE_OK * promptService.BUTTON_POS_0 +
                        promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_1;

                        var response = promptService.confirmEx(win, passwordExporter.getString('passwordexporter.name'),
                                    passwordExporter.stringBundle.formatStringFromName('passwordexporter.alert-passwords-exported', [that.count], 1) + "\n\n" +
                                    passwordExporter.stringBundle.formatStringFromName('passwordexporter.alert-passwords-failed', [that.errorCount], 1), flags,
                                    null, passwordExporter.getString('passwordexporter.show-details'), null, null, {});

                        if (response == 1)
                            win.openDialog("chrome://pwdbackuptool/content/pwdex-details-export.xul", "","chrome,resizable,centerscreen,close=no,modal");
                    }
                });
            }
        },

        // Generates XML/CSV from Login Manager entries
        export: function(type, encrypt) {
            if (type == 'xml') {
                this.currentExport = '<xml>' + passwordExporter.linebreak;
                this.currentExport += '<entries ext="' + expEngine + '" extxmlversion="' + expPwdVer + '" type="saved" encrypt="' + encrypt + '">' + passwordExporter.linebreak;
            }
            else if (type == 'csv') {
                this.currentExport = '# Generated by ' + expEngine + '; Export format ' + expPwdVer + '; Encrypted: ' + encrypt + passwordExporter.linebreak;
                this.currentExport += '"hostname","username","password","formSubmitURL","httpRealm","usernameField","passwordField"' + passwordExporter.linebreak;
            }

            this.count = 0;
            this.errorCount = 0;
            passwordExporter.failed = '';

            var loginManager = CC_loginManager.getService(Ci.nsILoginManager);
            var logins = loginManager.getAllLogins({});

            for (var i = 0; i < logins.length; i++) {
                if (type == 'xml') {
                    this.entryToXML(logins[i].hostname, logins[i].formSubmitURL, logins[i].httpRealm, logins[i].username,
                               logins[i].usernameField, logins[i].password, logins[i].passwordField, encrypt);
                }
                else if (type == 'csv') {
                    this.entryToCSV(logins[i].hostname, logins[i].formSubmitURL, logins[i].httpRealm, logins[i].username,
                               logins[i].usernameField, logins[i].password, logins[i].passwordField, encrypt);
                }
            }

            if (type == 'xml') {
                this.currentExport += '</entries>' + passwordExporter.linebreak + '</xml>';
            }

            return this.currentExport;
        },

        // Records an nsILoginInfo entry to XML
        entryToXML: function(hostname, formSubmitURL, httpRealm, username, usernameField,
                            password, passwordField, encrypt) {
            if (encrypt) {
                username = btoa(username);
                password = btoa(password);
            }

            try {
                var xml  = '<entry';
                xml += ' host="' + this.escapeXML(hostname) + '"';
                xml += ' user="' + this.escapeXML(username) + '"';
                xml += ' password="' + this.escapeXML(password) + '"';

                xml += ' formSubmitURL="' + (formSubmitURL ? this.escapeXML(formSubmitURL) : '') + '"';
                xml += ' httpRealm="' + (httpRealm ? this.escapeXML(httpRealm) : '') + '"';
                xml += ' userFieldName="' + (usernameField ? this.escapeXML(usernameField) : '') + '"';
                xml += ' passFieldName="' + (passwordField ? this.escapeXML(passwordField) : '') + '"';

                xml += '/>' + passwordExporter.linebreak;

                this.currentExport += xml;
                this.count++;
            } catch (e) {
                this.errorCount++;
                try {
                    this.failed += hostname + passwordExporter.linebreak;
                } catch (e) { }
            }
        },

        // Records an nsILoginInfo entry to CSV
        entryToCSV: function(hostname, formSubmitURL, httpRealm, username, usernameField,
                            password, passwordField, encrypt) {
            if (encrypt) {
                username = btoa(username);
                password = btoa(password);
            }

            try {
                var csv = '"' + this.escapeCVS(hostname) + '",';
                csv += '"' + this.escapeCVS(username) + '",';
                csv += '"' + this.escapeCVS(password) + '",';

                csv += '"' + (formSubmitURL ? this.escapeCVS(formSubmitURL) : '') + '",';
                csv += '"' + (httpRealm ? this.escapeCVS(httpRealm) : '') + '",';
                csv += '"' + (usernameField ? this.escapeCVS(usernameField) : '') + '",';
                csv += '"' + (passwordField ? this.escapeCVS(passwordField) : '')+ '"';

                csv += passwordExporter.linebreak;

                this.currentExport += csv;
                this.count++;
            } catch (e) {
                this.errorCount++;
                try {
                    this.failed += hostname + passwordExporter.linebreak;
                } catch (e) { }
            }
        },

        // escapes special characters so that it will parse correctly in CSV
        escapeCVS: function(string) {
            string = string.replace(/"/g, '""');

            return string;
        },

        // escapes special characters so that it will parse correctly in XML
        escapeXML: function(string) {
            string = string.replace(/</g, '&lt;');
            string = string.replace(/>/g, '&gt;');
            string = string.replace(/"/g, '&quot;');
            string = string.replace(/&/g, '&amp;');

            return string;
        },

        // populate details textbox with failed entries
        populateFailed: function(textbox) {
            textbox.value = this.failed;
        },

        disabled: {
            // starts export of login disabled sites that never saved passwords
            start: function() {
                var fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
                var stream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);

                fp.init(window, passwordExporter.getString('passwordexporter.filepicker-title'), fp.modeSave);
                fp.defaultString = 'disabled-export-' + passwordExporter.getDateString();
                fp.defaultExtension = '.xml';
                fp.appendFilters(fp.filterXML);

                // If cancelled, return
                if (fp.show() == fp.returnCancel)
                    return;

                if (fp.file.exists())
                    fp.file.remove(true);

                fp.file.create(fp.file.NORMAL_FILE_TYPE, parseInt("0666", 8));
                stream.init(fp.file, 0x02, 0x200, null);

                var xml = this.export();

                stream.write(xml, xml.length);
                stream.close();

                alert(passwordExporter.getString('passwordexporter.alert-rejected-exported'));
            },

            // Gets disabled hosts from Login Manager
            export: function() {
                var xml = '<xml>' + passwordExporter.linebreak;
                xml += '<entries ext="' + expEngine + '" extxmlversion="' + expHostVer + '" type="rejected">' + passwordExporter.linebreak;

                var loginManager = CC_loginManager.getService(Ci.nsILoginManager);
                var disabledHosts = loginManager.getAllDisabledHosts({});

                for (var i = 0; i < disabledHosts.length; i++) {
                    xml += '<entry host="' + disabledHosts[i] + '"/>' + passwordExporter.linebreak;
                }

                xml += '</entries>' + passwordExporter.linebreak + '</xml>';

                return xml;
            }
        }

    },

    import: {
        totalCount: 0, // total number of logins
        currentCount: 0, // number of logins currently imported
        cancelled: false, // whether the operation was cancelled
        failed: '', // list of failed hosts

        // Starts the import of logins from a CSV or XML file
        start: function() {
            var fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
            var stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
            var streamIO = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(Ci.nsIScriptableInputStream);
            var input, inputArray, importType, doc, header, name, type, version, encrypt;

            fp.init(window, passwordExporter.getString('passwordexporter.filepicker-title'), fp.modeOpen);
            fp.appendFilter(passwordExporter.getString('passwordexporter.filepicker-open-xmlcsv'), '*.xml; *.csv; *');

            // If cancelled, return
            if (fp.show() == fp.returnCancel)
                return;

            if (fp.file.path.indexOf('.csv') != -1 || fp.file.path.indexOf('.xml') != -1 || fp.file.path.indexOf('logins.json') != -1) {
                stream.init(fp.file, 0x01, parseInt("0444", 8), null);
                streamIO.init(stream);
                input = streamIO.read(stream.available());
                streamIO.close();
                stream.close();

                var utf8Converter = Cc["@mozilla.org/intl/utf8converterservice;1"].getService(Ci.nsIUTF8ConverterService);
                input = utf8Converter.convertURISpecToUTF8(input, "UTF-8");
            }

            // If CSV format, parse for header info
            if (fp.file.path.indexOf('.csv') != -1) {
                // Starting in 1.1, header is in a "comment" at the top
                var header = /# Generated by (.+); Export format (.{3,6}); Encrypted: (true|false)/i.exec(input);
                if (!header) {
                    // Previously, the header was in CSV form in the first line
                    header = /(.+?),(.{3,6}),(true|false)/i.exec(input);
                }
                if (!header) {
                    // If we still can't read header, there's a problem with the file
                    alert(passwordExporter.getString('passwordexporter.alert-cannot-import'));
                    return;
                }
                var properties = {'extension': header[1],
                                  'importtype': 'saved',
                                  'importversion': header[2],
                                  'encrypt': header[3]};
                this.import('csv', properties, input);
            }
            // If XML format, parse for header info
            else if (fp.file.path.indexOf('.xml') != -1) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(input, "text/xml");
                var header = doc.documentElement.getElementsByTagName('entries')[0];

                if (doc.documentElement.nodeName == 'parsererror') {
                    alert(passwordExporter.getString('passwordexporter.alert-xml-error'));
                    return;
                }

                var properties = {'extension': header.getAttribute('ext'),
                                  'importtype': header.getAttribute('type'),
                                  'importversion': header.getAttribute('extxmlversion'),
                                  'encrypt': header.getAttribute('encrypt')};
                var entries = doc.documentElement.getElementsByTagName('entry');
                this.import('xml', properties, entries);
            }
            // Firefox 58+ logins.json
            else if (fp.file.path.indexOf('logins.json') != -1) {
                var key4file = fp.file.parent;
                key4file.append("key4.db");
                if (typeof forge !== 'object') {
                    var loader = Cc["@mozilla.org/moz/jssubscript-loader;1"].getService(Ci.mozIJSSubScriptLoader);
                    loader.loadSubScript("chrome://pwdbackuptool/content/forge.min.js");
                    // entry: ['./lib/asn1.js', './lib/sha1.js', './lib/hmac.js', './lib/des.js', './lib/forge.js'],
                }
                let that = this;
                this.getRowsFromDBWithoutLocks(key4file.path, "Firefox key4.db",
                    `SELECT item1,item2,a11 FROM metadata,nssPrivate WHERE metadata.id = 'password' AND nssPrivate.a11 IS NOT NULL LIMIT 1`).then((rows) => {
                    var key = that.getKey(rows[0]);
                    var jsonData = JSON.parse(input);
                    var entries = jsonData.logins;
                    var properties = {'extension': expEngine,
                                    'importtype': 'saved',
                                    'importversion': expPwdVer,
                                    'encrypt': 'false'};
                    that.import('firefox', properties, entries, key);
                }).catch(ex => {
                    alert(ex);
                    that.finished();
                });
            // Chrome style Login Data
            } else {
                let that = this;
                this.getRowsFromDBWithoutLocks(fp.file.path, "Chrome passwords",
                    `SELECT origin_url, action_url, username_element, username_value,
                    password_element, password_value, signon_realm, scheme, date_created,
                    times_used FROM logins WHERE blacklisted_by_user = 0`).then((rows) => {
                    var properties = {'extension': expEngine,
                                    'importtype': 'saved',
                                    'importversion': expPwdVer,
                                    'encrypt': 'false'};
                    that.import('chrome', properties, rows);
                }).catch(ex => {
                    alert(ex);
                    that.finished();
                });
            }
        },

        // Validates import file and parses it
        import: function (type, properties, entries, key) {
            // Make sure this is a Password Backup Tool or Password Exporter export file
            if (properties.extension != expEngine && properties.extension != oldEngine) {
                alert(passwordExporter.getString('passwordexporter.alert-cannot-import'));
                return;
            }

            // Make sure this is a saved passwords file, as opposed to disabled hosts
            if (properties.importtype != 'saved') {
                alert(passwordExporter.getString('passwordexporter.alert-wrong-file-reject'));
                return;
            }

            // Make sure this was exported from a version supported (not a future version)
            if ((properties.extension == oldEngine && properties.importversion in {'1.0.2':'', '1.0.4':'', '1.1':''}) ||
                    (properties.extension == expEngine && properties.importversion == "2.0")) {
                // Import
                var logins = [];
                this.totalCount = 0;
                this.currentCount = 0;

                passwordExporter.disableAllButtons();
                document.getElementById('pwdex-import-finished').hidden = true;
                document.getElementById('pwdex-import-view-details').hidden = true;
                document.getElementById('pwdex-import-complete').hidden = true;
                document.getElementById('pwdex-import-cancelled').hidden = true;
                document.getElementById('pwdex-import-status').value = '';
                document.getElementById('pwdex-import-underway').hidden = false;
                document.getElementById('pwdex-import-cancel').hidden = false;

                var loginManager = CC_loginManager.getService(Ci.nsILoginManager);
                var nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1",
                                         Ci.nsILoginInfo, "init");
                if (type == 'xml') {
                    this.totalCount = entries.length;

                    if (properties.extension == oldEngine && (properties.importversion == '1.0.2' || properties.importversion == '1.0.4')) {
                        var emptySubmitURL = "";
                    } else {
                        var emptySubmitURL = null;
                    }

                    for (var i = 0; i < entries.length; i++) {
                        if (properties.extension == oldEngine) {
                            var loginInfo = new nsLoginInfo(
                                (entries[i].getAttribute('host') == null ? null : unescape(entries[i].getAttribute('host'))),
                                (entries[i].getAttribute('formSubmitURL') == null ? emptySubmitURL : unescape(entries[i].getAttribute('formSubmitURL'))),
                                ((entries[i].getAttribute('httpRealm') == null || entries[i].getAttribute('httpRealm') == "") ? null : unescape(entries[i].getAttribute('httpRealm'))),
                                (entries[i].getAttribute('user') == null ? "" : unescape(entries[i].getAttribute('user'))),
                                (entries[i].getAttribute('password') == null ? "" : unescape(entries[i].getAttribute('password'))),
                                (entries[i].getAttribute('userFieldName') == null ? "" : unescape(entries[i].getAttribute('userFieldName'))),
                                (entries[i].getAttribute('passFieldName') == null ? "" : unescape(entries[i].getAttribute('passFieldName')))
                            );
                        } else {
                            var loginInfo = new nsLoginInfo(
                                entries[i].getAttribute('host'),
                                (entries[i].getAttribute('formSubmitURL') == null ? emptySubmitURL : entries[i].getAttribute('formSubmitURL')),
                                ((entries[i].getAttribute('httpRealm') == null || entries[i].getAttribute('httpRealm') == "") ? null : entries[i].getAttribute('httpRealm')),
                                (entries[i].getAttribute('user') == null ? "" : entries[i].getAttribute('user')),
                                (entries[i].getAttribute('password') == null ? "" : entries[i].getAttribute('password')),
                                (entries[i].getAttribute('userFieldName') == null ? "" : entries[i].getAttribute('userFieldName')),
                                (entries[i].getAttribute('passFieldName') == null ? "" : entries[i].getAttribute('passFieldName'))
                            );
                        }

                        var formattedLogins = this.getFormattedLogin(properties, loginInfo);
                        for each (var login in formattedLogins) {
                            logins.push(login);
                        }
                    }
                }
                else if (type == 'csv') {
                    if (/\r\n/i.test(entries))
                        var entryArray = entries.split("\r\n");
                    else if (/\r/i.test(entries))
                        var entryArray = entries.split("\r");
                    else
                        var entryArray = entries.split("\n");

                    // Prior to version 1.1, we only had one line of header
                    // After 1.1, there was a header comment and a labels line
                    if (properties.extension == oldEngine && (properties.importversion == '1.0.2' || properties.importversion == '1.0.4')) {
                        var start = 1;
                    } else {
                        var start = 2;
                    }

                    for (var i = start; i < (entryArray.length - 1); i++) {
                        if (properties.extension == oldEngine) {
                            if (properties.importversion == '1.0.2' || properties.importversion == '1.0.4') {
                                // Before version 1.1, csv didn't have quotes
                                var fields = entryArray[i].split(',');

                                var loginInfo = new nsLoginInfo(
                                                    (fields[0] == '' ? null : unescape(fields[0])),// hostname
                                                    "", // formSubmitURL
                                                    null, // httpRealm
                                                    unescape(fields[1]), // username
                                                    unescape(fields[2]), // password
                                                    unescape(fields[3]), // usernameField
                                                    unescape(fields[4]) // passwordField
                                                );
                            } else {
                                // Version 1.1 CSV has quotes and 2 new fields
                                var fields = entryArray[i].split('","');

                                var loginInfo = new nsLoginInfo(
                                                    (fields[0] == '"' ? null : unescape(fields[0].replace('"', ''))), // hostname
                                                    (fields[3] == '' ? null : unescape(fields[3])), // formSubmitURL
                                                    (fields[4] == '' ? null : unescape(fields[4])), // httpRealm
                                                    unescape(fields[1]), // username
                                                    unescape(fields[2]), // password
                                                    unescape(fields[5]), // usernameField
                                                    unescape(fields[6].replace('"', '')) // passwordField
                                                );
                            }
                        } else {
                                // https://stackoverflow.com/questions/8493195
                                let fields = [''], n = 0, p = '', s = true, line = entryArray[i];
                                for (let l in line) {
                                    l = line[l];
                                    if ('"' === l) {
                                        s = !s;
                                        if ('"' === p) {
                                            fields[n] += '"';
                                            l = '-';
                                        } else if ('' === p)
                                            l = '-';
                                    } else if (s && ',' === l)
                                        l = fields[++n] = '';
                                    else
                                        fields[n] += l;
                                    p = l;
                                }
                                var loginInfo = new nsLoginInfo(
                                                    (fields[0] == '' ? null : fields[0]), // hostname
                                                    (fields[3] == '' ? null : fields[3]), // formSubmitURL
                                                    (fields[4] == '' ? null : fields[4]), // httpRealm
                                                    fields[1], // username
                                                    fields[2], // password
                                                    fields[5], // usernameField
                                                    fields[6] // passwordField
                                                );
                        }

                        var formattedLogins = this.getFormattedLogin(properties, loginInfo);
                        for each (var login in formattedLogins) {
                            logins.push(login);
                        }
                    }
                }
                else if (type == 'firefox') {
                    for (let row of entries) {
                        try {
                            var decodedUsername = this.decodeLoginData(row["encryptedUsername"]);
                            var decodedPassword = this.decodeLoginData(row["encryptedPassword"]);
                            var username = this.decrypt(decodedUsername.data, decodedUsername.iv, key);
                            var password = this.decrypt(decodedPassword.data, decodedPassword.iv, key);
                            var loginInfo = new nsLoginInfo(
                                row["hostname"],
                                row["formSubmitURL"],
                                row["httpRealm"],
                                username,
                                password,
                                row["usernameField"],
                                row["passwordField"]
                            );
                            logins.push(loginInfo);
                        } catch (e) {
                            Cu.reportError(e);
                        }
                    }
                } else {
                    let crypto = new OSCrypto();
                    var utf8Converter = Cc["@mozilla.org/intl/utf8converterservice;1"].getService(Ci.nsIUTF8ConverterService);
                    for (let row of entries) {
                        try {
                            let li = {
                                username: utf8Converter.convertURISpecToUTF8(row.getResultByName("username_value"), "UTF-8"),
                                password: utf8Converter.convertURISpecToUTF8(
                                        crypto.decryptData(crypto.arrayToString(row.getResultByName("password_value")), null),
                                        "UTF-8"),
                                hostName: NetUtil.newURI(row.getResultByName("origin_url")).prePath,
                                submitURL: null,
                                httpRealm: null,
                                usernameElement: row.getResultByName("username_element"),
                                passwordElement: row.getResultByName("password_element")
                            };

                            switch (row.getResultByName("scheme")) {
                                case AUTH_TYPE.SCHEME_HTML:
                                    li.submitURL = NetUtil.newURI(row.getResultByName("action_url")).prePath;
                                    break;
                                case AUTH_TYPE.SCHEME_BASIC:
                                case AUTH_TYPE.SCHEME_DIGEST:
                                    // signon_realm format is URIrealm, so we need remove URI
                                    li.httpRealm = row.getResultByName("signon_realm")
                                                            .substring(li.hostName.length + 1);
                                    break;
                                default:
                                    throw new Error("Login data scheme type not supported: " +
                                                        row.getResultByName("scheme"));
                            }

                            var loginInfo = new nsLoginInfo(li.hostName, li.submitURL, li.httpRealm, li.username, 
                                                            li.password, li.usernameElement, li.passwordElement);
                            logins.push(loginInfo);

                        } catch (e) {
                            Cu.reportError(e);
                        }
                    }
                    crypto.finalize();
                }

                this.insertEntries(logins);

                // because of window timers, we can't put post-insert steps here
                // they are now located in passwordExporterLoginMgr.import.finished()
            }
            else
                alert(passwordExporter.getString('passwordexporter.alert-wrong-version'));
        },

        // Makes sure logins are formatted correctly for Firefox 3
        getFormattedLogin: function(properties, loginInfo) {
            // in version 1.0.2, encryption was only for passwords... in 1.0.4 we encrypt usernames as well
            if (properties.encrypt == 'true') {
                loginInfo.password = atob(loginInfo.password);

                if (properties.extension != oldEngine || properties.importversion != '1.0.2')
                    loginInfo.username = atob(loginInfo.username);
            }

            // No null usernames or passwords
            if (loginInfo.username == null)
                loginInfo.username = '';
            if (loginInfo.password == null)
                loginInfo.password = '';

            // If no httpRealm, check to see if it's in the hostname
            if (!loginInfo.httpRealm) {
                var hostnameParts = /(.*) \((.*)\)/.exec(loginInfo.hostname);
                if (hostnameParts) {
                    loginInfo.hostname = hostnameParts[1];
                    loginInfo.httpRealm = hostnameParts[2];
                }
            }

            // Convert to 2E (remove httpRealm from hostname, convert protocol logins, etc)
            loginInfo = passwordExporterStorageLegacy._upgrade_entry_to_2E(loginInfo);
            for each (var login in loginInfo) {
                if (login.httpRealm != null)
                    login.formSubmitURL = null;
            }

            return loginInfo;
        },

        // Starts the generator to insert the logins
        insertEntries: function(entries) {
            this.totalCount = entries.length;
            this.cancelled = false;
            this.failed = '';

            this.insertGenerator = this.doInsert(entries);
            window.setTimeout("passwordExporter.import.updateProgress()", 0);
        },

        // Updates the progress bar and iterates the generator
        updateProgress: function() {
            var i = this.insertGenerator.next();
            var percentage = Math.floor((this.currentCount / this.totalCount) * 100);
            document.getElementById('pwdex-import-progress').value = percentage;
            document.getElementById('pwdex-import-status').value = this.currentCount + '/' + this.totalCount;

            // If cancelled, don't add another timer
            if (this.cancelled) {
                passwordExporter.import.finished();
                return;
            }
            // Add another timer if there are more logins
            if (i < this.totalCount)
                window.setTimeout("passwordExporter.import.updateProgress()", 0);
            else if (i == this.totalCount)
                passwordExporter.import.finished();
        },

        // Insert the new login into Login Manager
        doInsert: function(entries) {
            var loginManager = CC_loginManager.getService(Ci.nsILoginManager);
            var nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1",
                                         Ci.nsILoginInfo, "init");
            var i = 0;
            while (true) {
                yield i;
                // Fix for issue 39
                if (entries[i].httpRealm) {
                    entries[i].formSubmitURL = null;
                }
                else {
                    entries[i].httpRealm = null;
                }

                var loginInfo = new nsLoginInfo(entries[i].hostname, entries[i].formSubmitURL,
                            entries[i].httpRealm, entries[i].username,
                            entries[i].password, entries[i].usernameField,
                            entries[i].passwordField);
                try {
                    // Add the login
                    loginManager.addLogin(loginInfo);

                    this.currentCount++;
                }
                catch (e) {
                    this.failed += entries[i].hostname + ' (' + e.message + ')' + passwordExporter.linebreak;
                }
                i++;
            }
        },

        // Cancel the import
        cancel: function() {
            this.cancelled = true;
        },

        // Update UI to reflect import completion or cancellation
        finished: function() {
            if (document.getElementById('tabbox')) {
                // Refresh the listbox of passwords only if we are using the tab... the dialog version does not need to
                LoadSignons();
            }
            document.getElementById('pwdex-import-cancel').hidden = true;
            document.getElementById('pwdex-import-finished').hidden = false;

            if (this.cancelled) {
                document.getElementById('pwdex-import-cancelled').hidden = false;
            }
            else {
                //alert(passwordExporter.getString('passwordexporter.alert-passwords-imported'));
                document.getElementById('pwdex-import-complete').hidden = false;
            }

            // If there were failed entries, show a details link
            if (this.failed != '')
                document.getElementById('pwdex-import-view-details').hidden = false;

            passwordExporter.enableAllButtons();
        },

        // Open the import details window
        showDetailsWindow: function() {
            window.openDialog("chrome://pwdbackuptool/content/pwdex-details-import.xul", "","chrome,resizable,centerscreen,close=no,modal");
        },

        // populate details textbox with failed entries
        populateFailed: function(textbox) {
            textbox.value = this.failed;
        },

        disabled: {
            // Starts import of disabled hosts from XML file
            start: function() {
                var fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
                var stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
                var streamIO = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(Ci.nsIScriptableInputStream);
                var input;

                fp.init(window, passwordExporter.getString('passwordexporter.filepicker-title'), fp.modeOpen);
                fp.appendFilter(passwordExporter.getString('passwordexporter.filepicker-open-xml'), '*.xml; *');

                // If canceled, return
                if (fp.show() == fp.returnCancel)
                    return;

                stream.init(fp.file, 0x01, parseInt("0444", 8), null);
                streamIO.init(stream);
                input = streamIO.read(stream.available());
                streamIO.close();
                stream.close();

                var parser = new DOMParser();
                var doc = parser.parseFromString(input, "text/xml");

                var header = doc.documentElement.getElementsByTagName('entries')[0];

                // Return if parser error or no header
                if (doc.documentElement.nodeName == 'parsererror' || !header) {
                    alert(passwordExporter.getString('passwordexporter.alert-xml-error'));
                    return;
                }

                // Return if not Password Backup Tool or Password Exporter
                if (header.getAttribute('ext') != expEngine && header.getAttribute('ext') != oldEngine) {
                    alert(passwordExporter.getString('passwordexporter.alert-cannot-import'));
                    return;
                }

                // Make sure it's a disabled hosts file
                if (header.getAttribute('type') != 'rejected') {
                    alert(passwordExporter.getString('passwordexporter.alert-wrong-file-saved'));
                    return;
                }

                var entries = doc.documentElement.getElementsByTagName('entry');
                this.import(entries);

                if (document.getElementById('tabbox')) {
                    // Refresh the listbox of rejects only if we are using the tab... the dialog version does not need to
                    LoadRejects();
                }

                alert(passwordExporter.getString('passwordexporter.alert-rejected-imported'));
            },

            // Import disabled hosts
            import: function(entries) {
                var loginManager = CC_loginManager.getService(Ci.nsILoginManager);

                for (var i = 0; i < entries.length; i++) {
                    loginManager.setLoginSavingEnabled(entries[i].getAttribute('host'), false);
                }
            }
        },

        /**
        * Get all the rows corresponding to a select query from a database, without
        * requiring a lock on the database. If fetching data fails (because someone
        * else tried to write to the DB at the same time, for example), we will
        * retry the fetch after a 100ms timeout, up to 10 times.
        *
        * @param path
        *        the file path to the database we want to open.
        * @param description
        *        a developer-readable string identifying what kind of database we're
        *        trying to open.
        * @param selectQuery
        *        the SELECT query to use to fetch the rows.
        *
        * @return a promise that resolves to an array of rows. The promise will be
        *         rejected if the read/fetch failed even after retrying.
        */
        getRowsFromDBWithoutLocks(path, description, selectQuery) {
            let dbOptions = {
                readOnly: true,
                // https://bugzilla.mozilla.org/show_bug.cgi?id=1285041 (FF51+)
                ignoreLockingMode: true,
                path,
            };

            const RETRYLIMIT = 10;
            const RETRYINTERVAL = 100;
            return Task.spawn(function* innerGetRows() {
                let rows = null;
                for (let retryCount = RETRYLIMIT; retryCount && !rows; retryCount--) {
                    // Attempt to get the rows. If this succeeds, we will bail out of the loop,
                    // close the database in a failsafe way, and pass the rows back.
                    // If fetching the rows throws, we will wait RETRYINTERVAL ms
                    // and try again. This will repeat a maximum of RETRYLIMIT times.
                    let db;
                    let didOpen = false;
                    let exceptionSeen;
                    try {
                        db = yield Sqlite.openConnection(dbOptions);
                        didOpen = true;
                        rows = yield db.execute(selectQuery);
                    } catch (ex) {
                        if (!exceptionSeen) {
                            Cu.reportError(ex);
                        }
                        exceptionSeen = ex;
                    } finally {
                        try {
                            if (didOpen) {
                                yield db.close();
                            }
                        } catch (ex) {}
                    }
                    if (exceptionSeen) {
                        yield new Promise(resolve => setTimeout(resolve, RETRYINTERVAL));
                    }
                }
                if (!rows) {
                    throw new Error("Couldn't get data from the " + description + " database.");
                }
                return rows;
            });
        },

        getKey(row) {
            var globalSalt = this.toByteString(row.getResultByName("item1"));
            var item2 = this.toByteString(row.getResultByName("item2"));
            var item2Asn1 = forge.asn1.fromDer(item2);
            var item2Salt = item2Asn1.value[0].value[1].value[0].value;
            var item2Data = item2Asn1.value[1].value;
            var a11 = this.toByteString(row.getResultByName("a11"));
            var a11Asn1 = forge.asn1.fromDer(a11);
            var a11Salt = a11Asn1.value[0].value[1].value[0].value;
            var a11Data = a11Asn1.value[1].value;
            var key, masterPasswordBytes;
            for (var i = 0; i < 2; i++) {
                if (i == 0) {
                    masterPasswordBytes = forge.util.encodeUtf8('');
                } else {
                    var password = {value: ''}, check = {value: true}; 
                    Services.prompt.promptPassword(null, 'Password Required', 'Please enter your master password:', password, null, check);
                    masterPasswordBytes = forge.util.encodeUtf8(password.value);
                }
                var item2Value = this.decryptKey(globalSalt, masterPasswordBytes, item2Salt, item2Data);
                if (item2Value && item2Value.data === 'password-check') {
                    var a11Value = this.decryptKey(globalSalt, masterPasswordBytes, a11Salt, a11Data);
                    key = forge.util.createBuffer(a11Value).getBytes(24);
                    if (key == null) {
                        throw new Error('No key found!');
                    } else {
                        break;
                    }
                } else {
                    if (i == 0) {
                        continue;
                    } else {
                        throw new Error('Master password incorrect!');
                    }
                }
            }
            return key;
        },

        decodeLoginData(b64) {
            var asn1 = forge.asn1.fromDer(forge.util.decode64(b64));
            return {
                iv: asn1.value[1].value[1].value,
                data: asn1.value[2].value
            };
        },

        decrypt(data, iv, key) {
            var decipher = forge.cipher.createDecipher('3DES-CBC', key);
            decipher.start({ iv: iv });
            decipher.update(forge.util.createBuffer(data));
            decipher.finish();
            return decipher.output;
        },

        decryptKey(globalSalt, password, entrySalt, data) {
            var hp = this.sha1(globalSalt + password);
            var pes = this.toByteString(this.pad(this.toArray(entrySalt), 20).buffer);
            var chp = this.sha1(hp + entrySalt);
            var k1 = this.hmac(pes + entrySalt, chp);
            var tk = this.hmac(pes, chp);
            var k2 = this.hmac(tk + entrySalt, chp);
            var k = k1 + k2;
            var kBuffer = forge.util.createBuffer(k);
            var otherLength = kBuffer.length() - 32;
            var key = kBuffer.getBytes(24);
            kBuffer.getBytes(otherLength);
            var iv = kBuffer.getBytes(8);
            return this.decrypt(data, iv, key);
        },

        pad(arr, length) {
            if (arr.length >= length) {
                return arr;
            }
            var padAmount = length - arr.length;
            var padArr = [];
            for (let i = 0; i < padAmount; i++) {
                padArr.push(0);
            }

            var newArr = new Uint8Array(padArr.length + arr.length);
            newArr.set(padArr, 0);
            newArr.set(arr, padArr.length);
            return newArr;
        },

        sha1(data) {
            var md = forge.md.sha1.create();
            md.update(data, 'raw');
            return md.digest().data;
        },

        hmac(data, key) {
            var hmac = forge.hmac.create();
            hmac.start('sha1', key);
            hmac.update(data, 'raw');
            return hmac.digest().data;
        },

        toByteString(buffer) {
          return String.fromCharCode.apply(null, new Uint8Array(buffer));
        },

        toArray(str) {
            const arr = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) {
                arr[i] = str.charCodeAt(i);
            }
            return arr;
        }
    }
};
