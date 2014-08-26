var express = require('express');
var app = express();
var compression = require('compression')
var flash = require('connect-flash')
var debug = require('debug')('nowplaying-node');
var MongoClient = require('mongodb').MongoClient;
var cookieParser = require('cookie-parser')
var bodyParser = require('body-parser')
var VERSION = "0.0.1"

var moment = require('moment')
var passport = require('passport')
var session = require('cookie-session')
, LocalStrategy = require('passport-local').Strategy;

try {
	var config = require('./config')
} catch (e)
{
	console.log("Not configured yet! -- boo! Copy config.js.EXAMPLE to config.js and customise it please!")
	process.exit()
}

var nowplaying = {}

MongoClient.connect(config.mongo.connectionString, function (err, db)
{
	passport.use(new LocalStrategy( function (username, password, done) {
		process.nextTick(function () {
			if (password == "hackme")
			{
				return done(null, "bob")
			} else {
				return done (null, false, { message: "Invalid Password" })
			}
		})
	}));
	app.set('views', __dirname + '/views');
	app.set('view engine', 'ejs');
	app.use( session({ secret: config.sessionKeySecret }));
	
	app.use( compression({ threshold: 512 }) )
	app.use(cookieParser())	
	app.use(express.static(__dirname + '/wwwroot'));
	app.use(flash());
	app.use( bodyParser.json() );       // to support JSON-encoded bodies
	app.use( bodyParser.urlencoded() ); // to support URL-encoded bodies
	app.use(passport.initialize());
	app.use(passport.session());
	
	app.get('/version', function (req, res)
	{
		res.end(JSON.stringify({
			application: 'node-nowplaying',
			version: VERSION,
			author: "Chris Roberts"
		}))
	});
	
	app.post('/feed/:clientID', function (req, res) {
		nowplaying = {'data': req.body, 'source': req.query.clientID}
		res.end(JSON.stringify({code:200,msg:'OK'}))
	});
	
	app.get('/nowplaying', function (req, res) {
		res.end(JSON.stringify(nowplaying))
	});
	
	app.get('/admin/login', function (req, res)
	{
		res.render('login', { user: req.user, message: req.flash('error') });
	});
	
	app.post('/admin/login', 
		passport.authenticate('local', { failureRedirect: '/admin/login', failureFlash: true }),
		function (req, res)
		{
			res.redirect('/admin')
		}
	);
	
	app.get('/admin/logout', function(req, res){
		req.logout();
		res.redirect('/admin/login');
	});
	
	app.get('/admin', ensureAuthenticated, function (req, res) {
		res.end("Heyo!")
	});
	
	var server = app.listen(3000, function () {
		console.log("Listening on port %d", server.address().port)
	});
	
	function ensureAuthenticated(req, res, next) {
		if (req.isAuthenticated()) { return next(); }
		res.redirect('/admin/login');
	}
})