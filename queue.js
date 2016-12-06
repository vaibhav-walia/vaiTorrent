module.exports.Queue = function(){
  var arr = [];
  this.enqueue = function(value){
      arr.push(value);
  };
  this.dequeue = function(){
      return arr.shift();
  };
  this.peek = function(){
      return arr[0];
  };
  this.isEmpty = function(){
    return arr.length == 0 ? true : false;  
  };
  this.print = function(){
    arr.forEach(function(element){
        console.log(element+" ");
    });  
  };
};