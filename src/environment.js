var crypto = require("crypto");

var id = null;

module.exports.getID = function(clientEncodingPrefix) {
    if (!id) {
        id = crypto.randomBytes(20);
        console.log(clientEncodingPrefix);
        Buffer.from(clientEncodingPrefix).copy(id, 0);
    }
    return id;
};

module.exports.getHash = function(pieceString){
    const hash = crypto.createHash('sha1');
    hash.update(pieceString);
    return hash.digest('hex');
}