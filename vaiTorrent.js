'use-strict';
var fs = require("fs");
var bencode = require("bencode");
var settings = require("./settings.json");
var httpTracker = require("./httpTracker");
var peer = require("./peer");
var queue = require("./queue");
var torrentFile; //= fs.readFileSync('1.torrent');
var parseTorrent = require("parse-torrent");
var pt = null; // = parseTorrent(torrentFile);
var torrent; // = bencode.decode(torrentFile);
var logStore = [];
var peerState = [];
var requested = [];
var avaiablePieces = [];
var pieces = [];
var isChoking = []; //peers choking me
var beingChoked = []; //peers I am choking 
var remaining; // = pt.pieces.length; //number of pieces remaining 
var downloadedFilePath = null;

var args = process.argv.slice(2);
var torrentFileName = args[0];

if (typeof(torrentFileName) !== "undefined") {
    torrentFile = fs.readFileSync(torrentFileName);
    torrent = bencode.decode(torrentFile);
    pt = parseTorrent(torrentFile);
    remaining = pt.pieces.length

    var peerStateManager = {

        log: function(peerString, messageToBeLogged) {
            peerState[peerString].messages.push(messageToBeLogged);
        },
        updateStatus: function(peerString, status) {
            peerState[peerString].status = status;
        },
        isRequested: function(pieceNumber) {
            return requested[pieceNumber] || false;
        },
        markRequested: function(pieceNumber) {
            requested[pieceNumber] = true;
        },
        markNotRequested: function(pieceNumber) {
            requested[pieceNumber] = false;
        },
        getPeerQueue: function(peerString) {
            return peerState[peerString].pieceQueue;
        },
        setPeerQueue: function(peerString, peerQueue) {
            peerState[peerString].pieceQueue = peerQueue;
        },
        savePiece: function(pieceNumber, piece) {
            //pieces[pieceNumber] = piece;
            savePieceToFile(pieceNumber,piece);
            remaining--;
            // if (remaining == 0) {
            //     //download complete, save file. 
            //     //[TODO] save multiple file torrent
            //     // pt.files.forEach(function(file) {
            //     //     var filename = file.name;
            //     //     for (var k = 0; k < filename.length; k++)
            //     //         filename = filename.replace(" ", "_");
            //     //     downloadedFilePath = settings.downloadDir + filename;
            //     // });
            //     var filename = pt.files[0].name;
            //     for (var k = 0; k < filename.length; k++)
            //         filename = filename.replace(" ", "_");
            //     downloadedFilePath = settings.downloadDir + filename;
            //     // var buf = Buffer.from(pieces);
            //     // logStore.push("Expected file length:"+pt.files[0].length);
            //     // logStore.push("Actual file length:"+buf.length);
            //     pieces.forEach(function(p) {
            //         fs.appendFileSync(downloadedFilePath, p, 'binary');
            //     });

            //     // var writeStream = fs.createWriteStream(downloadedFilePath, {
            //     //     flags: 'w',
            //     //     defaultEncoding: 'utf8',
            //     //     fd: null,
            //     //     mode: 0o666,
            //     //     autoClose: true
            //     // });
            //     // piece.forEach(function(p) {
            //     //     writeStream.write(p.toString());
            //     // });
            //     // fs.writeFile(downloadedFilePath, pieces, function(err) {
            //     //     if (err) {
            //     //         logStore.push(err);
            //     //         return console.log(err);
            //     //     }
            //     // });
            // }
        },
        isChokingMe: function(peerString) {
            return isChoking.indexOf(peerString) > -1 ? true : false;
        },
        markUnchoked: function(peerString) {
            var index = isChoking.indexOf(peerString);
            if (index > -1)
                isChoking.splice(index, 1);
        },
        markedChoked: function(peerString) {
            var index = isChoking.indexOf(peerString);
            if (index === -1) {
                isChoking.push(peerString);
            }
        },
        enqueue: function(peerString, value) {
            peerState[peerString].pieceQueue.enqueue(value);
        },
        dequeue: function(peerString) {
            return peerState[peerString].pieceQueue.dequeue();
        },
        isEmpty: function(peerString) {
            return peerState[peerString].pieceQueue.isEmpty();
        }
    };
    
    httpTracker.getPeerList(torrent, function(peerList) {
        if (!peerList || !peerList.length) {
            console.push("No active peers found, exiting.");
            process.exit(0);
        }
        peerList.forEach(function(p) {
            var peerString = p.ip + ":" + p.port;
            //logStore.push(JSON.stringify(pt));
            isChoking.push(peerString);
            peerState[peerString] = {
                peerString: peerString,
                pieceQueue: new queue.Queue(),
                status: "disconnected",
                messages: []
            };
            peer.download(p.ip, p.port, torrent, peerStateManager);
        });
    });
    setInterval(function() {
        console.log('\x1Bc');
        printPeerState();
    }, 3000);
}
else {
    console.log("Please provide torrent file path");
    console.log("Usage:" + "\n" + "node vaiTorrent.js <torrentFilePath>");
    process.exit(0);
}


function printPeerState() {
    Object.keys(peerState).forEach(function(key, index) {
        console.log(key, "Messages: " + peerState[key].messages);
    });
    // percentage done = ((total-remaining)/total)*100
    console.log(Math.ceil(((pt.pieces.length - remaining) / pt.pieces.length) * 100) + "% done");
    console.log("Done:" + (pt.pieces.length - remaining));
    console.log("Remianing:" + remaining);
    logStore.forEach(function(log) {
        console.log(log);
    });
    if (remaining == 0) {
        console.log("Download Complete!")
        console.log("File will be saved at : " + settings.downloadDir);
        process.exit(0);
    }


}

function escapeFileName(filename) {
    for (var k = 0; k < filename.length; k++)
        filename = filename.replace(" ", "_");
    return filename;    
}

function savePieceToFile(pieceNumber, piece) {
    //calculate byte offset of this piece
    var byteOffset = pieceNumber * pt.pieceLength;

    //use this to find which file this piece belongs to
    var fileIndex = 0;
    for (var fi = 0; fi < pt.files.length; fi++) {
        if (byteOffset >= pt.files[fi].offset && byteOffset < (pt.files[fi].offset + pt.files[fi].length)) {
            var fileByteOffset = byteOffset - pt.files[fi].offset;
            //write to file
            var filePath = settings.downloadDir + escapeFileName(pt.files[fi].name);
            fs.open(filePath,'r+',function(err,fd){
                if(err){
                    var fileDesc = fs.openSync(filePath, 'w');
                    fs.writeSync(fileDesc,piece,0,piece.length,fileByteOffset);
                }
                else{
                    fs.writeSync(fd,piece,0,piece.length,fileByteOffset);
                }
                
            });
            
        }
    }

}
