/*
    Copyright 2010 Jamie Love

    This file is part of the "R-Node Server".

    R-Node Server is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 2.1 of the License, or
    (at your option) any later version.

    R-Node Server is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with R-Node Server.  If not, see <http://www.gnu.org/licenses/>.
*/
var SYS     = require("sys");
var FS      = require("fs");
var CHILD   = require("child_process");
var URL     = require("url");
var QUERY   = require ("querystring");
var HTTP    = require("http");
var RSERVE  = require("./rserve");
var UTILS   = require("./rnodeUtils");

SYS.puts(SYS.inspect(UTILS));

var nodelog = UTILS.nodelog; // Makes code a little nicer to read.

var sharedRConnection = null;
var Config = UTILS.loadJsonFile("configuration", "etc/config.js", "etc/config-example.js");
var AUTH = require ('./authenticators/' + Config.authentication.type.replace(/[^a-zA-Z-_]/g, '')).auth;
var Authenticator = AUTH.instance();

nodelog (null, "Using authenticator: '" + AUTH.name + "'");

var httpRestrict = FS.realpathSync(process.cwd() + "/htdocs/");

nodelog (null, "Current working directory is '" + process.cwd() + "', resolving to '" + 
    FS.realpathSync (process.cwd()) + "'. HTTP server will restrict to '" + httpRestrict + "'");

var defaultReturnFormat = "raw";

mimeTypes = {
    '.png': 'image/png',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.html': 'text/html',
    '.txt': 'text/plain'
}

mimeTypesRe = /\.([^.]+)$/;
function getMimeType (url) {
    var ft = url.match (mimeTypesRe);
    return mimeTypes[ft[0]] || 'text/plain';
}

function blurb (req, resp) {
    var blurbText = "Copyright (C) 2009 The R Foundation for Statistical Computing\n" +
                    "ISBN 3-900051-07-0\n\n" +
                    "R is free software and comes with ABSOLUTELY NO WARRANTY.\n" +
                    "You are welcome to redistribute it under certain conditions.\n" +
                    "Type 'license()' or 'licence()' for distribution details.\n\n" +
                    "R is a collaborative project with many contributors.\n" +
                    "Type 'contributors()' for more information and\n" + 
                    "'citation()' on how to cite R or R packages in publications.\n\n" +
                    "This online interface to R is Copyright (C) 2010 Jamie Love\n" +
                    "\n" +
                    "Try running the command:\n" +
                    "    x <- rnorm(100); y <- rnorm(100); plot (x,y, type='o')\n\n";


    r.request("R.version.string", function (rResp) {
        var completedResponse = rResp[0] + "\n" + blurbText; 
        resp.writeHeader(200, {
          "Content-Length": completedResponse.length,
          "Content-Type": "text/plain"
        });
        resp.write (completedResponse);
        resp.end();
    });
}

/*
 * Restricted commands, we don't run.
 * This isn't really designed to stop users from doing these commands (there are easy ways
 * around them), but it ensures that users don't accidentally run commands that could mess
 * up the remote R connection we're providing.
 */
function isRestricted (cmd) {
    var r = [
        /^\s*q\s*\(/i,
        /^\s*quit\s*\(/i,
        /^\s*help\s*\(/i,
        /^\s*\?/i,
        /^\s*\.internal\s*\(/i,
        /^\s*system/i
    ];

    for (var i = 0; i < r.length; ++i) {
        if (cmd.search(r[i]) >= 0) {
            return true;
        }
    }

    return false;
}

/**
 * Specialist R function handler - server side (rather than client side...
 * This is going to need a major cleanup!
 */
var helpVarId = 0;
function handleHelpRequest (req, resp) {
    var url = URL.parse (req.url, true);

    if (url.query && url.query.search) {
        var helpVar = 'rnode_help_' + helpVarId++;
        var request = url.query.search;
        var Rcmd = helpVar + ' <- help(\'' + request.replace ('\'', '\\\'') + '\')';
        
        r.request(Rcmd, function (rResp) {
            if (rResp.values) {
                var helpfile = rResp.values[0];
                // Replace the last part of the filepath with the equivalent HTML filename
                // and then redirect the user.
                var matches = /^.*\/library\/(.*)\/help\/([^\/]+)/.exec (helpfile);

                if (!matches || matches.length != 3) {
                    SYS.puts ("Cannot find help file for '" + request + "', received: '" + helpfile + "'");
                    resp.writeHeader(404, { "Content-Type": "text/plain" });
                    resp.end();
                    return;
                }

                var htmlHelpFile = '/help/' + matches[1] + '/html/' + matches[2] + '.html';

                resp.writeHeader (301, { 
                    'Location': htmlHelpFile,
                    'Content-Type': "text/html",
                });
                resp.write (" <html> <head> <title>Moved</title> </head> <body> <h1>Moved</h1> <p>page has moved to <a href='" + htmlHelpFile + "'>" + htmlHelpFile + "</a>.</p> </body> </html>" );
                resp.end();

                // Remove our temporary variable
                r.request ('rm(\'' + helpVar + '\')', function (r) {});

            } else {
                resp.writeHeader(404, { "Content-Type": "text/plain" });
                resp.end();
            }
        });
    } else { // else we're requesting a specific file. Find the file.
        var path = Config.R.root + '/library/' + url.href.replace('/help', '');
        FS.realpath(path, function (err, resolvedPath) {
            if (err) {
                nodelog(req, 'Error getting canonical path for ' + path + ': ' + err);
                resp.writeHeader(404, { "Content-Type": "text/plain" });
                resp.end();
            } else {
                if (resolvedPath.search('^' + Config.R.root + '/library/') != 0) {
                    nodelog(req, 'Resolved path \'' + resolvedPath + '\' not within right directory.');
                    resp.writeHeader(404, { "Content-Type": "text/plain" });
                    resp.end();
                } else {
                    streamFile (resolvedPath, 'text/html', resp);
                }
            }
        });
    }
}


var usemutt = false;
CHILD.exec ('which mutt', function (ok, stdout) {
    if (stdout.length > 0) {
        usemutt = true;
        nodelog (null, "Using Mutt to send feedback");
    } else {
        nodelog (null, "No Mutt found. Printing feedback to stdout");
    }
});

function feedback (req, resp) {
    
    var data = '';
    req.addListener ("data", function (chunk) {
        data += chunk;
    });
    req.addListener ("end", function () {

        if (usemutt) {
            nodelog(req, 'Sending feedback via mutt. Size is ' + data.length);
            var mailer = process.createChildProcess('mutt', ['-s', '[R-Node feedback]', 'drjlove@gmail.com']);
            mailer.write(data, encoding="utf8");
            mailer.close();
        } else {
            nodelog (req, "FEEDBACK: " + data);
        }

        resp.writeHeader(200, { "Content-Type": "text/plain" });
        resp.end();
    });

}


var sessions = {};

function login (req, resp) {
    Authenticator.login (req, function (sid) {
        if (sid) {
            sessions[sid] = {
                active: true
            }
            resp.writeHeader(200, { "Content-Type": "text/plain" });
            resp.write(sid);
            resp.end();

            // If now, find a R session for them
            if (!sessions[sid].Rconnection) { // re-logins - we don't replace their session
                
                switch (Config.R.sessionManagement) {
                    case "single":
                        sessions[sid].Rconnection = sharedRConnection;
                        break;
                    default:
                        throw new Error ("Config.R.sessionManagement '" + Config.R.sessionManagement + "' unknown.");
                }
            }
        } else {
            resp.writeHeader(401, { "Content-Type": "text/plain" });
            resp.end();
        }
    });
}

function streamFile (resolvedPath, mimetype, resp, callback) {
    FS.stat(resolvedPath, function (err, stats) {
        if (err) {
            resp.writeHeader(404, { "Content-Type": "text/plain" });
            resp.end();
        } else {
            resp.writeHeader(200, {
              "Content-Length": stats.size,
              "Content-Type": mimetype
            });
            FS.readFile (resolvedPath, "binary", function (err, data) {
                if (err) {
                    resp.writeHeader(404, { "Content-Type": "text/plain" });
                    resp.end();
                } else {
                    resp.write (data, "binary");
                    resp.end();
                }

                if (callback)
                    callback (err);
            });
        }
    });
}

var pageFilePrefix = '';
var pageFiles = {
};
function pager (rResp) {
    for (var i = 0; i < rResp.values.length; i++) {
        var key = SHA256.hex_sha256 (rResp.values[i] + (new Date().getTime()));
        SYS.debug ('adding ' + key + ' to list for ' + rResp.values[i]);
        pageFiles[key] = { file: rResp.values[i], deleteFile: rResp.attributes['delete'] == "TRUE" };
        rResp.values[i] = key;
    }
}

function handlePage(req, resp) {
    var url = URL.parse (req.url, true);
    var parts = url.href.split(/\?/)[0].split(/\//);
    var file = parts.length == 3 ? parts[2] : null;
    if (!file || !pageFiles[file]) {
        nodelog(req, 'Error finding file for page request.');
        resp.writeHeader(404, { "Content-Type": "text/plain" });
        resp.end();
        return;
    }

    streamFile (pageFilePrefix + pageFiles[file].file, 'text/plain', resp, function (err) {
        if (err)
            nodelog (req, 'Error streaming paged file to client: ' + err);
        if (pageFiles[file].deleteFile)
            FS.unlinkSync(pageFilePrefix + pageFiles[file].file);

        pageFiles[file] = null;
    });
}

function requestMgr (req, resp) {
    if (req.url.search(/^\/__login/) == 0) {
        login (req, resp);
        return;
    }

    if (req.url.search(/^\/__authmethods/) == 0) {
        resp.writeHeader(200, { "Content-Type": "text/plain" });
        resp.write(AUTH.clientMechanism);
        resp.end();
        return;
    }

    // URLs that require the Authenticator to ok access:
    var restrictedUrls = [ "/R", "/pager", "/download", "/help" ];
    var requiredAuth = false;
    restrictedUrls.forEach (function (p) {
        if (req.url.beginsWith (p)) {
            requiredAuth = true;
        }
    });

    if (requiredAuth) {
        Authenticator.checkRequest (req, function (ok) {
            if (ok) {
                authorizedRequestMgr (req, resp);
            } else {
                resp.writeHeader(403, { "Content-Type": "text/plain" });
                resp.end();
            }
        });
    } else {
        authorizedRequestMgr (req, resp);
    }
}

function authorizedRequestMgr (req, resp) {

    if (req.url == "/") {
        req.url = "/index.html";
    }
    if (req.url == "/blurb") {
        blurb(req, resp);
        return;
    }
    if (req.url == "/feedback") {
        feedback(req, resp);
        return;
    }
    if (req.url.search(/^\/pager\//) == 0) {
        handlePage(req, resp);
        return;
    }
    if (req.url == "/recent-changes.txt") {
        CHILD.exec ('git whatchanged --format="%ar: %s" --since="2 days ago" | perl -n -e \'print $_ unless m/^:/\'', function (err, stdout, stderr) {
            if (err) {
                nodelog(req, 'Error generating recent changes file: ' + stderr);
                resp.writeHeader(500, { "Content-Type": "text/plain" });
                resp.end();
            } else {
                resp.writeHeader(200, {
                  "Content-Length": stdout.length,
                  "Content-Type": "text/plain"
                });
                resp.write (stdout);
                resp.end();
            }
        });
        return;
    }

    var url = URL.parse (req.url, true);

    if (req.url.search (/^\/download\//) == 0) {
        var parts = url.href.split(/\?/)[0].split(/\//);
        var filename = parts.length >= 3 && parts[2].length > 0 ? QUERY.unescape(parts[2]) : 'graph.svg';
        if (filename.search(/\.svg$/) < 0) {
            filename += '.svg';
        }

        var sid = url.query ? url.query.sid : null;

        resp.writeHead (200, {
            'content-type': 'image/svg+xml',
            'Cache-Control': 'no-cache, must-revalidate',
            'Content-Disposition': 'attachment; filename="' + filename + '"'
        });

        req.setBodyEncoding('utf8');
        var data = '';

        req.addListener ("data", function (chunk) {
            data += chunk;
        });
        req.addListener ("end", function () {
            nodelog(req, 'Returning SVG file for download. Size is ' + (data.length - 4));
            data = data.substring (4); // remove the 'svg=' bit.
            resp.write (decodeURIComponent(decodeURIComponent(data)), encoding = 'utf8'); // double decode! TODO fix maybe
            resp.end();
        });

        return;
    }

    if (req.url.search (/^\/help/) == 0) {
        handleHelpRequest (req, resp);
        return;
    }

    if (req.url.search (/^\/R\//) == 0) {
        var parts = url.href.split(/\?/)[0].split(/\//);
        var request = QUERY.unescape(parts[2]);

        var sid = url.query ? url.query.sid : null;

        var format = url.query.format || defaultReturnFormat;
        if (format == "pretty") {
            request = "paste(capture.output(print(" + request + ")),collapse=\"\\n\")";
        }

        if (isRestricted(request)) {
            nodelog (req, 'R command \'' + request + '\' is restricted.');
            resp.writeHeader(403);
            resp.end();
            return;
        }

        nodelog(req, 'Executing R command: \'' + request + '\'');

        r.request(request, function (rResp) {
                
            if (rResp && rResp.attributes && rResp.attributes.class && rResp.attributes.class[0] == 'RNodePager') {
                pager (rResp);
            }

            var str = JSON.stringify(rResp);

            nodelog (req, 'Result of R command: \'' + request + '\' received.');

            if (format == "pretty" && rResp.length) {
                str = rResp[0];
            }

            resp.writeHeader(200, {
              "Content-Length": str.length,
              "Content-Type": "text/plain" // Change to application/json TODO
            });
            resp.write (str);
            resp.end();
        });

        return;
    } 

    // Default handling
    var file = "htdocs" + req.url;
    nodelog(req, 'Getting file: \'' + file + '\'');
    FS.realpath(file, function (err, resolvedPath) {
        if (err) {
            nodelog(req, 'error getting canonical path for ' + resolvedPath);
            resp.writeHeader(404, { "Content-Type": "text/plain" });
            resp.end();
        } else {
            if (!resolvedPath.beginsWith (httpRestrict)) {
                nodelog(req, 'resolved path \'' + resolvedPath + '\' not within right directory.');
                resp.writeHeader(404, { "Content-Type": "text/plain" });
                resp.end();
            } else {
                streamFile (resolvedPath, getMimeType (req.url), resp);
            }
        }
    });
}

function setupRSession (connection, callback) {
    var rnodeSetupCommands = [
        "rNodePager = function (files, header, title, f) { r <- files; attr(r, 'class') <- 'RNodePager'; attr(r, 'header') <- header; attr(r, 'title') <- title; attr(r, 'delete') <- f; r; }",
        "options(pager=rNodePager)"
    ]

    var runs = function (i) {
        if (i < rnodeSetupCommands.length) {
            nodelog (null, "Running R setup command '" + rnodeSetupCommands[i] + "'");
            r.request (rnodeSetupCommands[i], function (resp) { 
                SYS.debug ('Setup command response: ' + JSON.stringify (resp));
                runs (++i);
            });
        } else {
            callback (true);
        }
    }

    runs (0);
}

// Try a test R connection. If this fails, then we fail.
// if it succeeds, we can go ahead and start up our HTTP server.
// If we're using the R sessionManagement of "single", we keep
// the connection open as our sharedRConnection.
function testRConnection (callback) {
    r = new RSERVE.RservConnection();
    r.connect(function (requireLogin) {
        if (requireLogin) {
            nodelog (null, "RServe requires login. Using information from config.");
            if (Config.R.username && Config.R.password) {
                r.login (Config.R.username, Config.R.password, function (ok) {
                    nodelog (null, "Logged into R via RServe: " + ok);

                    if (Config.R.sessionManagement == "single") {
                        sharedRConnection = r;
                        setupRSession (r, callback);
                    } else {
                        callback (true);
                    }
                });
            } else {
                throw new Error ("RServe requires login, but no credentials given by config.");
            }
        }
    });
}

var requiredSetupSteps = {
    "auth": false,
    "testR": false
}

function conditionallyGoLive () {
    for (var s in requiredSetupSteps) {
        if (requiredSetupSteps[s] == false) {
            return;
        }
    }

    var ui = HTTP.createServer(requestMgr);
    ui.addListener ('listening', function () {
        nodelog (null, 'R-Node Listening on port: \'' + Config.listen.port + '\', interface: \'' + (Config.listen.interface ? Config.listen.interface : 'all') + '\'');
    });
    ui.listen (Config.listen.port, Config.listen.interface);
}

Authenticator.init (Config.authentication, function (ok) {
    "Setup authentication: " + (ok ? "ok" : "NOT ok");
    requiredSetupSteps["auth"] = ok;
    conditionallyGoLive();
});

testRConnection (function (ok) {
    "Tested R connection: " + (ok ? "ok" : "NOT ok");
    requiredSetupSteps["testR"] = ok;
    conditionallyGoLive();
});
