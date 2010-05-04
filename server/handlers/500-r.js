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
var QUERY   = require ("querystring");
var URL     = require("url");
var UTILS   = require("../rnodeUtils");
var FS      = require("fs");
var SHA256  = require("../sha256");

exports.name = "/R";

var defaultReturnFormat = "raw";

var ourTempDirectory;
var rTempDirectory;

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

var pageFilePrefix = '';
var pageFiles = {
};
function pager (rResp) {
    for (var i = 0; i < rResp.values.length; i++) {
        var key = SHA256.hex_sha256 (rResp.values[i] + (new Date().getTime()));
        pageFiles[key] = { 
            file: rResp.values[i], 
            mimeType: 'text/plain',
            deleteFile: rResp.attributes['delete'] == "TRUE" 
        };
        rResp.values[i] = key;
    }
}

function handlePage(req, resp, sid, rNodeApi) {
    var url = URL.parse (req.url, true);
    var parts = url.href.split(/\?/)[0].split(/\//);
    var file = parts.length == 3 ? parts[2] : null;
    if (!file || !pageFiles[file]) {
        rNodeApi.log(req, 'Error finding file for page request.');
        resp.writeHeader(404, { "Content-Type": "text/plain" });
        resp.end();
        return;
    }

    var d = pageFiles[file];
    SYS.debug('Streaming file "' + file + '" which is "' + d.file + '"');

    UTILS.streamFile (pageFilePrefix + d.file, d.mimeType, resp, function (err) {
        if (err)
            rNodeApi.log (req, 'Error streaming paged file to client: ' + err);
        if (d.deleteFile)
            FS.unlinkSync(pageFilePrefix + d.file);

        pageFiles[file] = null;
    });
}

function handleGraphicalCommand (r, parsedRequest, httpRequest, resp, sid, rNodeApi) {

    var context = rNodeApi.getSidContext(sid);
    if (!context.graphing) {
        context.graphing = {};
    }
    
    var type = context.preferences.graphOutputType || 'png';

    if (!context.graphing.file) // set up a file we write to.
        context.graphing.file = rNodeApi.getRaccessibleTempFile('.' + type);

    // Assume our current graphical device is our main one we've
    // been tracking all graphing commands on.
    
    var req = parsedRequest + ';\n' +
              '' + type + '("' + context.graphing.file.r + '");\n' +
              'dev.set(dev.prev());\n' + 
              'dev.copy(which=dev.next());\n' +
              'dev.off();\n' +
              'print("ok");\n';

    r.request (req,
        function (rResp) {
            if (rResp.length && rResp[0] == "ok") {
                var key = SHA256.hex_sha256 (context.graphing.file.ours);
                pageFiles[key] = { 
                    file: context.graphing.file.ours,
                    mimeType: 'image/' + type,
                    deleteFile: false
                };
                resp.writeHeader(200, { "Content-Type": "text/plain" });
                resp.write (JSON.stringify ({
                    values: [key],
                    attributes: {
                        class:["RNodePager"],
                        "title":["Plot"]
                    }
                }));
                resp.end();
            } else {
                var str = JSON.stringify(rResp);
                resp.writeHeader(200, {
                  "Content-Length": str.length,
                  "Content-Type": "text/plain"
                });
                resp.write (str);
                resp.end();
            }
    });

}

function isGraphical(parsedRequest) {
    var commands = [ 'boxplot', 'title', 'plot', 'pairs', 'coplot', 'qqnorm', 'qqline', 
        'qqplot', 'dotchart', 'image', 'contour', 'persp', 'points', 'lines', 
        'text', 'abline', 'polygon', 'legend', 'title', 'axis', 'locator', 'identify' ];
    for (var i=0; i < commands.length; ++i) {
        if (parsedRequest.beginsWith(commands[i])) 
            return true;
    }
    return false;
}

function handleR (req, resp, sid, rNodeApi) {
    var url = URL.parse (req.url, true);
    var parts = url.href.split(/\?/)[0].split(/\//);
    var request = QUERY.unescape(parts[2]);

    if (isRestricted(request)) {
        rNodeApi.log (req, 'R command \'' + request + '\' is restricted.');
        resp.writeHeader(403);
        resp.end();
        return;
    }

    rNodeApi.log(req, 'Executing R command: \'' + request + '\'');

    // Find session
    var r = rNodeApi.getRConnection(sid, false);

    // If we don't have a sessions, we've got a problem! we shouldn't be here.
    if (!r) {
        resp.writeHeader(500, { "Content-Type": "text/plain" });
        resp.end();
        return;
    }

    if (isGraphical(request)) {
        rNodeApi.log (req, 'R command \'' + request + '\' is graphical. Wrapping in graphics mechanism.');
        return handleGraphicalCommand (r, request, req, resp, sid, rNodeApi);
    }

    var format = url.query.format || defaultReturnFormat;
    if (format == "pretty") {
        request = "paste(capture.output(print(" + request + ")),collapse=\"\\n\")";
    }

    r.request(request, function (rResp) {
            
        if (rResp && rResp.attributes && rResp.attributes.class && rResp.attributes.class[0] == 'RNodePager') {
            pager (rResp);
        }

        var str = JSON.stringify(rResp);

        rNodeApi.log (req, 'Result of R command: \'' + request + '\' received.');

        resp.writeHeader(200, {
          "Content-Length": str.length,
          "Content-Type": "text/plain" // Change to application/json TODO
        });
        resp.write (str);
        resp.end();
    });
    return true;
}

exports.init = function (rNodeApi) {
    rNodeApi.addRestrictedUrl(/^\/R\//);
    rNodeApi.addRestrictedUrl(/^\/pager\//);

    ourTempDirectory = rNodeApi.config.R.tempDirectoryFromOurPerspective;
    rTempDirectory = rNodeApi.config.R.tempDirectoryFromRperspective;
}

exports.handle = function (req, resp, sid, rNodeApi) {
    if (req.url.beginsWith ('/R/')) {
        handleR (req, resp, sid, rNodeApi);
        return true;
    } else if (req.url.beginsWith ('/pager/')) {
        handlePage (req, resp, sid, rNodeApi);
        return true;
    }
    return false;
}

exports.canHandle = function (req, rNodeApi) {
    return req.url.beginsWith ('/R/') || req.url.beginsWith('/pager/');
}
