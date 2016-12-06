'use-strict';
var net = require("net");
var messageFactory = require("./messageFactory");
var bencode = require("bencode");
var keepAliveInterval = null;
var Buffer = require("buffer").Buffer;
var oEnvironment = require("./environment.js");
var parseTorrent = require("parse-torrent");
var pieceCache = [];
var blockCount = [];
var pt = null;

module.exports.download = function(ip, port, torrent, peerStateManager) {
    /*
    Basic Flow:
    1.open a connection
    2.send handshake to peer
    3.look for handshake response
    4.send interested on handshake response
    5.look for unchoke
    */
    pt = parseTorrent(bencode.encode(torrent));
    var peerString = ip + ":" + port;
    console.log("Trying to open TCP connection to peer " + peerString);
    var socket = net.createConnection(port, ip);
    socket.on("connect", function() {
        peerStateManager.log(peerString, "Connected");
        peerStateManager.updateStatus(peerString, "Connected");

        //send keep-alive every 100 sec
        keepAliveInterval = setInterval(function() {
            peerStateManager.log(peerString, "Sent Keep-Alive");
            socket.write(messageFactory.keepAlive().rawBuffer);
        }, 100000);

        socket.write(messageFactory.handshake(torrent).rawBuffer);
        peerStateManager.log(peerString, "handshake sent ");

        //receiveCompleteMessage(socket, function(message) {
        onWholeMsg(socket, function(message) {
            //peerStateManager.log(peerString,"Received the following message from peer " + peerString + " -> " + message.toString());

            var parsedMessage = messageFactory.parse(message);
            //check the type of incoming message and respond with the suitable meesage
            switch (parsedMessage.messageID) {
                case -2:
                    peerStateManager.log(peerString, "Keep-Alive received ");
                    break;
                case -1:
                    //handshake
                    peerStateManager.log(peerString, "handshake complete ");
                    socket.write(messageFactory.interested().rawBuffer);
                    peerStateManager.log(peerString, "Sent interested ");
                    break;
                case 0:
                    //choke
                    //console.log("Incoming message: Choke received form peer " + peerString);
                    peerStateManager.log(peerString, "Choke received ");
                    chokeHandler(peerStateManager, peerString);
                    break;
                case 1:
                    //console.log("Incoming message: Un-Choke received form peer " + peerString);
                    peerStateManager.log(peerString, "Un-Choke received ");
                    unchokeHandler(socket, peerStateManager, peerString);
                    break;
                case 2:
                    //console.log("Incoming message: Interested received form peer " + peerString);
                    peerStateManager.log(peerString, "Interested received ");
                    break;
                case 3:
                    //console.log("Incoming message: Not-interested received form peer " + peerString);
                    peerStateManager.log(peerString, "Not-interested received ");
                    break;
                case 4:
                    //console.log("Incoming message: Have received form peer " + peerString);
                    //peerStateManager.log(peerString, "Have received ");
                    haveHandler(socket, message, peerStateManager, peerString);
                    break;
                case 5:
                    //console.log(" Bitfield received ");
                    peerStateManager.log(peerString, "Bitfield received ");
                    bitfieldHandler(socket, message, peerStateManager, peerString);
                    break;
                case 6:
                    //console.log(" Request received ");
                    peerStateManager.log(peerString, "Request received ");
                    break;
                case 7:
                    //console.log("Incoming message: Peice received form peer " + peerString);
                    //peerStateManager.log(peerString, "Peice received ");
                    pieceHandler(socket, message, peerStateManager, peerString, torrent);
                    // try to request next piece in queue
                    break;
                case 8:
                    //console.log("Incoming message: cancel received form peer " + peerString);
                    peerStateManager.log(peerString, "Cancel received ");
                    break;
                case 9:
                    //console.log("Incoming message: port received form peer " + peerString);
                    peerStateManager.log(peerString, "Port received ");
                    break;

                default:
                    //console.log("Message type " + parsedMessage.messageID + " does not match any messages");
                    peerStateManager.log(peerString, "Message type " + parsedMessage.messageID + " does not match any messages");
            }
        });
        /*var mBuffer = Buffer.alloc(0);

        socket.on("data", function(data) {
                mBuffer = Buffer.concat([mBuffer, data]);
                console.log("Handshake : Received a chunk of response from " + peerString);
            })
            .on("end", function() {
                console.log("Handshake : Received final response from : " + peerString + ", Final buffer:" + mBuffer.toString());

            })
            .on("close", function() {
                console.log("Handshake : Connection to " + peerString + " closed ");
            }); */
    }).on("close", function() {
        clearInterval(keepAliveInterval);
        peerStateManager.log(peerString, "Closed");
        peerStateManager.updateStatus(peerString, "Disconnected");
        console.log("Connection to peer " + peerString + " closed");
    }).on("error", function(err) {
        peerStateManager.log(peerString, err);
        peerStateManager.updateStatus(peerString, "Disconnected");
        console.log("error occoured in connection to " + peerString);
    });
};

function receiveCompleteMessage(socket, done) {
    /*
    Handshake message is of the following format:
    <pstrlen><pstr><reserved><info_hash><peer_id>
    and is 49+len(pstr) bytes long
    
    All the message except handshake have the following formant:
    <length prefix><message ID><payload>
    
    so when expecting for the handshake response we should call done
    only after receiving 49+len(pstr) bytes
    
    For other messages done should be called after receiving <length prefix>
    number of bytes
    */

    //handshake is the first message received
    var handshake = true;
    var mBuffer = getBuffer();
    var firstDataEvent = true;
    var expectedMessageLength;
    socket.on("data", function(data) {
        /*
        the problem here is that 
        */

        if (firstDataEvent) {
            if (handshake) {
                expectedMessageLength = data.readUInt8(0) + 49;
                handshake = false;
            }
            else {
                expectedMessageLength = data.readInt32BE(0) + 4;
            }
            firstDataEvent = false;
        }
        mBuffer = Buffer.concat([mBuffer, data]);
        if (mBuffer.length >= expectedMessageLength) {
            // received the entire message, call done
            // splice is required as the last data buffer received might be partially filled 
            done(mBuffer.slice(0, expectedMessageLength));
            //subsequent data events will be for another message
            firstDataEvent = true;
            mBuffer = getBuffer();
        }
    });
};

function onWholeMsg(socket, callback) {
    var savedBuf = Buffer.alloc(0);
    var handshake = true;

    socket.on('data', recvBuf => {
        // msgLen calculates the length of a whole message
        const msgLen = () => handshake ? savedBuf.readUInt8(0) + 49 : savedBuf.readInt32BE(0) + 4;
        savedBuf = Buffer.concat([savedBuf, recvBuf]);

        while (savedBuf.length >= 4 && savedBuf.length >= msgLen()) {
            callback(savedBuf.slice(0, msgLen()));
            savedBuf = savedBuf.slice(msgLen());
            handshake = false;
        }
    });
};

function getMessageType(message) {
    var msgActualLength = message.length;
    var msgExpectedLength = message.readUInt8(0, 1) + 49;
    var pstr = message.toString('utf8', 1, message.readUInt8(0, 1) + 1);
    var mType = -1;

    if (msgActualLength > 0 && msgActualLength === msgExpectedLength && pstr && pstr === 'BitTorrent protocol') {
        mType = 1;
    }
    return mType;
};

function getBuffer() {
    return Buffer.alloc(0);
}

function haveHandler(socket, rawMessage, peerStateManager, peerString) {
    //enqueue the piece
    var pieceNumber = rawMessage.readUInt32BE(5);
    peerStateManager.log(peerString, "Have(" + pieceNumber + ")");

    var wasQueueEmpty = peerStateManager.isEmpty(peerString);
    peerStateManager.enqueue(peerString, pieceNumber);
    /*
    Request only if all of the following conditions are met:
    1:Not being choked by the peer
    2:Peer queue was empty
    3:Peice not already requested
    */
    if (!peerStateManager.isChokingMe(peerString) && wasQueueEmpty && (peerStateManager.isRequested(pieceNumber) === false)) {
        // var req = ( pieceNumber == pt.pieces.length - 1 ) ? messageFactory.request(pieceNumber,pt.lastPieceLength).rawBuffer: messageFactory.request(pieceNumber).rawBuffer;
        // //var req = messageFactory.request(pieceNumber).rawBuffer;
        // socket.write(req);
        sendRequest(pieceNumber, socket);
        //console.log("Outgoing message : Sent request for a piece to peer " + peerString);
        peerStateManager.log(peerString, "Sent request for " + pieceNumber + " ");
        //requested[pieceNumber] = true;
        peerStateManager.markRequested(pieceNumber);
    }
    //peerStateManager.setPeerQueue(peerString, peerQueue);
}

function pieceHandler(socket, rawMessage, peerStateManager, peerString, torrent) {
    /*
    validate hash
    save if valid discard otherwise
    request next piece in queue
    [TODO] Special handling for last piece [done]
    */

    var pieceLength = rawMessage.readInt32BE(0) - 9;

    //peerStateManager.log(peerString, "Received block of length : " + pieceLength);

    var pieceNumber = rawMessage.readUInt32BE(5);
    var blockOffset = rawMessage.readUInt32BE(9);

    //length of last piece is diffrent
    //var pieceSize = (pieceNumber == pt.pieces.length -1)?pt.lastPieceLength:16384;
    // var pieceBuffer = Buffer.alloc(pieceSize);
    // rawMessage.copy(pieceBuffer, 0, 13, pieceSize+13);
    //var pieceBuffer = Buffer.alloc(pieceLength);
    rawMessage.copy(pieceCache[pieceNumber], blockOffset, 13, pieceLength + 13);

    var noOfBlocks = (pieceNumber == pt.pieces.length - 1) ? Math.ceil(pt.lastPieceLength / 16384) : Math.ceil(pt.pieceLength / 16384);
    if (++blockCount[pieceNumber] == noOfBlocks) {
        //all blocks received, save piece
        var incomingPieceHash = oEnvironment.getHash(pieceCache[pieceNumber]);
        var expectedHash = pt.pieces[pieceNumber];
         peerStateManager.log(peerString,"Received all blocks for piece "+pieceNumber);
        if (incomingPieceHash == expectedHash) {
            //valid piece, save
            peerStateManager.log(peerString, "valid piece");
            peerStateManager.savePiece(pieceNumber, pieceCache[pieceNumber]);
            pieceCache[pieceNumber] = null;
        }
        else {
            peerStateManager.log(peerString, "In-valid piece, discarded");
            //mark piece as not requested so that it can be downloaded from other peers
            peerStateManager.markNotRequested(pieceNumber);
            //peerStateManager.log(peerString,"expected "+expectedHash);
            //peerStateManager.log(peerString,"incoming "+incomingPieceHash);
        }
        //request next piece
        var nextPiece = nextRequestablePiece(peerStateManager, peerString);
        if (typeof(nextPiece) != "undefined") {
            //piece not requested yet from any peer
            // build and send request
            // var req = ( nextPiece == pt.pieces.length - 1 ) ? messageFactory.request(nextPiece,pt.lastPieceLength).rawBuffer: messageFactory.request(nextPiece).rawBuffer;
            // //var req = messageFactory.request(nextPiece).rawBuffer;
            // socket.write(req);
            sendRequest(nextPiece, socket);
            peerStateManager.log(peerString, "Sent request for " + nextPiece + " ");
            peerStateManager.markRequested(nextPiece);
        }
        else {
            peerStateManager.log(peerString, "No more pieces to request");
        }
    }
    //var pieceString = pieceBuffer.toString();
    //var incomingPieceHash = oEnvironment.getHash(pieceString);


}


function nextRequestablePiece(peerStateManager, peerString) {
    //find a piece which has not been requested
    var retval;
    var nextPiece = peerStateManager.dequeue(peerString); //peerQueue.dequeue();
    while (!peerStateManager.isEmpty(peerString) && peerStateManager.isRequested(nextPiece) !== false) {
        nextPiece = peerStateManager.dequeue(peerString);
    }
    if (peerStateManager.isRequested(nextPiece) === false) {
        //this check is required as we might reach the end of the queue without finding a requestable piece 
        retval = nextPiece;
    }
    return retval;
}

function unchokeHandler(socket, peerStateManager, peerString) {
    peerStateManager.markUnchoked(peerString);
    //request next piece
    var nextPiece = nextRequestablePiece(peerStateManager, peerString);
    if (typeof(nextPiece) != "undefined") {
        // var req = ( nextPiece == pt.pieces.length - 1 ) ? messageFactory.request(nextPiece,pt.lastPieceLength).rawBuffer: messageFactory.request(nextPiece).rawBuffer;
        // //var req = messageFactory.request(nextPiece).rawBuffer;
        // socket.write(req);
        sendRequest(nextPiece, socket);
        peerStateManager.log(peerString, "Sent request for " + nextPiece + " ");
        peerStateManager.markRequested(nextPiece);
    }
}

function chokeHandler(peerStateManager, peerString) {
    peerStateManager.markedChoked(peerString);
}

function bitfieldHandler(socket, rawMessage, peerStateManager, peerString) {
    //parse bitfield and enqueue pieceNumbers
    //calculate length of bitfield
    // read the first 32bit integer
    var bitfieldSize = rawMessage.readUInt32BE(0) - 1 || 0;
    //peerStateManager.log(peerString, "Received a bitfield of size " + bitfieldSize);

    // var bitfield = rawMessage.readUInt32BE(5);
    // var parsedBitfield = bitfield.toString(2);
    // peerStateManager.log(peerString, "un-parsed bitfield  " + bitfield + " ");
    // peerStateManager.log(peerString, "parsed bitfield  " + parsedBitfield + " ");
    var binaryRep = "";
    for (var i = 0; i < bitfieldSize; i++) {
        var tempByte = rawMessage.readUInt8(5 + i);
        var tmpBinaryRep = tempByte.toString(2) || "";
        binaryRep += prefixZeros(tmpBinaryRep);
    }
    //peerStateManager.log(peerString,"Parsed bitfield :"+binaryRep);
    for (var i = 0; i < binaryRep.length; i++) {
        if (binaryRep.charAt(i) === "1") {
            //enqueue
            peerStateManager.enqueue(peerString, i);
        }
    }
}

function prefixZeros(binaryRep) {
    while (binaryRep.length < 8)
        binaryRep = "0" + binaryRep;
    return binaryRep;
}

function sendRequest(pieceNumber, socket) {
    var plen = (pieceNumber == pt.pieces.length - 1) ? pt.lastPieceLength : pt.pieceLength;
    pieceCache[pieceNumber] = Buffer.alloc(plen);
    blockCount[pieceNumber] = 0;
    var offsetMultilyer = 0;
    while (plen > 0) {
        if (plen >= 16384) {
            //send request of size 16384
            var req = messageFactory.request(pieceNumber, 16384, 16384 * offsetMultilyer).rawBuffer;
            socket.write(req);
        }
        else {
            //send request of plen
            var req = messageFactory.request(pieceNumber, plen, 16384 * offsetMultilyer).rawBuffer;
            socket.write(req);
        }
        plen -= 16384;
        offsetMultilyer++;
    }
}
