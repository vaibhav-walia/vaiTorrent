'use-strict';

var parseTorrent = require("parse-torrent");
var oEnvironment = require("./environment.js");
var bencode = require("bencode");
var Buffer = require("buffer").Buffer;
var crypto = require("crypto");

var message = function(messageID) {
    this.messageID = messageID || -3;
}

module.exports.parse = function(msg) {
    //detrmine messageId and create new message
    //is handshake message
    var hs = ((msg.length === (msg.readUInt8(0, 1) + 49)) && (msg.toString('utf8', 1, msg.readUInt8(0, 1) + 1) === 'BitTorrent protocol')) ? true : false;
    var pMessage = new message(msg.length > 4 ? (hs ? -1 : msg.readInt8(4)) : -2);
    if (pMessage.messageID === -1) {
        //handshake
        pMessage.pstrLen = msg.readUInt8(0, 1);
        pMessage.pstr = msg.toString('utf8', 1, msg.readUInt8(0, 1) + 1);
        pMessage.infoHash = msg.toString('utf8', 28, 48);
        pMessage.peerID = msg.toString('utf8', 48);

    }
    //console.log("Parsed Message : " + JSON.stringify(pMessage));
    pMessage.rawBuffer = msg;
    return pMessage;
};
module.exports.keepAlive = function() {
    var oMessage = new message(-2);
    oMessage.rawBuffer = Buffer.alloc(4);
    return oMessage;
};
module.exports.interested = function() {
    var oMessage = new message(2);
    //the interested message should have fixed length and no payload
    var mBuffer = Buffer.alloc(5);
    // length
    mBuffer.writeUInt32BE(1, 0);
    // id
    mBuffer.writeUInt8(2, 4);
    oMessage.rawBuffer = mBuffer;
    return oMessage;
};
module.exports.handshake = function(torrent) {
    var oMessage = new message(-1);
    // we assume that the caller calls with the decoded torrent file
    //therefore to get the torrentfile we encode it again
    var torrentFile = bencode.encode(torrent);
    //handshake is always 68 bytes
    var mBuffer = Buffer.alloc(68);
    //length of protocol string
    mBuffer.writeUInt8(19, 0);
    // protocol string, name of the protocol
    mBuffer.write('BitTorrent protocol', 1);
    //reserved, fill with 0, 
    //can't fill 64 bit at a time so fill 32 at a time
    mBuffer.writeUInt32BE(0, 20);
    mBuffer.writeUInt32BE(0, 24);
    //get torrent's infoHash and copy to buffer
    var info = bencode.decode(torrentFile).info;
    var info_encoded = bencode.encode(info);
    var info_encoded_hash = crypto.createHash('sha1').update(info_encoded).digest();
    info_encoded_hash.copy(mBuffer, 28);
    //Buffer.from(bencode.encode(parseTorrent(bencode.encode(torrent)).infoHash)).copy(mBuffer, 28);
    // peer id
    //oEnvironment.getID('-VT0001-').copy(mBuffer,48);
    Buffer.from('-VT0001-000000000000').copy(mBuffer, 48);
    //mBuffer.write(oEnvironment.getID('-VT0001-000000000000').toString());

    oMessage.rawBuffer = mBuffer;
    return oMessage;
};

module.exports.request = function(pieceIndex,requestLength,offset) {
    var oMessage = new message(6);
    var mBuffer = Buffer.alloc(17);
    
    var pieceLength = requestLength || 16384;
    var blockOffset = offset || 0;
    // length
    mBuffer.writeUInt32BE(13, 0);
    // id
    mBuffer.writeUInt8(6, 4);
    // piece index
    mBuffer.writeUInt32BE(pieceIndex, 5);
    // begin
    mBuffer.writeUInt32BE(blockOffset, 9);
    // Piece length
    mBuffer.writeUInt32BE(pieceLength, 13);

    oMessage.rawBuffer = mBuffer;
    //console.log(" Request : "+mBuffer);
    return oMessage;
};
