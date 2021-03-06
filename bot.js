var RtmClient = require('@slack/client').RtmClient;
var RTM_EVENTS = require('@slack/client').RTM_EVENTS;
var MemoryDataStore = require('@slack/client').MemoryDataStore;
var CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS;
var https = require('https');
var Twitter = null;

try{
    Twitter = require('twitter');
}catch(e){
    console.log('twitter not found.  For twitter integration, npm install Twitter');
}

var constants = require('./constants');

var token = constants.apiToken;
var botToken = constants.botToken;
var botId = constants.botId;
var atBot = "<@" + botId + ">";


var rtm = new RtmClient(botToken);
rtm.start();

rtm.on(CLIENT_EVENTS.RTM.RTM_CONNECTION_OPENED, function(){
    //ping the channel every 4 hours
    setInterval(pingChannel, 4*60*60*1000);
});

rtm.on(RTM_EVENTS.MESSAGE, function (message){
    console.log('Message: ', message);
    var channelId = message.channel;

    if(message.text && message.text.indexOf(atBot) > - 1 && message.user != botId){
        var user = message.text.replace(/ /g, '').replace(atBot, '').replace(':','');
        var start = user.indexOf('<@');
        var end = user.indexOf('>');
        if (start > -1 && end > start) {
            var userId = user.substring(start, end+1);
            var croppedid = userId.substring(2, userId.length-1)
            var name =  rtm.dataStore.getUserById(croppedid).name
            user = user.replace(userId, name)
        }
        if(user.indexOf('twitter') > -1){
            if(Twitter && constants.twitterConsumerKey && constants.twitterConsumerKey !== ''){
                var handle = user.replace('twitter', '');

                getTwitterMessages(handle, channelId);

            }else{
                rtm.sendMessage('Environment not configured for twitter parsing!', channelId, function(err, msg){

                });
            }
        }else{
            getSlackMessages(user, channelId);
        }
    }
});

var isFromDm = function(message){
    return (message.channel && message.channel.id[0] == 'D');
}

var pingChannel = function(){
    var pickedUser = {name: '', id: ''};
    var userIds = Object.keys(rtm.dataStore.users);
    var usersLength = userIds.length;

    var index = Math.floor(Math.random()*usersLength);
    pickedUser.name = rtm.dataStore.users[userIds[index]].name;
    pickedUser.id = rtm.dataStore.users[userIds[index]].id;
    pickedUser.isBot = rtm.dataStore.users[userIds[index]].is_bot;
    console.log(rtm.dataStore.users[userIds[index]]);

    if(!pickedUser.isBot && pickedUser.name != "slackbot"){
        getSlackMessages(pickedUser.name, constants.simChannelId, true);
    }
}

var markovChain = function(messages, user, channelId){
    var cache = {
        '_START': []
    };

    //format message data
    cache['_START'].push(messages[0]);
    for(var i = 0; i < messages.length - 1; i++){
        if(!cache[messages[i]]){
            cache[messages[i]] = [];
        }

        cache[messages[i]].push(messages[i+1]);

        if(messages[i].match(/\.$/)){
            cache['_START'].push(messages[i+1]);
        }
    }

    //form sentence
    var currentWord = '_START';
    var str = '';
    var numSentences = 1 + Math.floor(Math.random()*6);

    while(numSentences > 0){
        var rand = Math.floor(Math.random()*cache[currentWord].length);
        var newWord = cache[currentWord][rand];
        str += newWord;

        //if we reached the end of the chain or a word with puncuation, we reached the end of the sentence.
        if(!cache[newWord] || newWord[newWord.length-1] == '.' || newWord[newWord.length-1] == "?" || newWord[newWord.length-1] == "!"){
            currentWord = '_START';
                
            if(!cache[newWord]){
                str += '. ';
            }else{
                str += ' ';
            }

            numSentences--;
        }else{
            currentWord = newWord;
            str += ' ';
        }
    }

    console.log(str);
    var userOut = user ? user + ':' : '';
    rtm.sendMessage(userOut+"\""+str+"\"", channelId, function(err, msg){

    });
}

var getTwitterMessages = function(handle, channelId){
    var client = new Twitter({
        consumer_key: constants.twitterConsumerKey,
        consumer_secret: constants.twitterConsumerSecret,
        access_token_key: constants.twitterAccessTokenKey,
        access_token_secret: constants.twitterAccessTokenSecret
    });

    console.log(handle);
    var params = {screen_name: handle, count: 200};
    client.get('statuses/user_timeline', params, function(error, tweets, response){
        if(!error){
            var messages = [];
            tweets.forEach(function (tweet){
                var message = tweet.text.trim();
                if(message[message.length-1] != "." && message[message.length-1] != "!" && message[message.length -1] != "?"){
                    message += ".";
                }

                //split words from messages
                var words = message.split(/\s+/g);
                words.forEach(function(word){
                    messages.push(word);
                });
            });

            markovChain(messages, handle, channelId);
        }else{
            console.log('Twitter error: ', error);
        }
    });
}

var getSlackMessages = function(user, channelId, outputUser){
    var ops = {
        host: 'slack.com',
        path: '/api/search.messages?token='+token+'&count=1000&query=from:'+user,
        method: 'GET',
    }

    console.log('firing request for: '+user);
    var req = https.request(ops, function(res){
        var body = '';
        res.on('data', function(d){
            body += d;
        });
        res.on('end', function(){
            //console.log('the messages were: ', body);

            var responseData = JSON.parse(body);
            if(!responseData.messages || responseData.messages.total < 1){
                console.log('no messages found for that user');
                return;
            }

            var messages = [];
            responseData.messages.matches.forEach(function(match){
                var message = match.text.trim();

                if(isFromDm(match)){
                    return;
                }

                //ignore commands to the bot itself
                if(message.indexOf(atBot) == -1){
                    //make sure messages end in a punctuation
                    if(message[message.length-1] != "." && message[message.length-1] != "!" && message[message.length-1] != "?"){
                       message += ".";
                    }

                    //split words from messages
                    var words = message.split(/\s+/g);
                    words.forEach(function(word){
                        messages.push(word);
                    });
                }
            }, this);


            markovChain(messages, outputUser ? user : '', channelId);
        });
    });
    req.end();

    req.on('error', function(e){
        console.error(e);
    });
}
