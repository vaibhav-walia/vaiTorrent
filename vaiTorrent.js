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
var lengthOfBoundryPieceWrittenToFile = [];

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
            savePieceToFile(pieceNumber, piece);
            remaining--;
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
    for (var x = 0; x < pt.files.length; x++) {
        lengthOfBoundryPieceWrittenToFile[x] = 0;
    }
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
    var thisPieceLength = (pieceNumber == pt.pieces.length - 1) ? pt.lastPieceLength : pt.pieceLength;
    var byteOffset = pieceNumber * pt.pieceLength;

    //use this to find which file this piece belongs to
    for (var fi = 0; fi < pt.files.length; fi++) {
        var fileLength = pt.files[fi].length;
        var fileBegin = pt.files[fi].offset;
        var fileEnd = fileBegin + fileLength;
        if (byteOffset >= fileBegin && byteOffset < fileEnd) {
            //belongs to this file[maybe partially]
            //check if the entire piece can be saved to this file
            if (byteOffset + thisPieceLength <= fileEnd) {
                //entire piece can be saved to this file
                var fileByteOffset = byteOffset - fileBegin + lengthOfBoundryPieceWrittenToFile[fi];
                var filePath = settings.downloadDir + escapeFileName(pt.files[fi].name);
                //write to file
                writeToFileAtOffset(piece, filePath, fileByteOffset);
            }
            else{
                //boundary piece, partition and save to both this and next file
                //logStore.push("Boundry case occured");
                var thisFileBufferSize = fileEnd-byteOffset;
                var nextFileBufferSize = byteOffset+thisPieceLength-fileEnd;
                var thisFileBuffer  = Buffer.alloc(thisFileBufferSize);
                var nextFileBuffer = Buffer.alloc(nextFileBufferSize);
                var thisFileEnd = thisFileBufferSize-1;
                
                piece.copy(thisFileBuffer,0,0,thisFileEnd);
                piece.copy(nextFileBuffer,0,thisFileEnd+1,piece.length);
                
                var thisFilePath = settings.downloadDir + escapeFileName(pt.files[fi].name);
                // [fi+1] should never overflow as this case would never occur for the last file
                var nextFilePath = settings.downloadDir + escapeFileName(pt.files[fi+1].name); 
                writeToFileAtOffset(thisFileBuffer,thisFilePath,byteOffset - fileBegin);
                writeToFileAtOffset(nextFileBuffer,nextFilePath,0);
                
                lengthOfBoundryPieceWrittenToFile[fi+1] = nextFileBufferSize;
            }
        }
    }
}

function writeToFileAtOffset(piece, filePath, offset) {
    try {
        var fd = fs.openSync(filePath, 'r+');
        fs.writeSync(fd, piece, 0, piece.length, offset);
    }
    catch (err) {
        var fileDesc = fs.openSync(filePath, 'w');
        fs.writeSync(fileDesc, piece, 0, piece.length, offset);
    }
}
