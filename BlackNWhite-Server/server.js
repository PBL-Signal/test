const express = require("express");
const http = require("http");
const cors = require("cors");
const bodyPaser = require('body-parser');
// const REDIS_PORT = 6380;

// const mongoose = require('mongoose');
const socketio = require("socket.io");
const Redis = require("ioredis"); 
// const socketredis = require("socket.io-redis");


const app = express();
// const redisClient = new Redis(REDIS_PORT);
const server = http.createServer(app);
const options = {
    cors: true,
    origin: ['http://localhost:5000/blacknwhite/'],
};
const io = socketio(server, options);

// const io = socketio(server,{
//     cors: {
//         // origin: 'http://localhost:7000',
//         origin: ['http://localhost:5693'],
//         methods: ["GET", "POST"]
//     },
   
//     transport: ["websocket"]
// });

// io.adapter(socketio({host: 'localhost', port: 6380}));


const { setupWorker } = require("@socket.io/sticky");
const crypto = require("crypto");
const randomId = () => crypto.randomBytes(8).toString("hex");

// 잠시 주석 0516
// const { RedisSessionStore } = require("./sessionStore"); // 잠시 주석 0516
// const sessionStore = new RedisSessionStore(redisClient); // 잠시 주석 0516

// Redis test 
// redisClient.set(
//   "test",
//   "userID1234");



setupWorker(io);
require('./io-handler')(io);

app.use(cors());
app.use(bodyPaser.json());
app.use(bodyPaser.urlencoded({extended: false}));
app.use(express.json());



////////////////////////////////////////JSON TEST
// const { RedisJsonStore } = require("./redisJsonStore");
// const jsonStore = new RedisJsonStore(redisClient);

// whiteTeam = {
//     "total_pita" : 24,
//     "users" : {
//             "userId" : 123,
//             "IsBlocked": 123,
//             "currentLocation" : "서울"
//     }
// }
// jsonStore.test(whiteTeam, "whiteTeam");
// const j = jsonStore.get("whiteTeam");


//////////////////////////////////////////////////

// server.listen(process.argv[2]);
// console.log(process.argv[2] +' Server Started!! ');


// sessionStore.saveSession("testSessionId", {
//     userID: "socket.userID",
//     username: "socket.username",
//     connected: true,
// });


/// test 
// const { RoomTotalSchema, BlackTeam, WhiteTeam, BlackUsers, UserCompanyStatus, WhiteUsers, Section, Progress} = require("./schemas/roomTotal");
// const { section }= require("./schemas/section");


// const RoomTotalSchema = require("./schemas/roomTotal/RoomTotalSchema");
// const BlackTeam = require("./schemas/roomTotal/BlackTeam");
// const WhiteTeam = require("./schemas/roomTotal/WhiteTeam");
// const BlackUsers = require("./schemas/roomTotal/BlackUsers");
// const UserCompanyStatus = require("./schemas/roomTotal/UserCompanyStatus");
// const WhiteUsers = require("./schemas/roomTotal/WhiteUsers");
// const Company = require("./schemas/roomTotal/Company");
// const Section = require("./schemas/roomTotal/Section");
// const Progress = require("./schemas/roomTotal/Progress");


// var userCompanyStatus = new UserCompanyStatus({
//     warnCnt    : 0,
//     detectCnt : 2
// })


// var blackUsers = new BlackUsers({
//     userId   :"abc123",
//     IsBlocked   : false,
//     currentLocation : 3,
//     companyA    : userCompanyStatus,
//     companyB    : userCompanyStatus,
//     companyC    : userCompanyStatus,
//     companyD    : userCompanyStatus,
//     companyE    : userCompanyStatus,
// })

// var whiteUsers = new WhiteUsers({
//     userId   :"abc123",
//     IsBlocked   : true,
//     currentLocation : 1,
// })

// var progress = new Progress({
//     progress  :[5,4,1,2,3],
//     last  : 1,
// })

// var companyA = new Company({
//     abandonStatus : false,
//     penetrationTestingLV : [1,2,3,4],
//     attackLV : [1,2,3,4],
//     sections : [
//         new Section({
//         destroyStatus  : true ,
//         level  : 5,
//         attack : progress,
//         response : progress,
//         })
//     ]
// })


// var testRoomTotalJson  = {
//     server_start  : new Date(),
//     server_end  :  new Date(),
//     blackTeam  : new BlackTeam({ 
//         total_pita : 10,
//         users : blackUsers
//     }),
//     whiteTeam  : new WhiteTeam({ 
//         total_pita : 10,
//         users : whiteUsers
//     }),
//     companyA    : companyA,
//     companyB    : companyA,
//     companyC    : companyA,
//     companyD    : companyA,
//     companyE    : companyA,
// }

// const func = require('./server_functions/db_func');
// var testRoomTotal = new RoomTotalSchema(testRoomTotalJson);
// func.InsertRoomTotal(testRoomTotal);