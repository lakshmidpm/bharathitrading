var createError = require('http-errors');
var https = require('https');
var express = require('express');
const fs = require('fs'); 
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var schedule = require('node-schedule');
var KiteConnect = require("kiteconnect").KiteConnect;
var kc = new KiteConnect({ api_key: "6l7wlikr9ar2c61y"});
const axios = require('axios');
var querystring = require('querystring');
var bodyParser = require('body-parser');
const mongodb = require('mongodb').MongoClient;
var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use(bodyParser.urlencoded({ extended: true }));

var webPageDetails = [];
var referer;
var scookie;
var sredirect;
let my_request_token;
var access_token;
let zerouser;
let zeropwd;
let zeropin;
let instrument_name;
let tsymbol;
var dbInterval;
var emaInterval;
var loginInterval;
var emergencylogin;
let ema5 = 0;
let ema21 = 0;
let ema5Close = 0;

let ltp = 0;
var ohlc;
let margin = 0;
let tradeSize = 75;

let enableBuycheck = 0;
let iboLow = 0;
let iboHigh = 0;

let buyPositionInitiated = 0;
let buyPositionOpened = 0;
let buyPositionClosed = 0 ;
let buyValue = 0;

let sellPositionInitiated = 0;
let sellPositionOpened = 0;
let sellPositionClosed = 0 ;
let sellValue = 0;




// DB config
const uri = 'mongodb+srv://bharathidpm:lakshmidpm@cluster0.fcttb.mongodb.net/bars11?retryWrites=true&w=majority';


//Morning schedule db fetch
schedule.scheduleJob('00 00 03 * * 1-5', function(){
	webPageDetails= [];
	dbInterval =   setInterval(() =>  startMongo()  , 60000);
});

// Morning Login schedule
schedule.scheduleJob('00 37 03 * * 1-5', function(){	
	loginInterval =   setInterval(() =>  startLogin()  , 60000);
});

// Emergency restart
if ((new Date().getHours()) >=3 && (new Date().getHours()) <=9 ) {
	if ((new Date().getDay()) >=1 && (new Date().getDay()) <=5){
	startMongo();	
	emergencylogin =	setInterval(() =>  startLogin()  , 60000);
	emaInterval =   setInterval(() =>  emacalc()  , 300000); 
	}
}

// Extract data from DB 
function startMongo() {	
	mongodb.connect(uri,{ useUnifiedTopology: true }).then(res => {
		addLogs("DB Connected");
		res.db("bars11").collection("autotrade").findOne({}, function(err, result) {
            if (err) throw err;
		    zerouser = result.userid;
			zeropwd = result.pwd;
			zeropin = result.zpin;
			ema5 = result.ema5;
			ema21 = result.ema21;
			tsymbol = result.tradesym;
			buyPositionInitiated = result.futbuy.buyPositionInitiated;
			buyPositionOpened = result.futbuy.buyPositionOpened;
			buyPositionClosed = result.futbuy.buyPositionClosed;
			buyValue = result.futbuy.buyValue;
            sellPositionInitiated = result.futsell.sellPositionInitiated;
            sellPositionOpened = result.futsell.sellPositionOpened;
            sellPositionClosed = result.futsell.sellPositionClosed;
            sellValue = result.futsell.sellValue;
            enableBuycheck = result.futlevel.enableBuycheck;
            iboLow = result.futlevel.iboLow;
            iboHigh = result.futlevel.iboHigh;	
			clearInterval(dbInterval);
            res.close();
        });		 
	}).catch(err => console.log(err));	
}

// Login into kite , calculate margin and start websocket streaming
function startLogin() {
	axios.get('https://kite.zerodha.com/connect/login?v=3&api_key=6l7wlikr9ar2c61y', {}).then((res) => {
		referer = res.request.res.responseUrl;
		sredirect = referer.concat('&skip_session=true');
		axios.post('https://kite.zerodha.com/api/login',querystring.stringify({user_id: zerouser,password: zeropwd}), {
			headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"referer": res.request.res.responseUrl
		}}).then(function(response) {
			scookie =  (response.headers['set-cookie'][0].split(';')[0]).concat(';',response.headers['set-cookie'][1].split(';')[0])
			axios.post('https://kite.zerodha.com/api/twofa',
				querystring.stringify({
				user_id: zerouser,
				twofa_value: zeropin,
				request_id: response.data.data.request_id
		}), {
			headers: { 
				"Content-Type": "application/x-www-form-urlencoded",
				'referer': referer,
				'cookie': scookie
			}
		}).then(function(response) {
			axios.get(sredirect, {
				headers:{
					'referer': referer,
					'cookie': scookie			  
				}
			}).then(function(res) {
				my_request_token = res.request.res.responseUrl.split('request_token=')[1].split('&')[0] ;
				addLogs("Login Successful");
				startSession();
				clearInterval(loginInterval);
				clearInterval(emergencylogin);
			}).catch((error) => {
				console.error(error)
			});  
		}).catch((error) => {
			console.error(error)
		})
		}).catch((error) => {
		console.error(error)
	    });	  
	}).catch((error) => {
		console.error(error)
	});		
}

//start Kite Session
function startSession() {	
    kc.generateSession(my_request_token, "lc3f7s1r6cu4e0vfr1m06iflvlxpjgrr").then(function(response) {
		access_token = response.access_token;
		marginCalc();
		getInst();
	}).catch(function(err) {
		console.log(err);
	});	
}

// Margin calculation	
function marginCalc() {
	kc.getMargins().then(function(response) {
		console.log(response);
		margin = response.equity.available.opening_balance;
		tradeSize = 75 * (margin-(margin % 90000))/90000;
	}).catch(function(err) {
		console.log(err);
	});		
}

function getInst(){
kc.getQuote('NFO:'+ tsymbol).then(function(response) {
		instrument_name = response['NFO:'+ tsymbol].instrument_token;
		streamN();
	}).catch(function(err) {
		console.log(err);
	});
}

//Websocket Streaming
function streamN() {
	addLogs("Data streaming started");
	var KiteTicker = require("kiteconnect").KiteTicker;
    var ticker = new KiteTicker({ api_key: "6l7wlikr9ar2c61y", access_token: access_token });

    // set autoreconnect with 24 maximum reconnections and 5 second interval
    ticker.autoReconnect(true, 24, 5)
    ticker.connect();
    ticker.on("ticks", onTicks);
    ticker.on("connect", subscribe);
    ticker.on("noreconnect", function() {
		console.log("noreconnect");
    });
    ticker.on("reconnect", function(reconnect_count, reconnect_interval) {
		console.log("Reconnecting: attempt - ", reconnect_count, " interval - ", reconnect_interval);
    });

    function onTicks(ticks) {
    	ltp = ticks[0].last_price;
		ohlc = ticks[0].ohlc;
		ema5Close = ema5 + ((ltp - ema5)*0.33333);
		if (buyPositionOpened === 0 && enableBuycheck === 1 && buyPositionInitiated === 0) {
			buyCheck();
		}
		if (buyPositionOpened === 1 && buyPositionClosed ===0 ) {
			buyClose();	
		}
		if (sellPositionOpened === 0 && enableBuycheck === 1 && sellPositionInitiated === 0) {
			sellCheck();
		}
		if (sellPositionOpened === 1 && sellPositionClosed ===0 ) {
			sellClose();	
		}	
    }

    function subscribe() {
		var items = [instrument_name];
		ticker.subscribe(items);
		ticker.setMode(ticker.modeFull, items);
    }	
}

// Ema calculation scheduling
schedule.scheduleJob('00 40 03 * * 1-5', function(){
	addLogs("Ema calc Successfully");	
	emaInterval =   setInterval(() =>  emacalc()  , 300000); 
});
function emacalc() {
	ema5 = ema5 + ((ltp - ema5)*0.33333);
	ema21 = ema21 + ((ltp - ema21)*0.090909);
	updateDb({"ema5": ema5, "ema21": ema21 })
}

//Fetch high and low details
schedule.scheduleJob('00 15 04 * * 1-5', function(){
	iboLow = ohlc.low;
	iboHigh = ohlc.high;
	enableBuycheck = 1;
	updateDb({"futlevel.enableBuycheck": 1, "futlevel.iboLow": iboLow , "futlevel.iboHigh": iboHigh })
	addLogs("Levels captured Successfully");

});

//check for buyPosition
function buyCheck() {	
	if (ema5Close > iboHigh && ema5Close > ema21) {
		buyPositionInitiated = 1;	
		kc.placeOrder("regular", {
			"exchange": "NFO",
			"tradingsymbol": tsymbol,
			"transaction_type": "BUY",
			"quantity": tradeSize,
			"product": "MIS",
			"order_type": "MARKET"
		}).then(function(resp) {
			addLogs("Buy Order Placed");
			buyValue = ltp;	
			buyPositionOpened = 1;
			kc.getOrderHistory(resp.order_id).then(function(resp) {
			resp.map((res) => {
				if(res.status === "REJECTED") {
                    buyPositionInitiated = 0;
					buyPositionOpened = 0;
					addLogs("Buy Poistion Entry Failed");
				}
				if(res.status === "COMPLETE") {
                    buyPositionOpened = 1;
					buyValue = res.average_price;
					updateDb({"futbuy.buyPositionInitiated": 1, "futbuy.buyPositionOpened": 1, "futbuy.buyValue": buyValue});
					addLogs("Buy Poistion Entered");	
				}
		        });
		    }).catch(function(err) {
				console.log(err);
		    });		
		}).catch(function(err) {
			buyPositionInitiated = 0;
			console.log(err);
		});
	}	
}

function buyClose() {
	if (ltp < (buyValue - 22) || ltp > (buyValue + 22) ){	
		buyPositionClosed =1;
		kc.placeOrder("regular", {
			"exchange": "NFO",
			"tradingsymbol": tsymbol,
			"transaction_type": "SELL",
			"quantity": tradeSize,
			"product": "MIS",
			"order_type": "MARKET"
		}).then(function(resp) {
			kc.getOrderHistory(resp.order_id).then(function(resp) {
			resp.map((res) => {
				if(res.status === "REJECTED") {
                    buyPositionClosed = 0;	
                    addLogs("Buy Poistion Exit Failed");	
				}
				if(res.status === "COMPLETE") {
					updateDb({"futbuy.buyPositionClosed": 1});	
				}
		    });
		}).catch(function(err) {
			console.log(err);
		});	
		}).catch(function(err) {
			buyPositionClosed = 0;
			console.log(err);
			addLogs("Buy Poistion Exit Failed");
		});			
        addLogs("Buy Poistion exited");		
	}
}

function sellCheck() {	
	if (ema5Close < iboLow && ema5Close < ema21) {
		sellPositionInitiated = 1;
		kc.placeOrder("regular", {
			"exchange": "NFO",
			"tradingsymbol": tsymbol,
			"transaction_type": "SELL",
			"quantity": tradeSize,
			"product": "MIS",
			"order_type": "MARKET"
		}).then(function(resp) {
            addLogs("Sell Order Placed");
			sellValue = ltp;
			sellPositionOpened = 1;
			kc.getOrderHistory(resp.order_id).then(function(resp) {
			resp.map((res) => {
				if(res.status === "COMPLETE") {
                    sellPositionOpened = 1;	
					sellValue = res.average_price;
					updateDb({"futsell.sellPositionInitiated": 1, "futsell.sellPositionOpened": 1, "futsell.sellValue": sellValue});			
                    addLogs("Sell Order Executed");					
				}
				if(res.status === "REJECTED") {
                    sellPositionInitiated = 0;
					sellPositionOpened = 0;
					addLogs("Sell Poistion Entry Failed");	
				}
			});
		    }).catch(function(err) {
			console.log(err);
		    });			
		}).catch(function(err) {
			sellPositionInitiated = 0;
			console.log(err);
		});
	}
}

function sellClose() {	
	if (ltp < (sellValue - 22) || ltp > (sellValue + 22) ){
        sellPositionClosed =1;	
		kc.placeOrder("regular", {
			"exchange": "NFO",
			"tradingsymbol": tsymbol,
			"transaction_type": "BUY",
			"quantity": tradeSize,
			"product": "MIS",
			"order_type": "MARKET"
		}).then(function(resp) {
			kc.getOrderHistory(resp.order_id).then(function(resp) {
			resp.map((res) => {
				if(res.status === "REJECTED") {
                    sellPositionClosed = 0;	
                    addLogs("Sell Poistion Exit Failed");					
				}
				if(res.status === "COMPLETE") {
					updateDb({"futsell.sellPositionClosed": 1});	
				}
		    });
		    }).catch(function(err) {
		    	console.log(err);
			});	
		}).catch(function(err) {
			sellPositionClosed = 0;	
			console.log(err);
		});			
        addLogs("Sell Poistion exited");		
	}
}



schedule.scheduleJob('00 30 09 * * 1-5', function(){
    enableBuycheck = 0;
	addLogs("New Position disabled");
	updateDb({"futlevel.enableBuycheck": 0 })
});

schedule.scheduleJob('00 02 10 * * 1-5', function(){
    clearInterval(emaInterval);
	iboLow = 0;
    iboHigh = 0;
	buyPositionInitiated = 0;
    buyPositionOpened = 0;
    buyPositionClosed = 0 ;
    buyValue = 0;
	sellPositionInitiated = 0;
    sellPositionOpened = 0;
    sellPositionClosed = 0 ;
    sellValue = 0;
	addLogs("DB Updated");
    updateDb({"futlevel.iboLow": 0 , "futlevel.iboHigh": 0,"futsell.sellPositionInitiated": 0, "futsell.sellPositionOpened": 0, "futsell.sellValue": 0, "futsell.sellPositionClosed": 0,
		"futbuy.buyPositionInitiated": 0, "futbuy.buyPositionOpened": 0, "futsell.buyPositionClosed": 0,"futbuy.buyValue": 0 })


});

function updateDb(updobj) {
	
		mongodb.connect(uri,{ useUnifiedTopology: true }).then(res => {		
		res.db("bars11").collection("autotrade").updateOne({ uname: "bars11" }, { $set: updobj }, function(err, resp) {
			if (err) throw err;
			res.close();
        });		 
	}).catch(err => console.log(err));
	
}

function addLogs(str1) {
	 webPageDetails.push(str1);
	 app.set('wconsole', webPageDetails); 
}	
addLogs("Node restarted"); 

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;



