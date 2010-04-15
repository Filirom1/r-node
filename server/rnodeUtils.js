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

/**
 * GENERAL UTILITIES
 */
var SYS = require ('sys');
var FS  = require ('fs');

/**
 * String 'beginsWith' method - 'cause it makes sense to have awesome
 * string functions.
 */
String.prototype.beginsWith = function (s) {
    if (s == null)
        return false;

    var x = this.substring (0, s.length);
    return x == s;
}

function nodelog (req, str) {
    SYS.log ( (req ? req.connection.remoteAddress : '(local)') + ': ' + str);
}

/**
 * Load a JSON file with comments, returning the result.
 */ 
function loadJsonFile (type, path, secondOption) {
    var data;
    try {
        data = FS.readFileSync (path);
        nodelog (null, 'Loaded ' + type + ' from \'' + path + '\'');
    } catch (e) {
        if (secondOption) {
            nodelog (null, 'Cannot load ' + type + ' from \'' + path + '\'. Trying second option \'' + secondOption + '\'');
            try {
                data = FS.readFileSync (secondOption);
                nodelog (null, 'Loaded ' + type + ' from \'' + secondOption + '\'');
            } catch (e) {
                nodelog (null, 'Cannot load ' + type + ' from \'' + secondOption + '\'. Aborting.');
                throw e;
            }
        } else {
            nodelog (null, 'Cannot load ' + type + ' from \'' + path + '\'. Continuing without this file.');
            return null;
        }
    }
    data = data.replace (/\/\/[^\n]*\n/g, '');
    return JSON.parse(data);
}

exports.loadJsonFile = loadJsonFile;
exports.nodelog = nodelog;
