//this is server side code. Using nodejs.
var express = require('express');
var cookieParser = require('cookie-parser');
var app = express();
app.use(cookieParser());
var http = require('http').createServer(app);
var io = require('socket.io')(http);

//user process.env.PORT for heroku, 3000 for local.
//var port = process.env.PORT;
var port = 3000;

//we start our website on port 3000 and output it to console. 
http.listen(port, function(){
    console.log(`listening on port ${port}.`);
})

//our dictionary of all users
let user_list = new Object();
let message_queue = [];
const MAX_QUEUE_SIZE = 200;


//send index.html on connection
app.get("/", function(req, res){
    res.sendFile(__dirname + "/index.html");
});

//serve the css
app.get('/style.css', function(req, res) {
    res.sendFile(__dirname + "/" + "style.css");
});

//serve the client js
app.get('/client.js', function(req, res) {
    res.sendFile(__dirname + "/" + "client.js");
});


//handles connections from a socket
io.on("connection", function(socket){

    //create a placeholder user. 
    let new_user = new User();

    //client sends a uid stored as a cookie on the client.
    socket.on("connection made", function(msg){

        //a user reconnects
        if(user_list[msg] !== undefined){
            //update the user's object with proper socket id
            user_list[msg].socketID = socket.id;
            new_user = user_list[msg];

            //check if the previous nickname was stolen
            if(!checkIfUniqueNickname(user_list[msg].userNickname, user_list)){
                //check if someone made their nickname the client's uid
                if(!checkIfUniqueNickname(msg, user_list)){
                    //give client a new random nickname
                    user_list[msg].userNickname = (Math.floor(Math.random() * 100000000000) + 1);
                }else{
                    user_list[msg].userNickname = msg;
                }
            }

            //mark user as online and update online user list
            user_list[msg].status = true;
            findOnlineUsers(user_list);
            io.emit("message logs", message_queue, new_user.userID);
            socket.emit("username message", user_list[msg].userNickname);
            console.log(`A user connected. ID = ${user_list[msg].userNickname}.`);

        //a new user
        }else{
            //create a new user with uid and socket id
            new_user = new User(msg, socket.id);
            user_list[new_user.userID] = new_user;
            findOnlineUsers(user_list);
            io.emit("message logs", message_queue, new_user.userID);
            socket.emit("username message", user_list[msg].userNickname);
            console.log(`A user connected. ID = ${user_list[msg].userNickname}.`);
        }
    });

    //when a socket disconnects
    socket.on('disconnect', function(){
        console.log('user disconnected');
        try{
            user_list[new_user.userID].status = false;
        }catch(err){
            console.log("There was an error. Don't panic lol.")
        }
        findOnlineUsers(user_list);
    });

    //when we receive a message from a client
    socket.on("chat message", function(msg){
        let xss_regex = /[\S\s]*<[\S\s]*>[\S\s]*/;
        if(!xss_regex.test(msg)){
            if(msg.length <= 1000){
                msg = new Message(msg, user_list[new_user.userID].userNickname, user_list[new_user.userID].userColour, new_user.userID, "message");
                //check if user is trying to issue a command
                checkForCommand(msg, new_user.userID);
            }else{
                io.emit("error", "The max message size if 1000 character.", new_user.userID);    
            }
        }else{
            io.emit("error", "Please do not use the characters < or >.", new_user.userID);   
        }
    });
});


//returns a formatted timestamp
function getTimeStamp(){
    let now = new Date();
    var time = [ now.getHours(), now.getMinutes(), now.getSeconds() ];
    for ( var i = 1; i < 3; i++ ) {
        if ( time[i] < 10 ) {
            time[i] = "0" + time[i];
        }
    }
    return ("[" + time[0] + ":" + time[1] + ":" + time[2] + "]");
}


//check if msg contains a request
function checkForCommand(msg, userID){
    let split_msg = msg.msg.split(" ");
    if(split_msg[0] === "/nick"){
        changeNickname(split_msg, userID);
        return 1;
    }else if(split_msg[0] === "/nickcolor"){
        changeColour(split_msg, userID);
        return 2;
    }else if(split_msg[0] === "/nickcolour"){
        changeColour(split_msg, userID);
        return 2;
    }else if(split_msg[0] === "/help"){
        io.emit("error", "/nick [nickname]<br>/nickcolor [hexvalue]", userID)
    }else{
        io.emit("chat message", JSON.stringify(msg));
        addToMessageQueue(msg);
    } 
}


//changes a users nickname
function changeNickname(command, userID){

    //still need to implement check for existing usernames
    if(command[1] !== undefined && command[1] !== ""){
        old_nickname = user_list[userID].userNickname;

        if(command.length >2){
            io.emit("error", "Spaces are not allowed in nicknames.", userID);
        }else{
            if(checkIfUniqueNickname(command[1], user_list)){
                user_list[userID].userNickname = command[1];
                let message_string = `${old_nickname} has changed their username to ${user_list[userID].userNickname}`;
                io.emit("username update", message_string, userID);
                let message = new Message(message_string, "server", "ffffff", -1, "server");
                addToMessageQueue(message);
                findOnlineUsers(user_list);
            //error handling
            }else{
                io.emit("error", "Someone else already has that nickname!!", userID);
            }
        }
    //error handling   
    }else{
        io.emit("error", "Please use format /nick <nickname>", userID);
    }
}


//changes a users colour and let's all peers know
function changeColour(command, userID){
    //still need to implement check for existing usernames
    if(command[1] !== undefined && command[1] !== ""){
        let colourReg = /[A-Fa-f\d]{6}/;
        if(colourReg.test(command[1])){
            user_list[userID].userColour = command[1];
            let message_string = `${user_list[userID].userNickname} changed their colour!`;
            io.emit("colour update", message_string, userID, user_list[userID].userColour);
            let message = new Message(message_string, "server", "ffffff", -1, "server");
            addToMessageQueue(message);
        //error handling in here.
        }else{
            io.emit("error", "Please use a valid hex value in range 000000-FFFFFF.", userID);
        }
        
    //error handling in here.    
    }else{
        io.emit("error", "Please use format /nickcolour <hex value>", userID);
    }
}


//returns all online users
function findOnlineUsers(user_list){
    let online_users = [];
    for(let user in user_list){
        if(user_list[user].status === true){
            online_users.push(user_list[user].userNickname);
        }
    }
    io.emit("online users", online_users);
}


//checks if a nickname is in use
function checkIfUniqueNickname(proposed_nickname, user_list){
    for(let user in user_list){
        if(user_list[user].userNickname === proposed_nickname && user_list[user].status === true){
            return false;
        }else{
            continue;
        }
    }
    return true;
}


//ensures that message_queue can only hold 200 messages. 
function addToMessageQueue(message){
    if(message_queue.length >= 200){
        message_queue.shift();
        message_queue.push(message);
    }else{
        message_queue.push(message);
    }
}


//constructor for a Message object
function Message(msg, user, colour, id, type){
    this.msg = msg;
    this.user = user;
    this.id = id;
    this.timestamp = getTimeStamp();
    this.colour = colour;
    this.type = type;
}


//constructor for a User object
function User(userID ,socketID){
    this.userID = userID;
    this.socketID = socketID;
    this.userNickname = userID;
    this.userColour = "000000";
    this.status = true;
}