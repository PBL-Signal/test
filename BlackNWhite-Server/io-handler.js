const url = require('url');
const async = require('async');
//const func = require('./server_functions/db_func');
const { Socket } = require('dgram');
const { stringify } = require('querystring');
const config = require('./configure');

const REDIS_PORT = 6380;
const Redis = require("ioredis"); 
const redisClient = new Redis(REDIS_PORT);
const { RedisSessionStore } = require("./sessionStore");
const sessionStore = new RedisSessionStore(redisClient);

const { redisHashTableStore } = require("./redisHashTableStore");
const hashtableStore = new redisHashTableStore(redisClient);

const { RedisJsonStore } = require("./redisJsonStore");
const jsonStore = new RedisJsonStore(redisClient);

const { redisListStore } = require("./redisListStore");
const listStore = new redisListStore(redisClient);

const { RedisRoomStore, InMemoryRoomStore } = require("./roomStore");
const redis_room = new RedisRoomStore(redisClient);

const crypto = require("crypto");
const randomId = () => crypto.randomBytes(8).toString("hex");

const RoomTotalSchema = require("./schemas/roomTotal/RoomTotalSchema");
const BlackTeam = require("./schemas/roomTotal/BlackTeam");
const WhiteTeam = require("./schemas/roomTotal/WhiteTeam");
const BlackUsers = require("./schemas/roomTotal/BlackUsers");
const UserCompanyStatus = require("./schemas/roomTotal/UserCompanyStatus");
const WhiteUsers = require("./schemas/roomTotal/WhiteUsers");
const Company = require("./schemas/roomTotal/Company");
const Section = require("./schemas/roomTotal/Section");
const Progress = require("./schemas/roomTotal/Progress");

// 자바스크립트는 특정 문자열 인덱스 수정 불가라, 이를 대체하기 위해 가져온 함수
String.prototype.replaceAt = function(index, replacement) {
    if (index >= this.length) {
        return this.valueOf();
    }

    return this.substring(0, index) + replacement + this.substring(index + 1);
}

module.exports = (io) => {
    
    var gameserver = io.of("blacknwhite");
 
    var rooms ={};  // 여러 방 정보를 저장하는 딕셔너리
    var userPlacement ={}; // # WaitingRoom TeamChange 및 UI 배치 관련 정보 저장
    let Players = [];
    let gamePlayer = {};
    let evenNumPlayer = false;
    let numPlayer = 1;
    let companyNameList = ["companyA", "companyB", "companyC", "companyD", "companyE"];
    let sectionNames = [["Area_DMZ", "Area_Interal", "Area_Sec"], ["Area_DMZ", "Area_Interal", "Area_Sec"],["Area_DMZ", "Area_Interal", "Area_Sec"],["Area_DMZ", "Area_Interal", "Area_Sec"],["Area_DMZ", "Area_Interal", "Area_Sec"]];
    let vulnArray = ["Reconnaissance", "Credential Access", "Discovery", "Collection"];      
    let attack_name_list = ["Reconnaissance", "Credential Access", "Discovery", "Collection", "Resource Development", "Initial Access", "Execution", "Privilege Escalation", "Persistence", "Defense Evasion", "Command and Control", "Exfiltration", "Impact"];      

    let timerId;
    let pitaTimerId;
    
    io.use(async (socket, next) => {
        console.log("io.use");

        const sessionID = socket.handshake.auth.sessionID;
        // 가장 먼저 CONNECTION들어가기 전에 SESSIONID 있는지 확인
        //finding existing session
        const session = await sessionStore.findSession(sessionID);

        if(sessionID){
            socket.sessionID = sessionID;
            socket.userID = session.userID;
            socket.nickname = session.username;
            console.log("io.use 세션 있음", session.userID, sessionID);
            return next();
        }
        // 처음 연결되는 경우 즉, SESSIONID 없으면 
        const username = socket.handshake.auth.username;

        if (!username) {
            return next(new Error("invalid username")); // 새로운 세션 계속 안생기게 해주는 것
            // USERNAME 입력시에만 세션이 만들어짐 
        }
        console.log("io.use 세션 새로 생성", username);
        //create new session
        socket.sessionID = randomId();
        socket.userID = randomId();
        socket.nickname = username;


        // console.log("session 설정 확인 - sessionID", socket.sessionID);
        // console.log("session 설정 확인 - userID", socket.userID);
        // console.log("session 설정 확인 - username", socket.username);
        next();
    });


    io.on('connection', async(socket) => {
        console.log("io-handler.js socket connect!!");
        console.log("socketid : "+ socket.id); 
     
        // console.log("sessionID : "+ socket.sessionID); 
        // console.log("userID : "+ socket.userID); 
 
        console.log("session 설정 확인 - sessionID", socket.sessionID);
        console.log("session 설정 확인 - userID", socket.userID);
        console.log("session 설정 확인 - username", socket.nickname);

        
    
        try{
            await sessionStore.saveSession(socket.sessionID, {
                userID: socket.userID,
                username: socket.nickname,
                connected: true,
            }).catch( 
            function (error) {
            console.log('catch handler', error);
            });

        }catch(error){
            console.log("ERROR! ", error);
        }

        console.log("connect: saveSession");



         // [MainHome] 사용자 정보(session) 확인 
        socket.on('checkSession', () => {
            var session = { 
                sessionID: socket.sessionID,
                userID: socket.userID,
                nickname: socket.nickname,  // 원래는 username임
            };
    
            var sessionJSON= JSON.stringify(session);
            socket.emit("sessionInfo", sessionJSON);
        });




        // [MainHome] pin 번호 입력받아 현재 활성화된 방인지 검증함
        // [MainHome] 오픈 방 클릭시 
        socket.on("isValidRoom", async(room) => {
            console.log('[socket-isValidRoom] room:',room);
        
            // var room_data = { 
            //     permission: await UpdatePermission(room)
            // };
            var permission = await UpdatePermission(room);
            console.log('[socket-isValidRoom] permission: ', permission);

            if(permission == 1){
                console.log('[socket-isValidRoom] UpdatePermission: 1');
                socket.room = room;
            }

            socket.emit('room permission',permission);
            // var roomJson = JSON.stringify(room_data);
            // console.log('!!check roomJson : ', roomJson);
            // socket.emit('room permission',roomJson);

        });


        // [MainHome] 랜덤 게임 시작 버튼 클릭시
        socket.on("randomGameStart", async() => {
            console.log('[randomGameStart]');
            var roomPin; 
            /*
             - 경우 1 : 공개방 O -> public이고 isnotfull인 방 키 return 
             - 경우 2 : 공개방 X -> 새 공개방 만들고 입장하기 
            */

            // step 0. redis-publicWaitingRoom 상태 확인 

            var publicRoomCnt = await listStore.lenList('publicRoom', 'roomManage');
            console.log("publicRoomCnt : ", publicRoomCnt);


            if(publicRoomCnt > 0){    
                // 경우 1
                var publicRoomList = await listStore.rangeList('publicRoom', 0, -1, 'roomManage');
                console.log("! publicRoomList : ", publicRoomList);

                //0~9까지의 난수
                var randomNum = {};
                randomNum.random = function(n1, n2) {
                    return parseInt(Math.random() * (n2 -n1 +1)) + n1;
                };

                var randomRoomIdx = randomNum.random(0,publicRoomCnt-1);
                var roomPin = publicRoomList[randomRoomIdx];
                console.log("@ randomRoomIdx  : ", randomRoomIdx);
                console.log("@ roomPin  : ", roomPin);
                
                socket.room = roomPin;
                console.log("socket.room", socket.room);
                socket.emit('enterPublicRoom');
            }else {
                // 경우 2
                roomPin = await createRoom('public', config.DEFAULT_ROOM.maxPlayer);

                console.log("succesCreateRoom roomPin: " , roomPin);
            }    
            socket.room = roomPin;
          
            console.log("socket.room", socket.room);
            socket.emit('enterPublicRoom');

        });


        // [MainHome] 룸 리스트 정보 반환 
        socket.on("getPublcRooms", async() => {
            console.log('[getPublcRooms]');
            // <<코드 미정>> 코드 수정 필요
            // 방 pin 번호, 방 인원수 
            // var roomslist = await redis_room.viewRoomList();
            var roomslist = await listStore.rangeList('publicRoom', 0, -1, 'roomManage');
            console.log('[getPublcRooms] roomsList : ', roomslist);
            var publicRooms = []
            for (const room of roomslist){
                // publicRooms[room] = await redis_room.RoomMembers_num(room)
                publicRooms.push({
                    'roomPin' : room.toString(),
                    'userCnt' : (await redis_room.RoomMembers_num(room)).toString(),
                    'maxPlayer' : JSON.parse(await redis_room.getRoomInfo(room)).maxPlayer
                });               
            }   
        
            console.log(">>> publicRooms : ", publicRooms);
            socket.emit('loadPublicRooms', publicRooms);
        });

        // [CreateRoom] 새 방을 만듦
        socket.on("createRoom", async(room) =>{
            console.log('[socket-createRoom] 호출됨, 받은 room 정보 (maxPlayer): ', room);
            console.log('[socket-createRoom] room.roomType', room.roomType);
            // hashtableStore.storeHashTable("key", {"a":"f", 1:2}, 1, 2);
               
            var roomPin = await createRoom(room.roomType, room.maxPlayer);
            // await initRoom(roomPin);

            console.log("succesCreateRoom roomPin: " , roomPin);
            socket.room = roomPin;


            socket.emit('succesCreateRoom', {
                roomPin: roomPin.toString()
            });
        
        });


        // [WaitingRoom] 사용자 첫 입장 시 'add user' emit 
        socket.on('add user', async() => {

            io.sockets.emit('Visible AddedSettings'); // actionbar
            console.log('[add user] add user 호출됨 user : ', socket.nickname, 'room : ', socket.room );
            /*
                < 로직 > 
                1. redis에서 room 정보 불러오기
                2. new user를 white/black 배정 및 profile 색 지정 
                3. 2번에서 만든 new user정보 저장(redis_room.addMember) 및 socket.join 
                4. 사용자 로그인 알림 (new user에게 모든 사용자의 정보를 push함) 
                5. new user외의 사용자들에게 new user정보보냄
            */
        

            var room = socket.room;
        
            // 1. redis에서 room 정보 불러오기
            var roomManageDict = await hashtableStore.getAllHashTable(room, 'roomManage'); // 딕셔너리 형태
            console.log('!!!~~룸정보 roomManage', roomManageDict);

            // 2. new user를 white/black 배정 및 profile 색 지정 
            // 2-1. team배정
            var team;
            if (roomManageDict.blackUserCnt > roomManageDict.whiteUserCnt){
                ++roomManageDict.whiteUserCnt ;
                team = true;
            }else {
                ++roomManageDict.blackUserCnt ;
                team = false;
            }
            
            ++roomManageDict.userCnt; 
            

            // 만약 현재 방 인원이 꽉 찾으면 list에서 삭제해주기
            if (roomManageDict.userCnt >= roomManageDict.maxPlayer){
                var redisroomKey =  roomManageDict.roomType +'Room';
                listStore.delElementList(redisroomKey, 1, room, 'roomManage');
                console.log("roomManage의 list에서 삭제됨");
            }


            // 2-1. profile 배정
            const rand_Color = roomManageDict.profileColors.indexOf('0'); //0~11
            roomManageDict.profileColors = roomManageDict.profileColors.replaceAt(rand_Color, '1');
            console.log("rand_Color : ",rand_Color ,"roomManageDict.profileColors : " , roomManageDict.profileColors);
            // const rand_Color = Math.floor(Math.random() * 12);
            await hashtableStore.storeHashTable(room, roomManageDict, 'roomManage'); // 무조건 PlaceUser 위에 있어야 함!
            
            let playerInfo = { userID: socket.userID, nickname: socket.nickname, team: team, status: 0, color: rand_Color, place : await PlaceUser(room, team), socketID : socket.id };
            console.log("PlayersInfo : ", playerInfo);

            
            // 3. socket.join, socket.color
            redis_room.addMember(socket.room, socket.userID, playerInfo);
            socket.team = team;
            socket.color = rand_Color;
            socket.join(room);

            // 4. 사용자 로그인 알림 (new user에게 모든 사용자의 정보를 push함) 
            // 해당 룸의 모든 사용자 정보 가져와 new user 정보 추가 후 update
            var RoomMembersList =  await redis_room.RoomMembers(socket.room);
            var RoomMembersDict = {}

            for (const member of RoomMembersList){
                RoomMembersDict[member] = await redis_room.getMember(room, member);
            }   

            console.log('!!!~~RoomMembersDict', RoomMembersDict);

            var room_data = { 
                room : room,
                clientUserID : socket.userID,
                maxPlayer : roomManageDict.maxPlayer,
                users : RoomMembersDict
            };
            var roomJson = JSON.stringify(room_data);

            console.log('check roomJson : ', roomJson);
            // io.sockets.in(room).emit('login',roomJson); 
            socket.emit('login',roomJson); 
     
            // 5. new user외의 사용자들에게 new user정보 보냄
            socket.broadcast.to(room).emit('user joined', JSON.stringify(playerInfo));

        });
        

    
        // [WaitingRoom] ready status 변경 시 
        socket.on('changeReadyStatus',  async(newStatus) =>{
            console.log('changeReadyStatus status : ', newStatus);
            
            // 1. 사용자 정보 수정 
            var playerInfo = await redis_room.getMember(socket.room, socket.userID);
            console.log("!PlayersInfo : ", playerInfo);
            playerInfo.status = newStatus;

            await redis_room.updateMember(socket.room, socket.userID, playerInfo);

            // 2. ready한 경우 room_info 바꿔주기 
            var roomInfo  = await hashtableStore.getHashTableFieldValue(socket.room, ['readyUserCnt', 'maxPlayer'], 'roomManage');
            var readyUserCnt = parseInt(roomInfo[0]);
            var maxPlayer =  parseInt(roomInfo[1]);
            console.log("!readyUserCnt : ", readyUserCnt);
            console.log("!maxPlayer : ", maxPlayer);

            if (newStatus == 1){
                readyUserCnt += 1
            }else {
                readyUserCnt -= 1
            }

            console.log("!readyUserCnt : ", readyUserCnt);
            await hashtableStore.updateHashTableField(socket.room, 'readyUserCnt', readyUserCnt, 'roomManage'); 
           
            // 3. 만약 모두가 ready한 상태라면 자동 game start
           if(readyUserCnt == maxPlayer){
                console.log("!모두 레디함!");
                io.sockets.in(socket.room).emit('countGameStart');
           }else{
                // 47 수정한 내용 client들에게 뿌리기
                var playerJson = JSON.stringify(playerInfo);

                console.log('check playerJson : ', playerJson);
                io.sockets.in(socket.room).emit('updateUI',playerJson);
           }

        });


        // [WaitingRoom] profile 변경 시 
        socket.on('changeProfileColor',  async() =>{
            console.log('changeProfileColor 프로필 변경');
            
            // 0. 이전의 사용자 정보의 프로필 색상 인덱스 가져옴
            var playerInfo = await redis_room.getMember(socket.room, socket.userID);
            var prevColorIndex = playerInfo.color;
            console.log("PlayersInfo : ", playerInfo);

            // 1. 룸 정보에서 가능한 프로필 색상 인덱스 가져오고 이전 프로필 인덱스는 0으로 만듦
            var profileColors = await hashtableStore.getHashTableFieldValue(socket.room, ['profileColors'], 'roomManage');
            profileColors = profileColors[0].replaceAt(prevColorIndex, '0'); // 이전 프로필 인덱스 0으로 설정
            
            const rand_Color = profileColors.indexOf('0', (prevColorIndex + 1)%12); // <확인필요> 새 프로필 인덱스 할당
            // 프로필 인덱스 최대를 넘어가도 앞으로 와서 반복되도독 하기
            if (rand_Color == -1){
                rand_Color = profileColors.indexOf('0');
            }
            profileColors = profileColors.replaceAt(rand_Color, '1');

            socket.color = rand_Color;
            console.log("rand_Color : ",rand_Color ,"profileColors : " , profileColors);
            await hashtableStore.updateHashTableField(socket.room, 'profileColors', profileColors, 'roomManage');

            // 2. 사용자 정보 수정 
            playerInfo.color = rand_Color;
            console.log(" 수정 후 PlayersInfo : ", playerInfo);

            await redis_room.updateMember(socket.room, socket.userID, playerInfo);


            // 3. 수정한 내용을 요청한 사람 포함 모두에게 뿌리기
            var playerJson = JSON.stringify(playerInfo);

            console.log('check : ', playerJson);
            // socket.broadcast.to(socket.room).emit('updateUI', playerJson);
            io.sockets.in(socket.room).emit('updateUI',playerJson); // 모든 사람에게 뿌림
        });  



        // [WaitingRoom] teamChange 변경 시 
        socket.on('changeTeamStatus',  async(changeStatus) =>{
            console.log("_____________________________________________________________________");
            console.log('!!!!changeTeamStatus changeStatus : ', changeStatus);
            var room = socket.room;

            // 1. 사용자 정보 (status)수정  
            var playerInfo = await redis_room.getMember(room, socket.userID);
            playerInfo.status = changeStatus;
            console.log("PlayersInfo : ", playerInfo);

            await redis_room.updateMember(room, socket.userID, playerInfo);
            io.sockets.in(socket.room).emit('updateUI',JSON.stringify(playerInfo));


            var prevTeam = playerInfo.team; // 팀 바꾸기 전 현재 사용자 팀 정보
            var prevPlace = playerInfo.place;
            console.log("## prevTeam : ", prevTeam, "  prevPlace : ", prevPlace );

            // 2. status 상황에 따라 행동 다르게
            // 0이면 teamChange Off
            if (changeStatus == 0){     
                // 만약 대기에 있었다면 빼주기 
                var myWaitingField, mywaitingList;
                if(prevPlace){
                    myWaitingField = 'toBlackUsers';
                }else{
                    myWaitingField = 'toWhiteUsers';
                }
                var myWaitingData = await hashtableStore.getHashTableFieldValue(room, [myWaitingField], 'roomManage');

                // 널 처리
                if (myWaitingData[0].length != 0){
                    mywaitingList = myWaitingData[0].split(',');
                    mywaitingList = mywaitingList.filter(function(userID) {
                        return userID != socket.userID;
                    });
                    console.log("웨이팅 리스트에서 삭제함 : "+ myWaitingField + mywaitingList);
                    await hashtableStore.updateHashTableField(room, myWaitingField, mywaitingList.join(','), 'roomManage');
                }

                // 2-1. 수정한 내용 client들에게 뿌리기
                var playerJson = JSON.stringify(playerInfo);
                console.log('check : ', playerJson);
                socket.broadcast.to(socket.room).emit('updateUI', playerJson);
            }
            // 2이면 teamChange On
            else if(changeStatus == 2){
                /*
                경우 2가지 : 
                    - 경우 1 : 다른 팀의 자리가 있어서 바로 변경 가능
                    - 경우 2 : full 상태라 1:1로 팀 change를 해야되는 상황 
                ! 추가 처리 사항 !
                    - 입장 시 random시 evenNumPlayer 따른 팀 자동 선택 변수 제어해야 될 듯
                */

                // 0. redis에서 room 정보 불러오기s
                var roomManageDict = await hashtableStore.getAllHashTable(room, 'roomManage'); // 딕셔너리 형태
                console.log('!!!~~룸정보 roomManage', roomManageDict);


                // 경우 1 : 다른 팀의 자리가 있어서 바로 변경 가능
                console.log("@roomManageDict.blackUserCnt : ", roomManageDict.blackUserCnt);
                console.log("@roomManageDict.whiteUserCnt : ", roomManageDict.whiteUserCnt);
                var limitedUser = parseInt(roomManageDict.maxPlayer / 2);
                if ((prevTeam == true &&  parseInt(roomManageDict.blackUserCnt) < limitedUser) || (prevTeam == false && parseInt(roomManageDict.whiteUserCnt) < limitedUser))
                {                
                    // 1. room의 사용자 team 정보 바꾸기
                    console.log("[case1] PlayersInfo : ", playerInfo);
                    playerInfo.team = !prevTeam;
                    socket.team = !prevTeam;;
                    playerInfo.status = 0; 

                    if(prevTeam){ // white팀이면
                        -- roomManageDict.whiteUserCnt ; 
                        ++ roomManageDict.blackUserCnt ; 
                    }else{
                        // black팀이면
                        ++ roomManageDict.whiteUserCnt; 
                        -- roomManageDict.blackUserCnt ; 
                    }

                    // 수정사항 REDIS 저장
                    await hashtableStore.storeHashTable(room, roomManageDict, 'roomManage');
  
                    // UI 위치 할당
                    await DeplaceUser(room, prevTeam, prevPlace);
                    playerInfo.place = await PlaceUser(room, !prevTeam);
      
                    // 수정사항 REDIS 저장
                    console.log("[찐최종 저장 ] playerInfo : ", playerInfo);
                    await redis_room.updateMember(room, socket.userID, playerInfo);


                    // 2. 바뀐 정보 클라쪽에 보내기
                    var changeInfo = { 
                        type : 1,
                        player1 : playerInfo, // 이전 ->수정 후 v3
                    };

                    var teamChangeInfo = JSON.stringify(changeInfo);
                    console.log('check : ', teamChangeInfo);
                    io.sockets.in(socket.room).emit('updateTeamChange',teamChangeInfo);
                }else{

                    // 경우 2 : full 상태라 1:1로 팀 change를 해야되는 상황 
                    console.log("[case2]  ");

                    // 경우 2-1 : 상대팀에서 팀 변경 원하는 사람이 있는지 확인 
                    var othersWaitingField, myWaitingField;
                    if (prevTeam){ //현재 팀 바꾸길 원하는 사용자가 화이트->블랙이므로, toWhiteUsers가 있는지 확인하기 
                        othersWaitingField = 'toWhiteUsers';
                        myWaitingField = 'toBlackUsers';
                    }
                    else{ 
                        othersWaitingField = 'toBlackUsers';
                        myWaitingField = 'toWhiteUsers';
                    }

                    var othersWaitingData = await hashtableStore.getHashTableFieldValue(room, [othersWaitingField], 'roomManage');
                    var myWaitingData = await hashtableStore.getHashTableFieldValue(room, [myWaitingField], 'roomManage');
                    console.log("othersWaitingListData : " , othersWaitingData);
                    console.log("othersWaitingListData[0].length : " , othersWaitingData[0].length);
                    console.log("myWaitingListData : " , myWaitingData);
                    console.log("myWaitingListData[0].length : " , myWaitingData[0].length);

                    // 널처리
                    var otherswaitingList;
                    var mywaitingList;

                    if (othersWaitingData[0].length != 0){
                        otherswaitingList = othersWaitingData[0].split(',');
                    }else{
                        otherswaitingList = []
                    }

                    if (myWaitingData[0].length != 0){
                        mywaitingList = myWaitingData[0].split(',');
                    } else{
                        mywaitingList = []
                    }
           
                    console.log("otherswaitingList : " , otherswaitingList);
                    console.log("mywaitingList : " , mywaitingList);
               
                    // 맞교환할 사람이 없으면 웨이팅리스트에 추가
                    if (otherswaitingList.length == 0){
                        console.log("맞교환 X - 웨이팅리스트에 추가");
                        mywaitingList.push(socket.userID);
                        // mywaitingList.push({ socketID : socket.id, userID : socket.userID});
                        console.log("check mywaitingList : " , mywaitingList);
                        await hashtableStore.updateHashTableField(room, myWaitingField, mywaitingList.join(','), 'roomManage');
                    }else{
                        // 맞교환 진행
                        console.log("맞교환 O");
                                 
                        var mateUserID = otherswaitingList.shift();
                        console.log("mateUserID : ", mateUserID);
                        await hashtableStore.updateHashTableField(room, othersWaitingField, otherswaitingList.join(','), 'roomManage');
                        
                        var matePlayerInfo = await redis_room.getMember(room, mateUserID);
                        console.log("mate 정보 : " , matePlayerInfo);
                        console.log("나 정보 : " , playerInfo);
                        
                        // player간 자리 및 정보 교환
                        var tmp_place = playerInfo.place;

                        playerInfo.place = matePlayerInfo.place;
                        playerInfo.team = !playerInfo.team ;
                        playerInfo.status = 0;
                        socket.team = playerInfo.team;

                        matePlayerInfo.place = tmp_place;
                        matePlayerInfo.team = !matePlayerInfo.team ;
                        matePlayerInfo.status = 0;

                        await redis_room.updateMember(room, socket.userID, playerInfo);
                        await redis_room.updateMember(room, mateUserID, matePlayerInfo);

                        //  바뀐 정보 클라쪽에 보내기
                        var changeInfo = { 
                            type : 2,
                            player1 : playerInfo, 
                            player2 : matePlayerInfo
                        };

                        var teamChangeInfo = JSON.stringify(changeInfo);
                        console.log('check : ', teamChangeInfo);
                        io.sockets.in(socket.room).emit('updateTeamChange',teamChangeInfo);
                        
                        // 상대방 socketID로 1:1로 보냄 
                        io.to(matePlayerInfo.socketID).emit('onTeamChangeType2');
                    }

                }
            }
        });  

        socket.on('updateSocketTeam',async()=> {
            socket.team = !socket.team;
            console.log("updateSocketTeam : " ,socket.team);
        });

        // [WaitingRoom] WaitingRoom에서 나갈 시 (홈버튼 클릭)
        socket.on('leaveRoom', async()=> {
            console.log(">>>>> [leaveRoom]!");

            var roomPin = socket.room;
         
            await leaveRoom(socket, roomPin);
        });


        // [WaitingRoom] 게임 스타트 누를 시에 모든 유저에게 전달
        socket.on('Game Start',  async() =>{
            // 사용자 정보 팀 별로 불러오기
            var blackUsersInfo = []; 
            var whiteUsersInfo = [];
            let infoJson = {};
            
            var RoomMembersList =  await redis_room.RoomMembers(socket.room);
            for (const member of RoomMembersList){
                var playerInfo = await redis_room.getMember(socket.room, member);
                if (playerInfo.team == false) {
                    infoJson = {UsersID : playerInfo.userID, UsersProfileColor : playerInfo.color}
                    blackUsersInfo.push(infoJson);
                }
                else {
                    infoJson = {UsersID : playerInfo.userID, UsersProfileColor : playerInfo.color}
                    whiteUsersInfo.push(infoJson);
                }
            }
            console.log("blackUsersInfo 배열 : ", blackUsersInfo);
            console.log("whiteUsersInfo 배열 : ", whiteUsersInfo);
               
            // 게임 관련 Json 생성 (new)
            var roomTotalJson = InitGame(socket.room, blackUsersInfo, whiteUsersInfo);
            
            // monitoringLog 생성
            var monitoringLog = [];
            jsonStore.storejson(monitoringLog, socket.room+":blackLog");
            jsonStore.storejson(monitoringLog, socket.room+":whiteLog");
            // var test = JSON.parse(await jsonStore.getjson(socket.room+":blackLog"))[0];
            // console.log("monitoringLog INIT test >> ", test);

            var monitoringLog2 = {time: "12:34:56", nickname: "test1", targetCompany: "companyA", targetSection: "Area_DMZ", actionType: "monitoring", detail: "dddd 공격을 수행했습니다."};

            // redis에 저징
            jsonStore.storejson(roomTotalJson, socket.room);

            // socket.broadcast.to(socket.room).emit('onGameStart');  //ver0
            io.sockets.in(socket.room).emit('onGameStart'); // ver1/
        });

        //  [WaitingRoom] GameStart로 모든 클라이언트의 on을 받는 함수로 팀별로 room join하여 씬 이동함 
        socket.on('joinTeam', async() => {
            // 팀별로 ROOM 추가 join
            socket.roomTeam = socket.room + socket.team.toString();
            // console.log("@@ socket.nickname : " , socket.nickname, " socket.roomTeam  : ",  socket.roomTeam);
            socket.join(socket.roomTeam);

            socket.emit('loadMainGame', socket.team.toString()); //ver3
            // io.sockets.in(socket.room+'false').emit('onBlackGameStart');// ver2
            // io.sockets.in(socket.room+'true').emit('onWhiteGameStart');// ver2
        });


        // [MainGame] 게임 시작시 해당 룸의 사용자 정보 넘김
        socket.on('InitGame',  async() =>{
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("On Main Map roomTotalJson : ", roomTotalJson);

            let abandonStatusList = [];
            for(let company of companyNameList){
                abandonStatusList.push(roomTotalJson[0][company]["abandonStatus"]);
            }

            var pitaNum;
            let teamProfileJson = {}
            let userId = []
            if (socket.team == true){
                pitaNum = roomTotalJson[0]["whiteTeam"]["total_pita"];
                for (const userID in roomTotalJson[0]["whiteTeam"]["users"]){
                    teamProfileJson[userID] = roomTotalJson[0]["whiteTeam"]["users"][userID]["profileColor"];
                    userId.push(userID);
                }

            } else {
                pitaNum = roomTotalJson[0]["blackTeam"]["total_pita"];
                for (const userID in roomTotalJson[0]["blackTeam"]["users"]){
                    teamProfileJson[userID] = roomTotalJson[0]["blackTeam"]["users"][userID]["profileColor"];
                    userId.push(userID);
                }
            }

            console.log("teamprofileColor 정보 :", teamProfileJson);

            var room_data = { 
                teamName : socket.team,
                pita : pitaNum,
                teamProfileColor : teamProfileJson,
                userID : userId,
                teamNum : userId.length
            };
            var roomJson = JSON.stringify(room_data);


            console.log("Team 정보 :", socket.team);
            console.log("room 정보 :", socket.room);
            console.log("roomJson!! :",roomJson);
            // io.sockets.in(socket.room).emit('MainGameStart', roomJson);
            socket.emit('MainGameStart', roomJson);
            
            console.log("On Main Map abandonStatusList : ", abandonStatusList);
            io.sockets.in(socket.room).emit('Company Status', abandonStatusList);

            // io.sockets.emit('Visible LimitedTime', socket.team.toString()); // actionbar
            console.log("[[[InitGame]] socket.nickname, team : ", socket.nickname, socket.team);
            socket.emit('Visible LimitedTime', socket.team.toString()); // actionbar

            // Timer 시작
            var time = 600; //600=10분, 1분 -> 60
            var min = "";
            var sec = "";

            // 게임 시간 타이머 
            io.sockets.in(socket.room).emit('Timer START');
            timerId = setInterval(function(){
                min = parseInt(time/60);
                sec = time%60;
                // console.log("TIME : " + min + "분 " + sec + "초");
                time--;
                if(time<=0) {
                    console.log("시간종료!");
                    io.sockets.in(socket.room).emit('Timer END');
                    clearInterval(timerId);
                    clearInterval(pitaTimerId);
                }
            }, 1000);

            // pita 10초 간격으로 pita 지급
            var pitaInterval= config.BLACK_INCOME.time * 1000; // black, white 동일함 * 1000초
            // console.log("[TEST] pitaInterval :", pitaInterval);
            pitaTimerId = setInterval(async function(){
                const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

                roomTotalJson[0].blackTeam.total_pita += config.BLACK_INCOME.pita;
                roomTotalJson[0].whiteTeam.total_pita += config.WHITE_INCOME.pita;

                var black_total_pita = roomTotalJson[0].blackTeam.total_pita;
                var white_total_pita = roomTotalJson[0].whiteTeam.total_pita;

                await jsonStore.updatejson(roomTotalJson[0], socket.room);

                console.log("!!! [월급 지급] black_total_pita : " + black_total_pita + " white_total_pita : " + white_total_pita);
                
                io.sockets.in(socket.room+'false').emit('Update Pita', black_total_pita);
                io.sockets.in(socket.room+'true').emit('Update Pita', white_total_pita);
                // io.sockets.in(socket.room).emit("Load Pita Num", black_total_pita);
    
            }, pitaInterval);


        });
        


        // 무력화 test (나중에 삭제해야됨)
        socket.on('TestNeutralization', async function() {
            console.log("[On] TestNeutralization 스키마에 경고 추가 및 isBlocked True");
            // console.log("[Emit] OnNeutralization");

            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            // 회사 A, C 에 경고 3번으로 무력화 true
            roomTotalJson[0].blackTeam.users[socket.userID].companyA.warnCnt = 3;
            roomTotalJson[0].blackTeam.users[socket.userID].companyA.IsBlocked = true;

            roomTotalJson[0].blackTeam.users[socket.userID].companyC.warnCnt = 3;
            roomTotalJson[0].blackTeam.users[socket.userID].companyC.IsBlocked = true;


            // console.log("[CHECK] roomTotalJson[0].blackTeam.users[socket.userID] : ", roomTotalJson[0].blackTeam.users[socket.userID]);
            await jsonStore.updatejson(roomTotalJson[0], socket.room);

            socket.emit('OnNeutralization', true);            
        });

        // 특정 회사가 무력화인지 확인
        socket.on('Check Neutralization',  async function(company) {
            console.log("[On] Check Neutralization ", company);

            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            // 회사 isBlocked 정보 가져옴
            var companyIsBlocked = roomTotalJson[0].blackTeam.users[socket.userID][company].IsBlocked;
            console.log("!-- companyIsBlocked : ", companyIsBlocked);
            
            // null 처리
            if (!companyIsBlocked){
                companyIsBlocked = false;
                console.log("!-- companyIsBlocked NULL처리 : ", companyIsBlocked);
            }
            
            socket.emit('OnNeutralization', companyIsBlocked);
        });


        // 무력화 해결 시도 시
        socket.on('Try Non-neutralization', async(company)=> {
            console.log("[On] Solve Neutralization company :", company);
          
            //  json 불러와서 해당 영역 회사 경고 초기화 함 
            var roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("JSON!!!",roomTotalJson);
            
            var black_total_pita = roomTotalJson[0].blackTeam.total_pita;
            console.log("blackTeam.total_pita!!!", black_total_pita );


            // 무력화 상태인지 확인
            var companyIsBlocked = roomTotalJson[0].blackTeam.users[socket.userID][company].IsBlocked;
            console.log("!-- companyIsBlocked : ", companyIsBlocked);
            if (!companyIsBlocked)
            {
                console.log("무력화 상태 아님!");
                socket.emit('After non-Neutralization', false);
            }else{
                // 가격화 
                if (black_total_pita - config.UNBLOCK_INFO.pita < 0){
                    console.log("무력화 해제 실패!");
                    socket.emit('After non-Neutralization', false);
                }
                else{
                    // isBlocked 해제
                    roomTotalJson[0].blackTeam.users[socket.userID][company].IsBlocked = false;
                    // pita 가격 마이너스
                    roomTotalJson[0].blackTeam.total_pita = black_total_pita - config.UNBLOCK_INFO.pita;
                    
                    await jsonStore.updatejson(roomTotalJson[0], socket.room);
                    io.sockets.in(socket.room+'false').emit('Update Pita', roomTotalJson[0].blackTeam.total_pita );

                    console.log("무력화 해제 성공!");
                    socket.emit('After non-Neutralization', true);

                    // [GameLog] 로그 추가 - 무력화 해제 로그
                    const blackLogJson = JSON.parse(await jsonStore.getjson(socket.room+":blackLog"));

                    let today = new Date();   
                    let hours = today.getHours(); // 시
                    let minutes = today.getMinutes();  // 분
                    let seconds = today.getSeconds();  // 초
                    let now = hours+":"+minutes+":"+seconds;
                    var monitoringLog = {time: now, nickname: socket.nickname, targetCompany: company, targetSection: "", actionType: "Neutralization", detail: socket.nickname+"무력화 해제되었습니다."};

                    blackLogJson[0].push(monitoringLog);
                    await jsonStore.updatejson(blackLogJson[0], socket.room+":blackLog");

                    var logArr = [];
                    logArr.push(monitoringLog);
                    // socket.emit('BlackLog', logArr);
                    // socket.to(socket.room).emit('BlackLog', logArr);
                    io.sockets.in(socket.room+'false').emit('addLog', logArr);
                    console.log("무력화 해제 성공!");
                    socket.emit('After non-Neutralization', true);
                }
            }
        });

        ////////////////////////////////////////////////////////////////////////////////////
        // PlayerEnter
        // socket.on('PlayerEnter', function() {
        //     console.log("Players >> ");
        //     const rand_Color = Math.floor(Math.random() * 12);
        //     // eval("Players.player" + numPlayer + " = playerInfo")
        //     let playerOrder = "player" + numPlayer;
        //     let playerInfo = {playerOrder: playerOrder, socket: socket.id, nickname: socket.nickname, readyStatus: false, teamStatus: false, team: evenNumPlayer, color: rand_Color};
        //     Players.push(playerInfo);
        //     gamePlayer.player = Players;
        //     // Players[Players.length]=playerInfo;
        //     console.log("PlayersInfo", numPlayer, " >> ", playerInfo);
        //     console.log("Players >> ", Players);
        //     console.log("gamePlayer >> ", gamePlayer);

        //     if (evenNumPlayer == false){
        //         evenNumPlayer = true;
        //     } else {
        //         evenNumPlayer = false;
        //     }

        //     numPlayer = numPlayer + 1;
            
        //     // JSON 형식으로 유니티에 데이터 보내기

        //     var PlayersJson = JSON.stringify(gamePlayer);
        //     console.log("jsonStringify : ", PlayersJson.toString());
        //     socket.emit('PlayersData', PlayersJson);
        // });
        
        // socket.on('changeStatus', function(jsonStr) {
        //     let changePlayerInfo = JSON.parse(jsonStr);        
    
        //     console.log('new Player info Jsong string : ', jsonStr);
        //     console.log('new Player info gamePlayer : ', changePlayerInfo);

        //     let playerNum = changePlayerInfo["playerNum"];
        //     let ready = (changePlayerInfo["readyStatus"] == 'True') ? true : false;
        //     let teamChange = (changePlayerInfo["teamStatus"] == 'True') ? true : false;

        //     gamePlayer.player[playerNum]["readyStatus"] = ready;
        //     gamePlayer.player[playerNum]["teamStatus"] = teamChange;

        //     console.log("new josn file : ", gamePlayer);

        //     var PlayersJson = JSON.stringify(gamePlayer);
        //     console.log("jsonStringify : ", PlayersJson.toString());
        //     socket.emit('PlayersData', PlayersJson);
        // });

        // socket.on('changeColor', function(jsonStr) {
        //     let changePlayerInfo = JSON.parse(jsonStr);

        //     console.log('new Player info Jsong string : ', jsonStr);
        //     console.log('new Player info gamePlayer : ', changePlayerInfo);

        //     let playerNum = changePlayerInfo["playerNum"];
        //     let colorNum = changePlayerInfo["value"];

        //     gamePlayer.player[playerNum]["color"] = colorNum;

        //     console.log("new josn file : ", gamePlayer);

        //     var PlayersJson = JSON.stringify(gamePlayer);
        //     console.log("jsonStringify : ", PlayersJson.toString());
        //     socket.emit('PlayersData', PlayersJson);
        // });


        ////////////////////////////////////////////////////////////////////////////////////
        // 회사 선택 후 사용자들에게 위치 알리기
        socket.on("Select Company", async(CompanyName) => {
            
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("Select Company CompanyIndex : ", CompanyName);

            let teamLocations = {};
            let teamLocationsJson = "";

            if (socket.team == true) {
                roomTotalJson[0]["whiteTeam"]["users"][socket.userID]["currentLocation"] = CompanyName;
                for (const userID in roomTotalJson[0]["whiteTeam"]["users"]){
                    teamLocations[userID] = roomTotalJson[0]["whiteTeam"]["users"][userID]["currentLocation"];
                }
                
                teamLocationsJson = JSON.stringify(teamLocations);
                console.log("teamLocationsJson : ", teamLocationsJson);
                socket.to(socket.room+'true').emit("Load User Location", teamLocationsJson);
            } else {
                roomTotalJson[0]["blackTeam"]["users"][socket.userID]["currentLocation"] = CompanyName;
                for (const userID in roomTotalJson[0]["blackTeam"]["users"]){
                    teamLocations[userID] = roomTotalJson[0]["blackTeam"]["users"][userID]["currentLocation"];
                }

                teamLocationsJson = JSON.stringify(teamLocations);
                console.log("teamLocationsJson : ", teamLocationsJson);
                socket.to(socket.room+'false').emit("Load User Location", teamLocationsJson);
            }

            socket.emit("Load User Location", teamLocationsJson);

            await jsonStore.updatejson(roomTotalJson[0], socket.room);
        });


        socket.on("Back to MainMap", async() => {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            let teamLocations = {};
            let teamLocationsJson = "";

            if (socket.team == true) {
                roomTotalJson[0]["whiteTeam"]["users"][socket.userID]["currentLocation"] = "";
                for (const userID in roomTotalJson[0]["whiteTeam"]["users"]){
                    teamLocations[userID] = roomTotalJson[0]["whiteTeam"]["users"][userID]["currentLocation"];
                }

                teamLocationsJson = JSON.stringify(teamLocations);
                console.log("teamLocationsJson : ", teamLocationsJson);
                socket.to(socket.room+'true').emit("Load User Location", teamLocationsJson);
            } else {
                roomTotalJson[0]["blackTeam"]["users"][socket.userID]["currentLocation"] = "";
                for (const userID in roomTotalJson[0]["blackTeam"]["users"]){
                    teamLocations[userID] = roomTotalJson[0]["blackTeam"]["users"][userID]["currentLocation"];
                }

                teamLocationsJson = JSON.stringify(teamLocations);
                console.log("teamLocationsJson : ", teamLocationsJson);
                socket.to(socket.room+'false').emit("Load User Location", teamLocationsJson);
            }
            
            socket.emit("Load User Location", teamLocationsJson);

            await jsonStore.updatejson(roomTotalJson[0], socket.room);
            roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
        });

        socket.on("Section Activation Check", async(companyName) => {
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            var activationList = [];
            for (let i = 0; i <roomTotalJson[0][companyName]["sections"].length; i++){
                console.log("[Section Activation Check] roomTotalJson[0][companyName]['sections'][i] : ", roomTotalJson[0][companyName]["sections"][i]);
                console.log("[Section Activation Check] roomTotalJson[0][companyName]['sections'][i]['activation'] : ", roomTotalJson[0][companyName]["sections"][i]["activation"]);
                activationList.push(roomTotalJson[0][companyName]["sections"][i]["activation"]);
            }

            console.log("[Section Activation List] activationList : ", activationList);

            socket.emit("Section Activation List", companyName, activationList);
        });


        // 게임 카드 리스트 보내기
        socket.on("Load Card List", async(teamData) => {            
            let teamDataJson = JSON.parse(teamData);

            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("Load card list teamData : ", teamDataJson);
            let returnArray;

            if (socket.team == true) {
                returnArray = roomTotalJson[0][teamDataJson.companyName]["penetrationTestingLV"];
                console.log("load card list return value : ", returnArray);
            } else {
                returnArray = roomTotalJson[0][teamDataJson.companyName]["attackLV"];
                console.log("load card list return value : ", returnArray);
            }

            socket.to(socket.room + socket.team).emit("Card List", teamDataJson.companyName, returnArray);
            socket.emit("Card List", teamDataJson.companyName, returnArray);
        });

        // 게임 카드 리스트 보내기
        socket.on("Load Attack Step", async(teamData) => {            
            let teamDataJson = JSON.parse(teamData);

            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("Load card list teamData : ", teamDataJson);

            if (socket.team == true){  // white 팀 response step
                console.log("Load Attack Step - sectino", roomTotalJson[0][teamDataJson.companyName]["sections"][teamDataJson.sectionIndex]);
                console.log("load response list : ", roomTotalJson[0][teamDataJson.companyName]["sections"][teamDataJson.sectionIndex]["response"]["progress"]);
                console.log("load response step : ", roomTotalJson[0][teamDataJson.companyName]["sections"][teamDataJson.sectionIndex]["responseStep"]);

                let responseProgress = []
                for(var i in roomTotalJson[0][teamDataJson.companyName]["sections"][teamDataJson.sectionIndex]["response"]["progress"]){
                    console.log("responseIndex : ", roomTotalJson[0][teamDataJson.companyName]["sections"][teamDataJson.sectionIndex]["response"]["progress"][i]);
                    responseProgress.push(Number(Object.keys(roomTotalJson[0][teamDataJson.companyName]["sections"][teamDataJson.sectionIndex]["response"]["progress"][i])));
                }

                console.log("responseProgress : ", responseProgress)

                socket.to(socket.room+'true').emit("Load Response List", teamDataJson.companyName, teamDataJson.sectionIndex, responseProgress, roomTotalJson[0][teamDataJson.companyName]["sections"][teamDataJson.sectionIndex]["responseStep"] - 1);
                socket.emit("Load Response List", teamDataJson.companyName, teamDataJson.sectionIndex, responseProgress, roomTotalJson[0][teamDataJson.companyName]["sections"][teamDataJson.sectionIndex]["responseStep"] - 1);

                // socket.to(socket.room+'true').emit("Response Step", roomTotalJson[0][teamDataJson.companyName]["sections"][teamDataJson.sectionIndex]["responseStep"] - 1);
                // socket.emit("Response Step", roomTotalJson[0][teamDataJson.companyName]["sections"][teamDataJson.sectionIndex]["responseStep"] - 1);
            } else {  // black 팀 attack step
                let step = roomTotalJson[0][teamDataJson.companyName]["sections"][teamDataJson.sectionIndex]["attackStep"];
                console.log("roomTotalJson[0][teamDataJson.companyName]['sections'][teamDataJson.sectionIndex]", roomTotalJson[0][teamDataJson.companyName]["sections"][teamDataJson.sectionIndex]);

                console.log("load attack step : ", step);

                socket.to(socket.room+'false').emit("Attack Step", teamDataJson.companyName, teamDataJson.sectionIndex, step);
                socket.emit("Attack Step", teamDataJson.companyName, teamDataJson.sectionIndex, step);
            }
        });

        // 공격을 수행하였을 때 결과 처리 및 total pita 정보 보내기
        socket.on("Click Attack", async(attackData) => {
            console.log("Click Attack jsonStr : ", attackData);
            let attackJson = JSON.parse(attackData);

            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("White Team Response list (before) : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["progress"]);
            console.log("Black Team Attack list (before) : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["progress"]);
            console.log("Click Response responseJson : ", attackJson);
            console.log("attack step load json : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attackStep"]);

            

            let cardLv = roomTotalJson[0][attackJson.companyName]["penetrationTestingLV"][attackJson.attackIndex];
            let pitaNum;
            if (attackJson.teamName == true) {
                pitaNum = roomTotalJson[0]['whiteTeam']['total_pita'] - config["ATTACK_" + (attackJson.attackIndex + 1)]['pita'][cardLv - 1];
                roomTotalJson[0]['whiteTeam']['total_pita'] = pitaNum;

                console.log("[!!!!!] pita num : ", pitaNum);

            } else {
                pitaNum = roomTotalJson[0]['blackTeam']['total_pita'] - config["ATTACK_" + (attackJson.attackIndex + 1)]['pita'][cardLv - 1];
                roomTotalJson[0]['blackTeam']['total_pita'] = pitaNum;

                console.log("[!!!!!] pita num : ", pitaNum);
            }

            if (pitaNum >= 0){
                socket.emit("Continue Event");

                socket.to(socket.room + socket.team).emit('Update Pita', pitaNum);
                socket.emit('Update Pita', pitaNum);

                // 만약 1단계 공격이라면 그에 맞는 공격만 효과가 있음
                if (0 <= attackJson.attackIndex && attackJson.attackIndex < 4){
                    if (attackJson.attackIndex == roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["vuln"]){
                        console.log("attack success : ", attackJson.attackIndex)

                        var attackList = roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["progress"];
                        var responseList = roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["progress"];
                        var existAttack = false;
                        for(var i = 0; i < attackList.length; i++){ 
                            console.log("공격 수행 여부 attackList[i] : ", attackList[i]);
                            if (Object.keys(attackList[i]) == attackJson.attackIndex || Object.keys(responseList[i]) == attackJson.attackIndex) { 
                                existAttack = true;
                                break;
                            }
                        }

                        console.log("공격 수행 여부 : ", existAttack);

                        if (!existAttack){
                            let json = new Object();
                            json[attackJson.attackIndex] = socket.userID;
                            roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["progress"].push(json);
                            roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["last"] = attackJson.attackIndex;
                            step = 1;
                
                            console.log("결정된 인덱스 별 step : ", 1);
                            await attackCount(socket, roomTotalJson, attackJson, cardLv, 1);
                            await monitoringCount(socket, roomTotalJson, attackJson, cardLv);
                        } else {
                            console.log("이미 수행한 공격입니다.");
                            await monitoringCountBlocked(socket, roomTotalJson, attackJson, cardLv);
                        }
                        
                    } else {
                        console.log("취약점이 아닌 공격입니다.");
                        await monitoringCountBlocked(socket, roomTotalJson, attackJson, cardLv);
                    }
                } else {

                    let step; // attack Step
                    if (attackJson.attackIndex == 4){
                        step = 2;
                    } else if (attackJson.attackIndex == 5){
                        step = 3;
                    } else if (attackJson.attackIndex == 6){
                        step = 4;
                    } else if (7 <= attackJson.attackIndex && attackJson.attackIndex <= 10){
                        step = 5;
                    } else if (11 <= attackJson.attackIndex && attackJson.attackIndex <= 12){
                        step = 6;
                    }

                    var attackList = roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["progress"];
                    var responseList = roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["progress"];
                    var existAttack = false;
                    for(var i = 0; i < attackList.length; i++){ 
                        if (Object.keys(attackList[i]) == attackJson.attackIndex || Object.keys(responseList[i]) == attackJson.attackIndex) { 
                            existAttack = true;
                            break;
                        }
                    }

                    if (!existAttack){

                            let json = new Object();
                            json[attackJson.attackIndex] = socket.userID;
                            roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["progress"].push(json);
                            roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["last"] = attackJson.attackIndex;
                    
                            console.log("결정된 인덱스 별 step : ", step);
                            await attackCount(socket, roomTotalJson, attackJson, cardLv, step);
                            await monitoringCount(socket, roomTotalJson, attackJson, cardLv);
                    } else {
                        console.log("이미 수행한 공격입니다.");
                        await monitoringCountBlocked(socket, roomTotalJson, attackJson, cardLv);
                    }
                    
                }
            } else {
                console.log("공격 실패! >> Pita 부족");
                socket.emit("Short of Money");

                if (attackJson.teamName == true) {
                    pitaNum = roomTotalJson[0]['whiteTeam']['total_pita'] + config["ATTACK_" + (attackJson.attackIndex + 1)]['pita'][cardLv - 1];
                    roomTotalJson[0]['whiteTeam']['total_pita'] = pitaNum;
    
                    console.log("[!!!!!] pita num : ", pitaNum);
    
                } else {
                    pitaNum = roomTotalJson[0]['blackTeam']['total_pita'] + config["ATTACK_" + (attackJson.attackIndex + 1)]['pita'][cardLv - 1];
                    roomTotalJson[0]['blackTeam']['total_pita'] = pitaNum;
    
                    console.log("[!!!!!] pita num : ", pitaNum);
                }
            }

            // step = roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["attackStep"];
            console.log("roomTotalJson[0][attackJson.companyName]['sections'][attackJson.sectionIndex] : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]);
            // console.log("attack step update : ", step);
            

            await jsonStore.updatejson(roomTotalJson[0], socket.room);
            roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("attack step after update json : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attackStep"]);
            console.log("attack step after destroy status json : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["destroyStatus"]);
        });

        // 공격을 수행하였을 때 결과 처리 및 total pita 정보 보내기
        socket.on("Click Response", async(responseData) => {
            console.log("Click Attack jsonStr : ", responseData);
            let responseJson = JSON.parse(responseData);

            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("White Team Response list (Click Response before) : ", roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["response"]["progress"]);
            console.log("Black Team Attack list (Click Response before) : ", roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["attack"]["progress"]);
            console.log("Click Response responseJson : ", responseJson);
            console.log("response step load json : ", roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["responseStep"]);

            let cardLv = roomTotalJson[0][responseJson.companyName]["penetrationTestingLV"][responseJson.attackIndex];

            // pita 감소
            let pitaNum;
            if (roomTotalJson[0]['blackTeam']['total_pita'] - config["RESPONSE_" + (responseJson.attackIndex + 1)]['pita'][cardLv - 1] >= 0){
                socket.emit("Continue Event");

                pitaNum = roomTotalJson[0]['blackTeam']['total_pita'] - config["RESPONSE_" + (responseJson.attackIndex + 1)]['pita'][cardLv - 1];
                roomTotalJson[0]['blackTeam']['total_pita'] = pitaNum;
                console.log("[!!!!!] pita num : ", pitaNum);

                await responseCount(socket, roomTotalJson, responseJson, cardLv);
            } else {
                console.log("방어 실패!! >> pita 부족")
                socket.emit("Short of Money");
            }
            
        });


        // 모의해킹 혹은 연구를 수행하였을 때 결과 처리 및 total pita 정보 보내기
        socket.on("Click Upgrade Attack", async(upgradeJson) => {
            let upgradeAttackInfo = JSON.parse(upgradeJson);

            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("Update card list upgradeAttackInfo : ", upgradeAttackInfo);

            let cardLv;
            let pitaNum;
            if (socket.team == true) {
                console.log("white team upgrade attack card");
                cardLv = roomTotalJson[0][upgradeAttackInfo.companyName]["penetrationTestingLV"][upgradeAttackInfo.attackIndex];
                pitaNum = roomTotalJson[0]['whiteTeam']['total_pita'] - config["MONITORING_" + (upgradeAttackInfo.attackIndex + 1)]['pita'][cardLv];
                roomTotalJson[0]['whiteTeam']['total_pita'] = pitaNum;

                console.log("[!!!!!] pita num : ", pitaNum);
            } else {
                console.log("black team upgrade attack card");
                cardLv = roomTotalJson[0][upgradeAttackInfo.companyName]["attackLV"][upgradeAttackInfo.attackIndex];
                console.log("team total_pita : ", roomTotalJson[0]['blackTeam']['total_pita'], ", config pita : ", config["MONITORING_" + (upgradeAttackInfo.attackIndex + 1)]['pita'][cardLv]);
                pitaNum = roomTotalJson[0]['blackTeam']['total_pita'] - config["MONITORING_" + (upgradeAttackInfo.attackIndex + 1)]['pita'][cardLv];
                roomTotalJson[0]['blackTeam']['total_pita'] = pitaNum;

                console.log("[!!!!!] pita num : ", pitaNum);
            }

            if (pitaNum >= 0){
                socket.emit("Continue Event");
                
                socket.to(socket.room + socket.team).emit('Update Pita', pitaNum);
                socket.emit('Update Pita', pitaNum);

                if (socket.team == true) {
                    console.log("white team upgrade attack card");
                    roomTotalJson[0][upgradeAttackInfo.companyName]["penetrationTestingLV"][upgradeAttackInfo.attackIndex] += 1;
                } else {
                    console.log("black team upgrade attack card");
                    roomTotalJson[0][upgradeAttackInfo.companyName]["attackLV"][upgradeAttackInfo.attackIndex] += 1;
                }

                

                console.log("Update card list roomTotalJson : ", roomTotalJson[0][upgradeAttackInfo.companyName]);

                await jsonStore.updatejson(roomTotalJson[0], socket.room);
                roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
                console.log("Update card list update roomTotalJson : ", roomTotalJson);
                let returnValue;

                if (socket.team == true) {
                    returnValue = roomTotalJson[0][upgradeAttackInfo.companyName]["penetrationTestingLV"];
                } else {
                    returnValue = roomTotalJson[0][upgradeAttackInfo.companyName]["attackLV"];
                }

                // 나중에 white와 black 구분해서 보내기
                console.log("Update Card List Return Value : ", returnValue);
                socket.to(socket.room + socket.team).emit("Card List", upgradeAttackInfo.companyName, returnValue);
                socket.emit("Card List", upgradeAttackInfo.companyName, returnValue);
            } else {
                console.log("업그레이드 실패!! >> pita 부족");
                socket.emit("Short of Money");
            }

            

        });


        // 회사 몰락 여부 확인
        socket.on('On Main Map', async() => {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("On Main Map roomTotalJson : ", roomTotalJson);

            let abandonStatusList = [];
            for(let company of companyNameList){
                abandonStatusList.push(roomTotalJson[0][company]["abandonStatus"]);
            }

            console.log("On Main Map abandonStatusList : ", abandonStatusList);
            socket.to(socket.room).emit('Company Status', abandonStatusList);
            socket.emit('Company Status', abandonStatusList);
        })
        

        socket.on('On Monitoring', async(companyName) => {
            console.log("On Monitoring companyName : ", companyName);
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            let company_blockedNum = 0;

            for (var userId in roomTotalJson[0]["blackTeam"]["users"]){
                console.log("[On Monitoring] user id : ", userId);
                if (roomTotalJson[0]["blackTeam"]["users"][userId][companyName]["IsBlocked"] == true){
                    company_blockedNum += 1;
                }
            }

            console.log("[On Monitoring] company_blockedNum : ", company_blockedNum);
        
            socket.to(socket.room+'true').emit("Blocked Num", company_blockedNum);
            socket.emit('Blocked Num', company_blockedNum);


        })


// ===================================================================================================================
        // ## [Section] 영역 클릭 시 
        socket.on('Section_Name', async(data) => {
            console.log('[Section - Click Section] Click Area Info  : ', data);
            data = JSON.parse(data);

            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var white_total_pita = roomTotalJson[0].whiteTeam.total_pita;
            console.log("Before White total_pita!!!", white_total_pita );

            var corpName = data.Corp;
            var sectionIdx = data.areaIdx;
            
            if(white_total_pita - config.MAINTENANCE_SECTION_INFO.pita[roomTotalJson[0][corpName].sections[sectionIdx].level] < 0)
            {
                console.log("[Maintainance] 피타 부족");
                socket.emit("Short of Money");
            } else {
                // 최대 레벨 확인
                if(roomTotalJson[0][corpName].sections[sectionIdx].level >= config.MAX_LEVEL){
                    console.log("섹션 최대 레벨");
                } else {
                    // json 변경 - pita 감소
                    var newTotalPita = white_total_pita - config.MAINTENANCE_SECTION_INFO.pita[roomTotalJson[0][corpName].sections[sectionIdx].level]; //pita 감소
                    roomTotalJson[0].whiteTeam.total_pita = newTotalPita;
                    roomTotalJson[0][corpName].sections[sectionIdx].level += 1; // 레벨 증가
                    await jsonStore.updatejson(roomTotalJson[0], socket.room);

                    // update 확인(추후 삭제)
                    var NewRoomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
                    console.log("After White total_pita!!!", white_total_pita - config.MAINTENANCE_SECTION_INFO.pita[roomTotalJson[0][corpName].sections[sectionIdx].level] );
                    console.log("================= After UPDATE ================= : ", NewRoomTotalJson[0][corpName].sections[sectionIdx]);

                    var area_level = sectionIdx.toString() + "-" + (roomTotalJson[0][corpName].sections[sectionIdx].level);
                    io.sockets.in(socket.room+'true').emit('New_Level', corpName, area_level.toString());
                    // socket.to(socket.room).emit("New_Level", area_level.toString());
                    // socket.emit('New_Level', area_level.toString());

                    io.sockets.in(socket.room+'true').emit('Update Pita', newTotalPita); // 화이트팀
                    // socket.to(socket.room).emit("Load Pita Num", newTotalPita);
                    // socket.emit("Load Pita Num", newTotalPita);    
                }
            }
        });

        // ## [Section] 구조도 페이지 시작 시
        socket.on('Section_Start', async (corp) => {
            console.log("Section_Start CALLED >> ");
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            var corpName = corp;
            var sectionsArr = roomTotalJson[0][corpName].sections;
            console.log("### LENGTH ### >> ", sectionsArr.length);

            for(var i=0; i<sectionsArr.length; i++){
                var sectionInfo = { Corp: corpName, areaIdx: i, level: roomTotalJson[0][corpName].sections[i].level, vuln: roomTotalJson[0][corpName].sections[i].vuln}
                console.log("[Section] sectionInfo-detail", sectionInfo);
                
                // socket.to(socket.room).emit("Area_Start_Emit", JSON.stringify(sectionInfo));
                socket.emit('Area_Start_Emit', JSON.stringify(sectionInfo));


                /*
                [Section] sectionInfo-detail { Corp: 'companyA', areaIdx: 0, level: 0, vuln: 3 }
                [Section] sectionInfo-detail { Corp: 'companyA', areaIdx: 1, level: 0, vuln: 1 }
                [Section] sectionInfo-detail { Corp: 'companyA', areaIdx: 2, level: 0, vuln: 2 }
                */
            }
        });

        // ## [PreDiscovery] 사전탐색 페이지 시작 시
        socket.on('PreDiscovery_Start', async (corp) => {
            console.log("PreDiscovery_Start CALLED >> ");
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            var corpName = corp;
            var sectionsArr = roomTotalJson[0][corpName].sections;

            for(var i=0; i<sectionsArr.length; i++){
                var sectionInfo = { Corp: corpName, areaIdx: i, vuln: roomTotalJson[0][corpName].sections[i].vuln, vulnActive: roomTotalJson[0][corpName].sections[i].vulnActive}
                console.log("[PreDiscovery] sectionInfo-detail", sectionInfo);
                
                // socket.to(socket.room).emit("PreDiscovery_Start_Emit", JSON.stringify(sectionInfo));
                socket.emit('PreDiscovery_Start_Emit', JSON.stringify(sectionInfo));


                /*
                [Section] sectionInfo-detail { Corp: 'companyA', areaIdx: 0, vuln: 3, vulnActive: false}
                [Section] sectionInfo-detail { Corp: 'companyA', areaIdx: 1, vuln: 1, vulnActive: false}
                [Section] sectionInfo-detail { Corp: 'companyA', areaIdx: 2, vuln: 2, vulnActive: false}
                */
            }
        });

        // ## [Vuln] 영역 클릭 시 
        socket.on('Get_VulnActive', async (data) => {
            console.log('[Vuln] Click Area_Name IDX : ', data);
            data = JSON.parse(data);

            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var black_total_pita = roomTotalJson[0].blackTeam.total_pita;
            console.log("Before black_total_pita!!!", black_total_pita );

            var corpName = data.Corp;
            var sectionIdx = data.areaIdx;

            var vulnIdx =  roomTotalJson[0][corpName].sections[sectionIdx].vuln;

            
            if( roomTotalJson[0][corpName].sections[sectionIdx].vulnActive == true){
                console.log("이미 취약점확인됨" + roomTotalJson[0][corpName].sections[sectionIdx].vulnActive.toString());
            }
            else if(black_total_pita - config.EXPLORE_INFO.pita < 0)
            {
                console.log("피타 부족");
                socket.emit("Short of Money");
            } else {
                // json 변경
                var newTotalPita = black_total_pita - config.EXPLORE_INFO.pita; // pita 감소
                roomTotalJson[0].blackTeam.total_pita = newTotalPita; // pita 감소
                roomTotalJson[0][corpName].sections[sectionIdx].vulnActive = true;  // vulnActive 변경
                await jsonStore.updatejson(roomTotalJson[0], socket.room);

                // 확인
                var roomTotalJsonA = JSON.parse(await jsonStore.getjson(socket.room));
                console.log("UPDATE 후에 JSON!!!",roomTotalJsonA[0]);
                console.log("After black_total_pita!!!", black_total_pita - config.EXPLORE_INFO.pita);

                io.sockets.in(socket.room+'false').emit('Area_VulnActive', corpName, sectionIdx, roomTotalJson[0][corpName].sections[sectionIdx].vulnActive);
                // socket.to(socket.room).emit("Area_VulnActive", sectionIdx, roomTotalJson[0][corpName].sections[sectionIdx].vulnActive);
                // socket.emit('Area_VulnActive', sectionIdx, roomTotalJson[0][corpName].sections[sectionIdx].vulnActive);

                io.sockets.in(socket.room+'false').emit('Update Pita', newTotalPita); // 블랙팀
                // socket.to(socket.room).emit("Load Pita Num", newTotalPita);
                // socket.emit("Load Pita Num", newTotalPita);   

                // [GameLog] 로그 추가 - 사전탐색 로그
                const blackLogJson = JSON.parse(await jsonStore.getjson(socket.room+":blackLog"));

                let today = new Date();   
                let hours = today.getHours(); // 시
                let minutes = today.getMinutes();  // 분
                let seconds = today.getSeconds();  // 초
                let now = hours+":"+minutes+":"+seconds;

                var companyIdx =  corpName.charCodeAt(7) - 65;
                var monitoringLog = {time: now, nickname: socket.nickname, targetCompany: corpName, targetSection: sectionNames[companyIdx][sectionIdx], actionType: "PreDiscovery", detail: "취약점 " +vulnArray[vulnIdx] +"이 발견되었습니다."};

                blackLogJson[0].push(monitoringLog);
                await jsonStore.updatejson(blackLogJson[0], socket.room+":blackLog");
                
                var logArr = [];
                logArr.push(monitoringLog);
                //socket.emit('BlackLog', logArr);
                //socket.to(socket.room).emit('BlackLog', logArr);
                io.sockets.in(socket.room+'false').emit('addLog', logArr);
            }
        });

        // [SectionState] Section Destroy
        socket.on('Get_Section_Destroy_State', async(corp) => {
            console.log('Get_Section_Destroy_State CALLED  : ', corp);
            
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var corpName = corp;

            //console.log("@@@@@@@@ Destroy State @@@@@@@ ",  roomTotalJson[0][corpName].sections);
            var sections = {sections: roomTotalJson[0][corpName].sections};

            // socket.to(socket.room).emit("Section_Destroy_State", JSON.stringify(sections));
            socket.emit('Section_Destroy_State', JSON.stringify(sections));
        });

        // [SectionState] Section Attacked Name TEST
        socket.on('Get_Section_Attacked_Name', async(corp) => {
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var corpName = corp;

            //console.log("@@@@@@@@ Destroy State @@@@@@@ ",  roomTotalJson[0][corpName].sections);
            var sections = {sections: roomTotalJson[0][corpName].sections}

            // socket.to(socket.room).emit("Section_Attacked_Name", JSON.stringify(sections));
            socket.emit('Section_Attacked_Name', JSON.stringify(sections));
        });

        // [SectionState] 관제 issue Count
        socket.on('Get_Issue_Count', async(corp) => {            
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            var corpName = corp;
            var sectionsArr = roomTotalJson[0][corpName].sections;

            var cntArr = [];
            for(i=0; i<sectionsArr.length; i++)
            {
                var sectionData = roomTotalJson[0][corpName].sections[i].response.progress.length;
                cntArr[i] = sectionData;
            }

            // socket.to(socket.room).emit("Issue_Count", cntArr);
            socket.emit('Issue_Count', cntArr);

        });

        // [Abandon] 한 회사의 모든 영역이 파괴되었는지 확인 후 몰락 여부 결정
        socket.on('is_All_Sections_Destroyed', async(corpName) => {
            console.log("[Abandon]is_All_Sections_Destroyed " + corpName);
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            
            var isAbondon = true;
            var sectionsArr = roomTotalJson[0][corpName].sections;
            for(i=0; i<sectionsArr.length; i++)
            {
                var isDestroy = roomTotalJson[0][corpName].sections[i].destroyStatus;
                console.log("[Abandon]isDestroy " + i+isDestroy.toString());
                if(isDestroy == false){ // 한 영역이라도 false면 반복문 나감
                    isAbondon = false;
                    break;
                }
            }
            console.log("[Abandon] isAbondon " + isAbondon);

            if(isAbondon == true){ // 회사 몰락
                console.log("[Abandon] 회사몰락 " + corpName);
                roomTotalJson[0][corpName].abandonStatus = true;
                await jsonStore.updatejson(roomTotalJson[0], socket.room);

                // [GameLog] 로그 추가
                const blackLogJson = JSON.parse(await jsonStore.getjson(socket.room+":blackLog"));
                const whiteLogJson = JSON.parse(await jsonStore.getjson(socket.room+":whiteLog"));

                let today = new Date();   
                let hours = today.getHours(); // 시
                let minutes = today.getMinutes();  // 분
                let seconds = today.getSeconds();  // 초
                let now = hours+":"+minutes+":"+seconds;
                var monitoringLog = {time: now, nickname: "", targetCompany: corpName, targetSection: "", actionType: "Damage", detail: corpName+"회사가 파괴되었습니다"};

                blackLogJson[0].push(monitoringLog);
                whiteLogJson[0].push(monitoringLog);
                await jsonStore.updatejson(blackLogJson[0], socket.room+":blackLog");
                await jsonStore.updatejson(whiteLogJson[0], socket.room+":whiteLog");

                var logArr = [];
                logArr.push(monitoringLog);
                // socket.emit('BlackLog', logArr);
                // socket.to(socket.room).emit('BlackLog', logArr);
                io.sockets.in(socket.room+'false').emit('addLog', logArr);
                // socket.emit('WhiteLog', logArr);
                // socket.to(socket.room).emit('WhiteLog', logArr);
                io.sockets.in(socket.room+'true').emit('addLog', logArr);

                // 회사 아이콘 색상 변경
                let abandonStatusList = [];
                for(let company of companyNameList){
                    abandonStatusList.push(roomTotalJson[0][company]["abandonStatus"]);
                }

                
                console.log("Section Destroy -> abandonStatusList : ", abandonStatusList);

                io.sockets.in(socket.room+'false').emit('Company Status', abandonStatusList); // 블랙팀
                io.sockets.in(socket.room+'true').emit('Company Status', abandonStatusList); // 화이트팀
                // io.sockets.in(socket.room).emit('Company Status', abandonStatusList);
            }
            
        });

        // [Monitoring] monitoringLog 스키마 데이터 보내기
        socket.on('Get_MonitoringLog', async(corp) => {
            console.log('Get_MonitoringLog CALLED  : ', corp);
            const monitoringLogJson = JSON.parse(await jsonStore.getjson(socket.room+":whiteLog"));

            var jsonArray = [];
            console.log('Get_MonitoringLog Result : ', monitoringLogJson[0].length);
            for (var i=0; i<monitoringLogJson[0].length; i++) {
                if(monitoringLogJson[0][i]["targetCompany"] == corp){
                    var newResult = {
                        time : monitoringLogJson[0][i]["time"],
                        nickname : monitoringLogJson[0][i]["nickname"],
                        targetCompany : corp,
                        targetSection : monitoringLogJson[0][i]["targetSection"],
                        actionType : monitoringLogJson[0][i]["actionType"],
                        detail : monitoringLogJson[0][i]["detail"]
                    }
                    jsonArray.push(newResult);
                } 
            }
            console.log('Get_MonitoringLog NEW Result Length : ', jsonArray.length);
            //console.log("@@@@@@@@ MonitoringLog @@@@@@@ ",  jsonArray);
            socket.emit('MonitoringLog', jsonArray);
        });


        // [Result] 최종 결과 보내기
        socket.on('Get_Final_RoomTotal', async() => {
            // 타이머 종료
            io.sockets.in(socket.room).emit('Timer END');
            socket.emit('Result_PAGE'); // 결과 페이지로 넘어가면 타이머, 로그 안보이게 하기

            // 양팀 남은 피타, 획득 호두, 승리팀
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var finalRoomTotal = {
                blackPita : roomTotalJson[0].blackTeam.total_pita,
                whitePita : roomTotalJson[0].whiteTeam.total_pita,
                winHodu : config.WIN_HODU,
                loseHodu : config.LOSE_HODU,
                winTeam : false
            }         

            // 사용자 정보 팀 별로 불러오기
            var blackUsersInfo = []; 
            var whiteUsersInfo = [];
            let infoJson = {};
            
            var RoomMembersList =  await redis_room.RoomMembers(socket.room);
            for (const member of RoomMembersList){
                var playerInfo = await redis_room.getMember(socket.room, member);
                if (playerInfo.team == false) {
                    infoJson = {UsersID : playerInfo.userID, nickname : playerInfo.nickname, UsersProfileColor : playerInfo.color}
                    blackUsersInfo.push(infoJson);
                }
                else {
                    infoJson = {UsersID : playerInfo.userID, nickname : playerInfo.nickname, UsersProfileColor : playerInfo.color}
                    whiteUsersInfo.push(infoJson);
                }
            }
            console.log("blackUsersInfo 배열 : ", blackUsersInfo);
            console.log("whiteUsersInfo 배열 : ", whiteUsersInfo);

            socket.emit('playerInfo', blackUsersInfo, whiteUsersInfo, JSON.stringify(finalRoomTotal)); // 플리이어 정보(닉네임, 프로필 색) 배열, 양팀 피타, 호두, 승리팀 정보 전송

        });

// ===================================================================================================================
        
        socket.on('disconnect', async function() {
            console.log('A Player disconnected!!! - socket.sessionID : ', socket.sessionID);
            clearInterval(timerId)
            clearInterval(pitaTimerId);
            console.log("[disconnect] 타이머 종료!");

            if (socket.room){
                await leaveRoom(socket, socket.room);
            }
            await sessionStore.deleteSession(socket.sessionID);
        });
    })

    // [room] 방 키 5자리 랜덤 
    function randomN(){
        var randomNum = {};

        //0~9까지의 난수
        randomNum.random = function(n1, n2) {
            return parseInt(Math.random() * (n2 -n1 +1)) + n1;
        };
    
        var value = "";
        for(var i=0; i<5; i++){
            value += randomNum.random(0,9);
        }

        return value;
    };


    // 현재 날짜 문자열 생성
    function nowDate(){
        var today = new Date();
        var year = today.getFullYear();
        var month = ('0' + (today.getMonth() + 1)).slice(-2);
        var day = ('0' + today.getDate()).slice(-2);
        
        var today = new Date();   
        var hours = ('0' + today.getHours()).slice(-2); 
        var minutes = ('0' + today.getMinutes()).slice(-2);
        var seconds = ('0' + today.getSeconds()).slice(-2); 
        
        var dateString = year + '-' + month  + '-' + day;
        var timeString = hours + ':' + minutes  + ':' + seconds;
    
        var now_date = dateString + " " + timeString;
        return now_date;
    }

    // [WaitingRoom] UI player 대응 컴포넌트 idx 할당
    async function PlaceUser(roomPin, team){
        console.log("PlaceUser 함수---!");

        // var roomPin = socket.room;
        var userPlacementName ;

        if(!team){ //false(0)면 black
            userPlacementName =  'blackPlacement';
        }else{
            userPlacementName =  'whitePlacement';
        } 

        console.log("userPlacementName " , userPlacementName);

        var userPlacement =await hashtableStore.getHashTableFieldValue(roomPin, [userPlacementName], 'roomManage');
        console.log("userPlacement " , userPlacement);

        if(!userPlacement)// 널처리
        {
            return -1
        }

        userPlacement = userPlacement[0].split('');
        console.log("userPlacement.split() " , userPlacement);
        var place =  userPlacement.pop();

        var newUserPlacement =  userPlacement.join('');
        console.log("AFTER! userPlacement.join('')" , newUserPlacement);
        await hashtableStore.updateHashTableField(roomPin, userPlacementName, newUserPlacement, 'roomManage');


        console.log("[PlaceUser] 반환 team : ", team, " place : ", place); 
      
        return place
    }

    // [WaitingRoom] UI player 대응 컴포넌트 idx 제거
    async function DeplaceUser(roomPin, prevTeam, idx){
        console.log("DeplaceUser 함수---! return idx : ", idx);

        // var roomPin = socket.room;
        var userPlacementName ;

        if(!prevTeam){ // false(0) 면 black팀
            userPlacementName =  'blackPlacement';
        }else{
            userPlacementName =  'whitePlacement';
        }

        console.log("userPlacementName " , userPlacementName);

        var userPlacement = await hashtableStore.getHashTableFieldValue(roomPin, [userPlacementName], 'roomManage');
        // console.log("userPlacement " , userPlacement);
        userPlacement = userPlacement[0].split('');
        // console.log("userPlacement.split() " , userPlacement);
        userPlacement.push(idx);
        // console.log("$$DeplaceUser  userPlacement : " ,userPlacement);

        userPlacement =  userPlacement.join('');
        console.log("AFTER! userPlacement" , userPlacement);
        console.log("check!! ", await hashtableStore.updateHashTableField(roomPin, userPlacementName, userPlacement, 'roomManage'));
    }

    async function createRoom(roomType, maxPlayer){
        //  1. redis - room에 저장
        var roomPin = randomN();
        while (redis_room.checkRooms(roomPin))
        {
            console.log("룸키 중복 발생_룸 키 재발급");
            roomPin = randomN();
        }


        var creationDate = nowDate();

        var room_info = {
            creationDate : creationDate,
            roomType : roomType,
            maxPlayer : maxPlayer
        };

        await redis_room.createRoom(roomPin, room_info);

        // 2. redis - roomManage/'roomKey' 저장
        var room_info = {
            'roomType' : roomType,
            'creationDate' : creationDate,
            'maxPlayer' : maxPlayer,
            'userCnt' : 0,
            'readyUserCnt' : 0,
            'whiteUserCnt' : 0,
            'blackUserCnt' : 0,
            'blackPlacement' : config.ALLOCATE_PLAYER_UI[maxPlayer],
            'whitePlacement' : config.ALLOCATE_PLAYER_UI[maxPlayer],
            'toBlackUsers' : [],
            'toWhiteUsers' : [],
            'profileColors' : '000000000000'
        };

        hashtableStore.storeHashTable(roomPin, room_info, 'roomManage');

        // 3. redis - roomManage/publicRoom 또는 roomManage/privateRoom 에 저장
        var redisroomKey =  roomType +'Room';
        listStore.rpushList(redisroomKey, roomPin, false, 'roomManage');

        return roomPin
    };


    // 공개방/비공개 방 들어갈 수 있는지 확인 (검증 : 룸 존재 여부, 룸 full 여부)
    async function UpdatePermission(roomPin){
         /*
                < 로직 > 
                1. 해당 룸 핀이 있는지 확인
                2. 해당 룸에 들어갈 수 있는지 (full상태 확인)
                3. permission 주기 (socket.room 저장, 방 상태 update 및 cnt ++)
        */

        // 1. 해당 룸 핀이 있는지 확인
        if (! await redis_room.IsValidRoom(roomPin)) { 
            console.log("permission False - no Room");
            return -1
        }

        // 2. 해당 룸에 들어갈 수 있는지 (full상태 확인)
        console.log("room_member 수", await redis_room.RoomMembers_num(roomPin))
        if (await redis_room.RoomMembers_num(roomPin) >= JSON.parse(await redis_room.getRoomInfo(roomPin)).maxPlayer){
            console.log("permission False - room Full");
            return 0
        }

        return 1
    };

    // 팀 교체 함수 (type 1) 
    async function switchTeamType1(socket, playerInfo){


    };

    // 방 나가는  함수
    async function leaveRoom(socket, roomPin){

        // 1. 해당 인원이 나가면 room null인지 확인 (user 0명인 경우 룸 삭제)
        if (await redis_room.RoomMembers_num(roomPin) <= 1){
            console.log("[룸 삭제]!");
            redis_room.deleteRooms(roomPin); // 1) redis 기본 room 삭제

            var redisroomKey = await hashtableStore.getHashTableFieldValue(roomPin, ['roomType'], 'roomManage'); // 3번 과정을 위해 roomType 가져오기
            console.log('redisroomKey : ',redisroomKey, 'roomPin : ', roomPin);
            console.log('hashtableStore.deleteHashTable', hashtableStore.deleteHashTable(roomPin,'roomManage')); // 2) roomManage room 삭제
            console.log('listStore.delElementList : ', listStore.delElementList(redisroomKey[0] + 'Room', 0, roomPin, 'roomManage')); // 3) roomManage list에서 삭제
              
            // 2. 방에 emit하기 (나갈려고 하는 사용자에게 보냄)
            socket.emit('logout'); 

            // 3. 방에 emit하기 (그 외 다른 사용자들에게 나간 사람정보 보냄_
            socket.broadcast.to(roomPin).emit('userLeaved',socket.userID);  
    
            // 4. (join삭제) 
            socket.leave(roomPin);
        }
        else{  // 나중에 if에 return 추가해서 else는 없애주기 
            // 1) roomManage room 인원 수정
            // userCnt, blackUserCnt/whiteUserCnt, blackPlacement/whitePlacement, profileColors  수정 필요

            // 주의! DeplaceUser부터 해줘야함
            var userInfo = await redis_room.getMember(socket.room, socket.userID);
            console.log(" userInfo : " ,userInfo, userInfo.place);
            if (socket.team){
                await DeplaceUser(roomPin, socket.team, userInfo.place); // blackPlacement/whitePlacement  -> DeplaceUser
            }else{
                await DeplaceUser(roomPin, socket.team, userInfo.place);  // blackPlacement/whitePlacement  -> DeplaceUser
            }
            
            var roomManageInfo = await hashtableStore.getAllHashTable(roomPin, 'roomManage'); ;
            console.log("[[[ 수정전 ]]] roomManageInfo" , roomManageInfo);


            // userCnt 변경
            roomManageInfo.userCnt = roomManageInfo.userCnt - 1;

            // blackUserCnt/whiteUserCnt 변경
            // toBlackUsers, toWhiteUsers 초기화
            var othersWaitingField, myWaitingField;
            if (socket.team){
                roomManageInfo.whiteUserCnt = roomManageInfo.whiteUserCnt - 1;
                myWaitingField = 'toBlackUsers';
                othersWaitingField = 'toWhiteUsers';
            }else{
                roomManageInfo.blackUserCnt = roomManageInfo.blackUserCnt - 1;
                myWaitingField = 'toWhiteUsers';
                othersWaitingField = 'toBlackUsers';
            }
          
            // 만약 해당 유저가 웨이팅리스트에 있었다면 삭제함
            if(roomManageInfo[myWaitingField].length != 0){
                console.log("나 - 웨이팅 리스트에서 삭제함");
                var mywaitingList = roomManageInfo[myWaitingField].split(',');
                roomManageInfo[myWaitingField] = mywaitingList.filter(function(userID) {
                    return userID != socket.userID;
                });
            }

            // profileColor 변경 
            console.log("socket.color ", socket.color);
            roomManageInfo.profileColors = roomManageInfo.profileColors.replaceAt(socket.color, '0');
            console.log("roomManageInfo.profileColors", roomManageInfo.profileColors);

            // readycnt 변경 
            if(userInfo.status == 1){
                roomManageInfo.readyUserCnt -= 1 ;
            }
        
            console.log("[[[수정 후 ]]] roomManageInfo" , roomManageInfo);
            await hashtableStore.storeHashTable(roomPin, roomManageInfo, 'roomManage');


            // 2)  Redis - room 인원에서 삭제
            redis_room.delMember(roomPin, socket.userID);

            // 2. 방에 emit하기 (나갈려고 하는 사용자에게 보냄)
            socket.emit('logout'); 

            // 3. 방에 emit하기 (그 외 다른 사용자들에게 나간 사람정보 보냄_
            socket.broadcast.to(roomPin).emit('userLeaved',socket.userID);  
    
            // 4. (join삭제) 
            socket.leave(roomPin);

            ////---------------- 후 처리
            // 3) 다른 유저의 teamChange 가능한지 확인 후 정보 저장
            var otherswaitingList;
            if(roomManageInfo[othersWaitingField].length != 0){
                console.log("다른유저 -팀 체인지 진행");
                otherswaitingList = othersWaitingData[0].split(',');

                console.log("otherswaitingList : " , otherswaitingList);

                var mateUserID = otherswaitingList.shift();
                var matePlayerInfo = await redis_room.getMember(room, mateUserID);
                console.log("mate 정보 : " , matePlayerInfo);

                matePlayerInfo.place = userInfo.place;
                matePlayerInfo.team = userInfo.team ;
                matePlayerInfo.status = 0;
                await redis_room.updateMember(room, mateUserID, matePlayerInfo);

                var teamChangeInfo = { 
                    type : 1,
                    player1 : matePlayerInfo
                };
                
                // teamchange 정보 보내기 
                console.log('JSON.stringify(changeInfo); : ', JSON.stringify(changeInfo));
                io.sockets.in(socket.room).emit('updateTeamChange', JSON.stringify(teamChangeInfo));
            }

            // 3) roomManage list 인원 확인 (함수로 따로 빼기)
            // 만약 해당 룸이 full이 아니면 list에 추가해주기
            var redisroomKey =  roomManageInfo.roomType + 'Room';
            var publicRoomList = await listStore.rangeList(redisroomKey, 0, -1, 'roomManage');

            if (!publicRoomList.includes(roomPin) && (await redis_room.RoomMembers_num(roomPin) <= JSON.parse(await redis_room.getRoomInfo(roomPin)).maxPlayer)){
                await listStore.rpushList(redisroomKey, roomPin, false, 'roomManage');
                console.log("roomManage의 list에 추가됨");
            }
            
        }
        

        // 5. 나머지 room 관련 정보 socket에서 삭제 및 빈 값으로 수정해주기!!
       socket.room = null;
       socket.team = null;
       socket.color = null;
    };


    // [GameStart] 게임시작을 위해 게임 스키마 초기화 
    function InitGame(room_key, blackUsersInfo, whiteUsersInfo){
        console.log("INIT GAME 호출됨------! blackUsersID", blackUsersInfo);


        /*
            var blackUsers = [ user1ID, user2ID, user3ID ];
        */

        // RoomTotalJson 생성 및 return 
        var userCompanyStatus = new UserCompanyStatus({
            detectCnt : [0, 0, 0],
            warnCnt    : 0,
            IsBlocked   : false, //무력화 상태
        });

        var blackUsers = {};
        var whiteUsers = {};

        for (const user of blackUsersInfo){
            blackUsers[user.UsersID] = new BlackUsers({
                userId   : user.UsersID,
                profileColor : user.UsersProfileColor,
                currentLocation : "",
                companyA    : userCompanyStatus,
                companyB    : userCompanyStatus,
                companyC    : userCompanyStatus,
                companyD    : userCompanyStatus,
                companyE    : userCompanyStatus,
            });
        }

        for (const user of whiteUsersInfo){
            whiteUsers[user.UsersID] =  new WhiteUsers({
                userId   : user.UsersID,
                profileColor : user.UsersProfileColor,
                currentLocation : ""
            })
        }
    
        var progress = new Progress({
            progress  : [],
            last  : -1
        })

        var initCompany = new Company({
            abandonStatus : false,
            penetrationTestingLV : [1,1,1,1,1,1,1,1,1,1,1,1,1],
            attackLV : [0,0,0,0,0,0,0,0,0,0,0,0,0],
            sections : [
                new Section({
                    activation : true,
                    destroyStatus : false ,
                    level  : 0,
                    vuln : 0,
                    vulnActive : false,
                    attackStep : 0,
                    responseStep : 0,
                    attack : progress,
                    response : progress,
                }),

                new Section({
                    activation : false,
                    destroyStatus  : false ,
                    level  : 0,
                    vuln : 1,
                    vulnActive : false,
                    attackStep : 0,
                    responseStep : 0,
                    attack : progress,
                    response : progress,
                }),

                new Section({
                    activation : false,
                    destroyStatus  : false ,
                    level  : 0,
                    vuln : 2,
                    vulnActive : false,
                    attackStep : 0,
                    responseStep : 0,
                    attack : progress,
                    response : progress,
                }),
            ]
        });


        var RoomTotalJson  = {
            roomPin : room_key,
            server_start  : new Date(),
            server_end  :  new Date(),
            blackTeam  : new BlackTeam({ 
                total_pita : 500,
                users : blackUsers
            }),
            whiteTeam  : new WhiteTeam({ 
                total_pita : 500,
                users : whiteUsers
            }),
            companyA    : initCompany,
            companyB    : initCompany,
            companyC    : initCompany,
            companyD    : initCompany,
            companyE    : initCompany,
        };
      
        return RoomTotalJson
    }

    

    // 공격 별 n초 후 공격 성공
    async function attackCount(socket, roomTotalJson, attackJson, cardLv, step){
        var attackStepTime = setTimeout(async function(){
            socket.to(socket.room+'false').emit("Attack Step", attackJson.companyName, attackJson.sectionIndex, step);
            socket.emit("Attack Step", attackJson.companyName, attackJson.sectionIndex, step);
            console.log("attackCount CALLED");

            // [GameLog] 로그 추가 - 공격 성공 로그
            const blackLogJson = JSON.parse(await jsonStore.getjson(socket.room+":blackLog"));

            let today = new Date();   
            let hours = today.getHours(); // 시
            let minutes = today.getMinutes();  // 분
            let seconds = today.getSeconds();  // 초
            let now = hours+":"+minutes+":"+seconds;
            var companyIdx =  attackJson.companyName.charCodeAt(7) - 65;
            var monitoringLog = {time: now, nickname: socket.nickname, targetCompany: attackJson.companyName, targetSection: sectionNames[companyIdx][attackJson.sectionIndex], actionType: "Attack", detail: attack_name_list[attackJson.attackIndex]+"공격이 수행되었습니다."};

            blackLogJson[0].push(monitoringLog);
            await jsonStore.updatejson(blackLogJson[0], socket.room+":blackLog");

            var logArr = [];
            logArr.push(monitoringLog);
            //socket.emit('BlackLog', logArr);
            //socket.to(socket.room).emit('BlackLog', logArr);
            io.sockets.in(socket.room+'false').emit('addLog', logArr);

            // let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("White Team Response list (attackCount) : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["progress"]);
            console.log("Black Team Attack list (attackCount) : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["progress"]);

            if (step == 6) {
                roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["destroyStatus"] = true;
                await jsonStore.updatejson(roomTotalJson[0], socket.room);
                roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room)); 
                console.log("destory section!! section : ", attackJson.sectionIndex, ", destroyStatus : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["destroyStatus"]); 

                sectionDestroy = {company : attackJson.companyName, section : attackJson.sectionIndex};
                var destroyJson = JSON.stringify(sectionDestroy);

                io.sockets.in(socket.room+'false').emit('Section Destroy', destroyJson);
                // socket.to(socket.room).emit("Section Destroy", destroyJson);
                // socket.emit("Section Destroy", destroyJson);

                io.sockets.in(socket.room+'false').emit('is_All_Sections_Destroyed_Nickname', socket.nickname, attackJson.companyName);
                // socket.to(socket.room).emit('is_All_Sections_Destroyed', attackJson.companyName);
                // socket.emit('is_All_Sections_Destroyed', attackJson.companyName);

                // [GameLog] 로그 추가 - 섹션 파괴 로그
                const blackLogJson = JSON.parse(await jsonStore.getjson(socket.room+":blackLog"));
                const whiteLogJson = JSON.parse(await jsonStore.getjson(socket.room+":whiteLog"));

                let today = new Date();   
                let hours = today.getHours(); // 시
                let minutes = today.getMinutes();  // 분
                let seconds = today.getSeconds();  // 초
                let now = hours+":"+minutes+":"+seconds;

                //var companyIdx =  attackJson.companyName.charCodeAt(7) - 65;
                var monitoringLog = {time: now, nickname: "", targetCompany: attackJson.companyName, targetSection: sectionNames[companyIdx][attackJson.sectionIndex], actionType: "Damage", detail: "파괴되었습니다."};

                blackLogJson[0].push(monitoringLog);
                whiteLogJson[0].push(monitoringLog);
                await jsonStore.updatejson(blackLogJson[0], socket.room+":blackLog");
                await jsonStore.updatejson(whiteLogJson[0], socket.room+":whiteLog");
                
                var logArr = [];
                logArr.push(monitoringLog);
                //socket.emit('BlackLog', logArr);
                //socket.to(socket.room).emit('BlackLog', logArr);
                socket.to(socket.room).emit('addLog', logArr);

                // 영역 파괴 후 다음 영역 공격 활성화
                if (roomTotalJson[0][attackJson.companyName]["sections"].length > attackJson.sectionIndex){
                    roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex + 1]["activation"] = true;
                } else {
                    console.log("[Section Destory] 해당 회사는 몰락함");
                }

            }

            if (step > roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attackStep"]){
                roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attackStep"] = step;
                roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["responseStep"] = step;
            }

            console.log("[setTimeout] roomTotalJson attack step ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attackStep"]);
            console.log("[setTimeout] roomTotalJson attack step, step ", step);

            await jsonStore.updatejson(roomTotalJson[0], socket.room);
            roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));                

            console.log("attack step after edit json (attackCount) : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attackStep"]);

            clearTimeout(attackStepTime);

        }, config["ATTACK_" + (attackJson.attackIndex + 1)]["time"][cardLv - 1] * 1000);

        socket.on("Click Response", async(responseData) => {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            console.log("Click Attack jsonStr : ", responseData);
            let responseJson = JSON.parse(responseData);

            let responseStep;
            if (0 <= responseJson.attackIndex && responseJson.attackIndex < 4){
                responseStep = 1;
            } else if (responseJson.attackIndex == 4){
                responseStep = 2;
            } else if (responseJson.attackIndex == 5){
                responseStep = 3;
            } else if (responseJson.attackIndex == 6){
                responseStep = 4;
            } else if (7 <= responseJson.attackIndex && responseJson.attackIndex <= 10){
                responseStep = 5;
            } else if (11 <= responseJson.attackIndex && responseJson.attackIndex <= 12){
                responseStep = 6;
            }

            if (roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["attackStep"] == (responseStep + 1) || 
            roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["attackStep"] == responseStep ){
                console.log("대응됨! -> attackCount 중지");
                clearTimeout(attackStepTime);
                socket.to(socket.room+socket.team).emit("Stop Performing");
                socket.emit("Stop Performing");
            }
        });
    }

    // 공격 별 n초 후 관제 리스트로 넘기기
    async function monitoringCount(socket, roomTotalJson, attackJson, cardLv){
        var monitoringTime = setTimeout(async function(){

            var attackList = roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["progress"];
            let delIndex = -1;
            let attacker = "";
            for(var i = 0; i < attackList.length; i++){ 
                if (Object.keys(attackList[i]) == attackJson.attackIndex) { 
                    delIndex = i
                    attacker = attackList[i][attackJson.attackIndex];
                    console.log("Delete Response attack in Response List : ", i);
                    console.log("Delete Response attack's attacker' : ", attacker);
                    break;
                }
            }

            console.log("monitoring success? : ", Boolean(delIndex));

            console.log("White Team Response list (monitoringCount) : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["progress"]);
            console.log("Black Team Attack list (monitoringCount) : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["progress"]);

            if (delIndex > -1){
                let json = new Object();
                json[attackJson.attackIndex] = socket.userID;
                attackList.splice(i, 1); 
                roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["progress"].push(json);
                roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["last"] = attackJson.attackIndex;

                // 나중에 1단계에서 취약점 외의 공격들도 감지할 수 있도록 수정하기
                roomTotalJson[0]["blackTeam"]["users"][attacker][attackJson.companyName]["detectCnt"][attackJson.sectionIndex] += 1;
                if (roomTotalJson[0]["blackTeam"]["users"][attacker][attackJson.companyName]["detectCnt"][attackJson.sectionIndex] == 3){
                    roomTotalJson[0]["blackTeam"]["users"][attacker][attackJson.companyName]["detectCnt"][attackJson.sectionIndex] = 0;
                    roomTotalJson[0]["blackTeam"]["users"][attacker][attackJson.companyName]["warnCnt"] += 1
                    if (roomTotalJson[0]["blackTeam"]["users"][attacker][attackJson.companyName]["warnCnt"] == 3){
                        roomTotalJson[0]["blackTeam"]["users"][attacker][attackJson.companyName]["warnCnt"] = 0;
                        roomTotalJson[0]["blackTeam"]["users"][attacker][attackJson.companyName]["IsBlocked"] = true;
                        socket.emit('OnNeutralization', true);
                        console.log("You are Blocked!!!!");

                        // [GameLog] 로그 추가 - 무력화(블랙) & 무력화 발견(화이트)로그
                        const blackLogJson = JSON.parse(await jsonStore.getjson(socket.room+":blackLog"));
                        const whiteLogJson = JSON.parse(await jsonStore.getjson(socket.room+":whiteLog"));

                        let today = new Date();   
                        let hours = today.getHours(); // 시
                        let minutes = today.getMinutes();  // 분
                        let seconds = today.getSeconds();  // 초
                        let now = hours+":"+minutes+":"+seconds;

                        //var companyIdx =  attackJson.companyName.charCodeAt(7) - 65;
                        var monitoringLogBlack = {time: now, nickname: socket.nickname, targetCompany: attackJson.companyName, targetSection: "", actionType: "Neutralization", detail: socket.nickname+"님이 공격 차단되었습니다."};
                        var monitoringLogWhite = {time: now, nickname: "", targetCompany: attackJson.companyName, targetSection: "", actionType: "Neutralization", detail: attackJson.companyName+"에서 공격 차단이 수행되었습니다."};

                        blackLogJson[0].push(monitoringLogBlack);
                        whiteLogJson[0].push(monitoringLogWhite);
                        await jsonStore.updatejson(blackLogJson[0], socket.room+":blackLog");
                        await jsonStore.updatejson(whiteLogJson[0], socket.room+":whiteLog");
                        
                        var logArr = [];
                        logArr.push(monitoringLogBlack);
                        //socket.emit('BlackLog', logArr);
                        //socket.to(socket.room).emit('BlackLog', logArr);
                        io.sockets.in(socket.room+'false').emit('addLog', logArr);
                        logArr = [];
                        logArr.push(monitoringLogWhite);
                        //socket.emit('WhiteLog', logArr);
                        //socket.to(socket.room).emit('WhiteLog', logArr);
                        io.sockets.in(socket.room+'true').emit('addLog', logArr);
                    }
                }

                let company_blockedNum = 0;
                for (var userId in roomTotalJson[0]["blackTeam"]["users"]){
                    console.log("[On Monitoring] user id : ", userId);

                    if (roomTotalJson[0]["blackTeam"]["users"][userId][attackJson.companyName]["IsBlocked"] == true){
                        company_blockedNum += 1;
                    }
                }
                console.log("[On Monitoring] company_blockedNum : ", company_blockedNum);
                socket.to(socket.room+'true').emit("Blocked Num", company_blockedNum);
                socket.emit('Blocked Num', company_blockedNum);

                console.log(attacker, "의 userCompanyStatus : ", roomTotalJson[0]["blackTeam"]["users"][attacker]);

                let responseProgress = []
                for(var i in roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["progress"]){
                    console.log("responseIndex : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["progress"][i]);
                    responseProgress.push(Number(Object.keys(roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["progress"][i])));
                }
                
                console.log("responseProgress", responseProgress);

                console.log("Math.max(...responseProgress) ; ", Math.max(...responseProgress));
                if (roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["progress"].length == 0){
                    step = 0;
                } else {
                    let maxAttack = Math.max(...responseProgress);
                    if (0 <= maxAttack && maxAttack < 4){
                        step = 1;
                    } else if (maxAttack == 4){
                        step = 2;
                    } else if (maxAttack == 5){
                        step = 3;
                    } else if (maxAttack == 6){
                        step = 4;
                    } else if (7 <= maxAttack && maxAttack <= 10){
                        step = 5;
                    } else if (11 <= maxAttack && maxAttack <= 12){
                        step = 6;
                    }
                }

                socket.to(socket.room+'true').emit('Load Response List', attackJson.companyName, attackJson.sectionIndex, responseProgress, step - 1);
                socket.emit('Load Response List', attackJson.companyName, attackJson.sectionIndex, responseProgress, step - 1);

                roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["progress"] = attackList;

                console.log("[timeout] roomTotalJson[0][attackJson.companyName]['sections'][attackJson.sectionIndex]['attack']['progress']", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["progress"]);
                console.log("[timeout] roomTotalJson[0][attackJson.companyName][sections][attackJson.sectionIndex][response][progress]", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["progress"]);

                // white room으로 response list 보내기 -> 해당 공격들만 활성화 시키기


                console.log("Done Monitoring atttck : ", attackJson.attackIndex);

                await jsonStore.updatejson(roomTotalJson[0], socket.room);
                roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
                console.log("White Team Response list (timeout) : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["response"]["progress"]);
                console.log("Black Team Attack list (timeout) : ", roomTotalJson[0][attackJson.companyName]["sections"][attackJson.sectionIndex]["attack"]["progress"]);
            
                clearTimeout(monitoringTime);
                
            } else {
                console.log("what the");
            }

            // [GameLog] 로그 추가 - 관제 로그 추가
            const whiteLogJson = JSON.parse(await jsonStore.getjson(socket.room+":whiteLog"));

            let today = new Date();   
            let hours = today.getHours(); // 시
            let minutes = today.getMinutes();  // 분
            let seconds = today.getSeconds();  // 초
            let now = hours+":"+minutes+":"+seconds;
            var companyIdx =  attackJson.companyName.charCodeAt(7) - 65;
            var monitoringLog = {time: now, nickname: "", targetCompany: attackJson.companyName, targetSection: sectionNames[companyIdx][attackJson.sectionIndex], actionType: "Detected", detail: attack_name_list[delIndex]+"공격이 탐지 되었습니다."};
            var attackIdx = 
            console.log("[GameLog] monitoringLog > ",monitoringLog);
            whiteLogJson[0].push(monitoringLog);
            await jsonStore.updatejson(whiteLogJson[0], socket.room+":whiteLog");
            console.log("[GameLog] monitoringLog2 >> ",monitoringLog);

            var logArr = [];
            logArr.push(monitoringLog);
            //socket.emit('WhiteLog', logArr);
            //socket.to(socket.room).emit('WhiteLog', logArr);
            io.sockets.in(socket.room+'true').emit('addLog', logArr);

        }, config["MONITORING_" + (attackJson.attackIndex + 1)]["time"][cardLv] * 1000);
    }

    // 공격은 수행하였지만 관제에서 무시되는 경우 warn만 +1
    async function monitoringCountBlocked(socket, roomTotalJson, attackJson, cardLv){
        var monitoringTime = setTimeout(async function(){
            // 나중에 1단계에서 취약점 외의 공격들도 감지할 수 있도록 수정하기
            roomTotalJson[0]["blackTeam"]["users"][socket.userID][attackJson.companyName]["detectCnt"][attackJson.sectionIndex] += 1;
            if (roomTotalJson[0]["blackTeam"]["users"][socket.userID][attackJson.companyName]["detectCnt"][attackJson.sectionIndex] == 3){
                roomTotalJson[0]["blackTeam"]["users"][socket.userID][attackJson.companyName]["detectCnt"][attackJson.sectionIndex] = 0;
                roomTotalJson[0]["blackTeam"]["users"][socket.userID][attackJson.companyName]["warnCnt"] += 1
                if (roomTotalJson[0]["blackTeam"]["users"][socket.userID][attackJson.companyName]["warnCnt"] == 3){
                    roomTotalJson[0]["blackTeam"]["users"][socket.userID][attackJson.companyName]["warnCnt"] = 0;
                    roomTotalJson[0]["blackTeam"]["users"][socket.userID][attackJson.companyName]["IsBlocked"] = true;
                    socket.emit('OnNeutralization', true);
                    console.log("You are Blocked!!!!");

                    // [GameLog] 로그 추가 - 무력화(블랙) & 무력화 발견(화이트)로그
                    const blackLogJson = JSON.parse(await jsonStore.getjson(socket.room+":blackLog"));
                    const whiteLogJson = JSON.parse(await jsonStore.getjson(socket.room+":whiteLog"));

                    let today = new Date();   
                    let hours = today.getHours(); // 시
                    let minutes = today.getMinutes();  // 분
                    let seconds = today.getSeconds();  // 초
                    let now = hours+":"+minutes+":"+seconds;

                    //var companyIdx =  attackJson.companyName.charCodeAt(7) - 65;
                    var monitoringLogBlack = {time: now, nickname: socket.nickname, targetCompany: attackJson.companyName, targetSection: "", actionType: "Neutralization", detail: socket.nickname+"이 공격 차단되었습니다."};
                    var monitoringLogWhite = {time: now, nickname: "", targetCompany: attackJson.companyName, targetSection: "", actionType: "Neutralization", detail: attackJson.companyName+"에서 공격 차단이 수행되었습니다."};

                    blackLogJson[0].push(monitoringLogBlack);
                    whiteLogJson[0].push(monitoringLogWhite);
                    await jsonStore.updatejson(blackLogJson[0], socket.room+":blackLog");
                    await jsonStore.updatejson(whiteLogJson[0], socket.room+":whiteLog");
                    
                    var logArr = [];
                    logArr.push(monitoringLogBlack);
                    //socket.emit('BlackLog', logArr);
                    //socket.to(socket.room).emit('BlackLog', logArr);
                    io.sockets.in(socket.room+'false').emit('addLog', logArr);
                    logArr = [];
                    logArr.push(monitoringLogWhite);
                    //socket.emit('WhiteLog', logArr);
                    //socket.to(socket.room).emit('WhiteLog', logArr);
                    io.sockets.in(socket.room+'true').emit('addLog', logArr);
                }
            }

            let company_blockedNum = 0;
            for (var userId in roomTotalJson[0]["blackTeam"]["users"]){
                console.log("[On Monitoring] user id : ", userId);

                if (roomTotalJson[0]["blackTeam"]["users"][userId][attackJson.companyName]["IsBlocked"] == true){
                    company_blockedNum += 1;
                }
            }
            console.log("[On Monitoring] company_blockedNum : ", company_blockedNum);
            socket.to(socket.room+'true').emit("Blocked Num", company_blockedNum);
            socket.emit('Blocked Num', company_blockedNum);

            console.log(socket.userID, "의 userCompanyStatus : ", roomTotalJson[0]["blackTeam"]["users"][socket.userID]);
            await jsonStore.updatejson(roomTotalJson[0], socket.room);
            
            clearTimeout(monitoringTime);
        }, config["MONITORING_" + (attackJson.attackIndex + 1)]["time"][cardLv] * 1000);
    }

    // 대응 별 n초 후 대응 성공
    async function responseCount(socket, roomTotalJson, responseJson, cardLv){
        var responseStepTime = setTimeout(async function(){

            // response list에서 대응 성공한 공격 삭제
            var responseList = roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["response"]["progress"];
            for(var i = 0; i < responseList.length; i++){ 
                if (Object.keys(responseList[i]) == responseJson.attackIndex) { 
                    console.log("Delete Response attack in Response List : ", i);
                    responseList.splice(i, 1); 
                    break;
                }
            }

            // var attackList = roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["attack"]["progress"];
            // for(var i = 0; i < attackList.length; i++){ 
            //     if (Object.keys(attackList[i]) == responseJson.attackIndex) { 
            //         console.log("Delete Response attack in Response List : ", i);
            //         attackList.splice(i, 1); 
            //         break;
            //     }
            // }

            let step; // attack Step

            let responseProgress = []
            for(var i in responseList){
                console.log("responseIndex : ", responseList[i]);
                responseProgress.push(Number(Object.keys(responseList[i])));
            }

            console.log("Math.max(...responseList) ; ", Math.max(...responseProgress));
            if (responseList.length == 0){
                step = 0;
            } else {
                let maxAttack = Math.max(...responseProgress);
                if (0 <= maxAttack && maxAttack < 4){
                    step = 1;
                } else if (maxAttack == 4){
                    step = 2;
                } else if (maxAttack == 5){
                    step = 3;
                } else if (maxAttack == 6){
                    step = 4;
                } else if (7 <= maxAttack && maxAttack <= 10){
                    step = 5;
                } else if (11 <= maxAttack && maxAttack <= 12){
                    step = 6;
                }
            }

            socket.to(socket.room+'true').emit('Load Response List', responseJson.companyName, responseJson.sectionIndex, responseProgress, step - 1);
            socket.emit('Load Response List', responseJson.companyName, responseJson.sectionIndex, responseProgress, step - 1); 

            // socket.to(socket.room+'true').emit("Response Step", step - 1);
            // socket.emit("Response Step", step - 1);

            socket.to(socket.room+'false').emit("Attack Step", responseJson.companyName, responseJson.sectionIndex, step);
            socket.emit("Attack Step", responseJson.companyName, responseJson.sectionIndex, step);

            // 대응 되었음을 black에게 알림

            roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["response"]["progress"] = responseList;
            //roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["attack"]["progress"] = attackList;

            // let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("White Team Response list (responseCount) : ", roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["response"]["progress"]);
            console.log("Black Team Attack list (responseCount) : ", roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["attack"]["progress"]);

            if (step < roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["attackStep"]){
                roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["attackStep"] = step;
                roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["responseStep"] = step;
            }

            console.log("[setTimeout] roomTotalJson response step ", roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["attackStep"]);
            console.log("[setTimeout] roomTotalJson response step, step ", step);

            await jsonStore.updatejson(roomTotalJson[0], socket.room);
            roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));                

            console.log("attack step after edit json (attackCount) : ", roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["attackStep"]);

            // [GameLog] 로그 추가 - 대응 로그
            const whiteLogJson = JSON.parse(await jsonStore.getjson(socket.room+":whiteLog"));

            let today = new Date();   
            let hours = today.getHours(); // 시
            let minutes = today.getMinutes();  // 분
            let seconds = today.getSeconds();  // 초
            let now = hours+":"+minutes+":"+seconds;

            var companyIdx =  responseJson.companyName.charCodeAt(7) - 65;
            var monitoringLog = {time: now, nickname: socket.nickname, targetCompany: responseJson.companyName, targetSection: sectionNames[companyIdx][responseJson.sectionIndex], actionType: "Response", detail: attack_name_list[responseJson.attackIndex]+"대응이 수행되었습니다."};

            whiteLogJson[0].push(monitoringLog);
            await jsonStore.updatejson(whiteLogJson[0], socket.room+":whiteLog");
            
            var logArr = [];
            logArr.push(monitoringLog);
            //socket.emit('WhiteLog', logArr);
            //socket.to(socket.room).emit('WhiteLog', logArr);
            io.sockets.in(socket.room+'true').emit('addLog', logArr);

            clearTimeout(responseStepTime);

        }, config["RESPONSE_" + (responseJson.attackIndex + 1)]["time"][cardLv - 1] * 1000);


        // click attack이 호출되어도 이 socket 함수로 들어오지 않는 것으로 보임 -> 수정 필요
        // click resonse 역시 마찬가지
        socket.on("Click Attack", async(attackData) => {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            console.log("Click Attack jsonStr : ", attackData);
            let attackJson = JSON.parse(attackData);

            if (0 <= attackJson.attackIndex && attackJson.attackIndex < 4){
                step = 1;
            } else if (attackJson.attackIndex == 4){
                step = 2;
            } else if (attackJson.attackIndex == 5){
                step = 3;
            } else if (attackJson.attackIndex == 6){
                step = 4;
            } else if (7 <= attackJson.attackIndex && attackJson.attackIndex <= 10){
                step = 5;
            } else if (11 <= attackJson.attackIndex && attackJson.attackIndex <= 12){
                step = 6;
            }

            if(roomTotalJson[0][responseJson.companyName]["sections"][responseJson.sectionIndex]["responseStep"] == (step - 1)){
                console.log("공격 성공! -> responseCount 중지");
                clearTimeout(responseStepTime);
                socket.to(socket.room+socket.team).emit("Stop Performing");
                socket.emit("Stop Performing");
            }
        });
    }
    
}

