'use-strict'
var fs = require("fs");
var parseTorrent = require("parse-torrent");
var request = require("request");
var bencode = require("bencode");
var peer = require("./peer");
var j = 0;

function getPeerList(torrent, callback) {
    //logDiagnosticInfo(torrent);
    //formulate and send announce request
    var pt = parseTorrent(bencode.encode(torrent));
    //console.log(pt.announce);
    
    //do request if tracker list not exhausted 
    if (j < pt.announce.length) {
        request({
            url: pt.announce[j] + getAnnounceQueryString(torrent),
            method: 'GET',
            encoding: null
        }, function(error, response, body) {
            if (error) {
                console.log("Error requesting from tracker:"+pt.announce[j]);
                console.log("Trying next tracker")
                //try next tracker
                j++;
                getPeerList(torrent, callback);
            }
            else {
                console.log("Tracker response:"+body);
                var decodedBody = bencode.decode(body);
                if (decodedBody['failure reason']) {
                    console.log(response.statusCode, "error: " + bencode.encode(decodedBody['failure reason']));
                }
                else if (!decodedBody.peers) {
                    console.log(response.statusCode, "error: Did not receive peer list from Tracker, response: " + body);
                }
                else {
                    var peerList = [];
                    var type = decodedBody.peers instanceof Array ? "Array" : "Object";
                    if (type == "Object") {
                        console.log("Compact Notation");
                        for (var i = 0; i < decodedBody.peers.length; i += 6) {
                            var peer = {
                                ip: num2dot(decodedBody.peers.readUInt32BE(i)),
                                port: decodedBody.peers.readUIntBE(i + 4, 2).toString()
                            };
                            peerList.push(peer);
                        }
                    }
                    else {
                        console.log("Normal Notation");
                        peerList = decodedBody.peers.map(function(peer) {
                            return {
                                ip: peer.ip.toString("utf8"),
                                port: peer.port
                            };
                        })
                    }
                    callback(peerList);
                }
            }
        });
    }
    else {
        //tracker list exhausted,no peers to return
        console.log("Tracker list exhausted");
        callback([]);
    }
};

function logDiagnosticInfo(torrent) {
    var torr = bencode.encode(torrent);
    var parsedTorr = parseTorrent(torr);
    fs.writeFileSync('f.json', JSON.stringify(parsedTorr));
    console.log(escapeInfoHash(parsedTorr.infoHash));
};

function getAnnounceQueryStringJson(torrent) {
    var announceRequest;
    var pTorrent = parseTorrent(bencode.encode(torrent));
    announceRequest = {
        info_hash: escapeInfoHash(pTorrent.infoHash),
        port: 6887,
        peer_id: '-VT0001-000000000000',
        uploaded: 0,
        downloaded: 0,
        left: pTorrent.length,
        event: 'started'
    }
    return announceRequest;
};

function getAnnounceQueryString(torrent) {

    var pTorrent = parseTorrent(bencode.encode(torrent));
    var announceRequest = "?info_hash=" + escapeInfoHash(pTorrent.infoHash) +
        "&peer_id=-VT0001-000000000000&port=6687&uploaded=0&downloaded=0&left=" +
        pTorrent.length + "&event=started";
    return announceRequest;
}

function escapeInfoHash(infoHash) {
    var h = infoHash;
    h = h.replace(/.{2}/g, function(m) {
        var v = parseInt(m, 16);
        if (v <= 127) {
            m = encodeURIComponent(String.fromCharCode(v));
            if (m[0] === '%')
                m = m.toLowerCase();
        }
        else
            m = '%' + m;
        return m;
    });
    return h;
};

function dot2num(dot) {
    var d = dot.split('.');
    return ((((((+d[0]) * 256) + (+d[1])) * 256) + (+d[2])) * 256) + (+d[3]);
};

function num2dot(num) {
    var d = num % 256;
    for (var i = 3; i > 0; i--) {
        num = Math.floor(num / 256);
        d = num % 256 + '.' + d;
    }
    return d;
};

module.exports.getPeerList = getPeerList;
