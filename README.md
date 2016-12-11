# vaiTorrent

A BitTorrent client implementation in Node.js, meant for educational purposes only.

## Getting Started



### Prerequisites
Latest version of NodeJs and NPM


### Installing and Running 

 * Download/pull the source code
 
 ```
 $ mkdir vaiTorrent
 $ cd vaiTorrent
 $ git init
 $ git pull https://github.com/vaibhav-walia/vaiTorrent.git
```

* Install the client
 
```
 $ npm install
```


* Open settings.json and set the download directory
```javascript
{
    "downloadDir" : "./../Downloads/"
}
```

* Download a torrent : ```node vaiTorrent.js <torrentFilePath>```
    
    ```
    Example:
    $ node vaiTorrent.js ./../testTorrents/2.torrent
    ```


## Authors

* **Vaibhav Walia** - [Github Profile](https://github.com/vaibhav-walia)


## License

Free software!!
